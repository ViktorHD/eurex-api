/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { TextEncoder } from 'util';
import { StrategyView } from '../strategyview.js';
import { resetProductCatalog } from '../catalog.js';

global.TextEncoder = TextEncoder;
const wait = () => new Promise(r => setTimeout(r, 0));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const E1 = day(40);
const E2 = day(130);

const CATALOG = [
    { Product: 'FESX', Name: 'Euro STOXX 50 Futures', ProductType: 'INDEX FUTURES', ProductLine: 'Future', ProductTypeCode: 'FI', Currency: 'EUR' },
    { Product: 'FDAX', Name: 'DAX Futures', ProductType: 'INDEX FUTURES', ProductLine: 'Future', ProductTypeCode: 'FI', Currency: 'EUR' },
    { Product: 'OESX', Name: 'Euro STOXX 50 Options', ProductType: 'INDEX OPTIONS', ProductLine: 'Option', ProductTypeCode: 'OI', Currency: 'EUR' },
    { Product: 'FDIV', Name: 'Dividend future', ProductType: 'DIVIDEND', ProductLine: 'Dividend', ProductTypeCode: 'FD', Currency: 'EUR' }
];
const optionRows = [];
for (const k of [4800, 4900, 5000, 5100, 5200]) {
    optionRows.push({ Contract: `OESX C ${k}`, ExpirationDate: E1, CallPut: 'C', Strike: k, SettlementPrice: Math.max(5000 - k, 0) + 60 });
    optionRows.push({ Contract: `OESX P ${k}`, ExpirationDate: E1, CallPut: 'P', Strike: k, SettlementPrice: Math.max(k - 5000, 0) + 60 });
}
const futureRows = (code, base) => [{ Contract: `${code} A`, ExpirationDate: E1, SettlementPrice: base }, { Contract: `${code} B`, ExpirationDate: E2, SettlementPrice: base + 10 }];
const INFO = {
    OESX: { Product: 'OESX', Currency: 'EUR', TickSize: 0.1, TickValue: 1, ProductTypeCode: 'OI' },
    FESX: { Product: 'FESX', Currency: 'EUR', TickSize: 1, TickValue: 10, ProductTypeCode: 'FI' },
    FDAX: { Product: 'FDAX', Currency: 'EUR', TickSize: 0.5, TickValue: 12.5, ProductTypeCode: 'FI' }
};

