import { GraphQLClient } from './client.js';
import { UIManager } from './ui.js?v=2';
import { TabManager } from './tabs.js';
import { Autocomplete } from './autocomplete.js';
import { SchemaExplorer } from './schema.js';
import { Chatbot } from './chatbot.js';
import { TimelineManager } from './timeline.js';
import { InfoPanel } from './info.js';

const DEMO_API_KEY = '68cdafd2-c5c1-49be-8558-37244ab4f513';

/**
 * Extracts root field names from a GraphQL query string.
 * @param {string} query
 * @returns {string[]}
 */
function getRootFields(query) {
    if (!query) return [];
    const cleanQuery = query.replace(/#.*$/gm, ' ');
    const firstBraceIndex = cleanQuery.indexOf('{');
    if (firstBraceIndex === -1) return [];

    let inner = cleanQuery.substring(firstBraceIndex + 1);
    let fields = [];
    let braceDepth = 0;
    let parenDepth = 0;
    let currentToken = '';

    for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char === '{') {
            if (braceDepth === 0 && parenDepth === 0) {
                const t = currentToken.trim().split(/[\s,:]+/).filter(x => x).pop();
                if (t) fields.push(t);
                currentToken = '';
            }
            braceDepth++;
        } else if (char === '}') {
            if (braceDepth === 0) break;
            braceDepth--;
        } else if (char === '(') {
            if (braceDepth === 0 && parenDepth === 0) {
                const t = currentToken.trim().split(/[\s,:]+/).filter(x => x).pop();
                if (t) fields.push(t);
                currentToken = '';
            }
            parenDepth++;
        } else if (char === ')') {
            parenDepth--;
        } else if (braceDepth === 0 && parenDepth === 0) {
            if (/[\s,]/.test(char)) {
                const parts = currentToken.trim().split(/[\s,:]+/).filter(x => x);
                if (parts.length > 0) {
                    for (let j = 0; j < parts.length; j++) fields.push(parts[j]);
                }
                currentToken = '';
            } else {
                currentToken += char;
            }
        }
    }
    const finalParts = currentToken.trim().split(/[\s,:]+/).filter(x => x);
    for (let j = 0; j < finalParts.length; j++) fields.push(finalParts[j]);

    return fields.filter((f, index) => fields.indexOf(f) === index && f && !['query', 'mutation', 'subscription', 'fragment', 'on'].includes(f));
}

