// Technik und Reglement: Reifenregel, Parc fermé, Energiefluss, aktive Aerodynamik und Overtake-Modus
// (Reglement 2026, vereinfacht), Reifendruck vor dem Start, Mechaniker in der Startaufstellung,
// Auto zu spät in der Startaufstellung.
import { createCase, ev, measure } from './incidents.js';
import { createRng } from '../util/rng.js';

const f1 = x => x.toFixed(1).replace('.', ',');
const pickCar = race => {
  const c = race.cars.filter(x => !x.retired && !x.pitStart);
  return c.length ? race.rng.pick(c) : null;
};

// Im Rennen: seltene technische Verstöße (pro Führungsrunde gewürfelt)
export function rollRegs(race, lap) {
  if (race.isSession || race.neutral || race.phase !== 'running' || lap < 2) return;
  const r = race.rng;
  const per = 1 / Math.max(8, race.laps);
  if (r.chance(0.06 * per)) fuelFlow(race);
  if (r.chance(0.09 * per)) aeroMode(race);
  if (r.chance(0.09 * per)) overtakeMode(race);
}

function fuelFlow(race) {
  const car = pickCar(race); if (!car) return;
  const r = race.rng;
  const guilty = r.chance(0.5);
  const peak = measure(race, guilty ? 3070 : 3030, 25, 2950, 3200);
  createCase(race, {
    type: 'fuelFlow', cars: [car.id],
    title: `Energiefluss ${car.id} zu hoch?`,
    summary: `Der FIA-Sensor meldet bei ${car.id} einen zu hohen Energiefluss aus dem Kraftstoff.`,
    evidence: [
      ev('telemetry', 'FIA-Sensor', `Spitze ${Math.round(peak)} MJ/h über ${f1(r.range(0.4, 3))} s (Limit 3000 MJ/h).`, true),
      ev('data', 'Prüfung des Sensors', guilty ? 'Sensor arbeitet korrekt, Werte bestätigt durch zweiten Sensor.' : 'Zweiter Sensor zeigt Werte unter dem Limit – der erste Sensor ist auffällig.'),
      ev('radio', `Teamfunk ${car.team.name}`, '„Unsere Daten zeigen nichts Auffälliges.“'),
      ev('data', 'Leitlinie', 'Wer das Limit des Energieflusses überschreitet, muss den Motormodus sofort ändern; bei Vorteil Durchfahrt bis Disqualifikation.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['dt', 'dsq'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

function aeroMode(race) {
  const car = pickCar(race); if (!car) return;
  const r = race.rng;
  const guilty = r.chance(0.55);
  const corner = r.pick(race.track.corners);
  createCase(race, {
    type: 'aeroMode', cars: [car.id], corner: corner.id,
    title: `Aktive Aerodynamik ${car.id} außerhalb der Zone?`,
    summary: `${car.id} fährt vor ${corner.id} offenbar noch im Modus mit wenig Abtrieb.`,
    evidence: [
      ev('telemetry', 'Flügelstellung', `Flügel ${f1(measure(race, guilty ? 1.2 : 0.2, 0.3, 0, 3))} s zu spät in die Kurvenstellung zurückgefahren.`, true),
      ev('data', 'Zonen', `Die Gerade vor ${corner.id} ${guilty ? 'gehört nicht' : 'gehört bis zum Bremspunkt'} zur Zone mit wenig Abtrieb.`),
      ev('data', 'Leitlinie', 'Der Modus mit wenig Abtrieb (aktive Aero 2026) ist nur in den festgelegten Zonen erlaubt.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', '5s'], points: [0, 1] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

function overtakeMode(race) {
  const car = pickCar(race); if (!car) return;
  const r = race.rng;
  const guilty = r.chance(0.5);
  const gap = measure(race, guilty ? 1.35 : 0.85, 0.2, 0.2, 2.5);
  createCase(race, {
    type: 'overtakeMode', cars: [car.id],
    title: `Overtake-Modus ${car.id} ohne Berechtigung?`,
    summary: `${car.id} nutzt die zusätzliche Batterieleistung zum Überholen.`,
    evidence: [
      ev('data', 'Abstand am Messpunkt', `${f1(gap)} s zum Vordermann (berechtigt bis 1,0 s).`, true),
      ev('telemetry', 'Energie', `${f1(r.range(0.3, 0.6))} MJ zusätzlich abgerufen.`),
      ev('data', 'Leitlinie', 'Der Overtake-Modus ist nur erlaubt, wenn das Auto am Messpunkt weniger als eine Sekunde hinter dem Vordermann liegt.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', '5s'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

// Beim Start (Lichter aus): Reifendruck-Kontrolle und Mechaniker in der Startaufstellung
export function rollStartRegs(race) {
  if (race.isSession) return;
  const r = race.rng;
  if (r.chance(0.07)) {
    const car = pickCar(race); if (!car) return;
    const guilty = r.chance(0.55);
    const psi = measure(race, guilty ? 20.6 : 21.1, 0.25, 19.5, 22);
    createCase(race, {
      type: 'tyrePressure', cars: [car.id],
      title: `Reifendruck ${car.id} unter dem Minimum?`,
      summary: `Bei der Kontrolle vor dem Start fällt der Druck eines Reifens von ${car.id} knapp aus.`,
      evidence: [
        ev('data', 'Messung des Reifenherstellers', `Vorne links ${f1(psi)} psi (Minimum 21,0 psi), Reifendecke ${guilty ? 'zu früh entfernt' : 'vorschriftsmäßig'}.`, true),
        ev('data', 'Zweite Messung', `${f1(measure(race, guilty ? 20.7 : 21.2, 0.08, 19.5, 22))} psi.`),
        ev('data', 'Leitlinie', 'Startdruck und Reifentemperatur sind vorgeschrieben. Ein Unterschreiten bringt in der Regel eine Zeitstrafe.'),
      ],
      truth: guilty ? { offender: car.id, expected: ['5s', '10s'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
    });
  }
  if (r.chance(0.06)) {
    const car = pickCar(race); if (!car) return;
    const guilty = r.chance(0.6);
    const late = measure(race, guilty ? 2.5 : -1, 1.5, -4, 8);
    createCase(race, {
      type: 'gridCrew', cars: [car.id],
      title: `Mechaniker von ${car.id} zu spät aus der Startaufstellung?`,
      summary: `Beim 15-Sekunden-Signal arbeiten noch Mechaniker an ${car.id}.`,
      evidence: [
        ev('video', 'Kamera Startaufstellung', `Der letzte Mechaniker verlässt die Startaufstellung ${late > 0 ? `${f1(late)} s nach` : `${f1(-late)} s vor`} dem 15-Sekunden-Signal.`, true),
        ev('data', 'Leitlinie', 'Beim 15-Sekunden-Signal müssen alle Teammitglieder die Startaufstellung verlassen haben (üblich: 5 s, bei Gefahr mehr).'),
      ],
      truth: guilty ? { offender: car.id, expected: ['5s', '10s'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
    });
  }
}

// Zu spät in die Startaufstellung: Boxenausfahrt schon geschlossen → Start aus der Boxengasse
export function lateToGrid(race) {
  if (race.isSession || !race.rng.chance(0.03)) return null;
  const cand = race.cars.filter(c => !c.retired && !c.pitStart && c.gridPos > 3);
  return cand.length ? race.rng.pick(cand) : null;
}

// Nach dem Rennen: Pflicht, im Trockenen zwei verschiedene Reifenmischungen zu nutzen
export function checkTyreRule(race) {
  if (race.isSession || race.kind === 'sprint') return;
  const wetRace = race.cars.some(c => [...c.usedCompounds].some(x => x === 'I' || x === 'W'));
  if (wetRace) return;
  for (const car of race.cars) {
    if (!car.finished || car.dsq || car.usedCompounds.size >= 2) continue;
    const c = createCase(race, {
      type: 'tyreRule', cars: [car.id],
      title: `${car.id} hat nur eine Reifenmischung genutzt`,
      summary: `${car.id} ist das trockene Rennen nur auf einer Mischung (${[...car.usedCompounds].join('')}) gefahren.`,
      evidence: [
        ev('data', 'Reifendaten', `Genutzte Mischungen: ${[...car.usedCompounds].join(', ')} · Boxenstopps: ${car.stops}.`, true),
        ev('data', 'Leitlinie', 'Im trockenen Rennen müssen mindestens zwei verschiedene Trockenmischungen gefahren werden. Wer das nicht tut, wird in der Regel disqualifiziert bzw. erhält eine hohe Zeitstrafe.'),
      ],
      truth: { offender: car.id, expected: ['dsq'], points: [0, 0] },
    });
    c.when = 'Nach dem Rennen';
  }
}

// Nach dem Qualifying: Parc-fermé-Verstoß
export function rollParcFerme(race) {
  if (!race.isSession || race.kind === 'fp' || !race.rng.chance(0.15)) return;
  const car = pickCar(race); if (!car) return;
  const r = race.rng;
  const allowed = r.chance(0.4);
  const c = createCase(race, {
    type: 'parcFerme', cars: [car.id],
    title: `Parc-fermé-Verstoß ${car.id}?`,
    summary: `${car.team.name} hat nach dem Qualifying am Auto von ${car.id} gearbeitet.`,
    evidence: [
      ev('data', 'Technischer Delegierter', `Gewechselt: ${r.pick(['Frontflügel-Einstellung', 'Unterboden', 'Federn der Hinterachse', 'Kühlöffnungen'])}.`, true),
      ev('data', 'Antrag des Teams', allowed ? 'Vorher beantragt und als Reparatur (gleiches Teil) genehmigt.' : 'Kein Antrag gestellt – geänderte Abstimmung.'),
      ev('data', 'Leitlinie', 'Nach dem Qualifying gilt Parc fermé. Änderungen an der Abstimmung ohne Genehmigung: Start aus der Boxengasse.'),
    ],
    truth: allowed ? { offender: null, expected: ['none'], points: [0, 0] } : { offender: car.id, expected: ['pitstart'], points: [0, 0] },
  });
  c.when = 'Nach dem Qualifying';
}

// ---------- Fahrerbesprechung (nach dem Qualifying, vor dem Rennen) ----------
// Fahrer weisen auf Kurven hin, in denen die Streckenbegrenzung oft überfahren wird. Die Rennleitung legt
// fest, wo Track Limits überwacht werden. Nicht überwachte Problemkurven führen zu Beschwerden.
export function prepareBriefing(race) {
  if (race.briefing || race.isSession) return race.briefing;
  const r = createRng(((race.seed || 1) * 31337) ^ 0xb21f);
  const corners = race.track.corners;
  const fast = corners.filter(c => (c.vmax || 0) >= 110);
  const hotspot = r.pick(fast.length ? fast : corners).id;
  let decoy = r.pick(corners).id;
  if (decoy === hotspot) decoy = corners[(corners.findIndex(c => c.id === hotspot) + 2) % corners.length].id;
  const drivers = race.cars.map(c => c.id);
  // jeder Fahrer höchstens einmal
  const pick = () => drivers.splice(Math.floor(r.next() * drivers.length), 1)[0];
  let decoy2 = r.pick(corners).id;
  if (decoy2 === hotspot || decoy2 === decoy) decoy2 = corners[(corners.findIndex(c => c.id === hotspot) + 4) % corners.length].id;
  const GENERAL = [
    '„Die Boxenausfahrt ist sehr eng, bitte auf die Linie achten.“',
    '„Beim Neustart bitte nicht wieder so lange warten.“',
    '„Die Startaufstellung ist rutschig, Vorsicht beim Start.“',
    '„Bitte bei Gelb früher reagieren, letztes Mal stand ein Auto ewig ungesichert da.“',
    '„Die blauen Flaggen kamen zuletzt viel zu spät.“',
    '„Das Safety Car war beim letzten Rennen viel zu langsam, die Reifen werden kalt.“',
    '„Auf der Geraden bitte keine Manöver in der Bremszone tolerieren.“',
  ];
  const gen = [...GENERAL];
  const takeGen = () => gen.splice(Math.floor(r.next() * gen.length), 1)[0];
  const notes = [
    { who: pick(), text: `„Am Ausgang von ${hotspot} gehen alle mit vier Rädern über die Linie – das muss überwacht werden.“` },
    { who: pick(), text: `„In ${decoy} ist der Randstein sehr hoch, aber da gewinnt man nichts.“` },
    { who: pick(), text: `„Bitte ${hotspot} konsequent kontrollieren, sonst ist es unfair.“` },
    { who: pick(), text: `„In ${decoy2} kürzt keiner ab, da liegt Kies direkt hinter dem Randstein.“` },
    { who: pick(), text: takeGen() },
    { who: pick(), text: takeGen() },
  ];
  // Reihenfolge mischen (fest je Rennen)
  for (let i = notes.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [notes[i], notes[j]] = [notes[j], notes[i]]; }
  race.briefing = { hotspot, decoy, notes, tlCorners: null, done: false };
  return race.briefing;
}
