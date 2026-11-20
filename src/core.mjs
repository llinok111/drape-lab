/**
 * core.mjs — deterministic XPBD cloth solver.
 *
 * Pure ES module: no three.js, no DOM, no I/O, no environment reads.
 * Units: metre / second / kilogram. All state is Float64Array so that the
 * same scenario produces bit-identical results in node and in the browser.
 */

/** Signed distance helpers kept inline for speed. */

export function createCloth(spec) {
  const nx = spec.nx | 0;
  const ny = spec.ny | 0;
  const width = +spec.width;
  const height = +spec.height;
  const n = nx * ny;
  const totalMass = spec.totalMass === undefined ? 1 : +spec.totalMass;
  const massPer = totalMass / n;

  const pos = new Float64Array(3 * n);
  const prev = new Float64Array(3 * n);
  const vel = new Float64Array(3 * n);
  const invMass = new Float64Array(n).fill(1 / massPer);

  const dx = width / (nx - 1);
  const dy = height / (ny - 1);
  const x0 = -width / 2;
  const y0 = height / 2;
  const horizontal = spec.plane === 'xz';

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[3 * k] = x0 + i * dx;
      if (horizontal) {
        pos[3 * k + 1] = spec.startY === undefined ? y0 : +spec.startY;
        pos[3 * k + 2] = y0 - j * dy;
      } else {
        pos[3 * k + 1] = y0 - j * dy;
        pos[3 * k + 2] = 0;
      }
    }
  }
  prev.set(pos);

  const edges = [];
  const pushEdge = (a, b, kind, compliance) => {
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
    const rest = Math.hypot(bx - ax, by - ay, bz - az);
    edges.push({ a, b, kind, rest, compliance });
  };

  // structural: horizontal + vertical
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i + 1 < nx) pushEdge(k, k + 1, 'structural', 0);
      if (j + 1 < ny) pushEdge(k, k + nx, 'structural', 0);
    }
  }
  // shear: both diagonals of every quad
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const k = j * nx + i;
      pushEdge(k, k + nx + 1, 'shear', 1e-7);
      pushEdge(k + 1, k + nx, 'shear', 1e-7);
    }
  }
  // bend: skip-one neighbours (soft)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i + 2 < nx) pushEdge(k, k + 2, 'bend', 2e-3);
      if (j + 2 < ny) pushEdge(k, k + 2 * nx, 'bend', 2e-3);
    }
  }

  const pins = [];
  const pinMode = spec.pin || (spec.pinTop === false ? 'none' : 'top');
  if (pinMode === 'top') {
    for (let i = 0; i < nx; i++) pins.push(i);
  } else if (pinMode === 'corners') {
    pins.push(0, nx - 1, (ny - 1) * nx, n - 1);
  } else if (pinMode === 'single') {
    pins.push(0);
  }
  for (const p of pins) invMass[p] = 0;
  // Optional slack: pull the pinned corners toward the centre *after* rest
  // lengths were measured, so the sheet starts with material to spare.
  if (spec.pinInset && pins.length) {
    const f = 1 - +spec.pinInset;
    const cx = 0, cy = horizontal ? +spec.startY : 0, cz = 0;
    for (const p of pins) {
      pos[3 * p] = cx + (pos[3 * p] - cx) * f;
      pos[3 * p + 1] = cy + (pos[3 * p + 1] - cy) * f;
      pos[3 * p + 2] = cz + (pos[3 * p + 2] - cz) * f;
    }
    prev.set(pos);
  }

  return {
    nx, ny, n, width, height, massPer,
    pos, prev, vel, invMass, edges, pins,
    time: 0, stepIndex: 0, lam: new Float64Array(edges.length),
    spec: { ...spec }
  };
}

