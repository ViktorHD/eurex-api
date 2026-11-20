// Strategy Wizard: combine futures and options (also across products) and see the payoff profile.
// Data is loaded per product, on demand: picking a product loads its master data, TES profiles, expirations and
// contracts (a few small requests filtered by Product), so nothing is fetched for products you do not use.
import { el, button, refreshIcons } from './dom.js';
import { fetchProductCatalog } from './catalog.js';
import { buildSchemaIndex } from './schemacheck.js';
import { buildInfoQuery, buildContractsQuery } from './strategyquery.js';
import {
    contractOptions, expirationsOf, strikesOf, findContract, nearestStrike, impliedForward, defaultLevel, groupsOf, isOption,
    curve, moveRange, analyze, firstExpiry, netPremium, strategyPnl, legLevel, valueAtLevel, snapToStep, stepStrike
} from './payoff.js';
import { TEMPLATES, FAMILIES, templateById, templatesFor, productKind, tesSupport, tesMinimums, buildLegs, legFromContract } from './strategies.js';
import { renderPayoffChart } from './payoffchart.js';
import { SketchPanel } from './sketchview.js';
import { resample } from './fit.js';
import { cetDate } from './tradingstatus.js';
import { formatDateString } from './displayformat.js';
import { downloadText } from './ui.js';

const STORE_KEY = 'eurexExplorer.strategy';
const MAX_PAGES = 10;
const KIND_LABEL = { future: 'Future', call: 'Call', put: 'Put' };
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const money = (v, cur = '') => `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}${cur ? ` ${cur}` : ''}`;
const levelText = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(2))));

