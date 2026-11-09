// Weitere Rennsituationen: Ölspur, loses Rad, Feuer, Tier oder Person auf der Strecke, Kanaldeckel,
// loser Randstein, Kies auf der Fahrbahn, Marshal auf der Strecke, verlorene Teile, loser Frontflügel
// (Schwarz-Orange-Flagge), Gelb missachtet, Unfall in der Boxengasse.
import { sectorIndexAt, wrapD } from './trackModel.js';
import { createHazard, cornerNear, cornerLabel, retireCar } from './hazards.js';
import { createCase, ev, measure, tvImpression } from './incidents.js';
import { aggressionOf } from './race.js';

const f1 = x => x.toFixed(1).replace('.', ',');
const near = (race, d) => {
  const c = race.cars.filter(x => !x.retired && !x.finished && !x.inPit).sort((a, b) => wrapD(race.track, d - a.d) - wrapD(race.track, d - b.d))[0];
  return c ? c.id : null;
};

function marshal(race, h, text, cars = []) {
  h.desc = text;
  race.emit('marshal', `${h.global ? 'Gesamte Strecke' : `Sektor ${h.sector + 1}`}: ${text}.`, { hazard: h.id, sector: h.sector, cars });
}

// ---------- Zufällige Ereignisse je Führungsrunde ----------
export function rollRaceEvents(race, lap) {
  if (race.neutral || race.phase !== 'running' || lap < 1 || race.isSession) return;
  const r = race.rng;
  const tr = race.track;
  const per = 1 / Math.max(8, race.laps);              // Wahrscheinlichkeit pro Rennen auf Runden verteilen
  const at = () => r.range(0, tr.L);
  if (r.chance(0.10 * per * (tr.def.id === 'montreal' ? 4 : 1))) animal(race, at());
  if (r.chance(0.012 * per)) person(race, at());
  if (tr.def.street && r.chance(0.16 * per)) manhole(race, at());
  if (r.chance(0.05 * per)) looseKerb(race);
  if (r.chance(0.05 * per)) marshalOnTrack(race);
  if (r.chance(0.12 * per)) partsOff(race);
  if (r.chance(0.035 * per)) pitIncident(race);
}

function animal(race, d) {
  const r = race.rng;
  const who = race.track.def.id === 'montreal' ? 'Ein Murmeltier' : r.pick(['Ein Hund', 'Ein Fuchs', 'Ein Hase', 'Ein Vogelschwarm']);
  const h = createHazard(race, { type: 'animal', d, need: 'double', work: r.range(40, 110) });
  marshal(race, h, `${who} auf der Strecke in ${cornerLabel(h.corner)}`);
  const id = near(race, d);
  if (id) race.emit('radio', `Funk ${id}: „${who.replace('Ein ', 'Da ist ein ').replace('Ein', 'Da ist ein')} auf der Strecke!“`, { cars: [id] });
}

function person(race, d) {
  const h = createHazard(race, { type: 'person', d, need: 'red', work: race.rng.range(150, 260) });
  marshal(race, h, `Eine Person ist über den Zaun geklettert und läuft auf der Strecke in ${cornerLabel(h.corner)}`);
}

function manhole(race, d) {
  const r = race.rng;
  const victim = race.onTrackCars().sort((a, b) => wrapD(race.track, d - a.d) - wrapD(race.track, d - b.d))[0];
  const h = createHazard(race, { type: 'manhole', d, need: 'red', work: r.range(500, 800), needsCrane: Boolean(victim) });
  marshal(race, h, `Kanaldeckel hat sich in ${cornerLabel(h.corner)} gelöst${victim ? ` – ${victim.id} ist darübergefahren und schwer beschädigt` : ''}. Alle Deckel müssen überprüft werden`);
  if (victim) {
    retireCar(race, victim, 'Schaden durch losen Kanaldeckel', 12);
    h.carId = victim.id;
    race.emit('radio', `Funk ${victim.id}: „Da war etwas im Boden! Der Unterboden ist komplett zerstört!“`, { cars: [victim.id] });
  }
}

function looseKerb(race) {
  const r = race.rng;
  const c = r.pick(race.track.corners);
  const h = createHazard(race, { type: 'kerb', d: c.d + 20, need: 'vsc', work: r.range(120, 200) });
  marshal(race, h, `Der Randstein in ${c.id} hat sich gelöst und liegt teilweise auf der Fahrbahn`);
}

function marshalOnTrack(race) {
  const r = race.rng;
  const d = r.range(0, race.track.L);
  const h = createHazard(race, { type: 'marshal', d, need: 'double' });
  h.endAt = race.time + r.range(18, 40);
  marshal(race, h, `Ein Streckenposten läuft ohne Freigabe über die Fahrbahn in ${cornerLabel(h.corner)}`);
  const id = near(race, d);
  if (id) race.emit('radio', `Funk ${id}: „Da läuft jemand über die Strecke!!“`, { cars: [id] });
}

