// Startablauf: Formationsrunde, Startaufstellung, Startampel, Startabbruch,
// Boxengassenstart und Fehlstart. Vor dem Start läuft race.time schon mit
// (Bergungen, Flaggen); beim Erlöschen der Lichter wird die Uhr auf 0 gesetzt.
import { speedAt, wrapD, crossed, sectorIndexAt } from './trackModel.js';
import { updateHazards, startSpin, endOffTrack, startFailure, createHazard, retireCar, cornerLabel } from './hazards.js';
import { createJumpStartCase, createGridBoxCase } from './incidents.js';
import { startBehindSC, trackNeutralUse } from './neutral.js';
import { startLapMedical, updateServices } from './services.js';
import { rollStartRegs } from './regs.js';
import { rainAt } from './weather.js';
import { COMPOUNDS, bestCompound } from './tyres.js';

const F_SPEED = 0.65;   // Tempo in der Formationsrunde (Anteil der Renngeschwindigkeit) – langsam genug, dass ein Dreher aufholen kann
const F_VMAX = 62;      // m/s (~225 km/h)
const SLOT = 8;         // Abstand der Startplätze (m)
const slotD = i => -(6 + i * SLOT);
const slotOf = d => Math.round((-d - 6) / SLOT);

// ---------- Inspektionsrunde des Safety Cars (vor der Formationsrunde) ----------
// Das SC fährt eine Runde und meldet gegen Ende (etwa Sektor 10/11), ob die Strecke in Ordnung ist.
// Fast immer ist alles in Ordnung; selten findet es ein Problem, das die Rennleitung lösen muss
// (Kehrmaschine schicken, abwarten, Start verschieben …).
const INSPECT_SPEED = 0.7;
const INSPECT_ISSUE_CHANCE = 0.1;
const ANIMALS = ['Ein Hund', 'Ein Hase', 'Ein Murmeltier', 'Eine Katze', 'Ein paar Vögel', 'Ein Fuchs'];
const INSPECT_ISSUES = [
  { key: 'barrier', work: [140, 220], text: (c) => `Barriere in ${c} beschädigt – muss repariert werden` },
  { key: 'marshal', work: [20, 45], text: (c) => `Ein Marshal steht noch an der Fahrbahn in ${c}` },
  { key: 'dirt', work: [60, 110], sweep: true, text: (c) => `Dreck auf der Fahrbahn in ${c}` },
  { key: 'animal', work: [40, 100], text: (c, r) => `${r.pick(ANIMALS)} auf der Strecke in ${c}` },
  { key: 'oil', work: [90, 150], sweep: true, text: (c) => `Ölspur in ${c} – Bindemittel nötig` },
  { key: 'drain', work: [160, 260], text: (c) => `Lockerer Gullydeckel in ${c}` },
  { key: 'gravel', work: [40, 80], sweep: true, text: (c) => `Kies auf der Ideallinie in ${c}` },
  { key: 'object', work: [25, 50], text: (c) => `Werbeplane auf der Fahrbahn in ${c}` },
  { key: 'kerb', work: [120, 200], text: (c) => `Randstein in ${c} hat sich gelöst` },
  { key: 'cable', work: [30, 60], text: (c) => `TV-Kabel liegt auf der Fahrbahn in ${c}` },
  { key: 'tyres', work: [50, 90], text: (c) => `Reifenstapel in ${c} verschoben` },
];

export function sendInspection(race) {
  if (race.phase !== 'ready' || race.inspection) return false;
  const tr = race.track;
  race.inspection = { stage: 'lap', report: null, issue: null, dist: 0 };
  race.sc = { d: wrapD(tr, tr.pit.exit), v: 0, move: 0, inPit: false, inspection: true };
  race.emit('rc', 'Safety Car fährt die Inspektionsrunde.');
  return true;
}

// Vor der Formationsrunde: Inspektionsrunde, Bergung und Einsatzfahrzeuge laufen, die Autos stehen
export function stepReady(race, dt) {
  const I = race.inspection;
  const busy = (I && race.sc && race.sc.inspection) || race.hazards.some(h => !h.ended)
    || (race.svc && (race.svc.medical || race.svc.sweeper || race.svc.cranes.length));
  if (!busy) return;
  race.time += dt;
  const sc = race.sc;
  if (I && sc && sc.inspection) {
    const tr = race.track;
    const prev = sc.d;
    const vt = sc.inPit ? tr.pitLaneSpeed : speedAt(tr, sc.d) * INSPECT_SPEED;
    sc.v = vt > sc.v ? Math.min(vt, sc.v + 8 * dt) : vt;
    sc.move = sc.v * dt;
    sc.d = wrapD(tr, sc.d + sc.move);
    I.dist += sc.move;
    // Meldung gegen Ende der Runde (vorletzter Marshal-Sektor)
    if (I.stage === 'lap' && I.dist > tr.L * 0.3 && sectorIndexAt(tr, sc.d) >= tr.sectors.length - 2) inspectionReport(race, I.dist);
    if (I.stage === 'return' && !sc.inPit && crossed(tr, prev, sc.d, tr.pit.entry)) sc.inPit = true;
    else if (sc.inPit && crossed(tr, prev, sc.d, wrapD(tr, tr.pit.box))) { race.sc = null; I.stage = 'done'; }
  }
  updateHazards(race, dt);
  updateServices(race, dt);
}

