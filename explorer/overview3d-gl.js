// WebGL (three.js) renderer for the Strike Window 3D view.
// three.js is loaded lazily through the import map in index.html, so none of the other views pay for it.

const SIZE = 10;                 // scene units per axis: the cube spans -SIZE/2 .. SIZE/2 on x/z and 0 .. SIZE on y
const MIN_PITCH = 0.05;
const ORTHO_HALF = 10;           // half the visible height of the orthographic camera at zoom 1
const SURFACE_STEPS = 40;        // moneyness samples per expiry row of the delta surface
const SURFACE_COLORS = { C: '#26a69a', P: '#ef6c00' };
const TWEEN_MS = 450;

export const DEFAULT_GL_OPTIONS = Object.freeze({
    surface: false, atm: true, jumps: false, ortho: false,
    side: 'all',            // 'all' | 'C' | 'P'
    deltaMin: -1, deltaMax: 1
});

// Camera position on a sphere around the cube centre; azimuth spins around the vertical (contract date) axis.
function cameraOffset(azimuth, pitch, radius) {
    return [
        radius * Math.sin(azimuth) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(azimuth) * Math.cos(pitch)
    ];
}

const cssVar = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/**
 * Mounts the scene into `host` and returns a controller (see the return statement).
 * spec = {
 *   points: [{ x, y, z, color, flex, tip, strike, side, delta, jump }]
 *       x = delta, y = contract date, z = moneyness, all normalised to 0..1; delta is the raw value, jump flags a thin-coverage strike
 *   ticks: { delta: [{ n, label }], strike: [...], date: [...] },
 *   titles: { delta, strike, date },
 *   deltaDomain: [min, max]      // raw delta at x = 0 and x = 1, for the delta band filter
 *   atm: number | null           // normalised z of moneyness 1.0, when inside the domain
 *   caption: string              // drawn on PNG exports
 *   options: { ...DEFAULT_GL_OPTIONS } initial display options
 *   view: { position, target, ortho, zoom } | null   // restores a previous camera
 *   onHover(tipText | null, mouseEvent)
 * }
 * Rejects when three.js can't be loaded or WebGL is unavailable.
 */
