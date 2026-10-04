/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { ProductCard } from '../productcard.js';
import { resetWatchlistCache, getWatchlist } from '../watchlist.js';

const wait = () => new Promise(r => setTimeout(r, 0));

const DATA = {
    ProductInfos: { date: '2026-10-02', data: [{ ProductID: 1, Product: 'FESX', Name: 'Euro STOXX 50 Index Futures', ProductType: 'INDEX FUTURES', Currency: 'EUR', ProductISIN: 'DE000F1ESX0', TickSize: 1, ProductTypeCode: 'F', Underlying: null }] },
    TradingHours: { data: [{ StartContinuousTrading: '01:10:00', EndContinuousTrading: '22:00:00', EndOpeningAuction: null, EndClosingAuction: null, StartTES: '07:30:00', EndTES: '22:30:00', LTDBook: '12:00:00', LTDTES: '12:30:00' }] },
    Holidays: { data: [{ Holiday: '2099-12-24' }, { Holiday: '2020-01-01' }] },
    TickRules: { date: '2026-10-02', data: [
        { TradeType: 'ORDERBOOK', InstrumentType: 'SIMPLE', StartPrice: 0, EndPrice: 10, PriceStep: 0.5 },
        { TradeType: 'ORDERBOOK', InstrumentType: 'SIMPLE', StartPrice: 10, EndPrice: null, PriceStep: 1 },
        { TradeType: 'TES', InstrumentType: 'SIMPLE', StartPrice: 0, EndPrice: null, PriceStep: 0.01 }
    ] },
    TESProfiles: { data: [
        { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 100, NonDisclosureLimit: 1000, MinExpiryRange: 1, AllowBroker: true },
        { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 50, NonDisclosureLimit: 500, MinExpiryRange: 3 }
    ] },
    Expirations: { data: [
        { ExpirationIndex: 1, ExpirationDate: '2099-03-19', MasterContract: 'M1' },
        { ExpirationIndex: 2, ExpirationDate: '2099-06-18', MasterContract: 'M2' },
        { ExpirationIndex: 3, ExpirationDate: '2099-09-17', MasterContract: 'M3' },
        { ExpirationIndex: 0, ExpirationDate: '2001-03-16', MasterContract: 'OLD' }
    ] }
};

const make = (response = DATA) => {
    document.body.innerHTML = '<div id="c"></div>';
    const client = { request: jest.fn(async () => response) };
    const options = { onRunQuery: jest.fn(), onShare: jest.fn(), onOpenStrikeWindow: jest.fn() };
    const card = new ProductCard(client, { content: document.getElementById('c') }, options);
    return { card, client, options, box: document.getElementById('c') };
};
const titles = (box) => [...box.querySelectorAll('.pc-card h3')].map(h => h.textContent);

beforeEach(() => { resetWatchlistCache(); localStorage.clear(); });

