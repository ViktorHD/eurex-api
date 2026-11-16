// Query editor: a textarea with a syntax-highlighted overlay, line numbers, editing helpers,
// validation and a status bar. The textarea stays the source of truth, so existing code that
// reads or writes `queryInput.value` keeps working (programmatic writes refresh the overlay).

const KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment', 'on', 'true', 'false', 'null']);

// ---------- Tokenizer ----------

// Tokens: { type, text, start } with type in name | keyword | string | number | variable | comment | punct | space | error
export function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const start = i;
        if (c === '#') {
            while (i < n && src[i] !== '\n') i++;
            tokens.push({ type: 'comment', text: src.slice(start, i), start });
        } else if (/\s/.test(c)) {
            while (i < n && /\s/.test(src[i])) i++;
            tokens.push({ type: 'space', text: src.slice(start, i), start });
        } else if (c === '"') {
            const block = src.startsWith('"""', i);
            i += block ? 3 : 1;
            let closed = false;
            while (i < n) {
                if (block && src.startsWith('"""', i)) { i += 3; closed = true; break; }
                if (!block && src[i] === '\\') { i += 2; continue; }
                if (!block && (src[i] === '"' || src[i] === '\n')) { if (src[i] === '"') { i++; closed = true; } break; }
                i++;
            }
            tokens.push({ type: closed ? 'string' : 'error', text: src.slice(start, i), start, unterminated: !closed });
        } else if (c === '$') {
            i++;
            while (i < n && /\w/.test(src[i])) i++;
            tokens.push({ type: 'variable', text: src.slice(start, i), start });
        } else if (/[A-Za-z_]/.test(c)) {
            while (i < n && /\w/.test(src[i])) i++;
            const text = src.slice(start, i);
            tokens.push({ type: KEYWORDS.has(text) ? 'keyword' : 'name', text, start });
        } else if (/[-0-9]/.test(c)) {
            i++;
            while (i < n && /[0-9.eE+-]/.test(src[i])) i++;
            tokens.push({ type: 'number', text: src.slice(start, i), start });
        } else if (src.startsWith('...', i)) {
            i += 3;
            tokens.push({ type: 'punct', text: '...', start });
        } else {
            i++;
            tokens.push({ type: 'punct', text: c, start });
        }
    }
    return tokens;
}

const significant = (tokens) => tokens.filter(t => t.type !== 'space' && t.type !== 'comment');

// ---------- Highlighting ----------

const escapeHtml = (s) => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

