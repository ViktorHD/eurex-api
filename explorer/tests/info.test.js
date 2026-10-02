import { businessDaysBetween, datasetState, summarizeStatus, relativeDay, formatDate, changeKind } from '../info.js';

describe('Data status helpers', () => {
    test('businessDaysBetween skips weekends', () => {
        expect(businessDaysBetween('2026-10-02', '2026-10-02')).toBe(0); // Fri -> Fri
        expect(businessDaysBetween('2026-09-30', '2026-10-02')).toBe(2); // Wed -> Fri
        expect(businessDaysBetween('2026-10-02', '2026-10-04')).toBe(0); // Fri -> Sun
        expect(businessDaysBetween('2026-10-02', '2026-10-05')).toBe(1); // Fri -> Mon
    });

    test('datasetState: current, stale, weekend, reference and missing', () => {
        expect(datasetState('Contracts', '2026-10-02', '2026-10-02')).toBe('ok');
        expect(datasetState('Contracts', '2026-10-01', '2026-10-02')).toBe('stale');
        expect(datasetState('Contracts', '2026-10-02', '2026-10-04')).toBe('ok'); // Friday data on Sunday
        expect(datasetState('Changelog', '2026-01-01', '2026-10-02')).toBe('static');
        expect(datasetState('Contracts', null, '2026-10-02')).toBe('error');
    });

    test('summarizeStatus picks the worst level and counts', () => {
        expect(summarizeStatus(['ok', 'static', 'ok'])).toMatchObject({ level: 'ok', title: 'All datasets are up to date', detail: '' });
        expect(summarizeStatus(['ok', 'stale', 'stale', 'static'])).toMatchObject({ level: 'stale', current: 2, title: '2 of 4 datasets up to date', detail: '2 stale' });
        expect(summarizeStatus(['ok', 'stale', 'error'])).toMatchObject({ level: 'error', detail: '1 stale · 1 unavailable' });
    });
});

describe('Changelog helpers', () => {
    test('relativeDay', () => {
        expect(relativeDay('2026-10-02', '2026-10-02')).toBe('today');
        expect(relativeDay('2026-10-03', '2026-10-02')).toBe('tomorrow');
        expect(relativeDay('2026-10-01', '2026-10-02')).toBe('yesterday');
        expect(relativeDay('2026-10-19', '2026-10-02')).toBe('in 17 days');
        expect(relativeDay('2026-09-28', '2026-10-02')).toBe('4 days ago');
    });

    test('formatDate', () => {
        expect(formatDate('2026-10-19')).toBe('19.10.2026');
        expect(formatDate('2026-10-19T00:00:00Z')).toBe('19.10.2026');
        expect(formatDate('')).toBe('');
    });

    test('changeKind groups types into badge colours', () => {
        expect(changeKind('Deprecation')).toBe('removal');
        expect(changeKind('Field removed')).toBe('removal');
        expect(changeKind('New field')).toBe('addition');
        expect(changeKind('Value change')).toBe('change');
    });
});
