import { resample, candidatesFrom, suggest, recommended, nameOf, rmseOf } from '../fit.js';
import { contractOptions } from '../payoff.js';

const PV = 10;
const strikes = [];
for (let k = 4600; k <= 5400; k += 100) strikes.push(k);
const options = contractOptions(strikes.flatMap(k => ['C', 'P'].map(cp => ({ Contract: `${cp}${k}`, ExpirationDate: '2026-12-18', CallPut: cp, Strike: k, SettlementPrice: 50 }))));
const xs = Array.from({ length: 161 }, (_, i) => 4500 + (i * 1000) / 160);
const cands = candidatesFrom(options, '2026-12-18', PV, xs, 4500, 5500);
const call = (k) => (s) => Math.max(s - k, 0);
const put = (k) => (s) => Math.max(k - s, 0);
const target = (f) => ({ xs, ys: xs.map(f) });
const shape = (sol) => sol.legs.map(l => `${l.lots > 0 ? '+' : ''}${l.lots} ${l.cand.kind[0].toUpperCase()}${l.cand.strike}`);

describe('resample', () => {
    test('interpolates a drawn stroke onto a regular grid, whatever the drawing order', () => {
        const r = resample([{ s: 3, y: 30 }, { s: 1, y: 10 }, { s: 2, y: 20 }], 0, 10, 5);
        expect(r.xs).toEqual([1, 1.5, 2, 2.5, 3]);
        expect(r.ys).toEqual([10, 15, 20, 25, 30]);
    });
    test('averages points at the same level and stays inside the drawn extent and the limits', () => {
        const r = resample([{ s: 1, y: 0 }, { s: 1, y: 10 }, { s: 5, y: 10 }], 2, 4, 3);
        expect(r.xs).toEqual([2, 3, 4]);
        expect(r.ys.every(y => y === 5 + (0))).toBe(false);
        expect(resample([{ s: 1, y: 0 }], 0, 10)).toBeNull();
        expect(resample([{ s: 1, y: 0 }, { s: 2, y: 0 }], 5, 10)).toBeNull();
        expect(resample([], 0, 1)).toBeNull();
    });
});

describe('candidates', () => {
    test('calls and puts of one expiry inside the limits, with their payoff per lot', () => {
        expect(cands).toHaveLength(18);
        const c = cands.find(x => x.kind === 'call' && x.strike === 5000);
        expect(c.col[xs.indexOf(5500)]).toBeCloseTo(PV * 500, 6);
        expect(c.col[0]).toBe(0);
        expect(candidatesFrom(options, '2030-01-01', PV, xs, 0, 1e9)).toEqual([]);
    });
});