const load = (storage = globalThis.localStorage) => { try { return JSON.parse(storage?.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } };
const save = (state, storage = globalThis.localStorage) => { try { storage?.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } };

export class StrategyView {
    /** els: { content }; options: { getSchema, onOpenProduct(code) } */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
        this.built = false;
        this.catalog = null;       // products that can be a leg (options and futures)
        this.all = null;
        this.loading = new Map();  // product -> Promise<data>
        this.loaded = new Map();   // product -> data
        this.legs = [];
        this.cfg = {};             // group -> { s0, auto, beta, rel }
        this.settings = { vol: 20, range: '', today: false, fx: {} };
        this.main = '';
        this.tpl = null;
        this.pickerId = 0;
    }

    async show() {
        if (!this.built) this._build();
        if (this.catalog) return;
        this.status.textContent = 'Loading products…';
        try {
            this.all = await fetchProductCatalog(this.client);
            this.catalog = this.all.filter(p => productKind(p)).sort((a, b) => a.Product.localeCompare(b.Product));
            this.status.textContent = '';
            this.pickers.forEach(p => p.refill());
            this._restore();
        } catch (err) {
            this.status.textContent = '';
            this._alert(`The product list could not be loaded: ${err.message}`);
        }
    }

    // ---------- Layout ----------

    _build() {
        this.built = true;
        this.pickers = [];
        const box = this.els.content;
        box.innerHTML = '';
        box.appendChild(el('p', 'pc-hint', 'Pick a product, start from a template or add legs one by one, and combine legs of different products for inter-product spreads. Data is loaded only for the products you choose.'));
        this.alertBox = el('p', 'pc-note bad');
        this.alertBox.setAttribute('role', 'alert');
        this.alertBox.hidden = true;
        this.status = el('p', 'pc-hint ps-status');
        this.status.setAttribute('role', 'status');
        box.append(this.alertBox, this.status);

        // Two columns on a wide screen, three on a very wide one: the inputs on the left (product, legs, scenario), the wish
        // (drawing) and the result (payoff) next to each other on the right, both kept in view while the legs are edited.
        const grid = el('div', 'sw-grid');
        const left = el('div', 'sw-left');
        const right = el('div', 'sw-right');
        grid.append(left, right);
        box.appendChild(grid);
        const step = (parent, title, hint, cls = '') => {
            const sec = el('section', `pc-card sw-step ${cls}`.trim());
            const head = el('div', 'pc-card-head');
            head.appendChild(el('h3', '', title));
            if (hint) head.appendChild(el('span', 'pc-hint', hint));
            sec.appendChild(head);
            parent.appendChild(sec);
            return sec;
        };

        // 1 · Product and template
        const s1 = step(left, '1 · Product and template', 'optional shortcut');
        this.mainPicker = this._picker({ placeholder: 'Product, e.g. OESX', onPick: (code) => this._pickMain(code) });
        s1.appendChild(this.mainPicker.root);
        this.productInfo = el('div', 'sw-info');
        s1.appendChild(this.productInfo);
        this.templates = el('div', 'sw-templates');
        s1.appendChild(this.templates);
        this.tplForm = el('div', 'sw-form');
        s1.appendChild(this.tplForm);

        // 2 · Legs
        const s2 = step(left, '2 · Legs', 'side, quantity and entry price are editable');
        this.legsBox = el('div', 'sw-legs');
        s2.appendChild(this.legsBox);
        this.builder = el('div', 'sw-builder');
        s2.appendChild(this.builder);
        this.tesBox = el('div', 'sw-tes');
        s2.appendChild(this.tesBox);

        // 3 · Scenario and model
        const s3 = step(left, '3 · Scenario and model');
        this.scenario = el('div', 'sw-scenario');
        s3.appendChild(this.scenario);

        // Wish: draw the payoff and let the wizard suggest the legs
        const sk = step(right, 'Your wish · draw the payoff', 'suggests the legs', 'sw-wish');
        const skBody = el('div', 'sk-panel');
        sk.appendChild(skBody);
        this.sketch = new SketchPanel(skBody, {
            getData: () => (this.main ? this.loaded.get(this.main) || null : null),
            onChange: () => { if (this.out) this._renderResult(); },
            onUse: (legs, append) => {
                this.legs = append ? [...this.legs, ...legs] : legs;
                this._legsChanged({ resetLevels: !append });
                this.legsBox.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }
        });

        // Result: the payoff of the legs
        const s4 = step(right, 'Result · payoff of your legs', '', 'sw-result');
        this.out = el('div', 'sw-out');
        s4.appendChild(this.out);
        this._renderBuilder();
        this._renderLegs();
        this._renderScenario();
        this._renderResult();
        refreshIcons();
    }

    _alert(text) { this.alertBox.hidden = !text; this.alertBox.textContent = text || ''; }

    _field(label, control, className = '') {
        const f = el('label', `pc-field ${className}`.trim());
        f.appendChild(el('span', 'pc-hint', label));
        f.appendChild(control);
        return f;
    }

    _select(options, value, onChange, label) {
        const s = el('select', 'pc-select');
        if (label) s.setAttribute('aria-label', label);
        options.forEach(([v, text]) => { const o = el('option', '', text); o.value = String(v); s.appendChild(o); });
        if (value !== undefined && value !== null) s.value = String(value);
        s.addEventListener('change', () => onChange(s.value));
        return s;
    }

    _number(value, onInput, { label, step = 'any', min = null, width = 90 } = {}) {
        const i = el('input', 'sw-num');
        i.type = 'number';
        i.step = step;
        if (min !== null) i.min = String(min);
        i.value = Number.isFinite(value) ? String(value) : '';
        i.style.width = `${width}px`;
        if (label) i.setAttribute('aria-label', label);
        i.addEventListener('input', () => onInput(num(i.value), i));
        return i;
    }

    // A product input with a product type filter (the prefilter that keeps the request volume down).
    // onPick(code) runs for a valid product only; invalid input is explained and ignored.
    _picker({ placeholder, onPick, kind = null }) {
        const id = `swList${++this.pickerId}`;
        // Pickers that were redrawn away are forgotten
        this.pickers = (this.pickers || []).filter(p => this.els.content.contains(p.root));
        const root = el('div', 'ps-bar sw-picker');
        const typeSelect = el('select', 'pc-select');
        typeSelect.setAttribute('aria-label', 'Product type');
        const typeField = el('label', 'pc-field');
        typeField.append(el('span', 'pc-hint', 'Product type'), typeSelect);
        const input = el('input');
        input.type = 'text';
        input.maxLength = 32;
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        input.setAttribute('list', id);
        input.style.textTransform = 'uppercase';
        const list = el('datalist');
        list.id = id;
        const form = el('form', 'pc-field rt-symbol');
        form.setAttribute('autocomplete', 'off');
        form.append(el('span', 'pc-hint', 'Product'), input, list);
        const note = el('span', 'pc-hint sw-pick-note');
        root.append(typeField, form, note);
        // The product that is already in place: choosing it again (a blur after typing fires another change event
        // that would redraw the buttons under the pointer and swallow the click) does nothing
        let committed = '';
        const usable = () => (this.catalog || []).filter(p => !kind || productKind(p) === kind);
        const picker = {
            root, input, note,
            refill: () => {
                const cur = typeSelect.value;
                typeSelect.innerHTML = '';
                const all = el('option', '', 'All types');
                all.value = '';
                typeSelect.appendChild(all);
                [...new Set(usable().map(p => p.ProductType || 'Other'))].sort().forEach(t => { const o = el('option', '', t); o.value = t; typeSelect.appendChild(o); });
                typeSelect.value = cur;
                list.innerHTML = '';
                usable().filter(p => !typeSelect.value || (p.ProductType || 'Other') === typeSelect.value).forEach(p => { const o = el('option', '', p.Name || ''); o.value = p.Product; list.appendChild(o); });
            },
            set: (code) => { input.value = code || ''; committed = code || ''; note.textContent = ''; note.classList.remove('bad'); input.classList.remove('invalid'); },
            retry: () => { committed = ''; },
            submit: () => {
                const code = input.value.trim().toUpperCase();
                input.value = code;
                if (!code) return;
                const p = usable().find(x => x.Product === code);
                const known = (this.all || []).find(x => x.Product === code);
                const reason = p ? '' : !known ? `No product ${code} was found.` : kind ? `${code} is not a ${kind} product.` : `${code} is neither an options nor a futures product.`;
                input.classList.toggle('invalid', Boolean(reason));
                note.textContent = reason;
                note.classList.toggle('bad', Boolean(reason));
                if (reason || code === committed) return;
                committed = code;
                onPick(code);
            }
        };
        typeSelect.addEventListener('change', picker.refill);
        form.addEventListener('submit', (e) => { e.preventDefault(); picker.submit(); });
        input.addEventListener('change', picker.submit);
        this.pickers.push(picker);
        picker.refill();
        return picker;
    }

    // ---------- Product data ----------

    async _index() {
        if (this._schemaIndex === undefined) {
            try { this._schemaIndex = buildSchemaIndex(await this.options.getSchema?.()) || null; } catch (e) { this._schemaIndex = null; }
        }
        return this._schemaIndex;
    }

    /** Loads (once) what a product needs: master data, TES profiles, expirations and all contracts. */
    ensure(code) {
        if (this.loaded.has(code)) return Promise.resolve(this.loaded.get(code));
        if (!this.loading.has(code)) {
            const p = this._fetch(code).then(d => { this.loaded.set(code, d); return d; });
            p.catch(() => this.loading.delete(code));
            this.loading.set(code, p);
        }
        return this.loading.get(code);
    }

    async _fetch(code) {
        const index = await this._index();
        const fromCatalog = (this.all || []).find(p => p.Product === code) || { Product: code };
        let info = fromCatalog;
        let tes = [];
        let expirations = [];
        try {
            const { query } = buildInfoQuery(code, index);
            if (query) {
                const res = await this.client.request(query, null, false);
                info = { ...fromCatalog, ...(res?.ProductInfos?.data?.[0] || {}) };
                tes = res?.TESProfiles?.data || [];
                expirations = res?.Expirations?.data || [];
            }
        } catch (e) { /* TES, expirations and point value are optional: the legs still work */ }
        const rows = [];
        let after = null;
        let partial = false;
        for (let page = 0; page < MAX_PAGES; page++) {
            const { query, error } = buildContractsQuery(code, index, { after });
            if (error) throw new Error(error);
            const res = await this.client.request(query, null, false);
            rows.push(...(res?.Contracts?.data || []));
            const info2 = res?.Contracts?.pageInfo;
            if (!info2?.hasNextPage || !info2.endCursor) break;
            after = info2.endCursor;
            if (page === MAX_PAGES - 1) partial = true;
        }
        return { code, info, kind: productKind(info), tes, expirations, options: contractOptions(rows), partial };
    }

    _upcoming(data, family) {
        const today = cetDate();
        return expirationsOf(data.options, family).filter(d => d >= today);
    }

    // ---------- Step 1: product and templates ----------

    async _pickMain(code) {
        this._alert('');
        this.main = code;
        this.builderState.product = code;
        this.builderPicker.set(code);
        this.productInfo.textContent = '';
        this.productInfo.appendChild(el('span', 'pc-loading', `Loading ${code}…`));
        try {
            const d = await this.ensure(code);
            if (this.main !== code) return;
            this._renderProductInfo(d);
            this._renderTemplates(d);
            this._renderBuilder();
            this.sketch.refresh();
        } catch (err) {
            if (this.main !== code) return;
            this.mainPicker.retry();
            this.productInfo.textContent = '';
            this._alert(`${code}: ${err.message}`);
        }
    }

    _renderProductInfo(d) {
        const box = this.productInfo;
        box.innerHTML = '';
        const chips = el('div', 'pc-chips');
        const chip = (t) => chips.appendChild(el('span', 'pc-chip', t));
        chip(`${d.code} · ${d.info.Name || d.info.ProductType || ''}`.replace(/ · $/, ''));
        chip(d.kind === 'option' ? 'Options' : 'Futures');
        if (d.info.Currency) chip(d.info.Currency);
        const tes = tesSupport(d.tes);
        if (tes.known) {
            chip(`TES: ${tes.types.join(', ') || 'profiles'}`);
            chip(tes.strategy ? 'TES strategies supported' : 'TES simple instruments only');
        } else chip('TES profiles not available');
        box.appendChild(chips);
        if (d.partial) box.appendChild(el('p', 'pc-note bad', `Only the first ${MAX_PAGES} pages of contracts were loaded for ${d.code}; some strikes may be missing.`));
        const cardBtn = button('Product card', { className: 'pc-btn', iconName: 'layers', onClick: () => this.options.onOpenProduct?.(d.code) });
        box.appendChild(cardBtn);
        refreshIcons();
    }

    // The TES profiles are the shortcut for supported instrument types: strategies are marked when the product has a
    // strategy instrument type, and the shortcut list only offers templates that fit the product kind.
    _renderTemplates(d) {
        const box = this.templates;
        box.innerHTML = '';
        const tes = tesSupport(d.tes);
        const groups = {};
        templatesFor(d.kind).forEach(t => { (groups[t.family] = groups[t.family] || []).push(t); });
        Object.entries(FAMILIES).forEach(([key, name]) => {
            if (!groups[key]) return;
            const row = el('div', 'sw-tpl-row');
            row.appendChild(el('span', 'pc-hint sw-tpl-family', name));
            groups[key].forEach(t => {
                const b = button(t.name, { className: `pc-btn sw-tpl${this.tpl?.id === t.id ? ' active' : ''}`, title: t.hint, onClick: () => this._startTemplate(t.id) });
                if (t.tes && tes.strategy && t.needs.length === 1) b.appendChild(el('span', 'sw-tes-badge', 'TES'));
                row.appendChild(b);
            });
            box.appendChild(row);
        });
        const custom = el('div', 'sw-tpl-row');
        custom.appendChild(el('span', 'pc-hint sw-tpl-family', 'Other'));
        custom.appendChild(button('Clear all legs', { className: 'pc-btn', iconName: 'trash-2', onClick: () => { this.legs = []; this._legsChanged(); } }));
        box.appendChild(custom);
        refreshIcons();
    }

    async _startTemplate(id) {
        const t = templateById(id);
        const d = this.loaded.get(this.main);
        if (!t || !d) return;
        this.tpl = { id, slots: [this.main, ''], expiries: [], centre: null, width: 1 };
        this._renderTemplates(d);
        this._renderTplForm();
    }

    // Slot data of the running template (null while a product is missing or loading)
    _slot(i) {
        const code = this.tpl?.slots[i];
        const d = code ? this.loaded.get(code) : null;
        return d ? { product: d.code, options: d.options, info: d.info, group: d.code, data: d } : null;
    }

    // The expiry list of expiry slot j: from the first leg spec using it, preferring option specs
    _expiryChoices(t, j) {
        const specs = t.legs.filter(s => s.expiry === j);
        const spec = specs.find(s => s.kind !== 'future') || specs[0];
        const slot = spec ? this._slot(spec.slot) : null;
        return slot ? this._upcoming(slot.data, spec.kind === 'future' ? 'future' : 'option') : [];
    }

    _renderTplForm() {
        const box = this.tplForm;
        box.innerHTML = '';
        const t = templateById(this.tpl?.id);
        if (!t) return;
        const st = this.tpl;
        box.appendChild(el('p', 'pc-hint', t.hint));
        const row = el('div', 'ps-bar');
        // Second product (inter-product spread, covered call, protective put)
        if (t.needs.length > 1) {
            const kind = t.needs[1];
            const picker = this._picker({ placeholder: `Second product (${kind})`, kind, onPick: async (code) => {
                st.slots[1] = code;
                picker.note.textContent = 'Loading…';
                try { await this.ensure(code); picker.note.textContent = ''; } catch (err) { picker.retry(); picker.note.textContent = err.message; picker.note.classList.add('bad'); return; }
                if (this.tpl === st) this._renderTplForm();
            } });
            if (st.slots[1]) picker.set(st.slots[1]);
            box.appendChild(picker.root);
        }
        const ready = t.needs.every((_, i) => this._slot(i));
        if (!ready) { box.appendChild(el('p', 'pc-hint', `Choose the second product (${t.needs[1]}) to continue.`)); return; }
        for (let j = 0; j < t.expiries; j++) {
            const choices = this._expiryChoices(t, j);
            if (!choices.length) { box.appendChild(el('p', 'pc-note bad', 'No upcoming expiry is listed for these products.')); return; }
            if (!choices.includes(st.expiries[j])) st.expiries[j] = choices[Math.min(j, choices.length - 1)];
            row.appendChild(this._field(t.expiries > 1 ? (j ? 'Far expiry' : 'Near expiry') : 'Expiry', this._select(choices.map(c => [c, formatDateString(c)]), st.expiries[j], (v) => { st.expiries[j] = v; st.centre = null; this._renderTplForm(); }, 'Expiry')));
        }
        // Centre strike: the strike nearest to the forward implied by the listed settlement prices
        const optSpec = t.legs.find(s => s.kind !== 'future');
        if (optSpec) {
            const slot = this._slot(optSpec.slot);
            const ladder = strikesOf(slot.options, st.expiries[0], 'call');
            const rows = slot.options.filter(o => o.expiration === st.expiries[0] && o.kind !== 'future').map(o => ({ CallPut: o.kind === 'call' ? 'C' : 'P', Strike: o.strike, SettlementPrice: o.price }));
            const fwd = impliedForward(rows);
            const near = nearestStrike(ladder, fwd ?? ladder[Math.floor(ladder.length / 2)] ?? 0);
            if (ladder.length) {
                if (st.centre === null || !ladder.includes(st.centre)) st.centre = near.strike;
                row.appendChild(this._field('Centre strike', this._select(ladder.map(k => [k, `${levelText(k)}${k === near.strike ? ' (ATM)' : ''}`]), st.centre, (v) => { st.centre = Number(v); }, 'Centre strike')));
            }
            if (t.wings) row.appendChild(this._field('Width (strikes)', this._number(st.width, (v) => { st.width = Number.isFinite(v) && v >= 1 ? Math.round(v) : 1; }, { label: 'Wing width in strikes', step: 1, min: 1, width: 70 })));
        }
        box.appendChild(row);
        const actions = el('div', 'pc-actions');
        actions.appendChild(button('Replace legs', { className: 'pc-btn primary', iconName: 'check', onClick: () => this._applyTemplate(false) }));
        actions.appendChild(button('Add to existing legs', { className: 'pc-btn', iconName: 'plus', onClick: () => this._applyTemplate(true) }));
        box.appendChild(actions);
        this.tplMessages = el('div', 'sw-missing');
        box.appendChild(this.tplMessages);
        refreshIcons();
    }

    _applyTemplate(append) {
        const t = templateById(this.tpl?.id);
        const st = this.tpl;
        if (!t) return;
        const ctx = { slots: t.needs.map((_, i) => this._slot(i)), expiries: st.expiries, level: st.centre ?? 0, width: st.width };
        const { legs, missing } = buildLegs(t, ctx);
        this.tplMessages.innerHTML = '';
        missing.forEach(m => this.tplMessages.appendChild(el('p', 'pc-note bad', m)));
        if (!legs.length) return;
        this.legs = append ? [...this.legs, ...legs] : legs;
        this._legsChanged({ resetLevels: !append });
    }

    // ---------- Step 2: legs ----------

    _renderLegs() {
        const box = this.legsBox;
        box.innerHTML = '';
        if (!this.legs.length) { box.appendChild(el('p', 'pc-empty', 'No legs yet. Pick a template above or add a leg below.')); return; }
        const wrap = el('div', 'sw-table-wrap');
        const table = el('table', 'pc-table sw-table');
        const head = el('tr');
        ['', 'Qty', 'Contract', 'Entry price', 'Point value', ''].forEach(h => head.appendChild(el('th', '', h)));
        const thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        const body = el('tbody');
        this.legs.forEach(leg => {
            const tr = el('tr');
            Object.assign(tr.dataset, { leg: leg.id, product: leg.product, kind: leg.kind, strike: leg.kind === 'future' ? '' : String(leg.strike), expiry: leg.expiration });
            const cell = (c) => { const td = el('td'); if (c) td.appendChild(c); tr.appendChild(td); return td; };
            cell(this._select([[1, 'Buy'], [-1, 'Sell']], leg.side, (v) => { leg.side = Number(v); this._changed(); }, 'Buy or sell'));
            cell(this._number(leg.qty, (v, i) => { leg.qty = Number.isFinite(v) && v >= 1 ? Math.round(v) : 0; i.classList.toggle('invalid', !leg.qty); this._changed(); }, { label: 'Quantity', step: 1, min: 1, width: 56 }));
            const contract = cell();
            contract.appendChild(el('span', 'sw-contract', leg.label));
            contract.appendChild(el('span', 'pc-hint sw-detail', `${leg.label.includes(leg.product) ? '' : `${leg.product} · `}${KIND_LABEL[leg.kind]}${leg.kind === 'future' ? '' : ` ${levelText(Number(leg.strike))}`} · ${formatDateString(leg.expiration)}`));
            const price = this._number(leg.price, (v, i) => { leg.price = Number.isFinite(v) ? v : NaN; leg.priceFromSettlement = false; i.classList.toggle('invalid', !Number.isFinite(v)); this._futurePriceSet(leg); this._changed(); }, { label: `Entry price of ${leg.label}`, width: 88 });
            price.title = leg.priceFromSettlement ? 'Last settlement price. Overwrite with your own entry price.' : 'Entry price';
            cell(price);
            cell(this._number(leg.pointValue, (v, i) => { leg.pointValue = Number.isFinite(v) && v > 0 ? v : 0; leg.pointValueKnown = true; i.classList.toggle('invalid', !leg.pointValue); this._changed(); }, { label: `Point value of ${leg.product}`, width: 70 }));
            const del = button('', { className: 'pc-btn sw-del', title: 'Remove leg', iconName: 'x', onClick: () => { this.legs = this.legs.filter(l => l !== leg); this._legsChanged(); } });
            del.setAttribute('aria-label', `Remove ${leg.label}`);
            cell(del);
            body.appendChild(tr);
        });
        table.appendChild(body);
        wrap.appendChild(table);
        box.appendChild(wrap);
        refreshIcons();
    }

    _renderBuilder() {
        const box = this.builder;
        box.innerHTML = '';
        box.appendChild(el('h4', 'sw-sub', 'Add a leg'));
        const st = this.builderState = { product: '', kind: 'call', expiry: '', strike: null, side: 1, qty: 1, ...(this.builderState || {}) };
        const row = el('div', 'ps-bar');
        this.builderPicker = this._picker({ placeholder: 'Product of this leg', onPick: async (code) => {
            st.product = code;
            this.builderPicker.note.textContent = 'Loading…';
            try {
                const d = await this.ensure(code);
                if (st.product !== code) return;
                this.builderPicker.note.textContent = '';
                if (d.kind === 'future') st.kind = 'future';
                else if (st.kind === 'future') st.kind = 'call';
                st.expiry = ''; st.strike = null;
                this._renderBuilderControls();
            } catch (err) { this.builderPicker.retry(); this.builderPicker.note.textContent = err.message; this.builderPicker.note.classList.add('bad'); }
        } });
        if (st.product) this.builderPicker.set(st.product);
        row.appendChild(this.builderPicker.root);
        box.appendChild(row);
        this.builderControls = el('div', 'ps-bar');
        box.appendChild(this.builderControls);
        this._renderBuilderControls();
    }

    _renderBuilderControls() {
        const box = this.builderControls;
        box.innerHTML = '';
        const st = this.builderState;
        const d = st.product ? this.loaded.get(st.product) : null;
        if (!d) { box.appendChild(el('span', 'pc-hint', 'Choose a product to add a leg (a different product than above gives an inter-product combination).')); return; }
        const kinds = d.kind === 'future' ? [['future', 'Future']] : [['call', 'Call'], ['put', 'Put']];
        if (!kinds.some(([k]) => k === st.kind)) st.kind = kinds[0][0];
        box.appendChild(this._field('Type', this._select(kinds, st.kind, (v) => { st.kind = v; st.expiry = ''; st.strike = null; this._renderBuilderControls(); }, 'Contract type')));
        const expiries = this._upcoming(d, st.kind === 'future' ? 'future' : 'option');
        if (!expiries.length) { box.appendChild(el('span', 'pc-note bad', 'No upcoming expiry is listed.')); return; }
        if (!expiries.includes(st.expiry)) st.expiry = expiries[0];
        box.appendChild(this._field('Expiry', this._select(expiries.map(e => [e, formatDateString(e)]), st.expiry, (v) => { st.expiry = v; st.strike = null; this._renderBuilderControls(); }, 'Expiry')));
        if (st.kind !== 'future') {
            const ks = strikesOf(d.options, st.expiry, st.kind);
            const rows = d.options.filter(o => o.expiration === st.expiry && o.kind !== 'future').map(o => ({ CallPut: o.kind === 'call' ? 'C' : 'P', Strike: o.strike, SettlementPrice: o.price }));
            const near = nearestStrike(ks, impliedForward(rows) ?? ks[Math.floor(ks.length / 2)] ?? 0);
            if (!ks.length) { box.appendChild(el('span', 'pc-note bad', 'No strikes are listed for this expiry.')); return; }
            if (!ks.includes(st.strike)) st.strike = near.strike;
            box.appendChild(this._field('Strike', this._select(ks.map(k => [k, `${levelText(k)}${k === near.strike ? ' (ATM)' : ''}`]), st.strike, (v) => { st.strike = Number(v); }, 'Strike')));
        }
        box.appendChild(this._field('Side', this._select([[1, 'Buy'], [-1, 'Sell']], st.side, (v) => { st.side = Number(v); }, 'Buy or sell')));
        box.appendChild(this._field('Qty', this._number(st.qty, (v) => { st.qty = Number.isFinite(v) && v >= 1 ? Math.round(v) : 1; }, { label: 'Quantity', step: 1, min: 1, width: 60 })));
        box.appendChild(button('Add leg', { className: 'pc-btn primary', iconName: 'plus', onClick: () => this._addLeg() }));
        refreshIcons();
    }

    _addLeg() {
        const st = this.builderState;
        const d = this.loaded.get(st.product);
        if (!d) return;
        const contract = findContract(d.options, st.kind, st.expiry, st.kind === 'future' ? null : st.strike);
        if (!contract) { this._alert('That contract is not listed.'); return; }
        this._alert('');
        this.legs.push(legFromContract({ product: d.code, options: d.options, info: d.info, group: d.code }, contract, st.side, st.qty));
        this._legsChanged();
    }

    // TES notes per product: strategy entry and minimum lots at the leg expiries
    _renderTes() {
        const box = this.tesBox;
        box.innerHTML = '';
        const products = [...new Set(this.legs.map(l => l.product))];
        const lines = [];
        products.forEach(code => {
            const d = this.loaded.get(code);
            if (!d) return;
            const tes = tesSupport(d.tes);
            if (!tes.known) { lines.push(`${code}: no TES profiles available.`); return; }
            const expiries = [...new Set(this.legs.filter(l => l.product === code).map(l => l.expiration))].sort();
            const idx = (date) => Number((d.expirations.find(e => String(e.ExpirationDate).slice(0, 10) === date) || {}).ExpirationIndex) || 1;
            const parts = expiries.map(date => {
                const mins = tesMinimums(d.tes, idx(date)).filter(m => m.minLotSize !== null).map(m => `${m.tesType} ${m.instrumentType}: min ${m.minLotSize}`);
                return mins.length ? `${formatDateString(date)} (${mins.join('; ')})` : '';
            }).filter(Boolean);
            lines.push(`${code}: ${tes.strategy ? 'strategy entry is supported in TES' : 'TES for simple instruments only, so legs go in individually'}${parts.length ? `. Minimum lots ${parts.join(' | ')}` : ''}.`);
        });
        if (!lines.length) return;
        box.appendChild(el('h4', 'sw-sub', 'TES'));
        lines.forEach(t => box.appendChild(el('p', 'pc-hint', t)));
    }

    // ---------- Step 3: scenario and model ----------

    // Reference level of a product: its futures' entry price, else the forward implied by the listed settlement prices
    _autoLevel(group) {
        const legs = this.legs.filter(l => (l.group || l.product) === group);
        const forwards = {};
        legs.forEach(l => {
            const d = this.loaded.get(l.product);
            if (!d || !isOption(l)) return;
            const rows = d.options.filter(o => o.expiration === l.expiration && o.kind !== 'future').map(o => ({ CallPut: o.kind === 'call' ? 'C' : 'P', Strike: o.strike, SettlementPrice: o.price }));
            forwards[l.id] = impliedForward(rows);
        });
        return defaultLevel(legs, forwards);
    }

    _syncGroups({ reset = false } = {}) {
        const names = groupsOf(this.legs);
        names.forEach((name, i) => {
            const c = this.cfg[name] = this.cfg[name] || { s0: 0, auto: true, beta: 1, rel: 0 };
            if (reset) c.auto = true;
            if (c.auto && !this.drag) c.s0 = this._autoLevel(name);
            if (i === 0) { c.beta = 1; c.rel = 0; }
        });
        Object.keys(this.cfg).forEach(k => { if (!names.includes(k)) delete this.cfg[k]; });
        return names;
    }

    _renderScenario() {
        const box = this.scenario;
        box.innerHTML = '';
        if (!this.legs.length) { box.appendChild(el('p', 'pc-hint', 'Add legs to set the scenario.')); return; }
        const names = this._syncGroups();
        const table = el('table', 'pc-table sw-table');
        const head = el('tr');
        ['Underlying', 'Reference level', names.length > 1 ? 'Beta to first' : '', names.length > 1 ? 'Relative move %' : ''].forEach(h => head.appendChild(el('th', '', h)));
        const thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        const body = el('tbody');
        names.forEach((name, i) => {
            const c = this.cfg[name];
            const tr = el('tr');
            tr.appendChild(el('td', '', `${name}${i === 0 ? ' (x axis)' : ''}`));
            const lvl = el('td');
            const li = this._number(c.s0, (v) => { if (Number.isFinite(v) && v > 0) { c.s0 = v; c.auto = false; this._changed({ scenario: true }); } }, { label: `Reference level of ${name}`, width: 110 });
            li.title = 'Estimated from futures prices or put-call parity of the settlement prices. Overwrite with the live level.';
            lvl.appendChild(li);
            tr.appendChild(lvl);
            const b = el('td');
            const r = el('td');
            if (names.length > 1) {
                if (i === 0) { b.textContent = '1'; r.textContent = '0'; } else {
                    b.appendChild(this._number(c.beta, (v) => { c.beta = Number.isFinite(v) ? v : 0; this._changed({ scenario: true }); }, { label: `Beta of ${name}`, width: 70 }));
                    r.appendChild(this._number(c.rel * 100, (v) => { c.rel = Number.isFinite(v) ? v / 100 : 0; this._changed({ scenario: true }); }, { label: `Relative move of ${name} in percent`, width: 70 }));
                }
            }
            tr.append(b, r);
            body.appendChild(tr);
        });
        table.appendChild(body);
        box.appendChild(table);
        if (names.length > 1) box.appendChild(el('p', 'pc-hint', `The x axis is the move of ${names[0]}. The other underlyings move ${names.slice(1).join(', ')} = beta × that move, plus the relative move. Beta 1 and 0 % means they move together.`));

        const row = el('div', 'ps-bar');
        row.appendChild(this._field('Volatility %', this._number(this.settings.vol, (v) => { this.settings.vol = Number.isFinite(v) && v > 0 ? v : 0; this._changed({ scenario: true }); }, { label: 'Volatility in percent', step: 1, min: 0, width: 80 })));
        row.appendChild(this._field('Range ± %', this._number(num(this.settings.range), (v) => { this.settings.range = Number.isFinite(v) && v > 0 ? v : ''; this._changed({ scenario: true }); }, { label: 'Range in percent, empty for automatic', step: 1, min: 0, width: 80 })));
        const today = el('label', 'sw-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = this.settings.today;
        cb.addEventListener('change', () => { this.settings.today = cb.checked; this._changed({ scenario: true }); });
        today.append(cb, ' Also show the value today (model)');
        row.appendChild(today);
        // Different currencies: the first leg's currency is the reference, the others need a rate
        const refCur = this.legs[0].currency;
        [...new Set(this.legs.map(l => l.currency).filter(c => c && c !== refCur))].forEach(c => {
            row.appendChild(this._field(`${c} → ${refCur}`, this._number(this.settings.fx[c] ?? 1, (v) => { this.settings.fx[c] = Number.isFinite(v) && v > 0 ? v : 1; this._changed({ scenario: true }); }, { label: `Exchange rate ${c} to ${refCur}`, width: 80 })));
        });
        box.appendChild(row);
        box.appendChild(el('p', 'pc-hint', 'Options that expire after the first expiry, and the "today" curve, are valued with Black-76 at the volatility above (flat, no interest rate). Futures follow the underlying one to one, without carry.'));
    }

    // ---------- Changes ----------

    // Structural change (legs added or removed): everything is redrawn
    _legsChanged({ resetLevels = false } = {}) {
        this._syncGroups({ reset: resetLevels });
        this._renderLegs();
        this._renderTes();
        this._renderScenario();
        this._renderResult();
        this._persist();
        // Products that came from a stored strategy still need their data for TES notes and levels
        [...new Set(this.legs.map(l => l.product))].filter(c => !this.loaded.has(c)).forEach(c => this.ensure(c).then(() => { this._syncGroups(); this._renderTes(); this._renderScenario(); this._renderResult(); }).catch(() => {}));
    }

    // Value change inside an input: only the result is redrawn, so typing keeps its focus
    _changed({ levels = false } = {}) {
        if (levels) { this._syncGroups(); this._renderScenario(); }
        this._renderResult();
        this._persist();
    }

    _persist() { save({ main: this.main, legs: this.legs, cfg: this.cfg, settings: this.settings }); }

    _restore() {
        const s = load();
        if (!s || !Array.isArray(s.legs)) return;
        this.legs = s.legs.filter(l => l && ['future', 'call', 'put'].includes(l.kind) && l.product && /^\d{4}-\d{2}-\d{2}$/.test(String(l.expiration)));
        this.cfg = s.cfg && typeof s.cfg === 'object' ? s.cfg : {};
        this.settings = { ...this.settings, ...(s.settings || {}), fx: { ...(s.settings?.fx || {}) } };
        if (s.main && this.catalog.some(p => p.Product === s.main)) { this.mainPicker.set(s.main); this._pickMain(s.main); }
        if (this.legs.length) this._legsChanged();
    }

    // ---------- Step 4: payoff ----------

    _model() {
        const legs = this.legs.filter(l => l.qty > 0 && Number.isFinite(Number(l.price)) && l.pointValue > 0);
        const names = groupsOf(legs);
        const groups = {};
        names.forEach(n => { groups[n] = this.cfg[n] || { s0: 0, beta: 1, rel: 0 }; });
        const bad = names.filter(n => !(groups[n].s0 > 0));
        return { legs, names, groups, bad };
    }

    _renderResult() {
        const box = this.out;
        box.innerHTML = '';
        if (!this.legs.length) { box.appendChild(el('p', 'pc-empty', 'The payoff appears here as soon as there is a leg.')); return; }
        const { legs, names, groups, bad } = this._model();
        if (legs.length < this.legs.length) box.appendChild(el('p', 'pc-note bad', 'Some legs are left out of the payoff: quantity, entry price and point value must be valid numbers.'));
        if (!legs.length) return;
        if (bad.length) { box.appendChild(el('p', 'pc-note bad', `No reference level for ${bad.join(', ')}. Enter one in step 3.`)); return; }

        const fx = Object.fromEntries(Object.entries(this.settings.fx));
        const vol = (this.settings.vol || 0) / 100;
        const evalDate = firstExpiry(legs);
        // While a leg is dragged the axis stays put, otherwise it would rescale under the pointer
        // The sketch (the wish) and the payoff share their level axis when there is a drawing, so they can be compared
        const wish = this.sketch?.getGhost();
        const wishRange = wish && wish.code === names[0] && groups[names[0]].s0 > 0 ? { min: wish.axis.min / groups[names[0]].s0 - 1, max: wish.axis.max / groups[names[0]].s0 - 1 } : null;
        const range = this.freeze || (num(this.settings.range) > 0 ? moveRange(legs, groups, num(this.settings.range) / 100) : wishRange) || moveRange(legs, groups, null);
        const expiry = curve(legs, groups, range, { date: evalDate, vol, fx });
        // Exact when every option is at its expiry on the evaluation date; otherwise part of the curve is the model
        const stats = analyze(expiry, { exact: legs.every(l => l.kind === 'future' || l.expiration === evalDate) });
        const series = [{ name: `At ${formatDateString(evalDate)}`, points: expiry }];
        const today = cetDate();
        if (this.settings.today && today < evalDate) {
            // Same x grid as the expiry curve, so the crosshair reads both series at one index
            series.push({ name: 'Today (model)', dashed: true, points: expiry.map(p => ({ ...p, y: strategyPnl(legs, groups, p.x, { date: today, vol, fx }) })) });
        }
        const cur = legs[0].currency || '';
        const premium = netPremium(legs, fx);
        const leader = names[0];

        const tiles = el('div', 'pc-stats');
        const tile = (k, v, cls = '') => { const s = el('div', `pc-stat ${cls}`.trim()); s.appendChild(el('span', 'pc-hint', k)); s.appendChild(el('strong', '', v)); tiles.appendChild(s); };
        tile(premium >= 0 ? 'Net debit' : 'Net credit', money(Math.abs(premium), cur));
        tile('Max profit', stats.unlimitedProfit ? 'Unlimited' : money(stats.maxProfit, cur), 'gain');
        tile('Max loss', stats.unlimitedLoss ? 'Unlimited' : money(stats.maxLoss, cur), 'loss');
        tile('Breakeven', stats.breakevens.length ? stats.breakevens.map(b => `${levelText(b.s)} (${b.x >= 0 ? '+' : ''}${(b.x * 100).toFixed(1)}%)`).join(', ') : 'none in range');
        tile('Valued at', formatDateString(evalDate));
        box.appendChild(tiles);

        const ghost = this._ghost(leader, expiry);
        const markers = legs.map(l => {
            const value = l.kind === 'future' ? l.price : l.strike;
            return {
                id: l.id, side: l.side, s: legLevel(l, groups, leader), draggable: this._draggable(l, groups, leader), active: this.drag?.id === l.id,
                // the contract name as the API gives it; a future also shows its entry price, which is what the pill moves
                text: `${l.side > 0 ? '+' : '-'}${l.qty} ${l.label}${l.kind === 'future' ? ` @${levelText(Number(value))}` : ''}`
            };
        });
        const chart = renderPayoffChart(series, {
            legs: markers,
            ghost,
            onLegDown: (id, e) => this._startDrag(id, e),
            onLegStep: (id, dir) => this._stepLeg(id, dir),
            breakevens: stats.breakevens,
            currentLevel: groups[leader].s0,
            currency: cur,
            xLabel: `${leader} level at the evaluation date`,
            label: `Payoff of the strategy at ${evalDate}: max profit ${stats.unlimitedProfit ? 'unlimited' : money(stats.maxProfit, cur)}, max loss ${stats.unlimitedLoss ? 'unlimited' : money(stats.maxLoss, cur)}`
        });
        box.appendChild(chart);
        if (ghost) {
            const legend = el('p', 'pc-hint sw-legend');
            legend.append(el('span', 'sw-key wish'), 'Your wish (drawing, moved to the height of the payoff)  ', el('span', 'sw-key real'), 'Payoff of your legs');
            box.appendChild(legend);
        }
        if (this.focusLeg) { chart.querySelector(`[data-leg="${this.focusLeg}"]`)?.focus(); this.focusLeg = null; }
        box.appendChild(el('p', 'pc-hint', stats.unlimitedProfit || stats.unlimitedLoss
            ? 'Max profit / loss are over the shown range; "Unlimited" means the curve is still moving at its upper end. Drag a leg under the chart sideways to move its strike (a future: its entry price); the legs above follow. Hover the chart or focus it and use the arrow keys for values.'
            : 'Max profit / loss are over the shown range. Drag a leg under the chart sideways to move its strike (a future: its entry price); the legs above follow. Hover the chart or focus it and use the arrow keys for values.'));

        // Notes about what the numbers rest on
        const notes = [];
        legs.filter(l => l.expiration < today).forEach(l => notes.push(`${l.label} has already expired.`));
        this.legs.filter(l => !l.priceFromSettlement && !(l.price > 0) && isOption(l)).forEach(l => notes.push(`${l.label} has an entry price of 0. Enter the price you trade at.`));
        [...new Set(legs.filter(l => !l.pointValueKnown).map(l => l.product))].forEach(p => notes.push(`The point value of ${p} is not in the master data; ${legs.find(l => l.product === p).pointValue} is used. Check the column in step 2.`));
        if (legs.some(l => l.expiration !== evalDate && l.kind !== 'future')) notes.push('Legs expiring later than the first expiry are valued with the volatility model, so their part of the curve is theoretical.');
        if (names.length > 1) notes.push(`Several underlyings: the x axis is ${leader}; ${names.slice(1).map(n => `${n} follows with beta ${groups[n].beta} and ${(groups[n].rel * 100).toFixed(1)} % relative move`).join(', ')}.`);
        if (new Set(legs.map(l => l.currency).filter(Boolean)).size > 1) notes.push(`Legs in several currencies are converted into ${cur} with the rates in step 3 (default 1).`);
        notes.forEach(t => box.appendChild(el('p', 'pc-note', t)));

        // Values as table and CSV
        const rows = this._sample(series, 21);
        const det = el('details', 'sw-details');
        det.appendChild(el('summary', '', 'Values as a table'));
        const table = el('table', 'pc-table pc-num');
        const hr = el('tr');
        ['Level', 'Move', ...series.map(s => `P&L ${s.name}`)].forEach(h => hr.appendChild(el('th', '', h)));
        const th = el('thead');
        th.appendChild(hr);
        table.appendChild(th);
        const tb = el('tbody');
        rows.forEach(r => {
            const tr = el('tr');
            [levelText(r.s), `${r.x >= 0 ? '+' : ''}${(r.x * 100).toFixed(1)} %`, ...r.ys.map(y => money(y))].forEach(v => tr.appendChild(el('td', '', v)));
            tb.appendChild(tr);
        });
        table.appendChild(tb);
        det.appendChild(table);
        box.appendChild(det);
        const actions = el('div', 'pc-actions');
        actions.appendChild(button('Download CSV', { className: 'pc-btn', iconName: 'download', onClick: () => this._csv(series, groups, leader, cur) }));
        box.appendChild(actions);
        refreshIcons();
    }

    // ---------- Dragging legs ----------

    // A leg can be moved when it has a place on the axis and, for an option, its listed strikes are loaded
    _draggable(leg, groups, leader) {
        if (legLevel(leg, groups, leader) === null) return false;
        return leg.kind === 'future' || Boolean(this.loaded.get(leg.product));
    }

    _ladder(leg) {
        const d = this.loaded.get(leg.product);
        return d ? strikesOf(d.options, leg.expiration, leg.kind) : [];
    }

    // A future's entry price is the user's own: from now on the reference level keeps its value
    _futurePriceSet(leg) {
        const c = this.cfg[leg.group || leg.product];
        if (c) c.auto = false;
    }

    /** Moves an option to another listed strike, or a future to another entry price, and brings the leg data along. */
    _setLegValue(leg, value) {
        if (leg.kind === 'future') {
            const d = this.loaded.get(leg.product);
            const step = Number(d?.info?.TickSize) || 0;
            const next = snapToStep(value, step);
            if (!(next > 0) || next === leg.price) return false;
            this._futurePriceSet(leg);
            leg.price = next;
            leg.priceFromSettlement = false;
            return true;
        }
        const d = this.loaded.get(leg.product);
        const contract = d ? findContract(d.options, leg.kind, leg.expiration, value) : null;
        if (!contract || contract.strike === leg.strike) return false;
        leg.strike = contract.strike;
        leg.label = contract.label || `${leg.product} ${leg.expiration} ${contract.strike}`;
        // The price follows the settlement price of the new contract, unless it is the user's own entry price
        if (leg.priceFromSettlement || !(leg.price > 0)) { leg.price = contract.price ?? 0; leg.priceFromSettlement = contract.price !== null; }
        return true;
    }

    _redrawAfterMove() {
        this._renderLegs();
        this._renderResult();
        this._persist();
    }

    _startDrag(id, e) {
        const leg = this.legs.find(l => l.id === id);
        const { legs, groups, names } = this._model();
        if (!leg || !this._draggable(leg, groups, names[0])) return;
        e.preventDefault();
        this.freeze = moveRange(legs, groups, num(this.settings.range) / 100 || null);
        this.drag = { id };
        document.body.classList.add('pf-dragging');
        const move = (ev) => {
            const svg = this.out.querySelector('svg.pf');
            const m = this._model();
            if (!svg?.levelAt || !m.names.length) return;
            const target = valueAtLevel(leg, m.groups, m.names[0], svg.levelAt(ev.clientX));
            if (target === null) return;
            const value = leg.kind === 'future' ? target : (nearestStrike(this._ladder(leg), target)?.strike ?? null);
            if (value !== null && this._setLegValue(leg, value)) this._redrawAfterMove();
        };
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            document.body.classList.remove('pf-dragging');
            this.drag = null;
            this.freeze = null;
            this._renderScenario();
            this._renderResult();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        this._renderResult(); // marks the pill as active
    }

    // Keyboard: one listed strike per press (a future: one tick, or a thousandth of the level without a tick size)
    _stepLeg(id, dir) {
        const leg = this.legs.find(l => l.id === id);
        if (!leg) return;
        let value;
        if (leg.kind === 'future') {
            const d = this.loaded.get(leg.product);
            const step = Number(d?.info?.TickSize) || Math.max(Number(leg.price) / 1000, 0.01);
            value = Number(leg.price) + dir * step;
        } else {
            value = stepStrike(this._ladder(leg), leg.strike, dir);
            if (value === null) return;
        }
        this.focusLeg = id;
        if (this._setLegValue(leg, value)) { this._redrawAfterMove(); this._renderScenario(); } else this.focusLeg = null;
    }

    // The drawing from the sketch, in the levels of the payoff chart and moved to the height where it lies closest to the
    // payoff (only its shape was asked for). Null when there is no drawing or it is for another underlying than the x axis.
    _ghost(leader, points) {
        const g = this.sketch?.getGhost();
        if (!g || g.code !== leader) return null;
        const lo = Math.min(...g.points.map(p => p.s));
        const hi = Math.max(...g.points.map(p => p.s));
        const grid = resample(g.points, lo, hi, 160);
        if (!grid) return null;
        const at = (s) => {
            if (s < grid.xs[0] || s > grid.xs[grid.xs.length - 1]) return null;
            let j = 0;
            while (j < grid.xs.length - 2 && grid.xs[j + 1] < s) j++;
            const t = (s - grid.xs[j]) / ((grid.xs[j + 1] - grid.xs[j]) || 1);
            return grid.ys[j] + (grid.ys[j + 1] - grid.ys[j]) * t;
        };
        const diffs = points.map(p => { const y = at(p.s); return y === null ? null : p.y - y; }).filter(d => d !== null);
        if (diffs.length < 2) return null;
        const offset = diffs.reduce((s, d) => s + d, 0) / diffs.length;
        return { points: grid.xs.map((s, i) => ({ s, y: grid.ys[i] + offset })) };
    }

    _sample(series, count) {
        const main = series[0].points;
        const out = [];
        for (let i = 0; i < count; i++) {
            const at = Math.round((i * (main.length - 1)) / (count - 1));
            out.push({ s: main[at].s, x: main[at].x, ys: series.map(s => s.points[at].y) });
        }
        return out;
    }

    _csv(series, groups, leader, cur) {
        const head = [`${leader}_level`, 'move_pct', ...series.map(s => `pnl_${cur}_${s.name.replace(/\W+/g, '_')}`)];
        const lines = [head.join(',')];
        series[0].points.forEach((p, i) => lines.push([p.s.toFixed(4), (p.x * 100).toFixed(3), ...series.map(s => s.points[i].y.toFixed(2))].join(',')));
        downloadText(lines.join('\n'), 'strategy-payoff.csv', 'text/csv');
    }
}
