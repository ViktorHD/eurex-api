const TABS_KEY = 'eurexExplorer.tabs';
const MAX_TABS = 20;
const MAX_TEXT = 100000;

// Snapshots are stored per browser; oversized or malformed ones are ignored
export function loadTabsSnapshot(storage = globalThis.localStorage) {
    try {
        const snap = JSON.parse(storage?.getItem(TABS_KEY) || 'null');
        return snap && Array.isArray(snap.tabs) && snap.tabs.length ? snap : null;
    } catch (e) {
        return null;
    }
}

export function saveTabsSnapshot(snapshot, storage = globalThis.localStorage) {
    const tabs = (snapshot?.tabs || []).slice(0, MAX_TABS).map(t => ({ ...t, query: String(t.query || '').slice(0, MAX_TEXT), variables: String(t.variables || '').slice(0, MAX_TEXT) }));
    try { storage?.setItem(TABS_KEY, JSON.stringify({ activeTabId: snapshot?.activeTabId, tabs })); } catch (e) { /* storage unavailable */ }
}

// Elements in tests are plain mocks without setAttribute
const attr = (el, name, value) => { if (el && el.setAttribute) el.setAttribute(name, value); };

export class TabManager {
    constructor(tabsBarEl, addTabBtnEl, callbacks) {
        this.tabsBar = tabsBarEl;
        this.addTabBtn = addTabBtnEl;
        this.callbacks = callbacks; // { onTabChange: function(tabState) }
        
        this.tabIdCounter = 1;
        this.activeTabId = 1;
        this.tabStates = {};
        
        this.tabStates[1] = this._createTabState(1);

        attr(this.tabsBar, 'role', 'tablist');
        attr(this.tabsBar, 'aria-label', 'Query tabs');

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

    // What is kept between visits: names, queries and variables (results are not stored)
    snapshot() {
        return {
            activeTabId: this.activeTabId,
            tabs: Object.values(this.tabStates).map(s => ({ id: s.id, name: s.name, query: s.query || '', variables: s.variables || '' }))
        };
    }

    // Replaces the tabs with a snapshot; returns the active tab's state, or null when the snapshot is unusable
    restore(snapshot) {
        const list = Array.isArray(snapshot?.tabs) ? snapshot.tabs.filter(t => t && Number.isInteger(t.id) && t.id > 0) : [];
        if (!list.length) return null;
        this.tabStates = {};
        list.forEach(t => {
            this.tabStates[t.id] = { ...this._createTabState(t.id), name: String(t.name || 'Query ' + t.id), query: String(t.query || ''), variables: String(t.variables || '') };
        });
        this.tabIdCounter = Math.max(...list.map(t => t.id));
        this.activeTabId = this.tabStates[snapshot.activeTabId] ? snapshot.activeTabId : list[0].id;
        return this.tabStates[this.activeTabId];
    }

    getActiveState() {
        return this.tabStates[this.activeTabId];
    }
    
    updateActiveState(partialState) {
        if (!this.tabStates[this.activeTabId]) return;
        Object.assign(this.tabStates[this.activeTabId], partialState);
    }

    closeTab(id) {
        if (Object.keys(this.tabStates).length < 2 || !this.tabStates[id]) return;
        delete this.tabStates[id];
        if (this.activeTabId === id) {
            const rem = Object.keys(this.tabStates).map(Number);
            this.activateTab(rem[0]);
        }
        this.render();
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
            attr(tab, 'role', 'tab');
            attr(tab, 'aria-selected', String(id === this.activeTabId));
            // Roving tabindex: arrow keys move between tabs, Enter opens, Delete closes, F2 renames
            attr(tab, 'tabindex', id === this.activeTabId ? '0' : '-1');
            attr(tab, 'data-tab-id', String(id));

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = s.name;
            tab.appendChild(label);

            if (ids.length > 1) {
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'close-tab';
                x.textContent = '✕';
                attr(x, 'aria-label', `Close ${s.name}`);
                attr(x, 'tabindex', '-1');
                x.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(id);
                });
                tab.appendChild(x);
            }

            const startRename = () => {
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
                    ev.stopPropagation();
                    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                    if (ev.key === 'Escape') { committed = true; this.render(); }
                });
            };
            label.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startRename();
            });

            tab.addEventListener('keydown', (e) => {
                if (e.target !== tab) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    tab.click();
                    this.tabsBar.querySelector?.(`[data-tab-id="${id}"]`)?.focus(); // render() replaced the element
                }
                else if (e.key === 'Delete') { e.preventDefault(); this.closeTab(id); }
                else if (e.key === 'F2') { e.preventDefault(); startRename(); }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const at = ids.indexOf(id);
                    const target = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
                    const el = this.tabsBar.querySelector?.(`[data-tab-id="${target}"]`);
                    if (el) { el.setAttribute('tabindex', '0'); el.focus(); }
                }
            });

            tab.addEventListener('click', () => {
                if (this.callbacks.onTabSave) {
                    this.callbacks.onTabSave(this.activeTabId, this.tabStates[this.activeTabId]);
                }
                this.activateTab(id);
                this.render();
            });

            this.tabsBar.insertBefore(tab, this.addTabBtn);
        });
        if (this.callbacks.onTabsChanged) this.callbacks.onTabsChanged();
    }
}
