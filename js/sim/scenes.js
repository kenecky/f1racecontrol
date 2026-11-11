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

// Autos dürfen nicht durcheinander hindurchfahren: seitlich auseinanderschieben
// (außer in den Bildern der Berührung selbst), danach die Linie glätten.
const CAR_W = 2.05;
function separate(fA, fB, keep = []) {
  const n = fA.length, need = new Array(n).fill(0), sgn = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const a = fA[i], b = fB[i];
    const d = a[1] - b[1];
    sgn[i] = d === 0 ? 1 : Math.sign(d);
    if (keep.includes(i) || Math.abs(a[0] - b[0]) >= CAR_LEN * 1.05) continue;
    need[i] = d;   // vorläufig: Abstand merken
  }
  // Eine Seite für die ganze Szene (wer außen ist, bleibt außen)
  let sum = 0;
  for (let i = 0; i < n; i++) if (!keep.includes(i) && Math.abs(fA[i][0] - fB[i][0]) < CAR_LEN * 1.05) sum += fA[i][1] - fB[i][1];
  const side = sum >= 0 ? 1 : -1;
  sgn.fill(side);
  for (let i = 0; i < n; i++) {
    if (keep.includes(i) || Math.abs(fA[i][0] - fB[i][0]) >= CAR_LEN * 1.05) { need[i] = 0; continue; }
    need[i] = Math.max(0, CAR_W + 0.2 - side * (fA[i][1] - fB[i][1])) / 2;
  }
  // Ausweichen weich ein- und ausblenden (kein Springen zur Seite)
  const R = 8;
  for (let i = 0; i < n; i++) {
    if (keep.includes(i)) continue;
    let p = 0, sg = sgn[i];
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) {
      const v = need[j] * (1 - Math.abs(i - j) / (R + 1));
      if (v > p) { p = v; sg = sgn[j]; }
    }
    fA[i][1] += sg * p;
    fB[i][1] -= sg * p;
  }
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
  if (ci >= 0) {
    // Berührung: genau Seite an Seite, Räder berühren sich
    const d = fA[ci][1] - fB[ci][1];
    const mid = (fA[ci][1] + fB[ci][1]) / 2, sg = d === 0 ? turn : Math.sign(d);
    fA[ci][1] = mid + sg * CAR_W / 2; fB[ci][1] = mid - sg * CAR_W / 2;
  }
  separate(fA, fB, ci >= 0 ? [ci] : []);
  const vf = victim === A ? fA : fB;
  afterContact(vf, ci, consequence, turn, victim === A ? turn : -turn);
  if (ci >= 0) afterContact(victim === A ? fB : fA, ci, 'minor', turn, victim === A ? -turn : turn);
  if (ci >= 0) separate(fA, fB, [ci, ci + 1]);
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
  separate(fA, fB);
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
  separate(fA, fB);
  return finish('offTrackPass', corner, [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }], {
    contact: null,
    overlay: { kind: 'edge', a: 0, label: 'Streckenbegrenzung' },
  });
}

