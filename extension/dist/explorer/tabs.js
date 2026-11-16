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

const MAX_TAB_NAME = 60;

/**
 * The tab bar of the API Explorer: one tab per query (name, query, variables, results).
 * Tabs can be reordered by dragging, renamed (double click / F2), duplicated and closed (button, middle click,
 * Delete); a context menu (right click / Menu key) offers all of that. A tab shows whether its query is running or
 * failed and how many rows it holds. Many tabs scroll sideways, the "+" button stays in view.
 *
 * callbacks: { onTabSave(id, state), onTabLoad(state), onTabClose(id), onTabsChanged() }
 */
export class TabManager {
    constructor(tabsBarEl, addTabBtnEl, callbacks) {
        this.tabsBar = tabsBarEl;
        this.addTabBtn = addTabBtnEl;
        this.callbacks = callbacks;

        this.tabIdCounter = 1;
        this.activeTabId = 1;
        this.tabStates = {};
        this.order = [1]; // tab ids, left to right

        this.tabStates[1] = this._createTabState(1);

        this.tabsBar.setAttribute('role', 'tablist');
        this.tabsBar.setAttribute('aria-label', 'Query tabs');
        // Tabs live in a scroller of their own so that the "+" button never scrolls away
        this.scroller = document.createElement('div');
        this.scroller.className = 'tabs-scroll';
        this.tabsBar.insertBefore(this.scroller, this.addTabBtn);

        this.addTabBtn.addEventListener('click', () => this.addTab());
        this.scroller.addEventListener('wheel', (e) => {
            // A mouse wheel scrolls the tabs sideways
            if (this.scroller.scrollWidth > this.scroller.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                this.scroller.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        }, { passive: false });
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

    _save() {
        if (this.callbacks.onTabSave && this.tabStates[this.activeTabId]) {
            this.callbacks.onTabSave(this.activeTabId, this.tabStates[this.activeTabId]);
        }
    }

    // What is kept between visits: names, order, queries and variables (results are not stored)
    snapshot() {
        return {
            activeTabId: this.activeTabId,
            tabs: this.order.map(id => this.tabStates[id]).filter(Boolean).map(s => ({ id: s.id, name: s.name, query: s.query || '', variables: s.variables || '' }))
        };
    }

    // Replaces the tabs with a snapshot; returns the active tab's state, or null when the snapshot is unusable
    restore(snapshot) {
        const list = Array.isArray(snapshot?.tabs) ? snapshot.tabs.filter(t => t && Number.isInteger(t.id) && t.id > 0) : [];
        if (!list.length) return null;
        this.tabStates = {};
        this.order = [];
        list.forEach(t => {
            if (this.tabStates[t.id]) return; // duplicate id
            this.tabStates[t.id] = { ...this._createTabState(t.id), name: String(t.name || 'Query ' + t.id), query: String(t.query || ''), variables: String(t.variables || '') };
            this.order.push(t.id);
        });
        this.tabIdCounter = Math.max(...this.order);
        this.activeTabId = this.tabStates[snapshot.activeTabId] ? snapshot.activeTabId : this.order[0];
        return this.tabStates[this.activeTabId];
    }

    getActiveState() {
        return this.tabStates[this.activeTabId];
    }

    getTab(id) {
        return this.tabStates[id] || null;
    }

    updateActiveState(partialState) {
        if (!this.tabStates[this.activeTabId]) return;
        Object.assign(this.tabStates[this.activeTabId], partialState);
    }

    // Updates any tab (a query can finish while another tab is open); no-op for a tab that was closed
    updateTab(id, partialState) {
        if (!this.tabStates[id]) return false;
        Object.assign(this.tabStates[id], partialState);
        return true;
    }

    addTab(init = {}, afterId = null) {
        this._save();
        this.tabIdCounter++;
        const id = this.tabIdCounter;
        this.tabStates[id] = { ...this._createTabState(id), ...init };
        const at = afterId !== null ? this.order.indexOf(afterId) : -1;
        if (at >= 0) this.order.splice(at + 1, 0, id); else this.order.push(id);
        this.activateTab(id);
        this.render();
        return id;
    }

    duplicateTab(id) {
        const src = this.tabStates[id];
        if (!src) return null;
        if (id === this.activeTabId) this._save();
        const base = src.name.replace(/ copy( \d+)?$/, '').slice(0, MAX_TAB_NAME - 8);
        let name = `${base} copy`;
        for (let n = 2; Object.values(this.tabStates).some(t => t.name === name); n++) name = `${base} copy ${n}`;
        return this.addTab({ name, query: src.query || '', variables: src.variables || '' }, id);
    }

    activateTab(id) {
        this.activeTabId = id;
        if (this.callbacks.onTabLoad) {
            this.callbacks.onTabLoad(this.tabStates[id]);
        }
    }

    // Closes a tab; the last tab cannot be closed. Closing the open tab opens its right neighbour (else the left one).
    closeTab(id) {
        if (this.order.length < 2 || !this.tabStates[id]) return;
        const at = this.order.indexOf(id);
        this.order.splice(at, 1);
        delete this.tabStates[id];
        if (this.callbacks.onTabClose) this.callbacks.onTabClose(id);
        if (this.activeTabId === id) this.activateTab(this.order[Math.min(at, this.order.length - 1)]);
        this.render();
    }

    closeOthers(id) {
        if (!this.tabStates[id]) return;
        [...this.order].filter(t => t !== id).forEach(t => this.closeTab(t));
    }

    closeRightOf(id) {
        const at = this.order.indexOf(id);
        if (at < 0) return;
        this.order.slice(at + 1).forEach(t => this.closeTab(t));
    }

    // Moves tab `id` next to `targetId` (before it, or after it)
    moveTab(id, targetId, after = false) {
        if (id === targetId || !this.tabStates[id] || !this.tabStates[targetId]) return;
        this.order.splice(this.order.indexOf(id), 1);
        const at = this.order.indexOf(targetId);
        this.order.splice(after ? at + 1 : at, 0, id);
        this.render();
    }

    // Scrolls the tab strip just enough to show the open tab
    scrollActiveIntoView() {
        const el = this.scroller.querySelector('.tab.active');
        if (!el) return;
        const left = el.offsetLeft;
        const right = left + el.offsetWidth;
        const view = this.scroller;
        if (left < view.scrollLeft) view.scrollLeft = left - 8;
        else if (right > view.scrollLeft + view.clientWidth) view.scrollLeft = right - view.clientWidth + 8;
    }

    _tooltip(s) {
        const q = String(s.query || '').replace(/\s+/g, ' ').trim();
        const parts = [s.name];
        if (s.status === 'running') parts.push('running…');
        else if (s.status === 'error') parts.push(`failed: ${s.error || 'error'}`);
        else if (s.rowCount) parts.push(`${s.rowCount.toLocaleString('en-US')} rows`);
        if (q) parts.push(q.length > 120 ? q.slice(0, 117) + '…' : q);
        return parts.join(' · ');
    }

    render() {
        const hadFocus = this.scroller.contains(document.activeElement) ? document.activeElement.getAttribute('data-tab-id') : null;
        this.scroller.innerHTML = '';
        const ids = this.order;
        ids.forEach(id => {
            const s = this.tabStates[id];
            const tab = document.createElement('div');
            tab.className = 'tab' + (id === this.activeTabId ? ' active' : '') + (s.status ? ` ${s.status}` : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(id === this.activeTabId));
            // Roving tabindex: arrow keys move between tabs, Enter opens, Delete closes, F2 renames
            tab.tabIndex = id === this.activeTabId ? 0 : -1;
            tab.setAttribute('data-tab-id', String(id));
            tab.title = this._tooltip(s);
            tab.draggable = true;

            if (s.status === 'running' || s.status === 'error') {
                const dot = document.createElement('span');
                dot.className = `tab-status ${s.status}`;
                dot.setAttribute('role', 'img');
                dot.setAttribute('aria-label', s.status === 'running' ? 'Query running' : 'Last run failed');
                tab.appendChild(dot);
            }

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = s.name;
            tab.appendChild(label);

            if (s.rowCount && s.status !== 'running') {
                const count = document.createElement('span');
                count.className = 'tab-count';
                count.textContent = s.rowCount >= 10000 ? `${Math.round(s.rowCount / 1000)}k` : s.rowCount.toLocaleString('en-US');
                count.setAttribute('aria-label', `${s.rowCount} rows`);
                tab.appendChild(count);
            }

            if (ids.length > 1) {
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'close-tab';
                x.textContent = '✕';
                x.setAttribute('aria-label', `Close ${s.name}`);
                x.tabIndex = -1;
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
                inp.maxLength = MAX_TAB_NAME;
                inp.value = s.name;
                inp.setAttribute('aria-label', 'Tab name');
                tab.draggable = false; // so that selecting text in the field does not drag the tab
                label.replaceWith(inp);
                inp.focus();
                inp.select();

                let committed = false;
                const commit = () => {
                    if (committed) return;
                    committed = true;
                    s.name = inp.value.trim().slice(0, MAX_TAB_NAME) || s.name;
                    this.render();
                };
                inp.addEventListener('blur', commit);
                inp.addEventListener('click', (e) => e.stopPropagation());
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
                    this.scroller.querySelector(`[data-tab-id="${id}"]`)?.focus(); // render() replaced the element
                } else if (e.key === 'Delete') { e.preventDefault(); this.closeTab(id); }
                else if (e.key === 'F2') { e.preventDefault(); startRename(); }
                else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    e.preventDefault();
                    const r = tab.getBoundingClientRect();
                    this._openMenu(id, r.left, r.bottom, startRename);
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const at = ids.indexOf(id);
                    const target = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
                    if (e.altKey) { this.moveTab(id, target, e.key === 'ArrowRight'); this.scroller.querySelector(`[data-tab-id="${id}"]`)?.focus(); return; }
                    const el = this.scroller.querySelector(`[data-tab-id="${target}"]`);
                    if (el) { el.setAttribute('tabindex', '0'); el.focus(); }
                }
            });

            tab.addEventListener('click', () => {
                this._save();
                this.activateTab(id);
                this.render();
            });
            // Middle click closes
            tab.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
            tab.addEventListener('auxclick', (e) => {
                if (e.button === 1) { e.preventDefault(); this.closeTab(id); }
            });
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._openMenu(id, e.clientX, e.clientY, startRename);
            });

