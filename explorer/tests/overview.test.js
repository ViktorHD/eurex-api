import { formatDateToDDMMYYYY, generateStrikesCsv, generateStrikeRequestEmailText, OverviewManager, findLadderGaps, ladderSteps, findDeltaJumps, refineStep } from '../overview.js';

describe('Overview Additional Strikes Helpers', () => {
    describe('formatDateToDDMMYYYY', () => {
        test('converts YYYY-MM-DD to DD.MM.YYYY', () => {
            expect(formatDateToDDMMYYYY('2023-09-29')).toBe('29.09.2023');
            expect(formatDateToDDMMYYYY('2024-01-05')).toBe('05.01.2024');
        });

        test('returns original string if already formatted as DD.MM.YYYY', () => {
            expect(formatDateToDDMMYYYY('29.09.2023')).toBe('29.09.2023');
        });

        test('handles ISO datetime strings', () => {
            expect(formatDateToDDMMYYYY('2023-09-29T00:00:00Z')).toBe('29.09.2023');
        });

        test('returns empty string for null, undefined, or empty input', () => {
            expect(formatDateToDDMMYYYY(null)).toBe('');
            expect(formatDateToDDMMYYYY(undefined)).toBe('');
            expect(formatDateToDDMMYYYY('')).toBe('');
        });
    });

    describe('generateStrikesCsv', () => {
        test('generates expected CSV format with header and semicolon delimiter', () => {
            const result = generateStrikesCsv('OEXP', '29.09.2023', 4500, 4525, 25);
            const expected = 'Symbol;ContractDate;StrikePrice\r\nOEXP;29.09.2023;4500\r\nOEXP;29.09.2023;4525';
            expect(result).toBe(expected);
        });

        test('handles string numeric inputs for strikes and distance', () => {
            const result = generateStrikesCsv('OEXP', '29.09.2023', '4500', '4550', '25');
            const expected = 'Symbol;ContractDate;StrikePrice\r\nOEXP;29.09.2023;4500\r\nOEXP;29.09.2023;4525\r\nOEXP;29.09.2023;4550';
            expect(result).toBe(expected);
        });

        test('throws error if start > end or distance <= 0', () => {
            expect(() => generateStrikesCsv('OEXP', '29.09.2023', 4550, 4500, 25)).toThrow('Invalid strike range or distance');
            expect(() => generateStrikesCsv('OEXP', '29.09.2023', 4500, 4550, -5)).toThrow('Invalid strike range or distance');
            expect(() => generateStrikesCsv('OEXP', '29.09.2023', 4500, 4550, 0)).toThrow('Invalid strike range or distance');
        });

        test('handles array of entries with multiple contract dates and deduplicates lines', () => {
            const entries = [
                { contractDate: '29.09.2023', startStrike: 4500, endStrike: 4525, distance: 25 },
                { contractDate: '29.09.2023', startStrike: 4525, endStrike: 4550, distance: 25 },
                { contractDate: '20.10.2023', startStrike: 4600, endStrike: 4600, distance: 25 }
            ];
            const result = generateStrikesCsv('OEXP', entries);
            const expected = 'Symbol;ContractDate;StrikePrice\r\nOEXP;29.09.2023;4500\r\nOEXP;29.09.2023;4525\r\nOEXP;29.09.2023;4550\r\nOEXP;20.10.2023;4600';
            expect(result).toBe(expected);
        });

        test('handles entry with contractDates array for single strike pattern', () => {
            const entries = [
                { contractDates: ['29.09.2023', '20.10.2023'], startStrike: 4500, endStrike: 4525, distance: 25 }
            ];
            const result = generateStrikesCsv('OEXP', entries);
            const expected = 'Symbol;ContractDate;StrikePrice\r\nOEXP;29.09.2023;4500\r\nOEXP;29.09.2023;4525\r\nOEXP;20.10.2023;4500\r\nOEXP;20.10.2023;4525';
            expect(result).toBe(expected);
        });

        test('filters out existing strikes from CSV output', () => {
            const entries = [
                { contractDate: '29.09.2023', startStrike: 4500, endStrike: 4550, distance: 25 }
            ];
            const existingStrikes = new Set(['29.09.2023|4525']);
            const result = generateStrikesCsv('OEXP', entries, existingStrikes);
            const expected = 'Symbol;ContractDate;StrikePrice\r\nOEXP;29.09.2023;4500\r\nOEXP;29.09.2023;4550';
            expect(result).toBe(expected);
        });

        test('returns only headers if all requested strikes exist', () => {
            const entries = [
                { contractDate: '29.09.2023', startStrike: 4500, endStrike: 4525, distance: 25 }
            ];
            const existingStrikes = new Set(['29.09.2023|4500', '29.09.2023|4525']);
            const result = generateStrikesCsv('OEXP', entries, existingStrikes);
            const expected = 'Symbol;ContractDate;StrikePrice';
            expect(result).toBe(expected);
        });
    });

    describe('generateStrikeRequestEmailText', () => {
        test('generates business style email text with ASCII table and total new strikes count', () => {
            const entries = [
                { contractDates: ['29.09.2023', '20.10.2023'], startStrike: 4500, endStrike: 4600, distance: 25 }
            ];
            const text = generateStrikeRequestEmailText('OEXP', entries);

            expect(text).toContain('Dear Eurex Operations Team,');
            expect(text).toContain('Please add the following strike prices for OEXP for the next trading day:');
            expect(text).toContain('| Symbol | Contract Date | Start Strike | End Strike | Distance |');
            expect(text).toContain('| OEXP   | 29.09.2023    | 4500         | 4600       | 25       |');
            expect(text).toContain('| OEXP   | 20.10.2023    | 4500         | 4600       | 25       |');
            expect(text).toContain('Total new strikes to add: 10');
            expect(text).toContain('Note: The requested strikes CSV file has been prepared and is attached to this email.');
        });

        test('drops range rows where all strikes already exist and adjusts total counter', () => {
            const entries = [
                { contractDate: '29.09.2023', startStrike: 4500, endStrike: 4525, distance: 25 },
                { contractDate: '20.10.2023', startStrike: 4600, endStrike: 4650, distance: 25 }
            ];
            const existingStrikes = new Set(['29.09.2023|4500', '29.09.2023|4525']);
            const text = generateStrikeRequestEmailText('OEXP', entries, existingStrikes);

            expect(text).not.toContain('29.09.2023');
            expect(text).toContain('20.10.2023');
            expect(text).toContain('Total new strikes to add: 3');
        });

        test('returns empty string if entire request across all ranges already exists', () => {
            const entries = [
                { contractDate: '29.09.2023', startStrike: 4500, endStrike: 4525, distance: 25 }
            ];
            const existingStrikes = new Set(['29.09.2023|4500', '29.09.2023|4525']);
            const text = generateStrikeRequestEmailText('OEXP', entries, existingStrikes);

            expect(text).toBe('');
        });
    });
});

