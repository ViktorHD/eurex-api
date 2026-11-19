// Strategy Wizard logic: payoff of a combination of futures and options, possibly across products.
//
// Leg: { id, product, kind: 'future' | 'call' | 'put', strike, expiration ('YYYY-MM-DD'), label, side: 1 | -1, qty,
//        price (entry price in index / price points), pointValue (money per point per contract), currency, group }
//
// Model (kept simple on purpose, shown to the user next to the chart):
//  - The x axis is the move of the first ("leader") underlying group. Every other group moves with
//    S_g = S0_g * (1 + beta_g * x + rel_g): beta couples it to the leader, rel is a fixed relative performance.
//    One group = one underlying: legs of OESX options and FESX futures share a group, FDAX is its own.
//  - A leg's value at the evaluation date is intrinsic value at or after its expiry. Options that live longer are valued
//    with Black-76 (flat volatility, no discounting) and futures at the underlying level (no carry / basis).
//  - P&L = side * qty * pointValue * fx * (value - entry price), in the first leg's currency.

const dayNumber = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
};
export const daysBetween = (fromIso, toIso) => dayNumber(toIso) - dayNumber(fromIso);

export const isOption = (leg) => leg.kind === 'call' || leg.kind === 'put';

// ---------- Black-76 (r = 0) ----------

// Standard normal CDF (Abramowitz & Stegun 26.2.17, error below 1e-7)
export function normCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
}

/** Option value on a forward F: kind 'call' | 'put', years to expiry, volatility as a fraction (0.2 = 20 %). */
export function black76(kind, F, K, years, vol) {
    const intrinsic = kind === 'call' ? Math.max(F - K, 0) : Math.max(K - F, 0);
    if (!(years > 0) || !(vol > 0) || !(F > 0) || !(K > 0)) return intrinsic;
    const sd = vol * Math.sqrt(years);
    const d1 = (Math.log(F / K) + 0.5 * sd * sd) / sd;
    const d2 = d1 - sd;
    return kind === 'call' ? F * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - F * normCdf(-d1);
}

// ---------- Legs ----------

/** Value of one unit of the leg (in points) when its underlying is at `S` on `date`. */
export function legValue(leg, S, { date = null, vol = 0.2 } = {}) {
    if (leg.kind === 'future') return S;
    const K = Number(leg.strike);
    const years = date && leg.expiration ? daysBetween(date, leg.expiration) / 365 : 0;
    return black76(leg.kind, S, K, years, vol);
}

/** Money per unit in the reference currency: side * qty * pointValue * fx. */
export function legScale(leg, fx = {}) {
    const rate = fx[leg.currency] ?? 1;
    return leg.side * leg.qty * (Number(leg.pointValue) || 0) * rate;
}

// ---------- Underlying groups ----------

/** Distinct groups in first-appearance order; the first one is the leader. */
export const groupsOf = (legs) => [...new Set(legs.map(l => l.group || l.product))];

/** Underlying level of a group for a leader move x. groups: { [name]: { s0, beta, rel } } */
export function groupLevel(groups, name, x) {
    const g = groups[name] || { s0: 0, beta: 1, rel: 0 };
    return Math.max(0, g.s0 * (1 + g.beta * x + g.rel));
}

/** Total P&L of all legs for a leader move x at `date` (null = each leg at its own expiry). */
export function strategyPnl(legs, groups, x, { date = null, vol = 0.2, fx = {} } = {}) {
    let total = 0;
    for (const leg of legs) {
        const S = groupLevel(groups, leg.group || leg.product, x);
        total += legScale(leg, fx) * (legValue(leg, S, { date, vol }) - (Number(leg.price) || 0));
    }
    return total;
}

/** The evaluation date of the payoff: the earliest expiry of the legs, or null without legs. */
export function firstExpiry(legs) {
    const dates = legs.map(l => l.expiration).filter(Boolean).sort();
    return dates[0] || null;
}

/** Net premium paid (positive = debit, negative = credit) of the option legs, in the reference currency. */
export function netPremium(legs, fx = {}) {
    return legs.filter(isOption).reduce((s, l) => s + legScale(l, fx) * (Number(l.price) || 0), 0);
}

// ---------- Range and curve ----------

