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

    test('a bare attribute is wrapped in the root query that has it, with identifier fields', () => {
        const r = buildChangelogQuery({ Query: 'LiquidityClass', Description: 'LiquidityClass is deprecated' }, schema);
        expect(r.root).toBe('ProductInfos');
        expect(compact(r.query)).toBe('query { ProductInfos { date data { Product Name LiquidityClass } } }');
    });

    test('Root.Field form; large tables get a product filter from the description', () => {
        const r = buildChangelogQuery({ Query: 'Contracts.SettlementMethod', Description: 'New field for FGBL contracts' }, schema);
        expect(compact(r.query)).toBe('query { Contracts(filter: { Product: { eq: "FGBL" } }) { date data { Product Contract SettlementMethod } } }');
        expect(r.note).toBe('');
    });

    test('large tables without a product in the text default to FESX with a note', () => {
        const r = buildChangelogQuery({ Query: 'SettlementMethod', Description: 'New field' }, schema);
        expect(r.root).toBe('Contracts');
        expect(r.query).toContain('eq: "FESX"');
        expect(r.query.startsWith('# Example for FESX')).toBe(true);
    });

    test('several attributes and the "Root { fields }" form', () => {
        const r = buildChangelogQuery({ Query: 'TESProfiles { TESType MinLotSize }' }, schema);
        expect(compact(r.query)).toBe('query { TESProfiles { date data { Product TESType MinLotSize } } }');
    });

    test('ambiguous attribute prefers the root mentioned in the text', () => {
        const r = buildChangelogQuery({ Query: 'Name', Description: 'EnlightResponders now include the Name' }, schema);
        expect(r.root).toBe('EnlightResponders');
        expect(compact(r.query)).toBe('query { EnlightResponders { date data { Member Name } } }');
    });

    test('a bare root name with no attribute or unknown attribute gives null', () => {
        expect(buildChangelogQuery({ Query: 'DoesNotExist' }, schema)).toBeNull();
        expect(buildChangelogQuery({ Query: '' }, schema)).toBeNull();
    });

    test('without a schema only an explicit Root.Field resolves', () => {
        expect(compact(buildChangelogQuery({ Query: 'TESProfiles.MinLotSize' }, null).query))
            .toBe('query { TESProfiles { date data { MinLotSize } } }');
        expect(buildChangelogQuery({ Query: 'MinLotSize' }, null)).toBeNull();
    });

    test('rootShapes reads data item fields and filter support', () => {
        const shapes = rootShapes(schema);
        expect(shapes.get('Contracts').itemFields.has('SettlementMethod')).toBe(true);
        expect(shapes.get('Contracts').wrapped).toBe(true);
        expect(shapes.get('Contracts').hasFilter).toBe(true);
    });
});
