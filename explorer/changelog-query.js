// Turns the `Query` value of a Changelog entry into a runnable GraphQL query.
// The API often returns only the affected attribute (e.g. "SettlementMethod" or "Contracts.SettlementMethod")
// rather than a full query, so the root query is resolved from the schema and the entry's text.

// Fields that identify a row; the first ones present are selected next to the attribute for context.
const IDENTIFIER_FIELDS = ['Product', 'Contract', 'ContractID', 'ISIN', 'Member', 'Name'];
// Root queries that return very large result sets without a product filter.
const NEEDS_PRODUCT_FILTER = new Set(['Contracts', 'SettlementPrices', 'FlexibleContracts']);
const DEFAULT_PRODUCT = 'FESX';

const unwrap = (t) => {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return t;
};

// Root query name -> { itemFields: Set, wrapped: bool, hasFilter: bool }
export function rootShapes(schema) {
    const shapes = new Map();
    if (!schema || !schema.types) return shapes;
    const byName = new Map(schema.types.map(t => [t.name, t]));
    const queryType = byName.get(schema.queryType?.name || 'Query');
    (queryType?.fields || []).forEach(f => {
        const outer = byName.get(unwrap(f.type)?.name);
        if (!outer || !outer.fields) return;
        const dataField = outer.fields.find(x => x.name === 'data');
        const item = dataField ? byName.get(unwrap(dataField.type)?.name) : outer;
        if (!item || !item.fields) return;
        shapes.set(f.name, {
            itemFields: new Set(item.fields.map(x => x.name)),
            wrapped: !!dataField && outer.fields.some(x => x.name === 'date'),
            hasFilter: (f.args || []).some(a => a.name === 'filter')
        });
    });
    return shapes;
}

export function isFullQuery(text) {
    return /^\s*(query\b|\{)/.test(text || '') && /\w+\s*(\([^)]*\))?\s*\{[\s\S]*\}/.test(text);
}

const identifiers = (text) => (String(text || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);

// Eurex product codes mentioned in free text, e.g. "OESX" in "TES lot size for OESX block trades"
function productMentioned(entry, knownNames) {
    const text = [entry.Description, entry.OldValue, entry.NewValue].filter(Boolean).join(' ');
    const m = text.match(/\b[A-Z][A-Z0-9]{3}\b/g) || [];
    return m.find(code => !knownNames.has(code)) || null;
}

/**
 * entry: Changelog row { Query, Description, OldValue, NewValue, ... }
 * schema: introspection __schema (optional; without it only explicit "Root.Field" / "Root { Field }" forms resolve)
 * Returns { query, root, fields, note } or null when no root query can be determined.
 */
export function buildChangelogQuery(entry, schema = null) {
    const raw = String(entry?.Query || '').trim();
    if (!raw) return null;
    if (isFullQuery(raw)) return { query: raw, root: null, fields: [], note: '' };

    const shapes = rootShapes(schema);
    const tokens = identifiers(raw);
    const context = identifiers([entry.Description, entry.NewValue, entry.OldValue].filter(Boolean).join(' '));

    // Root named explicitly in the Query value ("Contracts.SettlementMethod", "Contracts { ... }")
    let root = tokens.find(t => shapes.has(t)) || null;
    if (!root && !shapes.size) {
        const dotted = raw.match(/^([A-Z][A-Za-z0-9_]*)\s*(\.|\{)/);
        if (dotted) root = dotted[1];
    }
    let attrs = tokens.filter(t => t !== root && t !== 'data' && t !== 'date' && t !== 'query');

    if (!root && shapes.size) {
        // Roots whose rows have every attribute; prefer one mentioned in the entry's text
        const candidates = [...shapes.entries()].filter(([, s]) => attrs.length && attrs.every(a => s.itemFields.has(a))).map(([n]) => n);
        root = candidates.find(n => context.includes(n)) || candidates[0] || null;
    }
    if (!root) return null;

    const shape = shapes.get(root);
    if (shape) attrs = attrs.filter(a => shape.itemFields.has(a));
    if (!attrs.length) return null;

    const ids = shape ? IDENTIFIER_FIELDS.filter(f => shape.itemFields.has(f) && !attrs.includes(f)).slice(0, 2) : [];
    const fields = [...ids, ...attrs];

    let args = '';
    let note = '';
    if (NEEDS_PRODUCT_FILTER.has(root) && (!shape || (shape.hasFilter && shape.itemFields.has('Product')))) {
        const knownNames = new Set([...shapes.keys(), ...fields]);
        const product = productMentioned(entry, knownNames) || DEFAULT_PRODUCT;
        args = `(filter: { Product: { eq: "${product}" } })`;
        if (product === DEFAULT_PRODUCT && !productMentioned(entry, knownNames)) note = `Example for ${DEFAULT_PRODUCT}: change the product as needed`;
    }

    const body = fields.join('\n      ');
    const wrapped = shape ? shape.wrapped : true;
    const selection = wrapped
        ? `{\n    date\n    data {\n      ${body}\n    }\n  }`
        : `{\n    ${fields.join('\n    ')}\n  }`;
    const query = `${note ? `# ${note}\n` : ''}query {\n  ${root}${args} ${selection}\n}`;
    return { query, root, fields, note };
}
