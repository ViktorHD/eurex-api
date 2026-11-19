import { TEMPLATES, templateById, templatesFor, productKind, tesSupport, tesMinimums, buildLegs, legFromContract, newLegId } from '../strategies.js';
import { contractOptions } from '../payoff.js';
import { buildInfoQuery, buildContractsQuery, isProductCode } from '../strategyquery.js';
import { buildSchemaIndex } from '../schemacheck.js';

const rows = [];
for (const k of [4800, 4900, 5000, 5100, 5200]) {
    rows.push({ Contract: `C${k}`, ExpirationDate: '2026-12-18', CallPut: 'C', Strike: k, SettlementPrice: Math.max(5000 - k, 0) + 50 });
    rows.push({ Contract: `P${k}`, ExpirationDate: '2026-12-18', CallPut: 'P', Strike: k, SettlementPrice: Math.max(k - 5000, 0) + 50 });
    rows.push({ Contract: `C${k}b`, ExpirationDate: '2027-03-19', CallPut: 'C', Strike: k, SettlementPrice: 120 });
}
rows.push({ Contract: 'FESX Dec', ExpirationDate: '2026-12-18', SettlementPrice: 5000 }, { Contract: 'FESX Mar', ExpirationDate: '2027-03-19', SettlementPrice: 5010 });
const oesx = { product: 'OESX', options: contractOptions(rows), info: { Currency: 'EUR', TickSize: 1, TickValue: 10 }, group: 'OESX' };
const fesx = { ...oesx, product: 'FESX', group: 'FESX' };
const shape = (legs) => legs.map(l => `${l.side > 0 ? '+' : '-'}${l.qty} ${l.kind}${l.strike ? ' ' + l.strike : ''} ${l.expiration}`);

