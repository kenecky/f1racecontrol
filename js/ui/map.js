// Streckenkarte (Canvas): Strecke, Boxengasse, Kurven, Autos.
import { pointAt, wrapD } from '../sim/trackModel.js';

const PIT_OFFSET_PX = 9;

export class TrackMap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.selected = null;
    this.showLabels = false;
    this.bg = document.createElement('canvas');
    this.onSelect = null;
    canvas.addEventListener('click', e => this.handleClick(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
    for (const c of [this.canvas, this.bg]) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const tr = this.track;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < tr.N; i++) {
      minX = Math.min(minX, tr.xs[i]); maxX = Math.max(maxX, tr.xs[i]);
      minY = Math.min(minY, tr.ys[i]); maxY = Math.max(maxY, tr.ys[i]);
    }
    const pad = 22;
    const s = Math.min((this.w - 2 * pad) / (maxX - minX), (this.h - 2 * pad) / (maxY - minY));
    this.scale = s;
    this.ox = (this.w - (maxX - minX) * s) / 2 - minX * s;
    this.oy = (this.h - (maxY - minY) * s) / 2 - minY * s;
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.drawBackground();
  }

  toPx([x, y]) {
    return [this.ox + x * this.scale, this.oy + y * this.scale];
  }

  pos(d, lateralPx = 0) {
    return this.toPx(pointAt(this.track, d, lateralPx / this.scale));
  }

  drawBackground() {
    const tr = this.track;
    const ctx = this.bg.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const path = (from, to, lat = 0) => {
      ctx.beginPath();
      const steps = Math.max(2, Math.round((to - from) / 5));
      for (let i = 0; i <= steps; i++) {
        const [x, y] = this.pos(from + (to - from) * (i / steps), lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    };

    // Boxengasse
    const pitSide = tr.pit.side * PIT_OFFSET_PX;
    const pitTo = tr.pit.exit + tr.L;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2a3140';
    ctx.lineWidth = 4;
    path(tr.pit.entry, pitTo, pitSide);
    ctx.stroke();

    // Strecke
    path(0, tr.L);
    ctx.closePath();
    ctx.strokeStyle = '#3a4252';
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = '#1b2029';
    ctx.lineWidth = 7.5;
    ctx.stroke();

    // Start/Ziel
    const [ax, ay] = this.pos(0, -7);
    const [bx, by] = this.pos(0, 7);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    // Kurvennummern
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = '#7d8799';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of tr.corners) {
      const p = pointAt(tr, c.d);
      let dx = p[0] - this.cx, dy = p[1] - this.cy;
      const len = Math.hypot(dx, dy) || 1;
      const [px, py] = this.toPx(p);
      ctx.fillText(c.id.replace('T', ''), px + (dx / len) * 15, py + (dy / len) * 15);
    }
  }

  carLateral(race, car) {
    // Startaufstellung versetzt, Überholmanöver nebeneinander
    let lat = 0;
    if (car.lap === 0 && car.d < 120) {
      const side = car.gridPos % 2 === 1 ? -1 : 1;
      lat = side * 4 * Math.min(1, Math.max(0, (120 - car.d) / 120));
    }
    if (car.pass) {
      const target = race.carById[car.pass.target];
      const gap = Math.abs(wrapD(race.track, target.d - car.d));
      const g = Math.min(gap, race.track.L - gap);
      if (g < 40) lat += (car.pass.blue ? 4 : 5) * (1 - g / 40) * -1;
    }
    return lat;
  }

  draw(race, renderD) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!race) return;

    const standings = race.standings();
    const posOf = new Map(standings.map((c, i) => [c, i + 1]));
    this.hit = [];
    for (const car of [...standings].reverse()) {
      if (car.retired) continue;
      const d = renderD.get(car) ?? car.d;
      const lat = car.inPit || car.stopTimer > 0 ? this.track.pit.side * PIT_OFFSET_PX : this.carLateral(race, car);
      const [x, y] = this.pos(d, lat);
      const sel = this.selected === car.id;
      const r = sel ? 6.5 : 5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.team.color;
      ctx.fill();
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeStyle = sel ? '#fff' : '#0b0f17';
      ctx.stroke();
      this.hit.push({ id: car.id, x, y });

      const pos = posOf.get(car);
      if (sel || this.showLabels || pos === 1) {
        const label = this.showLabels && !sel ? car.id : `${pos} ${car.id}`;
        ctx.font = `${sel ? 700 : 600} 10px system-ui, sans-serif`;
        const w = ctx.measureText(label).width + 8;
        const lx = x + 8, ly = y - 16;
        ctx.fillStyle = sel ? '#fff' : 'rgba(11,15,23,0.85)';
        ctx.fillRect(lx, ly, w, 14);
        ctx.fillStyle = sel ? '#0b0f17' : '#e6e9ef';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 4, ly + 7.5);
      }
    }
  }

  handleClick(e) {
    if (!this.hit) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bd = 22 * 22;
    for (const h of this.hit) {
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    if (this.onSelect) this.onSelect(best ? best.id : null);
  }
}
