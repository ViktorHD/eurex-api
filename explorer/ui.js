export function getTypeName(typeObj) {
    if (!typeObj) return 'Unknown';
    if (typeObj.name) return typeObj.name;
    if (typeObj.kind === 'NON_NULL') return getTypeName(typeObj.ofType) + '!';
    if (typeObj.kind === 'LIST') return '[' + getTypeName(typeObj.ofType) + ']';
    return 'Unknown';
}

function cellText(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

// CSV (RFC 4180 quoting) for the given column order and rows.
export function toCsv(headers, rows) {
    const esc = (v) => {
        const s = cellText(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n');
}

// Tab-separated text, pastes straight into Excel / Sheets.
export function toTsv(headers, rows) {
    const clean = (v) => cellText(v).replace(/[\t\r\n]+/g, ' ');
    return [headers.map(clean).join('\t'), ...rows.map(r => headers.map(h => clean(r[h])).join('\t'))].join('\n');
}

export function toMarkdown(headers, rows) {
    const clean = (v) => cellText(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
    return [
        `| ${headers.map(clean).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map(r => `| ${headers.map(h => clean(r[h])).join(' | ')} |`)
    ].join('\n');
}

const svgIcon = (name) => {
    const i = document.createElement('i');
    i.setAttribute('data-feather', name);
    i.setAttribute('aria-hidden', 'true');
    return i;
};

export class DataTable {
    constructor(container, data, options = {}) {
        this.container = container;
        this.data = data || [];
        this.name = options.name || '';
        this.date = options.date || null;
        this.onStateChange = options.onStateChange || null;
        
        this.sortCol = options.sortCol || null;
        this.sortAsc = options.sortAsc !== undefined ? options.sortAsc : true;
        this.columnFilters = options.columnFilters || {};
        this.stickyCols = new Set(options.stickyCols || []);
        this.searchText = options.searchText || '';
        this.showFilters = options.showFilters ?? Object.values(this.columnFilters).some(Boolean);
        // A single wide record reads better as a field/value list than as one very wide row
        this.layout = options.layout || ((data || []).length === 1 && Object.keys((data || [])[0] || {}).length > 4 ? 'record' : 'table');
        
        this.processedData = [];
        this.numericCols = new Set();
        this.headers = [];

        this.tableEl = null;
        this.tableHead = null;
        this.tableBody = null;
        
        this.expandedRows = new Set(); // indices of expanded rows

        this._prepareData();
        this.render();
    }

    _prepareData() {
        if (this.data.length === 0) return;
        this.headers = Object.keys(this.data[0]);

        this.processedData = this.data.map((row, index) => {
            const _s = {};
            const _sl = {};
            this.headers.forEach(h => {
                let val = row[h];
                let sVal;
                if (val === null || val === undefined) {
                    sVal = '';
                } else if (typeof val === 'object') {
                    sVal = JSON.stringify(val);
                } else {
                    sVal = String(val);
                }
                _s[h] = sVal;
                _sl[h] = sVal.toLowerCase();
            });
            return { row, _s, _sl, originalIndex: index };
        });

        this.numericCols = new Set();
        const remainingHeaders = new Set(this.headers);
        for (const row of this.data) {
            for (const h of remainingHeaders) {
                const val = row[h];
                if (val !== null && val !== undefined) {
                    if (typeof val === 'number' && !h.toLowerCase().includes('id')) {
                        this.numericCols.add(h);
                    }
                    remainingHeaders.delete(h);
                }
            }
            if (remainingHeaders.size === 0) break;
        }
    }

    _getNestedData(v) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return v;
        if (typeof v === 'object' && v !== null && Array.isArray(v.data) && v.data.length > 0 && typeof v.data[0] === 'object') return v.data;
        return null;
    }

    formatValue(val, colName) {
        if (val === null || val === undefined) return '';

        if (this._getNestedData(val)) {
            return '[Nested Data]';
        }
        if (typeof val === 'object') return JSON.stringify(val);

        if (typeof val === 'number') {
            if (colName && colName.toLowerCase().includes('id')) {
                return String(val);
            }
            return new Intl.NumberFormat().format(val);
        }
        return String(val);
    }

    render() {
        this.container.innerHTML = '';

        if (this.data.length === 0) {
            if (this.name) {
                const title = document.createElement('h3');
                title.className = 'table-title';
                title.textContent = this.name;
                this.container.appendChild(title);
            }
            const empty = document.createElement('p');
            empty.className = 'dt-empty';
            empty.textContent = "No data available.";
            this.container.appendChild(empty);
            return;
        }

        this._renderToolbar();

        const scroll = document.createElement('div');
        scroll.className = 'dt-scroll';
        this.tableEl = document.createElement('table');
        this.tableEl.className = 'data-table fade-in' + (this.layout === 'record' ? ' dt-record' : '');
        this.tableHead = document.createElement('thead');
        this.tableBody = document.createElement('tbody');

        this.tableEl.appendChild(this.tableHead);
        this.tableEl.appendChild(this.tableBody);
        scroll.appendChild(this.tableEl);
        this.container.appendChild(scroll);

        if (this.layout === 'record') {
            this._renderRecord();
        } else {
            this._renderHead();
            this._renderRows();
            this.autoResizeColumns();
        }
        if (window.feather) window.feather.replace();
    }

    _notify() {
        if (this.onStateChange) this.onStateChange(this.exportState());
    }

    _renderToolbar() {
        const bar = document.createElement('div');
        bar.className = 'dt-toolbar';

        const title = document.createElement('div');
        title.className = 'dt-title';
        const name = document.createElement('h3');
        name.className = 'dt-name';
        name.textContent = this.name || 'Result';
        this.countEl = document.createElement('span');
        this.countEl.className = 'dt-count';
        title.append(name, this.countEl);
        bar.appendChild(title);

        const tools = document.createElement('div');
        tools.className = 'dt-tools';

        if (this.layout === 'table') {
            const search = document.createElement('label');
            search.className = 'dt-search';
            search.appendChild(svgIcon('search'));
            const input = document.createElement('input');
            input.type = 'search';
            input.placeholder = 'Search table';
            input.setAttribute('aria-label', `Search ${this.name || 'results'}`);
            input.value = this.searchText;
            input.addEventListener('input', () => {
                this.searchText = input.value;
                this._notify();
                this._renderRows();
            });
            search.appendChild(input);
            tools.appendChild(search);

            const filterBtn = this._toolButton('filter', 'Filters', 'Show or hide column filters');
            filterBtn.setAttribute('aria-pressed', String(this.showFilters));
            if (this.showFilters) filterBtn.classList.add('active');
            filterBtn.addEventListener('click', () => {
                this.showFilters = !this.showFilters;
                filterBtn.classList.toggle('active', this.showFilters);
                filterBtn.setAttribute('aria-pressed', String(this.showFilters));
                this.tableHead.querySelector('.filter-row')?.classList.toggle('hidden', !this.showFilters);
                this._notify();
            });
            tools.appendChild(filterBtn);

            this.clearBtn = this._toolButton('x-circle', 'Clear', 'Clear search, filters and sorting');
            this.clearBtn.addEventListener('click', () => {
                this.searchText = '';
                this.columnFilters = {};
                this.sortCol = null;
                this.sortAsc = true;
                this._notify();
                this.render();
            });
            tools.appendChild(this.clearBtn);
        }

        if (this.data.length === 1) {
            const toRecord = this.layout === 'table';
            const layoutBtn = this._toolButton(toRecord ? 'list' : 'grid', toRecord ? 'Record view' : 'Table view',
                toRecord ? 'Show the record as a field / value list' : 'Show as a table row');
            layoutBtn.addEventListener('click', () => {
                this.layout = toRecord ? 'record' : 'table';
                this._notify();
                this.render();
            });
            tools.appendChild(layoutBtn);
        }

        const copyBtn = this._toolButton('copy', 'Copy', 'Copy visible rows (paste into Excel)');
        copyBtn.addEventListener('click', async () => {
            const label = copyBtn.querySelector('span');
            try {
                await navigator.clipboard.writeText(toTsv(this.headers, this.getVisibleRows()));
                label.textContent = 'Copied';
            } catch (e) {
                label.textContent = 'Copy failed';
            }
            setTimeout(() => { label.textContent = 'Copy'; }, 1500);
        });
        tools.appendChild(copyBtn);

        const csvBtn = this._toolButton('download', 'CSV', 'Download visible rows of this table as CSV');
        csvBtn.addEventListener('click', () => {
            downloadText(toCsv(this.headers, this.getVisibleRows()), `${this.name || 'result'}${this.date ? '_' + this.date : ''}.csv`, 'text/csv');
        });
        tools.appendChild(csvBtn);

        bar.appendChild(tools);
        this.container.appendChild(bar);
    }

    _toolButton(icon, label, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dt-tool';
        btn.title = title;
        btn.appendChild(svgIcon(icon));
        const span = document.createElement('span');
        span.textContent = label;
        btn.appendChild(span);
        return btn;
    }

    _updateCount(visible) {
        if (!this.countEl) return;
        const total = this.data.length;
        const noun = total === 1 ? 'row' : 'rows';
        this.countEl.textContent = visible === total ? `${total.toLocaleString('en-US')} ${noun}` : `${visible.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${noun}`;
        const active = this.searchText || this.sortCol || Object.values(this.columnFilters).some(Boolean);
        if (this.clearBtn) this.clearBtn.classList.toggle('hidden', !active);
    }

    // Field / value layout for a single record
    _renderRecord() {
        const row = this.data[0];
        const trHead = document.createElement('tr');
        ['Field', 'Value'].forEach(t => {
            const th = document.createElement('th');
            th.textContent = t;
            trHead.appendChild(th);
        });
        this.tableHead.appendChild(trHead);
        this.headers.forEach(h => {
            const tr = document.createElement('tr');
            const k = document.createElement('th');
            k.scope = 'row';
            k.className = 'dt-field';
            k.textContent = h;
            const v = document.createElement('td');
            this._fillCell(v, row[h], h, { originalIndex: 0, row });
            tr.append(k, v);
            this.tableBody.appendChild(tr);
        });
        if (this.expandedRows.has(0)) this._renderExpandedRow({ originalIndex: 0, row });
        this._updateCount(1);
    }

    // Rows after search, column filters and sorting, in display order
    getVisibleRows() {
        return this._visibleItems().map(i => i.row);
    }

    _visibleItems() {
        const activeFilters = this.headers
            .map(h => ({ header: h, value: (this.columnFilters[h] || '').toLowerCase() }))
            .filter(f => f.value);
        const search = (this.searchText || '').trim().toLowerCase();

        let filtered = this.processedData.filter(item => {
            if (search && !this.headers.some(h => (item._sl[h] || '').includes(search))) return false;
            return activeFilters.every(f => (item._sl[f.header] || '').includes(f.value));
        });

        if (this.sortCol) {
            filtered = [...filtered].sort((a, b) => {
                const ra = a.row[this.sortCol];
                const rb = b.row[this.sortCol];

                if (ra === rb) return 0;
                if (ra === null || ra === undefined) return 1;
                if (rb === null || rb === undefined) return -1;

                let comparison = 0;
                if (typeof ra === 'number' && typeof rb === 'number') {
                    comparison = ra - rb;
                } else {
                    const sa = a._s[this.sortCol] || '';
                    const sb = b._s[this.sortCol] || '';
                    const isDateA = sa.match(/^\d{4}-\d{2}-\d{2}/);
                    const isDateB = sb.match(/^\d{4}-\d{2}-\d{2}/);

                    if (isDateA && isDateB) {
                        comparison = new Date(sa) - new Date(sb);
                    } else {
                        const na = parseFloat(sa), nb = parseFloat(sb);
                        if (!isNaN(na) && !isNaN(nb) && !isDateA && !isDateB) {
                            comparison = na - nb;
                        } else {
                            comparison = sa.localeCompare(sb);
                        }
                    }
                }
                return this.sortAsc ? comparison : -comparison;
            });
        }
        return filtered;
    }

    _renderHead() {
        this.tableHead.innerHTML = '';

        // Header row
        const trHead = document.createElement('tr');
        this.headers.forEach((h) => {
            const th = document.createElement('th');
            th.className = 'sortable-th';
            if (this.stickyCols.has(h)) th.classList.add('sticky-col');
            if (this.numericCols.has(h)) th.classList.add('num');
            const sorted = this.sortCol === h;
            th.setAttribute('aria-sort', sorted ? (this.sortAsc ? 'ascending' : 'descending') : 'none');

            // The whole header is the sort control (button for keyboard access)
            const sortBtn = document.createElement('button');
            sortBtn.type = 'button';
            sortBtn.className = 'th-sort';
            sortBtn.title = `Sort by ${h}`;
            const labelSpan = document.createElement('span');
            labelSpan.textContent = h;
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow' + (sorted ? ' active' : '');
            arrow.textContent = sorted ? (this.sortAsc ? '▲' : '▼') : '↕';
            arrow.setAttribute('aria-hidden', 'true');
            sortBtn.append(labelSpan, arrow);
            sortBtn.addEventListener('click', () => {
                if (this.sortCol === h) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortCol = h;
                    this.sortAsc = true;
                }
                this._notify();
                this._renderHead();
                this._renderRows();
                this.autoResizeColumns();
                if (window.feather) window.feather.replace();
            });
            th.appendChild(sortBtn);

            // Pin button
            const pinBtn = document.createElement('button');
            pinBtn.type = 'button';
            pinBtn.className = 'pin-btn' + (this.stickyCols.has(h) ? ' active' : '');
            pinBtn.setAttribute('aria-label', (this.stickyCols.has(h) ? 'Unpin column ' : 'Pin column ') + h);
            pinBtn.setAttribute('aria-pressed', String(this.stickyCols.has(h)));
            pinBtn.title = this.stickyCols.has(h) ? 'Unpin column' : 'Pin column (keeps it visible while scrolling sideways)';
            pinBtn.appendChild(svgIcon('map-pin'));
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.stickyCols.has(h)) {
                    this.stickyCols.delete(h);
                } else {
                    this.stickyCols.add(h);
                }
                if (this.onStateChange) this.onStateChange(this.exportState());
                this.render();
            });
            th.appendChild(pinBtn);

            trHead.appendChild(th);
        });
        this.tableHead.appendChild(trHead);

        // Filter row
        const trFilter = document.createElement('tr');
        trFilter.className = 'filter-row' + (this.showFilters ? '' : ' hidden');
        this.headers.forEach(h => {
            const th = document.createElement('th');
            if (this.numericCols.has(h)) th.classList.add('num');
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter…';
            input.className = 'col-filter';
            input.setAttribute('aria-label', `Filter ${h}`);
            input.value = this.columnFilters[h] || '';
            input.addEventListener('input', () => {
                this.columnFilters[h] = input.value;
                this._notify();
                this._renderRows();
            });
            th.appendChild(input);
            trFilter.appendChild(th);
        });
        this.tableHead.appendChild(trFilter);
    }

    _renderRows() {
        this.tableBody.innerHTML = '';
        const filtered = this._visibleItems();
        this._updateCount(filtered.length);

        if (filtered.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = this.headers.length;
            td.className = 'dt-no-match';
            td.textContent = 'No rows match the current search or filters.';
            tr.appendChild(td);
            this.tableBody.appendChild(tr);
            return;
        }

        filtered.forEach(item => {
            const tr = document.createElement('tr');
            tr.dataset.index = item.originalIndex;

            this.headers.forEach(h => {
                const td = document.createElement('td');
                td.setAttribute('data-label', h);
                if (this.stickyCols.has(h)) td.classList.add('sticky-col');
                if (this.numericCols && this.numericCols.has(h)) td.classList.add('num');
                this._fillCell(td, item.row[h], h, item);
                tr.appendChild(td);
            });
            this.tableBody.appendChild(tr);

            if (this.expandedRows.has(item.originalIndex)) {
                this._renderExpandedRow(item);
            }
        });

        if (window.feather) window.feather.replace();
    }

    _fillCell(td, cellVal, h, item) {
        const nestedData = this._getNestedData(cellVal);
        if (nestedData) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'expand-btn';
            const isExpanded = this.expandedRows.has(item.originalIndex);
            btn.setAttribute('aria-expanded', String(isExpanded));
            btn.title = isExpanded ? 'Collapse row' : 'Expand row';
            btn.appendChild(svgIcon(isExpanded ? 'chevron-down' : 'chevron-right'));
            btn.append(` ${nestedData.length} items`);
            btn.addEventListener('click', () => {
                if (this.expandedRows.has(item.originalIndex)) {
                    this.expandedRows.delete(item.originalIndex);
                } else {
                    this.expandedRows.add(item.originalIndex);
                }
                this.layout === 'record' ? this.render() : this._renderRows();
            });
            td.appendChild(btn);
            return;
        }
        const text = this.formatValue(cellVal, h);
        if (text === '') {
            td.classList.add('dt-null');
            td.textContent = '—';
            td.title = 'No value';
        } else {
            td.textContent = text;
        }
    }

    _renderExpandedRow(item) {
        const tr = document.createElement('tr');
        tr.className = 'expanded-row';
        const td = document.createElement('td');
        td.colSpan = this.layout === 'record' ? 2 : this.headers.length;

        const nestedWrapper = document.createElement('div');
        nestedWrapper.className = 'nested-wrapper';

        // Find all nested fields
        this.headers.forEach(h => {
            const nestedData = this._getNestedData(item.row[h]);
            if (nestedData) {
                const nestedContainer = document.createElement('div');
                nestedContainer.className = 'nested-table-container';
                new DataTable(nestedContainer, nestedData, {
                    name: h
                });
                nestedWrapper.appendChild(nestedContainer);
            }
        });

        td.appendChild(nestedWrapper);
        tr.appendChild(td);
        this.tableBody.appendChild(tr);
    }

    autoResizeColumns() {
        if (!this.tableEl || this.layout === 'record') return;
        const ths = this.tableHead.querySelectorAll('tr:first-child th');
        ths.forEach(th => {
            th.style.width = '';
            th.style.left = '';
        });

        requestAnimationFrame(() => {
            let leftOffset = 0;
            ths.forEach((th, i) => {
                const width = th.offsetWidth;
                th.style.width = width + 'px';

                if (th.classList.contains('sticky-col')) {
                    th.style.left = leftOffset + 'px';

                    const filterTh = this.tableHead.querySelectorAll('.filter-row th')[i];
                    if (filterTh) {
                        filterTh.classList.add('sticky-col');
                        filterTh.style.left = leftOffset + 'px';
                    }

                    this.tableBody.querySelectorAll('tr:not(.expanded-row)').forEach(tr => {
                        const td = tr.querySelectorAll('td')[i];
                        if (td) {
                            td.style.left = leftOffset + 'px';
                        }
                    });

                    leftOffset += width;
                }
            });
        });
    }

    exportState() {
        return {
            sortCol: this.sortCol,
            sortAsc: this.sortAsc,
            columnFilters: { ...this.columnFilters },
            stickyCols: Array.from(this.stickyCols),
            searchText: this.searchText,
            showFilters: this.showFilters,
            layout: this.layout
        };
    }
}

export function downloadText(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/[^A-Za-z0-9._-]+/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export class UIManager {
    constructor(elements) {
        this.els = elements;
        this.currentData = [];
        this.currentDate = null;
        this.tables = [];
    }

    showLoading() {
        this.els.loadingIndicator.classList.remove('hidden');
        this.els.emptyState.classList.add('hidden');
        if (this.els.resultsTable) this.els.resultsTable.classList.add('hidden');
        if (this.els.resultsContainer) this.els.resultsContainer.classList.add('hidden');
        this.els.errorBox.classList.add('hidden');
    }

    showEmptyState(msg) {
        this.els.loadingIndicator.classList.add('hidden');
        this.els.emptyState.classList.remove('hidden');
        if (this.els.resultsTable) this.els.resultsTable.classList.add('hidden');
        if (this.els.resultsContainer) this.els.resultsContainer.classList.add('hidden');
        this.els.errorBox.classList.add('hidden');
        if (msg) {
            const p = this.els.emptyState.querySelector('p:first-of-type');
            if (p) p.textContent = msg;
        }
    }

    showError(msg) {
        this.els.errorBox.innerHTML = `
            <div class="error-card-header"><i data-feather="alert-circle"></i> Error</div>
            <p class="error-message"></p>
        `;
        const errorMsgEl = this.els.errorBox.querySelector('.error-message');
        if (errorMsgEl) errorMsgEl.textContent = msg;

        if (window.feather) setTimeout(() => window.feather.replace(), 0);
        this.els.errorBox.classList.remove('hidden');
        this.els.loadingIndicator.classList.add('hidden');
        if (this.els.resultsTable) this.els.resultsTable.classList.add('hidden');
        if (this.els.resultsContainer) this.els.resultsContainer.classList.add('hidden');
        this.els.emptyState.classList.add('hidden');
    }

    hideError() {
        this.els.errorBox.classList.add('hidden');
    }

    enableExportBtns() {
        this.els.downloadCsvBtn.disabled = false;
        this.els.downloadMdBtn.disabled = false;
        if (this.els.shareBtn) this.els.shareBtn.disabled = false;
    }

    disableExportBtns() {
        this.els.downloadCsvBtn.disabled = true;
        this.els.downloadMdBtn.disabled = true;
        if (this.els.shareBtn) this.els.shareBtn.disabled = true;
    }

    renderTable(data, stateOptions = {}) {
        this.currentData = data || [];
        this.currentDate = stateOptions.date || null;
        this.tables = [];

        const container = this.els.resultsContainer || this.els.resultsTable.parentElement;
        container.innerHTML = '';

        if (!data || (Array.isArray(data) && data.length === 0)) {
            this.showEmptyState("No data available to display.");
            this.disableExportBtns();
            return;
        }

        this.els.loadingIndicator.classList.add('hidden');
        this.els.emptyState.classList.add('hidden');
        container.classList.remove('hidden');

        let tablesToCreate = [];
        if (stateOptions.isMultiTable && Array.isArray(data)) {
            tablesToCreate = data;
        } else {
            tablesToCreate = [{ name: stateOptions.name || '', data: data, date: stateOptions.date }];
        }

        // Several root fields: chips to jump between their tables
        if (tablesToCreate.length > 1) {
            const nav = document.createElement('nav');
            nav.className = 'dt-jump';
            nav.setAttribute('aria-label', 'Result tables');
            tablesToCreate.forEach((t, i) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'dt-jump-chip';
                chip.textContent = t.name || `Table ${i + 1}`;
                const n = document.createElement('span');
                n.textContent = (t.data || []).length.toLocaleString('en-US');
                chip.appendChild(n);
                chip.addEventListener('click', () => {
                    container.querySelectorAll('.table-wrapper')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                nav.appendChild(chip);
            });
            container.appendChild(nav);
        }

        tablesToCreate.forEach((t, i) => {
            const tableDiv = document.createElement('div');
            tableDiv.className = 'table-wrapper';
            container.appendChild(tableDiv);

            const tableOptions = {
                name: t.name,
                date: t.date,
                onStateChange: (tableState) => {
                    if (this.els.onStateChange) {
                        this.els.onStateChange(this.exportState());
                    }
                }
            };

            // Apply saved state if available
            if (stateOptions.tables && stateOptions.tables[i]) {
                Object.assign(tableOptions, stateOptions.tables[i]);
            } else if (!stateOptions.isMultiTable) {
                // Backward compatibility for single table state
                tableOptions.sortCol = stateOptions.sortCol;
                tableOptions.sortAsc = stateOptions.sortAsc;
                tableOptions.columnFilters = stateOptions.columnFilters;
            }

            const dt = new DataTable(tableDiv, t.data, tableOptions);
            this.tables.push(dt);
        });

        this.updateHeaderUI();
        this.enableExportBtns();
    }

    updateHeaderUI() {
        let totalRecords = 0;
        this.tables.forEach(t => totalRecords += t.data.length);
        const n = this.tables.length;
        this.els.recordCounter.textContent = `${totalRecords.toLocaleString('en-US')} record${totalRecords === 1 ? '' : 's'}` + (n > 1 ? ` · ${n} tables` : '');

        if (this.currentDate) {
            this.els.validityDate.innerHTML = '';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'vd-label';
            labelSpan.textContent = 'Valid on ';
            this.els.validityDate.appendChild(labelSpan);

            this.els.validityDate.appendChild(document.createTextNode(this.currentDate));
            this.els.validityDate.title = 'Validity date of the returned records';
            this.els.validityDate.classList.remove('hidden');
        } else {
            this.els.validityDate.textContent = '';
            this.els.validityDate.classList.add('hidden');
        }
    }

    // Exports cover every table, using the rows currently visible (search, filters and sort applied).
    exportCsv() {
        if (this.tables.length === 1) return toCsv(this.tables[0].headers, this.tables[0].getVisibleRows());
        return this.tables.map(t => `${t.name}\r\n${toCsv(t.headers, t.getVisibleRows())}`).join('\r\n\r\n');
    }

    exportMarkdown() {
        return this.tables.map(t => {
            const md = toMarkdown(t.headers, t.getVisibleRows());
            return this.tables.length > 1 || t.name ? `## ${t.name || 'Result'}\n\n${md}` : md;
        }).join('\n\n');
    }

    exportFileBase() {
        const names = this.tables.map(t => t.name).filter(Boolean);
        return `${names.join('_') || 'result'}${this.currentDate ? '_' + this.currentDate : ''}`;
    }

    exportState() {
        return {
            tables: this.tables.map(t => t.exportState()),
            date: this.currentDate,
            isMultiTable: this.tables.length > 1
        };
    }
}
