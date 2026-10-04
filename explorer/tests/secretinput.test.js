/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { hardenSecretInput, isRevealed, setRevealed } from '../secretinput.js';

const withMaskSupport = (supported) => {
    global.CSS = { supports: jest.fn(() => supported) };
};
afterEach(() => { delete global.CSS; });

describe('secret inputs', () => {
    test('are masked text inputs that password managers and Chrome leave alone', () => {
        withMaskSupport(true);
        const input = document.createElement('input');
        input.type = 'password';
        hardenSecretInput(input);
        expect(input.type).toBe('text');
        expect(input.classList.contains('secret-input')).toBe(true);
        expect(input.getAttribute('autocomplete')).toBe('off');
        expect(input.getAttribute('data-lpignore')).toBe('true');
        expect(input.getAttribute('data-1p-ignore')).toBe('true');
        expect(input.getAttribute('spellcheck')).toBe('false');
    });

    test('revealing toggles a class, the type stays text', () => {
        withMaskSupport(true);
        const input = hardenSecretInput(document.createElement('input'));
        expect(isRevealed(input)).toBe(false);
        setRevealed(input, true);
        expect(isRevealed(input)).toBe(true);
        expect(input.type).toBe('text');
        setRevealed(input, false);
        expect(isRevealed(input)).toBe(false);
    });

    test('browsers that cannot mask text keep a password field', () => {
        withMaskSupport(false);
        const input = hardenSecretInput(document.createElement('input'));
        expect(input.type).toBe('password');
        expect(isRevealed(input)).toBe(false);
        setRevealed(input, true);
        expect(input.type).toBe('text');
        expect(isRevealed(input)).toBe(true);
    });
});