document.addEventListener('DOMContentLoaded', () => {
    const apiUrlInput = document.getElementById('apiUrl');
    const runQueryBtn = document.getElementById('runQueryBtn');
    const toggleDocsBtn = document.getElementById('toggleDocsBtn');
    
    // Editor Elements
    const queryInput = document.getElementById('queryInput');
    const variablesInput = document.getElementById('variablesInput');
    const drawerToggle = document.getElementById('drawerToggle');
    const drawerContent = document.getElementById('drawerContent');
    const drawerIcon = document.getElementById('drawerIcon');
    const apiKeyInput = document.getElementById('apiKey');

    // Panes
    const docsPane = document.getElementById('docsPane');
    const closeDocsBtn = document.getElementById('closeDocsBtn');
    const timelinePane = document.getElementById('timelinePane');
    const infoPane = document.getElementById('infoPane');
    const workspaceGrid = document.querySelector('.workspace-grid');
    const queryPane = document.getElementById('queryPane');
    const resultsPane = document.querySelector('.results-pane');

    // Global Nav
    const appNav = document.querySelector('.app-nav');
    const navEurexOverview = document.getElementById('nav-eurex-overview');
    const navTradingHours = document.getElementById('nav-trading-hours');
    const navApiExplorer = document.getElementById('nav-api-explorer');
    const navInfo = document.getElementById('nav-info');
    const actionBar = document.querySelector('.action-bar');
    const tabsBar = document.getElementById('tabsBar');

    // Panes addition
    const overviewPane = document.getElementById('overviewPane');

    // Toggles
    const toggleQueryBtn = document.getElementById('toggleQueryBtn');
    const closeQueryBtn = document.getElementById('closeQueryBtn');
    const firstSplitter = document.querySelector('.resize-handle:not(#docsSplitter)');

    function switchAppView(view) {
        // Reset active states
        navEurexOverview?.classList.remove('active');
        navTradingHours?.classList.remove('active');
        navApiExplorer?.classList.remove('active');
        navInfo?.classList.remove('active');

        // Hide all major panes
        overviewPane.classList.add('hidden');
        timelinePane.classList.add('hidden');
        infoPane.classList.add('hidden');
        queryPane.classList.add('hidden');
        resultsPane.classList.add('hidden');
        docsPane.classList.add('hidden');
        actionBar.classList.add('hidden');
        tabsBar.classList.add('hidden');
        document.querySelectorAll('.resize-handle').forEach(h => h.classList.add('hidden'));

        if (view === 'eurex-overview') {
            navEurexOverview?.classList.add('active');
            overviewPane.classList.remove('hidden');
        } else if (view === 'trading-hours') {
            navTradingHours?.classList.add('active');
            timelinePane.classList.remove('hidden');
            timelineManager.fetchAndRender();
        } else if (view === 'info') {
            navInfo?.classList.add('active');
            infoPane.classList.remove('hidden');
            infoPanel.load();
        } else {
            navApiExplorer.classList.add('active');
            
            // Show API Explorer specifics
            actionBar.classList.remove('hidden');
            tabsBar.classList.remove('hidden');
            
            if (isMobile()) {
                switchMobilePane('query');
            } else {
                resultsPane.classList.remove('hidden');
                // Ensure Query pane is always open when switching to or clicking API Explorer
                queryPane.classList.remove('hidden');
                if (firstSplitter) firstSplitter.classList.remove('hidden');
            }
        }
    }

    if (navEurexOverview) {
        navEurexOverview.addEventListener('click', () => switchAppView('eurex-overview'));
    }
    if (navTradingHours) {
        navTradingHours.addEventListener('click', () => switchAppView('trading-hours'));
    }
    if (navApiExplorer) {
        navApiExplorer.addEventListener('click', () => switchAppView('api-explorer'));
    }
    if (navInfo) {
        navInfo.addEventListener('click', () => switchAppView('info'));
    }

    // Sidebar Autohide/Unhide logic with 300ms hover delay
    if (appNav) {
        let expandTimeout = null;

        appNav.addEventListener('mouseenter', () => {
            if (!isMobile()) {
                if (expandTimeout) clearTimeout(expandTimeout);
                expandTimeout = setTimeout(() => {
                    appNav.classList.add('expanded');
                }, 300);
            }
        });

        appNav.addEventListener('mouseleave', () => {
            if (expandTimeout) {
                clearTimeout(expandTimeout);
                expandTimeout = null;
            }
            if (!isMobile()) {
                appNav.classList.remove('expanded');
            }
        });

        // Hide sidebar when a nav item is clicked
        const navBtns = appNav.querySelectorAll('.nav-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (expandTimeout) {
                    clearTimeout(expandTimeout);
                    expandTimeout = null;
                }
                if (!isMobile()) {
                    appNav.classList.remove('expanded');
                }
            });
        });
    }

    function deactivateTimeline() {
        switchAppView('api-explorer');
    }

    toggleQueryBtn.addEventListener('click', () => {
        if (isMobile()) {
            switchMobilePane('query');
        } else {
            const isApiExplorerActive = navApiExplorer?.classList.contains('active');
            if (!isApiExplorerActive) {
                switchAppView('api-explorer');
                queryPane.classList.remove('hidden');
                if (firstSplitter) firstSplitter.classList.remove('hidden');
            } else {
                queryPane.classList.toggle('hidden');
                resultsPane.classList.remove('hidden');
                if (firstSplitter) firstSplitter.classList.toggle('hidden', queryPane.classList.contains('hidden'));
            }
        }
    });

    closeQueryBtn.addEventListener('click', () => {
        if (isMobile()) {
            // No action needed for close on mobile as it's tabbed
        } else {
            queryPane.classList.add('hidden');
            if (firstSplitter) firstSplitter.classList.add('hidden');
        }
    });

    // Submodules Setup
    const client = new GraphQLClient(apiUrlInput.value.trim(), apiKeyInput.value.trim());
    apiKeyInput.addEventListener('input', () => client.setApiKey(apiKeyInput.value.trim()));
    apiUrlInput.addEventListener('input', () => client.setEndpoint(apiUrlInput.value.trim()));

    const ui = new UIManager({
        errorBox: document.getElementById('errorBox'),
        loadingIndicator: document.getElementById('loadingIndicator'),
        emptyState: document.getElementById('emptyState'),
        resultsContainer: document.getElementById('resultsContainer'),
        recordCounter: document.getElementById('recordCounter'),
        validityDate: document.getElementById('validityDate'),
        shareBtn: document.getElementById('actionShareBtn'),
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
                state.variables = variablesInput.value;
                state.data = ui.currentData;
                Object.assign(state, ui.exportState());
            },
            onTabLoad: (state) => {
                deactivateTimeline();
                queryInput.value = state.query || '';
                variablesInput.value = state.variables || '';
                ui.hideError();
                const resultLabel = document.getElementById('resultLabel');
                if (resultLabel) {
                    const isDefaultName = /^Query \d+$/.test(state.name);
                    resultLabel.textContent = isDefaultName ? 'Result' : state.name;
                }

                if (state.data && state.data.length > 0) {
                    ui.renderTable(state.data, state);
                } else {
                    ui.showEmptyState();
                    if (ui.els.validityDate) {
                        ui.els.validityDate.textContent = '';
                        ui.els.validityDate.classList.add('hidden');
                    }
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

    function insertFilterIntoQuery(fieldName, operator) {
        const current = queryInput.value;
        const filterStr = `${fieldName}: { ${operator}: "" }`;

        // Case 1: Existing filter block
        const filterMatch = current.match(/filter\s*:\s*\{/);
        if (filterMatch) {
            const startIndex = filterMatch.index + filterMatch[0].length;
            let braceCount = 0;
            let closingBraceIndex = -1;

            for (let i = startIndex; i < current.length; i++) {
                if (current[i] === '{') braceCount++;
                else if (current[i] === '}') {
                    if (braceCount === 0) { closingBraceIndex = i; break; }
                    braceCount--;
                }
            }

            if (closingBraceIndex !== -1) {
                const innerFilter = current.substring(startIndex, closingBraceIndex).trim();
                const separator = innerFilter ? ', ' : '';
                queryInput.value = current.substring(0, closingBraceIndex).replace(/\s+$/, '') + separator + filterStr + current.substring(closingBraceIndex);
                return;
            }
        }

        // Case 2: No filter block, find the first query field
        const firstFieldMatch = current.match(/query\s*\{\s*([a-zA-Z0-9_]+)/);
        if (firstFieldMatch) {
            const rootFieldName = firstFieldMatch[1];
            const fieldEndIndex = firstFieldMatch.index + firstFieldMatch[0].length;

            // Check if it already has arguments by looking at the next non-whitespace character
            const remainingQuery = current.substring(fieldEndIndex);
            const nextNonWsMatch = remainingQuery.match(/\S/);

            if (nextNonWsMatch && nextNonWsMatch[0] === '(') {
                // Insert into existing arguments
                const argsStartIndex = fieldEndIndex + nextNonWsMatch.index + 1;
                queryInput.value = current.substring(0, argsStartIndex) + `filter: { ${filterStr} }, ` + current.substring(argsStartIndex);
            } else {
                // Add new filter argument
                queryInput.value = current.substring(0, fieldEndIndex) + `(filter: { ${filterStr} })` + current.substring(fieldEndIndex);
            }
            return;
        }

        // Case 3: Fallback - just append at the cursor
        const pos = queryInput.selectionStart || current.length;
        queryInput.value = current.substring(0, pos) + filterStr + current.substring(pos);
    }

    const timelineManager = new TimelineManager(client, {
        container: document.getElementById('timelineContainer'),
        content: document.getElementById('timelineContent'),
        loading: document.getElementById('timelineLoading'),
        timezoneSelect: document.getElementById('timezoneSelect'),
        refreshBtn: document.getElementById('refreshTimelineBtn'),
        filterInput: document.getElementById('timelineFilter')
    });

    const infoPanel = new InfoPanel(client, {
        panel: infoPane,
        statusGrid: document.getElementById('statusGrid'),
        changelogContent: document.getElementById('changelogContent'),
        changelogLoading: document.getElementById('changelogLoading'),
        closeBtn: document.getElementById('closeInfoBtn'),
        refreshBtn: document.getElementById('refreshInfoBtn')
    }, {
        onRunQuery: (query) => {
            queryInput.value = query;
            switchAppView('api-explorer');
            executeGraphQLQuery(query).catch(() => {});
        },
        onClose: () => {
            switchAppView('api-explorer');
        }
    });

    const schemaExplorer = new SchemaExplorer(client, {
        docsTree: document.getElementById('docsTree'),
        docsLoading: document.getElementById('docsLoading'),
        docsEmpty: document.getElementById('docsEmpty'),
        docsSearch: document.getElementById('docsSearch')
    }, {
        onInsertField: insertFieldIntoQuery,
        onInsertFilter: insertFilterIntoQuery,
        onSetQuery: (query) => { queryInput.value = query; }
    });

    // Provider selector show/hide logic
    const aiProviderSelect = document.getElementById('aiProvider');
    const claudeKeyGroup = document.getElementById('claudeKeyGroup');
    const geminiKeyGroup = document.getElementById('geminiKeyGroup');

    function updateProviderFields() {
        const val = aiProviderSelect.value;
        claudeKeyGroup.style.display = val === 'claude' ? '' : 'none';
        geminiKeyGroup.style.display = val === 'gemini' ? '' : 'none';
    }
    aiProviderSelect.addEventListener('change', updateProviderFields);
    updateProviderFields();

    // AI Chatbot Setup
    const aiInfoModal = document.getElementById('aiInfoModal');
    const closeAiInfoModal = document.getElementById('closeAiInfoModal');
    const aiInfoText = document.getElementById('aiInfoText');
    const copyAiInfoBtn = document.getElementById('copyAiInfoBtn');

    const getSdlSummary = async () => {
        const schema = await schemaExplorer.fetchSchema();
        if (!schema) return "Schema not loaded yet.";

        const formatType = (typeObj) => {
            if (!typeObj) return 'Unknown';
            if (typeObj.kind === 'NON_NULL') return formatType(typeObj.ofType) + '!';
            if (typeObj.kind === 'LIST') return '[' + formatType(typeObj.ofType) + ']';
            return typeObj.name || 'Unknown';
        };

        let sdl = "";
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
    };

    const showAiHandoff = async () => {
        const schemaSDL = await getSdlSummary();
        const endpoint = apiUrlInput.value.trim();
        const apiKey = apiKeyInput.value.trim() || DEMO_API_KEY;
        const variables = variablesInput.value.trim();

        const handoffPrompt = `You are a GraphQL expert assisting a developer with the Eurex API.

### API CONFIGURATION
- ENDPOINT: ${endpoint}
- AUTHENTICATION: Use header "X-DBP-APIKEY: ${apiKey}"
${variables ? `- VARIABLES: ${variables}` : ''}

### SCHEMA SUMMARY (SDL)
${schemaSDL}

### INSTRUCTIONS
1. Help the user write valid GraphQL queries for this API.
2. Ensure you use the correct field names and types as defined in the SDL.
3. If the user asks for data visualization, suggest appropriate table columns.
4. You can assume the user is using the Eurex API Explorer.`;

        aiInfoText.value = handoffPrompt;
        aiInfoModal.classList.remove('hidden');
    };

    closeAiInfoModal.addEventListener('click', () => aiInfoModal.classList.add('hidden'));
    copyAiInfoBtn.addEventListener('click', () => {
        aiInfoText.select();
        navigator.clipboard.writeText(aiInfoText.value).then(() => {
            const originalText = copyAiInfoBtn.textContent;
            copyAiInfoBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyAiInfoBtn.textContent = originalText;
            }, 2000);
        });
    });

    document.getElementById('mobileAskAiBtn').addEventListener('click', showAiHandoff);

    window.addEventListener('click', (e) => {
        if (e.target === aiInfoModal) aiInfoModal.classList.add('hidden');
    });

    // Mobile Navigation & More Menu
    const moreMenuBtn = document.getElementById('moreMenuBtn');
    const moreMenu = document.getElementById('moreMenu');
    const bottomNavItems = document.querySelectorAll('.bottom-nav .nav-item');

    function isMobile() {
        return window.innerWidth <= 768;
    }

    function switchMobilePane(paneId) {
        if (!isMobile()) return;

        // Update active nav item
        bottomNavItems.forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-pane') === paneId);
        });

        // Toggle panes
        queryPane.classList.toggle('hidden', paneId !== 'query');
        resultsPane.classList.toggle('hidden', paneId !== 'results');
        docsPane.classList.toggle('hidden', paneId !== 'docs');
        timelinePane.classList.toggle('hidden', paneId !== 'hours');
        infoPane.classList.toggle('hidden', paneId !== 'info');

        if (paneId === 'hours') {
            timelineManager.fetchAndRender();
        }
        if (paneId === 'info') {
            infoPanel.load();
        }

        // Special handling for splitters/resizers (hide on mobile)
        const allSplitters = document.querySelectorAll('.resize-handle');
        allSplitters.forEach(s => s.classList.add('hidden'));

        // If switching to docs, fetch schema if needed
        if (paneId === 'docs' && docsPane.querySelector('#docsTree').classList.contains('hidden')) {
            schemaExplorer.fetchSchema().then(schema => {
                if (schema) autocomplete.setSchema(schema);
            });
        }
    }

    bottomNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const paneId = item.getAttribute('data-pane');
            switchMobilePane(paneId);
        });
    });

    moreMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreMenu.classList.toggle('hidden-menu');
    });

    document.addEventListener('click', (e) => {
        if (!moreMenu.contains(e.target) && e.target !== moreMenuBtn) {
            moreMenu.classList.add('hidden-menu');
        }
    });

    // Initial mobile state
    if (isMobile()) {
        switchMobilePane('query');
    }

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
        getVariables: () => variablesInput.value.trim(),
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
        onRunQuery: async (queryText, variablesObj) => {
            queryInput.value = queryText;
            if (variablesObj) {
                variablesInput.value = JSON.stringify(variablesObj, null, 2);
            }
            // Optionally auto-open the query pane if it's hidden
            if (queryPane.classList.contains('hidden')) {
                toggleQueryBtn.click();
            }
            return await executeGraphQLQuery(queryText, null, variablesObj);
        }
    });

    async function executeGraphQLQuery(query, stateOptions = null, explicitVariables = null) {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey || !query) {
            ui.showError('API Key and Query are required.');
            throw new Error('API Key and Query are required.');
        }

        let variables = explicitVariables;
        if (!variables) {
            const variablesRaw = variablesInput.value.trim();
            if (variablesRaw) {
                try {
                    variables = JSON.parse(variablesRaw);
                } catch (e) {
                    ui.showError('Invalid JSON in Variables: ' + e.message);
                    throw e;
                }
            }
        }

        ui.hideError();
        ui.showLoading();
        ui.disableExportBtns();

        // Mobile: switch to results pane on run
        if (isMobile()) {
            switchMobilePane('results');
        }

        // Dynamic Naming (Update early so it shows even on failure/loading)
        const rootFields = getRootFields(query);
        const newName = rootFields.length > 0 ? rootFields.join(', ') : '';
        const resultLabel = document.getElementById('resultLabel');

        const activeTab = tabs.getActiveState();
        const tabUpdate = {};
        if (newName) {
            tabUpdate.name = newName;
            if (resultLabel) resultLabel.textContent = newName;
        } else {
            tabUpdate.name = 'Query ' + activeTab.id;
            if (resultLabel) resultLabel.textContent = 'Result';
        }
        tabs.updateActiveState(tabUpdate);
        tabs.render();

        try {
            const response = await client.request(query, variables);
            const data = response.data;
            const date = response.date;

            const tableState = stateOptions || { date: date };
            tableState.date = date; // Ensure date is updated with the latest from the response
            if (response.isMultiTable) tableState.isMultiTable = true;
            if (response.name) tableState.name = response.name;

            tabs.updateActiveState({ data: data, ...tableState });

            if (data.length === 0) {
                ui.showEmptyState("Query successful, but no data was returned.");
                if (ui.els.validityDate) {
                    ui.els.validityDate.textContent = '';
                    ui.els.validityDate.classList.add('hidden');
                }
            } else {
                ui.renderTable(data, tableState);
            }
            return data;
        } catch (error) {
            ui.showError(error.message);
            throw error;
        }
    }

    // App Layout Logic
    toggleDocsBtn.addEventListener('click', async () => {
        if (isMobile()) {
            switchMobilePane('docs');
        } else {
            deactivateTimeline();
            docsPane.classList.toggle('hidden');
            resultsPane.classList.remove('hidden');
            const ds = document.getElementById('docsSplitter');
            if (ds) ds.classList.toggle('hidden');

            if (!docsPane.classList.contains('hidden')) {
                const schema = await schemaExplorer.fetchSchema();
                if (schema) autocomplete.setSchema(schema);
            }
        }
    });

    closeDocsBtn.addEventListener('click', () => {
        if (isMobile()) {
            // No action needed for close on mobile
        } else {
            docsPane.classList.add('hidden');
            const ds = document.getElementById('docsSplitter');
            if (ds) ds.classList.add('hidden');
        }
    });

    drawerToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
        deactivateTimeline();
        try {
            await executeGraphQLQuery(queryInput.value.trim());
        } catch (e) {
            // Error already handled in executeGraphQLQuery
        }
    });

    // Export Logic
    const downloadCsvAction = () => {
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
    };

    const downloadMdAction = () => {
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
    };

    document.getElementById('downloadCsvBtn').addEventListener('click', downloadCsvAction);
    document.getElementById('mobileCsvBtn').addEventListener('click', downloadCsvAction);

    document.getElementById('downloadMdBtn').addEventListener('click', downloadMdAction);
    document.getElementById('mobileMdBtn').addEventListener('click', downloadMdAction);

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

    // Share Logic
    const shareBtn = document.getElementById('actionShareBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShareModal = document.getElementById('closeShareModal');
    const shareLinkInput = document.getElementById('shareLinkInput');
    const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');

    const shareAction = () => {
        const uiState = ui.exportState();
        const state = {
            q: queryInput.value.trim(),
            v: variablesInput.value.trim(),
            e: apiUrlInput.value.trim()
        };

        // Handle table states (sorting, filtering, etc.)
        if (uiState.tables && uiState.tables.length > 0) {
            if (uiState.tables.length === 1) {
                // Legacy/Single table support
                const t = uiState.tables[0];
                if (t.sortCol) state.sc = t.sortCol;
                if (t.sortAsc === false) state.sa = false;
                if (t.columnFilters && Object.keys(t.columnFilters).length > 0) state.cf = t.columnFilters;
                if (t.stickyCols && t.stickyCols.length > 0) state.stc = t.stickyCols;
            } else {
                // Multi-table support
                state.ts = uiState.tables.map(t => {
                    const ts = {};
                    if (t.sortCol) ts.sc = t.sortCol;
                    if (t.sortAsc === false) ts.sa = false;
                    if (t.columnFilters && Object.keys(t.columnFilters).length > 0) ts.cf = t.columnFilters;
                    if (t.stickyCols && t.stickyCols.length > 0) ts.stc = t.stickyCols;
                    return ts;
                });
            }
        }

        // Use a more robust way to encode to base64 for Unicode support
        const jsonState = JSON.stringify(state);
        const encodedState = btoa(encodeURIComponent(jsonState).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode('0x' + p1);
        }));

        const url = new URL(window.location.href);
        url.searchParams.set('eurex-api-state', encodedState);

        shareLinkInput.value = url.toString();
        shareModal.classList.remove('hidden');
    };

    closeShareModal.addEventListener('click', () => {
        shareModal.classList.add('hidden');
    });

    copyShareLinkBtn.addEventListener('click', () => {
        shareLinkInput.select();
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            const originalText = copyShareLinkBtn.textContent;
            copyShareLinkBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyShareLinkBtn.textContent = originalText;
            }, 2000);
        });
    });

    shareBtn.addEventListener('click', shareAction);
    document.getElementById('mobileShareBtn').addEventListener('click', shareAction);

    window.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.add('hidden');
        }
    });

    // Handle shared link on load
    const urlParams = new URLSearchParams(window.location.search);
    const sharedStateEncoded = urlParams.get('eurex-api-state');
    if (sharedStateEncoded) {
        try {
            // Robustly decode base64
            const decodedJson = decodeURIComponent(atob(sharedStateEncoded).split('').map((c) => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const s = JSON.parse(decodedJson);

            const query = s.q || s.query;
            const variables = s.v || s.variables;
            const endpoint = s.e || s.endpoint;

            if (query) queryInput.value = query;
            if (variables) variablesInput.value = variables;
            if (endpoint) {
                apiUrlInput.value = endpoint;
                client.setEndpoint(endpoint);
            }

            // Set demo key if current key is empty, to ensure "directly provides results"
            if (!apiKeyInput.value.trim()) {
                apiKeyInput.value = DEMO_API_KEY;
                client.setApiKey(DEMO_API_KEY);
            }

            // Wait a bit for everything to be ready
            setTimeout(() => {
                const tableOptions = {};

                if (s.ts) {
                    // New multi-table format
                    tableOptions.tables = s.ts.map(t => ({
                        sortCol: t.sc || t.sortCol || null,
                        sortAsc: t.sa !== undefined ? t.sa : (t.sortAsc !== undefined ? t.sortAsc : true),
                        columnFilters: t.cf || t.columnFilters || {},
                        stickyCols: t.stc || t.stickyCols || []
                    }));
                } else {
                    // Backward compatibility / Single table
                    tableOptions.sortCol = s.sc || s.sortCol || null;
                    tableOptions.sortAsc = s.sa !== undefined ? s.sa : (s.sortAsc !== undefined ? s.sortAsc : true);
                    tableOptions.columnFilters = s.cf || s.columnFilters || {};
                    tableOptions.stickyCols = s.stc || s.stickyCols || [];
                }

                executeGraphQLQuery(query, tableOptions).catch(() => {});
            }, 500);
        } catch (e) {
            console.error('Failed to parse shared state', e);
        }
    }
});
