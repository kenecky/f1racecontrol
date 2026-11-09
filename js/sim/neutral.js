// Neutralisierungen: Virtual Safety Car, Safety Car, rote Flagge (inkl. Neustart).
import { speedAt, wrapD, crossed, sectorIndexAt } from './trackModel.js';
import { COMPOUNDS, bestCompound } from './tyres.js';
import { beginRestartFormation } from './start.js';
import { rollRestartCase, rollRedWork } from './cases2.js';

export const VSC_FACTOR = 0.62;   // Delta-Tempo unter VSC (Anteil der Renngeschwindigkeit)
const SC_SPEED = 0.6;             // Tempo des Safety Cars
const RED_SPEED = 0.55;           // Tempo auf dem Weg in die Boxengasse
const SC_GAP = 35;                // Abstand des ersten Autos zum Safety Car (m)

// Wie stark ist die Strecke gerade neutralisiert? (0 = gar nicht, 3 = VSC, 4 = SC, 5 = Rot)
export function neutralLevel(race) {
  const n = race.neutral;
  if (!n) return 0;
  return { vsc: 3, sc: 4, red: 5 }[n.type];
}

// Darf dieses Auto gerade überholen?
export function passingBanned(race, car) {
  return Boolean(race.neutral) || Boolean(car.restartHold);
}

function abortPasses(race) {
  for (const c of race.cars) if (c.pass && !c.pass.slow) c.pass = null;
}

function leaderOnTrack(race) {
  return race.standings().find(c => !c.retired && !c.finished);
}

// ---------- Aktionen der Rennleitung ----------

export function deployVSC(race) {
  if (race.isSession) return false;   // kein VSC in Training/Qualifying
  if (race.phase !== 'running' || race.neutral) return false;
  race.neutral = { type: 'vsc', phase: 'active', start: race.time };
  race.neutralStats.vsc++;
  abortPasses(race);
  race.emit('rc', 'VIRTUAL SAFETY CAR – Delta-Zeit einhalten, Überholverbot');
  return true;
}

export function endVSC(race) {
  const n = race.neutral;
  if (!n || n.type !== 'vsc' || n.phase !== 'active') return false;
  n.phase = 'ending';
  n.endAt = race.time + race.rng.range(8, 14);
  race.emit('rc', 'VSC ENDET – Grün in wenigen Sekunden');
  return true;
}

export function deploySC(race) {
  if (race.isSession) return false;   // kein Safety Car in Training/Qualifying
  if (race.phase !== 'running') return false;
  if (race.neutral && race.neutral.type !== 'vsc') return false;
  const leader = leaderOnTrack(race);
  if (!leader) return false;
  race.sc = { d: wrapD(race.track, leader.d + 90), v: speedAt(race.track, leader.d) * SC_SPEED, move: 0, inPit: false };
  race.neutral = { type: 'sc', phase: 'out', start: race.time, unlap: false, startLap: leader.lap };
  race.neutralStats.sc++;
  abortPasses(race);
  race.emit('rc', 'SAFETY CAR – Safety Car auf der Strecke, Überholverbot');
  return true;
}

// Rennstart hinter dem Safety Car (z. B. bei starkem Regen)
export function startBehindSC(race) {
  const pole = race.cars.reduce((a, b) => (b.d > a.d ? b : a));
  race.sc = { d: wrapD(race.track, pole.d + 60), v: 0, move: 0, inPit: false };
  race.neutral = { type: 'sc', phase: 'out', start: 0, unlap: false, startLap: 0, fromStart: true };
  race.neutralStats.sc++;
  for (const c of race.cars) c.reaction = race.rng.range(0.3, 1.2);
}

export function allowUnlap(race) {
  const n = race.neutral;
  if (!n || n.type !== 'sc' || n.phase !== 'out' || n.unlap) return false;
  n.unlap = true;
  const leader = leaderOnTrack(race);
  const lapped = race.cars.filter(c => !c.retired && !c.finished && leader && leader.d - c.d >= race.track.L);
  lapped.forEach(c => { c.unlap = { phase: 1 }; });
  if (lapped.length) {
    race.emit('rc', `Überrundete Autos dürfen sich zurückrunden: ${lapped.map(c => c.id).join(', ')}`);
  } else {
    race.emit('rc', 'Überrundete Autos dürfen sich zurückrunden (derzeit keine überrundeten Autos).');
  }
  return true;
}

