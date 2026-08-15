import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/* ============================================================
   A small illustrative point-cloud "scan" of a street scene —
   a pedestrian and an obstacle sitting on a ground grid. Scroll
   progress (via the pinned #lidar-scroller wrapper, same pattern
   as main.js) drives three things:
     p1 — overall scan fades in
     p2 — points shift from raw/unclassified gray to classified blue
     p3 — detection bounding boxes fade in around the two objects
   ============================================================ */

const canvas = document.getElementById('lidar-canvas');
const panel = document.querySelector('.lidar-panel');
const scroller = document.getElementById('lidar-scroller');

if (canvas && panel && scroller) {
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RAW_COLOR = new THREE.Color('#9aa1af');
  const CLASSIFIED_COLOR = new THREE.Color('#5b8dff');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 50);
  camera.position.set(0.6, 1.9, 5.4);
  camera.lookAt(0, 0.9, -1.4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const group = new THREE.Group();
  scene.add(group);

  /* soft round point sprite, same technique as the hero brain */
  function makeGlowTexture() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ---- build the scene's point set ---- */
  const positions = [];
  const clusterOf = []; // 'ground' | 'pedestrian' | 'obstacle'

  function addPoint(x, y, z, cluster) {
    positions.push(x, y, z);
    clusterOf.push(cluster);
  }

  // ground grid, sparse street plane
  for (let xi = -3; xi <= 3; xi += 0.45) {
    for (let zi = -4; zi <= 1; zi += 0.45) {
      addPoint(xi + (Math.random() - 0.5) * 0.08, Math.random() * 0.03, zi + (Math.random() - 0.5) * 0.08, 'ground');
    }
  }

  // back wall, faint context
  for (let i = 0; i < 60; i++) {
    addPoint((Math.random() - 0.5) * 6, Math.random() * 3, -4 - Math.random() * 0.3, 'ground');
  }

  // pedestrian — body cylinder + head cluster
  const pedX = -1.1, pedZ = -1.6;
  for (let i = 0; i < 34; i++) {
    const t = Math.random();
    const y = 0.25 + t * 1.3;
    const r = 0.16 * (1 - Math.abs(t - 0.5) * 0.3);
    const a = Math.random() * Math.PI * 2;
    addPoint(pedX + Math.cos(a) * r, y, pedZ + Math.sin(a) * r, 'pedestrian');
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = Math.random() * Math.PI;
    const r = 0.13;
    addPoint(
      pedX + r * Math.sin(p) * Math.cos(a),
      1.65 + r * Math.cos(p),
      pedZ + r * Math.sin(p) * Math.sin(a),
      'pedestrian'
    );
  }

  // obstacle — low blocky object (e.g. a bollard / bench)
  const obX = 1.3, obZ = -2.4;
  for (let i = 0; i < 40; i++) {
    addPoint(
      obX + (Math.random() - 0.5) * 0.9,
      Math.random() * 0.5,
      obZ + (Math.random() - 0.5) * 0.45,
      'obstacle'
    );
  }

  function bounds(cluster, pad) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < clusterOf.length; i++) {
      if (clusterOf[i] !== cluster) continue;
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return {
      min: new THREE.Vector3(minX - pad, minY - pad, minZ - pad),
      max: new THREE.Vector3(maxX + pad, maxY + pad, maxZ + pad),
    };
  }

  const pedBounds = bounds('pedestrian', 0.1);
  const obBounds = bounds('obstacle', 0.1);

  const pointCount = positions.length / 3;
  const posArray = new Float32Array(positions);
  const colorArray = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount; i++) {
    colorArray[i * 3] = RAW_COLOR.r;
    colorArray[i * 3 + 1] = RAW_COLOR.g;
    colorArray[i * 3 + 2] = RAW_COLOR.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

  const material = new THREE.PointsMaterial({
    size: 0.05,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });

  const points = new THREE.Points(geometry, material);
  group.add(points);

  /* detection bounding boxes */
  function makeBoxWireframe(b) {
    const geo = new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#5b8dff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const box = new THREE.LineSegments(edges, mat);
    box.position.set(
      (b.min.x + b.max.x) / 2,
      (b.min.y + b.max.y) / 2,
      (b.min.z + b.max.z) / 2
    );
    return box;
  }

  const pedBox = makeBoxWireframe(pedBounds);
  const obBox = makeBoxWireframe(obBounds);
  group.add(pedBox, obBox);

  /* continuous "actively scanning" sweep — decorative, not scroll-tied */
  const sweepGeo = new THREE.PlaneGeometry(6.5, 3.2);
  const sweepMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#5b8dff'),
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sweep = new THREE.Mesh(sweepGeo, sweepMat);
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.01;
  group.add(sweep);

  /* ---- sizing ---- */
  function resize() {
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---- scroll-driven progress (same pinned-runway pattern as main.js) ---- */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  let p1 = REDUCED_MOTION ? 1 : 0;
  let p2 = REDUCED_MOTION ? 1 : 0;
  let p3 = REDUCED_MOTION ? 1 : 0;
  let ticking = false;

  function updateProgress() {
    ticking = false;
    const rect = scroller.getBoundingClientRect();
    const vh = window.innerHeight;
    const runway = rect.height - vh;

    let progress;
    if (runway > 0) {
      progress = clamp01(-rect.top / runway);
    } else {
      progress = clamp01((vh - rect.top) / (vh + rect.height));
    }

    p1 = clamp01(progress * 3);
    p2 = clamp01(progress * 3 - 1);
    p3 = clamp01(progress * 3 - 2);
  }

  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
  }

  if (!REDUCED_MOTION) {
    window.addEventListener('scroll', onScroll, { passive: true });
    updateProgress();
  }

  /* ---- animation loop ---- */
  const clock = new THREE.Clock();
  const _c = new THREE.Color();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    material.opacity = 0.15 + p1 * 0.85;

    const colors = geometry.attributes.color.array;
    for (let i = 0; i < pointCount; i++) {
      _c.copy(RAW_COLOR).lerp(CLASSIFIED_COLOR, p2);
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    geometry.attributes.color.needsUpdate = true;

    pedBox.material.opacity = p3 * 0.9;
    obBox.material.opacity = p3 * 0.9;

    if (!REDUCED_MOTION) {
      // gentle continuous camera drift, like the scene is being lightly observed
      group.rotation.y = Math.sin(t * 0.15) * 0.06;

      // looping scan sweep across the depth of the scene
      const sweepT = (t * 0.25) % 1;
      sweep.position.z = -4 + sweepT * 5;
      sweep.material.opacity = 0.04 + Math.sin(sweepT * Math.PI) * 0.05;
    }

    renderer.render(scene, camera);
  }
  animate();
}