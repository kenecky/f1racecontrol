// Gefahren auf der Strecke: Dreher/Ausritte, liegengebliebene Autos, Trümmerteile.
// Erzeugt Meldungen von Marshals und Fahrern. Die Rennleitung reagiert mit Flaggen.
import { sectorIndexAt, wrapD } from './trackModel.js';

export const FLAG_FACTOR = { clear: 1, slippery: 0.97, yellow: 0.92, double: 0.8 };
const LEVEL = { clear: 0, slippery: 1, yellow: 2, double: 3 };

// Ist die gesetzte Flagge für diese Gefahr ausreichend?
export function isAdequate(h, flag) {
  if (h.recommended === 'double') return flag === 'double';
  if (h.type === 'debris') return flag !== 'clear';
  return flag === 'yellow' || flag === 'double';
}

export function isYellow(flag) {
  return flag === 'yellow' || flag === 'double';
}

function cornerNear(track, d) {
  const x = wrapD(track, d);
  let best = track.corners[0], bd = Infinity;
  for (const c of track.corners) {
    const dist = Math.min(Math.abs(c.d - x), track.L - Math.abs(c.d - x));
    if (dist < bd) { bd = dist; best = c; }
  }
  return best;
}

function cornerLabel(c) {
  return c.name !== c.id ? `${c.id} (${c.name})` : c.id;
}

// Beim Überfahren der Ziellinie: Zufallsereignis für die nächste Runde planen
export function rollLapIncidents(race, car) {
  if (race.phase !== 'running' || car.lap >= race.laps - 1) return;
  const r = race.rng;
  const L = race.track.L;
  const failP = (100 - car.team.reliability) * 0.000038;
  const spinP = 0.0019 * (car.driver.errors / 28);
  if (r.chance(failP)) {
    car.pendingIncident = { type: 'failure', at: car.lap * L + r.range(150, L - 300) };
  } else if (r.chance(spinP)) {
    const c = r.pick(race.track.corners);
    car.pendingIncident = { type: 'spin', at: car.lap * L + c.d + r.range(-5, 35) };
  }
}

// Nach jeder Bewegung: geplantes Ereignis auslösen?
export function checkPendingIncident(race, car, prev) {
  const p = car.pendingIncident;
  if (!p || car.retired || car.finished) return;
  if (prev < p.at && car.d >= p.at) {
    car.pendingIncident = null;
    if (car.inPit || race.phase !== 'running') return;
    if (p.type === 'spin') startSpin(race, car);
    else startFailure(race, car);
  }
}

function createHazard(race, props) {
  const h = {
    id: ++race.hazardSeq,
    start: race.time,
    endAt: null,
    ended: false,
    endTime: null,
    firstFlagAt: null,
    adequateAt: null,
    maxFlag: 'clear',
    overflag: false,
    complained: false,
    hinted: false,
    sector: sectorIndexAt(race.track, props.d),
    ...props,
  };
  h.corner = cornerNear(race.track, props.d);
  race.hazards.push(h);
  return h;
}

