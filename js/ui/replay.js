// Wiederholung des ganzen Rennens: Aufzeichnung alle 2 s Rennzeit und Wiedergabe im Vollbild
// mit Zeitleiste, Markierungen (Vorfälle, Fälle, VSC/SC/Rot, Führungswechsel) und Ranking.
import { TrackMap, PIT_OFFSET_PX } from './map.js';

export const REC_STEP = 2;          // Sekunden Rennzeit zwischen zwei Aufnahmen
const FLAG_CODE = { clear: 'c', yellow: 'y', double: 'd', slippery: 's' };
const FLAG_NAME = { c: 'clear', y: 'yellow', d: 'double', s: 'slippery' };
const NEUTRAL_CODE = { vsc: 'v', sc: 's', red: 'r' };
const NEUTRAL_NAME = { v: 'vsc', s: 'sc', r: 'red' };
const SPEEDS = [4, 16, 32, 64];

// ---------- Aufzeichnung ----------

export class Recorder {
  constructor(race, prev = null) {
    this.key = `${race.seed}-${race.startedAt}`;
    if (prev && prev.key === this.key) {
      this.data = prev;
    } else {
      this.data = {
        v: 1, key: this.key, trackId: race.track.def.id, gp: race.track.def.grandPrix, kind: race.kind,
        laps: race.laps, date: new Date().toISOString(),
        cars: race.cars.map(c => ({ id: c.id, c: c.team.color, team: c.team.short || c.team.name, n: c.driver.number })),
        frames: [], marks: [], done: false,
      };
    }
    const last = this.data.frames[this.data.frames.length - 1];
    this.next = last ? last.t + REC_STEP : 0;
    this.dirty = false;
  }

  tick(race) {
    if (this.data.done) return;
    const running = race.phase === 'running' || race.phase === 'chequered'
      || (race.neutral && race.neutral.restart && race.time > 0);
    if (!running && race.phase !== 'finished') return;
    if (race.phase === 'finished') { this.capture(race); this.finish(race); return; }
    if (race.time + 1e-6 < this.next) return;
    this.capture(race);
    this.next = race.time + REC_STEP;
  }

  capture(race) {
    const idx = new Map(race.cars.map((c, i) => [c, i]));
    const d = [], l = [], s = [];
    for (const c of race.cars) {
      let st = 0, pos = c.d;
      if (c.retired && !c.finished) {
        const w = c.wreck && !c.wreck.removed;
        st = w ? 2 : 3;
        if (w) pos = c.wreck.d;
      } else if (c.finished) st = 4;
      else if (c.inPit || c.stopTimer > 0 || c.inGarage) st = 1;
      else if (c.offTrack) st = 5;
      d.push(Math.round(pos));
      l.push(c.lap);
      s.push(st);
    }
    const n = race.neutral;
    this.data.frames.push({
      t: Math.round(race.time * 10) / 10,
      f: race.flags.map(x => FLAG_CODE[x] || 'c').join(''),
      n: n ? NEUTRAL_CODE[n.type] || '' : '',
      sc: race.sc ? [Math.round(race.sc.d), race.sc.inPit ? 1 : 0] : null,
      o: race.standings().map(c => idx.get(c)),
      d, l, s,
    });
    this.dirty = true;
  }

