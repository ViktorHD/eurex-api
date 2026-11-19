import {
    normCdf, black76, legValue, legScale, strategyPnl, moveRange, curve, analyze, breakevens, netPremium, firstExpiry,
    impliedForward, defaultLevel, legLevel, valueAtLevel, snapToStep, stepStrike, pointValueOf, contractOptions, expirationsOf, strikesOf, findContract, nearestStrike, groupsOf, groupLevel
} from '../payoff.js';

const leg = (o) => ({ id: Math.random().toString(36), product: 'OESX', kind: 'call', strike: 100, expiration: '2026-12-18', side: 1, qty: 1, price: 0, pointValue: 1, currency: 'EUR', ...o });
const groupsFor = (s0 = 100) => ({ OESX: { s0, beta: 1, rel: 0 } });
const at = (legs, level, groups = groupsFor(), opts = { date: '2026-12-18' }) => strategyPnl(legs, groups, level / groups.OESX.s0 - 1, opts);

describe('Black-76', () => {
    test('normal CDF', () => {
        expect(normCdf(0)).toBeCloseTo(0.5, 6);
        expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
        expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
    });
    test('at the money value and put-call parity', () => {
        expect(black76('call', 100, 100, 1, 0.2)).toBeCloseTo(7.9656, 3);
        const c = black76('call', 105, 100, 0.5, 0.25);
        const p = black76('put', 105, 100, 0.5, 0.25);
        expect(c - p).toBeCloseTo(5, 6); // F - K with r = 0
    });
    test('falls back to intrinsic value at expiry or without volatility', () => {
        expect(black76('call', 110, 100, 0, 0.2)).toBe(10);
        expect(black76('put', 110, 100, 1, 0)).toBe(0);
    });
});

