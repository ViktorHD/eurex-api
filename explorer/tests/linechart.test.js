/** @jest-environment jsdom */
import { niceTicks, renderLineChart } from '../linechart.js';

describe('niceTicks', () => {
    test('round steps covering the range', () => {
        expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
        expect(niceTicks(5512.3, 5530.9, 4)).toEqual([5515, 5520, 5525, 5530]);
        expect(niceTicks(0.0012, 0.0031, 4)).toEqual([0.0015, 0.002, 0.0025, 0.003]);
    });
    test('degenerate input', () => {
        expect(niceTicks(5, 5)).toEqual([5]);
        expect(niceTicks(NaN, 1)).toEqual([]);
    });
});

describe('renderLineChart', () => {
    const pts = [{ x: '2026-10-02', y: 5520 }, { x: '2026-09-30', y: 5500 }, { x: '2026-10-01', y: 5510.5 }];

    test('draws a path through the points in date order with a tooltip on each', () => {
        const svg = renderLineChart(pts, { format: v => v.toFixed(1), label: 'FESX settlement' });
        expect(svg.getAttribute('aria-label')).toBe('FESX settlement');
        const dots = [...svg.querySelectorAll('circle')];
        expect(dots.map(d => d.querySelector('title').textContent)).toEqual(['2026-09-30: 5500.0', '2026-10-01: 5510.5', '2026-10-02: 5520.0']);
        const path = svg.querySelector('path.lc-line').getAttribute('d');
        expect(path.startsWith('M')).toBe(true);
        expect(path.match(/L/g)).toHaveLength(2);
        const ys = dots.map(d => Number(d.getAttribute('cy')));
        expect(ys[0]).toBeGreaterThan(ys[2]); // higher prices are drawn higher (smaller y)
    });

    test('labels the axes with dates and values', () => {
        const svg = renderLineChart(pts);
        const labels = [...svg.querySelectorAll('text.lc-tick')].map(t => t.textContent);
        expect(labels).toContain('2026-09-30');
        expect(labels).toContain('2026-10-02');
        expect(svg.querySelectorAll('line.lc-grid').length).toBeGreaterThan(2);
    });

    test('a single point and a flat series do not break the scales', () => {
        expect(renderLineChart([{ x: '2026-10-01', y: 5 }]).querySelectorAll('circle')).toHaveLength(1);
        const flat = renderLineChart([{ x: '2026-10-01', y: 5 }, { x: '2026-10-02', y: 5 }]);
        expect(flat.querySelectorAll('circle')).toHaveLength(2);
        expect(flat.outerHTML).not.toContain('NaN');
    });

    test('empty and invalid data show a message', () => {
        expect(renderLineChart([]).textContent).toBe('No data');
        expect(renderLineChart([{ x: 'bad', y: 1 }, { x: '2026-10-01', y: NaN }]).textContent).toBe('No data');
    });
});