describe('Strike Window helpers', () => {
    // Bypass the constructor, which needs a DOM
    const om = Object.create(OverviewManager.prototype);

    test('_axisTickStep picks round steps that are multiples of the strike increment', () => {
        expect(om._axisTickStep(25, 9000, 10)).toBe(1000);
        expect(om._axisTickStep(25, 9000, 4)).toBe(2500);
        expect(om._axisTickStep(50, 1200, 12)).toBe(100);
        expect(om._axisTickStep(0.5, 12, 10)).toBe(2);
    });

    test('_atmByDate interpolates the strike where call delta crosses 0.5', () => {
        const rows = [
            { ContractDate: '2026-12-18', CallPut: 'C', ContractCycle: 'MONTHLY', Strike: 5400, Delta: 0.6 },
            { ContractDate: '2026-12-18', CallPut: 'C', ContractCycle: 'MONTHLY', Strike: 5500, Delta: 0.4 },
            { ContractDate: '2026-12-18', CallPut: 'P', ContractCycle: 'MONTHLY', Strike: 5450, Delta: -0.5 },
            { ContractDate: '2027-03-19', CallPut: 'C', ContractCycle: 'QUARTERLY', Strike: 5000, Delta: 0.9 }
        ];
        const atm = om._atmByDate(rows);
        expect(atm.get('2026-12-18')).toBeCloseTo(5450);
        expect(atm.has('2027-03-19')).toBe(false);
    });
});

