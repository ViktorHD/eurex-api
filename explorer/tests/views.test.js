/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { TextEncoder } from 'util';
import { CalendarView } from '../calendarview.js';
import { ProductsView } from '../productsview.js';
import { resetWatchlistCache, getWatchlist, setWatchlist } from '../watchlist.js';
import { resetProductCatalog } from '../catalog.js';
import { cetDate } from '../tradingstatus.js';
import { rangeEnd } from '../calendar.js';

global.TextEncoder = TextEncoder;
const wait = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = '<div id="c"></div>'; localStorage.clear(); resetWatchlistCache(); resetProductCatalog(); });

const CATALOG = [
    { ProductID: 1, Product: 'FESX', Name: 'Euro STOXX 50 Futures', ProductISIN: 'DE1', ProductType: 'INDEX FUTURES', Currency: 'EUR' },
    { ProductID: 2, Product: 'OESX', Name: 'Euro STOXX 50 Options', ProductISIN: 'DE2', ProductType: 'INDEX OPTIONS', Currency: 'EUR' },
    { ProductID: 3, Product: 'FDAX', Name: 'DAX Futures', ProductISIN: 'DE3', ProductType: 'INDEX FUTURES', Currency: 'EUR' }
];

describe('ProductsView', () => {
    const make = () => {
        const client = { request: jest.fn(async () => ({ data: CATALOG, date: 'd' })), endpoint: 'e', apiKey: 'k' };
        const onOpenProduct = jest.fn();
        const view = new ProductsView(client, { content: document.getElementById('c') }, { onOpenProduct, getSchema: async () => null });
        return { view, client, onOpenProduct, box: document.getElementById('c') };
    };
    const codes = (box) => [...box.querySelectorAll('.ps-table tbody tr td:nth-child(2)')].map(td => td.textContent);

    test('lists the catalog and filters while typing', async () => {
        const { view, box } = make();
        await view.show();
        expect(codes(box)).toEqual(['FDAX', 'FESX', 'OESX']);
        const input = box.querySelector('.ps-search input');
        input.value = 'stoxx options';
        input.dispatchEvent(new Event('input'));
        expect(codes(box)).toEqual(['OESX']);
        expect(box.querySelector('.ps-status').textContent).toBe('1 product');
        input.value = 'nothing here';
        input.dispatchEvent(new Event('input'));
        expect(box.querySelector('.pc-empty').textContent).toContain('No product matches');
    });

    test('type filter', async () => {
        const { view, box } = make();
        await view.show();
        const sel = box.querySelector('select');
        expect([...sel.options].map(o => o.value)).toEqual(['', 'INDEX FUTURES', 'INDEX OPTIONS']);
        sel.value = 'INDEX FUTURES';
        sel.dispatchEvent(new Event('change'));
        expect(codes(box)).toEqual(['FDAX', 'FESX']);
    });

    test('Enter opens the best match, the Card button opens a product', async () => {
        const { view, box, onOpenProduct } = make();
        await view.show();
        const input = box.querySelector('.ps-search input');
        input.value = 'fesx';
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(onOpenProduct).toHaveBeenCalledWith('FESX');
    });

    test('stars follow and unfollow, the following bar and the followed-only filter react', async () => {
        const { view, box } = make();
        await view.show();
        box.querySelector('.ps-table tbody tr:first-child .watch-star').click(); // FDAX
        expect(getWatchlist()).toEqual(['FDAX']);
        expect(box.querySelector('.ps-following').textContent).toContain('FDAX');
        const only = box.querySelector('.cal-toggle input');
        only.checked = true;
        only.dispatchEvent(new Event('change'));
        expect(codes(box)).toEqual(['FDAX']);
        box.querySelector('.ps-following .cal-product-remove').click();
        expect(getWatchlist()).toEqual([]);
        expect(box.querySelector('.ps-results').textContent).toContain('No products');
    });

    test('a failing catalog request can be retried', async () => {
        const { view, client, box } = make();
        client.request.mockRejectedValueOnce(new Error('Rate limit reached'));
        await view.show();
        expect(box.textContent).toContain('Rate limit reached');
        await box.querySelector('.pc-btn').click();
        await wait();
        await wait();
        expect(codes(box)).toHaveLength(3);
    });
});