describe('payoff of single legs and the classic strategies', () => {
    test('long call, short put, future', () => {
        const call = [leg({ kind: 'call', strike: 100, price: 5 })];
        expect(at(call, 90)).toBe(-5);
        expect(at(call, 120)).toBe(15);
        expect(at([leg({ kind: 'put', strike: 100, price: 4, side: -1 })], 80)).toBe(4 - 20);
        expect(at([leg({ kind: 'future', strike: null, price: 100, side: -1 })], 90)).toBe(10);
    });
    test('point value, quantity and currency rate scale the result', () => {
        const l = leg({ kind: 'call', strike: 100, price: 5, qty: 3, pointValue: 10, currency: 'USD' });
        expect(legScale(l, { USD: 0.5 })).toBe(15);
        expect(strategyPnl([l], groupsFor(), 0.2, { date: '2026-12-18', fx: { USD: 0.5 } })).toBe(15 * (20 - 5));
    });
    test('straddle: loss is the premium at the strike, breakevens strike +- premium', () => {
        const legs = [leg({ kind: 'call', price: 5 }), leg({ kind: 'put', price: 4 })];
        expect(at(legs, 100)).toBe(-9);
        const pts = curve(legs, groupsFor(), moveRange(legs, groupsFor()), { date: '2026-12-18' });
        const a = analyze(pts);
        expect(a.unlimitedProfit).toBe(true);
        expect(a.unlimitedLoss).toBe(false);
        expect(a.maxLoss).toBeCloseTo(-9, 6);
        expect(a.breakevens.map(b => Math.round(b.s))).toEqual([91, 109]);
        expect(netPremium(legs)).toBe(9);
    });
    test('short straddle has unlimited loss and a capped profit', () => {
        const legs = [leg({ kind: 'call', price: 5, side: -1 }), leg({ kind: 'put', price: 4, side: -1 })];
        const a = analyze(curve(legs, groupsFor(), moveRange(legs, groupsFor()), { date: '2026-12-18' }));
        expect(a.unlimitedLoss).toBe(true);
        expect(a.unlimitedProfit).toBe(false);
        expect(a.maxProfit).toBeCloseTo(9, 6);
        expect(netPremium(legs)).toBe(-9);
    });
    test('a curve with model-valued legs never claims an unlimited tail', () => {
        const near = leg({ kind: 'call', strike: 100, expiration: '2026-12-18', side: -1, price: 4 });
        const far = leg({ kind: 'call', strike: 100, expiration: '2027-03-19', side: 1, price: 6 });
        const pts = curve([near, far], groupsFor(), moveRange([near, far], groupsFor()), { date: '2026-12-18', vol: 0.2 });
        expect(analyze(pts).unlimitedLoss).toBe(true); // the slope at the edge is nonzero ...
        const a = analyze(pts, { exact: false });
        expect(a.unlimitedLoss).toBe(false); // ... but that is the model bending, not a tail
        expect(a.unlimitedProfit).toBe(false);
        expect(a.maxLoss).toBeLessThan(0);
    });
    test('bull call spread: capped on both sides', () => {
        const legs = [leg({ kind: 'call', strike: 100, price: 6 }), leg({ kind: 'call', strike: 110, price: 2, side: -1 })];
        const a = analyze(curve(legs, groupsFor(), moveRange(legs, groupsFor()), { date: '2026-12-18' }));
        expect(a.maxLoss).toBeCloseTo(-4, 6);
        expect(a.maxProfit).toBeCloseTo(6, 6);
        expect(a.unlimitedProfit).toBe(false);
        expect(a.breakevens.map(b => b.s.toFixed(1))).toEqual(['104.0']);
    });
    test('butterfly with a doubled centre leg', () => {
        const legs = [leg({ strike: 90, price: 12 }), leg({ strike: 100, price: 6, side: -1, qty: 2 }), leg({ strike: 110, price: 2 })];
        expect(at(legs, 100)).toBe(10 - 12 + 12 - 2); // centre pin: 10 intrinsic of the wing, minus net debit 2
        expect(at(legs, 80)).toBe(-2);
        expect(at(legs, 130)).toBe(-2);
    });
    test('covered call: future plus short call', () => {
        const legs = [leg({ product: 'OESX', kind: 'future', strike: null, price: 100 }), leg({ kind: 'call', strike: 110, price: 3, side: -1 })];
        expect(at(legs, 90)).toBe(-10 + 3);
        expect(at(legs, 130)).toBe(30 + 3 - 20);
    });
});

describe('several underlyings and expiries', () => {
    test('inter-product spread follows beta and relative move', () => {
        const a = leg({ product: 'FESX', kind: 'future', strike: null, price: 100, side: 1, pointValue: 10 });
        const b = leg({ product: 'FDAX', kind: 'future', strike: null, price: 200, side: -1, pointValue: 5 });
        const groups = { FESX: { s0: 100, beta: 1, rel: 0 }, FDAX: { s0: 200, beta: 1, rel: 0 } };
        expect(groupsOf([a, b])).toEqual(['FESX', 'FDAX']);
        // both +10 %: FESX +10 points * 10, FDAX +20 points * 5 (short)
        expect(strategyPnl([a, b], groups, 0.1, { date: '2026-12-18' })).toBeCloseTo(100 - 100, 6);
        // FDAX 5 % weaker than FESX relative to the common move
        groups.FDAX.rel = -0.05;
        expect(strategyPnl([a, b], groups, 0, { date: '2026-12-18' })).toBeCloseTo(0 + 10 * 5, 6);
        expect(groupLevel(groups, 'FDAX', 0)).toBeCloseTo(190, 6);
        groups.FDAX.beta = 0;
        expect(groupLevel(groups, 'FDAX', 0.5)).toBeCloseTo(190, 6);
    });
    test('a longer-dated leg is valued with the model at the first expiry', () => {
        const near = leg({ kind: 'call', strike: 100, expiration: '2026-12-18', side: -1, price: 4 });
        const far = leg({ kind: 'call', strike: 100, expiration: '2027-03-19', side: 1, price: 6 });
        expect(firstExpiry([far, near])).toBe('2026-12-18');
        const atm = strategyPnl([near, far], groupsFor(), 0, { date: '2026-12-18', vol: 0.2 });
        expect(atm).toBeCloseTo(-(0) + black76('call', 100, 100, 91 / 365, 0.2) - 6 + 4, 6);
        expect(atm).toBeGreaterThan(0);
        expect(legValue(far, 100, { date: '2026-12-18', vol: 0.2 })).toBeGreaterThan(legValue(far, 100, { date: '2027-03-19', vol: 0.2 }));
    });
});

