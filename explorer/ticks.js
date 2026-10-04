// Tick rules: the price step that applies to a price, and whether a price is on the tick grid.
// TickRules rows: { TradeType, InstrumentType, StartPrice, EndPrice, PriceStep }. A rule covers prices from
// StartPrice up to EndPrice (EndPrice excluded when the next rule starts there, included otherwise; an empty
// EndPrice is open-ended). Prices are checked as multiples of PriceStep counted from 0.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Digits after the decimal point of a number as written (1e-7 style included)
export function decimals(n) {
    const s = String(n);
    const exp = /e(-?\d+)$/i.exec(s);
    const mantissa = s.replace(/e.*$/i, '');
    const frac = (mantissa.split('.')[1] || '').length;
    return Math.max(0, frac - (exp ? Number(exp[1]) : 0));
}

// The distinct TradeType / InstrumentType pairs present in the rules
export function ruleGroups(rules) {
    const seen = new Map();
    for (const r of rules || []) {
        const key = `${r.TradeType ?? ''}|${r.InstrumentType ?? ''}`;
        if (!seen.has(key)) seen.set(key, { tradeType: r.TradeType ?? '', instrumentType: r.InstrumentType ?? '', count: 0 });
        seen.get(key).count++;
    }
    return [...seen.values()];
}

// Bands (start, end, step) of the given rows, lowest first; rows without a usable step are ignored
const toBands = (list) => list
    .map(r => ({ start: num(r.StartPrice) ?? -Infinity, end: num(r.EndPrice), step: num(r.PriceStep) }))
    .filter(r => r.step !== null && r.step > 0)
    .sort((a, b) => a.start - b.start);

export function rulesFor(rules, { tradeType, instrumentType }) {
    return toBands((rules || []).filter(r => (r.TradeType ?? '') === tradeType && (r.InstrumentType ?? '') === instrumentType));
}

export function ruleFor(sorted, price) {
    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        if (price < r.start) continue;
        if (r.end === null) return r;
        const nextStartsAtEnd = sorted.some(o => o !== r && o.start === r.end);
        if (nextStartsAtEnd ? price < r.end : price <= r.end) return r;
    }
    return null;
}

// Integer arithmetic on the scaled values avoids binary floating-point noise (0.1 + 0.2)
function scaled(price, step) {
    const d = Math.max(decimals(price), decimals(step));
    const f = 10 ** d;
    return { p: Math.round(price * f), s: Math.round(step * f), f };
}

/**
 * Result for one price: { rule, step, valid, below, above } or { rule: null } when no rule covers the price.
 * below / above are the nearest valid prices around it (both equal the price when it is valid).
 */
export function checkPrice(sorted, price) {
    const rule = ruleFor(sorted, price);
    if (!rule) return { rule: null, step: null, valid: false, below: null, above: null };
    const { p, s, f } = scaled(price, rule.step);
    const rem = ((p % s) + s) % s;
    const valid = rem === 0;
    const below = (p - rem) / f;
    const above = (valid ? p : p - rem + s) / f;
    const round = (n) => Number(n.toFixed(Math.max(decimals(price), decimals(rule.step))));
    return { rule, step: rule.step, valid, below: round(below), above: round(above) };
}

// ---- Choosing which tick rules apply ----

// 'ORDER_BOOK', 'Order book' and 'ORDERBOOK' are the same key
export const normKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isOrderBook = (v) => normKey(v) === 'orderbook';
const isSimpleInstrument = (v) => normKey(v) === 'simpleinstrument';

// Trade types in the data, order book first; BLOCK is always offered (block trades follow the order book rules when
// the product has none of their own)
export function tradeTypesOf(rows) {
    const types = [...new Set((rows || []).map(r => r.TradeType ?? '').filter(Boolean))];
    if (!types.some(t => normKey(t) === 'block')) types.push('BLOCK');
    return types.sort((a, b) => Number(isOrderBook(b)) - Number(isOrderBook(a)) || a.localeCompare(b));
}

// Instrument types in the data, simple instruments first
export function instrumentTypesOf(rows) {
    const types = [...new Set((rows || []).map(r => r.InstrumentType ?? '').filter(Boolean))];
    return types.sort((a, b) => Number(isSimpleInstrument(b)) - Number(isSimpleInstrument(a)) || a.localeCompare(b));
}

// The rules to start with: order book, simple instrument
export function defaultSelection(rows) {
    const trade = tradeTypesOf(rows);
    const instr = instrumentTypesOf(rows);
    return { tradeType: trade[0] ?? '', instrumentType: instr[0] ?? '' };
}

const sameKey = (a, b) => normKey(a) === normKey(b);

/**
 * Tick rules for a trade type and instrument type. When there are none for that pair (typically BLOCK), the order
 * book rules of the same instrument type apply, then the order book rules of the simple instrument.
 * Returns { rules, tradeType, instrumentType, fallback } where tradeType / instrumentType name the rules actually used.
 */
export function resolveRules(rows, { tradeType, instrumentType }) {
    const list = rows || [];
    const pick = (t, i) => toBands(list.filter(r => sameKey(r.TradeType, t) && sameKey(r.InstrumentType, i)));
    const own = pick(tradeType, instrumentType);
    if (own.length) return { rules: own, tradeType, instrumentType, fallback: false };

    const orderBook = list.find(r => isOrderBook(r.TradeType))?.TradeType ?? 'ORDER_BOOK';
    const sameInstrument = pick(orderBook, instrumentType);
    if (sameInstrument.length) return { rules: sameInstrument, tradeType: orderBook, instrumentType, fallback: true };

    const simple = list.find(r => isSimpleInstrument(r.InstrumentType))?.InstrumentType ?? '';
    const base = pick(orderBook, simple);
    return { rules: base, tradeType: orderBook, instrumentType: simple, fallback: base.length > 0 };
}
