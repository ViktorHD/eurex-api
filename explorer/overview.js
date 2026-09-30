// Strike Window visualization for the Eurex Overview pane.
// X-axis: Strike price. Y-axis: Contract date. Color: ContractCycle.

const CYCLE_COLORS = {
    WEEKLY: '#00ce7d',
    MONTHLY: '#1e88e5',
    QUARTERLY: '#ffb300',
    YEARLY: '#8e24aa',
    FLEXIBLE: '#ff1744'
};
const DEFAULT_CYCLE_COLOR = '#757575';
const PRODUCT_CODE_RE = /^[A-Z0-9_-]{1,32}$/;
// Delta Coverage view flags adjacent strikes whose deltas differ by more than this.
const DELTA_JUMP_THRESHOLD = 0.2;
// 3D camera presets. Front: delta vs contract date; Side: strike vs contract date; Top: delta vs strike.
const VIEW_PRESETS_3D = {
    iso: { label: '3D', title: 'Isometric view', azimuth: Math.PI / 4, pitch: Math.PI / 6 },
    front: { label: 'Δ × Date', title: 'Front: delta against contract date', azimuth: 0, pitch: 0.05 },
    side: { label: 'Strike × Date', title: 'Side: strike against contract date', azimuth: Math.PI / 2, pitch: 0.05 },
    top: { label: 'Δ × Strike', title: 'Top: delta against strike', azimuth: 0, pitch: Math.PI / 2 - 0.05 }
};
// Frequently used option products offered as quick picks in the empty state (only those that exist are shown).
const QUICK_PICKS = ['OESX', 'ODAX', 'OSMI', 'OGBL', 'OGBM', 'OVS2', 'OKS2', 'OMSC'];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatDateToDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    if (dateStr.includes('.')) return dateStr;
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
        const [y, m, d] = parts;
        return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
    }
    return dateStr;
}

export function generateStrikesCsv(symbol, contractDateOrEntries, startStrike, endStrike, distance, existingStrikes = null) {
    let entries = [];
    if (Array.isArray(contractDateOrEntries)) {
        entries = contractDateOrEntries;
        if (startStrike && (startStrike instanceof Set || Array.isArray(startStrike))) {
            existingStrikes = startStrike;
        }
    } else {
        entries = [{
            contractDate: contractDateOrEntries,
            startStrike,
            endStrike,
            distance
        }];
    }

    if (!entries.length) {
        throw new Error('Invalid strike range or distance');
    }

    let existingSet = null;
    if (existingStrikes) {
        existingSet = existingStrikes instanceof Set ? existingStrikes : new Set(existingStrikes);
    }

    const lines = ['Symbol;ContractDate;StrikePrice'];
    const seen = new Set();
    const maxCount = 10000;
    let count = 0;

    for (const entry of entries) {
        const rawDate = entry.contractDates || entry.contractDate || entry.ContractDate;
        const dates = Array.isArray(rawDate) ? rawDate : [rawDate];
        const start = Number(entry.startStrike ?? entry.StartStrike);
        const end = Number(entry.endStrike ?? entry.EndStrike);
        const step = Number(entry.distance ?? entry.Distance);

        if (!dates.length || dates.some(d => !d) || Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(step) || step <= 0 || start > end) {
            throw new Error('Invalid strike range or distance');
        }

        for (const date of dates) {
            let current = start;
            while (current <= end + 1e-9 && count < maxCount) {
                const strikeVal = Number(current.toFixed(6));
                const key = `${date}|${strikeVal}`;
                if (!existingSet || !existingSet.has(key)) {
                    const line = `${symbol};${date};${strikeVal}`;
                    if (!seen.has(line)) {
                        seen.add(line);
                        lines.push(line);
                    }
                }
                current += step;
                count++;
            }
        }
    }

    return lines.join('\r\n');
}

export function generateStrikeRequestEmailText(symbol, entries, existingStrikes = null) {
    let existingSet = null;
    if (existingStrikes) {
        existingSet = existingStrikes instanceof Set ? existingStrikes : new Set(existingStrikes);
    }

    const rows = [];
    let totalNewStrikes = 0;

    for (const entry of entries) {
        const rawDate = entry.contractDates || entry.contractDate || entry.ContractDate;
        const dates = Array.isArray(rawDate) ? rawDate : [rawDate];
        const start = Number(entry.startStrike ?? entry.StartStrike);
        const end = Number(entry.endStrike ?? entry.EndStrike);
        const distance = Number(entry.distance ?? entry.Distance);

        for (const d of dates) {
            let current = start;
            let newCount = 0;
            while (current <= end + 1e-9) {
                const strikeVal = Number(current.toFixed(6));
                const key = `${d}|${strikeVal}`;
                if (!existingSet || !existingSet.has(key)) {
                    newCount++;
                }
                current += distance;
            }

            if (newCount > 0) {
                totalNewStrikes += newCount;
                rows.push({
                    symbol: String(symbol),
                    contractDate: String(d),
                    startStrike: String(start),
                    endStrike: String(end),
                    distance: String(distance)
                });
            }
        }
    }

    if (rows.length === 0) {
        return '';
    }

    const colHeaders = {
        symbol: 'Symbol',
        contractDate: 'Contract Date',
        startStrike: 'Start Strike',
        endStrike: 'End Strike',
        distance: 'Distance'
    };

    const colWidths = {
        symbol: Math.max(colHeaders.symbol.length, ...rows.map(r => r.symbol.length)),
        contractDate: Math.max(colHeaders.contractDate.length, ...rows.map(r => r.contractDate.length)),
        startStrike: Math.max(colHeaders.startStrike.length, ...rows.map(r => r.startStrike.length)),
        endStrike: Math.max(colHeaders.endStrike.length, ...rows.map(r => r.endStrike.length)),
        distance: Math.max(colHeaders.distance.length, ...rows.map(r => r.distance.length))
    };

    const sepLine = '+' +
        '-'.repeat(colWidths.symbol + 2) + '+' +
        '-'.repeat(colWidths.contractDate + 2) + '+' +
        '-'.repeat(colWidths.startStrike + 2) + '+' +
        '-'.repeat(colWidths.endStrike + 2) + '+' +
        '-'.repeat(colWidths.distance + 2) + '+';

    const headerLine = '| ' +
        colHeaders.symbol.padEnd(colWidths.symbol) + ' | ' +
        colHeaders.contractDate.padEnd(colWidths.contractDate) + ' | ' +
        colHeaders.startStrike.padEnd(colWidths.startStrike) + ' | ' +
        colHeaders.endStrike.padEnd(colWidths.endStrike) + ' | ' +
        colHeaders.distance.padEnd(colWidths.distance) + ' |';

    const tableLines = [sepLine, headerLine, sepLine];

    for (const r of rows) {
        tableLines.push('| ' +
            r.symbol.padEnd(colWidths.symbol) + ' | ' +
            r.contractDate.padEnd(colWidths.contractDate) + ' | ' +
            r.startStrike.padEnd(colWidths.startStrike) + ' | ' +
            r.endStrike.padEnd(colWidths.endStrike) + ' | ' +
            r.distance.padEnd(colWidths.distance) + ' |'
        );
    }
    tableLines.push(sepLine);

    return `Dear Eurex Operations Team,\n\nPlease add the following strike prices for ${symbol} for the next trading day:\n\n${tableLines.join('\n')}\n\nTotal new strikes to add: ${totalNewStrikes}\n\nNote: The requested strikes CSV file has been prepared and is attached to this email.\n\nThank you,\nBest regards`;
}

// Distinct strike increments used in one expiry's ladder, ascending (e.g. [25, 50, 100] when the wings are coarser).
export function ladderSteps(sortedStrikes) {
    const steps = new Set();
    for (let i = 1; i < sortedStrikes.length; i++) {
        const d = Number((sortedStrikes[i] - sortedStrikes[i - 1]).toFixed(6));
        if (d > 0) steps.add(d);
    }
    return [...steps].sort((a, b) => a - b);
}

// Missing strikes inside one expiry's ladder. Strike schemes often widen away from the money (e.g. 25 near the
// money, 50 or 100 in the wings), so each interval is judged against the local step on both sides instead of one
// step for the whole expiry or product. The local step on a side is the nearest regular run (two equal consecutive
// intervals), falling back to the adjacent interval. An interval is a gap when it exceeds 1.5x the coarser side step.
// The first and last intervals are never gaps: a wider step at the end of the ladder is the wing, not a hole.
// Missing strikes are proposed on that coarser step, continuing the grid of the listed strikes on that side.
export function findLadderGaps(sortedStrikes) {
    const s = sortedStrikes;
    const d = [];
    for (let i = 1; i < s.length; i++) d.push(Number((s[i] - s[i - 1]).toFixed(6)));
    const sideStep = (i, dir) => {
        for (let j = i + dir; j + dir >= 0 && j + dir < d.length; j += dir) {
            if (d[j] === d[j + dir]) return d[j];
        }
        return d[i + dir];
    };
    const gaps = [];
    for (let i = 1; i < d.length - 1; i++) {
        const left = sideStep(i, -1);
        const right = sideStep(i, 1);
        const step = Math.max(left, right);
        if (!(step > 0) || d[i] <= step * 1.5) continue;
        const lo = s[i];
        const hi = s[i + 1];
        const count = Math.ceil(d[i] / step - 1e-9) - 1;
        // Anchor on the side whose step is used, so proposed strikes line up with that side's listed strikes
        const start = Number((right > left ? hi - count * step : lo + step).toFixed(6));
        const end = Number((start + (count - 1) * step).toFixed(6));
        gaps.push({ lo, hi, start, end, step, count });
    }
    return gaps;
}

// Adjacent listed strikes of one expiry whose call deltas differ by more than `threshold`: the delta coverage
// between them is thin. points: [{ strike, delta }] (call deltas, 0..1), any order.
export function findDeltaJumps(points, threshold = 0.2) {
    const sorted = points
        .filter(p => Number.isFinite(p.strike) && Number.isFinite(p.delta))
        .sort((a, b) => a.strike - b.strike);
    const jumps = [];
    for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        const size = Math.abs(a.delta - b.delta);
        if (b.strike > a.strike && size > threshold + 1e-9) {
            jumps.push({ lo: a.strike, hi: b.strike, deltaLo: a.delta, deltaHi: b.delta, size });
        }
    }
    return jumps;
}

