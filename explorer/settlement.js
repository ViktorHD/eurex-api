// Settlement price history: rows from SettlementPrices grouped per contract and price type.
// Row: { ContractID, ContractType, PriceType, SettlementPrice, SettlementDate }

// Contracts that have prices: [{ key, contractId, contractType, label, expiration, count, last }] sorted by expiration
// (contracts without one last). contracts: [{ ContractID, Contract, ExpirationDate }] supply the labels.
export function groupSettlement(rows, contracts = []) {
    const byId = new Map((contracts || []).map(c => [String(c.ContractID), c]));
    const groups = new Map();
    for (const r of rows || []) {
        if (r.ContractID === null || r.ContractID === undefined) continue;
        const key = `${r.ContractType ?? ''}|${r.ContractID}`;
        if (!groups.has(key)) {
            const c = byId.get(String(r.ContractID));
            groups.set(key, {
                key,
                contractId: r.ContractID,
                contractType: r.ContractType ?? '',
                label: c?.Contract || String(r.ContractID),
                expiration: c?.ExpirationDate || null,
                count: 0,
                last: null,
                priceTypes: new Set()
            });
        }
        const g = groups.get(key);
        g.count++;
        if (r.PriceType) g.priceTypes.add(r.PriceType);
        if (r.SettlementDate && (!g.last || r.SettlementDate > g.last)) g.last = r.SettlementDate;
    }
    return [...groups.values()]
        .map(g => ({ ...g, priceTypes: [...g.priceTypes].sort() }))
        .sort((a, b) => (a.expiration ? 0 : 1) - (b.expiration ? 0 : 1)
            || String(a.expiration).localeCompare(String(b.expiration))
            || String(a.label).localeCompare(String(b.label)));
}

// Time series [{ x: 'YYYY-MM-DD', y }] of one contract (and price type), one point per date, oldest first
export function seriesFor(rows, key, priceType = '') {
    const byDate = new Map();
    for (const r of rows || []) {
        if (`${r.ContractType ?? ''}|${r.ContractID}` !== key) continue;
        if (priceType && r.PriceType !== priceType) continue;
        const y = Number(r.SettlementPrice);
        if (r.SettlementDate && Number.isFinite(y) && r.SettlementPrice !== null && r.SettlementPrice !== '') byDate.set(String(r.SettlementDate).slice(0, 10), y);
    }
    return [...byDate].map(([x, y]) => ({ x, y })).sort((a, b) => a.x.localeCompare(b.x));
}

export function seriesStats(series) {
    if (!series.length) return null;
    const ys = series.map(p => p.y);
    return { count: series.length, first: series[0], last: series[series.length - 1], min: Math.min(...ys), max: Math.max(...ys) };
}
