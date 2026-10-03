// kind: 'network' | 'timeout' | 'aborted' | 'auth' | 'rate_limit' | 'server' | 'http' | 'graphql' | 'response'
export class GraphQLRequestError extends Error {
    constructor(message, { kind = 'http', status = null, retryAfter = null, errors = null } = {}) {
        super(message);
        this.name = 'GraphQLRequestError';
        this.kind = kind;
        this.status = status;
        this.retryAfter = retryAfter;
        this.errors = errors;
    }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 10000;

const RATE_LIMIT_MESSAGE = 'Rate limit reached (HTTP 429). Wait a moment and run the query again. '
    + 'Shared API keys are rate-limited; a personal key from the Deutsche Börse Developer Portal has a higher limit.';

// One line per GraphQL error, with the root field it belongs to when the server says so
const describeErrors = (errors) => errors.map(e => {
    const where = Array.isArray(e.path) && e.path.length ? `${e.path[0]}: ` : '';
    return where + e.message;
});

// Seconds ("5") or an HTTP date in a Retry-After header, as milliseconds; null when absent or invalid
function parseRetryAfter(value, now = Date.now()) {
    if (!value) return null;
    const secs = Number(value);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export class GraphQLClient {
    constructor(endpoint, apiKey) {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.cache = new Map(); // key -> {timestamp, data}
        this.inFlight = new Map(); // key -> Promise
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        this.timeoutMs = 30000; // per attempt
        this.maxRetries = 2; // extra attempts after 429 / 502 / 503 / 504
        this.retryBaseMs = 1000; // doubles per attempt when the server sends no Retry-After
        this.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    }

    setEndpoint(url) { this.endpoint = url; }
    setApiKey(key) { this.apiKey = key; }

    /**
     * options.fresh: skip the response cache (e.g. an explicit refresh)
     * options.signal: AbortSignal; the caller stops waiting (a request shared with other callers keeps running)
     * options.onRetry: ({ attempt, delayMs, status }) => void, called before waiting to retry
     *
     * With `flatten`, the result is { data, date, name, pageInfo } (or { data: [...tables], isMultiTable }).
     * When the server returns data together with errors, the result carries `partialErrors` (list of strings)
     * instead of failing the whole request; such results are not cached.
     */
    async request(query, variables = null, flatten = true, options = {}) {
        if (!this.apiKey || !query) {
            throw new Error('API Key and Query are required.');
        }

        const cacheKey = JSON.stringify({ query, variables, endpoint: this.endpoint, apiKey: this.apiKey, flatten });
        const now = Date.now();
        if (options.fresh) this.cache.delete(cacheKey);

        // Check cache
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now - cached.timestamp < this.cacheTTL) {
                return cached.data;
            } else {
                this.cache.delete(cacheKey);
            }
        }

        // Check in-flight requests for deduplication
        if (this.inFlight.has(cacheKey)) {
            return this._withSignal(this.inFlight.get(cacheKey), options.signal);
        }

        const fetchPromise = this._executeRequest(query, variables, flatten, options).then(data => {
            const hasData = flatten
                ? (data && data.data && data.data.length > 0)
                : (data && Object.keys(data).length > 0);

            if (hasData && !data.partialErrors) {
                this.cache.set(cacheKey, { timestamp: Date.now(), data });
            }
            this.inFlight.delete(cacheKey);
            return data;
        }).catch(err => {
            this.inFlight.delete(cacheKey);
            throw err;
        });

        this.inFlight.set(cacheKey, fetchPromise);
        return this._withSignal(fetchPromise, options.signal);
    }

