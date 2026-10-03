// Products view: search the whole catalog (code, name, ISIN, type, currency, vendor symbols), follow products and open
// their cards.
import { el, button, refreshIcons } from './dom.js';
import { fetchProductCatalog } from './catalog.js';
import { searchProducts, productTypes, vendorMap } from './products.js';
import { getWatchlist, toggleWatched, onWatchlistChange } from './watchlist.js';
import { buildSchemaIndex, membersOf, baseName } from './schemacheck.js';

const LIMIT = 100;

export class ProductsView {
    /** els: { content }; options: { onOpenProduct(code), getSchema } */
    constructor(client, els, options = {}) {
        this.client = client;
        this.els = els;
        this.options = options;
        this.catalog = null;
        this.vendor = null;
        this.query = '';
        this.type = '';
        this.watchedOnly = false;
        this.built = false;
        onWatchlistChange(() => { if (this.built) { this._drawFollowing(); this._drawResults(); } });
    }

    async show() {
        if (!this.built) this._build();
        if (this.catalog) return;
        this.status.textContent = 'Loading products…';
        try {
            this.catalog = await fetchProductCatalog(this.client);
            this._fillTypes();
            this.status.textContent = '';
            this._drawResults();
            this._loadVendorCodes();
        } catch (err) {
            this.status.textContent = '';
            this.results.innerHTML = '';
            this.results.appendChild(el('p', 'pc-empty bad', `The product list could not be loaded: ${err.message}`));
            this.results.appendChild(button('Try again', { className: 'pc-btn', onClick: () => this.show() }));
        }
    }

    // Vendor symbols make products findable by their data vendor code; optional, needs VendorCodes in the schema
    async _loadVendorCodes() {
        try {
            const index = buildSchemaIndex(await this.options.getSchema?.());
            const root = index && membersOf(index, index.queryTypeName).find(f => f.name === 'VendorCodes');
            if (!root) return;
            const outer = index.types.get(baseName(root.type));
            const row = index.types.get(baseName(outer?.fields?.find(f => f.name === 'data')?.type));
            const fields = (row?.fields || []).filter(f => { const t = index.types.get(baseName(f.type)); return !t || t.kind === 'SCALAR' || t.kind === 'ENUM'; }).map(f => f.name);
            if (!fields.includes('Product')) return;
            const res = await this.client.request(`query {\n  VendorCodes {\n    data {\n      ${fields.join('\n      ')}\n    }\n  }\n}`, null, true);
            this.vendor = vendorMap(res.data);
            this._drawResults();
        } catch (e) { /* search simply works without vendor symbols */ }
    }

