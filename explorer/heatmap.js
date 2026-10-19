// Calendar heatmap of expirations and exchange holidays: one small month grid per month, days coloured by what
// happens on them. An expiration that falls on an exchange holiday is marked as a clash.
import { el } from './dom.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * expirations: [{ date: 'YYYY-MM-DD', index? }]; holidays: ['YYYY-MM-DD']; today: 'YYYY-MM-DD'.
 * Returns `count` months from the month of `today`: [{ year, month (1-12), title, offset (blank cells before day 1,
 * Monday first), days: [{ day, iso, kind: '' | 'exp' | 'hol' | 'both', weekend, today, title }] }].
 */
export function calendarMonths({ expirations = [], holidays = [], today, count = 12 }) {
    const exp = new Map();
    expirations.forEach(e => { if (e?.date) exp.set(String(e.date).slice(0, 10), e); });
    const hol = new Set(holidays.map(d => String(d).slice(0, 10)));
    const [ty, tm] = today.split('-').map(Number);
    const months = [];
    for (let i = 0; i < count; i++) {
        const first = new Date(Date.UTC(ty, tm - 1 + i, 1));
        const year = first.getUTCFullYear();
        const month = first.getUTCMonth() + 1;
        const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const days = [];
        for (let day = 1; day <= length; day++) {
            const iso = `${year}-${pad(month)}-${pad(day)}`;
            const e = exp.get(iso);
            const h = hol.has(iso);
            const kind = e && h ? 'both' : e ? 'exp' : h ? 'hol' : '';
            const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            const parts = [];
            if (e) parts.push(`expiration${e.index !== null && e.index !== undefined ? ` (index ${e.index})` : ''}`);
            if (h) parts.push('exchange holiday');
            days.push({ day, iso, kind, weekend: dow === 0 || dow === 6, today: iso === today, title: `${iso}${parts.length ? `: ${parts.join(', ')}` : ''}` });
        }
        months.push({ year, month, title: `${MONTHS[month - 1]} ${year}`, offset: (first.getUTCDay() + 6) % 7, days });
    }
    return months;
}

/** Number of days of each kind in the given months */
export function countKinds(months) {
    const n = { exp: 0, hol: 0, both: 0 };
    months.forEach(m => m.days.forEach(d => { if (d.kind) n[d.kind]++; }));
    return n;
}

export function renderHeatmap(months) {
    const root = el('div', 'hm');
    const counts = countKinds(months);
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', `Calendar of ${months.length} months: ${counts.exp + counts.both} expirations, ${counts.hol + counts.both} exchange holidays, ${counts.both} on the same day`);
    months.forEach(m => {
        const box = el('div', 'hm-month');
        box.appendChild(el('div', 'hm-title', m.title));
        const grid = el('div', 'hm-grid');
        WEEKDAYS.forEach(w => { const h = el('span', 'hm-wd', w); h.setAttribute('aria-hidden', 'true'); grid.appendChild(h); });
        for (let i = 0; i < m.offset; i++) grid.appendChild(el('span', 'hm-blank'));
        m.days.forEach(d => {
            const c = el('span', `hm-day${d.kind ? ` ${d.kind}` : ''}${d.weekend ? ' we' : ''}${d.today ? ' today' : ''}`, String(d.day));
            c.title = d.title;
            if (d.kind) c.setAttribute('aria-label', d.title);
            grid.appendChild(c);
        });
        box.appendChild(grid);
        root.appendChild(box);
    });
    return root;
}