export function scInThisLap(race) {
  const n = race.neutral;
  if (!n || n.type !== 'sc' || n.phase !== 'out' || !race.sc) return false;
  const tr = race.track;
  n.phase = 'in';
  // Nach dem letzten erlaubten Sektor (Standard: 6 von 12) erst in der nächsten Runde
  n.skipEntry = !race.sc.inPit && !scInPossibleThisLap(race);
  const t10 = tr.corners[tr.corners.length - 1].d;
  n.restartPoint = wrapD(tr, t10 - race.rng.range(0, 160));
  n.go = false;
  race.emit('rc', n.skipEntry
    ? 'SAFETY CAR KOMMT IN DER NÄCHSTEN RUNDE REIN'
    : 'SAFETY CAR KOMMT IN DIESER RUNDE REIN');
  return true;
}

// Letzter Marshal-Sektor, in dem „SC in dieser Runde“ noch möglich ist (1-basiert)
export function scInLastSector(track) {
  return track.def.scInLastSector ?? Math.ceil(track.sectors.length / 2);
}

export function scInPossibleThisLap(race) {
  if (!race.sc) return false;
  return sectorIndexAt(race.track, race.sc.d) < scInLastSector(race.track);
}

// Einfahrtsrunde: ab dem Grenz-Sektor baut das SC Vorsprung auf
function scPullingAway(race) {
  const n = race.neutral;
  return Boolean(n && n.type === 'sc' && n.phase === 'in' && !n.skipEntry && race.sc && !race.sc.inPit
    && sectorIndexAt(race.track, race.sc.d) >= scInLastSector(race.track) - 1);
}

export function redFlag(race) {
  if (race.phase !== 'running' || (race.neutral && race.neutral.type === 'red')) return false;
  const tr = race.track;
  race.neutral = { type: 'red', phase: 'stopping', start: race.time, queue: 0, clearAnnounced: false };
  race.neutralStats.red++;
  race.sc = null;
  abortPasses(race);
  for (const c of race.cars) {
    c.unlap = null;
    c.restartHold = false;
    if (c.inPit && !c.retired && !c.finished) assignQueue(race, c);
  }
  race.emit('rc', 'ROTE FLAGGE – Rennen unterbrochen, alle Autos langsam in die Boxengasse');
  return true;
}

function assignQueue(race, car) {
  const tr = race.track;
  const slot = race.neutral.queue++;
  const target = wrapD(tr, tr.pit.exit - 30 - slot * 13);
  car.redBound = true;
  car.redSlot = slot;
  let dist = wrapD(tr, target - car.d);
  // Schon an der Warteposition vorbei (war beim Abbruch in der Boxengasse)? Dann direkt anhalten.
  if (car.inPit && dist > tr.L / 2) dist = 1;
  car.queueD = car.d + dist;
  car.stoppedThisVisit = true;
}

// Kann neu gestartet werden?
export function canRestart(race) {
  const n = race.neutral;
  return Boolean(n && n.type === 'red' && n.phase === 'stopped' && !race.hazards.some(h => !h.ended));
}

export function restartRace(race, mode) {
  if (!canRestart(race)) return false;
  const tr = race.track;
  const L = tr.L;
  const queued = race.cars.filter(c => c.redQueued).sort((a, b) => a.redSlot - b.redSlot);

  if (mode === 'sc') {
    race.sc = { d: wrapD(tr, tr.pit.exit + 80), v: 0, move: 0, inPit: false };
    race.neutral = { type: 'sc', phase: 'out', start: race.time, unlap: false, fromRed: true, release: queued.map(c => c.id), nextRelease: race.time + 2 };
    race.neutralStats.sc++;
    race.emit('rc', 'NEUSTART HINTER DEM SAFETY CAR – Boxenausfahrt offen');
    return true;
  }

  // Stehender Neustart: aus der Boxengasse in die Formationsrunde, Ampel durch die Rennleitung
  return beginRestartFormation(race);
}

