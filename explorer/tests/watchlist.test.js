import { getWatchlist, isWatched, normalizeProduct, onWatchlistChange, resetWatchlistCache, setWatchlist, toggleWatched } from '../watchlist.js';

const memory = (initial) => { const m = new Map(initial ? [['eurexExplorer.watchlist', initial]] : []); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), dump: () => m.get('eurexExplorer.watchlist') }; };

beforeEach(() => resetWatchlistCache());

describe('watchlist', () => {
    test('toggles products, normalises codes and persists', () => {
        const s = memory();
        expect(toggleWatched(' fesx ', s)).toBe(true);
        expect(toggleWatched('FDAX', s)).toBe(true);
        expect(getWatchlist(s)).toEqual(['FESX', 'FDAX']);
        expect(isWatched('fesx', s)).toBe(true);
        expect(JSON.parse(s.dump())).toEqual(['FESX', 'FDAX']);
        expect(toggleWatched('FESX', s)).toBe(false);
        expect(getWatchlist(s)).toEqual(['FDAX']);
    });

    test('restores from storage and tolerates bad data', () => {
        expect(getWatchlist(memory('["oesx","OESX","bad code!",""]'))).toEqual(['OESX']);
        resetWatchlistCache();
        expect(getWatchlist(memory('not json'))).toEqual([]);
        resetWatchlistCache();
        expect(getWatchlist(memory('{"a":1}'))).toEqual([]);
    });

    test('rejects invalid codes', () => {
        const s = memory();
        expect(toggleWatched('a b', s)).toBe(false);
        expect(toggleWatched('', s)).toBe(false);
        expect(getWatchlist(s)).toEqual([]);
    });

    test('is capped', () => {
        const s = memory();
        setWatchlist(Array.from({ length: 150 }, (_, i) => `P${i}`), s);
        expect(getWatchlist(s)).toHaveLength(100);
        expect(toggleWatched('NEWONE', s)).toBe(false);
    });

    test('announces changes', () => {
        const s = memory();
        const seen = [];
        const off = onWatchlistChange(list => seen.push(list));
        toggleWatched('FESX', s);
        setWatchlist(['A', 'B'], s);
        off();
        toggleWatched('C', s);
        expect(seen).toEqual([['FESX'], ['A', 'B']]);
        expect(normalizeProduct(' x ')).toBe('X');
    });
});
