import { jest } from '@jest/globals';
import { UIManager } from '../ui.js';

describe('UIManager XSS Security', () => {
    let ui;
    let mockElements;

    beforeEach(() => {
        global.window = {
            feather: {
                replace: jest.fn()
            }
        };
        global.setTimeout = (fn) => fn();

        // Need a simple mock for querySelector that can return an object with textContent
        const mockErrorMsgEl = { textContent: '' };

        mockElements = {
            errorBox: {
                innerHTML: '',
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                },
                querySelector: jest.fn().mockImplementation((selector) => {
                    if (selector === '.error-message') return mockErrorMsgEl;
                    return null;
                })
            },
            loadingIndicator: {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                }
            },
            resultsTable: {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                }
            },
            emptyState: {
                classList: {
                    add: jest.fn(),
                    remove: jest.fn()
                }
            }
        };
        ui = new UIManager(mockElements);
        ui.errorMsgEl = mockErrorMsgEl; // Reference for testing
    });

    afterEach(() => {
        delete global.window;
    });

    test('showError is NOT vulnerable to XSS', () => {
        const maliciousPayload = '<img src=x onerror=alert(1)>';
        ui.showError(maliciousPayload);

        // innerHTML should only contain the static part (and the empty p.error-message)
        expect(mockElements.errorBox.innerHTML).not.toContain(maliciousPayload);

        // textContent should contain the raw malicious payload (rendered safely)
        expect(ui.errorMsgEl.textContent).toBe(maliciousPayload);
    });
});
