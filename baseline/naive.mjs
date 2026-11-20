/**
 * baseline/naive.mjs — the comparison solver: classic PBD, one substep per
 * frame, 8 Gauss-Seidel sweeps, stiffness 0.5. Same cloth, same collision
 * code, same frame count. This is the "before" number in README.
 */
import { createCloth, strain, penetration } from '../src/core.mjs';

export function runNaive(scenario) {
  const cloth = createCloth(scenario.cloth);
  const substeps = 1;
  const iterations = 8;
  const stiffness = 0.5;
  const dt = scenario.dt;
  const groundY = scenario.groundY;
  const sphere = scenario.sphere || null;
  const drag = scenario.drag || null;
  let maxStrain = 0;
  let worstPen = 0;
  let sceneTime = 0;
  const wind = scenario.wind || 0;
  const damping = scenario.damping === undefined ? 0.8 : +scenario.damping;

  for (let f = 0; f < scenario.steps; f++) {
    const prev = cloth.prev;
    prev.set(cloth.pos);
    const k = scenario.gravity * dt * dt;
    for (let p = 0; p < cloth.n; p++) {
      if (cloth.invMass[p] === 0) continue;
      const gust = wind === 0 ? 0 : wind * (0.6 + 0.4 * Math.sin(3.1 * sceneTime + 2.0 * cloth.pos[3 * p + 1]));
      cloth.vel[3 * p + 1] += scenario.gravity * dt;
      cloth.vel[3 * p + 2] += gust * dt;
      cloth.pos[3 * p] += cloth.vel[3 * p] * dt;
      cloth.pos[3 * p + 1] += cloth.vel[3 * p + 1] * dt;
      cloth.pos[3 * p + 2] += cloth.vel[3 * p + 2] * dt;
    }
    void k;
    if (drag) {
      const t = Math.max(0, Math.min(1, (f - drag.startStep) / (drag.endStep - drag.startStep)));
      const idx = drag.index;
      cloth.invMass[idx] = 0;
      for (let c = 0; c < 3; c++) {
        cloth.pos[3 * idx + c] = drag.from[c] + (drag.to[c] - drag.from[c]) * t;
      }
    }
    for (let it = 0; it < iterations; it++) {
      for (const e of cloth.edges) {
        const a = e.a, b = e.b;
        const wa = cloth.invMass[a], wb = cloth.invMass[b];
        const w = wa + wb;
        if (w === 0) continue;
        const dx = cloth.pos[3 * b] - cloth.pos[3 * a];
        const dy = cloth.pos[3 * b + 1] - cloth.pos[3 * a + 1];
        const dz = cloth.pos[3 * b + 2] - cloth.pos[3 * a + 2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-12) continue;
        const diff = ((len - e.rest) / len) * stiffness;
        const cx = dx * diff, cy = dy * diff, cz = dz * diff;
        const ra = wa / w, rb = wb / w;
        cloth.pos[3 * a] += ra * cx; cloth.pos[3 * a + 1] += ra * cy; cloth.pos[3 * a + 2] += ra * cz;
        cloth.pos[3 * b] -= rb * cx; cloth.pos[3 * b + 1] -= rb * cy; cloth.pos[3 * b + 2] -= rb * cz;
      }
      for (let p = 0; p < cloth.n; p++) {
        if (cloth.invMass[p] === 0) continue;
        if (cloth.pos[3 * p + 1] < groundY) cloth.pos[3 * p + 1] = groundY;
        if (sphere) {
          const dx = cloth.pos[3 * p] - sphere.x;
          const dy = cloth.pos[3 * p + 1] - sphere.y;
          const dz = cloth.pos[3 * p + 2] - sphere.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < sphere.r && d > 1e-12) {
            const s = sphere.r / d;
            cloth.pos[3 * p] = sphere.x + dx * s;
            cloth.pos[3 * p + 1] = sphere.y + dy * s;
            cloth.pos[3 * p + 2] = sphere.z + dz * s;
          }
        }
      }
    }
    for (let p = 0; p < cloth.n; p++) {
      if (cloth.invMass[p] === 0) continue;
      for (let c = 0; c < 3; c++) {
        cloth.vel[3 * p + c] = (cloth.pos[3 * p + c] - prev[3 * p + c]) / dt * Math.max(0, 1 - damping * dt);
      }
    }
    const st = strain(cloth, 'structural').max;
    if (st > maxStrain) maxStrain = st;
    const pen = penetration(cloth, groundY, sphere);
    if (pen > worstPen) worstPen = pen;
    sceneTime += dt;
  }
  return { maxStrain, worstPenetration: worstPen, cloth };
}
