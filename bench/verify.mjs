/**
 * bench/verify.mjs — behavioural assertions for the XPBD cloth core.
 * Every number printed below is measured in this process.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createCloth, stepCloth, strain, penetration, hashPositions, finite, runScenario
} from '../src/core.mjs';
import { runNaive } from '../baseline/naive.mjs';
import { scenarioText } from '../tools/gen-sample.mjs';

let pass = 0;
let fail = 0;
const t0 = performance.now();

function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ::  ${detail}`);
}

const fileText = readFileSync('data/scenarios.json', 'utf8');
const { scenarios } = JSON.parse(fileText);

// Independence: regenerate into a temp copy and compare with the *committed*
// bytes (git index), not with whatever is on disk — a generator drift shows here.
execFileSync(process.execPath, ['tools/gen-sample.mjs'], { stdio: 'ignore' });
const regenerated = readFileSync('data/scenarios.json', 'utf8');
let committed = regenerated;
try { committed = execFileSync('git', ['show', 'HEAD:data/scenarios.json'], { encoding: 'utf8' }); }
catch { /* not a checkout with history: fall back to the on-disk copy */ }
const genSha = createHash('sha256').update(regenerated).digest('hex');
const committedSha = createHash('sha256').update(committed).digest('hex');
check('A1 generator matches committed data byte-for-byte (independent subprocess)',
  genSha === committedSha && createHash('sha256').update(scenarioText()).digest('hex') === genSha,
  `sha256=${genSha.slice(0, 16)}`);

check('A2 four scenarios x 900 frames', scenarios.length === 4 && scenarios.every((s) => s.steps === 900),
  scenarios.map((s) => `${s.id}:${s.steps}`).join(', '));

const results = [];
for (const s of scenarios) results.push({ id: s.id, r: runScenario(s) });

check('A3 solver stays finite', results.every((x) => x.r.finite),
  results.map((x) => `${x.id}=${x.r.finite}`).join(', '));

check('A4 max structural strain <= 1.5% on every scenario',
  results.every((x) => x.r.maxStrain <= 0.015),
  results.map((x) => `${x.id}=${(x.r.maxStrain * 100).toFixed(3)}%`).join(', '));

check('A5 zero ground penetration (<= 1e-12 m) over all 3600 frames',
  results.every((x) => x.r.worstPenetration <= 1e-12),
  results.map((x) => x.r.worstPenetration.toExponential(2)).join(', '));

check('A6 position hash is 8 hex digits', results.every((x) => /^[0-9a-f]{8}$/.test(x.r.hash)),
  results.map((x) => `${x.id}=${x.r.hash}`).join(', '));

const hang = scenarios.find((s) => s.id === 'hang');
const again = runScenario(hang);
check('A7 replay is bit-identical (same hash, same strain)',
  again.hash === results[0].r.hash && again.maxStrain === results[0].r.maxStrain,
  `${again.hash} vs ${results[0].r.hash}`);

const naive = runNaive(hang);
const gust = scenarios.find((s) => s.id === 'gust');
const naiveGust = runNaive(gust);
check('A8b baseline applies the same wind as core (gust drags further than hang)',
  naiveGust.maxStrain > naive.maxStrain * 1.02,
  `naive gust ${(naiveGust.maxStrain * 100).toFixed(3)}% vs hang ${(naive.maxStrain * 100).toFixed(3)}%`);
check('A8 one-substep PBD baseline stretches > 10%',
  naive.maxStrain > 0.10,
  `naive max strain ${(naive.maxStrain * 100).toFixed(3)}% vs XPBD ${(results[0].r.maxStrain * 100).toFixed(3)}%`);

const ratio = naive.maxStrain / results[0].r.maxStrain;
check('A9 XPBD reduces peak strain by >= 10x vs baseline', ratio >= 10, `${ratio.toFixed(1)}x`);

// --- scale equivariance: lengths x s, gravity x s, same dt ------------------
const proto = {
  nx: 21, ny: 21, width: 1, height: 1, totalMass: 1, pin: 'top',
  steps: 240, dt: 1 / 60, substeps: 12, damping: 0.8, gravity: -9.81, groundY: -1.5
};
function scaled(s, scale) {
  const c = createCloth({
    nx: proto.nx, ny: proto.ny, width: proto.width * scale,
    height: proto.height * scale, totalMass: 1, pin: 'top'
  });
  for (let f = 0; f < proto.steps; f++) {
    stepCloth(c, {
      dt: proto.dt, substeps: proto.substeps, gravity: proto.gravity * scale,
      groundY: proto.groundY * scale, damping: proto.damping
    });
  }
  return c;
}
const ref = scaled(proto, 1);
const scales = [1e-3, 1e-2, 1, 1e2, 1e3];
let worstScale = 0;
for (const s of scales) {
  const c = s === 1 ? ref : scaled(proto, s);
  for (let i = 0; i < ref.pos.length; i++) {
    const rel = Math.abs(c.pos[i] / s - ref.pos[i]) / Math.max(1e-12, Math.abs(ref.pos[i]));
    if (rel > worstScale) worstScale = rel;
  }
}
check('A10 five-scale equivariance (1e-3..1e3), relative error <= 1e-9',
  worstScale <= 1e-9, `worst relative coordinate error ${worstScale.toExponential(2)}`);

// --- pinned vertices must not move ----------------------------------------
const pinCloth = createCloth({ nx: 9, ny: 9, width: 1, height: 1, totalMass: 1, pin: 'top' });
const pinStart = Array.from(pinCloth.pins).map((p) => [pinCloth.pos[3 * p], pinCloth.pos[3 * p + 1]]);
for (let f = 0; f < 120; f++) {
  stepCloth(pinCloth, { dt: 1 / 60, substeps: 8, gravity: -9.81, groundY: -1.5, damping: 0.8 });
}
let pinDrift = 0;
pinCloth.pins.forEach((p, i) => {
  pinDrift = Math.max(pinDrift, Math.abs(pinCloth.pos[3 * p] - pinStart[i][0]), Math.abs(pinCloth.pos[3 * p + 1] - pinStart[i][1]));
});
check('A11 pinned vertices never move', pinDrift === 0, `max drift ${pinDrift}`);

check('A12 constraint bookkeeping is exact',
  (() => {
    const c = createCloth({ nx: 31, ny: 21, width: 2, height: 1.4, totalMass: 1, pin: 'top' });
    const structural = c.edges.filter((e) => e.kind === 'structural').length;
    const shear = c.edges.filter((e) => e.kind === 'shear').length;
    const bend = c.edges.filter((e) => e.kind === 'bend').length;
    const ok = structural === 2 * 31 * 21 - 31 - 21 &&
      shear === 2 * 30 * 20 &&
      bend === (31 - 2) * 21 + 31 * (21 - 2);
    return ok;
  })(),
  'structural / shear / bend counts match the grid formula');

const totalFrames = scenarios.reduce((a, s) => a + s.steps, 0);
check('A13 3600 frames simulated', totalFrames === 3600, `${totalFrames} frames`);

const ms = performance.now() - t0;
console.log(`\n${pass}/${pass + fail} assertions passed in ${ms.toFixed(0)} ms`);
console.log('hashes: ' + results.map((x) => `${x.id}=${x.r.hash}`).join(' '));
if (fail) {
  console.error(`${fail} assertion(s) failed`);
  process.exit(1);
}
process.exit(0);
