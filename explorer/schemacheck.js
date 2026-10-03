// Schema-aware help for the query editor, built on the introspection result:
//  - validateAgainstSchema: unknown queries, fields, arguments, filter fields, operators and enum values
//  - completionsAt: suggestions that depend on where the cursor is (root query, row field, argument, filter field,
//    operator, enum value, product code)
// A small parser reads only what is needed; when the text does not parse (typing in progress) nothing is reported,
// the bracket check in editor.js covers structural problems.
import { tokenize } from './editor.js';

const significant = (tokens) => tokens.filter(t => t.type !== 'space' && t.type !== 'comment');

// ---------- Schema index ----------

export const baseName = (t) => {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return t?.name || null;
};
const isList = (t) => {
    while (t && t.kind === 'NON_NULL') t = t.ofType;
    return t?.kind === 'LIST';
};
const listItem = (t) => {
    while (t && t.kind === 'NON_NULL') t = t.ofType;
    return t?.ofType;
};

export function buildSchemaIndex(schema) {
    if (!schema?.types) return null;
    const types = new Map(schema.types.filter(t => t.name && !t.name.startsWith('__')).map(t => [t.name, t]));
    const queryTypeName = schema.queryType?.name || 'Query';
    if (!types.has(queryTypeName)) return null;
    return { types, queryTypeName };
}

// Fields of an object type or input fields of an input type
export function membersOf(index, typeName) {
    const t = index.types.get(typeName);
    if (!t) return [];
    return t.kind === 'INPUT_OBJECT' ? (t.inputFields || []) : (t.fields || []);
}

const memberOf = (index, typeName, name) => membersOf(index, typeName).find(m => m.name === name) || null;
const enumValues = (index, typeName) => {
    const t = index.types.get(typeName);
    return t?.kind === 'ENUM' ? (t.enumValues || []).map(v => v.name) : null;
};

// ---------- Suggestions for misspelled names ----------

function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

export function didYouMean(name, candidates) {
    const lower = name.toLowerCase();
    const exact = candidates.find(c => c.toLowerCase() === lower);
    if (exact) return exact;
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
        const d = distance(lower, c.toLowerCase());
        if (d < bestD) { best = c; bestD = d; }
    }
    return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

// ---------- Parser ----------

class ParseError extends Error {}

