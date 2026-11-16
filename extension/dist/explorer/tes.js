// TES (T7 Entry Service) block-trade thresholds per expiration.
// TESProfiles carry MinLotSize / NonDisclosureLimit per product and, for simple instruments, per expiry range:
// MinExpiryRange is the expiration index (1 = front expiry) FROM which a threshold applies, until the next
// threshold starts. The same rule as in the "FAQ cases" notebook.

const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

// Distinct TESType / InstrumentType pairs present in the profiles
export function profileGroups(profiles) {
    const seen = new Map();
    for (const p of profiles || []) {
        const key = `${p.TESType ?? ''}|${p.InstrumentType ?? ''}`;
        if (!seen.has(key)) seen.set(key, { tesType: p.TESType ?? '', instrumentType: p.InstrumentType ?? '', count: 0 });
        seen.get(key).count++;
    }
    return [...seen.values()];
}

// Profiles of one group ordered by start of range, with the end of each range (null = open ended)
export function tiers(profiles, { tesType, instrumentType }) {
    const list = (profiles || [])
        .filter(p => (p.TESType ?? '') === tesType && (p.InstrumentType ?? '') === instrumentType)
        .sort((a, b) => n(a.MinExpiryRange) - n(b.MinExpiryRange));
    return list.map((p, i) => ({
        from: n(p.MinExpiryRange),
        to: i + 1 < list.length ? n(list[i + 1].MinExpiryRange) - 1 : null,
        minLotSize: p.MinLotSize ?? null,
        minLotSizeNonPrimary: p.MinLotSizeNonPrimary ?? null,
        nonDisclosureLimit: p.NonDisclosureLimit ?? null,
        profile: p
    }));
}

// The tier for an expiration index: the one with the highest start not above the index,
// the first tier when the index is below all of them (as in the notebook)
export function tierFor(tierList, expirationIndex) {
    if (!tierList.length) return null;
    let found = null;
    for (const t of tierList) if (expirationIndex >= t.from) found = t;
    return found || tierList[0];
}

/**
 * Expirations with the thresholds that apply to each: [{ expirationIndex, expirationDate, masterContract, ...tier }]
 */
export function allocate(expirations, tierList) {
    return (expirations || [])
        .map(e => ({ idx: n(e.ExpirationIndex), e }))
        .sort((a, b) => a.idx - b.idx || String(a.e.ExpirationDate).localeCompare(String(b.e.ExpirationDate)))
        .map(({ idx, e }) => {
            const t = tierFor(tierList, idx);
            return {
                expirationIndex: idx,
                expirationDate: e.ExpirationDate ?? null,
                masterContract: e.MasterContract ?? null,
                minLotSize: t?.minLotSize ?? null,
                minLotSizeNonPrimary: t?.minLotSizeNonPrimary ?? null,
                nonDisclosureLimit: t?.nonDisclosureLimit ?? null
            };
        });
}
