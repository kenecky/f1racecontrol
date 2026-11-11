// Gefahren auf der Strecke: Dreher, liegengebliebene Autos, Trümmerteile, schwere Unfälle.
// Erzeugt Meldungen von Marshals und Fahrern. Die Rennleitung reagiert mit Flaggen,
// VSC, Safety Car oder roter Flagge – davon hängt ab, wie schnell geborgen werden kann.
import { sectorIndexAt, wrapD } from './trackModel.js';
import { neutralLevel } from './neutral.js';
import { errorsOf } from './race.js';
import { pickText } from './texts.js';
import { craneIn } from './services.js';
import { oilSpill, carFire, gravelOnTrack } from './events.js';
import { rollUnsafeParking, rollParkedQuali } from './cases2.js';
import { wetLoss, bestCompound } from './tyres.js';

export const FLAG_FACTOR = { clear: 1, slippery: 0.97, yellow: 0.92, double: 0.8 };

// Stufen: 0 nichts, 1 Gelb, 2 Doppelt Gelb, 3 VSC, 4 Safety Car, 5 Rote Flagge
export const NEED_LEVEL = { yellow: 1, double: 2, vsc: 3, sc: 4, red: 5, pit: 1 };
export const NEED_LABEL = {
  yellow: 'Gelb', double: 'Doppelt Gelb', vsc: 'VSC', sc: 'Safety Car', red: 'Rote Flagge', pit: 'Boxengasse schließen',
};

// Bergungstempo je Gefahrenstufe (Zeile) und Reaktion der Rennleitung (Spalte 0–5)
const WORK_RATE = {
  yellow: [0.6, 1.0, 1.0, 1.5, 1.8, 3.0],
  double: [0.4, 0.6, 1.0, 1.6, 2.0, 4.0],
  vsc:    [0.2, 0.3, 0.5, 1.0, 1.4, 3.0],
  sc:     [0.1, 0.2, 0.3, 0.6, 1.0, 2.5],
  red:    [0.0, 0.0, 0.0, 0.1, 0.4, 1.0],
  pit:    [0.15, 1.0, 1.0, 1.0, 1.0, 1.0],
};

function flagLevel(h, flag) {
  if (flag === 'double') return 2;
  if (flag === 'yellow') return 1;
  if (flag === 'slippery' && (h.type === 'debris' || h.type === 'oil' || h.type === 'gravel')) return 1;
  return 0;
}

// Aktuelle Reaktionsstufe auf diese Gefahr
export function responseLevel(race, h) {
  if (h.need === 'pit') return race.svc && race.svc.pitClosed ? 1 : 0;   // Boxengasse geschlossen?
  // Start verschoben, Feld in der Boxengasse: Strecke gesperrt – jede Gefahr gilt als ausreichend abgesichert
  if (race.phase === 'delay') return Math.max(flagLevel(h, race.flags[h.sector]), NEED_LEVEL[h.need] || 0);
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
  return c.id;   // Kurvennamen werden im Spiel nicht verwendet
}

// Beim Überfahren der Ziellinie: Zufallsereignis für die nächste Runde planen
export function rollLapIncidents(race, car) {
  if (race.phase !== 'running' || car.lap >= race.laps - 1 || race.neutral) return;
  const r = race.rng;
  const L = race.track.L;
  const k = race.incScale || 1;
  const failP = (100 - car.team.reliability) * 0.000038 * k;
  let spinP = 0.0019 * (errorsOf(car) / 28) * k;
  // Nässe und falsche Reifen erhöhen das Risiko stark
  const w = race.weather.wetness;
  if (w > 0.05) {
    const best = bestCompound(w, (race.laps - car.lap) * (race.wear || 1));
    const mismatch = Math.min(3, Math.max(0, (wetLoss(car.compound, w) - wetLoss(best, w)) / 4));
    spinP *= 1 + 5 * w + 4 * mismatch;
    spinP *= 1.5 - car.driver.wet / 200;
  }
  if (r.chance(failP)) {
    // Defekt: entweder sofort stehen bleiben oder langsam zurück an die Box rollen
    car.pendingIncident = { type: r.chance(0.5) ? 'limp' : 'failure', at: car.lap * L + r.range(150, L - 300) };
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
    else if (p.type === 'limp') startLimp(race, car);
    else {
      const corner = cornerNear(race.track, car.d);
      if ((corner.vmax || 0) >= 170 && race.rng.chance(0.35 + 0.25 * race.weather.wetness)) startCrash(race, car, corner);
      else startSpin(race, car);
    }
  }
}

