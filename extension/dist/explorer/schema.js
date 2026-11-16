import { getTypeName } from './ui.js';

const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
};
const icon = (name) => {
    const i = document.createElement('i');
    i.setAttribute('data-feather', name);
    i.setAttribute('aria-hidden', 'true');
    return i;
};

// Text with the search term wrapped in <mark>
function highlight(text, term) {
    const frag = document.createDocumentFragment();
    const s = String(text ?? '');
    if (!term) { frag.append(s); return frag; }
    const lower = s.toLowerCase();
    let i = 0;
    let at;
    while ((at = lower.indexOf(term, i)) !== -1) {
        frag.append(s.slice(i, at));
        const m = document.createElement('mark');
        m.textContent = s.slice(at, at + term.length);
        frag.append(m);
        i = at + term.length;
    }
    frag.append(s.slice(i));
    return frag;
}

// Scroll only the docs pane (scrollIntoView would also scroll the page layout around it)
function scrollPaneTo(tree, card) {
    const scroller = tree?.parentElement;
    if (!scroller || !card) return;
    const top = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 84;
    scroller.scrollTop = Math.max(0, top);
}

const unwrapType = (t) => {
    while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return t;
};

const KIND_LABELS = { OBJECT: 'Object', INPUT_OBJECT: 'Input', ENUM: 'Enum', SCALAR: 'Scalar' };

/**
 * Documentation model from an introspection __schema:
 * - queries: the root queries users call, with their row fields, arguments and sort options
 * - typeGroups: all other named types grouped by kind (response wrappers hidden)
 */