describe('templates', () => {
    test('ids are unique and every template builds from its own specs', () => {
        expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
        TEMPLATES.forEach(t => { expect(t.legs.length).toBeGreaterThan(0); expect(t.needs.length).toBeGreaterThan(0); });
        expect(templateById('nope')).toBeNull();
    });
    test('product kinds', () => {
        expect(productKind({ ProductTypeCode: 'OI' })).toBe('option');
        expect(productKind({ ProductLine: 'Future', ProductTypeCode: 'FI' })).toBe('future');
        expect(productKind({ ProductLine: 'Dividend', ProductTypeCode: 'FD' })).toBeNull();
        expect(productKind(null)).toBeNull();
        expect(templatesFor('option').every(t => t.needs[0] === 'option')).toBe(true);
        expect(templatesFor('future').map(t => t.id)).toEqual(['futures-calendar', 'inter-product']);
    });
    test('straddle, strangle, spread, butterfly and condor strikes', () => {
        const ctx = { slots: [oesx], expiries: ['2026-12-18'], level: 5000, width: 1 };
        const legs = (id, extra = {}) => shape(buildLegs(templateById(id), { ...ctx, ...extra }).legs);
        expect(legs('long-straddle')).toEqual(['+1 call 5000 2026-12-18', '+1 put 5000 2026-12-18']);
        expect(legs('short-strangle')).toEqual(['-1 call 5100 2026-12-18', '-1 put 4900 2026-12-18']);
        expect(legs('bull-call-spread')).toEqual(['+1 call 5000 2026-12-18', '-1 call 5100 2026-12-18']);
        expect(legs('bear-put-spread')).toEqual(['+1 put 5000 2026-12-18', '-1 put 4900 2026-12-18']);
        expect(legs('call-butterfly')).toEqual(['+1 call 4900 2026-12-18', '-2 call 5000 2026-12-18', '+1 call 5100 2026-12-18']);
        expect(legs('iron-condor')).toEqual(['+1 put 4800 2026-12-18', '-1 put 4900 2026-12-18', '-1 call 5100 2026-12-18', '+1 call 5200 2026-12-18']);
        expect(legs('long-strangle', { width: 2 })).toEqual(['+1 call 5200 2026-12-18', '+1 put 4800 2026-12-18']);
    });
    test('the centre follows the given level to the nearest listed strike', () => {
        const { legs } = buildLegs(templateById('long-straddle'), { slots: [oesx], expiries: ['2026-12-18'], level: 5060, width: 1 });
        expect(legs.map(l => l.strike)).toEqual([5100, 5100]);
    });
    test('strikes that are not listed are reported, not invented', () => {
        const { legs, missing } = buildLegs(templateById('iron-condor'), { slots: [oesx], expiries: ['2026-12-18'], level: 5200, width: 1 });
        expect(legs.map(l => `${l.kind}${l.strike}`)).toEqual(['put5000', 'put5100']);
        expect(missing).toHaveLength(2);
        expect(missing[0]).toContain('not listed');
    });
    test('calendar spread uses two expiries; futures calendar and inter-product spread use futures', () => {
        expect(shape(buildLegs(templateById('call-calendar'), { slots: [oesx], expiries: ['2026-12-18', '2027-03-19'], level: 5000 }).legs))
            .toEqual(['-1 call 5000 2026-12-18', '+1 call 5000 2027-03-19']);
        expect(shape(buildLegs(templateById('futures-calendar'), { slots: [fesx], expiries: ['2026-12-18', '2027-03-19'], level: 0 }).legs))
            .toEqual(['+1 future 2026-12-18', '-1 future 2027-03-19']);
        const fdax = { ...fesx, product: 'FDAX', group: 'FDAX' };
        const { legs } = buildLegs(templateById('inter-product'), { slots: [fesx, fdax], expiries: ['2026-12-18'], level: 0 });
        expect(legs.map(l => `${l.side}${l.product}`)).toEqual(['1FESX', '-1FDAX']);
        expect(legs[0].group).toBe('FESX');
    });
    test('covered call: the future of the second product is the first one on or after the option expiry', () => {
        const { legs } = buildLegs(templateById('covered-call'), { slots: [oesx, { ...fesx, options: contractOptions(rows.filter(r => !r.CallPut)) }], expiries: ['2026-12-10'], level: 5000, width: 1 });
        expect(legs.map(l => `${l.kind} ${l.expiration}`)).toEqual(['future 2026-12-18']); // no option on 2026-12-10, the future is the first one after it
        const ok = buildLegs(templateById('covered-call'), { slots: [oesx, fesx], expiries: ['2026-12-18'], level: 5000, width: 1 });
        expect(ok.missing).toEqual([]);
        expect(shape(ok.legs)).toEqual(['+1 future 2026-12-18', '-1 call 5100 2026-12-18']);
    });
    test('a leg takes price, point value, currency and group from the contract and product', () => {
        const [call] = buildLegs(templateById('long-straddle'), { slots: [oesx], expiries: ['2026-12-18'], level: 5000 }).legs;
        expect(call).toMatchObject({ product: 'OESX', kind: 'call', strike: 5000, price: 50, priceFromSettlement: true, pointValue: 10, pointValueKnown: true, currency: 'EUR', group: 'OESX', qty: 1, side: 1 });
        const bare = legFromContract({ product: 'X', options: [], info: {} }, { kind: 'future', strike: null, expiration: '2026-12-18', price: null }, -1, 2);
        expect(bare).toMatchObject({ price: 0, priceFromSettlement: false, pointValue: 1, pointValueKnown: false, side: -1, qty: 2 });
        expect(newLegId()).not.toBe(newLegId());
    });
});

