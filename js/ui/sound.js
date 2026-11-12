// Geräusche – komplett im Browser erzeugt (Web Audio), ohne Sound-Dateien.
// Motoren: mehrere verstimmte Sägezahn-Oszillatoren + Rauschen durch einen Tiefpass,
// Drehzahl steuert Tonhöhe und Filter. Dazu Startampel, Funk-Knacken, Hinweistöne.

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.engine = null;
    this.rpm = 0;
    this.level = 0;
  }

  // Muss durch eine Berührung/Klick ausgelöst werden (Browser-Regel)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.buildEngine();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- Motorengeräusch (Feld aus mehreren Autos) ----------
  buildEngine() {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    filter.connect(out);
    out.connect(this.master);
    const oscs = [];
    for (const det of [-14, -5, 0, 7, 16]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det * 10;
      const g = c.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(filter);
      o.start();
      oscs.push(o);
    }
    // leichtes Wabern (Autos fahren vorbei)
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoG = c.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG);
    lfo.start();
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1800;
    const ng = c.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf).connect(ng).connect(out);
    noise.start();
    for (const o of oscs) lfoG.connect(o.detune);
    this.engine = { out, filter, oscs };
  }

  // ---------- Safety Car: Straßen-V8 (tiefes Blubbern statt hohem F1-Heulen) ----------
  buildScEngine() {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 4;
    filter.connect(out);
    out.connect(this.master);
    const oscs = [];
    for (const [type, det, vol] of [['sawtooth', 0, 0.12], ['sawtooth', -9, 0.09], ['triangle', 1200, 0.1]]) {
      const o = c.createOscillator();
      o.type = type;
      o.detune.value = det;
      const g = c.createGain();
      g.gain.value = vol;
      o.connect(g).connect(filter);
      o.start();
      oscs.push(o);
    }
    // V8-Blubbern: Lautstärke pulsiert mit der Zündfolge
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 9;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.07;   // nur ein leichtes Pulsieren
    const trem = c.createGain();
    trem.gain.value = 0.93;
    lfo.connect(lfoG).connect(trem.gain);
    lfo.start();
    filter.disconnect();
    filter.connect(trem).connect(out);
    this.scEngine = { out, filter, oscs, lfo };
  }

  setScEngine(level, rpm) {
    if (!this.ctx) return;
    if (!this.scEngine) { if (level <= 0) return; this.buildScEngine(); }
    const t = this.ctx.currentTime, e = this.scEngine;
    e.out.gain.setTargetAtTime(level * 0.75, t, 0.3);   // tiefer Klang wirkt leiser – daher deutlich mehr Pegel
    const f = 45 + rpm * 95;   // tiefer als F1, aber gleichmäßiger Lauf
    for (const o of e.oscs) o.frequency.setTargetAtTime(f, t, 0.25);
    e.lfo.frequency.setTargetAtTime(6 + rpm * 14, t, 0.25);
    e.filter.frequency.setTargetAtTime(320 + rpm * 1300, t, 0.25);
  }

  // level 0…1 (Lautstärke), rpm 0…1 (Drehzahl)
  setEngine(level, rpm) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    if (Math.abs(level - this.level) > 0.005) e.out.gain.setTargetAtTime(level * 0.16, t, 0.25);
    if (Math.abs(rpm - this.rpm) > 0.005) {
      const f = 55 + rpm * 165;                       // Grundton
      for (const o of e.oscs) o.frequency.setTargetAtTime(f, t, 0.18);
      e.filter.frequency.setTargetAtTime(350 + rpm * 2600, t, 0.2);
    }
    this.level = level;
    this.rpm = rpm;
  }

  // ---------- Einzelne Töne ----------
  tone(freq, start, dur, { type = 'sine', vol = 0.25, attack = 0.005, release = 0.08 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime + start;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(start, dur, { freq = 2500, q = 0.8, vol = 0.18 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime + start;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // Ein rotes Licht geht an
  light() { this.tone(660, 0, 0.16, { type: 'sine', vol: 0.05 }); }   // Startampel: leiser, weicher
  // Lichter aus: Aufheulen der Motoren
  lightsOut() { this.tone(990, 0, 0.12, { type: 'sine', vol: 0.04 }); this.launchUntil = (this.ctx ? this.ctx.currentTime : 0) + 2.5; }
  // Funk: Knacken + kurzer Piepton
  radio() {
    this.noiseBurst(0, 0.12, { freq: 2200, q: 1.2, vol: 0.12 });
    this.tone(1320, 0.1, 0.06, { vol: 0.07 });
    this.tone(1760, 0.17, 0.06, { vol: 0.07 });
  }
  // Neue Entscheidung
  chime() { this.tone(784, 0, 0.18, { vol: 0.14 }); this.tone(1047, 0.16, 0.28, { vol: 0.14 }); }
  // Neuer Vorfall auf der Strecke
  alert() { this.tone(880, 0, 0.1, { type: 'triangle', vol: 0.16 }); this.tone(880, 0.16, 0.1, { type: 'triangle', vol: 0.16 }); }
  // VSC / Safety Car / Rot
  neutral(kind) {
    const f = kind === 'red' ? 520 : kind === 'sc' ? 700 : 820;
    for (let i = 0; i < 3; i++) { this.tone(f, i * 0.32, 0.14, { type: 'square', vol: 0.08 }); this.tone(f * 0.75, i * 0.32 + 0.15, 0.14, { type: 'square', vol: 0.08 }); }
  }
  // Einsatz ausgelöst (Medical Car, Kehrmaschine, Kran, Boxengasse zu, Schwarz-Orange, Start verschoben)
  deploy(kind) {
    const f = { start: 600, med: 940, sweep: 760, crane: 680, pit: 560, bo: 880 }[kind] || 760;
    for (let i = 0; i < 2; i++) { this.tone(f, i * 0.28, 0.12, { type: 'sawtooth', vol: 0.07 }); this.tone(f * 1.25, i * 0.28 + 0.13, 0.12, { type: 'sawtooth', vol: 0.07 }); }
  }
  // Zielflagge
  chequered() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.13, 0.22, { type: 'triangle', vol: 0.14 })); }
}
