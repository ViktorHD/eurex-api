"""Small GraphQL client for the Eurex reference-data API (standard library only)."""
import json
import os
import time
import urllib.error
import urllib.request

ENDPOINT = 'https://api.developer.deutsche-boerse.com/eurex-prod-graphql/'
# Shared demo key published on the landing page and in ai.md. Rate limited for everyone together.
DEMO_KEY = '68cdafd2-c5c1-49be-8558-37244ab4f513'

RETRYABLE = {429, 502, 503, 504}
MAX_RETRY_DELAY = 10.0


class EurexError(Exception):
    """kind: network | timeout | auth | rate_limit | server | http | graphql | response | input"""

    def __init__(self, message, kind='http', status=None, errors=None, hint=None):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.errors = errors
        self.hint = hint

    def to_dict(self):
        out = {'error': str(self), 'kind': self.kind}
        if self.status is not None:
            out['status'] = self.status
        if self.errors:
            out['graphql_errors'] = self.errors
        if self.hint:
            out['hint'] = self.hint
        return out


def _retry_after(value):
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return None


class EurexClient:
    def __init__(self, api_key=None, endpoint=None, timeout=30, max_retries=2, cache_ttl=300,
                 opener=None, sleep=time.sleep, clock=time.monotonic):
        self.api_key = api_key or os.environ.get('EUREX_API_KEY') or DEMO_KEY
        self.using_demo_key = self.api_key == DEMO_KEY
        self.endpoint = endpoint or os.environ.get('EUREX_API_ENDPOINT') or ENDPOINT
        self.timeout = timeout
        self.max_retries = max_retries
        self.cache_ttl = cache_ttl
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep
        self._clock = clock
        self._cache = {}

    def query(self, query, variables=None, fresh=False):
        """Run a query and return the `data` object. Raises EurexError.

        A response that carries both `data` and `errors` is partial: the data is returned with a
        `_partial_errors` entry so callers can say what is missing.
        """
        if not query or not str(query).strip():
            raise EurexError('Empty query.', kind='input')
        key = json.dumps([query, variables], sort_keys=True, default=str)
        hit = self._cache.get(key)
        if hit and not fresh and self._clock() - hit[0] < self.cache_ttl:
            return hit[1]
        body = {'query': query}
        if variables:
            body['variables'] = variables
        payload = self._post(body)
        errors = payload.get('errors')
        data = payload.get('data')
        if errors and not data:
            msgs = [self._describe(e) for e in errors]
            raise EurexError('GraphQL error: ' + '; '.join(msgs), kind='graphql', errors=msgs,
                             hint='Check names with get_schema instead of guessing; field and type names are case sensitive.')
        if not isinstance(data, dict):
            raise EurexError('Unexpected response: no data.', kind='response')
        if errors:
            data = dict(data)
            data['_partial_errors'] = [self._describe(e) for e in errors]
            return data  # partial answers are not cached
        self._cache[key] = (self._clock(), data)
        return data

    @staticmethod
    def _describe(err):
        path = err.get('path') if isinstance(err, dict) else None
        where = f'{path[0]}: ' if path else ''
        return where + (err.get('message', str(err)) if isinstance(err, dict) else str(err))

    def _post(self, body):
        raw = json.dumps(body).encode('utf-8')
        attempt = 0
        while True:
            req = urllib.request.Request(self.endpoint, data=raw, method='POST', headers={
                'Content-Type': 'application/json', 'Accept': 'application/json', 'X-DBP-APIKEY': self.api_key})
            try:
                with self._open(req, timeout=self.timeout) as resp:
                    text = resp.read().decode('utf-8')
                try:
                    return json.loads(text)
                except ValueError:
                    raise EurexError('The API returned something that is not JSON.', kind='response')
            except urllib.error.HTTPError as e:
                status = e.code
                if status in RETRYABLE and attempt < self.max_retries:
                    delay = _retry_after(e.headers.get('Retry-After') if e.headers else None)
                    self._sleep(min(MAX_RETRY_DELAY, delay if delay is not None else 2 ** attempt))
                    attempt += 1
                    continue
                raise self._http_error(status) from None
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                reason = getattr(e, 'reason', e)
                if isinstance(reason, TimeoutError) or isinstance(e, TimeoutError):
                    raise EurexError('The API did not answer in time.', kind='timeout',
                                     hint='Narrow the query (filters, fewer fields) and retry.') from None
                raise EurexError(f'Network error: {reason}', kind='network') from None

    def _http_error(self, status):
        if status in (401, 403):
            return EurexError(f'HTTP {status}: the API key is missing or invalid.', kind='auth', status=status,
                              hint='Set EUREX_API_KEY to a key from the Deutsche Börse developer portal.')
        if status == 429:
            hint = 'Wait a moment and retry.'
            if self.using_demo_key:
                hint += ' The shared demo key is rate limited for everyone; a free personal key avoids this.'
            return EurexError('HTTP 429: rate limit reached.', kind='rate_limit', status=status, hint=hint)
        if status >= 500:
            return EurexError(f'HTTP {status}: temporary server problem.', kind='server', status=status,
                              hint='Retry later or narrow the query.')
        return EurexError(f'HTTP {status}.', kind='http', status=status)
