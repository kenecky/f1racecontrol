#!/usr/bin/env node
// Erzeugt die Umgebung der Strecken für die Intros (js/data/scenery/<id>.js) aus OpenStreetMap-Vektorkacheln
// von OpenFreeMap (OpenMapTiles-Schema, Zoom 14). Ohne zusätzliche Pakete: eigener kleiner MVT-Decoder.
//
// Aufruf:  node tools/gen_scenery_tiles.mjs <cache-ordner> [strecken-ids …]
//
// Ergebnis je Strecke (gleiches Format wie tools/scenery.html):
//   Bodenraster (CELL m): 0 Standardboden, 1 Wasser (Meer, Seen, Flüsse), 2 Wald, 3 Sand/Strand/Fels,
//   4 Stadt/Bebauung, 5 Park/Rasen/Feld; zeilenweise lauflängenkodiert. Gebäude: Grundriss + Höhe.
// Kartendaten © OpenStreetMap-Mitwirkende (ODbL), Kacheln: OpenFreeMap / OpenMapTiles.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { TRACKS } = await import(path.join(ROOT, 'js/data/tracks/index.js'));

// Mittelpunkt der Projektion – identisch zu tools/gen_tracks.py
const ORIGIN = {
  albertpark: [-37.84591, 144.97037], shanghai: [31.34020, 121.21930], suzuka: [34.84459, 136.53278],
  bahrain: [26.03223, 50.51416], jeddah: [21.63894, 39.10273], miami: [25.95762, -80.23775],
  montreal: [45.50441, -73.52645], monaco: [43.73714, 7.42529], barcelona: [41.56900, 2.25735],
  redbullring: [47.22341, 14.76200], silverstone: [52.07177, -1.01636], spa: [50.43466, 5.96867],
  hungaroring: [47.58275, 19.25085], zandvoort: [52.38768, 4.54555], monza: [45.62342, 9.28659],
  madring: [40.47283, -3.62147], baku: [40.36894, 49.84076], singapore: [1.29067, 103.85796],
  cota: [30.13521, -97.63474], mexico: [19.40272, -99.08972], interlagos: [-23.70094, -46.69803],
  lasvegas: [36.11650, -115.16576], lusail: [25.49177, 51.45430], yasmarina: [24.46935, 54.60559],
};
const Z = 14, MARGIN = 900, CELL = 20, BUILD_DIST = 520, MAX_BUILD = 1800;

// ---------- Kacheln holen ----------
const cache = process.argv[2];
fs.mkdirSync(cache, { recursive: true });
let tileUrl = null;
function curl(url, out) { execFileSync('curl', ['-s', '--fail', '--compressed', '--max-time', '60', '-o', out, url]); }
function tile(x, y) {
  const f = path.join(cache, `${Z}_${x}_${y}.pbf`);
  if (!fs.existsSync(f)) {
    if (!tileUrl) {
      const tj = path.join(cache, 'tilejson.json');
      curl('https://tiles.openfreemap.org/planet', tj);
      tileUrl = JSON.parse(fs.readFileSync(tj, 'utf8')).tiles[0];
    }
    for (let i = 0; ; i++) {
      try { curl(tileUrl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), f); break; } catch (e) { if (i >= 3) throw e; }
    }
  }
  let buf = fs.readFileSync(f);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf;
}

