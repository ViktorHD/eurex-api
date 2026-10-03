/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { TabManager } from '../tabs.js';

const setup = () => {
    document.body.innerHTML = '<div id="bar"><button id="add">+</button></div>';
    const callbacks = { onTabSave: jest.fn((id, state) => { state.query = `saved-${id}`; }), onTabLoad: jest.fn() };
    const tm = new TabManager(document.getElementById('bar'), document.getElementById('add'), callbacks);
    return { tm, callbacks, bar: document.getElementById('bar') };
};
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('tab accessibility', () => {
    test('tabs expose roles, selection and a roving tabindex', () => {
        const { tm, bar } = setup();
        document.getElementById('add').click();
        tm.render();
        expect(bar.getAttribute('role')).toBe('tablist');
        const tabs = bar.querySelectorAll('[role="tab"]');
        expect(tabs).toHaveLength(2);
        expect([...tabs].map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        expect([...tabs].map(t => t.tabIndex)).toEqual([-1, 0]);
    });

    test('arrow keys move focus, Enter opens the tab', () => {
        const { tm, bar, callbacks } = setup();
        document.getElementById('add').click();
        tm.render();
        const [first, second] = bar.querySelectorAll('[role="tab"]');
        second.focus();
        key(second, 'ArrowLeft');
        expect(document.activeElement).toBe(first);
        key(first, 'Enter');
        expect(tm.activeTabId).toBe(1);
        expect(callbacks.onTabLoad).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }));
        expect(document.activeElement.getAttribute('data-tab-id')).toBe('1');
    });

    test('Delete closes a tab through its keyboard, the close control is a labelled button', () => {
        const { tm, bar } = setup();
        document.getElementById('add').click();
        tm.render();
        const close = bar.querySelector('button.close-tab');
        expect(close.getAttribute('aria-label')).toMatch(/^Close /);
        const tab = bar.querySelector('[data-tab-id="2"]');
        key(tab, 'Delete');
        expect(Object.keys(tm.tabStates)).toEqual(['1']);
        expect(bar.querySelectorAll('.close-tab')).toHaveLength(0); // the last tab cannot be closed
    });

    test('F2 starts renaming', () => {
        const { tm, bar } = setup();
        tm.render();
        key(bar.querySelector('[role="tab"]'), 'F2');
        expect(bar.querySelector('input.tab-rename-input')).not.toBeNull();
    });
});

describe('tab persistence', () => {
    test('snapshot keeps names, queries and variables but not results', () => {
        const { tm } = setup();
        tm.updateActiveState({ name: 'Contracts', query: 'q1', variables: '{"a":1}', data: [{ x: 1 }] });
        document.getElementById('add').click();
        const snap = tm.snapshot();
        expect(snap.activeTabId).toBe(2);
        expect(snap.tabs[0]).toEqual({ id: 1, name: 'Contracts', query: 'saved-1', variables: '{"a":1}' });
        expect(JSON.stringify(snap)).not.toContain('"x":1');
    });

    test('restore rebuilds the tabs and returns the active one', () => {
        const { tm } = setup();
        const active = tm.restore({ activeTabId: 5, tabs: [{ id: 3, name: 'A', query: 'qa', variables: '' }, { id: 5, name: 'B', query: 'qb', variables: '{}' }] });
        expect(active).toMatchObject({ id: 5, name: 'B', query: 'qb' });
        expect(tm.tabIdCounter).toBe(5);
        document.getElementById('add').click();
        expect(tm.activeTabId).toBe(6); // new ids continue after the restored ones
    });

    test('restore ignores unusable snapshots', () => {
        const { tm } = setup();
        expect(tm.restore(null)).toBeNull();
        expect(tm.restore({ tabs: [] })).toBeNull();
        expect(tm.restore({ tabs: [{ id: 'x' }] })).toBeNull();
        expect(Object.keys(tm.tabStates)).toEqual(['1']);
    });

    test('an unknown active id falls back to the first tab', () => {
        const { tm } = setup();
        expect(tm.restore({ activeTabId: 99, tabs: [{ id: 2, name: 'A', query: '' }] }).id).toBe(2);
    });
});
