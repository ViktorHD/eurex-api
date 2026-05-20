export class TimelineManager {
    constructor(client, els) {
        this.client = client;
        this.els = els; // { container, content, loading, timezoneSelect, refreshBtn, filterInput }
        this.data = null;
        this.timezone = 'CET'; // Default
        this.filterText = '';
        this.tooltip = this._createTooltip();
        this.expandedGroups = new Set();

        this.bindEvents();
    }

    bindEvents() {
        this.els.timezoneSelect.addEventListener('change', () => {
            this.timezone = this.els.timezoneSelect.value;
            this.render();
        });
        this.els.refreshBtn.addEventListener('click', () => this.fetchAndRender());
        if (this.els.filterInput) {
            this.els.filterInput.addEventListener('input', (e) => {
                this.filterText = e.target.value.toLowerCase();
                this.render();
            });
        }
    }

    _createTooltip() {
        const div = document.createElement('div');
        div.className = 'timeline-tooltip hidden';
        document.body.appendChild(div);
        return div;
    }

    async fetchAndRender() {
        this.els.loading.classList.remove('hidden');
        this.els.content.innerHTML = '';

        const query = `
        query {
          ProductInfos {
            data {
              Product
              ProductType
              Name
            }
          }
          TradingHours {
            data {
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
            const response = await this.client.request(query, false);
            if (response.errors) throw new Error(response.errors[0].message);

            const products = response.ProductInfos.data;
            const hours = response.TradingHours.data;

            // Join data
            const hoursMap = new Map();
            hours.forEach(h => hoursMap.set(h.Product, h));

            const joined = products.map(p => ({
                ...p,
                hours: hoursMap.get(p.Product) || null
            })).filter(p => p.hours);

            // Group by ProductType
            this.data = joined.reduce((acc, curr) => {
                if (!acc[curr.ProductType]) acc[curr.ProductType] = [];
                acc[curr.ProductType].push(curr);
                return acc;
            }, {});

            this.render();
        } catch (err) {
            this.els.content.innerHTML = `<div class="error-card"><p>${err.message}</p></div>`;
        } finally {
            this.els.loading.classList.add('hidden');
        }
    }

    _timeToMinutes(timeStr) {
        if (!timeStr) return null;
        const [h, m, s] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

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

    render() {
        if (!this.data) return;

        this.els.content.innerHTML = '';

        // Header row
        const headerRow = document.createElement('div');
        headerRow.className = 'timeline-header-row';

        const corner = document.createElement('div');
        corner.className = 'timeline-corner-label';
        corner.textContent = 'Product Type / Name';
        headerRow.appendChild(corner);

        const grid = document.createElement('div');
        grid.className = 'timeline-grid';

        // Background for labels area to ensure they are visible on sticky
        const labelsBg = document.createElement('div');
        labelsBg.className = 'timeline-labels-bg';
        grid.appendChild(labelsBg);

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
        headerRow.appendChild(grid);
        this.els.content.appendChild(headerRow);

        const groupNames = Object.keys(this.data).sort();
        groupNames.forEach(name => {
            let group = this.data[name];

            // Apply filtering
            if (this.filterText) {
                group = group.filter(p => p.Product.toLowerCase().includes(this.filterText) || p.Name.toLowerCase().includes(this.filterText));
            }

            if (group.length === 0) return;

            const isExpanded = this.expandedGroups.has(name) || this.filterText !== '';

            // Representing the group as a whole
            if (!this.filterText) {
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

        if (window.feather) window.feather.replace();
    }

    _renderGroupRow(parent, name, group, isExpanded) {
        const row = document.createElement('div');
        row.className = 'timeline-row timeline-group-row';
        row.addEventListener('click', () => {
            if (this.expandedGroups.has(name)) this.expandedGroups.delete(name);
            else this.expandedGroups.add(name);
            this.render();
        });

        const label = document.createElement('div');
        label.className = 'timeline-product-label group-label';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = `${name} (${group.length})`;
        label.appendChild(labelSpan);

        label.title = `${name} (${group.length} Products)`;
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
                type: 'continuous',
                label: 'Trading Range'
            });
        }

        row.appendChild(barContainer);
        parent.appendChild(row);
    }

    _renderProductDetails(parent, product) {
        // Main row with Product name and CLOB
        const clobRow = document.createElement('div');
        clobRow.className = 'timeline-row';

        const label = document.createElement('div');
        label.className = 'timeline-product-label';
        label.textContent = product.Product;
        label.title = product.Name;
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
                this._addMarkerToContainer(clobContainer, product.hours.LTDBook, 'ltd-book', 'LTD Book');
            }
        }

        clobRow.appendChild(clobContainer);
        parent.appendChild(clobRow);

        // TES Row
        const tesRow = document.createElement('div');
        tesRow.className = 'timeline-row sub-row';

        const tesLabel = document.createElement('div');
        tesLabel.className = 'timeline-product-label';
        tesLabel.textContent = 'TES';
        tesRow.appendChild(tesLabel);

        const tesContainer = document.createElement('div');
        tesContainer.className = 'timeline-bar-container';

        if (product.hours) {
            if (product.hours.StartTES && product.hours.EndTES) {
                this._addPhaseToContainer(tesContainer, { start: product.hours.StartTES, end: product.hours.EndTES, type: 'tes', label: 'TES' });
            }
            // LTD TES Marker
            if (product.hours.LTDTES) {
                this._addMarkerToContainer(tesContainer, product.hours.LTDTES, 'ltd-tes', 'LTD TES');
            }
        }

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
                    this._addTooltip(bar2, `${phase.label}: 00:00 - ${endConverted}`);
                    container.appendChild(bar2);
                }

                bar.style.left = `${left}%`;
                bar.style.width = `${width}%`;
                this._addTooltip(bar, `${phase.label}: ${startConverted} - ${endConverted}`);
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

    _addTooltip(el, text) {
        el.addEventListener('mouseenter', (e) => {
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
}
