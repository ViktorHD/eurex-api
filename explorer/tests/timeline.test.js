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

describe('TimelineManager holidays', () => {
    const wed = '2026-09-30';
    const holidays = ['2026-09-30', '2026-12-24', '2026-12-31'];

    test('a holiday listed for today overrides the trading hours', () => {
        expect(tm.getStatus(FESX, berlin('10:00', wed), holidays)).toBe('holiday');
        expect(tm.getStatus(FESX, berlin('23:30', wed), holidays)).toBe('holiday');
    });

    test('other days are unaffected', () => {
        expect(tm.getStatus(FESX, berlin('10:00', wed), ['2026-12-24'])).toBe('open');
        expect(tm.getStatus(FESX, berlin('10:00', wed), [])).toBe('open');
        expect(tm.getStatus(FESX, berlin('10:00', wed), null)).toBe('open');
    });

    test('the holiday is matched on the Eurex calendar date, not the browser date', () => {
        // 23:30 UTC on 29 Sep is already 01:30 on 30 Sep in Berlin
        expect(tm._cetDate(new Date('2026-09-29T23:30:00Z'))).toBe('2026-09-30');
        expect(tm.getStatus(FESX, new Date('2026-09-29T23:30:00Z'), holidays)).toBe('holiday');
    });

    test('weekends stay closed rather than holiday', () => {
        expect(tm.getStatus(FESX, berlin('10:00', '2026-10-03'), ['2026-10-03'])).toBe('closed');
    });

    test('several hour sets: open when any is open', () => {
        const sets = [
            { StartContinuousTrading: '08:00:00', EndContinuousTrading: '12:00:00' },
            { StartContinuousTrading: '14:00:00', EndContinuousTrading: '18:00:00' }
        ];
        expect(tm.getStatus(sets, berlin('15:00'))).toBe('open');
        expect(tm.getStatus(sets, berlin('13:00'))).toBe('closed');
        expect(tm.getStatus([], berlin('15:00'))).toBe('closed');
    });

    test('nextHoliday finds the first date after today', () => {
        expect(tm.nextHoliday(holidays, berlin('10:00', wed))).toBe('2026-12-24');
        expect(tm.nextHoliday(['2026-01-01'], berlin('10:00', wed))).toBeNull();
        expect(tm.nextHoliday(null, berlin('10:00', wed))).toBeNull();
    });

    test('buildHolidayMap groups, sorts and de-duplicates dates and skips unusable rows', () => {
        const map = tm.buildHolidayMap([
            { Product: 'FESX', Holiday: '2026-12-25' },
            { Product: 'FESX', Holiday: '2026-12-24T00:00:00' },
            { Product: 'FESX', Holiday: '2026-12-25' },
            { Product: 'FDAX', Holiday: 'garbage' },
            { Product: null, Holiday: '2026-01-01' }
        ]);
        expect(map.get('FESX')).toEqual(['2026-12-24', '2026-12-25']);
        expect(map.has('FDAX')).toBe(false);
        expect(tm.buildHolidayMap(undefined).size).toBe(0);
    });

    test('_statusFor combines hours, holidays and the next holiday', () => {
        tm.holidays = new Map([['FESX', holidays]]);
        const product = { Product: 'FESX', hours: FESX, allHours: [FESX] };
        expect(tm._statusFor(product, berlin('10:00', wed))).toEqual({ status: 'holiday', next: '2026-12-24' });
        expect(tm._statusFor({ Product: 'FDAX', hours: FESX, allHours: [FESX] }, berlin('10:00', wed))).toEqual({ status: 'open', next: null });
    });
});

describe('TimelineManager joinHours', () => {
    test('joins on ProductID so a reused product code cannot pick up another product\'s hours', () => {
        const products = [{ ProductID: 1, Product: 'ABC', Name: 'One' }, { ProductID: 2, Product: 'ABC', Name: 'Two' }];
        const hours = [{ ProductID: 1, Product: 'ABC', StartContinuousTrading: '08:00:00' }, { ProductID: 2, Product: 'ABC', StartContinuousTrading: '09:00:00' }];
        const joined = tm.joinHours(products, hours);
        expect(joined.map(p => [p.Name, p.hours.StartContinuousTrading])).toEqual([['One', '08:00:00'], ['Two', '09:00:00']]);
    });

    test('falls back to the product code when ids are missing', () => {
        const joined = tm.joinHours([{ Product: 'FESX', Name: 'x' }, { Product: 'NOHOURS', Name: 'y' }], [{ Product: 'FESX', StartContinuousTrading: '01:10:00' }]);
        expect(joined).toHaveLength(1);
        expect(joined[0].Product).toBe('FESX');
    });

    test('keeps every hour set of a product instead of dropping all but one', () => {
        const hours = [{ Product: 'FESX', StartContinuousTrading: '08:00:00' }, { Product: 'FESX', StartContinuousTrading: '14:00:00' }];
        const [p] = tm.joinHours([{ Product: 'FESX' }], hours);
        expect(p.allHours).toHaveLength(2);
        expect(p.hours).toBe(hours[0]);
    });
});
