import { buildSchemaIndex, completionsAt, didYouMean, validateAgainstSchema } from '../schemacheck.js';

const T = (name, kind = 'SCALAR') => ({ kind, name, ofType: null });
const NN = (t) => ({ kind: 'NON_NULL', name: null, ofType: t });
const L = (t) => ({ kind: 'LIST', name: null, ofType: t });
const f = (name, type, args = []) => ({ name, description: '', type, args });
const inp = (name, type) => ({ name, description: '', type });
const filterOf = (name, fields) => ({ kind: 'INPUT_OBJECT', name, inputFields: fields.map(([n, t]) => inp(n, T(t, 'INPUT_OBJECT'))) });

const SCHEMA = {
    queryType: { name: 'Query' },
    types: [
        { kind: 'OBJECT', name: 'Query', fields: [
            f('Contracts', T('ContractsResponse', 'OBJECT'), [inp('filter', T('ContractsFilter', 'INPUT_OBJECT')), inp('sort', T('ContractsSort', 'INPUT_OBJECT')), inp('page', T('PageInput', 'INPUT_OBJECT'))]),
            f('ProductInfos', T('ProductInfosResponse', 'OBJECT'), [inp('filter', T('ProductInfosFilter', 'INPUT_OBJECT'))]),
            f('Holidays', T('HolidaysResponse', 'OBJECT'), [])
        ] },
        { kind: 'OBJECT', name: 'ContractsResponse', fields: [f('date', T('String')), f('data', L(T('Contract', 'OBJECT'))), f('pageInfo', T('PageInfo', 'OBJECT'))] },
        { kind: 'OBJECT', name: 'ProductInfosResponse', fields: [f('date', T('String')), f('data', L(T('ProductInfo', 'OBJECT')))] },
        { kind: 'OBJECT', name: 'HolidaysResponse', fields: [f('date', T('String')), f('data', L(T('Holiday', 'OBJECT')))] },
        { kind: 'OBJECT', name: 'PageInfo', fields: [f('hasNextPage', T('Boolean')), f('endCursor', T('String'))] },
        { kind: 'OBJECT', name: 'Contract', fields: [f('Product', T('String')), f('ISIN', T('String')), f('ExpirationDate', T('String')), f('Strike', T('Float'))] },
        { kind: 'OBJECT', name: 'ProductInfo', fields: [f('Product', T('String')), f('Name', T('String'))] },
        { kind: 'OBJECT', name: 'Holiday', fields: [f('Product', T('String')), f('Holiday', T('String'))] },
        filterOf('ContractsFilter', [['Product', 'StringFilter'], ['ISIN', 'StringFilter'], ['Strike', 'FloatFilter']]),
        filterOf('ProductInfosFilter', [['Product', 'StringFilter']]),
        { kind: 'INPUT_OBJECT', name: 'StringFilter', inputFields: ['eq', 'in', 'beginsWith', 'contains'].map(n => inp(n, T('String'))) },
        { kind: 'INPUT_OBJECT', name: 'FloatFilter', inputFields: ['eq', 'gt', 'lt', 'between'].map(n => inp(n, T('Float'))) },
        { kind: 'INPUT_OBJECT', name: 'ContractsSort', inputFields: [inp('field', NN(T('ContractsSortField', 'ENUM'))), inp('order', T('SortOrder', 'ENUM'))] },
        { kind: 'INPUT_OBJECT', name: 'PageInput', inputFields: [inp('first', T('Int')), inp('after', T('String'))] },
        { kind: 'ENUM', name: 'ContractsSortField', enumValues: [{ name: 'Product' }, { name: 'ISIN' }, { name: 'Strike' }] },
        { kind: 'ENUM', name: 'SortOrder', enumValues: [{ name: 'ASC' }, { name: 'DESC' }] }
    ]
};
const index = buildSchemaIndex(SCHEMA);
const check = (q) => validateAgainstSchema(q, index);
const msgs = (q) => check(q).map(p => p.message);

