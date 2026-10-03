import { buildCalendarQuery, collectEvents, groupByDate, toIcs, rangeEnd, monthOf, MAX_PRODUCTS } from '../calendar.js';

describe('buildCalendarQuery', () => {
    test('one aliased pair per product', () => {
        const q = buildCalendarQuery(['FESX', 'FDAX']);
        expect(q).toContain('e0: Expirations(filter: { Product: { eq: "FESX" } })');
        expect(q).toContain('h1: Holidays(filter: { Product: { eq: "FDAX" } })');
    });
    test('caps the number of products and rejects bad codes', () => {
        const many = Array.from({ length: 40 }, (_, i) => `P${i}`);
        expect((buildCalendarQuery(many).match(/Expirations\(/g) || [])).toHaveLength(MAX_PRODUCTS);
        expect(() => buildCalendarQuery(['A"B'])).toThrow('Invalid product code');
    });
});

describe('events', () => {
    const res = {
        e0: { data: [{ ExpirationIndex: 1, ExpirationDate: '2026-12-18' }, { ExpirationIndex: 2, ExpirationDate: '2027-03-19' }, { ExpirationIndex: 0, ExpirationDate: '2026-09-18' }, { ExpirationIndex: 1, ExpirationDate: '2026-12-18' }] },
        h0: { data: [{ Holiday: '2026-12-24' }, { Holiday: '2026-12-25T00:00:00' }] },
        e1: { data: [{ ExpirationIndex: 5, ExpirationDate: '2026-12-18' }] },
        h1: { data: [{ Holiday: '2026-12-24' }, { Holiday: 'garbage' }] }
    };
    const events = collectEvents(res, ['FESX', 'FDAX'], '2026-10-01', '2027-01-31');

    test('filters to the range, removes duplicates and bad dates', () => {
        expect(events.map(e => [e.date, e.kind, e.product])).toEqual([
            ['2026-12-18', 'expiration', 'FDAX'], ['2026-12-18', 'expiration', 'FESX'],
            ['2026-12-24', 'holiday', 'FDAX'], ['2026-12-24', 'holiday', 'FESX'],
            ['2026-12-25', 'holiday', 'FESX']
        ]);
    });

    test('groups by date', () => {
        const groups = groupByDate(events);
        expect(groups.map(g => g.date)).toEqual(['2026-12-18', '2026-12-24', '2026-12-25']);
        expect(groups[0].expirations).toEqual([{ product: 'FDAX', index: 5 }, { product: 'FESX', index: 1 }]);
        expect(groups[1].holidays).toEqual(['FDAX', 'FESX']);
        expect(monthOf('2026-12-18')).toBe('2026-12');
    });

    test('missing answers produce no events', () => {
        expect(collectEvents(null, ['A'], '2026-01-01', '2026-12-31')).toEqual([]);
        expect(collectEvents({ e0: null, h0: { data: null } }, ['A'], '2026-01-01', '2026-12-31')).toEqual([]);
    });

    test('calendar file: one event per day and kind, products named in the title', () => {
        const ics = toIcs(groupByDate(events), { now: new Date('2026-10-03T00:00:00Z') });
        expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
        expect(ics).toContain('SUMMARY:Expiration: FDAX\\, FESX');
        expect(ics).toContain('SUMMARY:Holiday: FDAX\\, FESX');
        expect(ics).toContain('DESCRIPTION:FDAX (index 5)\\nFESX (index 1)');
    });

    test('long product lists are shortened in the title but complete in the description', () => {
        const groups = [{ date: '2026-12-24', expirations: [], holidays: ['A', 'B', 'C', 'D', 'E', 'F'] }];
        const ics = toIcs(groups);
        expect(ics).toContain('SUMMARY:Holiday: A\\, B\\, C\\, D +2');
        expect(ics).toContain('DESCRIPTION:A\\, B\\, C\\, D\\, E\\, F');
    });
});

describe('rangeEnd', () => {
    test('adds months', () => {
        expect(rangeEnd('2026-10-03', 3)).toBe('2027-01-03');
        expect(rangeEnd('2026-10-03', 12)).toBe('2027-10-03');
    });
});