// ---------- Minimaler Decoder für Mapbox-Vektorkacheln ----------
function reader(buf) {
  let pos = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  return {
    get pos() { return pos; }, set pos(p) { pos = p; }, end: buf.length, varint,
    key: () => { const k = varint(); return [Math.floor(k / 8), k & 7]; },
    bytes: () => { const n = varint(); const b = buf.subarray(pos, pos + n); pos += n; return b; },
    skip: t => { if (t === 0) varint(); else if (t === 1) pos += 8; else if (t === 2) pos += varint(); else if (t === 5) pos += 4; },
    f32: () => { const v = buf.readFloatLE(pos); pos += 4; return v; }, f64: () => { const v = buf.readDoubleLE(pos); pos += 8; return v; },
  };
}
const packed = b => { const r = reader(b), out = []; while (r.pos < r.end) out.push(r.varint()); return out; };
function decodeValue(b) {
  const r = reader(b);
  while (r.pos < r.end) {
    const [f, t] = r.key();
    if (f === 1) return r.bytes().toString('utf8');
    if (f === 2) return r.f32();
    if (f === 3) return r.f64();
    if (f === 4 || f === 5) return r.varint();
    if (f === 6) { const v = r.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    if (f === 7) return Boolean(r.varint());
    r.skip(t);
  }
  return null;
}
function decodeTile(buf) {
  const layers = {};
  const r = reader(buf);
  while (r.pos < r.end) {
    const [f, t] = r.key();
    if (f !== 3) { r.skip(t); continue; }
    const lr = reader(r.bytes());
    const L = { name: '', extent: 4096, keys: [], values: [], feats: [] };
    while (lr.pos < lr.end) {
      const [lf, lt] = lr.key();
      if (lf === 1) L.name = lr.bytes().toString('utf8');
      else if (lf === 2) L.feats.push(lr.bytes());
      else if (lf === 3) L.keys.push(lr.bytes().toString('utf8'));
      else if (lf === 4) L.values.push(decodeValue(lr.bytes()));
      else if (lf === 5) L.extent = lr.varint();
      else lr.skip(lt);
    }
    layers[L.name] = L;
  }
  return layers;
}
function decodeFeature(L, b) {
  const r = reader(b);
  let tags = [], type = 0, geom = [];
  while (r.pos < r.end) {
    const [f, t] = r.key();
    if (f === 2) tags = packed(r.bytes());
    else if (f === 3) type = r.varint();
    else if (f === 4) geom = packed(r.bytes());
    else r.skip(t);
  }
  const props = {};
  for (let i = 0; i < tags.length; i += 2) props[L.keys[tags[i]]] = L.values[tags[i + 1]];
  const rings = [];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < geom.length;) {
    const cmd = geom[i] & 7, n = geom[i] >> 3; i++;
    if (cmd === 7) { if (cur) rings.push(cur); cur = null; continue; }
    for (let k = 0; k < n; k++) {
      const dx = geom[i++], dy = geom[i++];
      x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
      if (cmd === 1) { if (cur && type !== 3) rings.push(cur); cur = [[x, y]]; } else cur.push([x, y]);
    }
  }
  if (cur && type !== 3) rings.push(cur);
  return { props, type, rings };
}

// ---------- Hilfen ----------
const lon2x = lon => (lon + 180) / 360 * 2 ** Z;
const lat2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z;
function classOf(layer, p) {
  const c = p.class;
  if (layer === 'water') return 1;
  if (layer === 'landcover') {
    if (c === 'wood') return 2;
    if (c === 'sand' || c === 'rock' || c === 'ice') return 3;
    return 5;   // grass, farmland, wetland …
  }
  if (layer === 'landuse') {
    if (['residential', 'commercial', 'industrial', 'retail', 'railway', 'quarry', 'garages', 'hospital', 'school', 'university', 'military'].includes(c)) return 4;
    if (['stadium', 'pitch', 'playground', 'cemetery', 'track', 'zoo', 'theme_park'].includes(c)) return 5;
    return null;
  }
  if (layer === 'park') return 5;
  return null;
}
function fillRings(grid, W, H, rings, val) {
  // gerade/ungerade-Regel über alle Ringe (Löcher werden ausgespart); Zellmitten
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let cy = Math.max(0, Math.floor(y0)); cy <= Math.min(H - 1, Math.ceil(y1)); cy++) {
    const yc = cy + 0.5, xs = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let cx = Math.max(0, Math.ceil(xs[i] - 0.5)); cx <= Math.min(W - 1, Math.floor(xs[i + 1] - 0.5)); cx++) grid[cy * W + cx] = val;
    }
  }
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const rdp = (a, b) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = 0, idx = -1;
    for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / L; if (d > best) { best = d; idx = i; } }
    if (idx >= 0 && best > tol) return rdp(a, idx).slice(0, -1).concat(rdp(idx, b));
    return [pts[a], pts[b]];
  };
  return rdp(0, pts.length - 1);
}