export function createHazard(race, props) {
  // In Training/Qualifying gibt es kein SC/VSC – dort ist Rot die passende Maßnahme
  if (race.isSession && (props.need === 'vsc' || props.need === 'sc')) props = { ...props, need: 'red' };
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
  const text = pickText(race, 'spin', { id: car.id, c: cornerLabel(h.corner) });
  h.desc = text;
  race.emit('marshal', `Sektor ${h.sector + 1}: ${text}.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  if (r.chance(0.45)) race.emit('radio', `Funk ${car.id}: „${pickText(race, 'spinRadio')}“`, { cars: [car.id] });
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
    h.needsCrane = true;      // im Kies festgefahren
    h.need = exposed ? 'double' : 'yellow';
    h.work = h.workTotal = race.rng.range(70, 160);
    h.desc = `${car.id} steckt fest – ${exposed ? 'Auto steht ungeschützt direkt neben der Fahrbahn' : 'Auto steht weit im Auslauf'}`;
    race.emit('marshal', `Sektor ${h.sector + 1}: ${pickText(race, exposed ? 'stuckExposed' : 'stuckSafe', { id: car.id })}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
    if (race.rng.chance(0.6)) race.emit('radio', `Funk ${car.id}: „${pickText(race, 'stuckRadio')}“`, { cars: [car.id] });
  } else {
    car.v = 0;
    h.endAt = race.time + 3;
    h.rejoined = true;
    if (race.rng.chance(0.25)) gravelOnTrack(race, car);
  }
}