// ---------- Unsichere Freigabe in der Boxengasse ----------
// Boxengasse liegt neben der Strecke: Fahrgasse und Arbeitsgasse vor den Garagen.
export const PIT = { wall: HALF_W + 4, fast: HALF_W + 8, work: HALF_W + 12.5, garage: HALF_W + 16 };
export function sceneUnsafeRelease(race, { A, B, box, side, gap, contact }) {
  const vLim = 22.2;                 // 80 km/h
  const tRel = 1.4;                  // Freigabe von A
  const n = 61;
  const fA = [], fB = [];
  // A: steht in der Box, beschleunigt, zieht in die Fahrgasse
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const tt = Math.max(0, t - tRel);
    const v = Math.min(vLim, 6.5 * tt);
    const sA = tt < vLim / 6.5 ? 0.5 * 6.5 * tt * tt : 0.5 * vLim * vLim / 6.5 + vLim * (tt - vLim / 6.5);
    const latA = side * lerp(PIT.work, PIT.fast, smooth(sA / 10));
    fA.push([sA, latA, tt === 0 ? -side * 0.35 : -side * 0.35 * (1 - smooth(sA / 10)), v]);
  }
  // B: kommt in der Fahrgasse; Abstand beim Einfädeln = gap Sekunden
  const iJoin = fA.findIndex(f => f[0] >= 8);
  const sB0 = fA[iJoin][0] - gap * vLim - (iJoin * DT) * vLim;
  let sB = sB0, vB = vLim;
  let contactI = -1;
  for (let i = 0; i < n; i++) {
    const ahead = fA[i][0] - sB;
    const sameLane = Math.abs(fA[i][1] - side * PIT.fast) < 1.6;
    if (sameLane && ahead > 0 && ahead < CAR_LEN + 6) {
      // B muss bremsen – bei Berührung erst knapp danach
      const minGap = contact && contactI < 0 ? CAR_LEN * 0.92 : CAR_LEN + 1.2;
      if (ahead < minGap + 0.3 && contact && contactI < 0) contactI = i;
      vB = Math.max(fA[i][3] * 0.9, vB - 9 * DT);
      if (ahead - vB * DT < minGap) sB = fA[i][0] - minGap; else sB += vB * DT;
    } else {
      vB = Math.min(vLim, vB + 4 * DT);
      sB += vB * DT;
    }
    const swerve = sameLane && ahead > 0 && ahead < 12 ? -side * 0.9 * (1 - ahead / 12) : 0;
    fB.push([sB, side * PIT.fast + swerve, 0]);
  }
  for (const f of fA) f.length = 3;
  return {
    type: 'unsafeRelease', d0: box, turn: 1, corner: 'PIT', dt: DT, dur: (n - 1) * DT, pit: { side },
    cars: [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }],
    contact: contactI >= 0 ? contactI * DT : null,
    overlay: { kind: 'release', t: iJoin * DT, a: 0, b: 1, label: 'Abstand beim Einfädeln' },
  };
}

// ---------- Unsichere Rückkehr auf die Strecke ----------
export function sceneUnsafeRejoin(race, { A, B, d0, cid, side, unsafe, v, contact }) {
  const n = 61;
  const vB = clamp(v, 25, 75);
  const tGo = 1.2;                       // A fährt los
  const fA = [], fB = [];
  const off = side * (HALF_W + 7);       // Position neben der Strecke
  const line = unsafe ? -side * 1.5 : side * (HALF_W - 1.5);   // unsicher: quer auf die Ideallinie
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const tt = Math.max(0, t - tGo);
    const vA = Math.min(unsafe ? 30 : 20, 7 * tt);
    const sA = 0.5 * 7 * Math.min(tt, (unsafe ? 30 : 20) / 7) ** 2 + Math.max(0, tt - (unsafe ? 30 : 20) / 7) * (unsafe ? 30 : 20);
    const k = smooth(sA / (unsafe ? 14 : 30));
    const latA = lerp(off, line, k);
    const ang = tt === 0 ? -side * 0.9 : -side * 0.9 * (1 - smooth(sA / (unsafe ? 16 : 24)));
    fA.push([sA, latA, ang]);
  }
  // B: kommt mit Renntempo; Treffpunkt kurz nach der Rückkehr
  const iMeet = Math.min(n - 1, Math.round((tGo + (unsafe ? 1.6 : 2.6)) / DT));
  let sB = fA[iMeet][0] - CAR_LEN * (unsafe ? 0.6 : -3) - vB * iMeet * DT;
  let vb = vB, contactI = -1, lat = -side * 1;
  for (let i = 0; i < n; i++) {
    const ahead = fA[i][0] - sB;
    let target = -side * 1;
    if (unsafe && ahead > -3 && ahead < 45) {
      // B muss bremsen und auf die andere Seite ausweichen
      vb = Math.max(vB * 0.5, vb - 22 * DT);
      target = side * (HALF_W - 1.3);
      if (contact && contactI < 0 && ahead < CAR_LEN && ahead > -1 && Math.abs(lat - fA[i][1]) < 2.3) contactI = i;
    } else vb = Math.min(vB, vb + 6 * DT);
    lat += clamp(target - lat, -0.45, 0.45);
    sB += vb * DT;
    fB.push([sB, lat, 0]);
  }
  separate(fA, fB, contactI >= 0 ? [contactI] : []);
  return {
    type: 'unsafeRejoin', d0, turn: side, corner: cid, dt: DT, dur: (n - 1) * DT,
    cars: [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }],
    contact: contactI >= 0 ? contactI * DT : null,
    overlay: { kind: 'rejoin', t: iMeet * DT, a: 0, b: 1, label: 'Abstand bei der Rückkehr' },
  };
}

