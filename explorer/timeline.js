import { resolveTz, nowIn, timeToMinutes, inRange, cetDate, getStatus, nextHoliday, buildHolidayMap, STATUS_LABELS } from './tradingstatus.js';
import { getWatchlist, toggleWatched, onWatchlistChange } from './watchlist.js';

export class TimelineManager {
    constructor(client, els) {
        this.client = client;
        this.els = els; // { container, content, loading, timezoneSelect, refreshBtn, filterInput }
        this.data = null;
        this.holidays = new Map(); // Product -> sorted ISO dates on which it does not trade
        this.timezone = 'CET'; // Default
        this.filterText = '';
        this.tooltip = this._createTooltip();
        this.tooltipTimer = null;
        this.expandedGroups = new Set();
        this.watchOnly = false; // only products on the watchlist

        this.bindEvents();
        onWatchlistChange(() => { if (this.data) this.render(); });
        // Keep the "now" line and open/closed status current while the view is open
        this.nowTimer = setInterval(() => this._updateNow(), 60 * 1000);
    }

    bindEvents() {
        this.els.timezoneSelect.addEventListener('change', () => {
            this.timezone = this.els.timezoneSelect.value;
            this.render();
        });
        this.els.refreshBtn.addEventListener('click', () => this.fetchAndRender({ fresh: true }));
        if (this.els.filterInput) {
            this.els.filterInput.addEventListener('input', (e) => {
                this.filterText = e.target.value.trim().toLowerCase();
                this.render();
            });
        }
        if (this.els.watchOnlyBtn) {
            this.els.watchOnlyBtn.addEventListener('click', () => {
                this.watchOnly = !this.watchOnly;
                this._syncWatchBtn();
                this.render();
            });
        }
        if (this.els.expandAllBtn) {
            this.els.expandAllBtn.addEventListener('click', () => {
                if (!this.data) return;
                const names = Object.keys(this.data);
                const allOpen = names.every(n => this.expandedGroups.has(n));
                this.expandedGroups = allOpen ? new Set() : new Set(names);
                this.render();
            });
        }
    }

    _syncWatchBtn() {
        const b = this.els.watchOnlyBtn;
        if (!b) return;
        b.classList.toggle('active', this.watchOnly);
        b.setAttribute('aria-pressed', String(this.watchOnly));
    }

    // View settings for share links, and applying them
    getState() {
        return { tz: this.timezone, f: this.filterText, w: this.watchOnly };
    }

    setState(state = {}) {
        if (state.tz && Array.from(this.els.timezoneSelect.options).some(o => o.value === state.tz)) {
            this.timezone = state.tz;
            this.els.timezoneSelect.value = state.tz;
        }
        this.filterText = String(state.f || '').trim().toLowerCase();
        if (this.els.filterInput) this.els.filterInput.value = state.f || '';
        this.watchOnly = !!state.w;
        this._syncWatchBtn();
        if (this.data) this.render();
    }

    _createTooltip() {
        const div = document.createElement('div');
        div.className = 'timeline-tooltip hidden';
        document.body.appendChild(div);
        return div;
    }

    // options.fresh: bypass the response cache (the Refresh button)
    async fetchAndRender(options = {}) {
        this.els.loading.classList.remove('hidden');
        this.els.content.innerHTML = '';

        const query = `
        query {
          ProductInfos {
            data {
              ProductID
              Product
              ProductType
              Name
            }
          }
          Holidays {
            data {
              Product
              Holiday
            }
          }
          TradingHours {
            data {
              ProductID
              Product
              StartContinuousTrading
              EndContinuousTrading
              StartTES
              EndTES
              EndOpeningAuction
              EndClosingAuction
              LTDBook
              LTDTES
            }
          }
        }
        `;

        try {
            const response = await this.client.request(query, null, false, { fresh: options.fresh === true });
            if (response.errors) throw new Error(response.errors[0].message);

            const products = response.ProductInfos?.data;
            const hours = response.TradingHours?.data;
            if (!products || !hours) {
                // Both are needed; the API reports why in partialErrors
                throw new Error(`Trading hours could not be loaded${response.partialErrors ? ': ' + response.partialErrors.join('; ') : '.'}`);
            }

            // Holidays are optional: without them the status simply ignores them
            this.holidays = this.buildHolidayMap(response.Holidays?.data);
            this.holidaysUnavailable = !response.Holidays?.data;

            const joined = this.joinHours(products, hours);

            // Group by ProductType
            this.data = joined.reduce((acc, curr) => {
                if (!acc[curr.ProductType]) acc[curr.ProductType] = [];
                acc[curr.ProductType].push(curr);
                return acc;
            }, {});

            this.render();
            this._scrollToNow();
        } catch (err) {
            this.els.content.innerHTML = '';
            const card = document.createElement('div');
            card.className = 'error-card';
            const msg = document.createElement('p');
            msg.textContent = err.message;
            card.appendChild(msg);
            this.els.content.appendChild(card);
        } finally {
            this.els.loading.classList.add('hidden');
        }
    }

