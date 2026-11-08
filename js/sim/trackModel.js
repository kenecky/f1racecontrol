// Baut aus einer Streckendefinition ein Rechenmodell:
// geglätteter Streckenverlauf, Kurvenradien, Geschwindigkeitsprofil, Boxengasse.

const STEP = 5;            // Abstand der Stützpunkte in Metern
const V_TOP = 90;          // Höchstgeschwindigkeit m/s (~324 km/h)
const A_LAT = 38;          // max. Querbeschleunigung m/s²
const DECEL = 42;          // Bremsverzögerung m/s²

export function accelAt(v) {
  return Math.max(4, 14 - v * 0.11);
}

function catmullRom(p0, p1, p2, p3, t) {
  // Zentripetale Catmull-Rom-Spline (vermeidet Schleifen)
  const alpha = 0.5;
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha);
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tb - ta) === 0 ? 0 : (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

function nearestIndex(xs, ys, N, [px, py]) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) {
    const d = (xs[i] - px) ** 2 + (ys[i] - py) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function buildTrack(def) {
  const cp = def.controlPoints;
  const n = cp.length;

  // 1) Feiner Spline-Polygonzug
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
    for (let s = 0; s < 24; s++) dense.push(catmullRom(p0, p1, p2, p3, s / 24));
  }
  dense.push(dense[0]);

  let unitLen = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    unitLen += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    cum.push(unitLen);
  }

  // 2) Gleichmäßig in Metern abtasten
  const L = def.lengthM;
  const N = Math.round(L / STEP);
  const ds = L / N;
  const mPerUnit = L / unitLen;
  const xs = new Float64Array(N), ys = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = (i * ds) / mPerUnit;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const w = (target - cum[j]) / seg;
    xs[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * w;
    ys[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * w;
  }

  // 3) Krümmung (Menger) in 1/m, geglättet
  const K = 3;
  const curv = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - K + N) % N, c = (i + K) % N;
    const ax = xs[a] * mPerUnit, ay = ys[a] * mPerUnit;
    const bx = xs[i] * mPerUnit, by = ys[i] * mPerUnit;
    const cx = xs[c] * mPerUnit, cy = ys[c] * mPerUnit;
    const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    const d1 = Math.hypot(bx - ax, by - ay), d2 = Math.hypot(cx - bx, cy - by), d3 = Math.hypot(cx - ax, cy - ay);
    curv[i] = (2 * area2) / (d1 * d2 * d3 || 1);
  }
  const curvS = new Float64Array(N);
  const W = 3;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -W; k <= W; k++) s += curv[(i + k + N) % N];
    curvS[i] = s / (2 * W + 1);
  }

  // 4) Geschwindigkeitsprofil
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.min(V_TOP, Math.sqrt(A_LAT / Math.max(curvS[i], 1e-6)));
  // Kurven-Höchstgeschwindigkeiten aus den Streckendaten (das Layout ist nur angenähert)
  for (const c of def.corners) {
    if (!c.vmax) continue;
    const ci = nearestIndex(xs, ys, N, c.at);
    for (let k = -5; k <= 5; k++) {
      const idx = (ci + k + N) % N;
      v[idx] = Math.min(v[idx], c.vmax / 3.6);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nx = v[(i + 1) % N];
      v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * DECEL * ds));
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const pv = v[(i - 1 + N) % N];
      v[i] = Math.min(v[i], Math.sqrt(pv * pv + 2 * accelAt(pv) * ds));
    }
  }
  let profLap = 0;
  for (let i = 0; i < N; i++) profLap += ds / ((v[i] + v[(i + 1) % N]) / 2);
  const scale = profLap / def.baseLap;
  for (let i = 0; i < N; i++) v[i] *= scale;

  const track = {
    def, L, N, ds, xs, ys, v, mPerUnit,
    baseLap: def.baseLap,
    laps: def.laps,
    pitLaneSpeed: def.pitLaneSpeed / 3.6,
  };

  // 5) Kurven einordnen
  const nearestD = at => nearestIndex(xs, ys, N, at) * ds;
  // Kurvenrichtung: +1 = Rechtskurve, −1 = Linkskurve (Bildschirmkoordinaten, y nach unten)
  const turnAt = idx => {
    let sum = 0;
    for (let k = -8; k <= 8; k++) {
      const i = (idx + k + N) % N, a = (i - 4 + N) % N, b = (i + 4) % N;
      sum += (xs[i] - xs[a]) * (ys[b] - ys[i]) - (ys[i] - ys[a]) * (xs[b] - xs[i]);
    }
    return sum >= 0 ? 1 : -1;
  };
  track.corners = def.corners.map(c => {
    const d = nearestD(c.at);
    return { ...c, d, turn: turnAt(Math.round(d / ds) % N) };
  });
  const cornerD = id => track.corners.find(c => c.id === id).d;
  const wrap = d => ((d % L) + L) % L;

  track.zones = def.overtakeZones.map(z => ({
    corner: z.corner,
    start: wrap(cornerD(z.corner) - z.before),
    end: wrap(cornerD(z.corner) + z.after),
    factor: z.factor,
  }));
  // Auslaufzonen (Asphalt/Kies) relativ zu Kurven; Seite 'out' = Kurvenaußenseite
  track.runoffs = (def.runoffs || []).map(r => {
    const c = track.corners.find(x => x.id === r.corner);
    const side = r.side === 'in' ? c.turn : r.side === 'out' ? -c.turn : r.side === 'right' ? 1 : -1;
    return { from: c.d + r.from, to: c.d + r.to, side, type: r.type, width: r.width, offset: r.offset || 0 };
  });
  // Randsteine: innen am Scheitel, außen am Kurvenausgang
  track.kerbs = [];
  for (const c of track.corners) {
    const k = (def.kerbs && def.kerbs[c.id]) || {};
    track.kerbs.push({ from: c.d + (k.inFrom ?? -35), to: c.d + (k.inTo ?? 25), side: c.turn });
    if (k.out !== false) track.kerbs.push({ from: c.d + (k.outFrom ?? 10), to: c.d + (k.outTo ?? 70), side: -c.turn });
  }
  track.sectorEnds = def.timingSectors.map(s => wrap(cornerD(s.corner) + s.offset));
  const starts = def.marshalSectors.map(m => (m.line ? 0 : wrap(cornerD(m.corner) + m.offset)));
  track.sectors = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : L;
    const corners = track.corners.filter(c => c.d >= start && c.d < end).map(c => c.id);
    return { id: i + 1, start, end, corners };
  });
  track.pit = {
    entry: wrap(cornerD(def.pit.entry.corner) + def.pit.entry.offset),
    exit: wrap(cornerD(def.pit.exit.corner) + def.pit.exit.offset),
    box: def.pit.boxOffsetAfterLine,
    side: def.pitLaneSide,
  };
  return track;
}

