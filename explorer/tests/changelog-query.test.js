import { buildChangelogQuery, rootShapes, isFullQuery } from '../changelog-query.js';

// Minimal introspection-shaped schema: Root { date data { ...fields } }
const obj = (name, fields) => ({ kind: 'OBJECT', name, fields: fields.map(f => (typeof f === 'string' ? { name: f, type: { kind: 'SCALAR', name: 'String' }, args: [] } : f)) });
const listOf = (name) => ({ kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name } });
const root = (name, item, withFilter = true) => ({ name, type: { kind: 'OBJECT', name: `${name}Result` }, args: withFilter ? [{ name: 'filter' }] : [] });
const schema = {
    queryType: { name: 'Query' },
    types: [
        obj('Query', []),
        ...[
            ['Contracts', ['Product', 'Contract', 'ISIN', 'SettlementMethod', 'ExpirationDate']],
            ['ProductInfos', ['Product', 'Name', 'LiquidityClass', 'Currency']],
            ['TESProfiles', ['Product', 'TESType', 'MinLotSize']],
            ['EnlightResponders', ['Member', 'Name']]
        ].flatMap(([n, fields]) => [obj(`${n}Result`, ['date', { name: 'data', type: listOf(`${n}Item`) }]), obj(`${n}Item`, fields)])
    ]
};
schema.types[0].fields = ['Contracts', 'ProductInfos', 'TESProfiles', 'EnlightResponders'].map(n => root(n));

const compact = (q) => q.replace(/\s+/g, ' ').trim();

describe('buildChangelogQuery', () => {
    test('a full query is used unchanged', () => {
        const q = 'query {\n  Contracts(filter: { Product: { eq: "FGBL" } }) { data { Contract } }\n}';
        expect(isFullQuery(q)).toBe(true);
        expect(buildChangelogQuery({ Query: q }, schema).query).toBe(q);
    });

    test('Query naming the affected query selects the fields the entry mentions', () => {
        const r = buildChangelogQuery({ Query: 'ProductInfos', Description: 'LiquidityClass is deprecated' }, schema);
        expect(r.roots).toEqual(['ProductInfos']);
        expect(compact(r.query)).toBe('query { ProductInfos { date data { Product Name LiquidityClass } } }');
    });

    test('Query naming the affected query without a mentioned field selects all its fields', () => {
        const r = buildChangelogQuery({ Query: 'TESProfiles', Description: 'Parameters updated' }, schema);
        expect(compact(r.query)).toBe('query { TESProfiles { date data { Product TESType MinLotSize } } }');
    });

    test('field mentioned via old/new value; large table filtered by product from the text', () => {
        const r = buildChangelogQuery({ Query: 'Contracts', NewValue: 'SettlementMethod', Description: 'New field for FGBL contracts' }, schema);
        expect(compact(r.query)).toBe('query { Contracts(filter: { Product: { eq: "FGBL" } }) { date data { Product Contract SettlementMethod } } }');
        expect(r.note).toBe('');
    });

    test('large tables without a product in the text default to FESX with a note', () => {
        const r = buildChangelogQuery({ Query: 'Contracts', Description: 'New field SettlementMethod' }, schema);
        expect(r.query).toContain('eq: "FESX"');
        expect(r.query.startsWith('# Example for FESX')).toBe(true);
    });

    test('several affected queries in one entry', () => {
        const r = buildChangelogQuery({ Query: 'ProductInfos, TESProfiles', Description: 'Currency and MinLotSize changes' }, schema);
        expect(r.roots).toEqual(['ProductInfos', 'TESProfiles']);
        expect(compact(r.query)).toBe('query { ProductInfos { date data { Product Name Currency } } TESProfiles { date data { Product MinLotSize } } }');
    });

    test('Root.Field and "Root { fields }" forms', () => {
        expect(compact(buildChangelogQuery({ Query: 'Contracts.SettlementMethod', Description: 'for FGBL' }, schema).query))
            .toBe('query { Contracts(filter: { Product: { eq: "FGBL" } }) { date data { Product Contract SettlementMethod } } }');
        expect(compact(buildChangelogQuery({ Query: 'TESProfiles { TESType MinLotSize }' }, schema).query))
            .toBe('query { TESProfiles { date data { Product TESType MinLotSize } } }');
    });

    test('a bare attribute resolves to the query that has it, preferring one named in the text', () => {
        expect(buildChangelogQuery({ Query: 'LiquidityClass' }, schema).roots).toEqual(['ProductInfos']);
        expect(buildChangelogQuery({ Query: 'Name', Description: 'EnlightResponders now include the Name' }, schema).roots).toEqual(['EnlightResponders']);
    });

    test('unknown or empty Query gives null (no run button)', () => {
        expect(buildChangelogQuery({ Query: 'DoesNotExist' }, schema)).toBeNull();
        expect(buildChangelogQuery({ Query: '' }, schema)).toBeNull();
        expect(buildChangelogQuery({}, schema)).toBeNull();
    });

    test('without a schema only full queries and explicit Root.Field resolve', () => {
        expect(compact(buildChangelogQuery({ Query: 'TESProfiles.MinLotSize' }, null).query))
            .toBe('query { TESProfiles { date data { MinLotSize } } }');
        expect(buildChangelogQuery({ Query: 'Contracts' }, null)).toBeNull();
    });

    test('rootShapes reads data item fields and filter support', () => {
        const shapes = rootShapes(schema);
        expect(shapes.get('Contracts').scalarFields).toContain('SettlementMethod');
        expect(shapes.get('Contracts').wrapped).toBe(true);
        expect(shapes.get('Contracts').hasFilter).toBe(true);
    });
});