    // Hours per product, joined on ProductID when both sides have it (Product code otherwise).
    // A product with several hour sets keeps all of them in `allHours`; `hours` is the first one.
    joinHours(products, hours) {
        const keyOf = (row, useId) => (useId && row.ProductID != null ? `id:${row.ProductID}` : `code:${row.Product}`);
        const useId = products.some(p => p.ProductID != null) && hours.some(h => h.ProductID != null);
        const byKey = new Map();
        hours.forEach(h => {
            const key = keyOf(h, useId);
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(h);
        });
        return products
            .map(p => {
                const list = byKey.get(keyOf(p, useId)) || byKey.get(`code:${p.Product}`) || [];
                return { ...p, hours: list[0] || null, allHours: list };
            })
            .filter(p => p.hours);
    }

    buildHolidayMap(rows) { return buildHolidayMap(rows); }

    _cetDate(now = new Date()) { return cetDate(now); }

    _timeToMinutes(timeStr) { return timeToMinutes(timeStr); }

    _convertTime(timeStr, fromTz, toTz) {
        if (!timeStr) return null;

        // Assume date is today
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const dtStr = `${dateStr}T${timeStr}`;

        // Create a date object interpreting the time as being in fromTz
        // Since JS Date usually works in Local or UTC, we need a trick.

        let tzStr;
        if (fromTz === 'CET') tzStr = 'Europe/Berlin';
        else if (fromTz === 'UTC') tzStr = 'UTC';
        else tzStr = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Formatter for the source timezone to find its offset
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tzStr,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });

        // This is complex in pure JS. Let's simplify:
        // Eurex times are CET.
        // We calculate the offset between CET and Target TZ for "now".

        const getOffset = (tz) => {
            const d = new Date();
            const s = d.toLocaleString('en-US', { timeZone: tz, hour12: false });
            const [date, time] = s.split(', ');
            const [m, day, y] = date.split('/');
            const [h, min, sec] = time.split(':');
            const dTZ = new Date(Date.UTC(y, m-1, day, h === '24' ? 0 : h, min, sec));
            return (dTZ.getTime() - Date.UTC(y, m-1, day, h === '24' ? 0 : h, min, sec)) / (60 * 1000);
            // Wait, this is getting messy.
        };

        // Better approach:
        const d = new Date(`${dateStr}T${timeStr}Z`); // Temporary UTC date
        // We want to know what time it would be in toTz if it's currently timeStr in fromTz.

        // Let's use a simpler way for the specific cases:
        // Input is always CET.
        let targetTz = toTz;
        if (targetTz === 'LOCAL') targetTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (targetTz === 'CET') targetTz = 'Europe/Berlin';
        if (targetTz === 'UTC') targetTz = 'UTC';
        if (targetTz === 'SGT') targetTz = 'Asia/Singapore';
        if (targetTz === 'CST') targetTz = 'America/Chicago';

        // 1. Parse timeStr as CET
        const cetFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric'});

        // We need a Date object that represents timeStr in Europe/Berlin
        // Hack: find a date that when formatted to Europe/Berlin gives timeStr
        let testDate = new Date();
        const [th, tm, ts] = timeStr.split(':').map(Number);
        testDate.setHours(th, tm, ts, 0);

        // Adjust for the difference between Local and Berlin
        const berlinStr = testDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour12: false });
        const localStr = testDate.toLocaleString('en-US', { hour12: false });

        // This is still fragile. Let's just do a simple shift based on current offsets.
        const berlinOffset = this._getOffsetMinutes('Europe/Berlin');
        const targetOffset = this._getOffsetMinutes(targetTz);

        const diff = targetOffset - berlinOffset;
        let [h, min] = timeStr.split(':').map(Number);
        let totalMin = h * 60 + min + diff;

        // Wrap around 24h
        totalMin = (totalMin + 1440) % 1440;

        const rh = Math.floor(totalMin / 60);
        const rm = totalMin % 60;
        return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
    }

    _getOffsetMinutes(tz) {
        const d = new Date();
        const localDate = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(d.toLocaleString('en-US', { timeZone: tz }));
        return (tzDate - localDate) / 60000;
    }

    _resolveTz(tz) { return resolveTz(tz); }

    // Current wall-clock time in a timezone: { minutes, weekday (0 = Sunday) }
    _nowIn(tz, now = new Date()) { return nowIn(tz, now); }

    _inRange(mins, start, end) { return inRange(mins, start, end); }

    // Trading status of a product right now, based on Eurex (CET) hours: 'open', 'tes', 'closed' or 'holiday'.
    getStatus(hours, now = new Date(), holidays = null) { return getStatus(hours, now, holidays); }

    nextHoliday(holidays, now = new Date()) { return nextHoliday(holidays, now); }

    _statusFor(product, now = new Date()) {
        const hours = product?.allHours?.length ? product.allHours : product?.hours;
        const holidays = this.holidays.get(product?.Product) || null;
        return { status: getStatus(hours, now, holidays), next: nextHoliday(holidays, now) };
    }

    _formatDuration(startMin, endMin) {
        const d = (endMin - startMin + 1440) % 1440;
        const h = Math.floor(d / 60);
        const m = d % 60;
        return m ? `${h}h ${m}m` : `${h}h`;
    }

    _updateNow() {
        if (!this.data || !this.els.content.isConnected) return;
        const { minutes } = this._nowIn(this.timezone);
        const left = `${(minutes / 1440) * 100}%`;
        this.els.content.querySelectorAll('.timeline-now').forEach(el => { el.style.left = left; });
        const pill = this.els.content.querySelector('.timeline-now-pill');
        if (pill) {
            pill.style.left = left;
            pill.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        }
        this.els.content.querySelectorAll('[data-status-for]').forEach(dot => {
            const product = dot.getAttribute('data-status-for');
            this._applyStatus(dot, this._statusFor(this._productsByCode?.get(product)));
        });
    }

    _applyStatus(dot, { status, next }) {
        const text = STATUS_LABELS[status] + (next ? `. Next holiday: ${next}` : '');
        dot.className = `timeline-status status-${status}`;
        dot.title = text;
        dot.setAttribute('aria-label', text);
    }

    // On narrow screens the 24h axis overflows: bring the current time into view
    _scrollToNow() {
        const c = this.els.container;
        if (!c || c.scrollWidth <= c.clientWidth) return;
        const line = this.els.content.querySelector('.timeline-bar-container .timeline-now');
        const label = this.els.content.querySelector('.timeline-corner-label');
        if (!line || !label) return;
        const labelW = label.getBoundingClientRect().width;
        const x = line.offsetLeft + line.parentElement.offsetLeft - labelW;
        c.scrollLeft = Math.max(0, x - (c.clientWidth - labelW) / 2);
    }

    _addNowLine(container) {
        const line = document.createElement('div');
        line.className = 'timeline-now';
        line.setAttribute('aria-hidden', 'true');
        container.appendChild(line);
    }

    render() {
        if (!this.data) return;

        this._productsByCode = new Map();
        Object.values(this.data).flat().forEach(p => this._productsByCode.set(p.Product, p));

        this.els.content.innerHTML = '';

        if (this.holidaysUnavailable) {
            const notice = document.createElement('div');
            notice.className = 'timeline-notice';
            notice.setAttribute('role', 'status');
            notice.textContent = 'The holiday calendar could not be loaded, so open / closed status ignores exchange holidays.';
            this.els.content.appendChild(notice);
        }

        // Header row
        const headerRow = document.createElement('div');
        headerRow.className = 'timeline-header-row';

        const corner = document.createElement('div');
        corner.className = 'timeline-corner-label';
        const tzLabel = this.els.timezoneSelect.selectedOptions?.[0]?.textContent || this.timezone;
        corner.textContent = `Product · ${tzLabel}`;
        headerRow.appendChild(corner);

        const grid = document.createElement('div');
        grid.className = 'timeline-grid';

        // Add markers and labels
        for (let i = 0; i <= 24; i += 2) {
            const pos = `${(i / 24) * 100}%`;

            const marker = document.createElement('div');
            marker.className = 'timeline-hour-marker';
            marker.style.left = pos;
            grid.appendChild(marker);

            const label = document.createElement('div');
            label.className = 'timeline-hour-label';
            label.style.left = pos;
            if (i === 0) label.style.transform = 'translateX(4px)';
            else if (i === 24) label.style.transform = 'translateX(-100%)';
            label.textContent = `${String(i).padStart(2, '0')}:00`;
            grid.appendChild(label);
        }
        const nowPill = document.createElement('div');
        nowPill.className = 'timeline-now-pill';
        nowPill.title = 'Current time';
        grid.appendChild(nowPill);
        headerRow.appendChild(grid);
        this.els.content.appendChild(headerRow);

        const groupNames = Object.keys(this.data).sort();
        let shown = 0;
        groupNames.forEach(name => {
            let group = this.data[name];

            if (this.watchOnly) {
                const watched = new Set(getWatchlist());
                group = group.filter(p => watched.has(p.Product));
            }

            // Apply filtering (product code, name or product type)
            if (this.filterText) {
                const f = this.filterText;
                const typeMatch = name.toLowerCase().includes(f);
                group = group.filter(p => typeMatch || p.Product.toLowerCase().includes(f) || (p.Name || '').toLowerCase().includes(f));
            }

            if (group.length === 0) return;
            shown += group.length;

            const isExpanded = this.expandedGroups.has(name) || this.filterText !== '' || this.watchOnly;

            // Representing the group as a whole
            if (!this.filterText && !this.watchOnly) {
                this._renderGroupRow(this.els.content, name, group, isExpanded);
            }

            if (isExpanded) {
                const details = document.createElement('div');
                details.className = 'group-details';
                group.forEach(p => {
                    this._renderProductDetails(details, p);
                });
                this.els.content.appendChild(details);
            }
        });

        if (shown === 0) {
            const empty = document.createElement('div');
            empty.className = 'timeline-empty';
            empty.textContent = this.watchOnly && !getWatchlist().length
                ? 'Your watchlist is empty. Follow products with the star (here or in Products).'
                : this.filterText ? `No products match "${this.filterText}".` : this.watchOnly ? 'None of your watchlist products has trading hours.' : 'No trading hours available.';
            this.els.content.appendChild(empty);
        }

        if (this.els.expandAllBtn) {
            const allOpen = groupNames.every(n => this.expandedGroups.has(n));
            this.els.expandAllBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
            this.els.expandAllBtn.disabled = this.filterText !== '' || this.watchOnly;
        }

        this._updateNow();
        if (window.feather) window.feather.replace();
    }

    _renderGroupRow(parent, name, group, isExpanded) {
        const row = document.createElement('div');
        row.className = 'timeline-row timeline-group-row';
        const toggle = () => {
            if (this.expandedGroups.has(name)) this.expandedGroups.delete(name);
            else this.expandedGroups.add(name);
            this.render();
            this.els.content.querySelector(`[data-group="${CSS.escape(name)}"]`)?.focus();
        };
        row.addEventListener('click', toggle);

        const label = document.createElement('div');
        label.className = 'timeline-product-label group-label';
        label.setAttribute('role', 'button');
        label.setAttribute('tabindex', '0');
        label.setAttribute('aria-expanded', String(isExpanded));
        label.setAttribute('data-group', name);
        label.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });

        const chevron = document.createElement('i');
        chevron.setAttribute('data-feather', isExpanded ? 'chevron-down' : 'chevron-right');
        chevron.className = 'timeline-chevron';
        label.appendChild(chevron);

        const labelSpan = document.createElement('span');
        labelSpan.textContent = name;
        label.appendChild(labelSpan);

        const count = document.createElement('span');
        count.className = 'timeline-count';
        count.textContent = group.length;
        label.appendChild(count);

        label.title = `${name} (${group.length} products): click to ${isExpanded ? 'collapse' : 'expand'}`;
        row.appendChild(label);

        const barContainer = document.createElement('div');
        barContainer.className = 'timeline-bar-container';

        let globalMin = null;
        let globalMax = null;
        let minStartStr = null;
        let maxEndStr = null;

        group.forEach(p => {
            if (!p.hours) return;
            const fields = ['StartContinuousTrading', 'EndContinuousTrading', 'StartTES', 'EndTES'];
            fields.forEach(f => {
                const val = p.hours[f];
                if (val) {
                    const mins = this._timeToMinutes(val);
                    if (mins !== null) {
                        if (globalMin === null || mins < globalMin) {
                            globalMin = mins;
                            minStartStr = val;
                        }
                        if (globalMax === null || mins > globalMax) {
                            globalMax = mins;
                            maxEndStr = val;
                        }
                    }
                }
            });
        });

        if (minStartStr && maxEndStr) {
            this._addPhaseToContainer(barContainer, {
                start: minStartStr,
                end: maxEndStr,
                type: 'range',
                label: 'Earliest start to latest end'
            });
        }
        this._addNowLine(barContainer);

        row.appendChild(barContainer);
        parent.appendChild(row);
    }

    _renderProductDetails(parent, product) {
        // Main row with Product name and CLOB
        const clobRow = document.createElement('div');
        clobRow.className = 'timeline-row';

        const label = document.createElement('div');
        label.className = 'timeline-product-label product-label';
        label.title = `${product.Product}: ${product.Name}`;

        const dot = document.createElement('span');
        dot.setAttribute('data-status-for', product.Product);
        dot.setAttribute('role', 'img');
        this._applyStatus(dot, this._statusFor(product));
        label.appendChild(dot);

        const code = document.createElement('strong');
        code.textContent = product.Product;
        label.appendChild(code);

        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'watch-star';
        const watched = getWatchlist().includes(product.Product);
        star.textContent = watched ? '★' : '☆';
        star.setAttribute('aria-pressed', String(watched));
        star.setAttribute('aria-label', `${watched ? 'Unfollow' : 'Follow'} ${product.Product}`);
        star.title = watched ? 'On your watchlist' : 'Add to your watchlist';
        star.addEventListener('click', (e) => { e.stopPropagation(); toggleWatched(product.Product); });
        label.appendChild(star);

        const nameEl = document.createElement('span');
        nameEl.className = 'timeline-product-name';
        nameEl.textContent = product.Name || '';
        label.appendChild(nameEl);
        clobRow.appendChild(label);

        const clobContainer = document.createElement('div');
        clobContainer.className = 'timeline-bar-container';

        if (product.hours) {
            // CLOB Phases: Opening Auction, Continuous Trading, Closing Auction
            const phases = [];

            // Opening Auction: from StartContinuousTrading to EndOpeningAuction
            if (product.hours.StartContinuousTrading && product.hours.EndOpeningAuction) {
                phases.push({ start: product.hours.StartContinuousTrading, end: product.hours.EndOpeningAuction, type: 'opening', label: 'Opening Auction' });
            }

            // Continuous Trading: from StartContinuousTrading to EndContinuousTrading
            if (product.hours.StartContinuousTrading && product.hours.EndContinuousTrading) {
                phases.push({ start: product.hours.StartContinuousTrading, end: product.hours.EndContinuousTrading, type: 'continuous', label: 'Continuous Trading' });
            }

            // Closing Auction: from EndContinuousTrading to EndClosingAuction
            if (product.hours.EndContinuousTrading && product.hours.EndClosingAuction) {
                phases.push({ start: product.hours.EndContinuousTrading, end: product.hours.EndClosingAuction, type: 'closing', label: 'Closing Auction' });
            }

            phases.forEach(p => this._addPhaseToContainer(clobContainer, p));

            // LTD Book Marker
            if (product.hours.LTDBook) {
                this._addMarkerToContainer(clobContainer, product.hours.LTDBook, 'ltd-book', 'Last trading day: book closes');
            }
        }
        this._addNowLine(clobContainer);

        clobRow.appendChild(clobContainer);
        parent.appendChild(clobRow);

        // TES Row
        const tesRow = document.createElement('div');
        tesRow.className = 'timeline-row sub-row';

        const tesLabel = document.createElement('div');
        tesLabel.className = 'timeline-product-label';
        tesLabel.textContent = 'TES';
        tesLabel.title = 'T7 Entry Service (off-book trades)';
        tesRow.appendChild(tesLabel);

        const tesContainer = document.createElement('div');
        tesContainer.className = 'timeline-bar-container';

        if (product.hours) {
            if (product.hours.StartTES && product.hours.EndTES) {
                this._addPhaseToContainer(tesContainer, { start: product.hours.StartTES, end: product.hours.EndTES, type: 'tes', label: 'TES' });
            }
            // LTD TES Marker
            if (product.hours.LTDTES) {
                this._addMarkerToContainer(tesContainer, product.hours.LTDTES, 'ltd-tes', 'Last trading day: TES closes');
            }
        }
        this._addNowLine(tesContainer);

        tesRow.appendChild(tesContainer);
        parent.appendChild(tesRow);
    }

    _addPhaseToContainer(container, phase) {
        if (phase.start && phase.end) {
            const startConverted = this._convertTime(phase.start, 'CET', this.timezone);
            const endConverted = this._convertTime(phase.end, 'CET', this.timezone);

            const startMin = this._timeToMinutes(startConverted);
            const endMin = this._timeToMinutes(endConverted);

            if (startMin !== null && endMin !== null) {
                const bar = document.createElement('div');
                bar.className = `timeline-bar bar-${phase.type}`;

                let left, width;
                if (endMin >= startMin) {
                    left = (startMin / 1440) * 100;
                    width = ((endMin - startMin) / 1440) * 100;
                } else {
                    // Spans across midnight
                    left = (startMin / 1440) * 100;
                    width = ((1440 - startMin) / 1440) * 100;

                    // Add second bar for the wrap around
                    const bar2 = document.createElement('div');
                    bar2.className = `timeline-bar bar-${phase.type}`;
                    bar2.style.left = '0%';
                    bar2.style.width = `${(endMin / 1440) * 100}%`;
                    this._addTooltip(bar2, `${phase.label}: ${startConverted} – ${endConverted} (${this._formatDuration(startMin, endMin)})`);
                    container.appendChild(bar2);
                }

                bar.style.left = `${left}%`;
                bar.style.width = `${width}%`;
                this._addTooltip(bar, `${phase.label}: ${startConverted} – ${endConverted} (${this._formatDuration(startMin, endMin)})`);
                container.appendChild(bar);
            }
        }
    }

    _addMarkerToContainer(container, time, type, label) {
        const converted = this._convertTime(time, 'CET', this.timezone);
        const minutes = this._timeToMinutes(converted);
        if (minutes !== null) {
            const marker = document.createElement('div');
            marker.className = `timeline-marker marker-${type}`;
            marker.style.left = `${(minutes / 1440) * 100}%`;
            this._addTooltip(marker, `${label}: ${converted}`);
            container.appendChild(marker);
        }
    }

    _positionTooltip(x, y) {
        const pad = 12;
        const rect = this.tooltip.getBoundingClientRect();
        const left = Math.min(x + 15, window.innerWidth - rect.width - pad);
        const top = y + 15 + rect.height > window.innerHeight - pad ? y - rect.height - 10 : y + 15;
        this.tooltip.style.left = `${Math.max(pad, left)}px`;
        this.tooltip.style.top = `${top}px`;
    }

    _addTooltip(el, text) {
        el.setAttribute('aria-label', text);
        el.addEventListener('mouseenter', () => {
            clearTimeout(this.tooltipTimer);
            this.tooltip.textContent = text;
            this.tooltip.classList.remove('hidden');
        });
        el.addEventListener('mousemove', (e) => this._positionTooltip(e.clientX, e.clientY));
        el.addEventListener('mouseleave', () => {
            this.tooltip.classList.add('hidden');
        });
        // Touch devices have no hover: show the tooltip on tap for a few seconds
        el.addEventListener('click', (e) => {
            if (el.closest('.timeline-group-row')) return; // group bars toggle the group instead
            e.stopPropagation();
            clearTimeout(this.tooltipTimer);
            this.tooltip.textContent = text;
            this.tooltip.classList.remove('hidden');
            this._positionTooltip(e.clientX, e.clientY);
            this.tooltipTimer = setTimeout(() => this.tooltip.classList.add('hidden'), 3000);
        });
    }
}
