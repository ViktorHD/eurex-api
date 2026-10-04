const STATUS_QUERY = `query {
    Holidays { date }
    DeliverableBonds { date }
    TradingHours { date }
    VendorCodes { date }
    SettlementPrices(filter: { Product: { eq: "FESX" } }) { date }
    Enlight { date }
    ProductInfos { date }
    Contracts(filter: { Product: { eq: "FESX" } }) { date }
    TickRules { date }
    EnlightResponders { date }
    FlexibleContracts(filter: { Product: { eq: "FESX" } }) { date }
    Changelog { date }
    Expirations { date }
    TESProfiles { date }
    FesxHolidays: Holidays(filter: { Product: { eq: "FESX" } }) { data { Holiday } }
}`;

// Datasets that change only occasionally: their date is shown but never counted as stale.
const STATIC_DATASETS = new Set(['Changelog', 'DeliverableBonds']);

const DATASET_INFO = {
    Holidays: 'Exchange holidays per product',
    DeliverableBonds: 'Bonds deliverable into fixed income futures',
    TradingHours: 'Trading phases and times per product',
    VendorCodes: 'Data vendor symbols per product',
    SettlementPrices: 'Daily settlement prices (checked for FESX)',
    Enlight: 'Eurex EnLight RFQ configuration',
    ProductInfos: 'Product master data',
    Contracts: 'Listed contracts (checked for FESX)',
    TickRules: 'Tick rules: price steps per price band',
    EnlightResponders: 'Eurex EnLight responders',
    FlexibleContracts: 'Flexible contracts (checked for FESX)',
    Changelog: 'Announced and past API changes',
    Expirations: 'Expiration calendar',
    TESProfiles: 'T7 Entry Service (TES) parameters'
};

const STATUS_NAMES = [
    'Holidays', 'DeliverableBonds', 'TradingHours', 'VendorCodes',
    'SettlementPrices', 'Enlight', 'ProductInfos', 'Contracts',
    'TickRules', 'EnlightResponders', 'FlexibleContracts', 'Changelog',
    'Expirations', 'TESProfiles'
];


import { buildChangelogQuery } from './changelog-query.js?v=2';
import { getWatchlist, onWatchlistChange } from './watchlist.js';
import { buildIcs } from './ics.js';
import { downloadText } from './ui.js';

const DAY = 86400000;
const toUtcDay = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
// Today's date in Eurex time (Frankfurt), not the browser's
export const isoOf = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// Business days (Mon–Fri, minus the given exchange holidays) after `fromIso` up to and including `toIso`;
// 0 when from >= to. holidays: Set of 'YYYY-MM-DD'.
export function businessDaysBetween(fromIso, toIso, holidays = null) {
    let from = toUtcDay(fromIso);
    const to = toUtcDay(toIso);
    let n = 0;
    while (from < to) {
        from += DAY;
        const day = new Date(from);
        const wd = day.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (holidays && holidays.has(day.toISOString().slice(0, 10))) continue;
        n++;
    }
    return n;
}

// 'ok' (current), 'stale' (older than the last business day), 'static' (reference data) or 'error' (no data).
// On weekends and exchange holidays the last business day's data counts as current.
export function datasetState(name, dateIso, todayIso, holidays = null) {
    if (!dateIso) return 'error';
    if (STATIC_DATASETS.has(name)) return 'static';
    return businessDaysBetween(dateIso, todayIso, holidays) === 0 ? 'ok' : 'stale';
}

export function summarizeStatus(states) {
    const count = (s) => states.filter(x => x === s).length;
    const stale = count('stale');
    const error = count('error');
    const current = states.length - stale - error;
    let level = 'ok';
    if (error) level = 'error';
    else if (stale) level = 'stale';
    const parts = [];
    if (stale) parts.push(`${stale} stale`);
    if (error) parts.push(`${error} unavailable`);
    return {
        level,
        current,
        total: states.length,
        title: level === 'ok' ? 'All datasets are up to date' : `${current} of ${states.length} datasets up to date`,
        detail: parts.join(' · ')
    };
}

