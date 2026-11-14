// Intro-Musik je Strecke: eigene Kompositionen im Stil des Landes bzw. Ortes (Tonleiter, Instrumente, Rhythmus),
// komplett im Browser erzeugt (Web Audio), keine Sounddateien und keine Kopie bestehender Musik.
// Feste Zeitachse passend zum Intro (17,2 s): Einstieg 0–3,4 s · Schlag beim Abtauchen 3,4 s ·
// Hauptteil 3,75–15 s (5–7 Takte je nach Tempo) · Schlag bei der Drehung 11,25 s · Schlussakkord ab 15 s.
// Funktioniert auch mit einem OfflineAudioContext (zum Aufnehmen).

const MAIN0 = 3.75, MAIN1 = 15.0;

// Tonleitern (Halbtöne ab Grundton)
const SC = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmMinor: [0, 2, 3, 5, 7, 8, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygDom: [0, 1, 4, 5, 7, 8, 10], phryg: [0, 1, 3, 5, 7, 8, 10],
  pentaMaj: [0, 2, 4, 7, 9], pentaMin: [0, 3, 5, 7, 10], japIn: [0, 1, 5, 7, 8],
};
// Akkordfolgen: [Grundton in Halbtönen, Art] – '' Dur, 'm' Moll, '5' Quinte, 'sus' Quarte
const PROG = {
  epicMin: [[0, 'm'], [8, ''], [3, ''], [10, ''], [5, 'm'], [7, '']],
  popMaj: [[0, ''], [7, ''], [9, 'm'], [5, ''], [0, ''], [7, '']],
  anthem: [[0, ''], [5, ''], [9, 'm'], [7, ''], [5, ''], [7, '']],
  andalus: [[5, 'm'], [3, ''], [1, ''], [0, ''], [5, 'm'], [0, '']],          // Am G F E über E
  hijaz: [[0, ''], [1, ''], [0, ''], [10, 'm'], [1, ''], [0, '']],
  shur: [[0, 'm'], [10, ''], [8, ''], [0, 'm'], [3, ''], [7, '']],
  penta: [[0, '5'], [7, '5'], [9, '5'], [5, '5'], [0, '5'], [7, '5']],
  japan: [[0, '5'], [8, '5'], [5, 'sus'], [7, '5'], [8, '5'], [7, '5']],
  csardas: [[0, 'm'], [5, 'm'], [7, ''], [0, 'm'], [8, ''], [7, '']],
  rock: [[0, '5'], [10, '5'], [5, '5'], [7, '5'], [3, '5'], [7, '5']],
  house: [[0, 'm'], [8, ''], [10, ''], [7, 'm'], [0, 'm'], [10, '']],
  latin: [[0, 'm'], [5, 'm'], [10, ''], [3, ''], [8, ''], [7, '']],
  mariachi: [[0, ''], [5, ''], [7, ''], [0, ''], [5, ''], [7, '']],
  swing: [[0, ''], [9, 'm'], [2, 'm'], [7, ''], [0, ''], [7, '']],
};