/** Clamp a particle out of a plane / sphere; returns contact count. */
function collide(cloth, p, groundY, sphere) {
  let contacts = 0;
  const k = 3 * p;
  if (pos_ok(cloth, p)) {
    if (cloth.pos[k + 1] < groundY) {
      cloth.pos[k + 1] = groundY;
      contacts++;
    }
  }
  if (sphere) {
    const dx = cloth.pos[k] - sphere.x;
    const dy = cloth.pos[k + 1] - sphere.y;
    const dz = cloth.pos[k + 2] - sphere.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < sphere.r * sphere.r) {
      const d = Math.sqrt(d2);
      if (d > 1e-12) {
        const s = sphere.r / d;
        cloth.pos[k] = sphere.x + dx * s;
        cloth.pos[k + 1] = sphere.y + dy * s;
        cloth.pos[k + 2] = sphere.z + dz * s;
      } else {
        cloth.pos[k + 1] = sphere.y + sphere.r;
      }
      contacts++;
    }
  }
  return contacts;
}

function pos_ok(cloth, p) {
  return p >= 0 && p < cloth.n && Number.isFinite(cloth.pos[3 * p]);
}

/** One frame. params: dt, substeps, gravity, wind, groundY, sphere, damping, drag. */
export function stepCloth(cloth, params) {
  const dt = params.dt === undefined ? 1 / 60 : +params.dt;
  const substeps = params.substeps === undefined ? 8 : (params.substeps | 0);
  const g = params.gravity === undefined ? -9.81 : +params.gravity;
  const wind = params.wind || 0;
  const groundY = params.groundY === undefined ? -1.5 : +params.groundY;
  const sphere = params.sphere || null;
  const damping = params.damping === undefined ? 0.8 : +params.damping;
  const drag = params.drag || null;
  const iterations = params.iterations === undefined ? 1 : (params.iterations | 0);
  const sub = dt / substeps;
  const { pos, prev, vel, invMass, edges, lam } = cloth;

  // The dragged particle is held rigidly for this frame.
  let dragIndex = -1;
  let dragTarget = null;
  let dragW = 0;
  if (drag && drag.index >= 0 && drag.index < cloth.n) {
    dragIndex = drag.index;
    dragW = invMass[dragIndex];
    const t = drag.t === undefined ? 1 : Math.max(0, Math.min(1, drag.t));
    dragTarget = [
      drag.from[0] + (drag.to[0] - drag.from[0]) * t,
      drag.from[1] + (drag.to[1] - drag.from[1]) * t,
      drag.from[2] + (drag.to[2] - drag.from[2]) * t
    ];
  }

  let contacts = 0;
  for (let s = 0; s < substeps; s++) {
    prev.set(pos);
    if (dragIndex >= 0) invMass[dragIndex] = 0;

    const tNow = cloth.time + s * sub;
    for (let p = 0; p < cloth.n; p++) {
      if (invMass[p] === 0) continue;
      const k = 3 * p;
      const gust = wind === 0 ? 0 : wind * (0.6 + 0.4 * Math.sin(3.1 * tNow + 2.0 * pos[k + 1]));
      vel[k + 1] += g * sub;
      vel[k + 2] += gust * sub;
      pos[k] += vel[k] * sub;
      pos[k + 1] += vel[k + 1] * sub;
      pos[k + 2] += vel[k + 2] * sub;
    }
    if (dragIndex >= 0) {
      pos[3 * dragIndex] = dragTarget[0];
      pos[3 * dragIndex + 1] = dragTarget[1];
      pos[3 * dragIndex + 2] = dragTarget[2];
    }

    lam.fill(0);
    for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = e.a, b = e.b;
      const wa = invMass[a], wb = invMass[b];
      const w = wa + wb;
      if (w === 0) continue;
      const ka = 3 * a, kb = 3 * b;
      const dx = pos[kb] - pos[ka];
      const dy = pos[kb + 1] - pos[ka + 1];
      const dz = pos[kb + 2] - pos[ka + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-12) continue;
      const alpha = e.compliance / (sub * sub);
      const C = len - e.rest;
      const dl = (-C - alpha * lam[i]) / (w + alpha);
      lam[i] += dl;
      const s = dl / len;
      const cx = dx * s, cy = dy * s, cz = dz * s;
      pos[ka] -= wa * cx; pos[ka + 1] -= wa * cy; pos[ka + 2] -= wa * cz;
      pos[kb] += wb * cx; pos[kb + 1] += wb * cy; pos[kb + 2] += wb * cz;
    }
    }

    for (let p = 0; p < cloth.n; p++) {
      if (invMass[p] === 0) continue;
      contacts += collide(cloth, p, groundY, sphere);
    }

    const damp = Math.max(0, 1 - damping * sub);
    for (let p = 0; p < cloth.n; p++) {
      if (invMass[p] === 0) continue;
      const k = 3 * p;
      vel[k] = ((pos[k] - prev[k]) / sub) * damp;
      vel[k + 1] = ((pos[k + 1] - prev[k + 1]) / sub) * damp;
      vel[k + 2] = ((pos[k + 2] - prev[k + 2]) / sub) * damp;
    }
    if (dragIndex >= 0) invMass[dragIndex] = dragW;
    cloth.time += sub;
  }
  cloth.stepIndex++;
  cloth.lastContacts = contacts;
  return contacts;
}

