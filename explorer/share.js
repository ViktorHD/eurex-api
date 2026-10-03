// Share links: the state of a view as a base64 JSON parameter, restored when the page opens with it.
const PARAM = 'eurex-api-state';

export function encodeState(state) {
    const json = JSON.stringify(state);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (m, hex) => String.fromCharCode('0x' + hex)));
}

export function decodeState(encoded) {
    const json = decodeURIComponent(atob(encoded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
}

export function shareUrl(state, href = globalThis.location?.href || 'http://localhost/') {
    const url = new URL(href);
    url.searchParams.set(PARAM, encodeState(state));
    return url.toString();
}

// State in a page URL's search string, or null when absent or unreadable
export function stateFromSearch(search) {
    const raw = new URLSearchParams(search).get(PARAM);
    if (!raw) return null;
    try { return decodeState(raw); } catch (e) { return null; }
}