/**
 * Range of leader moves { min, max } that shows every kink: each strike is mapped back to a leader move, then padded.
 * `halfWidth` (fraction, e.g. 0.2) overrides the automatic range with +-halfWidth around the current level.
 */
export function moveRange(legs, groups, halfWidth = null) {
    if (halfWidth > 0) return { min: Math.max(-0.95, -halfWidth), max: halfWidth };
    const xs = [0];
    for (const leg of legs) {
        if (!isOption(leg)) continue;
        const g = groups[leg.group || leg.product];
        if (!g || !(g.s0 > 0) || !g.beta) continue;
        xs.push((Number(leg.strike) / g.s0 - 1 - g.rel) / g.beta);
    }
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    // Breakevens lie outside the strikes by about the premium, so the padding grows with it
    const leader = groupsOf(legs)[0];
    const s0 = groups[leader]?.s0 || 0;
    const premium = s0 > 0 ? legs.filter(l => isOption(l) && (l.group || l.product) === leader).reduce((s, l) => s + Math.abs(Number(l.price) || 0) * l.qty, 0) / s0 : 0;
    const pad = Math.max(0.1, (hi - lo) * 0.5, premium * 1.5);
    return { min: Math.max(-0.95, lo - pad), max: hi + pad };
}

/** Curve over [min, max] with `steps` intervals plus the kinks (strikes), sorted: [{ x, s, y }] (s = leader level). */
export function curve(legs, groups, range, options = {}) {
    const steps = options.steps || 240;
    const leader = groupsOf(legs)[0];
    const xs = new Set();
    for (let i = 0; i <= steps; i++) xs.add(range.min + ((range.max - range.min) * i) / steps);
    for (const leg of legs) {
        if (!isOption(leg)) continue;
        const g = groups[leg.group || leg.product];
        if (!g || !(g.s0 > 0) || !g.beta) continue;
        const x = (Number(leg.strike) / g.s0 - 1 - g.rel) / g.beta;
        if (x > range.min && x < range.max) xs.add(x);
    }
    return [...xs].sort((a, b) => a - b).map(x => ({ x, s: groupLevel(groups, leader, x), y: strategyPnl(legs, groups, x, options) }));
}

// ---------- Analysis ----------

/** Leader moves where the curve crosses zero (linear interpolation), as [{ x, s }]. */
export function breakevens(points) {
    const out = [];
    const add = (p) => { if (!out.length || Math.abs(p.x - out[out.length - 1].x) > 1e-9) out.push(p); };
    if (points[0]?.y === 0 && points[1] && points[1].y !== 0) add({ x: points[0].x, s: points[0].s });
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if ((a.y < 0 && b.y > 0) || (a.y > 0 && b.y < 0)) {
            const t = a.y / (a.y - b.y);
            add({ x: a.x + (b.x - a.x) * t, s: a.s + (b.s - a.s) * t });
        } else if (b.y === 0 && a.y !== 0) {
            add({ x: b.x, s: b.s });
        }
    }
    return out;
}

const slopeAt = (points, end) => {
    const n = points.length;
    const [a, b] = end === 'upper' ? [points[n - 2], points[n - 1]] : [points[0], points[1]];
    return a && b && b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
};

/**
 * Summary of a payoff curve: { maxProfit, maxLoss, unlimitedProfit, unlimitedLoss, breakevens }.
 * maxProfit / maxLoss are taken over the shown range; "unlimited" means the curve still rises (falls) at the upper end.
 * That is only claimed for an exact curve (every option at its expiry, so the tail is a straight line); a curve with
 * model-valued legs bends towards its limit, so its slope at the edge of the range says nothing about the tail.
 */
export function analyze(points, { exact = true } = {}) {
    if (points.length < 2) return { maxProfit: 0, maxLoss: 0, unlimitedProfit: false, unlimitedLoss: false, breakevens: [] };
    const ys = points.map(p => p.y);
    const scale = Math.max(...ys.map(Math.abs), 1);
    const upper = slopeAt(points, 'upper');
    const rising = (upper * (points[points.length - 1].x - points[points.length - 2].x)) / scale;
    const tol = 1e-6;
    return {
        maxProfit: Math.max(...ys),
        maxLoss: Math.min(...ys),
        unlimitedProfit: exact && rising > tol,
        unlimitedLoss: exact && rising < -tol,
        breakevens: breakevens(points)
    };
}

