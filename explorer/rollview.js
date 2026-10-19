// Roll tracker: for index and fixed income futures, how far open interest has moved from the front contract to the
// next one (pace of roll), from OpenInterest on Contracts.
import { el, button, refreshIcons } from './dom.js';
import { fetchProductCatalog } from './catalog.js';
import { buildSchemaIndex, membersOf, baseName } from './schemacheck.js';
import { isRollProduct, rejectReason, rollSnapshot, rollStatus, recordSnapshot, cycleEntries, pace, daysToComplete } from './roll.js';
import { renderLineChart } from './linechart.js';
import { cetDate } from './tradingstatus.js';
import { formatNumber, formatDateString } from './displayformat.js';

const WANTED = ['Contract', 'ContractDate', 'ExpirationDate', 'LastTradingDate', 'CallPut', 'ContractCycle', 'OpenInterest'];
const LAST_KEY = 'eurexExplorer.rollProduct';
const DEFAULTS = ['FESX', 'FGBL'];
const pct = (v) => `${(v * 100).toFixed(1)}%`;

const remember = (code) => { try { localStorage.setItem(LAST_KEY, code); } catch (e) { /* storage unavailable */ } };
const recall = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } };

export class RollView {
    /** els: { content }; options: { getSchema, onOpenProduct(code) } */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
        this.built = false;
        this.catalog = null;
        this.all = null;
        this.product = '';
        this.token = 0;
    }

    async show() {
        if (!this.built) this._build();
        if (this.catalog) return;
        this.status.textContent = 'Loading products…';
        try {
            const all = await fetchProductCatalog(this.client);
            this.all = all;
            this.catalog = all.filter(isRollProduct).sort((a, b) => a.Product.localeCompare(b.Product));
            this._fillSymbols();
            this.status.textContent = '';
            if (!this.catalog.length) { this._fillTypes(); this._fillProducts(); this._message('No futures (product line Future) were found in the product list.'); return; }
            const wanted = [recall(), ...DEFAULTS].find(c => c && this.catalog.some(p => p.Product === c)) || this.catalog[0].Product;
            this._fillTypes(this.catalog.find(p => p.Product === wanted).ProductType || 'Other');
            this._fillProducts(wanted);
            this.load(wanted);
        } catch (err) {
            this.status.textContent = '';
            this._message(`The product list could not be loaded: ${err.message}`, true);
        }
    }

    _build() {
        this.built = true;
        const box = this.els.content;
        box.innerHTML = '';
        const bar = el('div', 'ps-bar');
        const typeLabel = el('label', 'pc-field');
        typeLabel.appendChild(el('span', 'pc-hint', 'Product type'));
        this.typeSelect = el('select', 'pc-select');
        this.typeSelect.setAttribute('aria-label', 'Product type');
        this.typeSelect.addEventListener('change', () => {
            this._fillProducts();
            if (this.select.value) this.load(this.select.value);
        });
        typeLabel.appendChild(this.typeSelect);
        bar.appendChild(typeLabel);
        const label = el('label', 'pc-field');
        label.appendChild(el('span', 'pc-hint', 'Future'));
        this.select = el('select', 'pc-select');
        this.select.setAttribute('aria-label', 'Index or fixed income future');
        this.select.addEventListener('change', () => this.load(this.select.value));
        label.appendChild(this.select);
        bar.appendChild(label);
        const form = el('form', 'pc-field rt-symbol');
        form.setAttribute('autocomplete', 'off');
        form.appendChild(el('span', 'pc-hint', 'Symbol'));
        this.symbol = el('input');
        this.symbol.type = 'text';
        this.symbol.maxLength = 32;
        this.symbol.placeholder = 'Future, e.g. FESX';
        this.symbol.setAttribute('aria-label', 'Future symbol');
        this.symbol.setAttribute('list', 'rollSymbolList');
        this.symbol.style.textTransform = 'uppercase';
        this.symbols = el('datalist');
        this.symbols.id = 'rollSymbolList';
        form.append(this.symbol, this.symbols);
        form.addEventListener('submit', (e) => { e.preventDefault(); this._pickSymbol(); });
        this.symbol.addEventListener('change', () => this._pickSymbol());
        bar.appendChild(form);
        this.refreshBtn = button('Refresh', { className: 'pc-btn', iconName: 'refresh-cw', onClick: () => this.product && this.load(this.product, { fresh: true }) });
        this.cardBtn = button('Product card', { className: 'pc-btn', iconName: 'layers', onClick: () => this.product && this.options.onOpenProduct?.(this.product) });
        bar.append(this.refreshBtn, this.cardBtn);
        box.appendChild(bar);
        this.alert = el('p', 'pc-note bad');
        this.alert.setAttribute('role', 'alert');
        this.alert.hidden = true;
        box.appendChild(this.alert);
        this.status = el('p', 'pc-hint ps-status');
        this.status.setAttribute('role', 'status');
        box.appendChild(this.status);
        this.out = el('div', 'rt');
        box.appendChild(this.out);
        refreshIcons();
    }

    _fillTypes(current) {
        this.typeSelect.innerHTML = '';
        [...new Set((this.catalog || []).map(p => p.ProductType || 'Other'))].sort().forEach(t => {
            const o = el('option', '', t);
            o.value = t;
            this.typeSelect.appendChild(o);
        });
        if (current) this.typeSelect.value = current;
    }

    _fillSymbols() {
        this.symbols.innerHTML = '';
        (this.catalog || []).forEach(p => {
            const o = el('option', '', p.Name || '');
            o.value = p.Product;
            this.symbols.appendChild(o);
        });
    }

    // The futures of the chosen product type
    _fillProducts(current) {
        this.select.innerHTML = '';
        const type = this.typeSelect.value;
        (this.catalog || []).filter(p => (p.ProductType || 'Other') === type).forEach(p => {
            const o = el('option', '', `${p.Product}${p.Name ? ` · ${p.Name}` : ''}`);
            o.value = p.Product;
            this.select.appendChild(o);
        });
        if (current) this.select.value = current;
        else if (this.select.options.length) this.select.selectedIndex = 0;
    }

    // Typed symbol: only futures are accepted; anything else is rejected and the current view stays
    _pickSymbol() {
        const code = this.symbol.value.trim().toUpperCase();
        this.symbol.value = code;
        const reason = rejectReason(code, this.all);
        this.alert.hidden = !reason;
        this.alert.textContent = reason;
        this.symbol.classList.toggle('invalid', Boolean(reason));
        if (reason || !code) return;
        this._fillTypes(this.catalog.find(p => p.Product === code).ProductType || 'Other');
        this._fillProducts(code);
        this.load(code);
    }

    _message(text, bad = false) {
        this.out.innerHTML = '';
        this.out.appendChild(el('p', `pc-empty${bad ? ' bad' : ''}`, text));
    }

    // Contracts query with the fields the schema offers; null OpenInterest means the API does not have it
    async _query(code) {
        let fields = WANTED;
        try {
            const index = buildSchemaIndex(await this.options.getSchema?.());
            const root = index && membersOf(index, index.queryTypeName).find(f => f.name === 'Contracts');
            if (index && !root) return { error: 'This API does not offer Contracts.' };
            if (root) {
                const outer = index.types.get(baseName(root.type));
                const rowType = baseName(outer?.fields?.find(f => f.name === 'data')?.type) || outer?.name;
                const available = membersOf(index, rowType).map(f => f.name);
                if (!available.includes('OpenInterest')) return { error: 'Contracts has no OpenInterest field in this API yet, so the roll cannot be tracked.' };
                fields = WANTED.filter(f => available.includes(f));
            }
        } catch (e) { /* no schema: ask for the standard fields */ }
        return { query: `query {\n  Contracts(filter: { Product: { eq: "${code}" } }) {\n    date\n    data {\n      ${fields.join('\n      ')}\n    }\n  }\n}` };
    }

    async load(code, { fresh = false } = {}) {
        const reason = rejectReason(code, this.all);
        if (reason) { this.alert.hidden = false; this.alert.textContent = reason; return; }
        this.alert.hidden = true;
        this.product = code;
        remember(code);
        const token = ++this.token;
        this.out.innerHTML = '';
        this.out.appendChild(el('p', 'pc-loading', `Loading ${code}…`));
        try {
            const { query, error } = await this._query(code);
            if (token !== this.token) return;
            if (error) { this._message(error, true); return; }
            const res = await this.client.request(query, null, false, { fresh });
            if (token !== this.token) return;
            const rows = res?.Contracts?.data || [];
            const date = String(res?.Contracts?.date || '').slice(0, 10) || cetDate();
            this._draw(code, rows, date);
        } catch (err) {
            if (token !== this.token) return;
            this._message(err.message, true);
            this.out.appendChild(button('Try again', { className: 'pc-btn', onClick: () => this.load(code) }));
        }
    }

    _draw(code, rows, date) {
        const snap = rollSnapshot(rows, cetDate());
        this.out.innerHTML = '';
        if (!snap) { this._message(`No open interest is listed for the futures of ${code}.`); return; }
        const history = snap.next ? recordSnapshot(code, snap, date) : [];
        const cycle = snap.next ? cycleEntries(history, snap.front.label) : [];
        const perDay = pace(cycle);
        const status = rollStatus(snap.share);

        const head = el('div', `rt-status ${status.key}`);
        head.appendChild(el('span', 'rt-dot'));
        head.appendChild(el('strong', '', status.label));
        head.appendChild(el('span', 'pc-hint', `open interest as of ${formatDateString(date)}`));
        this.out.appendChild(head);

        const tiles = el('div', 'pc-stats');
        const tile = (k, v) => { const s = el('div', 'pc-stat'); s.appendChild(el('span', 'pc-hint', k)); s.appendChild(el('strong', '', v)); tiles.appendChild(s); };
        tile('Front future', `${snap.front.label} · ${formatDateString(snap.front.expiration)}`);
        tile('Days to expiry', String(snap.front.daysLeft));
        if (snap.next) {
            tile('Rolled to next', snap.share === null ? '–' : pct(snap.share));
            tile('Next future', snap.next.label);
            tile('Pace', perDay === null ? 'needs 2 days' : `${perDay >= 0 ? '+' : ''}${perDay.toFixed(1)} pp/day`);
            const done = daysToComplete(snap.share, perDay);
            if (done !== null) tile('Full roll in', done === 0 ? 'done' : `~${done} days${done > snap.front.daysLeft ? ' (after expiry)' : ''}`);
        }
        this.out.appendChild(tiles);

        if (snap.excluded) this.out.appendChild(el('p', 'pc-hint', `Primary contracts only: ${snap.excluded} daily, weekly or flexible contract${snap.excluded === 1 ? '' : 's'} left out.`));
        this.out.appendChild(this._bar(snap));
        this.out.appendChild(this._table(snap));

        if (snap.next) {
            const sec = el('section', 'pc-card rt-history');
            const h = el('div', 'pc-card-head');
            h.appendChild(el('h3', '', 'Roll progress'));
            h.appendChild(el('span', 'pc-hint', `${snap.front.label} → ${snap.next.label}`));
            sec.appendChild(h);
            sec.appendChild(renderLineChart(cycle.map(e => ({ x: e.date, y: e.share * 100 })), { format: (y) => `${y.toFixed(0)}%`, label: `Roll progress of ${code}` }));
            sec.appendChild(el('p', 'pc-hint', 'The API returns the open interest of the latest day. The chart is built from the days this view was opened in this browser, so it fills up with use.'));
            this.out.appendChild(sec);
        }
        refreshIcons();
    }

    // Stacked bar: share of open interest per upcoming future
    _bar(snap) {
        const wrap = el('div', 'rt-bar');
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', snap.contracts.map(c => `${c.label} ${pct(c.share)}`).join(', '));
        snap.contracts.forEach((c, i) => {
            if (c.share <= 0) return;
            const seg = el('span', `rt-seg s${Math.min(i, 3)}`, c.share >= 0.08 ? `${c.label} ${pct(c.share)}` : '');
            seg.style.flexGrow = String(c.share);
            seg.title = `${c.label}: ${formatNumber(c.oi)} (${pct(c.share)})`;
            wrap.appendChild(seg);
        });
        return wrap;
    }

    _table(snap) {
        const table = el('table', 'pc-table pc-num rt-table');
        const hr = el('tr');
        ['Contract', 'Expiration', 'Days left', 'Open interest', 'Share'].forEach(t => hr.appendChild(el('th', '', t)));
        const head = el('thead');
        head.appendChild(hr);
        table.appendChild(head);
        const body = el('tbody');
        snap.contracts.forEach(c => {
            const tr = el('tr');
            [c.label, formatDateString(c.expiration), String(c.daysLeft), formatNumber(c.oi), pct(c.share)].forEach(v => tr.appendChild(el('td', '', v)));
            body.appendChild(tr);
        });
        table.appendChild(body);
        return table;
    }
}