function inspectionReport(race, dist) {
  const I = race.inspection, r = race.rng, tr = race.track;
  I.stage = 'return';
  if (!r.chance(INSPECT_ISSUE_CHANCE)) {
    I.report = 'ok';
    race.emit('rc', 'Safety Car: Inspektionsrunde beendet – die Strecke ist in Ordnung.');
    return;
  }
  const kind = r.pick(INSPECT_ISSUES);
  const d = wrapD(tr, tr.pit.exit + r.range(0.05, 0.95) * Math.min(dist, tr.L * 0.85));
  const h = createHazard(race, { type: 'inspect', issue: kind.key, d, need: 'double', work: r.range(kind.work[0], kind.work[1]), needsSweeper: !!kind.sweep });
  h.desc = kind.text(cornerLabel(h.corner), r);
  I.report = 'issue';
  I.issue = h.id;
  race.emit('rc', `Safety Car meldet: ${h.desc}.${kind.sweep ? ' Die Kehrmaschine wird gebraucht.' : ''}`, { hazard: h.id, sector: h.sector });
}

// ---------- Formationsrunde ----------

export function beginFormation(race) {
  const r = race.rng;
  const tr = race.track;
  const L = tr.L;
  const n = (race.formation ? race.formation.n : 0) + 1;
  const grid = race.cars.filter(c => !c.retired && !c.pitStart).sort((a, b) => b.d - a.d);
  const f = race.formation = {
    n, t: 0, gridT: 0,
    order: grid.map(c => c.id),
    backSlot: Math.max(0, ...grid.map(c => slotOf(c.d))) + 1,
    stall: null, gridStall: null, gridBox: null,
  };
  grid.forEach((c, i) => {
    c.v = 0;
    c.move = 0;
    c.fTarget = c.d + L;
    c.fSlot = slotOf(c.d);
    c.fDepart = 0.8 + i * 0.3 + r.range(0, 0.3);
    c.fIncident = null;
    c.jump = null;
  });

  // Was in dieser Formationsrunde passiert (bei einer Extra-Runde seltener)
  const k = n === 1 ? 1 : 0.5;
  const pool = () => grid.filter(c => c.fDepart !== Infinity && !c.fIncident);
  if (grid.length > 3 && r.chance(0.035 * k)) {
    const c = r.pick(grid.slice(1));
    c.fDepart = Infinity;
    f.stall = { id: c.id, at: 6 + r.range(0, 3) };
  }
  if (r.chance(0.07 * k)) {
    // Technischer Defekt – unzuverlässige Teams häufiger
    const cand = pool();
    const total = cand.reduce((s, c) => s + 101 - c.team.reliability, 0);
    let x = r.next() * total;
    const c = cand.find(cc => (x -= 101 - cc.team.reliability) <= 0) || cand[0];
    c.fIncident = { type: 'failure', at: c.d + r.range(0.12, 0.85) * L };
  }
  if (r.chance((0.03 + 0.12 * race.weather.wetness) * k)) {
    // Dreher beim Aufwärmen der Reifen
    const c = r.pick(pool());
    const corner = r.pick(tr.corners);
    const ahead = wrapD(tr, corner.d - wrapD(tr, c.d));
    if (ahead > 150 && ahead < L - 200) c.fIncident = { type: 'spin', at: c.d + ahead + r.range(-5, 30) };
  }
  if (r.chance(0.04 * k)) f.gridStall = r.pick(pool()).id;
  if (n === 1 && r.chance(0.025)) f.gridBox = r.pick(grid).id;

  race.phase = 'formation';
  race.emit('info', n === 1
    ? 'Formationsrunde – die Autos verlassen die Startaufstellung.'
    : `Extra-Formationsrunde – das Rennen geht jetzt über ${race.laps} Runden.`);
}

export function stepFormation(race, dt) {
  race.time += dt;
  moveFormation(race, dt);
  updateHazards(race, dt);
  updateServices(race, dt);
}

