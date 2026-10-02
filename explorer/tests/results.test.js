import { DataTable, toCsv, toTsv, toMarkdown } from '../ui.js';

describe('Result export helpers', () => {
    const headers = ['Contract', 'Price', 'Note'];
    const rows = [
        { Contract: 'FESX 202612', Price: 5512.5, Note: 'a, "quoted" note' },
        { Contract: 'FESX 202703', Price: null, Note: 'line\nbreak' }
    ];

    test('toCsv quotes commas, quotes and line breaks and leaves nulls empty', () => {
        expect(toCsv(headers, rows)).toBe(
            'Contract,Price,Note\r\nFESX 202612,5512.5,"a, ""quoted"" note"\r\nFESX 202703,,"line\nbreak"'
        );
    });

    test('toTsv flattens tabs and line breaks so rows paste cleanly', () => {
        expect(toTsv(headers, rows).split('\n')).toEqual([
            'Contract\tPrice\tNote',
            'FESX 202612\t5512.5\ta, "quoted" note',
            'FESX 202703\t\tline break'
        ]);
    });

    test('toMarkdown escapes pipes', () => {
        expect(toMarkdown(['A'], [{ A: 'x|y' }])).toBe('| A |\n| --- |\n| x\\|y |');
    });

    test('nested objects are serialised as JSON', () => {
        expect(toCsv(['N'], [{ N: { a: 1 } }])).toBe('N\r\n"{""a"":1}"');
    });
});

describe('DataTable visible rows', () => {
    // Bypass the constructor, which renders into the DOM
    const make = (data, state = {}) => {
        const dt = Object.create(DataTable.prototype);
        Object.assign(dt, { data, columnFilters: {}, searchText: '', sortCol: null, sortAsc: true }, state);
        dt._prepareData();
        return dt;
    };
    const data = [
        { Contract: 'FESX 202612', Expiry: '2026-12-18', Price: 5512 },
        { Contract: 'FESX 202703', Expiry: '2027-03-19', Price: 5481 },
        { Contract: 'FDAX 202703', Expiry: '2027-03-19', Price: 23950 }
    ];

    test('global search matches any column, case-insensitively', () => {
        expect(make(data, { searchText: 'fdax' }).getVisibleRows().map(r => r.Contract)).toEqual(['FDAX 202703']);
        expect(make(data, { searchText: '2027' }).getVisibleRows()).toHaveLength(2);
    });

    test('column filters combine with search', () => {
        const dt = make(data, { searchText: '2027', columnFilters: { Contract: 'fesx' } });
        expect(dt.getVisibleRows().map(r => r.Contract)).toEqual(['FESX 202703']);
    });

    test('sorting applies to exported rows', () => {
        expect(make(data, { sortCol: 'Price', sortAsc: false }).getVisibleRows().map(r => r.Price)).toEqual([23950, 5512, 5481]);
        expect(make(data, { sortCol: 'Expiry', sortAsc: true }).getVisibleRows()[0].Contract).toBe('FESX 202612');
    });
});
