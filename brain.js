import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

/* ============================================================
   Config
   ============================================================ */
const NODE_COUNT = 560;
const K_NEAREST = 3;
const MAX_EDGE_DIST = 0.34;
const BASE_ROTATE_SPEED = 0.11;   // rad/sec
const JITTER_AMPLITUDE = 0.026;   // fraction of scene units
const JITTER_SPEED = 0.85;
const POINTER_INFLUENCE = 0.35;   // how much the cursor nudges rotation
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* "aliveness" — edge signal activity */
const AMBIENT_BASE = 0.28;        // resting glow, all edges
const AMBIENT_AMPLITUDE = 0.22;   // slow per-edge shimmer on top of the base
const AMBIENT_SPEED = 0.75;
const SURGE_MIN_INTERVAL = 0.02;  // seconds between surge bursts
const SURGE_MAX_INTERVAL = 0.1;
const SURGE_BURST_MIN = 4;        // how many edges fire per burst
const SURGE_BURST_MAX = 12;
const SURGE_DECAY_SPEED = 3.6;    // higher = faster flash decay
const SURGE_PEAK = 1.8;           // brightness multiplier at the instant of firing

/* traveling signal particles — the "vibrant" main event */
const SIGNAL_COUNT = 24;
const SIGNAL_PATH_MIN = 3;        // nodes per journey
const SIGNAL_PATH_MAX = 7;
const SIGNAL_SEGMENT_TIME_MIN = 0.1; // seconds to cross one edge
const SIGNAL_SEGMENT_TIME_MAX = 0.19;
const SIGNAL_RESPAWN_MIN = 0.02;  // pause before a slot starts a new journey
const SIGNAL_RESPAWN_MAX = 0.18;
const SIGNAL_EDGE_PEAK = 4.5;     // much hotter than a random ambient surge
const SIGNAL_NODE_PEAK = 3.8;
const SIGNAL_NODE_DECAY_SPEED = 7;

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

const NODE_BASE_COLOR = new THREE.Color('#7db2ff');
const NODE_HOT_COLOR = new THREE.Color('#e8faff');
const nodeColorArray = new Float32Array(NODE_COUNT * 3);
for (let i = 0; i < NODE_COUNT; i++) {
  nodeColorArray[i * 3] = NODE_BASE_COLOR.r;
  nodeColorArray[i * 3 + 1] = NODE_BASE_COLOR.g;
  nodeColorArray[i * 3 + 2] = NODE_BASE_COLOR.b;
}
pointsGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColorArray, 3));
const nodeGlow = new Float32Array(NODE_COUNT); // decaying charge, driven by signals passing through

const pointsMaterial = new THREE.PointsMaterial({
  size: 0.052,
  map: makeGlowTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});

const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
group.add(pointCloud);

/* lines (edges / synapses) */
const lineArray = new Float32Array(edges.length * 6);
const lineGeometry = new THREE.BufferGeometry();
lineGeometry.setAttribute('position', new THREE.BufferAttribute(lineArray, 3));

/* per-edge color buffer — lets each synapse glow independently */
const lineColorArray = new Float32Array(edges.length * 6);
lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColorArray, 3));