// Stile je Strecke
const STYLES = {
  aussie:   { tonic: 146.83, scale: 'mixo', prog: 'anthem', bars: 6, lead: 'brass', drums: 'rock', bass: 'drive8', pad: 'strings', drone: 'didge', final: 'major' },
  china:    { tonic: 155.56, scale: 'pentaMaj', prog: 'penta', bars: 6, lead: 'guzheng', drums: 'toms', bass: 'sub', pad: 'strings', gong: true, final: 'fifth' },
  japan:    { tonic: 146.83, scale: 'japIn', prog: 'japan', bars: 5, lead: 'koto', lead2: 'ney', drums: 'taiko', bass: 'sub', pad: 'strings', final: 'fifth' },
  hijaz:    { tonic: 146.83, scale: 'phrygDom', prog: 'hijaz', bars: 6, lead: 'oud', lead2: 'ney', drums: 'darbuka', bass: 'drive8', pad: 'strings', final: 'major' },
  hijazFast:{ tonic: 164.81, scale: 'phrygDom', prog: 'hijaz', bars: 7, lead: 'oud', drums: 'darbuka', bass: 'drive8', pad: 'strings', arp: true, final: 'major' },
  hijazSlow:{ tonic: 196.0, scale: 'phrygDom', prog: 'hijaz', bars: 5, lead: 'ney', lead2: 'oud', drums: 'darbuka', bass: 'sub', pad: 'strings', final: 'major' },
  hijazElec:{ tonic: 174.61, scale: 'phrygDom', prog: 'hijaz', bars: 6, lead: 'synth', lead2: 'oud', drums: 'house', bass: 'pulse', pad: 'strings', arp: true, final: 'major' },
  shur:     { tonic: 146.83, scale: 'phryg', prog: 'shur', bars: 6, lead: 'oud', lead2: 'ney', drums: 'darbuka', bass: 'drive8', pad: 'strings', final: 'minor' },
  dembow:   { tonic: 138.59, scale: 'minor', prog: 'latin', bars: 6, lead: 'synth', drums: 'dembow', bass: 'pulse', pad: 'strings', arp: true, final: 'minor' },
  canada:   { tonic: 196.0, scale: 'major', prog: 'popMaj', bars: 7, lead: 'fiddle', drums: 'rock', bass: 'oompah', pad: 'strings', final: 'major' },
  monaco:   { tonic: 146.83, scale: 'minor', prog: 'epicMin', bars: 5, lead: 'violin', drums: 'soft', bass: 'sub', pad: 'strings', harp: true, final: 'major' },
  flamenco: { tonic: 164.81, scale: 'phrygDom', prog: 'andalus', bars: 6, lead: 'guitar', drums: 'flamenco', bass: 'sub', pad: 'strings', strum: true, final: 'major' },
  pasodoble:{ tonic: 146.83, scale: 'phrygDom', prog: 'andalus', bars: 7, lead: 'trumpet', drums: 'military', bass: 'oompah', pad: 'strings', final: 'major' },
  alpine:   { tonic: 174.61, scale: 'major', prog: 'mariachi', bars: 7, lead: 'accordion', drums: 'oompah', bass: 'oompah', pad: 'strings', final: 'major' },
  british:  { tonic: 155.56, scale: 'major', prog: 'anthem', bars: 6, lead: 'brass', drums: 'military', bass: 'drive8', pad: 'strings', final: 'major' },
  belgium:  { tonic: 130.81, scale: 'dorian', prog: 'epicMin', bars: 5, lead: 'brass', drums: 'epic', bass: 'drive8', pad: 'organ', final: 'minor' },
  csardas:  { tonic: 146.83, scale: 'harmMinor', prog: 'csardas', bars: 7, lead: 'violin', drums: 'oompah', bass: 'oompah', pad: 'strings', final: 'minor' },
  house:    { tonic: 130.81, scale: 'minor', prog: 'house', bars: 6, lead: 'synth', drums: 'house', bass: 'pulse', pad: 'strings', arp: true, stabs: true, final: 'minor' },
  italia:   { tonic: 174.61, scale: 'major', prog: 'popMaj', bars: 6, lead: 'mandolin', drums: 'epic', bass: 'drive8', pad: 'strings', final: 'major' },
  electro:  { tonic: 138.59, scale: 'pentaMin', prog: 'house', bars: 6, lead: 'synth', drums: 'rock', bass: 'pulse', pad: 'strings', arp: true, final: 'minor' },
  texas:    { tonic: 164.81, scale: 'mixo', prog: 'rock', bars: 6, lead: 'guitarDist', drums: 'rock', bass: 'drive8', pad: 'power', final: 'fifth' },
  mariachi: { tonic: 196.0, scale: 'major', prog: 'mariachi', bars: 7, lead: 'trumpet', lead2: 'trumpet3', drums: 'oompah', bass: 'oompah', pad: 'strings', strum: true, final: 'major' },
  samba:    { tonic: 174.61, scale: 'major', prog: 'latin', bars: 6, lead: 'whistle', drums: 'samba', bass: 'drive8', pad: 'strings', strum: true, final: 'major' },
  swing:    { tonic: 174.61, scale: 'mixo', prog: 'swing', bars: 6, lead: 'brass', drums: 'swing', bass: 'walk', pad: 'strings', stabs: true, final: 'major' },
};
export const TRACK_STYLE = {
  albertpark: 'aussie', shanghai: 'china', suzuka: 'japan', bahrain: 'hijaz', jeddah: 'hijazFast', miami: 'dembow',
  montreal: 'canada', monaco: 'monaco', barcelona: 'flamenco', redbullring: 'alpine', silverstone: 'british', spa: 'belgium',
  hungaroring: 'csardas', zandvoort: 'house', monza: 'italia', madring: 'pasodoble', baku: 'shur', singapore: 'electro',
  cota: 'texas', mexico: 'mariachi', interlagos: 'samba', lasvegas: 'swing', lusail: 'hijazSlow', yasmarina: 'hijazElec',
};

