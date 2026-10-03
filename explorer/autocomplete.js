// Suggestions while typing a query. With the schema loaded they depend on the cursor position (root query, row field,
// argument, filter field, operator, enum value, product code); without it, a flat list of all names is used.
// Ctrl+Space opens the list without typing anything.
export class Autocomplete {
    constructor(editorPaneEl, queryInputEl) {
        this.queryInput = queryInputEl;
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'autocomplete-dropdown hidden';
        this.dropdown.setAttribute('role', 'listbox');
        editorPaneEl.appendChild(this.dropdown);
        this.items = []; // flat fallback list
        this.shown = []; // items in the open dropdown
        this.from = 0; // where the typed part of the word starts
        this.schemaData = null;
        this.provider = null; // (text, position) => { from, prefix, inString, items }

        this.queryInput.addEventListener('input', () => this.handleInput());
        this.queryInput.addEventListener('keydown', (e) => this.handleKey(e));
        this.queryInput.addEventListener('blur', () => {
            setTimeout(() => this.hide(), 200);
        });
    }

    setSchema(schemaData) {
        this.schemaData = schemaData;
        this.buildItems();
    }

    // Context-aware suggestions; the provider returns { from, prefix, inString, items: [{ label, kind, detail, insert }] }
    setProvider(fn) {
        this.provider = fn;
    }

    buildItems() {
        this.items = [];
        if (!this.schemaData) return;

        const queryTypeName = this.schemaData.queryType ? this.schemaData.queryType.name : null;
        const queryType = this.schemaData.types.find(t => t.name === queryTypeName);
        if (queryType && queryType.fields) {
            queryType.fields.forEach(f => {
                this.items.push({ label: f.name, kind: 'query', detail: f.description || '', insert: f.name });
            });
        }

        this.schemaData.types.forEach(t => {
            if (t.name.startsWith('__')) return;
            const fields = t.fields || t.inputFields || [];
            fields.forEach(f => {
                if (!this.items.some(a => a.label === f.name)) {
                    this.items.push({ label: f.name, kind: 'field', detail: f.description || '', insert: f.name });
                }
            });
        });
    }

    hide() {
        this.dropdown.classList.add('hidden');
        this.shown = [];
    }

    isOpen() {
        return !this.dropdown.classList.contains('hidden');
    }

    // Matches for the text before the cursor, or null when nothing should be offered
    _suggest(force) {
        const pos = this.queryInput.selectionStart;
        const text = this.queryInput.value;
        if (this.provider) {
            const r = this.provider(text, pos);
            if (r) {
                const opened = force || r.prefix.length >= 1 || r.inString || text[pos - 1] === '"';
                return opened && r.items.length ? { from: r.from, items: r.items } : null;
            }
        }
        if (this.items.length === 0) this.buildItems();
        const wordMatch = text.substring(0, pos).match(/(\w+)$/);
        const word = wordMatch ? wordMatch[1] : '';
        if (word.length < 2 && !force) return null;
        const w = word.toLowerCase();
        const items = this.items.filter(a => a.label.toLowerCase().includes(w)).slice(0, 8);
        return items.length ? { from: pos - word.length, items } : null;
    }

    handleInput(force = false) {
        const found = this._suggest(force);
        if (!found) { this.hide(); return; }

        this.from = found.from;
        this.shown = found.items.slice(0, 12);
        this.dropdown.innerHTML = '';
        this.shown.forEach((m, idx) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (idx === 0 ? ' active' : '');
            item.setAttribute('role', 'option');
            item.dataset.index = String(idx);

            const acLabel = document.createElement('span');
            acLabel.className = 'ac-label';
            acLabel.textContent = m.label;
            item.appendChild(acLabel);

            item.appendChild(document.createTextNode(' '));

            const acKind = document.createElement('span');
            acKind.className = 'ac-kind';
            acKind.textContent = m.kind;
            item.appendChild(acKind);

            if (m.detail) {
                const acDetail = document.createElement('span');
                acDetail.className = 'ac-detail';
                acDetail.textContent = String(m.detail).slice(0, 40);
                item.appendChild(acDetail);
            }

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.apply(m);
            });
            this.dropdown.appendChild(item);
        });

        const coords = this.getCaretCoordinates();
        this.dropdown.style.top = coords.top + 'px';
        this.dropdown.style.left = coords.left + 'px';
        this.dropdown.classList.remove('hidden');
    }

    handleKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
            e.preventDefault();
            this.handleInput(true);
            return;
        }
        if (!this.isOpen()) return;

        const items = this.dropdown.querySelectorAll('.autocomplete-item');
        let activeIdx = [...items].findIndex(i => i.classList.contains('active'));

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (items[activeIdx]) items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            if (items[activeIdx]) {
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView?.({ block: 'nearest' });
            }
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const chosen = this.shown[Math.max(0, activeIdx)];
            if (chosen) {
                e.preventDefault();
                this.apply(chosen);
            }
        } else if (e.key === 'Escape') {
            this.hide();
        }
    }

    apply(item) {
        const pos = this.queryInput.selectionStart;
        const value = this.queryInput.value;
        const insert = item.insert ?? item.label;
        this.queryInput.value = value.substring(0, this.from) + insert + value.substring(pos);
        const newPos = this.from + insert.length;
        this.queryInput.setSelectionRange(newPos, newPos);
        this.queryInput.focus();
        this.hide();
        if (this.onSelect) this.onSelect(); // Fire optional callback
    }

    getCaretCoordinates() {
        const ta = this.queryInput;
        const pane = ta.closest('.editor-pane');
        const rect = ta.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();
        const cs = getComputedStyle(ta);

        const text = ta.value.substring(0, ta.selectionStart);
        const lines = text.split('\n');
        const lineNum = lines.length;
        const colNum = lines[lines.length - 1].length;

        const fontSize = parseFloat(cs.fontSize) || 14;
        const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
        if (!this._charWidth || this._charFont !== cs.font) {
            const ctx = (this._canvas ||= document.createElement('canvas')).getContext('2d');
            ctx.font = cs.font || `${fontSize}px monospace`;
            this._charWidth = ctx.measureText('M').width || fontSize * 0.6;
            this._charFont = cs.font;
        }
        const top = rect.top - paneRect.top + parseFloat(cs.paddingTop || 0) + lineNum * lineHeight - ta.scrollTop + 4;
        const left = rect.left - paneRect.left + parseFloat(cs.paddingLeft || 0) + colNum * this._charWidth - ta.scrollLeft;
        return {
            top: Math.min(top, paneRect.height - 40),
            left: Math.max(8, Math.min(left, paneRect.width - 260))
        };
    }
}