export function strain(cloth, kind) {
  let max = 0, sum = 0, count = 0;
  for (let i = 0; i < cloth.edges.length; i++) {
    const e = cloth.edges[i];
    if (kind && e.kind !== kind) continue;
    const a = e.a, b = e.b;
    const dx = cloth.pos[3 * b] - cloth.pos[3 * a];
    const dy = cloth.pos[3 * b + 1] - cloth.pos[3 * a + 1];
    const dz = cloth.pos[3 * b + 2] - cloth.pos[3 * a + 2];
    const s = Math.abs(Math.hypot(dx, dy, dz) - e.rest) / e.rest;
    if (s > max) max = s;
    sum += s;
    count++;
  }
  return { max, mean: count ? sum / count : 0, count };
}

/** Deepest point below the ground / inside the sphere, in metres (>=0 means clear). */
export function penetration(cloth, groundY, sphere) {
  let worst = 0;
  for (let p = 0; p < cloth.n; p++) {
    const k = 3 * p;
    const below = groundY - cloth.pos[k + 1];
    if (below > worst) worst = below;
    if (sphere) {
      const dx = cloth.pos[k] - sphere.x;
      const dy = cloth.pos[k + 1] - sphere.y;
      const dz = cloth.pos[k + 2] - sphere.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const inside = sphere.r - d;
      if (inside > worst) worst = inside;
    }
  }
  return worst;
}

/** FNV-1a over the raw Float64 bytes of every particle position. */
export function hashPositions(cloth) {
  const bytes = new Uint8Array(cloth.pos.buffer, cloth.pos.byteOffset, cloth.pos.byteLength);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function finite(cloth) {
  for (let i = 0; i < cloth.pos.length; i++) {
    if (!Number.isFinite(cloth.pos[i])) return false;
  }
  return true;
}

/**
 * Run a scenario description to completion. Shared by bench/verify and the
 * browser page, so that the certificate shown on screen is the same code path.
 */
export function runScenario(scenario) {
  const cloth = createCloth(scenario.cloth);
  const steps = scenario.steps | 0;
  const drag = scenario.drag || null;
  let maxStrain = 0;
  let worstPen = 0;
  let totalContacts = 0;
  for (let i = 0; i < steps; i++) {
    const params = {
      dt: scenario.dt,
      substeps: scenario.substeps,
      iterations: scenario.iterations || 1,
      gravity: scenario.gravity,
      wind: scenario.wind || 0,
      groundY: scenario.groundY,
      sphere: scenario.sphere || null,
      damping: scenario.damping
    };
    if (drag) {
      const t0 = drag.startStep | 0;
      const t1 = drag.endStep | 0;
      const t = t1 === t0 ? 1 : (i - t0) / (t1 - t0);
      params.drag = {
        index: drag.index,
        from: drag.from,
        to: drag.to,
        t: Math.max(0, Math.min(1, t))
      };
    }
    totalContacts += stepCloth(cloth, params);
    const st = strain(cloth, 'structural').max;
    if (st > maxStrain) maxStrain = st;
    const pen = penetration(cloth, scenario.groundY, scenario.sphere || null);
    if (pen > worstPen) worstPen = pen;
  }
  return {
    cloth,
    steps,
    maxStrain,
    worstPenetration: worstPen,
    totalContacts,
    hash: hashPositions(cloth),
    finalStrain: strain(cloth, 'structural'),
    finite: finite(cloth)
  };
}
