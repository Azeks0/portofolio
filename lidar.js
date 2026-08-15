import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/* ============================================================
   A small illustrative point-cloud "scan" of a sidewalk running
   alongside a road, with a pedestrian walking along the sidewalk
   and a parked car on the road. Scroll progress (via the pinned
   #lidar-scroller wrapper, same pattern as main.js) drives:
     p1 — overall scan fades in
     p2 — points shift from raw/unclassified gray to classified blue
     p3 — detection bounding boxes + labels fade in
   ============================================================ */

const canvas = document.getElementById('lidar-canvas');
const panel = document.querySelector('.lidar-panel');
const scroller = document.getElementById('lidar-scroller');
const labelPed = document.querySelector('.detect-label[data-target="pedestrian"]');
const labelCar = document.querySelector('.detect-label[data-target="car"]');

if (canvas && panel && scroller) {
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RAW_COLOR = new THREE.Color('#9aa1af');
  const CLASSIFIED_COLOR = new THREE.Color('#5b8dff');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 3.4, 2.6);
  camera.lookAt(0, 0, -1.6);

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
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ---- scene layout (X = across the frame, Z = depth) ----
     sidewalk band: near the camera, z in [-0.9, -0.3]
     curb gap:      z in [-1.1, -0.9]
     road band:     further back, z in [-2.5, -1.1]           */
  const SIDEWALK_Z = [-0.9, -0.3];
  const ROAD_Z = [-2.5, -1.1];
  const X_RANGE = [-3, 3];

  const positions = [];
  const clusterOf = [];

  function addPoint(x, y, z, cluster) {
    positions.push(x, y, z);
    clusterOf.push(cluster);
  }

  // sample points scattered across the visible outer faces of a box —
  // closer to what a LiDAR unit actually sees than a filled volume
  function sampleBoxSurface(cx, cy, cz, sx, sy, sz, count, cluster) {
    // faces: -x, +x, +y (top), -z, +z  (omit the underside — never scanned)
    const faces = ['-x', '+x', '+y', '-z', '+z'];
    for (let i = 0; i < count; i++) {
      const face = faces[Math.floor(Math.random() * faces.length)];
      let x, y, z;
      const u = (Math.random() - 0.5) * sx;
      const v = (Math.random() - 0.5) * sy;
      const w = (Math.random() - 0.5) * sz;
      switch (face) {
        case '-x': x = -sx / 2; y = v; z = w; break;
        case '+x': x = sx / 2; y = v; z = w; break;
        case '+y': x = u; y = sy / 2; z = w; break;
        case '-z': x = u; y = v; z = -sz / 2; break;
        case '+z': x = u; y = v; z = sz / 2; break;
      }
      addPoint(cx + x, cy + sy / 2 + y, cz + z, cluster);
    }
  }

  // sidewalk paving
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += 0.32) {
    for (let z = SIDEWALK_Z[0]; z <= SIDEWALK_Z[1]; z += 0.15) {
      addPoint(x + (Math.random() - 0.5) * 0.05, Math.random() * 0.015, z + (Math.random() - 0.5) * 0.05, 'ground');
    }
  }

  // curb edge — a subtle brighter line marking the boundary
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += 0.22) {
    addPoint(x, 0.05, -1.0, 'ground');
  }

  // road surface
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += 0.32) {
    for (let z = ROAD_Z[0]; z <= ROAD_Z[1]; z += 0.28) {
      addPoint(x + (Math.random() - 0.5) * 0.06, Math.random() * 0.015, z + (Math.random() - 0.5) * 0.06, 'ground');
    }
  }

  // dashed lane markings down the center of the road
  const laneZ = (ROAD_Z[0] + ROAD_Z[1]) / 2;
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += 0.5) {
    if (Math.floor(x / 0.5) % 2 === 0) continue; // dash gaps
    addPoint(x, 0.02, laneZ, 'ground');
    addPoint(x + 0.12, 0.02, laneZ, 'ground');
  }

  // ---- pedestrian: body cylinder + head, authored in LOCAL space
  // (local x/z centered at 0 so we can translate it laterally each frame)
  const pedLocal = [];
  const pedZ = (SIDEWALK_Z[0] + SIDEWALK_Z[1]) / 2;
  for (let i = 0; i < 34; i++) {
    const t = Math.random();
    const y = 0.22 + t * 1.2;
    const r = 0.14 * (1 - Math.abs(t - 0.5) * 0.3);
    const a = Math.random() * Math.PI * 2;
    pedLocal.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = Math.random() * Math.PI;
    const r = 0.12;
    pedLocal.push([r * Math.sin(p) * Math.cos(a), 1.5 + r * Math.cos(p), r * Math.sin(p) * Math.sin(a)]);
  }

  const pedStartIndex = positions.length / 3;
  const WALK_RANGE = 2.1; // how far the pedestrian paces left/right
  for (const [lx, ly, lz] of pedLocal) {
    addPoint(lx, ly, pedZ + lz, 'pedestrian'); // x finalized each frame
  }
  const pedCount = pedLocal.length;

  // ---- parked car: chassis + cabin, surface-sampled for a recognizable silhouette
  const carX = 1.3, carZ = (ROAD_Z[0] + ROAD_Z[1]) / 2;
  sampleBoxSurface(carX, 0.02, carZ, 1.9, 0.42, 0.85, 34, 'car');       // lower body
  sampleBoxSurface(carX - 0.15, 0.44, carZ, 1.05, 0.32, 0.62, 20, 'car'); // cabin, set back slightly

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

  const pedBoundsLocal = bounds('pedestrian', 0.1); // computed pre-walk, x centered near 0
  const carBounds = bounds('car', 0.06);

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
    size: 0.045,
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
    box.userData.height = b.max.y - b.min.y;
    return box;
  }

  const pedBox = makeBoxWireframe(pedBoundsLocal);
  const pedBoxBaseX = pedBox.position.x;
  const carBox = makeBoxWireframe(carBounds);
  group.add(pedBox, carBox);

  /* continuous "actively scanning" sweep — decorative, not scroll-tied */
  const sweepGeo = new THREE.PlaneGeometry(6.5, 2.6);
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

  /* ---- HTML detection-label projection ---- */
  const _labelWorldPos = new THREE.Vector3();

  function updateLabel(label, box, opacity) {
    if (!label) return;
    box.getWorldPosition(_labelWorldPos);
    _labelWorldPos.y += box.userData.height / 2 + 0.18;
    _labelWorldPos.project(camera);

    const w = panel.clientWidth;
    const h = panel.clientHeight;
    const x = (_labelWorldPos.x * 0.5 + 0.5) * w;
    const y = (-_labelWorldPos.y * 0.5 + 0.5) * h;

    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    label.style.opacity = opacity;
  }

  /* ---- animation loop ---- */
  const clock = new THREE.Clock();
  const _c = new THREE.Color();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    material.opacity = 0.15 + p1 * 0.85;

    // pedestrian pacing back and forth along the sidewalk
    const walkX = REDUCED_MOTION ? 0 : Math.sin(t * 0.18) * WALK_RANGE;
    for (let i = 0; i < pedCount; i++) {
      const [lx, ly, lz] = pedLocal[i];
      const idx = pedStartIndex + i;
      posArray[idx * 3] = lx + walkX;
      posArray[idx * 3 + 1] = ly;
      posArray[idx * 3 + 2] = pedZ + lz;
    }
    geometry.attributes.position.needsUpdate = true;
    pedBox.position.x = pedBoxBaseX + walkX;

    const colors = geometry.attributes.color.array;
    for (let i = 0; i < pointCount; i++) {
      _c.copy(RAW_COLOR).lerp(CLASSIFIED_COLOR, p2);
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    geometry.attributes.color.needsUpdate = true;

    pedBox.material.opacity = p3 * 0.9;
    carBox.material.opacity = p3 * 0.9;

    updateLabel(labelPed, pedBox, p3);
    updateLabel(labelCar, carBox, p3);

    if (!REDUCED_MOTION) {
      // gentle continuous camera drift, like the scene is being lightly observed
      group.rotation.y = Math.sin(t * 0.12) * 0.04;

      // looping scan sweep across the depth of the scene
      const sweepT = (t * 0.22) % 1;
      sweep.position.z = -2.6 + sweepT * 3.2;
      sweep.material.opacity = 0.04 + Math.sin(sweepT * Math.PI) * 0.05;
    }

    renderer.render(scene, camera);
  }
  animate();
}