import { jest } from '@jest/globals';
import { GraphQLClient, GraphQLRequestError } from '../client.js';

const reply = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});

const make = () => {
    const client = new GraphQLClient('https://example.test/graphql', 'key');
    client.sleep = jest.fn(async () => {});
    return client;
};

const QUERY = '{ Contracts { data { ISIN } } }';
const ok = (data) => reply(200, { data });

afterEach(() => { delete global.fetch; });

describe('GraphQLClient requests', () => {
    test('flattens a single root field and keeps date, name and pageInfo', async () => {
        global.fetch = jest.fn(async () => ok({
            Contracts: { date: '2026-10-02', data: [{ ISIN: 'A' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } }
        }));
        const res = await make().request(QUERY);
        expect(res).toEqual({ data: [{ ISIN: 'A' }], date: '2026-10-02', name: 'Contracts', pageInfo: { hasNextPage: true, endCursor: 'c1' } });
    });

    test('multiple root fields become tables that each keep their pageInfo', async () => {
        global.fetch = jest.fn(async () => ok({
            A: { data: [{ x: 1 }], pageInfo: { hasNextPage: false, endCursor: null } },
            B: { data: [{ y: 2 }] }
        }));
        const res = await make().request(QUERY);
        expect(res.isMultiTable).toBe(true);
        expect(res.data.map(t => [t.name, t.pageInfo])).toEqual([['A', { hasNextPage: false, endCursor: null }], ['B', null]]);
    });

    test('requires an API key and a query', async () => {
        await expect(new GraphQLClient('u', '').request(QUERY)).rejects.toThrow('API Key and Query are required.');
    });

    test('caches successful responses', async () => {
        global.fetch = jest.fn(async () => ok({ Contracts: { data: [{ ISIN: 'A' }] } }));
        const client = make();
        await client.request(QUERY);
        await client.request(QUERY);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await client.request(QUERY, null, true, { fresh: true });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('GraphQLClient errors', () => {
    test('fails when the server returns only errors', async () => {
        global.fetch = jest.fn(async () => reply(200, { data: null, errors: [{ message: 'bad field' }] }));
        const err = await make().request(QUERY).catch(e => e);
        expect(err).toBeInstanceOf(GraphQLRequestError);
        expect(err.kind).toBe('graphql');
        expect(err.message).toBe('GraphQL Error: bad field');
    });

    test('keeps the data of root fields that worked when another one fails', async () => {
        global.fetch = jest.fn(async () => reply(200, {
            data: { Holidays: { date: '2026-10-02' }, Changelog: null },
            errors: [{ message: 'upstream timeout', path: ['Changelog'] }]
        }));
        const client = make();
        const res = await client.request('{ Holidays { date } Changelog { date } }', null, false);
        expect(res.Holidays.date).toBe('2026-10-02');
        expect(res.Changelog).toBeNull();
        expect(res.partialErrors).toEqual(['Changelog: upstream timeout']);
        expect(Object.keys(res)).toEqual(['Holidays', 'Changelog']); // partialErrors does not show up as a root field
        // partial results are not cached
        await client.request('{ Holidays { date } Changelog { date } }', null, false);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('flattened partial results carry partialErrors', async () => {
        global.fetch = jest.fn(async () => reply(200, {
            data: { A: { data: [{ x: 1 }] }, B: null },
            errors: [{ message: 'boom', path: ['B'] }]
        }));
        const res = await make().request(QUERY);
        expect(res.data).toEqual([{ x: 1 }]);
        expect(res.partialErrors).toEqual(['B: boom']);
    });

    test('maps 401 and 403 to an authentication message', async () => {
        global.fetch = jest.fn(async () => reply(403, 'no'));
        const err = await make().request(QUERY).catch(e => e);
        expect(err.kind).toBe('auth');
        expect(err.message).toMatch(/check your API Key/);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('maps 5xx to a server error without retrying a 500', async () => {
        global.fetch = jest.fn(async () => reply(500, 'oops'));
        const err = await make().request(QUERY).catch(e => e);
        expect(err.kind).toBe('server');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('reports a non-JSON success response', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('x'); } }));
        const err = await make().request(QUERY).catch(e => e);
        expect(err.kind).toBe('response');
    });

    test('reports network failures', async () => {
        global.fetch = jest.fn(async () => { throw new TypeError('offline'); });
        const err = await make().request(QUERY).catch(e => e);
        expect(err.kind).toBe('network');
        expect(err.message).toMatch(/offline/);
    });
});

describe('GraphQLClient rate limiting and retries', () => {
    test('retries a 429 using Retry-After and then succeeds', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(reply(429, 'slow down', { 'Retry-After': '3' }))
            .mockResolvedValueOnce(ok({ Contracts: { data: [{ ISIN: 'A' }] } }));
        const client = make();
        const onRetry = jest.fn();
        const res = await client.request(QUERY, null, true, { onRetry });
        expect(res.data).toHaveLength(1);
        expect(client.sleep).toHaveBeenCalledWith(3000);
        expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 3000, status: 429 });
    });

    test('backs off exponentially without Retry-After and gives up with a rate-limit error', async () => {
        global.fetch = jest.fn(async () => reply(429, 'slow down'));
        const client = make();
        const err = await client.request(QUERY).catch(e => e);
        expect(err.kind).toBe('rate_limit');
        expect(err.status).toBe(429);
        expect(err.message).toMatch(/Rate limit reached/);
        expect(global.fetch).toHaveBeenCalledTimes(3); // first try + 2 retries
        expect(client.sleep.mock.calls.map(c => c[0])).toEqual([1000, 2000]);
    });

    test('caps an excessive Retry-After', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(reply(503, '', { 'Retry-After': '600' }))
            .mockResolvedValueOnce(ok({ Contracts: { data: [{ ISIN: 'A' }] } }));
        const client = make();
        await client.request(QUERY);
        expect(client.sleep).toHaveBeenCalledWith(10000);
    });
});

describe('GraphQLClient timeout and cancel', () => {
    test('times out a request that never answers', async () => {
        global.fetch = jest.fn((url, init) => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        const client = make();
        client.timeoutMs = 20;
        const err = await client.request(QUERY).catch(e => e);
        expect(err.kind).toBe('timeout');
        expect(err.message).toMatch(/timed out/);
    });

    test('a caller can stop waiting without breaking the shared request', async () => {
        let release;
        global.fetch = jest.fn(() => new Promise(resolve => { release = () => resolve(ok({ Contracts: { data: [{ ISIN: 'A' }] } })); }));
        const client = make();
        const controller = new AbortController();
        const waiting = client.request(QUERY, null, true, { signal: controller.signal });
        const other = client.request(QUERY); // shares the in-flight request
        controller.abort();
        const err = await waiting.catch(e => e);
        expect(err.kind).toBe('aborted');
        release();
        expect((await other).data).toHaveLength(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('an already aborted signal rejects immediately', async () => {
        global.fetch = jest.fn(async () => ok({ Contracts: { data: [{ ISIN: 'A' }] } }));
        const controller = new AbortController();
        controller.abort();
        const err = await make().request(QUERY, null, true, { signal: controller.signal }).catch(e => e);
        expect(err.kind).toBe('aborted');
    });
});
