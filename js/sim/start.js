// Startablauf: Formationsrunde, Startaufstellung, Startampel, Startabbruch,
// Boxengassenstart und Fehlstart. Vor dem Start läuft race.time schon mit
// (Bergungen, Flaggen); beim Erlöschen der Lichter wird die Uhr auf 0 gesetzt.
import { speedAt, wrapD, crossed } from './trackModel.js';
import { updateHazards, startSpin, endOffTrack, startFailure, createHazard, retireCar } from './hazards.js';
import { createJumpStartCase, createGridBoxCase } from './incidents.js';
import { startBehindSC, trackNeutralUse } from './neutral.js';
import { startLapMedical } from './services.js';

const F_SPEED = 0.8;    // Tempo in der Formationsrunde (Anteil der Renngeschwindigkeit)
const F_VMAX = 70;      // m/s (250 km/h)
const SLOT = 8;         // Abstand der Startplätze (m)
const slotD = i => -(6 + i * SLOT);
const slotOf = d => Math.round((-d - 6) / SLOT);

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
          if (!car.retired) moveToBack(race, car);
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

// Nach einem Dreher in der Formationsrunde: Start vom Ende des Feldes
function moveToBack(race, car) {
  const f = race.formation;
  f.order = f.order.filter(id => id !== car.id).concat(car.id);
  car.fSlot = f.backSlot;
  car.fTarget = race.track.L + slotD(f.backSlot++);
  race.emit('rc', `${car.id} hat in der Formationsrunde Plätze verloren und startet vom Ende des Feldes.`, { cars: [car.id] });
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
  race.emit('rc', 'Rennleitung: Formationsrunde freigegeben.');
  beginFormation(race);
  return true;
}

function checkGridStall(race) {
  const f = race.formation;
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
  const issue = race.startIssue;
  race.startIssue = null;
  if (issue && issue.released) stalledAtStart(race, race.carById[issue.carId]);
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
  race.laps = Math.max(3, race.laps - 1);
  race.emit('rc', 'START ABGEBROCHEN – Extra-Formationsrunde, die Renndistanz wird um eine Runde verkürzt.');
  beginFormation(race);
  return true;
}

// Start hinter dem Safety Car (z. B. Starkregen oder Problem in der Startaufstellung)
export function startFromGridBehindSC(race) {
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
  const clear = race.time > 45 || race.cars.every(o => o.retired || o.pitStart || o.d > tr.pit.exit + 30);
  if (!clear) return;
  holding.forEach((c, i) => {
    c.pitHold = false;
    c.d += L;
    c.reaction = race.time + 0.5 + i * 1.5;
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
