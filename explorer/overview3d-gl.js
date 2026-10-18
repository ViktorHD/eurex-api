// WebGL (three.js) renderer for the Strike Window 3D view. Prototype to compare against the SVG projection in overview.js.
// three.js is loaded lazily through the import map in index.html, so none of the other views pay for it.

const SIZE = 10;                 // scene units per axis: the cube spans -SIZE/2 .. SIZE/2 on x/z and 0 .. SIZE on y
const MIN_PITCH = 0.05;

// Camera position on a sphere around the cube centre; azimuth spins around the vertical (contract date) axis.
function cameraOffset(azimuth, pitch, radius) {
    return [
        radius * Math.sin(azimuth) * Math.cos(pitch),
        radius * Math.sin(pitch),
        radius * Math.cos(azimuth) * Math.cos(pitch)
    ];
}

/**
 * Mounts the scene into `host` and returns { dispose(), setPreset(p), reset(), getView() }.
 * spec = {
 *   points: [{ x, y, z, color, flex, tip }]  // x = delta, y = contract date, z = moneyness, all normalised to 0..1
 *   ticks: { delta: [{ n, label }], strike: [...], date: [...] },
 *   titles: { delta, strike, date },
 *   onHover(tipText | null, mouseEvent),
 *   view: { position: [x,y,z], target: [x,y,z] } | null   // restores a previous camera
 * }
 * Rejects when three.js can't be loaded or WebGL is unavailable, so the caller can fall back to the SVG view.
 */
export async function mountGlScene(host, spec) {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { CSS2DRenderer, CSS2DObject } = await import('three/addons/renderers/CSS2DRenderer.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'overview-gl-labels';
    host.append(renderer.domElement, labelRenderer.domElement);
    renderer.domElement.className = 'overview-gl-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    const center = new THREE.Vector3(0, SIZE / 2, 0);

    const controls = new OrbitControls(camera, labelRenderer.domElement);
    controls.enableDamping = true;
    controls.minPolarAngle = 0.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.3;
    controls.minDistance = 6;
    controls.maxDistance = 60;

    const applyPreset = (azimuth, pitch) => {
        const [x, y, z] = cameraOffset(azimuth, pitch, 32);
        controls.target.copy(center);
        camera.position.set(center.x + x, center.y + y, center.z + z);
        controls.update();
    };
    const reset = () => applyPreset(Math.PI / 4, Math.PI / 6);
    if (spec.view) {
        camera.position.fromArray(spec.view.position);
        controls.target.fromArray(spec.view.target);
        controls.update();
    } else {
        reset();
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(8, 20, 12);
    scene.add(sun);

    const css = getComputedStyle(host);
    const lineColor = new THREE.Color(css.getPropertyValue('--border-color').trim() || '#9aa5b1');

    // Floor grid plus the three axes.
    const toX = (n) => n * SIZE - SIZE / 2;
    const toY = (n) => n * SIZE;
    const toZ = (n) => n * SIZE - SIZE / 2;
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
    scene.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.55 })));

    const addLabel = (text, pos, cls = '') => {
        const el = document.createElement('div');
        el.className = `overview-gl-label ${cls}`.trim();
        el.textContent = text;
        const obj = new CSS2DObject(el);
        obj.position.set(...pos);
        scene.add(obj);
    };
    spec.ticks.delta.forEach(t => addLabel(t.label, [toX(t.n), 0, SIZE / 2 + 0.5]));
    spec.ticks.strike.forEach(t => addLabel(t.label, [SIZE / 2 + 0.6, 0, toZ(t.n)]));
    spec.ticks.date.forEach(t => addLabel(t.label, [-SIZE / 2 - 0.4, toY(t.n), -SIZE / 2], 'overview-gl-label-date'));
    addLabel(spec.titles.delta, [0, 0, SIZE / 2 + 1.7], 'overview-gl-title');
    addLabel(spec.titles.strike, [SIZE / 2 + 2.4, 0, 0], 'overview-gl-title');
    addLabel(spec.titles.date, [-SIZE / 2, SIZE + 0.8, -SIZE / 2], 'overview-gl-title');

    // One instanced mesh for all strikes: a single draw call regardless of how many contracts are listed.
    const n = spec.points.length;
    const radius = Math.max(0.05, Math.min(0.14, 0.2 - Math.log10(Math.max(n, 1)) * 0.04));
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 }), Math.max(n, 1));
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    spec.points.forEach((p, i) => {
        const r = p.flex ? Math.max(radius, 0.12) : radius;
        m.makeScale(r, r, r).setPosition(toX(p.x), toY(p.y), toZ(p.z));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(p.color));
    });
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);

    // Hover picking: ray against the instanced mesh, report the nearest hit's tooltip text.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = -1;
    const onMove = (e) => {
        const rect = labelRenderer.domElement.getBoundingClientRect();
        pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = n ? raycaster.intersectObject(mesh)[0] : null;
        const id = hit ? hit.instanceId : -1;
        if (id !== hovered) {
            hovered = id;
            labelRenderer.domElement.style.cursor = id >= 0 ? 'pointer' : '';
        }
        spec.onHover(id >= 0 ? spec.points[id].tip : null, e);
    };
    const onLeave = () => { hovered = -1; spec.onHover(null); };
    labelRenderer.domElement.addEventListener('pointermove', onMove);
    labelRenderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
        const w = Math.max(host.clientWidth, 300);
        const h = Math.max(host.clientHeight, 300);
        renderer.setSize(w, h);
        labelRenderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let disposed = false;
    const tick = () => {
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
    };
    tick();

    return {
        setPreset: (azimuth, pitch) => applyPreset(azimuth, Math.max(MIN_PITCH, pitch)),
        reset,
        zoom: (factor) => {
            const offset = camera.position.clone().sub(controls.target).multiplyScalar(1 / factor);
            camera.position.copy(controls.target).add(offset);
            controls.update();
        },
        getView: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
        dispose() {
            disposed = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            labelRenderer.domElement.removeEventListener('pointermove', onMove);
            labelRenderer.domElement.removeEventListener('pointerleave', onLeave);
            controls.dispose();
            geo.dispose();
            mesh.material.dispose();
            gridGeo.dispose();
            renderer.dispose();
            renderer.domElement.remove();
            labelRenderer.domElement.remove();
        }
    };
}
