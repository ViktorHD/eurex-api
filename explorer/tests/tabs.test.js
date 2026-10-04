/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { TabManager } from '../tabs.js';

const setup = () => {
    document.body.innerHTML = '<div id="bar"><button id="add">+</button></div>';
    const callbacks = {
        onTabSave: jest.fn((id, state) => { state.query = state.query || `q${id}`; }),
        onTabLoad: jest.fn(),
        onTabClose: jest.fn(),
        onTabsChanged: jest.fn()
    };
    const tm = new TabManager(document.getElementById('bar'), document.getElementById('add'), callbacks);
    tm.render();
    return { tm, callbacks, bar: document.getElementById('bar'), add: document.getElementById('add') };
};
const names = (bar) => [...bar.querySelectorAll('.tab .tab-label')].map(l => l.textContent);
const tabEl = (bar, id) => bar.querySelector(`[data-tab-id="${id}"]`);

describe('TabManager basics', () => {
    test('starts with one tab', () => {
        const { tm, bar } = setup();
        expect(tm.tabStates[1].name).toBe('Query 1');
        expect(tm.order).toEqual([1]);
        expect(names(bar)).toEqual(['Query 1']);
        expect(bar.querySelectorAll('.close-tab')).toHaveLength(0); // the only tab cannot be closed
    });

    test('the + button adds a tab next to the end and opens it', () => {
        const { tm, add, callbacks } = setup();
        add.click();
        expect(tm.order).toEqual([1, 2]);
        expect(tm.activeTabId).toBe(2);
        expect(callbacks.onTabLoad).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }));
        expect(callbacks.onTabSave).toHaveBeenCalledWith(1, expect.anything()); // the tab that was open is saved first
    });

    test('the tab bar keeps the + button outside the scrolling tab strip', () => {
        const { bar, add } = setup();
        expect(bar.querySelector('.tabs-scroll')).not.toBeNull();
        expect(add.parentElement).toBe(bar);
        expect(bar.querySelector('.tabs-scroll').nextElementSibling).toBe(add);
    });

    test('_createTabState returns the expected object', () => {
        const { tm } = setup();
        expect(tm._createTabState(3)).toEqual({ id: 3, name: 'Query 3', query: '', data: null, sortCol: null, sortAsc: true, columnFilters: {} });
    });

    test('updateTab changes any tab, and ignores tabs that were closed', () => {
        const { tm, add } = setup();
        add.click();
        expect(tm.updateTab(1, { rowCount: 5 })).toBe(true);
        expect(tm.getTab(1).rowCount).toBe(5);
        tm.closeTab(1);
        expect(tm.updateTab(1, { rowCount: 9 })).toBe(false);
    });
});

describe('closing tabs', () => {
    const three = () => { const s = setup(); s.add.click(); s.add.click(); return s; }; // order 1,2,3, tab 3 open

    test('closing the open tab opens its right neighbour, else the left one', () => {
        const { tm } = three();
        tm.activateTab(2);
        tm.closeTab(2);
        expect(tm.activeTabId).toBe(3);
        tm.closeTab(3);
        expect(tm.activeTabId).toBe(1);
        expect(tm.order).toEqual([1]);
    });

    test('closing another tab keeps the open one', () => {
        const { tm, callbacks } = three();
        tm.closeTab(1);
        expect(tm.activeTabId).toBe(3);
        expect(callbacks.onTabClose).toHaveBeenCalledWith(1);
    });

    test('close others and close to the right', () => {
        const { tm } = three();
        tm.closeRightOf(1);
        expect(tm.order).toEqual([1]);
        expect(tm.activeTabId).toBe(1);
        const again = three();
        again.tm.closeOthers(2);
        expect(again.tm.order).toEqual([2]);
        expect(again.tm.activeTabId).toBe(2);
    });

    test('the last tab cannot be closed', () => {
        const { tm } = setup();
        tm.closeTab(1);
        expect(tm.order).toEqual([1]);
    });

    test('middle click closes a tab', () => {
        const { tm, bar, add } = setup();
        add.click();
        tabEl(bar, 1).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
        expect(tm.order).toEqual([2]);
    });
});

