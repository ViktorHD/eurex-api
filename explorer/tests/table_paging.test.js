/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { DataTable, UIManager } from '../ui.js';

const rows = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ ISIN: `ISIN${from + i}`, Strike: (from + i) * 5 }));
const make = (data, options = {}) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const table = new DataTable(container, data, { name: 'Contracts', ...options });
    return { table, container };
};
const bodyRows = (container) => container.querySelectorAll('tbody tr[data-index]');

afterEach(() => { document.body.innerHTML = ''; });

describe('progressive rendering', () => {
    test('draws the first rows only and offers more', () => {
        const { table, container } = make(rows(1000));
        expect(bodyRows(container)).toHaveLength(200);
        expect(container.querySelector('.dt-more-btn').textContent).toBe('Show 500 more rows');
        expect(container.querySelector('.dt-count').textContent).toBe('1,000 rows');
        expect(table.getVisibleRows()).toHaveLength(1000); // exports and copy cover every row
    });

    test('shows no extra row for small results', () => {
        const { container } = make(rows(50));
        expect(bodyRows(container)).toHaveLength(50);
        expect(container.querySelector('.dt-more')).toBeNull();
    });

    test('"Show more" draws the next step, "Show all" the rest', () => {
        const { container } = make(rows(2000));
        container.querySelector('.dt-more-btn').click();
        expect(bodyRows(container)).toHaveLength(700);
        container.querySelector('.dt-more-btn.secondary').click();
        expect(bodyRows(container)).toHaveLength(2000);
        expect(container.querySelector('.dt-more')).toBeNull();
    });

    test('search covers rows that are not drawn yet and resets the drawn count', () => {
        const { table, container } = make(rows(1000));
        container.querySelector('.dt-more-btn').click();
        const input = container.querySelector('.dt-search input');
        input.value = 'ISIN999';
        input.dispatchEvent(new Event('input'));
        expect(bodyRows(container)).toHaveLength(1);
        expect(table.renderLimit).toBe(200);
        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(bodyRows(container)).toHaveLength(200);
    });

    test('selecting a record beyond the drawn rows draws it', () => {
        const { table, container } = make(rows(1000));
        table.setSelected(450, true);
        const tr = container.querySelector('tr[data-index="450"]');
        expect(tr).not.toBeNull();
        expect(tr.classList.contains('dt-row-selected')).toBe(true);
    });

    test('sorting restarts from the top of the sorted list', () => {
        const { container } = make(rows(1000));
        const strikeHeader = [...container.querySelectorAll('.th-sort')].find(b => b.textContent.startsWith('Strike'));
        strikeHeader.click();
        strikeHeader.click(); // descending
        const first = container.querySelector('tbody tr[data-index]');
        expect(first.dataset.index).toBe('999');
        expect(bodyRows(container)).toHaveLength(200);
    });
});

