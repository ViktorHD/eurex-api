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

export function generateStrikesCsv(symbol, contractDateFormatted, startStrike, endStrike, distance) {
    const start = Number(startStrike);
    const end = Number(endStrike);
    const step = Number(distance);
    if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(step) || step <= 0 || start > end) {
        throw new Error('Invalid strike range or distance');
    }
    const lines = ['Symbol;ContractDate;StrikePrice'];
    let current = start;
    let count = 0;
    const maxCount = 10000;
    while (current <= end + 1e-9 && count < maxCount) {
        const strikeVal = Number(current.toFixed(6));
        lines.push(`${symbol};${contractDateFormatted};${strikeVal}`);
        current += step;
        count++;
    }
    return lines.join('\r\n');
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

        this.bindEvents();
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
        const form = document.getElementById('requestStrikesForm');

        if (modal) {
            const closeModal = () => modal.classList.add('hidden');
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });

            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const symbol = document.getElementById('reqSymbol')?.value || '';
                    const contractDate = document.getElementById('reqContractDate')?.value || '';
                    const startStrike = document.getElementById('reqStartStrike')?.value;
                    const endStrike = document.getElementById('reqEndStrike')?.value;
                    const distance = document.getElementById('reqStrikeDistance')?.value;

                    try {
                        const csvContent = generateStrikesCsv(symbol, contractDate, startStrike, endStrike, distance);
                        const filename = `additional_strikes_${symbol}_${contractDate}.csv`;
                        downloadCsvFile(filename, csvContent);
                        closeModal();
                    } catch (err) {
                        alert(err.message || 'Error generating CSV');
                    }
                });
            }
        }
    }

    openRequestStrikesModal(product, rawDates, sortedStrikes) {
        const modal = document.getElementById('requestStrikesModal');
        if (!modal) return;

        const symbolInput = document.getElementById('reqSymbol');
        const dateSelect = document.getElementById('reqContractDate');
        const startInput = document.getElementById('reqStartStrike');
        const endInput = document.getElementById('reqEndStrike');
        const distanceInput = document.getElementById('reqStrikeDistance');
        const distanceHint = document.getElementById('reqDistanceHint');

        if (symbolInput) symbolInput.value = product || '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        if (distanceInput) distanceInput.value = '';

        const step = this._strikeStep(sortedStrikes || []);
        if (distanceHint) {
            distanceHint.textContent = step && Number.isFinite(step)
                ? `Default strike distance for ${product}: ${step}`
                : '';
        }

        if (dateSelect) {
            const formattedDates = [...new Set((rawDates || []).map(d => formatDateToDDMMYYYY(d)))].filter(Boolean);
            dateSelect.innerHTML = formattedDates
                .map(d => `<option value="${d}">${d}</option>`)
                .join('');
        }

        modal.classList.remove('hidden');
        if (window.feather) window.feather.replace();
    }

    _createChartHeader(titleText, product, dates, strikes) {
        const header = document.createElement('div');
        header.className = 'overview-chart-header';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = titleText;
        header.appendChild(titleSpan);

        if (product && strikes && strikes.length > 0) {
            const reqBtn = document.createElement('button');
            reqBtn.type = 'button';
            reqBtn.className = 'primary-btn';
            reqBtn.style.height = '32px';
            reqBtn.style.padding = '0 12px';
            reqBtn.style.fontSize = '0.75rem';
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
            this.tooltip.style.top = `${e.clientY + 15}px`;
            this.tooltip.style.left = `${e.clientX + 15}px`;
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
                .map(p => `<option value="${p.Product}">${p.Product} - ${p.Name || ''}</option>`)
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
            this.els.content.innerHTML = this._emptyState('Select a product', 'Choose an option product to view its strike window.');
            if (window.feather) window.feather.replace();
            return;
        }

        const isKnownOption = this.products.length === 0 || this.products.some(p => p.Product === product);
        if (!isKnownOption) {
            this.els.content.innerHTML = this._emptyState(
                'Not an option product',
                `"${product}" is not available in the options list. This view only supports option products (futures have no strike window).`
            );
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

            const contractRows = (response.Contracts.data || [])
                .filter(r => r.Strike !== null && r.Strike !== undefined)
                .map(r => ({
                    Strike: r.Strike,
                    ContractDate: r.ContractDate,
                    ContractCycle: (r.ContractCycle || '').toUpperCase(),
                    ExpirationDate: r.ExpirationDate,
                    RefPrice: r.PreviousDaySettlementPrice,
                    CallPut: (r.CallPut || '').toUpperCase(),
                    Delta: this._signedDelta(r.OptionsDelta, r.CallPut)
                }));

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
            this.els.content.innerHTML = `<div class="error-card"><p>${err.message}</p></div>`;
        } finally {
            this.els.loading.classList.add('hidden');
        }
    }

    _emptyState(title, message) {
        return `
        <div class="empty-state">
            <i data-feather="grid"></i>
            <div>
                <h3>${title}</h3>
                <p>${message}</p>
            </div>
        </div>`;
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

    _renderChart(normalRows, lepoRows, product, allRows) {
        const viewMode = this.els.viewSelect?.value || 'strike';
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

        const dates = [...new Set([...normalRows, ...lepoRows].map(r => r.ContractDate))].sort();
        const strikes = [...new Set(normalRows.map(r => Number(r.Strike)))].sort((a, b) => a - b);
        const domainCandidates = [...strikes, ...refPrices];
        const minStrike = Math.min(...domainCandidates);
        const maxStrike = Math.max(...domainCandidates);
        const strikePad = (maxStrike - minStrike) * 0.05 || 1;
        // Strikes are never negative, so the axis never extends below 0.
        const domainMin = Math.max(0, minStrike - strikePad);
        const domainMax = maxStrike + strikePad;

        const rowHeight = 26;
        const labelWidth = 100;
        const topAxisHeight = 36;
        const containerWidth = Math.max(this.els.container.clientWidth, 300);
        const chartWidth = Math.max(containerWidth - labelWidth - 40, 150);
        const chartHeight = dates.length * rowHeight;
        const svgWidth = labelWidth + chartWidth + 20;
        const svgHeight = topAxisHeight + chartHeight + 10;

        const xScale = (strike) => labelWidth + ((strike - domainMin) / (domainMax - domainMin)) * chartWidth;
        const yScale = (date) => topAxisHeight + dates.indexOf(date) * rowHeight + rowHeight / 2;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', svgHeight);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('overview-chart-svg');

        // Row backgrounds + date labels
        dates.forEach((date, i) => {
            const y = topAxisHeight + i * rowHeight;
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('x', 0);
            rect.setAttribute('y', y);
            rect.setAttribute('width', svgWidth);
            rect.setAttribute('height', rowHeight);
            rect.setAttribute('class', i % 2 === 0 ? 'overview-row-even' : 'overview-row-odd');
            svg.appendChild(rect);

            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', 8);
            label.setAttribute('y', y + rowHeight / 2 + 4);
            label.setAttribute('class', 'overview-date-label');
            label.textContent = date;
            svg.appendChild(label);
        });

        // Vertical strike gridlines + top axis ticks, spaced to match the real strike increment.
        const baseStep = this._strikeStep(strikes);
        const tickStep = this._niceTickStep(baseStep, domainMax - domainMin);
        const firstTick = Math.ceil(domainMin / tickStep) * tickStep;
        for (let strike = firstTick; strike <= domainMax; strike += tickStep) {
            const x = xScale(strike);

            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', x);
            line.setAttribute('y1', topAxisHeight);
            line.setAttribute('x2', x);
            line.setAttribute('y2', svgHeight);
            line.setAttribute('class', 'overview-gridline');
            svg.appendChild(line);

            const tickLabel = document.createElementNS(svgNS, 'text');
            tickLabel.setAttribute('x', x);
            tickLabel.setAttribute('y', topAxisHeight - 14);
            tickLabel.setAttribute('class', 'overview-tick-label');
            tickLabel.setAttribute('text-anchor', 'middle');
            tickLabel.textContent = Math.round(strike).toLocaleString();
            svg.appendChild(tickLabel);
        }

        const axisTitle = document.createElementNS(svgNS, 'text');
        axisTitle.setAttribute('x', labelWidth + chartWidth / 2);
        axisTitle.setAttribute('y', 14);
        axisTitle.setAttribute('class', 'overview-axis-title');
        axisTitle.setAttribute('text-anchor', 'middle');
        axisTitle.textContent = 'Strike';
        svg.appendChild(axisTitle);

        // Contract points
        normalRows.forEach(r => {
            const cx = xScale(Number(r.Strike));
            const cy = yScale(r.ContractDate);
            const cycle = (r.ContractCycle || '').toUpperCase();
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            const delta = Number(r.Delta);
            const hasDelta = Number.isFinite(delta) && r.Delta !== null && r.Delta !== undefined;

            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', 5);
            circle.setAttribute('fill', color);
            circle.setAttribute('class', 'overview-point');
            svg.appendChild(circle);

            this._addTooltip(circle, [
                `Strike: ${r.Strike}`,
                `Contract Date: ${r.ContractDate}`,
                `Contract Cycle: ${r.ContractCycle || '-'}`,
                `Expiration: ${r.ExpirationDate || '-'}`,
                ...(hasDelta ? [`Options Delta: ${r.Delta}`] : []),
                // Contract name and Open Interest are only available for FlexibleContracts, not standard Contracts.
                ...(cycle === 'FLEXIBLE' && r.ContractName ? [`Contract: ${r.ContractName}`] : []),
                ...(cycle === 'FLEXIBLE' && r.OpenInterest !== null && r.OpenInterest !== undefined
                    ? [`Open Interest: ${r.OpenInterest}`]
                    : [])
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

            const marker = document.createElementNS(svgNS, 'line');
            marker.setAttribute('x1', x);
            marker.setAttribute('y1', y + 2);
            marker.setAttribute('x2', x);
            marker.setAttribute('y2', y + rowHeight - 2);
            marker.setAttribute('class', 'overview-ref-marker');
            svg.appendChild(marker);

            this._addTooltip(marker, [
                'Underlying Reference (LEPO settlement price)',
                `Price: ${lepo.RefPrice}`,
                `Contract Date: ${date}`
            ].join('\n'));
        });

        // Legend
        const legend = document.createElement('div');
        legend.className = 'overview-legend';
        const cyclesPresent = [...new Set(normalRows.map(r => (r.ContractCycle || '').toUpperCase()).filter(Boolean))];
        let legendHtml = cyclesPresent.map(cycle => {
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            return `<span class="overview-legend-item"><span class="overview-legend-swatch" style="background:${color}"></span>${cycle}</span>`;
        }).join('');
        if (lepoByDate.size > 0) {
            legendHtml += `<span class="overview-legend-item"><span class="overview-legend-swatch overview-legend-swatch-line"></span>Underlying Ref (LEPO)</span>`;
        }
        legend.innerHTML = legendHtml;

        const flexCount = normalRows.filter(r => r.ContractCycle === 'FLEXIBLE').length;
        const titleText = `${product} — ${normalRows.length} contracts across ${dates.length} contract dates`
            + (flexCount > 0 ? ` (includes ${flexCount} flexible)` : '');
        const header = this._createChartHeader(titleText, product, dates, strikes);

        this.els.content.innerHTML = '';
        this.els.content.appendChild(header);
        this.els.content.appendChild(legend);

        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overview-chart-scroll';
        scrollWrap.appendChild(svg);
        this.els.content.appendChild(scrollWrap);

        if (window.feather) window.feather.replace();
    }

    // Delta Coverage view: X-axis = Options Delta, Y-axis = days to maturity (ExpirationDate - ContractDate).
    _renderDeltaChart(rows, product) {
        const points = rows
            .map(r => ({
                ...r,
                delta: Number(r.Delta),
                dtm: this._daysToMaturity(r.ExpirationDate)
            }))
            .filter(p => Number.isFinite(p.delta) && Number.isFinite(p.dtm) && p.dtm >= 0);

        if (points.length === 0) {
            this.els.content.innerHTML = this._emptyState(
                'No delta data',
                `No contracts with both an Options Delta and a computable days-to-maturity were found for ${product}.`
            );
            if (window.feather) window.feather.replace();
            return;
        }

        const deltas = points.map(p => p.delta);
        const dtms = points.map(p => p.dtm);
        const minDelta = Math.min(...deltas);
        const maxDelta = Math.max(...deltas);
        const deltaPad = (maxDelta - minDelta) * 0.08 || 0.1;
        const domainMinX = minDelta - deltaPad;
        const domainMaxX = maxDelta + deltaPad;

        const minDtm = Math.min(...dtms);
        const maxDtm = Math.max(...dtms);
        const dtmPad = (maxDtm - minDtm) * 0.08 || 1;
        // Days to maturity is never negative.
        const domainMinY = Math.max(0, minDtm - dtmPad);
        const domainMaxY = maxDtm + dtmPad;

        const labelWidth = 70;
        const topMargin = 30;
        const bottomAxisHeight = 36;
        const containerWidth = Math.max(this.els.container.clientWidth, 300);
        const chartWidth = Math.max(containerWidth - labelWidth - 40, 150);
        // Use the full available pane height instead of a fixed size, minus room for the header/legend above the chart.
        const reservedHeight = 110;
        const containerHeight = Math.max(this.els.container.clientHeight, 300);
        const chartHeight = Math.max(containerHeight - reservedHeight - topMargin - bottomAxisHeight, 300);
        const svgWidth = labelWidth + chartWidth + 20;
        const svgHeight = topMargin + chartHeight + bottomAxisHeight;

        const xScale = (delta) => labelWidth + ((delta - domainMinX) / (domainMaxX - domainMinX)) * chartWidth;
        // Log scale: short maturities get proportionally more vertical space, long ones compress together.
        const logMinY = Math.log1p(domainMinY);
        const logMaxY = Math.log1p(domainMaxY);
        const yScale = (dtm) => topMargin + ((Math.log1p(dtm) - logMinY) / (logMaxY - logMinY)) * chartHeight;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', svgHeight);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('overview-chart-svg');

        // Horizontal gridlines + Y-axis (days to maturity) ticks, using natural day/week/month/year buckets on the log scale.
        const dtmTicks = this._dtmTicks(domainMinY, domainMaxY);
        dtmTicks.forEach(dtm => {
            const y = yScale(dtm);

            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', labelWidth);
            line.setAttribute('y1', y);
            line.setAttribute('x2', svgWidth);
            line.setAttribute('y2', y);
            line.setAttribute('class', 'overview-gridline');
            svg.appendChild(line);

            const tickLabel = document.createElementNS(svgNS, 'text');
            tickLabel.setAttribute('x', labelWidth - 8);
            tickLabel.setAttribute('y', y + 4);
            tickLabel.setAttribute('class', 'overview-date-label');
            tickLabel.setAttribute('text-anchor', 'end');
            tickLabel.textContent = Math.round(dtm).toLocaleString();
            svg.appendChild(tickLabel);
        });

        // Vertical gridlines + X-axis (delta) ticks
        const deltaStep = this._niceTickStep(0.1, domainMaxX - domainMinX, 10);
        const firstDeltaTick = Math.ceil(domainMinX / deltaStep) * deltaStep;
        for (let delta = firstDeltaTick; delta <= domainMaxX; delta += deltaStep) {
            const x = xScale(delta);

            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', x);
            line.setAttribute('y1', topMargin);
            line.setAttribute('x2', x);
            line.setAttribute('y2', topMargin + chartHeight);
            line.setAttribute('class', 'overview-gridline');
            svg.appendChild(line);

            const tickLabel = document.createElementNS(svgNS, 'text');
            tickLabel.setAttribute('x', x);
            tickLabel.setAttribute('y', topMargin + chartHeight + 20);
            tickLabel.setAttribute('class', 'overview-tick-label');
            tickLabel.setAttribute('text-anchor', 'middle');
            tickLabel.textContent = delta.toFixed(2);
            svg.appendChild(tickLabel);
        }

        const yAxisTitle = document.createElementNS(svgNS, 'text');
        yAxisTitle.setAttribute('x', 8);
        yAxisTitle.setAttribute('y', 16);
        yAxisTitle.setAttribute('class', 'overview-axis-title');
        yAxisTitle.setAttribute('text-anchor', 'start');
        yAxisTitle.textContent = 'Days to Maturity';
        svg.appendChild(yAxisTitle);

        const xAxisTitle = document.createElementNS(svgNS, 'text');
        xAxisTitle.setAttribute('x', labelWidth + chartWidth / 2);
        xAxisTitle.setAttribute('y', svgHeight - 4);
        xAxisTitle.setAttribute('class', 'overview-axis-title');
        xAxisTitle.setAttribute('text-anchor', 'middle');
        xAxisTitle.textContent = 'Options Delta';
        svg.appendChild(xAxisTitle);

        // Contract points
        points.forEach(p => {
            const cx = xScale(p.delta);
            const cy = yScale(p.dtm);
            const cycle = (p.ContractCycle || '').toUpperCase();
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;

            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', 5);
            circle.setAttribute('fill', color);
            circle.setAttribute('class', 'overview-point');
            svg.appendChild(circle);

            this._addTooltip(circle, [
                `Strike: ${p.Strike}`,
                `Call/Put: ${p.CallPut || '-'}`,
                `Options Delta: ${p.Delta}`,
                `Days to Maturity: ${p.dtm}`,
                `Contract Date: ${p.ContractDate}`,
                `Contract Cycle: ${p.ContractCycle || '-'}`,
                `Expiration: ${p.ExpirationDate || '-'}`
            ].join('\n'));
        });

        // Legend
        const legend = document.createElement('div');
        legend.className = 'overview-legend';
        const cyclesPresent = [...new Set(points.map(p => (p.ContractCycle || '').toUpperCase()).filter(Boolean))];
        legend.innerHTML = cyclesPresent.map(cycle => {
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            return `<span class="overview-legend-item"><span class="overview-legend-swatch" style="background:${color}"></span>${cycle}</span>`;
        }).join('');

        const deltaDates = [...new Set(points.map(p => p.ContractDate))].sort();
        const deltaStrikes = [...new Set(points.map(p => Number(p.Strike)))].sort((a, b) => a - b);
        const titleText = `${product} — ${points.length} contracts with delta coverage`;
        const header = this._createChartHeader(titleText, product, deltaDates, deltaStrikes);

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
        if (!this.hiddenCycles3D) this.hiddenCycles3D = new Set();

        // Legend + header only need to be built once per fetch; rotation only touches the SVG.
        const legend = document.createElement('div');
        legend.className = 'overview-legend';
        const cyclesPresent = [...new Set(points.map(p => (p.ContractCycle || '').toUpperCase()).filter(Boolean))];
        let legendHtml = cyclesPresent.map(cycle => {
            const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;
            const hidden = this.hiddenCycles3D.has(cycle) ? ' overview-legend-item-hidden' : '';
            return `<span class="overview-legend-item overview-legend-toggle${hidden}" data-cycle="${cycle}" title="Click to show/hide ${cycle}"><span class="overview-legend-swatch" style="background:${color}"></span>${cycle}</span>`;
        }).join('');
        legendHtml += `<span class="overview-legend-item overview-legend-note">X: Delta (puts left, calls right) &mdash; Depth: Strike &mdash; Height: Contract Date (short-dated low, rising) &mdash; drag to rotate, shift+drag to pan, scroll to zoom &mdash; click a cycle to toggle it</span>`;
        legend.innerHTML = legendHtml;
        legend.addEventListener('click', (e) => {
            const item = e.target.closest('.overview-legend-toggle');
            if (!item) return;
            const cycle = item.dataset.cycle;
            if (this.hiddenCycles3D.has(cycle)) this.hiddenCycles3D.delete(cycle);
            else this.hiddenCycles3D.add(cycle);
            item.classList.toggle('overview-legend-item-hidden');
            this._redraw3DScene();
        });

        const titleText = `${product} — ${points.length} contracts (3D: Delta \u00d7 Strike \u00d7 Contract Date)`;
        const header = this._createChartHeader(titleText, product, dates, strikes);

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

        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overview-chart-scroll overview-3d-scroll';
        chartWrap.appendChild(scrollWrap);
        this._chart3DScrollWrap = scrollWrap;
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
        scrollWrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom3D = Math.min(4, Math.max(0.3, this.zoom3D * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
            scheduleRedraw();
        }, { passive: false });
    }

    _build3DSvg() {
        const d = this._chart3D;
        const hidden = this.hiddenCycles3D || new Set();
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
            return { sx: xr, sy: y * Math.cos(pitch) - zr * Math.sin(pitch) };
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
        const availW = Math.max(containerWidth - padding * 2, 100);
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
            x: svgWidth / 2 + panX + (proj.sx - centerSx) * scale,
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
            svg.appendChild(label);
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
            label.textContent = Math.round(g.value).toLocaleString();
            svg.appendChild(label);
        });

        const deltaTitleSvg = toSvg(deltaTitlePos);
        const deltaTitle = document.createElementNS(svgNS, 'text');
        deltaTitle.setAttribute('x', deltaTitleSvg.x);
        deltaTitle.setAttribute('y', deltaTitleSvg.y - 10);
        deltaTitle.setAttribute('class', 'overview-axis-title');
        deltaTitle.setAttribute('text-anchor', 'middle');
        deltaTitle.textContent = 'Delta';
        svg.appendChild(deltaTitle);

        const strikeTitleSvg = toSvg(strikeTitlePos);
        const strikeTitle = document.createElementNS(svgNS, 'text');
        strikeTitle.setAttribute('x', strikeTitleSvg.x + 10);
        strikeTitle.setAttribute('y', strikeTitleSvg.y);
        strikeTitle.setAttribute('class', 'overview-axis-title');
        strikeTitle.textContent = 'Strike';
        svg.appendChild(strikeTitle);

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
            label.textContent = tick.value;
            svg.appendChild(label);
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
        dateTitle.textContent = 'Contract Date (height)';
        svg.appendChild(dateTitle);

        // Points, sorted so ones further from the camera draw first (simple painter's algorithm).
        projectedPoints
            .slice()
            .sort((a, b) => a.proj.sy - b.proj.sy)
            .forEach(({ p, proj }) => {
                const top = toSvg(proj);
                const cycle = (p.ContractCycle || '').toUpperCase();
                const color = CYCLE_COLORS[cycle] || DEFAULT_CYCLE_COLOR;

                const circle = document.createElementNS(svgNS, 'circle');
                circle.setAttribute('cx', top.x);
                circle.setAttribute('cy', top.y);
                circle.setAttribute('r', 5);
                circle.setAttribute('fill', color);
                circle.setAttribute('class', 'overview-point');
                svg.appendChild(circle);

                this._addTooltip(circle, [
                    `Strike: ${p.Strike}`,
                    `Call/Put: ${p.CallPut || '-'}`,
                    `Options Delta: ${p.Delta}`,
                    `Contract Date: ${p.ContractDate}`,
                    `Days to Maturity: ${Number.isFinite(p.dtm) ? p.dtm : '-'}`,
                    `Contract Cycle: ${p.ContractCycle || '-'}`,
                    `Expiration: ${p.ExpirationDate || '-'}`
                ].join('\n'));
            });

        return svg;
    }
}
