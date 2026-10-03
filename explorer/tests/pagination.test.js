import { buildNextPageQuery, canPaginate } from '../pagination.js';

describe('buildNextPageQuery', () => {
    test('inserts an after cursor into an existing page argument', () => {
        const q = `query {
  ProductInfos(filter: { ProductType: { eq: "SINGLE STOCK OPTIONS" } }, page: { first: 10 }) {
    data { Product }
    pageInfo { hasNextPage endCursor }
  }
}`;
        const next = buildNextPageQuery(q, 'ProductInfos', 'abc==');
        expect(next).toContain('page: { after: "abc==", first: 10 }');
        expect(next).toContain('filter: { ProductType: { eq: "SINGLE STOCK OPTIONS" } }');
        expect(next).toContain('pageInfo { hasNextPage endCursor }');
    });

    test('replaces an existing cursor', () => {
        const q = 'query { Contracts(page: { first: 50, after: "old" }) { data { ISIN } pageInfo { hasNextPage endCursor } } }';
        expect(buildNextPageQuery(q, 'Contracts', 'new')).toContain('page: { first: 50, after: "new" }');
    });

    test('handles an empty page object', () => {
        const q = 'query { Contracts(page: {}) { data { ISIN } } }';
        expect(buildNextPageQuery(q, 'Contracts', 'c1')).toContain('page: { after: "c1" }');
    });

    test('escapes cursors that contain quotes', () => {
        const q = 'query { Contracts(page: { first: 5 }) { data { ISIN } } }';
        expect(buildNextPageQuery(q, 'Contracts', 'a"b')).toContain('after: "a\\"b"');
    });

    test('requests only the paged root field when there are no variables', () => {
        const q = `query {
  ProductInfos { data { Product } }
  Contracts(filter: { Product: { eq: "FESX" } }, page: { first: 100 }) {
    data { ISIN }
    pageInfo { hasNextPage endCursor }
  }
}`;
        const next = buildNextPageQuery(q, 'Contracts', 'c9');
        expect(next).not.toContain('ProductInfos');
        expect(next.startsWith('query {')).toBe(true);
        expect(next).toContain('Contracts(filter: { Product: { eq: "FESX" } }, page: { after: "c9", first: 100 })');
    });

    test('keeps the whole operation when variables are declared', () => {
        const q = `query ($p: String) {
  ProductInfos { data { Product } }
  Contracts(filter: { Product: { eq: $p } }, page: { first: 100 }) { data { ISIN } }
}`;
        const next = buildNextPageQuery(q, 'Contracts', 'c9');
        expect(next).toContain('query ($p: String)');
        expect(next).toContain('ProductInfos');
        expect(next).toContain('after: "c9"');
    });

    test('matches the response key when the field is aliased', () => {
        const q = 'query { first: Contracts(page: { first: 5 }) { data { ISIN } } other: Contracts { data { ISIN } } }';
        const next = buildNextPageQuery(q, 'first', 'c2');
        expect(next).toContain('first: Contracts(page: { after: "c2", first: 5 })');
        expect(next).not.toContain('other');
        expect(buildNextPageQuery(q, 'Contracts', 'c2')).toBeNull();
    });

    test('is not fooled by page or after inside other arguments or nested objects', () => {
        const q = 'query { Contracts(filter: { Name: { eq: "page" } }, page: { first: 5 }) { data { page } } }';
        expect(buildNextPageQuery(q, 'Contracts', 'c')).toContain('page: { after: "c", first: 5 }');
    });

    test('returns null when the query cannot be advanced', () => {
        // no page argument
        expect(buildNextPageQuery('query { Contracts { data { ISIN } } }', 'Contracts', 'c')).toBeNull();
        // page or cursor supplied by a variable
        expect(buildNextPageQuery('query ($p: PageInput) { Contracts(page: $p) { data { ISIN } } }', 'Contracts', 'c')).toBeNull();
        expect(buildNextPageQuery('query ($c: String) { Contracts(page: { first: 5, after: $c }) { data { ISIN } } }', 'Contracts', 'c')).toBeNull();
        // unknown root field, missing cursor, empty query
        expect(buildNextPageQuery('query { Contracts(page: { first: 5 }) { data { ISIN } } }', 'Nope', 'c')).toBeNull();
        expect(buildNextPageQuery('query { Contracts(page: { first: 5 }) { data { ISIN } } }', 'Contracts', '')).toBeNull();
        expect(buildNextPageQuery('', 'Contracts', 'c')).toBeNull();
    });

    test('canPaginate reports whether a table can load more', () => {
        expect(canPaginate('query { Contracts(page: { first: 5 }) { data { ISIN } } }', 'Contracts')).toBe(true);
        expect(canPaginate('query { Contracts { data { ISIN } } }', 'Contracts')).toBe(false);
    });
});