            // Drag to reorder
            tab.addEventListener('dragstart', (e) => {
                this._dragId = id;
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.name); }
                tab.classList.add('dragging');
            });
            tab.addEventListener('dragend', () => {
                this._dragId = null;
                this.scroller.querySelectorAll('.tab').forEach(t => t.classList.remove('dragging', 'drop-before', 'drop-after'));
            });
            tab.addEventListener('dragover', (e) => {
                if (this._dragId === null || this._dragId === undefined || this._dragId === id) return;
                e.preventDefault();
                const r = tab.getBoundingClientRect();
                const after = e.clientX > r.left + r.width / 2;
                tab.classList.toggle('drop-before', !after);
                tab.classList.toggle('drop-after', after);
            });
            tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
            tab.addEventListener('drop', (e) => {
                if (this._dragId === null || this._dragId === undefined) return;
                e.preventDefault();
                const r = tab.getBoundingClientRect();
                const moving = this._dragId;
                this._dragId = null;
                this.moveTab(moving, id, e.clientX > r.left + r.width / 2);
            });

            this.scroller.appendChild(tab);
        });
        if (hadFocus) this.scroller.querySelector(`[data-tab-id="${hadFocus}"]`)?.focus();
        this.scrollActiveIntoView();
        if (this.callbacks.onTabsChanged) this.callbacks.onTabsChanged();
    }

    // ---------- Context menu ----------

    _closeMenu() {
        if (!this.menu) return;
        this.menu.remove();
        this.menu = null;
        document.removeEventListener('mousedown', this._menuOutside, true);
        document.removeEventListener('keydown', this._menuKeys, true);
    }

    _openMenu(id, x, y, rename) {
        this._closeMenu();
        const at = this.order.indexOf(id);
        const items = [
            ['Rename', 'F2', () => rename(), false],
            ['Duplicate', '', () => this.duplicateTab(id), false],
            ['Close', 'Del', () => this.closeTab(id), this.order.length < 2],
            ['Close others', '', () => this.closeOthers(id), this.order.length < 2],
            ['Close tabs to the right', '', () => this.closeRightOf(id), at >= this.order.length - 1]
        ];
        const menu = document.createElement('div');
        menu.className = 'tab-menu';
        menu.setAttribute('role', 'menu');
        items.forEach(([label, key, action, disabled]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tab-menu-item';
            b.setAttribute('role', 'menuitem');
            b.disabled = disabled;
            const text = document.createElement('span');
            text.textContent = label;
            b.appendChild(text);
            if (key) { const k = document.createElement('kbd'); k.textContent = key; b.appendChild(k); }
            b.addEventListener('click', () => { this._closeMenu(); action(); });
            menu.appendChild(b);
        });
        document.body.appendChild(menu);
        const w = menu.offsetWidth || 200;
        const h = menu.offsetHeight || 160;
        menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
        this.menu = menu;
        this._menuOutside = (e) => { if (!menu.contains(e.target)) this._closeMenu(); };
        this._menuKeys = (e) => {
            const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
            const i = buttons.indexOf(document.activeElement);
            if (e.key === 'Escape') {
                e.preventDefault();
                this._closeMenu();
                this.scroller.querySelector(`[data-tab-id="${id}"]`)?.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
        };
        document.addEventListener('mousedown', this._menuOutside, true);
        document.addEventListener('keydown', this._menuKeys, true);
        menu.querySelector('button:not(:disabled)')?.focus();
    }
}
