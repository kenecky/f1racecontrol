// Streckenkarte (Canvas): Strecke, Boxengasse, Marshal-Sektoren, Flaggen,
// Gefahrenstellen, Autos. Zoom (Zwei-Finger / Mausrad) und Verschieben nur hier.
import { pointAt, wrapD, sectorIndexAt } from '../sim/trackModel.js';
import { drawTrackArt } from './trackArt.js';

const PIT_OFFSET_PX = 9;
const MAX_ZOOM = 6;
const FLAG_COLORS = { yellow: '#ffd12e', double: '#ffd12e' };

export class TrackMap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.selected = null;
    this.showLabels = false;
    this.showSectors = false;
    this.highlightSector = null;
    this.zoom = 1;
    this.paused = false;
    this.anim = 0;          // Animationsuhr, steht bei Pause still
    this.lastDraw = null;
    this.panX = 0;
    this.panY = 0;
    this.bg = document.createElement('canvas');
    this.bgDirty = true;
    this.onSelectCar = null;
    this.onSelectSector = null;
    this.onZoomChange = null;
    this.pointers = new Map();
    this.setupInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // ---------- Größe & Ansicht ----------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Größe geändert (z. B. Bereich unten ein-/ausgeklappt): komplett herauszoomen
    if (this.w && (Math.abs(rect.width - this.w) > 1 || Math.abs(rect.height - this.h) > 1)) {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      if (this.onZoomChange) this.onZoomChange(1);
    }
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
    for (const c of [this.canvas, this.bg]) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const tr = this.track;
    const pad = 34;    // Rand: Gras und Auslaufzonen ragen über die Mittellinie hinaus
    const padTop = 76; // Platz für Einblendungen (Vorfälle, VSC, SC …)
    const padL = this.padLeft ? this.padLeft + 40 : pad; // Platz für den Ranking-Tower
    const bounds = rot => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < tr.N; i++) {
        const [x, y] = rot ? [tr.ys[i], -tr.xs[i]] : [tr.xs[i], tr.ys[i]];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const s = Math.min((this.w - padL - pad) / (maxX - minX), (this.h - padTop - pad) / (maxY - minY));
      return { minX, minY, maxX, maxY, s };
    };
    // Hohe, schmale Karte (z. B. eingeklappter Bereich): Strecke um 90° drehen, wenn sie dadurch deutlich größer wird
    const normal = bounds(false), rotated = bounds(true);
    this.rot = rotated.s > normal.s * 1.2;
    const { minX, minY, maxX, maxY, s } = this.rot ? rotated : normal;
    this.scale = s;
    this.ox = padL + (this.w - padL - pad - (maxX - minX) * s) / 2 - minX * s;
    this.oy = padTop + (this.h - padTop - pad - (maxY - minY) * s) / 2 - minY * s;
    // Mittelpunkt in Streckenkoordinaten (ungedreht)
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
    [this.cx, this.cy] = this.rot ? [-my, mx] : [mx, my];
    this.clampPan();
    this.bgDirty = true;
  }

  setTrack(track) {
    if (this.track === track) return;
    this.track = track;
    this.w = 0;           // erzwingt Neuberechnung
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.resize();
  }

  setPadLeft(px) {
    if (this.padLeft === px) return;
    this.padLeft = px;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    if (this.onZoomChange) this.onZoomChange(1);
    this.resize();
  }

  setView(zoom, panX, panY) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
    this.panX = panX;
    this.panY = panY;
    this.clampPan();
    this.bgDirty = true;
    if (this.onZoomChange) this.onZoomChange(this.zoom);
  }

  resetView() {
    this.setView(1, 0, 0);
  }

  zoomAt(factor, sx, sy) {
    const z0 = this.zoom;
    const z1 = Math.min(MAX_ZOOM, Math.max(1, z0 * factor));
    // Punkt unter dem Finger bleibt an Ort und Stelle
    const bx = (sx - this.panX) / z0, by = (sy - this.panY) / z0;
    this.setView(z1, sx - bx * z1, sy - by * z1);
  }

  clampPan() {
    const z = this.zoom;
    this.panX = Math.min(0, Math.max(this.w - this.w * z, this.panX));
    this.panY = Math.min(0, Math.max(this.h - this.h * z, this.panY));
  }

  toPx([x, y]) {
    if (this.rot) [x, y] = [y, -x];
    return [(this.ox + x * this.scale) * this.zoom + this.panX, (this.oy + y * this.scale) * this.zoom + this.panY];
  }

  pos(d, lateralPx = 0) {
    return this.toPx(pointAt(this.track, d, lateralPx / (this.scale * this.zoom)));
  }

  widthScale() {
    return 1 + (this.zoom - 1) * 0.35;
  }

  // ---------- Eingabe ----------

  setupInput() {
    const c = this.canvas;
    const local = e => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      this.pointers.set(e.pointerId, { x, y, sx: x, sy: y });
      if (this.pointers.size === 1) this.tapCandidate = { x, y, t: performance.now() };
      else this.tapCandidate = null;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      }
    });
    c.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const [x, y] = local(e);
      const dx = x - p.x, dy = y - p.y;
      p.x = x; p.y = y;
      if (this.tapCandidate && Math.hypot(x - this.tapCandidate.x, y - this.tapCandidate.y) > 8) this.tapCandidate = null;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const target = this.pinch.zoom * (dist / this.pinch.dist);
        this.zoomAt(target / this.zoom, mx, my);
        // Verschieben mit zwei Fingern
        this.setView(this.zoom, this.panX + dx / 2, this.panY + dy / 2);
      } else if (this.pointers.size === 1 && this.zoom > 1 && !this.tapCandidate) {
        this.setView(this.zoom, this.panX + dx, this.panY + dy);
      }
    });
    const end = e => {
      const tap = this.tapCandidate && this.pointers.size === 1 && performance.now() - this.tapCandidate.t < 500;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (tap && e.type === 'pointerup') this.handleTap(this.tapCandidate.x, this.tapCandidate.y);
      this.tapCandidate = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = local(e);
      this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, x, y);
    }, { passive: false });
    c.addEventListener('dblclick', e => {
      e.preventDefault();
      const [x, y] = local(e);
      if (this.zoom > 1.5) this.resetView();
      else this.zoomAt(2.5, x, y);
    });
  }

  handleTap(x, y) {
    // 1) Auto in der Nähe?
    let best = null, bd = 18 * 18;
    for (const h of this.hit || []) {
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    if (best) {
      if (this.onSelectCar) this.onSelectCar(best.id);
      return;
    }
    // 2) Streckenabschnitt → Marshal-Sektor
    const tr = this.track;
    let bestD = null, bestDist = 28 * 28;
    for (let i = 0; i < tr.N; i += 2) {
      const [px, py] = this.toPx([tr.xs[i], tr.ys[i]]);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestDist) { bestDist = d; bestD = i * tr.ds; }
    }
    if (bestD !== null && this.onSelectSector) this.onSelectSector(sectorIndexAt(tr, bestD));
    else if (this.onSelectCar) this.onSelectCar(null);
  }

  // ---------- Zeichnen ----------

  tracePath(ctx, from, to, lat = 0) {
    const steps = Math.max(2, Math.round((to - from) / 5));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const [x, y] = this.pos(from + (to - from) * (i / steps), lat);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
  }

  drawBackground() {
    const ctx = this.bg.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    drawTrackArt(this, ctx, { pitOffsetPx: PIT_OFFSET_PX });
    this.bgDirty = false;
  }

  drawSectorOverlay(ctx, race) {
    const tr = this.track;
    const ws = this.widthScale();
    const t = performance.now() / 1000;
    tr.sectors.forEach((sec, i) => {
      const flag = race ? race.flags[i] : 'clear';
      const hl = this.highlightSector === i;
      if (flag === 'clear' && !hl) return;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      if (hl) {
        this.tracePath(ctx, sec.start, sec.end);
        ctx.strokeStyle = 'rgba(61,139,255,0.55)';
        ctx.lineWidth = 15 * ws;
        ctx.stroke();
      }
      if (flag === 'yellow' || flag === 'double') {
        this.tracePath(ctx, sec.start, sec.end);
        ctx.strokeStyle = FLAG_COLORS[flag];
        ctx.globalAlpha = flag === 'double' ? 0.65 + 0.35 * Math.sin(t * 6) : 0.9;
        ctx.lineWidth = (flag === 'double' ? 7.5 : 5) * ws;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (flag === 'double') {
          ctx.strokeStyle = '#1b2029';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (flag === 'slippery') {
        this.tracePath(ctx, sec.start, sec.end);
        ctx.lineWidth = 5 * ws;
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = '#ffd12e';
        ctx.stroke();
        ctx.lineDashOffset = 6;
        ctx.strokeStyle = '#e10600';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    });

    if (this.showSectors) {
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      tr.sectors.forEach(sec => {
        const mid = (sec.start + sec.end) / 2;
        const p = pointAt(tr, mid);
        const [px, py] = this.toPx(p);
        const [qx, qy] = this.toPx([this.cx, this.cy]);
        const dx = px - qx, dy = py - qy;
        const len = Math.hypot(dx, dy) || 1;
        const x = px - (dx / len) * 16 * ws, y = py - (dy / len) * 16 * ws;
        ctx.fillStyle = 'rgba(61,139,255,0.9)';
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(String(sec.id), x, y + 0.5);
      });
    }
  }

  drawHazards(ctx, race) {
    const t = performance.now() / 1000;
    for (const h of race.hazards) {
      if (h.ended || h.global) continue;
      const [x, y] = this.pos(h.d, 0);
      const s = 9 + Math.sin(t * 5) * 1.2;
      const ty = y - 14;
      ctx.beginPath();
      ctx.moveTo(x, ty - s);
      ctx.lineTo(x + s, ty + s * 0.75);
      ctx.lineTo(x - s, ty + s * 0.75);
      ctx.closePath();
      ctx.fillStyle = '#ffd12e';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = '900 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', x, ty + 2);
    }
  }

  carLateral(race, car) {
    const ws = this.widthScale();
    if (car.offTrack) return car.offTrack.lateral * ws;
    if (car.inPit || car.stopTimer > 0) return this.track.pit.side * PIT_OFFSET_PX * ws;
    let lat = 0;
    if (car.lap === 0 && car.d < 120) {
      const side = car.gridPos % 2 === 1 ? -1 : 1;
      lat = side * 4 * Math.min(1, Math.max(0, (120 - car.d) / 120));
    }
    if (car.pass) {
      const target = race.carById[car.pass.target];
      const gap = Math.abs(wrapD(race.track, target.d - car.d));
      const g = Math.min(gap, race.track.L - gap);
      if (g < 40) lat -= (car.pass.blue ? 4 : 5) * (1 - g / 40);
    }
    return lat * ws;
  }

  draw(race, renderD) {
    const now = performance.now();
    if (!this.paused && this.lastDraw !== null) this.anim += Math.min(0.25, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    if (this.bgDirty) this.drawBackground();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSectorOverlay(ctx, race);
    if (!race) return;
    this.drawWeather(ctx, race);
    this.drawNeutral(ctx, race);

    // Liegengebliebene Autos
    for (const car of race.cars) {
      if (!car.wreck || car.wreck.removed) continue;
      const [x, y] = this.pos(car.wreck.d, car.wreck.lateral * this.widthScale());
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = car.team.color;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    this.drawHazards(ctx, race);

    const standings = race.standings();
    const posOf = new Map(standings.map((c, i) => [c, i + 1]));
    this.hit = [];
    for (const car of [...standings].reverse()) {
      if (car.retired) {
        if (car.wreck && !car.wreck.removed) {
          const [x, y] = this.pos(car.wreck.d, car.wreck.lateral * this.widthScale());
          this.hit.push({ id: car.id, x, y });
          if (this.selected === car.id) this.drawLabel(ctx, x, y, `${car.id} – Ausfall`, true);
        }
        continue;
      }
      const d = renderD.get(car) ?? car.d;
      const [x, y] = this.pos(d, this.carLateral(race, car));
      const sel = this.selected === car.id;
      const r = (sel ? 6.5 : 5) * Math.min(1.4, this.widthScale());
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.team.color;
      ctx.fill();
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeStyle = sel ? '#fff' : car.offTrack ? '#ffd12e' : '#0b0f17';
      ctx.stroke();
      this.hit.push({ id: car.id, x, y });

      const pos = posOf.get(car);
      if (sel || this.showLabels || pos === 1 || this.zoom >= 2.5) {
        const label = sel || pos === 1 ? `${pos} ${car.id}` : car.id;
        this.drawLabel(ctx, x, y, label, sel);
      }
    }
    this.drawSafetyCar(ctx, race);
  }

  // Nasse Strecke (Glanz) und Regen
  drawWeather(ctx, race) {
    const wx = race.weather;
    if (!wx || (wx.wetness < 0.05 && wx.rain < 0.03)) return;
    const ws = this.widthScale();
    if (wx.wetness >= 0.05) {
      this.tracePath(ctx, 0, this.track.L);
      ctx.closePath();
      ctx.strokeStyle = `rgba(120, 165, 225, ${0.28 * wx.wetness})`;
      ctx.lineWidth = 7 * ws;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    if (wx.rain >= 0.03) {
      const n = Math.round(160 * wx.rain);
      const t = this.anim;
      ctx.strokeStyle = `rgba(190, 210, 240, ${0.18 + 0.25 * wx.rain})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sx = (i * 137.5) % this.w;
        const speed = 220 + (i % 7) * 30;
        const y = ((i * 89.3) + t * speed) % (this.h + 20) - 10;
        const x = (sx + y * 0.25) % this.w;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2.5, y - 9);
      }
      ctx.stroke();
    }
  }

  // VSC / SC: gelb gestrichelte Strecke, Rot: rote Strecke
  drawNeutral(ctx, race) {
    const n = race.neutral;
    if (!n) return;
    const ws = this.widthScale();
    this.tracePath(ctx, 0, this.track.L);
    ctx.closePath();
    ctx.lineWidth = 3 * ws;
    ctx.lineCap = 'butt';
    if (n.type === 'red') {
      ctx.strokeStyle = 'rgba(225, 6, 0, 0.85)';
      ctx.stroke();
    } else {
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -(this.anim * 25) % 18;
      ctx.strokeStyle = n.type === 'sc' ? 'rgba(255, 154, 31, 0.9)' : 'rgba(255, 209, 46, 0.85)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  drawSafetyCar(ctx, race) {
    const sc = race.sc;
    if (!sc) return;
    const lat = sc.inPit ? this.track.pit.side * PIT_OFFSET_PX * this.widthScale() : 0;
    const [x, y] = this.pos(sc.d, lat);
    const w = 22, h = 13;
    ctx.fillStyle = '#ff9a1f';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = '900 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SC', x, y + 0.5);
  }

  drawLabel(ctx, x, y, label, sel) {
    ctx.font = `${sel ? 700 : 600} 10px system-ui, sans-serif`;
    const w = ctx.measureText(label).width + 8;
    // am rechten Rand nach links ausweichen
    const lx = x + 8 + w > this.w - 4 ? x - 8 - w : x + 8;
    const ly = y - 16;
    ctx.fillStyle = sel ? '#fff' : 'rgba(11,15,23,0.85)';
    ctx.fillRect(lx, ly, w, 14);
    ctx.fillStyle = sel ? '#0b0f17' : '#e6e9ef';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 4, ly + 7.5);
  }
}
