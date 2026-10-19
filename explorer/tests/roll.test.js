/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { isRollProduct, rollShare, rollStatus, rollSnapshot, recordSnapshot, loadHistory, cycleEntries, pace, daysToComplete } from '../roll.js';
import { RollView } from '../rollview.js';
import { resetProductCatalog } from '../catalog.js';

const rows = [
    { Contract: 'FESX Dec 2026', ExpirationDate: '2026-12-18', OpenInterest: 600, CallPut: null },
    { Contract: 'FESX Mar 2027', ExpirationDate: '2027-03-19', OpenInterest: 400, CallPut: null },
    { Contract: 'FESX Jun 2027', ExpirationDate: '2027-06-18', OpenInterest: 0, CallPut: '' },
    { Contract: 'OESX Dec 2026 C 5000', ExpirationDate: '2026-12-18', OpenInterest: 9999, CallPut: 'C' },
    { Contract: 'FESX Sep 2026', ExpirationDate: '2026-09-18', OpenInterest: 50, CallPut: null }
];

describe('products and shares', () => {
    test('index and fixed income futures only', () => {
        expect(isRollProduct({ ProductType: 'INDEX FUTURES' })).toBe(true);
        expect(isRollProduct({ ProductType: 'Fixed Income Futures' })).toBe(true);
        expect(isRollProduct({ ProductType: 'INTEREST RATE FUTURES' })).toBe(true);
        expect(isRollProduct({ ProductType: 'INDEX OPTIONS' })).toBe(false);
        expect(isRollProduct({ ProductType: 'INDEX DIVIDEND FUTURES' })).toBe(false);
        expect(isRollProduct({})).toBe(false);
    });
    test('roll share and status', () => {
        expect(rollShare(600, 400)).toBe(0.4);
        expect(rollShare(0, 0)).toBeNull();
        expect(rollStatus(0.05).key).toBe('early');
        expect(rollStatus(0.4).key).toBe('rolling');
        expect(rollStatus(0.7).key).toBe('late');
        expect(rollStatus(0.95).key).toBe('done');
        expect(rollStatus(null).key).toBe('none');
    });
});

describe('rollSnapshot', () => {
    test('uses upcoming futures only, nearest first', () => {
        const s = rollSnapshot(rows, '2026-10-19');
        expect(s.contracts.map(c => c.label)).toEqual(['FESX Dec 2026', 'FESX Mar 2027', 'FESX Jun 2027']);
        expect(s.front.daysLeft).toBe(60);
        expect(s.total).toBe(1000);
        expect(s.share).toBe(0.4);
        expect(s.contracts[0].share).toBe(0.6);
    });
    test('returns null without futures and a null share for a single one', () => {
        expect(rollSnapshot([], '2026-10-19')).toBeNull();
        expect(rollSnapshot(rows.slice(3, 4), '2026-10-19')).toBeNull();
        expect(rollSnapshot(rows.slice(0, 1), '2026-10-19').share).toBeNull();
    });
});

describe('history and pace', () => {
    const snap = (a, b) => rollSnapshot([rows[0], { ...rows[1] }].map((r, i) => ({ ...r, OpenInterest: i ? b : a })), '2026-10-19');
    test('records one entry per date and keeps them sorted', () => {
        localStorage.clear();
        recordSnapshot('FESX', snap(900, 100), '2026-12-02');
        recordSnapshot('FESX', snap(700, 300), '2026-12-04');
        const h = recordSnapshot('FESX', snap(600, 400), '2026-12-04');
        expect(h.map(e => e.date)).toEqual(['2026-12-02', '2026-12-04']);
        expect(loadHistory('FESX')).toHaveLength(2);
        expect(h[1].share).toBe(0.4);
    });
    test('pace in percentage points per day within a cycle', () => {
        const entries = [{ date: '2026-12-02', share: 0.1, front: 'A' }, { date: '2026-12-04', share: 0.4, front: 'A' }];
        expect(pace(entries)).toBeCloseTo(15);
        expect(pace(entries.slice(0, 1))).toBeNull();
        expect(cycleEntries([...entries, { date: '2026-12-05', share: 0.9, front: 'B' }], 'A')).toHaveLength(2);
        expect(daysToComplete(0.4, 15)).toBe(4);
        expect(daysToComplete(0.4, -2)).toBeNull();
        expect(daysToComplete(1, 5)).toBe(0);
    });
    test('ignores broken storage', () => {
        localStorage.setItem('eurexExplorer.roll.X', '{nope');
        expect(loadHistory('X')).toEqual([]);
    });
});

