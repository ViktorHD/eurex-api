import { TabManager } from '../tabs.js';
import { jest } from '@jest/globals';

describe('TabManager', () => {
    let tabsBarEl;
    let addTabBtnEl;
    let callbacks;

    beforeEach(() => {
        // Mock DOM elements manually since jsdom is not available
        tabsBarEl = {
            appendChild: jest.fn(),
            querySelectorAll: jest.fn().mockReturnValue([]),
            insertBefore: jest.fn(),
            querySelector: jest.fn()
        };
        addTabBtnEl = {
            addEventListener: jest.fn()
        };
        callbacks = {
            onTabSave: jest.fn(),
            onTabLoad: jest.fn()
        };

        // Mock document.createElement
        if (typeof global.document === 'undefined') {
            global.document = {
                createElement: jest.fn().mockImplementation((tagName) => ({
                    className: '',
                    textContent: '',
                    appendChild: jest.fn(),
                    addEventListener: jest.fn(),
                    querySelector: jest.fn(),
                    replaceWith: jest.fn(),
                    focus: jest.fn(),
                    select: jest.fn()
                }))
            };
        }
    });

    test('initializes with one tab', () => {
        const tabs = new TabManager(tabsBarEl, addTabBtnEl, callbacks);
        expect(tabs.tabStates[1]).toBeDefined();
        expect(tabs.tabStates[1].name).toBe('Query 1');
    });

    test('adding a tab creates a new tab state', () => {
        const tabs = new TabManager(tabsBarEl, addTabBtnEl, callbacks);

        // Get the click listener from addTabBtnEl
        const clickListener = addTabBtnEl.addEventListener.mock.calls.find(call => call[0] === 'click')[1];

        clickListener();

        expect(tabs.tabStates[2]).toBeDefined();
        expect(tabs.tabStates[2].name).toBe('Query 2');
        expect(tabs.activeTabId).toBe(2);
    });

    test('_createTabState returns correct object', () => {
        const tabs = new TabManager(tabsBarEl, addTabBtnEl, callbacks);
        const state = tabs._createTabState(3);
        expect(state).toEqual({
            id: 3,
            name: 'Query 3',
            query: '',
            data: null,
            sortCol: null,
            sortAsc: true,
            columnFilters: {}
        });
    });
});