describe('validateAgainstSchema', () => {
    test('a correct query has no problems', () => {
        expect(check(`query {
  Contracts(filter: { Product: { eq: "FESX" }, Strike: { gt: 5000 } }, sort: { field: Strike, order: ASC }, page: { first: 10 }) {
    date
    data { Product ISIN Strike }
    pageInfo { hasNextPage endCursor }
  }
}`)).toEqual([]);
    });

    test('unknown query with a suggestion and its position', () => {
        const q = 'query {\n  Contract(filter: {}) { data { ISIN } }\n}';
        const [p] = check(q);
        expect(p.message).toBe('Unknown query “Contract”. Did you mean “Contracts”?');
        expect([p.line, p.col]).toEqual([2, 3]);
        expect(q.slice(p.start, p.end)).toBe('Contract');
        expect(p.severity).toBe('error');
    });

    test('unknown field in the row type', () => {
        expect(msgs('query { Contracts { data { ISIN Strik } } }')).toEqual([
            '“Strik” is not a field of Contract. Available: Product, ISIN, ExpirationDate, Strike. Did you mean “Strike”?'
        ]);
    });

    test('field names are case sensitive but the hint finds the right case', () => {
        expect(msgs('query { Contracts { data { isin } } }')[0]).toMatch(/Did you mean “ISIN”\?/);
    });

    test('unknown argument and unknown filter field', () => {
        expect(msgs('query { Contracts(filtr: {}) { data { ISIN } } }')[0]).toMatch(/no argument “filtr”.*Did you mean “filter”\?/);
        expect(msgs('query { Contracts(filter: { Produkt: { eq: "x" } }) { data { ISIN } } }')[0]).toMatch(/Unknown filter field “Produkt” in ContractsFilter.*Did you mean “Product”\?/);
    });

    test('unknown operator', () => {
        expect(msgs('query { Contracts(filter: { Product: { equals: "x" } }) { data { ISIN } } }')[0]).toMatch(/Unknown filter field “equals” in StringFilter.*Available: eq, in, beginsWith, contains/);
    });

    test('operator that exists only for another type', () => {
        expect(msgs('query { Contracts(filter: { Product: { gt: "x" } }) { data { ISIN } } }')[0]).toMatch(/“gt” in StringFilter/);
    });

    test('enum values: wrong value, quoted value', () => {
        expect(msgs('query { Contracts(sort: { field: Strikes, order: ASC }) { data { ISIN } } }')[0]).toMatch(/“Strikes” is not a valid ContractsSortField.*Did you mean “Strike”\?/);
        expect(msgs('query { Contracts(sort: { field: Strike, order: "ASC" }) { data { ISIN } } }')[0]).toMatch(/SortOrder is an enum/);
    });

    test('a filter must be an object', () => {
        expect(msgs('query { Contracts(filter: "FESX") { data { ISIN } } }')[0]).toMatch(/expects an object/);
    });

    test('variables are accepted wherever a value goes', () => {
        expect(check('query ($p: String, $f: ContractsFilter) { Contracts(filter: $f) { data { ISIN } } ProductInfos(filter: { Product: { eq: $p } }) { data { Name } } }')).toEqual([]);
    });

    test('a query root without a selection is only a warning', () => {
        const [p] = check('query { Contracts }');
        expect(p.severity).toBe('warn');
        expect(p.message).toMatch(/needs a selection/);
        expect(msgs('query { Contracts { data { ISIN { x } } } }')[0]).toMatch(/no sub-fields/);
    });

    test('aliases, __typename, fragments and directives do not confuse it', () => {
        expect(check(`query Q($x: Boolean) {
  first: Contracts(page: { first: 1 }) @include(if: $x) { __typename data { ...F ... on Contract { ISIN } } }
}
fragment F on Contract { Product }`)).toEqual([]);
    });

    test('reports several problems in order', () => {
        const found = msgs('query { Contracts { data { A B } } Nope { data { x } } }');
        expect(found).toHaveLength(3);
        expect(found[0]).toMatch(/“A”/);
        expect(found[2]).toMatch(/Unknown query “Nope”/);
    });

    test('text that does not parse yet is left to the bracket check', () => {
        expect(check('query { Contracts { data { ISIN')).toEqual([]);
        expect(check('query { Contracts(filter: { Product: ')).toEqual([]);
        expect(check('')).toEqual([]);
        expect(check('mutation { x }')).toEqual([]);
        expect(validateAgainstSchema('query { x }', null)).toEqual([]);
    });
});

describe('didYouMean', () => {
    test('finds close names only', () => {
        expect(didYouMean('Contract', ['Contracts', 'Holidays'])).toBe('Contracts');
        expect(didYouMean('zzzzzz', ['Contracts', 'Holidays'])).toBeNull();
        expect(didYouMean('contracts', ['Contracts'])).toBe('Contracts');
    });
});