// ---------- Massenunfall ----------
// outcomes: je Auto 'dnf' | 'damage' | 'spin'; blame: 'follower' (zu spät gebremst) | 'chain'
export function scenePileup(race, { cars, corner, outcomes, blame }) {
  const turn = corner.turn || 1;
  const vc = clamp((corner.vmax || 120) / 3.6, 18, 60);
  const n = 61;
  // Führendes Auto: normal (bei „chain“ ungewöhnlich früh) bremsen
  const sA = runPath(-120, speedProfile(vc, blame === 'chain' ? -35 : 0), 6);
  const tHit = cars.map((c, k) => (k === 0 ? null : 1.9 + (k - 1) * 0.35));
  const frames = cars.map(() => []);
  const sides = cars.map((c, k) => (k % 2 ? -1 : 1) * (k === 1 ? turn : -turn));
  for (let k = 0; k < cars.length; k++) {
    const lat0 = (k % 2 ? 1 : -1) * 1.2 + (k > 2 ? (k % 2 ? 2 : -2) : 0);
    let hitAt = k === 0 ? tHit[1] : tHit[k];
    let last = null, v = 0, lat = lat0, rot = 0;
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      let s;
      if (t <= hitAt || last === null) {
        // vor dem Einschlag: Kolonne, der Abstand schrumpft bis zum Treffer
        const gap0 = 12 * k, gapHit = k * CAR_LEN * 0.92;
        const kk = k === 0 ? 0 : smooth(t / hitAt);
        s = sA[i] - lerp(gap0, gapHit, kk);
        v = last === null ? 60 : (s - last[0]) / DT;
      } else {
        // nach dem Einschlag: je nach Folge abbremsen, rutschen, drehen
        const o = outcomes[k];
        const dt2 = t - hitAt;
        const decay = o === 'dnf' ? Math.exp(-dt2 * 2.2) : o === 'spin' ? Math.exp(-dt2 * 1.2) : 0.75;
        s = last[0] + Math.max(0, v * decay) * DT;
        const drift = o === 'dnf' ? HALF_W + 3 + k * 0.8 : o === 'spin' ? 4.5 : 1.2;
        lat = lat0 + sides[k] * drift * smooth(dt2 / 1.3);
        rot = sides[k] * (o === 'dnf' ? 1.3 : o === 'spin' ? Math.PI * 2 : 0.15) * smooth(dt2 / 1.4);
      }
      frames[k].push([s, last === null || t <= hitAt ? lat0 : lat, rot]);
      last = frames[k][i];
    }
  }
  const iBrake = sA.findIndex((x, i) => i > 0 && sA[i] - sA[i - 1] < sA[1] - sA[0] - 0.4);
  return {
    type: 'pileup', d0: corner.d, turn, corner: corner.id, dt: DT, dur: (n - 1) * DT,
    cars: cars.map((c, k) => ({ ...teamLook(c), f: frames[k] })),
    contact: tHit[1],
    overlay: { kind: 'rejoin', t: Math.max(0, iBrake) * DT, a: 0, b: 1, label: `Abstand ${cars[1].id} zu ${cars[0].id} beim Bremsen` },
  };
}

// Position eines Autos zur Zeit t (interpoliert)
export function sceneCarAt(scene, car, t) {
  const f = car.f;
  const x = clamp(t / scene.dt, 0, f.length - 1);
  const i = Math.floor(x), k = Math.min(f.length - 1, i + 1), w = x - i;
  const a = f[i], b = f[k];
  return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
}