describe('Per-expiry strike gap detection', () => {
    const range = (from, to, step) => { const r = []; for (let k = from; k <= to; k += step) r.push(k); return r; };

    test('regular ladder has no gaps', () => {
        expect(findLadderGaps(range(5000, 6000, 25))).toEqual([]);
    });

    test('coarser wings are not gaps (25 near the money, 50 and 100 further out)', () => {
        const ladder = [...range(3000, 3900, 100), ...range(4000, 4950, 50), ...range(5000, 6000, 25), ...range(6050, 7000, 50), ...range(7100, 8000, 100), 8200];
        expect(findLadderGaps(ladder)).toEqual([]);
        expect(ladderSteps(ladder)).toEqual([25, 50, 100, 200]);
    });

    test('single missing strike in the 25 region uses step 25', () => {
        const ladder = range(5000, 6000, 25).filter(k => k !== 5500);
        expect(findLadderGaps(ladder)).toEqual([{ lo: 5475, hi: 5525, start: 5500, end: 5500, step: 25, count: 1 }]);
    });

    test('hole in a 100-step wing uses step 100, not the 25 step near the money', () => {
        const ladder = [...range(5000, 6000, 25), ...range(6100, 6500, 100), ...range(7000, 7500, 100)];
        expect(findLadderGaps(ladder)).toEqual([{ lo: 6500, hi: 7000, start: 6600, end: 6900, step: 100, count: 4 }]);
    });

    test('two holes separated by one strike are both found', () => {
        const ladder = [...range(5000, 5100, 25), 5250, ...range(5400, 5500, 25)];
        const gaps = findLadderGaps(ladder);
        expect(gaps.map(g => [g.start, g.end, g.step])).toEqual([[5125, 5225, 25], [5275, 5375, 25]]);
    });

    test('hole at a step transition proposes strikes on the coarser grid', () => {
        const ladder = [...range(5000, 5100, 25), ...range(5250, 5500, 50)];
        expect(findLadderGaps(ladder)).toEqual([{ lo: 5100, hi: 5250, start: 5150, end: 5200, step: 50, count: 2 }]);
    });

    test('proposed strikes continue the listed grid even when it is not a multiple of the step', () => {
        const ladder = [6150, 6250, 6350, 6850, 7050, 7250];
        expect(findLadderGaps(ladder)).toEqual([{ lo: 6350, hi: 6850, start: 6450, end: 6650, step: 200, count: 2 }]);
    });

    test('too few strikes to judge', () => {
        expect(findLadderGaps([5000, 5500])).toEqual([]);
        expect(findLadderGaps([5000, 5025, 5500])).toEqual([]);
    });
});

describe('Delta coverage helpers', () => {
    test('findDeltaJumps flags adjacent strikes whose call deltas differ by more than the threshold', () => {
        const pts = [
            { strike: 5500, delta: 0.52 }, { strike: 5550, delta: 0.45 },
            { strike: 5600, delta: 0.38 }, { strike: 6000, delta: 0.08 }, { strike: 6050, delta: 0.06 }
        ];
        const jumps = findDeltaJumps(pts, 0.2);
        expect(jumps).toHaveLength(1);
        expect(jumps[0]).toMatchObject({ lo: 5600, hi: 6000 });
        expect(jumps[0].size).toBeCloseTo(0.3);
    });

    test('findDeltaJumps ignores unsorted input order and small moves', () => {
        const pts = [{ strike: 5100, delta: 0.4 }, { strike: 5000, delta: 0.5 }, { strike: 5200, delta: 0.3 }];
        expect(findDeltaJumps(pts, 0.2)).toEqual([]);
    });

    test('refineStep picks the largest listed step that divides the interval', () => {
        expect(refineStep(400, [25, 50, 100])).toBe(100);
        expect(refineStep(150, [25, 50, 100])).toBe(50);
        expect(refineStep(650, [50, 100, 200])).toBe(50);
        expect(refineStep(25, [25, 50])).toBe(25);
        expect(refineStep(100, [])).toBeNull();
    });
});
