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

export function rulesFor(rules, { tradeType, instrumentType }) {
    return (rules || [])
        .filter(r => (r.TradeType ?? '') === tradeType && (r.InstrumentType ?? '') === instrumentType)
        .map(r => ({ start: num(r.StartPrice) ?? -Infinity, end: num(r.EndPrice), step: num(r.PriceStep) }))
        .filter(r => r.step !== null && r.step > 0)
        .sort((a, b) => a.start - b.start);
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
