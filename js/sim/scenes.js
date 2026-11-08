// Rennszenen: kurze Nachstellung eines Vorfalls in der Draufsicht.
// Die Szene wird aus dem erzeugt, was beim Vorfall wirklich passiert ist (interne Wahrheit),
// und als reine Daten im Fall gespeichert (Spielstand, immer gleiche Wiedergabe).
// Koordinaten: s = Meter entlang der Strecke relativ zur Kurve, lat = Meter quer (+ = rechts).

const DT = 0.1;            // Abstand der Bilder (s)
export const CAR_LEN = 5.6;
export const HALF_W = 6.5;  // halbe Streckenbreite (m)

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

function teamLook(car) {
  const hex = car.team.color.replace('#', '');
  const n = parseInt(hex, 16);
  const lum = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
  return { id: car.id, num: car.driver.number, c1: car.team.color, c2: lum > 150 ? '#14171f' : '#f2f2f2' };
}

// Geschwindigkeit über der Strecke: anbremsen, Kurve, herausbeschleunigen
function speedProfile(vc, lateBrake = 0) {
  const entry = -25 + lateBrake;
  return s => {
    if (s < entry) return Math.min(88, Math.sqrt(vc * vc + 2 * 42 * (entry - s)));
    if (s < 18) return vc;
    return Math.min(88, Math.sqrt(vc * vc + 2 * 11 * (s - 18)));
  };
}

function runPath(s0, v, dur) {
  const out = [];
  let s = s0;
  for (let t = 0; t <= dur + 1e-6; t += 0.02) {
    if (Math.abs(t / DT - Math.round(t / DT)) < 1e-6) out.push(s);
    s += v(s) * 0.02;
  }
  return out;
}

// Ideallinie: außen anbremsen, innen Scheitelpunkt, außen hinaus
function racingLine(turn, s, early = 0) {
  const inside = turn * 3.8, outside = -turn * 4.2;
  if (s < -70 - early) return outside;
  if (s < 0 - early) return lerp(outside, inside, smooth((s + 70 + early) / 70));
  if (s < 70) return lerp(inside, outside, smooth((s + early) / (70 + early)));
  return outside;
}

function finish(type, corner, cars, extra = {}) {
  return { type, d0: corner.d, turn: corner.turn, corner: corner.id, dt: DT, dur: (cars[0].f.length - 1) * DT, cars, ...extra };
}

// Erster Zeitpunkt, an dem sich zwei Autos berühren
function findContact(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) < CAR_LEN * 0.95 && Math.abs(a[i][1] - b[i][1]) < 2.05) return i;
  }
  return -1;
}

// Nach einer Berührung: Dreher / Ausfall des Opfers nachstellen
function afterContact(f, i, how, turn, side) {
  if (i < 0) return;
  const base = f[i];
  for (let k = i + 1; k < f.length; k++) {
    const t = (k - i) * DT;
    if (how === 'spin' || how === 'dnf') {
      const slow = how === 'dnf' ? 1 - smooth(t / 1.6) : 1 - 0.7 * smooth(t / 2);
      const ds = (f[k][0] - f[k - 1][0]) * slow;
      const s = f[k - 1][0] + Math.max(0, ds);
      f[k] = [s, clamp(base[1] + side * 7 * smooth(t / 1.4), -HALF_W - 14, HALF_W + 14), side * Math.min(1, t / 1.5) * Math.PI * (how === 'dnf' ? 0.6 : 2)];
    } else {
      f[k] = [f[k][0], f[k][1] + side * 0.6 * Math.sin(Math.min(t, 0.6) * 5) * Math.exp(-t * 2), side * 0.12 * Math.exp(-t * 3)];
    }
  }
}