  // Rennende: Markierungen für die Zeitleiste
  finish(race) {
    const data = this.data;
    data.done = true;
    const marks = [];
    for (const h of race.hazards) {
      if (h.type === 'spin' && !h.carId) continue;
      marks.push({ t: h.start, kind: h.need === 'red' ? 'red' : h.need === 'sc' ? 'sc' : h.need === 'vsc' ? 'vsc' : 'haz',
        text: `${h.global ? 'Gesamte Strecke' : `Sektor ${h.sector + 1}`}: ${h.desc || h.type}` });
    }
    for (const c of race.cases) {
      if (!c.time && c.lap === 0) continue;
      marks.push({ t: c.time, kind: 'case', text: `DOC ${c.id}: ${c.title}` });
    }
    const F = data.frames;
    for (let i = 1; i < F.length; i++) {
      if (F[i].n !== F[i - 1].n && F[i].n) marks.push({ t: F[i].t, kind: F[i].n === 'r' ? 'red' : F[i].n === 's' ? 'sc' : 'vsc', text: F[i].n === 'r' ? 'ROTE FLAGGE' : F[i].n === 's' ? 'SAFETY CAR' : 'VIRTUAL SAFETY CAR' });
      if (F[i].o[0] !== F[i - 1].o[0] && F[i].s[F[i].o[0]] !== 4) marks.push({ t: F[i].t, kind: 'lead', text: `Führungswechsel: ${data.cars[F[i].o[0]].id} übernimmt von ${data.cars[F[i - 1].o[0]].id}` });
    }
    const fin = F.findIndex(fr => fr.s.includes(4));
    if (fin >= 0) marks.push({ t: F[fin].t, kind: 'flag', text: `Zielflagge – Sieger ${data.cars[F[fin].o[0]].id}` });
    marks.sort((a, b) => a.t - b.t);
    data.marks = marks;
    this.dirty = true;
  }
}

// ---------- Wiedergabe ----------

