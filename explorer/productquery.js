// The one request behind a product card, built against the schema: a root query is left out when the schema does not
// have it (or cannot be filtered by Product), and only fields that exist are selected, so a missing piece never
// invalidates the whole request.
import { baseName, membersOf } from './schemacheck.js';

const KNOWN = {
    ProductInfos: { fields: 'all' },
    TradingHours: { fields: ['StartContinuousTrading', 'EndContinuousTrading', 'EndOpeningAuction', 'EndClosingAuction', 'StartTES', 'EndTES', 'LTDBook', 'LTDTES'] },
    Holidays: { fields: ['Holiday', 'ExchangeHoliday'], sort: 'Holiday' },
    TickRules: { fields: ['TradeType', 'InstrumentType', 'StartPrice', 'EndPrice', 'PriceStep'] },
    TESProfiles: { fields: ['TESType', 'InstrumentType', 'PriceValidationRule', 'AllowAutoApproval', 'AllowBroker', 'MinLotSize', 'MinLotSizeNonPrimary', 'MinExpiryRange', 'NonDisclosureLimit', 'TESminStep', 'MaxTrader', 'LegPriceEntry'] },
    Expirations: { fields: ['ProductID', 'MasterContract', 'ExpirationIndex', 'ExpirationDate'] },
    VendorCodes: { fields: 'all' }
};

export const PRODUCT_ROOTS = Object.keys(KNOWN);

const isLeaf = (index, type) => {
    const t = index.types.get(baseName(type));
    return !t || t.kind === 'SCALAR' || t.kind === 'ENUM';
};

// Row type of a root query ({ data: [Row] } wrapper or the row type itself)
function rowTypeOf(index, rootField) {
    const outer = index.types.get(baseName(rootField.type));
    const data = outer?.fields?.find(f => f.name === 'data');
    return data ? baseName(data.type) : outer?.name || null;
}

/**
 * Returns { query, roots } where roots lists the root queries included. Without a schema index the standard
 * product queries with their known fields are requested (VendorCodes needs the schema for its field list).
 */
export function buildProductQuery(product, index = null) {
    const code = String(product || '').toUpperCase();
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) throw new Error('Invalid product code.');
    const filter = `filter: { Product: { eq: "${code}" } }`;
    const parts = [];
    const roots = [];

    for (const [root, spec] of Object.entries(KNOWN)) {
        let fields = spec.fields === 'all' ? null : spec.fields;
        let args = filter;
        if (index) {
            const rootField = membersOf(index, index.queryTypeName).find(f => f.name === root);
            if (!rootField) continue;
            const filterArg = (rootField.args || []).find(a => a.name === 'filter');
            if (!filterArg || !membersOf(index, baseName(filterArg.type)).some(f => f.name === 'Product')) continue;
            const rowType = rowTypeOf(index, rootField);
            const available = membersOf(index, rowType).filter(f => isLeaf(index, f.type)).map(f => f.name);
            fields = fields ? fields.filter(f => available.includes(f)) : available;
            if (spec.sort) {
                const sortArg = (rootField.args || []).find(a => a.name === 'sort');
                const sortInput = sortArg ? index.types.get(baseName(sortArg.type)) : null;
                const fieldEnum = sortInput?.inputFields?.find(f => f.name === 'field');
                const values = fieldEnum ? (index.types.get(baseName(fieldEnum.type))?.enumValues || []).map(v => v.name) : [];
                if (values.includes(spec.sort)) args += `, sort: { field: ${spec.sort}, order: ASC }`;
            }
        } else if (!fields) {
            if (root === 'VendorCodes') continue;
            fields = ['ProductID', 'Product', 'Name', 'ProductISIN', 'ProductLine', 'ProductType', 'LiquidityClass', 'Currency', 'ContractSize', 'TickSize', 'TickValue', 'SettlementType', 'Underlying', 'UnderlyingISIN'];
        } else if (spec.sort) {
            args += `, sort: { field: ${spec.sort}, order: ASC }`;
        }
        if (!fields.length) continue;
        roots.push(root);
        parts.push(`  ${root}(${args}) {\n    date\n    data {\n      ${fields.join('\n      ')}\n    }\n  }`);
    }
    return { query: `query {\n${parts.join('\n')}\n}`, roots };
}