    _build() {
        this.built = true;
        const box = this.els.content;
        box.innerHTML = '';

        const bar = el('div', 'ps-bar');
        const label = el('label', 'ps-search');
        this.input = el('input');
        this.input.type = 'search';
        this.input.placeholder = 'Search by product code, name, ISIN or vendor code';
        this.input.setAttribute('aria-label', 'Search products');
        this.input.autocomplete = 'off';
        this.input.addEventListener('input', () => { this.query = this.input.value; this._drawResults(); });
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = this.results.querySelector('.ps-open');
                if (first) first.click();
            }
        });
        label.appendChild(this.input);
        this.typeSel = el('select', 'pc-select');
        this.typeSel.setAttribute('aria-label', 'Product type');
        this.typeSel.addEventListener('change', () => { this.type = this.typeSel.value; this._drawResults(); });
        const only = el('label', 'cal-toggle');
        this.onlyBox = el('input');
        this.onlyBox.type = 'checkbox';
        this.onlyBox.addEventListener('change', () => { this.watchedOnly = this.onlyBox.checked; this._drawResults(); });
        only.append(this.onlyBox, ' Followed only');
        bar.append(label, this.typeSel, only);
        box.appendChild(bar);

        this.following = el('div', 'ps-following');
        box.appendChild(this.following);
        this.status = el('p', 'pc-hint ps-status');
        this.status.setAttribute('role', 'status');
        box.appendChild(this.status);
        this.results = el('div', 'ps-results');
        box.appendChild(this.results);
        this._fillTypes();
        this._drawFollowing();
    }

    _fillTypes() {
        if (!this.typeSel) return;
        this.typeSel.innerHTML = '';
        const all = el('option', '', 'All types');
        all.value = '';
        this.typeSel.appendChild(all);
        (this.catalog ? productTypes(this.catalog) : []).forEach(t => { const o = el('option', '', t); o.value = t; this.typeSel.appendChild(o); });
        this.typeSel.value = this.type;
    }

    _drawFollowing() {
        const box = this.following;
        box.innerHTML = '';
        const watched = getWatchlist();
        box.appendChild(el('span', 'ps-following-label', watched.length ? 'Following' : 'Follow products with the star to keep them at hand: they filter the changelog and fill your calendar.'));
        watched.forEach(p => {
            const c = el('span', 'cal-product');
            c.append(
                button(p, { className: 'cal-product-name', title: `Open ${p}`, onClick: () => this.options.onOpenProduct?.(p) }),
                (() => { const b = button('×', { className: 'cal-product-remove', title: `Unfollow ${p}`, onClick: () => toggleWatched(p) }); b.setAttribute('aria-label', `Unfollow ${p}`); return b; })()
            );
            box.appendChild(c);
        });
    }

    _drawResults() {
        if (!this.catalog) return;
        const watched = new Set(getWatchlist());
        let { total, items } = searchProducts(this.catalog, this.query, { type: this.type, vendor: this.vendor, limit: this.watchedOnly ? Infinity : LIMIT });
        if (this.watchedOnly) { items = items.filter(p => watched.has(p.Product)); total = items.length; }
        const box = this.results;
        box.innerHTML = '';
        this.status.textContent = `${total.toLocaleString('en-US')} product${total === 1 ? '' : 's'}${total > items.length ? `, showing the first ${items.length}` : ''}`;
        if (!items.length) {
            box.appendChild(el('p', 'pc-empty', this.query ? `No product matches “${this.query}”.` : 'No products.'));
            return;
        }
        const table = el('table', 'pc-table ps-table');
        const head = el('thead');
        const hr = el('tr');
        ['', 'Product', 'Name', 'Type', 'Currency', 'ISIN', ''].forEach((t, i) => { const th = el('th', '', t); if (i === 0) th.setAttribute('aria-label', 'Follow'); hr.appendChild(th); });
        head.appendChild(hr);
        table.appendChild(head);
        const body = el('tbody');
        items.forEach(p => {
            const tr = el('tr');
            const on = watched.has(p.Product);
            const star = el('button', 'watch-star', on ? '★' : '☆');
            star.type = 'button';
            star.setAttribute('aria-pressed', String(on));
            star.setAttribute('aria-label', `${on ? 'Unfollow' : 'Follow'} ${p.Product}`);
            star.title = on ? 'On your watchlist' : 'Add to your watchlist';
            star.addEventListener('click', () => toggleWatched(p.Product));
            const c0 = el('td');
            c0.appendChild(star);
            tr.appendChild(c0);
            const code = el('td');
            code.appendChild(button(p.Product, { className: 'ps-open', title: `Open the card of ${p.Product}`, onClick: () => this.options.onOpenProduct?.(p.Product) }));
            tr.appendChild(code);
            [p.Name, p.ProductType, p.Currency, p.ProductISIN].forEach(v => tr.appendChild(el('td', '', v ?? '')));
            const last = el('td');
            last.appendChild(button('Card', { className: 'dt-link', onClick: () => this.options.onOpenProduct?.(p.Product) }));
            tr.appendChild(last);
            body.appendChild(tr);
        });
        table.appendChild(body);
        box.appendChild(table);
        refreshIcons();
    }
}
