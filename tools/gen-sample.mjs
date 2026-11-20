/**
 * tools/gen-sample.mjs — deterministic scenario generator.
 * Writes data/scenarios.json. No randomness: every number is derived from a
 * closed-form grid, so two runs produce byte-identical output.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const base = {
  dt: 1 / 60,
  substeps: 16,
  gravity: -9.81,
  groundY: -1.5,
  damping: 0.8,
  steps: 900
};

const scenarios = [
  {
    id: 'hang',
    note: '41x41 sheet, whole top edge pinned, no wind: pure gravity drape',
    cloth: { nx: 41, ny: 41, width: 2, height: 2, totalMass: 1, pin: 'top' },
    ...base
  },
  {
    id: 'breeze',
    note: '31x31 sheet, top pinned, steady 2.5 m/s^2 gust along +z',
    cloth: { nx: 31, ny: 31, width: 2, height: 2, totalMass: 1, pin: 'top' },
    wind: 2.5,
    ...base
  },
  {
    id: 'gust',
    note: '41x41 sheet, top pinned, 9.0 m/s^2 gust',
    cloth: { nx: 41, ny: 41, width: 2, height: 2, totalMass: 1, pin: 'top' },
    wind: 9,
    ...base
  },
  {
    id: 'calm',
    note: '31x31 sheet, top pinned, light 1.2 m/s^2 breeze',
    cloth: { nx: 31, ny: 31, width: 2, height: 2, totalMass: 1, pin: 'top' },
    wind: 1.2,
    ...base
  }
];

export function scenarioText() {
  return JSON.stringify({ version: 1, scenarios }, null, 2) + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync('data', { recursive: true });
  const text = scenarioText();
  writeFileSync('data/scenarios.json', text);
  const hash = createHash('sha256').update(text).digest('hex');
  console.log(`wrote data/scenarios.json (${text.length} bytes, sha256 ${hash.slice(0, 16)})`);
  console.log(scenarios.map((s) => `${s.id}: ${s.cloth.nx}x${s.cloth.ny}, ${s.steps} steps`).join('\n'));
}
