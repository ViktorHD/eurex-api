
const dataArray = [];
const headers = ['id', 'name', 'description', 'category', 'price'];
for (let i = 0; i < 10000; i++) {
    dataArray.push({
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
        category: i % 10 === 0 ? 'A' : 'B',
        price: i * 1.5
    });
}

const columnFilters = {
    name: 'item',
    category: 'a'
};

function originalFilter(dataArray, headers, columnFilters) {
    return dataArray.filter(row => {
        return headers.every(h => {
            const fv = (columnFilters[h] || '').toLowerCase();
            if (!fv) return true;
            let val = row[h];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            val = val !== undefined && val !== null ? String(val) : '';
            return val.toLowerCase().includes(fv);
        });
    });
}

function optimizedFilter(dataArray, headers, columnFilters) {
    const activeFilters = headers
        .map(h => ({ header: h, value: (columnFilters[h] || '').toLowerCase() }))
        .filter(f => f.value);

    return dataArray.filter(row => {
        return activeFilters.every(f => {
            let val = row[f.header];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            val = val !== undefined && val !== null ? String(val) : '';
            return val.toLowerCase().includes(f.value);
        });
    });
}

console.log('Starting benchmark...');

// Warmup
for (let i = 0; i < 100; i++) {
    originalFilter(dataArray, headers, columnFilters);
    optimizedFilter(dataArray, headers, columnFilters);
}

const iterations = 1000;

console.time('Original');
for (let i = 0; i < iterations; i++) {
    originalFilter(dataArray, headers, columnFilters);
}
console.timeEnd('Original');

console.time('Optimized');
for (let i = 0; i < iterations; i++) {
    optimizedFilter(dataArray, headers, columnFilters);
}
console.timeEnd('Optimized');

// Verify results are the same
const res1 = originalFilter(dataArray, headers, columnFilters);
const res2 = optimizedFilter(dataArray, headers, columnFilters);
console.log('Results match:', JSON.stringify(res1) === JSON.stringify(res2));
console.log('Result count:', res1.length);