// Bewegung der Autos auf der Formationsrunde (läuft weiter, falls die Ampel zu früh startet)
function moveFormation(race, dt) {
  const f = race.formation;
  const tr = race.track;
  if (f.arrived) return;
  f.t += dt;

  if (f.stall && f.t >= f.stall.at) {
    const c = race.carById[f.stall.id];
    f.stall = null;
    race.emit('marshal', `Startaufstellung: ${c.id} kommt nicht los – das Auto wird in die Boxengasse geschoben.`, { cars: [c.id] });
    toPitLane(race, c);
    race.emit('rc', `${c.id} startet aus der Boxengasse.`, { cars: [c.id] });
  }

  const order = f.order.map(id => race.carById[id]).filter(c => !c.retired && !c.pitStart);
  let ahead = null;
  for (const car of order) {
    car.move = 0;
    if (car.offTrack) {
      car.v = 0;
      if (race.time >= car.offTrack.until) {
        // Erst zurück auf die Strecke, wenn das Feld vorbei ist
        const waiting = order.some(o => o !== car && !o.offTrack && o.d < car.d + 15);
        if (waiting) car.offTrack.until = race.time + 0.5;
        else {
          endOffTrack(race, car);
          if (!car.retired) startRegain(race, car);
        }
      }
      continue;
    }
    if (f.t < car.fDepart) {
      car.v = 0;
      if (car.fDepart !== Infinity) ahead = car;
      continue;
    }
    const toGo = car.fTarget - car.d;
    let vt = Math.min(speedAt(tr, car.d) * F_SPEED, F_VMAX);
    // Platz verloren (Dreher/Ausritt): darf überholen, um die Startreihenfolge wiederherzustellen
    if (car.fRegain) {
      vt = Math.min(speedAt(tr, car.d), Math.sqrt(Math.max(0, 2 * 6 * (toGo - 0.2))));
      if (vt > car.v) car.v = Math.min(vt, car.v + 7 * dt);
      else car.v = Math.max(vt, car.v - 14 * dt);
      car.move = Math.max(0, Math.min(car.v * dt, toGo));
      const prev = car.d;
      car.d += car.move;
      regainCheck(race, car, prev);
      continue;
    }
    if (car.inPit) vt = Math.min(vt, tr.pitLaneSpeed);   // Neustart: erst durch die Boxengasse
    vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 6 * (toGo - 0.2))));
    let room = toGo;
    if (ahead) {
      const gap = ahead.d - car.d;
      // Auf der Runde Abstand halten, am Ende in die eigene Startbox rollen
      if (toGo >= 90 && gap < 60) vt = Math.min(vt, Math.max(0, ahead.v + (gap - 28) * 0.4));
      room = Math.min(room, Math.max(0, gap - (SLOT - 0.5)));
      vt = Math.min(vt, ahead.v + Math.sqrt(Math.max(0, 2 * 6 * (room - 0.2))));
    }
    if (vt > car.v) car.v = Math.min(vt, car.v + 5 * dt);
    else car.v = Math.max(vt, car.v - 14 * dt);
    car.move = Math.max(0, Math.min(car.v * dt, room));
    if (car.move < car.v * dt) car.v = car.move / dt;
    const prev = car.d;
    car.d += car.move;
    if (car.inPit && crossed(tr, prev, car.d, tr.pit.exit)) car.inPit = false;
    const inc = car.fIncident;
    if (inc && prev < inc.at && car.d >= inc.at) {
      car.fIncident = null;
      if (inc.type === 'failure') startFailure(race, car, true);
      else startSpin(race, car);
    }
    if (!car.retired && !car.offTrack) ahead = car;
  }
  const live = order.filter(c => !c.retired && !c.pitStart);
  if (live.every(c => !c.offTrack && c.fTarget - c.d < 0.6 && c.v < 0.3)) arriveOnGrid(race);
}

// Nach einem Dreher/Ausritt in der Formationsrunde (Reglement): Der Fahrer darf überholen, um seinen
// ursprünglichen Startplatz zurückzuholen. Schafft er das nicht bis zur ersten Safety-Car-Linie
// (hier: Boxeneinfahrt), muss er in die Boxengasse und startet von dort.
function startRegain(race, car) {
  const f = race.formation;
  f.order = f.order.filter(id => id !== car.id).concat(car.id);   // vorerst hinter dem Feld
  car.fRegain = { slot: car.fSlot };
  race.emit('rc', `${car.id} hat in der Formationsrunde Plätze verloren – darf bis zur ersten Safety-Car-Linie aufholen, sonst Start aus der Boxengasse.`, { cars: [car.id] });
}

function regainCheck(race, car, prev) {
  const f = race.formation, tr = race.track;
  const behind = f.order.map(id => race.carById[id]).filter(c => c !== car && !c.retired && !c.pitStart && c.fSlot > car.fRegain.slot);
  if (behind.every(c => c.d < car.d - 12)) {
    // Startreihenfolge wiederhergestellt: zurück an den eigenen Platz
    f.order = f.order.filter(id => id !== car.id);
    const idx = f.order.findIndex(id => race.carById[id].fSlot > car.fRegain.slot);
    f.order.splice(idx < 0 ? f.order.length : idx, 0, car.id);
    car.fRegain = null;
    race.emit('rc', `${car.id} hat seinen Startplatz in der Formationsrunde zurückgeholt.`, { cars: [car.id] });
    return;
  }
  const entry = tr.pit.entry;
  if (prev < entry && car.d >= entry) {
    car.fRegain = null;
    f.order = f.order.filter(id => id !== car.id);
    toPitLane(race, car);
    race.emit('rc', `${car.id} hat seinen Startplatz bis zur ersten Safety-Car-Linie nicht zurückgeholt und startet aus der Boxengasse.`, { cars: [car.id] });
  }
}


function arriveOnGrid(race) {
  const f = race.formation;
  const L = race.track.L;
  if (f.restart) { arriveRestartGrid(race); return; }
  for (const c of race.cars) {
    if (c.retired || c.pitStart || !f.order.includes(c.id)) continue;
    c.d = c.fTarget - L;
    c.v = 0;
    c.move = 0;
    c.launchUntil = c.d + 400;
  }
  renumberGrid(race);
  f.arrived = true;
  f.gridT = 0;
  if (race.phase === 'formation') race.phase = 'grid';
  race.emit('info', race.phase === 'grid'
    ? 'Alle Autos stehen in der Startaufstellung – die Startampel kann eingeschaltet werden.'
    : 'Alle Autos stehen jetzt in der Startaufstellung.');
  // Vorgemerkte Entscheidung der Rennleitung ausführen
  const pending = f.pending;
  f.pending = null;
  if (pending === 'abort') abortStart(race);
  else if (pending === 'sc') startFromGridBehindSC(race);
}

