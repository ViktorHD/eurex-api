// Strategy Wizard: from a drawn payoff to a combination of legs.
//
// The drawn curve is the profit / loss at expiry over the underlying level. Every listed call and put of one expiry is a
// candidate whose payoff per lot is known (point value * intrinsic value). The wizard looks for a few candidates with whole
// lot sizes whose sum matches the curve (orthogonal matching pursuit with a swap pass). The vertical position of the
// drawn curve is free: the real position follows from the premiums, so only the shape is fitted (a constant is allowed).
// A future needs no candidate of its own: a call and a put at one strike (long call, short put) are one.

/** Drawn points [{ s, y }] on a regular grid of `n` levels inside the drawn extent and [lo, hi]; null with less than two levels. */
export function resample(points, lo, hi, n = 160) {
    const pts = (points || []).filter(p => Number.isFinite(p.s) && Number.isFinite(p.y)).sort((a, b) => a.s - b.s);
    const merged = [];
    for (const p of pts) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.s - p.s) < 1e-9) { last.sum += p.y; last.n++; } else merged.push({ s: p.s, sum: p.y, n: 1 });
    }
    const xs0 = merged.map(m => ({ s: m.s, y: m.sum / m.n }));
    if (xs0.length < 2) return null;
    const a = Math.max(lo, xs0[0].s);
    const b = Math.min(hi, xs0[xs0.length - 1].s);
    if (!(b > a)) return null;
    const xs = [];
    const ys = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
        const s = a + ((b - a) * i) / (n - 1);
        while (j < xs0.length - 2 && xs0[j + 1].s < s) j++;
        const p = xs0[j];
        const q = xs0[j + 1];
        const t = q.s === p.s ? 0 : Math.max(0, Math.min(1, (s - p.s) / (q.s - p.s)));
        xs.push(s);
        ys.push(p.y + (q.y - p.y) * t);
    }
    return { xs, ys };
}

/**
 * Candidates for one expiry: [{ kind, strike, price, contract, col }] where col is the payoff of one lot on the grid.
 * options: contractOptions rows; only strikes inside [lo, hi] are used (the others are straight lines there).
 */