function make({ schema = null } = {}) {
    document.body.innerHTML = '<div id="c"></div>';
    resetProductCatalog();
    const calls = [];
    const client = {
        endpoint: 'e', apiKey: 'k',
        request: jest.fn(async (q) => {
            calls.push(q);
            const product = /Product: \{ eq: "([A-Z]+)"/.exec(q)?.[1];
            if (!product) return { data: CATALOG };
            if (q.includes('Contracts(')) {
                const data = product === 'OESX' ? optionRows : futureRows(product, product === 'FDAX' ? 20000 : 5000);
                return { Contracts: { data, pageInfo: { hasNextPage: false } } };
            }
            return {
                ProductInfos: { data: [INFO[product]] },
                TESProfiles: { data: product === 'OESX'
                    ? [{ TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 100, MinExpiryRange: 1 }, { TESType: 'BLOCK', InstrumentType: 'STRATEGY', MinLotSize: 25, MinExpiryRange: 1 }]
                    : [{ TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 50, MinExpiryRange: 1 }] },
                Expirations: { data: [{ ExpirationIndex: 1, ExpirationDate: E1 }, { ExpirationIndex: 2, ExpirationDate: E2 }] }
            };
        })
    };
    const onOpenProduct = jest.fn();
    const view = new StrategyView(client, { content: document.getElementById('c') }, { getSchema: async () => schema, onOpenProduct });
    return { view, client, calls, onOpenProduct, box: document.getElementById('c') };
}
const typeInto = async (input, value) => { input.value = value; input.dispatchEvent(new Event('change')); await wait(); await wait(); };
const flush = async () => { for (let i = 0; i < 6; i++) await wait(); };
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const byText = (box, selector, text) => [...box.querySelectorAll(selector)].find(e => e.textContent.includes(text));
const tile = (box, label) => [...box.querySelectorAll('.pc-stat')].find(s => s.firstChild.textContent === label)?.querySelector('strong').textContent;

beforeEach(() => localStorage.clear());

describe('dragging legs on the chart', () => {
    const origRect = Element.prototype.getBoundingClientRect;
    beforeAll(() => { Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 400, right: 760, bottom: 400 }); });
    afterAll(() => { Element.prototype.getBoundingClientRect = origRect; });

    const straddle = async () => {
        const ctx = make();
        await ctx.view.show();
        await typeInto(ctx.box.querySelector('.sw-picker input'), 'OESX');
        await flush();
        click(byText(ctx.box, '.sw-tpl', 'Long straddle'));
        click(byText(ctx.box, '.sw-form button', 'Replace legs'));
        return ctx;
    };
    const pills = (box) => [...box.querySelectorAll('.pf-leg')];
    const label = (pill) => pill.querySelector('text').textContent;
    const dragTo = (box, pill, level) => {
        const svg = box.querySelector('svg.pf');
        pill.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0 }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: box.querySelector('svg.pf').xAt(level) }));
        window.dispatchEvent(new MouseEvent('pointerup'));
        return svg;
    };

    test('every leg is a pill under the chart, with the strike it sits at', async () => {
        const { box } = await straddle();
        expect(pills(box).map(label)).toEqual(['+1 OESX C 5,000', '+1 OESX P 5,000']);
        expect(pills(box).every(p => p.getAttribute('role') === 'slider' && p.getAttribute('tabindex') === '0')).toBe(true);
    });

    test('dragging a pill moves the strike to the nearest listed one and updates the leg, its price and the result', async () => {
        const { box } = await straddle();
        expect(tile(box, 'Net debit')).toBe('1,200 EUR');
        dragTo(box, pills(box)[0], 4890);
        const row = box.querySelector('.sw-legs tbody tr');
        expect(row.children[5].textContent).toBe('4,900');                 // strike
        expect(row.children[2].textContent).toBe('OESX C 4900');           // contract
        expect(row.querySelectorAll('input')[1].value).toBe('160');        // settlement price of the new contract
        expect(label(pills(box)[0])).toBe('+1 OESX C 4,900');
        expect(tile(box, 'Net debit')).toBe('2,200 EUR');                  // (160 + 60) * 10: the result follows the new leg
        expect(document.body.classList.contains('pf-dragging')).toBe(false);
        expect(JSON.parse(localStorage.getItem('eurexExplorer.strategy')).legs[0].strike).toBe(4900);
    });

    test('a strike cannot leave the listed ladder', async () => {
        const { box } = await straddle();
        dragTo(box, pills(box)[1], 99999);
        expect(box.querySelectorAll('.sw-legs tbody tr')[1].children[5].textContent).toBe('5,200');
    });

    test('an entry price typed by the user is kept when the strike moves', async () => {
        const { box } = await straddle();
        const price = box.querySelector('.sw-legs tbody tr').querySelectorAll('input')[1];
        price.value = '77';
        price.dispatchEvent(new Event('input'));
        dragTo(box, pills(box)[0], 5090);
        expect(box.querySelector('.sw-legs tbody tr').querySelectorAll('input')[1].value).toBe('77');
    });

    test('arrow keys step one listed strike and keep the focus on the pill', async () => {
        const { box } = await straddle();
        const pill = () => pills(box)[1];
        pill().focus();
        pill().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(box.querySelectorAll('.sw-legs tbody tr')[1].children[5].textContent).toBe('4,900');
        expect(document.activeElement.getAttribute('data-leg')).toBe(pill().getAttribute('data-leg'));
        pill().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        pill().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(box.querySelectorAll('.sw-legs tbody tr')[1].children[5].textContent).toBe('5,100');
    });

    test('dragging a future changes its entry price (snapped to the tick) but not the reference level', async () => {
        const { view, box } = make();
        await view.show();
        await typeInto(box.querySelector('.sw-picker input'), 'FESX');
        await flush();
        click(byText(box, '.sw-tpl', 'Futures calendar'));
        click(byText(box, '.sw-form button', 'Replace legs'));
        const refBefore = box.querySelector('.sw-scenario input').value;
        dragTo(box, pills(box)[0], 5033.4);
        const row = box.querySelector('.sw-legs tbody tr');
        expect(row.querySelectorAll('input')[1].value).toBe('5033');
        expect(box.querySelector('.sw-scenario input').value).toBe(refBefore);
        expect(label(pills(box)[0])).toBe('+1 FESX F @5,033');
    });

    test('legs whose strikes are not loaded cannot be dragged', async () => {
        const first = await straddle();
        const again = make();
        await again.view.show(); // restored from the browser, the product data is still loading
        expect(pills(again.box).every(p => p.getAttribute('role') !== 'slider')).toBe(true);
        await flush();
        expect(pills(again.box).every(p => p.getAttribute('role') === 'slider')).toBe(true);
    });
});