// Formationsrunde noch nicht beendet, aber das Rennen startet: Autos rollen von ihrer Position aus los
function abandonFormation(race) {
  const f = race.formation;
  const L = race.track.L;
  if (f.stall) { const c = race.carById[f.stall.id]; f.stall = null; toPitLane(race, c); }
  for (const c of race.cars) {
    if (c.retired || c.pitStart || !f.order.includes(c.id)) continue;
    c.d -= L;
    if (c.offTrack) continue;
    c.reaction = 0;
    c.launchUntil = c.d + 400;
  }
  f.arrived = true;
}

// Startplätze: Platz in der Aufstellung, Boxengassenstarter dahinter
function renumberGrid(race) {
  const onGrid = race.cars.filter(c => !c.retired && !c.pitStart);
  for (const c of onGrid) c.gridPos = slotOf(c.d) + 1;
  race.cars.filter(c => c.pitStart).forEach((c, i) => { c.gridPos = onGrid.length + 1 + i; });
}

// ---------- Startaufstellung und Startampel ----------
// Ablauf (Reglement 2026, vereinfacht): Rennleitung gibt die Formationsrunde frei. Stehen alle
// Autos in ihren Startboxen, schaltet sie die Startampel ein: 5 s „Pre-Start“, dann gehen die
// fünf roten Lichter im Sekundentakt an. Danach löscht die Rennleitung die Lichter –
// üblich nach einer zufälligen Pause von bis zu 3 s.
export const PRESTART = 5;          // Sekunden bis zum ersten roten Licht
export const ALL_ON = PRESTART + 4; // alle fünf Lichter an
export const HOLD_MAX = 3;          // längste übliche Pause bis „Lichter aus“
const AUTO_OUT = 8;                 // spätestens dann gehen die Lichter automatisch aus

// Rennleitung gibt die Formationsrunde frei
export function releaseFormation(race) {
  if (race.phase !== 'ready') return false;
  if (race.sc && race.sc.inspection) race.sc = null;   // SC der Inspektionsrunde ist in der Boxengasse
  race.emit('rc', 'Rennleitung: Formationsrunde freigegeben.');
  beginFormation(race);
  return true;
}

// Regen setzt in der Startaufstellung ein, Autos noch auf Trockenreifen
function checkRainAtGrid(race) {
  const f = race.formation;
  if (race.startIssue || f.rainChecked || !f.arrived || f.restart) return;
  f.rainChecked = true;
  const rain = Math.max(rainAt(race.weather, 150), rainAt(race.weather, 300));
  const slicks = race.cars.some(c => !c.retired && !COMPOUNDS[c.compound].wet);
  if (rain < 0.2 || !slicks) return;
  race.startIssue = { type: 'rain', seq: ++race.startIssueSeq };
  race.emit('weather', 'Starker Regen setzt in der Startaufstellung ein!');
  race.emit('radio', `Funk ${race.standings()[0].id}: „Es regnet richtig! Wir brauchen andere Reifen!“`);
}

function checkGridStall(race) {
  const f = race.formation;
  checkRainAtGrid(race);
  if (race.startIssue || !f.gridStall || !f.arrived || f.gridT < 1.2) return;
  const c = race.carById[f.gridStall];
  f.gridStall = null;
  if (!c || c.retired || c.pitStart) return;
  race.startIssue = { type: 'stall', carId: c.id, seq: ++race.startIssueSeq };
  race.emit('marshal', `Startaufstellung: ${c.id} hebt die Hände – Motor abgestorben! Gelbe Flagge in der Startaufstellung.`, { cars: [c.id] });
  race.emit('radio', `Funk ${c.id}: „${race.rng.pick(['Ich stehe, der Motor ist aus!', 'Motor aus! Motor aus!', 'Anti-Stall … nichts geht mehr!', 'Ich komme nicht weg, der Motor ist abgestorben!'])}“`, { cars: [c.id] });
}

export function stepGrid(race, dt) {
  const f = race.formation;
  f.gridT += dt;
  race.time += dt;
  updateHazards(race, dt);
  updateServices(race, dt);
  checkGridStall(race);
}

// Rennleitung schaltet die Startampel ein
export function startLights(race) {
  if (race.phase !== 'grid' && race.phase !== 'formation') return false;
  const f = race.formation;
  const issue = race.startIssue;
  if (race.phase === 'formation') {
    const missing = race.cars.filter(c => !c.retired && !c.pitStart && f.order.includes(c.id) && c.fTarget - c.d > 0.6).length;
    race.startLog.push({ type: 'lights', action: 'early', missing });
    race.emit('rc', `Startampel eingeschaltet – obwohl noch ${missing} Auto${missing > 1 ? 's' : ''} nicht in der Startbox ${missing > 1 ? 'stehen' : 'steht'}!`);
  } else {
    race.emit('rc', 'Startampel eingeschaltet – Pre-Start.');
  }
  if (issue) issue.released = true;
  beginLights(race);
  return true;
}

function beginLights(race) {
  const r = race.rng;
  race.phase = 'lights';
  race.lightsTimer = 0;
  race.lightsHold = null;
  // Fehlstart: ein Auto wird nach dem letzten Licht nervös (je länger die Pause, desto eher)
  const grid = race.cars.filter(c => !c.retired && !c.pitStart && !(race.startIssue && race.startIssue.carId === c.id));
  for (const c of grid) {
    if (!r.chance(0.02 * (0.6 + c.driver.aggression * (1 - 0.35 * (c.caution || 0)) / 100))) continue;
    const real = r.chance(0.6);
    c.jump = { at: ALL_ON + r.range(0.4, 3.5), real, dist: real ? r.range(0.4, 1.8) : r.range(0.05, 0.35), moved: 0 };
    break;
  }
}

