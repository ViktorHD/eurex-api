// A small dependency-free SVG radar ("spider") chart. Axes are fixed per call, values are 0..1 (1 = outer ring), so
// two products drawn with the same scales are directly comparable. Every vertex carries a tooltip with the real value.
const NS = 'http://www.w3.org/2000/svg';

const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
};

/**
 * axes: [{ label, value: 0..1, text: 'shown value', compare?: { value, text } }]; needs at least 3. When the axes carry
 * `compare`, a second polygon is drawn over the first. Returns the <svg> element.
 * options: { rings: number of grid rings (default 4), label: accessible description }
 */
export function renderRadar(axes, options = {}) {
    const rings = options.rings || 4;
    const W = 360;
    const H = 300;
    const cx = W / 2;
    const cy = H / 2 + 4;
    const R = 98;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rd', role: 'img', 'aria-label': options.label || 'Radar chart', preserveAspectRatio: 'xMidYMid meet' });
    const n = axes.length;
    if (n < 3) {
        root.appendChild(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'rd-empty' }, 'Not enough data'));
        return root;
    }
    const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
    const point = (i, f) => [cx + Math.cos(angle(i)) * R * f, cy + Math.sin(angle(i)) * R * f];
    const poly = (f) => axes.map((_, i) => point(i, typeof f === 'function' ? f(i) : f).map(v => v.toFixed(1)).join(',')).join(' ');

    for (let r = 1; r <= rings; r++) root.appendChild(svg('polygon', { points: poly(r / rings), class: 'rd-ring' }));
    axes.forEach((a, i) => {
        const [x, y] = point(i, 1);
        root.appendChild(svg('line', { x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1), class: 'rd-spoke' }));
        const [lx, ly] = point(i, 1.16);
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
        root.appendChild(svg('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': anchor, class: 'rd-label' }, a.label));
    });
    const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    const layer = (pick, cls, name) => {
        root.appendChild(svg('polygon', { points: poly(i => clamp(pick(axes[i]).value)), class: `rd-area ${cls}` }));
        axes.forEach((a, i) => {
            const [x, y] = point(i, clamp(pick(a).value));
            const dot = svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4, class: `rd-dot ${cls}`, tabindex: 0 });
            dot.appendChild(svg('title', {}, `${name ? `${name} · ` : ''}${a.label}: ${pick(a).text}`));
            root.appendChild(dot);
        });
    };
    const second = axes.every(a => a.compare);
    layer(a => a, 'rd-a', second ? options.names?.[0] : '');
    if (second) layer(a => a.compare, 'rd-b', options.names?.[1]);
    return root;
}
