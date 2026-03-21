export class GraphQLClient {
    constructor(endpoint, apiKey) {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.cache = new Map(); // key -> {timestamp, data}
        this.inFlight = new Map(); // key -> Promise
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    }

    setEndpoint(url) { this.endpoint = url; }
    setApiKey(key) { this.apiKey = key; }

    async request(query, flatten = true) {
        if (!this.apiKey || !query) {
            throw new Error('API Key and Query are required.');
        }

        const cacheKey = JSON.stringify({ query, endpoint: this.endpoint, apiKey: this.apiKey, flatten });
        const now = Date.now();

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
            return this.inFlight.get(cacheKey);
        }

        const fetchPromise = this._executeRequest(query, flatten).then(data => {
            if (data.length > 0) {
                this.cache.set(cacheKey, { timestamp: Date.now(), data });
            }
            this.inFlight.delete(cacheKey);
            return data;
        }).catch(err => {
            this.inFlight.delete(cacheKey);
            throw err;
        });

        this.inFlight.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    async _executeRequest(query, flatten) {
        let response;
        try {
            response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-DBP-APIKEY': this.apiKey
                },
                body: JSON.stringify({ query })
            });
        } catch (networkErr) {
            throw new Error(`Network Error: Ensure the URL is correct and you have an internet connection. (${networkErr.message})`);
        }

        if (!response.ok) {
            const status = response.status;
            let msg = await response.text();
            if (status === 401 || status === 403) throw new Error("Authentication failed: Please check your API Key.");
            if (status >= 500) throw new Error(`Server Error (${status}): The Eurex API is currently unavailable.`);
            throw new Error(`HTTP Error ${status}: ${msg}`);
        }

        const json = await response.json();
        
        if (json.errors && json.errors.length > 0) {
            throw new Error('GraphQL Error: ' + json.errors.map(e => e.message).join(', '));
        }

        if (!flatten) return json.data;
        return this._flattenGraphQLResponse(json.data);
    }

    _flattenGraphQLResponse(dataObj) {
        if (!dataObj) return [];
        let targetArray = null;

        function findArray(obj) {
            if (Array.isArray(obj)) {
                targetArray = obj;
                return;
            }
            if (typeof obj === 'object' && obj !== null) {
                if (Array.isArray(obj.data)) {
                    targetArray = obj.data;
                    return;
                }
                for (const key of Object.keys(obj)) {
                    if (targetArray) break;
                    findArray(obj[key]);
                }
            }
        }

        findArray(dataObj);
        return targetArray || [];
    }
}
