import fs from 'node:fs';
import path from 'node:path';
import { transformIndexHtml, rewriteThreeImports, build } from '../../scripts/build_extension.mjs';

import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('browser extension build', () => {
    test('index.html has no remote or inline scripts after the transform', () => {
        const out = transformIndexHtml(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
        expect(out).not.toMatch(/https:\/\/(unpkg|cdn\.jsdelivr|fonts\.googleapis)/);
        expect(out).not.toMatch(/importmap/);
        expect(out).not.toMatch(/<script>/);
        expect(out).toContain('vendor/feather.min.js');
        expect(out).toContain('ext/boot.js');
    });

    test('three.js imports point at the vendored copy', () => {
        const src = "await import('three'); await import('three/addons/controls/OrbitControls.js');";
        expect(rewriteThreeImports(src, '../vendor')).toBe(
            "await import('../vendor/three/three.module.js'); await import('../vendor/three/addons/controls/OrbitControls.js');");
    });

    test('built extension is complete, MV3-valid and self-contained', () => {
        const dist = build();
        const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
        expect(manifest.manifest_version).toBe(3);
        for (const f of [manifest.background.service_worker, ...Object.values(manifest.icons), 'index.html', 'explorer/app.js',
            'vendor/feather.min.js', 'vendor/three/three.module.js', 'vendor/three/addons/controls/OrbitControls.js'])
            expect(fs.existsSync(path.join(dist, f))).toBe(true);
        // every explorer module of the web app is shipped
        for (const f of fs.readdirSync(path.join(root, 'explorer')).filter(f => f.endsWith('.js')))
            expect(fs.existsSync(path.join(dist, 'explorer', f))).toBe(true);
        // no bare three.js specifier or CDN url left in any shipped script
        for (const f of fs.readdirSync(path.join(dist, 'explorer')).filter(f => f.endsWith('.js'))) {
            const text = fs.readFileSync(path.join(dist, 'explorer', f), 'utf8');
            expect(text).not.toMatch(/import\(['"]three/);
            expect(text).not.toMatch(/(from|import)\s*\(?\s*['"]https?:/);
        }
    });
});
