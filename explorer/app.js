import { GraphQLClient } from './client.js?v=3';
import { UIManager, downloadText } from './ui.js?v=6';
import { buildNextPageQuery, canPaginate } from './pagination.js';
import { TabManager } from './tabs.js';
import { Autocomplete } from './autocomplete.js?v=2';
import { QueryEditor, addToHistory, loadHistory, clearHistory, timeAgo } from './editor.js?v=1';
import { SchemaExplorer } from './schema.js?v=2';
import { Chatbot } from './chatbot.js';
import { TimelineManager } from './timeline.js?v=3';
import { InfoPanel } from './info.js?v=5';
import { OverviewManager } from './overview.js?v=7';

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
    const apiOverviewPane = document.getElementById('apiOverviewPane');

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
        const navApiOverview = document.getElementById('nav-api-overview');
        navApiOverview?.classList.remove('active');

        // Hide all major panes
        overviewPane.classList.add('hidden');
        if (apiOverviewPane) apiOverviewPane.classList.add('hidden');
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
            if (!overviewProductsLoaded) {
                overviewProductsLoaded = true;
                overviewManager.loadProducts().then(() => overviewManager.fetchAndRender());
            }
        } else if (view === 'api-overview') {
            navApiOverview?.classList.add('active');
            if (apiOverviewPane) apiOverviewPane.classList.remove('hidden');
        } else if (view === 'trading-hours') {
            navTradingHours?.classList.add('active');
            timelinePane.classList.remove('hidden');
            timelineManager.fetchAndRender();
        } else if (view === 'info') {
            navInfo?.classList.add('active');
            infoPane.classList.remove('hidden');
            infoPanel.load();
        } else {
            navApiExplorer?.classList.add('active');
            
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
    const navApiOverviewBtn = document.getElementById('nav-api-overview');
    if (navApiOverviewBtn) {
        navApiOverviewBtn.addEventListener('click', () => switchAppView('api-overview'));
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

    const overviewManager = new OverviewManager(client, {
        container: document.getElementById('overviewContainer'),
        content: document.getElementById('overviewContent'),
        loading: document.getElementById('overviewLoading'),
        productInput: document.getElementById('overviewProductInput'),
        productList: document.getElementById('overviewProductList'),
        refreshBtn: document.getElementById('refreshOverviewBtn'),
        viewSelect: document.getElementById('overviewViewSelect')
    });
    let overviewProductsLoaded = false;

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
        loadPage: (pager) => loadNextPage(pager),
        onStateChange: (state) => {
            // `data` too: rows loaded from further pages belong to the tab
            tabs.updateActiveState({ ...state, data: ui.currentData });
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

    // Editor (created after autocomplete so its key handling runs second and respects open suggestions)
    let schemaRootNames = null;
    const queryEditor = new QueryEditor(queryInput, { getRootNames: () => schemaRootNames });

    // Load the schema in the background the first time the editor is used: feeds autocomplete and
    // the "unknown query" check without having to open the Docs pane first.
    let schemaRequested = false;
    const ensureSchema = () => {
        if (schemaRequested) return;
        schemaRequested = true;
        schemaExplorer.fetchSchema().then(schema => {
            if (!schema) { schemaRequested = false; return; }
            autocomplete.setSchema(schema);
            const queryType = schema.types.find(t => t.name === (schema.queryType?.name || 'Query'));
            schemaRootNames = new Set((queryType?.fields || []).map(f => f.name));
            queryEditor.refresh();
        }).catch(() => { schemaRequested = false; });
    };
    queryInput.addEventListener('focus', ensureSchema);

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
        filterInput: document.getElementById('timelineFilter'),
        expandAllBtn: document.getElementById('timelineExpandAllBtn')
    });

    const infoPanel = new InfoPanel(client, {
        panel: infoPane,
        statusGrid: document.getElementById('statusGrid'),
        statusSummary: document.getElementById('statusSummary'),
        changelogContent: document.getElementById('changelogContent'),
        changelogFilters: document.getElementById('changelogFilters'),
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
        },
        // Used to turn changelog attributes into full queries
        getSchema: () => schemaExplorer.fetchSchema()
    });

    const schemaExplorer = new SchemaExplorer(client, {
        docsTree: document.getElementById('docsTree'),
        docsLoading: document.getElementById('docsLoading'),
        docsEmpty: document.getElementById('docsEmpty'),
        docsSearch: document.getElementById('docsSearch')
    }, {
        onInsertField: insertFieldIntoQuery,
        onInsertFilter: insertFilterIntoQuery,
        onSetQuery: (query) => {
            queryInput.value = query;
            tabs.updateActiveState({ query });
        },
        onRunQuery: (query) => {
            queryInput.value = query;
            tabs.updateActiveState({ query });
            executeGraphQLQuery(query).catch(() => {});
        }
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

    let currentRun = null; // AbortController of the query being waited for

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

        // A newer run replaces the one still waiting
        currentRun?.abort();
        const run = new AbortController();
        currentRun = run;

        try {
            const response = await client.request(query, variables, true, {
                signal: run.signal,
                onRetry: ({ attempt, delayMs, status }) => ui.showLoading(
                    status === 429
                        ? `Rate limit reached, retrying in ${Math.ceil(delayMs / 1000)} s (attempt ${attempt + 1})…`
                        : `The API is busy (HTTP ${status}), retrying in ${Math.ceil(delayMs / 1000)} s…`
                )
            });
            const data = response.data;
            const date = response.date;

            const tableState = stateOptions || { date: date };
            tableState.date = date; // Ensure date is updated with the latest from the response
            if (response.isMultiTable) tableState.isMultiTable = true;
            if (response.name) tableState.name = response.name;

            // Tables with more pages on the server get a "Load next page" control
            const warnings = [...(response.partialErrors || [])];
            const pagedTables = response.isMultiTable ? response.data : [{ name: response.name, pageInfo: response.pageInfo }];
            const pagers = pagedTables.map(t => {
                if (!t.pageInfo?.hasNextPage || !t.pageInfo.endCursor) return null;
                if (!canPaginate(query, t.name)) {
                    warnings.push(`${t.name || 'Result'}: more rows exist on the server. To load them here, give the query a literal page argument, e.g. page: { first: 100 }.`);
                    return null;
                }
                return { key: t.name, query, variables, hasNextPage: true, endCursor: t.pageInfo.endCursor };
            });
            delete tableState.pagers;
            if (pagers.some(Boolean)) tableState.pagers = pagers;

            tabs.updateActiveState({ data: data, ...tableState });
            addToHistory(query);

            if (data.length === 0) {
                ui.showEmptyState(warnings.length ? `Query returned no data. ${warnings.join(' ')}` : "Query successful, but no data was returned.");
                if (ui.els.validityDate) {
                    ui.els.validityDate.textContent = '';
                    ui.els.validityDate.classList.add('hidden');
                }
            } else {
                ui.renderTable(data, tableState);
                ui.setWarnings(warnings);
            }
            return data;
        } catch (error) {
            // Cancelled by the user (or replaced by a newer run): nothing to report
            if (error.kind === 'aborted') {
                if (currentRun === run) ui.showEmptyState('Query cancelled.');
                throw error;
            }
            ui.showError(error.message);
            throw error;
        } finally {
            if (currentRun === run) currentRun = null;
        }
    }

    // Next page of one result table: the query with the table's cursor, reduced to that table's rows
    async function loadNextPage(pager) {
        const next = buildNextPageQuery(pager.query, pager.key, pager.cursor);
        if (!next) throw new Error('This query cannot load further pages automatically.');
        const response = await client.request(next, pager.variables || null, true);
        const table = response.isMultiTable ? response.data.find(t => t.name === pager.key) : response;
        if (!table) throw new Error(`The next page did not contain ${pager.key}.`);
        if (response.partialErrors?.length) throw new Error(response.partialErrors.join('; '));
        return { rows: table.data || [], pageInfo: table.pageInfo || null };
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
        const tab = e.target.closest('.qe-drawer-tab');
        const wasOpen = drawerContent.classList.contains('open');
        if (tab) {
            const already = tab.classList.contains('active');
            drawerToggle.querySelectorAll('.qe-drawer-tab').forEach(t => {
                t.classList.toggle('active', t === tab);
                t.setAttribute('aria-selected', String(t === tab));
            });
            drawerContent.querySelectorAll('.qe-drawer-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
            // Clicking the active tab of an open drawer closes it; any other tab opens it
            if (wasOpen && already) drawerContent.classList.remove('open');
            else drawerContent.classList.add('open');
        } else {
            drawerContent.classList.toggle('open');
        }
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

    // Ctrl/Cmd+Enter runs the query from the editor or the variables box
    [queryInput, variablesInput].forEach(el => el?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            runQueryBtn.click();
        }
    }));

    // Run execution
    const runLabel = runQueryBtn.querySelector('.qe-run-label');
    const setRunning = (running) => {
        runQueryBtn.classList.toggle('running', running);
        const label = running ? 'Cancel' : 'Run';
        if (runLabel) runLabel.textContent = label;
        runQueryBtn.title = running ? 'Stop waiting for this query' : 'Run query (Ctrl+Enter)';
    };
    runQueryBtn.addEventListener('click', async () => {
        // While a query runs the button cancels it
        if (runQueryBtn.classList.contains('running')) {
            currentRun?.abort();
            return;
        }
        deactivateTimeline();
        setRunning(true);
        try {
            await executeGraphQLQuery(queryInput.value.trim());
        } catch (e) {
            // Error already handled in executeGraphQLQuery
        } finally {
            setRunning(false);
        }
    });

    // Editor toolbar
    const flash = (btn, text) => {
        btn.dataset.flash = text;
        btn.classList.add('flashed');
        setTimeout(() => btn.classList.remove('flashed'), 1200);
    };
    document.getElementById('formatQueryBtn').addEventListener('click', (e) => {
        if (!queryEditor.format()) flash(e.currentTarget, 'Fix errors first');
        else tabs.updateActiveState({ query: queryInput.value });
    });
    document.getElementById('copyQueryBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try { await navigator.clipboard.writeText(queryInput.value); flash(btn, 'Copied'); }
        catch (err) { flash(btn, 'Copy failed'); }
    });
    document.getElementById('clearQueryBtn').addEventListener('click', () => {
        // Through the editor so Ctrl+Z can bring the query back
        queryEditor._replace('', 0, 0);
        tabs.updateActiveState({ query: '' });
    });

    // Query history (stored per browser)
    const historyBtn = document.getElementById('historyBtn');
    const historyMenu = document.getElementById('historyMenu');
    const closeHistory = () => {
        historyMenu.classList.add('hidden');
        historyBtn.setAttribute('aria-expanded', 'false');
    };
    const renderHistory = () => {
        historyMenu.innerHTML = '';
        const list = loadHistory();
        const head = document.createElement('div');
        head.className = 'qe-history-head';
        head.textContent = list.length ? 'Recently run' : 'No queries run yet';
        historyMenu.appendChild(head);
        list.forEach(h => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qe-history-item';
            item.setAttribute('role', 'menuitem');
            const name = document.createElement('strong');
            name.textContent = (h.roots && h.roots.length ? h.roots.join(', ') : 'Query');
            const when = document.createElement('span');
            when.textContent = timeAgo(h.at);
            const preview = document.createElement('code');
            preview.textContent = h.query.replace(/\s+/g, ' ').trim().slice(0, 90);
            item.append(name, when, preview);
            item.addEventListener('click', () => {
                queryInput.value = h.query;
                tabs.updateActiveState({ query: h.query });
                closeHistory();
                queryInput.focus();
            });
            historyMenu.appendChild(item);
        });
        if (list.length) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'qe-history-clear';
            clear.textContent = 'Clear history';
            clear.addEventListener('click', () => { clearHistory(); renderHistory(); });
            historyMenu.appendChild(clear);
        }
    };
    historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = historyMenu.classList.contains('hidden');
        if (open) { renderHistory(); historyMenu.classList.remove('hidden'); historyBtn.setAttribute('aria-expanded', 'true'); }
        else closeHistory();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.qe-history')) closeHistory(); });
    historyMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeHistory(); historyBtn.focus(); } });

    // Variables: live JSON check
    const varsStatus = document.getElementById('varsStatus');
    const varsBadge = document.getElementById('varsBadge');
    const varsHintHtml = varsStatus.innerHTML;
    const checkVariables = () => {
        const raw = variablesInput.value.trim();
        varsStatus.classList.remove('error', 'ok');
        varsBadge.classList.add('hidden');
        if (!raw) { varsStatus.innerHTML = varsHintHtml; return; }
        try {
            const obj = JSON.parse(raw);
            const used = [...new Set((queryInput.value.match(/\$\w+/g) || []).map(v => v.slice(1)))];
            const missing = used.filter(v => !(v in obj));
            varsStatus.classList.add(missing.length ? 'error' : 'ok');
            varsStatus.textContent = missing.length
                ? `Valid JSON, but the query also uses: ${missing.map(m => '$' + m).join(', ')}`
                : `Valid JSON · ${Object.keys(obj).length} variable${Object.keys(obj).length === 1 ? '' : 's'}`;
            varsBadge.textContent = String(Object.keys(obj).length);
            varsBadge.classList.remove('hidden');
        } catch (err) {
            varsStatus.classList.add('error');
            varsStatus.textContent = 'Invalid JSON: ' + err.message;
            varsBadge.textContent = '!';
            varsBadge.classList.remove('hidden');
        }
    };
    variablesInput.addEventListener('input', checkVariables);
    queryInput.addEventListener('input', () => { if (variablesInput.value.trim()) checkVariables(); });
    document.getElementById('formatVarsBtn').addEventListener('click', () => {
        try { variablesInput.value = JSON.stringify(JSON.parse(variablesInput.value || '{}'), null, 2); } catch (err) { /* status shows the error */ }
        checkVariables();
    });

    // Headers: show/hide key, demo-key notice
    const apiKeyHint = document.getElementById('apiKeyHint');
    const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
    const updateKeyHint = () => {
        const key = apiKeyInput.value.trim();
        apiKeyHint.textContent = !key
            ? 'No key set: requests will fail.'
            : key === DEMO_API_KEY
                ? 'Shared demo key: rate-limited. Create your own key in the Deutsche Börse Developer Portal for higher throughput.'
                : 'Personal key in use. It is sent only to the endpoint above.';
        apiKeyHint.classList.toggle('error', !key);
    };
    apiKeyInput.addEventListener('input', updateKeyHint);
    updateKeyHint();
    toggleApiKeyBtn.addEventListener('click', () => {
        const show = apiKeyInput.type === 'password';
        apiKeyInput.type = show ? 'text' : 'password';
        toggleApiKeyBtn.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
        toggleApiKeyBtn.title = show ? 'Hide key' : 'Show key';
        toggleApiKeyBtn.innerHTML = `<i data-feather="${show ? 'eye-off' : 'eye'}"></i>`;
        if (window.feather) window.feather.replace();
    });

    // Export Logic
    // Exports follow what is on screen: every result table, with its search, filters and sorting applied.
    const downloadCsvAction = () => {
        if (!ui.tables.length) return;
        downloadText(ui.exportCsv(), `${ui.exportFileBase()}.csv`, 'text/csv');
    };

    const downloadMdAction = () => {
        if (!ui.tables.length) return;
        downloadText(ui.exportMarkdown(), `${ui.exportFileBase()}.md`, 'text/markdown');
    };

    document.getElementById('downloadCsvBtn').addEventListener('click', downloadCsvAction);
    document.getElementById('mobileCsvBtn').addEventListener('click', downloadCsvAction);

    document.getElementById('downloadMdBtn').addEventListener('click', downloadMdAction);
    document.getElementById('mobileMdBtn').addEventListener('click', downloadMdAction);

    // Share Logic
    const shareBtn = document.getElementById('actionShareBtn');
    const shareOverviewBtn = document.getElementById('shareOverviewBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShareModal = document.getElementById('closeShareModal');
    const shareLinkInput = document.getElementById('shareLinkInput');
    const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');

    const shareOverviewAction = () => {
        const productInput = document.getElementById('overviewProductInput');
        const viewSelect = document.getElementById('overviewViewSelect');
        const state = {
            view: 'eurex-overview',
            p: productInput ? productInput.value.trim() : '',
            m: viewSelect ? viewSelect.value : 'strike',
            e: apiUrlInput.value.trim()
        };

        const jsonState = JSON.stringify(state);
        const encodedState = btoa(encodeURIComponent(jsonState).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode('0x' + p1);
        }));

        const url = new URL(window.location.href);
        url.searchParams.set('eurex-api-state', encodedState);

        shareLinkInput.value = url.toString();
        shareModal.classList.remove('hidden');
    };

    const shareAction = () => {
        if (navEurexOverview?.classList.contains('active')) {
            shareOverviewAction();
            return;
        }
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
    if (shareOverviewBtn) shareOverviewBtn.addEventListener('click', shareOverviewAction);
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

            const view = s.view;
            const endpoint = s.e || s.endpoint;

            if (endpoint) {
                apiUrlInput.value = endpoint;
                client.setEndpoint(endpoint);
            }

            // Set demo key if current key is empty, to ensure "directly provides results"
            if (!apiKeyInput.value.trim()) {
                apiKeyInput.value = DEMO_API_KEY;
                client.setApiKey(DEMO_API_KEY);
            }

            if (view === 'eurex-overview') {
                switchAppView('eurex-overview');
                const overviewProductInput = document.getElementById('overviewProductInput');
                const overviewViewSelect = document.getElementById('overviewViewSelect');
                if (s.p && overviewProductInput) overviewProductInput.value = s.p;
                if (s.m && overviewViewSelect) overviewViewSelect.value = s.m;

                setTimeout(() => {
                    if (!overviewProductsLoaded) {
                        overviewProductsLoaded = true;
                        overviewManager.loadProducts().then(() => overviewManager.fetchAndRender());
                    } else {
                        overviewManager.fetchAndRender();
                    }
                }, 100);
            } else {
                const query = s.q || s.query;
                const variables = s.v || s.variables;

                if (query) queryInput.value = query;
                if (variables) variablesInput.value = variables;

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
            }
        } catch (e) {
            console.error('Failed to parse shared state', e);
        }
    } else {
        switchAppView('api-overview');
    }

    // API Overview Domain Buttons
    const DOMAIN_QUERIES = {
        products: `query {
  ProductInfos(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      Name
      ProductISIN
      ProductLine
      ProductType
      LiquidityClass
      Currency
      ContractSize
      TickSize
      TickValue
      SettlementType
      Underlying
      UnderlyingISIN
    }
  }
  Contracts(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Contract
      ISIN
      ContractDate
      ExpirationDate
      FirstTradingDate
      LastTradingDate
      PreviousDaySettlementPrice
    }
  }
}`,

        calendar: `query {
  TradingHours(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      StartContinuousTrading
      EndOpeningAuction
      EndContinuousTrading
      EndClosingAuction
      StartTES
      EndTES
      LTDBook
      LTDTES
    }
  }
  Holidays(filter: { Product: { eq: "FESX" } }, sort: { field: Holiday, order: ASC }) {
    date
    data {
      Product
      Holiday
      ExchangeHoliday
    }
  }
}`,

        parameters: `query {
  TickRules(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      TradeType
      InstrumentType
      StartPrice
      EndPrice
      PriceStep
    }
  }
  TESProfiles(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      TESType
      InstrumentType
      PriceValidationRule
      AllowAutoApproval
      AllowBroker
      MinLotSize
      MinLotSizeNonPrimary
      MinExpiryRange
      NonDisclosureLimit
      TESminStep
      MaxTrader
      LegPriceEntry
    }
  }
}`,

        flexible: `query {
  FlexibleContracts(filter: { Product: { eq: "OESX" } }, sort: { field: ContractID, order: ASC }) {
    date
    data {
      ContractID
      Contract
      ISIN
      CallPut
      Strike
      ExpirationDate
      SettlementDate
      SettlementPrice
      OpenInterest
      ExerciseStyle
      SettlementType
    }
  }
  SettlementPrices(
    filter: { Product: { eq: "OESX" }, ContractType: { eq: "FLEXIBLE" } }
    sort: { field: ContractID, order: ASC }
  ) {
    date
    data {
      ContractID
      Product
      ContractType
      PriceType
      SettlementPrice
      SettlementDate
    }
  }
}`,

        options: `query {
  Expirations(filter: { Product: { eq: "OESX" } }) {
    date
    data {
      ProductID
      Product
      MasterContract
      ExpirationIndex
      ExpirationDate
    }
  }
  Contracts(filter: { Product: { eq: "OESX" } }) {
    date
    data {
      Contract
      ISIN
      ContractDate
      ContractCycle
      ExpirationDate
      CallPut
      Strike
      OptionsDelta
      PreviousDaySettlementPrice
    }
  }
}`
    };

    document.querySelectorAll('.domain-query-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const domain = btn.getAttribute('data-domain');
            const q = DOMAIN_QUERIES[domain];
            if (q) {
                queryInput.value = q;
                tabs.updateActiveState({ query: q });
                switchAppView('api-explorer');
                executeGraphQLQuery(q).catch(() => {});
            }
        });
    });

    // API Overview Strike Form
    const apiOverviewStrikeForm = document.getElementById('apiOverviewStrikeForm');
    if (apiOverviewStrikeForm) {
        apiOverviewStrikeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('apiOverviewStrikeProduct');
            const product = input.value.trim().toUpperCase();
            if (/^[A-Z0-9_-]{1,32}$/.test(product)) {
                switchAppView('eurex-overview');
                const pInput = document.getElementById('overviewProductInput');
                if (pInput) pInput.value = product;
                const vSelect = document.getElementById('overviewViewSelect');
                if (vSelect) vSelect.value = 'strike';
                
                setTimeout(() => {
                    if (!overviewProductsLoaded) {
                        overviewProductsLoaded = true;
                        overviewManager.loadProducts().then(() => {
                            if (overviewManager.state) {
                                overviewManager.state.p = product;
                                overviewManager.state.m = 'strike';
                            }
                            overviewManager.fetchAndRender();
                        });
                    } else {
                        if (overviewManager.state) {
                            overviewManager.state.p = product;
                            overviewManager.state.m = 'strike';
                        }
                        overviewManager.fetchAndRender();
                    }
                }, 100);
            }
        });
    }

    const overviewOpenExplorerBtn = document.getElementById('overviewOpenExplorerBtn');
    if (overviewOpenExplorerBtn) {
        overviewOpenExplorerBtn.addEventListener('click', () => switchAppView('api-explorer'));
    }

    // Live Schema Link
    const overviewLiveSchemaLink = document.getElementById('overviewLiveSchemaLink');
    if (overviewLiveSchemaLink) {
        overviewLiveSchemaLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchAppView('api-explorer');
            if (docsPane.classList.contains('hidden')) {
                toggleDocsBtn.click();
            }
        });
    }
});
