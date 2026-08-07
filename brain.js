import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/* ============================================================
   Config
   ============================================================ */
const NODE_COUNT = 560;
const K_NEAREST = 3;
const MAX_EDGE_DIST = 0.34;
const BASE_ROTATE_SPEED = 0.06;   // rad/sec
const JITTER_AMPLITUDE = 0.018;   // fraction of scene units
const JITTER_SPEED = 0.55;
const POINTER_INFLUENCE = 0.35;   // how much the cursor nudges rotation
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   Cheap deterministic 3D "noise" — a few offset sine waves.
   Not a real simplex implementation, but gives organic,
   non-repeating-looking motion without extra dependencies.
   ============================================================ */
function pseudoNoise3(x, y, z, seed = 0) {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 2.3 - seed) +
    Math.sin(y * 1.3 + z * 1.9 + seed * 0.7) +
    Math.cos(x * 2.1 - z * 1.4 + seed * 1.3)
  ) / 3;
}

/* ============================================================
   Brain surface function.
   theta = polar angle (0..PI, top to bottom)
   phi   = azimuth (0..2PI, around the vertical axis)
   Returns a THREE.Vector3 on a brain-like surface:
   two lobes, a longitudinal fissure, a flattened base,
   and gyri-like wrinkle noise.
   ============================================================ */
function brainPoint(theta, phi) {
  let x = Math.sin(theta) * Math.cos(phi);
  let y = Math.cos(theta);
  let z = Math.sin(theta) * Math.sin(phi);

  // base proportions: wider front-to-back than side-to-side
  const sx = 1.0, sy = 0.84, sz = 1.22;

  // longitudinal fissure — groove along the midline, strongest at the top
  const fissure = Math.exp(-Math.pow(x * 4.4, 2)) * Math.max(0, y) * 0.17;

  // flatten the underside (brainstem region)
  const bottomFlatten = y < -0.5 ? (y + 0.5) * 0.4 : 0;

  // slight taper at the very front/back
  const taper = 1 - Math.max(0, Math.abs(z) - 0.82) * 0.55;

  // organic surface wrinkling (gyri / sulci impression)
  const n = pseudoNoise3(x * 3.1, y * 3.1, z * 3.1, 0);
  const wrinkle = 1 + n * 0.055;

  const r = wrinkle * taper;

  let px = x * sx * r;
  let py = y * sy * r - fissure - bottomFlatten;
  let pz = z * sz * r;

  // push the two hemispheres apart slightly along the fissure
  px += Math.sign(x || 1) * fissure * 0.55;

  return new THREE.Vector3(px, py, pz);
}

/* Evenly distribute points with a Fibonacci sphere, then map
   each onto the brain surface function above. */
function generateBrainPoints(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    const x = Math.cos(t) * radiusAtY;
    const z = Math.sin(t) * radiusAtY;
    const polar = Math.acos(Math.max(-1, Math.min(1, y)));
    const azimuth = Math.atan2(z, x);
    pts.push(brainPoint(polar, azimuth));
  }
  return pts;
}

/* Build a sparse graph: connect each node to its K nearest
   neighbors within a max distance, deduped. */
function buildEdges(points, k, maxDist) {
  const edgeSet = new Set();
  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const dists = [];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const d = points[i].distanceTo(points[j]);
      if (d < maxDist) dists.push([d, j]);
    }
    dists.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < Math.min(k, dists.length); m++) {
      const j = dists[m][1];
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

/* Soft radial glow sprite for the node points, generated at
   runtime on a canvas — avoids shipping an image asset. */
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(160,200,255,0.7)');
  gradient.addColorStop(1, 'rgba(80,130,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/* ============================================================
   Scene setup
   ============================================================ */
const canvas = document.getElementById('brain-canvas');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 6.2);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const group = new THREE.Group();
scene.add(group);

/* geometry data */
const basePoints = generateBrainPoints(NODE_COUNT);
const edges = buildEdges(basePoints, K_NEAREST, MAX_EDGE_DIST);

const basePositions = new Float32Array(NODE_COUNT * 3);
basePoints.forEach((p, i) => {
  basePositions[i * 3] = p.x;
  basePositions[i * 3 + 1] = p.y;
  basePositions[i * 3 + 2] = p.z;
});

const currentPositions = new Float32Array(basePositions);
const nodePhases = new Float32Array(NODE_COUNT).map(() => Math.random() * Math.PI * 2);

/* points (nodes) */
const pointsGeometry = new THREE.BufferGeometry();
pointsGeometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));