// "today", "tomorrow", "in 17 days", "3 days ago", ...
export function relativeDay(dateIso, todayIso) {
    const diff = Math.round((toUtcDay(dateIso) - toUtcDay(todayIso)) / DAY);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

// Badge colour family for a changelog type
export function changeKind(type) {
    const t = String(type || '').toLowerCase();
    if (/deprecat|remov|delet|discontinu/.test(t)) return 'removal';
    if (/new|add/.test(t)) return 'addition';
    return 'change';
}

const icon = (name) => {
    const i = document.createElement('i');
    i.setAttribute('data-feather', name);
    i.setAttribute('aria-hidden', 'true');
    return i;
};
const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
};

// Product codes of `products` that an entry talks about (description, old / new value, affected query)
export function productsMentioned(entry, products) {
    if (!products || !products.length) return [];
    const words = new Set(String([entry.Description, entry.OldValue, entry.NewValue, entry.Query].filter(Boolean).join(' ')).toUpperCase().match(/[A-Z0-9_-]+/g) || []);
    return products.filter(p => words.has(p));
}

// All-day calendar events for changelog entries that have a valid date
export function changelogEvents(entries) {
    return entries
        .filter(e => /^\d{4}-\d{2}-\d{2}/.test(String(e.Date || '')))
        .map((e, i) => {
            const text = String(e.Description || '').replace(/\s+/g, ' ').trim();
            const lines = [e.Description, e.OldValue && `Old: ${e.OldValue}`, e.NewValue && `New: ${e.NewValue}`, e.Query && `Affected query: ${e.Query}`].filter(Boolean);
            return {
                uid: `changelog-${String(e.Date).slice(0, 10)}-${i}`,
                date: String(e.Date).slice(0, 10),
                summary: `Eurex API: ${e.Type || 'Change'}${text ? ' - ' + (text.length > 70 ? text.slice(0, 67) + '...' : text) : ''}`,
                description: lines.join('\n')
            };
        });
}

export class InfoPanel {
    constructor(client, elements, options = {}) {
        this.client = client;
        this.els = elements; // { panel, statusGrid, statusSummary, changelogContent, changelogFilters, changelogLoading, closeBtn, refreshBtn }
        this.options = options; // { onRunQuery, onClose, getSchema }
        this.changelogData = null;
        this.typeFilter = 'all';
        this.searchText = '';
        this.showPast = true;
        this.onlyWatched = false;

        this.bindEvents();
        // Follow / unfollow a product elsewhere: the "My products" filter and its count change
        onWatchlistChange(() => { if (this.changelogData) this.renderChangelog(); });
    }

    bindEvents() {
        if (this.els.closeBtn) {
            this.els.closeBtn.addEventListener('click', () => {
                if (this.options.onClose) this.options.onClose();
                else this.els.panel.classList.add('hidden');
            });
        }

        if (this.els.refreshBtn) {
            this.els.refreshBtn.addEventListener('click', () => this.load({ fresh: true }));
        }
    }

    _today() {
        return isoOf(new Date());
    }

    async load(options = {}) {
        await Promise.all([
            this.loadStatus(options),
            this.loadChangelog(options)
        ]);
    }

