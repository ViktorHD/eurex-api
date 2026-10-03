// Products a user follows. Stored per browser; other views read it (Strike Window, Trading Hours, Calendar, Changelog).
const KEY = 'eurexExplorer.watchlist';
const MAX = 100;

let items = null; // loaded lazily so tests can inject storage
const listeners = new Set();

export const normalizeProduct = (code) => String(code ?? '').trim().toUpperCase();
export const isProductCode = (code) => /^[A-Z0-9_-]{1,32}$/.test(code);

function read(storage) {
    try {
        const list = JSON.parse(storage?.getItem(KEY) || '[]');
        return Array.isArray(list) ? [...new Set(list.map(normalizeProduct).filter(isProductCode))].slice(0, MAX) : [];
    } catch (e) {
        return [];
    }
}

function write(storage) {
    try { storage?.setItem(KEY, JSON.stringify(items)); } catch (e) { /* storage unavailable */ }
    listeners.forEach(fn => fn([...items]));
}

export function getWatchlist(storage = globalThis.localStorage) {
    if (items === null) items = read(storage);
    return [...items];
}

export function isWatched(code, storage) {
    return getWatchlist(storage).includes(normalizeProduct(code));
}

// Adds or removes a product; returns whether it is on the list afterwards (false for invalid codes or a full list)
export function toggleWatched(code, storage = globalThis.localStorage) {
    const c = normalizeProduct(code);
    getWatchlist(storage);
    if (items.includes(c)) {
        items = items.filter(x => x !== c);
        write(storage);
        return false;
    }
    if (!isProductCode(c) || items.length >= MAX) return false;
    items = [...items, c];
    write(storage);
    return true;
}

export function setWatchlist(codes, storage = globalThis.localStorage) {
    items = [...new Set((codes || []).map(normalizeProduct).filter(isProductCode))].slice(0, MAX);
    write(storage);
}

export const onWatchlistChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Test helper: forget the cached list so the next read goes to storage
export const resetWatchlistCache = () => { items = null; };
