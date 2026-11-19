// Requests of the Strategy Wizard. Everything is filtered by one product, and only the fields and root queries the
// schema offers are asked for, so a field the API does not have never fails the whole request.
import { baseName, membersOf } from './schemacheck.js';

const CODE = /^[A-Z0-9_-]{1,32}$/;
export const isProductCode = (code) => CODE.test(String(code || ''));

export const CONTRACT_FIELDS = ['Contract', 'ContractDate', 'ContractCycle', 'ExpirationDate', 'LastTradingDate', 'CallPut', 'Strike', 'SettlementPrice', 'SettlementDate'];
export const INFO_FIELDS = ['Product', 'Name', 'ProductType', 'ProductTypeCode', 'ProductLine', 'Currency', 'ContractSize', 'TickSize', 'TickValue', 'Underlying'];
export const TES_FIELDS = ['TESType', 'InstrumentType', 'MinLotSize', 'MinLotSizeNonPrimary', 'MinExpiryRange', 'NonDisclosureLimit'];
export const EXPIRATION_FIELDS = ['ExpirationIndex', 'ExpirationDate', 'MasterContract'];

const isLeaf = (index, type) => {
    const t = index.types.get(baseName(type));
    return !t || t.kind === 'SCALAR' || t.kind === 'ENUM';
};

// { root: field | null, fields: wanted fields the schema has, hasPage, hasProductFilter } or null when the root is missing.
// Without a schema index every wanted field is assumed.
function describeRoot(index, root, wanted) {
    if (!index) return { fields: wanted, hasPage: true };
    const rootField = membersOf(index, index.queryTypeName).find(f => f.name === root);
    if (!rootField) return null;
    const filterArg = (rootField.args || []).find(a => a.name === 'filter');
    if (!filterArg || !membersOf(index, baseName(filterArg.type)).some(f => f.name === 'Product')) return null;
    const outer = index.types.get(baseName(rootField.type));
    const rowType = baseName(outer?.fields?.find(f => f.name === 'data')?.type) || outer?.name;
    const available = membersOf(index, rowType).filter(f => isLeaf(index, f.type)).map(f => f.name);
    return { fields: wanted.filter(f => available.includes(f)), hasPage: (rootField.args || []).some(a => a.name === 'page') };
}

const block = (root, code, fields) => `  ${root}(filter: { Product: { eq: "${code}" } }) {\n    data {\n      ${fields.join('\n      ')}\n    }\n  }`;

/**
 * One request with the small per-product roots: master data (point value, currency), TES profiles and expirations.
 * Returns { query, roots } (query is null when the schema has none of them).
 */
export function buildInfoQuery(product, index = null) {
    const code = String(product || '').toUpperCase();
    if (!isProductCode(code)) throw new Error('Invalid product code.');
    const roots = [];
    const parts = [];
    for (const [root, wanted] of [['ProductInfos', INFO_FIELDS], ['TESProfiles', TES_FIELDS], ['Expirations', EXPIRATION_FIELDS]]) {
        const d = describeRoot(index, root, wanted);
        if (!d || !d.fields.length) continue;
        roots.push(root);
        parts.push(block(root, code, d.fields));
    }
    return { query: parts.length ? `query {\n${parts.join('\n')}\n}` : null, roots };
}

/**
 * Contracts of one product, one page. Returns { query, error }; `after` is the cursor of the previous page.
 * The page size is only sent when the schema has a `page` argument.
 */
export function buildContractsQuery(product, index = null, { after = null, pageSize = 2000 } = {}) {
    const code = String(product || '').toUpperCase();
    if (!isProductCode(code)) throw new Error('Invalid product code.');
    const d = describeRoot(index, 'Contracts', CONTRACT_FIELDS);
    if (!d) return { query: null, error: 'This API does not offer Contracts (filtered by Product).' };
    if (!d.fields.includes('Strike') || !d.fields.includes('CallPut')) return { query: null, error: 'Contracts has no Strike / CallPut fields in this API, so options cannot be combined.' };
    const page = d.hasPage ? `, page: { first: ${pageSize}${after ? `, after: ${JSON.stringify(String(after))}` : ''} }` : '';
    const pageInfo = d.hasPage ? '\n    pageInfo { hasNextPage endCursor }' : '';
    return { query: `query {\n  Contracts(filter: { Product: { eq: "${code}" } }${page}) {\n    data {\n      ${d.fields.join('\n      ')}\n    }${pageInfo}\n  }\n}`, error: '' };
}