// ---------- Kollision: A greift B innen an ----------
export function sceneCollision(race, { A, B, corner, blame, overlap, consequence, victim }) {
  const turn = corner.turn || 1;
  const vc = clamp((corner.vmax || 120) / 3.6, 18, 60);
  const dur = 6;
  const sB = runPath(-150, speedProfile(vc), dur);
  // Vorderachse von A bei ov·Fahrzeuglänge von B beim Einlenken
  const ov = clamp(overlap / 100, 0.05, 1.1);
  const target = -(1 - ov) * CAR_LEN + (blame === 'attacker' ? 1.5 : 0);
  const tTurn = sB.findIndex(s => s > -60);
  const fB = [], fA = [];
  sB.forEach((s, i) => {
    const k = tTurn > 0 ? smooth(i / tTurn) : 1;
    const off = lerp(-16, target, k) + (blame === 'attacker' ? Math.max(0, i - tTurn) * 0.06 : 0);
    // B: Ideallinie – bei Schuld des Verteidigers lenkt er früh und hart nach innen
    const latB = blame === 'defender' ? racingLine(turn, s, 28) : racingLine(turn, s);
    // A: innen; bei Schuld des Angreifers rutscht er am Scheitel nach außen in B hinein
    let latA = lerp(-turn * 1.5, turn * 4.6, smooth((s + off + 150) / 70));
    if (blame === 'attacker' && s + off > -25) latA = lerp(turn * 4.6, turn * 0.8, smooth((s + off + 25) / 30));
    if (blame === 'racing' && s + off > -15) latA = lerp(turn * 4.6, turn * 2.6, smooth((s + off + 15) / 25));
    fB.push([s, latB, 0]);
    fA.push([s + off, latA, 0]);
  });
  const ci = findContact(fA, fB);
  const vf = victim === A ? fA : fB;
  afterContact(vf, ci, consequence, turn, victim === A ? turn : -turn);
  if (ci >= 0) afterContact(victim === A ? fB : fA, ci, 'minor', turn, victim === A ? -turn : turn);
  const iTurn = Math.max(0, tTurn);
  return finish('collision', corner, [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }], {
    contact: ci >= 0 ? ci * DT : null,
    overlay: { kind: 'overlap', t: iTurn * DT, a: 0, b: 1, label: 'Überlappung beim Einlenken' },
  });
}

// ---------- Abdrängen: A außen, B zieht am Ausgang nach außen ----------
export function sceneForcedOff(race, { A, B, corner, fault, overlap }) {
  const turn = corner.turn || 1;
  const vc = clamp((corner.vmax || 120) / 3.6, 18, 60);
  const sB = runPath(-150, speedProfile(vc), 6);
  const ov = clamp(overlap / 100, 0.05, 1.1);
  const apexI = sB.findIndex(s => s > 0);
  const fA = [], fB = [];
  sB.forEach((s, i) => {
    const k = apexI > 0 ? smooth(i / apexI) : 1;
    const off = lerp(-14, -(1 - ov) * CAR_LEN, k) - (i > apexI ? (i - apexI) * 0.25 : 0);
    // B: am Ausgang bei Schuld weit über die Ideallinie hinaus bis an den Rand
    let latB = racingLine(turn, s);
    if (s > 0 && fault) latB = lerp(turn * 3.8, -turn * (HALF_W - 0.9), smooth(s / 45));
    // A: außen, muss neben die Strecke
    const sa = s + off;
    let latA = -turn * 5.3 + turn * 0.6 * smooth((sa + 150) / 80);
    const squeeze = fault ? smooth(sa / 40) : smooth((sa - 10) / 50);
    if (sa > -5) latA = lerp(-turn * 4.7, -turn * (HALF_W + 3.5), squeeze);
    if (sa > 60) latA = lerp(-turn * (HALF_W + 3.5), -turn * 4.5, smooth((sa - 60) / 60));
    fB.push([s, latB, 0]);
    fA.push([sa, latA, 0]);
  });
  return finish('forcedOff', corner, [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }], {
    contact: null,
    overlay: { kind: 'overlap', t: Math.max(0, apexI) * DT, a: 0, b: 1, label: 'Überlappung am Scheitelpunkt' },
  });
}

// ---------- Überholen neben der Strecke ----------
export function sceneOffTrackPass(race, { A, B, corner, wheels }) {
  const turn = corner.turn || 1;
  const vc = clamp((corner.vmax || 120) / 3.6, 18, 60);
  const sB = runPath(-140, speedProfile(vc), 6);
  const out = wheels >= 4 ? HALF_W + 1.6 : HALF_W - 0.2 + (wheels - 2) * 0.4;   // Mitte von A jenseits der Linie
  const fA = [], fB = [];
  sB.forEach((s, i) => {
    const off = -10 + i * 0.32;               // A ist schneller und kommt vorbei
    const sa = s + off;
    fB.push([s, racingLine(turn, s), 0]);
    let latA = lerp(-turn * 1.5, -turn * 4.6, smooth((sa + 140) / 60));
    if (sa > -10 && sa < 70) latA = lerp(-turn * 4.6, -turn * out, smooth((sa + 10) / 25) * (1 - smooth((sa - 40) / 30)));
    fA.push([sa, latA, 0]);
  });
  return finish('offTrackPass', corner, [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }], {
    contact: null,
    overlay: { kind: 'edge', a: 0, label: 'Streckenbegrenzung' },
  });
}

// Position eines Autos zur Zeit t (interpoliert)
export function sceneCarAt(scene, car, t) {
  const f = car.f;
  const x = clamp(t / scene.dt, 0, f.length - 1);
  const i = Math.floor(x), k = Math.min(f.length - 1, i + 1), w = x - i;
  const a = f[i], b = f[k];
  return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
}
