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

import { monthGrid, shiftMonth, eventsByDate, isoDate } from '../calendar.js';

describe('monthGrid', () => {
    test('weeks start on Monday and include the days of the neighbouring months', () => {
        const weeks = monthGrid(2026, 10); // 1 October 2026 is a Thursday
        expect(weeks).toHaveLength(5);
        expect(weeks[0][0]).toMatchObject({ date: '2026-09-28', day: 28, inMonth: false });
        expect(weeks[0][3]).toMatchObject({ date: '2026-10-01', inMonth: true });
        expect(weeks[4][6]).toMatchObject({ date: '2026-11-01', inMonth: false });
        expect(weeks.every(w => w.length === 7)).toBe(true);
    });

    test('weekends are flagged', () => {
        const week = monthGrid(2026, 10)[0];
        expect(week.map(d => d.weekend)).toEqual([false, false, false, false, false, true, true]);
    });

    test('a month that starts on Monday and has 28 days fits four weeks', () => {
        const weeks = monthGrid(2027, 2); // 1 February 2027 is a Monday
        expect(weeks).toHaveLength(4);
        expect(weeks[0][0].date).toBe('2027-02-01');
        expect(weeks[3][6].date).toBe('2027-02-28');
    });

    test('a month can need six weeks', () => {
        expect(monthGrid(2026, 8)).toHaveLength(6); // 1 August 2026 is a Saturday, 31 days
    });

    test('leap day', () => {
        const days = monthGrid(2028, 2).flat().filter(d => d.inMonth);
        expect(days).toHaveLength(29);
    });

    test('shiftMonth wraps the year', () => {
        expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
        expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
        expect(shiftMonth({ y: 2026, m: 5 }, 0)).toEqual({ y: 2026, m: 5 });
        expect(shiftMonth({ y: 2026, m: 5 }, 14)).toEqual({ y: 2027, m: 7 });
    });

    test('eventsByDate and isoDate', () => {
        const map = eventsByDate([{ date: '2026-10-23', kind: 'expiration', product: 'FESX', index: 1 }, { date: '2026-10-23', kind: 'holiday', product: 'FDAX', index: null }]);
        expect(map.get('2026-10-23')).toEqual({ date: '2026-10-23', expirations: [{ product: 'FESX', index: 1 }], holidays: ['FDAX'] });
        expect(map.get('2026-10-24')).toBeUndefined();
        expect(isoDate(2026, 3, 7)).toBe('2026-03-07');
    });
});