describe('range, breakevens and levels', () => {
    test('range covers the strikes and the premium', () => {
        const legs = [leg({ strike: 90, price: 12 }), leg({ strike: 110, price: 2, side: -1 })];
        const r = moveRange(legs, groupsFor());
        expect(r.min).toBeLessThan(-0.1 - 0.0001);
        expect(r.max).toBeGreaterThan(0.1);
        expect(moveRange(legs, groupsFor(), 0.3)).toEqual({ min: -0.3, max: 0.3 });
    });
    test('breakevens: crossings and exact zeros', () => {
        const mk = (ys) => ys.map((y, i) => ({ x: i, s: 100 + i, y }));
        expect(breakevens(mk([-2, -1, 1, 2])).map(b => b.s)).toEqual([101.5]);
        expect(breakevens(mk([1, 0, -1])).map(b => b.s)).toEqual([101]);
        expect(breakevens(mk([0, 1, 2])).map(b => b.s)).toEqual([100]);
        expect(breakevens(mk([1, 2, 3]))).toEqual([]);
    });
    test('forward from put-call parity picks the strike where call and put are closest', () => {
        const rows = [
            { CallPut: 'C', Strike: 4900, SettlementPrice: 160 }, { CallPut: 'P', Strike: 4900, SettlementPrice: 60 },
            { CallPut: 'C', Strike: 5000, SettlementPrice: 105 }, { CallPut: 'P', Strike: 5000, SettlementPrice: 105 + 0 },
            { CallPut: 'C', Strike: 5100, SettlementPrice: 60 }, { CallPut: 'P', Strike: 5100, SettlementPrice: 160 }
        ];
        expect(impliedForward(rows)).toBe(5000);
        expect(impliedForward([{ CallPut: 'C', Strike: 100, SettlementPrice: 5 }])).toBeNull();
        expect(impliedForward([])).toBeNull();
    });
    test('default level: futures prices, then the forward, then the middle strike', () => {
        const f = leg({ kind: 'future', strike: null, price: 101 });
        const c = leg({ id: 'c', kind: 'call', strike: 100 });
        const p = leg({ id: 'p', kind: 'put', strike: 120 });
        expect(defaultLevel([f, c])).toBe(101);
        expect(defaultLevel([c], { c: 99 })).toBe(99);
        expect(defaultLevel([c, p])).toBe(120);
        expect(defaultLevel([])).toBe(0);
    });
});

