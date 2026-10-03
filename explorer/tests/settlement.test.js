import { groupSettlement, seriesFor, seriesStats } from '../settlement.js';

const ROWS = [
    { ContractID: 2, ContractType: 'STANDARD', PriceType: 'DAILY', SettlementPrice: 5510, SettlementDate: '2026-10-02' },
    { ContractID: 2, ContractType: 'STANDARD', PriceType: 'DAILY', SettlementPrice: 5500, SettlementDate: '2026-10-01' },
    { ContractID: 2, ContractType: 'STANDARD', PriceType: 'FINAL', SettlementPrice: 5499, SettlementDate: '2026-10-01' },
    { ContractID: 1, ContractType: 'STANDARD', PriceType: 'DAILY', SettlementPrice: 5400, SettlementDate: '2026-10-02' },
    { ContractID: 9, ContractType: 'FLEXIBLE', PriceType: 'DAILY', SettlementPrice: null, SettlementDate: '2026-10-02' },
    { ContractID: null, SettlementPrice: 1 }
];
const CONTRACTS = [
    { ContractID: 1, Contract: 'FESX 202612', ExpirationDate: '2026-12-18' },
    { ContractID: 2, Contract: 'FESX 202609', ExpirationDate: '2026-09-18' }
];

describe('groupSettlement', () => {
    test('one entry per contract and type, labelled and ordered by expiration', () => {
        const g = groupSettlement(ROWS, CONTRACTS);
        expect(g.map(x => [x.label, x.contractType, x.count, x.last])).toEqual([
            ['FESX 202609', 'STANDARD', 3, '2026-10-02'],
            ['FESX 202612', 'STANDARD', 1, '2026-10-02'],
            ['9', 'FLEXIBLE', 1, '2026-10-02']
        ]);
        expect(g[0].priceTypes).toEqual(['DAILY', 'FINAL']);
    });
    test('works without contract labels and with empty input', () => {
        expect(groupSettlement(ROWS.slice(0, 1))[0].label).toBe('2');
        expect(groupSettlement(null)).toEqual([]);
    });
});

describe('seriesFor', () => {
    test('points of one contract sorted by date; a price type narrows them', () => {
        expect(seriesFor(ROWS, 'STANDARD|2')).toEqual([{ x: '2026-10-01', y: 5499 }, { x: '2026-10-02', y: 5510 }]);
        expect(seriesFor(ROWS, 'STANDARD|2', 'DAILY')).toEqual([{ x: '2026-10-01', y: 5500 }, { x: '2026-10-02', y: 5510 }]);
    });
    test('missing prices are skipped', () => {
        expect(seriesFor(ROWS, 'FLEXIBLE|9')).toEqual([]);
        expect(seriesFor(ROWS, 'nope')).toEqual([]);
    });
    test('stats', () => {
        expect(seriesStats(seriesFor(ROWS, 'STANDARD|2', 'DAILY'))).toMatchObject({ count: 2, min: 5500, max: 5510, last: { x: '2026-10-02', y: 5510 } });
        expect(seriesStats([])).toBeNull();
    });
});
