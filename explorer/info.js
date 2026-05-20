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
}`;

const STATUS_NAMES = [
    'Holidays', 'DeliverableBonds', 'TradingHours', 'VendorCodes',
    'SettlementPrices', 'Enlight', 'ProductInfos', 'Contracts',
    'TickRules', 'EnlightResponders', 'FlexibleContracts', 'Changelog',
    'Expirations', 'TESProfiles'
];

export class InfoPanel {
    constructor(client, elements, options = {}) {
        this.client = client;
        this.els = elements; // { panel, statusGrid, changelogContent, changelogLoading, closeBtn, refreshBtn }
        this.options = options; // { onRunQuery }
        this.changelogData = null;

        this.bindEvents();
    }

    bindEvents() {
        if (this.els.closeBtn) {
            this.els.closeBtn.addEventListener('click', () => {
                if (this.options.onClose) this.options.onClose();
                else this.els.panel.classList.add('hidden');
            });
        }

        if (this.els.refreshBtn) {
            this.els.refreshBtn.addEventListener('click', () => this.load());
        }
    }

    async load() {
        await Promise.all([
            this.loadStatus(),
            this.loadChangelog()
        ]);
    }

    async loadStatus() {
        this._setContent(this.els.statusGrid, 'loading', 'Checking API status…');

        try {
            const data = await this.client.request(STATUS_QUERY, false);
            const today = new Date().toISOString().split('T')[0];

            this.els.statusGrid.innerHTML = '';
            STATUS_NAMES.forEach(name => {
                const date = data?.[name]?.date ?? null;

                let state = 'error';
                if (date) {
                    if (name === 'Changelog' || name === 'DeliverableBonds') {
                        state = 'ok';
                    } else {
                        state = (date === today) ? 'ok' : 'stale';
                    }
                }

                const card = document.createElement('div');
                card.className = `status-card ${state}`;

                const dot = document.createElement('div');
                dot.className = 'status-dot';

                const info = document.createElement('div');
                info.className = 'status-info';

                const nameEl = document.createElement('span');
                nameEl.className = 'status-name';
                nameEl.textContent = name;

                const dateEl = document.createElement('span');
                dateEl.className = 'status-date';
                dateEl.textContent = date || '–';

                info.appendChild(nameEl);
                info.appendChild(dateEl);
                card.appendChild(dot);
                card.appendChild(info);
                this.els.statusGrid.appendChild(card);
            });
        } catch (err) {
            this._setContent(this.els.statusGrid, 'error', err.message);
        }
    }

    async loadChangelog() {
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
            const response = await this.client.request(query, false);
            if (!response || !response.Changelog || !response.Changelog.data) {
                throw new Error("No changelog data found.");
            }

            this.changelogData = response.Changelog.data;
            this.renderChangelog();
        } catch (err) {
            if (this.els.changelogContent) {
                this.els.changelogContent.innerHTML = `<div class="error-card"><p>${err.message}</p></div>`;
            }
        } finally {
            if (this.els.changelogLoading) this.els.changelogLoading.classList.add('hidden');
        }
    }

    renderChangelog() {
        if (!this.changelogData || !this.els.changelogContent) return;

        const container = this.els.changelogContent;
        container.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sortedData = [...this.changelogData].sort((a, b) => new Date(b.Date) - new Date(a.Date));

        const timelineWrapper = document.createElement('div');
        timelineWrapper.className = 'changelog-timeline-container';

        const axis = document.createElement('div');
        axis.className = 'changelog-axis';
        timelineWrapper.appendChild(axis);

        let todayMarkerAdded = false;

        sortedData.forEach((entry) => {
            const entryDate = new Date(entry.Date);
            entryDate.setHours(0, 0, 0, 0);

            if (!todayMarkerAdded && entryDate <= today) {
                this._addTodayMarker(timelineWrapper);
                todayMarkerAdded = true;
            }

            const item = document.createElement('div');
            const isFuture = entryDate > today;
            const isToday = entryDate.getTime() === today.getTime();

            item.className = `changelog-item ${isFuture ? 'future' : (isToday ? 'today' : 'past')}`;

            const dot = document.createElement('div');
            dot.className = 'changelog-dot';
            item.appendChild(dot);

            const content = document.createElement('div');
            content.className = 'changelog-item-content';

            const header = document.createElement('div');
            header.className = 'changelog-item-header';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'changelog-date';
            dateSpan.textContent = entry.Date;
            header.appendChild(dateSpan);

            const typeSpan = document.createElement('span');
            typeSpan.className = 'changelog-type-badge';
            typeSpan.textContent = entry.Type;
            header.appendChild(typeSpan);

            content.appendChild(header);

            if (entry.Description) {
                const desc = document.createElement('p');
                desc.className = 'changelog-description';
                desc.textContent = entry.Description;
                content.appendChild(desc);
            }

            if (entry.OldValue || entry.NewValue) {
                const changes = document.createElement('div');
                changes.className = 'changelog-changes';

                if (entry.OldValue) {
                    const oldVal = document.createElement('div');
                    oldVal.className = 'changelog-change-val old';
                    oldVal.innerHTML = `<span class="label">Old:</span> <code>${this._escapeHtml(entry.OldValue)}</code>`;
                    changes.appendChild(oldVal);
                }

                if (entry.NewValue) {
                    const newVal = document.createElement('div');
                    newVal.className = 'changelog-change-val new';
                    newVal.innerHTML = `<span class="label">New:</span> <code>${this._escapeHtml(entry.NewValue)}</code>`;
                    changes.appendChild(newVal);
                }
                content.appendChild(changes);
            }

            if (entry.Query) {
                const queryDiv = document.createElement('div');
                queryDiv.className = 'changelog-query';
                queryDiv.innerHTML = `<div class="changelog-query-header">
                    <span class="label">GraphQL Query:</span>
                    <button class="run-query-btn"><i data-feather="play"></i> Run in Explorer</button>
                </div>
                <pre><code>${this._escapeHtml(entry.Query)}</code></pre>`;

                const runBtn = queryDiv.querySelector('.run-query-btn');
                runBtn.addEventListener('click', () => {
                    if (this.options.onRunQuery) {
                        this.options.onRunQuery(entry.Query);
                    }
                });

                content.appendChild(queryDiv);
            }

            item.appendChild(content);
            timelineWrapper.appendChild(item);
        });

        if (!todayMarkerAdded) {
            this._addTodayMarker(timelineWrapper);
        }

        container.appendChild(timelineWrapper);
        if (window.feather) window.feather.replace();
    }

    _addTodayMarker(parent) {
        const marker = document.createElement('div');
        marker.className = 'changelog-today-marker';

        const line = document.createElement('div');
        line.className = 'changelog-today-line';
        marker.appendChild(line);

        const label = document.createElement('div');
        label.className = 'changelog-today-label';
        label.textContent = 'TODAY';
        marker.appendChild(label);

        parent.appendChild(marker);
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
