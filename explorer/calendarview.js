// Calendar view: expirations and exchange holidays of the products you follow, by month, with .ics export.
import { el, button, refreshIcons } from './dom.js';
import { buildCalendarQuery, collectEvents, groupByDate, toIcs, rangeEnd, monthOf, monthGrid, shiftMonth, eventsByDate, MAX_PRODUCTS } from './calendar.js';
import { cetDate } from './tradingstatus.js';
import { getWatchlist, toggleWatched, onWatchlistChange, normalizeProduct, isProductCode } from './watchlist.js';
import { fetchProductCatalog } from './catalog.js';
import { formatDateString } from './displayformat.js';
import { downloadText } from './ui.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_CHIPS = 6;
const MAX_TAGS = 3; // product tags shown inside a month cell
const MODE_KEY = 'eurexExplorer.calendarMode';

const loadMode = () => { try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'agenda'; } catch (e) { return 'agenda'; } };
const saveMode = (mode) => { try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* storage unavailable */ } };

export class CalendarView {
    /** els: { content }; options: { onOpenProduct(code) } */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
        this.mode = loadMode(); // 'agenda' (list by month) or 'month' (month grid)
        const today = cetDate();
        this.cursor = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }; // month shown in the grid
        this.selected = null; // day selected in the grid
        this.months = 6;
        this.showExpirations = true;
        this.showHolidays = true;
        this.loadedFor = '';
        this.response = null;
        this.visible = false;
        onWatchlistChange(() => { if (this.visible) this.load(); });
    }

    // Called when the view is shown
    show() {
        this.visible = true;
        const key = getWatchlist().join(',');
        if (!this.response || key !== this.loadedFor) this.load();
        else this.render();
    }

    hide() { this.visible = false; }

    async load({ fresh = false } = {}) {
        const products = getWatchlist().slice(0, MAX_PRODUCTS);
        this.products = products;
        this.loadedFor = getWatchlist().join(',');
        this.response = null;
        if (!products.length) { this.render(); return; }
        this.els.content.innerHTML = '';
        this.els.content.appendChild(this._controls());
        this.els.content.appendChild(el('p', 'pc-loading', 'Loading calendar…'));
        const token = (this._token = (this._token || 0) + 1);
        try {
            const res = await this.client.request(buildCalendarQuery(products), null, false, { fresh });
            if (token !== this._token) return;
            this.response = res;
            this.render();
        } catch (err) {
            if (token !== this._token) return;
            this.els.content.innerHTML = '';
            this.els.content.appendChild(this._controls());
            this.els.content.appendChild(el('p', 'pc-empty bad', err.message));
        }
    }

    _kindFilter(e) {
        return e.kind === 'expiration' ? this.showExpirations : this.showHolidays;
    }

    // Agenda: the next N months from today. Month grid: any month, so every event of the response is available.
    _events() {
        if (this.mode === 'month') return collectEvents(this.response, this.products, '0000-01-01', '9999-12-31').filter(e => this._kindFilter(e));
        const from = cetDate();
        return collectEvents(this.response, this.products, from, rangeEnd(from, this.months)).filter(e => this._kindFilter(e));
    }

    // Days listed in the current view (what the calendar export contains)
    _groups() {
        const groups = groupByDate(this._events());
        if (this.mode !== 'month') return groups;
        const prefix = `${this.cursor.y}-${String(this.cursor.m).padStart(2, '0')}`;
        return groups.filter(g => monthOf(g.date) === prefix);
    }

    // ---------- Rendering ----------

    _controls() {
        const bar = el('div', 'cal-controls');

        const chips = el('div', 'cal-products');
        getWatchlist().forEach(p => {
            const c = el('span', 'cal-product');
            const open = button(p, { className: 'cal-product-name', title: `Open ${p}`, onClick: () => this.options.onOpenProduct?.(p) });
            const remove = button('×', { className: 'cal-product-remove', title: `Unfollow ${p}`, onClick: () => toggleWatched(p) });
            remove.setAttribute('aria-label', `Unfollow ${p}`);
            c.append(open, remove);
            chips.appendChild(c);
        });
        const form = el('form', 'cal-add');
        const input = el('input');
        input.type = 'text';
        input.placeholder = 'Follow a product, e.g. FESX';
        input.setAttribute('list', 'calendarProductList');
        input.setAttribute('aria-label', 'Product code to follow');
        input.maxLength = 32;
        input.autocomplete = 'off';
        const list = el('datalist');
        list.id = 'calendarProductList';
        fetchProductCatalog(this.client).then(cat => {
            list.innerHTML = '';
            cat.slice(0, 2000).forEach(p => { const o = el('option'); o.value = p.Product; o.label = p.Name || ''; list.appendChild(o); });
        }).catch(() => {});
        const err = el('span', 'cal-add-error');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const code = normalizeProduct(input.value);
            if (!code) return;
            if (!isProductCode(code)) { err.textContent = 'Not a valid product code.'; return; }
            if (getWatchlist().length >= MAX_PRODUCTS) { err.textContent = `The calendar shows up to ${MAX_PRODUCTS} products.`; return; }
            if (!getWatchlist().includes(code)) toggleWatched(code);
            input.value = '';
        });
        form.append(input, list, button('Follow', { className: 'pc-btn' }), err);
        form.lastChild.previousSibling.type = 'submit';
        chips.appendChild(form);
        bar.appendChild(chips);

        const opts = el('div', 'cal-options');
        const modes = el('div', 'cal-modes');
        modes.setAttribute('role', 'group');
        modes.setAttribute('aria-label', 'Calendar layout');
        [['agenda', 'Agenda', 'list'], ['month', 'Month', 'calendar']].forEach(([mode, label, iconName]) => {
            const b = button(label, { className: 'cal-mode' + (this.mode === mode ? ' active' : ''), iconName, onClick: () => {
                if (this.mode === mode) return;
                this.mode = mode;
                saveMode(mode);
                this.render();
            } });
            b.setAttribute('aria-pressed', String(this.mode === mode));
            modes.appendChild(b);
        });
        opts.appendChild(modes);
        const range = el('select', 'pc-select');
        range.hidden = this.mode === 'month'; // the grid is browsed month by month
        range.setAttribute('aria-label', 'Time range');
        [[3, 'Next 3 months'], [6, 'Next 6 months'], [12, 'Next 12 months'], [24, 'Next 24 months']].forEach(([m, label]) => {
            const o = el('option', '', label);
            o.value = String(m);
            if (m === this.months) o.selected = true;
            range.appendChild(o);
        });
        range.addEventListener('change', () => { this.months = Number(range.value); this.render(); });
        const toggle = (label, key) => {
            const l = el('label', 'cal-toggle');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = this[key];
            cb.addEventListener('change', () => { this[key] = cb.checked; this.render(); });
            l.append(cb, ` ${label}`);
            return l;
        };
        opts.append(range, toggle('Expirations', 'showExpirations'), toggle('Holidays', 'showHolidays'));
        const ics = button('Add to calendar (.ics)', { className: 'pc-btn', iconName: 'calendar', title: 'Download the events shown as a calendar file', onClick: () => {
            const groups = this._groups();
            if (groups.length) downloadText(toIcs(groups, { name: `Eurex: ${this.products.join(', ')}` }), 'eurex-expirations-holidays.ics', 'text/calendar');
        } });
        ics.classList.add('cal-ics');
        opts.appendChild(ics);
        opts.appendChild(button('Refresh', { className: 'pc-btn', iconName: 'refresh-cw', onClick: () => this.load({ fresh: true }) }));
        bar.appendChild(opts);
        return bar;
    }

    render() {
        const box = this.els.content;
        box.innerHTML = '';
        box.appendChild(this._controls());
        if (!this.products.length) {
            const m = el('div', 'pc-message');
            m.appendChild(el('h3', '', 'Follow products to see their calendar'));
            m.appendChild(el('p', '', 'Add products above, or follow them with the star in Products, Trading Hours or a product card. Their expirations and exchange holidays appear here.'));
            box.appendChild(m);
            refreshIcons();
            return;
        }
        if (!this.response) return;
        if (this.mode === 'month') {
            this._renderMonth(box);
            refreshIcons();
            return;
        }
        this._renderAgenda(box);
        refreshIcons();
    }

    _renderAgenda(box) {
        const groups = this._groups();
        box.querySelector('.cal-ics').disabled = groups.length === 0;
        if (!groups.length) {
            box.appendChild(el('p', 'pc-empty', 'Nothing in this time range for your products.'));
            return;
        }
        const today = cetDate();
        let month = '';
        let list = null;
        groups.forEach(g => {
            if (monthOf(g.date) !== month) {
                month = monthOf(g.date);
                const section = el('section', 'cal-month');
                section.appendChild(el('h3', '', `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`));
                list = el('ul', 'cal-days');
                section.appendChild(list);
                box.appendChild(section);
            }
            const li = el('li', 'cal-day' + (g.date === today ? ' today' : ''));
            const d = new Date(`${g.date}T12:00:00Z`);
            const label = el('div', 'cal-date');
            label.appendChild(el('strong', '', String(Number(g.date.slice(8)))));
            label.appendChild(el('span', '', WEEKDAYS[d.getUTCDay()]));
            label.title = formatDateString(g.date);
            li.appendChild(label);
            li.appendChild(this._dayItems(g));
            list.appendChild(li);
        });
    }

    // The expiration and holiday rows of one day
    _dayItems(g) {
        const items = el('div', 'cal-items');
        if (g.expirations.length) items.appendChild(this._row('exp', 'Expiration', g.expirations.map(e => ({ product: e.product, note: e.index != null ? `index ${e.index}` : '' }))));
        if (g.holidays.length) items.appendChild(this._row('hol', 'Holiday', g.holidays.map(p => ({ product: p, note: '' }))));
        return items;
    }

    // ---------- Month grid ----------

    _renderMonth(box) {
        const { y, m } = this.cursor;
        const today = cetDate();
        const byDate = eventsByDate(this._events());
        const inMonthCount = this._groups().length;
        box.querySelector('.cal-ics').disabled = inMonthCount === 0;

        const nav = el('div', 'cal-nav');
        const step = (delta) => { this.cursor = shiftMonth(this.cursor, delta); this.selected = null; this.render(); };
        const prev = button('‹', { className: 'cal-nav-btn', title: 'Previous month', onClick: () => step(-1) });
        prev.setAttribute('aria-label', 'Previous month');
        const next = button('›', { className: 'cal-nav-btn', title: 'Next month', onClick: () => step(1) });
        next.setAttribute('aria-label', 'Next month');
        const title = el('h3', 'cal-nav-title', `${MONTHS[m - 1]} ${y}`);
        title.setAttribute('aria-live', 'polite');
        const todayBtn = button('Today', { className: 'pc-btn', onClick: () => {
            this.cursor = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
            this.selected = today;
            this.render();
        } });
        nav.append(prev, title, next, todayBtn);
        box.appendChild(nav);

        const table = el('table', 'cal-table');
        const head = el('thead');
        const hr = el('tr');
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => { const th = el('th', i >= 5 ? 'weekend' : '', d); th.scope = 'col'; hr.appendChild(th); });
        head.appendChild(hr);
        table.appendChild(head);
        const body = el('tbody');
        monthGrid(y, m).forEach(week => {
            const tr = el('tr');
            week.forEach(day => {
                const g = byDate.get(day.date);
                const exp = g?.expirations.length || 0;
                const hol = g?.holidays.length || 0;
                const td = el('td', ['cal-cell', day.inMonth ? '' : 'out', day.weekend ? 'weekend' : '', day.date === today ? 'today' : '', day.date === this.selected ? 'selected' : '', exp || hol ? 'has-events' : ''].filter(Boolean).join(' '));
                td.addEventListener('click', (e) => {
                    if (e.target.closest('.cal-tag')) return; // a product tag opens the product
                    this.selected = day.date === this.selected ? null : day.date;
                    this.render();
                });
                const num = el('button', 'cal-daynum', String(day.day));
                num.type = 'button';
                const parts = [`${day.day} ${MONTHS[Number(day.date.slice(5, 7)) - 1]} ${day.date.slice(0, 4)}`];
                if (exp) parts.push(`${exp} expiration${exp === 1 ? '' : 's'}`);
                if (hol) parts.push(`${hol} holiday${hol === 1 ? '' : 's'}`);
                num.setAttribute('aria-label', parts.join(', '));
                num.setAttribute('aria-pressed', String(day.date === this.selected));
                td.appendChild(num);

                if (g) {
                    const tags = el('div', 'cal-tags');
                    const all = [...g.expirations.map(e => ({ kind: 'exp', product: e.product, note: e.index != null ? `index ${e.index}` : '' })), ...g.holidays.map(p => ({ kind: 'hol', product: p, note: '' }))];
                    all.slice(0, MAX_TAGS).forEach(t => {
                        tags.appendChild(button(t.product, { className: `cal-tag ${t.kind}`, title: `${t.kind === 'exp' ? 'Expiration' : 'Holiday'} ${t.product}${t.note ? ' · ' + t.note : ''}: open product card`, onClick: () => this.options.onOpenProduct?.(t.product) }));
                    });
                    if (all.length > MAX_TAGS) tags.appendChild(el('span', 'cal-more', `+${all.length - MAX_TAGS}`));
                    td.appendChild(tags);
                    // Narrow screens: counts instead of names
                    const dots = el('div', 'cal-dots');
                    if (exp) dots.appendChild(el('span', 'cal-dot exp', String(exp)));
                    if (hol) dots.appendChild(el('span', 'cal-dot hol', String(hol)));
                    td.appendChild(dots);
                }
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
        table.appendChild(body);
        box.appendChild(table);

        const legend = el('p', 'cal-legend');
        legend.append(el('span', 'cal-key exp'), ' Expiration  ', el('span', 'cal-key hol'), ' Holiday');
        box.appendChild(legend);

        if (this.selected) {
            const g = byDate.get(this.selected);
            const d = new Date(`${this.selected}T12:00:00Z`);
            const detail = el('section', 'cal-detail');
            detail.appendChild(el('h4', '', `${WEEKDAYS[d.getUTCDay()]}, ${formatDateString(this.selected)}`));
            if (g) detail.appendChild(this._dayItems(g));
            else detail.appendChild(el('p', 'pc-empty', 'No expirations or holidays on this day.'));
            box.appendChild(detail);
        } else if (!inMonthCount) {
            box.appendChild(el('p', 'pc-empty', 'Nothing in this month for your products.'));
        }
    }

    _row(kind, label, entries) {
        const row = el('div', `cal-row ${kind}`);
        row.appendChild(el('span', 'cal-kind', label));
        const chips = el('span', 'cal-chips');
        const draw = (all) => {
            chips.innerHTML = '';
            (all ? entries : entries.slice(0, MAX_CHIPS)).forEach(e => {
                chips.appendChild(button(e.product, { className: 'cal-chip', title: `${e.product}${e.note ? ' · ' + e.note : ''}: open product card`, onClick: () => this.options.onOpenProduct?.(e.product) }));
            });
            if (!all && entries.length > MAX_CHIPS) chips.appendChild(button(`+${entries.length - MAX_CHIPS} more`, { className: 'dt-link', onClick: () => draw(true) }));
        };
        draw(false);
        row.appendChild(chips);
        return row;
    }
}
