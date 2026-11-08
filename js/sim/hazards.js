// Gefahren auf der Strecke: Dreher, liegengebliebene Autos, Trümmerteile, schwere Unfälle.
// Erzeugt Meldungen von Marshals und Fahrern. Die Rennleitung reagiert mit Flaggen,
// VSC, Safety Car oder roter Flagge – davon hängt ab, wie schnell geborgen werden kann.
import { sectorIndexAt, wrapD } from './trackModel.js';
import { neutralLevel } from './neutral.js';
import { wetLoss, bestCompound } from './tyres.js';

export const FLAG_FACTOR = { clear: 1, slippery: 0.97, yellow: 0.92, double: 0.8 };

// Stufen: 0 nichts, 1 Gelb, 2 Doppelt Gelb, 3 VSC, 4 Safety Car, 5 Rote Flagge
export const NEED_LEVEL = { yellow: 1, double: 2, vsc: 3, sc: 4, red: 5 };
export const NEED_LABEL = {
  yellow: 'Gelb', double: 'Doppelt Gelb', vsc: 'VSC', sc: 'Safety Car', red: 'Rote Flagge',
};

// Bergungstempo je Gefahrenstufe (Zeile) und Reaktion der Rennleitung (Spalte 0–5)
const WORK_RATE = {
  yellow: [0.6, 1.0, 1.0, 1.5, 1.8, 3.0],
  double: [0.4, 0.6, 1.0, 1.6, 2.0, 4.0],
  vsc:    [0.2, 0.3, 0.5, 1.0, 1.4, 3.0],
  sc:     [0.1, 0.2, 0.3, 0.6, 1.0, 2.5],
  red:    [0.0, 0.0, 0.0, 0.1, 0.4, 1.0],
};

function flagLevel(h, flag) {
  if (flag === 'double') return 2;
  if (flag === 'yellow') return 1;
  if (flag === 'slippery' && h.type === 'debris') return 1;
  return 0;
}

// Aktuelle Reaktionsstufe auf diese Gefahr
export function responseLevel(race, h) {
  return Math.max(flagLevel(h, race.flags[h.sector]), neutralLevel(race));
}

// Ort einer Gefahr für Texte
export function hazardWhere(h) {
  return h.global ? 'Gesamte Strecke' : `Sektor ${h.sector + 1}`;
}

export function isYellow(flag) {
  return flag === 'yellow' || flag === 'double';
}

export function cornerNear(track, d) {
  const x = wrapD(track, d);
  let best = track.corners[0], bd = Infinity;
  for (const c of track.corners) {
    const dist = Math.min(Math.abs(c.d - x), track.L - Math.abs(c.d - x));
    if (dist < bd) { bd = dist; best = c; }
  }
  return best;
}

export function cornerLabel(c) {
  return c.name !== c.id ? `${c.id} (${c.name})` : c.id;
}

// Beim Überfahren der Ziellinie: Zufallsereignis für die nächste Runde planen
export function rollLapIncidents(race, car) {
  if (race.phase !== 'running' || car.lap >= race.laps - 1 || race.neutral) return;
  const r = race.rng;
  const L = race.track.L;
  const failP = (100 - car.team.reliability) * 0.000038;
  let spinP = 0.0019 * (car.driver.errors / 28);
  // Nässe und falsche Reifen erhöhen das Risiko stark
  const w = race.weather.wetness;
  if (w > 0.05) {
    const best = bestCompound(w, race.laps - car.lap);
    const mismatch = Math.min(3, Math.max(0, (wetLoss(car.compound, w) - wetLoss(best, w)) / 4));
    spinP *= 1 + 5 * w + 4 * mismatch;
    spinP *= 1.5 - car.driver.wet / 200;
  }
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
    if (car.inPit || race.phase !== 'running' || race.neutral) return;
    if (p.type === 'failure') startFailure(race, car);
    else {
      const corner = cornerNear(race.track, car.d);
      if ((corner.vmax || 0) >= 170 && race.rng.chance(0.35 + 0.25 * race.weather.wetness)) startCrash(race, car, corner);
      else startSpin(race, car);
    }
  }
}

export function createHazard(race, props) {
  const h = {
    id: ++race.hazardSeq,
    start: race.time,
    endAt: null,        // fester Endzeitpunkt (nur Dreher)
    work: null,         // verbleibende Bergungsarbeit in Sekunden (bei normalem Tempo)
    workTotal: null,
    ended: false,
    endTime: null,
    firstFlagAt: null,
    adequateAt: null,
    maxResponse: 0,
    complained: false,
    hinted: false,
    sector: sectorIndexAt(race.track, props.d),
    ...props,
  };
  if (h.work !== null) h.workTotal = h.work;
  h.corner = cornerNear(race.track, props.d);
  race.hazards.push(h);
  return h;
}