// Lautheitsausgleich je Strecke (dB), gemessen auf ca. −23,5 LUFS
const TRIM = { albertpark: -0.9, shanghai: 0.9, suzuka: 0.6, bahrain: 1.5, jeddah: 1.6, miami: -0.5, montreal: -0.6, monaco: 1.3, barcelona: 2.2, redbullring: 0.7, silverstone: -0.1, spa: -0.7, hungaroring: 2.5, zandvoort: -0.7, monza: 0.0, madring: 0.1, baku: 1.4, singapore: -0.2, cota: -1.6, mexico: 1.0, interlagos: -0.3, lasvegas: -0.2, lusail: 0.2, yasmarina: -0.7 };

function rng(seed) {
  let a = 0; for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const st = (f, n) => f * Math.pow(2, n / 12);
const chordTones = (root, q) => q === 'm' ? [0, 3, 7].map(n => root + n) : q === '5' ? [0, 7, 12].map(n => root + n) : q === 'sus' ? [0, 5, 7].map(n => root + n) : [0, 4, 7].map(n => root + n);

export function playIntroMusic(ctx, dest, noiseBuf, trackId = 'albertpark', offset = 0) {
  const S = STYLES[TRACK_STYLE[trackId]] || STYLES.aussie;
  const R = rng(trackId);
  const BAR = (MAIN1 - MAIN0) / S.bars, BEAT = BAR / 4, T0 = ctx.currentTime + 0.05 - offset;
  const VOL = 0.55 * Math.pow(10, (TRIM[trackId] || 0) / 20);
  const bus = ctx.createGain(); bus.gain.value = VOL; bus.connect(dest);
  const rev = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  rev.buffer = ir;
  const revGain = ctx.createGain(); revGain.gain.value = 0.28; rev.connect(revGain).connect(bus);
  const out = (node, wet = 0.3) => { node.connect(bus); if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s).connect(rev); } };
  const at = t => T0 + t;
  const live = t => T0 + t > ctx.currentTime - 0.02;

  // ---------- Klangbausteine ----------
  const voice = (type, freq, t, dur, vol, { attack = 0.01, release = 0.12, detune = 0, cut0 = 0, cut1 = 0, q = 1, wet = 0.3, vib = 0, vibRate = 5.5, decay = false } = {}) => {
    if (!live(t + dur) || dur <= 0) return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vibRate; lg.gain.setValueAtTime(0, at(t)); lg.gain.linearRampToValueAtTime(vib, at(t + Math.min(0.35, dur * 0.6))); l.connect(lg).connect(o.detune); l.start(at(t)); l.stop(at(t + dur + 0.05)); }
    const g = ctx.createGain();
    let node = o;
    if (cut0) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
      f.frequency.setValueAtTime(cut0, at(t)); f.frequency.exponentialRampToValueAtTime(Math.max(40, cut1 || cut0), at(t + Math.max(0.05, Math.min(dur, attack * 4 + 0.15))));
      o.connect(f); node = f;
    }
    g.gain.setValueAtTime(0.0001, at(t));
    g.gain.exponentialRampToValueAtTime(vol, at(t + attack));
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, at(t + dur));
    else { g.gain.setValueAtTime(vol, at(t + Math.max(attack, dur - release))); g.gain.exponentialRampToValueAtTime(0.0001, at(t + dur)); }
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
  const drum = (t, f0, f1, dur, vol, wet = 0.05) => {
    if (!live(t + dur)) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, at(t)); o.frequency.exponentialRampToValueAtTime(f1, at(t + Math.min(0.15, dur)));
    g.gain.setValueAtTime(vol, at(t)); g.gain.exponentialRampToValueAtTime(0.0001, at(t + dur));
    o.connect(g); out(g, wet); o.start(at(t)); o.stop(at(t + dur + 0.05));
  };
  const kick = (t, v = 0.85) => drum(t, 130, 42, 0.32, v);
  const snare = (t, v = 0.3) => { noise(t, 0.18, v, { f0: 1900, f1: 1500, q: 0.7 }); voice('triangle', 190, t, 0.1, v * 0.6, { attack: 0.002, release: 0.08, wet: 0.2 }); };
  const hat = (t, v = 0.05, open = false) => noise(t, open ? 0.22 : 0.05, v, { type: 'highpass', f0: 7000, f1: 9000, wet: 0.05 });
  const clap = (t, v = 0.2) => { for (let k = 0; k < 3; k++) noise(t + k * 0.012, 0.09, v, { f0: 1300, f1: 1100, q: 1.2, wet: 0.25 }); };
  const boom = (t, v = 1) => {
    voice('sine', 62, t, 1.4, 0.45 * v, { attack: 0.004, release: 1.2, wet: 0.5 });
    voice('sine', 47, t, 1.6, 0.32 * v, { attack: 0.004, release: 1.4, wet: 0.4 });
    noise(t, 1.6, 0.16 * v, { type: 'highpass', f0: 4000, f1: 2500, wet: 0.6 });
    kick(t, 0.65);
  };
  const gong = (t, v = 0.25) => { for (const [m, a] of [[1, 1], [1.47, 0.6], [2.09, 0.45], [2.76, 0.3], [3.9, 0.2]]) voice('sine', 82 * m, t, 3.2, v * a, { attack: 0.01, decay: true, wet: 0.6 }); noise(t, 1.2, 0.05, { f0: 1500, f1: 600, wet: 0.6 }); };
  const riser = (t, dur, v = 0.18) => noise(t, dur, v, { f0: 300, f1: 6000, q: 3, attack: dur * 0.95, wet: 0.4 });
  // Melodie-Instrumente
  const pluck = (f, t, dur, v, { bright = 3500, type = 'sawtooth', body = 0.4, wet = 0.35 } = {}) => {
    voice(type, f, t, Math.max(0.25, dur), v, { attack: 0.003, cut0: bright, cut1: 500, decay: true, wet });
    if (body) voice('sine', f, t, Math.max(0.3, dur), v * body, { attack: 0.003, decay: true, wet });
  };
  const INSTR = {
    brass: (f, t, d, v) => { for (const dt of [-6, 6]) voice('sawtooth', f, t, d, v, { attack: 0.04, release: 0.15, detune: dt, cut0: 500, cut1: 2600, q: 2, wet: 0.45 }); voice('square', f / 2, t, d, v * 0.4, { attack: 0.04, release: 0.15, cut0: 400, cut1: 1500, wet: 0.3 }); },
    trumpet: (f, t, d, v) => { voice('sawtooth', f, t, d, v * 1.1, { attack: 0.03, release: 0.12, cut0: 900, cut1: 4200, q: 2.5, vib: 18, vibRate: 6, wet: 0.4 }); voice('square', f, t, d, v * 0.35, { attack: 0.03, release: 0.12, cut0: 1200, cut1: 3000, wet: 0.3 }); },
    trumpet3: (f, t, d, v) => INSTR.trumpet(f * Math.pow(2, 4 / 12), t, d, v * 0.6),
    violin: (f, t, d, v) => { voice('sawtooth', f, t, d, v, { attack: 0.08, release: 0.2, cut0: 2600, cut1: 2600, q: 1.5, vib: 14, vibRate: 5.8, wet: 0.5 }); voice('sawtooth', f, t, d, v * 0.5, { attack: 0.1, release: 0.2, detune: 7, cut0: 2000, cut1: 2000, wet: 0.5 }); },
    fiddle: (f, t, d, v) => voice('sawtooth', f, t, d, v * 1.1, { attack: 0.03, release: 0.1, cut0: 3000, cut1: 3000, q: 2, vib: 10, vibRate: 6.5, wet: 0.35 }),
    accordion: (f, t, d, v) => { for (const dt of [-12, 12]) voice('square', f, t, d, v * 0.7, { attack: 0.03, release: 0.08, detune: dt, cut0: 1800, cut1: 1800, wet: 0.3 }); },
    ney: (f, t, d, v) => { voice('sine', f, t, d, v * 1.2, { attack: 0.12, release: 0.2, vib: 12, vibRate: 5, wet: 0.5 }); noise(t, d, v * 0.25, { f0: f * 2, f1: f * 2, q: 8, attack: 0.1, wet: 0.5 }); },
    whistle: (f, t, d, v) => voice('sine', f * 2, t, d, v, { attack: 0.02, release: 0.08, vib: 20, vibRate: 7, wet: 0.35 }),
    synth: (f, t, d, v) => { for (const dt of [-12, 12]) voice('sawtooth', f, t, d, v * 0.8, { attack: 0.01, release: 0.1, detune: dt, cut0: 3500, cut1: 1800, q: 4, wet: 0.35 }); },
    guitarDist: (f, t, d, v) => { for (const dt of [-8, 8]) voice('square', f, t, d, v * 0.8, { attack: 0.005, release: 0.15, detune: dt, cut0: 2600, cut1: 1600, q: 3, vib: 8, wet: 0.3 }); },
    koto: (f, t, d, v) => pluck(f, t, d, v * 1.2, { bright: 4200, type: 'triangle', body: 0.6 }),
    guzheng: (f, t, d, v) => { pluck(f, t, d, v * 1.2, { bright: 4800, type: 'sawtooth', body: 0.5 }); if (d > BEAT) pluck(f, t + BEAT / 2, d / 2, v * 0.5, { bright: 3000, type: 'triangle', body: 0.3 }); },
    oud: (f, t, d, v) => pluck(f, t, d, v * 1.3, { bright: 2400, type: 'sawtooth', body: 0.7, wet: 0.3 }),
    guitar: (f, t, d, v) => pluck(f, t, d, v * 1.3, { bright: 3000, type: 'sawtooth', body: 0.6, wet: 0.3 }),
    harp: (f, t, d, v) => pluck(f, t, d, v, { bright: 2500, type: 'triangle', body: 0.8, wet: 0.6 }),
    mandolin: (f, t, d, v) => { for (let s = 0; s < d - 0.02; s += BEAT / 4) pluck(f, t + s, BEAT / 3, v * (s ? 0.75 : 1), { bright: 4500, type: 'sawtooth', body: 0.3, wet: 0.3 }); },
  };
  const lead = INSTR[S.lead] || INSTR.brass;
  const lead2 = S.lead2 ? INSTR[S.lead2] : null;

  // Begleitung
  const tonic = S.tonic, scale = SC[S.scale];
  const prog = PROG[S.prog];
  const chordAt = b => prog[b % prog.length];
  const pad = (tones, t, dur, v = 0.04) => {
    if (S.pad === 'organ') { for (const n of tones) for (const m of [1, 2, 3]) voice('sine', st(tonic * 2, n) * m, t, dur, v * (m === 1 ? 1.2 : 0.5), { attack: 0.08, release: 0.3, wet: 0.5 }); return; }
    if (S.pad === 'power') { for (const n of tones.slice(0, 2)) for (const dt of [-10, 10]) voice('square', st(tonic, n), t, dur, v * 0.9, { attack: 0.01, release: 0.2, detune: dt, cut0: 1600, cut1: 900, q: 3, wet: 0.2 }); return; }
    for (const n of tones) for (const dt of [-9, 0, 9]) voice('sawtooth', st(tonic * 2, n), t, dur, v, { attack: Math.min(0.6, dur / 3), release: Math.min(0.9, dur / 2), detune: dt, cut0: 700, cut1: 1400, wet: 0.5 });
  };
  const strum = (tones, t, v = 0.05) => tones.forEach((n, i) => pluck(st(tonic * 2, n), t + i * 0.018, BEAT * 0.9, v, { bright: 2600, type: 'sawtooth', body: 0.4, wet: 0.25 }));
  const bassNote = (n, t, d, v = 0.15) => { voice('sawtooth', st(tonic / 2, n), t, d, v, { attack: 0.005, release: 0.06, cut0: 900, cut1: 250, wet: 0 }); voice('square', st(tonic / 4, n), t, d, v * 0.45, { attack: 0.005, release: 0.06, wet: 0 }); };

  // ---------- Einstieg (0–3,75 s) ----------
  const c0 = chordTones(...chordAt(0));
  pad(c0, 0, 3.6, 0.04);
  voice('sine', tonic / 2, 0, 3.6, 0.16, { attack: 1.2, release: 0.6, wet: 0.2 });
  if (S.drone === 'didge') {   // Didgeridoo: tiefer Grundton mit wanderndem Formant
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = tonic / 2;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6; f.frequency.value = 350;
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 2.3; lg.gain.value = 220; l.connect(lg).connect(f.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at(0)); g.gain.exponentialRampToValueAtTime(0.35, at(0.6)); g.gain.setValueAtTime(0.35, at(14.2)); g.gain.exponentialRampToValueAtTime(0.0001, at(15.2));
    o.connect(f).connect(g); out(g, 0.2); o.start(at(0)); l.start(at(0)); o.stop(at(15.3)); l.stop(at(15.3));
  }
  if (S.gong) gong(0.05, 0.22);
  if (S.drums === 'taiko') { drum(0.3, 90, 55, 0.9, 0.5, 0.4); drum(1.5, 90, 55, 0.9, 0.5, 0.4); drum(2.4, 90, 55, 0.6, 0.4, 0.4); drum(2.7, 90, 55, 0.6, 0.45, 0.4); }
  else for (let k = 0; k < 14; k++) hat(0.4 + k * 0.234, 0.018 + k * 0.003);
  // Kleines Motiv des Leitinstruments im Einstieg (nicht bei Blech – das setzt erst beim Abtauchen ein)
  if (!['brass', 'trumpet', 'guitarDist', 'synth'].includes(S.lead)) {
    const intro = [0, 2, 4].map(i => scale[i % scale.length]);
    intro.forEach((n, i) => lead(st(tonic * 4, n), 1.0 + i * 0.5, 0.45, 0.06));
  }
  riser(1.6, 1.8, 0.18);
  boom(3.4, 0.9);
  lead(st(tonic * 2, 0), 3.4, 0.4, 0.1); lead(st(tonic * 2, 7), 3.4, 0.4, 0.08);
  if (S.gong) gong(3.4, 0.18);

  // ---------- Melodie (je Strecke eigen, aus Tonleiter und Akkordtönen) ----------
  const RHY = [
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
    [[0, 2], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1], [3, 1]], [[0, 1], [1, 1.5], [2.5, 0.5], [3, 1]],
  ];
  const deg = []; for (let o = 0; o < 3; o++) for (const n of scale) deg.push(n + 12 * o);   // Tonvorrat über drei Oktaven
  let cur = deg.indexOf(scale[0] + 12) >= 0 ? deg.indexOf(scale[0] + 12) : scale.length;
  const motifA = RHY[Math.floor(R() * RHY.length)], motifB = RHY[Math.floor(R() * RHY.length)];
  const nearestChordTone = (root, q) => { const ct = chordTones(root, q).map(n => ((n % 12) + 12) % 12); let best = cur, bd = 99; for (let i = 0; i < deg.length; i++) { if (!ct.includes(((deg[i] % 12) + 12) % 12)) continue; const d = Math.abs(i - cur) + (i < cur ? 0.1 : 0); if (d < bd) { bd = d; best = i; } } return best; };
  const melody = [];
  for (let b = 0; b < S.bars; b++) {
    const last = b === S.bars - 1;
    const rhythm = last ? [[0, 4]] : (b % 2 ? motifB : motifA);
    const [root, q] = chordAt(b);
    const up = b < S.bars / 2 ? 1 : -1;   // erst steigend, dann fallend (Spannungsbogen)
    rhythm.forEach(([beat, l], i) => {
      if (i === 0 || l >= 1.5) cur = nearestChordTone(root, q);
      else cur = Math.max(0, Math.min(deg.length - 1, cur + (R() < 0.7 ? up : -up) * (R() < 0.75 ? 1 : 2)));
      melody.push([b, beat, l, deg[cur]]);
    });
  }

  // ---------- Hauptteil (3,75–15 s) ----------
  for (let b = 0; b < S.bars; b++) {
    const tb = MAIN0 + b * BAR, [root, q] = chordAt(b), tones = chordTones(root, q);
    const lift = tb >= 11.2 ? 1 : 0;
    pad(tones, tb, BAR + 0.1, 0.03 + lift * 0.01);
    if (S.harp) for (let s = 0; s < 8; s++) INSTR.harp(st(tonic * 2, tones[s % 3] + (s >= 3 ? 12 : 0)), tb + s * BEAT / 2, BEAT, 0.05);
    if (S.strum) for (let k = 0; k < 4; k++) strum(tones, tb + k * BEAT + (k % 2 ? BEAT / 2 : 0), 0.035);
    if (S.stabs) for (const k of [0.5, 1.5, 2.5, 3.5]) pad(tones, tb + k * BEAT, BEAT * 0.35, 0.035);
    if (S.arp && b >= 1) { const arp = [tones[0] + 12, tones[1] + 12, tones[2] + 12, tones[1] + 24]; for (let s = 0; s < 16; s++) voice('triangle', st(tonic * 2, arp[s % 4] + lift * 12), tb + s * BEAT / 4, BEAT / 4 - 0.02, 0.045, { attack: 0.003, release: 0.08, cut0: 3000, cut1: 1200, wet: 0.35 }); }
    // Bass
    if (S.bass === 'drive8') for (let e = 0; e < 8; e++) bassNote(e === 6 ? root + 7 : root, tb + e * BEAT / 2, BEAT / 2 - 0.02);
    else if (S.bass === 'oompah') for (let k = 0; k < 4; k++) { if (k % 2 === 0) bassNote(k === 2 ? root + 7 : root, tb + k * BEAT, BEAT * 0.8, 0.17); else pad(tones, tb + k * BEAT, BEAT * 0.3, 0.03); }
    else if (S.bass === 'pulse') for (let k = 0; k < 4; k++) bassNote(root, tb + k * BEAT + BEAT / 2, BEAT / 2 - 0.02, 0.17);
    else if (S.bass === 'walk') for (let k = 0; k < 4; k++) bassNote(root + [0, 4, 7, 9][k], tb + k * BEAT, BEAT * 0.9, 0.15);
    else bassNote(root, tb, BAR * 0.95, 0.13);
    // Schlagzeug
    for (let k = 0; k < 4; k++) {
      const t = tb + k * BEAT, e = BEAT / 2, s16 = BEAT / 4;
      switch (S.drums) {
        case 'rock': kick(t, k % 2 ? 0.55 : 0.85); if (k === 2) kick(t + e, 0.5); if (k % 2) snare(t); hat(t, 0.04); hat(t + e, 0.05); break;
        case 'house': kick(t, 0.85); hat(t + e, 0.07, true); if (k % 2) clap(t, 0.18); hat(t + s16, 0.02); hat(t + 3 * s16, 0.02); break;
        case 'epic': kick(t, k % 2 ? 0.6 : 0.85); if (k % 2) snare(t); hat(t + e, 0.05); if (lift) hat(t + s16, 0.03); break;
        case 'soft': if (k === 0) kick(t, 0.45); if (k === 2) snare(t, 0.12); hat(t + e, 0.025); break;
        case 'taiko': if (k === 0 || k === 3) drum(t, 95, 55, 0.7, 0.6, 0.35); if (k === 1) drum(t + e, 95, 55, 0.5, 0.45, 0.35); noise(t + e, 0.05, 0.05, { f0: 2500, f1: 2500, q: 2 }); break;
        case 'toms': drum(t, k % 2 ? 160 : 110, k % 2 ? 120 : 80, 0.35, 0.45, 0.3); if (k === 3) drum(t + e, 200, 150, 0.25, 0.35, 0.3); hat(t + e, 0.03); break;
        case 'darbuka': { const pat = [1, 2, 0, 2, 1, 0, 2, 0]; for (const [i, sub] of [[k * 2, 0], [k * 2 + 1, e]]) { if (pat[i] === 1) drum(t + sub, 140, 90, 0.25, 0.6, 0.2); if (pat[i] === 2) noise(t + sub, 0.08, 0.16, { f0: 3200, f1: 2600, q: 4, wet: 0.2 }); } break; }
        case 'dembow': kick(t, 0.8); if (k % 2 === 0) { snare(t + 3 * s16, 0.22); } else { snare(t - s16 + e, 0.18); snare(t + e, 0.2); } hat(t + e, 0.04); break;
        case 'samba': if (k === 1 || k === 3) drum(t, 75, 55, 0.4, k === 3 ? 0.75 : 0.5, 0.1); for (let x = 0; x < 4; x++) noise(t + x * s16, 0.04, x === 2 ? 0.08 : 0.04, { type: 'highpass', f0: 6000, f1: 7000 }); if (k % 2 === 0) noise(t + s16 * 3, 0.06, 0.12, { f0: 3500, f1: 3500, q: 6 }); break;
        case 'flamenco': for (const [x, a] of [[0, 0.22], [2, 0.12], [3, 0.18]]) clap(t + x * s16, a); if (k === 3) noise(t + e, 0.05, 0.14, { type: 'highpass', f0: 4000, f1: 5000 }); break;
        case 'military': kick(t, k % 2 ? 0.4 : 0.7); for (let x = 0; x < 4; x++) snare(t + x * s16, x === 0 ? 0.22 : 0.08); break;
        case 'oompah': if (k % 2) snare(t, 0.14); hat(t + e, 0.03); break;
        case 'swing': kick(t, k % 2 ? 0.35 : 0.6); if (k % 2) snare(t, 0.14); hat(t, 0.05, true); hat(t + BEAT * 2 / 3, 0.035); break;
        default: kick(t); if (k % 2) snare(t); hat(t + e);
      }
    }
    if (b === 0 || (lift && tb - BAR < 11.2)) noise(tb, 1.4, 0.11, { type: 'highpass', f0: 5000, f1: 3500, wet: 0.5 });
  }
  for (const [b, beat, l, n] of melody) {
    const t = MAIN0 + b * BAR + beat * BEAT, lift = t >= 11.2 ? 1 : 0;
    lead(st(tonic * 2, n), t, l * BEAT - 0.03, 0.085 + lift * 0.02);
    if (lead2 && (b >= Math.floor(S.bars / 2) || S.lead2 === 'trumpet3')) lead2(st(tonic * 2, n), t, l * BEAT - 0.03, 0.05);
  }
  riser(9.6, 1.6, 0.15);
  boom(11.25, 0.8);
  if (S.gong) gong(11.25, 0.16);

  // ---------- Schluss ab 15 s ----------
  const fin = S.final === 'minor' ? [0, 3, 7, 12] : S.final === 'fifth' ? [0, 7, 12, 19] : [0, 4, 7, 12];
  boom(MAIN1, 1.05);
  if (S.gong) gong(MAIN1, 0.25);
  pad(fin, MAIN1, 2.3, 0.045);
  lead(st(tonic * 2, 12), MAIN1, 1.7, 0.11); lead(st(tonic * 2, 7), MAIN1, 1.7, 0.08);
  voice('sawtooth', tonic / 2, MAIN1, 2.0, 0.13, { attack: 0.01, release: 1.2, cut0: 600, cut1: 150, wet: 0.2 });

  bus.gain.setValueAtTime(VOL, at(16.4));
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
