import { GraphQLClient } from './client.js?v=3';
import { UIManager, downloadText } from './ui.js?v=8';
import { buildNextPageQuery, canPaginate } from './pagination.js';
import { TabManager, loadTabsSnapshot, saveTabsSnapshot } from './tabs.js?v=3';
import { Autocomplete } from './autocomplete.js?v=3';
import { QueryEditor, addToHistory, loadHistory, clearHistory, timeAgo, rootFieldsOf, loadSaved, saveQuery, deleteSaved } from './editor.js?v=2';
import { SchemaExplorer, schemaToSdl } from './schema.js?v=3';
import { Chatbot } from './chatbot.js';
import { TimelineManager } from './timeline.js?v=4';
import { InfoPanel } from './info.js?v=6';
import { DOMAIN_QUERIES } from './examples.js';
import { shareUrl, stateFromSearch } from './share.js';
import { buildSchemaIndex, validateAgainstSchema, completionsAt } from './schemacheck.js';
import { fetchProductCatalog } from './catalog.js';
import { ProductCard } from './productcard.js';
import { ProductsView } from './productsview.js';
import { CalendarView } from './calendarview.js?v=2';
import { loadDisplay, setDisplay, getDisplay, NUMBER_MODES, DATE_MODES } from './displayformat.js';
import { XLSX_MIME } from './xlsx.js';
import { hardenSecretInput, isRevealed, setRevealed } from './secretinput.js';
import { OverviewManager } from './overview.js?v=7';