// Selection set AST: [{ name, alias, nameTok, args: [{ name, nameTok, value }], selections: [...] | null }]
// Values: { kind: 'variable'|'string'|'number'|'enum'|'null'|'boolean'|'list'|'object', tok?, items?, fields? }
function parseDocument(tokens) {
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    const expect = (text) => {
        const t = next();
        if (!t || t.text !== text) throw new ParseError(`expected ${text}`);
        return t;
    };
    const skipBalanced = (open, close) => {
        let depth = 0;
        do {
            const t = next();
            if (!t) throw new ParseError('unbalanced');
            if (t.type === 'punct' && t.text === open) depth++;
            else if (t.type === 'punct' && t.text === close) depth--;
        } while (depth > 0);
    };
    const skipDirectives = () => {
        while (peek()?.text === '@') {
            next();
            next();
            if (peek()?.text === '(') skipBalanced('(', ')');
        }
    };

    function parseValue() {
        const t = next();
        if (!t) throw new ParseError('value');
        if (t.type === 'variable') return { kind: 'variable', tok: t };
        if (t.type === 'string') return { kind: 'string', tok: t };
        if (t.type === 'number') return { kind: 'number', tok: t };
        if (t.type === 'keyword' || t.type === 'name') {
            if (t.text === 'null') return { kind: 'null', tok: t };
            if (t.text === 'true' || t.text === 'false') return { kind: 'boolean', tok: t };
            return { kind: 'enum', tok: t };
        }
        if (t.text === '[') {
            const items = [];
            while (peek() && peek().text !== ']') { items.push(parseValue()); if (peek()?.text === ',') next(); }
            expect(']');
            return { kind: 'list', items };
        }
        if (t.text === '{') {
            const fields = [];
            while (peek() && peek().text !== '}') {
                const nameTok = next();
                if (nameTok.type !== 'name' && nameTok.type !== 'keyword') throw new ParseError('field name');
                expect(':');
                fields.push({ name: nameTok.text, nameTok, value: parseValue() });
                if (peek()?.text === ',') next();
            }
            expect('}');
            return { kind: 'object', fields };
        }
        throw new ParseError('value');
    }

    function parseArgs() {
        const args = [];
        expect('(');
        while (peek() && peek().text !== ')') {
            const nameTok = next();
            if (nameTok.type !== 'name' && nameTok.type !== 'keyword') throw new ParseError('argument name');
            expect(':');
            args.push({ name: nameTok.text, nameTok, value: parseValue() });
            if (peek()?.text === ',') next();
        }
        expect(')');
        return args;
    }

    function parseSelectionSet() {
        expect('{');
        const out = [];
        while (peek() && peek().text !== '}') {
            if (peek().text === ',') { next(); continue; }
            if (peek().text === '...') {
                next();
                if (peek()?.text === 'on') { next(); next(); }
                else if (peek()?.text !== '{' && peek()?.text !== '@') next();
                skipDirectives();
                if (peek()?.text === '{') parseSelectionSet(); // inline fragment: not checked
                continue;
            }
            const first = next();
            if (first.type !== 'name' && first.type !== 'keyword') throw new ParseError('field');
            let nameTok = first;
            let alias = null;
            if (peek()?.text === ':') {
                next();
                alias = first.text;
                nameTok = next();
                if (!nameTok || (nameTok.type !== 'name' && nameTok.type !== 'keyword')) throw new ParseError('field');
            }
            const args = peek()?.text === '(' ? parseArgs() : [];
            skipDirectives();
            const selections = peek()?.text === '{' ? parseSelectionSet() : null;
            out.push({ name: nameTok.text, alias, nameTok, args, selections });
        }
        expect('}');
        return out;
    }

    // First operation: [query|mutation|subscription] [Name] [($vars)] { ... }
    while (peek()) {
        const t = peek();
        if (t.text === 'fragment') { next(); while (peek() && peek().text !== '{') next(); if (peek()) skipBalanced('{', '}'); continue; }
        if (t.text === '{') return { operation: 'query', selections: parseSelectionSet() };
        if (t.type === 'keyword' && ['query', 'mutation', 'subscription'].includes(t.text)) {
            next();
            if (peek()?.type === 'name') next();
            if (peek()?.text === '(') skipBalanced('(', ')');
            skipDirectives();
            return { operation: t.text, selections: parseSelectionSet() };
        }
        throw new ParseError('unexpected token');
    }
    return { operation: 'query', selections: [] };
}

// ---------- Validation ----------

function lineCol(src, offset) {
    const before = src.slice(0, offset);
    return { line: before.split('\n').length, col: offset - before.lastIndexOf('\n') };
}

const list = (names, max = 8) => names.slice(0, max).join(', ') + (names.length > max ? ', …' : '');

/**
 * Problems of a query against the schema: [{ message, start, end, line, col, severity }]. Empty when the text
 * is fine or cannot be parsed yet.
 */