describe('RollView', () => {
    const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 130 * 86400000).toISOString().slice(0, 10);
    const make = (schema) => {
        document.body.innerHTML = '<div id="c"></div>';
        resetProductCatalog();
        const client = {
            endpoint: 'e', apiKey: 'k',
            request: jest.fn(async (q) => {
                if (q.includes('ProductInfos')) return { data: [{ Product: 'FESX', Name: 'Euro STOXX 50', ProductType: 'INDEX FUTURES', ProductLine: 'Equity Index' }, { Product: 'OESX', ProductType: 'INDEX OPTIONS' }, { Product: 'FGBL', Name: 'Bund', ProductType: 'FIXED INCOME FUTURES', ProductLine: 'Euro Bond' }, { Product: 'FXXP', ProductType: 'INDEX FUTURES' }] };
                return { Contracts: { date: '2026-10-19', data: [
                    { Contract: 'A', ExpirationDate: future, OpenInterest: 700, CallPut: null },
                    { Contract: 'B', ExpirationDate: later, OpenInterest: 300, CallPut: null }] } };
            })
        };
        const view = new RollView(client, { content: document.getElementById('c') }, { getSchema: async () => schema, onOpenProduct: jest.fn() });
        return { view, client, box: document.getElementById('c') };
    };
    const wait = () => new Promise(r => setTimeout(r, 0));
    const schemaWith = (fields) => ({ queryType: { name: 'Query' }, types: [
        { kind: 'OBJECT', name: 'Query', fields: [{ name: 'Contracts', args: [], type: { kind: 'OBJECT', name: 'ContractsResponse' } }] },
        { kind: 'OBJECT', name: 'ContractsResponse', fields: [{ name: 'date', args: [], type: { kind: 'SCALAR', name: 'String' } }, { name: 'data', args: [], type: { kind: 'LIST', ofType: { kind: 'OBJECT', name: 'Contract' } } }] },
        { kind: 'OBJECT', name: 'Contract', fields: fields.map(n => ({ name: n, args: [], type: { kind: 'SCALAR', name: 'String' } })) },
        { kind: 'SCALAR', name: 'String' }
    ] });

    beforeEach(() => localStorage.clear());

    test('lists only index and fixed income futures and draws the roll', async () => {
        const { view, client, box } = make(schemaWith(['Contract', 'ExpirationDate', 'CallPut', 'OpenInterest']));
        await view.show();
        await wait();
        const types = box.querySelectorAll('select')[0];
        const products = box.querySelectorAll('select')[1];
        expect([...types.options].map(o => o.value)).toEqual(['FIXED INCOME FUTURES', 'INDEX FUTURES']);
        expect(types.value).toBe('INDEX FUTURES');
        expect([...products.querySelectorAll('optgroup')].map(g => g.label)).toEqual(['Equity Index', 'INDEX FUTURES']);
        expect([...products.options].map(o => o.value)).toEqual(['FESX', 'FXXP']);
        expect(client.request.mock.calls[1][0]).toContain('Contracts(filter: { Product: { eq: "FESX" } })');
        expect(client.request.mock.calls[1][0]).toContain('OpenInterest');
        expect(box.querySelector('.rt-status').textContent).toContain('Rolling');
        expect(box.querySelectorAll('.rt-seg')).toHaveLength(2);
        expect(box.querySelectorAll('.rt-table tbody tr')).toHaveLength(2);
        expect(box.textContent).toContain('30.0%');
    });

    test('choosing another product type lists its futures and loads the first', async () => {
        const { view, client, box } = make(schemaWith(['Contract', 'ExpirationDate', 'CallPut', 'OpenInterest']));
        await view.show();
        await wait();
        const [types, products] = box.querySelectorAll('select');
        types.value = 'FIXED INCOME FUTURES';
        types.dispatchEvent(new Event('change'));
        for (let i = 0; i < 5; i++) await wait();
        expect([...products.options].map(o => o.value)).toEqual(['FGBL']);
        expect(products.querySelector('optgroup').label).toBe('Euro Bond');
        expect(client.request.mock.calls.at(-1)[0]).toContain('"FGBL"');
    });

    test('says so when Contracts has no OpenInterest', async () => {
        const { view, client, box } = make(schemaWith(['Contract', 'ExpirationDate']));
        await view.show();
        await wait();
        expect(box.querySelector('.pc-empty.bad').textContent).toContain('no OpenInterest');
        expect(client.request.mock.calls.every(c => !c[0].includes('Contracts('))).toBe(true);
    });
});
