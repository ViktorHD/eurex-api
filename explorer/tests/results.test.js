import { DataTable, UIManager, toCsv, toTsv, toMarkdown } from '../ui.js';

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

describe('Record panel navigation', () => {
    const makeTable = (data, state = {}) => {
        const dt = Object.create(DataTable.prototype);
        Object.assign(dt, { data, columnFilters: {}, searchText: '', sortCol: null, sortAsc: true, selectedIndex: null, tableBody: null }, state);
        dt._prepareData();
        return dt;
    };
    const makeUi = () => {
        const ui = new UIManager({});
        ui._renderDetail = () => {}; // panel DOM is covered by the browser checks
        ui.detailEl = { classList: { add() {}, remove() {} }, querySelector: () => null };
        return ui;
    };
    const data = [
        { Contract: 'C', Price: 3 },
        { Contract: 'A', Price: 1 },
        { Contract: 'B', Price: 2 }
    ];

    test('opening selects the row and steps follow the visible (sorted) order', () => {
        const table = makeTable(data, { sortCol: 'Price', sortAsc: true });
        const ui = makeUi();
        ui.openRecord(table, 1); // A
        expect(table.selectedIndex).toBe(1);
        ui.stepRecord(1);
        expect(ui.detail.index).toBe(2); // B
        ui.stepRecord(1);
        expect(ui.detail.index).toBe(0); // C
        ui.stepRecord(1); // already last: stays
        expect(ui.detail.index).toBe(0);
        ui.stepRecord(-2);
        expect(ui.detail.index).toBe(1);
    });

    test('steps skip rows hidden by search', () => {
        const table = makeTable(data, { searchText: 'a' }); // matches only A... and none else by name
        const ui = makeUi();
        expect(table.visibleIndices()).toEqual([1]);
        ui.openRecord(table, 1);
        ui.stepRecord(1);
        expect(ui.detail.index).toBe(1);
    });

    test('closing clears the selection', () => {
        const table = makeTable(data);
        const ui = makeUi();
        ui.openRecord(table, 2);
        ui.closeRecord();
        expect(ui.detail).toBeNull();
        expect(table.selectedIndex).toBeNull();
    });
});