describe('completionsAt', () => {
    const at = (src, extras) => completionsAt(src, src.length, index, extras);
    const labels = (r) => r.items.map(i => i.label);

    test('root queries at the first level', () => {
        expect(labels(at('query {\n  '))).toEqual(['Contracts', 'ProductInfos', 'Holidays']);
        expect(labels(at('query {\n  Prod'))).toEqual(['ProductInfos']);
        expect(at('query {\n  Prod').from).toBe('query {\n  '.length);
    });

    test('response wrapper fields, then row fields inside data', () => {
        expect(labels(at('query { Contracts { '))).toEqual(['date', 'data', 'pageInfo']);
        expect(labels(at('query { Contracts { data { '))).toEqual(['Product', 'ISIN', 'ExpirationDate', 'Strike']);
        expect(labels(at('query { ProductInfos { data { Na'))).toEqual(['Name']);
    });

    test('a prefix matches inside names and ranks prefix matches first', () => {
        expect(labels(at('query { Contracts { data { ra'))).toEqual(['ExpirationDate']); // matches inside a name
        expect(labels(at('query { Contracts { data { zz'))).toEqual([]);
        expect(labels(at('query { Contracts { data { st'))).toEqual(['Strike']);
        expect(labels(at('query { Contracts { data { is'))).toEqual(['ISIN']);
    });

    test('does not suggest root queries inside a selection of another query', () => {
        expect(labels(at('query { Contracts { data { ISIN } } Hol'))).toEqual(['Holidays']);
        expect(labels(at('query { Contracts { data { ISIN } }\n  Ho'))).toEqual(['Holidays']);
    });

    test('argument names, with a colon to insert', () => {
        const r = at('query { Contracts(');
        expect(labels(r)).toEqual(['filter', 'sort', 'page']);
        expect(r.items[0].insert).toBe('filter: ');
        expect(labels(at('query { Contracts(filter: {}, so'))).toEqual(['sort']);
    });

    test('filter fields, then operators of that field type', () => {
        expect(labels(at('query { Contracts(filter: { '))).toEqual(['Product', 'ISIN', 'Strike']);
        expect(labels(at('query { Contracts(filter: { Product: { '))).toEqual(['eq', 'in', 'beginsWith', 'contains']);
        expect(labels(at('query { Contracts(filter: { Strike: { '))).toEqual(['eq', 'gt', 'lt', 'between']);
        expect(labels(at('query { Contracts(filter: { Product: { eq: "FESX" }, '))).toEqual(['Product', 'ISIN', 'Strike']);
    });

    test('enum values for sort', () => {
        expect(labels(at('query { Contracts(sort: { field: '))).toEqual(['Product', 'ISIN', 'Strike']);
        expect(labels(at('query { Contracts(sort: { field: Strike, order: '))).toEqual(['ASC', 'DESC']);
        expect(labels(at('query { Contracts(sort: { field: Strike, order: D'))).toEqual(['DESC']);
    });

    test('page arguments', () => {
        expect(labels(at('query { Contracts(page: { '))).toEqual(['first', 'after']);
    });

    test('product codes inside a Product filter value, inserted with quotes unless already inside quotes', () => {
        const products = [{ Product: 'FESX', Name: 'Euro Stoxx 50' }, { Product: 'FDAX', Name: 'DAX' }, { Product: 'OESX', Name: 'Options on Euro Stoxx 50' }];
        const open = at('query { Contracts(filter: { Product: { eq: ', { products });
        expect(labels(open)).toEqual(['FESX', 'FDAX', 'OESX']);
        expect(open.items[0].insert).toBe('"FESX"');

        const inString = at('query { Contracts(filter: { Product: { eq: "FE', { products });
        expect(inString.inString).toBe(true);
        expect(labels(inString)).toEqual(['FESX']);
        expect(inString.items[0].insert).toBe('FESX');
        expect(inString.from).toBe('query { Contracts(filter: { Product: { eq: "'.length);

        // matches by name too
        expect(labels(at('query { Contracts(filter: { Product: { eq: "dax', { products }))).toEqual(['FDAX']);
        // not for other fields
        expect(labels(at('query { Contracts(filter: { ISIN: { eq: "', { products }))).toEqual([]);
    });

    test('nothing without a schema or outside any context', () => {
        expect(completionsAt('query { ', 8, null).items).toEqual([]);
        expect(labels(at('query { Contracts { data { ISIN } } } '))).toEqual([]);
    });

    test('works in the middle of a document: only the text before the cursor counts', () => {
        const src = 'query { Contracts { data { ISIN St } } }';
        const pos = src.indexOf(' St') + 3;
        expect(labels(completionsAt(src, pos, index))).toEqual(['Strike']);
    });

    test('alias colon still offers fields of the same level', () => {
        expect(labels(at('query { first: '))).toEqual(['Contracts', 'ProductInfos', 'Holidays']);
    });
});