describe('duplicating and ordering', () => {
    test('duplicate copies query and variables next to the source and opens the copy', () => {
        const { tm, add } = setup();
        tm.updateActiveState({ query: 'query { A }', variables: '{"a":1}', name: 'Contracts' });
        add.click();
        const copy = tm.duplicateTab(1);
        expect(tm.order).toEqual([1, copy, 2]);
        expect(tm.getTab(copy)).toMatchObject({ name: 'Contracts copy', query: 'query { A }', variables: '{"a":1}' });
        expect(tm.activeTabId).toBe(copy);
        expect(tm.duplicateTab(1)).not.toBeNull();
        expect(Object.values(tm.tabStates).map(t => t.name)).toContain('Contracts copy 2');
        expect(tm.duplicateTab(99)).toBeNull();
    });

    test('moveTab places a tab before or after another', () => {
        const { tm, add } = setup();
        add.click();
        add.click();
        tm.moveTab(3, 1);
        expect(tm.order).toEqual([3, 1, 2]);
        tm.moveTab(3, 2, true);
        expect(tm.order).toEqual([1, 2, 3]);
        tm.moveTab(1, 1);
        tm.moveTab(1, 99);
        expect(tm.order).toEqual([1, 2, 3]);
    });

    test('dragging a tab onto the right half of another moves it after it', () => {
        const { tm, bar, add } = setup();
        add.click();
        add.click();
        const target = tabEl(bar, 2);
        target.getBoundingClientRect = () => ({ left: 100, width: 100, right: 200, top: 0, bottom: 30 });
        tabEl(bar, 1).dispatchEvent(new Event('dragstart', { bubbles: true }));
        const over = new MouseEvent('dragover', { clientX: 180, bubbles: true, cancelable: true });
        target.dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        expect(target.classList.contains('drop-after')).toBe(true);
        target.dispatchEvent(new MouseEvent('drop', { clientX: 180, bubbles: true, cancelable: true }));
        expect(tm.order).toEqual([2, 1, 3]);
    });

    test('alt + arrow keys move the focused tab', () => {
        const { tm, bar, add } = setup();
        add.click();
        tabEl(bar, 1).focus();
        tabEl(bar, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
        expect(tm.order).toEqual([2, 1]);
        expect(document.activeElement.getAttribute('data-tab-id')).toBe('1');
    });

    test('snapshot and restore keep the order', () => {
        const { tm, add } = setup();
        add.click();
        tm.moveTab(2, 1);
        const snap = tm.snapshot();
        expect(snap.tabs.map(t => t.id)).toEqual([2, 1]);
        const other = setup().tm;
        other.restore(snap);
        expect(other.order).toEqual([2, 1]);
    });
});

describe('tab status', () => {
    test('a running tab shows a spinner, a failed one an error dot, a finished one its row count', () => {
        const { tm, bar, add } = setup();
        add.click();
        add.click();
        tm.updateTab(1, { status: 'running' });
        tm.updateTab(2, { status: 'error', error: 'Rate limit' });
        tm.updateTab(3, { status: 'ok', rowCount: 12345 });
        tm.render();
        expect(tabEl(bar, 1).querySelector('.tab-status.running')).not.toBeNull();
        expect(tabEl(bar, 1).querySelector('.tab-count')).toBeNull();
        expect(tabEl(bar, 2).querySelector('.tab-status.error')).not.toBeNull();
        expect(tabEl(bar, 2).title).toContain('failed: Rate limit');
        expect(tabEl(bar, 3).querySelector('.tab-count').textContent).toBe('12k');
        expect(tabEl(bar, 3).querySelector('.tab-status')).toBeNull();
    });

    test('small counts are shown in full', () => {
        const { tm, bar } = setup();
        tm.updateTab(1, { rowCount: 1234 });
        tm.render();
        expect(bar.querySelector('.tab-count').textContent).toBe('1,234');
    });
});

describe('context menu', () => {
    const open = (bar, id) => tabEl(bar, id).dispatchEvent(new MouseEvent('contextmenu', { clientX: 50, clientY: 40, bubbles: true, cancelable: true }));
    const items = () => [...document.querySelectorAll('.tab-menu-item')];

    test('lists the actions and disables those that do not apply', () => {
        const { bar, add } = setup();
        open(bar, 1);
        expect(items().map(i => i.querySelector('span').textContent)).toEqual(['Rename', 'Duplicate', 'Close', 'Close others', 'Close tabs to the right']);
        expect(items().filter(i => i.disabled).map(i => i.querySelector('span').textContent)).toEqual(['Close', 'Close others', 'Close tabs to the right']);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.tab-menu')).toBeNull();
        add.click();
        open(bar, 2);
        expect(items().filter(i => i.disabled).map(i => i.querySelector('span').textContent)).toEqual(['Close tabs to the right']);
    });

    test('Duplicate and Close run and close the menu', () => {
        const { tm, bar, add } = setup();
        add.click();
        open(bar, 1);
        items().find(i => i.textContent.startsWith('Duplicate')).click();
        expect(document.querySelector('.tab-menu')).toBeNull();
        expect(tm.order).toHaveLength(3);
        open(bar, 1);
        items().find(i => i.textContent.startsWith('Close others')).click();
        expect(tm.order).toEqual([1]);
    });

    test('Rename opens the name field', () => {
        const { bar, add } = setup();
        add.click();
        open(bar, 1);
        items()[0].click();
        expect(bar.querySelector('input.tab-rename-input')).not.toBeNull();
        expect(bar.querySelector('.tab[data-tab-id="1"]').draggable).toBe(false);
    });

    test('a click elsewhere closes the menu; arrow keys move through the items', () => {
        const { bar } = setup();
        open(bar, 1);
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(document.querySelector('.tab-menu')).toBeNull();
        open(bar, 1);
        const first = document.activeElement;
        expect(first.classList.contains('tab-menu-item')).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(document.activeElement).not.toBe(first);
    });

    test('the Menu key opens it from the keyboard', () => {
        const { bar } = setup();
        tabEl(bar, 1).focus();
        tabEl(bar, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
        expect(document.querySelector('.tab-menu')).not.toBeNull();
    });
});

describe('renaming', () => {
    test('double click renames, Enter commits, the name is limited', () => {
        const { tm, bar } = setup();
        bar.querySelector('.tab-label').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const input = bar.querySelector('input.tab-rename-input');
        input.value = 'x'.repeat(100);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(tm.getTab(1).name).toHaveLength(60);
    });

    test('Escape keeps the old name', () => {
        const { tm, bar } = setup();
        bar.querySelector('.tab-label').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const input = bar.querySelector('input.tab-rename-input');
        input.value = 'changed';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(tm.getTab(1).name).toBe('Query 1');
    });
});
