import { buildIcs } from '../ics.js';

const now = new Date('2026-10-03T12:00:00Z');

describe('buildIcs', () => {
    test('writes all-day events with CRLF line endings', () => {
        const ics = buildIcs([{ uid: 'exp-FESX-1', date: '2026-12-18', summary: 'FESX expiry', description: 'Index 3' }], { name: 'My products', now });
        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(ics).toContain('X-WR-CALNAME:My products');
        expect(ics).toContain('DTSTART;VALUE=DATE:20261218');
        expect(ics).toContain('DTEND;VALUE=DATE:20261219');
        expect(ics).toContain('DTSTAMP:20261003T120000Z'.replace('2026', '2026'));
        expect(ics).toContain('SUMMARY:FESX expiry');
        expect(ics).toContain('UID:exp-FESX-1@eurex-api-explorer');
        expect(ics.split('\n').every(l => l === '' || l.endsWith('\r'))).toBe(true);
    });

    test('the end date rolls over month and year', () => {
        expect(buildIcs([{ date: '2026-12-31', summary: 'x' }], { now })).toContain('DTEND;VALUE=DATE:20270101');
        expect(buildIcs([{ date: '2028-02-28', summary: 'x' }], { now })).toContain('DTEND;VALUE=DATE:20280229');
    });

    test('escapes commas, semicolons, backslashes and new lines', () => {
        const ics = buildIcs([{ date: '2026-01-02', summary: 'a, b; c\\d', description: 'line1\nline2' }], { now });
        expect(ics).toContain('SUMMARY:a\\, b\; c\\\\d');
        expect(ics).toContain('DESCRIPTION:line1\\nline2');
    });

    test('folds long lines at 75 octets', () => {
        const ics = buildIcs([{ date: '2026-01-02', summary: 'x'.repeat(200) }], { now });
        const lines = ics.split('\r\n');
        expect(lines.every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
        expect(lines.join('').replace(/ /g, '')).toContain('x'.repeat(200));
    });

    test('skips entries without a usable date', () => {
        const ics = buildIcs([{ date: '', summary: 'a' }, { date: 'soon', summary: 'b' }, { date: '2026-01-02T00:00:00', summary: 'c' }], { now });
        expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
        expect(ics).toContain('SUMMARY:c');
    });
});