describe('CalendarView', () => {
    const from = cetDate();
    const to = rangeEnd(from, 6);
    const inside = (n) => new Date(Date.parse(from) + n * 86400000).toISOString().slice(0, 10);
    const make = (response) => {
        const client = { request: jest.fn(async (q) => (typeof response === 'function' ? response(q) : response)), endpoint: 'e', apiKey: 'k' };
        const onOpenProduct = jest.fn();
        const view = new CalendarView(client, { content: document.getElementById('c') }, { onOpenProduct });
        return { view, client, onOpenProduct, box: document.getElementById('c') };
    };

    test('asks to follow products when the watchlist is empty', async () => {
        const { view, box, client } = make({});
        view.show();
        await wait();
        expect(box.textContent).toContain('Follow products to see their calendar');
        expect(client.request.mock.calls.some(c => String(c[0]).includes('Expirations('))).toBe(false); // only the product list for the datalist
    });

    test('shows expirations and holidays of followed products grouped by month', async () => {
        setWatchlist(['FESX', 'FDAX']);
        const d1 = inside(10);
        const d2 = inside(40);
        const { view, box, client, onOpenProduct } = make({
            e0: { data: [{ ExpirationIndex: 1, ExpirationDate: d1 }, { ExpirationIndex: 2, ExpirationDate: '2001-01-01' }] },
            h0: { data: [{ Holiday: d2 }] }, e1: { data: [{ ExpirationIndex: 7, ExpirationDate: d1 }] }, h1: { data: [{ Holiday: d2 }] }
        });
        view.show();
        await wait();
        await wait();
        expect(client.request.mock.calls[0][0]).toContain('e1: Expirations(filter: { Product: { eq: "FDAX" } })');
        const rows = [...box.querySelectorAll('.cal-row')].map(r => [r.classList.contains('exp') ? 'exp' : 'hol', ...[...r.querySelectorAll('.cal-chip')].map(c => c.textContent)]);
        expect(rows).toEqual([['exp', 'FDAX', 'FESX'], ['hol', 'FDAX', 'FESX']]);
        box.querySelector('.cal-chip').click();
        expect(onOpenProduct).toHaveBeenCalledWith('FDAX');
        expect(box.querySelector('.cal-ics').disabled).toBe(false);
        expect(to > from).toBe(true);
    });

    test('the kind toggles and range hide events', async () => {
        setWatchlist(['FESX']);
        const { view, box } = make({ e0: { data: [{ ExpirationIndex: 1, ExpirationDate: inside(10) }] }, h0: { data: [{ Holiday: inside(12) }] } });
        view.show();
        await wait();
        await wait();
        expect(box.querySelectorAll('.cal-row')).toHaveLength(2);
        const [exp] = box.querySelectorAll('.cal-toggle input');
        exp.checked = false;
        exp.dispatchEvent(new Event('change'));
        expect([...box.querySelectorAll('.cal-row')].map(r => r.className)).toEqual(['cal-row hol']);
    });

    test('adding and removing products reloads', async () => {
        setWatchlist(['FESX']);
        const { view, box, client } = make({ e0: { data: [] }, h0: { data: [] } });
        view.show();
        await wait();
        await wait();
        const input = box.querySelector('.cal-add input');
        input.value = 'fdax';
        box.querySelector('.cal-add').dispatchEvent(new Event('submit', { cancelable: true }));
        expect(getWatchlist()).toEqual(['FESX', 'FDAX']);
        await wait();
        await wait();
        expect(client.request.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(client.request.mock.calls.at(-1)[0]).toContain('"FDAX"');
    });

    test('invalid codes are refused with a message', async () => {
        setWatchlist(['FESX']);
        const { view, box } = make({ e0: { data: [] }, h0: { data: [] } });
        view.show();
        await wait();
        await wait();
        const input = box.querySelector('.cal-add input');
        input.value = 'bad code';
        box.querySelector('.cal-add').dispatchEvent(new Event('submit', { cancelable: true }));
        expect(box.querySelector('.cal-add-error').textContent).toBe('Not a valid product code.');
        expect(getWatchlist()).toEqual(['FESX']);
    });
});

describe('CalendarView month grid', () => {
    const month = cetDate().slice(0, 7);
    // Four followed products expire on the 15th; two of them also have a holiday on the 20th
    const response = {
        e0: { data: [{ ExpirationIndex: 1, ExpirationDate: `${month}-15` }] }, h0: { data: [{ Holiday: `${month}-20` }] },
        e1: { data: [{ ExpirationIndex: 2, ExpirationDate: `${month}-15` }] }, h1: { data: [{ Holiday: `${month}-20` }] },
        e2: { data: [{ ExpirationIndex: 3, ExpirationDate: `${month}-15` }] }, h2: { data: [] },
        e3: { data: [{ ExpirationIndex: 4, ExpirationDate: `${month}-15` }] }, h3: { data: [] }
    };
    const make = async (mode = 'month') => {
        localStorage.setItem('eurexExplorer.calendarMode', mode);
        setWatchlist(['FESX', 'FDAX', 'OESX', 'SAPG']);
        const client = { request: jest.fn(async () => response), endpoint: 'e', apiKey: 'k' };
        const onOpenProduct = jest.fn();
        const view = new CalendarView(client, { content: document.getElementById('c') }, { onOpenProduct });
        view.show();
        await wait();
        await wait();
        return { view, box: document.getElementById('c'), onOpenProduct };
    };
    const cell = (box, day) => [...box.querySelectorAll('.cal-cell:not(.out)')].find(td => td.querySelector('.cal-daynum').textContent === String(day));

    test('the layout toggle switches between agenda and month grid and is remembered', async () => {
        const { box } = await make('agenda');
        expect(box.querySelector('.cal-table')).toBeNull();
        expect(box.querySelectorAll('.cal-mode')).toHaveLength(2);
        box.querySelectorAll('.cal-mode')[1].click();
        expect(box.querySelector('.cal-table')).not.toBeNull();
        expect(box.querySelectorAll('.cal-mode')[1].getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem('eurexExplorer.calendarMode')).toBe('month');
        box.querySelectorAll('.cal-mode')[0].click();
        expect(box.querySelector('.cal-table')).toBeNull();
        expect(box.querySelector('.cal-days')).not.toBeNull();
    });

    test('draws the month with weekday headers and puts events on their day', async () => {
        const { box } = await make();
        expect([...box.querySelectorAll('.cal-table th')].map(th => th.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(box.querySelectorAll('.cal-table tbody tr').length).toBeGreaterThanOrEqual(4);
        const c15 = cell(box, 15);
        expect(c15.classList.contains('has-events')).toBe(true);
        // four expirations: three tags and "+1"
        expect(c15.querySelectorAll('.cal-tag')).toHaveLength(3);
        expect(c15.querySelector('.cal-more').textContent).toBe('+1');
        expect(c15.querySelector('.cal-dot.exp').textContent).toBe('4');
        const c20 = cell(box, 20);
        expect([...c20.querySelectorAll('.cal-tag')].map(t => [t.textContent, t.classList.contains('hol')])).toEqual([['FDAX', true], ['FESX', true]]); // alphabetical within a day
        expect(cell(box, 10).classList.contains('has-events')).toBe(false);
    });

    test('a day button announces its events', async () => {
        const { box } = await make();
        expect(cell(box, 15).querySelector('.cal-daynum').getAttribute('aria-label')).toMatch(/^15 \w+ \d{4}, 4 expirations$/);
        expect(cell(box, 20).querySelector('.cal-daynum').getAttribute('aria-label')).toMatch(/2 holidays$/);
    });

    test('selecting a day lists all its events, a tag opens the product', async () => {
        const { box, onOpenProduct } = await make();
        cell(box, 15).click();
        const detail = box.querySelector('.cal-detail');
        expect(detail.querySelectorAll('.cal-chip')).toHaveLength(4);
        expect(cell(box, 15).classList.contains('selected')).toBe(true);
        cell(box, 15).click(); // selecting again clears it
        expect(box.querySelector('.cal-detail')).toBeNull();
        cell(box, 20).querySelector('.cal-tag').click();
        expect(onOpenProduct).toHaveBeenCalledWith('FDAX');
        expect(box.querySelector('.cal-detail')).toBeNull(); // a tag click does not also select the day
    });

    test('an empty day can be selected', async () => {
        const { box } = await make();
        cell(box, 10).click();
        expect(box.querySelector('.cal-detail').textContent).toContain('No expirations or holidays');
    });

    test('navigates months and returns to today', async () => {
        const { box } = await make();
        const title = () => box.querySelector('.cal-nav-title').textContent;
        const start = title();
        box.querySelector('.cal-nav-btn[aria-label="Next month"]').click();
        expect(title()).not.toBe(start);
        expect(box.querySelectorAll('.cal-tag')).toHaveLength(0); // events are in the starting month only
        expect(box.textContent).toContain('Nothing in this month');
        box.querySelector('.cal-nav-btn[aria-label="Previous month"]').click();
        expect(title()).toBe(start);
        box.querySelector('.cal-nav-btn[aria-label="Next month"]').click();
        [...box.querySelectorAll('.cal-nav .pc-btn')].find(b => b.textContent === 'Today').click();
        expect(title()).toBe(start);
        expect(box.querySelector('.cal-cell.today')).not.toBeNull();
        expect(box.querySelector('.cal-cell.selected')).not.toBeNull();
    });

    test('the kind toggles apply to the grid and the export follows the month shown', async () => {
        const { box } = await make();
        expect(box.querySelector('.cal-ics').disabled).toBe(false);
        const [exp] = box.querySelectorAll('.cal-toggle input');
        exp.checked = false;
        exp.dispatchEvent(new Event('change'));
        expect(cell(box, 15).classList.contains('has-events')).toBe(false);
        expect(cell(box, 20).classList.contains('has-events')).toBe(true);
        box.querySelector('.cal-nav-btn[aria-label="Next month"]').click();
        expect(box.querySelector('.cal-ics').disabled).toBe(true);
    });

    test('the time range select belongs to the agenda only', async () => {
        const { box } = await make();
        expect(box.querySelector('.cal-options select').hidden).toBe(true);
        box.querySelectorAll('.cal-mode')[0].click();
        expect(box.querySelector('.cal-options select').hidden).toBe(false);
    });
});
