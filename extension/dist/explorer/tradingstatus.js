// Is a product trading right now? Pure helpers shared by the Trading Hours view and the Product card.
// Eurex times are CET/CEST (Europe/Berlin).

export function resolveTz(tz) {
    if (tz === 'LOCAL') return Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'CET') return 'Europe/Berlin';
    if (tz === 'SGT') return 'Asia/Singapore';
    if (tz === 'CST') return 'America/Chicago';
    return 'UTC';
}

// Current wall-clock time in a timezone: { minutes, weekday (0 = Sunday) }
export function nowIn(tz, now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTz(tz), hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    }).formatToParts(now);
    const get = (t) => parts.find(p => p.type === t)?.value;
    const hour = Number(get('hour')) % 24;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { minutes: hour * 60 + Number(get('minute')), weekday };
}

export function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

export function inRange(mins, start, end) {
    const s = timeToMinutes(start);
    const e = timeToMinutes(end);
    if (s === null || e === null) return false;
    return s <= e ? (mins >= s && mins < e) : (mins >= s || mins < e);
}

// Calendar date (YYYY-MM-DD) in Eurex time
export function cetDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// 'open', 'tes' (only TES), 'closed' or 'holiday'. `hours` may be one hour set or a list (open if any is);
// `holidays` the product's holiday dates (sorted ISO strings).
export function getStatus(hours, now = new Date(), holidays = null) {
    const sets = (Array.isArray(hours) ? hours : [hours]).filter(Boolean);
    if (!sets.length) return 'closed';
    const { minutes, weekday } = nowIn('CET', now);
    if (weekday === 0 || weekday === 6) return 'closed';
    if (holidays && holidays.length && holidays.includes(cetDate(now))) return 'holiday';
    if (sets.some(h => inRange(minutes, h.StartContinuousTrading, h.EndContinuousTrading))) return 'open';
    if (sets.some(h => inRange(minutes, h.StartTES, h.EndTES))) return 'tes';
    return 'closed';
}

// First holiday after today (YYYY-MM-DD), or null
export function nextHoliday(holidays, now = new Date()) {
    const today = cetDate(now);
    return (holidays || []).find(d => d > today) || null;
}

// Product -> sorted ISO dates (YYYY-MM-DD); rows without a usable date are ignored
export function buildHolidayMap(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
        const day = String(r.Holiday ?? '').slice(0, 10);
        if (!r.Product || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        if (!map.has(r.Product)) map.set(r.Product, new Set());
        map.get(r.Product).add(day);
    });
    return new Map([...map].map(([product, days]) => [product, [...days].sort()]));
}

export const STATUS_LABELS = {
    open: 'Continuous trading now',
    tes: 'TES only now',
    closed: 'Closed now',
    holiday: 'Holiday today: no trading'
};