describe('ProductCard', () => {
    test('requests the product queries and renders every section', async () => {
        const { card, client, box } = make();
        await card.open('fesx');
        const query = client.request.mock.calls[0][0];
        expect(query).toContain('ProductInfos(filter: { Product: { eq: "FESX" } })');
        expect(box.querySelector('.pc-title h2').textContent).toBe('FESX');
        expect(box.querySelector('.pc-name').textContent).toBe('Euro STOXX 50 Index Futures');
        expect(titles(box)).toEqual(['Product data', 'Trading hours', 'Tick rules', 'TES (block trades)', 'Expirations and holidays', 'Settlement prices']);
    });

    test('product data skips empty values and splits camel case labels', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const labels = [...box.querySelectorAll('.pc-card:first-child dt')].map(d => d.textContent);
        expect(labels).toContain('Product ISIN');
        expect(labels).toContain('Tick Size');
        expect(labels).not.toContain('Underlying');
    });

    test('trading hours show phases in CET and a status', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const hours = [...box.querySelectorAll('.pc-card')].find(c => c.querySelector('h3').textContent === 'Trading hours');
        const rows = [...hours.querySelectorAll('tbody tr')].map(tr => [tr.querySelector('th').textContent, tr.querySelector('td').textContent]);
        expect(rows).toContainEqual(['Continuous trading', '01:10 – 22:00']);
        expect(rows).toContainEqual(['TES (off-book)', '07:30 – 22:30']);
        expect(rows).toContainEqual(['Last trading day: order book closes', '12:00']);
        expect(hours.querySelector('.pc-status')).not.toBeNull();
        expect(hours.textContent).toContain('Next holiday 2099-12-24');
    });

    test('tick rules: order book by default, other trade types, BLOCK falls back, price checker', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const card3 = [...box.querySelectorAll('.pc-card')].find(c => c.querySelector('h3').textContent === 'Tick rules');
        expect([...card3.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent))).toEqual([['0', '10', '0.5'], ['10', 'and above', '1']]);
        const input = card3.querySelector('input');
        const out = card3.querySelector('output');
        input.value = '5.25';
        input.dispatchEvent(new Event('input'));
        expect(out.textContent).toBe('Not on the tick grid (tick size 0.5). Nearest valid prices: 5 and 5.5.');
        expect(out.classList.contains('bad')).toBe(true);
        input.value = '5,5';
        input.dispatchEvent(new Event('input'));
        expect(out.textContent).toBe('Valid: tick size 0.5.');
        input.value = 'abc';
        input.dispatchEvent(new Event('input'));
        expect(out.textContent).toBe('Enter a number.');
        // other trade types have their own bands
        const trade = card3.querySelector('select');
        expect([...trade.options].map(o => o.value)).toEqual(['ORDERBOOK', 'BLOCK', 'TES']);
        trade.value = 'TES';
        trade.dispatchEvent(new Event('change'));
        expect([...card3.querySelectorAll('tbody tr')].map(tr => tr.lastChild.textContent)).toEqual(['0.01']);
        expect(card3.querySelector('.pc-note')).toBeNull();
        // BLOCK has no rules of its own: the order book rules apply, and the card says so
        trade.value = 'BLOCK';
        trade.dispatchEvent(new Event('change'));
        expect(card3.querySelector('.pc-note').textContent).toBe('No tick rules for BLOCK · SIMPLE: the ORDERBOOK · SIMPLE tick rules apply.');
        expect([...card3.querySelectorAll('tbody tr')].map(tr => tr.lastChild.textContent)).toEqual(['0.5', '1']);
        card3.querySelector('input').value = '5.25';
        card3.querySelector('input').dispatchEvent(new Event('input'));
        expect(card3.querySelector('output').textContent).toContain('Nearest valid prices: 5 and 5.5');
    });

    test('TES: tiers and the threshold allocated to each expiration', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const tes = [...box.querySelectorAll('.pc-card')].find(c => c.querySelector('h3').textContent === 'TES (block trades)');
        const tables = tes.querySelectorAll('table');
        expect([...tables[0].querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent))).toEqual([['1 – 2', '100', '–', '1,000'], ['3 and later', '50', '–', '500']]);
        const perExp = [...tables[1].querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent));
        expect(perExp[0].slice(0, 4)).toEqual(['0', '2001-03-16', 'OLD', '100']); // below every tier: first tier
        expect(perExp.find(r => r[0] === '3')[3]).toBe('50');
        expect(tes.querySelector('dl').textContent).toContain('Broker allowed');
    });

    test('lists upcoming expirations and holidays only', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const cal = [...box.querySelectorAll('.pc-card')].find(c => c.querySelector('h3').textContent === 'Expirations and holidays');
        const text = cal.textContent;
        expect(text).toContain('2099-03-19');
        expect(text).not.toContain('2001-03-16');
        expect(text).not.toContain('2020-01-01');
        expect(text).toContain('2099-12-24');
        expect(cal.querySelector('button').textContent).toContain('Add to calendar');
    });

    test('follow button toggles the watchlist', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const star = box.querySelector('.pc-star');
        expect(star.textContent).toBe('☆ Follow');
        star.click();
        expect(getWatchlist()).toEqual(['FESX']);
        expect(star.textContent).toBe('★ Following');
        star.click();
        expect(getWatchlist()).toEqual([]);
    });

    test('header actions call back', async () => {
        const { card, box, options } = make({ ...DATA, ProductInfos: { data: [{ Product: 'OESX', ProductTypeCode: 'O', Name: 'x' }] } });
        await card.open('OESX');
        const buttons = [...box.querySelectorAll('.pc-actions button')];
        const click = (label) => buttons.find(b => b.textContent.includes(label)).click();
        click('Run in Explorer');
        expect(options.onRunQuery).toHaveBeenCalledWith(expect.stringContaining('OESX'));
        click('Share');
        expect(options.onShare).toHaveBeenCalledWith('OESX');
        click('Strike Window');
        expect(options.onOpenStrikeWindow).toHaveBeenCalledWith('OESX');
    });

    test('Strike Window is only offered for options', async () => {
        const { card, box } = make();
        await card.open('FESX');
        expect([...box.querySelectorAll('.pc-actions button')].some(b => b.textContent.includes('Strike Window'))).toBe(false);
    });

    test('an unknown product and a failing request are explained', async () => {
        const unknown = make({ ...DATA, ProductInfos: { data: [] } });
        await unknown.card.open('NOPE');
        expect(unknown.box.textContent).toContain('No product NOPE');

        const failing = make();
        failing.client.request.mockRejectedValue(new Error('Rate limit reached'));
        await failing.card.open('FESX');
        expect(failing.box.textContent).toContain('Rate limit reached');
    });

    test('missing sections say why, partial errors are listed', async () => {
        const { card, box } = make({ ...DATA, TickRules: null, partialErrors: ['TickRules: upstream timeout'] });
        await card.open('FESX');
        const ticks = [...box.querySelectorAll('.pc-card')].find(c => c.querySelector('h3').textContent === 'Tick rules');
        expect(ticks.textContent).toContain('TickRules could not be loaded.');
        expect(box.querySelector('.dt-warning').textContent).toContain('TickRules: upstream timeout');
    });

    test('settlement prices load on request and chart one contract', async () => {
        const { card, client, box } = make();
        await card.open('FESX');
        client.request.mockResolvedValueOnce({
            SettlementPrices: { date: '2026-10-02', data: [
                { ContractID: 1, ContractType: 'STANDARD', PriceType: 'DAILY', SettlementPrice: 5500, SettlementDate: '2026-10-01' },
                { ContractID: 1, ContractType: 'STANDARD', PriceType: 'DAILY', SettlementPrice: 5510, SettlementDate: '2026-10-02' }
            ] },
            Contracts: { data: [{ ContractID: 1, Contract: 'FESX 209909', ExpirationDate: '2099-09-17' }] }
        });
        box.querySelector('.pc-settle .pc-btn').click();
        await wait();
        await wait();
        expect(client.request.mock.calls[1][0]).toContain('SettlementPrices(filter: { Product: { eq: "FESX" } })');
        expect(box.querySelector('.pc-chart svg')).not.toBeNull();
        expect(box.querySelectorAll('.pc-chart circle')).toHaveLength(2);
        expect(box.querySelector('.pc-stats').textContent).toContain('5,510');
        expect(box.querySelector('.pc-settle select').textContent).toContain('FESX 209909');
    });

    test('opening another product while one loads keeps only the last', async () => {
        const { card, client, box } = make();
        let release;
        client.request.mockImplementationOnce(() => new Promise(r => { release = () => r(DATA); }));
        const first = card.open('FDAX');
        await card.open('FESX');
        release();
        await first;
        expect(box.querySelector('.pc-title h2').textContent).toBe('FESX');
    });
});

describe('ProductCard layout', () => {
    test('cards are packed into columns, in order, and keep their place when content changes', async () => {
        const { card, box } = make();
        await card.open('FESX');
        const grid = box.querySelector('.pc-grid');
        expect(grid.querySelectorAll('.pc-col').length).toBeGreaterThanOrEqual(1);
        expect(grid.querySelectorAll('.pc-card')).toHaveLength(6);
    });

    test('with several columns each card goes to the shortest one', () => {
        const { card, box } = make();
        const grid = document.createElement('div');
        Object.defineProperty(grid, 'clientWidth', { value: 1300 }); // room for three columns
        box.appendChild(grid);
        const heights = [300, 100, 100, 100, 100, 100];
        const cards = heights.map((h, i) => {
            const c = document.createElement('section');
            c.className = 'pc-card';
            c.id = `c${i}`;
            Object.defineProperty(c, 'offsetHeight', { value: h });
            return c;
        });
        card._pack(grid, cards);
        const cols = [...grid.querySelectorAll('.pc-col')].map(col => [...col.children].map(c => c.id));
        expect(cols).toEqual([['c0'], ['c1', 'c3', 'c5'], ['c2', 'c4']]); // the tall card stays alone, the others fill the shorter columns
    });
});