export function validateAgainstSchema(src, index) {
    if (!index) return [];
    let doc;
    try {
        doc = parseDocument(significant(tokenize(src)));
    } catch (e) {
        if (e instanceof ParseError) return [];
        throw e;
    }
    if (doc.operation !== 'query') return [];

    const problems = [];
    const add = (tok, message, severity = 'error') => {
        problems.push({ message, start: tok.start, end: tok.start + tok.text.length, severity, ...lineCol(src, tok.start) });
    };

    const withHint = (name, candidates) => {
        const guess = didYouMean(name, candidates);
        return guess ? ` Did you mean “${guess}”?` : '';
    };

    function checkValue(value, typeRef, where) {
        if (!value || value.kind === 'variable' || value.kind === 'null' || !typeRef) return;
        if (isList(typeRef)) {
            const inner = listItem(typeRef);
            if (value.kind === 'list') value.items.forEach(v => checkValue(v, inner, where));
            else checkValue(value, inner, where);
            return;
        }
        const name = baseName(typeRef);
        const t = index.types.get(name);
        if (!t) return;
        if (t.kind === 'INPUT_OBJECT') {
            if (value.kind !== 'object') {
                if (value.tok) add(value.tok, `${where} expects an object like { eq: … } (type ${name}).`);
                return;
            }
            const names = (t.inputFields || []).map(f => f.name);
            for (const f of value.fields) {
                const def = (t.inputFields || []).find(x => x.name === f.name);
                if (!def) {
                    add(f.nameTok, `Unknown ${t.name.endsWith('Filter') ? 'filter field' : 'field'} “${f.name}” in ${name}. Available: ${list(names)}.${withHint(f.name, names)}`);
                    continue;
                }
                checkValue(f.value, def.type, f.name);
            }
        } else if (t.kind === 'ENUM') {
            const values = (t.enumValues || []).map(v => v.name);
            if (value.kind === 'enum' && !values.includes(value.tok.text)) {
                add(value.tok, `“${value.tok.text}” is not a valid ${name}. Use: ${list(values)}.${withHint(value.tok.text, values)}`);
            } else if (value.kind === 'string') {
                add(value.tok, `${name} is an enum: write ${values[0] ? values[0] : 'the value'} without quotes.`);
            }
        }
    }

    function walk(selections, typeName) {
        for (const f of selections) {
            if (f.name === '__typename') continue;
            const def = memberOf(index, typeName, f.name);
            if (!def) {
                const names = membersOf(index, typeName).map(m => m.name);
                const isRoot = typeName === index.queryTypeName;
                add(f.nameTok, isRoot
                    ? `Unknown query “${f.name}”.${withHint(f.name, names)}`
                    : `“${f.name}” is not a field of ${typeName}. Available: ${list(names)}.${withHint(f.name, names)}`);
                continue;
            }
            const argDefs = def.args || [];
            for (const a of f.args) {
                const ad = argDefs.find(x => x.name === a.name);
                if (!ad) {
                    const names = argDefs.map(x => x.name);
                    add(a.nameTok, `“${f.name}” has no argument “${a.name}”${names.length ? `. Available: ${list(names)}` : ''}.${withHint(a.name, names)}`);
                    continue;
                }
                checkValue(a.value, ad.type, a.name);
            }
            const target = baseName(def.type);
            const targetType = index.types.get(target);
            if (f.selections) {
                if (targetType && targetType.kind === 'OBJECT') walk(f.selections, target);
                else add(f.nameTok, `“${f.name}” has no sub-fields to select.`);
            } else if (targetType && targetType.kind === 'OBJECT') {
                add(f.nameTok, `“${f.name}” needs a selection of fields, e.g. { data { … } }.`, 'warn');
            }
        }
    }

    walk(doc.selections, index.queryTypeName);
    return problems.sort((a, b) => a.start - b.start);
}

// ---------- Completions ----------

const VALUE_END = new Set(['string', 'number', 'name', 'keyword', 'variable']);

/**
 * Suggestions at `pos` in `src`.
 * extras.products: [{ Product, Name }] offered for the value of a Product filter.
 * Returns { from, prefix, inString, items: [{ label, kind, detail, insert }] }
 */
