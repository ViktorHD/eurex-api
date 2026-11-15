// Builds the Chrome / Edge extension into extension/dist from the web Explorer, so there is one code base:
//   index.html + explorer/   -> the extension page (same files as the web app and the Android app)
//   extension/*              -> manifest, service worker, icons
// Manifest V3 pages may not load remote scripts or run inline scripts, so the build
//   - vendors three.js and feather-icons from node_modules (versions pinned in package.json),
//   - replaces the import map by relative imports,
//   - moves the two inline scripts of index.html into files,
//   - drops the Google Fonts link (the CSS falls back to system fonts).
// Usage: node scripts/build_extension.mjs [--zip]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'extension', 'dist');

const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

// Pure transforms, exported for tests
export function transformIndexHtml(html) {
    let out = html
        .replace(/<script>\s*\/\/ Land on the API Overview[\s\S]*?<\/script>/, '<script src="ext/boot.js"></script>')
        .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/, '')
        .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
        .replace(/<script src="https:\/\/unpkg\.com\/feather-icons"><\/script>/, '<script src="vendor/feather.min.js"></script>')
        .replace(/<script>\s*feather\.replace\(\);\s*<\/script>/, '<script src="ext/icons.js"></script>');
    return out;
}

export function rewriteThreeImports(source, relToVendor) {
    return source
        .replace(/import\('three\/addons\/([^']+)'\)/g, `import('${relToVendor}/three/addons/$1')`)
        .replace(/import\('three'\)/g, `import('${relToVendor}/three/three.module.js')`);
}

export function build() {
    fs.rmSync(dist, { recursive: true, force: true });

    const html = transformIndexHtml(read('index.html'));
    for (const bad of ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'type="importmap"'])
        if (html.includes(bad)) throw new Error(`index.html still references ${bad}; update transformIndexHtml`);
    write(path.join(dist, 'index.html'), html);

    // Web app modules (no tests / screenshots), three.js imports pointed at the vendored copy
    const srcDir = path.join(root, 'explorer');
    for (const f of fs.readdirSync(srcDir)) {
        if (!fs.statSync(path.join(srcDir, f)).isFile() || f.endsWith('.png')) continue;
        let text = fs.readFileSync(path.join(srcDir, f));
        if (f.endsWith('.js')) text = rewriteThreeImports(text.toString('utf8'), '../vendor');
        write(path.join(dist, 'explorer', f), text);
    }

    // Vendored libraries
    const nm = (...p) => path.join(root, 'node_modules', ...p);
    fs.copyFileSync(nm('feather-icons', 'dist', 'feather.min.js'), (fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true }), path.join(dist, 'vendor', 'feather.min.js')));
    const t = path.join(dist, 'vendor', 'three');
    write(path.join(t, 'three.module.js'), fs.readFileSync(nm('three', 'build', 'three.module.js')));
    for (const f of ['controls/OrbitControls.js', 'renderers/CSS2DRenderer.js'])
        write(path.join(t, 'addons', f), fs.readFileSync(nm('three', 'examples', 'jsm', f), 'utf8').replace(/from 'three'/g, `from '../../three.module.js'`));

    // Inline scripts of index.html, as files
    write(path.join(dist, 'ext', 'boot.js'),
        "// Land on the API Overview without a flash of the Explorer; share links open the Explorer directly\n" +
        "if (location.search.indexOf('eurex-api-state=') < 0) document.documentElement.classList.add('boot-overview');\n");
    write(path.join(dist, 'ext', 'icons.js'), 'feather.replace();\n');

    // Extension shell
    for (const f of ['manifest.json', 'background.js']) fs.copyFileSync(path.join(root, 'extension', f), path.join(dist, f));
    fs.cpSync(path.join(root, 'extension', 'icons'), path.join(dist, 'icons'), { recursive: true });
    return dist;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    build();
    console.log('Built', path.relative(root, dist));
    if (process.argv.includes('--zip')) {
        const zip = path.join(root, 'extension', 'eurex-explorer-extension.zip');
        fs.rmSync(zip, { force: true });
        execFileSync('zip', ['-qr', zip, '.'], { cwd: dist });
        console.log('Zipped', path.relative(root, zip));
    }
}