export function candidatesFrom(options, expiration, pointValue, xs, lo, hi) {
    const seen = new Set();
    const out = [];
    for (const o of options || []) {
        if (o.expiration !== expiration || (o.kind !== 'call' && o.kind !== 'put') || !Number.isFinite(o.strike)) continue;
        if (o.strike < lo || o.strike > hi) continue;
        const key = `${o.kind}${o.strike}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            kind: o.kind, strike: o.strike, price: o.price ?? 0, contract: o,
            col: xs.map(s => pointValue * (o.kind === 'call' ? Math.max(s - o.strike, 0) : Math.max(o.strike - s, 0)))
        });
    }
    return out.sort((a, b) => a.strike - b.strike || a.kind.localeCompare(b.kind));
}

const mean = (v) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Solves A x = b (Gaussian elimination with partial pivoting); null when singular
function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-12) return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
        x[r] = s / M[r][r];
    }
    return x;
}

// Least squares of y on the chosen columns plus a free constant: { w (lots, real), rmse } or null
function lstsq(cols, y) {
    const cc = cols.map(c => { const m = mean(c); return c.map(v => v - m); });
    const yc = y.map(v => v - mean(y));
    const k = cols.length;
    const G = cc.map(a => cc.map(b => dot(a, b)));
    const scale = Math.max(...G.map((r, i) => r[i]), 1);
    for (let i = 0; i < k; i++) G[i][i] += scale * 1e-10; // a hair of ridge keeps near-collinear sets solvable
    const w = solve(G, cc.map(a => dot(a, yc)));
    if (!w) return null;
    const r = yc.map((v, i) => v - cc.reduce((s, c, j) => s + w[j] * c[i], 0));
    return { w, rmse: Math.sqrt(dot(r, r) / y.length) };
}

/** Root-mean-square error of whole-lot weights against the target, with the best constant. */
export function rmseOf(cands, lots, y) {
    const fit = y.map((_, i) => cands.reduce((s, c, j) => s + lots[j] * c.col[i], 0));
    const off = mean(y) - mean(fit);
    return { rmse: Math.sqrt(mean(fit.map((v, i) => (v + off - y[i]) ** 2))), fit: fit.map(v => v + off) };
}

// Call and put of one strike differ by a straight line (C - P = S - K), so flipping legs between them whose lots add up
// to zero keeps the curve. Of all such flips the one with the fewest in-the-money legs is returned.
function preferOutOfTheMoney(used, lots, ys, cands, ref, baseErr, amp) {
    const itm = (c) => (c.kind === 'call' ? c.strike < ref : c.strike > ref);
    const find = (kind, strike) => cands.find(c => c.kind === kind && c.strike === strike);
    let best = used;
    let bestItm = used.filter(itm).length;
    for (let mask = 1; mask < (1 << used.length); mask++) {
        const set = used.map((c, i) => ((mask >> i) & 1 ? find(c.kind === 'call' ? 'put' : 'call', c.strike) : c));
        if (set.some(c => !c) || new Set(set.map(c => `${c.kind}${c.strike}`)).size !== set.length) continue;
        const n = set.filter(itm).length;
        if (n >= bestItm) continue;
        if (rmseOf(set, lots, ys).rmse <= baseErr + amp * 1e-9) { best = set; bestItm = n; }
    }
    return best;
}

/**
 * Up to `maxLegs` solutions, one per number of legs (1..maxLegs, duplicates dropped):
 * [{ legs: [{ cand, lots }] (signed whole lots), rmse, rel (rmse as share of the drawn amplitude), fit (curve on the grid) }]
 * Subsets are found by beam search (the `beam` best subsets of each size are extended by every candidate), then the best
 * one of each size gets whole lots: rounded, then improved one lot at a time. Shapes that several combinations draw
 * equally well (a bull call spread is a bull put spread plus a constant) resolve to the one with out-of-the-money legs
 * when a reference level `ref` is given, because those are the liquid contracts.
 */
export function suggest(target, cands, { maxLegs = 4, maxLots = 10000, beam = cands.length > 100 ? 20 : 40, ref = null } = {}) {
    const { ys } = target;
    const amp = Math.max(...ys) - Math.min(...ys);
    if (!cands.length || !(amp > 0)) return [];
    const usable = cands.map((c) => { const m = mean(c.col); return Math.sqrt(dot(c.col.map(v => v - m), c.col.map(v => v - m))) > 1e-9; });
    const out = [];
    const seen = new Set();
    let level = [{ idx: [], rmse: Infinity }];
    for (let k = 1; k <= Math.min(maxLegs, cands.length); k++) {
        const tried = new Set();
        const next = [];
        for (const base of level) {
            for (let j = 0; j < cands.length; j++) {
                if (!usable[j] || base.idx.includes(j)) continue;
                const idx = [...base.idx, j].sort((x, y) => x - y);
                const key = idx.join(',');
                if (tried.has(key)) continue;
                tried.add(key);
                const r = lstsq(idx.map(i => cands[i].col), ys);
                if (r) {
                    const itm = ref === null ? 0 : idx.filter(i => (cands[i].kind === 'call' ? cands[i].strike < ref : cands[i].strike > ref)).length;
                    next.push({ idx, rmse: r.rmse, w: r.w, score: r.rmse + amp * 1e-5 * itm });
                }
            }
        }
        if (!next.length) break;
        next.sort((x, y) => x.score - y.score);
        level = next.slice(0, beam);
        const top = level[0];
        const used = top.idx.map(i => cands[i]);
        let lots = top.w.map(w => Math.max(-maxLots, Math.min(maxLots, Math.round(w) || Math.sign(w) || 1)));
        // Whole lots: nudge one leg by a lot while that lowers the error (a lot size never drops to zero)
        let cur = rmseOf(used, lots, ys).rmse;
        for (let sweep = 0; sweep < 20; sweep++) {
            let improved = false;
            for (let q = 0; q < lots.length; q++) {
                for (const d of [-1, 1]) {
                    const t = lots.slice();
                    t[q] += d;
                    if (t[q] === 0 || Math.abs(t[q]) > maxLots) continue;
                    const e = rmseOf(used, t, ys).rmse;
                    if (e < cur * (1 - 1e-9)) { lots = t; cur = e; improved = true; }
                }
            }
            if (!improved) break;
        }
        let legsUsed = used;
        if (ref !== null) legsUsed = preferOutOfTheMoney(used, lots, ys, cands, ref, cur, amp);
        const { rmse, fit } = rmseOf(legsUsed, lots, ys);
        const key = legsUsed.map((c, q) => `${c.kind}${c.strike}:${lots[q]}`).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ legs: legsUsed.map((cand, q) => ({ cand, lots: lots[q] })).sort((x, y) => x.cand.strike - y.cand.strike || x.cand.kind.localeCompare(y.cand.kind)), rmse, rel: rmse / amp, fit });
    }
    return out;
}

/** The solution to recommend: the fewest legs whose error is within `slack` (relative) of the best one. */
export function recommended(solutions, slack = 0.02) {
    if (!solutions.length) return -1;
    const best = Math.min(...solutions.map(s => s.rel));
    return solutions.findIndex(s => s.rel <= best + slack);
}

/** Name of a combination when it is a classic one; `legs`: [{ kind, strike, lots }] with signed whole lots. */
export function nameOf(legs) {
    const l = [...legs].sort((a, b) => a.strike - b.strike || a.kind.localeCompare(b.kind));
    const dir = (x) => (x.lots > 0 ? 'Long' : 'Short');
    if (l.length === 1) return `${dir(l[0])} ${l[0].kind}`;
    const calls = l.filter(x => x.kind === 'call');
    const puts = l.filter(x => x.kind === 'put');
    if (l.length === 2) {
        const [a, b] = l;
        if (calls.length === 1 && puts.length === 1) {
            if (a.lots === b.lots) return `${dir(a)} ${a.strike === b.strike ? 'straddle' : 'strangle'}`;
            if (a.lots === -b.lots) {
                const call = calls[0];
                const put = puts[0];
                return call.lots > 0 && put.lots < 0 ? 'Risk reversal' : call.lots < 0 && put.lots > 0 ? 'Reverse risk reversal' : 'Custom';
            }
            return 'Custom';
        }
        if (a.kind === b.kind && a.lots === -b.lots) {
            return `${a.lots > 0 ? 'Bull' : 'Bear'} ${a.kind} spread`; // long the lower strike is bullish for calls and puts alike
        }
        return 'Custom';
    }
    if (l.length === 3 && (calls.length === 3 || puts.length === 3)) {
        const [a, m, b] = l;
        if (a.lots === b.lots && m.lots === -2 * a.lots && Math.abs((m.strike - a.strike) - (b.strike - m.strike)) < 1e-9) return `${dir(a)} ${a.kind} butterfly`;
    }
    if (l.length === 4 && calls.length === 2 && puts.length === 2) {
        const [p1, p2, c1, c2] = l;
        if (p1.kind === 'put' && p2.kind === 'put' && c1.kind === 'call' && c2.kind === 'call' && p1.lots === -p2.lots && c1.lots === -c2.lots && p2.lots === c1.lots) {
            return p2.lots < 0 ? 'Iron condor' : 'Reverse iron condor';
        }
    }
    return 'Custom';
}
