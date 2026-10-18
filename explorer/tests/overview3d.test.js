/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { OverviewManager } from '../overview.js';

describe('3D view toolbar', () => {
    const build = (jumpCount = 3) => {
        const om = Object.create(OverviewManager.prototype);
        om._glOptions = { surface: false, atm: true, jumps: false, ortho: false, side: 'all', deltaMin: -1, deltaMax: 1 };
        om._glSpecPoints = [{ strike: 5000, side: 'C', date: '2026-12-18' }];
        om._gl = { setOptions: jest.fn(), setPreset: jest.fn(), focus: jest.fn() };
        const bar = om._build3DToolbar({ atm: 0.5 }, jumpCount);
        document.body.appendChild(bar);
        return { om, bar };
    };
    const btn = (bar, text) => [...bar.querySelectorAll('button')].find(b => b.textContent.startsWith(text));

    afterEach(() => { document.body.innerHTML = ''; });

    test('overlay toggles update the options, the scene and aria-pressed', () => {
        const { om, bar } = build();
        const surface = btn(bar, 'Surface');
        expect(surface.getAttribute('aria-pressed')).toBe('false');
        surface.click();
        expect(om._glOptions.surface).toBe(true);
        expect(om._gl.setOptions).toHaveBeenLastCalledWith({ surface: true });
        expect(surface.getAttribute('aria-pressed')).toBe('true');
        btn(bar, 'ATM').click();
        expect(om._glOptions.atm).toBe(false);
        expect(btn(bar, 'Jumps (3)')).toBeTruthy();
        btn(bar, 'Ortho').click();
        expect(om._gl.setOptions).toHaveBeenLastCalledWith({ ortho: true });
    });

    test('the ATM toggle is left out when moneyness 1.0 is outside the data', () => {
        const om = Object.create(OverviewManager.prototype);
        om._glOptions = { atm: true };
        const bar = om._build3DToolbar({ atm: null }, 0);
        expect([...bar.querySelectorAll('button')].some(b => b.textContent === 'ATM')).toBe(false);
    });

    test('option side buttons are mutually exclusive', () => {
        const { om, bar } = build();
        btn(bar, 'Calls').click();
        expect(om._glOptions.side).toBe('C');
        expect(btn(bar, 'Calls').getAttribute('aria-pressed')).toBe('true');
        expect(btn(bar, 'All').getAttribute('aria-pressed')).toBe('false');
    });

    test('the delta band sliders cannot cross', () => {
        const { om, bar } = build();
        const [min, max] = bar.querySelectorAll('input[type=range]');
        max.value = '0.5'; max.dispatchEvent(new Event('input'));
        expect(om._glOptions.deltaMax).toBe(0.5);
        min.value = '0.9'; min.dispatchEvent(new Event('input'));
        expect(om._glOptions.deltaMin).toBe(0.5);
        expect(min.value).toBe('0.5');
    });

    test('Enter in the search box flies to the match', () => {
        const { om, bar } = build();
        const input = bar.querySelector('input[type=search]');
        input.value = '5000';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(om._gl.focus).toHaveBeenCalledWith([0], true);
        expect(bar.querySelector('.overview-3d-search-status').textContent).toBe('Strike 5,000');
    });

    test('camera presets call into the scene', () => {
        const { om, bar } = build();
        btn(bar, 'Δ × Date').click();
        expect(om._gl.setPreset).toHaveBeenCalledWith(0, 0.05);
    });
});
