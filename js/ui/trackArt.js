// Streckengrafik im Luftbild-Stil: Texturen, Auslaufzonen mit verjüngten Enden,
// Leitplanken, feine Randsteine, Boxengasse mit Garagen, Startaufstellung.
import { pointAt } from '../sim/trackModel.js';

const PAL = {
  terrain: 'rgba(28, 44, 34, 0.35)',
  grass: '#1b3122',
  grassStripe: '#1d3425',
  gravel: '#857455',
  runoff: '#383d45',
  asphalt: '#24272d',
  line: 'rgba(255,255,255,0.88)',
  kerbRed: '#c4232b',
  kerbWhite: '#e8e8e8',
  barrier: 'rgba(170,178,190,0.85)',
  tyres: '#121417',
  pitLane: '#2f333a',
  pitWall: 'rgba(200,206,216,0.8)',
  building: '#41474f',
  garage: '#2a2e35',
};

// ---------- Texturen (einmal erzeugt) ----------

const patterns = {};
function noiseCanvas(size, base, specks, stripes) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  if (stripes) {
    // Mähstreifen
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate(-Math.PI / 5);
    g.fillStyle = stripes;
    for (let x = -size; x < size; x += 16) g.fillRect(x, -size, 8, size * 2);
    g.restore();
  }
  for (const [color, count, r] of specks) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) g.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  return c;
}

function pattern(ctx, name) {
  if (!patterns[name]) {
    patterns[name] = {
      grass: () => noiseCanvas(64, PAL.grass, [['rgba(255,255,255,0.025)', 160, 1], ['rgba(0,0,0,0.12)', 120, 1]], PAL.grassStripe),
      gravel: () => noiseCanvas(32, PAL.gravel, [['rgba(255,240,210,0.25)', 140, 1], ['rgba(40,30,15,0.3)', 140, 1]]),
      asphalt: () => noiseCanvas(32, PAL.asphalt, [['rgba(255,255,255,0.035)', 120, 1], ['rgba(0,0,0,0.25)', 80, 1]]),
      runoff: () => noiseCanvas(32, PAL.runoff, [['rgba(255,255,255,0.04)', 100, 1], ['rgba(0,0,0,0.2)', 60, 1]]),
    }[name]();
  }
  return ctx.createPattern(patterns[name], 'repeat');
}

// ---------- Geometrie-Helfer ----------

// Fläche entlang der Strecke zwischen zwei seitlichen Abständen; taper = Anteil für weiches Ein-/Auslaufen
function ribbon(map, ctx, from, to, latA, latB, taper = 0) {
  const steps = Math.max(6, Math.round((to - from) / 4));
  const inner = [], outer = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let k = 1;
    if (taper > 0) {
      k = Math.min(1, t / taper, (1 - t) / taper);
      k = k * k * (3 - 2 * k); // weicher Verlauf
    }
    const d = from + (to - from) * t;
    inner.push(map.pos(d, latA));
    outer.push(map.pos(d, latA + (latB - latA) * k));
  }
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = outer.length - 1; i >= 0; i--) ctx.lineTo(outer[i][0], outer[i][1]);
  ctx.closePath();
  return outer;
}

