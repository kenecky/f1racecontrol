// Technische Abnahme nach Rennen und Sprint (stark vereinfacht nach dem FIA-Reglement 2026).
// Die FIA prüft die Top 3 immer, die Rennleitung kann weitere Autos auswählen.
// Jedes Auto hat verborgene „wahre“ Werte; gemessen wird mit Messunsicherheit.
// Klare Fälle sind sofort erledigt, Grenzfälle werden zu Entscheidungen.
import { createCase, ev, measure } from './incidents.js';

export const TECH_CHECKS = {
  weight: { name: 'Mindestgewicht', rule: 'mind. 768 kg inkl. Fahrer, ohne Kraftstoff' },
  fuel:   { name: 'Kraftstoffprobe', rule: 'mind. 1,0 l müssen nach dem Rennen entnommen werden können' },
  plank:  { name: 'Unterboden-Planke', rule: 'neu 10 mm, nach dem Rennen an jedem Messpunkt mind. 9,0 mm' },
  power:  { name: 'Antriebsleistung', rule: 'MGU-K max. 350 kW (FIA-Sensor)' },
  wing:   { name: 'Flügel-Belastungstest', rule: 'Frontflügel max. 15,0 mm Durchbiegung unter Prüflast (vereinfacht)' },
};
export const EXTRA_CHECKS = 3;   // so viele Autos darf die Rennleitung zusätzlich prüfen lassen

const fx = (x, n = 1) => x.toFixed(n).replace('.', ',');

// Beim Rennende: verborgene Werte aller gewerteten Autos festlegen
export function prepareScrutiny(race) {
  if (race.scrutiny || race.isSession) return;
  const r = race.rng;
  const classified = race.standings().filter(c => c.finished && !c.dsq);
  const hidden = {};
  for (const c of classified) {
    const driftUp = r.chance(0.01);
    hidden[c.id] = {
      weight: r.chance(0.008) ? 768 - r.range(0.05, 1.8) : 768 + r.range(0.1, 15),
      fuel: r.chance(0.01) ? r.range(0.3, 0.97) : r.range(1.0, 4.0),
      plank: r.chance(0.01) ? r.range(8.8, 8.98) : r.range(9.0, 10),
      power: r.chance(0.005) ? r.range(351.5, 358) : r.range(345, 349.8),
      drift: driftUp ? r.range(0.8, 2) : r.range(-0.15, 0.15),        // Messfehler des Sensors in %
      wing: r.chance(0.005) ? r.range(15.2, 16.8) : r.range(8.5, 14.95),
    };
  }
  race.scrutiny = { done: false, mandatory: classified.slice(0, 3).map(c => c.id), extra: [], hidden, results: [] };
}

// Prüfung durchführen (extraIds: zusätzlich gewählte Autos)
export function runScrutiny(race, extraIds = []) {
  const s = race.scrutiny;
  if (!s || s.done) return [];
  s.extra = extraIds.filter(id => s.hidden[id] && !s.mandatory.includes(id)).slice(0, EXTRA_CHECKS);
  const created = [];
  for (const id of [...s.mandatory, ...s.extra]) {
    const car = race.carById[id];
    const h = s.hidden[id];
    const items = [checkWeight, checkFuel, checkPlank, checkPower, checkWing].map(fn => fn(race, car, h));
    for (const it of items) if (it.caseId) created.push(it.caseId);
    s.results.push({ carId: id, items });
  }
  s.done = true;
  race.emit('rc', `Technische Abnahme abgeschlossen: ${[...s.mandatory, ...s.extra].join(', ')} geprüft${created.length ? ` – ${created.length} Auffälligkeit${created.length > 1 ? 'en' : ''}` : ' – alles in Ordnung'}.`);
  return created;
}

function techCase(race, car, check, { summary, evidence, violation }) {
  const c = createCase(race, {
    type: 'tech', cars: [car.id],
    title: `Technische Abnahme ${car.id}: ${TECH_CHECKS[check].name}`,
    summary,
    evidence: [...evidence, ev('data', 'Reglement', `${TECH_CHECKS[check].name}: ${TECH_CHECKS[check].rule}. Verstöße führen zur Disqualifikation – Absicht spielt keine Rolle.`)],
    truth: violation
      ? { offender: car.id, expected: ['dsq'], points: [0, 0] }
      : { offender: null, expected: ['none'], points: [0, 0] },
  });
  c.when = 'Nach dem Rennen';
  return c.id;
}

function checkWeight(race, car, h) {
  const m1 = h.weight + race.rng.gauss(0.12);
  const item = { check: 'weight', text: `${fx(m1)} kg`, ok: true };
  if (m1 >= 768.4) return item;
  const m2 = h.weight + race.rng.gauss(0.04);
  item.ok = false;
  item.caseId = techCase(race, car, 'weight', {
    violation: h.weight < 768,
    summary: `${car.id} liegt beim Wiegen nach dem Rennen sehr knapp am Mindestgewicht.`,
    evidence: [
      ev('data', 'Waage der FIA', `Gewogen: ${fx(m1)} kg (Limit 768,0 kg). Messgenauigkeit der Waage ±0,1 kg.`, true),
      ev('data', 'Zweite Wägung (nach Trocknen des Autos)', `${fx(m2, 2)} kg.`),
      ev('radio', `Team ${car.team.name}`, h.weight < 768
        ? '„Der Fahrer hat im Rennen viel Flüssigkeit verloren, außerdem fehlt Gummi an den Reifen.“'
        : '„Wir liegen über dem Limit, die erste Messung war ungenau.“'),
    ],
  });
  return item;
}

