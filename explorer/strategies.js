// Strategy Wizard templates and TES profile shortcuts.
//
// A template is a list of leg specs relative to a centre strike ("offset" counts listed strikes away from it, "w" is the
// wing width in strikes chosen by the user). A spec names the product slot it belongs to (0 = first product, 1 = second)
// and the expiry slot (0 = first expiry, 1 = second). Slots are filled by the wizard with real contracts.
import { strikesOf, findContract, nearestStrike, pointValueOf } from './payoff.js';
import { isRollProduct } from './roll.js';
import { profileGroups, tiers, tierFor } from './tes.js';

const L = (kind, side, offset = 0, extra = {}) => ({ kind, side, offset, qty: 1, slot: 0, expiry: 0, ...extra });

export const FAMILIES = { vol: 'Volatility', direction: 'Directional', income: 'Income / hedge', spread: 'Spreads' };

/**
 * needs: product kinds of the slots ('option' | 'future'); expiries: how many expiries the wizard asks for;
 * tes: true when the combination can be entered as a TES strategy within one product; the wizard only badges it when the
 * product's TES profiles contain a strategy instrument type (tesSupport).
 */
export const TEMPLATES = [
    { id: 'long-straddle', name: 'Long straddle', family: 'vol', needs: ['option'], expiries: 1, tes: true, hint: 'Buy call and put at the same strike: profits from a large move either way.', legs: [L('call', 1), L('put', 1)] },
    { id: 'short-straddle', name: 'Short straddle', family: 'vol', needs: ['option'], expiries: 1, tes: true, hint: 'Sell call and put at the same strike: collects premium if the market stays put.', legs: [L('call', -1), L('put', -1)] },
    { id: 'long-strangle', name: 'Long strangle', family: 'vol', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Buy an out-of-the-money call and put: cheaper than a straddle, needs a bigger move.', legs: [L('call', 1, 1), L('put', 1, -1)] },
    { id: 'short-strangle', name: 'Short strangle', family: 'vol', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Sell an out-of-the-money call and put.', legs: [L('call', -1, 1), L('put', -1, -1)] },
    { id: 'bull-call-spread', name: 'Bull call spread', family: 'direction', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Buy a call, sell a higher call: limited profit and loss, bullish.', legs: [L('call', 1), L('call', -1, 1)] },
    { id: 'bear-put-spread', name: 'Bear put spread', family: 'direction', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Buy a put, sell a lower put: limited profit and loss, bearish.', legs: [L('put', 1), L('put', -1, -1)] },
    { id: 'bull-put-spread', name: 'Bull put spread', family: 'income', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Sell a put, buy a lower put: credit spread, bullish to neutral.', legs: [L('put', -1), L('put', 1, -1)] },
    { id: 'bear-call-spread', name: 'Bear call spread', family: 'income', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Sell a call, buy a higher call: credit spread, bearish to neutral.', legs: [L('call', -1), L('call', 1, 1)] },
    { id: 'risk-reversal', name: 'Risk reversal', family: 'direction', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Sell a put, buy a call: synthetic long exposure with a skew view.', legs: [L('put', -1, -1), L('call', 1, 1)] },
    { id: 'call-butterfly', name: 'Call butterfly', family: 'income', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Buy the wings, sell two at the centre: profits if the market pins the centre strike.', legs: [L('call', 1, -1), L('call', -1, 0, { qty: 2 }), L('call', 1, 1)] },
    { id: 'iron-condor', name: 'Iron condor', family: 'income', needs: ['option'], expiries: 1, tes: true, wings: true, hint: 'Sell a strangle, buy protection further out: defined risk in a range.', legs: [L('put', 1, -2), L('put', -1, -1), L('call', -1, 1), L('call', 1, 2)] },
    { id: 'call-calendar', name: 'Call calendar', family: 'vol', needs: ['option'], expiries: 2, tes: true, hint: 'Sell the near, buy the far call at one strike: long time value and vega. Valued with the volatility model.', legs: [L('call', -1), L('call', 1, 0, { expiry: 1 })] },
    { id: 'covered-call', name: 'Covered call', family: 'income', needs: ['option', 'future'], expiries: 1, tes: true, wings: true, hint: 'Long future, short out-of-the-money call (option and future may be different products).', legs: [L('future', 1, 0, { slot: 1 }), L('call', -1, 1)] },
    { id: 'protective-put', name: 'Protective put', family: 'income', needs: ['option', 'future'], expiries: 1, tes: true, hint: 'Long future with a put as insurance.', legs: [L('future', 1, 0, { slot: 1 }), L('put', 1)] },
    { id: 'futures-calendar', name: 'Futures calendar spread', family: 'spread', needs: ['future'], expiries: 2, tes: true, hint: 'Buy the near, sell the far future of one product (roll or curve view).', legs: [L('future', 1), L('future', -1, 0, { expiry: 1 })] },
    { id: 'inter-product', name: 'Inter-product spread', family: 'spread', needs: ['future', 'future'], expiries: 1, tes: false, hint: 'Buy one product, sell another (e.g. FESX vs FDAX). The second product follows the first with a beta you can set.', legs: [L('future', 1), L('future', -1, 0, { slot: 1 })] }
];

export const templateById = (id) => TEMPLATES.find(t => t.id === id) || null;

/** 'option' | 'future' | null for a ProductInfos row (the same split the Strike Window and Roll Tracker use). */
export function productKind(p) {
    if (!p) return null;
    if (String(p.ProductTypeCode || '').toUpperCase().startsWith('O')) return 'option';
    return isRollProduct(p) ? 'future' : null;
}

/** Templates whose first slot suits a product of this kind. */
export const templatesFor = (kind) => TEMPLATES.filter(t => t.needs[0] === kind);

// ---------- TES profiles ----------

const STRATEGY = /STRATEG/i;

/**
 * What the TES profiles of a product allow: { types: ['BLOCK', ...], simple, strategy, groups }.
 * Strategy entry is available when a profile with an instrument type containing STRATEGY exists. Without profiles
 * nothing is assumed (`known: false`).
 */
export function tesSupport(profiles) {
    const groups = profileGroups(profiles);
    return {
        known: groups.length > 0,
        types: [...new Set(groups.map(g => g.tesType).filter(Boolean))],
        simple: groups.some(g => !STRATEGY.test(g.instrumentType)),
        strategy: groups.some(g => STRATEGY.test(g.instrumentType)),
        groups
    };
}

/**
 * Minimum TES lot sizes for a position: for each profile group the tier that applies to `expirationIndex`
 * (1 = front expiry). Returns [{ tesType, instrumentType, minLotSize, nonDisclosureLimit }].
 */
export function tesMinimums(profiles, expirationIndex) {
    return profileGroups(profiles).map(g => {
        const t = tierFor(tiers(profiles, g), expirationIndex);
        return { tesType: g.tesType, instrumentType: g.instrumentType, minLotSize: t?.minLotSize ?? null, nonDisclosureLimit: t?.nonDisclosureLimit ?? null };
    });
}

// ---------- Building legs ----------

// Ids are unique across page loads, because legs are stored in the browser and restored next to new ones
let counter = 0;
const session = Date.now().toString(36);
export const newLegId = () => `leg${session}${++counter}`;

/**
 * Legs of a template for chosen contracts.
 * ctx: { slots: [{ product, options (contractOptions of the product), info (ProductInfos row), group }],
 *        expiries: ['YYYY-MM-DD', ...], level (centre price of slot 0), width (strikes, default 1) }
 * Returns { legs, missing: [text] }; a spec without a matching contract is reported instead of guessed.
 */
export function buildLegs(template, ctx) {
    const width = Math.max(1, Math.round(ctx.width || 1));
    const legs = [];
    const missing = [];
    // The centre strike is taken from the first slot that has options for the first expiry
    const centreSlot = ctx.slots.find(s => s.options.some(o => o.kind !== 'future' && o.expiration === ctx.expiries[0]));
    const ladder = (slot, expiration) => strikesOf(slot.options, expiration, 'call');
    const centre = centreSlot ? nearestStrike(ladder(centreSlot, ctx.expiries[0]), ctx.level) : null;
    for (const spec of template.legs) {
        const slot = ctx.slots[spec.slot];
        const expiration = ctx.expiries[spec.expiry];
        if (!slot || !expiration) { missing.push(`${spec.kind} leg: no ${slot ? 'expiry' : 'product'} chosen`); continue; }
        let strike = null;
        if (spec.kind !== 'future') {
            const ks = strikesOf(slot.options, expiration, spec.kind);
            const wanted = spec.offset * width;
            const base = nearestStrike(ks, centre ? centre.strike : ctx.level);
            const at = base ? base.index + wanted : -1;
            if (at < 0 || at >= ks.length) { missing.push(`${slot.product} ${spec.kind} ${expiration}: strike ${wanted > 0 ? '+' : ''}${wanted} steps is not listed`); continue; }
            strike = ks[at];
        }
        let contract = findContract(slot.options, spec.kind, expiration, strike);
        // A future rarely expires on the option's day (options on fixed income futures expire earlier): take the first one after it
        if (!contract && spec.kind === 'future') {
            const next = slot.options.filter(o => o.kind === 'future' && o.expiration >= expiration).sort((a, b) => a.expiration.localeCompare(b.expiration))[0];
            contract = next || null;
        }
        if (!contract) { missing.push(`${slot.product} ${spec.kind} ${expiration}${strike !== null ? ` ${strike}` : ''} is not listed`); continue; }
        legs.push(legFromContract(slot, contract, spec.side, spec.qty));
    }
    return { legs, missing };
}

/** A leg for a listed contract of a product slot. */
export function legFromContract(slot, contract, side = 1, qty = 1) {
    return {
        id: newLegId(),
        product: slot.product,
        kind: contract.kind,
        strike: contract.strike,
        expiration: contract.expiration,
        label: contract.label || `${slot.product} ${contract.expiration}${contract.strike !== null ? ` ${contract.strike}` : ''}`,
        side,
        qty,
        price: contract.price ?? 0,
        priceFromSettlement: contract.price !== null,
        pointValue: pointValueOf(slot.info) ?? 1,
        pointValueKnown: pointValueOf(slot.info) !== null,
        currency: slot.info?.Currency || '',
        group: slot.group || slot.product
    };
}