describe('server-side paging', () => {
    const pager = (extra = {}) => ({ key: 'Contracts', query: 'q', variables: null, hasNextPage: true, endCursor: 'c1', ...extra });

    test('shows the pager only while more pages exist', () => {
        const withMore = make(rows(10), { pager: pager(), loadPage: async () => ({ rows: [], pageInfo: null }) });
        expect(withMore.container.querySelector('.dt-pager').classList.contains('hidden')).toBe(false);
        expect(withMore.container.querySelector('.dt-count').textContent).toBe('10 rows loaded');

        const done = make(rows(10), { pager: pager({ hasNextPage: false }), loadPage: async () => ({ rows: [], pageInfo: null }) });
        expect(done.container.querySelector('.dt-pager').classList.contains('hidden')).toBe(true);
        expect(done.container.querySelector('.dt-count').textContent).toBe('10 rows');

        const noLoader = make(rows(10), { pager: pager() });
        expect(noLoader.container.querySelector('.dt-pager').classList.contains('hidden')).toBe(true);
    });

    test('loads the next page, appends rows and updates the cursor without touching the original array', async () => {
        const original = rows(10);
        const loadPage = jest.fn(async () => ({ rows: rows(10, 10), pageInfo: { hasNextPage: false, endCursor: 'c2' } }));
        const onRowsAppended = jest.fn();
        const { table, container } = make(original, { pager: pager(), loadPage, onRowsAppended });

        await table.loadNextPage();

        expect(loadPage).toHaveBeenCalledWith(expect.objectContaining({ key: 'Contracts' }), 'c1');
        expect(table.data).toHaveLength(20);
        expect(original).toHaveLength(10); // may be shared with the response cache
        expect(bodyRows(container)).toHaveLength(20);
        expect(table.pager).toMatchObject({ hasNextPage: false, endCursor: 'c2' });
        expect(container.querySelector('.dt-pager').classList.contains('hidden')).toBe(true);
        expect(container.querySelector('.dt-count').textContent).toBe('20 rows');
        expect(onRowsAppended).toHaveBeenCalledTimes(1);
        expect(table.exportState().pager).toMatchObject({ endCursor: 'c2' });
    });

    test('keeps search and filters working across loaded pages', async () => {
        const loadPage = async () => ({ rows: rows(10, 10), pageInfo: { hasNextPage: false, endCursor: null } });
        const { table } = make(rows(10), { pager: pager(), loadPage, searchText: 'ISIN1' });
        await table.loadNextPage();
        // ISIN1, ISIN10..ISIN19
        expect(table.getVisibleRows()).toHaveLength(11);
    });

    test('shows an error and allows a retry', async () => {
        let fail = true;
        const loadPage = jest.fn(async () => {
            if (fail) throw new Error('Rate limit reached (HTTP 429).');
            return { rows: rows(5, 10), pageInfo: { hasNextPage: false, endCursor: null } };
        });
        const { table, container } = make(rows(10), { pager: pager(), loadPage });
        await table.loadNextPage();
        expect(container.querySelector('.dt-pager-error').textContent).toMatch(/Rate limit/);
        expect(table.data).toHaveLength(10);
        expect([...container.querySelectorAll('.dt-pager-btn')].map(b => b.textContent)).toContain('Try again');

        fail = false;
        await table.loadNextPage();
        expect(table.data).toHaveLength(15);
        expect(container.querySelector('.dt-pager-error')).toBeNull();
    });

    test('"load all" follows the cursors until the last page', async () => {
        const pages = [
            { rows: rows(5, 10), pageInfo: { hasNextPage: true, endCursor: 'c2' } },
            { rows: rows(5, 15), pageInfo: { hasNextPage: true, endCursor: 'c3' } },
            { rows: rows(2, 20), pageInfo: { hasNextPage: false, endCursor: 'c4' } }
        ];
        const loadPage = jest.fn(async () => pages.shift());
        const { table } = make(rows(10), { pager: pager(), loadPage });
        await table.loadNextPage(true);
        expect(loadPage.mock.calls.map(c => c[1])).toEqual(['c1', 'c2', 'c3']);
        expect(table.data).toHaveLength(22);
        expect(table.pager.hasNextPage).toBe(false);
    });

    test('stops when the server repeats a cursor or returns no rows', async () => {
        const loadPage = jest.fn(async () => ({ rows: rows(3, 10), pageInfo: { hasNextPage: true, endCursor: 'c1' } }));
        const { table } = make(rows(10), { pager: pager(), loadPage });
        await table.loadNextPage(true);
        expect(loadPage).toHaveBeenCalledTimes(1);
        expect(table.pager.hasNextPage).toBe(false);
    });

    test('sorted tables place new rows in sort order', async () => {
        const loadPage = async () => ({ rows: [{ ISIN: 'ISIN-X', Strike: -1 }], pageInfo: { hasNextPage: false, endCursor: null } });
        const { table, container } = make(rows(10), { pager: pager(), loadPage, sortCol: 'Strike', sortAsc: true });
        await table.loadNextPage();
        expect(container.querySelector('tbody tr[data-index]').dataset.index).toBe('10'); // the new row sorts first
    });
});

