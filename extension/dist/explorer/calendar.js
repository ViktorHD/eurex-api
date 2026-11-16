// Expiry and holiday calendar for a set of products: the request, the events and their calendar-file form.
import { buildIcs } from './ics.js';

export const MAX_PRODUCTS = 25;

// One request for all products: e0/h0 = Expirations/Holidays of the first product, and so on
export function buildCalendarQuery(products) {
    const list = products.slice(0, MAX_PRODUCTS);
    const parts = list.map((p, i) => {
        if (!/^[A-Z0-9_-]{1,32}$/.test(p)) throw new Error(`Invalid product code ${p}`);
        const filter = `filter: { Product: { eq: "${p}" } }`;
        return `  e${i}: Expirations(${filter}) { data { ExpirationIndex ExpirationDate MasterContract } }\n  h${i}: Holidays(${filter}) { data { Holiday } }`;
    });
    return `query {\n${parts.join('\n')}\n}`;
}

const day = (v) => String(v ?? '').slice(0, 10);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Events between `from` and `to` (YYYY-MM-DD, inclusive) from the response of buildCalendarQuery.
 * Returns [{ date, kind: 'expiration' | 'holiday', product, index }] without duplicates, sorted by date.
 */
export function collectEvents(res, products, from, to) {
    const seen = new Set();
    const events = [];
    products.slice(0, MAX_PRODUCTS).forEach((product, i) => {
        for (const row of res?.[`e${i}`]?.data || []) {
            const date = day(row.ExpirationDate);
            const key = `e|${product}|${date}`;
            if (!isDay(date) || date < from || date > to || seen.has(key)) continue;
            seen.add(key);
            events.push({ date, kind: 'expiration', product, index: row.ExpirationIndex ?? null });
        }
        for (const row of res?.[`h${i}`]?.data || []) {
            const date = day(row.Holiday);
            const key = `h|${product}|${date}`;
            if (!isDay(date) || date < from || date > to || seen.has(key)) continue;
            seen.add(key);
            events.push({ date, kind: 'holiday', product, index: null });
        }
    });
    return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.product.localeCompare(b.product));
}

// [{ date, expirations: [{ product, index }], holidays: [product] }] in date order
export function groupByDate(events) {
    const map = new Map();
    for (const e of events) {
        if (!map.has(e.date)) map.set(e.date, { date: e.date, expirations: [], holidays: [] });
        const g = map.get(e.date);
        if (e.kind === 'expiration') g.expirations.push({ product: e.product, index: e.index });
        else g.holidays.push(e.product);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const monthOf = (date) => String(date).slice(0, 7);

const names = (list, max = 4) => list.slice(0, max).join(', ') + (list.length > max ? ` +${list.length - max}` : '');

// One event per day and kind, listing the products
export function toIcs(groups, { name = 'Eurex expirations and holidays', now = new Date() } = {}) {
    const events = [];
    for (const g of groups) {
        if (g.expirations.length) {
            events.push({
                uid: `exp-${g.date}`,
                date: g.date,
                summary: `Expiration: ${names(g.expirations.map(e => e.product))}`,
                description: g.expirations.map(e => `${e.product}${e.index != null ? ` (index ${e.index})` : ''}`).join('\n')
            });
        }
        if (g.holidays.length) {
            events.push({ uid: `hol-${g.date}`, date: g.date, summary: `Holiday: ${names(g.holidays)}`, description: g.holidays.join(', ') });
        }
    }
    return buildIcs(events, { name, now });
}

export function rangeEnd(from, months) {
    const [y, m, d] = from.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + months, d));
    return t.toISOString().slice(0, 10);
}

// ---- Month grid ----

const pad2 = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * Weeks (Monday first) covering month `m` (1-12) of year `y`: [[{ date, day, inMonth, weekend }] x 7] per week,
 * with the days of the neighbouring months that complete the first and last week.
 */
export function monthGrid(y, m) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const weeks = Math.ceil((offset + days) / 7);
    const out = [];
    for (let w = 0; w < weeks; w++) {
        const row = [];
        for (let d = 0; d < 7; d++) {
            const t = new Date(Date.UTC(y, m - 1, 1 - offset + w * 7 + d));
            row.push({
                date: isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
                day: t.getUTCDate(),
                inMonth: t.getUTCMonth() === m - 1,
                weekend: d >= 5
            });
        }
        out.push(row);
    }
    return out;
}

// { y, m } moved by `delta` months
export function shiftMonth({ y, m }, delta) {
    const t = new Date(Date.UTC(y, m - 1 + delta, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}

// Map date -> { date, expirations, holidays } for quick lookup by cell
export const eventsByDate = (events) => new Map(groupByDate(events).map(g => [g.date, g]));