describe('drawing a payoff', () => {
    const origRect = Element.prototype.getBoundingClientRect;
    beforeAll(() => { Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 300, right: 760, bottom: 300 }); });
    afterAll(() => { Element.prototype.getBoundingClientRect = origRect; });

    const picked = async (code = 'OESX') => {
        const ctx = make();
        await ctx.view.show();
        await typeInto(ctx.box.querySelector('.sw-picker input'), code);
        await flush();
        return ctx;
    };
    const sk = (box) => box.querySelector('.sk-panel');
    const cards = (box) => [...sk(box).querySelectorAll('.sk-card')];
    const names = (box) => cards(box).map(c => c.querySelector('strong').textContent);
    // pixel position (viewBox units) of a level fraction u and a P&L fraction v in the drawing area: margins 66 / 14, size 672 x 252
    const pt = (u, v) => ({ clientX: 66 + u * 672, clientY: 14 + (252 * (1 - v)) / 2 });
    const draw = (box, curve) => {
        const pad = sk(box).querySelector('.sk-pad');
        const pts = Array.from({ length: 41 }, (_, i) => pt(i / 40, curve(i / 40)));
        pad.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...pts[0] }));
        pts.slice(1).forEach(p => pad.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, ...p })));
        pad.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, ...pts[pts.length - 1] }));
    };

    test('asks for an options product first; a futures product cannot be drawn for', async () => {
        const { view, box } = make();
        await view.show();
        expect(sk(box).textContent).toContain('Pick an options product');
        await typeInto(box.querySelector('.sw-picker input'), 'FESX');
        await flush();
        expect(sk(box).textContent).toContain('futures product');
    });

    test('a drawn V suggests a long straddle and previews it', async () => {
        const { box } = await picked();
        draw(box, (u) => 1.6 * Math.abs(2 * u - 1) - 0.8);
        expect(names(box)).toContain('2 legs · Long straddle');
        const recommended = cards(box).find(c => c.querySelector('.sw-tes-badge'));
        expect(recommended.textContent).toContain('2 legs · Long straddle');
        expect(recommended.textContent).toContain('Buy 1 × OESX C 5,000');
        expect(recommended.textContent).toContain('Buy 1 × OESX P 5,000');
        expect(sk(box).querySelector('.lc-empty').getAttribute('visibility')).toBe('hidden'); // "Draw here" makes way for the drawing
        expect(sk(box).querySelector('.pf-line2').getAttribute('d')).toMatch(/^M/); // the dashed preview
        expect(sk(box).querySelector('.sk-line').getAttribute('d')).toMatch(/^M/);  // and the drawing
    });

    test('using the legs puts them into the strategy with their data and draws the payoff', async () => {
        const { box } = await picked();
        draw(box, (u) => 1.6 * Math.abs(2 * u - 1) - 0.8);
        click(byText(cards(box).find(c => c.textContent.includes('Long straddle')), 'button', 'Use these legs'));
        const rows = [...box.querySelectorAll('.sw-legs tbody tr')];
        expect(rows.map(r => r.children[4].textContent)).toEqual(['Call', 'Put']);
        expect(rows.map(r => r.children[5].textContent)).toEqual(['5,000', '5,000']);
        expect(rows[0].querySelector('select').value).toBe('1');
        expect(tile(box, 'Net debit')).toBe('1,200 EUR');
        expect(box.querySelectorAll('.pf-leg')).toHaveLength(2); // and the legs can be dragged on the chart
    });

    test('a short volatility shape gives sold legs, "Add to legs" keeps the existing ones', async () => {
        const { box } = await picked();
        click(byText(box, '.sk-panel button', 'Long volatility'));
        click(byText(cards(box).find(c => c.textContent.includes('Long straddle')), 'button', 'Use these legs'));
        click(byText(box, '.sk-panel button', 'Short volatility'));
        const short = cards(box).find(c => c.textContent.includes('Short straddle'));
        expect(short.textContent).toContain('Sell 1 × OESX C 5,000');
        expect(short.textContent).toContain('Net credit');
        click(byText(short, 'button', 'Add to legs'));
        expect(box.querySelectorAll('.sw-legs tbody tr')).toHaveLength(4);
    });

    test('a capped rising curve suggests a spread; more legs are offered as alternatives', async () => {
        const { box } = await picked();
        click(byText(box, '.sk-panel button', 'Capped bullish'));
        expect(names(box).some(n => /Bull (call|put) spread/.test(n))).toBe(true);
        expect(cards(box).length).toBeGreaterThan(1);
        click(byText(cards(box)[cards(box).length - 1], 'button', 'Preview'));
        expect(cards(box).filter(c => c.classList.contains('selected'))).toHaveLength(1);
    });

    test('the expiry, range and clearing are respected; a flat or empty drawing suggests nothing', async () => {
        const { box } = await picked();
        click(byText(box, '.sk-panel button', 'Bullish'));
        expect(cards(box).length).toBeGreaterThan(0);
        click(byText(box, '.sk-panel button', 'Clear'));
        expect(cards(box)).toHaveLength(0);
        draw(box, () => 0.3);
        expect(cards(box)).toHaveLength(0);
        expect(sk(box).querySelector('.sk-results').textContent).toContain('Nothing to fit');
        const range = sk(box).querySelector('select[aria-label="Level range"]');
        range.value = '0.2';
        range.dispatchEvent(new Event('change'));
        expect([...sk(box).querySelectorAll('.lc-tick')].some(t => t.textContent === '6,000')).toBe(true);
    });
});