function partsOff(race) {
  const r = race.rng;
  const car = r.pick(race.onTrackCars());
  if (!car) return;
  const part = r.pick(['ein Spiegel', 'eine Flügel-Endplatte', 'ein Teil der Motorabdeckung', 'ein Stück Unterboden']);
  const h = createHazard(race, { type: 'debris', d: car.d, need: 'yellow', work: r.range(40, 100), cars: [car.id] });
  marshal(race, h, `Von ${car.id} ist ${part} abgefallen – liegt in ${cornerLabel(h.corner)}`, [car.id]);
}

// ---------- Ölspur nach Motorschaden (mehrere Sektoren) ----------
export function oilSpill(race, car) {
  const r = race.rng;
  const tr = race.track;
  const n = r.int(1, 3);
  const s0 = sectorIndexAt(tr, car.d);
  for (let k = 0; k < n; k++) {
    const sec = (s0 - n + 1 + k + tr.sectors.length) % tr.sectors.length;
    const d = tr.sectors[sec].start + 30;
    const h = createHazard(race, { type: 'oil', d, need: 'yellow', work: r.range(90, 170), needsSweeper: r.chance(0.5) });
    h.sector = sec;
    marshal(race, h, `Ölspur von ${car.id} – die Fahrbahn ist rutschig`, [car.id]);
  }
}

// ---------- Feuer am Auto ----------
export function carFire(race, h, car) {
  h.fire = true;
  if (h.need === 'yellow' || h.need === 'double') h.need = 'vsc';
  h.work = (h.work || 100) + 60;
  h.workTotal = h.work;
  marshal(race, h, `${h.desc} – das Auto brennt! Streckenposten mit Feuerlöschern sind unterwegs`, [car.id]);
  race.emit('radio', `Funk ${car.id}: „Feuer! Es brennt hinten! Ich steige aus!“`, { cars: [car.id] });
}

// ---------- Kies auf der Fahrbahn nach Ausritt ----------
export function gravelOnTrack(race, car) {
  const h = createHazard(race, { type: 'gravel', d: car.d, need: 'yellow', work: race.rng.range(70, 140), needsSweeper: true });
  marshal(race, h, `${car.id} hat beim Zurückfahren viel Kies auf die Fahrbahn gebracht`, [car.id]);
}

// ---------- Loser Frontflügel → Schwarz-Orange-Flagge ----------
export function markWingDamage(race, car) {
  const r = race.rng;
  car.damageStayOut = r.chance(0.6);                  // Team will draußen bleiben
  car.wingLoose = r.chance(0.55) ? { fallAt: race.time + r.range(20, 110) } : null;
  if (car.damageStayOut) {
    race.emit('marshal', `${car.id} fährt mit beschädigtem Frontflügel weiter${car.wingLoose ? ' – Teile vibrieren stark' : ''}.`, { cars: [car.id] });
  }
}

export function showBlackOrange(race, car) {
  if (!car || car.boShown || car.retired) return false;
  car.boShown = true;
  car.damageStayOut = false;
  race.boLog = race.boLog || [];
  race.boLog.push({ carId: car.id, needed: Boolean(car.wingLoose), t: race.time });
  race.emit('rc', `SCHWARZ-ORANGE FLAGGE für ${car.id} – sofort an die Box (Reparatur)`, { cars: [car.id] });
  return true;
}

// ---------- Loses Rad nach dem Boxenstopp ----------
export function rollLooseWheel(race, car) {
  if (race.isSession || !race.rng.chance(0.006)) return;
  car.looseWheel = { at: race.time + race.rng.range(1.5, 14) };
}

function looseWheelNow(race, car) {
  const r = race.rng;
  const tr = race.track;
  car.looseWheel = null;
  const inPit = car.inPit;
  const h = createHazard(race, { type: inPit ? 'pit' : 'wheel', d: inPit ? tr.pit.exit - 40 : car.d, need: inPit ? 'pit' : r.chance(0.5) ? 'vsc' : 'double', work: r.range(60, 140) });
  retireCar(race, car, 'Rad nach Boxenstopp verloren', inPit ? 0 : 10);
  if (inPit) {
    car.wreck.lateral = 0;
    marshal(race, h, `Boxengasse: ${car.id} verliert direkt nach dem Stopp ein Rad und bleibt in der Fahrgasse stehen`, [car.id]);
  } else marshal(race, h, `${car.id} verliert in ${cornerLabel(h.corner)} ein Rad – es springt über die Strecke`, [car.id]);
  race.emit('radio', `Funk ${car.id}: „Das Rad ist ab! Das Rad ist ab!“`, { cars: [car.id] });
  createCase(race, {
    type: 'unsafeRelease', cars: [car.id],
    title: `Loses Rad ${car.id} – unsichere Freigabe`,
    summary: `${car.team.name} hat ${car.id} mit nicht richtig befestigtem Rad losgeschickt.`,
    evidence: [
      ev('video', 'Boxengassen-Kamera', `Der Mechaniker hinten ${r.pick(['links', 'rechts'])} hebt die Hand zu spät – das Auto fährt schon los.`, true),
      ev('data', 'Boxenstopp', `Stoppzeit ${f1(car.lastStopTime || 2.4)} s, Radmutter nicht vollständig angezogen.`),
      ev('data', 'Leitlinie', 'Ein Auto mit nicht gesichertem Rad loszuschicken ist eine unsichere Freigabe. Üblich: Startplatzstrafe bzw. 10 s, wenn das Auto weiterfährt – zusätzlich Geldstrafe für das Team.'),
    ],
    truth: { offender: car.id, expected: ['grid5', '10s'], points: [0, 0] },
  });
}

