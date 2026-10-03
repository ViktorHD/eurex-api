/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';
import { DataTable, UIManager } from '../ui.js';
import { setDisplay } from '../displayformat.js';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const data = [
    { ISIN: 'DE0001', Strike: 1234.5, ExpirationDate: '2026-12-18', Note: 'a' },
    { ISIN: 'DE0002', Strike: 99, ExpirationDate: '2027-03-19', Note: 'b' }
];
const make = (rows = data, options = {}) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return { table: new DataTable(container, rows, { name: 'Contracts', ...options }), container };
};
const headerNames = (c) => [...c.querySelectorAll('thead tr:first-child th .th-sort span:first-child')].map(s => s.textContent);

afterEach(() => { document.body.innerHTML = ''; setDisplay({ numbers: 'auto', dates: 'iso' }, { setItem() {} }); });

describe('column chooser', () => {
    test('hidden columns leave the header, rows, copy and export columns', () => {
        const { table, container } = make(data, { hiddenCols: ['Note', 'ExpirationDate'] });
        expect(headerNames(container)).toEqual(['ISIN', 'Strike']);
        expect(container.querySelectorAll('tbody tr:first-child td')).toHaveLength(2);
        expect(table.columns).toEqual(['ISIN', 'Strike']);
        expect(table.exportState().hiddenCols).toEqual(['Note', 'ExpirationDate']);
        expect(container.querySelector('.dt-columns button span').textContent).toBe('Columns (2 hidden)');
    });

    test('the checklist hides and shows columns and keeps the menu open', () => {
        const { table, container } = make();
        const onState = jest.fn();
        table.onStateChange = onState;
        container.querySelector('.dt-columns > button').click();
        const menu = container.querySelector('.dt-columns-menu');
        expect(menu.classList.contains('hidden')).toBe(false);
        const boxes = () => [...menu.querySelectorAll('input[type=checkbox]')];
        expect(boxes()).toHaveLength(4);

        boxes()[3].click(); // Note
        expect(headerNames(container)).toEqual(['ISIN', 'Strike', 'ExpirationDate']);
        expect(menu.classList.contains('hidden')).toBe(false);
        expect(onState).toHaveBeenCalled();

        menu.querySelector('.dt-link').click(); // Show all
        expect(headerNames(container)).toHaveLength(4);
    });

    test('the last visible column cannot be hidden', () => {
        const { container } = make(data, { hiddenCols: ['Strike', 'ExpirationDate', 'Note'] });
        container.querySelector('.dt-columns > button').click();
        const boxes = [...container.querySelectorAll('.dt-columns-menu input[type=checkbox]')];
        expect(boxes.filter(b => b.checked).map(b => b.disabled)).toEqual([true]);
    });

    test('Escape closes the menu', () => {
        const { container } = make();
        container.querySelector('.dt-columns > button').click();
        const menu = container.querySelector('.dt-columns-menu');
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(menu.classList.contains('hidden')).toBe(true);
    });

    test('searching and sorting still work on hidden columns', () => {
        const { table } = make(data, { hiddenCols: ['Note'], searchText: 'b' });
        expect(table.getVisibleRows().map(r => r.ISIN)).toEqual(['DE0002']);
    });
});

describe('display settings in tables', () => {
    test('numbers and dates follow the display setting, raw values are untouched', () => {
        const { table, container } = make();
        const cell = (n) => container.querySelectorAll('tbody tr:first-child td')[n].textContent;
        setDisplay({ numbers: 'de', dates: 'dmy' }, { setItem() {} });
        table.render();
        expect(cell(1)).toBe('1.234,5');
        expect(cell(2)).toBe('18.12.2026');
        expect(table.getVisibleRows()[0].Strike).toBe(1234.5);
    });

    test('small values are not rounded', () => {
        setDisplay({ numbers: 'en' }, { setItem() {} });
        const { container } = make([{ Tick: 0.00005 }, { Tick: 1 }]);
        expect(container.querySelector('tbody td').textContent).toBe('0.00005');
    });

    test('UIManager.refreshDisplay redraws the tables', () => {
        const mk = () => document.createElement('div');
        const pane = mk();
        pane.className = 'results-pane';
        const resultsContainer = mk();
        pane.appendChild(resultsContainer);
        document.body.appendChild(pane);
        const ui = new UIManager({ resultsContainer, errorBox: mk(), loadingIndicator: mk(), emptyState: mk(), recordCounter: mk(), validityDate: mk(), downloadCsvBtn: document.createElement('button'), downloadMdBtn: document.createElement('button') });
        ui.renderTable(data, { name: 'Contracts' });
        setDisplay({ numbers: 'de' }, { setItem() {} });
        ui.refreshDisplay();
        expect(resultsContainer.querySelectorAll('tbody tr:first-child td')[1].textContent).toBe('1.234,5');
    });
});

describe('Excel export', () => {
    test('one sheet per table with the visible rows and columns', () => {
        const mk = () => document.createElement('div');
        const pane = mk();
        pane.className = 'results-pane';
        const resultsContainer = mk();
        pane.appendChild(resultsContainer);
        document.body.appendChild(pane);
        const ui = new UIManager({ resultsContainer, errorBox: mk(), loadingIndicator: mk(), emptyState: mk(), recordCounter: mk(), validityDate: mk(), downloadCsvBtn: document.createElement('button'), downloadMdBtn: document.createElement('button') });
        ui.renderTable(
            [{ name: 'Contracts', data, date: 'd' }, { name: 'Other', data: [{ X: 1 }], date: 'd' }],
            { isMultiTable: true, tables: [{ hiddenCols: ['Note'], searchText: 'DE0002' }, {}] }
        );
        const bytes = ui.exportXlsx();
        expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
        const text = new TextDecoder().decode(bytes);
        expect(text).toContain('name="Contracts"');
        expect(text).toContain('name="Other"');
        expect(text).toContain('DE0002');
        expect(text).not.toContain('DE0001'); // filtered out
        expect(text).not.toContain('>Note<'); // hidden column
    });
});
