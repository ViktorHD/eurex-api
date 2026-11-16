// A small dependency-free SVG line chart for time series (settlement prices). One series, brand navy, light grid,
// labelled axes and a value tooltip on every point. Scales to the width of its container.
const NS = 'http://www.w3.org/2000/svg';

// Round tick values covering [min, max]
export function niceTicks(min, max, target = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    if (min === max) return [min];
    const span = max - min;
    const raw = span / Math.max(1, target);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const first = Math.ceil(min / step) * step;
    const ticks = [];
    const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(digits)));
    return ticks;
}

const dayNumber = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
};
const isoFromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
};

/**
 * points: [{ x: 'YYYY-MM-DD', y: number }] (any order). Returns the <svg> element, already filled.
 * options: { yLabel, format: (y) => text, label: accessible description }
 */
export function renderLineChart(points, options = {}) {
    const fmt = options.format || ((y) => String(y));
    const data = points
        .filter(p => /^\d{4}-\d{2}-\d{2}/.test(String(p.x)) && Number.isFinite(p.y))
        .map(p => ({ d: dayNumber(p.x), x: String(p.x).slice(0, 10), y: p.y }))
        .sort((a, b) => a.d - b.d);

    const W = 720;
    const H = 300;
    const m = { top: 16, right: 20, bottom: 36, left: 64 };
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc', role: 'img', 'aria-label': options.label || 'Line chart', preserveAspectRatio: 'xMidYMid meet' });
    if (!data.length) {
        root.appendChild(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lc-empty' }, 'No data'));
        return root;
    }

    const xMin = data[0].d;
    const xMax = data[data.length - 1].d;
    let yMin = Math.min(...data.map(p => p.y));
    let yMax = Math.max(...data.map(p => p.y));
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const pad = (yMax - yMin) * 0.06;
    const yTicks = niceTicks(yMin - pad, yMax + pad, 5);
    yMin = Math.min(yMin - pad, yTicks[0] ?? yMin);
    yMax = Math.max(yMax + pad, yTicks[yTicks.length - 1] ?? yMax);

    const sx = (d) => m.left + (xMax === xMin ? (W - m.left - m.right) / 2 : ((d - xMin) / (xMax - xMin)) * (W - m.left - m.right));
    const sy = (y) => m.top + (1 - (y - yMin) / (yMax - yMin)) * (H - m.top - m.bottom);

    yTicks.forEach(t => {
        root.appendChild(svg('line', { x1: m.left, x2: W - m.right, y1: sy(t), y2: sy(t), class: 'lc-grid' }));
        root.appendChild(svg('text', { x: m.left - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'lc-tick' }, fmt(t)));
    });
    // About five date labels
    const labelCount = Math.min(5, xMax - xMin + 1);
    for (let i = 0; i < labelCount; i++) {
        const d = labelCount === 1 ? xMin : Math.round(xMin + ((xMax - xMin) * i) / (labelCount - 1));
        root.appendChild(svg('text', { x: sx(d), y: H - m.bottom + 20, 'text-anchor': i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle', class: 'lc-tick' }, isoFromDay(d)));
    }
    root.appendChild(svg('line', { x1: m.left, x2: W - m.right, y1: H - m.bottom, y2: H - m.bottom, class: 'lc-axis' }));
    if (options.yLabel) root.appendChild(svg('text', { x: 14, y: m.top + 4, class: 'lc-ylabel' }, options.yLabel));

    root.appendChild(svg('path', { d: data.map((p, i) => `${i ? 'L' : 'M'}${sx(p.d).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' '), class: 'lc-line', fill: 'none' }));
    data.forEach(p => {
        const dot = svg('circle', { cx: sx(p.d).toFixed(1), cy: sy(p.y).toFixed(1), r: data.length > 80 ? 2 : 3.5, class: 'lc-dot', tabindex: 0 });
        dot.appendChild(svg('title', {}, `${p.x}: ${fmt(p.y)}`));
        root.appendChild(dot);
    });
    return root;
}
