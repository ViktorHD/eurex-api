// Payoff chart for the Strategy Wizard: dependency-free SVG, profit area green, loss area red, zero line, breakeven
// markers, a marker for the current level, and a crosshair with the values (pointer, or arrow keys when focused).
import { niceTicks } from './linechart.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
};

// Compact money axis labels: 12.5k, -3M
export function compact(v) {
    const a = Math.abs(v);
    const fmt = (n, suffix) => `${Number(n.toFixed(n >= 100 ? 0 : 1))}${suffix}`;
    if (a >= 1e6) return fmt(v / 1e6, 'M');
    if (a >= 1e3) return fmt(v / 1e3, 'k');
    return String(Number(v.toFixed(a >= 100 ? 0 : 2)));
}

const level = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(2))));
const money = (v) => `${v < 0 ? '-' : v > 0 ? '+' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * series: [{ name, points: [{ x, s, y }], dashed? }]; the first series is the main one (area fill, breakevens).
 * options: { breakevens: [{ x, s }], currentLevel: number, currency, label, xLabel,
 *   legs: [{ id, text, s (level the leg sits at), side, draggable, active }],
 *   onLegDown(id, pointerEvent), onLegStep(id, -1 | 1) }
 * Legs are drawn as pills in a lane under the axis, one row each; a draggable pill reports pointer presses and arrow keys
 * to the caller, which moves the leg and draws a new chart. The svg gets levelAt(clientX) and xAt(level) for the caller.
 * Returns the <svg> element, already filled.
 */
export function renderPayoffChart(series, options = {}) {
    const W = 760;
    const H = 360 + (options.legs?.length ? options.legs.length * 22 + 6 : 0);
    const legs = options.legs || [];
    const LANE = 22;
    const m = { top: 30, right: 22, bottom: 44 + (legs.length ? legs.length * LANE + 6 : 0), left: 66 };
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pf', role: 'img', preserveAspectRatio: 'xMidYMid meet', tabindex: 0 });
    root.setAttribute('aria-label', options.label || 'Payoff chart');
    const main = series[0]?.points || [];
    if (main.length < 2) {
        root.appendChild(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'lc-empty' }, 'Add legs to see the payoff'));
        return root;
    }

    const all = series.flatMap(s => s.points);
    const sMin = Math.min(...all.map(p => p.s));
    const sMax = Math.max(...all.map(p => p.s));
    let yMin = Math.min(0, ...all.map(p => p.y));
    let yMax = Math.max(0, ...all.map(p => p.y));
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const pad = (yMax - yMin) * 0.08;
    const yTicks = niceTicks(yMin - pad, yMax + pad, 6);
    yMin = Math.min(yMin - pad, yTicks[0] ?? yMin);
    yMax = Math.max(yMax + pad, yTicks[yTicks.length - 1] ?? yMax);
    const plotW = W - m.left - m.right;
    const plotH = H - m.top - m.bottom;
    const sx = (s) => m.left + (sMax === sMin ? plotW / 2 : ((s - sMin) / (sMax - sMin)) * plotW);
    const sy = (y) => m.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;
    root.xAt = (s) => sx(s);
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.s).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');

    yTicks.forEach(t => {
        root.appendChild(svg('line', { x1: m.left, x2: W - m.right, y1: sy(t), y2: sy(t), class: 'lc-grid' }));
        root.appendChild(svg('text', { x: m.left - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'lc-tick' }, compact(t)));
    });
    niceTicks(sMin, sMax, 7).forEach(t => {
        root.appendChild(svg('line', { x1: sx(t), x2: sx(t), y1: m.top, y2: H - m.bottom, class: 'lc-grid' }));
        root.appendChild(svg('text', { x: sx(t), y: H - m.bottom + 18, 'text-anchor': 'middle', class: 'lc-tick' }, level(t)));
    });
    if (options.xLabel) root.appendChild(svg('text', { x: m.left + plotW / 2, y: m.top + plotH + 34, 'text-anchor': 'middle', class: 'lc-ylabel' }, options.xLabel));
    if (options.currency) root.appendChild(svg('text', { x: 14, y: 14, class: 'lc-ylabel' }, `P&L (${options.currency})`));

    // Profit above zero, loss below: the same area is clipped twice
    const zero = sy(0);
    const defs = svg('defs');
    const clip = (id, y, h) => {
        const c = svg('clipPath', { id });
        c.appendChild(svg('rect', { x: m.left, y, width: plotW, height: Math.max(0, h) }));
        defs.appendChild(c);
    };
    const uid = `pf${Math.random().toString(36).slice(2, 8)}`;
    clip(`${uid}p`, m.top, zero - m.top);
    clip(`${uid}n`, zero, H - m.bottom - zero);
    root.appendChild(defs);
    const area = `${line(main)} L${sx(main[main.length - 1].s).toFixed(1)} ${zero.toFixed(1)} L${sx(main[0].s).toFixed(1)} ${zero.toFixed(1)} Z`;
    root.appendChild(svg('path', { d: area, class: 'pf-gain', 'clip-path': `url(#${uid}p)` }));
    root.appendChild(svg('path', { d: area, class: 'pf-loss', 'clip-path': `url(#${uid}n)` }));
    root.appendChild(svg('line', { x1: m.left, x2: W - m.right, y1: zero, y2: zero, class: 'pf-zero' }));

    if (Number.isFinite(options.currentLevel) && options.currentLevel > sMin && options.currentLevel < sMax) {
        root.appendChild(svg('line', { x1: sx(options.currentLevel), x2: sx(options.currentLevel), y1: m.top, y2: H - m.bottom, class: 'pf-now' }));
        root.appendChild(svg('text', { x: sx(options.currentLevel) + 4, y: m.top + 10, class: 'lc-tick' }, 'now'));
    }
    series.forEach((s, i) => root.appendChild(svg('path', { d: line(s.points), class: `pf-line${i ? ' pf-line2' : ''}${s.dashed ? ' pf-dashed' : ''}`, fill: 'none' })));
    (options.breakevens || []).forEach(b => {
        root.appendChild(svg('circle', { cx: sx(b.s), cy: zero, r: 4.5, class: 'pf-be' }));
        root.appendChild(svg('text', { x: sx(b.s), y: zero - 9, 'text-anchor': 'middle', class: 'pf-be-label' }, level(b.s)));
    });

    // Legs: pills in a lane under the axis. Dragging one is the caller's business; here only the events are forwarded.
    legs.forEach((leg, i) => {
        if (!Number.isFinite(leg.s)) return;
        const w = Math.max(54, leg.text.length * 6.6 + 16);
        const x = Math.max(m.left + w / 2, Math.min(W - m.right - w / 2, sx(leg.s)));
        const y = m.top + plotH + 44 + i * LANE;
        const g = svg('g', { class: `pf-leg${leg.side < 0 ? ' pf-sell' : ''}${leg.draggable ? ' pf-drag' : ''}${leg.active ? ' pf-active' : ''}`, 'data-leg': leg.id });
        g.appendChild(svg('line', { x1: sx(leg.s), x2: sx(leg.s), y1: m.top + plotH, y2: y, class: 'pf-leg-line' }));
        g.appendChild(svg('rect', { x: x - w / 2, y: y, width: w, height: LANE - 4, rx: 9 }));
        g.appendChild(svg('text', { x, y: y + 12, 'text-anchor': 'middle' }, leg.text));
        const title = svg('title', {}, leg.draggable ? `${leg.text}: drag sideways to move it, or use the arrow keys` : leg.text);
        g.appendChild(title);
        if (leg.draggable) {
            g.setAttribute('tabindex', '0');
            g.setAttribute('role', 'slider');
            g.setAttribute('aria-label', `${leg.text}, move with the left and right arrow keys`);
            g.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') options.onLegDown?.(leg.id, e); });
            g.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { options.onLegStep?.(leg.id, e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); e.stopPropagation(); }
            });
        }
        root.appendChild(g);
    });

    // Crosshair
    const cross = svg('g', { class: 'pf-cross', visibility: 'hidden' });
    const vline = svg('line', { y1: m.top, y2: H - m.bottom, class: 'pf-vline' });
    const dots = series.map((_, i) => svg('circle', { r: 4, class: `pf-dot${i ? ' pf-dot2' : ''}` }));
    const tipBg = svg('rect', { rx: 4, class: 'pf-tipbg' });
    const tip = svg('text', { class: 'pf-tip' });
    cross.append(vline, ...dots, tipBg, tip);
    root.appendChild(cross);

    const showAt = (index) => {
        const p = main[Math.max(0, Math.min(main.length - 1, index))];
        const x = sx(p.s);
        vline.setAttribute('x1', x);
        vline.setAttribute('x2', x);
        const lines = [`${level(p.s)} (${p.x >= 0 ? '+' : ''}${(p.x * 100).toFixed(1)} %)`];
        series.forEach((s, i) => {
            const q = s.points[Math.max(0, Math.min(s.points.length - 1, index))] || p;
            dots[i].setAttribute('cx', sx(q.s));
            dots[i].setAttribute('cy', sy(q.y));
            lines.push(`${s.name}: ${money(q.y)}`);
        });
        tip.textContent = '';
        lines.forEach((t, i) => { const ts = svg('tspan', { x: 0, dy: i ? 15 : 0 }, t); tip.appendChild(ts); });
        const w = 160;
        const h = 10 + lines.length * 15;
        const left = x + 12 + w > W - m.right ? x - 12 - w : x + 12;
        tip.setAttribute('transform', `translate(${left + 8} ${m.top + 18})`);
        tip.querySelectorAll('tspan').forEach(t => t.setAttribute('x', 0));
        tipBg.setAttribute('x', left);
        tipBg.setAttribute('y', m.top + 4);
        tipBg.setAttribute('width', w);
        tipBg.setAttribute('height', h);
        cross.setAttribute('visibility', 'visible');
        root.dataset.index = String(index);
    };
    const levelAt = (clientX) => {
        const box = root.getBoundingClientRect();
        const px = ((clientX - box.left) / (box.width || 1)) * W;
        return sMin + ((px - m.left) / plotW) * (sMax - sMin);
    };
    root.levelAt = levelAt;
    // The series share their x grid, so one index serves all
    const indexAt = (clientX) => {
        const s = levelAt(clientX);
        let best = 0;
        main.forEach((p, i) => { if (Math.abs(p.s - s) < Math.abs(main[best].s - s)) best = i; });
        return best;
    };
    root.addEventListener('pointermove', (e) => showAt(indexAt(e.clientX)));
    root.addEventListener('pointerleave', () => { if (document.activeElement !== root) cross.setAttribute('visibility', 'hidden'); });
    root.addEventListener('blur', () => cross.setAttribute('visibility', 'hidden'));
    root.addEventListener('keydown', (e) => {
        const at = Number(root.dataset.index ?? Math.floor(main.length / 2));
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') { showAt(at - step); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { showAt(at + step); e.preventDefault(); }
        else if (e.key === 'Home') { showAt(0); e.preventDefault(); }
        else if (e.key === 'End') { showAt(main.length - 1); e.preventDefault(); }
    });
    root.addEventListener('focus', () => showAt(Number(root.dataset.index ?? Math.floor(main.length / 2))));
    return root;
}