    _withSignal(promise, signal) {
        if (!signal) return promise;
        const cancelled = () => new GraphQLRequestError('Request cancelled.', { kind: 'aborted' });
        if (signal.aborted) {
            promise.catch(() => {}); // the shared request may still fail later; nobody is waiting for it here
            return Promise.reject(cancelled());
        }
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(cancelled());
            signal.addEventListener('abort', onAbort, { once: true });
            promise.then(
                value => { signal.removeEventListener('abort', onAbort); resolve(value); },
                err => { signal.removeEventListener('abort', onAbort); reject(err); }
            );
        });
    }

    // One HTTP attempt. Resolves with the Response; rejects with GraphQLRequestError (network / timeout).
    async _fetchOnce(body) {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
        try {
            return await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-DBP-APIKEY': this.apiKey
                },
                body,
                signal: controller.signal
            });
        } catch (networkErr) {
            if (timedOut) {
                throw new GraphQLRequestError(`The request timed out after ${Math.round(this.timeoutMs / 1000)} s. Try a narrower filter or run it again.`, { kind: 'timeout' });
            }
            throw new GraphQLRequestError(`Network Error: Ensure the URL is correct and you have an internet connection. (${networkErr.message})`, { kind: 'network' });
        } finally {
            clearTimeout(timer);
        }
    }

    async _executeRequest(query, variables, flatten, options = {}) {
        const payload = { query };
        if (variables) payload.variables = variables;
        const body = JSON.stringify(payload);

        let response;
        for (let attempt = 0; ; attempt++) {
            response = await this._fetchOnce(body);
            if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt >= this.maxRetries) break;

            const retryAfter = parseRetryAfter(response.headers?.get?.('Retry-After'));
            const delayMs = Math.min(retryAfter ?? this.retryBaseMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
            if (options.onRetry) options.onRetry({ attempt: attempt + 1, delayMs, status: response.status });
            await this.sleep(delayMs);
        }

        if (!response.ok) {
            const status = response.status;
            const retryAfter = parseRetryAfter(response.headers?.get?.('Retry-After'));
            if (status === 401 || status === 403) throw new GraphQLRequestError('Authentication failed: Please check your API Key.', { kind: 'auth', status });
            if (status === 429) throw new GraphQLRequestError(RATE_LIMIT_MESSAGE, { kind: 'rate_limit', status, retryAfter });
            if (status >= 500) throw new GraphQLRequestError(`Server Error (${status}): The Eurex API is currently unavailable.`, { kind: 'server', status });
            const msg = await response.text();
            throw new GraphQLRequestError(`HTTP Error ${status}: ${msg}`, { kind: 'http', status });
        }

        let json;
        try {
            json = await response.json();
        } catch (e) {
            throw new GraphQLRequestError('The API returned a response that is not valid JSON.', { kind: 'response' });
        }

        const errors = Array.isArray(json.errors) ? json.errors : [];
        const hasData = !!json.data && Object.values(json.data).some(v => v !== null && v !== undefined);
        if (errors.length > 0 && !hasData) {
            throw new GraphQLRequestError('GraphQL Error: ' + errors.map(e => e.message).join(', '), { kind: 'graphql', errors });
        }
        const partialErrors = errors.length > 0 ? describeErrors(errors) : null;

        if (!flatten) {
            const data = json.data;
            if (partialErrors && data && typeof data === 'object') {
                // Not enumerable, so callers that iterate the root fields never see it
                Object.defineProperty(data, 'partialErrors', { value: partialErrors, enumerable: false });
            }
            return data;
        }
        const flat = this._flattenGraphQLResponse(json.data);
        if (partialErrors) flat.partialErrors = partialErrors;
        return flat;
    }

    _flattenGraphQLResponse(dataObj) {
        if (!dataObj) return { data: [], date: null };

        const results = [];

        // First list of rows under a root field, with the validity date and page info that sit next to it
        function getFirstArray(obj) {
            let found = { array: null, date: null, pageInfo: null };

            function search(o) {
                if (Array.isArray(o)) {
                    found.array = o;
                    return true;
                }
                if (typeof o === 'object' && o !== null) {
                    if (Array.isArray(o.data)) {
                        found.array = o.data;
                        if (o.date) found.date = o.date;
                        if (o.pageInfo && typeof o.pageInfo === 'object') found.pageInfo = o.pageInfo;
                        return true;
                    }
                    for (const key of Object.keys(o)) {
                        if (search(o[key])) return true;
                    }
                }
                return false;
            }

            search(obj);
            return found;
        }

        for (const [key, value] of Object.entries(dataObj)) {
            const { array, date, pageInfo } = getFirstArray(value);
            if (array) {
                results.push({
                    name: key,
                    data: array,
                    date: date,
                    pageInfo: pageInfo
                });
            }
        }

        if (results.length === 0) return { data: [], date: null };

        if (results.length === 1) {
            return {
                data: results[0].data,
                date: results[0].date,
                name: results[0].name,
                pageInfo: results[0].pageInfo
            };
        }

        return {
            data: results,
            isMultiTable: true,
            date: results[0] ? results[0].date : null
        };
    }
}