export function stepLights(race, dt) {
  const f = race.formation;
  race.lightsTimer += dt;
  race.time += dt;
  if (f.arrived) f.gridT += dt;
  moveFormation(race, dt);
  updateHazards(race, dt);
  updateServices(race, dt);
  checkGridStall(race);
  const t = race.lightsTimer;
  // Lange Pause: Fahrer werden nervös
  if (t > ALL_ON + HOLD_MAX && !race.cars.some(c => c.jump) && race.rng.chance(0.05 * dt)) {
    const cand = race.cars.filter(c => !c.retired && !c.pitStart && !c.offTrack);
    if (cand.length) {
      const real = race.rng.chance(0.6);
      race.rng.pick(cand).jump = { at: t, real, dist: real ? race.rng.range(0.4, 1.8) : race.rng.range(0.05, 0.35), moved: 0 };
    }
  }
  for (const c of race.cars) {
    const j = c.jump;
    if (!j || t < j.at || j.moved >= j.dist || c.retired) continue;
    const m = Math.min(j.dist - j.moved, 1.2 * dt);
    c.d += m;
    j.moved += m;
  }
  if (t >= ALL_ON + AUTO_OUT) lightsOut(race, true);
}

// Rennleitung löscht die Lichter → Rennstart
export function lightsOut(race, auto = false) {
  if (race.phase !== 'lights' || race.lightsTimer < ALL_ON) return false;
  const hold = race.lightsTimer - ALL_ON;
  race.startLog.push({ type: 'lights', action: 'out', hold, auto });
  if (auto) race.emit('rc', 'Die Lichter gehen nach langer Wartezeit automatisch aus.');
  goGreen(race);
  return true;
}

// Uhr auf 0: alle bisherigen Zeitpunkte verschieben
function shiftTimes(race, s) {
  if (!s) return;
  for (const e of race.events) e.t -= s;
  for (const h of race.hazards) {
    for (const k of ['start', 'endAt', 'firstFlagAt', 'adequateAt', 'endTime', 'okAt']) if (typeof h[k] === 'number') h[k] -= s;
  }
  for (const c of race.cases) c.time -= s;
  for (const l of race.flagLog) l.t -= s;
  for (const c of race.cars) {
    if (c.offTrack) c.offTrack.until -= s;
    if (c.slowUntil) c.slowUntil -= s;
  }
}

function goGreen(race) {
  const f0 = race.formation;
  if (f0 && !f0.arrived) abandonFormation(race);
  shiftTimes(race, race.time);
  race.time = 0;
  race.phase = 'running';
  race.emit('start', 'Lichter aus – das Rennen ist gestartet!');
  startLapMedical(race);     // Medical Car folgt dem Feld in der ersten Runde
  rollStartRegs(race);       // Reifendruck, Mechaniker in der Startaufstellung
  const issue = race.startIssue;
  race.startIssue = null;
  if (issue && issue.released && issue.type === 'stall') stalledAtStart(race, race.carById[issue.carId]);
  if (issue && issue.released && issue.type === 'rain') race.startLog.push({ type: 'rain', action: 'releasedRain' });
  for (const c of race.cars) {
    if (!c.jump) continue;
    createJumpStartCase(race, c, c.jump);
    c.reaction = 0.02;
    c.jump = null;
  }
  const f = race.formation;
  if (f && f.gridBox) {
    const c = race.carById[f.gridBox];
    f.gridBox = null;
    if (c && !c.retired && !c.pitStart) createGridBoxCase(race, c);
  }
}

