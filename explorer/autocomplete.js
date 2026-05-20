export class Autocomplete {
    constructor(editorPaneEl, queryInputEl) {
        this.queryInput = queryInputEl;
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'autocomplete-dropdown hidden';
        editorPaneEl.appendChild(this.dropdown);
        this.items = [];
        this.schemaData = null;

        this.queryInput.addEventListener('input', () => this.handleInput());
        this.queryInput.addEventListener('keydown', (e) => this.handleKey(e));
        this.queryInput.addEventListener('blur', () => {
            setTimeout(() => this.dropdown.classList.add('hidden'), 200);
        });
    }

    setSchema(schemaData) {
        this.schemaData = schemaData;
        this.buildItems();
    }

    buildItems() {
        this.items = [];
        if (!this.schemaData) return;

        const queryTypeName = this.schemaData.queryType ? this.schemaData.queryType.name : null;
        const queryType = this.schemaData.types.find(t => t.name === queryTypeName);
        if (queryType && queryType.fields) {
            queryType.fields.forEach(f => {
                this.items.push({ label: f.name, kind: 'query', desc: f.description || '' });
            });
        }

        this.schemaData.types.forEach(t => {
            if (t.name.startsWith('__')) return;
            const fields = t.fields || t.inputFields || [];
            fields.forEach(f => {
                if (!this.items.some(a => a.label === f.name)) {
                    this.items.push({ label: f.name, kind: 'field', desc: f.description || '' });
                }
            });
        });
    }

    handleInput() {
        if (this.items.length === 0) this.buildItems();
        if (this.items.length === 0) return;

        const pos = this.queryInput.selectionStart;
        const textBefore = this.queryInput.value.substring(0, pos);
        const wordMatch = textBefore.match(/(\\w+)$/);
        if (!wordMatch || wordMatch[1].length < 2) {
            this.dropdown.classList.add('hidden');
            return;
        }

        const word = wordMatch[1].toLowerCase();
        const matches = this.items.filter(a => a.label.toLowerCase().includes(word)).slice(0, 8);

        if (matches.length === 0) {
            this.dropdown.classList.add('hidden');
            return;
        }

        this.dropdown.innerHTML = '';
        matches.forEach((m, idx) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (idx === 0 ? ' active' : '');

            const acLabel = document.createElement('span');
            acLabel.className = 'ac-label';
            acLabel.textContent = m.label;
            item.appendChild(acLabel);

            item.appendChild(document.createTextNode(' '));

            const acKind = document.createElement('span');
            acKind.className = 'ac-kind';
            acKind.textContent = m.kind;
            item.appendChild(acKind);

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.applyAutocomplete(m.label, word);
            });
            this.dropdown.appendChild(item);
        });

        const coords = this.getCaretCoordinates();
        this.dropdown.style.top = coords.top + 'px';
        this.dropdown.style.left = coords.left + 'px';
        this.dropdown.classList.remove('hidden');
    }

    handleKey(e) {
        if (this.dropdown.classList.contains('hidden')) return;

        const items = this.dropdown.querySelectorAll('.autocomplete-item');
        let activeIdx = [...items].findIndex(i => i.classList.contains('active'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items[activeIdx]) items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx + 1) % items.length;
            if (items[activeIdx]) items[activeIdx].classList.add('active');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items[activeIdx]) items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx - 1 + items.length) % items.length;
            if (items[activeIdx]) items[activeIdx].classList.add('active');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (items.length > 0) {
                e.preventDefault();
                const activeItem = items[activeIdx];
                const label = activeItem?.querySelector('.ac-label')?.textContent;
                if (label) {
                    const pos = this.queryInput.selectionStart;
                    const textBefore = this.queryInput.value.substring(0, pos);
                    const wordMatch = textBefore.match(/(\\w+)$/);
                    this.applyAutocomplete(label, wordMatch ? wordMatch[1] : '');
                }
            }
        } else if (e.key === 'Escape') {
            this.dropdown.classList.add('hidden');
        }
    }

    applyAutocomplete(label, currentWord) {
        const pos = this.queryInput.selectionStart;
        const before = this.queryInput.value.substring(0, pos - currentWord.length);
        const after = this.queryInput.value.substring(pos);
        this.queryInput.value = before + label + after;
        const newPos = pos - currentWord.length + label.length;
        this.queryInput.setSelectionRange(newPos, newPos);
        this.queryInput.focus();
        this.dropdown.classList.add('hidden');
        if (this.onSelect) this.onSelect(); // Fire optional callback
    }

    getCaretCoordinates() {
        const pane = this.queryInput.closest('.editor-pane');
        const rect = this.queryInput.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();

        const text = this.queryInput.value.substring(0, this.queryInput.selectionStart);
        const lines = text.split('\\n');
        const lineNum = lines.length;
        const colNum = lines[lines.length - 1].length;

        const lineHeight = 22; 
        const charWidth = 8.5; 

        return {
            top: (rect.top - paneRect.top) + (lineNum * lineHeight) + 4,
            left: (rect.left - paneRect.left) + (colNum * charWidth) + 16
        };
    }
}
