// Cursor pagination for the API Explorer. The API pages with `page: { first: N, after: "<cursor>" }` and
// returns `pageInfo { hasNextPage endCursor }` next to `data`. To fetch the next page of a result table the
// query text is rewritten: the `after` cursor of that root field's `page` argument is set or replaced.
import { tokenize } from './editor.js';

const significant = (tokens) => tokens.filter(t => t.type !== 'space' && t.type !== 'comment');

// Root fields of the first operation with their text ranges:
// [{ key, field, start, end, args: { open, close } | null }] where key is the alias when there is one
// (the name used in the response) and start/end are character offsets of the whole field.
function scanRootFields(query) {
    const tokens = significant(tokenize(query));
    let i = 0;
    let paren = 0;
    for (; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type !== 'punct') continue;
        if (t.text === '(') paren++;
        else if (t.text === ')') paren--;
        else if (t.text === '{' && paren === 0) break;
    }
    if (i >= tokens.length) return { tokens, roots: [] };

    const roots = [];
    let depth = 0;
    paren = 0;
    let cur = null;
    for (let j = i; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.type === 'punct') {
            if (t.text === '(') {
                if (paren === 0 && depth === 1 && cur) cur.args = { open: j, close: -1 };
                paren++;
                continue;
            }
            if (t.text === ')') {
                paren--;
                if (paren === 0 && depth === 1 && cur?.args) cur.args.close = j;
                continue;
            }
            if (paren > 0) continue; // braces inside arguments are object values, not selections
            if (t.text === '{') {
                depth++;
                if (depth === 2 && cur) cur.hasSelection = true;
                continue;
            }
            if (t.text === '}') {
                if (depth === 2 && cur) {
                    cur.end = t.start + 1;
                    roots.push(cur);
                    cur = null;
                }
                depth--;
                if (depth === 0) break;
                continue;
            }
        }
        if (paren === 0 && depth === 1 && !cur && t.type === 'name') {
            const aliased = tokens[j + 1]?.text === ':' && tokens[j + 2]?.type === 'name';
            cur = { key: t.text, field: aliased ? tokens[j + 2].text : t.text, start: t.start, end: -1, args: null, hasSelection: false };
            if (aliased) j += 2;
        }
    }
    return { tokens, roots };
}

// Rewrites the `page` argument of one root field so it starts after `cursor`.
// Returns the new text of the whole field, or null when the field has no literal `page: { ... }` argument
// (a variable such as `page: $p` or `after: $cursor` cannot be advanced by editing the query text).
function fieldWithCursor(query, tokens, root, cursor) {
    if (!root.args || root.args.close < 0) return null;
    const literal = JSON.stringify(String(cursor));
    let nesting = 0;
    for (let k = root.args.open + 1; k < root.args.close; k++) {
        const t = tokens[k];
        if (t.type === 'punct') {
            if (t.text === '{' || t.text === '[' || t.text === '(') nesting++;
            else if (t.text === '}' || t.text === ']' || t.text === ')') nesting--;
            continue;
        }
        if (nesting !== 0 || t.type !== 'name' || t.text !== 'page' || tokens[k + 1]?.text !== ':') continue;

        const open = tokens[k + 2];
        if (!open || open.text !== '{') return null;
        let depth = 0;
        let closeIdx = -1;
        for (let m = k + 2; m < root.args.close; m++) {
            if (tokens[m].type !== 'punct') continue;
            if (tokens[m].text === '{') depth++;
            else if (tokens[m].text === '}' && --depth === 0) { closeIdx = m; break; }
        }
        if (closeIdx < 0) return null;

        let edit = null;
        let inner = 0;
        for (let m = k + 3; m < closeIdx; m++) {
            const tm = tokens[m];
            if (tm.type === 'punct') {
                if (tm.text === '{' || tm.text === '[') inner++;
                else if (tm.text === '}' || tm.text === ']') inner--;
                continue;
            }
            if (inner === 0 && tm.type === 'name' && tm.text === 'after' && tokens[m + 1]?.text === ':') {
                const value = tokens[m + 2];
                if (!value || value.type !== 'string') return null; // a variable or null: leave it alone
                edit = { from: value.start, to: value.start + value.text.length, text: literal };
                break;
            }
        }
        if (!edit) {
            const hasContent = closeIdx > k + 3;
            edit = { from: open.start + 1, to: open.start + 1, text: ` after: ${literal}${hasContent ? ',' : ' '}` };
        }
        const text = query.slice(root.start, root.end);
        return text.slice(0, edit.from - root.start) + edit.text + text.slice(edit.to - root.start);
    }
    return null;
}

/**
 * Query that fetches the page after `cursor` for the root field `key` (its alias, or its name).
 * Without variables only that root field is requested; otherwise the whole operation is kept so that its
 * variable definitions stay valid. Returns null when the query cannot be advanced.
 */
export function buildNextPageQuery(query, key, cursor) {
    if (!query || !key || !cursor) return null;
    const { tokens, roots } = scanRootFields(query);
    const root = roots.find(r => r.key === key);
    if (!root) return null;
    const rewritten = fieldWithCursor(query, tokens, root, cursor);
    if (rewritten === null) return null;

    const usesVariables = tokens.some(t => t.type === 'variable');
    if (roots.length > 1 && !usesVariables) return `query {\n  ${rewritten}\n}`;
    return query.slice(0, root.start) + rewritten + query.slice(root.end);
}

export const canPaginate = (query, key, cursor = 'x') => buildNextPageQuery(query, key, cursor) !== null;