function fillTiming(race, car, newD) {
  const k = Math.floor(newD / 100);
  while (car.msK < k) {
    car.msK++;
    car.cross[car.msK] = race.time;
    if (race.firstCross[car.msK] === undefined) race.firstCross[car.msK] = race.time;
  }
}

// ---------- Simulation ----------

// Geschwindigkeitsfaktor unter Neutralisierung (null = normales Renntempo)
export function neutralSpeedFactor(race, car) {
  const n = race.neutral;
  if (!n) return null;
  if (n.type === 'vsc') return VSC_FACTOR;
  if (n.type === 'red') return n.phase === 'grid' ? 0 : RED_SPEED;
  // Safety Car
  if (car.unlap) return 1.0;
  if (n.go) return null;
  // SC fährt in der Einfahrtsrunde davon – der Führende bleibt auf SC-Tempo
  if (race.behindSC.has(car) && scPullingAway(race)) return SC_SPEED;
  const g = race.physGap.get(car) ?? 999;
  if (g > 300) return 0.92;
  if (g > 80) return 0.78;
  return 0.7;
}

export function minGapTo(A) {
  return A.isSC ? SC_GAP : null;
}

export function moveSafetyCar(race, dt) {
  const sc = race.sc;
  if (!sc) return;
  const tr = race.track;
  const n = race.neutral;
  let v;
  if (sc.inPit) v = tr.pitLaneSpeed;
  else {
    v = speedAt(tr, sc.d) * (scPullingAway(race) ? 0.85 : SC_SPEED);
  }
  sc.v = v;
  sc.move = v * dt;
}

export function afterMove(race, dt) {
  const tr = race.track;
  const n = race.neutral;
  const sc = race.sc;

  // Safety Car bewegen
  if (sc) {
    const prev = sc.d;
    const next = prev + sc.move;
    if (n && n.type === 'sc' && n.phase === 'in' && !sc.inPit && crossed(tr, prev, next, tr.pit.entry)) {
      if (n.skipEntry) n.skipEntry = false;
      else {
        sc.inPit = true;
        race.emit('rc', 'Safety Car in der Boxengasse – der Führende bestimmt das Tempo');
      }
    }
    if (sc.inPit && crossed(tr, prev, next, tr.pit.box)) race.sc = null;
    else sc.d = wrapD(tr, next);
  }

  if (!n) return;

  if (n.type === 'vsc' && n.phase === 'ending' && race.time >= n.endAt) {
    race.neutral = null;
    race.emit('rc', 'GRÜN – VSC beendet, Rennen freigegeben');
    return;
  }

  if (n.type === 'sc') {
    // Freigabe aus der Boxengasse nach roter Flagge
    if (n.release && n.release.length && race.time >= n.nextRelease) {
      const car = race.carById[n.release.shift()];
      car.redQueued = false;
      car.redBound = false;
      car.queueD = null;
      n.nextRelease = race.time + 1.2;
    }
    // Zurückrunden
    for (const c of race.cars) {
      if (!c.unlap) continue;
      if (!race.sc || c.retired || c.finished || c.inPit || n.go) { c.unlap = null; continue; }
      if (c.unlap.phase === 1) {
        const ahead = wrapD(tr, c.d - race.sc.d);
        if (ahead > 20 && ahead < 600) c.unlap.phase = 2;
      } else {
        const train = race.cars.filter(x => !x.unlap && !x.retired && !x.finished && !x.inPit && !x.offTrack);
        let tail = null, far = -1;
        for (const x of train) {
          const back = wrapD(tr, race.sc.d - x.d);
          if (back > far) { far = back; tail = x; }
        }
        if (!tail || wrapD(tr, tail.d - c.d) < 70) {
          c.unlap = null;
          if (!race.cars.some(x => x.unlap)) race.emit('rc', 'Alle überrundeten Autos haben sich zurückgerundet.');
        }
      }
    }
    // Neustart: Führender gibt Gas am Neustartpunkt
    if (n.phase === 'in' && !n.go && !n.skipEntry) {
      // Spitzenreiter (erstes Auto im Rennen, das auf der Strecke ist)
      const head = race.standings().find(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !c.redQueued);
      if (head && crossed(tr, head.d - head.move, head.d, n.restartPoint)) {
        n.go = true;
        n.headId = head.id;
        for (const c of race.cars) if (!c.retired && !c.finished) c.restartHold = true;
        race.emit('rc', `Neustart! ${head.id} gibt Gas – Überholen erst nach der Ziellinie`);
        const st = race.standings().filter(c => !c.retired && !c.finished && !c.inPit);
        rollRestartCase(race, head, st[st.indexOf(head) + 1]);
      }
    }
  }

  if (n.type === 'red') {
    if (n.phase === 'stopping') {
      const racing = race.cars.filter(c => !c.retired && !c.finished);
      if (racing.every(c => c.redQueued)) {
        n.phase = 'stopped';
        race.emit('rc', 'Alle Autos stehen in der Boxengasse.');
      }
    }
    if (n.phase === 'stopped' && !n.clearAnnounced && !race.hazards.some(h => !h.ended)) {
      n.clearAnnounced = true;
      race.emit('rc', 'Strecke geräumt – Neustart möglich.');
    }

  }
}