describe('UIManager integration', () => {
    const els = () => {
        const mk = () => document.createElement('div');
        const pane = mk();
        pane.className = 'results-pane';
        const resultsContainer = mk();
        pane.appendChild(resultsContainer);
        document.body.appendChild(pane);
        const downloadCsvBtn = document.createElement('button');
        const downloadMdBtn = document.createElement('button');
        return {
            resultsContainer, errorBox: mk(), loadingIndicator: mk(), emptyState: mk(),
            recordCounter: mk(), validityDate: mk(), downloadCsvBtn, downloadMdBtn
        };
    };

    test('passes pagers to the tables and keeps currentData in step after loading more', async () => {
        const e = els();
        const onStateChange = jest.fn();
        const loadPage = jest.fn(async () => ({ rows: rows(5, 10), pageInfo: { hasNextPage: false, endCursor: null } }));
        const ui = new UIManager({ ...e, loadPage, onStateChange });
        const data = rows(10);
        ui.renderTable(data, { date: '2026-10-02', name: 'Contracts', pagers: [{ key: 'Contracts', query: 'q', variables: null, hasNextPage: true, endCursor: 'c1' }] });

        await ui.tables[0].loadNextPage();

        expect(loadPage).toHaveBeenCalledWith(expect.objectContaining({ key: 'Contracts', cursor: 'c1' }));
        expect(ui.currentData).toHaveLength(15);
        expect(data).toHaveLength(10);
        expect(e.recordCounter.textContent).toBe('15 records');
        expect(onStateChange).toHaveBeenCalled();
        expect(ui.exportState().tables[0].pager.hasNextPage).toBe(false);
    });

    test('restores a saved pager from the tab state', () => {
        const e = els();
        const ui = new UIManager({ ...e, loadPage: async () => ({ rows: [], pageInfo: null }) });
        ui.renderTable(rows(10), { tables: [{ pager: { key: 'Contracts', query: 'q', variables: null, hasNextPage: true, endCursor: 'c7' }, sortCol: null }] });
        expect(ui.tables[0].pager.endCursor).toBe('c7');
    });

    test('multi-table results keep each table\'s extra rows', async () => {
        const e = els();
        const ui = new UIManager({ ...e, loadPage: async () => ({ rows: rows(2, 10), pageInfo: { hasNextPage: false, endCursor: null } }) });
        ui.renderTable(
            [{ name: 'A', data: rows(10), date: 'd' }, { name: 'B', data: rows(3), date: 'd' }],
            { isMultiTable: true, pagers: [{ key: 'A', query: 'q', variables: null, hasNextPage: true, endCursor: 'c1' }, null] }
        );
        await ui.tables[0].loadNextPage();
        expect(ui.currentData.map(t => [t.name, t.data.length])).toEqual([['A', 12], ['B', 3]]);
    });

    test('setWarnings shows and clears a notice above the tables', () => {
        const e = els();
        const ui = new UIManager({ ...e });
        ui.renderTable(rows(3), { name: 'Contracts' });
        ui.setWarnings(['Changelog: upstream timeout']);
        expect(e.resultsContainer.querySelector('.dt-warning li').textContent).toBe('Changelog: upstream timeout');
        ui.setWarnings([]);
        expect(e.resultsContainer.querySelector('.dt-warning')).toBeNull();
    });

    test('showLoading can carry a retry note and clears it on the next call', () => {
        const e = els();
        const ui = new UIManager({ ...e });
        ui.showLoading('Rate limit reached, retrying in 2 s (attempt 2)…');
        expect(e.loadingIndicator.querySelector('.loading-note').textContent).toMatch(/retrying in 2 s/);
        ui.showLoading();
        expect(e.loadingIndicator.querySelector('.loading-note')).toBeNull();
    });
});
