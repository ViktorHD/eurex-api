import { searchProducts, productTypes, vendorMap } from '../products.js';
import { buildProductQuery } from '../productquery.js';
import { buildSchemaIndex } from '../schemacheck.js';

const CATALOG = [
    { Product: 'FESX', Name: 'Euro STOXX 50 Index Futures', ProductISIN: 'DE000F1ESX0', ProductType: 'INDEX FUTURES', Currency: 'EUR' },
    { Product: 'OESX', Name: 'Euro STOXX 50 Index Options', ProductISIN: 'DE000O1ESX0', ProductType: 'INDEX OPTIONS', Currency: 'EUR' },
    { Product: 'FDAX', Name: 'DAX Futures', ProductISIN: 'DE000F1DAX0', ProductType: 'INDEX FUTURES', Currency: 'EUR' },
    { Product: 'FESXB', Name: 'ESX Banks', ProductType: 'INDEX FUTURES', Currency: 'EUR' },
    { Product: 'SAPG', Name: 'SAP AG', ProductType: 'SINGLE STOCK FUTURES', Currency: 'EUR' }
];

describe('searchProducts', () => {
    test('exact code first, then code prefix, then name matches', () => {
        expect(searchProducts(CATALOG, 'fesx').items.map(p => p.Product)).toEqual(['FESX', 'FESXB']);
        // 'esx': a name that starts with it ranks before codes that merely contain it
        expect(searchProducts(CATALOG, 'esx').items.map(p => p.Product)).toEqual(['FESXB', 'FESX', 'OESX']);
    });
    test('every word must match somewhere', () => {
        expect(searchProducts(CATALOG, 'stoxx options').items.map(p => p.Product)).toEqual(['OESX']);
        expect(searchProducts(CATALOG, 'stoxx nothing').total).toBe(0);
    });
    test('finds by ISIN, name, currency and type', () => {
        expect(searchProducts(CATALOG, 'DE000F1DAX0').items[0].Product).toBe('FDAX');
        expect(searchProducts(CATALOG, 'sap').items[0].Product).toBe('SAPG');
        expect(searchProducts(CATALOG, 'single stock').items.map(p => p.Product)).toEqual(['SAPG']);
    });
    test('type filter and limit; an empty query lists everything', () => {
        expect(searchProducts(CATALOG, '', { type: 'INDEX OPTIONS' }).items.map(p => p.Product)).toEqual(['OESX']);
        const all = searchProducts(CATALOG, '', { limit: 2 });
        expect(all.total).toBe(5);
        expect(all.items).toHaveLength(2);
    });
    test('vendor symbols are searchable', () => {
        const vendor = vendorMap([{ Product: 'FDAX', VendorCode: 'FDXM1', Vendor: 'Bloomberg', ProductID: 3 }, { Product: null, VendorCode: 'x' }]);
        expect(vendor.get('FDAX')).toEqual(['FDXM1', 'Bloomberg']);
        expect(searchProducts(CATALOG, 'fdxm1', { vendor }).items.map(p => p.Product)).toEqual(['FDAX']);
        expect(searchProducts(CATALOG, 'fdxm1').total).toBe(0);
    });
    test('product types', () => {
        expect(productTypes(CATALOG)).toEqual(['INDEX FUTURES', 'INDEX OPTIONS', 'SINGLE STOCK FUTURES']);
    });
});

const T = (name, kind = 'SCALAR') => ({ kind, name, ofType: null });
const L = (t) => ({ kind: 'LIST', name: null, ofType: t });
const field = (name, type, args = []) => ({ name, description: '', type, args });
const inp = (name, type) => ({ name, description: '', type });
const makeSchema = (roots) => {
    const types = [{ kind: 'OBJECT', name: 'Query', fields: roots.map(r => field(r.name, T(`${r.name}Response`, 'OBJECT'), [
        ...(r.filterable === false ? [] : [inp('filter', T(`${r.name}Filter`, 'INPUT_OBJECT'))]),
        inp('sort', T(`${r.name}Sort`, 'INPUT_OBJECT'))
    ])) }];
    roots.forEach(r => {
        types.push({ kind: 'OBJECT', name: `${r.name}Response`, fields: [field('date', T('String')), field('data', L(T(`${r.name}Row`, 'OBJECT')))] });
        types.push({ kind: 'OBJECT', name: `${r.name}Row`, fields: r.fields.map(n => field(n, T('String'))) });
        types.push({ kind: 'INPUT_OBJECT', name: `${r.name}Filter`, inputFields: [inp('Product', T('StringFilter', 'INPUT_OBJECT'))] });
        types.push({ kind: 'INPUT_OBJECT', name: `${r.name}Sort`, inputFields: [inp('field', T(`${r.name}SortField`, 'ENUM'))] });
        types.push({ kind: 'ENUM', name: `${r.name}SortField`, enumValues: r.fields.map(n => ({ name: n })) });
    });
    types.push({ kind: 'INPUT_OBJECT', name: 'StringFilter', inputFields: [inp('eq', T('String'))] });
    return { queryType: { name: 'Query' }, types };
};

describe('buildProductQuery', () => {
    test('without a schema: the standard queries with their known fields, no VendorCodes', () => {
        const { query, roots } = buildProductQuery('fesx');
        expect(roots).toEqual(['ProductInfos', 'TradingHours', 'Holidays', 'TickRules', 'TESProfiles', 'Expirations']);
        expect(query).toContain('ProductInfos(filter: { Product: { eq: "FESX" } })');
        expect(query).toContain('Holidays(filter: { Product: { eq: "FESX" } }, sort: { field: Holiday, order: ASC })');
        expect(query).not.toContain('VendorCodes');
    });

    test('with a schema: only roots that exist and can be filtered by Product, only existing fields', () => {
        const index = buildSchemaIndex(makeSchema([
            { name: 'ProductInfos', fields: ['Product', 'Name', 'Extra'] },
            { name: 'TradingHours', fields: ['StartContinuousTrading', 'EndContinuousTrading', 'Unknown'] },
            { name: 'Holidays', fields: ['Holiday'] },
            { name: 'TickRules', fields: ['PriceStep'], filterable: false },
            { name: 'VendorCodes', fields: ['Product', 'VendorCode'] }
        ]));
        const { query, roots } = buildProductQuery('FESX', index);
        expect(roots).toEqual(['ProductInfos', 'TradingHours', 'Holidays', 'VendorCodes']);
        expect(query).toMatch(/ProductInfos[^]*Product\n\s+Name\n\s+Extra/);
        expect(query).toMatch(/TradingHours[^]*StartContinuousTrading\n\s+EndContinuousTrading\n\s+\}/);
        expect(query).not.toContain('Unknown');
        expect(query).not.toContain('TickRules');
        expect(query).toContain('Holidays(filter: { Product: { eq: "FESX" } }, sort: { field: Holiday, order: ASC })');
    });

    test('a sort is only added when the schema allows it', () => {
        const index = buildSchemaIndex(makeSchema([{ name: 'Holidays', fields: ['Name'] }]));
        expect(buildProductQuery('FESX', index).query).not.toContain('sort');
    });

    test('rejects codes that are not product codes', () => {
        expect(() => buildProductQuery('FE"SX')).toThrow('Invalid product code.');
        expect(() => buildProductQuery('')).toThrow();
    });
});
