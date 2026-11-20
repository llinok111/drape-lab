/**
 * bench/bench.mjs — timing: cold start, warmup, 5 samples, median/p95/stddev.
 * Also records the full 900-frame metrics and the naive baseline.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runScenario, createCloth, stepCloth } from '../src/core.mjs';
import { runNaive } from '../baseline/naive.mjs';

const { scenarios } = JSON.parse(readFileSync('data/scenarios.json', 'utf8'));
const hang = scenarios.find((s) => s.id === 'hang');
const benchScenario = { ...hang, steps: 120 };

function timeOnce(sc) {
  const t = process.hrtime.bigint();
  runScenario(sc);
  return Number(process.hrtime.bigint() - t) / 1e6;
}

// cold start: first cloth work in this process
const coldMs = timeOnce(benchScenario);
timeOnce(benchScenario); // warmup
const samples = [];
for (let i = 0; i < 5; i++) samples.push(timeOnce(benchScenario));

const sorted = [...samples].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

const rows = [];
for (const s of scenarios) {
  const t = process.hrtime.bigint();
  const r = runScenario(s);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  const nt = process.hrtime.bigint();
  const n = runNaive(s);
  const nms = Number(process.hrtime.bigint() - nt) / 1e6;
  rows.push({
    id: s.id, steps: s.steps, nx: s.cloth.nx, ny: s.cloth.ny,
    maxStrain: r.maxStrain, worstPenetration: r.worstPenetration,
    totalContacts: r.totalContacts, hash: r.hash, finite: r.finite,
    msXpbd: +ms.toFixed(1), msNaive: +nms.toFixed(1),
    maxStrainNaive: n.maxStrain, speedupStrain: +(n.maxStrain / r.maxStrain).toFixed(1)
  });
}

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  sampleCount: samples.length,
  scenario: 'hang, 120 frames, 16 substeps, 41x41',
  coldMs: +coldMs.toFixed(1),
  timing: {
    samplesMs: samples.map((v) => +v.toFixed(1)),
    minMs: +sorted[0].toFixed(1),
    medianMs: +median.toFixed(1),
    p95Ms: +p95.toFixed(1),
    stddevMs: +stddev.toFixed(1),
    relStddev: +(stddev / mean).toFixed(3)
  },
  scenarios: rows,
  totals: {
    frames: rows.reduce((a, r) => a + r.steps, 0),
    maxStrain: Math.max(...rows.map((r) => r.maxStrain)),
    worstPenetration: Math.max(...rows.map((r) => r.worstPenetration)),
    worstNaiveStrain: Math.max(...rows.map((r) => r.maxStrainNaive))
  }
};

mkdirSync('bench', { recursive: true });
writeFileSync('bench/result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