// ---- Abfragen ----

export function wrapD(track, d) {
  const L = track.L;
  return ((d % L) + L) % L;
}

export function speedAt(track, d) {
  const p = wrapD(track, d) / track.ds;
  const i = Math.floor(p) % track.N, k = (i + 1) % track.N, w = p - Math.floor(p);
  return track.v[i] * (1 - w) + track.v[k] * w;
}

// Position (in Streckeneinheiten) mit seitlichem Versatz (Einheiten, + = rechts)
export function pointAt(track, d, lateral = 0) {
  const p = wrapD(track, d) / track.ds;
  const i = Math.floor(p) % track.N, k = (i + 1) % track.N, w = p - Math.floor(p);
  const x = track.xs[i] * (1 - w) + track.xs[k] * w;
  const y = track.ys[i] * (1 - w) + track.ys[k] * w;
  if (!lateral) return [x, y];
  let tx = track.xs[k] - track.xs[i], ty = track.ys[k] - track.ys[i];
  const len = Math.hypot(tx, ty) || 1;
  tx /= len; ty /= len;
  // rechte Normale bei y-nach-unten: (-ty, tx)
  return [x - ty * lateral, y + tx * lateral];
}

// Liegt Position d (gewrappt) im Bereich [a, b) auf der Runde?
export function inRange(track, d, a, b) {
  const x = wrapD(track, d);
  return a <= b ? (x >= a && x < b) : (x >= a || x < b);
}

// Wurde Markierung m (Rundenposition) zwischen prev und next (Rennmeter) überfahren?
export function crossed(track, prev, next, m) {
  return Math.floor((next - m) / track.L) > Math.floor((prev - m) / track.L);
}

// Marshal-Sektor (Index) an Position d
export function sectorIndexAt(track, d) {
  const x = wrapD(track, d);
  const secs = track.sectors;
  for (let i = secs.length - 1; i >= 0; i--) if (x >= secs[i].start) return i;
  return 0;
}
