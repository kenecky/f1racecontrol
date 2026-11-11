// Einsatzfahrzeuge der Rennleitung: Medical Car, Kehrmaschine, Bergungskran, Boxengasse sperren.
// Fahrzeuge erscheinen nur, solange sie im Einsatz sind.
// Regeln für die Bewertung: Medical Car und Kehrmaschine nur, wenn vorher das Safety Car (oder Rot)
// draußen ist; ein Kran im falschen Sektor oder ein Kran neben der Strecke ohne ausreichende Absicherung
// kostet Punkte.
import { wrapD, crossed, sectorIndexAt, speedAt } from './trackModel.js';

// Medical Car: 20 % schneller als das Safety Car (SC fährt 60 % des Renntempos)
const MED_FACTOR = 0.72;
const SWEEP_SPEED = 9;     // m/s

export function svc(race) {
  if (!race.svc) race.svc = { medical: null, sweeper: null, cranes: [], pitClosed: false, log: [], startMed: null };
  return race.svc;
}

const scOut = race => Boolean((race.neutral && (race.neutral.type === 'sc' || race.neutral.type === 'red')) || race.phase === 'delay');
// Einsatzfahrzeuge: im Rennen und vor dem Start (Formationsrunde, Startaufstellung, Start verschoben)
export const svcPhase = race => ['ready', 'running', 'formation', 'grid', 'lights', 'delay'].includes(race.phase);
const secMid = (race, i) => {
  const s = race.track.sectors[i];
  return wrapD(race.track, s.start + wrapD(race.track, s.end - s.start) / 2);
};
// Ziel im Sektor: die offene Gefahr dort, sonst die Sektormitte
function targetIn(race, sector, pred = () => true) {
  const h = race.hazards.find(x => !x.ended && !x.global && x.sector === sector && pred(x));
  return h ? wrapD(race.track, h.d) : secMid(race, sector);
}

// ---------- Medical Car ----------
export function deployMedical(race, sector) {
  const s = svc(race);
  if (s.medical || !svcPhase(race)) return false;
  const tr = race.track;
  const target = targetIn(race, sector, h => h.medical);
  const start = wrapD(tr, tr.pit.exit);
  s.medical = { d: start, target: start + wrapD(tr, target - start), phase: 'out', sector, onsite: 0, v: 0 };
  if (!scOut(race)) s.log.push({ type: 'medicalNoSC', t: race.time });
  race.emit('rc', `MEDICAL CAR wird zu Sektor ${sector + 1} geschickt${scOut(race) ? '' : ' – ohne Safety Car auf der Strecke!'}`);
  return true;
}

// ---------- Kehrmaschine ----------
export function deploySweeper(race, sector) {
  const s = svc(race);
  if (s.sweeper || !svcPhase(race)) return false;
  const tr = race.track;
  const sec = tr.sectors[sector];
  const len = wrapD(tr, sec.end - sec.start) || tr.L / 12;
  s.sweeper = { d: sec.start, end: sec.start + len, sector, v: SWEEP_SPEED };
  if (!scOut(race)) s.log.push({ type: 'sweeperNoSC', t: race.time });
  const needed = race.hazards.some(h => !h.ended && h.sector === sector && h.needsSweeper);
  if (!needed) s.log.push({ type: 'sweeperWrong', t: race.time, sector });
  race.emit('rc', `KEHRMASCHINE fährt in Sektor ${sector + 1} auf die Strecke${scOut(race) ? '' : ' – ohne Safety Car!'}`);
  return true;
}

// ---------- Bergungskran ----------
export function deployCrane(race, sector) {
  const s = svc(race);
  if (s.cranes.some(c => c.sector === sector) || !svcPhase(race)) return false;
  const d = targetIn(race, sector, h => h.needsCrane);
  const needed = race.hazards.some(h => !h.ended && h.sector === sector && h.needsCrane);
  s.cranes.push({ sector, d, since: race.time, idle: 0, side: race.track.corners.length ? 1 : 1 });
  if (!needed) s.log.push({ type: 'craneWrong', t: race.time, sector });
  race.emit('rc', `BERGUNGSKRAN in Sektor ${sector + 1} im Einsatz${needed ? '' : ' – dort wird kein Kran gebraucht!'}`);
  return true;
}

