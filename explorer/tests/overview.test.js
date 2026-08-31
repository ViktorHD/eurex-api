import { formatDateToDDMMYYYY, generateStrikesCsv, generateStrikeRequestEmailText } from '../overview.js';

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
            expect(text).toContain('Note: The requested strikes CSV file has been downloaded and is attached to this email.');
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
