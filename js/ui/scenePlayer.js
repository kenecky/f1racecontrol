// Wiedergabe der Rennszenen (Draufsicht) in der Entscheidungskarte, im Vollbild und auf der Karte.
import { pointAt, wrapD } from '../sim/trackModel.js';
import { sceneCarAt, CAR_LEN, HALF_W } from '../sim/scenes.js';

const UNIT = CAR_LEN / 63;   // Zeichen-Einheiten des Autos → Meter

// ---------- Fahrzeug (Variante C: TV-Grafik) ----------
function wheel(ctx, x, y, w, h) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 2); ctx.fill(); }
function body(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -30); ctx.lineTo(3, -20); ctx.lineTo(4, -8);
  ctx.lineTo(10, -4); ctx.lineTo(11, 10); ctx.lineTo(7, 18); ctx.lineTo(5, 24);
  ctx.lineTo(-5, 24); ctx.lineTo(-7, 18); ctx.lineTo(-11, 10); ctx.lineTo(-10, -4); ctx.lineTo(-4, -8); ctx.lineTo(-3, -20); ctx.closePath();
}
// Auto zeigt in Fahrtrichtung nach oben (−y); Länge ≈ 63 Einheiten
export function drawCar(ctx, c1, c2, num, { shadow = true, numbers = true } = {}) {
  if (shadow) { ctx.save(); ctx.translate(2.5, 3); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; body(ctx); ctx.fill(); ctx.fillRect(-15, -32, 30, 5); ctx.fillRect(-12, 24, 24, 6); ctx.restore(); }
  wheel(ctx, -11.5, -16, 5.5, 9.5); wheel(ctx, 11.5, -16, 5.5, 9.5); wheel(ctx, -12, 16, 6.5, 11); wheel(ctx, 12, 16, 6.5, 11);
  ctx.fillStyle = '#555'; ctx.fillRect(-11, -16.6, 22, 1.2); ctx.fillRect(-11, 15.4, 22, 1.2);
  ctx.fillStyle = c1; ctx.fillRect(-15, -33, 30, 4);
  ctx.fillStyle = c2; ctx.fillRect(-15, -33, 3, 5); ctx.fillRect(12, -33, 3, 5);
  ctx.fillStyle = c1; ctx.fillRect(-12, 24, 24, 5);
  body(ctx); ctx.fillStyle = c1; ctx.fill();
  ctx.save(); body(ctx); ctx.clip();
  ctx.fillStyle = c2; ctx.fillRect(-1.6, -30, 3.2, 60);
  const g = ctx.createLinearGradient(-11, 0, 11, 0);
  g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = g; ctx.fillRect(-12, -32, 24, 60); ctx.restore();
  body(ctx); ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
  ctx.fillStyle = '#0d0d0d'; ctx.beginPath(); ctx.ellipse(0, -3, 2.8, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, -3, 4.2, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.fillStyle = '#ffd12e'; ctx.beginPath(); ctx.arc(0, -2, 2, 0, Math.PI * 2); ctx.fill();
  if (numbers) {
    ctx.fillStyle = c2; ctx.font = 'bold 8px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num, 0, 12);
  }
}

// Weltposition (Meter) eines Szenenpunkts
function world(track, scene, s, lat) {
  return pointAt(track, scene.d0 + s, lat);
}

// Fahrtrichtung eines Autos zur Zeit t (aus der Bewegung + Drehung beim Dreher)
export function carPose(track, scene, car, t) {
  const [s, lat, rot] = sceneCarAt(scene, car, t);
  const [x, y] = world(track, scene, s, lat);
  const [s2, lat2] = sceneCarAt(scene, car, Math.min(scene.dur, t + 0.15));
  let [x2, y2] = world(track, scene, s2 + 0.01, lat2);
  if (Math.hypot(x2 - x, y2 - y) < 0.05) [x2, y2] = world(track, scene, s + 1, lat);
  return { x, y, s, lat, ang: Math.atan2(y2 - y, x2 - x) + Math.PI / 2 + rot };
}

const relD = (track, d, d0) => { const L = track.L; let r = wrapD(track, d - d0); if (r > L / 2) r -= L; return r; };

export class ScenePlayer {
  // opts: { track, scene, sharp, big, onFull, onMap }
  constructor(el, opts) {
    this.el = el;
    Object.assign(this, opts);
    this.t = opts.t || 0;
    this.playing = opts.autoplay !== false;
    this.rate = 1;
    el.innerHTML = `
      <div class="scene-view"><canvas></canvas><span class="scene-tag">${this.sharp ? 'ÜBERSICHT (Rennleitung)' : 'TV-BILD'}</span></div>
      <div class="scene-ctl">
        <button data-sc="play" aria-label="Abspielen">❚❚</button>
        <input type="range" min="0" max="1000" value="0" aria-label="Zeit">
        <button data-sc="slow" aria-label="Zeitlupe">½×</button>
        ${this.onMap ? '<button data-sc="map" aria-label="Auf der Karte">🗺</button>' : ''}
        ${this.onFull ? '<button data-sc="full" aria-label="Vollbild">⛶</button>' : ''}
      </div>`;
    this.canvas = el.querySelector('canvas');
    this.range = el.querySelector('input');
    this.playBtn = el.querySelector('[data-sc="play"]');
    el.querySelector('.scene-ctl').addEventListener('click', e => {
      const b = e.target.closest('[data-sc]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.sc;
      if (a === 'play') { if (this.t >= this.scene.dur) this.t = 0; this.playing = !this.playing; }
      else if (a === 'slow') { this.rate = this.rate === 1 ? 0.5 : this.rate === 0.5 ? 0.25 : 1; b.textContent = this.rate === 1 ? '½×' : this.rate === 0.5 ? '¼×' : '1×'; }
      else if (a === 'full' && this.onFull) this.onFull(this.t);
      else if (a === 'map' && this.onMap) this.onMap();
      this.sync();
    });
    this.range.addEventListener('pointerdown', () => { this.dragging = true; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    this.range.addEventListener('input', () => {
      this.t = (this.range.value / 1000) * this.scene.dur;
      this.playing = false;
      this.sync();
    });
    this.setupView();
    this.last = performance.now();
    this.alive = true;
    const loop = now => {
      if (!this.alive) return;
      if (!this.el.isConnected) { this.alive = false; return; }
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.hold > 0) this.hold -= dt;           // Standbild am Messzeitpunkt
      else if (this.playing) {
        const ovT = this.sharp && this.scene.overlay && this.scene.overlay.kind === 'overlap' ? this.scene.overlay.t : null;
        const before = this.t;
        this.t += dt * this.rate;
        if (ovT !== null && before < ovT && this.t >= ovT) { this.t = ovT; this.hold = 1.6; }
        if (this.t >= this.scene.dur + 0.8) this.t = 0;     // Endlosschleife mit kurzer Pause am Ende
      }
      this.draw();
      // Fortschrittsbalken mitlaufen lassen (nicht während man selbst zieht)
      if (!this.dragging) {
        const v = String(Math.round(Math.min(1, this.t / this.scene.dur) * 1000));
        if (this.range.value !== v) this.range.value = v;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.sync();
  }

  destroy() { this.alive = false; }

  sync() {
    this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    this.range.value = Math.round(Math.min(1, this.t / this.scene.dur) * 1000);
  }

  // Ausschnitt: alle Positionen der Szene, Kurvenrichtung nach oben gedreht
  setupView() {
    const { track, scene } = this;
    const [ax, ay] = world(track, scene, -20, 0), [bx, by] = world(track, scene, 20, 0);
    this.rot = -Math.atan2(by - ay, bx - ax) - Math.PI / 2;
    const [ox, oy] = world(track, scene, 0, 0);
    this.o = [ox, oy];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, smin = Infinity, smax = -Infinity;
    for (const car of scene.cars) {
      for (const [s, lat] of car.f) {
        const [x, y] = this.local(world(track, scene, s, lat));
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        smin = Math.min(smin, s); smax = Math.max(smax, s);
      }
    }
    const m = 14;
    this.box = { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
    this.srange = [smin - 80, smax + 80];
  }

  local([x, y]) {
    const dx = x - this.o[0], dy = y - this.o[1];
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [dx * c - dy * s, dx * s + dy * c];
  }

  draw() {
    const cv = this.canvas;
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    // TV-Bild: unscharf (geringe Auflösung, hochskaliert)
    let tctx = ctx, tw = W, th = H;
    if (!this.sharp) {
      this.low = this.low || document.createElement('canvas');
      tw = Math.max(60, Math.round(W / 4)); th = Math.max(40, Math.round(H / 4));
      if (this.low.width !== tw) { this.low.width = tw; this.low.height = th; }
      tctx = this.low.getContext('2d');
    }
    // Kamera folgt den Autos (Mitte zwischen ihnen), Fahrtrichtung zeigt nach oben
    const poses = this.scene.cars.map(c => carPose(this.track, this.scene, c, this.t));
    const sC = poses.reduce((a, p) => a + p.s, 0) / poses.length;
    const latC = poses.reduce((a, p) => a + p.lat, 0) / poses.length * 0.5;
    const [ax, ay] = world(this.track, this.scene, sC - 8, 0), [bx, by] = world(this.track, this.scene, sC + 8, 0);
    this.rot = -Math.atan2(by - ay, bx - ax) - Math.PI / 2;
    this.o = world(this.track, this.scene, sC, latC);
    let spread = 0;
    for (const p of poses) spread = Math.max(spread, Math.hypot(...this.local([p.x, p.y])));
    const viewM = Math.max(this.big ? 46 : 36, spread * 2 + 14);   // sichtbare Höhe in Metern
    const k = Math.min(th / viewM, tw / (viewM * 0.8));
    const offX = tw / 2, offY = th / 2;
    this.srange = [sC - viewM * 1.5, sC + viewM * 1.5];
    const P = (s, lat) => { const [x, y] = this.local(world(this.track, this.scene, s, lat)); return [offX + x * k, offY + y * k]; };
    this.renderScene(tctx, tw, th, k, P);
    if (!this.sharp) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.low, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = 0; y < H; y += 4 * dpr) ctx.fillRect(0, y, W, dpr);
    } else {
      this.drawOverlay(ctx, k, P, dpr);
    }
  }

  renderScene(ctx, w, h, k, P) {
    const { track, scene } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1f4a2a';
    ctx.fillRect(0, 0, w, h);
    const [s0, s1] = this.srange;
    const path = (lat, a = s0, z = s1) => {
      ctx.beginPath();
      for (let s = a; s <= z; s += 2) { const [x, y] = P(s, lat); s === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    };
    ctx.lineJoin = 'round';
    // Auslaufzonen
    for (const ro of track.runoffs || []) {
      const a = relD(track, ro.from, scene.d0), z = relD(track, ro.to, scene.d0);
      if (z < s0 || a > s1 || z < a) continue;
      path(ro.side * (HALF_W + ro.offset + ro.width / 2), Math.max(a, s0), Math.min(z, s1));
      ctx.strokeStyle = ro.type === 'gravel' ? '#b39b6b' : '#3a3f48';
      ctx.lineWidth = ro.width * k;
      ctx.stroke();
    }
    // Asphalt, weiße Linien
    path(0); ctx.strokeStyle = '#2b2f37'; ctx.lineWidth = HALF_W * 2 * k; ctx.stroke();
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = Math.max(1, 0.25 * k);
    path(HALF_W - 0.15); ctx.stroke(); path(-HALF_W + 0.15); ctx.stroke();
    // Randsteine
    for (const kb of track.kerbs || []) {
      const a = relD(track, kb.from, scene.d0), z = relD(track, kb.to, scene.d0);
      if (z < s0 || a > s1 || z < a) continue;
      path(kb.side * (HALF_W + 0.5), Math.max(a, s0), Math.min(z, s1));
      ctx.lineWidth = 1.0 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.setLineDash([1 * k, 1 * k]); ctx.strokeStyle = '#d0201a'; ctx.stroke(); ctx.setLineDash([]);
    }
    // Autos
    const t = this.t;
    for (const car of scene.cars) {
      const pose = carPose(track, scene, car, t);
      const [x, y] = P(pose.s, pose.lat);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pose.ang + this.rot);
      const sc = UNIT * k;
      ctx.scale(sc, sc);
      drawCar(ctx, car.c1, car.c2, car.num, { numbers: this.sharp });
      ctx.restore();
      if (this.sharp) {
        ctx.font = `700 ${Math.max(10, 1.6 * k)}px system-ui, sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const tx = x + 1.6 * k, ty = y - 2.4 * k, tw2 = ctx.measureText(car.id).width;
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(tx - 3, ty - 8, tw2 + 6, 16);
        ctx.fillStyle = car.c1; ctx.fillRect(tx - 3, ty - 8, 3, 16);
        ctx.fillStyle = '#fff'; ctx.fillText(car.id, tx + 2, ty);
      }
    }
    // Berührung
    if (scene.contact !== null && t >= scene.contact && t - scene.contact < 0.4) {
      const [a, bb] = scene.cars.map(c => carPose(track, scene, c, t));
      const [x, y] = P((a.s + bb.s) / 2, (a.lat + bb.lat) / 2);
      ctx.fillStyle = `rgba(255,220,60,${0.85 - (t - scene.contact) * 2})`;
      ctx.beginPath(); ctx.arc(x, y, 2.2 * k, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Hilfslinien für die Rennleitung (nur in der genauen Ansicht)
  drawOverlay(ctx, k, P, dpr) {
    const { track, scene } = this;
    const ov = scene.overlay;
    if (!ov) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    if (ov.kind === 'overlap') {
      const near = Math.abs(this.t - ov.t) < 0.25;
      if (!near) return;
      const A = carPose(track, scene, scene.cars[ov.a], this.t), B = carPose(track, scene, scene.cars[ov.b], this.t);
      const pct = Math.round(((A.s + CAR_LEN / 2) - (B.s - CAR_LEN / 2)) / CAR_LEN * 100);
      const line = (s, col, dash) => {
        const [x1, y1] = P(s, -HALF_W), [x2, y2] = P(s, HALF_W);
        ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr; ctx.setLineDash(dash ? [6 * dpr, 4 * dpr] : []);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      };
      line(B.s - CAR_LEN / 2 + 0.6 * CAR_LEN, 'rgba(255,255,255,.75)', true);     // Spiegel (60 %)
      line(A.s + CAR_LEN / 2 - 0.8, '#ffd12e', false);                            // Vorderachse A
      const txt = `${ov.label}: ${Math.max(0, pct)} % · Spiegel = 60 %`;
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      const w = ctx.measureText(txt).width + 12 * dpr;
      const bx = 6 * dpr, by = 26 * dpr;
      ctx.fillRect(bx, by, w, 20 * dpr);
      ctx.fillStyle = '#ffd12e';
      ctx.fillText(txt, bx + 6 * dpr, by + 14 * dpr);
    } else if (ov.kind === 'edge') {
      const car = scene.cars[ov.a];
      let maxOut = 0, side = 1;
      for (const [, lat] of car.f) if (Math.abs(lat) > maxOut) { maxOut = Math.abs(lat); side = Math.sign(lat); }
      const wheels = maxOut - 1 > HALF_W ? 4 : maxOut > HALF_W ? 2 : 0;
      const mid = (this.srange[0] + this.srange[1]) / 2;
      const [x1, y1] = P(mid - 60, side * HALF_W), [x2, y2] = P(mid + 60, side * HALF_W);
      ctx.strokeStyle = 'rgba(255,209,46,.8)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const txt = `${car.id}: max. ${wheels === 4 ? 'alle 4' : wheels ? '2–3' : '0'} Räder jenseits der Linie`;
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      const w = ctx.measureText(txt).width + 12 * dpr;
      ctx.fillRect(6 * dpr, 26 * dpr, w, 20 * dpr);
      ctx.fillStyle = '#ffd12e';
      ctx.fillText(txt, 12 * dpr, 40 * dpr);
    }
  }
}