function startSpin(race, car) {
  const r = race.rng;
  const stuck = r.chance(0.2);
  const dur = r.range(6, 14);
  const side = r.chance(0.5) ? 1 : -1;
  car.offTrack = { until: race.time + dur, lateral: side * 11, stuck };
  car.v = 0;
  car.pass = null;
  const h = createHazard(race, { type: 'spin', carId: car.id, d: car.d, recommended: 'yellow' });
  car.offTrack.hazardId = h.id;
  const text = r.chance(0.5)
    ? `${car.id} dreht sich in ${cornerLabel(h.corner)} und steht neben der Strecke`
    : `${car.id} rutscht in ${cornerLabel(h.corner)} von der Strecke ins Kiesbett`;
  h.desc = text;
  race.emit('marshal', `Sektor ${h.sector + 1}: ${text}.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
}

// Dreher vorbei: zurück auf die Strecke oder festgefahren
export function endOffTrack(race, car) {
  const off = car.offTrack;
  car.offTrack = null;
  const h = race.hazards.find(x => x.id === off.hazardId);
  if (off.stuck) {
    retireCar(race, car, 'Im Kiesbett festgefahren', off.lateral);
    const exposed = race.rng.chance(0.5);
    h.type = 'stopped';
    h.recommended = exposed ? 'double' : 'yellow';
    h.endAt = race.time + race.rng.range(80, 180);
    h.desc = `${car.id} steckt fest – ${exposed ? 'Auto steht ungeschützt direkt neben der Fahrbahn' : 'Auto steht weit im Auslauf'}`;
    race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} kommt nicht mehr frei. ${exposed ? 'Das Auto steht ungeschützt direkt neben der Fahrbahn, Bergungsfahrzeug wird benötigt.' : 'Das Auto steht weit im Auslauf, Bergung läuft.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  } else {
    car.v = 0;
    h.endAt = race.time + 3;
    h.rejoined = true;
  }
}

function startFailure(race, car) {
  const r = race.rng;
  const side = r.chance(0.5) ? 1 : -1;
  const exposed = r.chance(0.45);
  retireCar(race, car, 'Technischer Defekt', side * 12);
  const h = createHazard(race, {
    type: 'stopped', carId: car.id, d: car.d,
    recommended: exposed ? 'double' : 'yellow',
  });
  h.endAt = race.time + r.range(70, 180);
  h.desc = `${car.id} hat ein Problem und stellt das Auto ab – ${exposed ? 'ungeschützt direkt neben der Fahrbahn' : 'hinter der Leitplanke'}`;
  const quotes = ['Ich verliere Leistung … ich muss anhalten.', 'Kein Antrieb mehr!', 'Etwas ist kaputt, ich stelle das Auto ab.', 'Motor ist aus, Motor ist aus!'];
  race.emit('radio', `Funk ${car.id}: „${r.pick(quotes)}“`, { cars: [car.id] });
  race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} steht in ${cornerLabel(h.corner)} – ${exposed ? 'ungeschützt direkt neben der Fahrbahn.' : 'sicher hinter der Leitplanke.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
}

function retireCar(race, car, reason, lateral) {
  car.retired = true;
  car.dnf = reason;
  car.v = 0;
  car.move = 0;
  car.pass = null;
  car.pendingIncident = null;
  car.wreck = { d: car.d, lateral, removed: false };
}

// Nach einem Überholmanöver: Kontakt mit Trümmerteilen?
export function maybeContactDebris(race, attacker, defender) {
  if (!race.rng.chance(0.05)) return;
  const h = createHazard(race, { type: 'debris', d: attacker.d, recommended: 'yellow', cars: [attacker.id, defender.id] });
  h.endAt = race.time + race.rng.range(40, 110);
  h.desc = `Trümmerteile auf der Ideallinie nach Kontakt ${attacker.id}/${defender.id}`;
  race.emit('marshal', `Sektor ${h.sector + 1}: Leichte Berührung ${attacker.id}/${defender.id} in ${cornerLabel(h.corner)} – Trümmerteile auf der Ideallinie.`, { hazard: h.id, sector: h.sector, cars: [attacker.id, defender.id] });
}

// Jeder Simulationsschritt: Flaggenlage auswerten, Bergung, Beschwerden
export function updateHazards(race, dt) {
  const t = race.time;
  for (const h of race.hazards) {
    if (h.ended) continue;
    const flag = race.flags[h.sector];
    if (flag !== 'clear' && h.firstFlagAt === null) h.firstFlagAt = t;
    if (LEVEL[flag] > LEVEL[h.maxFlag]) h.maxFlag = flag;
    if (h.adequateAt === null && isAdequate(h, flag)) h.adequateAt = t;
    if (flag === 'double' && h.recommended === 'yellow' && h.type !== 'debris') h.overflag = true;

    // Fahrer beschweren sich, wenn nicht abgesichert wird
    if (!h.complained && h.adequateAt === null && flag === 'clear' && t - h.start > 15) {
      h.complained = true;
      const involved = [h.carId, ...(h.cars || [])];
      const witness = race.cars
        .filter(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !involved.includes(c.id))
        .sort((a, b) => wrapD(race.track, h.d - a.d) - wrapD(race.track, h.d - b.d))[0];
      if (witness) {
        const text = h.type === 'debris'
          ? `Funk ${witness.id}: „Da liegen überall Teile in ${h.corner.id}!“`
          : `Funk ${witness.id}: „Da steht ein Auto in ${h.corner.id} – keine gelbe Flagge?!“`;
        race.emit('radio', text, { cars: [witness.id], sector: h.sector });
      }
    }
    // Marshals bitten um mehr Schutz bei gefährlicher Bergung
    if (!h.hinted && h.recommended === 'double' && h.adequateAt === null && flag === 'yellow' && t - h.start > 20) {
      h.hinted = true;
      race.emit('marshal', `Sektor ${h.sector + 1}: Marshals arbeiten direkt an der Fahrbahn – bitte Schutz der Streckenposten beachten.`, { sector: h.sector });
    }

    if (h.endAt !== null && t >= h.endAt) {
      h.ended = true;
      h.endTime = t;
      const car = h.carId ? race.carById[h.carId] : null;
      if (car && car.wreck) car.wreck.removed = true;
      let text;
      if (h.type === 'spin' && h.rejoined) text = `${h.carId} ist zurück auf der Strecke. Gefahr beseitigt.`;
      else if (h.type === 'stopped') text = `Auto von ${h.carId} ist geborgen. Strecke frei.`;
      else text = 'Trümmerteile sind beseitigt. Strecke frei.';
      race.emit('marshal', `Sektor ${h.sector + 1}: ${text}`, { sector: h.sector, cleared: h.id });
    }
  }

  // Unnötige Flaggen (keine Gefahr im Sektor, 10 s Kulanz nach Freigabe)
  for (let i = 0; i < race.flags.length; i++) {
    if (race.flags[i] === 'clear') continue;
    const needed = race.hazards.some(h => h.sector === i && (!h.ended || t - h.endTime < 10));
    if (!needed) race.idleFlagTime += dt;
  }
}

export function activeHazards(race) {
  return race.hazards.filter(h => !h.ended);
}
