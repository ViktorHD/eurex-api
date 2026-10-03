import {
    tokenize, highlightGraphQL, validateGraphQL, rootFieldsOf, formatGraphQL,
    indentLines, toggleComment, addToHistory, loadHistory, clearHistory, timeAgo
} from '../editor.js';

const fakeStorage = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

const Q = 'query { Contracts(filter: { Product: { eq: "FESX" } }) { date data { ISIN Contract } } }';

describe('tokenize / highlight', () => {
    test('round-trips the source', () => {
        const src = 'query ($p: String!) {\n  # note\n  Contracts { a }\n}';
        expect(tokenize(src).map(t => t.text).join('')).toBe(src);
    });

    test('classifies tokens', () => {
        const types = tokenize('query $p "x" 12 # c').filter(t => t.type !== 'space').map(t => t.type);
        expect(types).toEqual(['keyword', 'variable', 'string', 'number', 'comment']);
    });

    test('highlights roots, args and escapes HTML', () => {
        const html = highlightGraphQL('{ Contracts(filter: "<b>") { a } }');
        expect(html).toContain('tk-root');
        expect(html).toContain('tk-arg');
        expect(html).not.toContain('<b>');
        expect(html).toContain('&lt;b&gt;');
    });
});

describe('validateGraphQL', () => {
    test('accepts a valid query', () => {
        expect(validateGraphQL(Q)).toBeNull();
    });
    test('reports an unclosed brace with its line', () => {
        expect(validateGraphQL('query {\n  Contracts {\n    a\n}')).toMatchObject({ line: 1 });
    });
    test('reports mismatched and unexpected closers', () => {
        expect(validateGraphQL('{ a(x: 1} }').message).toMatch(/closes the parenthesis/);
        expect(validateGraphQL('{ a } }').message).toMatch(/Unexpected/);
    });
    test('reports unterminated strings and empty input', () => {
        expect(validateGraphQL('{ a(x: "abc) }').message).toBe('Unterminated string');
        expect(validateGraphQL('  # only a comment').empty).toBe(true);
    });
});

describe('rootFieldsOf', () => {
    test('lists root fields, resolving aliases and skipping arguments', () => {
        expect(rootFieldsOf(Q)).toEqual(['Contracts']);
        expect(rootFieldsOf('{ a: Contracts { x } ProductInfos(filter: { Product: { eq: "X" } }) { y } }'))
            .toEqual(['Contracts', 'ProductInfos']);
    });
});

describe('formatGraphQL', () => {
    test('pretty-prints with arguments inline', () => {
        const out = formatGraphQL(Q);
        expect(out).toBe([
            'query {',
            '  Contracts(filter: { Product: { eq: "FESX" } }) {',
            '    date',
            '    data {',
            '      ISIN',
            '      Contract',
            '    }',
            '  }',
            '}'
        ].join('\n') + '\n');
    });
    test('is idempotent and keeps variables and comments', () => {
        const src = '# my query\nquery ($p: String!) { Contracts(filter: { Product: { eq: $p } }) { data { ISIN } } }';
        const once = formatGraphQL(src);
        expect(once).toContain('# my query');
        expect(once).toContain('query ($p: String!) {');
        expect(formatGraphQL(once)).toBe(once);
    });
    test('leaves broken input untouched', () => {
        expect(formatGraphQL('{ a { b }')).toBe('{ a { b }');
    });
});

describe('editing helpers', () => {
    test('indentLines indents and outdents the selected lines', () => {
        const v = 'a\nb\nc';
        const r = indentLines(v, 0, 3, false);
        expect(r.value).toBe('  a\n  b\nc');
        expect(indentLines(r.value, 0, r.end, true).value).toBe(v);
    });
    test('toggleComment comments and uncomments', () => {
        const v = '  a\n  b';
        const r = toggleComment(v, 0, v.length);
        expect(r.value).toBe('  # a\n  # b');
        expect(toggleComment(r.value, 0, r.value.length).value).toBe(v);
    });
});

describe('history', () => {
    test('adds newest first, de-duplicates by whitespace, records roots', () => {
        const s = fakeStorage();
        addToHistory('{ A { x } }', s, 1000);
        addToHistory('{ B { y } }', s, 2000);
        addToHistory('{  A {\n x } }', s, 3000);
        const list = loadHistory(s);
        expect(list.map(h => h.roots[0])).toEqual(['A', 'B']);
        expect(list[0].at).toBe(3000);
    });
    test('caps the list, ignores blanks, survives bad storage', () => {
        const s = fakeStorage();
        for (let i = 0; i < 30; i++) addToHistory(`{ Q${i} { x } }`, s, i);
        expect(loadHistory(s)).toHaveLength(25);
        expect(addToHistory('   ', s)).toHaveLength(25);
        clearHistory(s);
        expect(loadHistory(s)).toEqual([]);
        s.setItem('eurexExplorer.queryHistory', '{broken');
        expect(loadHistory(s)).toEqual([]);
    });
    test('timeAgo', () => {
        const now = 10_000_000;
        expect(timeAgo(now - 5_000, now)).toBe('just now');
        expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
        expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
        expect(timeAgo(now - 30 * 3_600_000, now)).toBe('yesterday');
    });
});