const DEMO_API_KEY = '68cdafd2-c5c1-49be-8558-37244ab4f513';

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
    const navApiExplorer = document.getElementById('nav-api-explorer');
    const actionBar = document.querySelector('.action-bar');
    const tabsBar = document.getElementById('tabsBar');

    // Panes addition
    const overviewPane = document.getElementById('overviewPane');
    const apiOverviewPane = document.getElementById('apiOverviewPane');
    const productsPane = document.getElementById('productsPane');
    const productPane = document.getElementById('productPane');
    const calendarPane = document.getElementById('calendarPane');

    // Toggles
    const toggleQueryBtn = document.getElementById('toggleQueryBtn');
    const closeQueryBtn = document.getElementById('closeQueryBtn');
    const firstSplitter = document.querySelector('.resize-handle:not(#docsSplitter)');

    // Every view except the API Explorer is one pane with one navigation entry.
    // onShow runs when it opens, onHide when another view replaces it.
    const VIEWS = {
        'api-overview': { nav: 'nav-api-overview', pane: apiOverviewPane },
        'products': { nav: 'nav-products', pane: productsPane, onShow: () => productsView.show() },
        'product': { nav: 'nav-products', pane: productPane },
        'eurex-overview': {
            nav: 'nav-eurex-overview',
            pane: overviewPane,
            onShow: () => {
                if (!overviewProductsLoaded) {
                    overviewProductsLoaded = true;
                    overviewManager.loadProducts().then(() => overviewManager.fetchAndRender());
                }
            }
        },
        'trading-hours': { nav: 'nav-trading-hours', pane: timelinePane, onShow: () => timelineManager.fetchAndRender() },
        'calendar': { nav: 'nav-calendar', pane: calendarPane, onShow: () => calendarView.show(), onHide: () => calendarView.hide() },
        'info': { nav: 'nav-info', pane: infoPane, onShow: () => infoPanel.load() }
    };
    let currentView = 'api-explorer';

    function switchAppView(view, options = {}) {
        document.documentElement.classList.remove('boot-overview');
        VIEWS[currentView]?.onHide?.();
        currentView = VIEWS[view] ? view : 'api-explorer';

        // Reset active states
        document.querySelectorAll('.app-nav .nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('mobileViewsBtn')?.classList.toggle('active', currentView !== 'api-explorer');

        // Hide all major panes
        Object.values(VIEWS).forEach(v => v.pane.classList.add('hidden'));
        timelinePane.classList.add('hidden');
        infoPane.classList.add('hidden');
        queryPane.classList.add('hidden');
        resultsPane.classList.add('hidden');
        docsPane.classList.add('hidden');
        actionBar.classList.add('hidden');
        tabsBar.classList.add('hidden');
        document.querySelectorAll('.resize-handle').forEach(h => h.classList.add('hidden'));

        const spec = VIEWS[currentView];
        if (spec) {
            document.getElementById(spec.nav)?.classList.add('active');
            bottomNavItems.forEach(item => item.classList.toggle('active', item.getAttribute('data-pane') === (currentView === 'info' ? 'info' : 'views')));
            spec.pane.classList.remove('hidden');
            spec.onShow?.();
            return;
        }

        navApiExplorer?.classList.add('active');

        // Show API Explorer specifics
        actionBar.classList.remove('hidden');
        tabsBar.classList.remove('hidden');

        if (isMobile()) {
            switchMobilePane(options.mobilePane || 'query');
        } else {
            resultsPane.classList.remove('hidden');
            // Ensure Query pane is always open when switching to or clicking API Explorer
            queryPane.classList.remove('hidden');
            if (firstSplitter) firstSplitter.classList.remove('hidden');
        }
    }

    ['api-overview', 'products', 'eurex-overview', 'trading-hours', 'calendar', 'info', 'api-explorer'].forEach(view => {
        const id = view === 'api-explorer' ? 'nav-api-explorer' : (VIEWS[view]?.nav);
        document.getElementById(id)?.addEventListener('click', () => switchAppView(view));
    });

    function deactivateTimeline() {
        switchAppView('api-explorer');
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

        // Keyboard users reach the labels too: the sidebar opens while focus is inside it
        // (only for keyboard focus: a mouse press also focuses the button, and expanding then would shift the layout under the click)
        appNav.addEventListener('focusin', (e) => {
            if (!isMobile() && e.target.matches?.(':focus-visible')) appNav.classList.add('expanded');
        });
        appNav.addEventListener('focusout', (e) => {
            if (!appNav.contains(e.relatedTarget) && !isMobile()) appNav.classList.remove('expanded');
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

    toggleQueryBtn.addEventListener('click', () => {
        if (isMobile()) {
            switchMobilePane('query');
        } else {
            if (currentView !== 'api-explorer') {
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

    // Query / Docs buttons show whether their pane is open (the panes are also opened and closed from elsewhere)
    function syncPaneToggles() {
        const inExplorer = currentView === 'api-explorer';
        [[toggleQueryBtn, queryPane], [document.getElementById('toggleDocsBtn'), docsPane]].forEach(([btn, pane]) => {
            if (!btn) return;
            const open = inExplorer && !pane.classList.contains('hidden');
            btn.classList.toggle('active', open);
            btn.setAttribute('aria-pressed', String(open));
        });
    }
    if (typeof MutationObserver !== 'undefined') {
        const paneObserver = new MutationObserver(syncPaneToggles);
        [queryPane, docsPane].forEach(p => paneObserver.observe(p, { attributes: true, attributeFilter: ['class'] }));
    }
    syncPaneToggles();

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
        downloadXlsxBtn: document.getElementById('downloadXlsxBtn'),
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
                // A tab whose query is still running shows no results yet: keep what it has
                if (state.status === 'running') return;
                state.data = ui.currentData;
                Object.assign(state, ui.exportState());
            },
            onTabsChanged: () => persistTabs(),
            onTabClose: (id) => { runs.get(id)?.abort(); runs.delete(id); },
            onTabLoad: (state) => {
                deactivateTimeline();
                queryInput.value = state.query || '';
                variablesInput.value = state.variables || '';
                ui.hideError();
                syncRunButton();
                const resultLabel = document.getElementById('resultLabel');
                if (resultLabel) {
                    const isDefaultName = /^Query \d+$/.test(state.name);
                    resultLabel.textContent = isDefaultName ? 'Result' : state.name;
                }

                if (state.status === 'running') {
                    // The query of this tab is still on its way
                    ui.clearResults();
                    ui.showLoading();
                } else if (state.status === 'error' && state.error) {
                    ui.clearResults();
                    ui.showError(state.error);
                } else if (state.data && state.data.length > 0) {
                    ui.renderTable(state.data, state);
                } else {
                    ui.clearResults();
                    ui.showEmptyState();
                    if (ui.els.validityDate) {
                        ui.els.validityDate.textContent = '';
                        ui.els.validityDate.classList.add('hidden');
                    }
                }
            }
        }
    );

    // Tabs (queries, variables, names) are kept between visits; a shared link replaces them
    let tabsPersistTimer = null;
    function persistTabs() {
        clearTimeout(tabsPersistTimer);
        tabsPersistTimer = setTimeout(() => {
            const active = tabs.getActiveState();
            if (active) { active.query = queryInput.value; active.variables = variablesInput.value; }
            saveTabsSnapshot(tabs.snapshot());
        }, 400);
    }
    const hasSharedLink = !!stateFromSearch(window.location.search);
    if (!hasSharedLink) {
        const restored = tabs.restore(loadTabsSnapshot());
        if (restored) {
            queryInput.value = restored.query || '';
            variablesInput.value = restored.variables || '';
            const resultLabel = document.getElementById('resultLabel');
            if (resultLabel && !/^Query \d+$/.test(restored.name)) resultLabel.textContent = restored.name;
        }
    }
    tabs.render();
    queryInput.addEventListener('input', persistTabs);
    variablesInput.addEventListener('input', persistTabs);

    const autocomplete = new Autocomplete(document.querySelector('.editor-pane'), queryInput);

    // Editor (created after autocomplete so its key handling runs second and respects open suggestions)
    let schemaRootNames = null;
    let schemaIndex = null; // introspection result prepared for validation and completions
    let productChoices = null; // product codes offered inside { Product: { eq: "…" } }
    const queryEditor = new QueryEditor(queryInput, {
        getRootNames: () => schemaRootNames,
        getProblems: (src) => (schemaIndex ? validateAgainstSchema(src, schemaIndex) : [])
    });
    autocomplete.setProvider((text, pos) => (schemaIndex ? completionsAt(text, pos, schemaIndex, { products: productChoices }) : null));

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
            schemaIndex = buildSchemaIndex(schema);
            queryEditor.refresh();
            // Product codes for the Product filter; the editor works without them
            fetchProductCatalog(client).then(list => { productChoices = list; }).catch(() => {});
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
        expandAllBtn: document.getElementById('timelineExpandAllBtn'),
        watchOnlyBtn: document.getElementById('timelineWatchBtn')
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

    // ---- Products, product card, calendar ----
    const getSchemaOnce = () => schemaExplorer.fetchSchema();
    const productCard = new ProductCard(client, { content: document.getElementById('productCardContent') }, {
        getSchema: getSchemaOnce,
        onRunQuery: (query) => {
            queryInput.value = query;
            tabs.updateActiveState({ query });
            switchAppView('api-explorer');
            executeGraphQLQuery(query).catch(() => {});
        },
        onOpenStrikeWindow: (product) => openStrikeWindow(product),
        onShare: (product) => openShare({ view: 'product', p: product, e: apiUrlInput.value.trim() }, 'Share product card')
    });
    function openProduct(code) {
        switchAppView('product');
        productCard.open(code);
    }
    const productsView = new ProductsView(client, { content: document.getElementById('productsContent') }, { onOpenProduct: openProduct, getSchema: getSchemaOnce });
    const calendarView = new CalendarView(client, { content: document.getElementById('calendarContent') }, { onOpenProduct: openProduct });
    document.getElementById('productBackBtn')?.addEventListener('click', () => switchAppView('products'));

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

    // The built-in assistant is the default when the server has a key for it; otherwise offer only the other providers
    fetch('/api/status').then(r => r.json()).then(status => {
        if (!status.builtinAssistant) {
            document.getElementById('aiBuiltinOption')?.remove();
            if (!aiProviderSelect.value) aiProviderSelect.value = 'databricks';
            updateProviderFields();
        }
    }).catch(() => {});

    // AI Chatbot Setup
    const aiInfoModal = document.getElementById('aiInfoModal');
    const closeAiInfoModal = document.getElementById('closeAiInfoModal');
    const aiInfoText = document.getElementById('aiInfoText');
    const copyAiInfoBtn = document.getElementById('copyAiInfoBtn');

    const getSdlSummary = async () => {
        const schema = await schemaExplorer.fetchSchema();
        return schema ? schemaToSdl(schema) : 'Schema not loaded yet.';
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

        // The explorer panes belong to the API Explorer: leave any other view first
        if (currentView !== 'api-explorer' && ['query', 'results', 'docs'].includes(paneId)) {
            switchAppView('api-explorer', { mobilePane: paneId });
            return;
        }
        if (paneId === 'info') {
            switchAppView('info');
            return;
        }

        // Update active nav item
        bottomNavItems.forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-pane') === paneId);
        });

        // Toggle panes
        queryPane.classList.toggle('hidden', paneId !== 'query');
        resultsPane.classList.toggle('hidden', paneId !== 'results');
        docsPane.classList.toggle('hidden', paneId !== 'docs');
        infoPane.classList.add('hidden');

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

    // Views sheet: every view of the app, for phones where the sidebar is not shown
    const viewSheet = document.getElementById('viewSheet');
    const viewsBtn = document.getElementById('mobileViewsBtn');
    const closeViewSheet = () => { viewSheet.classList.add('hidden'); viewsBtn.setAttribute('aria-expanded', 'false'); };
    viewsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = viewSheet.classList.toggle('hidden') === false;
        viewsBtn.setAttribute('aria-expanded', String(open));
    });
    viewSheet.addEventListener('click', (e) => {
        const target = e.target.closest('[data-view]');
        if (target) switchAppView(target.getAttribute('data-view'));
        closeViewSheet();
    });
    document.addEventListener('click', (e) => { if (!viewSheet.contains(e.target) && e.target !== viewsBtn && !viewsBtn.contains(e.target)) closeViewSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewSheet(); });

    bottomNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const paneId = item.getAttribute('data-pane');
            if (paneId === 'views') return; // handled above
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
        getSchemaSummary: getSdlSummary,
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

    // One query can run per tab; switching tabs does not stop it, and its result goes to the tab it was started in
    const runs = new Map(); // tab id -> AbortController
    const rowTotal = (data, multi) => (multi ? data.reduce((n, t) => n + (t.data || []).length, 0) : data.length);

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
        const rootFields = rootFieldsOf(query);
        const newName = rootFields.length > 0 ? rootFields.join(', ') : '';
        const resultLabel = document.getElementById('resultLabel');

        const runTab = tabs.activeTabId;
        const isActive = () => tabs.activeTabId === runTab;
        const tabUpdate = { status: 'running', error: null };
        if (newName) {
            tabUpdate.name = newName;
            if (resultLabel) resultLabel.textContent = newName;
        } else {
            tabUpdate.name = 'Query ' + runTab;
            if (resultLabel) resultLabel.textContent = 'Result';
        }
        tabs.updateTab(runTab, tabUpdate);

        // A newer run in the same tab replaces the one still waiting
        runs.get(runTab)?.abort();
        const run = new AbortController();
        runs.set(runTab, run);
        tabs.render();
        syncRunButton();

        try {
            const response = await client.request(query, variables, true, {
                signal: run.signal,
                onRetry: ({ attempt, delayMs, status }) => isActive() && ui.showLoading(
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

            // The result belongs to the tab the query was started in, which may not be the open one any more
            tabs.updateTab(runTab, { data, ...tableState, status: 'ok', error: null, rowCount: rowTotal(data, !!tableState.isMultiTable) });
            addToHistory(query, globalThis.localStorage, Date.now(), variablesInput.value);
            if (!isActive()) return data; // shown when the tab is opened

            if (data.length === 0) {
                ui.clearResults();
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
                if (runs.get(runTab) === run) {
                    tabs.updateTab(runTab, { status: null });
                    if (isActive()) ui.showEmptyState('Query cancelled.');
                }
                throw error;
            }
            tabs.updateTab(runTab, { status: 'error', error: error.message });
            if (isActive()) { ui.clearResults(); ui.showError(error.message); }
            throw error;
        } finally {
            if (runs.get(runTab) === run) runs.delete(runTab);
            tabs.render();
            syncRunButton();
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
    // The button shows the state of the open tab: Run, or Cancel while that tab's query runs
    function syncRunButton() { setRunning(runs.has(tabs.activeTabId)); }
    runQueryBtn.addEventListener('click', async () => {
        // While a query runs the button cancels it
        if (runs.has(tabs.activeTabId)) {
            runs.get(tabs.activeTabId).abort();
            return;
        }
        deactivateTimeline();
        try {
            await executeGraphQLQuery(queryInput.value.trim());
        } catch (e) {
            // Error already handled in executeGraphQLQuery
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
    const loadQueryIntoEditor = (item) => {
        queryInput.value = item.query;
        // History and saved entries remember their variables; an entry without any leaves the current ones alone
        if (item.variables) variablesInput.value = item.variables;
        tabs.updateActiveState({ query: item.query, variables: variablesInput.value });
        if (variablesInput.value.trim()) variablesInput.dispatchEvent(new Event('input'));
        closeHistory();
        queryInput.focus();
    };
    const renderHistory = () => {
        historyMenu.innerHTML = '';

        // Save the query in the editor under a name
        const saveForm = document.createElement('form');
        saveForm.className = 'qe-save';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Name this query to save it';
        nameInput.maxLength = 60;
        nameInput.autocomplete = 'off';
        nameInput.setAttribute('aria-label', 'Name for the saved query');
        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'qe-save-btn';
        saveBtn.textContent = 'Save';
        saveForm.append(nameInput, saveBtn);
        saveForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!nameInput.value.trim() || !queryInput.value.trim()) return;
            saveQuery(nameInput.value, queryInput.value, variablesInput.value);
            renderHistory();
        });
        historyMenu.appendChild(saveForm);

        const section = (title, list, build) => {
            const head = document.createElement('div');
            head.className = 'qe-history-head';
            head.textContent = title;
            historyMenu.appendChild(head);
            list.forEach(build);
        };
        const preview = (q, vars) => {
            const code = document.createElement('code');
            code.textContent = q.replace(/\s+/g, ' ').trim().slice(0, 90) + (vars && vars.trim() ? '  + variables' : '');
            return code;
        };

        const saved = loadSaved();
        if (saved.length) {
            section('Saved', saved, (h) => {
                const row = document.createElement('div');
                row.className = 'qe-saved-row';
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'qe-history-item';
                item.setAttribute('role', 'menuitem');
                const name = document.createElement('strong');
                name.textContent = h.name;
                item.append(name, preview(h.query, h.variables));
                item.addEventListener('click', () => loadQueryIntoEditor(h));
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'qe-saved-delete';
                del.textContent = '×';
                del.title = `Delete ${h.name}`;
                del.setAttribute('aria-label', `Delete saved query ${h.name}`);
                del.addEventListener('click', (e) => { e.stopPropagation(); deleteSaved(h.name); renderHistory(); });
                row.append(item, del);
                historyMenu.appendChild(row);
            });
        }

        const list = loadHistory();
        section(list.length ? 'Recently run' : 'No queries run yet', list, (h) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qe-history-item';
            item.setAttribute('role', 'menuitem');
            const name = document.createElement('strong');
            name.textContent = (h.roots && h.roots.length ? h.roots.join(', ') : 'Query');
            const when = document.createElement('span');
            when.textContent = timeAgo(h.at);
            item.append(name, when, preview(h.query, h.variables));
            item.addEventListener('click', () => loadQueryIntoEditor(h));
            historyMenu.appendChild(item);
        });
        if (list.length) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'qe-history-clear';
            clear.textContent = 'Clear history';
            clear.addEventListener('click', (e) => { e.stopPropagation(); clearHistory(); renderHistory(); });
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
    // Escape closes the menu from anywhere, e.g. after saving a query re-drew it and focus left the menu
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !historyMenu.classList.contains('hidden')) closeHistory(); });

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
    // Keys are masked text inputs, not password fields, so browsers do not offer to save them as passwords
    [apiKeyInput, document.getElementById('claudeApiKey'), document.getElementById('geminiApiKey')].forEach(hardenSecretInput);
    toggleApiKeyBtn.addEventListener('click', () => {
        const show = !isRevealed(apiKeyInput);
        setRevealed(apiKeyInput, show);
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

    const downloadXlsxAction = () => {
        if (!ui.tables.length) return;
        downloadText(ui.exportXlsx(), `${ui.exportFileBase()}.xlsx`, XLSX_MIME);
    };
    document.getElementById('downloadXlsxBtn').addEventListener('click', downloadXlsxAction);
    document.getElementById('mobileXlsxBtn').addEventListener('click', downloadXlsxAction);

    // Display settings: how numbers and dates are drawn in tables
    loadDisplay();
    const displayBtn = document.getElementById('displayBtn');
    const displayMenu = document.getElementById('displayMenu');
    const fillSelect = (id, options, current) => {
        const sel = document.getElementById(id);
        sel.innerHTML = '';
        Object.entries(options).forEach(([value, label]) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            sel.appendChild(o);
        });
        sel.value = current;
        return sel;
    };
    const numbersSel = fillSelect('displayNumbers', NUMBER_MODES, getDisplay().numbers);
    const datesSel = fillSelect('displayDates', DATE_MODES, getDisplay().dates);
    const applyDisplay = () => { setDisplay({ numbers: numbersSel.value, dates: datesSel.value }); ui.refreshDisplay(); };
    numbersSel.addEventListener('change', applyDisplay);
    datesSel.addEventListener('change', applyDisplay);
    const closeDisplayMenu = () => { displayMenu.classList.add('hidden'); displayBtn.setAttribute('aria-expanded', 'false'); };
    displayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = displayMenu.classList.toggle('hidden') === false;
        displayBtn.setAttribute('aria-expanded', String(open));
    });
    displayMenu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeDisplayMenu);
    displayMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDisplayMenu(); displayBtn.focus(); } });
    document.getElementById('mobileMdBtn').addEventListener('click', downloadMdAction);

    // Share Logic
    const shareBtn = document.getElementById('actionShareBtn');
    const shareOverviewBtn = document.getElementById('shareOverviewBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShareModal = document.getElementById('closeShareModal');
    const shareLinkInput = document.getElementById('shareLinkInput');
    const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');
    const shareTitle = shareModal.querySelector('.modal-header span');

    // Opens the share dialog with a link that restores `state` (see share.js)
    function openShare(state, title = 'Share Results') {
        shareTitle.textContent = title;
        shareLinkInput.value = shareUrl(state);
        shareModal.classList.remove('hidden');
    }

    const shareOverviewAction = () => {
        const productInput = document.getElementById('overviewProductInput');
        const viewSelect = document.getElementById('overviewViewSelect');
        openShare({
            view: 'eurex-overview',
            p: productInput ? productInput.value.trim() : '',
            m: viewSelect ? viewSelect.value : 'strike',
            e: apiUrlInput.value.trim()
        }, 'Share Strike Window');
    };

    const shareTimelineAction = () => openShare({ view: 'trading-hours', e: apiUrlInput.value.trim(), ...timelineManager.getState() }, 'Share Trading Hours');

    // Sorting, filters, pinned and hidden columns of one table, in the short keys of the link format
    const tableShareState = (t) => {
        const ts = {};
        if (t.sortCol) ts.sc = t.sortCol;
        if (t.sortAsc === false) ts.sa = false;
        if (t.columnFilters && Object.keys(t.columnFilters).length > 0) ts.cf = t.columnFilters;
        if (t.stickyCols && t.stickyCols.length > 0) ts.stc = t.stickyCols;
        if (t.hiddenCols && t.hiddenCols.length > 0) ts.hc = t.hiddenCols;
        return ts;
    };

    const shareAction = () => {
        if (currentView === 'eurex-overview') {
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
                Object.assign(state, tableShareState(uiState.tables[0]));
            } else {
                state.ts = uiState.tables.map(tableShareState);
            }
        }
        openShare(state);
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
    document.getElementById('shareTimelineBtn')?.addEventListener('click', shareTimelineAction);
    document.getElementById('mobileShareBtn').addEventListener('click', shareAction);

    window.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.add('hidden');
        }
    });

    // Opens the Strike Window for an option product
    function openStrikeWindow(product) {
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

    // Handle shared link on load
    const s = stateFromSearch(window.location.search);
    if (s) {
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
        } else if (view === 'trading-hours') {
            timelineManager.setState(s);
            switchAppView('trading-hours');
        } else if (view === 'product' && s.p) {
            openProduct(String(s.p));
        } else {
            const query = s.q || s.query;
            const variables = s.v || s.variables;

            if (query) queryInput.value = query;
            if (variables) variablesInput.value = variables;

            // Wait a bit for everything to be ready
            setTimeout(() => {
                const tableOptions = {};
                const read = (t) => ({
                    sortCol: t.sc || t.sortCol || null,
                    sortAsc: t.sa !== undefined ? t.sa : (t.sortAsc !== undefined ? t.sortAsc : true),
                    columnFilters: t.cf || t.columnFilters || {},
                    stickyCols: t.stc || t.stickyCols || [],
                    hiddenCols: t.hc || t.hiddenCols || []
                });

                if (s.ts) {
                    // New multi-table format
                    tableOptions.tables = s.ts.map(read);
                } else {
                    // Backward compatibility / Single table
                    Object.assign(tableOptions, read(s));
                }

                executeGraphQLQuery(query, tableOptions).catch(() => {});
            }, 500);
        }
    } else {
        switchAppView('api-overview');
    }

    // API Overview Domain Buttons
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
            if (/^[A-Z0-9_-]{1,32}$/.test(product)) openStrikeWindow(product);
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
