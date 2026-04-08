import { jest } from '@jest/globals';
import { getTypeName, UIManager } from './ui.js';

describe('getTypeName', () => {
    test('returns "Unknown" for null or undefined input', () => {
        expect(getTypeName(null)).toBe('Unknown');
        expect(getTypeName(undefined)).toBe('Unknown');
    });

    test('returns the name property if present', () => {
        const typeObj = { name: 'String', kind: 'SCALAR' };
        expect(getTypeName(typeObj)).toBe('String');
    });

    test('handles NON_NULL kind by appending "!"', () => {
        const typeObj = {
            kind: 'NON_NULL',
            ofType: { name: 'Int', kind: 'SCALAR' }
        };
        expect(getTypeName(typeObj)).toBe('Int!');
    });

    test('handles LIST kind by wrapping in "[]"', () => {
        const typeObj = {
            kind: 'LIST',
            ofType: { name: 'Float', kind: 'SCALAR' }
        };
        expect(getTypeName(typeObj)).toBe('[Float]');
    });

    test('handles nested combinations (e.g., non-null list of non-null strings)', () => {
        const typeObj = {
            kind: 'NON_NULL',
            ofType: {
                kind: 'LIST',
                ofType: {
                    kind: 'NON_NULL',
                    ofType: { name: 'String', kind: 'SCALAR' }
                }
            }
        };
        expect(getTypeName(typeObj)).toBe('[String!]!');
    });

    test('returns "Unknown" for objects without name and unknown kind', () => {
        const typeObj = { kind: 'OTHER' };
        expect(getTypeName(typeObj)).toBe('Unknown');
    });
});

describe('UIManager.formatValue', () => {
    let ui;

    beforeEach(() => {
        // Mock elements object
        const mockEls = {
            loadingIndicator: { classList: { add: jest.fn(), remove: jest.fn() } },
            emptyState: { classList: { add: jest.fn(), remove: jest.fn() }, querySelector: jest.fn() },
            resultsTable: { classList: { add: jest.fn(), remove: jest.fn() }, querySelectorAll: jest.fn() },
            errorBox: { classList: { add: jest.fn(), remove: jest.fn() } },
            downloadCsvBtn: {},
            downloadMdBtn: {},
            tableHead: {},
            tableBody: {},
            recordCounter: {}
        };
        ui = new UIManager(mockEls);
    });

    test('returns empty string for null or undefined', () => {
        expect(ui.formatValue(null)).toBe('');
        expect(ui.formatValue(undefined)).toBe('');
    });

    test('returns JSON string for objects', () => {
        const obj = { key: 'value', nested: { a: 1 } };
        expect(ui.formatValue(obj)).toBe(JSON.stringify(obj));
    });

    test('returns string representation for other primitives', () => {
        expect(ui.formatValue(true)).toBe('true');
        expect(ui.formatValue('hello')).toBe('hello');
    });

    test('formats numbers using Intl.NumberFormat if colName does not include "id"', () => {
        const val = 1234567.89;
        const formatted = new Intl.NumberFormat().format(val);
        expect(ui.formatValue(val, 'price')).toBe(formatted);
    });

    test('returns number as string if colName includes "id"', () => {
        const val = 1234567;
        expect(ui.formatValue(val, 'productId')).toBe('1234567');
        expect(ui.formatValue(val, 'ID')).toBe('1234567');
    });

    test('formats ISO date strings using toLocaleString', () => {
        const isoStr = '2023-10-27T10:00:00Z';
        const expected = new Date(isoStr).toLocaleString();
        expect(ui.formatValue(isoStr)).toBe(expected);
    });

    test('returns original string if it is not a valid ISO date', () => {
        const invalidDate = '2023-13-45T25:00:00';
        expect(ui.formatValue(invalidDate)).toBe(invalidDate);
        const notADate = 'Not a date';
        expect(ui.formatValue(notADate)).toBe(notADate);
describe('UIManager', () => {
    let uiManager;

    beforeEach(() => {
        uiManager = new UIManager({});
    });

    describe('formatValue', () => {
        test('returns empty string for null or undefined', () => {
            expect(uiManager.formatValue(null)).toBe('');
            expect(uiManager.formatValue(undefined)).toBe('');
        });

        test('returns JSON string for objects', () => {
            const obj = { key: 'value', num: 123 };
            expect(uiManager.formatValue(obj)).toBe(JSON.stringify(obj));
        });

        test('formats numbers using Intl.NumberFormat', () => {
            const num = 1234.56;
            const expected = new Intl.NumberFormat().format(num);
            expect(uiManager.formatValue(num)).toBe(expected);
        });

        test('returns string representation for numbers if column name contains "id"', () => {
            const id = 987654321;
            expect(uiManager.formatValue(id, 'userId')).toBe('987654321');
            expect(uiManager.formatValue(id, 'ID')).toBe('987654321');
        });

        test('formats ISO date strings using toLocaleString', () => {
            const isoDate = '2023-10-27T10:30:00';
            const expected = new Date(isoDate).toLocaleString();
            expect(uiManager.formatValue(isoDate)).toBe(expected);
        });

        test('returns original string for non-ISO date strings', () => {
            const normalStr = 'Hello World';
            expect(uiManager.formatValue(normalStr)).toBe('Hello World');

            const partialDate = '2023-10-27';
            expect(uiManager.formatValue(partialDate)).toBe('2023-10-27');
        });

        test('returns string representation for other types', () => {
            expect(uiManager.formatValue(true)).toBe('true');
            expect(uiManager.formatValue(false)).toBe('false');
        });
    });
});