export function buildDocsModel(schema) {
    const types = (schema?.types || []).filter(t => t.name && !t.name.startsWith('__'));
    const byName = new Map(types.map(t => [t.name, t]));
    const queryTypeName = schema?.queryType?.name || 'Query';
    const rootFields = byName.get(queryTypeName)?.fields || [];
    const toField = (f) => ({ name: f.name, description: f.description || '', type: f.type, raw: f });

    const usedBy = new Map();
    const queries = rootFields.map(rf => {
        const outer = byName.get(unwrapType(rf.type)?.name);
        const dataField = outer?.fields?.find(f => f.name === 'data');
        const rowType = dataField ? byName.get(unwrapType(dataField.type)?.name) : outer;
        if (rowType) usedBy.set(rowType.name, [...(usedBy.get(rowType.name) || []), rf.name]);
        const args = (rf.args || []).map(a => ({ name: a.name, description: a.description || '', type: a.type }));
        const filterArg = args.find(a => a.name === 'filter');
        const sortArg = args.find(a => a.name === 'sort');
        const sortType = sortArg ? byName.get(unwrapType(sortArg.type)?.name) : null;
        const sortFieldEnum = sortType?.inputFields?.find(f => f.name === 'field');
        const sortEnum = sortFieldEnum ? byName.get(unwrapType(sortFieldEnum.type)?.name) : null;
        return {
            name: rf.name,
            description: rf.description || outer?.description || '',
            rootField: rf,
            rowType: rowType || null,
            fields: (rowType?.fields || []).map(toField),
            args,
            filterType: filterArg ? unwrapType(filterArg.type)?.name : null,
            sortType: sortType?.name || null,
            sortFields: (sortEnum?.enumValues || []).map(v => v.name)
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const groups = [
        ['OBJECT', 'Row types'],
        ['ENUM', 'Enums'],
        ['INPUT_OBJECT', 'Inputs (filter & sort)'],
        ['SCALAR', 'Scalars']
    ];
    const typeGroups = groups.map(([kind, title]) => ({
        kind,
        title,
        types: types
            .filter(t => t.kind === kind && t.name !== queryTypeName && t.name !== schema?.mutationType?.name && !t.name.endsWith('Response'))
            .map(t => ({
                name: t.name,
                kind: t.kind,
                kindLabel: KIND_LABELS[t.kind] || t.kind,
                description: t.description || '',
                fields: (t.fields || t.inputFields || []).map(toField),
                enumValues: t.enumValues || [],
                usedBy: usedBy.get(t.name) || [],
                raw: t
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    }));
    return { schema, queries, typeGroups };
}

export function fieldMatches(f, term) {
    if (!term) return true;
    return f.name.toLowerCase().includes(term) || (f.description || '').toLowerCase().includes(term);
}

function nameMatch(q, term) {
    return q.name.toLowerCase().includes(term) || (q.description || '').toLowerCase().includes(term);
}

export function queryMatchesFilter(q, term) {
    if (!term) return true;
    return nameMatch(q, term) || q.fields.some(f => fieldMatches(f, term));
}

export function typeMatchesFilter(t, term) {
    if (!term) return true;
    return t.name.toLowerCase().includes(term)
        || (t.description || '').toLowerCase().includes(term)
        || t.fields.some(f => fieldMatches(f, term))
        || t.enumValues.some(v => v.name.toLowerCase().includes(term));
}

export class SchemaExplorer {
    constructor(client, els, options) {
        this.client = client;
        this.els = els; // { docsTree, docsLoading, docsEmpty, docsSearch }
        this.options = options; // { onInsertField, onInsertFilter, onSetQuery, onRunQuery }
        this.schemaData = null;

        if (this.els.docsSearch) {
            this.els.docsSearch.addEventListener('input', () => {
                if (!this.schemaData) return;
                this.renderSchema(this.els.docsSearch.value.trim().toLowerCase());
            });
        }
    }

    async fetchSchema() {
        if (this.schemaData) return this.schemaData;
        if (!this.client.apiKey || !this.client.endpoint) return null;

        this.els.docsLoading.classList.remove('hidden');
        this.els.docsEmpty.classList.add('hidden');
        this.els.docsTree.classList.add('hidden');

        const INTROSPECTION_QUERY = `
          query IntrospectionQuery {
            __schema {
              queryType { name }
              mutationType { name }
              types {
                kind
                name
                description
                fields {
                  name
                  description
                  type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
                  args { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } defaultValue }
                }
                inputFields {
                  name
                  description
                  type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
                  defaultValue
                }
                enumValues { name description }
              }
            }
          }
        `;

        try {
            const data = await this.client.request(INTROSPECTION_QUERY, null, false);
            if (!data || !data.__schema) throw new Error("Invalid schema response.");
            this.schemaData = data.__schema;
            this.renderSchema('');
            return this.schemaData;
        } catch (err) {
            this.els.docsTree.innerHTML = '';
            const errP = document.createElement('div');
            errP.className = 'error-card';
            errP.innerHTML = `<div class="error-card-header"><i data-feather="alert-circle"></i> Error</div><p class="error-message"></p>`;
            errP.querySelector('.error-message').textContent = `Failed to load schema: ${err.message}`;
            if (window.feather) setTimeout(() => window.feather.replace(), 0);
            this.els.docsTree.appendChild(errP);
            this.els.docsTree.classList.remove('hidden');
            return null;
        } finally {
            this.els.docsLoading.classList.add('hidden');
        }
    }

    // ---------- Rendering ----------

    renderSchema(filter) {
        if (!this.schemaData) return;
        this.model = this.model && this.model.schema === this.schemaData ? this.model : buildDocsModel(this.schemaData);
        const newFilter = (filter || '').trim().toLowerCase();
        if (newFilter !== this.filter) { this.collapsed = new Set(); this.showAllFor = null; }
        this.filter = newFilter;
        if (!this.view) this.view = 'queries';
        if (!this.expanded) this.expanded = new Set();

        const tree = this.els.docsTree;
        tree.innerHTML = '';
        tree.classList.remove('hidden');
        this.els.docsEmpty.classList.add('hidden');

        // View switch + summary
        const bar = el('div', 'dx-bar');
        const tabs = el('div', 'dx-tabs');
        tabs.setAttribute('role', 'tablist');
        const queryMatches = this.model.queries.filter(q => queryMatchesFilter(q, this.filter));
        const typeGroups = this.model.typeGroups.map(g => ({ ...g, types: g.types.filter(t => typeMatchesFilter(t, this.filter)) }));
        const typeCount = typeGroups.reduce((n, g) => n + g.types.length, 0);
        [['queries', 'Queries', queryMatches.length], ['types', 'Types', typeCount]].forEach(([key, label, count]) => {
            const t = el('button', 'dx-tab' + (this.view === key ? ' active' : ''));
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.setAttribute('aria-selected', String(this.view === key));
            t.append(label, el('span', 'dx-count', String(count)));
            t.addEventListener('click', () => { this.view = key; this.backStack = []; this.renderSchema(this.filter); });
            tabs.appendChild(t);
        });
        bar.appendChild(tabs);

        const toggleAll = el('button', 'dx-link', this.filter ? '' : 'Expand all');
        toggleAll.type = 'button';
        const visibleKeys = this.view === 'queries'
            ? queryMatches.map(q => 'q:' + q.name)
            : typeGroups.flatMap(g => g.types.map(t => 't:' + t.name));
        const allOpen = visibleKeys.length && visibleKeys.every(k => this.expanded.has(k));
        toggleAll.textContent = allOpen ? 'Collapse all' : 'Expand all';
        toggleAll.addEventListener('click', () => {
            visibleKeys.forEach(k => (allOpen ? this.expanded.delete(k) : this.expanded.add(k)));
            this.renderSchema(this.filter);
        });
        if (!this.filter) bar.appendChild(toggleAll);
        tree.appendChild(bar);

        if (this.backStack && this.backStack.length) {
            const back = el('button', 'dx-back');
            back.type = 'button';
            back.appendChild(icon('arrow-left'));
            back.append(` Back to ${this.backStack[this.backStack.length - 1].label}`);
            back.addEventListener('click', () => {
                const prev = this.backStack.pop();
                this.view = prev.view;
                this.renderSchema(this.filter);
                scrollPaneTo(tree, tree.querySelector(`[data-key="${CSS.escape(prev.key)}"]`));
            });
            tree.appendChild(back);
        }

        if (this.filter) {
            const fieldHits = this.view === 'queries'
                ? queryMatches.reduce((n, q) => n + q.fields.filter(f => fieldMatches(f, this.filter)).length, 0)
                : 0;
            const summary = el('p', 'dx-summary');
            summary.textContent = this.view === 'queries'
                ? `${queryMatches.length} quer${queryMatches.length === 1 ? 'y' : 'ies'}${fieldHits ? ` · ${fieldHits} matching field${fieldHits === 1 ? '' : 's'}` : ''} for “${this.filter}”`
                : `${typeCount} type${typeCount === 1 ? '' : 's'} for “${this.filter}”`;
            tree.appendChild(summary);
        }

        if (this.view === 'queries') {
            if (!queryMatches.length) tree.appendChild(this._noMatch());
            queryMatches.forEach(q => tree.appendChild(this._renderQuery(q)));
        } else {
            if (!typeCount) tree.appendChild(this._noMatch());
            typeGroups.forEach(g => {
                if (!g.types.length) return;
                const section = el('section', 'dx-group');
                section.appendChild(el('h4', 'dx-group-title', g.title));
                g.types.forEach(t => section.appendChild(this._renderType(t)));
                tree.appendChild(section);
            });
        }
        if (window.feather) window.feather.replace();
    }

    _noMatch() {
        const p = el('p', 'dx-empty', `Nothing matches “${this.filter}”.`);
        if (this.view === 'queries' && this.model.typeGroups.some(g => g.types.some(t => typeMatchesFilter(t, this.filter)))) {
            const link = el('button', 'dx-link', 'Search types instead');
            link.type = 'button';
            link.addEventListener('click', () => { this.view = 'types'; this.renderSchema(this.filter); });
            p.append(' ', link);
        }
        return p;
    }

    // Collapsible card. Cards opened automatically by a search can still be collapsed by the user.
    _card(key, head, buildBody, autoOpen) {
        if (!this.collapsed) this.collapsed = new Set();
        const open = this.expanded.has(key) || (autoOpen && !this.collapsed.has(key));
        const card = el('article', 'dx-card' + (open ? ' open' : ''));
        card.dataset.key = key;
        const header = el('div', 'dx-card-head');
        const toggle = el('button', 'dx-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.appendChild(icon(open ? 'chevron-down' : 'chevron-right'));
        toggle.appendChild(head.title);
        toggle.addEventListener('click', () => {
            if (open) { this.expanded.delete(key); this.collapsed.add(key); }
            else { this.expanded.add(key); this.collapsed.delete(key); }
            const scroller = this.els.docsTree.parentElement;
            const top = scroller ? scroller.scrollTop : 0;
            this.renderSchema(this.filter);
            if (scroller) scroller.scrollTop = top;
            this.els.docsTree.querySelector(`[data-key="${CSS.escape(key)}"] .dx-toggle`)?.focus({ preventScroll: true });
        });
        header.appendChild(toggle);
        if (head.actions) header.appendChild(head.actions);
        card.appendChild(header);
        if (head.sub) card.appendChild(head.sub);
        if (open) card.appendChild(buildBody());
        return card;
    }

    _renderQuery(q) {
        const key = 'q:' + q.name;
        const title = el('span', 'dx-title');
        title.appendChild(highlight(q.name, this.filter));
        title.appendChild(el('span', 'dx-meta', `${q.fields.length} fields${q.filterType ? ' · filter' : ''}${q.sortType ? ' · sort' : ''}`));

        const actions = el('div', 'dx-actions');
        const insert = this._btn('edit-3', 'Insert', `Put a ${q.name} query with all fields into the editor`);
        insert.addEventListener('click', () => this.options.onSetQuery?.(this.generateFullQuery(q.rootField)));
        const run = this._btn('play', 'Run', `Run ${q.name} with all fields`, 'primary');
        run.addEventListener('click', () => {
            const query = this.generateFullQuery(q.rootField);
            if (this.options.onRunQuery) this.options.onRunQuery(query); else this.options.onSetQuery?.(query);
        });
        actions.append(insert, run);

        const sub = q.description ? el('p', 'dx-desc') : null;
        if (sub) sub.appendChild(highlight(q.description, this.filter));

        const matching = this.filter ? q.fields.filter(f => fieldMatches(f, this.filter)) : q.fields;
        const autoOpen = !!this.filter && matching.length > 0 && !nameMatch(q, this.filter);
        return this._card(key, { title, actions, sub }, () => {
            const body = el('div', 'dx-body');
            const showAll = !this.filter || this.showAllFor === key || !matching.length;
            const list = showAll ? q.fields : matching;
            body.appendChild(this._fieldList(list, q.rowType));
            if (!showAll) {
                const more = el('button', 'dx-link', `Show all ${q.fields.length} fields`);
                more.type = 'button';
                more.addEventListener('click', () => { this.showAllFor = key; this.expanded.add(key); this.renderSchema(this.filter); });
                body.appendChild(more);
            }
            if (q.args.length && showAll) {
                const argsBox = el('div', 'dx-args');
                argsBox.appendChild(el('h5', 'dx-sub-title', 'Arguments'));
                q.args.forEach(a => {
                    const row = el('div', 'dx-arg');
                    row.appendChild(el('code', 'dx-arg-name', a.name));
                    row.appendChild(this._typePill(a.type, key));
                    if (a.description) row.appendChild(el('span', 'dx-field-desc', a.description));
                    argsBox.appendChild(row);
                });
                if (q.sortFields.length) {
                    argsBox.appendChild(el('p', 'dx-hint', `Sortable by: ${q.sortFields.join(', ')}`));
                }
                if (q.filterType) {
                    argsBox.appendChild(el('p', 'dx-hint', 'Example: ' + `${q.name}(filter: { Product: { eq: "FESX" } }, sort: { field: ${q.sortFields[0] || 'Product'}, order: ASC })`));
                }
                body.appendChild(argsBox);
            }
            return body;
        }, autoOpen);
    }

    _renderType(t) {
        const key = 't:' + t.name;
        const title = el('span', 'dx-title');
        title.appendChild(highlight(t.name, this.filter));
        title.appendChild(el('span', 'dx-meta', t.kindLabel + (t.usedBy.length ? ` · used by ${t.usedBy.length}` : '')));
        const sub = t.description ? el('p', 'dx-desc') : null;
        if (sub) sub.appendChild(highlight(t.description, this.filter));
        const hasBody = t.fields.length || t.enumValues.length || t.usedBy.length;
        const autoOpen = !!this.filter && !String(t.name).toLowerCase().includes(this.filter)
            && (t.fields.some(f => fieldMatches(f, this.filter)) || t.enumValues.some(v => v.name.toLowerCase().includes(this.filter)));
        return this._card(key, { title, sub }, () => {
            const body = el('div', 'dx-body');
            if (t.fields.length) body.appendChild(this._fieldList(t.fields, t.kind === 'OBJECT' ? t.raw : null));
            if (t.enumValues.length) {
                const ul = el('ul', 'dx-enum');
                t.enumValues.forEach(v => {
                    const li = el('li');
                    const code = el('code');
                    code.appendChild(highlight(v.name, this.filter));
                    li.appendChild(code);
                    if (v.description) li.appendChild(el('span', 'dx-field-desc', v.description));
                    ul.appendChild(li);
                });
                body.appendChild(ul);
            }
            if (t.usedBy.length) body.appendChild(el('p', 'dx-hint', `Returned by: ${t.usedBy.join(', ')}`));
            if (!hasBody) body.appendChild(el('p', 'dx-hint', 'Built-in scalar type.'));
            return body;
        }, autoOpen);
    }

    _fieldList(fields, ownerType) {
        const list = el('div', 'dx-fields');
        fields.forEach(f => {
            const row = el('div', 'dx-field');
            row.tabIndex = 0;
            const main = el('div', 'dx-field-main');
            const name = el('code', 'dx-field-name');
            name.appendChild(highlight(f.name, this.filter));
            main.appendChild(name);
            main.appendChild(this._typePill(f.type, null));
            row.appendChild(main);
            if (f.description) {
                const d = el('p', 'dx-field-desc');
                d.appendChild(highlight(f.description, this.filter));
                row.appendChild(d);
            }
            if (ownerType && (ownerType.kind === 'OBJECT')) {
                const acts = el('div', 'dx-field-actions');
                const add = this._btn('plus', 'Add', `Add ${f.name} to the current query`);
                add.addEventListener('click', (e) => { e.stopPropagation(); this.options.onInsertField?.(f.name); });
                const filt = this._btn('filter', 'Filter', `Add a filter on ${f.name}`);
                filt.addEventListener('click', (e) => { e.stopPropagation(); this.showFilterDropdown(filt, f.name, ownerType, f.raw); });
                acts.append(add, filt);
                row.appendChild(acts);
            }
            list.appendChild(row);
        });
        return list;
    }

    // Type reference; non-scalar types link to their entry in the Types view
    _typePill(typeObj, fromKey) {
        const label = getTypeName(typeObj);
        const base = this.getBaseTypeName(typeObj);
        const target = this.findTypeByName(base);
        const linkable = target && target.kind !== 'SCALAR';
        const pill = el(linkable ? 'button' : 'span', `dx-type ${(target?.kind || 'SCALAR').toLowerCase()}`, label);
        if (linkable) {
            pill.type = 'button';
            pill.title = `Show ${base}`;
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.backStack) this.backStack = [];
                const currentKey = e.target.closest('[data-key]')?.dataset.key || fromKey;
                this.backStack.push({ view: this.view, key: currentKey, label: currentKey ? currentKey.slice(2) : 'list' });
                this.view = 'types';
                this.expanded.add('t:' + base);
                if (this.els.docsSearch) this.els.docsSearch.value = '';
                this.renderSchema('');
                const card = this.els.docsTree.querySelector(`[data-key="${CSS.escape('t:' + base)}"]`);
                scrollPaneTo(this.els.docsTree, card);
                card?.classList.add('flash');
            });
        }
        return pill;
    }

    _btn(iconName, label, title, variant = '') {
        const b = el('button', `dx-btn ${variant}`.trim());
        b.type = 'button';
        b.title = title;
        b.appendChild(icon(iconName));
        b.append(' ' + label);
        return b;
    }

    getBaseTypeName(typeObj) {
        if (!typeObj) return null;
        if (typeObj.name) return typeObj.name;
        if (typeObj.ofType) return this.getBaseTypeName(typeObj.ofType);
        return null;
    }

    findTypeByName(name) {
        if (!this.schemaData) return null;
        return this.schemaData.types.find(t => t.name === name);
    }

    getScalarFields(typeName, depth) {
        if (depth > 2) return []; 
        const type = this.findTypeByName(typeName);
        if (!type || !type.fields) return [];

        const scalars = [];
        const nested = [];

        type.fields.forEach(f => {
            const baseName = this.getBaseTypeName(f.type);
            const resolvedType = this.findTypeByName(baseName);
            if (!resolvedType || resolvedType.kind === 'SCALAR' || resolvedType.kind === 'ENUM') {
                scalars.push(f.name);
            } else if (resolvedType.kind === 'OBJECT' && depth < 2) {
                const subFields = this.getScalarFields(resolvedType.name, depth + 1);
                if (subFields.length > 0) {
                    nested.push({ name: f.name, subFields });
                }
            }
        });

        return [...scalars.map(s => ({ name: s })), ...nested.map(n => ({ name: n.name, subFields: n.subFields }))];
    }

    fieldsToString(fields, indent) {
        return fields.map(f => {
            if (f.subFields) {
                return `${indent}${f.name} {\n${this.fieldsToString(f.subFields, indent + '  ')}\n${indent}}`;
            }
            return `${indent}${f.name}`;
        }).join('\n');
    }

    generateFullQuery(rootField) {
        const returnTypeName = this.getBaseTypeName(rootField.type);
        const fields = this.getScalarFields(returnTypeName, 0);

        const fieldStr = fields.length > 0
            ? ` {\n${this.fieldsToString(fields, '    ')}\n  }`
            : '';

        return `query {\n  ${rootField.name}${fieldStr}\n}`;
    }

    showFilterDropdown(anchorBtn, fieldName, type, field) {
        // Remove any existing dropdowns
        const existing = document.querySelector('.filter-operators-dropdown');
        if (existing) existing.remove();

        const operators = this.getOperatorsForField(type, field);
        const dropdown = document.createElement('div');
        dropdown.className = 'filter-operators-dropdown';

        operators.forEach(op => {
            const item = document.createElement('div');
            item.className = 'filter-operator-item';
            item.textContent = op;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.options.onInsertFilter) {
                    this.options.onInsertFilter(fieldName, op);
                }
                dropdown.remove();
            });
            dropdown.appendChild(item);
        });

        document.body.appendChild(dropdown);

        const rect = anchorBtn.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 5}px`;
        dropdown.style.left = `${rect.left + window.scrollX}px`;

        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    }

    getOperatorsForField(type, field) {
        let filterTypeName = null;

        if (type.kind === 'OBJECT') {
            filterTypeName = type.name + 'Filter';
        } else if (type.kind === 'INPUT_OBJECT') {
            // If it's already an input object, we might be looking at its fields directly
            const fieldBaseType = this.findTypeByName(this.getBaseTypeName(field.type));
            if (fieldBaseType && fieldBaseType.kind === 'INPUT_OBJECT') {
                return fieldBaseType.inputFields.map(f => f.name);
            }
            return ['eq'];
        }

        if (filterTypeName) {
            const filterType = this.findTypeByName(filterTypeName);
            if (filterType && filterType.inputFields) {
                const filterField = filterType.inputFields.find(f => f.name === field.name);
                if (filterField) {
                    const opType = this.findTypeByName(this.getBaseTypeName(filterField.type));
                    if (opType && opType.inputFields) {
                        return opType.inputFields.map(f => f.name);
                    }
                }
            }
        }

        return ['eq']; // Default
    }
}

const sdlType = (t) => {
    if (!t) return 'Unknown';
    if (t.kind === 'NON_NULL') return sdlType(t.ofType) + '!';
    if (t.kind === 'LIST') return '[' + sdlType(t.ofType) + ']';
    return t.name || 'Unknown';
};

// Compact SDL text of the schema (objects, inputs, enums), for AI assistants
export function schemaToSdl(schema) {
    let sdl = '';
    (schema?.types || []).filter(t => !t.name.startsWith('__')).forEach(type => {
        if (type.kind === 'OBJECT') {
            sdl += `type ${type.name} {\n`;
            (type.fields || []).forEach(f => {
                const args = f.args && f.args.length ? '(' + f.args.map(a => `${a.name}: ${sdlType(a.type)}`).join(', ') + ')' : '';
                sdl += `  ${f.name}${args}: ${sdlType(f.type)}\n`;
            });
            sdl += '}\n\n';
        } else if (type.kind === 'INPUT_OBJECT') {
            sdl += `input ${type.name} {\n`;
            (type.inputFields || []).forEach(f => { sdl += `  ${f.name}: ${sdlType(f.type)}\n`; });
            sdl += '}\n\n';
        } else if (type.kind === 'ENUM') {
            sdl += `enum ${type.name} {\n`;
            (type.enumValues || []).forEach(v => { sdl += `  ${v.name}\n`; });
            sdl += '}\n\n';
        }
    });
    return sdl.trim();
}
