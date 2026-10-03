import { allocate, profileGroups, tierFor, tiers } from '../tes.js';

const PROFILES = [
    { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 50, NonDisclosureLimit: 500, MinExpiryRange: 1 },
    { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 10, NonDisclosureLimit: 100, MinExpiryRange: 5 },
    { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 5, NonDisclosureLimit: 50, MinExpiryRange: 9 },
    { TESType: 'BLOCK', InstrumentType: 'STRATEGY', MinLotSize: 1, MinExpiryRange: 0 },
    { TESType: 'EFP', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 2, MinExpiryRange: null }
];
const group = { tesType: 'BLOCK', instrumentType: 'SIMPLE_INSTRUMENT' };

describe('TES tiers', () => {
    test('groups profiles', () => {
        expect(profileGroups(PROFILES).map(g => [g.tesType, g.instrumentType, g.count])).toEqual([
            ['BLOCK', 'SIMPLE_INSTRUMENT', 3], ['BLOCK', 'STRATEGY', 1], ['EFP', 'SIMPLE_INSTRUMENT', 1]
        ]);
    });

    test('tiers are ordered and know where the next one starts', () => {
        const list = tiers([...PROFILES].reverse(), group);
        expect(list.map(t => [t.from, t.to, t.minLotSize])).toEqual([[1, 4, 50], [5, 8, 10], [9, null, 5]]);
    });

    test('an expiration uses the highest tier that starts at or below its index', () => {
        const list = tiers(PROFILES, group);
        expect([1, 4, 5, 8, 9, 40].map(i => tierFor(list, i).minLotSize)).toEqual([50, 50, 10, 10, 5, 5]);
    });

    test('an index below every tier falls back to the first tier, as in the notebook', () => {
        expect(tierFor(tiers(PROFILES, group), 0).minLotSize).toBe(50);
        expect(tierFor([], 3)).toBeNull();
    });

    test('allocates thresholds to expirations in index order', () => {
        const rows = allocate([
            { ExpirationIndex: 6, ExpirationDate: '2027-06-18', MasterContract: 'M6' },
            { ExpirationIndex: 1, ExpirationDate: '2026-12-18', MasterContract: 'M1' },
            { ExpirationIndex: 10, ExpirationDate: '2028-03-17', MasterContract: 'M10' }
        ], tiers(PROFILES, group));
        expect(rows.map(r => [r.expirationIndex, r.expirationDate, r.minLotSize, r.nonDisclosureLimit])).toEqual([
            [1, '2026-12-18', 50, 500], [6, '2027-06-18', 10, 100], [10, '2028-03-17', 5, 50]
        ]);
    });

    test('empty input', () => {
        expect(allocate(null, [])).toEqual([]);
        expect(tiers(null, group)).toEqual([]);
    });
});