export function startFailure(race, car, formation = false) {
  const r = race.rng;
  const side = r.chance(0.5) ? 1 : -1;
  const roll = r.next();
  // In der Formationsrunde gibt es noch kein VSC – das Auto wird mit Gelb geborgen
  const need = roll < 0.4 ? 'yellow' : roll < 0.75 || formation ? 'double' : 'vsc';
  retireCar(race, car, formation ? 'Defekt in der Formationsrunde' : 'Technischer Defekt', side * 12);
  const where = {
    yellow: 'sicher hinter der Leitplanke',
    double: 'ungeschützt direkt neben der Fahrbahn',
    vsc: 'quer am Streckenrand – der Bergungskran muss dafür auf die Strecke',
  }[need];
  const h = createHazard(race, { type: 'stopped', carId: car.id, d: car.d, need, work: r.range(70, 170), needsCrane: need !== 'yellow' && r.chance(0.7) });
  h.desc = `${car.id} hat ein Problem und stellt das Auto ab – ${where}`;
  race.emit('radio', `Funk ${car.id}: „${pickText(race, 'failureRadio')}“`, { cars: [car.id] });
  if (r.chance(0.5)) race.emit('radio', `Teamfunk ${car.team.name}: „${pickText(race, 'failureTeam')}“`, { cars: [car.id] });
  race.emit('marshal', `Sektor ${h.sector + 1}: ${car.id} steht in ${cornerLabel(h.corner)} – ${where}.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
  if (!formation && r.chance(0.12)) carFire(race, h, car);
  if (!formation) rollUnsafeParking(race, car, h);
  rollParkedQuali(race, car);
  if (!formation && r.chance(0.3)) oilSpill(race, car);
  if (formation) race.emit('rc', `${car.id} fällt in der Formationsrunde aus und kann nicht starten.`, { cars: [car.id] });
  return h;
}

// Technischer Defekt: Auto rollt langsam zurück an die Box (wandernde Gefahr, Gelb von Sektor zu Sektor)
const LIMP_TEXT = [
  '{id} wird plötzlich langsam – offenbar ein technisches Problem',
  '{id} verliert deutlich an Tempo und rollt Richtung Box',
  '{id} schleicht mit einem Defekt über die Strecke',
  '{id} hat ein Problem und fährt langsam weiter',
];
const LIMP_RADIO = [
  'Ich habe keine Leistung mehr, nur noch Notlauf!', 'Getriebe hängt im fünften Gang fest.', 'Etwas stimmt nicht, ich komme rein.',
  'Hydraulikdruck fällt, ich rolle zur Box.', 'Ich habe kaum noch Antrieb.', 'Der Motor geht in den Notlauf.',
];
export function startLimp(race, car) {
  const r = race.rng;
  const h = createHazard(race, { type: 'slow', carId: car.id, d: car.d, need: 'yellow', moving: true });
  h.desc = r.pick(LIMP_TEXT).replace('{id}', car.id);
  car.limp = { hazardId: h.id, since: race.time, factor: r.range(0.32, 0.5) };
  h.legs = [{ sector: h.sector, start: race.time, end: null, adequateAt: null }];   // jeder Sektor wird einzeln bewertet
  car.pass = null;
  race.emit('radio', `Funk ${car.id}: „${r.pick(LIMP_RADIO)}“`, { cars: [car.id] });
  race.emit('marshal', `Sektor ${h.sector + 1}: ${h.desc}.`, { hazard: h.id, sector: h.sector, cars: [car.id] });
}

// Wandernde Gefahr mit dem langsamen Auto mitführen
export function updateLimp(race, car) {
  const h = race.hazards.find(x => x.id === car.limp.hazardId);
  if (!h || h.ended) return;
  h.d = car.d;
  const sec = sectorIndexAt(race.track, car.d);
  if (sec !== h.sector) {
    const leg = h.legs && h.legs[h.legs.length - 1];
    if (leg) leg.end = race.time;
    if (h.legs) h.legs.push({ sector: sec, start: race.time, end: null, adequateAt: null });
    h.sector = sec;
    h.corner = cornerNear(race.track, car.d);
    race.emit('marshal', `Sektor ${sec + 1}: ${car.id} langsam unterwegs (Defekt).`, { hazard: h.id, sector: sec, cars: [car.id] });
  }
}

// In der Box angekommen: Auto wird abgestellt
export function limpRetire(race, car) {
  const h = race.hazards.find(x => x.id === car.limp.hazardId);
  if (h && !h.ended) h.endAt = race.time;
  retireCar(race, car, car.limp.heat ? 'Kreislaufprobleme (Hitze)' : 'Technischer Defekt (in der Box abgestellt)', 0);
  car.wreck = null;
  car.limp = null;
  race.emit('pit', `${car.id} fährt in die Box – das Auto wird in der Garage abgestellt. Aus.`, { cars: [car.id] });
}

export function startCrash(race, car, corner) {
  const r = race.rng;
  const barrier = r.chance(0.3);
  const side = r.chance(0.5) ? 1 : -1;
  retireCar(race, car, 'Unfall', side * 14);
  const h = createHazard(race, {
    type: 'crash', carId: car.id, d: car.d,
    need: barrier ? 'red' : 'sc',
    work: barrier ? r.range(360, 600) : r.range(150, 240),
    okAt: race.time + r.range(6, 12),
    needsCrane: true,
    medical: r.chance(0.55),
  });
  h.medicalText = r.pick(['er ist in Ordnung', 'er steigt selbst aus und ist okay', 'er wird zur Vorsicht ins Medical Centre gebracht']);
  if (r.chance(0.08)) carFire(race, h, car);
  h.desc = barrier
    ? `Schwerer Unfall ${car.id} – Barriere stark beschädigt, muss repariert werden`
    : `Schwerer Unfall ${car.id} – Wrack und Trümmerfeld auf der Strecke`;
  race.emit('marshal', `Sektor ${h.sector + 1}: SCHWERER UNFALL! ${pickText(race, 'crash', { id: car.id, c: cornerLabel(corner) })} ${barrier ? 'Die Barriere ist stark beschädigt und muss repariert werden.' : 'Trümmerteile über die ganze Fahrbahn verteilt.'}`, { hazard: h.id, sector: h.sector, cars: [car.id] });
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
    needsCrane: r.chance(0.6),
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
  race.emit('marshal', `Sektor ${h.sector + 1}: ${pickText(race, 'debris', { id: attacker.id, o: defender.id, c: cornerLabel(h.corner) })}`, { hazard: h.id, sector: h.sector, cars: [attacker.id, defender.id] });
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
    if (h.legs) { const leg = h.legs[h.legs.length - 1]; if (leg.adequateAt === null && resp >= need) leg.adequateAt = t; }

    if (h.okAt && t >= h.okAt) {
      h.okAt = null;
      race.emit('radio', `Funk ${h.carId}: „${pickText(race, 'crashOk')}“`, { cars: [h.carId] });
    }

    // Fahrer beschweren sich, wenn gar nicht abgesichert wird
    if (!h.complained && resp === 0 && t - h.start > 15) {
      h.complained = true;
      const involved = [h.carId, ...(h.cars || [])];
      const witness = race.cars
        .filter(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !involved.includes(c.id))
        .sort((a, b) => wrapD(race.track, h.d - a.d) - wrapD(race.track, h.d - b.d))[0];
      if (witness) {
        const key = { weather: 'complainWeather', debris: 'complainDebris', crash: 'complainCrash' }[h.type] || 'complainStopped';
        const text = `Funk ${witness.id}: „${pickText(race, key, { c: h.corner.id })}“`;
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

    // Bergung – manche Gefahren brauchen Kran, Kehrmaschine oder zuerst das Medical Car
    let rate = WORK_RATE[h.need][resp];
    const age = t - h.start;
    if (h.needsCrane && !craneIn(race, h.sector)) {
      rate *= 0.12;
      if (!h.craneHint && age > 20) { h.craneHint = true; race.emit('marshal', `Sektor ${h.sector + 1}: Wir brauchen einen Bergungskran, das Auto lässt sich so nicht wegbringen.`, { sector: h.sector }); }
    }
    if (h.needsSweeper && !h.swept) {
      if (h.work !== null && h.work < h.workTotal * 0.4) rate = 0;
      if (!h.sweepHint && age > 20) { h.sweepHint = true; race.emit('marshal', `Sektor ${h.sector + 1}: Ohne Kehrmaschine bekommen wir das nicht sauber.`, { sector: h.sector }); }
    }
    if (h.medical && !h.medicalDone) {
      if (h.work !== null && h.work < h.workTotal * 0.5) rate = 0;
      if (!h.medHint && age > 12) { h.medHint = true; race.emit('marshal', `Sektor ${h.sector + 1}: Der Fahrer muss vom Medical Car untersucht werden.`, { sector: h.sector }); }
    }
    if (h.work !== null) h.work -= dt * rate;
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
      else if (h.type === 'slow') text = `${h.carId} ist in der Boxengasse. Strecke frei.`;
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
