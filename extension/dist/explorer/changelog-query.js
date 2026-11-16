// Turns the `Query` value of a Changelog entry into a runnable GraphQL query.
// The changelog names the affected query in its Query field (e.g. "Contracts"); it may also be a full query,
// "Root.Field", "Root { Field }" or just an attribute. Root queries and their fields come from the schema.

// Fields that identify a row; the first ones present are selected next to the changed fields for context.
const IDENTIFIER_FIELDS = ['Product', 'Contract', 'ContractID', 'ISIN', 'Member', 'Name'];
// Root queries that return very large result sets without a product filter.
const NEEDS_PRODUCT_FILTER = new Set(['Contracts', 'SettlementPrices', 'FlexibleContracts']);
const DEFAULT_PRODUCT = 'FESX';

const unwrap = (t) => {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return t;
};

// Root query name -> { itemFields: Set, scalarFields: string[], wrapped: bool, hasFilter: bool }
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
        const isLeaf = (x) => {
            const k = unwrap(x.type)?.kind;
            return !k || k === 'SCALAR' || k === 'ENUM';
        };
        shapes.set(f.name, {
            itemFields: new Set(item.fields.map(x => x.name)),
            scalarFields: item.fields.filter(isLeaf).map(x => x.name),
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

function block(root, fields, shape, entry, knownNames) {
    let args = '';
    let note = '';
    if (NEEDS_PRODUCT_FILTER.has(root) && (!shape || (shape.hasFilter && shape.itemFields.has('Product')))) {
        const mentioned = productMentioned(entry, knownNames);
        args = `(filter: { Product: { eq: "${mentioned || DEFAULT_PRODUCT}" } })`;
        if (!mentioned) note = `Example for ${DEFAULT_PRODUCT}: change the product as needed`;
    }
    const wrapped = shape ? shape.wrapped : true;
    const text = wrapped
        ? `  ${root}${args} {\n    date\n    data {\n      ${fields.join('\n      ')}\n    }\n  }`
        : `  ${root}${args} {\n    ${fields.join('\n    ')}\n  }`;
    return { text, note };
}

/**
 * entry: Changelog row { Query, Description, OldValue, NewValue, ... }
 * schema: introspection __schema; without it only full queries and "Root.Field" / "Root { Field }" resolve.
 * Returns { query, roots, fields, note } or null when no query can be determined.
 */
export function buildChangelogQuery(entry, schema = null) {
    const raw = String(entry?.Query || '').trim();
    if (!raw) return null;
    if (isFullQuery(raw)) return { query: raw, roots: [], fields: [], note: '' };

    const shapes = rootShapes(schema);
    const tokens = identifiers(raw);
    const contextTokens = new Set(identifiers([entry.Description, entry.NewValue, entry.OldValue].filter(Boolean).join(' ')));

    // 1. Roots named in the Query field (the usual case: "Contracts", "Contracts, Expirations", "Contracts.Field")
    let roots = shapes.size ? [...new Set(tokens.filter(t => shapes.has(t)))] : [];
    if (!roots.length && !shapes.size) {
        const explicit = raw.match(/^([A-Z][A-Za-z0-9_]*)\s*(\.|\{)/);
        if (explicit) roots = [explicit[1]];
    }
    let explicitAttrs = tokens.filter(t => !roots.includes(t) && !['data', 'date', 'query'].includes(t));

    // 2. Only an attribute was given: find the root whose rows have it, preferring one named in the text
    if (!roots.length && shapes.size && explicitAttrs.length) {
        const candidates = [...shapes.entries()].filter(([, s]) => explicitAttrs.every(a => s.itemFields.has(a))).map(([n]) => n);
        const pick = candidates.find(n => contextTokens.has(n)) || candidates[0];
        if (pick) roots = [pick];
    }
    if (!roots.length) return null;

    const knownNames = new Set([...shapes.keys(), ...roots]);
    const parts = [];
    const notes = new Set();
    let allFields = [];
    for (const root of roots) {
        const shape = shapes.get(root);
        let fields;
        if (!shape) {
            // No schema: only the explicitly named attributes can be selected
            fields = explicitAttrs;
        } else {
            const leaf = new Set(shape.scalarFields);
            const named = explicitAttrs.filter(a => leaf.has(a));
            // Fields the entry talks about (description / old / new value), e.g. "SettlementMethod"
            const mentioned = shape.scalarFields.filter(f => contextTokens.has(f) && !IDENTIFIER_FIELDS.includes(f));
            const focus = named.length ? named : mentioned;
            const ids = IDENTIFIER_FIELDS.filter(f => leaf.has(f) && !focus.includes(f)).slice(0, 2);
            fields = focus.length ? [...ids, ...focus] : shape.scalarFields;
        }
        if (!fields.length) continue;
        fields.forEach(f => knownNames.add(f));
        const b = block(root, fields, shape, entry, knownNames);
        parts.push(b.text);
        if (b.note) notes.add(b.note);
        allFields = allFields.concat(fields);
    }
    if (!parts.length) return null;

    const note = [...notes].join('; ');
    const query = `${note ? `# ${note}\n` : ''}query {\n${parts.join('\n')}\n}`;
    return { query, roots, fields: allFields, note };
}
