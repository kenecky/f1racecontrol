// Intro-Musik: eigene Komposition im Stil einer TV-Rennsport-Eröffnung (treibender Bass, Bläser, Arpeggio,
// große Schläge an den Kameraschnitten). Komplett im Browser erzeugt (Web Audio), keine Sounddateien.
// Läuft synchron zum Intro (17,2 s): Abtauchen 3,4 s · Flug ab 3,75 s · Drehung ab 11,25 s · Schluss ab 15 s.
// Funktioniert auch mit einem OfflineAudioContext (zum Aufnehmen).

const BPM = 128, BEAT = 60 / BPM, BAR = 4 * BEAT;
const N = { C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, Bb3: 233.08, C4: 261.63, Cs4: 277.18, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, Cs5: 554.37, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, Bb5: 932.33, C6: 1046.5, Cs6: 1108.73, D6: 1174.66 };
const lo = f => f / 4;   // zwei Oktaven tiefer (Bass)

// Akkorde je Takt ab Takt 3 (Takt = 1,875 s): d-Moll, B, F, C, g-Moll, A, (Schluss) D
const CHORDS = [
  [N.D4, N.F4, N.A4], [N.Bb3, N.D4, N.F4], [N.F3, N.A3, N.C4], [N.C4, N.E4, N.G4],
  [N.G3, N.Bb3, N.D4], [N.A3, N.Cs4, N.E4],
];
const ROOTS = [N.D3, N.Bb3 / 2, N.F3, N.C3, N.G3 / 2, N.A3 / 2];
// Melodie (Bläser), Takte 3–8: [Schlag im Takt, Länge in Schlägen, Ton]
const MELODY = [
  [[0, 1, N.D5], [1, 0.5, N.F5], [1.5, 0.5, N.A5], [2, 2, N.D6]],
  [[0, 1, N.C6], [1, 1, N.Bb5], [2, 1, N.A5], [3, 1, N.F5]],
  [[0, 1.5, N.A5], [1.5, 0.5, N.G5], [2, 1, N.F5], [3, 1, N.C5]],
  [[0, 2, N.E5], [2, 2, N.G5]],
  [[0, 1, N.Bb5], [1, 1, N.A5], [2, 1, N.G5], [3, 1, N.D6]],
  [[0, 4, N.Cs6]],
];