function checkFuel(race, car, h) {
  const m1 = Math.max(0, h.fuel + race.rng.gauss(0.03));
  const item = { check: 'fuel', text: `${fx(m1, 2)} l`, ok: true };
  if (m1 >= 1.05) return item;
  const claim = h.fuel + race.rng.range(0.15, 0.7);
  item.ok = false;
  item.caseId = techCase(race, car, 'fuel', {
    violation: h.fuel < 1,
    summary: `Bei ${car.id} kann nach dem Rennen kaum die Pflichtmenge Kraftstoff entnommen werden.`,
    evidence: [
      ev('data', 'Kraftstoffentnahme', `Entnommen: ${fx(m1, 2)} l (Pflicht: 1,00 l).`, true),
      ev('data', `Daten von ${car.team.name}`, `Laut Team befanden sich noch ${fx(claim, 2)} l im Tank.`, true),
      ev('data', 'Zweite Entnahme', h.fuel >= 1
        ? `Nach Entlüften der Leitung insgesamt ${fx(h.fuel + race.rng.gauss(0.01), 2)} l entnommen.`
        : `Keine weitere Menge entnehmbar – insgesamt ${fx(h.fuel, 2)} l.`),
      ev('data', 'Hinweis', 'Entscheidend ist die tatsächlich entnommene Menge, nicht die Angabe des Teams.'),
    ],
  });
  return item;
}

function checkPlank(race, car, h) {
  const r = race.rng;
  const pts = [h.plank, h.plank + r.range(0.05, 0.4), h.plank + r.range(0.1, 0.5), h.plank + r.range(0.02, 0.3)];
  // Reihenfolge der Messpunkte mischen
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const meas = pts.map(p => p + r.gauss(0.015));
  const min = Math.min(...meas);
  const item = { check: 'plank', text: `min. ${fx(min, 2)} mm`, ok: true };
  if (min >= 9.02) return item;
  const k = meas.indexOf(min);
  item.ok = false;
  item.caseId = techCase(race, car, 'plank', {
    violation: h.plank < 9,
    summary: `Die Planke am Unterboden von ${car.id} ist an einem Messpunkt sehr dünn.`,
    evidence: [
      ev('data', 'Messpunkte (Dicke)', meas.map((x, i) => `MP${i + 1}: ${fx(x, 2)}`).join(' · ') + ' mm', true),
      ev('data', `Nachmessung MP${k + 1}`, `${fx(pts[k] + r.gauss(0.005), 3)} mm (genaueres Messgerät).`),
      ev('radio', `Team ${car.team.name}`, '„Die Strecke war extrem wellig, das Auto hat öfter aufgesetzt als erwartet.“'),
    ],
  });
  return item;
}

function checkPower(race, car, h) {
  const r = race.rng;
  const sensor = h.power * (1 + h.drift / 100) + r.gauss(0.3);
  const item = { check: 'power', text: `${fx(Math.min(sensor, 999))} kW`, ok: true };
  if (sensor <= 350.4) return item;
  const team = h.power - r.range(0.5, 2.5);
  const lap = Math.max(1, Math.floor(r.range(0.2, 1) * race.laps));
  item.ok = false;
  item.caseId = techCase(race, car, 'power', {
    violation: h.power > 350,
    summary: `Der FIA-Sensor meldet bei ${car.id} zu viel Leistung der MGU-K – Verdacht auf Manipulation.`,
    evidence: [
      ev('telemetry', 'FIA-Sensor MGU-K', `Spitzenleistung ${fx(sensor)} kW in Runde ${lap} für ${fx(r.range(0.2, 1.5))} s (Limit 350 kW).`, true),
      ev('telemetry', `Daten von ${car.team.name}`, `Eigene Messung: ${fx(team)} kW.`),
      ev('data', 'Prüfung des Sensors', Math.abs(h.drift) > 0.5
        ? `Kalibrierung: Der Sensor misst ${fx(h.drift)} % zu hoch.`
        : `Kalibrierung: Sensor arbeitet korrekt (Abweichung ${fx(Math.abs(h.drift), 2)} %).`),
      ev('data', 'Hinweis', 'Maßgeblich sind die Daten der FIA-Sensoren – außer der Sensor ist nachweislich fehlerhaft.'),
    ],
  });
  return item;
}

function checkWing(race, car, h) {
  const m1 = h.wing + race.rng.gauss(0.15);
  const item = { check: 'wing', text: `${fx(m1)} mm`, ok: true };
  if (m1 <= 14.8) return item;
  item.ok = false;
  item.caseId = techCase(race, car, 'wing', {
    violation: h.wing > 15,
    summary: `Der Frontflügel von ${car.id} biegt sich im Belastungstest fast über das Limit.`,
    evidence: [
      ev('data', 'Belastungstest', `Durchbiegung ${fx(m1)} mm (Limit 15,0 mm).`, true),
      ev('data', 'Wiederholung mit neuem Prüfaufbau', `${fx(h.wing + race.rng.gauss(0.05), 2)} mm.`),
      ev('radio', `Team ${car.team.name}`, '„Der Flügel hat im Rennen Kontakt mit einem Randstein gehabt.“'),
    ],
  });
  return item;
}

// Zusammenfassung für die Ergebnisliste
export function scrutinySummary(race) {
  const s = race.scrutiny;
  if (!s) return null;
  return { done: s.done, mandatory: s.mandatory, extra: s.extra, results: s.results };
}
