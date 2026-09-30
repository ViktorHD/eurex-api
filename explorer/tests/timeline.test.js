import { TimelineManager } from '../timeline.js';

// Bypass the constructor, which needs a DOM
const tm = Object.create(TimelineManager.prototype);

const FESX = {
    StartContinuousTrading: '01:10:00',
    EndContinuousTrading: '22:00:00',
    StartTES: '07:30:00',
    EndTES: '22:30:00'
};

// 2026-09-30 is a Wednesday; Berlin is UTC+2 (CEST)
const berlin = (hhmm, day = '2026-09-30') => new Date(`${day}T${hhmm}:00+02:00`);

describe('TimelineManager trading status', () => {
    test('open during continuous trading', () => {
        expect(tm.getStatus(FESX, berlin('10:00'))).toBe('open');
        expect(tm.getStatus(FESX, berlin('01:10'))).toBe('open');
    });

    test('TES only after continuous trading ends', () => {
        expect(tm.getStatus(FESX, berlin('22:15'))).toBe('tes');
    });

    test('closed outside all sessions', () => {
        expect(tm.getStatus(FESX, berlin('23:00'))).toBe('closed');
        expect(tm.getStatus(FESX, berlin('00:30'))).toBe('closed');
    });

    test('closed on weekends', () => {
        expect(tm.getStatus(FESX, berlin('10:00', '2026-10-03'))).toBe('closed');
        expect(tm.getStatus(FESX, berlin('10:00', '2026-10-04'))).toBe('closed');
    });

    test('closed when hours are missing', () => {
        expect(tm.getStatus(null, berlin('10:00'))).toBe('closed');
    });

    test('sessions spanning midnight', () => {
        const overnight = { StartContinuousTrading: '23:00:00', EndContinuousTrading: '02:00:00' };
        expect(tm.getStatus(overnight, berlin('23:30'))).toBe('open');
        expect(tm.getStatus(overnight, berlin('01:00'))).toBe('open');
        expect(tm.getStatus(overnight, berlin('03:00'))).toBe('closed');
    });
});

describe('TimelineManager helpers', () => {
    test('_nowIn converts to the selected timezone', () => {
        const d = berlin('10:15');
        expect(tm._nowIn('CET', d)).toEqual({ minutes: 10 * 60 + 15, weekday: 3 });
        expect(tm._nowIn('UTC', d).minutes).toBe(8 * 60 + 15);
        expect(tm._nowIn('SGT', d).minutes).toBe(16 * 60 + 15);
    });

    test('_formatDuration', () => {
        expect(tm._formatDuration(70, 1320)).toBe('20h 50m');
        expect(tm._formatDuration(540, 1050)).toBe('8h 30m');
        expect(tm._formatDuration(1380, 120)).toBe('3h');
    });
});
