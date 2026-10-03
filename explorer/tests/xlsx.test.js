import { buildXlsx, columnName, sheetNames, zipStore } from '../xlsx.js';

// Reads the stored (uncompressed) entries of a zip
function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = {};
    let eocd = bytes.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
        expect(dv.getUint32(p, true)).toBe(0x02014b50);
        const size = dv.getUint32(p + 24, true);
        const nameLen = dv.getUint16(p + 28, true);
        const off = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
        const localNameLen = dv.getUint16(off + 26, true);
        const start = off + 30 + localNameLen;
        files[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
        p += 46 + nameLen;
    }
    return files;
}

describe('xlsx writer', () => {
    test('produces the parts of a workbook with one sheet per table', () => {
        const files = unzip(buildXlsx([
            { name: 'Contracts', headers: ['ISIN', 'Strike'], rows: [{ ISIN: 'DE0001', Strike: 5512.5 }] },
            { name: 'Holidays', headers: ['Holiday'], rows: [] }
        ]));
        expect(Object.keys(files).sort()).toEqual([
            '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
            'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'
        ]);
        expect(files['xl/workbook.xml']).toContain('name="Contracts"');
        expect(files['xl/workbook.xml']).toContain('name="Holidays"');
    });

    test('keeps numbers numeric, escapes text and leaves empty cells out', () => {
        const sheet = unzip(buildXlsx([{ name: 'T', headers: ['A', 'B', 'C', 'D', 'E'], rows: [
            { A: 'x < y & "z"', B: 12.5, C: null, D: true, E: { n: 1 } }
        ] }]))['xl/worksheets/sheet1.xml'];
        expect(sheet).toContain('x &lt; y &amp; &quot;z&quot;');
        expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
        expect(sheet).not.toContain('r="C2"');
        expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>');
        expect(sheet).toContain('{&quot;n&quot;:1}');
        expect(sheet).toContain('<c r="A1" s="1"'); // bold header
        expect(sheet).toContain('state="frozen"');
    });

    test('drops characters XML cannot carry', () => {
        const sheet = unzip(buildXlsx([{ name: 'T', headers: ['A'], rows: [{ A: 'ok\u0000\u0008bad' }] }]))['xl/worksheets/sheet1.xml'];
        expect(sheet).toContain('okbad');
    });

    test('an empty result still yields a valid workbook', () => {
        expect(Object.keys(unzip(buildXlsx([])))).toContain('xl/worksheets/sheet1.xml');
    });

    test('column names', () => {
        expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    });

    test('sheet names are valid and unique', () => {
        expect(sheetNames(['a/b', 'A/B', 'x'.repeat(40), '', 'Contracts', 'contracts'])).toEqual([
            'a b', 'A B_2', 'x'.repeat(31), 'Sheet4', 'Contracts', 'contracts_2'
        ]);
    });

    test('zip entries carry correct CRC and sizes', () => {
        const out = zipStore([{ name: 'a.txt', data: 'hello' }]);
        const dv = new DataView(out.buffer);
        expect(dv.getUint32(14, true)).toBe(0x3610a686); // CRC-32 of "hello"
        expect(dv.getUint32(18, true)).toBe(5);
    });
});
