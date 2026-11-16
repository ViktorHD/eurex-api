import { buildHolidayMap } from './tradingstatus.js';

// Profile of a product for the radar chart on the product card, derived only from data the card has already loaded.
// Every axis has a fixed scale (1 = outer ring) so products can be compared with each other.
// Axes without data are left out.

const toHours = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};

// Length of a window in hours, across midnight when the end is not after the start
export function windowHours(from, to) {
    const a = toHours(from);
    const b = toHours(to);
    if (a === null || b === null) return null;
    return b > a ? b - a : b + 24 - a;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const EXPIRATION_CAP = 24; // upcoming expirations at the outer ring
export const HOLIDAY_CAP = 15; // exchange holidays in the next year at the inner (worst) ring
export const LOT_DECADES = 4; // block trade minimum lot size of 10,000 contracts or more scores 0

/**
 * input: { hours: TradingHours row, tes: TESProfiles rows, ticks: TickRules rows, expirations: [ISO date],
 * holidays: [ISO date], today: ISO date }. Returns [{ key, label, value (0..1), text }].
 */
export function profileAxes({ hours, tes, ticks, expirations, holidays, today }) {
    const axes = [];
    const add = (key, label, value, text) => { if (value !== null && Number.isFinite(value)) axes.push({ key, label, value: clamp01(value), text }); };

    const book = hours ? windowHours(hours.StartContinuousTrading, hours.EndContinuousTrading) : null;
    if (book !== null) add('book', 'Trading day', book / 24, `${book.toFixed(1)} h continuous trading`);

    const offBook = hours ? windowHours(hours.StartTES, hours.EndTES) : null;
    if (offBook !== null) add('tes-window', 'TES window', offBook / 24, `${offBook.toFixed(1)} h TES entry`);

    if (expirations) {
        const upcoming = expirations.filter(d => d >= today).length;
        add('depth', 'Expiry depth', upcoming / EXPIRATION_CAP, `${plural(upcoming, 'upcoming expiration')}`);
    }

    if (holidays) {
        const end = new Date(Date.parse(today) + 365 * 86400000).toISOString().slice(0, 10);
        const closed = holidays.filter(d => d >= today && d <= end).length;
        add('open', 'Open days', 1 - closed / HOLIDAY_CAP, `${plural(closed, 'exchange holiday')} in the next 12 months`);
    }

    if (tes?.length) {
        const lots = tes.filter(r => r.TESType === 'BLOCK' && Number(r.MinLotSize) > 0).map(r => Number(r.MinLotSize));
        if (lots.length) {
            const lot = Math.min(...lots);
            add('block', 'Block access', 1 - Math.log10(lot) / LOT_DECADES, `block trades from ${lot.toLocaleString('en-US')} contracts`);
        }
        const types = new Set(tes.map(r => r.TESType).filter(Boolean));
        add('tes-types', 'TES types', types.size / 6, `${plural(types.size, 'TES type')}: ${[...types].join(', ')}`);
    }

    if (ticks?.length) {
        const bands = new Set(ticks.filter(r => r.TradeType === 'ORDER_BOOK' || !r.TradeType).map(r => `${r.StartPrice}|${r.PriceStep}`)).size;
        if (bands) add('ticks', 'Tick bands', 1 - (bands - 1) / 5, `${plural(bands, 'order book tick band')}${bands === 1 ? ' (one tick size)' : ''}`);
    }
    return axes;
}

/** The axes of one product from its loaded card data ({ TradingHours, TESProfiles, TickRules, Expirations, Holidays }). */
export function axesFromData(data, product, today) {
    const exps = data.Expirations;
    return profileAxes({
        hours: data.TradingHours?.[0],
        tes: data.TESProfiles,
        ticks: data.TickRules,
        expirations: exps ? exps.map(e => String(e.ExpirationDate || '').slice(0, 10)).filter(Boolean) : null,
        holidays: data.Holidays ? buildHolidayMap(data.Holidays.map(r => ({ ...r, Product: product }))).get(product) || [] : null,
        today
    });
}

/** Axes both products have, each carrying the second product's value as `compare`. */
export function compareAxes(first, second) {
    const other = new Map(second.map(a => [a.key, a]));
    return first.filter(a => other.has(a.key)).map(a => ({ ...a, compare: { value: other.get(a.key).value, text: other.get(a.key).text } }));
}
