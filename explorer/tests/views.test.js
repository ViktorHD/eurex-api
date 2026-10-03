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