// HTML for the overlay. Names are classified by context: argument names (inside parentheses, before ':'),
// root query fields (first level of the operation) and other fields.
export function highlightGraphQL(src, problems = []) {
    const tokens = tokenize(src);
    const badAt = new Map(problems.map(p => [p.start, p.severity === 'warn' ? 'tk-warn' : 'tk-bad']));
    let braceDepth = 0;
    let parenDepth = 0;
    let html = '';
    tokens.forEach((t, idx) => {
        let cls = '';
        if (t.type === 'name') {
            let j = idx + 1;
            while (tokens[j] && (tokens[j].type === 'space' || tokens[j].type === 'comment')) j++;
            const next = tokens[j]?.text;
            if (parenDepth > 0 && next === ':') cls = 'tk-arg';
            else if (parenDepth > 0) cls = 'tk-value';
            else if (braceDepth === 1) cls = 'tk-root';
            else cls = 'tk-field';
        } else if (t.type === 'punct') {
            if (t.text === '{') braceDepth++;
            else if (t.text === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (t.text === '(') parenDepth++;
            else if (t.text === ')') parenDepth = Math.max(0, parenDepth - 1);
            cls = 'tk-punct';
        } else if (t.type !== 'space') {
            cls = 'tk-' + t.type;
        }
        const text = escapeHtml(t.text);
        if (badAt.has(t.start)) cls = `${cls} ${badAt.get(t.start)}`.trim();
        html += cls ? `<span class="${cls}">${text}</span>` : text;
    });
    // A trailing newline needs a character after it to be rendered in a <pre>
    return html + (src.endsWith('\n') ? ' ' : '');
}

// ---------- Validation ----------

function lineCol(src, offset) {
    const before = src.slice(0, offset);
    const line = before.split('\n').length;
    return { line, col: offset - before.lastIndexOf('\n') };
}

// First structural problem: unbalanced or mismatched brackets, unterminated string. Null when fine.
export function validateGraphQL(src) {
    const tokens = tokenize(src);
    const pairs = { '}': '{', ')': '(', ']': '[' };
    const names = { '{': 'brace', '(': 'parenthesis', '[': 'bracket' };
    const stack = [];
    for (const t of tokens) {
        if (t.unterminated) return { message: 'Unterminated string', ...lineCol(src, t.start) };
        if (t.type !== 'punct') continue;
        if (t.text === '{' || t.text === '(' || t.text === '[') stack.push(t);
        else if (pairs[t.text]) {
            const open = stack.pop();
            if (!open) return { message: `Unexpected “${t.text}”`, ...lineCol(src, t.start) };
            if (open.text !== pairs[t.text]) {
                const where = lineCol(src, open.start);
                return { message: `“${t.text}” closes the ${names[open.text]} opened at line ${where.line}`, ...lineCol(src, t.start) };
            }
        }
    }
    if (stack.length) {
        const open = stack[stack.length - 1];
        return { message: `Unclosed ${names[open.text]} “${open.text}”`, ...lineCol(src, open.start) };
    }
    if (!significant(tokens).length) return { message: 'Query is empty', line: 1, col: 1, empty: true };
    return null;
}

// Root query fields of the first operation, e.g. ["Contracts", "ProductInfos"]
export function rootFieldsOf(src) {
    const tokens = significant(tokenize(src));
    const roots = [];
    let depth = 0;
    let paren = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.text === '{' && t.type === 'punct') depth++;
        else if (t.text === '}' && t.type === 'punct') { depth--; if (depth === 0) break; }
        else if (t.text === '(') paren++;
        else if (t.text === ')') paren--;
        else if (depth === 1 && paren === 0 && t.type === 'name') {
            // alias: name ':' realName
            if (tokens[i + 1]?.text === ':' && tokens[i + 2]?.type === 'name') { roots.push(tokens[i + 2].text); i += 2; }
            else roots.push(t.text);
        }
    }
    return roots;
}

// ---------- Formatting ----------

// Pretty-prints a query: one field per line, two-space indent, arguments kept inline as
// `(filter: { Product: { eq: "FESX" } })`, comments preserved on their own lines.
export function formatGraphQL(src) {
    const tokens = tokenize(src).filter(t => t.type !== 'space');
    if (validateGraphQL(src) && !validateGraphQL(src).empty) return src; // never reshape broken input
    const lines = [];
    let line = '';
    let indent = 0;
    let paren = 0;
    let prev = null;
    const pad = () => '  '.repeat(indent);
    const newline = () => { if (line.trim()) lines.push(line.replace(/\s+$/, '')); line = pad(); };

    for (const t of tokens) {
        if (t.type === 'comment') {
            if (line.trim()) newline();
            line = pad() + t.text;
            newline();
            prev = null;
            continue;
        }
        if (paren > 0) {
            // Inline argument mode
            if (t.text === '(') { line += '('; paren++; }
            else if (t.text === ')') { line = line.replace(/\s+$/, '') + ')'; paren--; }
            else if (t.text === '{' || t.text === '[') { line += (prev && !['(', '[', '{', ':'].includes(prev.text) && !line.endsWith(' ') ? ' ' : '') + t.text + (t.text === '{' ? ' ' : ''); }
            else if (t.text === '}') { line = line.replace(/\s+$/, '') + ' }'; }
            else if (t.text === ']') { line = line.replace(/\s+$/, '') + ']'; }
            else if (t.text === ':') { line = line.replace(/\s+$/, '') + ': '; }
            else if (t.text === ',') { line = line.replace(/\s+$/, '') + ', '; }
            else if (t.text === '!') { line = line.replace(/\s+$/, '') + '!'; }
            else {
                const needsSpace = prev && !['(', '[', ':', ','].includes(prev.text) && !line.endsWith(' ') && !line.endsWith('{ ');
                line += (needsSpace ? (prev.text === '{' ? '' : ' ') : '') + t.text;
            }
            if (paren === 0) prev = { text: ')', type: 'punct' };
            else prev = t;
            continue;
        }
        if (t.text === '{') {
            line = line.replace(/\s+$/, '') + (line.trim() ? ' {' : '{');
            indent++;
            newline();
        } else if (t.text === '}') {
            indent = Math.max(0, indent - 1);
            newline();
            line = pad() + '}';
            newline();
        } else if (t.text === '(') {
            line = line.replace(/\s+$/, '') + (prev?.type === 'keyword' ? ' (' : '(');
            paren = 1;
        } else if (t.text === ':') {
            line = line.replace(/\s+$/, '') + ': ';
        } else if (t.text === ',') {
            // commas between fields are optional in GraphQL; one field per line instead
        } else {
            const startsField = indent > 0 && prev && (prev.type === 'name' || prev.text === ')' || prev.text === '}') && prev.text !== ':';
            if (startsField) newline();
            else if (line.trim() && !line.endsWith(' ') && prev?.text !== ':') line += ' ';
            if (!line.trim()) line = pad();
            line += t.text;
        }
        prev = t;
    }
    newline();
    return lines.join('\n') + '\n';
}

