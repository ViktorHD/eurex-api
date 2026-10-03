// Product search over the catalog (code, name, ISIN, type, currency, vendor codes).
import { productHaystack } from './catalog.js';

// Products matching every word of `text`, best matches first (exact code, code prefix, name prefix, others).
// vendor: Map(product code -> [vendor symbols]) searched as well. type: exact ProductType, '' for any.
export function searchProducts(catalog, text, { type = '', vendor = null, limit = 100 } = {}) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    const q = words.join(' ');
    const out = [];
    for (const p of catalog) {
        if (type && p.ProductType !== type) continue;
        const code = String(p.Product).toLowerCase();
        const hay = productHaystack(p, vendor?.get(p.Product) || []);
        if (!words.every(w => hay.includes(w))) continue;
        const name = String(p.Name || '').toLowerCase();
        let rank = 4;
        if (code === q) rank = 0;
        else if (code.startsWith(q)) rank = 1;
        else if (name.startsWith(q)) rank = 2;
        else if (words.every(w => code.includes(w) || name.includes(w))) rank = 3;
        out.push({ p, rank });
    }
    out.sort((a, b) => a.rank - b.rank || String(a.p.Product).localeCompare(String(b.p.Product)));
    return { total: out.length, items: out.slice(0, limit).map(x => x.p) };
}

export const productTypes = (catalog) => [...new Set(catalog.map(p => p.ProductType).filter(Boolean))].sort();

// Vendor symbols per product from VendorCodes rows (field names come from the schema): every other text value of a
// row is a searchable symbol of its Product.
export function vendorMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
        const product = row.Product;
        if (!product) continue;
        const values = Object.entries(row).filter(([k, v]) => k !== 'Product' && k !== 'ProductID' && typeof v === 'string' && v).map(([, v]) => v);
        if (!map.has(product)) map.set(product, []);
        map.get(product).push(...values);
    }
    return map;
}