export function recallCrane(race, sector) {
  const s = svc(race);
  const i = s.cranes.findIndex(c => c.sector === sector);
  if (i < 0) return false;
  s.cranes.splice(i, 1);
  race.emit('rc', `Bergungskran in Sektor ${sector + 1} zieht sich zurück.`);
  return true;
}

// ---------- Boxengasse ----------
export function setPitClosed(race, closed) {
  const s = svc(race);
  if (s.pitClosed === closed) return false;
  s.pitClosed = closed;
  race.emit('rc', closed ? 'BOXENGASSE GESCHLOSSEN' : 'BOXENGASSE WIEDER OFFEN');
  return true;
}

// ---------- Medical Car in der ersten Runde: folgt dem Feld ----------
export function startLapMedical(race) {
  const s = svc(race);
  const tr = race.track;
  s.startMed = { d: wrapD(tr, tr.pit.exit), phase: 'wait', v: 0 };
}

// Hilfen für die Gefahren-Bergung
export function craneIn(race, sector) { return svc(race).cranes.some(c => c.sector === sector); }

// Nässe: Medical Car (und Safety Car) fahren langsamer – bei voller Nässe ~25 % (wie das Feld)
export function wetPace(race) { return 1 - 0.25 * (race.weather ? race.weather.wetness : 0); }

