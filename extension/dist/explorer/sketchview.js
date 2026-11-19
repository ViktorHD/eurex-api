// "Draw a payoff": the user sketches the profit / loss at expiry they want, the panel suggests legs of the chosen product
// and expiry that draw it (fit.js) and hands the chosen combination to the Strategy Wizard.
import { el, button, refreshIcons } from './dom.js';
import { niceTicks } from './linechart.js';
import { compact } from './payoffchart.js';
import { expirationsOf, impliedForward, nearestStrike, strikesOf, pointValueOf } from './payoff.js';
import { legFromContract } from './strategies.js';
import { resample, candidatesFrom, suggest, recommended, nameOf } from './fit.js';
import { cetDate } from './tradingstatus.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
};
const W = 760;
const H = 300;
const M = { top: 14, right: 22, bottom: 34, left: 66 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const levelText = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(2))));

// Shapes to start from, in drawing coordinates: u 0..1 across the levels, v -1..1 up the P&L axis
const PRESETS = [
    ['Long volatility', (x) => 1.6 * Math.abs(x) - 0.8],
    ['Short volatility', (x) => 0.8 - 1.6 * Math.abs(x)],
    ['Bullish', (x) => Math.max(x, 0) * 1.6 - 0.3],
    ['Bearish', (x) => Math.max(-x, 0) * 1.6 - 0.3],
    ['Capped bullish', (x) => Math.max(-0.6, Math.min(0.6, 1.6 * x))],
    ['Range', (x) => Math.max(-0.6, Math.min(0.6, 0.6 - 4.8 * (Math.abs(x) - 0.25)))]
].map(([name, f]) => ({ name, points: Array.from({ length: 41 }, (_, i) => { const x = (i / 40) * 2 - 1; return { u: i / 40, v: f(x) }; }) }));

export class SketchPanel {
    /** hooks: { getData(): the loaded product data or null, onUse(legs, append) } */
    constructor(box, hooks) {
        this.box = box;
        this.hooks = hooks;
        this.state = { expiry: '', range: 0.1, amount: null, maxLegs: 4 };
        this.points = [];      // drawing coordinates { u, v }
        this.solutions = [];
        this.selected = -1;
        this.refresh();
    }

    /** Rebuilds the panel for the current product (call when the product or its data changes). */
    refresh() {
        const box = this.box;
        box.innerHTML = '';
        const d = this.hooks.getData();
        if (!d) { box.appendChild(el('p', 'pc-hint', 'Pick an options product above, then draw the payoff you want and get a combination of calls and puts that draws it.')); return; }
        if (d.kind !== 'option') { box.appendChild(el('p', 'pc-hint', `${d.code} is a futures product. Drawing suggests calls and puts, so pick an options product.`)); return; }
        const today = cetDate();
        this.data = d;
        this.expiries = expirationsOf(d.options, 'option').filter(e => e >= today);
        if (!this.expiries.length) { box.appendChild(el('p', 'pc-note bad', `No upcoming option expiry is listed for ${d.code}.`)); return; }
        if (!this.expiries.includes(this.state.expiry)) this.state.expiry = this.expiries[0];
        box.appendChild(el('p', 'pc-hint', `Draw the profit or loss at expiry you want for ${d.code}: press and drag across the chart, or start from a shape. The wizard looks for the few calls and puts that draw it. Only the shape counts; the height of the curve follows from the premiums.`));
        this.controls = el('div', 'ps-bar');
        box.appendChild(this.controls);
        this.presets = el('div', 'sw-tpl-row');
        this.presets.appendChild(el('span', 'pc-hint sw-tpl-family', 'Start from'));
        PRESETS.forEach(p => this.presets.appendChild(button(p.name, { className: 'pc-btn', onClick: () => { this.points = p.points.map(q => ({ ...q })); this._changed(); } })));
        this.presets.appendChild(button('Clear', { className: 'pc-btn', iconName: 'x', onClick: () => { this.points = []; this._changed(); } }));
        box.appendChild(this.presets);
        this.canvas = el('div', 'sk-canvas');
        box.appendChild(this.canvas);
        this.results = el('div', 'sk-results');
        this.results.setAttribute('aria-live', 'polite');
        box.appendChild(this.results);
        this._axes();
        this._renderControls();
        this._renderCanvas();
        this._renderResults();
        refreshIcons();
    }

    // Levels and money range of the canvas
    _axes() {
        const d = this.data;
        const rows = d.options.filter(o => o.expiration === this.state.expiry && o.kind !== 'future').map(o => ({ CallPut: o.kind === 'call' ? 'C' : 'P', Strike: o.strike, SettlementPrice: o.price }));
        const ladder = strikesOf(d.options, this.state.expiry, 'call');
        const ref = impliedForward(rows) ?? ladder[Math.floor(ladder.length / 2)] ?? 0;
        this.ref = ref;
        this.pv = pointValueOf(d.info) ?? 1;
        this.sMin = ref * (1 - this.state.range);
        this.sMax = ref * (1 + this.state.range);
        // By default the shapes above are one lot: their V is 1.6 times the half height deep, and one lot of a straddle is
        // pointValue * (edge of the level range) deep
        this.amount = this.state.amount ?? Math.max(1, Math.round(this.pv * ref * this.state.range * 0.625));
        this.currency = d.info?.Currency || '';
    }

