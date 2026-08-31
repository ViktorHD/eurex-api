import { formatDateToDDMMYYYY, generateStrikesCsv } from '../overview.js';

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
    });
});