describe('TES profile shortcuts', () => {
    const profiles = [
        { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 100, MinExpiryRange: 1, NonDisclosureLimit: 500 },
        { TESType: 'BLOCK', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 50, MinExpiryRange: 4, NonDisclosureLimit: 300 },
        { TESType: 'BLOCK', InstrumentType: 'STRATEGY', MinLotSize: 20, MinExpiryRange: 1 },
        { TESType: 'EFP', InstrumentType: 'SIMPLE_INSTRUMENT', MinLotSize: 1, MinExpiryRange: 1 }
    ];
    test('supported instrument types', () => {
        expect(tesSupport(profiles)).toMatchObject({ known: true, types: ['BLOCK', 'EFP'], simple: true, strategy: true });
        expect(tesSupport([profiles[0]])).toMatchObject({ simple: true, strategy: false });
        expect(tesSupport([])).toMatchObject({ known: false, strategy: false, simple: false });
        expect(tesSupport(null).known).toBe(false);
    });
    test('minimum lots by expiration index', () => {
        const at = (i) => tesMinimums(profiles, i).map(m => `${m.tesType}/${m.instrumentType}:${m.minLotSize}`);
        expect(at(1)).toEqual(['BLOCK/SIMPLE_INSTRUMENT:100', 'BLOCK/STRATEGY:20', 'EFP/SIMPLE_INSTRUMENT:1']);
        expect(at(5)[0]).toBe('BLOCK/SIMPLE_INSTRUMENT:50');
    });
});

describe('requests', () => {
    test('product codes', () => {
        expect(isProductCode('FESX')).toBe(true);
        expect(isProductCode('fesx')).toBe(false);
        expect(isProductCode('F"X')).toBe(false);
        expect(() => buildInfoQuery('F" }')).toThrow();
        expect(() => buildContractsQuery('')).toThrow();
    });
    test('without a schema all roots are asked for, filtered by the product', () => {
        const { query, roots } = buildInfoQuery('oesx');
        expect(roots).toEqual(['ProductInfos', 'TESProfiles', 'Expirations']);
        ['ProductInfos', 'TESProfiles', 'Expirations'].forEach(r => expect(query).toContain(`${r}(filter: { Product: { eq: "OESX" } })`));
        const c = buildContractsQuery('OESX');
        expect(c.query).toContain('Contracts(filter: { Product: { eq: "OESX" } }, page: { first: 2000 })');
        expect(c.query).toContain('pageInfo { hasNextPage endCursor }');
        expect(buildContractsQuery('OESX', null, { after: 'a"b' }).query).toContain('after: "a\\"b"');
    });
    test('with a schema only offered roots, fields and page arguments are used', () => {
        const str = { kind: 'SCALAR', name: 'String' };
        const wrap = (name) => ({ kind: 'OBJECT', name: `${name}Result`, fields: [{ name: 'data', args: [], type: { kind: 'LIST', ofType: { kind: 'OBJECT', name } } }] });
        const row = (name, fields) => ({ kind: 'OBJECT', name, fields: fields.map(n => ({ name: n, args: [], type: str })) });
        const filterArg = { name: 'filter', type: { kind: 'INPUT_OBJECT', name: 'F' } };
        const schema = { queryType: { name: 'Query' }, types: [
            { kind: 'OBJECT', name: 'Query', fields: [
                { name: 'Contracts', args: [filterArg], type: { kind: 'OBJECT', name: 'ContractResult' } },
                { name: 'ProductInfos', args: [filterArg], type: { kind: 'OBJECT', name: 'ProductInfoResult' } }] },
            wrap('Contract'), wrap('ProductInfo'),
            row('Contract', ['CallPut', 'Strike', 'ExpirationDate', 'SettlementPrice']), row('ProductInfo', ['Product', 'TickSize']),
            { kind: 'INPUT_OBJECT', name: 'F', inputFields: [{ name: 'Product', type: str }] }, str] };
        const index = buildSchemaIndex(schema);
        const info = buildInfoQuery('FESX', index);
        expect(info.roots).toEqual(['ProductInfos']);
        expect(info.query).toContain('TickSize');
        expect(info.query).not.toContain('TickValue');
        const c = buildContractsQuery('FESX', index);
        expect(c.query).not.toContain('page:');
        expect(c.query).not.toContain('LastTradingDate');
        const noStrike = { ...schema, types: schema.types.map(t => (t.name === 'Contract' ? row('Contract', ['ExpirationDate']) : t)) };
        expect(buildContractsQuery('FESX', buildSchemaIndex(noStrike)).error).toContain('Strike');
        expect(buildContractsQuery('FESX', buildSchemaIndex({ ...schema, types: schema.types.map(t => (t.name === 'Query' ? { ...t, fields: [] } : t)) })).error).toContain('does not offer Contracts');
    });
});
