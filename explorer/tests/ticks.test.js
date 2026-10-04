import { checkPrice, decimals, ruleFor, ruleGroups, rulesFor } from '../ticks.js';

const RULES = [
    { TradeType: 'ORDERBOOK', InstrumentType: 'SIMPLE', StartPrice: 0, EndPrice: 0.5, PriceStep: 0.0005 },
    { TradeType: 'ORDERBOOK', InstrumentType: 'SIMPLE', StartPrice: 0.5, EndPrice: 10, PriceStep: 0.001 },
    { TradeType: 'ORDERBOOK', InstrumentType: 'SIMPLE', StartPrice: 10, EndPrice: null, PriceStep: 0.01 },
    { TradeType: 'TES', InstrumentType: 'SIMPLE', StartPrice: 0, EndPrice: null, PriceStep: 0.0001 }
];
const book = rulesFor(RULES, { tradeType: 'ORDERBOOK', instrumentType: 'SIMPLE' });

describe('tick rules', () => {
    test('groups by trade type and instrument type', () => {
        expect(ruleGroups(RULES)).toEqual([
            { tradeType: 'ORDERBOOK', instrumentType: 'SIMPLE', count: 3 },
            { tradeType: 'TES', instrumentType: 'SIMPLE', count: 1 }
        ]);
        expect(book).toHaveLength(3);
    });

    test('finds the rule of a price; a boundary belongs to the band that starts there', () => {
        expect(ruleFor(book, 0.25).step).toBe(0.0005);
        expect(ruleFor(book, 0.5).step).toBe(0.001);
        expect(ruleFor(book, 10).step).toBe(0.01);
        expect(ruleFor(book, 5000).step).toBe(0.01); // open ended
    });

    test('the last bounded band includes its end price', () => {
        const rules = rulesFor([{ TradeType: 'A', InstrumentType: 'B', StartPrice: 0, EndPrice: 100, PriceStep: 0.5 }], { tradeType: 'A', instrumentType: 'B' });
        expect(ruleFor(rules, 100).step).toBe(0.5);
        expect(ruleFor(rules, 100.5)).toBeNull();
        expect(ruleFor(rules, -1)).toBeNull();
    });

    test('valid prices lie on the grid, without floating point noise', () => {
        expect(checkPrice(book, 0.3).valid).toBe(true); // 0.3 / 0.0005 is not an exact float division
        expect(checkPrice(book, 0.0015).valid).toBe(true);
        expect(checkPrice(book, 5.123).valid).toBe(true);
        expect(checkPrice(book, 12.34).valid).toBe(true);
    });

    test('invalid prices report the nearest valid ones', () => {
        const r = checkPrice(book, 12.345);
        expect(r.valid).toBe(false);
        expect(r.step).toBe(0.01);
        expect(r.below).toBe(12.34);
        expect(r.above).toBe(12.35);
        const low = checkPrice(book, 0.3003);
        expect([low.below, low.above]).toEqual([0.3, 0.3005]);
    });

    test('a valid price is its own neighbour', () => {
        const r = checkPrice(book, 12.34);
        expect([r.below, r.above]).toEqual([12.34, 12.34]);
    });

    test('a price outside every band has no rule', () => {
        expect(checkPrice([], 5)).toEqual({ rule: null, step: null, valid: false, below: null, above: null });
    });

    test('rows with an unusable step are ignored', () => {
        expect(rulesFor([{ TradeType: 'A', InstrumentType: 'B', StartPrice: 0, EndPrice: null, PriceStep: 0 }, { TradeType: 'A', InstrumentType: 'B', StartPrice: 0, EndPrice: null, PriceStep: null }], { tradeType: 'A', instrumentType: 'B' })).toEqual([]);
    });

    test('decimals', () => {
        expect([decimals(5), decimals(0.0005), decimals(12.345), decimals(1e-7), decimals(1.5e-7)]).toEqual([0, 4, 3, 7, 8]);
    });
});

import { defaultSelection, instrumentTypesOf, normKey, resolveRules, tradeTypesOf } from '../ticks.js';

describe('choosing tick rules', () => {
    const rows = [
        { TradeType: 'EFP', InstrumentType: 'SIMPLE_INSTRUMENT', StartPrice: 0, EndPrice: null, PriceStep: 0.1 },
        { TradeType: 'ORDER_BOOK', InstrumentType: 'STRATEGY', StartPrice: 0, EndPrice: null, PriceStep: 0.5 },
        { TradeType: 'ORDER_BOOK', InstrumentType: 'SIMPLE_INSTRUMENT', StartPrice: 0, EndPrice: 10, PriceStep: 0.5 },
        { TradeType: 'ORDER_BOOK', InstrumentType: 'SIMPLE_INSTRUMENT', StartPrice: 10, EndPrice: null, PriceStep: 1 }
    ];

    test('keys ignore case and separators', () => {
        expect(normKey('ORDER_BOOK')).toBe(normKey('Order book'));
        expect(normKey(null)).toBe('');
    });

    test('order book and simple instrument come first, BLOCK is always offered', () => {
        expect(tradeTypesOf(rows)).toEqual(['ORDER_BOOK', 'BLOCK', 'EFP']);
        expect(instrumentTypesOf(rows)).toEqual(['SIMPLE_INSTRUMENT', 'STRATEGY']);
        expect(defaultSelection(rows)).toEqual({ tradeType: 'ORDER_BOOK', instrumentType: 'SIMPLE_INSTRUMENT' });
    });

    test('BLOCK stays a single entry when the data has it', () => {
        expect(tradeTypesOf([{ TradeType: 'block' }, { TradeType: 'ORDER_BOOK' }])).toEqual(['ORDER_BOOK', 'block']);
    });

    test('a pair with its own rules uses them', () => {
        const r = resolveRules(rows, { tradeType: 'EFP', instrumentType: 'SIMPLE_INSTRUMENT' });
        expect(r.fallback).toBe(false);
        expect(r.rules.map(x => x.step)).toEqual([0.1]);
    });

    test('BLOCK without rules of its own falls back to the order book rules of the instrument type', () => {
        const simple = resolveRules(rows, { tradeType: 'BLOCK', instrumentType: 'SIMPLE_INSTRUMENT' });
        expect(simple).toMatchObject({ fallback: true, tradeType: 'ORDER_BOOK', instrumentType: 'SIMPLE_INSTRUMENT' });
        expect(simple.rules.map(x => x.step)).toEqual([0.5, 1]);
        const strategy = resolveRules(rows, { tradeType: 'BLOCK', instrumentType: 'STRATEGY' });
        expect(strategy.rules.map(x => x.step)).toEqual([0.5]);
    });

    test('with no order book rules for the instrument type, the simple instrument order book rules apply', () => {
        const r = resolveRules(rows, { tradeType: 'EFP', instrumentType: 'STRATEGY_X' });
        expect(r).toMatchObject({ fallback: true, tradeType: 'ORDER_BOOK', instrumentType: 'SIMPLE_INSTRUMENT' });
    });

    test('nothing to fall back to', () => {
        expect(resolveRules([], { tradeType: 'BLOCK', instrumentType: 'X' })).toMatchObject({ rules: [], fallback: false });
    });
});
