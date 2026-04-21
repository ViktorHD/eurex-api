import { GraphQLClient } from './client.js';
import { UIManager } from './ui.js';
import { TabManager } from './tabs.js';
import { Autocomplete } from './autocomplete.js';
import { SchemaExplorer } from './schema.js';
import { Chatbot } from './chatbot.js';

document.addEventListener('DOMContentLoaded', () => {
    const apiUrlInput = document.getElementById('apiUrl');
    const runQueryBtn = document.getElementById('runQueryBtn');
    const toggleDocsBtn = document.getElementById('toggleDocsBtn');
    
    // Editor Elements
    const queryInput = document.getElementById('queryInput');
    const drawerToggle = document.getElementById('drawerToggle');
    const drawerContent = document.getElementById('drawerContent');
    const drawerIcon = document.getElementById('drawerIcon');
    const apiKeyInput = document.getElementById('apiKey');

    // Panes
    const docsPane = document.getElementById('docsPane');
    const closeDocsBtn = document.getElementById('closeDocsBtn');
    const workspaceGrid = document.querySelector('.workspace-grid');
    const queryPane = document.getElementById('queryPane');
    const resultsPane = document.querySelector('.results-pane');

    // Toggles
    const toggleQueryBtn = document.getElementById('toggleQueryBtn');
    const closeQueryBtn = document.getElementById('closeQueryBtn');
    const firstSplitter = document.querySelector('.resize-handle:not(#docsSplitter)');

    toggleQueryBtn.addEventListener('click', () => {
        queryPane.classList.toggle('hidden');
        if (firstSplitter) firstSplitter.classList.toggle('hidden');
    });

    closeQueryBtn.addEventListener('click', () => {
        queryPane.classList.add('hidden');
        if (firstSplitter) firstSplitter.classList.add('hidden');
    });

    // Submodules Setup
    const client = new GraphQLClient(apiUrlInput.value.trim(), apiKeyInput.value.trim());
    apiKeyInput.addEventListener('input', () => client.setApiKey(apiKeyInput.value.trim()));
    apiUrlInput.addEventListener('input', () => client.setEndpoint(apiUrlInput.value.trim()));

    const ui = new UIManager({
        errorBox: document.getElementById('errorBox'),
        loadingIndicator: document.getElementById('loadingIndicator'),
        emptyState: document.getElementById('emptyState'),
        resultsTable: document.getElementById('resultsTable'),
        tableHead: document.getElementById('tableHead'),
        tableBody: document.getElementById('tableBody'),
        recordCounter: document.getElementById('recordCounter'),
        downloadCsvBtn: document.getElementById('downloadCsvBtn'),
        downloadMdBtn: document.getElementById('downloadMdBtn'),
        onStateChange: (state) => {
            tabs.updateActiveState(state);
        }
    });

    const tabs = new TabManager(
        document.getElementById('tabsBar'),
        document.getElementById('addTabBtn'),
        {
            onTabSave: (id, state) => {
                state.query = queryInput.value;
                state.data = ui.currentData;
                Object.assign(state, ui.exportState());
            },
            onTabLoad: (state) => {
                queryInput.value = state.query;
                ui.hideError();
                if (state.data && state.data.length > 0) {
                    ui.renderTable(state.data, state);
                } else {
                    ui.showEmptyState();
                }
            }
        }
    );
    tabs.render();

    const autocomplete = new Autocomplete(document.querySelector('.editor-pane'), queryInput);

    // Helpers
    function insertFieldIntoQuery(fieldName) {
        const current = queryInput.value;
        const dataMatch = current.match(/data\s*\{/);

        if (dataMatch) {
            let braceCount = 0;
            let startIndex = dataMatch.index + dataMatch[0].length;
            let closingBraceIndex = -1;

            for (let i = startIndex; i < current.length; i++) {
                if (current[i] === '{') braceCount++;
                else if (current[i] === '}') {
                    if (braceCount === 0) { closingBraceIndex = i; break; }
                    braceCount--;
                }
            }

            if (closingBraceIndex !== -1) {
                const lineStartIndex = current.lastIndexOf('\n', closingBraceIndex) + 1;
                const indentation = current.substring(lineStartIndex, closingBraceIndex).replace(/[^\s]/g, ' ');
                const fieldIndent = indentation + '  ';

                const before = current.substring(0, closingBraceIndex);
                const after = current.substring(closingBraceIndex);

                const cleanBefore = before.replace(/\s+$/, '');

                queryInput.value = cleanBefore + '\n' + fieldIndent + fieldName + '\n' + indentation + after;
                return;
            }
        }

        const pos = queryInput.selectionStart || current.length;
        queryInput.value = current.substring(0, pos) + '\n      ' + fieldName + current.substring(pos);
    }

    const schemaExplorer = new SchemaExplorer(client, {
        docsTree: document.getElementById('docsTree'),
        docsLoading: document.getElementById('docsLoading'),
        docsEmpty: document.getElementById('docsEmpty'),
        docsSearch: document.getElementById('docsSearch')
    }, {
        onInsertField: insertFieldIntoQuery,
        onSetQuery: (query) => { queryInput.value = query; }
    });

    // Provider selector show/hide logic
    const aiProviderSelect = document.getElementById('aiProvider');
    const claudeKeyGroup = document.getElementById('claudeKeyGroup');
    const geminiKeyGroup = document.getElementById('geminiKeyGroup');
    aiProviderSelect.addEventListener('change', () => {
        const val = aiProviderSelect.value;
        claudeKeyGroup.style.display = val === 'claude' ? '' : 'none';
        geminiKeyGroup.style.display = val === 'gemini' ? '' : 'none';
    });
    // Set initial state (databricks is default — no key field shown)
    claudeKeyGroup.style.display = 'none';
    geminiKeyGroup.style.display = 'none';

    // AI Chatbot Setup
    const chatbot = new Chatbot({
        container: document.getElementById('chatbotContainer'),
        window: document.getElementById('chatbotWindow'),
        messagesContainer: document.getElementById('chatbotMessages'),
        input: document.getElementById('chatbotInput'),
        sendBtn: document.getElementById('sendChatbotBtn'),
        toggleBtn: document.getElementById('toggleChatbotBtn'),
        closeBtn: document.getElementById('closeChatbotBtn'),
        getApiKey: () => document.getElementById('geminiApiKey').value.trim(),
        getClaudeApiKey: () => document.getElementById('claudeApiKey').value.trim(),
        getProvider: () => document.getElementById('aiProvider').value,
        getSchemaSummary: async () => {
            const schema = await schemaExplorer.fetchSchema();
            if (!schema) return "Schema not loaded yet.";

            // Helper to stringify GraphQL types accurately
            const formatType = (typeObj) => {
                if (!typeObj) return 'Unknown';
                if (typeObj.kind === 'NON_NULL') return formatType(typeObj.ofType) + '!';
                if (typeObj.kind === 'LIST') return '[' + formatType(typeObj.ofType) + ']';
                return typeObj.name || 'Unknown';
            };

            let sdl = "";

            // Filter out introspection types
            const userTypes = schema.types.filter(t => !t.name.startsWith('__'));

            userTypes.forEach(type => {
                if (type.kind === 'OBJECT') {
                    sdl += `type ${type.name} {\n`;
                    if (type.fields) {
                        type.fields.forEach(f => {
                            let argsStr = "";
                            if (f.args && f.args.length > 0) {
                                argsStr = "(" + f.args.map(a => `${a.name}: ${formatType(a.type)}`).join(", ") + ")";
                            }
                            sdl += `  ${f.name}${argsStr}: ${formatType(f.type)}\n`;
                        });
                    }
                    sdl += `}\n\n`;
                } else if (type.kind === 'INPUT_OBJECT') {
                    sdl += `input ${type.name} {\n`;
                    if (type.inputFields) {
                        type.inputFields.forEach(f => {
                            sdl += `  ${f.name}: ${formatType(f.type)}\n`;
                        });
                    }
                    sdl += `}\n\n`;
                } else if (type.kind === 'ENUM') {
                    sdl += `enum ${type.name} {\n`;
                    if (type.enumValues) {
                        type.enumValues.forEach(v => {
                            sdl += `  ${v.name}\n`;
                        });
                    }
                    sdl += `}\n\n`;
                }
            });

            return sdl.trim();
        },
        onRunQuery: (queryText) => {
            queryInput.value = queryText;
            // Optionally auto-open the query pane if it's hidden
            if (queryPane.classList.contains('hidden')) {
                toggleQueryBtn.click();
            }
            runQueryBtn.click();
        }
    });

    // App Layout Logic
    toggleDocsBtn.addEventListener('click', async () => {
        docsPane.classList.toggle('hidden');
        const ds = document.getElementById('docsSplitter');
        if (ds) ds.classList.toggle('hidden');
        
        if (!docsPane.classList.contains('hidden')) {
            const schema = await schemaExplorer.fetchSchema();
            if (schema) autocomplete.setSchema(schema);
        }
    });

    closeDocsBtn.addEventListener('click', () => {
        docsPane.classList.add('hidden');
        const ds = document.getElementById('docsSplitter');
        if (ds) ds.classList.add('hidden');
    });

    drawerToggle.addEventListener('click', () => {
        drawerContent.classList.toggle('open');
        const isOpen = drawerContent.classList.contains('open');
        drawerIcon.setAttribute('data-feather', isOpen ? 'chevron-down' : 'chevron-up');
        if (window.feather) window.feather.replace(); 
    });

    // Resizing
    const resizeHandlesArray = document.querySelectorAll('.resize-handle');
    resizeHandlesArray.forEach(handle => {
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            workspaceGrid.classList.add('resizing');
            handle.classList.add('active');

            const isDocsSplitter = handle.id === 'docsSplitter';
            let startX = e.clientX;
            let startWidthQuery = queryPane.getBoundingClientRect().width;
            let startWidthDocs = docsPane.getBoundingClientRect().width;

            function onMouseMove(eMove) {
                const dx = eMove.clientX - startX;
                if (isDocsSplitter) {
                    let newWidth = startWidthDocs - dx;
                    if (newWidth < 200) newWidth = 200;
                    if (newWidth > 800) newWidth = 800;
                    docsPane.style.width = newWidth + 'px';
                    docsPane.style.flex = 'none';
                } else {
                    let newWidth = startWidthQuery + dx;
                    if (newWidth < 200) newWidth = 200;
                    if (newWidth > 800) newWidth = 800;
                    queryPane.style.width = newWidth + 'px';
                    queryPane.style.flex = 'none';
                    queryPane.style.maxWidth = 'none';
                }
                resultsPane.style.flex = '1';
            }

            function onMouseUp() {
                workspaceGrid.classList.remove('resizing');
                handle.classList.remove('active');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });

    // Run execution
    runQueryBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const query = queryInput.value.trim();

        if (!apiKey || !query) {
            ui.showError('API Key and Query are required.');
            return;
        }

        ui.hideError();
        ui.showLoading();
        ui.disableExportBtns();

        try {
            const data = await client.request(query);
            
            if (data.length === 0) {
                ui.showEmptyState("Query successful, but no data was returned.");
                tabs.updateActiveState({ data: [] });
                return;
            }

            // Save to tab state
            tabs.updateActiveState({ data: data, sortCol: null, sortAsc: true, columnFilters: {} });
            ui.renderTable(data, { sortCol: null, sortAsc: true, columnFilters: {} });

        } catch (error) {
            ui.showError(error.message);
        }
    });

    // Export Logic
    document.getElementById('downloadCsvBtn').addEventListener('click', () => {
        const data = ui.currentData;
        if (!data || data.length === 0) return;
        
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];
        
        data.forEach(row => {
            const values = headers.map(header => {
                let val = row[header];
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                val = val !== undefined && val !== null ? String(val) : '';
                if (val.includes(',') || val.includes('"')) val = `"${val.replace(/"/g, '""')}"`;
                return val;
            });
            csvRows.push(values.join(','));
        });

        downloadFile(csvRows.join('\n'), 'export.csv', 'text/csv');
    });

    document.getElementById('downloadMdBtn').addEventListener('click', () => {
        const data = ui.currentData;
        if (!data || data.length === 0) return;

        const headers = Object.keys(data[0]);
        const mdRows = [];

        mdRows.push(`| ${headers.join(' | ')} |`);
        mdRows.push(`| ${headers.map(() => '---').join(' | ')} |`);

        data.forEach(row => {
            const values = headers.map(header => {
                let val = row[header];
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                val = val !== undefined && val !== null ? String(val) : '';
                return val.replace(/\|/g, '\\|');
            });
            mdRows.push(`| ${values.join(' | ')} |`);
        });

        downloadFile(mdRows.join('\n'), 'export.md', 'text/markdown');
    });

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
});
