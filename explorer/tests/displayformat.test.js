import { formatNumber, formatDateString, loadDisplay, setDisplay, getDisplay, onDisplayChange } from '../displayformat.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

describe('formatNumber', () => {
    test('does not round away small values (the default of 3 fraction digits would)', () => {
        expect(formatNumber(0.00005, 'en')).toBe('0.00005');
        expect(formatNumber(0.0005, 'en')).toBe('0.0005');
        expect(formatNumber(5512.5, 'en')).toBe('5,512.5');
        expect(formatNumber(1234567.891, 'en')).toBe('1,234,567.891');
    });
    test('German and raw modes', () => {
        expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
        expect(formatNumber(1234.5, 'raw')).toBe('1234.5');
    });
    test('non-finite values are returned as text', () => {
        expect(formatNumber(NaN, 'en')).toBe('NaN');
    });
});

describe('formatDateString', () => {
    test('DD.MM.YYYY mode rewrites ISO dates and keeps the time part', () => {
        expect(formatDateString('2026-12-31', 'dmy')).toBe('31.12.2026');
        expect(formatDateString('2026-12-31T10:15:00Z', 'dmy')).toBe('31.12.2026 10:15:00');
    });
    test('other text and ISO mode are untouched', () => {
        expect(formatDateString('FESX', 'dmy')).toBe('FESX');
        expect(formatDateString('2026-12-31', 'iso')).toBe('2026-12-31');
        expect(formatDateString(42, 'dmy')).toBe(42);
    });
});

describe('display settings', () => {
    test('are stored, restored and announced', () => {
        const storage = memory();
        const seen = [];
        const off = onDisplayChange(d => seen.push(d.dates));
        setDisplay({ dates: 'dmy', numbers: 'de' }, storage);
        expect(seen).toEqual(['dmy']);
        off();
        setDisplay({ dates: 'iso', numbers: 'auto' }, memory()); // reset in-memory state
        expect(loadDisplay(storage)).toEqual({ numbers: 'de', dates: 'dmy' });
        expect(getDisplay().numbers).toBe('de');
    });
    test('unknown stored values fall back to defaults', () => {
        const storage = memory();
        storage.setItem('eurexExplorer.display', JSON.stringify({ numbers: 'klingon', dates: 5 }));
        expect(loadDisplay(storage)).toEqual({ numbers: 'auto', dates: 'iso' });
        storage.setItem('eurexExplorer.display', 'not json');
        expect(loadDisplay(storage)).toEqual({ numbers: 'auto', dates: 'iso' });
    });
});