    _renderControls() {
        const c = this.controls;
        c.innerHTML = '';
        const field = (label, control) => { const f = el('label', 'pc-field'); f.append(el('span', 'pc-hint', label), control); return f; };
        const select = (options, value, onChange, aria) => {
            const s = el('select', 'pc-select');
            s.setAttribute('aria-label', aria);
            options.forEach(([v, t]) => { const o = el('option', '', t); o.value = String(v); s.appendChild(o); });
            s.value = String(value);
            s.addEventListener('change', () => onChange(s.value));
            return s;
        };
        c.appendChild(field('Expiry', select(this.expiries.map(e => [e, e]), this.state.expiry, (v) => { this.state.expiry = v; this._axes(); this._renderControls(); this._changed(); }, 'Expiry')));
        c.appendChild(field('Level range', select([[0.05, '± 5 %'], [0.1, '± 10 %'], [0.2, '± 20 %'], [0.3, '± 30 %']], this.state.range, (v) => { this.state.range = Number(v); this._axes(); this._changed(); }, 'Level range')));
        const amount = el('input', 'sw-num');
        amount.type = 'number';
        amount.min = '1';
        amount.value = String(this.amount);
        amount.style.width = '100px';
        amount.setAttribute('aria-label', 'Profit and loss range of the drawing area');
        amount.addEventListener('input', () => { const v = Number(amount.value); if (v > 0) { this.state.amount = v; this._axes(); this._renderCanvas(); this._suggest(); } });
        c.appendChild(field(`P&L range ± ${this.currency}`.trim(), amount));
        c.appendChild(field('Max legs', select([2, 3, 4, 5, 6].map(n => [n, String(n)]), this.state.maxLegs, (v) => { this.state.maxLegs = Number(v); this._suggest(); }, 'Maximum number of legs')));
        c.appendChild(el('span', 'pc-hint', `Centre ${levelText(this.ref)} (implied forward)`));
    }

    // ---------- Canvas ----------

    _sx(s) { return M.left + ((s - this.sMin) / (this.sMax - this.sMin)) * PW; }
    _sy(y) { return M.top + (1 - (y + this.amount) / (2 * this.amount)) * PH; }
    _pathOf(pts) { return pts.map((p, i) => `${i ? 'L' : 'M'}${this._sx(p.s).toFixed(1)} ${this._sy(p.y).toFixed(1)}`).join(' '); }
    _drawnPts() { return this.points.map(p => ({ s: this.sMin + p.u * (this.sMax - this.sMin), y: p.v * this.amount })); }

