// Intro vor dem Rennen: Zoom auf Start/Ziel, Helikopterflug über die Strecke in 3D, TV-Einblendungen.
// Reines Canvas-2D mit eigener Perspektiv-Projektion (keine Bibliothek). renderAt(t) ist zeitgenau –
// dadurch lässt sich das Intro auch Bild für Bild als Video aufnehmen.
import { pointAt } from '../sim/trackModel.js';

const HALF_W = 7;                  // halbe Streckenbreite in Metern
export const INTRO_DUR = 17.2;     // Sekunden
// Strecken mit freigegebenem Intro (werden nacheinander ergänzt)
export const INTRO_TRACKS = new Set(['albertpark']);

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
    // Bäume entlang der Strecke
    const r = rng(tr.L * 7 + 11);
    this.trees = [];
    for (const p of this.pts) {
      if (r() < 0.45) continue;
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const off = 55 + r() * 120;
        const x = p.x + p.nx * side * off + (r() - 0.5) * 20, y = p.y + p.ny * side * off + (r() - 0.5) * 20;
        if (nearTrack(x, y)) continue;
        this.trees.push({ x, y, r: 4 + r() * 4, h: 7 + r() * 8, c: r() });
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
  //  0–1,4   Umriss der Strecke von oben (wie auf der Startseite)
  //  1,4–3,4 Zoom hinunter hinter die Start-Ziel-Gerade
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
    const top = { x: this.box.cx, y: this.box.cy, z: fit, yaw: -Math.PI / 2, pitch: Math.PI / 2 };
    const p0 = this.ptAt(-420);
    const low = { x: p0.x, y: p0.y, z: 260, yaw: head, pitch: Math.PI / 2 };
    const pitSide = this.tr.pit ? this.tr.pit.side || 1 : 1;
    // Flug über die Gerade: leicht zur Tribünenseite versetzt, Blick nach vorne
    const fly = k => {
      const d = lerp(-470, 90, k);
      const p = this.smoothPt(d, 50), q = this.smoothPt(d + 300, 60), n = this.ptAt(d);
      const x = p.x - n.nx * pitSide * 28, y = p.y - n.ny * pitSide * 28, z = 58;
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
    if (t < 1.4) c = top;
    else if (t < 3.4) c = blend(top, low, ease(t, 1.4, 3.4));
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
    const dpr = window.devicePixelRatio || 1;
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
    ctx.fillStyle = '#4f7d3a';
    ctx.fillRect(0, 0, W, H);
    if (horizon > -40) {
      const g = ctx.createLinearGradient(0, horizon - 220, 0, horizon);
      g.addColorStop(0, rgb([92, 140, 196])); g.addColorStop(1, rgb(SKY));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, horizon));
      const g2 = ctx.createLinearGradient(0, horizon, 0, horizon + 160);
      g2.addColorStop(0, rgb(HAZE)); g2.addColorStop(1, 'rgba(79,125,58,0)');
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
    // Breiter, hellerer Grasstreifen entlang der Strecke
    ribbon(-HALF_W - 30, HALF_W + 30, 0, this.tr.L, (i, dep) => fogged(i % 6 < 3 ? [92, 142, 66] : [86, 134, 61], dep));
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
    objs.sort((a, b) => b.dep - a.dep);
    for (const o of objs) o.draw();

    // Übersicht am Anfang: leuchtender Umriss wie auf der Startseite, blendet aus
    const outline = 1 - ease(t, 0.9, 2.3);
    if (outline > 0) {
      ctx.fillStyle = `rgba(6,9,13,${outline * 0.92})`;
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      let first = true;
      for (const p of pts) { const q = P(p.x, p.y); if (!q) continue; first ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); first = false; }
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.globalAlpha = outline;
      ctx.shadowColor = 'rgba(250,204,21,.45)'; ctx.shadowBlur = 18;
      ctx.strokeStyle = '#3a4352'; ctx.lineWidth = 9; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#f1f4f8'; ctx.lineWidth = 3; ctx.stroke();
      const s = P(pts[0].x, pts[0].y);
      if (s) { ctx.fillStyle = '#ef4444'; ctx.fillRect(s[0] - 5, s[1] - 5, 10, 10); }
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
    const tOut = ease(t, 14.8, 15.4);
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
    // Abschluss
    const endK = ease(t, 15.4, 16) * (1 - ease(t, INTRO_DUR - 0.5, INTRO_DUR - 0.1));
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