describe('contract data', () => {
    const rows = [
        { Contract: 'FESX Mar 27', ExpirationDate: '2027-03-19', CallPut: null, SettlementPrice: 5100 },
        { Contract: 'OESX Dec 26 C 5000', ExpirationDate: '2026-12-18T00:00:00', CallPut: 'C', Strike: 5000, SettlementPrice: 105 },
        { Contract: 'OESX Dec 26 P 5000', ExpirationDate: '2026-12-18', CallPut: 'Put', Strike: '5000', SettlementPrice: 0 },
        { Contract: 'OESX Dec 26 C 5100', ExpirationDate: '2026-12-18', CallPut: 'C', Strike: 5100, SettlementPrice: 60 },
        { Contract: 'broken', CallPut: 'C', Strike: 1 }
    ];
    const opts = contractOptions(rows);
    test('normalises rows and drops those without expiry or strike', () => {
        expect(opts).toHaveLength(4);
        expect(opts[0]).toMatchObject({ kind: 'call', strike: 5000, expiration: '2026-12-18', price: 105 });
        expect(opts.find(o => o.kind === 'put')).toMatchObject({ strike: 5000, price: null }); // 0 is no price
        expect(opts.find(o => o.kind === 'future')).toMatchObject({ strike: null, expiration: '2027-03-19' });
    });
    test('lookups', () => {
        expect(expirationsOf(opts, 'option')).toEqual(['2026-12-18']);
        expect(expirationsOf(opts, 'future')).toEqual(['2027-03-19']);
        expect(strikesOf(opts, '2026-12-18', 'call')).toEqual([5000, 5100]);
        expect(findContract(opts, 'call', '2026-12-18', 5100).label).toBe('OESX Dec 26 C 5100');
        expect(findContract(opts, 'future', '2027-03-19').label).toBe('FESX Mar 27');
        expect(findContract(opts, 'call', '2026-12-18', 4000)).toBeNull();
        expect(nearestStrike([5000, 5100, 5200], 5120)).toEqual({ strike: 5100, index: 1 });
        expect(nearestStrike([], 1)).toBeNull();
    });
    test('point value is tick value per tick size, else contract size', () => {
        expect(pointValueOf({ TickSize: 1, TickValue: 10 })).toBe(10);
        expect(pointValueOf({ TickSize: 0.01, TickValue: 10, ContractSize: 100000 })).toBeCloseTo(1000, 6);
        expect(pointValueOf({ ContractSize: 25 })).toBe(25);
        expect(pointValueOf({})).toBeNull();
    });
});

describe('placing and dragging legs on the chart', () => {
    const groups = { FESX: { s0: 5000, beta: 1, rel: 0 }, FDAX: { s0: 20000, beta: 1.2, rel: 0.01 } };
    test('an option sits at its strike, a future at its entry price', () => {
        expect(legLevel(leg({ product: 'FESX', group: 'FESX', strike: 5100 }), groups, 'FESX')).toBeCloseTo(5100, 6);
        expect(legLevel(leg({ product: 'FESX', group: 'FESX', kind: 'future', strike: null, price: 4950 }), groups, 'FESX')).toBeCloseTo(4950, 6);
    });
    test('a leg of another underlying sits where the leader would be when that strike is reached, and back', () => {
        const l = leg({ product: 'FDAX', group: 'FDAX', strike: 21000 });
        const at = legLevel(l, groups, 'FESX');
        // FDAX 21000 = 20000 * (1 + 1.2 x + 0.01)  ->  x = 0.03333
        expect(at).toBeCloseTo(5000 * (1 + (21000 / 20000 - 1.01) / 1.2), 6);
        expect(valueAtLevel(l, groups, 'FESX', at)).toBeCloseTo(21000, 6);
    });
    test('a leg that cannot be placed gives null', () => {
        expect(legLevel(leg({ product: 'FDAX', group: 'FDAX' }), { ...groups, FDAX: { s0: 20000, beta: 0, rel: 0 } }, 'FESX')).toBeNull();
        expect(legLevel(leg({ product: 'XXXX', group: 'XXXX' }), groups, 'FESX')).toBeNull();
        expect(valueAtLevel(leg({}), groups, 'NOPE', 5000)).toBeNull();
    });
    test('snapping to a tick and stepping along strikes', () => {
        expect(snapToStep(5003.4, 0.5)).toBe(5003.5);
        expect(snapToStep(1.0000000001, 0.01)).toBe(1);
        expect(snapToStep(5003.4, 0)).toBe(5003.4);
        expect(stepStrike([4900, 5000, 5100], 5000, 1)).toBe(5100);
        expect(stepStrike([4900, 5000, 5100], 5100, 1)).toBe(5100);
        expect(stepStrike([4900, 5000, 5100], 4900, -2)).toBe(4900);
        expect(stepStrike([], 5000, 1)).toBeNull();
    });
});
