export class TimelineManager {
    constructor(client, els) {
        this.client = client;
        this.els = els; // { container, content, loading, timezoneSelect, refreshBtn }
        this.data = null;
        this.timezone = 'CET'; // Default
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

        const groupNames = Object.keys(this.data).sort();
        groupNames.forEach(name => {
            const group = this.data[name];
            const groupEl = document.createElement('div');
            groupEl.className = 'timeline-group';

            const header = document.createElement('div');
            header.className = 'timeline-group-header';
            const isExpanded = this.expandedGroups.has(name);

            const icon = document.createElement('i');
            icon.setAttribute('data-feather', isExpanded ? 'chevron-down' : 'chevron-right');
            header.appendChild(icon);

            const labelSpan = document.createElement('span');
            labelSpan.textContent = `${name} (${group.length} Products)`;
            header.appendChild(labelSpan);
            header.addEventListener('click', () => {
                if (this.expandedGroups.has(name)) this.expandedGroups.delete(name);
                else this.expandedGroups.add(name);
                this.render();
            });
            groupEl.appendChild(header);

            // Timeline Grid for the group (Header row with hours)
            const grid = document.createElement('div');
            grid.className = 'timeline-grid';
            for (let i = 0; i <= 24; i += 2) {
                const marker = document.createElement('div');
                marker.className = 'timeline-hour-marker';
                marker.style.left = `${(i / 24) * 100}%`;

                const label = document.createElement('div');
                label.className = 'timeline-hour-label';
                label.textContent = `${String(i).padStart(2, '0')}:00`;
                marker.appendChild(label);
                grid.appendChild(marker);
            }
            groupEl.appendChild(grid);

            // Representing the group as a whole (average/common hours)
            // Or just use the first product's hours for the group summary
            this._renderProductRow(groupEl, { Name: 'Group Overview', hours: group[0].hours }, true);

            if (isExpanded) {
                const details = document.createElement('div');
                details.className = 'group-details';
                group.forEach(p => {
                    this._renderProductRow(details, p);
                });
                groupEl.appendChild(details);
            }

            this.els.content.appendChild(groupEl);
        });

        if (window.feather) window.feather.replace();
    }

    _renderProductRow(parent, product, isGroup = false) {
        const row = document.createElement('div');
        row.className = 'timeline-row';

        const label = document.createElement('div');
        label.className = 'timeline-product-label';
        label.textContent = isGroup ? 'Summary' : product.Product;
        label.title = product.Name;
        row.appendChild(label);

        const barContainer = document.createElement('div');
        barContainer.className = 'timeline-bar-container';

        if (product.hours) {
            let phases = [];

            if (isGroup) {
                // Summary only shows main phases
                phases = [
                    { start: product.hours.StartContinuousTrading, end: product.hours.EndContinuousTrading, type: 'continuous', label: 'Continuous Trading' },
                    { start: product.hours.StartTES, end: product.hours.EndTES, type: 'tes', label: 'TES' }
                ];
            } else {
                // Details shows everything
                phases = [
                    { start: '00:00:00', end: product.hours.EndOpeningAuction, type: 'opening', label: 'Opening Auction' },
                    { start: product.hours.StartContinuousTrading, end: product.hours.EndContinuousTrading, type: 'continuous', label: 'Continuous Trading' },
                    { start: product.hours.EndContinuousTrading, end: product.hours.EndClosingAuction, type: 'closing', label: 'Closing Auction' },
                    { start: product.hours.StartTES, end: product.hours.EndTES, type: 'tes', label: 'TES' },
                    { start: product.hours.LTDBook, end: '23:59:59', type: 'ltd-book', label: 'LTD Book' },
                    { start: product.hours.LTDTES, end: '23:59:59', type: 'ltd-tes', label: 'LTD TES' }
                ];
            }

            phases.forEach(phase => {
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
                            barContainer.appendChild(bar2);
                        }

                        bar.style.left = `${left}%`;
                        bar.style.width = `${width}%`;
                        this._addTooltip(bar, `${phase.label}: ${startConverted} - ${endConverted}`);
                        barContainer.appendChild(bar);
                    }
                }
            });
        }

        row.appendChild(barContainer);
        parent.appendChild(row);
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