export async function mountGlScene(host, spec) {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { CSS2DRenderer, CSS2DObject } = await import('three/addons/renderers/CSS2DRenderer.js');

    const P = spec.points;
    const n = P.length;
    const opts = { ...DEFAULT_GL_OPTIONS, ...(spec.options || {}) };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'overview-gl-labels';
    renderer.domElement.className = 'overview-gl-canvas';
    host.append(renderer.domElement, labelRenderer.domElement);
    const surface = labelRenderer.domElement; // receives all pointer and keyboard input
    surface.tabIndex = 0;
    surface.setAttribute('role', 'application');
    surface.setAttribute('aria-label', '3D chart: arrow keys rotate, plus and minus zoom, 0 resets, Escape unpins');

    const scene = new THREE.Scene();
    const persp = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    const ortho = new THREE.OrthographicCamera(-ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 200);
    let camera = persp;
    let isOrtho = false;
    const center = new THREE.Vector3(0, SIZE / 2, 0);
    const tanHalfFov = Math.tan(persp.fov * Math.PI / 360);

    const controls = new OrbitControls(camera, surface);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 + 0.3;
    controls.minDistance = 6;
    controls.maxDistance = 60;
    controls.minZoom = 0.3;
    controls.maxZoom = 12;

    // ---- camera helpers -------------------------------------------------------------------------------------------
    let tween = null;
    const cancelTween = () => { tween = null; };
    controls.addEventListener('start', cancelTween);

    const currentDistance = () => camera.position.distanceTo(controls.target);

    // Eases the camera to a new position/target (and orthographic zoom), turning around the target rather than cutting through it.
    function flyTo(position, target, zoom = null, ms = TWEEN_MS) {
        const fromOffset = camera.position.clone().sub(controls.target);
        const toOffset = position.clone().sub(target);
        tween = {
            t0: performance.now(), ms,
            fromTarget: controls.target.clone(), toTarget: target.clone(),
            fromDir: fromOffset.clone().normalize(), toDir: toOffset.clone().normalize(),
            fromLen: fromOffset.length(), toLen: toOffset.length(),
            fromZoom: camera.zoom, toZoom: zoom
        };
    }

    function stepTween(now) {
        if (!tween) return;
        const t = Math.min(1, (now - tween.t0) / tween.ms);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const q = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(tween.fromDir, tween.toDir), k);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
        const len = tween.fromLen + (tween.toLen - tween.fromLen) * k;
        camera.position.copy(controls.target).add(tween.fromDir.clone().applyQuaternion(q).multiplyScalar(len));
        if (camera.isOrthographicCamera && tween.toZoom != null) {
            camera.zoom = tween.fromZoom + (tween.toZoom - tween.fromZoom) * k;
            camera.updateProjectionMatrix();
        }
        if (t >= 1) tween = null;
    }

    const presetPosition = (azimuth, pitch) => {
        const [x, y, z] = cameraOffset(azimuth, Math.max(MIN_PITCH, pitch), 32);
        return new THREE.Vector3(center.x + x, center.y + y, center.z + z);
    };
    const baseOrthoZoom = ORTHO_HALF / (32 * tanHalfFov);
    const setPreset = (azimuth, pitch) => flyTo(presetPosition(azimuth, pitch), center, isOrtho ? baseOrthoZoom : null);
    const reset = () => setPreset(Math.PI / 4, Math.PI / 6);

    function setOrtho(on) {
        if (on === isOrtho) return;
        const from = camera;
        const to = on ? ortho : persp;
        const offset = from.position.clone().sub(controls.target);
        if (on) {
            ortho.zoom = ORTHO_HALF / (offset.length() * tanHalfFov);
        } else {
            offset.setLength(ORTHO_HALF / (ortho.zoom * tanHalfFov));
        }
        to.position.copy(controls.target).add(offset);
        to.quaternion.copy(from.quaternion);
        to.updateProjectionMatrix();
        camera = to;
        isOrtho = on;
        controls.object = to;
        cancelTween();
        controls.update();
    }

    const zoom = (factor) => {
        cancelTween();
        if (isOrtho) {
            camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * factor));
            camera.updateProjectionMatrix();
        } else {
            const offset = camera.position.clone().sub(controls.target).multiplyScalar(1 / factor);
            offset.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length())));
            camera.position.copy(controls.target).add(offset);
        }
        controls.update();
    };

    // Initial camera
    if (spec.view) {
        persp.position.fromArray(spec.view.position);
        controls.target.fromArray(spec.view.target);
        controls.update();
        if (spec.view.ortho) {
            setOrtho(true);
            if (spec.view.zoom) { ortho.zoom = spec.view.zoom; ortho.updateProjectionMatrix(); }
        }
    } else {
        persp.position.copy(presetPosition(Math.PI / 4, Math.PI / 6));
        controls.target.copy(center);
        controls.update();
    }
    if (opts.ortho !== isOrtho) setOrtho(opts.ortho);
    opts.ortho = isOrtho;

    // ---- scene ----------------------------------------------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(8, 20, 12);
    scene.add(sun);

    const lineColor = new THREE.Color(cssVar(host, '--border-color', '#9aa5b1'));
    const bgColor = new THREE.Color(cssVar(host, '--bg-panel', '#ffffff'));
    const accentColor = new THREE.Color(cssVar(host, '--navy-blue', '#201751'));
    const atmColor = new THREE.Color(cssVar(host, '--neon-green', '#00ce7d'));

    const toX = (v) => v * SIZE - SIZE / 2;
    const toY = (v) => v * SIZE;
    const toZ = (v) => v * SIZE - SIZE / 2;
    const pos = (p) => new THREE.Vector3(toX(p.x), toY(p.y), toZ(p.z));

    // Floor grid plus the three axes.
    const seg = [];
    const line = (a, b) => seg.push(...a, ...b);
    line([-SIZE / 2, 0, -SIZE / 2], [SIZE / 2, 0, -SIZE / 2]);
    line([SIZE / 2, 0, -SIZE / 2], [SIZE / 2, 0, SIZE / 2]);
    line([SIZE / 2, 0, SIZE / 2], [-SIZE / 2, 0, SIZE / 2]);
    line([-SIZE / 2, 0, SIZE / 2], [-SIZE / 2, 0, -SIZE / 2]);
    spec.ticks.delta.forEach(t => line([toX(t.n), 0, -SIZE / 2], [toX(t.n), 0, SIZE / 2]));
    spec.ticks.strike.forEach(t => line([-SIZE / 2, 0, toZ(t.n)], [SIZE / 2, 0, toZ(t.n)]));
    line([-SIZE / 2, 0, -SIZE / 2], [-SIZE / 2, SIZE, -SIZE / 2]); // contract date axis
    spec.ticks.date.forEach(t => line([-SIZE / 2, toY(t.n), -SIZE / 2], [SIZE / 2, toY(t.n), -SIZE / 2]));
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.55 });
    scene.add(new THREE.LineSegments(gridGeo, gridMat));

    const labels = []; // kept for PNG export, where the HTML labels have to be drawn by hand
    const addLabel = (text, position, cls = '') => {
        const el = document.createElement('div');
        el.className = `overview-gl-label ${cls}`.trim();
        el.textContent = text;
        const obj = new CSS2DObject(el);
        obj.position.set(...position);
        scene.add(obj);
        labels.push({ obj, text, title: cls.includes('title'), alignEnd: cls.includes('date') });
        return obj;
    };
    spec.ticks.delta.forEach(t => addLabel(t.label, [toX(t.n), 0, SIZE / 2 + 0.5]));
    spec.ticks.strike.forEach(t => addLabel(t.label, [SIZE / 2 + 0.6, 0, toZ(t.n)]));
    spec.ticks.date.forEach(t => addLabel(t.label, [-SIZE / 2 - 0.4, toY(t.n), -SIZE / 2], 'overview-gl-label-date'));
    addLabel(spec.titles.delta, [0, 0, SIZE / 2 + 1.7], 'overview-gl-title');
    addLabel(spec.titles.strike, [SIZE / 2 + 2.4, 0, 0], 'overview-gl-title');
    addLabel(spec.titles.date, [-SIZE / 2, SIZE + 0.8, -SIZE / 2], 'overview-gl-title');

    // At-the-money plane (moneyness 1.0): where the forward sits at every expiry.
    let atmGroup = null;
    if (spec.atm != null && Number.isFinite(spec.atm)) {
        atmGroup = new THREE.Group();
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(SIZE, SIZE),
            new THREE.MeshBasicMaterial({ color: atmColor, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
        );
        plane.position.set(0, SIZE / 2, toZ(spec.atm));
        const edge = new THREE.LineSegments(
            new THREE.EdgesGeometry(plane.geometry),
            new THREE.LineBasicMaterial({ color: atmColor })
        );
        edge.position.copy(plane.position);
        atmGroup.add(plane, edge);
        scene.add(atmGroup);
        const atmLabel = addLabel('ATM (K/F = 1)', [SIZE / 2 + 0.6, SIZE, toZ(spec.atm)], 'overview-gl-atm');
        atmGroup.userData.label = atmLabel;
    }

    // One instanced mesh for all strikes: a single draw call regardless of how many contracts are listed.
    const radius = Math.max(0.05, Math.min(0.14, 0.2 - Math.log10(Math.max(n, 1)) * 0.04));
    const baseR = P.map(p => p.flex ? Math.max(radius, 0.12) : radius);
    const baseColor = P.map(p => new THREE.Color(p.color));
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 }), Math.max(n, 1));
    mesh.count = n;
    // Outline spheres behind the points that sit next to a delta jump.
    const jumpMat = new THREE.MeshBasicMaterial({ color: 0xff1744, side: THREE.BackSide });
    const jumpMesh = new THREE.InstancedMesh(geo, jumpMat, Math.max(n, 1));
    jumpMesh.count = n;
    scene.add(mesh, jumpMesh);

    const surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);
    const pinGroup = new THREE.Group();
    scene.add(pinGroup);

    // ---- data-dependent state -------------------------------------------------------------------------------------
    let pinned = -1;
    const [dMin, dMax] = spec.deltaDomain || [-1, 1];
    const visible = (i) => {
        const p = P[i];
        if (opts.side !== 'all' && p.side !== opts.side) return false;
        return p.delta >= opts.deltaMin - 1e-9 && p.delta <= opts.deltaMax + 1e-9;
    };
    const sameStrike = (i) => pinned >= 0 && P[i].strike === P[pinned].strike && P[i].side === P[pinned].side;

    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    function applyData() {
        for (let i = 0; i < n; i++) {
            const vis = visible(i);
            const hot = sameStrike(i);
            const r = vis ? baseR[i] * (hot ? 1.8 : 1) : 0;
            m.makeScale(r, r, r).setPosition(toX(P[i].x), toY(P[i].y), toZ(P[i].z));
            mesh.setMatrixAt(i, m);
            mesh.setColorAt(i, pinned >= 0 && !hot ? c.copy(baseColor[i]).lerp(bgColor, 0.78) : baseColor[i]);
            const jr = vis && opts.jumps && P[i].jump ? r * 1.9 : 0;
            m.makeScale(jr, jr, jr).setPosition(toX(P[i].x), toY(P[i].y), toZ(P[i].z));
            jumpMesh.setMatrixAt(i, m);
        }
        for (const mm of [mesh, jumpMesh]) {
            mm.instanceMatrix.needsUpdate = true;
            if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
            mm.computeBoundingSphere();
        }
        buildPinLine();
        buildSurfaces();
    }

    // Line through the pinned strike across all expiries, so its path through the delta structure is visible.
    function buildPinLine() {
        pinGroup.children.slice().forEach(o => { o.geometry.dispose(); o.material.dispose(); pinGroup.remove(o); });
        if (pinned < 0) return;
        const hits = P.map((p, i) => i).filter(i => sameStrike(i) && visible(i)).sort((a, b) => P[a].y - P[b].y);
        if (hits.length < 2) return;
        const g = new THREE.BufferGeometry().setFromPoints(hits.map(i => pos(P[i])));
        pinGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: accentColor })));
    }

    // Delta surface per option side: delta interpolated over moneyness for every expiry, joined between expiries.
    function buildSurfaces() {
        surfaceGroup.children.slice().forEach(o => { o.geometry.dispose(); o.material.dispose(); surfaceGroup.remove(o); });
        if (!opts.surface) return;
        const sides = opts.side === 'all' ? ['C', 'P'] : [opts.side];
        const bandMin = (opts.deltaMin - dMin) / (dMax - dMin || 1);
        const bandMax = (opts.deltaMax - dMin) / (dMax - dMin || 1);
        sides.forEach(side => {
            const byDate = new Map();
            P.forEach(p => {
                if (p.side !== side || p.flex) return;
                if (!byDate.has(p.y)) byDate.set(p.y, []);
                byDate.get(p.y).push(p);
            });
            const rows = [...byDate.entries()]
                .map(([y, pts]) => ({ y, pts: pts.sort((a, b) => a.z - b.z) }))
                .filter(r => r.pts.length >= 2)
                .sort((a, b) => a.y - b.y);
            if (rows.length < 2) return;
            const zs = rows.flatMap(r => [r.pts[0].z, r.pts[r.pts.length - 1].z]);
            const zMin = Math.min(...zs), zMax = Math.max(...zs);

            const positions = new Float32Array(rows.length * SURFACE_STEPS * 3);
            const ok = new Uint8Array(rows.length * SURFACE_STEPS);
            rows.forEach((row, ri) => {
                let si = 0;
                for (let j = 0; j < SURFACE_STEPS; j++) {
                    const z = zMin + (zMax - zMin) * j / (SURFACE_STEPS - 1);
                    const pts = row.pts;
                    if (z < pts[0].z - 1e-9 || z > pts[pts.length - 1].z + 1e-9) continue;
                    while (si < pts.length - 2 && pts[si + 1].z < z) si++;
                    const a = pts[si], b = pts[si + 1];
                    const x = b.z > a.z ? a.x + (b.x - a.x) * Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z))) : a.x;
                    if (x < bandMin - 1e-9 || x > bandMax + 1e-9) continue;
                    const k = ri * SURFACE_STEPS + j;
                    positions.set([toX(x), toY(row.y), toZ(z)], k * 3);
                    ok[k] = 1;
                }
            });
            const index = [];
            for (let ri = 0; ri < rows.length - 1; ri++) {
                for (let j = 0; j < SURFACE_STEPS - 1; j++) {
                    const a = ri * SURFACE_STEPS + j, b = a + 1, d = a + SURFACE_STEPS, e = d + 1;
                    if (ok[a] && ok[b] && ok[d] && ok[e]) index.push(a, d, b, b, d, e);
                }
            }
            if (!index.length) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            g.setIndex(index);
            g.computeVertexNormals();
            surfaceGroup.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({
                color: SURFACE_COLORS[side] || '#888', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, roughness: 1
            })));
        });
    }

    function applyVisibility() {
        jumpMesh.visible = opts.jumps;
        if (atmGroup) {
            atmGroup.visible = opts.atm;
            atmGroup.userData.label.element.style.display = opts.atm ? '' : 'none';
        }
    }
    applyData();
    applyVisibility();

    // ---- pinned strike card ---------------------------------------------------------------------------------------
    const card = document.createElement('div');
    card.className = 'overview-gl-card hidden';
    host.appendChild(card);
    const sideName = (s) => s === 'C' ? 'Call' : s === 'P' ? 'Put' : '';
    function renderCard() {
        card.textContent = '';
        if (pinned < 0) { card.classList.add('hidden'); return; }
        const p = P[pinned];
        const dates = P.filter((_, i) => sameStrike(i)).length;
        const title = document.createElement('div');
        title.className = 'overview-gl-card-title';
        title.textContent = `Strike ${p.strike.toLocaleString('en-US')} ${sideName(p.side)}`.trim();
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'overview-gl-card-close';
        close.setAttribute('aria-label', 'Unpin strike');
        close.textContent = '×';
        close.addEventListener('click', () => pin(-1));
        const body = document.createElement('div');
        body.className = 'overview-gl-card-body';
        body.textContent = p.tip.split('\n').slice(1).join('\n');
        const note = document.createElement('div');
        note.className = 'overview-gl-card-note';
        note.textContent = `Highlighted in ${dates} contract date${dates === 1 ? '' : 's'}`;
        card.append(close, title, body, note);
        card.classList.remove('hidden');
    }
    function pin(i) {
        pinned = i === pinned ? -1 : i;
        applyData();
        renderCard();
        host.dispatchEvent(new CustomEvent('gl-pin', { detail: pinned >= 0 ? P[pinned] : null }));
    }

    // ---- pointer: hover and click-to-pin --------------------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e) => {
        const rect = surface.getBoundingClientRect();
        pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = n ? raycaster.intersectObject(mesh)[0] : null;
        return hit ? hit.instanceId : -1;
    };
    let hovered = -1;
    let down = null;
    const onMove = (e) => {
        if (down) return; // dragging: leave the tooltip alone
        const id = pick(e);
        if (id !== hovered) {
            hovered = id;
            surface.style.cursor = id >= 0 ? 'pointer' : '';
        }
        spec.onHover(id >= 0 ? P[id].tip : null, e);
    };
    const onLeave = () => { hovered = -1; spec.onHover(null); };
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; spec.onHover(null); };
    const onUp = (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const quick = performance.now() - down.t < 500;
        down = null;
        if (moved < 5 && quick && e.button === 0) {
            const id = pick(e);
            if (id >= 0) pin(id); else if (pinned >= 0) pin(-1);
        }
    };
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', () => { down = null; });

    // ---- keyboard -------------------------------------------------------------------------------------------------
    const onKey = (e) => {
        const step = 0.1;
        const offset = camera.position.clone().sub(controls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        if (e.key === 'ArrowLeft') sph.theta -= step;
        else if (e.key === 'ArrowRight') sph.theta += step;
        else if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - step);
        else if (e.key === 'ArrowDown') sph.phi = Math.min(controls.maxPolarAngle, sph.phi + step);
        else if (e.key === '+' || e.key === '=') { zoom(1.2); e.preventDefault(); return; }
        else if (e.key === '-') { zoom(1 / 1.2); e.preventDefault(); return; }
        else if (e.key === '0') { reset(); e.preventDefault(); return; }
        else if (e.key === 'Escape') { if (pinned >= 0) pin(-1); return; }
        else return;
        e.preventDefault();
        cancelTween();
        camera.position.copy(controls.target).add(offset.setFromSpherical(sph));
        controls.update();
    };
    surface.addEventListener('keydown', onKey);

    // ---- sizing and render loop -----------------------------------------------------------------------------------
    const resize = () => {
        const w = Math.max(host.clientWidth, 300);
        const h = Math.max(host.clientHeight, 300);
        renderer.setSize(w, h);
        labelRenderer.setSize(w, h);
        const aspect = w / h;
        persp.aspect = aspect;
        persp.updateProjectionMatrix();
        ortho.left = -ORTHO_HALF * aspect;
        ortho.right = ORTHO_HALF * aspect;
        ortho.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let disposed = false;
    const tick = (now) => {
        if (disposed) return;
        stepTween(now);
        controls.update();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ---- controller -----------------------------------------------------------------------------------------------
    const getView = () => ({
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        ortho: isOrtho,
        zoom: camera.zoom
    });

    // Flies the camera to frame the given points; pins the first one when `pinFirst` is set.
    function focus(indices, pinFirst = false) {
        const idx = indices.filter(i => i >= 0 && i < n);
        if (!idx.length) return false;
        const box = new THREE.Box3();
        idx.forEach(i => box.expandByPoint(pos(P[i])));
        const target = box.getCenter(new THREE.Vector3());
        const extent = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1.5);
        const dir = camera.position.clone().sub(controls.target).normalize();
        const dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, extent * 2.6));
        flyTo(target.clone().add(dir.multiplyScalar(dist)), target, isOrtho ? Math.min(controls.maxZoom, ORTHO_HALF / (extent * 1.4)) : null);
        if (pinFirst && pinned !== idx[0]) pin(idx[0]);
        return true;
    }

    // PNG of the current view. The HTML axis labels aren't part of the WebGL canvas, so they are drawn on by hand.
    function snapshot() {
        renderer.render(scene, camera);
        const w = renderer.domElement.width, h = renderer.domElement.height;
        const ratio = w / host.clientWidth;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        ctx.fillStyle = cssVar(host, '--bg-panel', '#ffffff');
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(renderer.domElement, 0, 0);
        const textColor = cssVar(host, '--text-secondary', '#5a6872');
        const titleColor = cssVar(host, '--text-primary', '#111');
        const v = new THREE.Vector3();
        labels.forEach(l => {
            if (l.obj.element.style.display === 'none' || l.obj.visible === false) return;
            v.copy(l.obj.position).project(camera);
            if (v.z > 1) return;
            const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
            ctx.font = `${l.title ? '600 ' : ''}${(l.title ? 12 : 11) * ratio}px system-ui, sans-serif`;
            ctx.fillStyle = l.title ? titleColor : textColor;
            ctx.textAlign = l.alignEnd ? 'right' : 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(l.text, x, y);
        });
        if (spec.caption) {
            ctx.font = `600 ${13 * ratio}px system-ui, sans-serif`;
            ctx.fillStyle = titleColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(spec.caption, 14 * ratio, 12 * ratio);
        }
        return new Promise(resolve => out.toBlob(resolve, 'image/png'));
    }

    return {
        setPreset,
        reset,
        zoom,
        focus,
        snapshot,
        getView,
        getOptions: () => ({ ...opts }),
        pinnedPoint: () => pinned >= 0 ? P[pinned] : null,
        setOptions(next) {
            Object.assign(opts, next);
            if ('ortho' in next) { setOrtho(!!next.ortho); opts.ortho = isOrtho; }
            applyData();
            applyVisibility();
        },
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            for (const [t, f] of [['pointermove', onMove], ['pointerleave', onLeave], ['pointerdown', onDown], ['pointerup', onUp], ['keydown', onKey]]) {
                surface.removeEventListener(t, f);
            }
            controls.dispose();
            surfaceGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); });
            pinGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); });
            geo.dispose();
            mesh.material.dispose();
            jumpMat.dispose();
            gridGeo.dispose();
            gridMat.dispose();
            renderer.dispose();
            card.remove();
            renderer.domElement.remove();
            labelRenderer.domElement.remove();
        }
    };
}
