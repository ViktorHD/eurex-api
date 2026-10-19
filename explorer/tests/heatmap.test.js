/** @jest-environment jsdom */
import { calendarMonths, countKinds, renderHeatmap } from '../heatmap.js';

const months = calendarMonths({
    today: '2026-10-19',
    expirations: [{ date: '2026-12-18', index: 3 }, { date: '2026-12-25', index: 4 }, { date: '2027-03-19' }],
    holidays: ['2026-12-25', '2026-12-24', '2027-01-01'],
    count: 6
});

describe('calendarMonths', () => {
    test('starts at the month of today and covers the requested months', () => {
        expect(months.map(m => m.title)).toEqual(['October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027']);
        expect(months[1].days).toHaveLength(30);
        expect(months[4].days).toHaveLength(28);
    });
    test('offsets the first day for a week that starts on Monday', () => {
        expect(months[0].offset).toBe(3); // 1 Oct 2026 is a Thursday
        expect(months[3].offset).toBe(4); // 1 Jan 2027 is a Friday
    });
    test('marks expirations, holidays and clashes', () => {
        const dec = Object.fromEntries(months[2].days.map(d => [d.day, d]));
        expect(dec[18].kind).toBe('exp');
        expect(dec[18].title).toBe('2026-12-18: expiration (index 3)');
        expect(dec[24].kind).toBe('hol');
        expect(dec[25].kind).toBe('both');
        expect(dec[25].weekend).toBe(false);
        expect(dec[19].weekend).toBe(true);
        expect(months[0].days[18].today).toBe(true);
        expect(countKinds(months)).toEqual({ exp: 2, hol: 2, both: 1 });
    });
    test('wraps over the new year', () => {
        expect(calendarMonths({ today: '2026-12-01', count: 2 }).map(m => m.title)).toEqual(['December 2026', 'January 2027']);
    });
});

describe('renderHeatmap', () => {
    test('draws one grid per month with a summary label', () => {
        const root = renderHeatmap(months);
        expect(root.querySelectorAll('.hm-month')).toHaveLength(6);
        expect(root.querySelectorAll('.hm-day.both')).toHaveLength(1);
        expect(root.getAttribute('aria-label')).toBe('Calendar of 6 months: 3 expirations, 3 exchange holidays, 1 on the same day');
        expect(root.querySelector('.hm-day.exp').title).toContain('expiration');
    });
});