    async loadStatus(options = {}) {
        this._setContent(this.els.statusGrid, 'loading', 'Checking API status…');
        if (this.els.statusSummary) {
            this.els.statusSummary.className = 'status-summary checking';
            this.els.statusSummary.textContent = 'Checking datasets…';
        }

        try {
            const data = await this.client.request(STATUS_QUERY, null, false, { fresh: !!options.fresh });
            const today = this._today();
            // FESX holidays stand for the Eurex calendar; without them only weekends are skipped
            const holidays = new Set((data?.FesxHolidays?.data || []).map(h => String(h.Holiday || '').slice(0, 10)).filter(Boolean));

            this.els.statusGrid.innerHTML = '';
            // Datasets needing attention first: unavailable, then stale (oldest first), then current, then reference
            const rank = { error: 0, stale: 1, ok: 2, static: 3 };
            const rows = STATUS_NAMES.map(name => {
                const date = data?.[name]?.date ?? null;
                return { name, date, state: datasetState(name, date, today, holidays) };
            }).sort((a, b) => rank[a.state] - rank[b.state] || String(a.date || '').localeCompare(String(b.date || '')) || a.name.localeCompare(b.name));
            const states = rows.map(r => r.state);
            rows.forEach(({ name, date, state }) => {

                const card = el('div', `status-card ${state}`);
                card.title = DATASET_INFO[name] || name;
                card.appendChild(el('span', 'status-dot'));

                const info = el('div', 'status-info');
                info.appendChild(el('span', 'status-name', name));
                info.appendChild(el('span', 'status-desc', DATASET_INFO[name] || ''));
                card.appendChild(info);

                const meta = el('div', 'status-meta');
                let label;
                if (state === 'error') label = 'No data';
                else if (state === 'static') label = 'Reference';
                else if (state === 'ok') label = 'Current';
                else {
                    const age = businessDaysBetween(date, today, holidays);
                    label = `${age} business day${age === 1 ? '' : 's'} old`;
                }
                meta.appendChild(el('span', `status-chip ${state}`, label));
                meta.appendChild(el('span', 'status-date', date ? formatDate(date) : '–'));
                card.appendChild(meta);
                this.els.statusGrid.appendChild(card);
            });

            this._renderSummary(summarizeStatus(states));
        } catch (err) {
            this._setContent(this.els.statusGrid, 'error', err.message);
            if (this.els.statusSummary) {
                this.els.statusSummary.className = 'status-summary error';
                this.els.statusSummary.textContent = 'Status could not be loaded';
            }
        }
        if (window.feather) window.feather.replace();
    }

    _renderSummary(summary) {
        const box = this.els.statusSummary;
        if (!box) return;
        box.className = `status-summary ${summary.level}`;
        box.innerHTML = '';
        box.appendChild(icon(summary.level === 'ok' ? 'check-circle' : summary.level === 'stale' ? 'clock' : 'alert-triangle'));
        const text = el('div', 'status-summary-text');
        text.appendChild(el('strong', '', summary.title));
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        text.appendChild(el('span', '', [summary.detail, `checked ${time}`].filter(Boolean).join(' · ')));
        box.appendChild(text);
    }

    async loadChangelog(options = {}) {
        if (this.els.changelogLoading) this.els.changelogLoading.classList.remove('hidden');
        if (this.els.changelogContent) this.els.changelogContent.innerHTML = '';

        const query = `
        query {
          Changelog {
            data {
              Date
              Type
              OldValue
              NewValue
              Description
              Query
            }
          }
        }
        `;

        try {
            const response = await this.client.request(query, null, false, { fresh: !!options.fresh });
            if (!response || !response.Changelog || !response.Changelog.data) {
                throw new Error("No changelog data found.");
            }

            this.changelogData = response.Changelog.data;
            // The schema tells which query each entry affects and which fields it has
            this.schema = null;
            this._queryCache = new Map();
            if (this.options.getSchema) {
                try { this.schema = await this.options.getSchema(); } catch (e) { this.schema = null; }
            }
            this.renderChangelog();
        } catch (err) {
            if (this.els.changelogFilters) this.els.changelogFilters.innerHTML = '';
            if (this.els.changelogContent) this._setContent(this.els.changelogContent, 'error', err.message);
        } finally {
            if (this.els.changelogLoading) this.els.changelogLoading.classList.add('hidden');
        }
    }

