document.addEventListener('DOMContentLoaded', () => {
    // Top Header Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const runQueryBtn = document.getElementById('runQueryBtn');
    const toggleDocsBtn = document.getElementById('toggleDocsBtn');
    
    // Tabs Elements
    const tabsBar = document.getElementById('tabsBar');
    const addTabBtn = document.getElementById('addTabBtn');

    // Editor Elements
    const queryInput = document.getElementById('queryInput');
    const drawerToggle = document.getElementById('drawerToggle');
    const drawerContent = document.getElementById('drawerContent');
    const drawerIcon = document.getElementById('drawerIcon');
    const apiKeyInput = document.getElementById('apiKey');

    // Panes
    const docsPane = document.getElementById('docsPane');
    const closeDocsBtn = document.getElementById('closeDocsBtn');
    
    // Result Elements
    const errorBox = document.getElementById('errorBox');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const emptyState = document.getElementById('emptyState');
    const resultsTable = document.getElementById('resultsTable');
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const downloadCsvBtn = document.getElementById('downloadCsvBtn');
    const downloadMdBtn = document.getElementById('downloadMdBtn');

    // State
    let currentData = null;

    // Event Listeners
    runQueryBtn.addEventListener('click', handleRunQuery);
    downloadCsvBtn.addEventListener('click', handleDownloadCsv);
    downloadMdBtn.addEventListener('click', handleDownloadMd);

    // UI Toggles
    drawerToggle.addEventListener('click', () => {
        drawerContent.classList.toggle('open');
        const isOpen = drawerContent.classList.contains('open');
        drawerIcon.setAttribute('data-feather', isOpen ? 'chevron-down' : 'chevron-up');
        feather.replace(); // Refresh icons
    });

    // Docs Pane Elements
    const docsContent = document.getElementById('docsContent');
    const docsLoading = document.getElementById('docsLoading');
    const docsEmpty = document.getElementById('docsEmpty');
    const docsTree = document.getElementById('docsTree');
    const docsSearch = document.getElementById('docsSearch');

    // Schema introspection cache
    let schemaData = null;

    toggleDocsBtn.addEventListener('click', async () => {
        docsPane.classList.toggle('hidden');
        // If just opened and no schema loaded, fetch it
        if (!docsPane.classList.contains('hidden') && !schemaData) {
            await fetchSchema();
        }
    });

    closeDocsBtn.addEventListener('click', () => {
        docsPane.classList.add('hidden');
    });

    // Search filter
    docsSearch.addEventListener('input', () => {
        if (!schemaData) return;
        renderSchema(schemaData, docsSearch.value.trim().toLowerCase());
    });

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
              type {
                kind
                name
                ofType { kind name ofType { kind name ofType { kind name } } }
              }
              args {
                name
                description
                type {
                  kind
                  name
                  ofType { kind name ofType { kind name ofType { kind name } } }
                }
                defaultValue
              }
            }
            inputFields {
              name
              description
              type {
                kind
                name
                ofType { kind name ofType { kind name ofType { kind name } } }
              }
              defaultValue
            }
            enumValues {
              name
              description
            }
          }
        }
      }
    `;

    async function fetchSchema() {
        const apiKey = apiKeyInput.value.trim();
        const endpoint = apiUrlInput.value.trim();
        if (!apiKey || !endpoint) return;

        docsLoading.classList.remove('hidden');
        docsEmpty.classList.add('hidden');
        docsTree.classList.add('hidden');

        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-DBP-APIKEY': apiKey
                },
                body: JSON.stringify({ query: INTROSPECTION_QUERY })
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));

            schemaData = json.data.__schema;
            renderSchema(schemaData, '');
        } catch (err) {
            docsTree.innerHTML = '';
            const errP = document.createElement('p');
            errP.className = 'docs-error';
            errP.textContent = `Failed to load schema: ${err.message}`;
            docsTree.appendChild(errP);
            docsTree.classList.remove('hidden');
        } finally {
            docsLoading.classList.add('hidden');
        }
    }

    function getTypeName(typeObj) {
        if (!typeObj) return 'Unknown';
        if (typeObj.name) return typeObj.name;
        if (typeObj.kind === 'NON_NULL') return getTypeName(typeObj.ofType) + '!';
        if (typeObj.kind === 'LIST') return '[' + getTypeName(typeObj.ofType) + ']';
        return 'Unknown';
    }

    function renderSchema(schema, filter) {
        docsTree.innerHTML = '';
        docsTree.classList.remove('hidden');
        docsEmpty.classList.add('hidden');

        // Filter out internal types (starting with __)
        const userTypes = schema.types.filter(t => !t.name.startsWith('__'));

        // Root query type
        const queryTypeName = schema.queryType ? schema.queryType.name : null;
        const mutationTypeName = schema.mutationType ? schema.mutationType.name : null;

        // Build a map of root query field names → field objects for quick lookup
        const rootFieldMap = {};
        const queryType = schema.types.find(t => t.name === queryTypeName);
        if (queryType && queryType.fields) {
            queryType.fields.forEach(f => { rootFieldMap[f.name] = f; });
        }

        // Group types by category
        const rootTypes = userTypes.filter(t => t.name === queryTypeName || t.name === mutationTypeName);
        const objectTypes = userTypes.filter(t => t.kind === 'OBJECT' && !rootTypes.includes(t));
        const inputTypes = userTypes.filter(t => t.kind === 'INPUT_OBJECT');
        const enumTypes = userTypes.filter(t => t.kind === 'ENUM');
        const scalarTypes = userTypes.filter(t => t.kind === 'SCALAR');

        // Render each section
        if (rootTypes.length > 0) addSection('Root Types', rootTypes, filter, rootFieldMap);
        if (objectTypes.length > 0) addSection('Object Types', objectTypes, filter, rootFieldMap);
        if (inputTypes.length > 0) addSection('Input Types', inputTypes, filter, rootFieldMap);
        if (enumTypes.length > 0) addSection('Enums', enumTypes, filter, rootFieldMap);
        if (scalarTypes.length > 0) addSection('Scalars', scalarTypes, filter, rootFieldMap);
    }
    function addSection(title, types, filter, rootFieldMap) {
        const filteredTypes = filter
            ? types.filter(t => {
                if (t.name.toLowerCase().includes(filter)) return true;
                if (t.description && t.description.toLowerCase().includes(filter)) return true;
                if (t.fields && t.fields.some(f => f.name.toLowerCase().includes(filter))) return true;
                if (t.inputFields && t.inputFields.some(f => f.name.toLowerCase().includes(filter))) return true;
                if (t.enumValues && t.enumValues.some(v => v.name.toLowerCase().includes(filter))) return true;
                return false;
            })
            : types;

        if (filteredTypes.length === 0) return;

        const section = document.createElement('div');
        section.className = 'docs-section';

        const sectionHeader = document.createElement('h4');
        sectionHeader.className = 'docs-section-title';
        sectionHeader.textContent = title;
        section.appendChild(sectionHeader);

        filteredTypes.forEach(type => {
            const typeBlock = document.createElement('div');
            typeBlock.className = 'docs-type-block';

            // Type Name Header (collapsible)
            const typeHeader = document.createElement('div');
            typeHeader.className = 'docs-type-header';

            const headerLeft = document.createElement('span');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'docs-type-name';
            nameSpan.textContent = type.name;
            headerLeft.appendChild(nameSpan);

            headerLeft.appendChild(document.createTextNode(' '));

            const kindSpan = document.createElement('span');
            kindSpan.className = 'docs-type-kind';
            kindSpan.textContent = type.kind;
            headerLeft.appendChild(kindSpan);

            typeHeader.appendChild(headerLeft);

            // If this type name matches a root query field, add a single "+ Query" button
            if (rootFieldMap && rootFieldMap[type.name]) {
                const rootField = rootFieldMap[type.name];
                const fullBtn = document.createElement('button');
                fullBtn.className = 'docs-add-btn docs-add-btn-inline';
                fullBtn.textContent = '+ Query';
                fullBtn.title = 'Generate full query for ' + type.name;
                fullBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    queryInput.value = generateFullQuery(rootField);
                });
                typeHeader.appendChild(fullBtn);
            }

            typeHeader.addEventListener('click', (e) => {
                if (e.target.closest('.docs-add-btn')) return; // don't toggle when clicking buttons
                const body = typeBlock.querySelector('.docs-type-body');
                body.classList.toggle('hidden');
            });
            typeBlock.appendChild(typeHeader);

            // Type Description
            if (type.description) {
                const desc = document.createElement('p');
                desc.className = 'docs-type-desc';
                desc.textContent = type.description;
                typeBlock.appendChild(desc);
            }

            // Fields / InputFields / EnumValues body
            const body = document.createElement('div');
            body.className = 'docs-type-body hidden';

            const fields = type.fields || type.inputFields || [];
            fields.forEach(field => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'docs-field';

                let argsStr = '';
                if (field.args && field.args.length > 0) {
                    argsStr = '(' + field.args.map(a => `${a.name}: ${getTypeName(a.type)}`).join(', ') + ')';
                }

                const fieldInfo = document.createElement('span');

                const fNameSpan = document.createElement('span');
                fNameSpan.className = 'docs-field-name';
                fNameSpan.textContent = field.name;
                fieldInfo.appendChild(fNameSpan);

                if (argsStr) {
                    const fArgsSpan = document.createElement('span');
                    fArgsSpan.className = 'docs-field-args';
                    fArgsSpan.textContent = argsStr;
                    fieldInfo.appendChild(fArgsSpan);
                }

                fieldInfo.appendChild(document.createTextNode(': '));

                const fTypeSpan = document.createElement('span');
                fTypeSpan.className = 'docs-field-type';
                fTypeSpan.textContent = getTypeName(field.type);
                fieldInfo.appendChild(fTypeSpan);

                fieldDiv.appendChild(fieldInfo);

                if (field.description) {
                    const fdesc = document.createElement('p');
                    fdesc.className = 'docs-field-desc';
                    fdesc.textContent = field.description;
                    fieldDiv.appendChild(fdesc);
                }

                // Single field add button (inline)
                const addBtn = document.createElement('button');
                addBtn.className = 'docs-add-btn docs-add-btn-secondary docs-add-btn-sm';
                addBtn.textContent = '+ Add';
                addBtn.title = 'Add this field to the current query';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    insertFieldIntoQuery(field.name);
                });
                fieldDiv.appendChild(addBtn);

                body.appendChild(fieldDiv);
            });

            if (type.enumValues) {
                type.enumValues.forEach(ev => {
                    const evDiv = document.createElement('div');
                    evDiv.className = 'docs-field';

                    const evNameSpan = document.createElement('span');
                    evNameSpan.className = 'docs-field-name';
                    evNameSpan.textContent = ev.name;
                    evDiv.appendChild(evNameSpan);

                    if (ev.description) {
                        const edesc = document.createElement('p');
                        edesc.className = 'docs-field-desc';
                        edesc.textContent = ev.description;
                        evDiv.appendChild(edesc);
                    }
                    body.appendChild(evDiv);
                });
            }

            typeBlock.appendChild(body);
            section.appendChild(typeBlock);
        });

        docsTree.appendChild(section);
    }

    // ======= Query Generation Helpers =======

    function getBaseTypeName(typeObj) {
        if (!typeObj) return null;
        if (typeObj.name) return typeObj.name;
        if (typeObj.ofType) return getBaseTypeName(typeObj.ofType);
        return null;
    }

    function findTypeByName(name) {
        if (!schemaData) return null;
        return schemaData.types.find(t => t.name === name);
    }

    function getScalarFields(typeName, depth) {
        if (depth > 2) return []; // prevent deep recursion
        const type = findTypeByName(typeName);
        if (!type || !type.fields) return [];

        const scalars = [];
        const nested = [];

        type.fields.forEach(f => {
            const baseName = getBaseTypeName(f.type);
            const resolvedType = findTypeByName(baseName);
            if (!resolvedType || resolvedType.kind === 'SCALAR' || resolvedType.kind === 'ENUM') {
                scalars.push(f.name);
            } else if (resolvedType.kind === 'OBJECT' && depth < 2) {
                const subFields = getScalarFields(resolvedType.name, depth + 1);
                if (subFields.length > 0) {
                    nested.push({ name: f.name, subFields });
                }
            }
        });

        return [...scalars.map(s => ({ name: s })), ...nested.map(n => ({ name: n.name, subFields: n.subFields }))];
    }

    function fieldsToString(fields, indent) {
        return fields.map(f => {
            if (f.subFields) {
                return `${indent}${f.name} {\n${fieldsToString(f.subFields, indent + '  ')}\n${indent}}`;
            }
            return `${indent}${f.name}`;
        }).join('\n');
    }

    function generateFullQuery(rootField) {
        // Get the return type name
        const returnTypeName = getBaseTypeName(rootField.type);
        const fields = getScalarFields(returnTypeName, 0);

        const fieldStr = fields.length > 0
            ? ` {\n${fieldsToString(fields, '    ')}\n  }`
            : '';

        return `query {\n  ${rootField.name}${fieldStr}\n}`;
    }

    function insertFieldIntoQuery(fieldName) {
        const current = queryInput.value;
        // Try to insert before the last closing brace
        const lastBrace = current.lastIndexOf('}');
        if (lastBrace > 0) {
            const secondLastBrace = current.lastIndexOf('}', lastBrace - 1);
            if (secondLastBrace > 0) {
                const before = current.substring(0, secondLastBrace);
                const after = current.substring(secondLastBrace);
                queryInput.value = before + '      ' + fieldName + '\n' + after;
                return;
            }
        }
        // Fallback: append to cursor position
        const pos = queryInput.selectionStart || queryInput.value.length;
        queryInput.value = current.substring(0, pos) + '\n      ' + fieldName + current.substring(pos);
    }

    // ======= Autocomplete =======

    const autocompleteDropdown = document.createElement('div');
    autocompleteDropdown.className = 'autocomplete-dropdown hidden';
    document.querySelector('.editor-pane').appendChild(autocompleteDropdown);

    let autocompleteItems = [];

    function buildAutocompleteItems() {
        autocompleteItems = [];
        if (!schemaData) return;

        // Add root query fields
        const queryTypeName = schemaData.queryType ? schemaData.queryType.name : null;
        const queryType = schemaData.types.find(t => t.name === queryTypeName);
        if (queryType && queryType.fields) {
            queryType.fields.forEach(f => {
                autocompleteItems.push({ label: f.name, kind: 'query', desc: f.description || '' });
            });
        }

        // Add all known field names from all types
        schemaData.types.forEach(t => {
            if (t.name.startsWith('__')) return;
            const fields = t.fields || t.inputFields || [];
            fields.forEach(f => {
                if (!autocompleteItems.some(a => a.label === f.name)) {
                    autocompleteItems.push({ label: f.name, kind: 'field', desc: f.description || '' });
                }
            });
        });
    }

    queryInput.addEventListener('input', handleAutocomplete);
    queryInput.addEventListener('keydown', handleAutocompleteKey);
    queryInput.addEventListener('blur', () => {
        setTimeout(() => autocompleteDropdown.classList.add('hidden'), 200);
    });

    function handleAutocomplete() {
        if (autocompleteItems.length === 0) buildAutocompleteItems();
        if (autocompleteItems.length === 0) return;

        // Get current word at cursor
        const pos = queryInput.selectionStart;
        const textBefore = queryInput.value.substring(0, pos);
        const wordMatch = textBefore.match(/(\w+)$/);
        if (!wordMatch || wordMatch[1].length < 2) {
            autocompleteDropdown.classList.add('hidden');
            return;
        }

        const word = wordMatch[1].toLowerCase();
        const matches = autocompleteItems.filter(a => a.label.toLowerCase().includes(word)).slice(0, 8);

        if (matches.length === 0) {
            autocompleteDropdown.classList.add('hidden');
            return;
        }

        autocompleteDropdown.innerHTML = '';
        matches.forEach((m, idx) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (idx === 0 ? ' active' : '');

            const acLabel = document.createElement('span');
            acLabel.className = 'ac-label';
            acLabel.textContent = m.label;
            item.appendChild(acLabel);

            item.appendChild(document.createTextNode(' '));

            const acKind = document.createElement('span');
            acKind.className = 'ac-kind';
            acKind.textContent = m.kind;
            item.appendChild(acKind);

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                applyAutocomplete(m.label, word);
            });
            autocompleteDropdown.appendChild(item);
        });

        // Position near cursor
        const coords = getCaretCoordinates();
        autocompleteDropdown.style.top = coords.top + 'px';
        autocompleteDropdown.style.left = coords.left + 'px';
        autocompleteDropdown.classList.remove('hidden');
    }

    function handleAutocompleteKey(e) {
        if (autocompleteDropdown.classList.contains('hidden')) return;

        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        let activeIdx = [...items].findIndex(i => i.classList.contains('active'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[activeIdx]?.classList.remove('active');
            activeIdx = (activeIdx + 1) % items.length;
            items[activeIdx]?.classList.add('active');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[activeIdx]?.classList.remove('active');
            activeIdx = (activeIdx - 1 + items.length) % items.length;
            items[activeIdx]?.classList.add('active');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (items.length > 0) {
                e.preventDefault();
                const activeItem = items[activeIdx];
                const label = activeItem?.querySelector('.ac-label')?.textContent;
                if (label) {
                    const pos = queryInput.selectionStart;
                    const textBefore = queryInput.value.substring(0, pos);
                    const wordMatch = textBefore.match(/(\w+)$/);
                    applyAutocomplete(label, wordMatch ? wordMatch[1] : '');
                }
            }
        } else if (e.key === 'Escape') {
            autocompleteDropdown.classList.add('hidden');
        }
    }

    function applyAutocomplete(label, currentWord) {
        const pos = queryInput.selectionStart;
        const before = queryInput.value.substring(0, pos - currentWord.length);
        const after = queryInput.value.substring(pos);
        queryInput.value = before + label + after;
        const newPos = pos - currentWord.length + label.length;
        queryInput.setSelectionRange(newPos, newPos);
        queryInput.focus();
        autocompleteDropdown.classList.add('hidden');
    }

    function getCaretCoordinates() {
        // Approximate caret position relative to the editor-pane
        const pane = document.querySelector('.editor-pane');
        const rect = queryInput.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();

        // Get line/col from cursor position
        const text = queryInput.value.substring(0, queryInput.selectionStart);
        const lines = text.split('\n');
        const lineNum = lines.length;
        const colNum = lines[lines.length - 1].length;

        const lineHeight = 22; // approx
        const charWidth = 8.5; // approx

        return {
            top: (rect.top - paneRect.top) + (lineNum * lineHeight) + 4,
            left: (rect.left - paneRect.left) + (colNum * charWidth) + 16
        };
    }

    // ======= Tab State Management =======
    let tabIdCounter = 1;
    let activeTabId = 1;
    const defaultQuery = queryInput.value.trim();

    const tabStates = {};
    tabStates[1] = {
        name: 'Query 1',
        query: defaultQuery,
        data: null,
        sortCol: null,
        sortAsc: true,
        columnFilters: {}
    };

    function saveActiveTab() {
        const s = tabStates[activeTabId];
        if (!s) return;
        s.query = queryInput.value;
        s.data = currentData;
        s.sortCol = sortCol;
        s.sortAsc = sortAsc;
        s.columnFilters = { ...columnFilters };
    }

    function activateTab(id) {
        activeTabId = id;
        const s = tabStates[id];
        if (!s) return;
        queryInput.value = s.query;
        currentData = s.data;
        sortCol = s.sortCol;
        sortAsc = s.sortAsc;
        columnFilters = s.columnFilters ? { ...s.columnFilters } : {};

        hideError();
        if (currentData && currentData.length > 0) {
            renderTable(currentData);
            enableExportBtns();
        } else {
            tableHead.innerHTML = '';
            tableBody.innerHTML = '';
            resultsTable.classList.add('hidden');
            emptyState.classList.remove('hidden');
            recordCounter.textContent = '';
            disableExportBtns();
        }
    }

    function buildTabBar() {
        // Remove all existing .tab elements
        tabsBar.querySelectorAll('.tab').forEach(t => t.remove());

        const ids = Object.keys(tabStates).map(Number).sort((a, b) => a - b);
        ids.forEach(id => {
            const s = tabStates[id];
            const tab = document.createElement('div');
            tab.className = 'tab' + (id === activeTabId ? ' active' : '');

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = s.name;
            tab.appendChild(label);

            // Close button (only if more than 1 tab)
            if (ids.length > 1) {
                const x = document.createElement('span');
                x.className = 'close-tab';
                x.textContent = '✕';
                x.addEventListener('click', (e) => {
                    e.stopPropagation();
                    delete tabStates[id];
                    if (activeTabId === id) {
                        const rem = Object.keys(tabStates).map(Number);
                        activateTab(rem[0]);
                    }
                    buildTabBar();
                });
                tab.appendChild(x);
            }

            // Double-click label to rename
            label.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'tab-rename-input';
                inp.value = s.name;
                label.replaceWith(inp);
                inp.focus();
                inp.select();
                let committed = false;
                const commit = () => {
                    if (committed) return;
                    committed = true;
                    s.name = inp.value.trim() || s.name;
                    buildTabBar();
                };
                inp.addEventListener('blur', commit);
                inp.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                    if (ev.key === 'Escape') { committed = true; buildTabBar(); }
                });
            });

            // Single click to switch
            tab.addEventListener('click', () => {
                if (id === activeTabId) return;
                saveActiveTab();
                activateTab(id);
                buildTabBar();
            });

            tabsBar.insertBefore(tab, addTabBtn);
        });
    }

    addTabBtn.addEventListener('click', () => {
        saveActiveTab();
        tabIdCounter++;
        tabStates[tabIdCounter] = {
            name: 'Query ' + tabIdCounter,
            query: '',
            data: null,
            sortCol: null,
            sortAsc: true,
            columnFilters: {}
        };
        activateTab(tabIdCounter);
        buildTabBar();
    });

    buildTabBar();

    async function handleRunQuery() {
        const apiKey = apiKeyInput.value.trim();
        const query = queryInput.value.trim();

        if (!apiKey || !query) {
            showError('API Key and Query are required.');
            return;
        }

        // Reset UI Context
        hideError();
        showLoading();
        disableExportBtns();

        try {
            const endpoint = apiUrlInput.value.trim();
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-DBP-APIKEY': apiKey
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                let errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            const jsonResponse = await response.json();
            
            if (jsonResponse.errors && jsonResponse.errors.length > 0) {
                throw new Error('GraphQL Error: ' + jsonResponse.errors.map(e => e.message).join(', '));
            }

            // Extract the actual array of data from the generic response
            const flatData = flattenGraphQLResponse(jsonResponse.data);
            
            if (flatData.length === 0) {
                showError('Query successful, but no data was returned.');
                showEmptyState("No data available to display.");
                return;
            }

            currentData = flatData;
            // Save to tab state
            if (tabStates[activeTabId]) {
                tabStates[activeTabId].data = flatData;
                tabStates[activeTabId].sortCol = null;
                tabStates[activeTabId].sortAsc = true;
                tabStates[activeTabId].columnFilters = {};
            }
            sortCol = null;
            sortAsc = true;
            columnFilters = {};
            renderTable(currentData);
            enableExportBtns();

        } catch (error) {
            showError(error.message);
            showEmptyState("An error occurred. Check the logs.");
        }
    }

    // Helper to find the first array in the nested GraphQL response objects
    function flattenGraphQLResponse(dataObj) {
        if (!dataObj) return [];
        
        let targetArray = null;

        // Recursive search for the deepest array or target 'data' field
        function findArray(obj) {
            if (Array.isArray(obj)) {
                targetArray = obj;
                return;
            }
            if (typeof obj === 'object' && obj !== null) {
                // If the node has a 'data' array (like the Contracts example)
                if (Array.isArray(obj.data)) {
                    targetArray = obj.data;
                    return;
                }
                // Else continue traversing
                for (const key of Object.keys(obj)) {
                    if (targetArray) break;
                    findArray(obj[key]);
                }
            }
        }

        findArray(dataObj);
        return targetArray || [];
    }

    // Table state
    const recordCounter = document.getElementById('recordCounter');
    let sortCol = null;
    let sortAsc = true;
    let columnFilters = {};

    function renderTable(dataArray) {
        tableHead.innerHTML = '';
        tableBody.innerHTML = '';

        if (!dataArray || dataArray.length === 0) return;

        const headers = Object.keys(dataArray[0]);

        // Filter row
        const trFilter = document.createElement('tr');
        trFilter.className = 'filter-row';
        headers.forEach(h => {
            const th = document.createElement('th');
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter...';
            input.className = 'col-filter';
            input.value = columnFilters[h] || '';
            input.addEventListener('input', () => {
                columnFilters[h] = input.value;
                renderTableRows(dataArray, headers);
            });
            th.appendChild(input);
            trFilter.appendChild(th);
        });

        // Header row with sort
        const trHead = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.className = 'sortable-th';
            th.textContent = h + (sortCol === h ? (sortAsc ? ' ▲' : ' ▼') : '');
            th.addEventListener('click', () => {
                if (sortCol === h) {
                    sortAsc = !sortAsc;
                } else {
                    sortCol = h;
                    sortAsc = true;
                }
                renderTable(dataArray);
            });
            trHead.appendChild(th);
        });

        tableHead.appendChild(trHead);
        tableHead.appendChild(trFilter);

        renderTableRows(dataArray, headers);

        // Toggle Views
        loadingIndicator.classList.add('hidden');
        emptyState.classList.add('hidden');
        resultsTable.classList.remove('hidden');
        resultsTable.classList.add('fade-in');

        // Auto-resize: remove nowrap so columns fit naturally
        autoResizeColumns();
    }

    function renderTableRows(dataArray, headers) {
        tableBody.innerHTML = '';

        // Apply column filters
        let filtered = dataArray.filter(row => {
            return headers.every(h => {
                const fv = (columnFilters[h] || '').toLowerCase();
                if (!fv) return true;
                let val = row[h];
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                val = val !== undefined && val !== null ? String(val) : '';
                return val.toLowerCase().includes(fv);
            });
        });

        // Apply sort
        if (sortCol) {
            filtered = [...filtered].sort((a, b) => {
                let va = a[sortCol], vb = b[sortCol];
                if (va == null) va = '';
                if (vb == null) vb = '';
                if (typeof va === 'object') va = JSON.stringify(va);
                if (typeof vb === 'object') vb = JSON.stringify(vb);
                va = String(va); vb = String(vb);
                // Try numeric sort
                const na = parseFloat(va), nb = parseFloat(vb);
                if (!isNaN(na) && !isNaN(nb)) {
                    return sortAsc ? na - nb : nb - na;
                }
                return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            });
        }

        // Update counter
        recordCounter.textContent = `(${filtered.length} of ${dataArray.length} records)`;

        // Render rows
        filtered.forEach(row => {
            const tr = document.createElement('tr');
            headers.forEach(h => {
                const td = document.createElement('td');
                let cellVal = row[h];
                if (typeof cellVal === 'object' && cellVal !== null) {
                    cellVal = JSON.stringify(cellVal);
                }
                td.textContent = cellVal !== undefined && cellVal !== null ? cellVal : '';
                tr.appendChild(td);
            });
            tableBody.appendChild(tr);
        });
    }

    function autoResizeColumns() {
        // Let the browser auto-size by removing fixed widths
        const ths = resultsTable.querySelectorAll('th');
        ths.forEach(th => { th.style.width = ''; });
        // After a tick, set each column to its computed width for consistent sizing
        requestAnimationFrame(() => {
            ths.forEach(th => {
                th.style.width = th.offsetWidth + 'px';
            });
        });
    }

    // Export Logic
    function handleDownloadCsv() {
        if (!currentData || currentData.length === 0) return;
        
        const headers = Object.keys(currentData[0]);
        const csvRows = [];
        
        // Add Header row
        csvRows.push(headers.join(','));
        
        // Add data rows
        currentData.forEach(row => {
            const values = headers.map(header => {
                let val = row[header];
                if (typeof val === 'object' && val !== null) {
                    val = JSON.stringify(val);
                }
                val = val !== undefined && val !== null ? String(val) : '';
                // Escape quotes and wrap in quotes if contains comma
                if (val.includes(',') || val.includes('"')) {
                    val = `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            });
            csvRows.push(values.join(','));
        });

        const csvString = csvRows.join('\n');
        downloadFile(csvString, 'export.csv', 'text/csv');
    }

    function handleDownloadMd() {
        if (!currentData || currentData.length === 0) return;

        const headers = Object.keys(currentData[0]);
        const mdRows = [];

        // Add Headers
        mdRows.push(`| ${headers.join(' | ')} |`);
        // Add Separator
        mdRows.push(`| ${headers.map(() => '---').join(' | ')} |`);

        // Add Data
        currentData.forEach(row => {
            const values = headers.map(header => {
                let val = row[header];
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                val = val !== undefined && val !== null ? String(val) : '';
                // Escape pipe character for markdown tables
                return val.replace(/\|/g, '\\|');
            });
            mdRows.push(`| ${values.join(' | ')} |`);
        });

        const mdString = mdRows.join('\n');
        downloadFile(mdString, 'export.md', 'text/markdown');
    }

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // UI Helpers
    function showLoading() {
        loadingIndicator.classList.remove('hidden');
        emptyState.classList.add('hidden');
        resultsTable.classList.add('hidden');
    }

    function showEmptyState(msg) {
        loadingIndicator.classList.add('hidden');
        emptyState.classList.remove('hidden');
        resultsTable.classList.add('hidden');
        if (msg) {
            emptyState.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = msg;
            emptyState.appendChild(p);
        }
    }

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.classList.remove('hidden');
        loadingIndicator.classList.add('hidden');
    }

    function hideError() {
        errorBox.classList.add('hidden');
        errorBox.textContent = '';
    }

    function enableExportBtns() {
        downloadCsvBtn.disabled = false;
        downloadMdBtn.disabled = false;
    }

    function disableExportBtns() {
        downloadCsvBtn.disabled = true;
        downloadMdBtn.disabled = true;
    }
});