const lineMaterial = new THREE.LineBasicMaterial({
  color: new THREE.Color('#ffffff'),
  vertexColors: true,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
group.add(lineSegments);

/* per-edge "aliveness" state */
const EDGE_BASE_COLOR = new THREE.Color('#3d76ff');
const EDGE_HOT_COLOR = new THREE.Color('#bfe9ff');
const edgePulse = new Float32Array(edges.length);          // decaying surge charge
const edgeAmbientPhase = new Float32Array(edges.length).map(() => Math.random() * Math.PI * 2);
let nextSurgeAt = 0;
const _tmpColor = new THREE.Color();

function triggerRandomSurges(t) {
  if (t < nextSurgeAt) return;
  const burstCount = SURGE_BURST_MIN + Math.floor(Math.random() * (SURGE_BURST_MAX - SURGE_BURST_MIN + 1));
  for (let i = 0; i < burstCount; i++) {
    const e = Math.floor(Math.random() * edges.length);
    edgePulse[e] = SURGE_PEAK;
  }
  nextSurgeAt = t + SURGE_MIN_INTERVAL + Math.random() * (SURGE_MAX_INTERVAL - SURGE_MIN_INTERVAL);
}

function updateEdgeColors(t, dt) {
  const colorArr = lineGeometry.attributes.color.array;
  for (let e = 0; e < edges.length; e++) {
    // decay any active surge charge
    if (edgePulse[e] > 0.001) {
      edgePulse[e] *= Math.exp(-dt * SURGE_DECAY_SPEED);
    } else {
      edgePulse[e] = 0;
    }

    const ambient = 0.5 + 0.5 * Math.sin(t * AMBIENT_SPEED + edgeAmbientPhase[e]);
    const intensity = AMBIENT_BASE + AMBIENT_AMPLITUDE * ambient + edgePulse[e];

    _tmpColor.copy(EDGE_BASE_COLOR).lerp(EDGE_HOT_COLOR, Math.min(intensity, 1));
    const overdrive = Math.max(0, intensity - 1) * 0.9; // extra flash punch on hard surges
    _tmpColor.multiplyScalar(0.65 + intensity * 0.7 + overdrive);

    const o = e * 6;
    colorArr[o] = _tmpColor.r;
    colorArr[o + 1] = _tmpColor.g;
    colorArr[o + 2] = _tmpColor.b;
    colorArr[o + 3] = _tmpColor.r;
    colorArr[o + 4] = _tmpColor.g;
    colorArr[o + 5] = _tmpColor.b;
  }
  lineGeometry.attributes.color.needsUpdate = true;
}

function updateNodeColors(dt) {
  const colorArr = pointsGeometry.attributes.color.array;
  for (let i = 0; i < NODE_COUNT; i++) {
    if (nodeGlow[i] > 0.001) {
      nodeGlow[i] *= Math.exp(-dt * SIGNAL_NODE_DECAY_SPEED);
    } else {
      nodeGlow[i] = 0;
      continue; // already at rest color, no write needed
    }
    _tmpColor.copy(NODE_BASE_COLOR).lerp(NODE_HOT_COLOR, Math.min(nodeGlow[i], 1));
    _tmpColor.multiplyScalar(1 + Math.max(0, nodeGlow[i] - 1) * 0.8);
    colorArr[i * 3] = _tmpColor.r;
    colorArr[i * 3 + 1] = _tmpColor.g;
    colorArr[i * 3 + 2] = _tmpColor.b;
  }
  pointsGeometry.attributes.color.needsUpdate = true;
}

/* ============================================================
   Traveling signals — particles that walk a real path through
   the graph, brightening each edge and node as they pass.
   ============================================================ */
const adjacency = Array.from({ length: NODE_COUNT }, () => []);
edges.forEach(([a, b]) => {
  adjacency[a].push(b);
  adjacency[b].push(a);
});

const edgeIndexMap = new Map();
edges.forEach(([a, b], e) => {
  const key = a < b ? `${a}_${b}` : `${b}_${a}`;
  edgeIndexMap.set(key, e);
});

function buildRandomWalk(minLen, maxLen) {
  const targetLen = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  let start = Math.floor(Math.random() * NODE_COUNT);
  let tries = 0;
  while (adjacency[start].length === 0 && tries < 20) {
    start = Math.floor(Math.random() * NODE_COUNT);
    tries++;
  }
  if (adjacency[start].length === 0) return null;

  const path = [start];
  let prev = -1;
  let current = start;
  for (let i = 1; i < targetLen; i++) {
    const neighbors = adjacency[current];
    if (neighbors.length === 0) break;
    // prefer not to immediately backtrack when there's another option
    const candidates = neighbors.filter((n) => n !== prev);
    const pool = candidates.length > 0 ? candidates : neighbors;
    const next = pool[Math.floor(Math.random() * pool.length)];
    path.push(next);
    prev = current;
    current = next;
  }
  return path.length >= 2 ? path : null;
}

class Signal {
  constructor() {
    this.active = false;
    this.respawnAt = Math.random() * SIGNAL_RESPAWN_MAX;
    this.path = null;
    this.segIndex = 0;
    this.segStart = 0;
    this.segDuration = SIGNAL_SEGMENT_TIME_MIN;
  }

  trySpawn(t) {
    const walk = buildRandomWalk(SIGNAL_PATH_MIN, SIGNAL_PATH_MAX);
    if (!walk) {
      this.respawnAt = t + 0.2; // graph hiccup, try again shortly
      return;
    }
    this.path = walk;
    this.segIndex = 0;
    this.segStart = t;
    this.segDuration = SIGNAL_SEGMENT_TIME_MIN + Math.random() * (SIGNAL_SEGMENT_TIME_MAX - SIGNAL_SEGMENT_TIME_MIN);
    this.active = true;
  }

  update(t, outPosition) {
    if (!this.active) {
      if (t >= this.respawnAt) this.trySpawn(t);
      return 0; // envelope 0 = fully hidden
    }

    let segT = (t - this.segStart) / this.segDuration;
    if (segT >= 1) {
      this.segIndex++;
      if (this.segIndex >= this.path.length - 1) {
        this.active = false;
        this.respawnAt = t + SIGNAL_RESPAWN_MIN + Math.random() * (SIGNAL_RESPAWN_MAX - SIGNAL_RESPAWN_MIN);
        return 0;
      }
      this.segStart = t;
      segT = 0;
    }

    const a = this.path[this.segIndex];
    const b = this.path[this.segIndex + 1];

    // charge the edge and both endpoint nodes as the signal crosses
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const eIdx = edgeIndexMap.get(key);
    const crossingPulse = Math.sin(Math.min(segT, 1) * Math.PI); // 0 -> 1 -> 0 across the segment
    if (eIdx !== undefined) {
      edgePulse[eIdx] = Math.max(edgePulse[eIdx], crossingPulse * SIGNAL_EDGE_PEAK);
    }
    nodeGlow[a] = Math.max(nodeGlow[a], (1 - segT) * SIGNAL_NODE_PEAK);
    nodeGlow[b] = Math.max(nodeGlow[b], segT * SIGNAL_NODE_PEAK);

    // interpolate the particle's world position between the two (jittering) nodes
    outPosition.set(
      currentPositions[a * 3] + (currentPositions[b * 3] - currentPositions[a * 3]) * segT,
      currentPositions[a * 3 + 1] + (currentPositions[b * 3 + 1] - currentPositions[a * 3 + 1]) * segT,
      currentPositions[a * 3 + 2] + (currentPositions[b * 3 + 2] - currentPositions[a * 3 + 2]) * segT
    );

    // fade in/out over the whole journey so it never pops
    const globalProgress = (this.segIndex + segT) / (this.path.length - 1);
    const fade = Math.min(1, globalProgress / 0.15, (1 - globalProgress) / 0.15);
    return Math.max(0.15, fade) * (0.55 + crossingPulse * 0.45);
  }
}

const signals = Array.from({ length: SIGNAL_COUNT }, () => new Signal());

const SIGNAL_HOT_COLOR = new THREE.Color('#eafcff');
const signalPositions = new Float32Array(SIGNAL_COUNT * 3);
const signalColors = new Float32Array(SIGNAL_COUNT * 3);
const signalGeometry = new THREE.BufferGeometry();
signalGeometry.setAttribute('position', new THREE.BufferAttribute(signalPositions, 3));
signalGeometry.setAttribute('color', new THREE.BufferAttribute(signalColors, 3));

const signalMaterial = new THREE.PointsMaterial({
  size: 0.13,
  map: makeGlowTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});

const signalPoints = new THREE.Points(signalGeometry, signalMaterial);
group.add(signalPoints);

const _signalPos = new THREE.Vector3();

function updateSignals(t) {
  for (let s = 0; s < SIGNAL_COUNT; s++) {
    const envelope = signals[s].update(t, _signalPos);
    signalPositions[s * 3] = _signalPos.x;
    signalPositions[s * 3 + 1] = _signalPos.y;
    signalPositions[s * 3 + 2] = _signalPos.z;

    const c = SIGNAL_HOT_COLOR;
    signalColors[s * 3] = c.r * envelope;
    signalColors[s * 3 + 1] = c.g * envelope;
    signalColors[s * 3 + 2] = c.b * envelope;
  }
  signalGeometry.attributes.position.needsUpdate = true;
  signalGeometry.attributes.color.needsUpdate = true;
}

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

    // electric surge activity on the edges
    triggerRandomSurges(t);

    // traveling signals — must run before the color pass so their
    // edge/node charges are included in this frame's render
    updateSignals(t);

    updateEdgeColors(t, dt);
    updateNodeColors(dt);

    // faint synced breathing on the nodes themselves
    pointsMaterial.opacity = 0.88 + Math.sin(t * 0.7) * 0.1;
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