const fmt = t => {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const MARK_ICON = { haz: '⚠', vsc: 'VSC', sc: 'SC', red: '🟥', case: '⚖', lead: '▲', flag: '🏁' };

export class ReplayViewer {
  constructor(root, { onClose } = {}) {
    this.root = root;
    this.onClose = onClose;
    this.$ = sel => root.querySelector(sel);
    this.speed = 16;
    this.playing = false;
    this.t = 0;
    this.map = null;
    this.follow = null;
    this.$('#rpClose').addEventListener('click', () => this.close());
    this.$('#rpPlay').addEventListener('click', () => { if (this.t >= this.T) this.t = 0; this.playing = !this.playing; this.updateCtl(); });
    this.$('#rpSpeeds').addEventListener('click', e => {
      const b = e.target.closest('[data-sp]');
      if (!b) return;
      this.speed = Number(b.dataset.sp);
      this.updateCtl();
    });
    const slider = this.$('#rpSlider');
    slider.addEventListener('input', () => { this.t = (Number(slider.value) / 1000) * this.T; this.renderSide(true); });
    const jump = e => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      this.t = Math.max(0, Number(b.dataset.t) - 6);
      if (b.dataset.car) this.setFollow(b.dataset.car);
      this.renderSide(true);
    };
    this.$('#rpMarks').addEventListener('click', jump);
    this.$('#rpEvents').addEventListener('click', jump);
    this.$('#rpTower').addEventListener('click', e => {
      const r = e.target.closest('[data-car]');
      if (r) this.setFollow(this.follow === r.dataset.car ? null : r.dataset.car);
    });
    this.loop = this.loop.bind(this);
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }

  open(data, track) {
    this.data = data;
    this.track = track;
    const F = data.frames;
    this.T = F.length ? F[F.length - 1].t : 0;
    this.t = 0;
    this.follow = null;
    this.lastTower = '';
    this.lastEv = -2;
    this.root.classList.remove('hidden');
    this.$('#rpTitle').textContent = `${data.gp.replace('Großer Preis von ', 'GP ')}${data.kind === 'sprint' ? ' · Sprint' : ''}`;
    if (!this.map) {
      this.map = new TrackMap(this.$('#rpCanvas'), track);
      this.map.onSelectSector = null;
      this.map.onSelectCar = id => this.setFollow(id);
    } else this.map.setTrack(track);
    this.map.setPadLeft(this.$('#rpTower').offsetWidth || 96);
    this.map.resetView();
    this.renderMarks();
    this.playing = true;
    this.updateCtl();
    this.lastNow = null;
    requestAnimationFrame(this.loop);
  }

  close() {
    this.playing = false;
    this.root.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  setFollow(id) {
    this.follow = id || null;
    if (this.follow) {
      this.map.zoom = Math.max(this.map.zoom, 3.2);
      this.map.selected = id;
    } else {
      this.map.selected = null;
      this.map.resetView();
    }
    this.lastTower = '';
  }

  updateCtl() {
    this.$('#rpPlay').textContent = this.playing ? '❚❚' : '▶';
    for (const b of this.$('#rpSpeeds').children) b.classList.toggle('on', Number(b.dataset.sp) === this.speed);
  }

  renderMarks() {
    const T = this.T || 1;
    const F = this.data.frames;
    // Neutralisierungen als Bänder
    let bands = '';
    let start = null, type = '';
    for (let i = 0; i <= F.length; i++) {
      const n = i < F.length ? F[i].n : '';
      if (n !== type) {
        if (type && start !== null) bands += `<i class="rp-band rp-${NEUTRAL_NAME[type]}" style="left:${(start / T) * 100}%;width:${Math.max(0.4, ((F[Math.min(i, F.length - 1)].t - start) / T) * 100)}%"></i>`;
        type = n;
        start = i < F.length ? F[i].t : null;
      }
    }
    const marks = this.data.marks.filter(m => m.kind !== 'lead' || true).map(m =>
      `<b class="rp-mk rp-mk-${m.kind}" data-t="${m.t}" style="left:${(m.t / T) * 100}%" title="${m.text.replace(/"/g, '')}"></b>`).join('');
    this.$('#rpMarks').innerHTML = bands + marks;
    this.$('#rpEvents').innerHTML = this.data.marks.length
      ? this.data.marks.map((m, i) => `<button class="rp-ev rp-ev-${m.kind}" data-t="${m.t}" data-i="${i}"><span>${fmt(m.t)}</span><em>${MARK_ICON[m.kind] || '•'}</em><span>${m.text}</span></button>`).join('')
      : '<div class="ctl-small">Keine Ereignisse aufgezeichnet.</div>';
  }

  frameAt(t) {
    const F = this.data.frames;
    let lo = 0, hi = F.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  loop(now) {
    if (!this.isOpen) return;
    const dt = this.lastNow === null ? 0 : Math.min(0.25, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.T) { this.t = this.T; this.playing = false; this.updateCtl(); }
    }
    this.draw();
    this.renderSide(false);
    requestAnimationFrame(this.loop);
  }

  // Position eines Autos zur Zeit t (zwischen zwei Aufnahmen weich interpoliert)
  carState(i, a, b, k) {
    const L = this.track.L;
    const sa = a.s[i], sb = b.s[i];
    let d = a.d[i];
    if (sa === sb && (sa === 0 || sa === 1 || sa === 5 || sa === 4)) {
      let db = b.d[i];
      if (db < d - L / 2) db += L;
      if (db - d < 400) d += (db - d) * k;
    }
    return { d: ((d % L) + L) % L, st: k > 0.5 ? sb : sa };
  }

  draw() {
    const F = this.data.frames;
    if (!F.length || !this.map || !this.map.w) return;
    const i = this.frameAt(this.t);
    const a = F[i], b = F[Math.min(F.length - 1, i + 1)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (this.t - a.t) / (b.t - a.t))) : 0;
    const m = this.map;
    const ws = m.widthScale();
    const latOf = st => (st === 1 ? this.track.pit.side * PIT_OFFSET_PX * ws : st === 5 ? 11 * ws : st === 2 ? 12 * ws : 0);
    const cars = this.data.cars.map((c, idx) => ({ c, idx, ...this.carState(idx, a, b, k) }));
    if (this.follow) {
      const f = cars.find(x => x.c.id === this.follow);
      if (f && f.st !== 3) m.centerOn(f.d, latOf(f.st));
    }
    m.draw(null, new Map());
    const ctx = m.ctx;
    m.drawSectorOverlay(ctx, { flags: [...a.f].map(x => FLAG_NAME[x]) });
    if (a.n) m.drawNeutral(ctx, { neutral: { type: NEUTRAL_NAME[a.n] } });
    m.hit = [];
    const posOf = new Map(a.o.map((idx, p) => [idx, p + 1]));
    for (const x of [...cars].sort((p, q) => (posOf.get(q.idx) || 99) - (posOf.get(p.idx) || 99))) {
      if (x.st === 3) continue;
      const [px, py] = m.pos(x.d, latOf(x.st));
      const sel = this.follow === x.c.id;
      const r = (sel ? 6.5 : 5) * Math.min(1.4, ws);
      ctx.globalAlpha = x.st === 2 ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = x.c.c;
      ctx.fill();
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeStyle = sel ? '#fff' : x.st === 2 ? '#ff5a5a' : x.st === 5 ? '#ffd12e' : '#0b0f17';
      ctx.stroke();
      ctx.globalAlpha = 1;
      m.hit.push({ id: x.c.id, x: px, y: py });
      const pos = posOf.get(x.idx);
      if (sel || pos === 1 || m.zoom >= 2.5) m.drawLabel(ctx, px, py, sel || pos === 1 ? `${pos} ${x.c.id}` : x.c.id, sel);
    }
    if (a.sc) m.drawSafetyCar(ctx, { sc: { d: a.sc[0], inPit: Boolean(a.sc[1]) } });
  }

  renderSide(force) {
    const F = this.data.frames;
    if (!F.length) return;
    const i = this.frameAt(this.t);
    const fr = F[i];
    const slider = this.$('#rpSlider');
    if (document.activeElement !== slider) slider.value = String(Math.round((this.t / (this.T || 1)) * 1000));
    const lead = fr.o[0];
    const lap = Math.min(this.data.laps, fr.l[lead] + (fr.s[lead] === 4 ? 0 : 1));
    const status = fr.n ? { v: ' · VSC', s: ' · SAFETY CAR', r: ' · ROTE FLAGGE' }[fr.n] : fr.f.includes('d') ? ' · DOPPELT GELB' : fr.f.includes('y') ? ' · GELB' : '';
    this.$('#rpTime').textContent = `RD ${lap}/${this.data.laps} · ${fmt(this.t)}`;
    this.$('#rpInfo').textContent = status.replace(' · ', '');
    this.$('#rpInfo').className = `rp-info${fr.n ? ` rp-${NEUTRAL_NAME[fr.n]}` : status ? ' rp-yellow' : ''}`;
    // Ranking zum Zeitpunkt
    const sig = `${i}|${this.follow}`;
    if (force || sig !== this.lastTower) {
      this.lastTower = sig;
      this.$('#rpTower').innerHTML = fr.o.map((idx, p) => {
        const c = this.data.cars[idx];
        const st = fr.s[idx];
        const tag = st === 1 ? 'PIT' : st === 2 || st === 3 ? 'OUT' : st === 4 ? '🏁' : '';
        return `<button class="rp-row${this.follow === c.id ? ' sel' : ''}${st === 2 || st === 3 ? ' out' : ''}" data-car="${c.id}"><span>${st === 2 || st === 3 ? '–' : p + 1}</span><i style="background:${c.c}"></i><b>${c.id}</b><em>${tag}</em></button>`;
      }).join('');
    }
    // aktuelles Ereignis in der Liste hervorheben
    let cur = -1;
    this.data.marks.forEach((m, j) => { if (m.t <= this.t + 0.5) cur = j; });
    if (cur !== this.lastEv) {
      this.lastEv = cur;
      for (const el of this.$('#rpEvents').children) el.classList.toggle('now', Number(el.dataset.i) === cur);
      const el = this.$(`#rpEvents [data-i="${cur}"]`);
      if (el && this.playing) el.scrollIntoView({ block: 'nearest' });
    }
  }
}