// Strike step to propose inside an interval: the largest listed step of the expiry that is smaller than the interval
// and divides it evenly, otherwise the finest listed step.
export function refineStep(interval, steps) {
    const candidates = (steps || []).filter(st => st < interval - 1e-9 && Math.abs(interval / st - Math.round(interval / st)) < 1e-6);
    if (candidates.length) return Math.max(...candidates);
    return steps && steps.length ? Math.min(...steps) : null;
}

export function downloadCsvFile(filename, csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export class OverviewManager {
    constructor(client, els) {
        this.client = client; // shared GraphQLClient instance (same one used by the Query pane)
        this.els = els; // { container, content, loading, productInput, productList, refreshBtn, viewSelect }
        this.products = []; // [{ Product, Name }] option products only
        this.currentProduct = null;
        this.tooltip = this._createTooltip();
        this._lastChart = null; // { normalRows, lepoRows, product } for instant view-mode switching
        this._existingContractsSet = new Set(); // Stores "date|strike" for standard listed Contracts

        this.bindEvents();

        // Re-render when the pane width changes so the chart always fits without distortion.
        if (typeof ResizeObserver !== 'undefined' && this.els.container) {
            let lastWidth = 0;
            let timer = null;
            new ResizeObserver(entries => {
                const width = Math.round(entries[0].contentRect.width);
                if (!width || width === lastWidth) return;
                lastWidth = width;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (this._lastChart) this._renderChart(this._lastChart.normalRows, this._lastChart.lepoRows, this._lastChart.product, this._lastChart.allRows);
                }, 150);
            }).observe(this.els.container);
        }
    }

    bindEvents() {
        this.els.refreshBtn.addEventListener('click', () => this.fetchAndRender());
        this.els.productInput.addEventListener('change', () => this.fetchAndRender());
        this.els.productInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.fetchAndRender();
        });
        this.els.productInput.addEventListener('input', () => {
            this.els.productInput.value = this.els.productInput.value.toUpperCase();
        });
        if (this.els.viewSelect) {
            this.els.viewSelect.addEventListener('change', () => {
                // Re-render from cached data; no need to refetch just to switch view mode.
                if (this._lastChart) this._renderChart(this._lastChart.normalRows, this._lastChart.lepoRows, this._lastChart.product, this._lastChart.allRows);
            });
        }

        const modal = document.getElementById('requestStrikesModal');
        const closeBtn = document.getElementById('closeRequestStrikesModal');
        const cancelBtn = document.getElementById('cancelRequestStrikesBtn');
        const prepareMailBtn = document.getElementById('prepareMailBtn');
        const form = document.getElementById('requestStrikesForm');
        const addRowBtn = document.getElementById('addReqRowBtn');

        if (modal) {
            const closeModal = () => modal.classList.add('hidden');
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });

            if (addRowBtn) {
                addRowBtn.addEventListener('click', () => {
                    this._addRequestStrikeRow('', {});
                });
            }

            const extractEntries = () => {
                const symbol = document.getElementById('reqSymbol')?.value || '';
                const rowEls = document.querySelectorAll('.req-strike-row');
                const entries = [];

                rowEls.forEach(row => {
                    const dateSelect = row.querySelector('.req-contract-date');
                    const startInput = row.querySelector('.req-start-strike');
                    const endInput = row.querySelector('.req-end-strike');
                    const distanceInput = row.querySelector('.req-strike-distance');

                    if (dateSelect && startInput && endInput && distanceInput) {
                        const selectedDates = Array.from(dateSelect.selectedOptions).map(opt => opt.value);
                        entries.push({
                            contractDates: selectedDates,
                            startStrike: startInput.value,
                            endStrike: endInput.value,
                            distance: distanceInput.value
                        });
                    }
                });
                return { symbol, entries };
            };

            if (prepareMailBtn) {
                prepareMailBtn.addEventListener('click', () => {
                    const { symbol, entries } = extractEntries();
                    try {
                        const csvContent = generateStrikesCsv(symbol, entries, this._existingContractsSet);
                        const csvLines = csvContent.split('\r\n').filter(Boolean);
                        if (csvLines.length <= 1) {
                            alert('All requested strikes are already listed.');
                            return;
                        }

                        const todayFormatted = formatDateToDDMMYYYY(new Date().toISOString().split('T')[0]);
                        const filename = `additional_strikes_${symbol}_${todayFormatted}.csv`;
                        downloadCsvFile(filename, csvContent);

                        const emailBody = generateStrikeRequestEmailText(symbol, entries, this._existingContractsSet);
                        const mailtoUrl = `mailto:eurextrading@eurex.com?subject=${encodeURIComponent(`Request for Additional Strikes - ${symbol} for Next Trading Day`)}&body=${encodeURIComponent(emailBody)}`;
                        window.location.href = mailtoUrl;

                        closeModal();
                    } catch (err) {
                        alert(err.message || 'Error preparing email');
                    }
                });
            }

            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const { symbol, entries } = extractEntries();

                    try {
                        const csvContent = generateStrikesCsv(symbol, entries, this._existingContractsSet);
                        const csvLines = csvContent.split('\r\n').filter(Boolean);
                        if (csvLines.length <= 1) {
                            alert('All requested strikes are already listed.');
                            return;
                        }

                        const todayFormatted = formatDateToDDMMYYYY(new Date().toISOString().split('T')[0]);
                        const filename = `additional_strikes_${symbol}_${todayFormatted}.csv`;
                        downloadCsvFile(filename, csvContent);
                        closeModal();
                    } catch (err) {
                        alert(err.message || 'Error generating CSV');
                    }
                });
            }
        }
    }

    _addRequestStrikeRow(defaultDate = '', prefill = {}) {
        const container = document.getElementById('reqRowsContainer');
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'req-strike-row';
        row.style.cssText = 'padding: 12px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-main); position: relative;';

        const datesHtml = (this._modalDates || [])
            .map(d => `<option value="${escapeHtml(d)}" ${d === defaultDate ? 'selected' : ''}>${escapeHtml(d)}</option>`)
            .join('');

        const isFirst = container.children.length === 0;

        row.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary);">Contract Dates (hold Ctrl/Cmd to multi-select)</label>
                ${!isFirst ? `<button type="button" class="icon-btn remove-req-row-btn" aria-label="Remove range row" title="Remove range row" style="color: #ff1744; padding: 2px;"><i data-feather="trash-2" style="width: 14px; height: 14px;"></i></button>` : ''}
            </div>
            <div style="margin-bottom: 8px;">
                <select class="req-contract-date" multiple required style="width: 100%; height: 90px; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-panel); color: var(--text-primary); font-size: 0.85rem;">
                    ${datesHtml}
                </select>
            </div>
            <div style="display: flex; gap: 8px;">
                <div style="flex: 1;">
                    <label style="display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; color: var(--text-secondary);">Start Strike</label>
                    <input type="number" step="any" class="req-start-strike" required placeholder="e.g. 4500" value="${prefill.start ?? ''}" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-panel); color: var(--text-primary); font-size: 0.85rem;">
                </div>
                <div style="flex: 1;">
                    <label style="display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; color: var(--text-secondary);">End Strike</label>
                    <input type="number" step="any" class="req-end-strike" required placeholder="e.g. 4600" value="${prefill.end ?? ''}" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-panel); color: var(--text-primary); font-size: 0.85rem;">
                </div>
                <div style="flex: 1;">
                    <label style="display: block; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px; color: var(--text-secondary);">Distance</label>
                    <input type="number" step="any" class="req-strike-distance" required placeholder="e.g. 25" value="${prefill.distance ?? ''}" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-panel); color: var(--text-primary); font-size: 0.85rem;">
                </div>
            </div>
        `;

        // Follow the selected expiry's strike step until the user types a distance themselves
        const dateSelect = row.querySelector('.req-contract-date');
        const distanceInput = row.querySelector('.req-strike-distance');
        distanceInput.addEventListener('input', () => { distanceInput.dataset.userSet = '1'; });
        dateSelect.addEventListener('change', () => {
            if (distanceInput.dataset.userSet) return;
            const selected = Array.from(dateSelect.selectedOptions).map(o => o.value);
            const d = this._defaultDistance(selected);
            if (d !== null) distanceInput.value = d;
        });

        const removeBtn = row.querySelector('.remove-req-row-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                row.remove();
            });
        }

        container.appendChild(row);
        if (window.feather) window.feather.replace();
    }

    // prefill (optional): { date, start, end, distance } e.g. from a clicked gap in the strike ladder
    openRequestStrikesModal(product, rawDates, sortedStrikes, prefill = null) {
        const modal = document.getElementById('requestStrikesModal');
        if (!modal) return;

        const symbolInput = document.getElementById('reqSymbol');
        const distanceHint = document.getElementById('reqDistanceHint');
        const container = document.getElementById('reqRowsContainer');

        if (symbolInput) symbolInput.value = product || '';

        if (distanceHint) {
            distanceHint.textContent = this._stepsByDate?.size
                ? 'Strike steps differ per expiry: the distance defaults to the finest step of the selected contract date(s).'
                : '';
        }

        const formattedDates = [...new Set((rawDates || []).map(d => formatDateToDDMMYYYY(d)))].filter(Boolean);
        this._modalDates = formattedDates;

        if (container) {
            container.innerHTML = '';
            if (prefill) {
                this._addRequestStrikeRow(formatDateToDDMMYYYY(prefill.date), {
                    start: prefill.start, end: prefill.end, distance: prefill.distance
                });
            } else {
                const first = formattedDates[0] || '';
                const fallback = this._strikeStep(sortedStrikes || []);
                this._addRequestStrikeRow(first, { distance: this._defaultDistance([first]) ?? (Number.isFinite(fallback) ? fallback : '') });
            }
        }

        modal.classList.remove('hidden');
        if (window.feather) window.feather.replace();
    }

    // Finest strike step among the given contract dates ("DD.MM.YYYY"), or null when unknown.
    _defaultDistance(formattedDates) {
        const steps = formattedDates.flatMap(d => (this._stepsByDate?.get(d) || []).slice(0, 1));
        return steps.length ? Math.min(...steps) : null;
    }

    _createChartHeader(titleText, product, dates, strikes, stats = null) {
        const header = document.createElement('div');
        header.className = 'overview-chart-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'overview-chart-title';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = titleText;
        titleWrap.appendChild(titleSpan);
        if (stats && stats.length) {
            const list = document.createElement('div');
            list.className = 'overview-stats';
            stats.forEach(item => {
                const chip = document.createElement('span');
                chip.className = 'overview-stat' + (item.warn ? ' overview-stat-warn' : '');
                chip.textContent = typeof item === 'string' ? item : item.text;
                list.appendChild(chip);
            });
            titleWrap.appendChild(list);
        }
        header.appendChild(titleWrap);

        if (product && strikes && strikes.length > 0) {
            const reqBtn = document.createElement('button');
            reqBtn.type = 'button';
            reqBtn.className = 'primary-btn overview-request-btn';
            reqBtn.innerHTML = `<i data-feather="plus-circle" style="width: 14px; height: 14px;"></i> Request additional strikes`;
            reqBtn.addEventListener('click', () => this.openRequestStrikesModal(product, dates, strikes));
            header.appendChild(reqBtn);
        }

        return header;
    }

    _createTooltip() {
        const div = document.createElement('div');
        div.className = 'timeline-tooltip hidden';
        document.body.appendChild(div);
        return div;
    }

    _addTooltip(el, text) {
        el.addEventListener('mouseenter', () => {
            this.tooltip.textContent = text;
            this.tooltip.classList.remove('hidden');
        });
        el.addEventListener('mousemove', (e) => {
            const rect = this.tooltip.getBoundingClientRect();
            const left = Math.min(e.clientX + 15, window.innerWidth - rect.width - 12);
            const top = e.clientY + 15 + rect.height > window.innerHeight - 12 ? e.clientY - rect.height - 10 : e.clientY + 15;
            this.tooltip.style.left = `${Math.max(12, left)}px`;
            this.tooltip.style.top = `${top}px`;
        });
        el.addEventListener('mouseleave', () => {
            this.tooltip.classList.add('hidden');
        });
    }

    // Populates the product datalist with option products only (futures have no strike window).
    async loadProducts() {
        const query = `
        query {
          ProductInfos {
            data {
              Product
              Name
              ProductTypeCode
            }
          }
        }
        `;
        try {
            const response = await this.client.request(query, null, false);
            if (response.errors) throw new Error(response.errors[0].message);
            const all = response.ProductInfos.data || [];
            this.products = all
                .filter(p => (p.ProductTypeCode || '').toUpperCase().startsWith('O'))
                .sort((a, b) => a.Product.localeCompare(b.Product));

            this.els.productList.innerHTML = this.products
                .map(p => `<option value="${escapeHtml(p.Product)}">${escapeHtml(p.Product)} - ${escapeHtml(p.Name || '')}</option>`)
                .join('');
        } catch (err) {
            // Non-fatal: dropdown just stays empty, user can still type a product code.
            this.els.productList.innerHTML = '';
        }
    }

    async fetchAndRender() {
        const product = (this.els.productInput.value || '').trim().toUpperCase();
        this.els.productInput.value = product;
        if (!product) {
            this._lastChart = null;
            this.els.content.innerHTML = this._emptyState('Select an option product', 'Type a product code above or pick one below to see its listed strikes per contract date.');
            this._appendQuickPicks();
            if (window.feather) window.feather.replace();
            return;
        }

        if (!PRODUCT_CODE_RE.test(product)) {
            this._lastChart = null;
            this.els.content.innerHTML = this._emptyState('Invalid product code', 'Product codes contain only letters, digits, "-" or "_" (e.g. OESX).');
            this._appendQuickPicks();
            if (window.feather) window.feather.replace();
            return;
        }

        const isKnownOption = this.products.length === 0 || this.products.some(p => p.Product === product);
        if (!isKnownOption) {
            this._lastChart = null;
            this.els.content.innerHTML = this._emptyState(
                'Not an option product',
                `"${product}" is not available in the options list. This view only supports option products (futures have no strike window).`
            );
            this._appendQuickPicks();
            if (window.feather) window.feather.replace();
            return;
        }

        this.currentProduct = product;
        this.els.loading.classList.remove('hidden');
        this.els.content.innerHTML = '';

        const contractsQuery = `
        query {
          Contracts(filter: { Product: { eq: "${product}" } }) {
            data {
              Strike
              ContractDate
              ContractCycle
              ExpirationDate
              PreviousDaySettlementPrice
              OptionsDelta
              CallPut
            }
          }
        }
        `;

        const flexQuery = `
        query {
          FlexibleContracts(filter: { Product: { eq: "${product}" } }) {
            data {
              Strike
              ContractDate
              ExpirationDate
              SettlementPrice
              OpenInterest
              Contract
            }
          }
        }
        `;

        try {
            const response = await this.client.request(contractsQuery, null, false);
            if (response.errors) throw new Error(response.errors[0].message);

            this._existingContractsSet = new Set();
            const contractRows = (response.Contracts.data || [])
                .filter(r => r.Strike !== null && r.Strike !== undefined)
                .map(r => {
                    const formattedDate = formatDateToDDMMYYYY(r.ContractDate);
                    const strikeVal = Number(r.Strike);
                    if (formattedDate && !Number.isNaN(strikeVal)) {
                        this._existingContractsSet.add(`${formattedDate}|${Number(strikeVal.toFixed(6))}`);
                    }
                    return {
                        Strike: r.Strike,
                        ContractDate: r.ContractDate,
                        ContractCycle: (r.ContractCycle || '').toUpperCase(),
                        ExpirationDate: r.ExpirationDate,
                        RefPrice: r.PreviousDaySettlementPrice,
                        CallPut: (r.CallPut || '').toUpperCase(),
                        Delta: this._signedDelta(r.OptionsDelta, r.CallPut)
                    };
                });

            // FlexibleContracts are not offered for every product; a failure here shouldn't break the standard view.
            let flexRows = [];
            try {
                const flexResponse = await this.client.request(flexQuery, null, false);
                if (!flexResponse.errors) {
                    flexRows = (flexResponse.FlexibleContracts.data || [])
                        .filter(r => r.Strike !== null && r.Strike !== undefined)
                        .map(r => ({
                            Strike: r.Strike,
                            ContractDate: r.ContractDate,
                            ContractCycle: 'FLEXIBLE',
                            ExpirationDate: r.ExpirationDate,
                            RefPrice: r.SettlementPrice,
                            OpenInterest: r.OpenInterest,
                            ContractName: r.Contract
                        }));
                }
            } catch (flexErr) {
                flexRows = [];
            }

            // Call/Put pairs collapse into one point for the Strike Window view; flexible contracts stay distinct
            // from standard ones at the same strike/date. Delta-based views need every individual contract instead,
            // since a call and a put at the same strike/date have different (opposite-signed) deltas.
            const allRows = [...contractRows, ...flexRows];
            const seen = new Map();
            allRows.forEach(r => {
                const key = `${r.Strike}|${r.ContractDate}|${r.ContractCycle}`;
                if (!seen.has(key)) seen.set(key, r);
            });
            const rows = [...seen.values()];
            if (rows.length === 0) {
                this.els.content.innerHTML = this._emptyState('No strike data', `No option contracts with a strike were found for ${product}.`);
                if (window.feather) window.feather.replace();
                return;
            }

            const { normalRows, lepoRows } = this._splitLepoRows(rows);
            this._lastChart = { normalRows, lepoRows, allRows, product };
            this._renderChart(normalRows, lepoRows, product, allRows);
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

    _emptyState(title, message) {
        return `
        <div class="empty-state overview-empty">
            <i data-feather="bar-chart-2"></i>
            <div>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        </div>`;
    }

    // Clickable product chips under the empty state, so a first-time user gets a chart in one click.
    _appendQuickPicks() {
        const known = this.products.map(p => p.Product);
        const picks = known.length ? QUICK_PICKS.filter(p => known.includes(p)) : QUICK_PICKS.slice(0, 2);
        const list = picks.length ? picks : known.slice(0, 6);
        if (!list.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'overview-quick-picks';
        const label = document.createElement('span');
        label.textContent = 'Try:';
        wrap.appendChild(label);
        list.forEach(code => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'overview-quick-pick';
            btn.textContent = code;
            const info = this.products.find(p => p.Product === code);
            if (info?.Name) btn.title = info.Name;
            btn.addEventListener('click', () => {
                this.els.productInput.value = code;
                this.fetchAndRender();
            });
            wrap.appendChild(btn);
        });
        this.els.content.querySelector('.overview-empty')?.appendChild(wrap);
    }

    // Smallest gap between distinct strikes, used so axis ticks align to real strike increments.
    _strikeStep(sortedStrikes) {
        let step = Infinity;
        for (let i = 1; i < sortedStrikes.length; i++) {
            const d = sortedStrikes[i] - sortedStrikes[i - 1];
            if (d > 0 && d < step) step = d;
        }
        return Number.isFinite(step) ? step : 1;
    }

    // Widens the base strike increment by a "nice" integer multiplier until the tick count is readable.
    _niceTickStep(baseStep, range, maxTicks = 12) {
        const multipliers = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
        for (const m of multipliers) {
            const step = baseStep * m;
            if (range / step <= maxTicks) return step;
        }
        return baseStep * multipliers[multipliers.length - 1];
    }

    // Tick values for the log-scaled days-to-maturity axis: day/week/month/year buckets, dense near 0.
    _dtmTicks(minDtm, maxDtm) {
        const candidates = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 545, 730, 1095, 1460, 1825, 2555, 3650, 5475, 7300];
        const inRange = candidates.filter(d => d >= minDtm && d <= maxDtm);
        if (inRange.length >= 2) return inRange;
        // Narrow range fallback: a few evenly spaced integer-day ticks.
        const step = this._niceTickStep(1, Math.max(maxDtm - minDtm, 1), 6);
        const ticks = [];
        for (let d = Math.ceil(minDtm / step) * step; d <= maxDtm; d += step) ticks.push(d);
        return ticks.length ? ticks : [Math.round(minDtm), Math.round(maxDtm)];
    }

    // Evenly-spaced subset of a sorted categorical axis (e.g. dates), used to keep tick labels readable.
    _sampleTicks(sortedValues, maxTicks) {
        if (sortedValues.length <= maxTicks) return sortedValues;
        const step = (sortedValues.length - 1) / (maxTicks - 1);
        const picked = [];
        for (let i = 0; i < maxTicks; i++) picked.push(sortedValues[Math.round(i * step)]);
        return [...new Set(picked)];
    }

    // LEPOs (Low Exercise Price Options) carry a strike far below the rest of the ladder (often near 0),
    // so they're pulled out and shown as an underlying reference price instead of a normal strike point.
    _splitLepoRows(rows) {
        const strikes = [...new Set(rows.map(r => Number(r.Strike)))].filter(s => s > 0).sort((a, b) => a - b);
        if (strikes.length < 2) return { normalRows: rows, lepoRows: [] };
        const median = strikes[Math.floor(strikes.length / 2)];
        const lepoThreshold = median * 0.1;
        const lepoRows = rows.filter(r => Number(r.Strike) > 0 && Number(r.Strike) < lepoThreshold);
        if (lepoRows.length === 0 || lepoRows.length === rows.length) return { normalRows: rows, lepoRows: [] };
        const lepoKeys = new Set(lepoRows.map(r => `${r.Strike}|${r.ContractDate}|${r.ContractCycle}`));
        const normalRows = rows.filter(r => !lepoKeys.has(`${r.Strike}|${r.ContractDate}|${r.ContractCycle}`));
        return { normalRows, lepoRows };
    }

    // Whole days remaining until expiration, measured from today.
    _daysToMaturity(expirationDate) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(expirationDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return NaN;
        return Math.round((end - start) / 86400000);
    }

    // Applies the sign convention (positive = Call, negative = Put) regardless of how the raw value is stored.
    _signedDelta(rawDelta, callPut) {
        if (rawDelta === null || rawDelta === undefined || rawDelta === '') return rawDelta;
        const magnitude = Math.abs(Number(rawDelta));
        if (!Number.isFinite(magnitude)) return rawDelta;
        return (callPut || '').toUpperCase() === 'P' ? -magnitude : magnitude;
    }

    // "DD.MM.YYYY" -> ascending strike steps of that expiry's standard (non-flexible) ladder.
    _computeStepsByDate(rows) {
        const byDate = new Map();
        rows.forEach(r => {
            if (r.ContractCycle === 'FLEXIBLE') return;
            const key = formatDateToDDMMYYYY(r.ContractDate);
            if (!byDate.has(key)) byDate.set(key, new Set());
            byDate.get(key).add(Number(r.Strike));
        });
        const result = new Map();
        byDate.forEach((set, key) => {
            const steps = ladderSteps([...set].filter(Number.isFinite).sort((a, b) => a - b));
            if (steps.length) result.set(key, steps);
        });
        return result;
    }

    _productTitle(product) {
        const info = this.products.find(p => p.Product === product);
        return info?.Name ? `${product} · ${info.Name}` : product;
    }

    _rerender() {
        const c = this._lastChart;
        if (c) this._renderChart(c.normalRows, c.lepoRows, c.product, c.allRows);
    }

    // Legend shared by all views: one toggle button per contract cycle (with counts) plus static marker explanations.
    // extraItems: [[swatchClass, label], ...]
    _buildLegend(rows, extraItems = [], note = '') {
        const hidden = this.hiddenCycles;
        const legend = document.createElement('div');
        legend.className = 'overview-legend';
        const order = Object.keys(CYCLE_COLORS);
        const counts = new Map();
        rows.forEach(r => {
            const c = (r.ContractCycle || '').toUpperCase();
            if (c) counts.set(c, (counts.get(c) || 0) + 1);
        });
        [...counts.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(cycle => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'overview-legend-item overview-legend-toggle' + (hidden.has(cycle) ? ' overview-legend-item-hidden' : '');
            item.setAttribute('aria-pressed', String(!hidden.has(cycle)));
            item.title = `Show/hide ${cycle.toLowerCase()} contracts`;
            const swatch = document.createElement('span');
            swatch.className = 'overview-legend-swatch';
            swatch.style.background = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            item.append(swatch, `${cycle.charAt(0)}${cycle.slice(1).toLowerCase()}`);
            const c = document.createElement('span');
            c.className = 'overview-legend-count';
            c.textContent = counts.get(cycle).toLocaleString('en-US');
            item.appendChild(c);
            item.addEventListener('click', () => {
                if (hidden.has(cycle)) hidden.delete(cycle); else hidden.add(cycle);
                this._rerender();
            });
            legend.appendChild(item);
        });
        extraItems.forEach(([swatchClass, label]) => {
            const span = document.createElement('span');
            span.className = 'overview-legend-item';
            const sw = document.createElement('span');
            sw.className = `overview-legend-swatch ${swatchClass}`;
            span.append(sw, label);
            legend.appendChild(span);
        });
        if (note) {
            const n = document.createElement('span');
            n.className = 'overview-legend-item overview-legend-note';
            n.textContent = note;
            legend.appendChild(n);
        }
        return legend;
    }

    _renderChart(normalRows, lepoRows, product, allRows) {
        const viewMode = this.els.viewSelect?.value || 'strike';
        if (!this.hiddenCycles) this.hiddenCycles = new Set(); // shared by all views, so a toggle survives a view switch
        this._stepsByDate = this._computeStepsByDate(normalRows);
        if (viewMode === 'delta') {
            this._renderDeltaChart(allRows || [...normalRows, ...lepoRows], product);
            return;
        }
        if (viewMode === '3d') {
            this._render3DChart(allRows || [...normalRows, ...lepoRows], product);
            return;
        }

        const lepoByDate = new Map();
        lepoRows.forEach(r => {
            if (!lepoByDate.has(r.ContractDate)) lepoByDate.set(r.ContractDate, r);
        });
        const refPrices = [...lepoByDate.values()]
            .map(r => Number(r.RefPrice))
            .filter(v => Number.isFinite(v) && v > 0);

        const hidden = this.hiddenCycles;
        const visibleRows = normalRows.filter(r => !hidden.has((r.ContractCycle || '').toUpperCase()));

        const dates = [...new Set([...normalRows, ...lepoRows].map(r => r.ContractDate))].sort();
        const strikes = [...new Set(normalRows.map(r => Number(r.Strike)))].sort((a, b) => a - b);
        // Flexible contracts can sit on arbitrary strikes, so the listed strike increment comes from standard series only.
        const standardStrikes = [...new Set(normalRows.filter(r => r.ContractCycle !== 'FLEXIBLE').map(r => Number(r.Strike)))].sort((a, b) => a - b);
        const domainCandidates = [...strikes, ...refPrices];
        const minStrike = Math.min(...domainCandidates);
        const maxStrike = Math.max(...domainCandidates);
        const strikePad = (maxStrike - minStrike) * 0.04 || 1;
        // Strikes are never negative, so the axis never extends below 0.
        const domainMin = Math.max(0, minStrike - strikePad);
        const domainMax = maxStrike + strikePad;

        const rowHeight = 28;
        const labelWidth = 128;
        const topAxisHeight = 48;
        const available = Math.max((this.els.container.clientWidth || 0) - 48, 300);
        const chartWidth = Math.max(available - labelWidth - 16, 150);
        const chartHeight = dates.length * rowHeight;
        const svgWidth = labelWidth + chartWidth + 16;
        const svgHeight = topAxisHeight + chartHeight + 8;

        const xScale = (strike) => labelWidth + ((strike - domainMin) / (domainMax - domainMin)) * chartWidth;
        const yScale = (date) => topAxisHeight + dates.indexOf(date) * rowHeight + rowHeight / 2;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('width', svgWidth);
        svg.setAttribute('height', svgHeight);
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `Strike window for ${product}: listed strikes per contract date`);
        svg.classList.add('overview-chart-svg', 'overview-strike-svg');

        const el = (tag, attrs, text) => {
            const node = document.createElementNS(svgNS, tag);
            Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
            if (text !== undefined) node.textContent = text;
            svg.appendChild(node);
            return node;
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rowsByDate = new Map(dates.map(d => [d, []]));
        visibleRows.forEach(r => rowsByDate.get(r.ContractDate)?.push(r));

        // Row backgrounds, date labels and days to expiry
        dates.forEach((date, i) => {
            const y = topAxisHeight + i * rowHeight;
            el('rect', { x: 0, y, width: svgWidth, height: rowHeight, class: i % 2 === 0 ? 'overview-row-even' : 'overview-row-odd' });
            el('text', { x: 8, y: y + rowHeight / 2 + 4, class: 'overview-date-label', 'data-date': date }, formatDateToDDMMYYYY(date));
            const dte = this._daysToMaturity(date);
            if (Number.isFinite(dte)) {
                el('text', { x: labelWidth - 10, y: y + rowHeight / 2 + 4, class: 'overview-dte-label', 'text-anchor': 'end' }, dte < 365 ? `${dte}d` : `${(dte / 365).toFixed(1)}y`);
            }
        });

        // Column headers
        el('text', { x: 8, y: topAxisHeight - 10, class: 'overview-axis-title' }, 'Contract date');
        el('text', { x: labelWidth, y: 14, class: 'overview-axis-title' }, 'Strike');

        // Vertical strike gridlines + top axis ticks on round values that are multiples of the listed increment.
        const baseStep = this._strikeStep(standardStrikes.length > 1 ? standardStrikes : strikes);
        const maxTicks = Math.max(4, Math.floor(chartWidth / 90));
        const tickStep = this._axisTickStep(baseStep, domainMax - domainMin, maxTicks);
        const firstTick = Math.ceil(domainMin / tickStep) * tickStep;
        for (let strike = firstTick; strike <= domainMax; strike += tickStep) {
            const x = xScale(strike);
            el('line', { x1: x, y1: topAxisHeight, x2: x, y2: svgHeight, class: 'overview-gridline' });
            el('text', { x, y: topAxisHeight - 10, class: 'overview-tick-label', 'text-anchor': 'middle' }, Math.round(strike).toLocaleString('en-US'));
        }
        el('line', { x1: labelWidth, y1: topAxisHeight, x2: labelWidth, y2: svgHeight, class: 'overview-axis-line' });

        // Point size adapts to strike density so neighbouring strikes stay distinguishable.
        const minGapPx = (baseStep / (domainMax - domainMin)) * chartWidth;
        const radius = Math.max(2.2, Math.min(5, minGapPx * 0.42));

        const gaps = [];
        dates.forEach(date => {
            const rows = rowsByDate.get(date) || [];
            const std = rows.filter(r => r.ContractCycle !== 'FLEXIBLE');
            const cy = yScale(date);

            // Coverage band from lowest to highest listed strike
            if (std.length > 1) {
                const rowStrikes = [...new Set(std.map(r => Number(r.Strike)))].sort((a, b) => a - b);
                const cycle = (std[0].ContractCycle || '').toUpperCase();
                const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
                el('line', {
                    x1: xScale(rowStrikes[0]), y1: cy, x2: xScale(rowStrikes[rowStrikes.length - 1]), y2: cy,
                    stroke: color, class: 'overview-coverage-band'
                });

                // Missing strikes are determined per expiry (see findLadderGaps)
                findLadderGaps(rowStrikes).forEach(g => gaps.push({ ...g, date }));
            }
        });

        // Hovering a contract date shows that expiry's strike steps
        svg.querySelectorAll('.overview-date-label').forEach(label => {
            const steps = this._stepsByDate.get(formatDateToDDMMYYYY(label.getAttribute('data-date')));
            if (steps && steps.length) {
                this._addTooltip(label, `Strike steps in this expiry: ${steps.map(v => v.toLocaleString('en-US')).join(' / ')}`);
            }
        });

        gaps.forEach(g => {
            const x1 = xScale(g.lo);
            const x2 = xScale(g.hi);
            const cy = yScale(g.date);
            const rect = el('rect', {
                x: x1 + radius, y: cy - 7, width: Math.max(x2 - x1 - 2 * radius, 4), height: 14, rx: 3,
                class: 'overview-gap', tabindex: 0, role: 'button'
            });
            const text = [
                `Missing strikes: ${g.start.toLocaleString('en-US')} – ${g.end.toLocaleString('en-US')}`,
                `${g.count} strike${g.count === 1 ? '' : 's'} at step ${g.step}`,
                `Contract date: ${formatDateToDDMMYYYY(g.date)}`,
                'Click to request these strikes'
            ].join('\n');
            rect.setAttribute('aria-label', text.replace(/\n/g, '. '));
            this._addTooltip(rect, text);
            const open = () => this.openRequestStrikesModal(product, dates, standardStrikes, {
                date: g.date, start: g.start, end: g.end, distance: g.step
            });
            rect.addEventListener('click', open);
            rect.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });

        // Contract points
        visibleRows.forEach(r => {
            const cx = xScale(Number(r.Strike));
            const cy = yScale(r.ContractDate);
            const cycle = (r.ContractCycle || '').toUpperCase();
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            const delta = Number(r.Delta);
            const hasDelta = Number.isFinite(delta) && r.Delta !== null && r.Delta !== undefined;
            const isFlex = cycle === 'FLEXIBLE';

            const circle = el('circle', {
                cx, cy, r: isFlex ? Math.max(radius, 4) : radius, fill: color,
                class: isFlex ? 'overview-point overview-point-flex' : 'overview-point'
            });

            this._addTooltip(circle, [
                `Strike: ${Number(r.Strike).toLocaleString('en-US')}`,
                `Contract Date: ${formatDateToDDMMYYYY(r.ContractDate)}`,
                `Contract Cycle: ${r.ContractCycle || '-'}`,
                `Expiration: ${r.ExpirationDate ? formatDateToDDMMYYYY(r.ExpirationDate) : '-'}`,
                ...(hasDelta ? [`Options Delta: ${r.Delta}`] : []),
                // Contract name and Open Interest are only available for FlexibleContracts, not standard Contracts.
                ...(isFlex && r.ContractName ? [`Contract: ${r.ContractName}`] : []),
                ...(isFlex && r.OpenInterest !== null && r.OpenInterest !== undefined
                    ? [`Open Interest: ${r.OpenInterest}`]
                    : [])
            ].join('\n'));
        });

        // At-the-money estimate per contract date: strike where the call delta crosses 0.5
        const atmByDate = this._atmByDate(allRows || []);
        atmByDate.forEach((atm, date) => {
            if (!dates.includes(date) || atm < domainMin || atm > domainMax) return;
            const x = xScale(atm);
            const cy = yScale(date);
            const marker = el('rect', { x: x - 1.5, y: cy - 10, width: 3, height: 20, rx: 1.5, class: 'overview-atm-marker' });
            this._addTooltip(marker, [
                `At the money ≈ ${Math.round(atm).toLocaleString('en-US')}`,
                'Estimated where call delta = 0.50',
                `Contract Date: ${formatDateToDDMMYYYY(date)}`
            ].join('\n'));
        });

        // Underlying reference price markers, derived from LEPO settlement prices
        dates.forEach((date, i) => {
            const lepo = lepoByDate.get(date);
            if (!lepo) return;
            const refPrice = Number(lepo.RefPrice);
            if (!Number.isFinite(refPrice) || refPrice <= 0) return;

            const x = xScale(refPrice);
            const y = topAxisHeight + i * rowHeight;
            const marker = el('line', { x1: x, y1: y + 2, x2: x, y2: y + rowHeight - 2, class: 'overview-ref-marker' });
            this._addTooltip(marker, [
                'Underlying Reference (LEPO settlement price)',
                `Price: ${lepo.RefPrice}`,
                `Contract Date: ${formatDateToDDMMYYYY(date)}`
            ].join('\n'));
        });

        const legend = this._buildLegend(normalRows, [
            ...(atmByDate.size > 0 ? [['overview-legend-swatch-atm', 'At the money (Δ 0.50)']] : []),
            ...(gaps.length > 0 ? [['overview-legend-swatch-gap', 'Missing strikes (click to request)']] : []),
            ...(lepoByDate.size > 0 ? [['overview-legend-swatch-line', 'Underlying Ref (LEPO)']] : [])
        ]);

        const flexCount = normalRows.filter(r => r.ContractCycle === 'FLEXIBLE').length;
        const titleText = this._productTitle(product);
        const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
        const stats = [
            `${dates.length} contract dates`,
            `${(normalRows.length - flexCount).toLocaleString('en-US')} standard strikes`,
            ...(flexCount > 0 ? [`${flexCount} flexible`] : []),
            ...(standardStrikes.length ? [`Range ${fmtNum(standardStrikes[0])} – ${fmtNum(standardStrikes[standardStrikes.length - 1])}`] : []),
            ...(gaps.length ? [{ text: `${gaps.length} gap${gaps.length === 1 ? '' : 's'} in ladder`, warn: true }] : [])
        ];
        const header = this._createChartHeader(titleText, product, dates, standardStrikes.length ? standardStrikes : strikes, stats);

        this.els.content.innerHTML = '';
        this.els.content.appendChild(header);
        this.els.content.appendChild(legend);

        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overview-chart-scroll';
        scrollWrap.appendChild(svg);
        this.els.content.appendChild(scrollWrap);

        if (window.feather) window.feather.replace();
    }

    // Round axis step (1, 2, 2.5 or 5 × 10^n) that is a multiple of the listed strike increment.
    _axisTickStep(baseStep, range, maxTicks = 10) {
        const minStep = range / maxTicks;
        const start = Math.pow(10, Math.floor(Math.log10(Math.max(minStep, 1e-9))));
        for (let mag = start; mag <= start * 1000; mag *= 10) {
            for (const f of [1, 2, 2.5, 5]) {
                const step = f * mag;
                const ratio = step / baseStep;
                if (step >= minStep && Math.abs(ratio - Math.round(ratio)) < 1e-6) return step;
            }
        }
        return this._niceTickStep(baseStep, range, maxTicks);
    }

    // Estimated at-the-money strike per contract date, interpolated where the call delta crosses 0.5.
    _atmByDate(rows) {
        const byDate = new Map();
        rows.forEach(r => {
            if ((r.CallPut || '') !== 'C' || r.ContractCycle === 'FLEXIBLE') return;
            const delta = Number(r.Delta);
            const strike = Number(r.Strike);
            if (!Number.isFinite(delta) || !Number.isFinite(strike) || r.Delta === null || r.Delta === '') return;
            if (!byDate.has(r.ContractDate)) byDate.set(r.ContractDate, []);
            byDate.get(r.ContractDate).push({ strike, delta });
        });
        const result = new Map();
        byDate.forEach((pts, date) => {
            pts.sort((a, b) => a.strike - b.strike);
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const b = pts[i];
                if (a.delta >= 0.5 && b.delta <= 0.5 && a.delta !== b.delta) {
                    result.set(date, a.strike + ((a.delta - 0.5) / (a.delta - b.delta)) * (b.strike - a.strike));
                    break;
                }
            }
        });
        return result;
    }

    // Delta Coverage view: X = Options Delta (puts left, calls right), Y = days to maturity (log scale).
    // Each expiry is one row of points with a coverage band per side; large delta jumps between adjacent
    // listed strikes are flagged and can be requested directly.
    _renderDeltaChart(rows, product) {
        const hidden = this.hiddenCycles;
        const allPoints = rows
            .map(r => ({
                ...r,
                strike: Number(r.Strike),
                delta: Number(r.Delta),
                dtm: this._daysToMaturity(r.ExpirationDate)
            }))
            .filter(p => p.Delta !== null && p.Delta !== undefined && p.Delta !== ''
                && Number.isFinite(p.delta) && Number.isFinite(p.dtm) && p.dtm >= 0);

        if (allPoints.length === 0) {
            this.els.content.innerHTML = this._emptyState(
                'No delta data',
                `No contracts with both an Options Delta and a computable days-to-maturity were found for ${product}.`
            );
            if (window.feather) window.feather.replace();
            return;
        }
        const points = allPoints.filter(p => !hidden.has((p.ContractCycle || '').toUpperCase()));

        const domainMinX = -1.05;
        const domainMaxX = 1.05;
        const dtms = allPoints.map(p => p.dtm);
        const domainMinY = Math.max(0, Math.min(...dtms));
        const domainMaxY = Math.max(...dtms) * 1.08 + 1;

        const labelWidth = 64;
        const topMargin = 40;
        const bottomAxisHeight = 44;
        const available = Math.max((this.els.container.clientWidth || 0) - 48, 300);
        const chartWidth = Math.max(available - labelWidth - 16, 200);
        const reservedHeight = 150;
        const containerHeight = Math.max(this.els.container.clientHeight || 0, 420);
        const chartHeight = Math.max(containerHeight - reservedHeight - topMargin - bottomAxisHeight, 320);
        const svgWidth = labelWidth + chartWidth + 16;
        const svgHeight = topMargin + chartHeight + bottomAxisHeight;

        const xScale = (delta) => labelWidth + ((delta - domainMinX) / (domainMaxX - domainMinX)) * chartWidth;
        // Log scale: short maturities get proportionally more vertical space, long ones compress together.
        const logMinY = Math.log1p(domainMinY);
        const logMaxY = Math.log1p(domainMaxY);
        const innerPad = 14; // keeps the first and last expiry rows off the chart edges
        const yScale = (dtm) => topMargin + innerPad + ((Math.log1p(dtm) - logMinY) / (logMaxY - logMinY || 1)) * (chartHeight - 2 * innerPad);

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('width', svgWidth);
        svg.setAttribute('height', svgHeight);
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `Delta coverage for ${product}: option deltas per days to maturity`);
        svg.classList.add('overview-chart-svg', 'overview-strike-svg');
        const el = (tag, attrs, text) => {
            const node = document.createElementNS(svgNS, tag);
            Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
            if (text !== undefined) node.textContent = text;
            svg.appendChild(node);
            return node;
        };

        // Put / call halves
        el('rect', { x: xScale(domainMinX), y: topMargin, width: xScale(0) - xScale(domainMinX), height: chartHeight, class: 'overview-delta-half-put' });
        el('rect', { x: xScale(0), y: topMargin, width: xScale(domainMaxX) - xScale(0), height: chartHeight, class: 'overview-delta-half-call' });
        el('text', { x: xScale(-0.5), y: topMargin - 14, class: 'overview-axis-title', 'text-anchor': 'middle' }, '◀ Puts');
        el('text', { x: xScale(0.5), y: topMargin - 14, class: 'overview-axis-title', 'text-anchor': 'middle' }, 'Calls ▶');

        // Days-to-maturity gridlines (log scale)
        this._dtmTicks(domainMinY, domainMaxY).forEach(dtm => {
            const y = yScale(dtm);
            el('line', { x1: labelWidth, y1: y, x2: svgWidth - 16, y2: y, class: 'overview-gridline' });
            el('text', { x: labelWidth - 8, y: y + 4, class: 'overview-date-label', 'text-anchor': 'end' }, dtm < 365 ? `${Math.round(dtm)}d` : `${(dtm / 365).toFixed(dtm % 365 ? 1 : 0)}y`);
        });

        // Delta gridlines, with ATM (±0.50) and zero emphasised
        for (let i = -10; i <= 10; i += 2) {
            const v = i / 10;
            const x = xScale(v);
            const cls = v === 0 ? 'overview-axis-line' : Math.abs(v) === 0.5 ? 'overview-atm-line' : 'overview-gridline';
            el('line', { x1: x, y1: topMargin, x2: x, y2: topMargin + chartHeight, class: cls });
            el('text', { x, y: topMargin + chartHeight + 18, class: 'overview-tick-label', 'text-anchor': 'middle' }, v.toFixed(1));
        }
        el('text', { x: xScale(0.5), y: topMargin + chartHeight + 18, class: 'overview-atm-label', 'text-anchor': 'middle' }, 'ATM');
        el('text', { x: xScale(-0.5), y: topMargin + chartHeight + 18, class: 'overview-atm-label', 'text-anchor': 'middle' }, 'ATM');
        el('text', { x: 8, y: topMargin - 14, class: 'overview-axis-title' }, 'Expiry');
        el('text', { x: labelWidth + chartWidth / 2, y: svgHeight - 6, class: 'overview-axis-title', 'text-anchor': 'middle' }, 'Options delta');

        // Per expiry: coverage bands, delta jumps, points
        const byDate = new Map();
        points.forEach(p => {
            if (!byDate.has(p.ContractDate)) byDate.set(p.ContractDate, []);
            byDate.get(p.ContractDate).push(p);
        });
        const radius = Math.max(2, Math.min(4, chartWidth / 400));
        const jumps = [];
        const dates = [...byDate.keys()].sort();
        dates.forEach(date => {
            const pts = byDate.get(date);
            const y = yScale(pts[0].dtm);
            const color = CYCLE_COLORS[(pts.find(p => p.ContractCycle !== 'FLEXIBLE')?.ContractCycle || '').toUpperCase()] || DEFAULT_CYCLE_COLOR;
            ['P', 'C'].forEach(side => {
                const ds = pts.filter(p => p.CallPut === side && p.ContractCycle !== 'FLEXIBLE').map(p => p.delta);
                if (ds.length > 1) {
                    el('line', { x1: xScale(Math.min(...ds)), y1: y, x2: xScale(Math.max(...ds)), y2: y, stroke: color, class: 'overview-coverage-band' });
                }
            });

            const calls = pts.filter(p => p.CallPut === 'C' && p.ContractCycle !== 'FLEXIBLE').map(p => ({ strike: p.strike, delta: p.delta }));
            const steps = this._stepsByDate.get(formatDateToDDMMYYYY(date)) || [];
            // A jump that is also a hole in the strike ladder gets the same proposal as in the Strike Window
            const ladderGaps = findLadderGaps([...new Set(calls.map(c => c.strike))].sort((a, b) => a - b));
            findDeltaJumps(calls, DELTA_JUMP_THRESHOLD).forEach(j => {
                const gap = ladderGaps.find(g => g.lo === j.lo && g.hi === j.hi);
                if (gap) {
                    jumps.push({ ...j, date, y, step: gap.step, start: gap.start, end: gap.end });
                    return;
                }
                const step = refineStep(j.hi - j.lo, steps);
                if (!step || j.hi - j.lo <= step) return; // nothing listable in between
                jumps.push({ ...j, date, y, step, start: j.lo + step, end: j.hi - step });
            });
        });

        jumps.forEach(j => {
            // Draw on the out-of-the-money side: calls when the call delta is below 0.5, otherwise the mirrored puts
            const otmCalls = (j.deltaLo + j.deltaHi) / 2 < 0.5;
            const x1 = xScale(otmCalls ? j.deltaHi : j.deltaLo - 1);
            const x2 = xScale(otmCalls ? j.deltaLo : j.deltaHi - 1);
            const rect = el('rect', {
                x: Math.min(x1, x2), y: j.y - 6, width: Math.max(Math.abs(x2 - x1), 4), height: 12, rx: 3,
                class: 'overview-gap', tabindex: 0, role: 'button'
            });
            const count = Math.round((j.end - j.start) / j.step) + 1;
            const text = [
                `Delta jump ${j.size.toFixed(2)} between strikes ${j.lo.toLocaleString('en-US')} and ${j.hi.toLocaleString('en-US')}`,
                `Contract date: ${formatDateToDDMMYYYY(j.date)}`,
                `Suggested: ${j.start.toLocaleString('en-US')} – ${j.end.toLocaleString('en-US')} (${count} strike${count === 1 ? '' : 's'} at step ${j.step})`,
                'Click to request these strikes'
            ].join('\n');
            rect.setAttribute('aria-label', text.replace(/\n/g, '. '));
            this._addTooltip(rect, text);
            const standardStrikes = [...new Set(rows.filter(r => r.ContractCycle !== 'FLEXIBLE').map(r => Number(r.Strike)))].sort((a, b) => a - b);
            const open = () => this.openRequestStrikesModal(product, dates, standardStrikes, { date: j.date, start: j.start, end: j.end, distance: j.step });
            rect.addEventListener('click', open);
            rect.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });

        points.forEach(p => {
            const cycle = (p.ContractCycle || '').toUpperCase();
            const isFlex = cycle === 'FLEXIBLE';
            const circle = el('circle', {
                cx: xScale(p.delta), cy: yScale(p.dtm), r: isFlex ? Math.max(radius, 4) : radius,
                fill: CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR,
                class: isFlex ? 'overview-point overview-point-flex' : 'overview-point'
            });
            this._addTooltip(circle, [
                `Strike: ${p.strike.toLocaleString('en-US')} ${p.CallPut === 'P' ? 'Put' : p.CallPut === 'C' ? 'Call' : ''}`.trim(),
                `Options Delta: ${p.Delta}`,
                `Contract Date: ${formatDateToDDMMYYYY(p.ContractDate)} (${p.dtm}d)`,
                `Contract Cycle: ${p.ContractCycle || '-'}`
            ].join('\n'));
        });

        const legend = this._buildLegend(allPoints, [
            ['overview-legend-swatch-atm', 'ATM (Δ ±0.50)'],
            ...(jumps.length ? [['overview-legend-swatch-gap', `Delta jump > ${DELTA_JUMP_THRESHOLD.toFixed(2)} (click to request)`]] : [])
        ]);

        const fmtRange = (arr) => arr.length ? `${Math.min(...arr).toFixed(2)} to ${Math.max(...arr).toFixed(2)}` : '–';
        const std = points.filter(p => p.ContractCycle !== 'FLEXIBLE');
        const callDeltas = std.filter(p => p.CallPut === 'C').map(p => p.delta);
        const putDeltas = std.filter(p => p.CallPut === 'P').map(p => p.delta);
        const stats = [
            `${dates.length} contract dates`,
            `${callDeltas.length.toLocaleString('en-US')} calls · ${putDeltas.length.toLocaleString('en-US')} puts`,
            ...(callDeltas.length ? [`Calls Δ ${fmtRange(callDeltas)}`] : []),
            ...(putDeltas.length ? [`Puts Δ ${fmtRange(putDeltas)}`] : []),
            ...(jumps.length ? [{ text: `${jumps.length} delta jump${jumps.length === 1 ? '' : 's'}`, warn: true }] : [])
        ];
        const reqStrikes = [...new Set(allPoints.filter(p => p.ContractCycle !== 'FLEXIBLE').map(p => p.strike))].sort((a, b) => a - b);
        const header = this._createChartHeader(this._productTitle(product), product, dates, reqStrikes, stats);

        this.els.content.innerHTML = '';
        this.els.content.appendChild(header);
        this.els.content.appendChild(legend);
        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overview-chart-scroll';
        scrollWrap.appendChild(svg);
        this.els.content.appendChild(scrollWrap);

        if (window.feather) window.feather.replace();
    }

    // 3D View: isometric projection with Strike x Days-to-Maturity as the floor plane and Options Delta as elevation.
    _render3DChart(rows, product) {
        const points = rows
            .map(r => ({
                ...r,
                strike: Number(r.Strike),
                delta: Number(r.Delta),
                dtm: this._daysToMaturity(r.ExpirationDate)
            }))
            .filter(p => Number.isFinite(p.strike) && Number.isFinite(p.delta) && !!p.ContractDate);

        if (points.length === 0) {
            this.els.content.innerHTML = this._emptyState(
                'No data for 3D view',
                `No contracts with Strike, Options Delta, and a Contract Date were found for ${product}.`
            );
            if (window.feather) window.feather.replace();
            return;
        }

        const strikes = points.map(p => p.strike);
        const minStrike = Math.min(...strikes);
        const maxStrike = Math.max(...strikes);
        const strikePad = (maxStrike - minStrike) * 0.08 || 1;
        const domainMinStrike = Math.max(0, minStrike - strikePad);
        const domainMaxStrike = maxStrike + strikePad;

        // Contract Date ordered ascending: short-dated at the bottom (world Y = 0), rising for later dates.
        const dates = [...new Set(points.map(p => p.ContractDate))].sort();

        const deltas = points.map(p => p.delta);
        const minDelta = Math.min(...deltas);
        const maxDelta = Math.max(...deltas);
        const deltaPad = (maxDelta - minDelta) * 0.08 || 0.1;
        const domainMinDelta = minDelta - deltaPad;
        const domainMaxDelta = maxDelta + deltaPad;

        // Cached so drag-to-rotate can re-project without refetching or re-filtering the data.
        this._chart3D = {
            points,
            product,
            domainMinStrike, domainMaxStrike,
            dates,
            domainMinDelta, domainMaxDelta
        };
        if (!this.rotation3D) this.rotation3D = { azimuth: Math.PI / 4, pitch: Math.PI / 6 };
        if (!this.zoom3D) this.zoom3D = 1;
        if (!this.pan3D) this.pan3D = { x: 0, y: 0 };
        const legend = this._buildLegend(points, [], 'Drag to rotate · Shift+drag to pan · Scroll or +/− to zoom · Arrow keys rotate');

        const deltas3 = points.filter(p => !this.hiddenCycles.has((p.ContractCycle || '').toUpperCase())).map(p => p.delta);
        const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
        const stats = [
            `${dates.length} contract dates`,
            `${points.length.toLocaleString('en-US')} contracts`,
            `Strike ${fmtNum(minStrike)} – ${fmtNum(maxStrike)}`,
            ...(deltas3.length ? [`Δ ${Math.min(...deltas3).toFixed(2)} to ${Math.max(...deltas3).toFixed(2)}`] : [])
        ];
        const reqStrikes = [...new Set(points.filter(p => p.ContractCycle !== 'FLEXIBLE').map(p => p.strike))].sort((a, b) => a - b);
        const header = this._createChartHeader(this._productTitle(product), product, dates, reqStrikes, stats);

        this.els.content.innerHTML = '';
        this.els.content.appendChild(header);
        this.els.content.appendChild(legend);

        const chartWrap = document.createElement('div');
        chartWrap.className = 'overview-3d-wrap';
        this.els.content.appendChild(chartWrap);

        const controls = document.createElement('div');
        controls.className = 'overview-3d-controls';
        controls.innerHTML = `
            <button type="button" class="icon-btn" data-action="zoom-in" title="Zoom in" aria-label="Zoom in"><i data-feather="plus"></i></button>
            <button type="button" class="icon-btn" data-action="zoom-out" title="Zoom out" aria-label="Zoom out"><i data-feather="minus"></i></button>
            <button type="button" class="icon-btn" data-action="reset" title="Reset view" aria-label="Reset 3D view"><i data-feather="refresh-ccw"></i></button>
        `;
        controls.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'zoom-in') this._zoom3D(1.2);
            else if (btn.dataset.action === 'zoom-out') this._zoom3D(1 / 1.2);
            else if (btn.dataset.action === 'reset') this._reset3DView();
        });
        chartWrap.appendChild(controls);

        // Camera presets: each flattens one axis so a 2D relationship can be read exactly
        const presets = document.createElement('div');
        presets.className = 'overview-3d-presets';
        presets.setAttribute('role', 'group');
        presets.setAttribute('aria-label', 'Camera presets');
        Object.entries(VIEW_PRESETS_3D).forEach(([key, preset]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = preset.label;
            btn.title = preset.title;
            btn.dataset.preset = key;
            btn.addEventListener('click', () => {
                this.rotation3D = { azimuth: preset.azimuth, pitch: preset.pitch };
                this.pan3D = { x: 0, y: 0 };
                this._redraw3DScene();
            });
            presets.appendChild(btn);
        });
        chartWrap.appendChild(presets);

        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overview-chart-scroll overview-3d-scroll';
        chartWrap.appendChild(scrollWrap);
        this._chart3DScrollWrap = scrollWrap;
        scrollWrap.tabIndex = 0;
        scrollWrap.setAttribute('aria-label', '3D chart: arrow keys rotate, plus and minus zoom, 0 resets');
        this._bind3DDrag(scrollWrap);
        this._redraw3DScene();

        if (window.feather) window.feather.replace();
    }

    _zoom3D(factor) {
        this.zoom3D = Math.min(4, Math.max(0.3, this.zoom3D * factor));
        this._redraw3DScene();
    }

    _reset3DView() {
        this.rotation3D = { azimuth: Math.PI / 4, pitch: Math.PI / 6 };
        this.zoom3D = 1;
        this.pan3D = { x: 0, y: 0 };
        this._redraw3DScene();
    }

    // Re-projects the cached 3D data at the current rotation and swaps the <svg> in place (header/legend untouched).
    _redraw3DScene() {
        if (!this._chart3DScrollWrap || !this._chart3D) return;
        const svg = this._build3DSvg();
        this._chart3DScrollWrap.innerHTML = '';
        this._chart3DScrollWrap.appendChild(svg);
    }

    _bind3DDrag(scrollWrap) {
        let dragging = false;
        let panning = false;
        let startX = 0, startY = 0, startAzimuth = 0, startPitch = 0;
        let startPanX = 0, startPanY = 0;
        let rafScheduled = false;
        const minPitch = 0.05;
        const maxPitch = Math.PI / 2 - 0.05;

        const scheduleRedraw = () => {
            if (rafScheduled) return;
            rafScheduled = true;
            requestAnimationFrame(() => {
                rafScheduled = false;
                this._redraw3DScene();
            });
        };

        scrollWrap.addEventListener('pointerdown', (e) => {
            panning = e.shiftKey || e.button === 1 || e.button === 2;
            dragging = !panning;
            startX = e.clientX;
            startY = e.clientY;
            startAzimuth = this.rotation3D.azimuth;
            startPitch = this.rotation3D.pitch;
            startPanX = this.pan3D.x;
            startPanY = this.pan3D.y;
            scrollWrap.setPointerCapture(e.pointerId);
            scrollWrap.classList.add('dragging');
            e.preventDefault();
        });
        scrollWrap.addEventListener('pointermove', (e) => {
            if (!dragging && !panning) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (panning) {
                this.pan3D.x = startPanX + dx;
                this.pan3D.y = startPanY + dy;
            } else {
                const sensitivity = 0.01;
                this.rotation3D.azimuth = startAzimuth + dx * sensitivity;
                this.rotation3D.pitch = Math.min(maxPitch, Math.max(minPitch, startPitch - dy * sensitivity));
            }
            scheduleRedraw();
        });
        const endDrag = () => {
            dragging = false;
            panning = false;
            scrollWrap.classList.remove('dragging');
        };
        scrollWrap.addEventListener('pointerup', endDrag);
        scrollWrap.addEventListener('pointercancel', endDrag);
        scrollWrap.addEventListener('contextmenu', (e) => e.preventDefault());
        scrollWrap.addEventListener('keydown', (e) => {
            const step = 0.1;
            const r = this.rotation3D;
            if (e.key === 'ArrowLeft') r.azimuth -= step;
            else if (e.key === 'ArrowRight') r.azimuth += step;
            else if (e.key === 'ArrowUp') r.pitch = Math.min(maxPitch, r.pitch + step);
            else if (e.key === 'ArrowDown') r.pitch = Math.max(minPitch, r.pitch - step);
            else if (e.key === '+' || e.key === '=') this.zoom3D = Math.min(4, this.zoom3D * 1.2);
            else if (e.key === '-') this.zoom3D = Math.max(0.3, this.zoom3D / 1.2);
            else if (e.key === '0') { this._reset3DView(); e.preventDefault(); return; }
            else return;
            e.preventDefault();
            scheduleRedraw();
        });
        scrollWrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom3D = Math.min(4, Math.max(0.3, this.zoom3D * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            scheduleRedraw();
        }, { passive: false });
    }

    _build3DSvg() {
        const d = this._chart3D;
        const hidden = this.hiddenCycles || new Set();
        const points = hidden.size > 0
            ? d.points.filter(p => !hidden.has((p.ContractCycle || '').toUpperCase()))
            : d.points;
        const { azimuth, pitch } = this.rotation3D;

        const nStrike = (s) => (s - d.domainMinStrike) / (d.domainMaxStrike - d.domainMinStrike);
        const nDate = (date) => d.dates.length > 1 ? d.dates.indexOf(date) / (d.dates.length - 1) : 0;
        const nDelta = (v) => (v - d.domainMinDelta) / (d.domainMaxDelta - d.domainMinDelta);

        const containerWidth = Math.max(this.els.container.clientWidth, 300);
        const reservedHeight = 110;
        const containerHeight = Math.max(this.els.container.clientHeight - reservedHeight, 300);
        const planeSize = Math.max(Math.min(containerWidth - 100, containerHeight - 60), 240);
        // Same magnitude as planeSize so Delta/Strike/Contract Date form a cube rather than a flattened box.
        const elevationScale = planeSize;

        // X = Delta (puts negative, calls positive), Z = Strike (depth), Y = Contract Date (height, short-dated at the bottom).
        const worldX = (delta) => nDelta(delta) * planeSize - planeSize / 2;
        const worldZ = (s) => nStrike(s) * planeSize - planeSize / 2;
        const worldY = (date) => nDate(date) * elevationScale;

        // Orthographic projection: azimuth spins around the vertical (contract date) axis, pitch tilts the camera.
        const project = (x, y, z) => {
            const xr = x * Math.cos(azimuth) + z * Math.sin(azimuth);
            const zr = -x * Math.sin(azimuth) + z * Math.cos(azimuth);
            // depth: larger = closer to the camera
            return { sx: xr, sy: y * Math.cos(pitch) - zr * Math.sin(pitch), depth: y * Math.sin(pitch) + zr * Math.cos(pitch) };
        };

        // Floor corners (earliest Contract Date, i.e. world Y = 0) span Delta x Strike.
        const corners = [
            [d.domainMinDelta, d.domainMinStrike],
            [d.domainMaxDelta, d.domainMinStrike],
            [d.domainMaxDelta, d.domainMaxStrike],
            [d.domainMinDelta, d.domainMaxStrike]
        ].map(([delta, s]) => project(worldX(delta), 0, worldZ(s)));

        const deltaStep = this._niceTickStep(0.1, d.domainMaxDelta - d.domainMinDelta, 8);
        const firstDeltaTick = Math.ceil(d.domainMinDelta / deltaStep) * deltaStep;
        const deltaAxisTicks = [];
        for (let v = firstDeltaTick; v <= d.domainMaxDelta; v += deltaStep) deltaAxisTicks.push(v);
        const deltaGrid = deltaAxisTicks.map(v => ({
            value: v,
            p1: project(worldX(v), 0, worldZ(d.domainMinStrike)),
            p2: project(worldX(v), 0, worldZ(d.domainMaxStrike))
        }));

        const strikeStep = this._niceTickStep(this._strikeStep([...new Set(points.map(p => p.strike))].sort((a, b) => a - b)), d.domainMaxStrike - d.domainMinStrike, 6);
        const firstStrikeTick = Math.ceil(d.domainMinStrike / strikeStep) * strikeStep;
        const strikeTicks = [];
        for (let s = firstStrikeTick; s <= d.domainMaxStrike; s += strikeStep) strikeTicks.push(s);
        const strikeGrid = strikeTicks.map(s => ({
            value: s,
            p1: project(worldX(d.domainMinDelta), 0, worldZ(s)),
            p2: project(worldX(d.domainMaxDelta), 0, worldZ(s))
        }));

        const dateBaseX = worldX(d.domainMinDelta);
        const dateBaseZ = worldZ(d.domainMinStrike);
        const dateTicks = this._sampleTicks(d.dates, 8).map(date => ({
            value: date,
            p: project(dateBaseX, worldY(date), dateBaseZ)
        }));
        const dateAxisTop = project(dateBaseX, elevationScale, dateBaseZ);
        const dateAxisBase = project(dateBaseX, 0, dateBaseZ);

        const deltaTitlePos = project(worldX((d.domainMinDelta + d.domainMaxDelta) / 2), 0, worldZ(d.domainMaxStrike));
        const strikeTitlePos = project(worldX(d.domainMaxDelta), 0, worldZ((d.domainMinStrike + d.domainMaxStrike) / 2));

        const projectedPoints = points.map(p => ({
            p,
            proj: project(worldX(p.delta), worldY(p.ContractDate), worldZ(p.strike))
        }));

        // Fit whatever is currently visible into the available viewport, regardless of rotation.
        const all = [
            ...corners,
            ...deltaGrid.flatMap(g => [g.p1, g.p2]),
            ...strikeGrid.flatMap(g => [g.p1, g.p2]),
            ...dateTicks.map(t => t.p),
            dateAxisTop, dateAxisBase,
            deltaTitlePos, strikeTitlePos,
            ...projectedPoints.map(pp => pp.proj)
        ];
        const xs = all.map(a => a.sx);
        const ys = all.map(a => a.sy);
        const minSx = Math.min(...xs), maxSx = Math.max(...xs);
        const maxSy = Math.max(...ys), minSy = Math.min(...ys);
        const bboxW = Math.max(maxSx - minSx, 1);
        const bboxH = Math.max(maxSy - minSy, 1);

        const padding = 60;
        const labelRoom = 80; // contract date labels are drawn left of the vertical axis
        const availW = Math.max(containerWidth - padding * 2 - labelRoom, 100);
        const availH = Math.max(containerHeight - padding * 2, 100);
        const fitScale = Math.min(availW / bboxW, availH / bboxH, 1.4);
        const scale = fitScale * (this.zoom3D || 1);
        const centerSx = (minSx + maxSx) / 2;
        const centerSy = (minSy + maxSy) / 2;
        const svgWidth = containerWidth;
        const svgHeight = containerHeight;
        const panX = this.pan3D?.x || 0;
        const panY = this.pan3D?.y || 0;
        const toSvg = (proj) => ({
            x: svgWidth / 2 + labelRoom / 2 + panX + (proj.sx - centerSx) * scale,
            y: svgHeight / 2 + panY - (proj.sy - centerSy) * scale
        });

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', svgHeight);
        svg.classList.add('overview-chart-svg');

        const floorPts = corners.map(c => toSvg(c));
        const floor = document.createElementNS(svgNS, 'polygon');
        floor.setAttribute('points', floorPts.map(c => `${c.x},${c.y}`).join(' '));
        floor.setAttribute('class', 'overview-3d-floor');
        svg.appendChild(floor);

        // An axis seen edge-on (e.g. strike in the front preset) collapses: hide its labels instead of stacking them
        const spacing = (grid) => grid.length > 1 ? Math.hypot(toSvg(grid[1].p1).x - toSvg(grid[0].p1).x, toSvg(grid[1].p1).y - toSvg(grid[0].p1).y) : Infinity;
        const showDeltaLabels = spacing(deltaGrid) >= 28;
        const showStrikeLabels = spacing(strikeGrid) >= 18;
        const showDateLabels = dateTicks.length < 2 || Math.abs(toSvg(dateTicks[1].p).y - toSvg(dateTicks[0].p).y) >= 12;

        deltaGrid.forEach(g => {
            const p1 = toSvg(g.p1), p2 = toSvg(g.p2);
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
            line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
            line.setAttribute('class', 'overview-3d-gridline');
            svg.appendChild(line);

            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', p1.x);
            label.setAttribute('y', p1.y + 14);
            label.setAttribute('class', 'overview-tick-label');
            label.setAttribute('text-anchor', 'middle');
            label.textContent = g.value.toFixed(2);
            if (showDeltaLabels) svg.appendChild(label);
        });

        strikeGrid.forEach(g => {
            const p1 = toSvg(g.p1), p2 = toSvg(g.p2);
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
            line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
            line.setAttribute('class', 'overview-3d-gridline');
            svg.appendChild(line);

            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', p1.x - 6);
            label.setAttribute('y', p1.y + 4);
            label.setAttribute('class', 'overview-date-label');
            label.setAttribute('text-anchor', 'end');
            label.textContent = Math.round(g.value).toLocaleString('en-US');
            if (showStrikeLabels) svg.appendChild(label);
        });

        const deltaTitleSvg = toSvg(deltaTitlePos);
        const deltaTitle = document.createElementNS(svgNS, 'text');
        deltaTitle.setAttribute('x', deltaTitleSvg.x);
        deltaTitle.setAttribute('y', deltaTitleSvg.y - 10);
        deltaTitle.setAttribute('class', 'overview-axis-title');
        deltaTitle.setAttribute('text-anchor', 'middle');
        deltaTitle.textContent = 'Delta';
        if (showDeltaLabels) svg.appendChild(deltaTitle);

        const strikeTitleSvg = toSvg(strikeTitlePos);
        const strikeTitle = document.createElementNS(svgNS, 'text');
        strikeTitle.setAttribute('x', strikeTitleSvg.x + 10);
        strikeTitle.setAttribute('y', strikeTitleSvg.y);
        strikeTitle.setAttribute('class', 'overview-axis-title');
        strikeTitle.textContent = 'Strike';
        if (showStrikeLabels) svg.appendChild(strikeTitle);

        dateTicks.forEach(tick => {
            const p = toSvg(tick.p);
            const tickLine = document.createElementNS(svgNS, 'line');
            tickLine.setAttribute('x1', p.x - 6); tickLine.setAttribute('y1', p.y);
            tickLine.setAttribute('x2', p.x); tickLine.setAttribute('y2', p.y);
            tickLine.setAttribute('class', 'overview-3d-gridline');
            svg.appendChild(tickLine);

            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', p.x - 10);
            label.setAttribute('y', p.y + 4);
            label.setAttribute('class', 'overview-date-label');
            label.setAttribute('text-anchor', 'end');
            label.textContent = formatDateToDDMMYYYY(tick.value);
            if (showDateLabels) svg.appendChild(label);
        });

        const axisBaseSvg = toSvg(dateAxisBase);
        const axisTopSvg = toSvg(dateAxisTop);
        const dateAxisLine = document.createElementNS(svgNS, 'line');
        dateAxisLine.setAttribute('x1', axisBaseSvg.x); dateAxisLine.setAttribute('y1', axisBaseSvg.y);
        dateAxisLine.setAttribute('x2', axisTopSvg.x); dateAxisLine.setAttribute('y2', axisTopSvg.y);
        dateAxisLine.setAttribute('class', 'overview-3d-gridline');
        svg.appendChild(dateAxisLine);
        const dateTitle = document.createElementNS(svgNS, 'text');
        dateTitle.setAttribute('x', axisTopSvg.x - 10);
        dateTitle.setAttribute('y', axisTopSvg.y - 10);
        dateTitle.setAttribute('class', 'overview-axis-title');
        dateTitle.setAttribute('text-anchor', 'end');
        dateTitle.textContent = 'Contract date';
        if (showDateLabels) svg.appendChild(dateTitle);

        // Points, sorted so ones further from the camera draw first (painter's algorithm) and fade with distance.
        const depths = projectedPoints.map(pp => pp.proj.depth);
        const minDepth = Math.min(...depths);
        const depthRange = Math.max(...depths) - minDepth || 1;
        const radius = Math.max(2.2, Math.min(5, 6.5 - Math.log10(Math.max(points.length, 1)))) * Math.sqrt(this.zoom3D || 1);
        projectedPoints
            .slice()
            .sort((a, b) => a.proj.depth - b.proj.depth)
            .forEach(({ p, proj }) => {
                const top = toSvg(proj);
                const cycle = (p.ContractCycle || '').toUpperCase();
                const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
                const isFlex = cycle === 'FLEXIBLE';

                const circle = document.createElementNS(svgNS, 'circle');
                circle.setAttribute('cx', top.x);
                circle.setAttribute('cy', top.y);
                circle.setAttribute('r', isFlex ? Math.max(radius, 4) : radius);
                circle.setAttribute('fill', color);
                circle.setAttribute('class', isFlex ? 'overview-point overview-point-flex' : 'overview-point');
                circle.style.opacity = (0.35 + 0.65 * (proj.depth - minDepth) / depthRange).toFixed(2);
                svg.appendChild(circle);

                this._addTooltip(circle, [
                    `Strike: ${p.strike.toLocaleString('en-US')} ${p.CallPut === 'P' ? 'Put' : p.CallPut === 'C' ? 'Call' : ''}`.trim(),
                    `Options Delta: ${p.Delta}`,
                    `Contract Date: ${formatDateToDDMMYYYY(p.ContractDate)}${Number.isFinite(p.dtm) ? ` (${p.dtm}d)` : ''}`,
                    `Contract Cycle: ${p.ContractCycle || '-'}`
                ].join('\n'));
            });

        return svg;
    }
}
