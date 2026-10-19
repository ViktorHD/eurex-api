// Roll tracker logic: how far open interest has moved from the front future to the next one.
// Contract row: { Contract, ContractDate?, ExpirationDate, LastTradingDate?, CallPut?, ContractCycle?, OpenInterest }

// Futures are the products of product line "Future". Options are told apart by their product type code (O...), as in
// the Strike Window; a product without a product line is judged by its type code (F...).
const isOptionCode = (p) => String(p?.ProductTypeCode || '').toUpperCase().startsWith('O');

export const isRollProduct = (p) => {
    if (!p || isOptionCode(p)) return false;
    const line = String(p.ProductLine || '').trim().toUpperCase();
    if (line) return line === 'FUTURE' || line === 'FUTURES';
    return String(p.ProductTypeCode || '').toUpperCase().startsWith('F');
};

// Why a typed product code cannot be tracked, or '' when it can. catalog: all products.
export function rejectReason(code, catalog) {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c) return '';
    if (!/^[A-Z0-9_-]{1,32}$/.test(c)) return 'Product codes contain only letters, digits, "-" or "_" (e.g. FESX).';
    const p = (catalog || []).find(x => x.Product === c);
    if (!p) return `No product ${c} was found.`;
    if (isOptionCode(p)) return `${c} is an options product. The roll tracker covers futures only; options have a Strike Window.`;
    if (!isRollProduct(p)) return `${c} is not a future${p.ProductLine ? ` (product line ${p.ProductLine})` : ''}. The roll tracker covers futures only.`;
    return '';
}

// Share of the next future in front + next open interest: 0 = nothing rolled yet, 1 = fully rolled
export const rollShare = (frontOi, nextOi) => (frontOi + nextOi > 0 ? nextOi / (frontOi + nextOi) : null);

export function rollStatus(share) {
    if (share === null || share === undefined) return { key: 'none', label: 'No open interest' };
    if (share < 0.1) return { key: 'early', label: 'Roll not started' };
    if (share < 0.5) return { key: 'rolling', label: 'Rolling' };
    if (share < 0.9) return { key: 'late', label: 'Mostly rolled' };
    return { key: 'done', label: 'Rolled' };
}

const dayNumber = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
};

// Primary contracts are the regular listings (monthly, quarterly, yearly cycle). Dailies, weeklies and flexible
// contracts are rolled differently and would distort the front / next split. Rows without a cycle count as primary.
const NON_PRIMARY = /DAIL|DAY|WEEK|FLEX/;
export const isPrimaryContract = (row) => !NON_PRIMARY.test(String(row?.ContractCycle || '').toUpperCase());

/**
 * Open interest per upcoming primary future, nearest expiry first.
 * Returns null when no future with open interest is left; otherwise
 * { excluded (daily / weekly / flexible contracts left out), contracts: [{ label, expiration, daysLeft, oi, share }], front, next, total, share (next / (front + next)) }.
 */
export function rollSnapshot(rows, today) {
    const futuresAll = (rows || []).filter(r => !r.CallPut);
    const futures = futuresAll
        .filter(isPrimaryContract)
        .map(r => ({ label: r.Contract || String(r.ContractDate || ''), expiration: String(r.ExpirationDate || r.LastTradingDate || '').slice(0, 10), oi: Number(r.OpenInterest) }))
        .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.expiration) && r.expiration >= today && Number.isFinite(r.oi) && r.oi >= 0)
        .sort((a, b) => a.expiration.localeCompare(b.expiration));
    if (!futures.length) return null;
    const total = futures.reduce((s, r) => s + r.oi, 0);
    const contracts = futures.map(r => ({ ...r, daysLeft: dayNumber(r.expiration) - dayNumber(today), share: total > 0 ? r.oi / total : 0 }));
    const front = contracts[0];
    const next = contracts[1] || null;
    const excluded = futuresAll.length - futuresAll.filter(isPrimaryContract).length;
    return { excluded, contracts, front, next, total, share: next ? rollShare(front.oi, next.oi) : null };
}

// ---------- History: the API gives today's open interest, so the pace is built from the days seen in this browser ----------

const KEY = (product) => `eurexExplorer.roll.${product}`;
const MAX_ENTRIES = 120;

export function loadHistory(product, storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(KEY(product)) || '[]');
        return Array.isArray(list) ? list.filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(e.share)) : [];
    } catch (e) { return []; }
}

// Adds (or replaces) the entry of the data date; returns the history, oldest first
export function recordSnapshot(product, snapshot, date, storage = globalThis.localStorage) {
    const list = loadHistory(product, storage);
    if (snapshot?.next && Number.isFinite(snapshot.share) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const entry = { date, front: snapshot.front.label, frontOi: snapshot.front.oi, nextOi: snapshot.next.oi, share: snapshot.share };
        const at = list.findIndex(e => e.date === date);
        if (at >= 0) list[at] = entry; else list.push(entry);
        list.sort((a, b) => a.date.localeCompare(b.date));
        try { storage?.setItem(KEY(product), JSON.stringify(list.slice(-MAX_ENTRIES))); } catch (e) { /* storage unavailable */ }
    }
    return list.slice(-MAX_ENTRIES);
}

// Entries of the current roll cycle (same front contract), oldest first
export const cycleEntries = (history, frontLabel) => history.filter(e => e.front === frontLabel);

// Percentage points rolled per calendar day over the cycle; null with fewer than two different days
export function pace(entries) {
    if (entries.length < 2) return null;
    const first = entries[0];
    const last = entries[entries.length - 1];
    const days = dayNumber(last.date) - dayNumber(first.date);
    return days > 0 ? ((last.share - first.share) * 100) / days : null;
}

// Days until half / all of the open interest has rolled at the current pace; null when it is not moving forward
export function daysToComplete(share, perDay, target = 1) {
    if (!Number.isFinite(perDay) || perDay <= 0 || share === null) return null;
    return share >= target ? 0 : Math.ceil(((target - share) * 100) / perDay);
}