// ---------- Mehrfacher Richtungswechsel (Verteidigung auf der Geraden) ----------
// Verteidiger A vorne, Angreifer B im Windschatten. moves = Anzahl der Richtungswechsel von A.
export function sceneWeaving(race, { A, B, corner, moves }) {
  const turn = corner.turn || 1;
  const n = 46, v = 74;                     // ~266 km/h auf der Geraden
  const fA = [], fB = [];
  // Zeitpunkte der Bewegungen von A und die Seite, auf die er zieht
  const tMoves = moves >= 2 ? [0.9, 2.2, 3.3].slice(0, moves) : [1.2];
  const sides = [turn, -turn, turn];
  const latAt = t => {
    let lat = 0;
    tMoves.forEach((tm, i) => { lat = lerp(lat, sides[i] * 3.6, smooth((t - tm) / 0.55)); });
    // ein einzelner Richtungswechsel: danach bleibt A innen (erlaubt)
    return lat;
  };
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const sA = -380 + v * t;
    const lA = latAt(t);
    fA.push([sA, lA, 0]);
    // B im Windschatten, versucht auf die freie Seite auszuweichen
    const gap = lerp(16, 7, smooth(t / 2.5));
    const want = -Math.sign(lA || -turn) * 3.4;
    const lB = lerp(0, want, smooth((t - 0.4) / 0.9));
    fB.push([sA - gap, i ? lerp(fB[i - 1][1], lB, 0.35) : 0, 0]);
  }
  separate(fA, fB);
  return {
    type: 'weaving', d0: corner.d, turn, corner: corner.id, dt: DT, dur: (n - 1) * DT,
    cars: [{ ...teamLook(A), f: fA }, { ...teamLook(B), f: fB }],
    contact: null,
    overlay: { kind: 'trail', a: 0, moves: tMoves, label: 'Richtungswechsel' },
  };
}

// ---------- Schikane abgekürzt ----------
// Auto verbremst sich und fährt geradeaus über den Auslauf, kommt hinter der Kurve wieder auf die Strecke.
export function sceneChicaneCut(race, { A, corner, gain }) {
  const turn = corner.turn || 1;
  const vc = clamp((corner.vmax || 100) / 3.6, 16, 40);
  const n = 56, fA = [];
  const v = speedProfile(vc, 18);           // bremst zu spät
  const sPath = runPath(-150, v, (n - 1) * DT);
  sPath.forEach(s => {
    // Ideallinie, aber in der Kurve geradeaus über den Auslauf (Innenseite der Schikane)
    let lat = racingLine(turn, s);
    if (s > -30 && s < 60) lat = lerp(lat, turn * (HALF_W + 7), smooth((s + 30) / 25) * (1 - smooth((s - 30) / 30)));
    fA.push([s, lat, 0]);
  });
  return {
    type: 'chicaneCut', d0: corner.d, turn, corner: corner.id, dt: DT, dur: (n - 1) * DT,
    cars: [{ ...teamLook(A), f: fA }],
    contact: null,
    overlay: { kind: 'trail', a: 0, cut: true, gain, label: 'Abkürzung' },
  };
}

// ---------- Fehlstart ----------
// Nur das eine Auto in seiner Startbox. Die fünf Lichter gehen an, das Auto bewegt sich (zu früh?),
// dann gehen die Lichter aus und es fährt los.
export function sceneJumpStart(race, { A, d, side, early, dist, real }) {
  const n = 76;
  const allOn = 4.5;
  const hold = clamp(race.lightsTimer - 9, 0.4, 2.5);    // Pause nach dem 5. Licht (PRESTART 5 + 4)
  const tOut = allOn + hold;
  const tMove = Math.max(allOn + 0.1, tOut - clamp(early, 0.05, 1.2));
  const lat = side * 3.3;
  const fA = [];
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    let s = 0;
    if (t > tMove) {
      // echter Fehlstart: rollt bis zum Signal weiter · Zucken: kurz vor, dann Stillstand
      const k = real ? smooth((t - tMove) / Math.max(0.3, tOut - tMove)) : smooth((t - tMove) / 0.35);
      s = dist * clamp(k, 0, 1);
    }
    if (t > tOut) { const tt = t - tOut - 0.2; if (tt > 0) s += 0.5 * 9 * tt * tt; }
    fA.push([s, lat, 0]);
  }
  return {
    type: 'jumpStart', d0: d, turn: 1, corner: 'GRID', dt: DT, dur: (n - 1) * DT,
    cars: [{ ...teamLook(A), f: fA }],
    contact: null,
    grid: { side, lat },
    lights: { allOn, out: tOut },
    overlay: { kind: 'jump', a: 0, out: tOut, label: 'Bewegung vor Lichter aus' },
  };
}