// ---------- Simulation ----------
export function updateServices(race, dt) {
  const s = race.svc;
  if (!s) return;
  const tr = race.track;
  // Medical Car
  const m = s.medical;
  if (m) {
    if (m.phase === 'out' || m.phase === 'return') {
      const vt = speedAt(tr, m.d) * MED_FACTOR * wetPace(race);
      m.v = vt;
      const prev = m.d;
      m.d += vt * dt;
      if (m.phase === 'out' && m.d >= m.target) {
        m.d = m.target;
        m.phase = 'onsite';
        race.emit('marshal', `Sektor ${m.sector + 1}: Medical Car ist an der Unfallstelle.`, { sector: m.sector });
      }
      if (m.phase === 'return' && crossed(tr, prev, m.d, tr.pit.entry)) {
        s.medical = null;
        race.emit('rc', 'Medical Car ist zurück in der Boxengasse.');
      }
    } else if (m.phase === 'onsite') {
      m.onsite += dt;
      for (const h of race.hazards) {
        if (!h.ended && h.medical && !h.medicalDone && h.sector === m.sector) {
          if (m.onsite > 12) {
            h.medicalDone = true;
            race.emit('marshal', `Sektor ${m.sector + 1}: Der Fahrer ist untersucht – ${h.medicalText || 'er ist in Ordnung'}.`, { sector: m.sector });
          }
        }
      }
      const waiting = race.hazards.some(h => !h.ended && h.medical && !h.medicalDone && h.sector === m.sector);
      if (!waiting && m.onsite > 15) m.phase = 'return';
    }
  }
  // Medical Car der ersten Runde: wartet in der Boxenausfahrt, bis das ganze Feld (auch die Boxengassen-Starter)
  // vorbei ist, folgt dann dem Feld. Gibt es in Runde 1 einen Unfall mit Ausfall, fährt es direkt dorthin.
  const sm = s.startMed;
  if (sm) {
    const exitD = wrapD(tr, tr.pit.exit);
    const field = race.cars.filter(c => !c.retired && !c.pitStart);
    if (sm.phase === 'wait') {
      const passed = race.phase === 'running' && race.cars.every(c => c.retired || (!c.inPit && !c.pitHold && c.d > exitD + 40) || (c.lap >= 1 && !c.pitStart));
      if (passed) { sm.phase = 'go'; sm.d = exitD; race.emit('info', 'Medical Car verlässt die Boxengasse und folgt dem Feld in der ersten Runde.'); }
    } else {
      // Unfall mit Ausfall vor dem Medical Car? Dann direkt zur Unfallstelle
      const crash = !s.medical && race.hazards.find(h => !h.ended && (h.medical || h.type === 'crash') && !h.medicalDone && !h.global && h.carId
        && race.carById[h.carId] && race.carById[h.carId].retired && wrapD(tr, h.d - sm.d) < tr.L * 0.9);
      if (crash) {
        s.medical = { d: sm.d, target: sm.d + wrapD(tr, crash.d - sm.d), phase: 'out', sector: crash.sector, onsite: 0, v: sm.v || 0, auto: true };
        s.startMed = null;
        race.emit('rc', `MEDICAL CAR fährt direkt zur Unfallstelle in Sektor ${crash.sector + 1}.`, { sector: crash.sector });
      } else {
        const last = Math.min(...field.map(c => c.d));
        const vt = Math.min(speedAt(tr, sm.d) * 0.8 * wetPace(race), Math.max(10, (last - 60 - sm.d) * 2 + 20));
        const prev = sm.d;
        sm.d += vt * dt;
        sm.v = vt;
        // Ende der ersten Runde: an der Boxeneinfahrt (liegt meist vor der Ziellinie) hinein
        if (crossed(tr, prev, sm.d, tr.pit.entry) && sm.d - exitD > tr.L * 0.5) {
          s.startMed = null;
          race.emit('info', 'Medical Car fährt nach der ersten Runde in die Boxengasse.');
        }
      }
    }
  }
  // Boxengasse ohne Grund geschlossen (kein Vorfall in der Boxengasse, keine rote Flagge) → zählt für die Bewertung
  if (s.pitClosed && !(race.neutral && race.neutral.type === 'red') && !race.hazards.some(h => !h.ended && h.need === 'pit')) s.pitIdle = (s.pitIdle || 0) + dt;
  // Kehrmaschine: fährt den Sektor ab und räumt
  const sw = s.sweeper;
  if (sw) {
    sw.d += sw.v * dt;
    for (const h of race.hazards) {
      if (!h.ended && h.needsSweeper && h.sector === sw.sector && Math.abs(wrapD(tr, h.d - sw.d)) < 25) h.swept = true;
    }
    if (sw.d >= sw.end) {
      s.sweeper = null;
      race.emit('rc', `Kehrmaschine hat Sektor ${sw.sector + 1} verlassen.`);
    }
  }
  // Kräne: ohne Arbeit nach einer Weile zurückziehen; neben der Strecke nur mit ausreichender Absicherung
  for (const c of [...s.cranes]) {
    const busy = race.hazards.some(h => !h.ended && h.sector === c.sector && h.needsCrane);
    c.idle = busy ? 0 : c.idle + dt;
    if (c.idle > 25) { recallCrane(race, c.sector); continue; }
    const flag = race.flags[c.sector];
    const safe = flag === 'double' || race.phase === 'delay' || (race.neutral && race.neutral.type !== 'vsc') || (race.neutral && race.weather.wetness < 0.3);
    if (!safe && !c.warned) {
      c.unsafeT = (c.unsafeT || 0) + dt;
      if (c.unsafeT > 8) {
        c.warned = true;
        s.log.push({ type: 'craneUnsafe', t: race.time, sector: c.sector, wet: race.weather.wetness > 0.3 });
        race.emit('radio', `Funk ${nearestDriver(race, c.d)}: „Da steht ein Kran direkt neben der Strecke – und kaum Absicherung!“`);
      }
    }
  }
}

function nearestDriver(race, d) {
  const c = race.cars.filter(x => !x.retired && !x.finished).sort((a, b) => wrapD(race.track, d - a.d) - wrapD(race.track, d - b.d))[0];
  return c ? c.id : 'Fahrer';
}

// Bewertung: Abzüge aus dem Einsatz der Fahrzeuge
export function serviceLog(race) {
  return race.svc ? race.svc.log : [];
}