    _renderCanvas() {
        const box = this.canvas;
        box.innerHTML = '';
        const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sk-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
        root.setAttribute('aria-label', this.points.length ? 'Your drawn payoff' : 'Drawing area for the payoff you want. Use the shapes above for a keyboard alternative.');
        niceTicks(-this.amount, this.amount, 6).forEach(t => {
            root.appendChild(svg('line', { x1: M.left, x2: W - M.right, y1: this._sy(t), y2: this._sy(t), class: 'lc-grid' }));
            root.appendChild(svg('text', { x: M.left - 8, y: this._sy(t) + 4, 'text-anchor': 'end', class: 'lc-tick' }, compact(t)));
        });
        niceTicks(this.sMin, this.sMax, 7).forEach(t => {
            root.appendChild(svg('line', { x1: this._sx(t), x2: this._sx(t), y1: M.top, y2: H - M.bottom, class: 'lc-grid' }));
            root.appendChild(svg('text', { x: this._sx(t), y: H - M.bottom + 18, 'text-anchor': 'middle', class: 'lc-tick' }, levelText(t)));
        });
        root.appendChild(svg('line', { x1: M.left, x2: W - M.right, y1: this._sy(0), y2: this._sy(0), class: 'pf-zero' }));
        root.appendChild(svg('line', { x1: this._sx(this.ref), x2: this._sx(this.ref), y1: M.top, y2: H - M.bottom, class: 'pf-now' }));
        this.fitPath = svg('path', { class: 'pf-line pf-line2 pf-dashed', fill: 'none' });
        this.drawPath = svg('path', { class: 'sk-line', fill: 'none' });
        root.append(this.fitPath, this.drawPath);
        this.placeholder = svg('text', { x: M.left + PW / 2, y: M.top + PH / 2, 'text-anchor': 'middle', class: 'lc-empty' }, 'Draw here');
        root.appendChild(this.placeholder);
        this._paint();
        const pad = svg('rect', { x: M.left, y: M.top, width: PW, height: PH, class: 'sk-pad' });
        let drawing = false;
        const at = (e) => {
            const r = root.getBoundingClientRect();
            const px = ((e.clientX - r.left) / (r.width || 1)) * W;
            const py = ((e.clientY - r.top) / (r.height || 1)) * H;
            return { u: Math.max(0, Math.min(1, (px - M.left) / PW)), v: Math.max(-1, Math.min(1, 1 - (2 * (py - M.top)) / PH)) };
        };
        root.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            drawing = true;
            try { root.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic events have no pointer to capture */ }
            this.points = [at(e)];
            this.solutions = [];
            this._paint();
            e.preventDefault();
        });
        root.addEventListener('pointermove', (e) => {
            if (!drawing) return;
            const p = at(e);
            const last = this.points[this.points.length - 1];
            if (!last || Math.abs(p.u - last.u) > 0.002 || Math.abs(p.v - last.v) > 0.004) { this.points.push(p); this._paint(); }
        });
        const end = () => { if (!drawing) return; drawing = false; this._suggest(); };
        root.addEventListener('pointerup', end);
        root.addEventListener('pointercancel', end);
        root.appendChild(pad);
        box.appendChild(root);
        this.svg = root;
    }

    // The drawn line and the preview of the selected suggestion
    _paint() {
        this.placeholder.setAttribute('visibility', this.points.length ? 'hidden' : 'visible');
        this.drawPath.setAttribute('d', this.points.length > 1 ? this._pathOf(this._drawnPts()) : '');
        const sol = this.solutions[this.selected];
        // The fitted curve is shown at the height of the drawing, not at the height the premiums would give
        this.fitPath.setAttribute('d', sol && this.grid ? this._pathOf(this.grid.xs.map((s, i) => ({ s, y: sol.fit[i] }))) : '');
    }

    // ---------- Suggestions ----------

    _changed() {
        this._renderCanvas();
        this._suggest();
    }

    _suggest() {
        const d = this.data;
        const target = resample(this._drawnPts(), this.sMin, this.sMax, 160);
        this.grid = target;
        this.solutions = [];
        this.selected = -1;
        if (target) {
            const cands = candidatesFrom(d.options, this.state.expiry, this.pv, target.xs, this.sMin, this.sMax);
            this.solutions = suggest(target, cands, { maxLegs: this.state.maxLegs, ref: this.ref });
            this.selected = recommended(this.solutions);
        }
        this._paint();
        this._renderResults();
    }

    _legsOf(sol) {
        const d = this.data;
        const slot = { product: d.code, options: d.options, info: d.info, group: d.code };
        return sol.legs.map(l => legFromContract(slot, l.cand.contract, l.lots > 0 ? 1 : -1, Math.abs(l.lots)));
    }

    _renderResults() {
        const box = this.results;
        box.innerHTML = '';
        if (!this.points.length) return;
        if (!this.solutions.length) { box.appendChild(el('p', 'pc-hint', this.points.length < 2 ? 'Keep the button pressed and draw a line across the chart.' : 'Nothing to fit: draw a curve that is not flat and covers some of the width.')); return; }
        const best = recommended(this.solutions);
        const list = el('div', 'sk-cards');
        this.solutions.forEach((sol, i) => {
            const card = el('div', `sk-card${i === this.selected ? ' selected' : ''}`);
            const name = nameOf(sol.legs.map(l => ({ kind: l.cand.kind, strike: l.cand.strike, lots: l.lots })));
            const head = el('div', 'sk-card-head');
            head.appendChild(el('strong', '', `${sol.legs.length} leg${sol.legs.length === 1 ? '' : 's'}${name === 'Custom' ? '' : ` · ${name}`}`));
            if (i === best) head.appendChild(el('span', 'sw-tes-badge', 'Recommended'));
            head.appendChild(el('span', 'pc-hint', `match ${Math.max(0, Math.round((1 - sol.rel) * 100))} %`));
            card.appendChild(head);
            const ul = el('ul', 'sk-legs');
            let debit = 0;
            sol.legs.forEach(l => {
                debit += l.lots * l.cand.price * this.pv;
                ul.appendChild(el('li', '', `${l.lots > 0 ? 'Buy' : 'Sell'} ${Math.abs(l.lots)} × ${this.data.code} ${l.cand.kind === 'call' ? 'C' : 'P'} ${levelText(l.cand.strike)} @ ${levelText(l.cand.price)}`));
            });
            card.appendChild(ul);
            card.appendChild(el('p', 'pc-hint', `${debit >= 0 ? 'Net debit' : 'Net credit'} ${Math.abs(Math.round(debit)).toLocaleString('en-US')} ${this.currency} at the last settlement prices`));
            const actions = el('div', 'pc-actions');
            actions.appendChild(button('Preview', { className: 'pc-btn', onClick: () => { this.selected = i; this._paint(); this._renderResults(); } }));
            actions.appendChild(button('Use these legs', { className: 'pc-btn primary', iconName: 'check', onClick: () => this.hooks.onUse(this._legsOf(sol), false) }));
            actions.appendChild(button('Add to legs', { className: 'pc-btn', iconName: 'plus', onClick: () => this.hooks.onUse(this._legsOf(sol), true) }));
            card.appendChild(actions);
            list.appendChild(card);
        });
        box.appendChild(list);
        box.appendChild(el('p', 'pc-hint', 'More legs follow the drawing closer. Combinations that draw the same shape exist (a call spread and a put spread); the one with out-of-the-money legs is shown. The dashed line is the preview of the selected combination.'));
        refreshIcons();
    }
}