// Start freigegeben, obwohl ein Auto in der Startaufstellung steht
function stalledAtStart(race, car) {
  if (!car || car.retired) return;
  const r = race.rng;
  const tr = race.track;
  const behind = race.cars
    .filter(c => !c.retired && !c.pitStart && c !== car && c.d < car.d)
    .sort((a, b) => b.d - a.d)[0];
  const hit = behind && r.chance(0.35);
  retireCar(race, car, 'Motor in der Startaufstellung abgestorben', 0);
  if (hit) {
    retireCar(race, behind, 'Unfall beim Start', (r.chance(0.5) ? 1 : -1) * 6);
    const h = createHazard(race, {
      type: 'crash', carId: car.id, carIds: [car.id, behind.id], d: wrapD(tr, car.d), need: 'sc', work: r.range(150, 240),
    });
    h.desc = `Unfall in der Startaufstellung: ${behind.id} fährt auf den stehenden ${car.id} auf`;
    race.emit('marshal', `Startaufstellung: UNFALL! ${behind.id} kann dem stehenden ${car.id} nicht ausweichen. Beide Autos sind ausgeschieden, Trümmer auf der Start-Ziel-Geraden.`, { hazard: h.id, sector: h.sector, cars: [car.id, behind.id] });
  } else {
    const h = createHazard(race, { type: 'stopped', carId: car.id, d: wrapD(tr, car.d), need: 'double', work: r.range(40, 90) });
    h.desc = `${car.id} steht mit abgestorbenem Motor in der Startaufstellung`;
    race.emit('marshal', `Startaufstellung: Das Feld weicht dem stehenden ${car.id} knapp aus. Marshals müssen das Auto von der Strecke schieben.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  }
  race.startLog.push({ type: 'stall', action: 'released', carId: car.id, crash: Boolean(hit) });
}

// ---------- Entscheidungen der Rennleitung ----------

// Start abbrechen: Extra-Formationsrunde, Renndistanz −1 Runde
export function abortStart(race) {
  // Während der Formationsrunde: vormerken, ausgeführt wird es, sobald alle in der Startaufstellung stehen
  if (race.phase === 'formation' && race.formation && !race.formation.arrived && !race.formation.restart) {
    if (race.formation.pending) return false;
    race.formation.pending = 'abort';
    race.emit('rc', 'EXTRA-FORMATIONSRUNDE angeordnet – sobald das Feld in der Startaufstellung steht.');
    return true;
  }
  if ((race.phase !== 'grid' && race.phase !== 'lights') || !race.formation.arrived) return false;
  const issue = race.startIssue;
  race.startIssue = null;
  for (const c of race.cars) {
    if (c.jump) { c.d -= c.jump.moved; c.jump = null; }
  }
  if (issue && issue.type === 'stall') {
    const c = race.carById[issue.carId];
    toPitLane(race, c);
    race.emit('rc', `${c.id} wird in die Boxengasse geschoben und startet aus der Boxengasse.`, { cars: [c.id] });
  }
  race.startLog.push({ type: issue ? issue.type : 'none', action: 'abort', carId: issue ? issue.carId : null });
  if (issue && issue.type === 'rain') {
    // Startverschiebung: alle wechseln auf Regenreifen
    const w = Math.max(0.4, rainAt(race.weather, 0));
    for (const c of race.cars) if (!c.retired) { c.compound = bestCompound(w, 30); c.plan = []; c.usedCompounds.add(c.compound); }
    race.emit('rc', 'Startverschiebung – die Teams wechseln in der Startaufstellung auf Regenreifen.');
  }
  race.laps = Math.max(3, race.laps - 1);
  race.emit('rc', 'START ABGEBROCHEN – Extra-Formationsrunde, die Renndistanz wird um eine Runde verkürzt.');
  beginFormation(race);
  return true;
}

// ---------- Start verschieben: Feld fährt in die Boxengasse ----------
// Jederzeit vor dem Start möglich (auch während der Formationsrunde). Das Feld beendet die Runde und
// stellt sich in der Boxengasse auf; die Strecke gilt dann als gesperrt (wie bei Rot) – Medical Car,
// Kehrmaschine und Kran dürfen ohne Safety Car raus. Danach neue Formationsrunde aus der Boxengasse.
export function suspendStart(race) {
  if (!['formation', 'grid', 'lights'].includes(race.phase) || race.neutral) return false;
  const tr = race.track, L = tr.L;
  const issue = race.startIssue;
  race.startIssue = null;
  for (const c of race.cars) if (c.jump) { c.d -= c.jump.moved; c.jump = null; }
  if (issue && issue.type === 'stall') {
    const c = race.carById[issue.carId];
    toPitLane(race, c);
    race.emit('rc', `${c.id} wird in die Boxengasse geschoben.`, { cars: [c.id] });
  }
  const f = race.formation;
  if (f.stall) { const c = race.carById[f.stall.id]; f.stall = null; toPitLane(race, c); }
  const open = race.hazards.some(h => !h.ended && h.type !== 'spin');
  race.startLog.push({ type: issue ? issue.type : open ? 'hazard' : 'none', action: 'suspend', carId: issue ? issue.carId : null });
  // Warteplätze in der Boxengasse in der aktuellen Reihenfolge auf der Strecke
  const cars = race.cars.filter(c => !c.retired && !c.pitStart && f.order.includes(c.id)).sort((a, b) => b.d - a.d);
  const lane = wrapD(tr, tr.pit.box - tr.pit.entry);
  const gapM = Math.min(12, Math.max(4, (lane - 20) / Math.max(1, cars.length)));
  cars.forEach((c, i) => {
    const entryAbs = c.d + wrapD(tr, tr.pit.entry - c.d - 5) + 5;
    c.pEntry = entryAbs;
    c.pTarget = entryAbs + Math.max(10, lane - i * gapM);
    c.fIncident = null;
    c.pass = null;
  });
  race.laps = Math.max(3, race.laps - 1);
  race.lightsTimer = 0;
  race.phase = 'delay';
  race.delay = { stage: 'toPit', t: 0, order: cars.map(c => c.id), gap: gapM };
  race.emit('rc', `START VERSCHOBEN – das Feld fährt in die Boxengasse. Die Strecke ist für Bergungen frei. Renndistanz jetzt ${race.laps} Runden.`);
  return true;
}

export function stepDelay(race, dt) {
  const tr = race.track;
  const D = race.delay;
  race.time += dt;
  D.t += dt;
  if (D.stage === 'toPit') {
    const cars = D.order.map(id => race.carById[id]).filter(c => !c.retired && !c.pitStart);
    let ahead = null, all = true;
    for (const car of cars) {
      car.move = 0;
      if (car.offTrack) {
        car.v = 0;
        all = false;
        if (race.time >= car.offTrack.until) endOffTrack(race, car);
        continue;
      }
      const toGo = car.pTarget - car.d;
      let vt = Math.min(speedAt(tr, car.d) * F_SPEED, F_VMAX);
      if (car.inPit) vt = Math.min(vt, tr.pitLaneSpeed);
      vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 6 * (toGo - 0.2))));
      let room = toGo;
      if (ahead) {
        const gap = ahead.d - car.d;
        // Auf der Strecke 20 m Abstand, in der Boxengasse dicht auffahren bis zum Warteplatz
        if (!car.inPit && gap < 60) vt = Math.min(vt, Math.max(4, ahead.v + (gap - 20) * 0.4));
        room = Math.min(room, Math.max(0, gap - (D.gap - 0.5)));
        vt = Math.min(vt, ahead.v + Math.sqrt(Math.max(0, 2 * 6 * (room - 0.2))));
      }
      if (vt > car.v) car.v = Math.min(vt, car.v + 5 * dt);
      else car.v = Math.max(vt, car.v - 14 * dt);
      car.move = Math.max(0, Math.min(car.v * dt, room));
      if (car.move < car.v * dt) car.v = car.move / dt;
      car.d += car.move;
      if (!car.inPit && car.d >= car.pEntry) car.inPit = true;
      if (car.pTarget - car.d > 0.6 || car.v > 0.3) all = false;
      if (!car.retired) ahead = car;
    }
    if (all) {
      D.stage = 'inPit';
      race.emit('info', 'Alle Autos stehen in der Boxengasse. Nach der Bergung: neue Formationsrunde aus der Boxengasse.');
    }
  }
  updateHazards(race, dt);
  updateServices(race, dt);
}

// Strecke frei? Dann neue Formationsrunde aus der Boxengasse (Startaufstellung wie vorher)
export function canResumeStart(race) {
  return race.phase === 'delay' && race.delay.stage === 'inPit' && !race.hazards.some(h => !h.ended && h.type !== 'spin');
}

export function resumeStart(race) {
  if (!canResumeStart(race)) return false;
  const tr = race.track, L = tr.L;
  const f = race.formation;
  const cars = race.cars.filter(c => !c.retired && !c.pitStart && f.order.includes(c.id));
  // Warteplätze in der Boxengasse nach Startaufstellung neu belegen (Positionen auf die Runde davor normieren)
  const spots = cars.map(c => c.d - Math.ceil(c.d / L) * L).sort((a, b) => b - a);
  const grid = [...cars].sort((a, b) => (a.fSlot ?? 99) - (b.fSlot ?? 99));
  grid.forEach((c, i) => {
    c.d = spots[i];
    c.inPit = true;
    c.v = 0;
    c.move = 0;
    const exitAbs = c.d + wrapD(tr, tr.pit.exit - c.d);
    c.fTarget = (Math.floor(exitAbs / L) + 1) * L + slotD(c.fSlot ?? i);
    c.fDepart = 1 + i * 1.3;
    c.fIncident = null;
    c.jump = null;
    c.pEntry = c.pTarget = undefined;
  });
  race.formation = { n: f.n + 1, t: 0, gridT: 0, order: grid.map(c => c.id), backSlot: f.backSlot, stall: null, gridStall: null, gridBox: null, rainChecked: f.rainChecked };
  race.delay = null;
  race.phase = 'formation';
  race.emit('rc', 'Boxenausfahrt offen – neue Formationsrunde aus der Boxengasse.');
  return true;
}

// Start hinter dem Safety Car (z. B. Starkregen oder Problem in der Startaufstellung)
export function startFromGridBehindSC(race) {
  // Während der Formationsrunde: vormerken, ausgeführt wird es, sobald alle in der Startaufstellung stehen
  if (race.phase === 'formation' && race.formation && !race.formation.arrived && !race.formation.restart) {
    if (race.formation.pending) return false;
    race.formation.pending = 'sc';
    race.emit('rc', 'START HINTER DEM SAFETY CAR angeordnet – sobald das Feld in der Startaufstellung steht.');
    return true;
  }
  if ((race.phase !== 'grid' && race.phase !== 'lights') || !race.formation.arrived) return false;
  const issue = race.startIssue;
  race.startIssue = null;
  for (const c of race.cars) {
    if (c.jump) { c.d -= c.jump.moved; c.jump = null; }
  }
  if (issue && issue.type === 'stall') {
    const c = race.carById[issue.carId];
    toPitLane(race, c);
    race.emit('rc', `${c.id} wird in die Boxengasse geschoben und startet aus der Boxengasse.`, { cars: [c.id] });
  }
  race.startLog.push({ type: issue ? issue.type : 'none', action: 'sc', carId: issue ? issue.carId : null });
  shiftTimes(race, race.time);
  race.time = 0;
  race.phase = 'running';
  race.emit('start', 'Start hinter dem Safety Car – das Rennen ist freigegeben.');
  startBehindSC(race);
  return true;
}

// ---------- Boxengassenstart ----------

export function toPitLane(race, car) {
  const tr = race.track;
  const k = race.cars.filter(c => c.pitStart).length;
  car.pitStart = true;
  car.pitHold = true;
  car.inPit = true;
  car.stoppedThisVisit = true;
  car.offTrack = null;
  car.fIncident = null;
  car.jump = null;
  car.v = 0;
  car.move = 0;
  car.d = tr.pit.box - tr.L - k * 12;   // gleiche Stelle wie die Box, aber hinter dem Feld gewertet
  renumberGrid(race);
}

// Boxengassenstarter fahren los, wenn das Feld die Boxenausfahrt passiert hat
export function releasePitStarters(race) {
  const tr = race.track;
  const L = tr.L;
  const holding = race.cars.filter(c => c.pitHold && !c.retired);
  if (!holding.length || race.phase !== 'running') return;
  // Boxenausfahrt öffnet, sobald das Feld vorbei ist (wie in echt). Autos, die neben der Strecke stehen
  // oder stehen geblieben sind, halten die Boxengassen-Starter nicht auf.
  const clear = race.time > 30 || race.cars.every(o => o.retired || o.pitStart || o.offTrack || o.limp || (race.time > 6 && o.v < 3) || o.d > tr.pit.exit + 15);
  if (!clear) return;
  holding.forEach((c, i) => {
    c.pitHold = false;
    c.d += L;
    c.reaction = race.time + 0.3 + i * 1.5;
    const k = Math.floor(c.d / 100);
    while (c.msK < k) {
      c.msK++;
      c.cross[c.msK] = race.time;
      if (race.firstCross[c.msK] === undefined) race.firstCross[c.msK] = race.time;
    }
    race.emit('pit', `${c.id} fährt aus der Boxengasse los.`, { cars: [c.id] });
  });
}

// ---------- Neustart nach roter Flagge ----------
// Autos verlassen die Boxengasse in Rennreihenfolge, fahren eine Formationsrunde und stellen sich
// auf. Die Rennleitung schaltet die Ampel ein und löscht die Lichter – wie beim Start.

export function beginRestartFormation(race) {
  const tr = race.track;
  const L = tr.L;
  const queued = race.cars.filter(c => c.redQueued && !c.retired);
  // In der Boxengasse in Rennreihenfolge aufstellen
  const spots = queued.map(c => c.d).sort((a, b) => b - a);
  const order = race.standings().filter(c => queued.includes(c));
  order.forEach((c, i) => {
    c.d = spots[i];
    const exitAbs = c.d + wrapD(tr, tr.pit.exit - c.d);
    c.fTarget = (Math.floor(exitAbs / L) + 1) * L + slotD(i);
    c.fSlot = i;
    c.fDepart = 1 + i * 1.3;
    c.fIncident = null;
    c.jump = null;
    c.redQueued = false;
    c.redBound = false;
    c.queueD = null;
    c.inPit = true;
    c.v = 0;
    c.move = 0;
    c.pass = null;
    c.restartGrid = i + 1;
  });
  race.formation = { n: 1, t: 0, gridT: 0, restart: true, order: order.map(c => c.id), backSlot: order.length, stall: null, gridStall: null, gridBox: null };
  race.neutral = { ...race.neutral, phase: 'formation', restart: true };
  race.emit('rc', 'NEUSTART – Boxenausfahrt offen. Formationsrunde, danach Startaufstellung.');
  return true;
}

function fillTimingTo(race, car) {
  const k = Math.floor(car.d / 100);
  while (car.msK < k) {
    car.msK++;
    car.cross[car.msK] = race.time;
    if (race.firstCross[car.msK] === undefined) race.firstCross[car.msK] = race.time;
  }
}

function arriveRestartGrid(race) {
  const f = race.formation;
  for (const id of f.order) {
    const c = race.carById[id];
    if (c.retired) continue;
    c.d = c.fTarget;
    c.v = 0;
    c.move = 0;
    c.gridLat = { side: c.fSlot % 2 === 0 ? -1 : 1, until: null };
    fillTimingTo(race, c);
  }
  f.arrived = true;
  f.gridT = 0;
  if (race.neutral.phase === 'formation') race.neutral.phase = 'grid';
  race.emit('info', 'Alle Autos stehen in der Startaufstellung – die Startampel kann eingeschaltet werden.');
}

export function stepRestart(race, dt) {
  const n = race.neutral;
  race.time += dt;
  if (!race.formation.arrived) moveFormation(race, dt);
  updateHazards(race, dt);
  trackNeutralUse(race, dt);
  if (n.phase === 'lights') {
    n.lightsTimer += dt;
    if (n.lightsTimer >= ALL_ON + AUTO_OUT) restartLightsOut(race, true);
  }
}

export function restartLights(race) {
  const n = race.neutral;
  if (!n || !n.restart || (n.phase !== 'formation' && n.phase !== 'grid')) return false;
  if (n.phase === 'formation') {
    race.startLog.push({ type: 'lights', action: 'early', restart: true });
    race.emit('rc', 'Startampel eingeschaltet – obwohl noch nicht alle Autos in der Startaufstellung stehen!');
  } else race.emit('rc', 'Startampel eingeschaltet – Pre-Start.');
  n.phase = 'lights';
  n.lightsTimer = 0;
  return true;
}

export function restartLightsOut(race, auto = false) {
  const n = race.neutral;
  if (!n || !n.restart || n.phase !== 'lights' || n.lightsTimer < ALL_ON) return false;
  race.startLog.push({ type: 'lights', action: 'out', hold: n.lightsTimer - ALL_ON, auto, restart: true });
  const f = race.formation;
  for (const id of f.order) {
    const c = race.carById[id];
    if (c.retired) continue;
    const rolling = !f.arrived && c.fTarget - c.d > 0.6;
    if (rolling) fillTimingTo(race, c);
    c.reaction = rolling ? 0 : race.time + race.rng.range(0.18, 0.36);
    c.launch = race.rng.range(0.92, 1.06);
    c.launchUntil = c.d + 400;
    c.lapStart = race.time;
    if (c.gridLat) c.gridLat.until = c.d + 120;
  }
  f.arrived = true;
  race.neutral = null;
  if (auto) race.emit('rc', 'Die Lichter gehen nach langer Wartezeit automatisch aus.');
  race.emit('start', 'Lichter aus – Neustart!');
  return true;
}
