// Calendar view: expirations and exchange holidays of the products you follow, by month, with .ics export.
import { el, button, refreshIcons } from './dom.js';
import { buildCalendarQuery, collectEvents, groupByDate, toIcs, rangeEnd, monthOf, MAX_PRODUCTS } from './calendar.js';
import { cetDate } from './tradingstatus.js';
import { getWatchlist, toggleWatched, onWatchlistChange, normalizeProduct, isProductCode } from './watchlist.js';
import { fetchProductCatalog } from './catalog.js';
import { formatDateString } from './displayformat.js';
import { downloadText } from './ui.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_CHIPS = 6;

export class CalendarView {
    /** els: { content }; options: { onOpenProduct(code) } */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
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

    _groups() {
        const from = cetDate();
        const events = collectEvents(this.response, this.products, from, rangeEnd(from, this.months))
            .filter(e => (e.kind === 'expiration' ? this.showExpirations : this.showHolidays));
        return groupByDate(events);
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
        const range = el('select', 'pc-select');
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
        const groups = this._groups();
        box.querySelector('.cal-ics').disabled = groups.length === 0;
        if (!groups.length) {
            box.appendChild(el('p', 'pc-empty', 'Nothing in this time range for your products.'));
            refreshIcons();
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
            const items = el('div', 'cal-items');
            if (g.expirations.length) items.appendChild(this._row('exp', 'Expiration', g.expirations.map(e => ({ product: e.product, note: e.index != null ? `index ${e.index}` : '' }))));
            if (g.holidays.length) items.appendChild(this._row('hol', 'Holiday', g.holidays.map(p => ({ product: p, note: '' }))));
            li.appendChild(items);
            list.appendChild(li);
        });
        refreshIcons();
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