describe('StrategyView', () => {
    test('offers only option and future products, and loads nothing else before one is picked', async () => {
        const { view, box, calls } = make();
        await view.show();
        const codes = [...box.querySelectorAll('datalist')[0].options].map(o => o.value);
        expect(codes).toEqual(['FDAX', 'FESX', 'OESX']);
        expect(calls).toHaveLength(1); // the product list only
        expect(box.querySelector('.pc-empty').textContent).toContain('No legs yet');
    });

    test('a typed product that cannot be a leg is refused with a reason', async () => {
        const { view, box, calls } = make();
        await view.show();
        const input = box.querySelector('.sw-picker input');
        await typeInto(input, 'fdiv');
        expect(box.querySelector('.sw-pick-note').textContent).toContain('neither an options nor a futures');
        await typeInto(input, 'zzzz');
        expect(box.querySelector('.sw-pick-note').textContent).toContain('No product ZZZZ');
        expect(calls).toHaveLength(1);
    });

    test('picking a product loads it once, filtered by product, and shows its TES shortcut', async () => {
        const { view, box, calls } = make();
        await view.show();
        await typeInto(box.querySelector('.sw-picker input'), 'oesx');
        await flush();
        const mine = calls.slice(1);
        expect(mine).toHaveLength(2); // small roots + contracts
        mine.forEach(q => expect(q).toContain('Product: { eq: "OESX" }'));
        expect(box.querySelector('.sw-info').textContent).toContain('TES strategies supported');
        const names = [...box.querySelectorAll('.sw-tpl')].map(b => b.textContent.replace('TES', '').trim());
        expect(names).toContain('Long straddle');
        expect(names).not.toContain('Futures calendar spread'); // an options product offers option templates
        expect(byText(box, '.sw-tpl', 'Long straddle').querySelector('.sw-tes-badge')).not.toBeNull();
    });

    test('choosing the same product again changes nothing (a blur after typing must not redraw the buttons)', async () => {
        const { view, box, calls } = make();
        await view.show();
        const input = box.querySelector('.sw-picker input');
        await typeInto(input, 'OESX');
        await flush();
        const button = byText(box, '.sw-tpl', 'Long straddle');
        input.dispatchEvent(new Event('change'));
        await flush();
        expect(byText(box, '.sw-tpl', 'Long straddle')).toBe(button);
        expect(calls).toHaveLength(3);
    });

    test('a failed product can be chosen again to retry', async () => {
        const { view, box, client } = make();
        await view.show();
        const original = client.request.getMockImplementation();
        let fail = true;
        client.request.mockImplementation(async (q) => { if (fail && q.includes('Contracts(')) throw new Error('boom'); return original(q); });
        const input = box.querySelector('.sw-picker input');
        await typeInto(input, 'OESX');
        await flush();
        expect(box.querySelector('.pc-note.bad').textContent).toContain('boom');
        fail = false;
        await typeInto(input, 'OESX');
        await flush();
        expect(box.querySelector('.sw-info').textContent).toContain('Options');
    });

    test('a straddle template builds two legs and draws the payoff', async () => {
        const { view, box, calls } = make();
        await view.show();
        await typeInto(box.querySelector('.sw-picker input'), 'OESX');
        await flush();
        click(byText(box, '.sw-tpl', 'Long straddle'));
        click(byText(box, '.sw-form button', 'Replace legs'));
        const rows = [...box.querySelectorAll('.sw-table tbody tr')];
        expect(rows.length).toBeGreaterThanOrEqual(2);
        const legRows = [...box.querySelectorAll('.sw-legs tbody tr')];
        expect(legRows.map(r => r.children[4].textContent)).toEqual(['Call', 'Put']);
        expect(legRows.map(r => r.children[5].textContent)).toEqual(['5,000', '5,000']);
        // premium 60 + 60 at 10 per point (1 / 0.1)
        expect(tile(box, 'Net debit')).toBe('1,200 EUR');
        expect(tile(box, 'Max profit')).toBe('Unlimited');
        expect(tile(box, 'Max loss')).toContain('-1,200');
        expect(box.querySelectorAll('.sw-out svg.pf path.pf-line')).toHaveLength(1);
        expect(box.querySelectorAll('.sw-out circle.pf-be')).toHaveLength(2);
        expect(tile(box, 'Breakeven')).toMatch(/4,880.*5,120|4880.*5120/);
        // no further data requests for the same product
        expect(calls.filter(q => q.includes('Contracts('))).toHaveLength(1);
        expect(box.querySelector('.sw-tes').textContent).toContain('min 25');
    });

    test('editing the entry price or quantity redraws; invalid input is flagged and left out', async () => {
        const { view, box } = make();
        await view.show();
        await typeInto(box.querySelector('.sw-picker input'), 'OESX');
        await flush();
        click(byText(box, '.sw-tpl', 'Long straddle'));
        click(byText(box, '.sw-form button', 'Replace legs'));
        const [qty, price] = [...box.querySelectorAll('.sw-legs tbody tr')[0].querySelectorAll('input')];
        price.value = '100';
        price.dispatchEvent(new Event('input'));
        expect(tile(box, 'Net debit')).toBe('1,600 EUR');
        qty.value = '2';
        qty.dispatchEvent(new Event('input'));
        expect(tile(box, 'Net debit')).toBe('2,600 EUR'); // (2 * 100 + 60) * 10
        qty.value = '';
        qty.dispatchEvent(new Event('input'));
        expect(qty.classList.contains('invalid')).toBe(true);
        expect(box.querySelector('.sw-out .pc-note.bad').textContent).toContain('left out');
        expect(tile(box, 'Net debit')).toBe('600 EUR');
    });

    test('inter-product spread: legs of two products, scenario with beta, loaded on demand', async () => {
        const { view, box, calls } = make();
        await view.show();
        await typeInto(box.querySelector('.sw-picker input'), 'FESX');
        await flush();
        expect([...box.querySelectorAll('.sw-tpl')].map(b => b.textContent)).toEqual(['Futures calendar spread', 'Inter-product spread']);
        click(byText(box, '.sw-tpl', 'Inter-product'));
        expect(box.querySelector('.sw-form').textContent).toContain('Choose the second product');
        const second = box.querySelector('.sw-form input');
        await typeInto(second, 'FDAX');
        await flush();
        click(byText(box, '.sw-form button', 'Replace legs'));
        const legRows = [...box.querySelectorAll('.sw-legs tbody tr')];
        expect(legRows.map(r => r.children[3].textContent)).toEqual(['FESX', 'FDAX']);
        expect(legRows.map(r => r.children[0].querySelector('select').value)).toEqual(['1', '-1']);
        expect(calls.filter(q => q.includes('"FDAX"'))).toHaveLength(2);
        expect(box.querySelector('.sw-scenario').textContent).toContain('Beta to first');
        expect(box.querySelector('.sw-scenario').textContent).toContain('FESX (x axis)');
        // one FDAX contract carries far more exposure than one FESX contract (point value 25 at 20,000 vs 10 at 5,000), so the
        // short leg dominates: the loss grows with the market and the profit is capped by the lower end of the range
        expect(tile(box, 'Max loss')).toBe('Unlimited');
        expect(tile(box, 'Max profit')).toMatch(/EUR$/);
        expect(box.querySelector('.sw-out').textContent).toContain('Several underlyings');
        // a relative move of the second product shifts the payoff at the current level
        const rel = [...box.querySelectorAll('.sw-scenario input')].find(i => i.getAttribute('aria-label')?.startsWith('Relative move'));
        rel.value = '1';
        rel.dispatchEvent(new Event('input'));
        expect(box.querySelector('.sw-out svg')).not.toBeNull();
    });

    test('adding a leg by hand, including a product that is not the template product', async () => {
        const { view, box } = make();
        await view.show();
        const builderInput = box.querySelectorAll('.sw-picker input')[1];
        await typeInto(builderInput, 'OESX');
        await flush();
        const controls = box.querySelector('.sw-builder');
        const selects = controls.querySelectorAll('select');
        expect([...selects].some(s => s.getAttribute('aria-label') === 'Strike')).toBe(true);
        click(byText(box, '.sw-builder button', 'Add leg'));
        expect(box.querySelectorAll('.sw-legs tbody tr')).toHaveLength(1);
        await typeInto(box.querySelectorAll('.sw-picker input')[1], 'FESX');
        await flush();
        click(byText(box, '.sw-builder button', 'Add leg'));
        const rows = [...box.querySelectorAll('.sw-legs tbody tr')];
        expect(rows.map(r => r.children[3].textContent)).toEqual(['OESX', 'FESX']);
        expect(rows.map(r => r.children[4].textContent)).toEqual(['Call', 'Future']);
        click(rows[0].querySelector('.sw-del'));
        expect(box.querySelectorAll('.sw-legs tbody tr')).toHaveLength(1);
    });

    test('the strategy is kept in the browser and restored', async () => {
        const first = make();
        await first.view.show();
        await typeInto(first.box.querySelector('.sw-picker input'), 'OESX');
        await flush();
        click(byText(first.box, '.sw-tpl', 'Long straddle'));
        click(byText(first.box, '.sw-form button', 'Replace legs'));
        const again = make();
        await again.view.show();
        await flush();
        expect(again.box.querySelectorAll('.sw-legs tbody tr')).toHaveLength(2);
        expect(tile(again.box, 'Net debit')).toBe('1,200 EUR');
    });

    test('a product that cannot be loaded is reported', async () => {
        const { view, box, client } = make();
        await view.show();
        const original = client.request.getMockImplementation();
        client.request.mockImplementation(async (q) => { if (q.includes('Contracts(')) throw new Error('boom'); return original(q); });
        await typeInto(box.querySelector('.sw-picker input'), 'OESX');
        await flush();
        expect(box.querySelector('.pc-note.bad').textContent).toContain('boom');
    });

    test('a failing product list is reported', async () => {
        document.body.innerHTML = '<div id="c"></div>';
        resetProductCatalog();
        const client = { endpoint: 'e', apiKey: 'k', request: jest.fn(async () => { throw new Error('no network'); }) };
        const view = new StrategyView(client, { content: document.getElementById('c') }, { getSchema: async () => null });
        await view.show();
        expect(document.getElementById('c').querySelector('[role=alert]').textContent).toContain('no network');
    });
});
