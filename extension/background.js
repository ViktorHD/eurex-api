// Opens the Explorer (the same app as the web version, bundled by scripts/build_extension.mjs) in a tab.
// An already open Explorer tab is focused instead of opening a second one.
const APP_URL = chrome.runtime.getURL('index.html');

async function openExplorer(search = '') {
    const [existing] = await chrome.tabs.query({ url: APP_URL + '*' });
    if (existing && !search) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return;
    }
    if (existing) {
        await chrome.tabs.update(existing.id, { url: APP_URL + search, active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return;
    }
    await chrome.tabs.create({ url: APP_URL + search });
}

chrome.action.onClicked.addListener(() => openExplorer());

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'eurex-lookup',
        title: 'Open Eurex product card for "%s"',
        contexts: ['selection'],
    });
});

// Selected text (a product code such as FDAX) opens its product card via the app's share-link state (explorer/share.js)
chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== 'eurex-lookup' || !info.selectionText) return;
    const code = info.selectionText.trim().toUpperCase();
    if (!/^[A-Z0-9_.-]{1,20}$/.test(code)) return;
    openExplorer('?eurex-api-state=' + encodeURIComponent(btoa(JSON.stringify({ view: 'product', p: code }))));
});
