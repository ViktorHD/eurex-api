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

function unwrapTypeName(typeObj) {
    if (!typeObj) return null;
    if (typeObj.name) return typeObj.name;
    return unwrapTypeName(typeObj.ofType);
}

export class InfoPanel {
    constructor(client, elements) {
        this.client = client;
        this.panel = elements.panel;
        this.statusGrid = elements.statusGrid;
        this.changelogContainer = elements.changelogContainer;
        this.onClose = elements.onClose;

        elements.closeBtn.addEventListener('click', () => {
            if (this.onClose) this.onClose();
        });

        if (elements.refreshBtn) {
            elements.refreshBtn.addEventListener('click', () => this.load());
        }
    }

    async load() {
        await Promise.all([
            this.loadStatus(),
            this.loadChangelog()
        ]);
    }

    async loadStatus() {
        this._setContent(this.statusGrid, 'loading', 'Checking API status…');

        try {
            const data = await this.client.request(STATUS_QUERY, false);
            const today = new Date().toISOString().split('T')[0];

            this.statusGrid.innerHTML = '';
            STATUS_NAMES.forEach(name => {
                const date = data?.[name]?.date ?? null;
                const state = date ? (date === today ? 'ok' : 'stale') : 'error';

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
                this.statusGrid.appendChild(card);
            });
        } catch (err) {
            this._setContent(this.statusGrid, 'error', err.message);
        }
    }

    async loadChangelog() {
        this._setContent(this.changelogContainer, 'loading', 'Loading changelog…');

        try {
            const dataFields = await this._fetchChangelogDataFields();

            const query = dataFields.length > 0
                ? `query { Changelog { date data { ${dataFields.join(' ')} } } }`
                : `query { Changelog { date } }`;

            const res = await this.client.request(query, false);
            const changelog = res?.Changelog;

            this.changelogContainer.innerHTML = '';

            if (!changelog) {
                this._setContent(this.changelogContainer, 'empty', 'No data available.');
                return;
            }

            if (changelog.date) {
                const p = document.createElement('p');
                p.className = 'info-date-label';
                p.textContent = `Data as of: ${changelog.date}`;
                this.changelogContainer.appendChild(p);
            }

            const rows = changelog.data || [];
            if (rows.length === 0) {
                const p = document.createElement('p');
                p.className = 'info-empty';
                p.textContent = 'No changelog entries found.';
                this.changelogContainer.appendChild(p);
                return;
            }

            this.changelogContainer.appendChild(this._buildTable(rows));
        } catch (err) {
            this._setContent(this.changelogContainer, 'error', err.message);
        }
    }

    async _fetchChangelogDataFields() {
        const INTROSPECT = `query {
            __schema {
                queryType { name }
                types {
                    name kind
                    fields {
                        name
                        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
                    }
                }
            }
        }`;

        const schemaData = await this.client.request(INTROSPECT, false);
        const schema = schemaData.__schema;
        const queryType = schema.types.find(t => t.name === schema.queryType.name);

        const changelogField = queryType?.fields?.find(f => f.name === 'Changelog');
        const resultType = schema.types.find(t => t.name === unwrapTypeName(changelogField?.type));
        const dataField = resultType?.fields?.find(f => f.name === 'data');
        const recordType = schema.types.find(t => t.name === unwrapTypeName(dataField?.type));

        return (recordType?.fields || []).map(f => f.name);
    }

    _buildTable(rows) {
        const headers = Object.keys(rows[0]);
        const table = document.createElement('table');

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach(row => {
            const tr = document.createElement('tr');
            headers.forEach(h => {
                const td = document.createElement('td');
                const val = row[h];
                td.textContent = val !== null && val !== undefined ? String(val) : '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
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
