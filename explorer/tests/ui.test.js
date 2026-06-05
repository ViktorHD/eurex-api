import { jest } from '@jest/globals';
import { getTypeName, UIManager, DataTable } from '../ui.js';

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

describe('UIManager', () => {
    let ui;
    let mockEls;

    beforeEach(() => {
        // Mock elements object
        mockEls = {
            loadingIndicator: { classList: { add: jest.fn(), remove: jest.fn() } },
            emptyState: {
                classList: { add: jest.fn(), remove: jest.fn() },
                querySelector: jest.fn().mockReturnValue({ textContent: '' })
            },
            resultsTable: {
                classList: { add: jest.fn(), remove: jest.fn() },
                querySelectorAll: jest.fn().mockReturnValue([]),
                offsetWidth: 100
            },
            errorBox: {
                classList: { add: jest.fn(), remove: jest.fn() },
                innerHTML: ''
            },
            downloadCsvBtn: { disabled: false },
            downloadMdBtn: { disabled: false },
            tableHead: { innerHTML: '', appendChild: jest.fn() },
            tableBody: { innerHTML: '', appendChild: jest.fn() },
            recordCounter: { textContent: '' }
        };
        ui = new UIManager(mockEls);
    });

    describe('formatValue', () => {
        let dt;
        beforeEach(() => {
            global.document = {
                createElement: jest.fn().mockReturnValue({
                    appendChild: jest.fn(),
                    classList: { add: jest.fn(), remove: jest.fn() },
                    style: {},
                    setAttribute: jest.fn()
                }),
                createTextNode: jest.fn()
            };
            dt = new DataTable({ innerHTML: '', appendChild: jest.fn(), querySelectorAll: jest.fn().mockReturnValue([]) }, []);
        });

        afterEach(() => {
            delete global.document;
        });

        test('returns empty string for null or undefined', () => {
            expect(dt.formatValue(null)).toBe('');
            expect(dt.formatValue(undefined)).toBe('');
        });

        test('returns JSON string for objects', () => {
            const obj = { key: 'value', nested: { a: 1 } };
            expect(dt.formatValue(obj)).toBe(JSON.stringify(obj));
        });

        test('returns string representation for other primitives', () => {
            expect(dt.formatValue(true)).toBe('true');
            expect(dt.formatValue(false)).toBe('false');
            expect(dt.formatValue('')).toBe('');
            expect(dt.formatValue('hello')).toBe('hello');
        });

        test('handles 0 correctly', () => {
            expect(dt.formatValue(0)).toBe('0');
        });

        test('formats numbers using Intl.NumberFormat if colName does not include "id"', () => {
            const val = 1234567.89;
            const formatted = new Intl.NumberFormat().format(val);
            expect(dt.formatValue(val, 'price')).toBe(formatted);

            const negVal = -123.45;
            const negFormatted = new Intl.NumberFormat().format(negVal);
            expect(dt.formatValue(negVal, 'delta')).toBe(negFormatted);
        });

        test('returns number as string if colName includes "id"', () => {
            const val = 1234567;
            expect(dt.formatValue(val, 'productId')).toBe('1234567');
            expect(dt.formatValue(val, 'ID')).toBe('1234567');
            expect(dt.formatValue(val, 'InstrumentId')).toBe('1234567');
            expect(dt.formatValue(val, 'product_id')).toBe('1234567');
        });

        test('returns raw ISO date strings without conversion', () => {
            const isoStr = '2023-10-27T10:00:00Z';
            expect(dt.formatValue(isoStr)).toBe(isoStr);

            const isoStrNoZ = '2023-10-27T10:00:00';
            expect(dt.formatValue(isoStrNoZ)).toBe(isoStrNoZ);
        });

        test('stringifies Date objects as JSON', () => {
            const d = new Date('2023-10-27T10:00:00Z');
            expect(dt.formatValue(d)).toBe(JSON.stringify(d));
        });

        test('returns original string if it is not a date', () => {
            const notADate = 'Not a date';
            expect(dt.formatValue(notADate)).toBe(notADate);
        });

        test('returns raw partial ISO date (YYYY-MM-DD) without conversion', () => {
            const partialDate = '2023-10-27';
            expect(dt.formatValue(partialDate)).toBe(partialDate);
        });
    });

    describe('Visibility methods', () => {
        test('showLoading toggles correct classes', () => {
            ui.showLoading();
            expect(mockEls.loadingIndicator.classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockEls.emptyState.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.resultsTable.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.errorBox.classList.add).toHaveBeenCalledWith('hidden');
        });

        test('showEmptyState toggles correct classes and sets message', () => {
            const mockP = { textContent: '' };
            mockEls.emptyState.querySelector.mockReturnValue(mockP);

            ui.showEmptyState('No results found');

            expect(mockEls.loadingIndicator.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.emptyState.classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockEls.resultsTable.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.errorBox.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockP.textContent).toBe('No results found');
        });

        test('hideError hides errorBox', () => {
            ui.hideError();
            expect(mockEls.errorBox.classList.add).toHaveBeenCalledWith('hidden');
        });

        test('showError toggles correct classes and sets message', () => {
            // Mock window.feather
            if (typeof global.window === 'undefined') {
                global.window = {};
            }
            const originalFeather = global.window.feather;
            global.window.feather = { replace: jest.fn() };
            jest.useFakeTimers();

            // Mock querySelector for error message
            const mockMsgP = { textContent: '' };
            mockEls.errorBox.querySelector = jest.fn().mockReturnValue(mockMsgP);

            const errMsg = 'Test error message';
            ui.showError(errMsg);

            expect(mockMsgP.textContent).toBe(errMsg);
            expect(mockEls.errorBox.innerHTML).toContain('class="error-message"');
            expect(mockEls.errorBox.innerHTML).toContain('data-feather="alert-circle"');

            expect(mockEls.errorBox.classList.remove).toHaveBeenCalledWith('hidden');
            expect(mockEls.loadingIndicator.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.resultsTable.classList.add).toHaveBeenCalledWith('hidden');
            expect(mockEls.emptyState.classList.add).toHaveBeenCalledWith('hidden');

            // Verify feather.replace is called after timeout
            jest.runAllTimers();
            expect(global.window.feather.replace).toHaveBeenCalled();

            // Cleanup
            global.window.feather = originalFeather;
            jest.useRealTimers();
        });
    });
});