export function startSpin(race, car) {
  const r = race.rng;
  const stuck = r.chance(0.2);
  const dur = r.range(6, 14);
  const side = r.chance(0.5) ? 1 : -1;
  car.offTrack = { until: race.time + dur, lateral: side * 11, stuck };
  car.v = 0;
  car.pass = null;
  const h = createHazard(race, { type: 'spin', carId: car.id, d: car.d, need: 'yellow' });
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
    h.need = exposed ? 'double' : 'yellow';
    h.work = h.workTotal = race.rng.range(70, 160);
    h.desc = `${car.id} steckt fest – ${exposed ? 'Auto steht ungeschützt direkt neben der Fahrbahn' : 'Auto steht weit im Auslauf'}`;
    race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} kommt nicht mehr frei. ${exposed ? 'Das Auto steht ungeschützt direkt neben der Fahrbahn.' : 'Das Auto steht weit im Auslauf, Bergung läuft.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  } else {
    car.v = 0;
    h.endAt = race.time + 3;
    h.rejoined = true;
  }
}

function startFailure(race, car) {
  const r = race.rng;
  const side = r.chance(0.5) ? 1 : -1;
  const roll = r.next();
  const need = roll < 0.4 ? 'yellow' : roll < 0.75 ? 'double' : 'vsc';
  retireCar(race, car, 'Technischer Defekt', side * 12);
  const where = {
    yellow: 'sicher hinter der Leitplanke',
    double: 'ungeschützt direkt neben der Fahrbahn',
    vsc: 'quer am Streckenrand – der Bergungskran muss dafür auf die Strecke',
  }[need];
  const h = createHazard(race, { type: 'stopped', carId: car.id, d: car.d, need, work: r.range(70, 170) });
  h.desc = `${car.id} hat ein Problem und stellt das Auto ab – ${where}`;
  const quotes = ['Ich verliere Leistung … ich muss anhalten.', 'Kein Antrieb mehr!', 'Etwas ist kaputt, ich stelle das Auto ab.', 'Motor ist aus, Motor ist aus!'];
  race.emit('radio', `Funk ${car.id}: „${r.pick(quotes)}“`, { cars: [car.id] });
  race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} steht in ${cornerLabel(h.corner)} – ${where}.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
}