// ---------- Eine Strecke ----------
function build(id) {
  const [lat0, lon0] = ORIGIN[id];
  const k = Math.cos(lat0 * Math.PI / 180);
  const fwd = (lon, lat) => [(lon - lon0) * 111320 * k, -(lat - lat0) * 110540];
  const inv = (x, y) => [x / (111320 * k) + lon0, -y / 110540 + lat0];
  const tpts = TRACKS[id].controlPoints;
  const xs = tpts.map(p => p[0]), ys = tpts.map(p => p[1]);
  const x0 = Math.min(...xs) - MARGIN, x1 = Math.max(...xs) + MARGIN, y0 = Math.min(...ys) - MARGIN, y1 = Math.max(...ys) + MARGIN;
  const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((y1 - y0) / CELL);
  const [lo0, la1] = inv(x0, y0), [lo1, la0] = inv(x1, y1);
  const tx0 = Math.floor(lon2x(lo0)), tx1 = Math.floor(lon2x(lo1)), ty0 = Math.floor(lat2y(la1)), ty1 = Math.floor(lat2y(la0));
  const layersOrder = [['landuse', 4], ['park', 5], ['landcover', 5], ['water', 1]];
  const feats = { landuse: [], park: [], landcover: [], water: [] };
  const builds = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    const layers = decodeTile(tile(tx, ty));
    const toM = (L, [px, py]) => {
      const lon = (tx + px / L.extent) / 2 ** Z * 360 - 180;
      const n = Math.PI * (1 - 2 * (ty + py / L.extent) / 2 ** Z);
      const lat = Math.atan(Math.sinh(n)) * 180 / Math.PI;
      return fwd(lon, lat);
    };
    for (const name of Object.keys(feats)) {
      const L = layers[name]; if (!L) continue;
      for (const fb of L.feats) {
        const f = decodeFeature(L, fb);
        if (f.type !== 3) continue;
        const c = classOf(name, f.props); if (!c) continue;
        feats[name].push({ c, rings: f.rings.map(r => r.map(p => toM(L, p))) });
      }
    }
    const B = layers.building;
    if (B) for (const fb of B.feats) {
      const f = decodeFeature(B, fb);
      if (f.type !== 3 || f.props.hide_3d) continue;
      for (const r of f.rings) builds.push({ h: f.props.render_height, ring: r.map(p => toM(B, p)) });
    }
  }
  // Raster: Stadt/Park/Bewuchs zuerst, Wasser zuletzt (liegt oben)
  const grid = new Uint8Array(W * H);
  const toCell = ([x, y]) => [(x - x0) / CELL, (y - y0) / CELL];
  for (const name of ['landuse', 'park', 'landcover']) for (const f of feats[name]) fillRings(grid, W, H, f.rings.map(r => r.map(toCell)), f.c);
  for (const f of feats.water) fillRings(grid, W, H, f.rings.map(r => r.map(toCell)), 1);
  // Dicht bebaut, aber ohne Stadtfläche in den Kacheln (z. B. São Paulo): als Stadt markieren
  {
    const bmask = new Uint8Array(W * H);
    for (const { ring } of builds) fillRings(bmask, W, H, [ring.map(toCell)], 1);
    const R2 = 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const j = y * W + x;
      if (grid[j] !== 0) continue;
      let n = 0, t = 0;
      for (let a = -R2; a <= R2; a++) for (let b = -R2; b <= R2; b++) { const yy = y + a, xx = x + b; if (yy >= 0 && yy < H && xx >= 0 && xx < W) { t++; n += bmask[yy * W + xx]; } }
      if (n / t > 0.12) grid[j] = 4;
    }
  }
  // Strecke selbst nie Wasser (Uferstraßen)
  for (let i = 0; i < tpts.length; i++) {
    const [ax, ay] = tpts[i], [bx, by] = tpts[(i + 1) % tpts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let s = 0; s < steps; s++) {
      const cx = Math.floor((ax + (bx - ax) * s / steps - x0) / CELL), cy = Math.floor((ay + (by - ay) * s / steps - y0) / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const j = (cy + b) * W + cx + a; if (cx + a >= 0 && cx + a < W && cy + b >= 0 && cy + b < H && grid[j] === 1) grid[j] = 0; }
    }
  }
  const rows = [];
  for (let y = 0; y < H; y++) {
    const r = []; let cur = grid[y * W], n = 0;
    for (let x = 0; x < W; x++) { const v = grid[y * W + x]; if (v === cur) n++; else { r.push(cur, n); cur = v; n = 1; } }
    r.push(cur, n); rows.push(r);
  }
  // Gebäude nahe der Strecke
  const G = 40, near = new Set();
  for (let i = 0; i < tpts.length; i++) {
    const [ax, ay] = tpts[i], [bx, by] = tpts[(i + 1) % tpts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 20));
    for (let s = 0; s < steps; s++) near.add(`${Math.floor((ax + (bx - ax) * s / steps) / G)},${Math.floor((ay + (by - ay) * s / steps) / G)}`);
  }
  const R = Math.ceil(BUILD_DIST / G);
  const distOk = (x, y) => { const gx = Math.floor(x / G), gy = Math.floor(y / G); for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if (near.has(`${gx + a},${gy + b}`)) return true; return false; };
  const list = [];
  for (const { h, ring } of builds) {
    const rg = (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ? ring.slice(0, -1) : ring;
    if (rg.length < 3) continue;
    const cx = rg.reduce((a, p) => a + p[0], 0) / rg.length, cy = rg.reduce((a, p) => a + p[1], 0) / rg.length;
    if (!distOk(cx, cy)) continue;
    let A = 0; for (let i = 0; i < rg.length; i++) { const [ax, ay] = rg[i], [bx, by] = rg[(i + 1) % rg.length]; A += ax * by - bx * ay; }
    A = Math.abs(A) / 2;
    if (A < 25 || A > 60000) continue;
    const hh = Math.max(3, Math.min(320, h || Math.min(14, 4 + Math.sqrt(A) * 0.25)));
    const sp = simplify(rg, 1.5);   // offener Ring (Anfang ≠ Ende), sonst entartet die Vereinfachung
    if (sp.length < 3) continue;
    list.push({ w: A * (1 + hh / 20), h: Math.round(hh * 10) / 10, sp });
  }
  list.sort((a, b) => b.w - a.w);
  const b = list.slice(0, MAX_BUILD).map(o => [o.h, ...o.sp.flatMap(p => [Math.round(p[0]), Math.round(p[1])])]);
  return { cell: CELL, x0: Math.round(x0), y0: Math.round(y0), w: W, h: H, rows, b, walls: [], tiles: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
}

const ids = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(ORIGIN);
const outDir = path.join(ROOT, 'js/data/scenery');
fs.mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const sc = build(id);
  const tiles = sc.tiles; delete sc.tiles;
  fs.writeFileSync(path.join(outDir, `${id}.js`),
    '// Umgebung für das Intro – erzeugt mit tools/gen_scenery_tiles.mjs aus OpenStreetMap-Daten\n' +
    '// (© OpenStreetMap-Mitwirkende, ODbL; Kacheln: OpenFreeMap/OpenMapTiles). Nicht von Hand bearbeiten.\n' +
    'export default ' + JSON.stringify(sc) + ';\n');
  const cnt = new Array(7).fill(0);
  for (const r of sc.rows) for (let i = 0; i < r.length; i += 2) cnt[r[i]] += r[i + 1];
  const tot = sc.w * sc.h, pct = c => Math.round(cnt[c] / tot * 100);
  console.log(`${id.padEnd(12)} ${tiles} Kacheln · Wasser ${pct(1)} % · Wald ${pct(2)} % · Sand ${pct(3)} % · Stadt ${pct(4)} % · Grün ${pct(5)} % · Gebäude ${sc.b.length}`);
}