function polyline(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

// ---------- Zeichnen ----------

export function drawTrackArt(map, ctx, { pitOffsetPx }) {
  const tr = map.track;
  const ws = map.widthScale();
  const pxPerM = (map.scale * map.zoom) / tr.mPerUnit;
  const trackW = 7.5 * ws;
  const half = trackW / 2;
  const mToPx = m => Math.max(2.5, m * pxPerM * 2.2);

  ctx.lineJoin = 'round';

  // 1) Umgebung und Gras
  map.tracePath(ctx, 0, tr.L);
  ctx.closePath();
  ctx.lineCap = 'round';
  ctx.strokeStyle = PAL.terrain;
  ctx.lineWidth = 80 * ws;
  ctx.stroke();
  const grass = pattern(ctx, 'grass');
  ctx.fillStyle = grass;
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = grass;
  ctx.lineWidth = 50 * ws;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 40 * ws;
  ctx.stroke();

  // 2) Auslaufzonen mit Leitplanke/Reifenstapel an der Außenkante
  ctx.lineCap = 'butt';
  const edges = [];
  for (const type of ['asphalt', 'gravel']) {
    for (const r of tr.runoffs) {
      if (r.type !== type) continue;
      const start = r.offset ? half + mToPx(r.offset) : half;
      const end = start + mToPx(r.width);
      const outer = ribbon(map, ctx, r.from, r.to, r.side * start, r.side * end, 0.28);
      ctx.fillStyle = pattern(ctx, type === 'gravel' ? 'gravel' : 'runoff');
      ctx.fill();
      edges.push({ outer, type });
    }
  }
  for (const e of edges) {
    polyline(ctx, e.outer);
    ctx.strokeStyle = e.type === 'gravel' ? PAL.tyres : PAL.barrier;
    ctx.lineWidth = e.type === 'gravel' ? 2.2 : 1;
    ctx.stroke();
  }

  // 3) Boxengasse, Boxenmauer, Garagen
  const side = tr.pit.side;
  const pitLat = side * pitOffsetPx * ws;
  map.tracePath(ctx, tr.pit.entry, tr.pit.exit + tr.L, pitLat);
  ctx.strokeStyle = PAL.pitLane;
  ctx.lineWidth = 4 * ws;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';
  map.tracePath(ctx, tr.L - 230, tr.L + 260, side * (half + (pitOffsetPx * ws - half) / 2));
  ctx.strokeStyle = PAL.pitWall;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  map.tracePath(ctx, tr.L - 220, tr.L + 250, side * (pitOffsetPx + 5.5) * ws);
  ctx.strokeStyle = PAL.building;
  ctx.lineWidth = 5 * ws;
  ctx.stroke();
  ctx.strokeStyle = PAL.garage;
  ctx.lineWidth = 4 * ws;
  ctx.setLineDash([1.2, Math.max(2, 9 * pxPerM)]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4) Asphalt mit Schatten, weiße Randlinien
  map.tracePath(ctx, 0, tr.L);
  ctx.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = pattern(ctx, 'asphalt');
  ctx.lineWidth = trackW;
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = Math.max(0.7, 0.9 * ws);
  for (const s of [-1, 1]) {
    map.tracePath(ctx, 0, tr.L, s * (half - 0.7));
    ctx.closePath();
    ctx.stroke();
  }

  // 5) Randsteine (rot-weiße Blöcke) direkt an der Streckenkante
  for (const k of tr.kerbs) {
    map.tracePath(ctx, k.from, k.to, k.side * (half + 0.9 * ws));
    ctx.lineWidth = 1.8 * ws;
    ctx.strokeStyle = PAL.kerbWhite;
    ctx.stroke();
    ctx.setLineDash([2.2 * ws, 2.2 * ws]);
    ctx.strokeStyle = PAL.kerbRed;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 6) Startaufstellung (nur sichtbar, wenn groß genug)
  if (8 * pxPerM > 3) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 22; i++) {
      const d = tr.L - (6 + i * 8);
      const lat = (i % 2 ? 1 : -1) * half * 0.45;
      const [ax, ay] = map.pos(d, lat - half * 0.3);
      const [bx, by] = map.pos(d, lat + half * 0.3);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }

  // 7) Ziellinie kariert
  const cells = 6;
  const depth = Math.max(1.2, 3 * pxPerM) / pxPerM;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      const l0 = -half + (trackW / cells) * i, l1 = l0 + trackW / cells;
      const d0 = j * depth, d1 = (j + 1) * depth;
      const p = [map.pos(d0, l0), map.pos(d0, l1), map.pos(d1, l1), map.pos(d1, l0)];
      polyline(ctx, p);
      ctx.closePath();
      ctx.fillStyle = (i + j) % 2 ? '#0d0d0d' : '#f4f4f4';
      ctx.fill();
    }
  }

  // 8) Sektorgrenzen (fein)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 0.8;
  for (const sec of tr.sectors) {
    if (sec.start === 0) continue;
    const [ax, ay] = map.pos(sec.start, -half - 2.5);
    const [bx, by] = map.pos(sec.start, half + 2.5);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  // 9) Kurvennummern, dezent
  ctx.font = '600 9.5px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  for (const c of tr.corners) {
    const [x, y] = map.pos(c.d, -c.turn * (half + 17 * ws));
    ctx.fillStyle = 'rgba(214,221,232,0.82)';
    ctx.fillText(c.id, x, y);
  }
  ctx.restore();
}

export function trackCenter(track, d) {
  return pointAt(track, d);
}
