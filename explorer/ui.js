export function getTypeName(typeObj) {
    if (!typeObj) return 'Unknown';
    if (typeObj.name) return typeObj.name;
    if (typeObj.kind === 'NON_NULL') return getTypeName(typeObj.ofType) + '!';
    if (typeObj.kind === 'LIST') return '[' + getTypeName(typeObj.ofType) + ']';
    return 'Unknown';
}

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

        if (this.name) {
            const title = document.createElement('h3');
            title.className = 'table-title';
            title.textContent = this.name;
            this.container.appendChild(title);
        }

        if (this.data.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = "No data available.";
            this.container.appendChild(empty);
            return;
        }

        this.tableEl = document.createElement('table');
        this.tableEl.className = 'data-table fade-in';
        this.tableHead = document.createElement('thead');
        this.tableBody = document.createElement('tbody');

        this.tableEl.appendChild(this.tableHead);
        this.tableEl.appendChild(this.tableBody);
        this.container.appendChild(this.tableEl);

        this._renderHead();
        this._renderRows();
        this.autoResizeColumns();
    }

    _renderHead() {
        this.tableHead.innerHTML = '';

        // Header row
        const trHead = document.createElement('tr');
        this.headers.forEach((h) => {
            const th = document.createElement('th');
            th.className = 'sortable-th';
            if (this.stickyCols.has(h)) th.classList.add('sticky-col');
            if (this.numericCols.has(h)) th.style.textAlign = 'right';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = h + (this.sortCol === h ? (this.sortAsc ? ' ▲' : ' ▼') : '');
            labelSpan.addEventListener('click', () => {
                if (this.sortCol === h) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortCol = h;
                    this.sortAsc = true;
                }
                if (this.onStateChange) this.onStateChange(this.exportState());
                this._renderHead();
                this._renderRows();
            });
            th.appendChild(labelSpan);

            // Pin button
            const pinBtn = document.createElement('button');
            pinBtn.className = 'pin-btn' + (this.stickyCols.has(h) ? ' active' : '');
            pinBtn.innerHTML = '📌';
            pinBtn.title = 'Pin Column';
            pinBtn.setAttribute('aria-label', 'Pin Column');
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
        trFilter.className = 'filter-row';
        this.headers.forEach(h => {
            const th = document.createElement('th');
            if (this.numericCols.has(h)) th.style.textAlign = 'right';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter...';
            input.className = 'col-filter';
            if (this.numericCols.has(h)) input.style.textAlign = 'right';
            input.value = this.columnFilters[h] || '';
            input.addEventListener('input', () => {
                this.columnFilters[h] = input.value;
                if (this.onStateChange) this.onStateChange(this.exportState());
                this._renderRows();
            });
            th.appendChild(input);
            trFilter.appendChild(th);
        });
        this.tableHead.appendChild(trFilter);
    }

    _renderRows() {
        this.tableBody.innerHTML = '';

        const activeFilters = this.headers
            .map(h => ({ header: h, value: (this.columnFilters[h] || '').toLowerCase() }))
            .filter(f => f.value);

        let filtered = this.processedData.filter(item => {
            return activeFilters.every(f => {
                const val = item._sl[f.header] || '';
                return val.includes(f.value);
            });
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

        filtered.forEach(item => {
            const tr = document.createElement('tr');
            tr.dataset.index = item.originalIndex;

            this.headers.forEach(h => {
                const td = document.createElement('td');
                td.setAttribute('data-label', h);
                if (this.stickyCols.has(h)) td.classList.add('sticky-col');
                if (this.numericCols && this.numericCols.has(h)) td.style.textAlign = 'right';

                let cellVal = item.row[h];

                const nestedData = this._getNestedData(cellVal);
                if (nestedData) {
                    const btn = document.createElement('button');
                    btn.className = 'expand-btn';
                    const isExpanded = this.expandedRows.has(item.originalIndex);
                    btn.innerHTML = `<i data-feather="${isExpanded ? 'chevron-down' : 'chevron-right'}"></i> ${nestedData.length} items`;
                    btn.addEventListener('click', () => {
                        if (this.expandedRows.has(item.originalIndex)) {
                            this.expandedRows.delete(item.originalIndex);
                        } else {
                            this.expandedRows.add(item.originalIndex);
                        }
                        this._renderRows();
                    });
                    td.appendChild(btn);
                } else {
                    td.textContent = this.formatValue(cellVal, h);
                }
                tr.appendChild(td);
            });
            this.tableBody.appendChild(tr);

            if (this.expandedRows.has(item.originalIndex)) {
                this._renderExpandedRow(item);
            }
        });

        if (window.feather) window.feather.replace();
    }

    _renderExpandedRow(item) {
        const tr = document.createElement('tr');
        tr.className = 'expanded-row';
        const td = document.createElement('td');
        td.colSpan = this.headers.length;

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
        if (!this.tableEl) return;
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
            stickyCols: Array.from(this.stickyCols)
        };
    }
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
        // Record counter: if multi-table, maybe show total?
        let totalRecords = 0;
        this.tables.forEach(t => totalRecords += t.data.length);
        this.els.recordCounter.textContent = `(${totalRecords} records across ${this.tables.length} table${this.tables.length > 1 ? 's' : ''})`;

        if (this.currentDate) {
            this.els.validityDate.innerHTML = '';
            const separatorSpan = document.createElement('span');
            separatorSpan.className = 'vd-separator';
            separatorSpan.textContent = '| ';
            this.els.validityDate.appendChild(separatorSpan);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'vd-label';
            labelSpan.textContent = 'Records Validity Date: ';
            this.els.validityDate.appendChild(labelSpan);

            this.els.validityDate.appendChild(document.createTextNode(this.currentDate));
            this.els.validityDate.classList.remove('hidden');
        } else {
            this.els.validityDate.textContent = '';
            this.els.validityDate.classList.add('hidden');
        }
    }

    exportState() {
        return {
            tables: this.tables.map(t => t.exportState()),
            date: this.currentDate,
            isMultiTable: this.tables.length > 1
        };
    }
}
