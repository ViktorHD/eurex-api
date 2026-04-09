export class TabManager {
    constructor(tabsBarEl, addTabBtnEl, callbacks) {
        this.tabsBar = tabsBarEl;
        this.addTabBtn = addTabBtnEl;
        this.callbacks = callbacks; // { onTabChange: function(tabState) }
        
        this.tabIdCounter = 1;
        this.activeTabId = 1;
        this.tabStates = {};
        
        this.tabStates[1] = this._createTabState(1);

        this.addTabBtn.addEventListener('click', () => {
            this.callbacks.onTabSave(this.activeTabId, this.tabStates[this.activeTabId]);
            this.tabIdCounter++;
            this.tabStates[this.tabIdCounter] = this._createTabState(this.tabIdCounter);
            this.activateTab(this.tabIdCounter);
            this.render();
        });
    }

    _createTabState(id) {
        return {
            id: id,
            name: 'Query ' + id,
            query: '',
            data: null,
            sortCol: null,
            sortAsc: true,
            columnFilters: {}
        };
    }

    getActiveState() {
        return this.tabStates[this.activeTabId];
    }
    
    updateActiveState(partialState) {
        if (!this.tabStates[this.activeTabId]) return;
        Object.assign(this.tabStates[this.activeTabId], partialState);
    }

    activateTab(id) {
        this.activeTabId = id;
        if (this.callbacks.onTabLoad) {
            this.callbacks.onTabLoad(this.tabStates[id]);
        }
    }

    render() {
        this.tabsBar.querySelectorAll('.tab').forEach(t => t.remove());

        const ids = Object.keys(this.tabStates).map(Number).sort((a, b) => a - b);
        ids.forEach(id => {
            const s = this.tabStates[id];
            const tab = document.createElement('div');
            tab.className = 'tab' + (id === this.activeTabId ? ' active' : '');

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = s.name;
            tab.appendChild(label);

            if (ids.length > 1) {
                const x = document.createElement('span');
                x.className = 'close-tab';
                x.textContent = '✕';
                x.addEventListener('click', (e) => {
                    e.stopPropagation();
                    delete this.tabStates[id];
                    if (this.activeTabId === id) {
                        const rem = Object.keys(this.tabStates).map(Number);
                        this.activateTab(rem[0]);
                    }
                    this.render();
                });
                tab.appendChild(x);
            }

            label.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'tab-rename-input';
                inp.value = s.name;
                label.replaceWith(inp);
                inp.focus();
                inp.select();
                
                let committed = false;
                const commit = () => {
                    if (committed) return;
                    committed = true;
                    s.name = inp.value.trim() || s.name;
                    this.render();
                };
                inp.addEventListener('blur', commit);
                inp.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                    if (ev.key === 'Escape') { committed = true; this.render(); }
                });
            });

            tab.addEventListener('click', () => {
                if (id === this.activeTabId) return;
                if (this.callbacks.onTabSave) {
                    this.callbacks.onTabSave(this.activeTabId, this.tabStates[this.activeTabId]);
                }
                this.activateTab(id);
                this.render();
            });

            this.tabsBar.insertBefore(tab, this.addTabBtn);
        });
    }
}