// Ziellinie überquert (aus race.handleCrossings)
export function onLineCrossed(race, car) {
  if (car.restartHold) {
    car.restartHold = false;
    const n = race.neutral;
    if (n && n.type === 'sc' && n.go && car.id === n.headId) {
      race.neutral = null;
      race.emit('rc', 'GRÜN – Rennen wieder freigegeben');
    }
  }
}

// Boxeneinfahrt: rote Flagge erzwingt Einfahrt, unter VSC/SC günstiger Stopp
export function pitDecision(race, car, next) {
  const n = race.neutral;
  if (n && n.type === 'red') return 'red';
  if (!next) return null;
  if (car.lap + 1 >= next.lap) return 'plan';
  const cheap = n && (n.type === 'vsc' || (n.type === 'sc' && n.phase === 'out'));
  const w = race.wear || 1;
  if (cheap && car.lap * w >= 6 && (next.lap - (car.lap + 1)) * w <= 10) return 'cheap';
  return null;
}

export function enterPitUnderRed(race, car) {
  assignQueue(race, car);
}

// In der Warteschlange angekommen: freier Reifenwechsel
export function arriveInQueue(race, car) {
  car.redQueued = true;
  rollRedWork(race, car);
  car.v = 0;
  const remaining = (race.laps - car.lap) * (race.wear || 1);   // Reifenverschleiß bis ins Ziel
  const used = car.usedCompounds;
  let choice = race.weather.wetness > 0.15
    ? bestCompound(race.weather.wetness, remaining)
    : remaining > 34 ? 'H' : remaining > 16 ? 'M' : 'S';
  if (used.size < 2 && used.has(choice) && car.planIdx >= car.plan.length) {
    choice = choice === 'H' ? 'M' : 'H';
  }
  const from = car.compound;
  car.compound = choice;
  car.tyreAge = 0;
  used.add(choice);
  // Restliche Stopps streichen, wenn die neuen Reifen bis ins Ziel halten
  if (used.size >= 2 && remaining <= COMPOUNDS[choice].cliff + 4) car.planIdx = car.plan.length;
  const note = from === choice ? 'frische' : '';
  race.emit('pit', `${car.id} wechselt unter Rot auf ${note ? 'frische ' : ''}${COMPOUNDS[choice].name}`, { cars: [car.id] });
}

// Unnötige Neutralisierung messen
export function trackNeutralUse(race, dt) {
  const n = race.neutral;
  if (!n) return;
  const key = { vsc: 'vscTime', sc: 'scTime', red: 'redTime' }[n.type];
  race.neutralStats[key] += dt;
  const needLevel = h => ({ yellow: 1, double: 2, vsc: 3, sc: 4, red: 5 }[h.need]);
  const minNeed = n.type === 'red' ? 5 : 2;
  const grace = n.type === 'red' ? 150 : n.type === 'sc' ? 200 : 25;
  const justified = race.hazards.some(h => h.type !== 'spin' && needLevel(h) >= minNeed
    && (!h.ended || race.time - h.endTime < grace));
  if (!justified) race.neutralStats.idle += dt;
}