// ---------- Unfall in der Boxengasse / an Ein- oder Ausfahrt ----------
function pitIncident(race) {
  const r = race.rng;
  const tr = race.track;
  const kind = r.pick(['entry', 'exit', 'lane']);
  const d = kind === 'entry' ? tr.pit.entry : kind === 'exit' ? tr.pit.exit : tr.pit.box + 40;
  const car = r.pick(race.onTrackCars());
  if (!car) return;
  const h = createHazard(race, { type: 'pit', d, need: 'pit', work: r.range(90, 170) });
  const text = {
    entry: `${car.id} verliert an der Boxeneinfahrt die Kontrolle und schlägt in die Boxenmauer ein`,
    exit: `Kollision an der Boxenausfahrt – ${car.id} kommt beim Einfädeln quer`,
    lane: `In der Boxengasse liegt Ausrüstung in der Fahrgasse, ein Mechaniker ist gestürzt`,
  }[kind];
  if (kind !== 'lane') { retireCar(race, car, 'Unfall in der Boxengasse', 0); h.carId = car.id; }
  marshal(race, h, `${text}. Die Boxengasse muss geschlossen werden`, kind !== 'lane' ? [car.id] : []);
}

// ---------- Laufende Prüfungen ----------
export function updateEvents(race, dt) {
  if (race.phase !== 'running') return;
  const tr = race.track;
  for (const car of race.cars) {
    if (car.retired || car.finished) continue;
    // loses Rad
    if (car.looseWheel && race.time >= car.looseWheel.at) looseWheelNow(race, car);
    // loser Flügel fällt ab
    if (car.wingLoose && race.time >= car.wingLoose.fallAt && !car.inPit) {
      car.wingLoose = null;
      const h = createHazard(race, { type: 'debris', d: car.d, need: 'yellow', work: race.rng.range(50, 110), cars: [car.id] });
      marshal(race, h, `Der lose Frontflügel von ${car.id} ist abgefallen und liegt auf der Strecke`, [car.id]);
      if (!car.boShown) { race.boLog = race.boLog || []; race.boLog.push({ carId: car.id, late: true, t: race.time }); }
      car.damageStayOut = false;
    }
    // Gelb missachtet: beim Einfahren in einen gelben Sektor
    const sec = sectorIndexAt(tr, car.d);
    if (car.secNow !== sec) {
      car.secNow = sec;
      const f = race.flags[sec];
      if ((f === 'yellow' || f === 'double') && !race.neutral && !car.inPit && race.rng.chance(0.018 * aggressionOf(car) / 70)) {
        yellowIgnored(race, car, sec, f === 'double');
      }
    }
  }
}

function yellowIgnored(race, car, sec, dbl) {
  const r = race.rng;
  const guilty = r.chance(0.6);
  const lift = measure(race, guilty ? 0.04 : 0.3, 0.1, 0, 0.8);
  const delta = measure(race, guilty ? -0.05 : 0.35, 0.18, -0.5, 1.2);
  const session = race.isSession;
  createCase(race, {
    type: 'yellowIgnored', cars: [car.id],
    title: `${car.id} unter ${dbl ? 'Doppelt Gelb' : 'Gelb'} nicht verlangsamt? – Sektor ${sec + 1}`,
    summary: `${car.id} fährt durch Sektor ${sec + 1}, während dort ${dbl ? 'Doppelt Gelb' : 'Gelb'} gezeigt wird.`,
    evidence: [
      ev('data', 'Mini-Sektor', `${car.id} ist im gelben Abschnitt ${delta >= 0 ? `${f1(delta)} s langsamer` : `${f1(-delta)} s schneller`} als seine Bestzeit dort.`, true),
      ev('telemetry', 'Gaspedal', `${car.id} lupft für ${f1(lift)} s.`),
      ev('radio', `Teamfunk ${car.team.name}`, guilty ? '„Wir haben ihn auf die gelbe Flagge hingewiesen.“' : '„Er hat deutlich verlangsamt, siehe Daten.“'),
      ev('data', 'Leitlinie', dbl
        ? 'Doppelt Gelb: deutlich verlangsamen und bereit sein anzuhalten. Keine Bestzeit im Mini-Sektor.'
        : 'Gelb: verlangsamen, nicht überholen. Eine Bestzeit im gelben Mini-Sektor gilt als nicht verlangsamt.'),
    ],
    truth: guilty
      ? { offender: car.id, expected: session ? ['grid3', 'grid5'] : dbl ? ['10s', 'dt'] : ['5s', '10s'], points: dbl ? [1, 2] : [0, 1] }
      : { offender: null, expected: ['none'], points: [0, 0] },
  });
}