// ---------- Editing helpers (pure, for testability) ----------

// Indents or outdents the lines touched by [start, end). Returns { value, start, end }.
export function indentLines(value, start, end, outdent) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const lineEndIdx = value.indexOf('\n', blockEnd);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    let firstDelta = 0;
    let total = 0;
    const changed = lines.map((l, i) => {
        if (outdent) {
            const removed = l.startsWith('  ') ? 2 : l.startsWith(' ') ? 1 : 0;
            if (i === 0) firstDelta = -removed;
            total -= removed;
            return l.slice(removed);
        }
        if (i === 0) firstDelta = 2;
        total += 2;
        return '  ' + l;
    }).join('\n');
    return {
        value: value.slice(0, lineStart) + changed + value.slice(lineEnd),
        start: Math.max(lineStart, start + firstDelta),
        end: end + total
    };
}

// Toggles '# ' comments on the lines touched by [start, end).
export function toggleComment(value, start, end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allCommented = lines.filter(l => l.trim()).every(l => /^\s*#/.test(l));
    const changed = lines.map(l => {
        if (!l.trim()) return l;
        if (allCommented) return l.replace(/^(\s*)# ?/, '$1');
        const ind = l.match(/^\s*/)[0];
        return ind + '# ' + l.slice(ind.length);
    }).join('\n');
    const delta = changed.length - (lineEnd - lineStart);
    return { value: value.slice(0, lineStart) + changed + value.slice(lineEnd), start: lineStart, end: lineEnd + delta };
}

const PAIRS = { '{': '}', '(': ')', '[': ']', '"': '"' };

// ---------- Editor ----------

export class QueryEditor {
    constructor(textarea, options = {}) {
        this.ta = textarea;
        this.options = options; // { getRootNames: () => Set|null, getProblems: (src) => [{ message, start, line, severity }] }
        this._build();
        this._interceptValue();
        this._bind();
        this.refresh();
    }

    _build() {
        const ta = this.ta;
        const wrap = document.createElement('div');
        wrap.className = 'qe';
        ta.parentNode.insertBefore(wrap, ta);
        this.gutter = document.createElement('div');
        this.gutter.className = 'qe-gutter';
        this.gutter.setAttribute('aria-hidden', 'true');
        const body = document.createElement('div');
        body.className = 'qe-body';
        this.pre = document.createElement('pre');
        this.pre.className = 'qe-highlight';
        this.pre.setAttribute('aria-hidden', 'true');
        this.code = document.createElement('code');
        this.pre.appendChild(this.code);
        body.append(this.pre, ta);
        wrap.append(this.gutter, body);
        ta.classList.add('qe-input');
        ta.setAttribute('aria-label', 'GraphQL query');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('autocomplete', 'off');
        this.wrap = wrap;

        this.status = document.createElement('div');
        this.status.className = 'qe-status';
        this.status.setAttribute('role', 'status');
        this.statusMsg = document.createElement('span');
        this.statusMsg.className = 'qe-status-msg';
        this.statusPos = document.createElement('span');
        this.statusPos.className = 'qe-status-pos';
        this.status.append(this.statusMsg, this.statusPos);
        wrap.after(this.status);
    }

    // Writes to `ta.value` from anywhere in the app also refresh the highlighting
    _interceptValue() {
        const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        const self = this;
        Object.defineProperty(this.ta, 'value', {
            configurable: true,
            get() { return proto.get.call(this); },
            set(v) { proto.set.call(this, v); self.refresh(); }
        });
    }

    _bind() {
        const ta = this.ta;
        ta.addEventListener('input', () => this.refresh());
        ta.addEventListener('scroll', () => this._syncScroll());
        ['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, () => this._updatePos()));
        ta.addEventListener('keydown', (e) => this._onKey(e));
    }

    _syncScroll() {
        this.pre.scrollTop = this.ta.scrollTop;
        this.pre.scrollLeft = this.ta.scrollLeft;
        this.gutter.scrollTop = this.ta.scrollTop;
    }

    refresh() {
        const v = this.ta.value;
        // Problems against the schema (when it is loaded) underline the tokens they belong to
        this.schemaProblems = this.options.getProblems && !validateGraphQL(v) ? this.options.getProblems(v) : [];
        this.code.innerHTML = highlightGraphQL(v, this.schemaProblems);
        const lines = v.split('\n').length;
        if (this._lines !== lines) {
            this._lines = lines;
            this.gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<span>${i + 1}</span>`).join('');
        }
        this._validate();
        this._updatePos();
        this._syncScroll();
    }

    _validate() {
        const v = this.ta.value;
        const problem = validateGraphQL(v);
        this.status.classList.remove('ok', 'warn', 'error');
        this.gutter.querySelectorAll('.err, .warn').forEach(s => s.classList.remove('err', 'warn'));
        if (problem && !problem.empty) {
            this.status.classList.add('error');
            this.statusMsg.textContent = `${problem.message} (line ${problem.line})`;
            this.gutter.children[problem.line - 1]?.classList.add('err');
            this.problem = problem;
            return;
        }
        this.problem = null;
        if (problem?.empty) {
            this.statusMsg.textContent = 'Type a query or pick one from History or the Docs pane';
            return;
        }
        const roots = rootFieldsOf(v);
        const found = this.schemaProblems || [];
        if (found.length) {
            const first = found[0];
            const errors = found.filter(p => p.severity !== 'warn').length;
            this.status.classList.add(errors ? 'error' : 'warn');
            this.statusMsg.textContent = `${first.message} (line ${first.line})${found.length > 1 ? ` · +${found.length - 1} more` : ''}`;
            found.forEach(p => this.gutter.children[p.line - 1]?.classList.add(p.severity === 'warn' ? 'warn' : 'err'));
            return;
        }
        const known = this.options.getRootNames ? this.options.getRootNames() : null;
        const unknown = known ? roots.filter(r => !known.has(r)) : [];
        if (unknown.length) {
            this.status.classList.add('warn');
            this.statusMsg.textContent = `Unknown quer${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`;
            return;
        }
        this.status.classList.add('ok');
        this.statusMsg.textContent = roots.length ? `Ready · ${roots.join(', ')}` : 'Ready';
    }

    _updatePos() {
        const pos = this.ta.selectionStart || 0;
        const before = this.ta.value.slice(0, pos);
        const line = before.split('\n').length;
        const col = pos - before.lastIndexOf('\n');
        const sel = Math.abs((this.ta.selectionEnd || 0) - pos);
        this.statusPos.textContent = `Ln ${line}, Col ${col}${sel ? ` (${sel} selected)` : ''}`;
    }

    // Replace text through execCommand where possible so the browser keeps undo history
    _replace(value, start, end) {
        const ta = this.ta;
        ta.focus();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand && document.execCommand('insertText', false, value);
        if (!ok || ta.value !== value) ta.value = value;
        ta.setSelectionRange(start, end);
        this.refresh();
    }

    _insert(text, caretOffset = text.length) {
        const ta = this.ta;
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const ok = document.execCommand && document.execCommand('insertText', false, text);
        if (!ok) {
            ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
        }
        ta.setSelectionRange(s + caretOffset, s + caretOffset);
        this.refresh();
    }

    format() {
        const formatted = formatGraphQL(this.ta.value);
        if (formatted !== this.ta.value) this._replace(formatted, 0, 0);
        return !this.problem;
    }

    _onKey(e) {
        if (e.defaultPrevented) return; // autocomplete handled it
        const ta = this.ta;
        const v = ta.value;
        const s = ta.selectionStart;
        const end = ta.selectionEnd;

        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            const r = toggleComment(v, s, end);
            this._replace(r.value, r.start, r.end);
            return;
        }
        if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
            e.preventDefault();
            this.format();
            return;
        }
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (s === end && !e.shiftKey) { this._insert('  '); return; }
            const r = indentLines(v, s, end, e.shiftKey);
            this._replace(r.value, r.start, r.end);
            return;
        }
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            const lineStart = v.lastIndexOf('\n', s - 1) + 1;
            const indent = v.slice(lineStart, s).match(/^\s*/)[0];
            const prevChar = v.slice(lineStart, s).trimEnd().slice(-1);
            const nextChar = v[end];
            const opens = prevChar === '{' || prevChar === '(';
            if (opens && (nextChar === '}' || nextChar === ')')) {
                const inner = '\n' + indent + '  ';
                this._insert(inner + '\n' + indent, inner.length);
            } else {
                this._insert('\n' + indent + (opens ? '  ' : ''));
            }
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Auto-close brackets and quotes; type over an existing closer
        if (PAIRS[e.key] && s === end) {
            if (e.key === '"' && v[s] === '"') { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
            const nextCh = v[s] || '';
            if (/\w/.test(nextCh)) return; // don't pair right before a word
            e.preventDefault();
            this._insert(e.key + PAIRS[e.key], 1);
            return;
        }
        if ((e.key === '}' || e.key === ')' || e.key === ']') && s === end && v[s] === e.key) {
            e.preventDefault();
            ta.setSelectionRange(s + 1, s + 1);
            return;
        }
        if (e.key === 'Backspace' && s === end && s > 0 && PAIRS[v[s - 1]] === v[s]) {
            e.preventDefault();
            ta.setSelectionRange(s - 1, s + 1);
            this._insert('', 0);
        }
    }
}

// ---------- History ----------

const HISTORY_KEY = 'eurexExplorer.queryHistory';
const HISTORY_MAX = 25;

export function loadHistory(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

// Adds a query to the front of the history (deduplicated by normalised text). Returns the new list.
export function addToHistory(query, storage = globalThis.localStorage, now = Date.now(), variables = '') {
    const norm = (q) => q.replace(/\s+/g, ' ').trim();
    const key = norm(query);
    if (!key) return loadHistory(storage);
    const vars = String(variables || '').trim();
    // The same query with different variables is a different run
    const list = loadHistory(storage).filter(h => !(norm(h.query) === key && norm(h.variables || '') === norm(vars)));
    list.unshift({ query, variables: vars, at: now, roots: rootFieldsOf(query) });
    const trimmed = list.slice(0, HISTORY_MAX);
    try { storage?.setItem(HISTORY_KEY, JSON.stringify(trimmed)); } catch (e) { /* storage unavailable */ }
    return trimmed;
}

export function clearHistory(storage = globalThis.localStorage) {
    try { storage?.removeItem(HISTORY_KEY); } catch (e) { /* storage unavailable */ }
}

export function timeAgo(ts, now = Date.now()) {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---------- Saved queries ----------
// Named queries (with their variables) the user keeps; stored per browser, newest first.

const SAVED_KEY = 'eurexExplorer.savedQueries';
const SAVED_MAX = 50;

export function loadSaved(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(SAVED_KEY) || '[]');
        return Array.isArray(list) ? list.filter(s => s && typeof s.query === 'string' && typeof s.name === 'string') : [];
    } catch (e) {
        return [];
    }
}

const writeSaved = (list, storage) => {
    try { storage?.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
    return list;
};

// Saves a query under a name; an existing entry with that name (case-insensitive) is replaced.
export function saveQuery(name, query, variables = '', storage = globalThis.localStorage, now = Date.now()) {
    const label = String(name || '').trim().slice(0, 60);
    if (!label || !String(query || '').trim()) return loadSaved(storage);
    const list = loadSaved(storage).filter(s => s.name.toLowerCase() !== label.toLowerCase());
    list.unshift({ name: label, query, variables: String(variables || '').trim(), at: now });
    return writeSaved(list.slice(0, SAVED_MAX), storage);
}

export function deleteSaved(name, storage = globalThis.localStorage) {
    return writeSaved(loadSaved(storage).filter(s => s.name !== name), storage);
}