const pointsMaterial = new THREE.PointsMaterial({
  size: 0.052,
  map: makeGlowTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  color: new THREE.Color('#7db2ff'),
});

const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
group.add(pointCloud);

/* lines (edges / synapses) */
const lineArray = new Float32Array(edges.length * 6);
const lineGeometry = new THREE.BufferGeometry();
lineGeometry.setAttribute('position', new THREE.BufferAttribute(lineArray, 3));

const lineMaterial = new THREE.LineBasicMaterial({
  color: new THREE.Color('#2f6dff'),
  transparent: true,
  opacity: 0.22,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
group.add(lineSegments);

function syncLinePositions() {
  const arr = lineGeometry.attributes.position.array;
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e];
    const o = e * 6;
    arr[o] = currentPositions[a * 3];
    arr[o + 1] = currentPositions[a * 3 + 1];
    arr[o + 2] = currentPositions[a * 3 + 2];
    arr[o + 3] = currentPositions[b * 3];
    arr[o + 4] = currentPositions[b * 3 + 1];
    arr[o + 5] = currentPositions[b * 3 + 2];
  }
  lineGeometry.attributes.position.needsUpdate = true;
}
syncLinePositions();

/* scale + orient the whole brain to fit the viewport nicely */
group.scale.setScalar(2.1);
group.rotation.x = -0.15;
group.rotation.z = 0.05;

/* ============================================================
   Interaction — subtle pointer-driven parallax
   ============================================================ */
let pointerX = 0, pointerY = 0;
let targetRotY = 0, targetRotX = -0.15;

window.addEventListener('pointermove', (e) => {
  pointerX = (e.clientX / window.innerWidth) * 2 - 1;
  pointerY = (e.clientY / window.innerHeight) * 2 - 1;
});

/* ============================================================
   Animation loop
   ============================================================ */
const clock = new THREE.Clock();
let autoRotation = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  if (!REDUCED_MOTION) {
    autoRotation += dt * BASE_ROTATE_SPEED;

    // per-node jitter — the "thinking / noise" effect
    for (let i = 0; i < NODE_COUNT; i++) {
      const phase = nodePhases[i];
      const jx = Math.sin(t * JITTER_SPEED + phase) * JITTER_AMPLITUDE;
      const jy = Math.cos(t * JITTER_SPEED * 0.8 + phase * 1.3) * JITTER_AMPLITUDE;
      const jz = Math.sin(t * JITTER_SPEED * 1.15 + phase * 0.6) * JITTER_AMPLITUDE;
      currentPositions[i * 3] = basePositions[i * 3] + jx;
      currentPositions[i * 3 + 1] = basePositions[i * 3 + 1] + jy;
      currentPositions[i * 3 + 2] = basePositions[i * 3 + 2] + jz;
    }
    pointsGeometry.attributes.position.needsUpdate = true;
    syncLinePositions();
  }

  targetRotY = autoRotation + pointerX * POINTER_INFLUENCE;
  targetRotX = -0.15 + pointerY * (POINTER_INFLUENCE * 0.4);

  group.rotation.y += (targetRotY - group.rotation.y) * 0.04;
  group.rotation.x += (targetRotX - group.rotation.x) * 0.04;

  renderer.render(scene, camera);
}
animate();

/* ============================================================
   Resize
   ============================================================ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // scale down slightly on narrow viewports so the brain doesn't
  // crowd the hero text
  const scale = window.innerWidth < 640 ? 1.5 : 2.1;
  group.scale.setScalar(scale);
});

window.dispatchEvent(new Event('resize'));