// ---------- Reference levels ----------

/**
 * Forward implied by put-call parity (F = K + C - P at r = 0) of the strike where call and put settlement prices are
 * closest. rows: [{ CallPut, Strike, SettlementPrice }] of ONE expiry. Returns null without a usable pair.
 */
export function impliedForward(rows) {
    const byStrike = new Map();
    for (const r of rows || []) {
        const cp = String(r.CallPut || '').toUpperCase().charAt(0);
        const K = Number(r.Strike);
        const px = Number(r.SettlementPrice);
        if (!['C', 'P'].includes(cp) || !Number.isFinite(K) || !(px > 0)) continue;
        const e = byStrike.get(K) || {};
        e[cp] = px;
        byStrike.set(K, e);
    }
    let best = null;
    for (const [K, e] of byStrike) {
        if (e.C === undefined || e.P === undefined) continue;
        const gap = Math.abs(e.C - e.P);
        if (!best || gap < best.gap) best = { gap, F: K + e.C - e.P };
    }
    return best ? best.F : null;
}

/** Default reference level of a group: its futures' entry prices, else the parity forward, else the middle strike. */
export function defaultLevel(legs, forwards = {}) {
    const futures = legs.filter(l => l.kind === 'future' && Number(l.price) > 0);
    if (futures.length) return futures.reduce((s, l) => s + Number(l.price), 0) / futures.length;
    for (const l of legs) if (forwards[l.id] > 0) return forwards[l.id];
    const strikes = legs.filter(isOption).map(l => Number(l.strike)).filter(Number.isFinite).sort((a, b) => a - b);
    return strikes.length ? strikes[Math.floor(strikes.length / 2)] : 0;
}

// ---------- Contract data helpers ----------

/** Money per point of a product: TickValue / TickSize, else ContractSize, else null. */
export function pointValueOf(info) {
    const tv = Number(info?.TickValue);
    const ts = Number(info?.TickSize);
    if (tv > 0 && ts > 0) return tv / ts;
    const cs = Number(info?.ContractSize);
    return cs > 0 ? cs : null;
}

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');

/** Contracts rows of a product as legs candidates: { kind, strike, expiration, label, price, contractDate }. */
export function contractOptions(rows) {
    const out = [];
    for (const r of rows || []) {
        const cp = String(r.CallPut || '').toUpperCase().charAt(0);
        const expiration = isoDate(r.ExpirationDate) || isoDate(r.LastTradingDate);
        if (!expiration) continue;
        const kind = cp === 'C' ? 'call' : cp === 'P' ? 'put' : 'future';
        const strike = kind === 'future' ? null : Number(r.Strike);
        if (kind !== 'future' && !Number.isFinite(strike)) continue;
        const px = Number(r.SettlementPrice);
        out.push({
            kind, strike, expiration,
            contractDate: r.ContractDate || '',
            cycle: String(r.ContractCycle || '').toUpperCase(),
            label: r.Contract || '',
            price: Number.isFinite(px) && px > 0 ? px : null
        });
    }
    return out.sort((a, b) => a.expiration.localeCompare(b.expiration) || (a.strike ?? 0) - (b.strike ?? 0));
}

/** Expirations of one kind family: 'future' or 'option' (calls and puts), distinct, soonest first. */
export function expirationsOf(options, family) {
    const wanted = (o) => (family === 'future' ? o.kind === 'future' : o.kind !== 'future');
    return [...new Set(options.filter(wanted).map(o => o.expiration))].sort();
}

/** Strikes available for an expiry and option kind, ascending. */
export const strikesOf = (options, expiration, kind) =>
    [...new Set(options.filter(o => o.expiration === expiration && o.kind === kind).map(o => o.strike))].sort((a, b) => a - b);

/** Contract matching a leg specification, or null. */
export function findContract(options, kind, expiration, strike = null) {
    return options.find(o => o.kind === kind && o.expiration === expiration && (kind === 'future' || o.strike === strike)) || null;
}

/** The strike closest to `level` from a sorted list, with the index; null for an empty list. */
export function nearestStrike(strikes, level) {
    if (!strikes.length) return null;
    let at = 0;
    strikes.forEach((k, i) => { if (Math.abs(k - level) < Math.abs(strikes[at] - level)) at = i; });
    return { strike: strikes[at], index: at };
}