    _renderFilters(entries) {
        const box = this.els.changelogFilters;
        if (!box) return;
        box.innerHTML = '';

        const search = el('label', 'cl-search');
        search.appendChild(icon('search'));
        const input = el('input');
        input.type = 'search';
        input.placeholder = 'Search changes';
        input.setAttribute('aria-label', 'Search changelog');
        input.value = this.searchText;
        input.addEventListener('input', () => {
            this.searchText = input.value;
            this._renderEntries();
        });
        search.appendChild(input);
        box.appendChild(search);

        const types = new Map();
        entries.forEach(e => types.set(e.Type || 'Other', (types.get(e.Type || 'Other') || 0) + 1));
        const chips = el('div', 'cl-chips');
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'Filter by change type');
        const mkChip = (value, label, count, kind) => {
            const b = el('button', `cl-chip${kind ? ' ' + kind : ''}${this.typeFilter === value ? ' active' : ''}`);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(this.typeFilter === value));
            b.append(label);
            b.appendChild(el('span', 'cl-chip-count', String(count)));
            b.addEventListener('click', () => {
                this.typeFilter = value;
                this._renderFilters(entries);
                this._renderEntries();
            });
            chips.appendChild(b);
        };
        mkChip('all', 'All', entries.length);
        [...types.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => mkChip(t, t, n, changeKind(t)));
        box.appendChild(chips);

        const watched = getWatchlist();
        const actions = el('div', 'cl-chips');
        if (watched.length) {
            const mine = entries.filter(e => productsMentioned(e, watched).length).length;
            const b = el('button', `cl-chip watch${this.onlyWatched ? ' active' : ''}`);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(this.onlyWatched));
            b.title = `Changes that mention ${watched.join(', ')}`;
            b.append('★ My products');
            b.appendChild(el('span', 'cl-chip-count', String(mine)));
            b.addEventListener('click', () => {
                this.onlyWatched = !this.onlyWatched;
                this._renderFilters(entries);
                this._renderEntries();
            });
            actions.appendChild(b);
        }
        const ics = el('button', 'cl-chip');
        ics.type = 'button';
        ics.title = 'Download the upcoming changes shown here as a calendar file (.ics)';
        ics.appendChild(icon('calendar'));
        ics.append(' Add upcoming to calendar');
        ics.addEventListener('click', () => this._downloadIcs());
        this._icsBtn = ics;
        actions.appendChild(ics);
        box.appendChild(actions);
        if (window.feather) window.feather.replace();
    }

    renderChangelog() {
        if (!this.changelogData || !this.els.changelogContent) return;
        this._renderFilters(this.changelogData);
        this._renderEntries();
    }

    // Entries after the type, search and "My products" filters, newest first
    _visibleEntries() {
        const q = this.searchText.trim().toLowerCase();
        const watched = this.onlyWatched ? getWatchlist() : null;
        return [...this.changelogData]
            .filter(e => this.typeFilter === 'all' || (e.Type || 'Other') === this.typeFilter)
            .filter(e => !q || [e.Date, e.Type, e.Description, e.OldValue, e.NewValue, e.Query].some(v => String(v || '').toLowerCase().includes(q)))
            .filter(e => !watched || productsMentioned(e, watched).length)
            .sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
    }

    _downloadIcs() {
        const today = this._today();
        const upcoming = this._visibleEntries().filter(e => String(e.Date).slice(0, 10) > today);
        if (!upcoming.length) return;
        downloadText(buildIcs(changelogEvents(upcoming), { name: 'Eurex API changes' }), 'eurex-api-changes.ics', 'text/calendar');
    }

    _renderEntries() {
        const container = this.els.changelogContent;
        container.innerHTML = '';
        const today = this._today();

        const entries = this._visibleEntries();
        if (this._icsBtn) {
            const n = entries.filter(e => String(e.Date).slice(0, 10) > today).length;
            this._icsBtn.disabled = n === 0;
            this._icsBtn.title = n ? `Download the ${n} upcoming change${n === 1 ? '' : 's'} shown here as a calendar file (.ics)` : 'No upcoming changes in the current view';
        }

        if (!entries.length) {
            this._setContent(container, 'empty', 'No changes match the current filter.');
            return;
        }

        const upcoming = entries.filter(e => String(e.Date).slice(0, 10) > today).reverse(); // soonest first
        const past = entries.filter(e => String(e.Date).slice(0, 10) <= today);

        const section = (title, list, kind) => {
            if (!list.length) return;
            const sec = el('section', `cl-section ${kind}`);
            const h = el('h4', 'cl-section-title', title);
            h.appendChild(el('span', 'cl-chip-count', String(list.length)));
            sec.appendChild(h);
            list.forEach(e => sec.appendChild(this._renderEntry(e, today, kind)));
            container.appendChild(sec);
        };
        section('Upcoming', upcoming, 'upcoming');
        section('Past changes', past, 'past');
        if (window.feather) window.feather.replace();
    }

    _renderEntry(entry, today, kind) {
        const item = el('article', `cl-item ${kind}`);

        const date = el('div', 'cl-date');
        date.appendChild(el('strong', '', formatDate(entry.Date)));
        date.appendChild(el('span', '', relativeDay(entry.Date, today)));
        item.appendChild(date);

        const body = el('div', 'cl-body');
        const head = el('div', 'cl-head');
        head.appendChild(el('span', `cl-badge ${changeKind(entry.Type)}`, entry.Type || 'Change'));
        body.appendChild(head);

        if (entry.Description) body.appendChild(el('p', 'cl-desc', entry.Description));

        if (entry.OldValue || entry.NewValue) {
            const diff = el('div', 'cl-diff');
            if (entry.OldValue) {
                const row = el('div', 'cl-diff-row old');
                row.appendChild(el('span', 'cl-diff-label', 'Old'));
                row.appendChild(el('code', '', entry.OldValue));
                diff.appendChild(row);
            }
            if (entry.NewValue) {
                const row = el('div', 'cl-diff-row new');
                row.appendChild(el('span', 'cl-diff-label', 'New'));
                row.appendChild(el('code', '', entry.NewValue));
                diff.appendChild(row);
            }
            body.appendChild(diff);
        }

        const built = this._resolveQuery(entry);
        if (entry.Query) {
            const roots = built?.roots?.length ? built.roots.join(', ') : String(entry.Query).trim();
            const affects = el('span', 'cl-affects');
            affects.appendChild(el('span', 'cl-affects-label', 'Affects'));
            affects.appendChild(el('code', '', roots));
            head.appendChild(affects);
        }
        // Offer to run only when the affected query is known
        if (built) {
            const actions = el('div', 'cl-actions');
            const run = el('button', 'cl-btn primary');
            run.type = 'button';
            run.title = `Run ${built.roots?.join(', ') || 'query'} in the API Explorer`;
            run.appendChild(icon('play'));
            run.append(' Run in Explorer');
            run.addEventListener('click', () => { if (this.options.onRunQuery) this.options.onRunQuery(built.query); });

            const toggle = el('button', 'cl-btn');
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.appendChild(icon('code'));
            toggle.append(' Show query');
            const pre = el('pre', 'cl-query hidden');
            pre.appendChild(el('code', '', built.query));
            toggle.addEventListener('click', () => {
                const open = pre.classList.toggle('hidden') === false;
                toggle.setAttribute('aria-expanded', String(open));
                toggle.lastChild.textContent = open ? ' Hide query' : ' Show query';
            });
            actions.append(run, toggle);
            body.append(actions, pre);
        }

        item.appendChild(body);
        return item;
    }

    // Runnable query for a changelog entry, or null when the affected query can't be determined; cached per entry.
    _resolveQuery(entry) {
        if (!this._queryCache) this._queryCache = new Map();
        if (!this._queryCache.has(entry)) this._queryCache.set(entry, buildChangelogQuery(entry, this.schema || null));
        return this._queryCache.get(entry);
    }

    _setContent(el, type, text) {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = type === 'loading' ? 'info-loading'
            : type === 'error' ? 'info-error'
            : 'info-empty';
        p.textContent = text;
        el.appendChild(p);
    }
}