export function completionsAt(src, pos, index, extras = {}) {
    const empty = { from: pos, prefix: '', inString: false, items: [] };
    if (!index) return empty;

    const text = src.slice(0, pos);
    const all = tokenize(text);
    let prefix = '';
    let inString = false;
    let body = all;
    const lastTok = all[all.length - 1];
    if (lastTok && lastTok.unterminated) {
        inString = true;
        prefix = lastTok.text.replace(/^"/, '');
        body = all.slice(0, -1);
    } else if (lastTok && (lastTok.type === 'name' || lastTok.type === 'keyword') && lastTok.start + lastTok.text.length === pos) {
        prefix = lastTok.text;
        body = all.slice(0, -1);
    }
    const toks = significant(body);

    const frames = [];
    let pending = null; // last field name at selection level
    let lastTokSeen = null;
    const top = () => frames[frames.length - 1];

    for (const t of toks) {
        const f = top();
        if (t.type === 'punct') {
            if (t.text === '{') {
                if (f && (f.k === 'args' || f.k === 'obj' || f.k === 'list')) {
                    frames.push({ k: 'obj', type: baseName(f.valueType) ? baseName(f.valueType) : f.itemType ? baseName(f.itemType) : null, key: null, valueType: null });
                } else if (f && f.k === 'sel') {
                    const def = f.type && pending ? memberOf(index, f.type, pending) : null;
                    frames.push({ k: 'sel', type: def ? baseName(def.type) : null });
                } else {
                    frames.push({ k: 'sel', type: index.queryTypeName });
                }
                pending = null;
            } else if (t.text === '(') {
                const def = f && f.k === 'sel' && f.type && pending ? memberOf(index, f.type, pending) : null;
                frames.push({ k: 'args', def, key: null, valueType: null });
            } else if (t.text === '[') {
                const inner = f && f.valueType ? (isList(f.valueType) ? listItem(f.valueType) : f.valueType) : null;
                frames.push({ k: 'list', itemType: inner, valueType: inner, key: null });
            } else if (t.text === ')' || t.text === '}' || t.text === ']') {
                frames.pop();
            } else if (t.text === ':' && f) {
                const prev = lastTokSeen;
                if (f.k === 'args' && prev?.type === 'name') {
                    const ad = (f.def?.args || []).find(a => a.name === prev.text);
                    f.key = prev.text;
                    f.valueType = ad ? ad.type : null;
                } else if (f.k === 'obj' && prev?.type === 'name') {
                    const m = f.type ? memberOf(index, f.type, prev.text) : null;
                    f.key = prev.text;
                    f.valueType = m ? m.type : null;
                }
            }
        } else if ((t.type === 'name' || t.type === 'keyword') && f && f.k === 'sel') {
            pending = t.text;
        }
        lastTokSeen = t;
    }

    const f = top();
    const last = lastTokSeen;
    const items = [];
    const push = (label, kind, detail = '', insert = label) => items.push({ label, kind, detail, insert });
    const typeLabel = (t) => {
        const wrap = (x) => x.kind === 'NON_NULL' ? wrap(x.ofType) + '!' : x.kind === 'LIST' ? `[${wrap(x.ofType)}]` : x.name;
        return t ? wrap(t) : '';
    };

    const atValue = last && last.text === ':';
    if (!f) {
        if (!toks.length) { push('query', 'keyword'); }
    } else if (f.k === 'sel') {
        if (f.type) {
            for (const m of membersOf(index, f.type)) push(m.name, f.type === index.queryTypeName ? 'query' : 'field', typeLabel(m.type));
        }
    } else if (f.k === 'args') {
        if (!atValue) {
            for (const a of f.def?.args || []) push(a.name, 'argument', typeLabel(a.type), `${a.name}: `);
        } else {
            valueItems(f.valueType, f, frames.length - 1);
        }
    } else if (f.k === 'obj') {
        if (!atValue) {
            for (const m of membersOf(index, f.type)) push(m.name, 'field', typeLabel(m.type), `${m.name}: `);
        } else {
            valueItems(f.valueType, f, frames.length - 1);
        }
    } else if (f.k === 'list') {
        valueItems(f.valueType, f, frames.length - 1);
    }

    function valueItems(valueType, frame, depth) {
        const name = baseName(valueType);
        const values = name ? enumValues(index, name) : null;
        if (values) {
            values.forEach(v => push(v, 'value', name));
            return;
        }
        // Product code in { Product: { eq: "…" } }
        const parent = frames[depth - 1];
        const isProduct = (frame.key && parent && parent.k === 'obj' && parent.key === 'Product')
            || (frame.k === 'obj' && frame.key === 'Product');
        if (isProduct && extras.products) {
            for (const p of extras.products) push(p.Product, 'product', p.Name || '', inString ? p.Product : `"${p.Product}"`);
        }
    }

    const p = prefix.toLowerCase();
    const matches = !p ? items : items.filter(i => i.label.toLowerCase().includes(p) || (i.kind === 'product' && String(i.detail).toLowerCase().includes(p)));
    matches.sort((a, b) => {
        const as = a.label.toLowerCase().startsWith(p) ? 0 : 1;
        const bs = b.label.toLowerCase().startsWith(p) ? 0 : 1;
        return as - bs;
    });
    return { from: pos - prefix.length, prefix, inString, items: matches.slice(0, 50) };
}
