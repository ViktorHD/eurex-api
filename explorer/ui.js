export function getTypeName(typeObj) {
    if (!typeObj) return 'Unknown';
    if (typeObj.name) return typeObj.name;
    if (typeObj.kind === 'NON_NULL') return getTypeName(typeObj.ofType) + '!';
    if (typeObj.kind === 'LIST') return '[' + getTypeName(typeObj.ofType) + ']';
    return 'Unknown';
}

export class UIManager {
    constructor(elements) {
        this.els = elements;
        this.sortCol = null;
        this.sortAsc = true;
        this.columnFilters = {};
        this.currentData = [];
    }

    showLoading() {
        this.els.loadingIndicator.classList.remove('hidden');
        this.els.emptyState.classList.add('hidden');
        this.els.resultsTable.classList.add('hidden');
        this.els.errorBox.classList.add('hidden');
    }

    showEmptyState(msg) {
        this.els.loadingIndicator.classList.add('hidden');
        this.els.emptyState.classList.remove('hidden');
        this.els.resultsTable.classList.add('hidden');
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

        this.els.errorBox.querySelector('.error-message').textContent = msg;
        if (window.feather) setTimeout(() => window.feather.replace(), 0);
        this.els.errorBox.classList.remove('hidden');
        this.els.loadingIndicator.classList.add('hidden');
        this.els.resultsTable.classList.add('hidden');
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

    formatValue(val, colName) {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        
        // Formatting numbers
        if (typeof val === 'number') {
            if (colName && colName.toLowerCase().includes('id')) {
                return String(val);
            }
            return new Intl.NumberFormat().format(val);
        }
        
        // Formatting ISO dates
        if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            const d = new Date(val);
            if (!isNaN(d.getTime())) return d.toLocaleString();
        }
        
        return String(val);
    }

    renderTable(dataArray, stateOptions = {}) {
        this.currentData = dataArray || [];
        if (stateOptions.sortCol !== undefined) this.sortCol = stateOptions.sortCol;
        if (stateOptions.sortAsc !== undefined) this.sortAsc = stateOptions.sortAsc;
        if (stateOptions.columnFilters !== undefined) this.columnFilters = stateOptions.columnFilters;

        this.els.tableHead.innerHTML = '';
        this.els.tableBody.innerHTML = '';

        if (this.currentData.length === 0) {
            this.showEmptyState("No data available to display.");
            this.disableExportBtns();
            return;
        }

        const headers = Object.keys(this.currentData[0]);

        this.processedData = this.currentData.map(row => {
            const _s = {};
            const _sl = {};
            headers.forEach(h => {
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
            return { row, _s, _sl };
        });

        this.numericCols = new Set();
        const remainingHeaders = new Set(headers);
        for (const row of this.currentData) {
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

        // Filter row
        const trFilter = document.createElement('tr');
        trFilter.className = 'filter-row';
        headers.forEach(h => {
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
                if (this.els.onStateChange) this.els.onStateChange(this.exportState());
                this.renderTableRows(headers);
            });
            th.appendChild(input);
            trFilter.appendChild(th);
        });

        // Header row
        const trHead = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.className = 'sortable-th';
            if (this.numericCols.has(h)) th.style.textAlign = 'right';
            th.textContent = h + (this.sortCol === h ? (this.sortAsc ? ' ▲' : ' ▼') : '');
            th.addEventListener('click', () => {
                if (this.sortCol === h) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortCol = h;
                    this.sortAsc = true;
                }
                if (this.els.onStateChange) this.els.onStateChange(this.exportState());
                this.renderTable(this.currentData, this.exportState());
            });
            trHead.appendChild(th);
        });

        this.els.tableHead.appendChild(trHead);
        this.els.tableHead.appendChild(trFilter);

        this.renderTableRows(headers);

        this.els.loadingIndicator.classList.add('hidden');
        this.els.emptyState.classList.add('hidden');
        this.els.resultsTable.classList.remove('hidden');
        
        // Re-trigger animation
        this.els.resultsTable.classList.remove('fade-in');
        void this.els.resultsTable.offsetWidth; // Trigger reflow
        this.els.resultsTable.classList.add('fade-in');

        this.enableExportBtns();
        this.autoResizeColumns();
    }

    renderTableRows(headers) {
        this.els.tableBody.innerHTML = '';

        const activeFilters = headers
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
                const va = a._s[this.sortCol] || '', vb = b._s[this.sortCol] || '';
                
                const na = parseFloat(va), nb = parseFloat(vb);
                if (!isNaN(na) && !isNaN(nb)) {
                    return this.sortAsc ? na - nb : nb - na;
                }
                return this.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            });
        }

        this.els.recordCounter.textContent = `(${filtered.length} of ${this.currentData.length} records)`;

        filtered.forEach(item => {
            const tr = document.createElement('tr');
            headers.forEach(h => {
                const td = document.createElement('td');
                td.setAttribute('data-label', h);
                if (this.numericCols && this.numericCols.has(h)) td.style.textAlign = 'right';
                let cellVal = item.row[h];
                td.textContent = this.formatValue(cellVal, h);
                tr.appendChild(td);
            });
            this.els.tableBody.appendChild(tr);
        });
    }

    autoResizeColumns() {
        const ths = this.els.resultsTable.querySelectorAll('th');
        ths.forEach(th => { th.style.width = ''; });
        requestAnimationFrame(() => {
            ths.forEach(th => {
                th.style.width = th.offsetWidth + 'px';
            });
        });
    }

    exportState() {
        return {
            sortCol: this.sortCol,
            sortAsc: this.sortAsc,
            columnFilters: { ...this.columnFilters }
        };
    }
}