describe('suggesting legs for a drawn payoff', () => {
    test('V shape: a long straddle, one lot of each', () => {
        const s = suggest(target(x => PV * Math.abs(x - 5000)), cands, { maxLegs: 4 });
        const two = s.find(x => x.legs.length === 2);
        expect(shape(two)).toEqual(['+1 C5000', '+1 P5000']);
        expect(two.rel).toBeLessThan(1e-6);
        expect(nameOf(two.legs.map(l => ({ kind: l.cand.kind, strike: l.cand.strike, lots: l.lots })))).toBe('Long straddle');
        expect(recommended(s)).toBe(s.indexOf(two));
    });
    test('the size of the drawing sets the number of lots', () => {
        const s = suggest(target(x => 3 * PV * Math.abs(x - 5000) + 777), cands);
        expect(shape(s.find(x => x.legs.length === 2))).toEqual(['+3 C5000', '+3 P5000']);
    });
    test('capped slope between two levels: a bull call spread', () => {
        const s = suggest(target(x => PV * Math.min(Math.max(x - 4900, 0), 200)), cands, { ref: 4950 });
        const sol = s.find(x => x.legs.length === 2);
        // a bull call spread and a bull put spread draw the same curve; either answer is right
        expect(nameOf(sol.legs.map(l => ({ kind: l.cand.kind, strike: l.cand.strike, lots: l.lots })))).toMatch(/^Bull (call|put) spread$/);
        expect(sol.legs.map(l => l.cand.strike)).toEqual([4900, 5100]);
        expect(sol.rel).toBeLessThan(1e-6);
        expect(recommended(s)).toBe(s.indexOf(sol)); // more legs would not fit better
    });
    test('tent: a butterfly', () => {
        const s = suggest(target(x => PV * (call(4800)(x) - 2 * call(5000)(x) + call(5200)(x))), cands);
        const sol = s.find(x => x.legs.length === 3);
        expect(shape(sol)).toEqual(['+1 C4800', '-2 C5000', '+1 C5200']);
        expect(sol.rel).toBeLessThan(1e-6);
        expect(nameOf(sol.legs.map(l => ({ kind: l.cand.kind, strike: l.cand.strike, lots: l.lots })))).toBe('Long call butterfly');
    });
    test('plateau with wings: an iron condor with four legs', () => {
        const f = (x) => PV * (put(4800)(x) - put(4900)(x) - call(5100)(x) + call(5200)(x));
        const s = suggest(target(f), cands, { maxLegs: 4, ref: 5000 });
        const sol = s.find(x => x.legs.length === 4);
        expect(sol.rel).toBeLessThan(1e-6);
        expect(nameOf(sol.legs.map(l => ({ kind: l.cand.kind, strike: l.cand.strike, lots: l.lots })))).toBe('Iron condor');
        expect(recommended(s)).toBe(s.indexOf(sol)); // three legs cannot do it
    });
    test('a rough drawing gets the closest combination, with an honest error', () => {
        const s = suggest(target(x => PV * 100 * Math.sin((x - 4500) / 160)), cands, { maxLegs: 3 });
        expect(s.length).toBeGreaterThan(0);
        expect(s.every(x => x.rel > 0 && x.rel < 1)).toBe(true);
        expect(s[s.length - 1].rel).toBeLessThan(s[0].rel); // more legs follow the wave closer
    });
    test('a flat drawing has nothing to fit', () => {
        expect(suggest(target(() => 5), cands)).toEqual([]);
        expect(suggest(target(x => x), [])).toEqual([]);
    });
    test('the error of whole lots is measured with the best constant', () => {
        const used = [cands.find(c => c.kind === 'call' && c.strike === 5000)];
        const y = xs.map(x => PV * call(5000)(x) + 123);
        expect(rmseOf(used, [1], y).rmse).toBeCloseTo(0, 6);
        expect(rmseOf(used, [2], y).rmse).toBeGreaterThan(100);
    });
});

describe('naming', () => {
    const L = (kind, strike, lots) => ({ kind, strike, lots });
    test('classic combinations', () => {
        expect(nameOf([L('call', 5000, 1)])).toBe('Long call');
        expect(nameOf([L('put', 5000, -2)])).toBe('Short put');
        expect(nameOf([L('call', 5000, -1), L('put', 5000, -1)])).toBe('Short straddle');
        expect(nameOf([L('call', 5100, 1), L('put', 4900, 1)])).toBe('Long strangle');
        expect(nameOf([L('call', 5100, 1), L('put', 4900, -1)])).toBe('Risk reversal');
        expect(nameOf([L('put', 4900, -1), L('put', 5000, 1)])).toBe('Bear put spread'); // long the higher put
        expect(nameOf([L('put', 4900, 1), L('put', 5000, -1)])).toBe('Bull put spread');
        expect(nameOf([L('call', 5000, -1), L('call', 5100, 1)])).toBe('Bear call spread');
        expect(nameOf([L('call', 5000, 1), L('call', 5100, -2)])).toBe('Custom');
        expect(nameOf([L('call', 5000, 2), L('put', 5000, 1)])).toBe('Custom');
    });
});
