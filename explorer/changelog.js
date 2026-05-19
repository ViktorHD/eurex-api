export class ChangelogManager {
    constructor(client, els) {
        this.client = client;
        this.els = els; // { container, content, loading, refreshBtn }
        this.data = null;

        this.bindEvents();
    }

    bindEvents() {
        if (this.els.refreshBtn) {
            this.els.refreshBtn.addEventListener('click', () => this.fetchAndRender());
        }
    }

    async fetchAndRender() {
        if (!this.els.loading || !this.els.content) return;

        this.els.loading.classList.remove('hidden');
        this.els.content.innerHTML = '';

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

            this.data = response.Changelog.data;

            this.render();
        } catch (err) {
            this.els.content.innerHTML = `<div class="error-card"><p>${err.message}</p></div>`;
        } finally {
            this.els.loading.classList.add('hidden');
        }
    }

    render() {
        if (!this.data) return;

        const container = this.els.content;
        container.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Sort data bottom-to-top (desc by date, newest at top)
        const sortedData = [...this.data].sort((a, b) => new Date(b.Date) - new Date(a.Date));

        const timelineWrapper = document.createElement('div');
        timelineWrapper.className = 'changelog-timeline-container';

        const axis = document.createElement('div');
        axis.className = 'changelog-axis';
        timelineWrapper.appendChild(axis);

        let todayMarkerAdded = false;

        sortedData.forEach((entry, index) => {
            const entryDate = new Date(entry.Date);
            entryDate.setHours(0, 0, 0, 0);

            // If we are newest-to-oldest, we want to place Today marker
            // BEFORE the first entry that is NOT in the future.
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
                queryDiv.innerHTML = `<span class="label">GraphQL Query:</span> <pre><code>${this._escapeHtml(entry.Query)}</code></pre>`;
                content.appendChild(queryDiv);
            }

            item.appendChild(content);
            timelineWrapper.appendChild(item);
        });

        // If all entries are in the past, add today marker at the end
        if (!todayMarkerAdded) {
            this._addTodayMarker(timelineWrapper);
        }

        container.appendChild(timelineWrapper);
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
}