function startCrash(race, car, corner) {
  const r = race.rng;
  const barrier = r.chance(0.3);
  const side = r.chance(0.5) ? 1 : -1;
  retireCar(race, car, 'Unfall', side * 14);
  const h = createHazard(race, {
    type: 'crash', carId: car.id, d: car.d,
    need: barrier ? 'red' : 'sc',
    work: barrier ? r.range(360, 600) : r.range(150, 240),
    okAt: race.time + r.range(6, 12),
  });
  h.desc = barrier
    ? `Schwerer Unfall ${car.id} – Barriere stark beschädigt, muss repariert werden`
    : `Schwerer Unfall ${car.id} – Wrack und Trümmerfeld auf der Strecke`;
  race.emit('marshal', `Sektor ${h.sector + 1}: SCHWERER UNFALL! ${car.id} schlägt in ${cornerLabel(corner)} heftig in die Barriere ein. ${barrier ? 'Die Barriere ist stark beschädigt und muss repariert werden.' : 'Trümmerteile über die ganze Fahrbahn verteilt.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
}

export function retireCar(race, car, reason, lateral) {
  car.retired = true;
  car.dnf = reason;
  car.v = 0;
  car.move = 0;
  car.pass = null;
  car.pendingIncident = null;
  car.inPit = false;
  car.wreck = { d: car.d, lateral, removed: false };
}

// Auto bleibt nach einem Vorfall liegen (z. B. nach Kollision)
export function stopCarAfterIncident(race, car, reason) {
  const r = race.rng;
  const exposed = r.chance(0.5);
  retireCar(race, car, reason, (r.chance(0.5) ? 1 : -1) * 12);
  const h = createHazard(race, {
    type: 'stopped', carId: car.id, d: car.d, need: exposed ? 'double' : 'yellow', work: r.range(70, 160),
  });
  h.desc = `${car.id} steht nach dem Vorfall – ${exposed ? 'ungeschützt direkt neben der Fahrbahn' : 'sicher hinter der Leitplanke'}`;
  race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} kann nicht weiterfahren und steht in ${cornerLabel(h.corner)} – ${exposed ? 'ungeschützt direkt neben der Fahrbahn.' : 'sicher hinter der Leitplanke.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  return h;
}

// Trümmerteile nach einer Berührung
export function createDebris(race, attacker, defender) {
  const h = createHazard(race, {
    type: 'debris', d: attacker.d, need: 'yellow', cars: [attacker.id, defender.id],
    work: race.rng.range(40, 110),
  });
  h.desc = `Trümmerteile auf der Ideallinie nach Kontakt ${attacker.id}/${defender.id}`;
  race.emit('marshal', `Sektor ${h.sector + 1}: Trümmerteile auf der Ideallinie nach Berührung ${attacker.id}/${defender.id} in ${cornerLabel(h.corner)}.`, { hazard: h.id, sector: h.sector, cars: [attacker.id, defender.id] });
  return h;
}

// Bergungsfortschritt 0–1
export function hazardProgress(h) {
  if (h.ended) return 1;
  if (!h.workTotal) return 0;
  return Math.max(0, Math.min(1, 1 - h.work / h.workTotal));
}

// Jeder Simulationsschritt: Reaktion auswerten, Bergung, Beschwerden
export function updateHazards(race, dt) {
  const t = race.time;
  for (const h of race.hazards) {
    if (h.ended) continue;
    const flag = race.flags[h.sector];
    const resp = responseLevel(race, h);
    const need = NEED_LEVEL[h.need];
    if (resp > 0 && h.firstFlagAt === null) h.firstFlagAt = t;
    if (resp > h.maxResponse) h.maxResponse = resp;
    if (h.adequateAt === null && resp >= need) h.adequateAt = t;

    if (h.okAt && t >= h.okAt) {
      h.okAt = null;
      race.emit('radio', `Funk ${h.carId}: „Mir geht's gut.“`, { cars: [h.carId] });
    }

    // Fahrer beschweren sich, wenn gar nicht abgesichert wird
    if (!h.complained && resp === 0 && t - h.start > 15) {
      h.complained = true;
      const involved = [h.carId, ...(h.cars || [])];
      const witness = race.cars
        .filter(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !involved.includes(c.id))
        .sort((a, b) => wrapD(race.track, h.d - a.d) - wrapD(race.track, h.d - b.d))[0];
      if (witness) {
        const text = h.type === 'weather'
          ? `Funk ${witness.id}: „Ich sehe gar nichts mehr, hier steht überall Wasser!“`
          : h.type === 'debris'
          ? `Funk ${witness.id}: „Da liegen überall Teile in ${h.corner.id}!“`
          : h.type === 'crash'
            ? `Funk ${witness.id}: „Riesiger Unfall in ${h.corner.id}! Da liegt alles voll!“`
            : `Funk ${witness.id}: „Da steht ein Auto in ${h.corner.id} – keine gelbe Flagge?!“`;
        race.emit('radio', text, { cars: [witness.id], sector: h.sector });
      }
    }
    // Marshals melden, wenn die Bergung so nicht vorankommt
    if (!h.hinted && h.type !== 'weather' && resp > 0 && resp < need && t - h.start > 25) {
      h.hinted = true;
      const text = need >= 4
        ? 'Bergung unter laufendem Rennen nicht möglich – die Marshals können nicht auf die Strecke.'
        : 'Marshals arbeiten direkt an der Fahrbahn – Bergung kommt so kaum voran.';
      race.emit('marshal', `Sektor ${h.sector + 1}: ${text}`, { sector: h.sector });
    }

    // Bergung
    if (h.work !== null) h.work -= dt * WORK_RATE[h.need][resp];
    const done = h.endAt !== null ? t >= h.endAt : h.work !== null && h.work <= 0;
    if (done) {
      h.ended = true;
      h.endTime = t;
      for (const id of h.carIds || (h.carId ? [h.carId] : [])) {
        const car = race.carById[id];
        if (car && car.wreck) car.wreck.removed = true;
      }
      let text;
      if (h.type === 'spin' && h.rejoined) text = `${h.carId} ist zurück auf der Strecke. Gefahr beseitigt.`;
      else if (h.type === 'stopped') text = `Auto von ${h.carId} ist geborgen. Strecke frei.`;
      else if (h.type === 'weather') text = 'Das Wasser ist weitgehend abgeflossen – die Strecke ist wieder befahrbar.';
      else if (h.type === 'crash') text = h.need === 'red' ? 'Unfallstelle geräumt, Barriere repariert. Strecke frei.' : 'Unfallstelle geräumt. Strecke frei.';
      else text = 'Trümmerteile sind beseitigt. Strecke frei.';
      race.emit('marshal', `${hazardWhere(h)}: ${text}`, { sector: h.sector, cleared: h.id });
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
