import { buildDocsModel, queryMatchesFilter, typeMatchesFilter, fieldMatches } from '../schema.js';

const S = (name) => ({ kind: 'SCALAR', name, ofType: null });
const ref = (kind, name) => ({ kind, name, ofType: null });
const schema = {
    queryType: { name: 'Query' },
    mutationType: null,
    types: [
        { kind: 'OBJECT', name: 'Query', fields: [
            { name: 'Contracts', description: 'Listed contracts', type: { kind: 'NON_NULL', ofType: ref('OBJECT', 'ContractsResponse') },
              args: [{ name: 'filter', type: ref('INPUT_OBJECT', 'ContractsFilter') }, { name: 'sort', type: ref('INPUT_OBJECT', 'ContractsSort') }] },
            { name: 'Holidays', description: 'Exchange holidays', type: ref('OBJECT', 'HolidaysResponse'), args: [] }
        ] },
        { kind: 'OBJECT', name: 'ContractsResponse', fields: [{ name: 'date', type: S('String') }, { name: 'data', type: { kind: 'LIST', ofType: ref('OBJECT', 'Contracts') } }] },
        { kind: 'OBJECT', name: 'Contracts', fields: [
            { name: 'Product', description: 'Product code', type: S('String') },
            { name: 'Strike', description: 'Strike price', type: S('Float') },
            { name: 'SettlementType', type: ref('ENUM', 'SettlementType') }
        ] },
        { kind: 'OBJECT', name: 'HolidaysResponse', fields: [{ name: 'date', type: S('String') }, { name: 'data', type: { kind: 'LIST', ofType: ref('OBJECT', 'Holidays') } }] },
        { kind: 'OBJECT', name: 'Holidays', fields: [{ name: 'Holiday', type: S('String') }] },
        { kind: 'ENUM', name: 'SettlementType', enumValues: [{ name: 'CASH' }, { name: 'PHYSICAL' }] },
        { kind: 'ENUM', name: 'ContractsSortField', enumValues: [{ name: 'Product' }, { name: 'Strike' }] },
        { kind: 'INPUT_OBJECT', name: 'ContractsFilter', inputFields: [{ name: 'Product', type: ref('INPUT_OBJECT', 'StringFilter') }] },
        { kind: 'INPUT_OBJECT', name: 'ContractsSort', inputFields: [{ name: 'field', type: ref('ENUM', 'ContractsSortField') }, { name: 'order', type: ref('ENUM', 'SortOrder') }] },
        S('String'), S('Float'),
        { kind: 'OBJECT', name: '__Type', fields: [] }
    ]
};

describe('Docs model', () => {
    const model = buildDocsModel(schema);

    test('root queries with their row fields, arguments and sort options', () => {
        expect(model.queries.map(q => q.name)).toEqual(['Contracts', 'Holidays']);
        const c = model.queries[0];
        expect(c.rowType.name).toBe('Contracts');
        expect(c.fields.map(f => f.name)).toEqual(['Product', 'Strike', 'SettlementType']);
        expect(c.args.map(a => a.name)).toEqual(['filter', 'sort']);
        expect(c.filterType).toBe('ContractsFilter');
        expect(c.sortFields).toEqual(['Product', 'Strike']);
        expect(model.queries[1].filterType).toBeNull();
    });

    test('types grouped by kind; Query, response wrappers and introspection types hidden', () => {
        const names = Object.fromEntries(model.typeGroups.map(g => [g.kind, g.types.map(t => t.name)]));
        expect(names.OBJECT).toEqual(['Contracts', 'Holidays']);
        expect(names.ENUM).toEqual(['ContractsSortField', 'SettlementType']);
        expect(names.INPUT_OBJECT).toEqual(['ContractsFilter', 'ContractsSort']);
        expect(names.SCALAR).toEqual(['Float', 'String']);
        expect(model.typeGroups[0].types[0].usedBy).toEqual(['Contracts']);
    });

    test('search matches query names, field names and descriptions', () => {
        const [contracts, holidays] = model.queries;
        expect(queryMatchesFilter(contracts, 'strike')).toBe(true);
        expect(queryMatchesFilter(contracts, 'price')).toBe(true); // field description
        expect(queryMatchesFilter(holidays, 'strike')).toBe(false);
        expect(queryMatchesFilter(holidays, 'exchange')).toBe(true); // query description
        expect(fieldMatches(contracts.fields[0], 'code')).toBe(true);
    });

    test('type search includes enum values', () => {
        const enums = model.typeGroups.find(g => g.kind === 'ENUM').types;
        expect(typeMatchesFilter(enums.find(t => t.name === 'SettlementType'), 'physical')).toBe(true);
        expect(typeMatchesFilter(enums.find(t => t.name === 'ContractsSortField'), 'physical')).toBe(false);
    });
});
