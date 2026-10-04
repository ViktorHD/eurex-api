// Product card: everything the API knows about one product on one page, for the daily "what are the rules for X"
// lookup: master data, trading hours with live status, tick rules (with a price checker), TES lot sizes per
// expiration, upcoming expirations and holidays (calendar export), settlement price history and vendor codes.
import { el, icon, button, labelOf, hhmm, refreshIcons } from './dom.js';
import { buildProductQuery } from './productquery.js';
import { buildSchemaIndex } from './schemacheck.js';
import { getStatus, nextHoliday, buildHolidayMap, STATUS_LABELS, cetDate } from './tradingstatus.js';
import { selectionOptions, isValidPair, instrumentsFor, defaultSelection, resolveRules, checkPrice, normKey } from './ticks.js';
import { profileGroups, tiers, allocate } from './tes.js';
import { renderLineChart } from './linechart.js';
import { groupSettlement, seriesFor, seriesStats } from './settlement.js';
import { buildIcs } from './ics.js';
import { formatNumber, formatDateString } from './displayformat.js';
import { toCsv, downloadText } from './ui.js';
import { isWatched, toggleWatched, onWatchlistChange } from './watchlist.js';

const show = (v) => (typeof v === 'number' ? formatNumber(v) : formatDateString(String(v)));
const daysUntil = (iso, today) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`);

export class ProductCard {
    /**
     * els: { content }; options: { getSchema: () => Promise<schema>, onRunQuery(query), onOpenStrikeWindow(product),
     * onShare(product) }
     */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
        this.product = '';
        this.data = null;
        this.index = null;
        this.loadToken = 0;
        this.roots = [];
        onWatchlistChange(() => this._syncStar());
    }

    async open(product, { fresh = false } = {}) {
        const code = String(product || '').trim().toUpperCase();
        this.product = code;
        const token = ++this.loadToken;
        const box = this.els.content;
        box.innerHTML = '';
        if (!code) {
            box.appendChild(this._message('No product selected', 'Pick a product in Products to see its card.'));
            return;
        }
        box.appendChild(el('p', 'pc-loading', `Loading ${code}…`));

        let query;
        let roots;
        try {
            if (!this.index && this.options.getSchema) {
                try { this.index = buildSchemaIndex(await this.options.getSchema()); } catch (e) { this.index = null; }
            }
            ({ query, roots } = buildProductQuery(code, this.index));
            this.query = query;
            this.roots = roots;
            const res = await this.client.request(query, null, false, { fresh });
            if (token !== this.loadToken) return; // another product was opened meanwhile
            this.data = {};
            roots.forEach(r => { this.data[r] = res?.[r]?.data ?? null; });
            this.dates = {};
            roots.forEach(r => { this.dates[r] = res?.[r]?.date ?? null; });
            this.partialErrors = res?.partialErrors || [];
            this.settlement = null;
            this.render();
        } catch (err) {
            if (token !== this.loadToken) return;
            box.innerHTML = '';
            box.appendChild(this._message('The product could not be loaded', err.message));
        }
    }

    refresh() { return this.open(this.product, { fresh: true }); }

    _message(title, text) {
        const m = el('div', 'pc-message');
        m.appendChild(el('h3', '', title));
        m.appendChild(el('p', '', text));
        return m;
    }

    render() {
        const box = this.els.content;
        box.innerHTML = '';
        const info = this.data.ProductInfos?.[0];
        if (this.data.ProductInfos && !info) {
            box.appendChild(this._message(`No product ${this.product}`, 'The API has no product with this code. Check the code in Products.'));
            return;
        }
        box.appendChild(this._header(info));
        if (this.partialErrors.length) {
            const warn = el('div', 'dt-warning');
            warn.appendChild(el('strong', '', 'Some data could not be loaded'));
            const ul = el('ul');
            this.partialErrors.slice(0, 5).forEach(m => ul.appendChild(el('li', '', m)));
            warn.appendChild(ul);
            box.appendChild(warn);
        }
        const cards = [this._overview(info), this._hours(), this._ticks(), this._tes(), this._calendar(), this._settlementSection(), this._vendor()].filter(Boolean);
        const grid = el('div', 'pc-grid');
        box.appendChild(grid);
        this._pack(grid, cards);
        refreshIcons();
    }

    // Cards differ a lot in height, so a plain grid leaves gaps. Each card goes into the column that is currently
    // shortest (masonry). Cards are placed once and keep their column when their content grows later (settlement chart);
    // the number of columns follows the width of the page.
    _pack(grid, cards) {
        this.packed = { grid, cards };
        const place = () => {
            const width = grid.clientWidth || this.els.content.clientWidth || 0;
            const count = Math.max(1, Math.min(3, Math.floor((width + 16) / 436)));
            if (grid.dataset.cols === String(count)) return;
            grid.dataset.cols = String(count);
            grid.innerHTML = '';
            const cols = Array.from({ length: count }, () => { const c = el('div', 'pc-col'); grid.appendChild(c); return c; });
            const heights = cols.map(() => 0);
            cards.forEach(card => {
                const at = heights.indexOf(Math.min(...heights));
                cols[at].appendChild(card);
                // Real height when laid out; otherwise (no layout) an estimate from the amount of text
                heights[at] += card.offsetHeight || Math.max(80, card.textContent.length / 3);
            });
        };
        place();
        this._resizeObserver?.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => { if (grid.isConnected) place(); });
            this._resizeObserver.observe(grid);
        }
    }

    _section(title, hint, ...children) {
        const s = el('section', 'pc-card');
        const head = el('div', 'pc-card-head');
        head.appendChild(el('h3', '', title));
        if (hint) head.appendChild(el('span', 'pc-hint', hint));
        s.appendChild(head);
        children.filter(Boolean).forEach(c => s.appendChild(c));
        return s;
    }

    _unavailable(root) {
        if (!this.roots.includes(root)) return el('p', 'pc-empty', `${root} is not offered by this API.`);
        return el('p', 'pc-empty', this.data[root] === null ? `${root} could not be loaded.` : 'Nothing listed for this product.');
    }

    // ---------- Header ----------

    _header(info) {
        const head = el('header', 'pc-header');
        const title = el('div', 'pc-title');
        const h = el('h2', '', this.product);
        title.appendChild(h);
        if (info?.Name) title.appendChild(el('span', 'pc-name', info.Name));
        const chips = el('div', 'pc-chips');
        [info?.ProductType, info?.Currency, info?.ProductLine].filter(Boolean).forEach(c => chips.appendChild(el('span', 'pc-chip', c)));
        title.appendChild(chips);
        head.appendChild(title);

        const actions = el('div', 'pc-actions');
        this.starBtn = el('button', 'pc-btn pc-star');
        this.starBtn.type = 'button';
        this.starBtn.addEventListener('click', () => toggleWatched(this.product));
        actions.appendChild(this.starBtn);
        this._syncStar();
        if (this.options.onOpenStrikeWindow && /^O/.test(String(info?.ProductTypeCode || '')) ) {
            actions.appendChild(button('Strike Window', { className: 'pc-btn', iconName: 'bar-chart-2', onClick: () => this.options.onOpenStrikeWindow(this.product) }));
        }
        if (this.options.onRunQuery) {
            actions.appendChild(button('Run in Explorer', { className: 'pc-btn', iconName: 'terminal', title: 'Open the queries behind this card in the API Explorer', onClick: () => this.options.onRunQuery(this.query) }));
        }
        if (this.options.onShare) actions.appendChild(button('Share', { className: 'pc-btn', iconName: 'share-2', onClick: () => this.options.onShare(this.product) }));
        actions.appendChild(button('Print', { className: 'pc-btn', iconName: 'printer', title: 'Print or save as PDF', onClick: () => window.print() }));
        actions.appendChild(button('Refresh', { className: 'pc-btn', iconName: 'refresh-cw', onClick: () => this.refresh() }));
        head.appendChild(actions);
        return head;
    }

    _syncStar() {
        if (!this.starBtn) return;
        const on = isWatched(this.product);
        this.starBtn.textContent = on ? '★ Following' : '☆ Follow';
        this.starBtn.setAttribute('aria-pressed', String(on));
        this.starBtn.classList.toggle('active', on);
    }

    // ---------- Master data ----------

    _overview(info) {
        if (!this.data.ProductInfos) return this._section('Product data', '', this._unavailable('ProductInfos'));
        const dl = el('dl', 'pc-dl');
        Object.entries(info).forEach(([k, v]) => {
            if (v === null || v === undefined || v === '' || typeof v === 'object') return;
            dl.appendChild(el('dt', '', labelOf(k)));
            dl.appendChild(el('dd', '', show(v)));
        });
        const more = this.data.ProductInfos.length > 1 ? el('p', 'pc-hint', `${this.data.ProductInfos.length} records exist for this code; the first is shown.`) : null;
        return this._section('Product data', this.dates.ProductInfos ? `valid ${formatDateString(this.dates.ProductInfos)}` : '', dl, more);
    }

    // ---------- Trading hours ----------

    _holidays() {
        const rows = this.data.Holidays || [];
        return buildHolidayMap(rows.map(r => ({ ...r, Product: this.product }))).get(this.product) || [];
    }

    _hours() {
        const rows = this.data.TradingHours;
        if (!rows || !rows.length) return this._section('Trading hours', '', this._unavailable('TradingHours'));
        const h = rows[0];
        const holidays = this._holidays();
        const status = getStatus(rows, new Date(), holidays);
        const badge = el('div', `pc-status ${status}`);
        badge.appendChild(el('span', 'pc-status-dot'));
        badge.appendChild(el('strong', '', STATUS_LABELS[status]));
        const next = nextHoliday(holidays);
        if (next) badge.appendChild(el('span', 'pc-hint', `Next holiday ${formatDateString(next)} (${inDays(daysUntil(next, cetDate()))})`));

        const table = el('table', 'pc-table');
        const body = el('tbody');
        const addRow = (phase, from, to) => {
            if (!from && !to) return;
            const tr = el('tr');
            tr.appendChild(el('th', '', phase));
            tr.appendChild(el('td', '', from && to ? `${hhmm(from)} – ${hhmm(to)}` : hhmm(from || to)));
            body.appendChild(tr);
        };
        addRow('Opening auction', h.StartContinuousTrading && h.EndOpeningAuction ? h.StartContinuousTrading : null, h.EndOpeningAuction);
        addRow('Continuous trading', h.StartContinuousTrading, h.EndContinuousTrading);
        addRow('Closing auction', h.EndClosingAuction ? h.EndContinuousTrading : null, h.EndClosingAuction);
        addRow('TES (off-book)', h.StartTES, h.EndTES);
        addRow('Last trading day: order book closes', h.LTDBook, null);
        addRow('Last trading day: TES closes', h.LTDTES, null);
        table.appendChild(body);
        const note = rows.length > 1 ? el('p', 'pc-hint', `${rows.length} hour sets exist; the first is shown, status considers all.`) : null;
        return this._section('Trading hours', 'CET / CEST', badge, table, note);
    }

    // ---------- Tick rules ----------

    _ticks() {
        const rows = this.data.TickRules;
        const title = 'Tick rules';
        if (!rows || !rows.length) return this._section(title, '', this._unavailable('TickRules'));
        // A tick rule belongs to a trade type AND an instrument type; TESProfiles say which combinations exist
        const { tradeTypes, instrumentTypes, valid } = selectionOptions(rows, this.data.TESProfiles);
        let sel = defaultSelection(rows);
        const holder = el('div', 'pc-tick');
        const fields = {};
        const pairLabel = (t, i) => [t, i].filter(Boolean).join(' · ');
        const draw = () => {
            holder.innerHTML = '';
            const ok = isValidPair(valid, sel.tradeType, sel.instrumentType);
            // Highlight both selects of a combination that does not exist, and mark the instrument types that do not
            // exist for the chosen trade type
            fields.trade?.classList.toggle('invalid', !ok);
            fields.instrument?.wrap.classList.toggle('invalid', !ok);
            fields.instrument?.select.querySelectorAll('option').forEach(o => {
                const exists = isValidPair(valid, sel.tradeType, o.value);
                o.textContent = exists ? o.value : `${o.value} (not available)`;
            });
            if (!ok) {
                const existing = instrumentsFor(valid, instrumentTypes, sel.tradeType);
                const warn = el('p', 'pc-note bad', `${pairLabel(sel.tradeType, sel.instrumentType)} is not a valid combination.${existing.length ? ` ${sel.tradeType} exists for: ${existing.join(', ')}.` : ''}`);
                warn.setAttribute('role', 'alert');
                holder.appendChild(warn);
                return;
            }
            const { rules, tradeType, instrumentType, fallback } = resolveRules(rows, sel);
            if (fallback) {
                holder.appendChild(el('p', 'pc-note', `No separate tick rules for ${pairLabel(sel.tradeType, sel.instrumentType)}: the ${pairLabel(tradeType, instrumentType)} tick rules apply.`));
            }
            if (!rules.length) {
                holder.appendChild(el('p', 'pc-empty', 'No tick rules listed for this selection.'));
                return;
            }
            const table = el('table', 'pc-table pc-num');
            const head = el('thead');
            const hr = el('tr');
            ['From price', 'Up to price', 'Tick size'].forEach(t => hr.appendChild(el('th', '', t)));
            head.appendChild(hr);
            table.appendChild(head);
            const body = el('tbody');
            rules.forEach(r => {
                const tr = el('tr');
                tr.appendChild(el('td', '', Number.isFinite(r.start) ? formatNumber(r.start) : '–'));
                tr.appendChild(el('td', '', r.end === null ? 'and above' : formatNumber(r.end)));
                tr.appendChild(el('td', '', formatNumber(r.step)));
                body.appendChild(tr);
            });
            table.appendChild(body);
            holder.appendChild(table);

            // Price checker
            const form = el('form', 'pc-check');
            form.setAttribute('autocomplete', 'off');
            const label = el('label', '', 'Check a price');
            const input = el('input');
            input.type = 'text';
            input.inputMode = 'decimal';
            input.autocomplete = 'off';
            input.placeholder = 'e.g. 5512.5';
            input.setAttribute('aria-label', 'Price to check');
            label.appendChild(input);
            const out = el('output', 'pc-check-out');
            out.setAttribute('role', 'status');
            const run = () => {
                const raw = input.value.trim().replace(',', '.');
                out.className = 'pc-check-out';
                if (!raw) { out.textContent = ''; return; }
                const price = Number(raw);
                if (!Number.isFinite(price)) { out.textContent = 'Enter a number.'; out.classList.add('bad'); return; }
                const r = checkPrice(rules, price);
                if (!r.rule) { out.textContent = 'No tick rule covers this price.'; out.classList.add('bad'); return; }
                if (r.valid) { out.textContent = `Valid: tick size ${formatNumber(r.step)}.`; out.classList.add('ok'); }
                else { out.textContent = `Not on the tick grid (tick size ${formatNumber(r.step)}). Nearest valid prices: ${formatNumber(r.below)} and ${formatNumber(r.above)}.`; out.classList.add('bad'); }
            };
            input.addEventListener('input', run);
            form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
            form.append(label, out);
            holder.appendChild(form);
            holder.appendChild(el('p', 'pc-hint', 'Prices are checked as multiples of the tick size from zero within the band that contains them.'));
        };
        const select = (labelText, values, current, onChange) => {
            const wrap = el('label', 'pc-field');
            wrap.appendChild(el('span', 'pc-hint', labelText));
            const s = el('select', 'pc-select');
            values.forEach(v => {
                const o = el('option', '', v);
                o.value = v;
                if (normKey(v) === normKey(current)) o.selected = true;
                s.appendChild(o);
            });
            s.addEventListener('change', () => onChange(s.value));
            wrap.appendChild(s);
            return { wrap, select: s };
        };
        const controls = el('div', 'pc-controls');
        const trade = select('Trade type', tradeTypes, sel.tradeType, (v) => { sel = { ...sel, tradeType: v }; draw(); });
        fields.trade = trade.wrap;
        controls.appendChild(trade.wrap);
        if (instrumentTypes.length > 1) {
            fields.instrument = select('Instrument type', instrumentTypes, sel.instrumentType, (v) => { sel = { ...sel, instrumentType: v }; draw(); });
            controls.appendChild(fields.instrument.wrap);
        }
        draw();
        return this._section(title, this.dates.TickRules ? `valid ${formatDateString(this.dates.TickRules)}` : '', controls, holder);
    }

    // ---------- TES ----------

    _tes() {
        const rows = this.data.TESProfiles;
        if (!rows || !rows.length) return this._section('TES (block trades)', '', this._unavailable('TESProfiles'));
        const groups = profileGroups(rows);
        let current = groups.find(g => g.tesType === 'BLOCK' && g.instrumentType === 'SIMPLE_INSTRUMENT') || groups[0];
        const holder = el('div', 'pc-tes');
        let showAll = false;
        const draw = () => {
            holder.innerHTML = '';
            const list = tiers(rows, current);
            const first = list[0]?.profile;
            if (first) {
                const dl = el('dl', 'pc-dl compact');
                [['PriceValidationRule', 'Price validation'], ['AllowAutoApproval', 'Auto approval'], ['AllowBroker', 'Broker allowed'], ['TESminStep', 'Minimum step'], ['MaxTrader', 'Max traders'], ['LegPriceEntry', 'Leg price entry']].forEach(([k, label]) => {
                    if (first[k] === null || first[k] === undefined || first[k] === '') return;
                    dl.appendChild(el('dt', '', label));
                    dl.appendChild(el('dd', '', typeof first[k] === 'boolean' ? (first[k] ? 'Yes' : 'No') : show(first[k])));
                });
                if (dl.children.length) holder.appendChild(dl);
            }
            const table = el('table', 'pc-table pc-num');
            const head = el('thead');
            const hr = el('tr');
            ['Expiry index', 'Min lot size', 'Min lot (non-primary)', 'Non-disclosure limit'].forEach(t => hr.appendChild(el('th', '', t)));
            head.appendChild(hr);
            table.appendChild(head);
            const body = el('tbody');
            list.forEach(t => {
                const tr = el('tr');
                tr.appendChild(el('td', '', t.to === null ? (t.from <= 1 ? 'all' : `${t.from} and later`) : t.from === t.to ? String(t.from) : `${t.from} – ${t.to}`));
                [t.minLotSize, t.minLotSizeNonPrimary, t.nonDisclosureLimit].forEach(v => tr.appendChild(el('td', '', v === null || v === undefined ? '–' : formatNumber(Number(v)))));
                body.appendChild(tr);
            });
            table.appendChild(body);
            holder.appendChild(table);

            const exps = allocate(this.data.Expirations || [], list);
            if (exps.length) {
                holder.appendChild(el('h4', 'pc-sub', 'Per expiration'));
                const t2 = el('table', 'pc-table pc-num');
                const h2 = el('thead');
                const hr2 = el('tr');
                ['Index', 'Expiration', 'Master contract', 'Min lot size', 'Non-disclosure'].forEach(t => hr2.appendChild(el('th', '', t)));
                h2.appendChild(hr2);
                t2.appendChild(h2);
                const b2 = el('tbody');
                exps.slice(0, showAll ? exps.length : 12).forEach(e => {
                    const tr = el('tr');
                    [e.expirationIndex, e.expirationDate ? formatDateString(String(e.expirationDate)) : '–', e.masterContract ?? '–',
                        e.minLotSize === null ? '–' : formatNumber(Number(e.minLotSize)), e.nonDisclosureLimit === null ? '–' : formatNumber(Number(e.nonDisclosureLimit))]
                        .forEach(v => tr.appendChild(el('td', '', String(v))));
                    b2.appendChild(tr);
                });
                t2.appendChild(b2);
                holder.appendChild(t2);
                if (exps.length > 12) {
                    holder.appendChild(button(showAll ? 'Show fewer' : `Show all ${exps.length}`, { className: 'dt-link', onClick: () => { showAll = !showAll; draw(); } }));
                }
                holder.appendChild(el('p', 'pc-hint', 'A threshold applies from its expiry index until the next one starts (rule of the "FAQ cases" notebook).'));
            }
        };
        const controls = [];
        if (groups.length > 1) {
            const sel = el('select', 'pc-select');
            sel.setAttribute('aria-label', 'TES type and instrument type');
            groups.forEach((g, i) => {
                const o = el('option', '', [g.tesType, g.instrumentType].filter(Boolean).join(' · ') || 'All');
                o.value = String(i);
                if (g === current) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => { current = groups[Number(sel.value)]; showAll = false; draw(); });
            controls.push(sel);
        }
        draw();
        return this._section('TES (block trades)', this.dates.TESProfiles ? `valid ${formatDateString(this.dates.TESProfiles)}` : '', ...controls, holder);
    }

    // ---------- Expirations and holidays ----------

    _calendar() {
        const exps = this.data.Expirations;
        const today = cetDate();
        const upcoming = (exps || []).filter(e => e.ExpirationDate && String(e.ExpirationDate).slice(0, 10) >= today)
            .sort((a, b) => String(a.ExpirationDate).localeCompare(String(b.ExpirationDate)));
        const holidays = this._holidays().filter(d => d >= today);
        if (!exps && !this.data.Holidays) return this._section('Expirations and holidays', '', this._unavailable('Expirations'));

        const wrap = el('div', 'pc-two');
        const left = el('div');
        left.appendChild(el('h4', 'pc-sub', 'Next expirations'));
        if (upcoming.length) {
            const ul = el('ul', 'pc-list');
            upcoming.slice(0, 12).forEach(e => {
                const li = el('li');
                li.appendChild(el('strong', '', formatDateString(String(e.ExpirationDate).slice(0, 10))));
                li.appendChild(el('span', 'pc-hint', ` ${inDays(daysUntil(String(e.ExpirationDate).slice(0, 10), today))}${e.ExpirationIndex != null ? ` · index ${e.ExpirationIndex}` : ''}`));
                ul.appendChild(li);
            });
            left.appendChild(ul);
        } else left.appendChild(el('p', 'pc-empty', 'No upcoming expirations listed.'));
        const right = el('div');
        right.appendChild(el('h4', 'pc-sub', 'Next holidays'));
        if (holidays.length) {
            const ul = el('ul', 'pc-list');
            holidays.slice(0, 12).forEach(d => {
                const li = el('li');
                li.appendChild(el('strong', '', formatDateString(d)));
                li.appendChild(el('span', 'pc-hint', ` ${inDays(daysUntil(d, today))}`));
                ul.appendChild(li);
            });
            right.appendChild(ul);
        } else right.appendChild(el('p', 'pc-empty', 'No upcoming holidays listed.'));
        wrap.append(left, right);

        const events = [
            ...upcoming.map((e, i) => ({ uid: `exp-${this.product}-${String(e.ExpirationDate).slice(0, 10)}-${i}`, date: String(e.ExpirationDate).slice(0, 10), summary: `${this.product} expiration${e.ExpirationIndex != null ? ` (index ${e.ExpirationIndex})` : ''}` })),
            ...holidays.map(d => ({ uid: `hol-${this.product}-${d}`, date: d, summary: `${this.product}: exchange holiday` }))
        ];
        const ics = events.length
            ? button('Add to calendar (.ics)', { className: 'pc-btn', iconName: 'calendar', onClick: () => downloadText(buildIcs(events, { name: `${this.product} expirations and holidays` }), `${this.product}-calendar.ics`, 'text/calendar') })
            : null;
        return this._section('Expirations and holidays', '', wrap, ics);
    }

    // ---------- Settlement prices (loaded on request) ----------

    _settlementSection() {
        const holder = el('div', 'pc-settle');
        const start = button('Load settlement prices', { className: 'pc-btn primary', iconName: 'trending-up', onClick: () => this._loadSettlement(holder) });
        holder.appendChild(el('p', 'pc-hint', 'Settlement prices can be large, so they are loaded when you ask.'));
        holder.appendChild(start);
        if (this.settlement) this._drawSettlement(holder);
        return this._section('Settlement prices', '', holder);
    }

    async _loadSettlement(holder) {
        holder.innerHTML = '';
        holder.appendChild(el('p', 'pc-loading', 'Loading settlement prices…'));
        const code = this.product;
        const query = `query {
  SettlementPrices(filter: { Product: { eq: "${code}" } }) {
    date
    data {
      ContractID
      ContractType
      PriceType
      SettlementPrice
      SettlementDate
    }
  }
  Contracts(filter: { Product: { eq: "${code}" } }) {
    data {
      ContractID
      Contract
      ExpirationDate
    }
  }
}`;
        try {
            const res = await this.client.request(query, null, false);
            if (code !== this.product) return;
            this.settlement = { rows: res?.SettlementPrices?.data || [], contracts: res?.Contracts?.data || [], date: res?.SettlementPrices?.date || null };
            this._drawSettlement(holder);
        } catch (err) {
            holder.innerHTML = '';
            holder.appendChild(el('p', 'pc-empty bad', err.message));
            holder.appendChild(button('Try again', { className: 'pc-btn', onClick: () => this._loadSettlement(holder) }));
        }
    }

    _drawSettlement(holder) {
        holder.innerHTML = '';
        const { rows, contracts, date } = this.settlement;
        const groups = groupSettlement(rows, contracts);
        if (!groups.length) { holder.appendChild(el('p', 'pc-empty', 'No settlement prices listed for this product.')); return; }

        const controls = el('div', 'pc-controls');
        const contractSel = el('select', 'pc-select');
        contractSel.setAttribute('aria-label', 'Contract');
        groups.forEach((g, i) => {
            const o = el('option', '', `${g.label}${g.contractType ? ` (${g.contractType.toLowerCase()})` : ''} · ${g.count} price${g.count === 1 ? '' : 's'}`);
            o.value = String(i);
            contractSel.appendChild(o);
        });
        const typeSel = el('select', 'pc-select');
        typeSel.setAttribute('aria-label', 'Price type');
        controls.appendChild(contractSel);
        controls.appendChild(typeSel);
        holder.appendChild(controls);
        const chartBox = el('div', 'pc-chart');
        const stats = el('div', 'pc-stats');
        const actions = el('div', 'pc-actions');
        holder.append(chartBox, stats, actions);

        const draw = () => {
            const g = groups[Number(contractSel.value)];
            const wanted = typeSel.value;
            const series = seriesFor(rows, g.key, wanted);
            chartBox.innerHTML = '';
            chartBox.appendChild(renderLineChart(series, { format: (y) => formatNumber(y), label: `Settlement price of ${g.label}` }));
            stats.innerHTML = '';
            const st = seriesStats(series);
            if (st) {
                [['Latest', `${formatNumber(st.last.y)} (${formatDateString(st.last.x)})`], ['Low', formatNumber(st.min)], ['High', formatNumber(st.max)], ['Prices', String(st.count)]].forEach(([k, v]) => {
                    const s = el('div', 'pc-stat');
                    s.appendChild(el('span', 'pc-hint', k));
                    s.appendChild(el('strong', '', v));
                    stats.appendChild(s);
                });
            }
            actions.innerHTML = '';
            if (series.length) {
                actions.appendChild(button('Download CSV', { className: 'pc-btn', iconName: 'download', onClick: () => downloadText(toCsv(['Date', 'SettlementPrice'], series.map(p => ({ Date: p.x, SettlementPrice: p.y }))), `${this.product}_${g.label}_settlement.csv`, 'text/csv') }));
                refreshIcons();
            }
        };
        const fillTypes = () => {
            const g = groups[Number(contractSel.value)];
            typeSel.innerHTML = '';
            const all = el('option', '', g.priceTypes.length > 1 ? 'All price types' : (g.priceTypes[0] || 'Price'));
            all.value = '';
            typeSel.appendChild(all);
            if (g.priceTypes.length > 1) g.priceTypes.forEach(t => { const o = el('option', '', t); o.value = t; typeSel.appendChild(o); });
            typeSel.hidden = g.priceTypes.length < 2;
        };
        contractSel.addEventListener('change', () => { fillTypes(); draw(); });
        typeSel.addEventListener('change', draw);
        // Start at the contract with the most recent prices that expires next
        const today = cetDate();
        const next = groups.findIndex(g => g.expiration && String(g.expiration).slice(0, 10) >= today);
        contractSel.value = String(next >= 0 ? next : 0);
        fillTypes();
        draw();
        if (date) holder.appendChild(el('p', 'pc-hint', `valid ${formatDateString(date)}`));
    }

    // ---------- Vendor codes ----------

    _vendor() {
        const rows = this.data.VendorCodes;
        if (!rows || !rows.length) return null;
        const cols = Object.keys(rows[0]).filter(k => k !== 'Product' && k !== 'ProductID');
        if (!cols.length) return null;
        const table = el('table', 'pc-table');
        const head = el('thead');
        const hr = el('tr');
        cols.forEach(c => hr.appendChild(el('th', '', labelOf(c))));
        head.appendChild(hr);
        table.appendChild(head);
        const body = el('tbody');
        rows.forEach(r => {
            const tr = el('tr');
            cols.forEach(c => tr.appendChild(el('td', '', r[c] === null || r[c] === undefined ? '–' : show(r[c]))));
            body.appendChild(tr);
        });
        table.appendChild(body);
        return this._section('Vendor codes', '', table);
    }
}
