/** @jest-environment jsdom */
import { windowHours, profileAxes } from '../profile.js';
import { renderRadar } from '../radar.js';

const base = {
    hours: { StartContinuousTrading: '01:10:00', EndContinuousTrading: '22:00:00', StartTES: '07:30:00', EndTES: '22:30:00' },
    tes: [{ TESType: 'BLOCK', MinLotSize: 100 }, { TESType: 'BLOCK', MinLotSize: 50 }, { TESType: 'EFP', MinLotSize: 1 }],
    ticks: [{ TradeType: 'ORDER_BOOK', StartPrice: 0, PriceStep: 0.5 }, { TradeType: 'ORDER_BOOK', StartPrice: 10, PriceStep: 1 }, { TradeType: 'EFP', StartPrice: 0, PriceStep: 0.01 }],
    expirations: ['2020-01-01', '2026-12-18', '2027-03-19'],
    holidays: ['2026-12-24', '2026-12-25', '2030-01-01'],
    today: '2026-10-18'
};

describe('windowHours', () => {
    test('measures a window, across midnight too', () => {
        expect(windowHours('01:10:00', '22:00:00')).toBeCloseTo(20.83, 1);
        expect(windowHours('22:00:00', '02:00:00')).toBe(4);
        expect(windowHours(null, '02:00:00')).toBeNull();
    });
});

describe('profileAxes', () => {
    test('derives scaled axes from the card data', () => {
        const axes = Object.fromEntries(profileAxes(base).map(a => [a.key, a]));
        expect(Object.keys(axes)).toEqual(['book', 'tes-window', 'depth', 'open', 'block', 'tes-types', 'ticks']);
        expect(axes.depth.value).toBeCloseTo(2 / 24);
        expect(axes.open.value).toBeCloseTo(1 - 2 / 15);
        expect(axes.block.value).toBeCloseTo(1 - Math.log10(50) / 4);
        expect(axes['tes-types'].value).toBeCloseTo(2 / 6);
        expect(axes.ticks.value).toBeCloseTo(1 - 1 / 5);
    });
    test('leaves out axes without data and keeps values within 0..1', () => {
        const axes = profileAxes({ ...base, hours: null, tes: null, ticks: null, expirations: Array.from({ length: 40 }, () => '2027-01-01') });
        expect(axes.map(a => a.key)).toEqual(['depth', 'open']);
        expect(axes[0].value).toBe(1);
    });
});

describe('renderRadar', () => {
    test('draws rings, spokes, labels, area and a tooltip per axis', () => {
        const svg = renderRadar(profileAxes(base));
        expect(svg.querySelectorAll('.rd-ring')).toHaveLength(4);
        expect(svg.querySelectorAll('.rd-spoke')).toHaveLength(7);
        expect(svg.querySelectorAll('.rd-label')).toHaveLength(7);
        expect(svg.querySelectorAll('.rd-area')).toHaveLength(1);
        expect(svg.querySelector('.rd-dot title').textContent).toContain('Trading day');
    });
    test('needs three axes', () => {
        expect(renderRadar([{ label: 'a', value: 1, text: '' }]).querySelector('.rd-empty')).not.toBeNull();
    });
});

describe('compareAxes', () => {
    test('keeps the axes both products have and carries the second value', async () => {
        const { compareAxes } = await import('../profile.js');
        const a = profileAxes(base);
        const b = profileAxes({ ...base, tes: null });
        const both = compareAxes(a, b);
        expect(both.map(x => x.key)).toEqual(['book', 'tes-window', 'depth', 'open', 'ticks']);
        expect(both[0].compare.value).toBe(b[0].value);
        expect(renderRadar(both, { names: ['A', 'B'] }).querySelectorAll('.rd-area.rd-b')).toHaveLength(1);
    });
});
