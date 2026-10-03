// How values are shown in result tables. Sorting, search, copy and export always use the raw API values;
// this only changes what is drawn. The choice is kept per browser.
const KEY = 'eurexExplorer.display';

export const NUMBER_MODES = {
    auto: 'Browser language',
    en: '1,234.5 (English)',
    de: '1.234,5 (German)',
    raw: 'Raw value'
};
export const DATE_MODES = {
    iso: '2026-12-31 (ISO)',
    dmy: '31.12.2026 (DD.MM.YYYY)'
};

const DEFAULTS = { numbers: 'auto', dates: 'iso' };
let current = { ...DEFAULTS };
const listeners = new Set();

export function loadDisplay(storage = globalThis.localStorage) {
    try {
        const saved = JSON.parse(storage?.getItem(KEY) || '{}');
        current = {
            numbers: saved.numbers in NUMBER_MODES ? saved.numbers : DEFAULTS.numbers,
            dates: saved.dates in DATE_MODES ? saved.dates : DEFAULTS.dates
        };
    } catch (e) {
        current = { ...DEFAULTS };
    }
    return current;
}

export const getDisplay = () => current;

export function setDisplay(patch, storage = globalThis.localStorage) {
    current = { ...current, ...patch };
    try { storage?.setItem(KEY, JSON.stringify(current)); } catch (e) { /* storage unavailable */ }
    listeners.forEach(fn => fn(current));
    return current;
}

export const onDisplayChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// maximumFractionDigits is raised from the default of 3 so that small values (tick sizes such as 0.00005)
// are never rounded away.
export function formatNumber(value, mode = current.numbers) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    if (mode === 'raw') return String(value);
    const locale = mode === 'en' ? 'en-US' : mode === 'de' ? 'de-DE' : undefined;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value);
}

// '2026-12-31' and '2026-12-31T10:00:00' become '31.12.2026' / '31.12.2026 10:00:00' in DD.MM.YYYY mode
export function formatDateString(text, mode = current.dates) {
    if (mode !== 'dmy' || typeof text !== 'string') return text;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](.*))?$/.exec(text);
    if (!m) return text;
    return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4].replace(/Z$/, '') : ''}`;
}
