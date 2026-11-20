/**
 * main.js — three.js view of the same core module the node bench uses.
 * No physics lives here: geometry comes from src/core.mjs, this file only
 * uploads positions to the GPU and prints the numbers core returns.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createCloth, stepCloth, strain, penetration, hashPositions, finite
} from './src/core.mjs';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 6, 14);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100);
camera.position.set(2.4, 0.7, 3.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.1, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x16202b, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x59e0a8, 0.7);
rim.position.set(-4, -2, -3);
scene.add(rim);

const grid = new THREE.GridHelper(12, 24, 0x1f3344, 0x152430);
grid.position.y = -1.5;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshStandardMaterial({ color: 0x0f1a24, roughness: 1, metalness: 0, transparent: true, opacity: 0.85 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.5001;
scene.add(ground);

const SPHERE = null;
const state = {
  data: null, nodeHashes: {}, scenario: null, cloth: null,
  geometry: null, mesh: null, frame: 0, paused: false,
  windMul: 1, last: performance.now(), acc: 0, lastStrain: 0, maxStrain: 0, lastPen: 0
};

const $ = (id) => document.getElementById(id);

fetch('./data/scenarios.json').then((r) => r.json()).then(async (d) => {
  state.data = d;
  try {
    const bench = await fetch('./bench/result.json').then((r) => r.json());
    for (const row of bench.scenarios) state.nodeHashes[row.id] = row.hash;
  } catch { /* certificate falls back to "node hash unavailable" */ }
  buildButtons();
  select(d.scenarios[0].id);
  requestAnimationFrame(loop);
}).catch((e) => fail(e));

function fail(e) {
  const el = $('err');
  el.style.display = 'block';
  el.textContent = 'Failed to start: ' + (e && e.message ? e.message : e);
}

function buildButtons() {
  const box = $('scenarios');
  for (const s of state.data.scenarios) {
    const b = document.createElement('button');
    b.textContent = s.id;
    b.dataset.id = s.id;
    b.onclick = () => select(s.id);
    box.appendChild(b);
  }
}

function disposeCloth() {
  if (state.mesh) {
    scene.remove(state.mesh);
    state.mesh.geometry.dispose();
    state.mesh.material.dispose();
  }
}

function select(id) {
  const sc = state.data.scenarios.find((s) => s.id === id);
  if (!sc) return;
  state.scenario = sc;
  state.cloth = createCloth(sc.cloth);
  state.frame = 0;
  state.acc = 0;
  state.maxStrain = 0;
  state.lastPen = 0;
  state.windMul = 1;
  $('wind').value = '1';
  $('w-val').textContent = '1.00x';
  for (const b of document.querySelectorAll('#scenarios button')) {
    b.classList.toggle('on', b.dataset.id === id);
  }
  disposeCloth();
  const c = state.cloth;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.n * 3), 3));
  const idx = [];
  for (let j = 0; j < c.ny - 1; j++) {
    for (let i = 0; i < c.nx - 1; i++) {
      const a = j * c.nx + i, b = a + 1, d = a + c.nx, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2fd6a6, roughness: 0.55, metalness: 0.05,
    side: THREE.DoubleSide, wireframe: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  state.geometry = geo;
  state.mesh = mesh;
  upload();
  updateHud();
}

function upload() {
  const c = state.cloth;
  if (!c) return;
  const attr = state.geometry.getAttribute('position');
  attr.array.set(c.pos);
  attr.needsUpdate = true;
  state.geometry.computeVertexNormals();
  state.geometry.computeBoundingSphere();
}

function stepOnce() {
  const sc = state.scenario;
  if (!sc) return;
  const params = {
    dt: sc.dt, substeps: sc.substeps, gravity: sc.gravity,
    groundY: sc.groundY, damping: sc.damping,
    wind: (sc.wind || 0) * state.windMul
  };
  stepCloth(state.cloth, params);
  state.frame++;
  if (state.frame % 10 === 0) {
    const st = strain(state.cloth, 'structural').max;
    state.lastStrain = st;
    if (st > state.maxStrain) state.maxStrain = st;
    state.lastPen = penetration(state.cloth, sc.groundY, SPHERE);
    upload();
    updateHud();
  }
  if (state.frame >= sc.steps) {
    state.paused = true;
    updateHud();
  }
}

function updateHud() {
  const sc = state.scenario;
  if (!sc) return;
  $('s-id').textContent = `${sc.id} (${sc.cloth.nx}x${sc.cloth.ny})`;
  $('s-frame').textContent = `${state.frame} / ${sc.steps}`;
  $('s-strain').textContent = `${(state.lastStrain * 100).toFixed(3)} %  (peak ${(state.maxStrain * 100).toFixed(3)} %)`;
  $('s-pen').textContent = state.lastPen.toExponential(2);
  if (state.frame % 60 === 0) $('s-hash').textContent = hashPositions(state.cloth);
  const node = state.nodeHashes[sc.id];
  $('s-node').textContent = node || 'not in bench/result.json';
  const cert = $('s-cert');
  if (state.windMul !== 1) {
    cert.textContent = 'interactive wind — excluded from certificate';
    cert.className = 'v dim';
  } else if (state.frame >= sc.steps && node) {
    const live = hashPositions(state.cloth);
    const ok = live === node && finite(state.cloth);
    cert.textContent = ok ? 'MATCH — live hash equals node hash' : `MISMATCH — ${live} vs ${node}`;
    cert.className = 'v ' + (ok ? 'ok' : 'bad');
  } else {
    cert.textContent = `waiting for ${sc.steps} frames`;
    cert.className = 'v dim';
  }
}

$('wind').addEventListener('input', (e) => {
  state.windMul = parseFloat(e.target.value);
  $('w-val').textContent = state.windMul.toFixed(2) + 'x';
  updateHud();
});
$('pause').onclick = () => {
  state.paused = !state.paused;
  $('pause').textContent = state.paused ? 'resume' : 'pause';
};
$('reset').onclick = () => {
  if (state.scenario) select(state.scenario.id);
  state.paused = false;
  $('pause').textContent = 'pause';
};

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - state.last) / 1000);
  state.last = now;
  if (!state.paused && state.scenario) {
    state.acc += dt;
    let guard = 0;
    while (state.acc >= 1 / 60 && guard++ < 4 && !state.paused) {
      state.acc -= 1 / 60;
      stepOnce();
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