export function playIntroMusic(ctx, dest, noiseBuf, offset = 0) {
  const T0 = ctx.currentTime + 0.05 - offset;
  const bus = ctx.createGain();
  bus.gain.value = 0.55;
  bus.connect(dest);
  // Hall: selbst erzeugte Impulsantwort (abklingendes Rauschen)
  const rev = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  rev.buffer = ir;
  const revGain = ctx.createGain(); revGain.gain.value = 0.28;
  rev.connect(revGain).connect(bus);
  const out = (node, wet = 0.3) => { node.connect(bus); if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s).connect(rev); } };
  const at = t => T0 + t;
  const live = t => T0 + t > ctx.currentTime - 0.02;   // beim Einstieg mitten im Stück nichts Vergangenes planen

  // Ton mit Hüllkurve und optionalem Filterverlauf
  const voice = (type, freq, t, dur, vol, { attack = 0.01, release = 0.12, detune = 0, cut0 = 0, cut1 = 0, q = 1, wet = 0.3 } = {}) => {
    if (!live(t + dur)) return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    let node = o;
    if (cut0) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
      f.frequency.setValueAtTime(cut0, at(t)); f.frequency.exponentialRampToValueAtTime(Math.max(40, cut1 || cut0), at(t + Math.max(0.05, Math.min(dur, attack * 4 + 0.15))));
      o.connect(f); node = f;
    }
    g.gain.setValueAtTime(0.0001, at(t));
    g.gain.exponentialRampToValueAtTime(vol, at(t + attack));
    g.gain.setValueAtTime(vol, at(t + Math.max(attack, dur - release)));
    g.gain.exponentialRampToValueAtTime(0.0001, at(t + dur));
    node.connect(g); out(g, wet);
    o.start(at(t)); o.stop(at(t + dur + 0.05));
  };
  const noise = (t, dur, vol, { type = 'bandpass', f0 = 2000, f1 = 2000, q = 1, attack = 0.002, wet = 0.15 } = {}) => {
    if (!live(t + dur) || !noiseBuf) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at(t)); f.frequency.exponentialRampToValueAtTime(f1, at(t + dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at(t)); g.gain.exponentialRampToValueAtTime(vol, at(t + attack)); g.gain.exponentialRampToValueAtTime(0.0001, at(t + dur));
    src.connect(f).connect(g); out(g, wet);
    src.start(at(t), Math.random()); src.stop(at(t + dur + 0.05));
  };
  // Schlagzeug
  const kick = (t, vol = 0.9) => {
    if (!live(t + 0.4)) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, at(t)); o.frequency.exponentialRampToValueAtTime(42, at(t + 0.12));
    g.gain.setValueAtTime(vol, at(t)); g.gain.exponentialRampToValueAtTime(0.0001, at(t + 0.32));
    o.connect(g); out(g, 0.05); o.start(at(t)); o.stop(at(t + 0.4));
  };
  const snare = (t, vol = 0.32) => { noise(t, 0.18, vol, { f0: 1900, f1: 1500, q: 0.7 }); voice('triangle', 190, t, 0.1, vol * 0.6, { attack: 0.002, release: 0.08, wet: 0.2 }); };
  const hat = (t, vol = 0.06) => noise(t, 0.05, vol, { type: 'highpass', f0: 7000, f1: 9000, wet: 0.05 });
  const boom = (t, vol = 1) => {   // großer Schlag (Pauke + Becken)
    voice('sine', 62, t, 1.4, 0.45 * vol, { attack: 0.004, release: 1.2, wet: 0.5 });
    voice('sine', 47, t, 1.6, 0.32 * vol, { attack: 0.004, release: 1.4, wet: 0.4 });
    noise(t, 1.6, 0.16 * vol, { type: 'highpass', f0: 4000, f1: 2500, wet: 0.6 });
    kick(t, 0.65);
  };
  const riser = (t, dur, vol = 0.18) => noise(t, dur, vol, { f0: 300, f1: 6000, q: 3, attack: dur * 0.95, wet: 0.4 });
  const pad = (notes, t, dur, vol = 0.06) => { for (const f of notes) for (const d of [-9, 0, 9]) voice('sawtooth', f, t, dur, vol, { attack: Math.min(0.6, dur / 3), release: Math.min(0.9, dur / 2), detune: d, cut0: 700, cut1: 1400, wet: 0.5 }); };
  const brass = (f, t, dur, vol = 0.11) => { for (const d of [-6, 6]) voice('sawtooth', f, t, dur, vol, { attack: 0.04, release: 0.15, detune: d, cut0: 500, cut1: 2600, q: 2, wet: 0.45 }); voice('square', f / 2, t, dur, vol * 0.4, { attack: 0.04, release: 0.15, cut0: 400, cut1: 1500, wet: 0.3 }); };

  // ---------- Einstieg 0–3,75 s: Fläche in d-Moll, leises Ticken, Anstieg zum Abtauchen ----------
  pad([N.D4, N.F4, N.A4], 0.0, 3.6, 0.045);
  voice('sine', N.D3 / 2, 0.0, 3.6, 0.18, { attack: 1.2, release: 0.6, wet: 0.2 });
  for (let k = 0; k < 14; k++) hat(0.4 + k * BEAT / 2, 0.02 + k * 0.003);
  riser(1.6, 1.8, 0.2);
  boom(3.4, 0.9);
  brass(N.D4, 3.4, 0.4, 0.12); brass(N.A4, 3.4, 0.4, 0.1);

  // ---------- Takte 3–8 (3,75–15 s): Groove, Akkorde, Arpeggio, Melodie ----------
  const START = 2 * BAR;
  for (let bar = 0; bar < 6; bar++) {
    const tb = START + bar * BAR, ch = CHORDS[bar], root = ROOTS[bar];
    const lift = bar >= 4 ? 1 : 0;   // ab der Drehung (Takt 7) größer
    pad(ch, tb, BAR + 0.1, 0.035 + lift * 0.01);
    // Bass: treibende Achtel
    for (let e = 0; e < 8; e++) {
      const f = e === 6 ? root * 1.5 : root;   // kleine Quinte vor dem Taktwechsel
      voice('sawtooth', lo(f * 2), tb + e * BEAT / 2, BEAT / 2 - 0.02, 0.16, { attack: 0.005, release: 0.06, cut0: 900, cut1: 250, wet: 0 });
      voice('square', lo(f), tb + e * BEAT / 2, BEAT / 2 - 0.02, 0.07, { attack: 0.005, release: 0.06, wet: 0 });
    }
    // Schlagzeug
    for (let q = 0; q < 4; q++) {
      const t = tb + q * BEAT;
      kick(t, q % 2 ? 0.6 : 0.85);
      if (q % 2) snare(t);
      hat(t + BEAT / 2, 0.05); if (lift) hat(t + BEAT / 4, 0.03);
    }
    // Arpeggio (Sechzehntel) aus den Akkordtönen, ab Takt 4
    if (bar >= 1) {
      const arp = [ch[0] * 2, ch[1] * 2, ch[2] * 2, ch[1] * 4, ch[2] * 2, ch[1] * 2];
      for (let s = 0; s < 16; s++) voice('triangle', arp[s % arp.length] * (lift ? 2 : 1), tb + s * BEAT / 4, BEAT / 4 - 0.02, 0.05, { attack: 0.003, release: 0.08, cut0: 3000, cut1: 1200, wet: 0.35 });
    }
    // Melodie
    for (const [b, l, f] of MELODY[bar]) brass(f, tb + b * BEAT, l * BEAT - 0.03, 0.09 + lift * 0.02);
    // Becken zu Taktbeginn
    if (bar === 0 || bar === 4) noise(tb, 1.4, 0.12, { type: 'highpass', f0: 5000, f1: 3500, wet: 0.5 });
  }
  riser(9.6, 1.6, 0.16);
  boom(11.25, 0.8);

  // ---------- Schluss ab 15 s: großer Akkord in D-Dur, ausklingen ----------
  const END = START + 6 * BAR;   // 15,0 s
  boom(END, 1.1);
  pad([N.D4, N.Fs4, N.A4, N.D5], END, 2.3, 0.05);
  brass(N.D5, END, 1.6, 0.12); brass(N.A4, END, 1.6, 0.1); brass(N.D4, END, 1.6, 0.08);
  voice('sawtooth', lo(N.D3), END, 2.0, 0.14, { attack: 0.01, release: 1.2, cut0: 600, cut1: 150, wet: 0.2 });

  // Gesamt ausblenden am Ende des Intros
  bus.gain.setValueAtTime(0.55, at(16.4));
  bus.gain.linearRampToValueAtTime(0.0001, at(17.3));

  return {
    stop(fade = 0.4) {
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => { try { bus.disconnect(); } catch { /* schon getrennt */ } }, (fade + 0.2) * 1000);
    },
  };
}
