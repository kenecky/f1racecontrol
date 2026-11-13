// Intro vor dem Rennen: Zoom auf Start/Ziel, Helikopterflug über die Strecke in 3D, TV-Einblendungen.
// Reines Canvas-2D mit eigener Perspektiv-Projektion (keine Bibliothek). renderAt(t) ist zeitgenau –
// dadurch lässt sich das Intro auch Bild für Bild als Video aufnehmen.
import { pointAt } from '../sim/trackModel.js';

const HALF_W = 7;                  // halbe Streckenbreite in Metern
export const INTRO_DUR = 17.2;     // Sekunden
// Strecken mit freigegebenem Intro (werden nacheinander ergänzt)
export const INTRO_TRACKS = new Set(['albertpark', 'suzuka', 'bahrain', 'baku']);

// Einblendungen fürs Intro: Eckdaten-Kacheln, Kalender-Zeile, Abschluss
export function introInfo(track, laps, season, teams) {
  const def = track.def;
  const round = season.find(r => r.track === def.id);
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  let kicker = `FORMEL 1 · ${new Date().getFullYear()}`;
  if (round) { const d = new Date(round.date + 'T12:00:00'); kicker = `Rennen ${round.round} / ${season.length} · ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
  const km = v => v.toFixed(v < 10 ? 3 : 1).replace('.', ',');
  return {
    kicker,
    tiles: [
      ['STRECKENLÄNGE', km(def.lengthM / 1000), 'km'],
      ['RUNDEN', String(laps)],
      ['RENNDISTANZ', km(def.lengthM * laps / 1000), 'km'],
      ['KURVEN', String(track.corners.length)],
      ['ÜBERHOLZONEN', String((def.overtakeZones || []).length)],
      ['REGENRISIKO', Math.round((def.rainChance ?? 0.38) * 100) + ' %'],
    ],
    cars: teams.flatMap(t => [t.color, t.color]),
    endText: 'LIGHTS OUT IN KÜRZE',
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ease = (t, a, b) => smooth((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const mix = (c1, c2, k) => c1.map((v, i) => Math.round(v + (c2[i] - v) * k));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// ---------- Umgebung je Strecke ----------
// Klima: Grundfarbe des Bodens, Streifen neben der Strecke, Baumart. Echte Flächen (Wasser, Wald, Stadt,
// Gebäude …) kommen aus js/data/scenery/<id>.js (OpenStreetMap).
const ENV = {
  green:  { ground: [79, 125, 58],  strip: [[92, 142, 66], [86, 134, 61]],   stripW: 30, tree: 'leaf', trackTrees: 1 },
  dry:    { ground: [138, 136, 84], strip: [[146, 146, 92], [140, 140, 88]], stripW: 26, tree: 'leaf', trackTrees: 0.5 },
  desert: { ground: [208, 182, 134], strip: [[200, 176, 130], [194, 170, 124]], stripW: 30, tree: 'palm', trackTrees: 0 },
  urban:  { ground: [148, 146, 140], strip: [[124, 126, 130], [120, 122, 126]], stripW: 12, tree: 'leaf', trackTrees: 0.15 },
};
const BIOME = {
  bahrain: 'desert', lusail: 'desert', jeddah: 'desert', yasmarina: 'desert', lasvegas: 'desert',
  barcelona: 'dry', cota: 'dry', madring: 'dry', mexico: 'dry',
  monaco: 'urban', singapore: 'urban', baku: 'urban',
};
// Wahrzeichen (Streckenkoordinaten): Gebäude dort bekommen eine eigene Farbe
const LANDMARKS = { baku: [{ x: -300, y: 310, r: 12, wall: [200, 172, 126], roof: [178, 150, 108] }] };   // Jungfrauenturm
// Seitlicher Versatz der Kamera beim Flug über die Start-Ziel-Gerade (m, zur Tribünenseite); 0 = genau über der Strecke
const FLY_OFFSET = { shanghai: 0, monaco: 0 };
const PALMS = new Set(['miami', 'singapore', 'yasmarina', 'jeddah', 'bahrain', 'lusail', 'lasvegas', 'monaco']);
const WATER = [46, 98, 146];
const HAZE_C = [176, 196, 210];   // Dunst in der Ferne (wie in renderAt)
function classColor(c, env) {
  if (c === 1) return WATER;
  if (c === 2) return env.tree === 'palm' ? [118, 134, 78] : [56, 94, 46];
  if (c === 3) return [216, 196, 150];
  if (c === 4) return env === ENV.desert ? [192, 180, 156] : [156, 152, 144];
  if (c === 5) return env === ENV.desert ? [120, 150, 84] : [98, 148, 72];
  if (c === 6) return [112, 116, 122];
  return env.ground;
}

// Kleiner Zufallsgenerator (fest je Strecke – das Intro sieht jedes Mal gleich aus)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class Intro {
  constructor(canvas, track, info = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.tr = track;
    this.info = info;
    this.build();
  }

  // ---------- Szene vorbereiten ----------
  build() {
    const tr = this.tr;
    const L = tr.L;
    // Streckenpunkte alle 5 m mit Normale (rechts bei y-nach-unten)
    const step = 5;
    this.pts = [];
    for (let d = 0; d <= L + 0.01; d += step) {
      const [x, y] = pointAt(tr, d);
      const [x2, y2] = pointAt(tr, d + 1);
      let tx = x2 - x, ty = y2 - y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      this.pts.push({ d, x, y, nx: -ty, ny: tx, tx, ty });
    }
    // Ausdehnung
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    this.box = { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    // Raster für „liegt nah an der Strecke?“
    const G = 20, grid = new Set();
    for (const p of this.pts) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) grid.add(`${Math.floor(p.x / G) + a},${Math.floor(p.y / G) + b}`);
    const nearTrack = (x, y) => grid.has(`${Math.floor(x / G)},${Math.floor(y / G)}`);
    // Umgebung: Klima und echte Flächen
    const env = this.env = ENV[BIOME[tr.def.id] || 'green'];
    const palms = PALMS.has(tr.def.id);
    const r = rng(tr.L * 7 + 11);
    this.prepScenery(nearTrack);
    const clsAt = (x, y) => this.clsAt(x, y);
    // Bäume entlang der Strecke (nur auf freiem Boden bzw. Rasen, je nach Klima)
    this.trees = [];
    for (const p of this.pts) {
      if (r() < 0.45) continue;
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const off = 55 + r() * 120;
        const x = p.x + p.nx * side * off + (r() - 0.5) * 20, y = p.y + p.ny * side * off + (r() - 0.5) * 20;
        if (nearTrack(x, y)) continue;
        const c = clsAt(x, y);
        if (c !== 0 && c !== 5 && c !== 2) continue;
        if (r() > (c === 2 ? 1 : env.trackTrees)) continue;
        this.trees.push({ x, y, r: 4 + r() * 4, h: 7 + r() * 8, c: r(), palm: palms && r() < 0.7 });
      }
    }
    // Wald und Parks aus den Kartendaten
    if (this.sc) {
      const sc = this.sc, CELL = sc.cell;
      const far = this.farGrid;
      let n = 0;
      for (let cy = 0; cy < sc.h && n < 2600; cy++) for (let cx = 0; cx < sc.w && n < 2600; cx++) {
        const c = sc.cls[cy * sc.w + cx];
        if (c !== 2 && c !== 5) continue;
        const x = sc.x0 + (cx + r()) * CELL, y = sc.y0 + (cy + r()) * CELL;
        if (!far(x, y) || nearTrack(x, y)) continue;
        if (r() > (c === 2 ? 0.55 : 0.1)) continue;
        this.trees.push({ x, y, r: 4 + r() * 4, h: 7 + r() * 9, c: r(), palm: palms && (c === 5 || env.tree === 'palm') && r() < 0.8 });
        n++;
      }
    }
    // Tribünen gegenüber der Boxengasse, Boxengebäude auf der Boxenseite
    const pitSide = tr.pit ? tr.pit.side || 1 : 1;
    this.blocks = [];
    const addBlock = (d0, d1, lat0, lat1, h, kind) => {
      for (let d = d0; d < d1; d += 40) {
        const a = pointAt(tr, d), b = pointAt(tr, Math.min(d + 36, d1));
        const p = this.ptAt(d);
        this.blocks.push({ a, b, nx: p.nx, ny: p.ny, lat0, lat1, h, kind, d });
      }
    };
    addBlock(-260, 220, -pitSide * (HALF_W + 26), -pitSide * (HALF_W + 46), 16, 'stand');
    addBlock(-330, 160, pitSide * (HALF_W + 30), pitSide * (HALF_W + 48), 11, 'pit');
    // Kurven
    this.corners = (tr.corners || []).map(c => ({ ...c, p: this.ptAt(c.d) }));
  }

  // Kartendaten (Bodenraster, Gebäude, Mauern) aufbereiten
  prepScenery(nearTrack) {
    const sc0 = this.info.scenery;
    this.runs = [[], []]; this.buildings = []; this.walls = []; this.boats = [];
    // „nicht zu weit von der Strecke“ (für Bäume/Boote): 40-m-Raster, Radius 450 m
    const G = 40, near = new Set();
    for (const p of this.pts) near.add(`${Math.floor(p.x / G)},${Math.floor(p.y / G)}`);
    const R = 11;
    const farCache = new Map();
    this.farGrid = (x, y) => {
      const gx = Math.floor(x / G), gy = Math.floor(y / G), key = gx * 100003 + gy;
      if (farCache.has(key)) return farCache.get(key);
      let ok = false;
      for (let a = -R; a <= R && !ok; a++) for (let b = -R; b <= R; b++) if (near.has(`${gx + a},${gy + b}`)) { ok = true; break; }
      farCache.set(key, ok);
      return ok;
    };
    if (!sc0) { this.sc = null; return; }
    const cls = new Uint8Array(sc0.w * sc0.h);
    sc0.rows.forEach((row, y) => { let x = 0; for (let i = 0; i < row.length; i += 2) { cls.fill(row[i], y * sc0.w + x, y * sc0.w + x + row[i + 1]); x += row[i + 1]; } });
    const sc = this.sc = { ...sc0, cls };
    // Läufe gleicher Klasse (ohne Standardboden), fein (1 Zelle) und grob (3×3, für hohe Kameras)
    const mk = (k, out) => {
      const W = Math.ceil(sc.w / k), H = Math.ceil(sc.h / k), CELL = sc.cell * k;
      // gleiche Läufe in aufeinanderfolgenden Zeilen zu Rechtecken zusammenfassen (weniger Flächen zum Zeichnen)
      let open = new Map();
      for (let by = 0; by < H; by++) {
        let cur = -1, start = 0;
        const next = new Map();
        const flush = bx => {
          if (cur > 0) for (let s0 = start; s0 < bx; s0 += 8) {
            const x0 = sc.x0 + s0 * CELL, x1 = sc.x0 + Math.min(bx, s0 + 8) * CELL, key = `${cur},${x0},${x1}`;
            const prev = open.get(key);
            if (prev && prev.y1 - prev.y0 < CELL * 8) { prev.y1 = sc.y0 + (by + 1) * CELL; next.set(key, prev); }
            else { const r = { c: cur, x0, x1, y0: sc.y0 + by * CELL, y1: sc.y0 + (by + 1) * CELL }; out.push(r); next.set(key, r); }
          }
        };
        for (let bx = 0; bx < W; bx++) {
          let v;
          if (k === 1) v = cls[by * sc.w + bx];
          else {
            const cnt = new Uint16Array(8);
            for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { const x = bx * k + b, y = by * k + a; if (x < sc.w && y < sc.h) cnt[cls[y * sc.w + x]]++; }
            v = 0; for (let c = 1; c < 8; c++) if (cnt[c] > cnt[v]) v = c;
          }
          if (v !== cur) { flush(bx); cur = v; start = bx; }
        }
        flush(W);
        open = next;
      }
    };
    mk(1, this.runs[0]); mk(3, this.runs[1]);
    // Außerhalb des Kartenausschnitts: jede Randfläche 4 km nach außen verlängern (Meer bleibt Meer, Stadt bleibt Stadt)
    {
      const C = sc.cell, X0 = sc.x0, Y0 = sc.y0, X1 = sc.x0 + sc.w * C, Y1 = sc.y0 + sc.h * C, EXT = 4000;
      // je 12 Randzellen die häufigste Klasse (keine dünnen Streifen bis zum Horizont)
      const SEG = 12;
      const edge = (n, at, quad) => {
        let cur = -1, st = 0;
        for (let i = 0; i <= n; i += SEG) {
          let v = -1;
          if (i < n) { const cnt = new Array(8).fill(0); for (let j = i; j < Math.min(n, i + SEG); j++) cnt[at(j)]++; v = 0; for (let c = 1; c < 8; c++) if (cnt[c] > cnt[v]) v = c; }
          if (v !== cur) { if (cur >= 0) { const q = quad(st, Math.min(n, i)); for (const r of [this.runs[0], this.runs[1]]) r.push({ c: cur, ...q }); } cur = v; st = i; }
        }
      };
      edge(sc.w, x => cls[x], (a, b) => ({ x0: X0 + a * C, x1: X0 + b * C, y0: Y0 - EXT, y1: Y0 }));
      edge(sc.w, x => cls[(sc.h - 1) * sc.w + x], (a, b) => ({ x0: X0 + a * C, x1: X0 + b * C, y0: Y1, y1: Y1 + EXT }));
      edge(sc.h, y => cls[y * sc.w], (a, b) => ({ x0: X0 - EXT, x1: X0, y0: Y0 + a * C, y1: Y0 + b * C }));
      edge(sc.h, y => cls[y * sc.w + sc.w - 1], (a, b) => ({ x0: X1, x1: X1 + EXT, y0: Y0 + a * C, y1: Y0 + b * C }));
      const corner = (c, x0, y0, x1, y1) => { for (const r of this.runs) r.push({ c, x0, y0, x1, y1 }); };
      corner(cls[0], X0 - EXT, Y0 - EXT, X0, Y0);
      corner(cls[sc.w - 1], X1, Y0 - EXT, X1 + EXT, Y0);
      corner(cls[(sc.h - 1) * sc.w], X0 - EXT, Y1, X0, Y1 + EXT);
      corner(cls[sc.h * sc.w - 1], X1, Y1, X1 + EXT, Y1 + EXT);
      // Bodenfarbe für den Horizont: häufigste Randklasse
      const cnt = new Array(8).fill(0);
      for (let x = 0; x < sc.w; x++) { cnt[cls[x]]++; cnt[cls[(sc.h - 1) * sc.w + x]]++; }
      for (let y = 0; y < sc.h; y++) { cnt[cls[y * sc.w]]++; cnt[cls[y * sc.w + sc.w - 1]]++; }
      let dom = 0; for (let c = 1; c < 8; c++) if (cnt[c] > cnt[dom]) dom = c;
      this.outside = classColor(dom, this.env);
    }
    // Gebäude: Grundriss + Höhe, Umlaufsinn für Außenseiten
    for (const b of sc.b || []) {
      const pts = [];
      for (let i = 1; i < b.length; i += 2) pts.push([b[i], b[i + 1]]);
      let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; A += ax * by - bx * ay; cx += ax; cy += ay; }
      cx /= pts.length; cy /= pts.length;
      if (nearTrack(cx, cy) && b[0] < 20) continue;   // kleine Bauten direkt an der Strecke stören die Kamerafahrt
      const lm = (LANDMARKS[this.tr.def.id] || []).find(m => Math.hypot(m.x - cx, m.y - cy) < m.r);
      this.buildings.push({ h: b[0], pts, A, cx, cy, lm });
    }
    for (const w of sc.walls || []) {
      const pts = [];
      for (let i = 1; i < w.length; i += 2) pts.push([w[i], w[i + 1]]);
      this.walls.push({ h: w[0] ? 9 : 1.2, pts });
    }
    // Boote: an Wasserzellen am Ufer nahe der Strecke (Häfen, Marinas)
    const r = rng(sc.w * 31 + sc.h);
    const isW = (x, y) => x >= 0 && y >= 0 && x < sc.w && y < sc.h && cls[y * sc.w + x] === 1;
    for (let y = 1; y < sc.h - 1 && this.boats.length < 140; y++) for (let x = 1; x < sc.w - 1 && this.boats.length < 140; x++) {
      if (!isW(x, y)) continue;
      const shore = !isW(x - 1, y) || !isW(x + 1, y) || !isW(x, y - 1) || !isW(x, y + 1) || !isW(x - 2, y) || !isW(x + 2, y);
      const wx = sc.x0 + (x + 0.5) * sc.cell, wy = sc.y0 + (y + 0.5) * sc.cell;
      if (!shore || !this.farGrid(wx, wy) || r() > 0.22) continue;
      this.boats.push({ x: wx, y: wy, a: r() * Math.PI, l: 12 + r() * 22, w: 4 + r() * 3 });
    }
  }

  clsAt(x, y) {
    const sc = this.sc;
    if (!sc) return 0;
    const cx = Math.floor((x - sc.x0) / sc.cell), cy = Math.floor((y - sc.y0) / sc.cell);
    if (cx < 0 || cy < 0 || cx >= sc.w || cy >= sc.h) return 0;
    return sc.cls[cy * sc.w + cx];
  }

  ptAt(d) {
    const L = this.tr.L;
    d = ((d % L) + L) % L;
    const i = Math.min(this.pts.length - 2, Math.floor(d / 5));
    const a = this.pts[i], b = this.pts[i + 1], k = (d - a.d) / 5;
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), nx: lerp(a.nx, b.nx, k), ny: lerp(a.ny, b.ny, k), tx: lerp(a.tx, b.tx, k), ty: lerp(a.ty, b.ty, k) };
  }

  // Geglätteter Punkt (Mittel über ±w Meter) – ruhige Kamerafahrt
  smoothPt(d, w = 80) {
    let x = 0, y = 0, n = 0;
    for (let o = -w; o <= w; o += 10) { const p = this.ptAt(d + o); x += p.x; y += p.y; n++; }
    return { x: x / n, y: y / n };
  }

  // ---------- Kamera ----------
  // Ablauf (Sekunden):
  //  0–0,5   Umriss der Strecke von oben – genau wie auf der Startseite
  //  0,5–3,4 fließender Zoom hinunter hinter die Start-Ziel-Gerade
  //  3,4–4,6 Neigen in die Helikopter-Perspektive
  //  4,6–9,6 Flug von hinten über die Gerade und die Ziellinie
  //  9,6–11  Aufsteigen
  // 11–15    Drehung um 180° hoch über der Strecke – die ganze Strecke im Bild
  // 15–17,2  Übersicht der Strecke, ganz langsam weiterdrehend, Abschluss-Einblendung, Ausblenden
  camera(t) {
    const W = this.W, H = this.H;
    const F = (H / 2) / Math.tan((50 * Math.PI / 180) / 2);
    const a = this.smoothPt(-320, 60), b = this.smoothPt(40, 60);
    const head = Math.atan2(b.y - a.y, b.x - a.x);          // Richtung der Start-Ziel-Geraden
    const fit = Math.max(this.box.w / (W * 0.82), this.box.h / (H * 0.62)) * F;
    let top = { x: this.box.cx, y: this.box.cy, z: fit, yaw: -Math.PI / 2, pitch: Math.PI / 2 };
    // Start genau am Streckenbild der Startseite (gleiche Lage und Größe) – von dort wird hineingezoomt
    const fr = this.info.from;
    if (fr) top = { x: (W / 2 - fr.left - fr.ox) / fr.k, y: (H / 2 - fr.top - fr.oy) / fr.k, z: F / fr.k, yaw: -Math.PI / 2, pitch: Math.PI / 2 };
    const p0 = this.ptAt(-420);
    const low = { x: p0.x, y: p0.y, z: 260, yaw: head, pitch: Math.PI / 2 };
    const pitSide = this.tr.pit ? this.tr.pit.side || 1 : 1;
    // Flug über die Gerade: leicht zur Tribünenseite versetzt, Blick nach vorne
    const fly = k => {
      const d = lerp(-470, 90, k);
      const p = this.smoothPt(d, 50), q = this.smoothPt(d + 300, 60), n = this.ptAt(d);
      const off = FLY_OFFSET[this.tr.def.id] ?? 28;
      const x = p.x - n.nx * pitSide * off, y = p.y - n.ny * pitSide * off, z = 58;
      const dx = q.x - x, dy = q.y - y;
      return { x, y, z, yaw: Math.atan2(dy, dx), pitch: Math.atan2(z, Math.hypot(dx, dy)) };
    };
    // Drehung um 180° über der Mitte der Strecke
    const R = Math.max(this.box.w, this.box.h);
    const orbit = k => {
      const ang = head + Math.PI * k;
      // Abstand je Blickwinkel so wählen, dass die ganze Strecke ins Bild passt (Hochformat: schmaler Bildwinkel)
      const rx = -Math.sin(ang), ry = Math.cos(ang);
      let hw = 0, hd = 0;
      for (let i = 0; i < this.pts.length; i += 8) {
        const p = this.pts[i], dx = p.x - this.box.cx, dy = p.y - this.box.cy;
        hw = Math.max(hw, Math.abs(dx * rx + dy * ry));
        hd = Math.max(hd, Math.abs(dx * Math.cos(ang) + dy * Math.sin(ang)));
      }
      const tanH = Math.tan(25 * Math.PI / 180) * W / H, pe = 0.82;
      const D3 = Math.max(R * 0.9, hw / (tanH * 0.86) + hd * 0.6);
      const dist = D3 * Math.cos(pe), z = D3 * Math.sin(pe);
      return { x: this.box.cx - Math.cos(ang) * dist, y: this.box.cy - Math.sin(ang) * dist, z, yaw: ang, pitch: Math.atan2(z, dist) };
    };
    // Vor der Ziellinie, Blick zurück auf die Gerade (langsam rückwärts schwebend)
    const back = k => {
      const d = lerp(330, 250, k);
      const p = this.smoothPt(d, 40), q = this.smoothPt(-260, 60), n = this.ptAt(d);
      const x = p.x - n.nx * pitSide * 22, y = p.y - n.ny * pitSide * 22, z = lerp(46, 38, k);
      const dx = q.x - x, dy = q.y - y;
      return { x, y, z, yaw: Math.atan2(dy, dx), pitch: Math.atan2(z, Math.hypot(dx, dy)) };
    };
    const blend = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)), yaw: lerpAng(a.yaw, b.yaw, k), pitch: lerp(a.pitch, b.pitch, k) });
    let c;
    if (t < 0.5) c = top;
    else if (t < 3.4) c = blend(top, low, ease(t, 0.5, 3.4));
    else if (t < 4.6) c = blend(low, fly(0), ease(t, 3.4, 4.6));
    else if (t < 9.6) { const k = (t - 4.6) / 5; c = fly(k * (0.85 + 0.15 * k)); }
    else if (t < 11) c = blend(fly(1), orbit(0), ease(t, 9.6, 11));
    else if (t < 15) c = orbit(ease(t, 11, 15) * 0.85 + (t - 11) / 4 * 0.15);
    else c = orbit(1 + (t - 15) * 0.0375);   // Übersicht: dreht im gleichen Tempo sanft aus
    c.F = F;
    return c;
  }

  // ---------- Zeichnen ----------
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.info.maxDpr || 1.5);   // begrenzt: flüssiger auf dem Handy
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
  }

  renderAt(t) {
    if (!this.W) this.resize();
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cam = this.camera(t);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const f = [cy * cp, sy * cp, -sp];
    const u = [cy * sp, sy * sp, cp];
    const rt = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    const F = cam.F, ox = W / 2, oy = H / 2;
    this.lastF = F;
    const NEAR = 2;
    const P = (x, y, z = 0) => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const dep = dx * f[0] + dy * f[1] + dz * f[2];
      if (dep < NEAR) return null;
      return [ox + F * (dx * rt[0] + dy * rt[1] + dz * rt[2]) / dep, oy - F * (dx * u[0] + dy * u[1] + dz * u[2]) / dep, dep];
    };
    this.P = P;
    const fogFar = Math.max(1800, cam.z * 3.2);
    const fogK = dep => clamp((dep - fogFar * 0.35) / fogFar, 0, 0.85);
    const SKY = [150, 182, 214], HAZE = [176, 196, 210];

    // Himmel und Boden
    const horizon = oy - F * Math.tan(cam.pitch);
    const env = this.env, groundC = this.outside || env.ground;
    ctx.fillStyle = rgb(groundC);
    ctx.fillRect(0, 0, W, H);
    if (horizon > -40) {
      const g = ctx.createLinearGradient(0, horizon - 220, 0, horizon);
      g.addColorStop(0, rgb([92, 140, 196])); g.addColorStop(1, rgb(SKY));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, horizon));
      const g2 = ctx.createLinearGradient(0, horizon, 0, horizon + 160);
      g2.addColorStop(0, rgb(HAZE)); g2.addColorStop(1, `rgba(${groundC[0]},${groundC[1]},${groundC[2]},0)`);
      ctx.fillStyle = g2; ctx.fillRect(0, horizon, W, 160);
    }
    // leichte Rasenstreifen um die Strecke (Mähmuster) – nur nah
    const quad = (a, b, c, d, fill) => {
      if (!a || !b || !c || !d) return;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    const pts = this.pts;
    const ribbon = (lat0, lat1, from, to, colorAt) => {
      const i0 = Math.floor(from / 5), i1 = Math.ceil(to / 5);
      for (let i = i0; i < i1; i++) {
        const a = pts[((i % (pts.length - 1)) + (pts.length - 1)) % (pts.length - 1)], b = pts[(((i + 1) % (pts.length - 1)) + (pts.length - 1)) % (pts.length - 1)];
        const A = P(a.x + a.nx * lat0, a.y + a.ny * lat0), B = P(b.x + b.nx * lat0, b.y + b.ny * lat0);
        const C = P(b.x + b.nx * lat1, b.y + b.ny * lat1), D = P(a.x + a.nx * lat1, a.y + a.ny * lat1);
        if (!A || !B || !C || !D) continue;
        // ausserhalb des Bildes überspringen
        if (Math.max(A[0], B[0], C[0], D[0]) < -20 || Math.min(A[0], B[0], C[0], D[0]) > W + 20 || Math.max(A[1], B[1], C[1], D[1]) < -20 || Math.min(A[1], B[1], C[1], D[1]) > H + 20) continue;
        quad(A, B, C, D, colorAt(i, (A[2] + C[2]) / 2));
      }
    };
    const fogged = (c, dep) => rgb(mix(c, HAZE, fogK(dep)));
    // Flächen aus den Kartendaten: Wasser, Wald, Sand, Stadt, Parks (grob, wenn die Kamera hoch ist)
    {
      const runs = this.runs ? this.runs[cam.z > 380 ? 1 : 0] : [];
      for (const rn of runs) {
        const A = P(rn.x0 - 1, rn.y0 - 1), B = P(rn.x1 + 1, rn.y0 - 1), C = P(rn.x1 + 1, rn.y1 + 1), D = P(rn.x0 - 1, rn.y1 + 1);
        if (!A || !B || !C || !D) continue;
        if (Math.max(A[0], B[0], C[0], D[0]) < -4 || Math.min(A[0], B[0], C[0], D[0]) > W + 4 || Math.max(A[1], B[1], C[1], D[1]) < -4 || Math.min(A[1], B[1], C[1], D[1]) > H + 4) continue;
        const col = mix(classColor(rn.c, env), HAZE, fogK((A[2] + C[2]) / 2));
        ctx.fillStyle = rgb(col);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill();
      }
    }
    // Streifen entlang der Strecke (Rasen, in der Wüste Sand, in der Stadt Gehweg)
    ribbon(-HALF_W - env.stripW, HALF_W + env.stripW, 0, this.tr.L, (i, dep) => fogged(i % 6 < 3 ? env.strip[0] : env.strip[1], dep));
    // Auslaufzonen
    for (const ro of this.tr.runoffs || []) {
      const lat0 = ro.side * (HALF_W + ro.offset), lat1 = ro.side * (HALF_W + ro.offset + ro.width);
      const col = ro.type === 'gravel' ? [196, 172, 124] : [112, 118, 128];
      let from = ro.from, to = ro.to; if (to < from) to += this.tr.L;
      ribbon(lat0, lat1, from, to, (i, dep) => fogged(col, dep));
    }
    // Boxengasse
    const pit = this.tr.pit;
    if (pit) {
      const sd = pit.side || 1;
      let a = pit.entry, b = pit.exit; if (b < a) b += this.tr.L;
      ribbon(sd * (HALF_W + 6), sd * (HALF_W + 26), a + 60, b - 60, (i, dep) => fogged([72, 76, 84], dep));
      ribbon(sd * (HALF_W + 4), sd * (HALF_W + 5), a + 60, b - 60, (i, dep) => fogged([220, 224, 230], dep));
    }
    // Asphalt mit leichter Abwechslung, weiße Randlinien
    ribbon(-HALF_W, HALF_W, 0, this.tr.L, (i, dep) => fogged(i % 2 ? [58, 61, 68] : [61, 64, 71], dep));
    ribbon(-HALF_W, -HALF_W + 0.5, 0, this.tr.L, (i, dep) => fogged([235, 236, 238], dep));
    ribbon(HALF_W - 0.5, HALF_W, 0, this.tr.L, (i, dep) => fogged([235, 236, 238], dep));
    // Randsteine rot-weiß
    for (const kb of this.tr.kerbs || []) {
      const lat0 = kb.side * (HALF_W - 0.2), lat1 = kb.side * (HALF_W + 1.4);
      let from = kb.from, to = kb.to; if (to < from) to += this.tr.L;
      ribbon(lat0, lat1, from, to, (i, dep) => fogged(i % 2 ? [214, 32, 26] : [240, 240, 240], dep));
    }
    // Start/Ziel: Schachbrett über die ganze Breite, Startplätze dahinter
    {
      const s = this.ptAt(0), n = 8, cell = (2 * HALF_W) / n;
      for (let r = 0; r < 2; r++) for (let c = 0; c < n; c++) {
        const d0 = -1.5 + r * 1.5, lat0 = -HALF_W + c * cell;
        const A = P(s.x + s.tx * d0 + s.nx * lat0, s.y + s.ty * d0 + s.ny * lat0);
        const B = P(s.x + s.tx * (d0 + 1.5) + s.nx * lat0, s.y + s.ty * (d0 + 1.5) + s.ny * lat0);
        const C = P(s.x + s.tx * (d0 + 1.5) + s.nx * (lat0 + cell), s.y + s.ty * (d0 + 1.5) + s.ny * (lat0 + cell));
        const D = P(s.x + s.tx * d0 + s.nx * (lat0 + cell), s.y + s.ty * d0 + s.ny * (lat0 + cell));
        quad(A, B, C, D, (r + c) % 2 ? '#111' : '#f4f4f4');
      }
      const cars = this.info.cars || [];
      for (let g = 0; g < cars.length; g++) {
        const p = this.ptAt(-16 - g * 8), lat = (g % 2 ? 1 : -1) * 3.2;
        const corner = (dl, dw) => P(p.x + p.tx * dl + p.nx * (lat + dw), p.y + p.ty * dl + p.ny * (lat + dw), 0.4);
        const A = corner(2.6, -0.95), B = corner(2.6, 0.95), C = corner(-2.6, 0.95), D = corner(-2.6, -0.95);
        quad(A, B, C, D, cars[g]);
        const A2 = corner(2.9, -0.95), B2 = corner(2.9, 0.95), C2 = corner(2.4, 0.95), D2 = corner(2.4, -0.95);
        quad(A2, B2, C2, D2, '#111');
      }
      for (let g = 0; g < 22; g++) {
        const p = this.ptAt(-12 - g * 8), lat = (g % 2 ? 1 : -1) * 3.2;
        const A = P(p.x + p.nx * (lat - 1.4), p.y + p.ny * (lat - 1.4)), B = P(p.x + p.nx * (lat + 1.4), p.y + p.ny * (lat + 1.4));
        if (A && B) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(0.6, F * 0.35 / A[2]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
      }
    }

    // 3D-Objekte: Bäume, Tribünen, Boxengebäude – von hinten nach vorne
    const objs = [];
    for (const tr of this.trees) {
      const c = P(tr.x, tr.y, tr.h * 0.6);
      if (!c || c[0] < -60 || c[0] > W + 60 || c[1] < -60 || c[1] > H + 60) continue;
      objs.push({ dep: c[2], draw: () => this.drawTree(ctx, P, tr, fogK(c[2])) });
    }
    for (const bl of this.blocks) {
      const c = P((bl.a[0] + bl.b[0]) / 2, (bl.a[1] + bl.b[1]) / 2, bl.h / 2);
      if (!c) continue;
      objs.push({ dep: c[2], draw: () => this.drawBlock(ctx, P, bl, cam, fogK(c[2])) });
    }
    const maxB = cam.z > 380 ? 450 : cam.z > 200 ? 1000 : Infinity;
    let nb = 0;
    for (const bd of this.buildings || []) {
      if (nb++ >= maxB && !bd.lm) continue;
      const c = P(bd.cx, bd.cy, bd.h / 2);
      if (!c || c[0] < -200 || c[0] > W + 200 || c[1] < -300 || c[1] > H + 200) continue;
      objs.push({ dep: c[2], draw: () => this.drawBuilding(ctx, P, bd, cam, fogK(c[2])) });
    }
    for (const wl of this.walls || []) {
      const m = wl.pts[Math.floor(wl.pts.length / 2)];
      const c = P(m[0], m[1], wl.h / 2);
      if (!c) continue;
      objs.push({ dep: c[2], draw: () => this.drawWall(ctx, P, wl, fogK(c[2])) });
    }
    for (const bt of this.boats || []) {
      const c = P(bt.x, bt.y, 1);
      if (!c || c[0] < -40 || c[0] > W + 40 || c[1] < -40 || c[1] > H + 40) continue;
      objs.push({ dep: c[2], draw: () => this.drawBoat(ctx, P, bt, fogK(c[2])) });
    }
    objs.sort((a, b) => b.dep - a.dep);
    for (const o of objs) o.draw();

    // Übersicht am Anfang: leuchtender Umriss wie auf der Startseite, blendet aus
    const outline = 1 - ease(t, 0.9, 2.3);
    if (outline > 0) {
      ctx.fillStyle = `rgba(6,9,13,${Math.min(1, outline * 0.92 + (1 - ease(t, 0, 0.9)) * 0.08)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      let first = true;
      for (const p of pts) { const q = P(p.x, p.y); if (!q) continue; first ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); first = false; }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.globalAlpha = outline;
      // gleicher Stil wie das Streckenbild auf der Startseite
      ctx.shadowColor = 'rgba(250,204,21,.35)'; ctx.shadowBlur = 14;
      ctx.strokeStyle = '#3a4352'; ctx.lineWidth = 8; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#f1f4f8'; ctx.lineWidth = 2.6; ctx.stroke();
      const s = P(pts[0].x, pts[0].y);
      if (s) { ctx.fillStyle = '#ef4444'; ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8); }
      ctx.globalAlpha = 1;
    }
    this.drawCorners(ctx, P, t);
    this.drawTV(ctx, t);
    // Ausblenden am Ende
    const out = ease(t, INTRO_DUR - 0.5, INTRO_DUR);
    if (out > 0) { ctx.fillStyle = `rgba(21,24,29,${out})`; ctx.fillRect(0, 0, W, H); }
  }

  drawTree(ctx, P, tr, fog) {
    const base = P(tr.x, tr.y, 0), top = P(tr.x, tr.y, tr.h);
    if (!base || !top) return;
    const rad = this.F_r(tr.r, top[2]);
    if (rad < 0.6) return;
    if (rad < 3) {
      // weit weg: nur ein Farbtupfer (schnell)
      ctx.fillStyle = rgb(mix(tr.palm ? [62, 128, 52] : tr.c < 0.5 ? [52, 110, 48] : [72, 128, 56], [176, 196, 210], fog));
      ctx.beginPath(); ctx.arc(top[0], top[1], rad, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (tr.palm) {
      // Palme: schlanker Stamm, Wedel sternförmig
      ctx.strokeStyle = rgb(mix([120, 96, 64], [176, 196, 210], fog)); ctx.lineWidth = Math.max(1, rad * 0.18);
      ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
      ctx.fillStyle = rgb(mix(tr.c < 0.5 ? [46, 110, 46] : [62, 128, 52], [176, 196, 210], fog));
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2 + tr.c * 3;
        ctx.beginPath();
        ctx.ellipse(top[0] + Math.cos(a) * rad * 0.7, top[1] + Math.sin(a) * rad * 0.35 + rad * 0.15, rad * 0.75, rad * 0.22, a, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    // Schatten
    ctx.fillStyle = `rgba(30,50,20,${0.35 * (1 - fog)})`;
    ctx.beginPath(); ctx.ellipse(base[0] + rad * 0.4, base[1] + rad * 0.15, rad * 1.1, rad * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    // Stamm
    ctx.strokeStyle = rgb(mix([80, 60, 40], [176, 196, 210], fog)); ctx.lineWidth = Math.max(1, rad * 0.25);
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1] + rad * 0.5); ctx.stroke();
    // Krone mit Licht von oben links
    const c1 = mix(tr.c < 0.5 ? [38, 92, 40] : [52, 104, 44], [176, 196, 210], fog);
    const c2 = mix(tr.c < 0.5 ? [72, 136, 62] : [92, 148, 66], [176, 196, 210], fog);
    const g = ctx.createRadialGradient(top[0] - rad * 0.4, top[1] - rad * 0.4, rad * 0.1, top[0], top[1], rad * 1.1);
    g.addColorStop(0, rgb(c2)); g.addColorStop(1, rgb(c1));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(top[0], top[1], rad, 0, Math.PI * 2); ctx.fill();
  }

  F_r(r, dep) { return this.lastF * r / dep; }

  // Gebäude als Quader mit echtem Grundriss: sichtbare Außenwände, dann Dach
  drawBuilding(ctx, P, bd, cam, fog) {
    const base = [], top = [];
    for (const [x, y] of bd.pts) { const a = P(x, y, 0), b = P(x, y, bd.h); if (!a || !b) return; base.push(a); top.push(b); }
    const span = Math.abs(top[0][0] - base[0][0]) + Math.abs(top[0][1] - base[0][1]);
    if (span < 2.5) {
      // von weit oben: nur das Dach (schnell)
      ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath();
      ctx.fillStyle = rgb(mix(bd.h > 28 ? [170, 180, 192] : [200, 190, 176], HAZE_C, fog)); ctx.fill();
      return;
    }
    const tall = bd.h > 28;
    const wall = bd.lm ? bd.lm.wall : tall ? [184, 194, 206] : bd.h > 14 ? [214, 206, 192] : [226, 216, 198];
    const roof = bd.lm ? bd.lm.roof : tall ? [150, 160, 172] : [188, 178, 164];
    const n = bd.pts.length, sgn = bd.A > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = bd.pts[i], [bx, by] = bd.pts[(i + 1) % n];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
      const nx = sgn * dy / l, ny = -sgn * dx / l;
      if ((cam.x - (ax + bx) / 2) * nx + (cam.y - (ay + by) / 2) * ny <= 0) continue;
      const lit = 0.72 + 0.28 * Math.max(0, -nx * 0.6 - ny * 0.8);
      ctx.beginPath(); ctx.moveTo(base[i][0], base[i][1]); ctx.lineTo(base[(i + 1) % n][0], base[(i + 1) % n][1]);
      ctx.lineTo(top[(i + 1) % n][0], top[(i + 1) % n][1]); ctx.lineTo(top[i][0], top[i][1]); ctx.closePath();
      ctx.fillStyle = rgb(mix(wall.map(v => v * lit), HAZE_C, fog)); ctx.fill();
      // Fensterbänder bei höheren Häusern
      if (bd.h > 12 && span > 14 && span / Math.max(1, bd.h / 3.4) > 3) {
        ctx.strokeStyle = `rgba(60,80,104,${0.35 * (1 - fog)})`; ctx.lineWidth = 1;
        const floors = Math.min(24, Math.floor(bd.h / 3.4));
        for (let f = 1; f < floors; f++) {
          const k = f / floors;
          ctx.beginPath();
          ctx.moveTo(lerp(base[i][0], top[i][0], k), lerp(base[i][1], top[i][1], k));
          ctx.lineTo(lerp(base[(i + 1) % n][0], top[(i + 1) % n][0], k), lerp(base[(i + 1) % n][1], top[(i + 1) % n][1], k));
          ctx.stroke();
        }
      }
    }
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath();
    ctx.fillStyle = rgb(mix(roof, HAZE_C, fog)); ctx.fill();
  }

  // Mauer (z. B. Altstadtmauer) bzw. flache Mole
  drawWall(ctx, P, wl, fog) {
    const col = wl.h > 2 ? [196, 170, 128] : [176, 176, 170];
    for (let i = 0; i < wl.pts.length - 1; i++) {
      const [ax, ay] = wl.pts[i], [bx, by] = wl.pts[i + 1];
      const a0 = P(ax, ay, 0), b0 = P(bx, by, 0), a1 = P(ax, ay, wl.h), b1 = P(bx, by, wl.h);
      if (!a0 || !b0 || !a1 || !b1) continue;
      ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(a1[0], a1[1]); ctx.closePath();
      ctx.fillStyle = rgb(mix(col, HAZE_C, fog)); ctx.fill();
      if (wl.h <= 2) { ctx.strokeStyle = rgb(mix(col, HAZE_C, fog)); ctx.lineWidth = Math.max(1, this.F_r(4, a1[2])); ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke(); }
    }
  }

  // Yacht im Hafen
  drawBoat(ctx, P, bt, fog) {
    const ca = Math.cos(bt.a), sa = Math.sin(bt.a);
    const pt = (l, w, z) => P(bt.x + ca * l - sa * w, bt.y + sa * l + ca * w, z);
    const hull = [pt(bt.l / 2, 0, 1), pt(bt.l * 0.3, bt.w / 2, 1), pt(-bt.l / 2, bt.w / 2, 1), pt(-bt.l / 2, -bt.w / 2, 1), pt(bt.l * 0.3, -bt.w / 2, 1)];
    if (hull.some(q => !q)) return;
    ctx.beginPath(); hull.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
    ctx.fillStyle = rgb(mix([244, 246, 248], HAZE_C, fog)); ctx.fill();
    const cab = [pt(bt.l * 0.15, bt.w * 0.3, 3), pt(-bt.l * 0.3, bt.w * 0.3, 3), pt(-bt.l * 0.3, -bt.w * 0.3, 3), pt(bt.l * 0.15, -bt.w * 0.3, 3)];
    if (cab.some(q => !q)) return;
    ctx.beginPath(); cab.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
    ctx.fillStyle = rgb(mix([200, 210, 220], HAZE_C, fog)); ctx.fill();
  }

  drawBlock(ctx, P, bl, cam, fog) {
    const corner = (pt, lat, z) => P(pt[0] + bl.nx * lat, pt[1] + bl.ny * lat, z);
    const a0 = corner(bl.a, bl.lat0, 0), b0 = corner(bl.b, bl.lat0, 0), a1 = corner(bl.a, bl.lat1, 0), b1 = corner(bl.b, bl.lat1, 0);
    const near = bl.kind === 'stand' ? bl.h * 0.25 : bl.h;
    const ta0 = corner(bl.a, bl.lat0, near), tb0 = corner(bl.b, bl.lat0, near), ta1 = corner(bl.a, bl.lat1, bl.h), tb1 = corner(bl.b, bl.lat1, bl.h);
    if (![a0, b0, a1, b1, ta0, tb0, ta1, tb1].every(Boolean)) return;
    const face = (pts, c) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fillStyle = rgb(mix(c, [176, 196, 210], fog)); ctx.fill(); };
    if (bl.kind === 'stand') {
      face([a1, b1, tb1, ta1], [70, 76, 88]);              // Rückwand
      face([ta0, tb0, tb1, ta1], [196, 40, 40]);           // Sitzreihen (schräg)
      // Sitzreihen-Linien
      ctx.strokeStyle = `rgba(255,255,255,${0.25 * (1 - fog)})`; ctx.lineWidth = 0.7;
      for (let k = 1; k < 5; k++) {
        const s = k / 5;
        const p1 = [lerp(ta0[0], ta1[0], s), lerp(ta0[1], ta1[1], s)], p2 = [lerp(tb0[0], tb1[0], s), lerp(tb0[1], tb1[1], s)];
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      }
      face([a0, b0, tb0, ta0], [120, 126, 138]);            // Vorderkante
    } else {
      face([a1, b1, tb1, ta1], [110, 116, 128]);
      face([ta0, tb0, tb1, ta1], [150, 156, 166]);          // Dach
      face([a0, b0, tb0, ta0], [92, 98, 110]);              // Garagenfront
      // Garagentore in Teamfarben
      const cols = [[220, 30, 40], [255, 135, 0], [0, 210, 190], [30, 65, 255], [0, 111, 98], [255, 255, 255], [34, 153, 113], [0, 144, 255], [100, 196, 255], [182, 186, 189]];
      const col = cols[Math.abs(Math.round(bl.d / 40)) % cols.length];
      for (let k = 0; k < 3; k++) {
        const s0 = 0.08 + k * 0.31, s1 = s0 + 0.24;
        const q = (s, z) => [lerp(a0[0], b0[0], s) + (lerp(ta0[0], tb0[0], s) - lerp(a0[0], b0[0], s)) * z, lerp(a0[1], b0[1], s) + (lerp(ta0[1], tb0[1], s) - lerp(a0[1], b0[1], s)) * z];
        face([q(s0, 0), q(s1, 0), q(s1, 0.6), q(s0, 0.6)], col);
      }
    }
  }

  // Kurvenmarken: schweben über der Kurve, solange man sie gut sieht
  drawCorners(ctx, P, t) {
    if (t < 11.2 || t > INTRO_DUR - 0.4) return;
    const alpha = ease(t, 11.2, 11.8) * (1 - ease(t, 14.6, 15.2));
    ctx.font = '700 12px "RC Mono", monospace';
    ctx.textBaseline = 'middle';
    const used = [];
    for (const c of this.corners) {
      const g = P(c.p.x, c.p.y, 0), top = P(c.p.x, c.p.y, 70);
      if (!g || !top || top[0] < 10 || top[0] > this.W - 10 || top[1] < 70 || top[1] > this.H - 220) continue;
      const a = alpha;
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(250,204,21,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
      const label = c.id;
      const w = ctx.measureText(label).width + 14;
      if (top[0] - w / 2 < 6 || top[0] + w / 2 > this.W - 6) continue;
      // keine überlappenden Schilder
      const box = [top[0] - w / 2 - 2, top[1] - 24, top[0] + w / 2 + 2, top[1]];
      if (used.some(u => box[0] < u[2] && box[2] > u[0] && box[1] < u[3] && box[3] > u[1])) continue;
      used.push(box);
      ctx.fillStyle = 'rgba(12,14,18,.88)'; ctx.fillRect(top[0] - w / 2, top[1] - 22, w, 20);
      ctx.fillStyle = '#facc15'; ctx.fillRect(top[0] - w / 2, top[1] - 22, 3, 20);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, top[0] + 1, top[1] - 12);
    }
    ctx.globalAlpha = 1;
  }

  // TV-Grafiken
  drawTV(ctx, t) {
    const W = this.W, H = this.H, info = this.info, def = this.tr.def;
    const mono = s => `${s} "RC Mono", monospace`;
    // Senderlogo oben links + LIVE
    const a0 = ease(t, 0.2, 0.6) * (1 - ease(t, INTRO_DUR - 0.7, INTRO_DUR - 0.3));
    if (a0 > 0) {
      ctx.globalAlpha = a0;
      ctx.fillStyle = 'rgba(12,14,18,.85)'; ctx.fillRect(12, 14, 132, 24);
      ctx.fillStyle = '#e10600'; ctx.fillRect(12, 14, 4, 24);
      ctx.font = mono('800 11px'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText('RACE CONTROL', 22, 26.5);
      const blink = Math.floor(t * 2) % 2 === 0;
      ctx.fillStyle = 'rgba(12,14,18,.85)'; ctx.fillRect(W - 70, 14, 58, 24);
      ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d'; ctx.beginPath(); ctx.arc(W - 58, 26, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('LIVE', W - 48, 26.5);
      ctx.globalAlpha = 1;
    }
    // Bauchbinde: Name des Grand Prix
    const inK = ease(t, 4.8, 5.5), outK = ease(t, 10.2, 10.8);
    if (inK > 0 && outK < 1) {
      const y = H - 196, x = 14 - (1 - inK) * 40 - outK * 40;
      ctx.globalAlpha = inK * (1 - outK);
      ctx.fillStyle = 'rgba(12,14,18,.9)'; ctx.fillRect(x, y, W - 28, 64);
      ctx.fillStyle = '#e10600'; ctx.fillRect(x, y, 6, 64);
      ctx.font = mono('600 10px'); ctx.fillStyle = '#facc15'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText((info.kicker || `FORMEL 1 · ${new Date().getFullYear()}`).toUpperCase(), x + 18, y + 18);
      ctx.font = mono('800 18px'); ctx.fillStyle = '#fff';
      ctx.fillText(def.grandPrix.toUpperCase(), x + 18, y + 40);
      ctx.font = '500 12px system-ui, sans-serif'; ctx.fillStyle = '#c3cad6';
      ctx.fillText(`${def.name} · ${def.country}`, x + 18, y + 57);
      ctx.globalAlpha = 1;
    }
    // Eckdaten: Kacheln, eine nach der anderen
    const tiles = info.tiles || [];
    const tIn = 11.2, per = 0.3;
    const tOut = 0;   // Kacheln bleiben bis zum Ende (Ausblenden mit dem ganzen Bild)
    if (t > tIn && tOut < 1) {
      const cols = 3, gap = 6, tw = (W - 28 - gap * (cols - 1)) / cols, th = 52, y0 = H - 124;
      tiles.forEach((tile, i) => {
        const k = ease(t, tIn + i * per, tIn + i * per + 0.35) * (1 - tOut);
        if (k <= 0) return;
        const cx = 14 + (i % cols) * (tw + gap), cy = y0 + Math.floor(i / cols) * (th + gap) + (1 - k) * 16;
        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgba(6,9,13,.9)'; ctx.fillRect(cx, cy, tw, th);
        ctx.strokeStyle = 'rgba(250,204,21,.55)'; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, tw - 1, th - 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.font = mono('600 8.5px'); ctx.fillStyle = '#8fd3a2';
        ctx.fillText(tile[0], cx + 8, cy + 15);
        ctx.font = mono('800 17px'); ctx.fillStyle = '#fff';
        ctx.fillText(tile[1], cx + 8, cy + 38);
        if (tile[2]) { const w = ctx.measureText(tile[1]).width; ctx.font = mono('600 10px'); ctx.fillStyle = '#c3cad6'; ctx.fillText(tile[2], cx + 12 + w, cy + 38); }
      });
      ctx.globalAlpha = 1;
    }
    // Abschluss-Text entfällt – die Eckdaten-Kacheln bleiben bis zum Ende stehen
    const endK = 0;
    if (endK > 0) {
      ctx.globalAlpha = endK;
      const y = H * 0.74;
      ctx.fillStyle = 'rgba(12,14,18,.88)'; ctx.fillRect(0, y, W, 60);
      ctx.fillStyle = '#facc15'; ctx.fillRect(0, y, W, 3); ctx.fillRect(0, y + 57, W, 3);
      ctx.font = mono('800 20px'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(info.endText || 'RACE CONTROL · BEREIT', W / 2, y + 31);
      ctx.globalAlpha = 1;
    }
    // Überspringen
    const sk = ease(t, 0.8, 1.2) * (1 - ease(t, INTRO_DUR - 1, INTRO_DUR - 0.6));
    if (sk > 0 && !info.hideSkip) {
      ctx.globalAlpha = sk * 0.8;
      ctx.font = mono('600 10px'); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
      ctx.fillText('TIPPEN ZUM ÜBERSPRINGEN ›', W - 14, H - 14);
      ctx.globalAlpha = 1;
    }
  }
}
