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

// ---- holiday-aware freshness, "My products" and calendar export ----
import { productsMentioned, changelogEvents, isoOf } from '../info.js';
import { businessDaysBetween as bdb, datasetState as ds } from '../info.js';

describe('freshness with exchange holidays', () => {
    const holidays = new Set(['2026-12-25', '2026-12-24']);
    test('holidays are not business days', () => {
        // Thu 23 Dec -> Mon 28 Dec: 24th and 25th are holidays, 26/27 weekend, so only the 28th counts
        expect(bdb('2026-12-23', '2026-12-28', holidays)).toBe(1);
        expect(bdb('2026-12-23', '2026-12-28')).toBe(3);
    });
    test('data from the last business day is current on a holiday', () => {
        expect(ds('Contracts', '2026-12-23', '2026-12-25', holidays)).toBe('ok');
        expect(ds('Contracts', '2026-12-23', '2026-12-25')).toBe('stale');
        expect(ds('Contracts', '2026-12-22', '2026-12-25', holidays)).toBe('stale');
    });
    test('today is read in Eurex time', () => {
        expect(isoOf(new Date('2026-09-29T23:30:00Z'))).toBe('2026-09-30');
    });
});

describe('changelog helpers', () => {
    const entry = { Date: '2026-11-02', Type: 'Change', Description: 'TES lot size for OESX block trades', OldValue: '10', NewValue: '20', Query: 'TESProfiles' };
    test('productsMentioned matches whole product codes only', () => {
        expect(productsMentioned(entry, ['OESX', 'FESX'])).toEqual(['OESX']);
        expect(productsMentioned({ Description: 'OESXX changed' }, ['OESX'])).toEqual([]);
        expect(productsMentioned({ Description: 'oesx lower case' }, ['OESX'])).toEqual(['OESX']);
        expect(productsMentioned(entry, [])).toEqual([]);
    });
    test('changelogEvents builds all-day events and skips undated entries', () => {
        const events = changelogEvents([entry, { Date: '', Type: 'New' }]);
        expect(events).toHaveLength(1);
        expect(events[0].date).toBe('2026-11-02');
        expect(events[0].summary).toBe('Eurex API: Change - TES lot size for OESX block trades');
        expect(events[0].description).toContain('Old: 10');
        expect(events[0].description).toContain('Affected query: TESProfiles');
    });
    test('long descriptions are shortened in the title', () => {
        const [e] = changelogEvents([{ Date: '2026-11-02', Type: 'Change', Description: 'x'.repeat(200) }]);
        expect(e.summary.length).toBeLessThan(100);
        expect(e.summary.endsWith('...')).toBe(true);
    });
});
