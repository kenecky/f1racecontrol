// Vorfälle zwischen Fahrern und Regelverstöße → Fälle für die Rennleitung.
// Jeder Fall hat eine interne "Wahrheit" (wer schuld ist, welche Strafe angemessen wäre)
// und Beweise, die der Spieler auswerten muss. Beweise können unklar oder parteiisch sein.
import { msgFactor } from './messages.js';
import { startSpin, stopCarAfterIncident, createDebris, cornerNear, cornerLabel, createHazard, retireCar } from './hazards.js';
import { sectorIndexAt, wrapD } from './trackModel.js';
import { aggressionOf, errorsOf } from './race.js';
import { markWingDamage } from './events.js';
import { rollDefending } from './cases2.js';
import { sceneCollision, sceneForcedOff, sceneOffTrackPass, sceneUnsafeRelease, sceneUnsafeRejoin, scenePileup, sceneJumpStart } from './scenes.js';
import { say } from './voices.js';

export const CASE_TYPES = {
  collision:     { name: 'Kollision',                     options: ['warning', '5s', '10s', 'dt', 'sg', 'grid3', 'grid5', 'grid10', 'dsq'] },
  pileup:        { name: 'Massenunfall',                  options: ['warning', '5s', '10s', 'dt', 'sg', 'grid3', 'grid5', 'grid10', 'dsq'] },
  forcedOff:     { name: 'Abdrängen von der Strecke',     options: ['warning', '5s', '10s', 'dt', 'grid3', 'grid5'] },
  offTrackPass:  { name: 'Überholen neben der Strecke',   options: ['warning', 'giveback', '5s', '10s'] },
  complaint:     { name: 'Beschwerde eines Teams',        options: ['warning', '5s', '10s', 'dt'] },
  trackLimits:   { name: 'Track Limits',                  options: ['warning', 'bw', '5s', '10s'] },
  pitSpeeding:   { name: 'Zu schnell in der Boxengasse',  options: ['warning', '5s', '10s', 'dt'] },
  unsafeRelease: { name: 'Unsichere Boxenfreigabe',       options: ['warning', '5s', '10s'] },
  unsafeRejoin:  { name: 'Unsichere Rückkehr auf die Strecke', options: ['warning', '5s', '10s', 'dt'] },
  yellowPass:    { name: 'Überholen unter Gelb',          options: ['warning', '5s', '10s', 'dt', 'sg', 'grid3', 'grid5'] },
  vscDelta:      { name: 'VSC-Delta unterschritten',      options: ['warning', '5s', '10s', 'dt'] },
  ignoredOrder:  { name: 'Anordnung nicht befolgt',       options: ['warning', '5s', '10s', 'dt', 'sg', 'grid5', 'dsq'] },
  tlLap:         { name: 'Track Limits (Rundenzeit)',     options: ['deleteLap'] },
  impeding:      { name: 'Behinderung',                   options: ['warning', 'grid3', 'grid5', 'grid10'] },
  blueFlag:      { name: 'Blaue Flaggen missachtet',       options: ['warning', '5s', '10s', 'dt'] },
  weaving:       { name: 'Mehrfacher Richtungswechsel',    options: ['warning', 'bw', '5s', '10s'] },
  brakeTest:     { name: 'Bremstest',                       options: ['warning', '5s', '10s', 'dt', 'grid3', 'grid5'] },
  scContact:     { name: 'Berührung hinter dem Safety Car', options: ['warning', '5s', '10s', 'dt'] },
  neutralPass:   { name: 'Überholen unter SC/VSC',          options: ['warning', 'giveback', '5s', '10s'] },
  scGap:         { name: 'Zu großer Abstand zum Safety Car', options: ['warning', '5s', '10s'] },
  restartIrreg:  { name: 'Unregelmäßiger Neustart',         options: ['warning', '5s', '10s'] },
  chicaneCut:    { name: 'Schikane abgekürzt',              options: ['warning', 'giveback', '5s', '10s'] },
  unsafeParking: { name: 'Auto unsicher abgestellt',        options: ['warning', 'grid3', 'grid5'] },
  pitLine:       { name: 'Linie an der Boxengasse überfahren', options: ['warning', '5s', '10s'] },
  pitClosedEntry: { name: 'Einfahrt in die geschlossene Boxengasse', options: ['warning', '10s', 'dt', 'sg'] },
  redWork:       { name: 'Unerlaubte Arbeiten unter Rot',   options: ['warning', '10s', 'dt', 'sg'] },
  pitQueue:      { name: 'Behinderung in der Boxengasse',   options: ['warning', 'grid3', 'grid5'] },
  fuelFlow:      { name: 'Energiefluss überschritten',    options: ['warning', 'dt', 'sg', 'dsq'] },
  aeroMode:      { name: 'Aktive Aerodynamik falsch genutzt', options: ['warning', '5s', '10s'] },
  overtakeMode:  { name: 'Overtake-Modus ohne Berechtigung', options: ['warning', '5s', '10s'] },
  tyrePressure:  { name: 'Reifendruck vor dem Start',     options: ['warning', '5s', '10s', 'dsq'] },
  gridCrew:      { name: 'Mechaniker in der Startaufstellung', options: ['warning', '5s', '10s'] },
  tyreRule:      { name: 'Reifenregel (zwei Mischungen)', options: ['warning', '10s', 'dsq'] },
  parcFerme:     { name: 'Parc-fermé-Verstoß',            options: ['warning', 'grid5', 'pitstart'] },
  parkedQuali:   { name: 'Absichtlich abgestellt (Qualifying)', options: ['warning', 'grid5', 'dsq'] },
  slowOutlap:    { name: 'Zu langsame Aufwärmrunde',      options: ['warning', 'grid3', 'grid5'] },
  outlapPass:    { name: 'Überholen vor der Linie (Aufwärmrunde)', options: ['warning', 'grid3', 'grid5'] },
  language:      { name: 'Schimpfwörter',                 options: ['warning', 'fine'] },
  protest:       { name: 'Protest / Antrag auf Überprüfung', options: [] },
  yellowIgnored: { name: 'Gelb missachtet',               options: ['warning', '5s', '10s', 'dt', 'grid3', 'grid5'] },
  jumpStart:     { name: 'Fehlstart',                     options: ['warning', '5s', '10s', 'dt'] },
  gridBox:       { name: 'Falsche Startposition',         options: ['warning', '5s', '10s'] },
  tech:          { name: 'Technische Abnahme',            options: ['warning', 'dsq'] },
};

const f1 = x => x.toFixed(1).replace('.', ',');

// Funksprüche in den Beweisen ({o} = der andere Fahrer)
const RADIO = {
  hitBy: ['{o} ist mir einfach reingefahren!', 'Was macht {o} da?! Der hat mich abgeschossen!', '{o} hat mich hinten links erwischt!',
    'Ich wurde getroffen! Schaut euch das an!', '{o} hat überhaupt nicht gebremst!', 'Das war doch Absicht von {o}!',
    'Kontakt! {o} kam aus dem Nichts.', 'Er hat mich umgedreht! Strafe!'],
  doorClosed: ['{o} hat mir die Tür zugemacht!', 'Er zieht einfach rüber, ich war schon daneben!', '{o} lässt mir keinen Platz!',
    'Ich war neben ihm, er hat mich gesehen!', 'Er bewegt sich in der Bremszone!', 'Das war meine Linie!'],
  admitAtt: ['Hm … vielleicht etwas zu optimistisch.', 'Da habe ich mich verschätzt.', 'Zu spät gebremst, sorry.'],
  admitDef: ['Ich habe ihn zu spät gesehen.', 'Hab ihn im Spiegel nicht gesehen.', 'Ich dachte, er bleibt hinter mir.'],
  pushedOff: ['Er hat mich rausgedrückt! Keine Autobreite Platz!', '{o} drückt mich von der Strecke!', 'Wohin soll ich denn da noch?!',
    'Keine Autobreite! Das ist gegen die Regeln!', 'Ich musste ins Gras, sonst hätte es gekracht!'],
  myCorner: ['Ich war vorne, das ist meine Kurve.', 'Ganz normales Racing.', 'Ich habe meine Linie gehalten.', 'Er war nie richtig daneben.',
    'Er hat es außen versucht – das ist sein Risiko.'],
  rearEnded: ['Was war das denn?! Jemand ist mir voll hinten drauf!', 'Ich wurde von hinten abgeschossen!', 'Hinten komplett kaputt, jemand ist reingeflogen!'],
  braked: ['{o} hat mitten auf der Geraden gebremst!', '{o} bremst viel zu früh!', 'Ich konnte nicht ausweichen, {o} stand plötzlich da!'],
};
const radio = (race, key, o = '') => `„${race.rng.pick(RADIO[key]).replace(/\{o\}/g, o)}“`;
const pick = (race, arr) => race.rng.pick(arr);

// Schwierigkeitsgrad: welche Fallarten es gibt, wie viele Fälle, wie klar die Beweise sind
export const DIFFICULTY = {
  easy:   { name: 'Leicht', cases: 0.6,  clarity: 0.5, tvTruth: 0.9 },
  medium: { name: 'Mittel', cases: 0.85, clarity: 0.8, tvTruth: 0.78 },
  hard:   { name: 'Schwer', cases: 1,    clarity: 1,   tvTruth: 0.65 },
};
const MEDIUM_EX = ['fuelFlow', 'aeroMode', 'overtakeMode', 'tyrePressure', 'gridCrew', 'parcFerme', 'parkedQuali',
  'slowOutlap', 'redWork', 'restartIrreg', 'language', 'pitQueue'];
export const EXCLUDED = {
  easy: [...MEDIUM_EX, 'complaint', 'weaving', 'brakeTest', 'blueFlag', 'yellowIgnored', 'unsafeRejoin', 'scContact',
    'neutralPass', 'scGap', 'vscDelta', 'chicaneCut', 'unsafeParking', 'pitLine', 'outlapPass', 'gridBox', 'protest'],
  medium: MEDIUM_EX,
  hard: [],
};
export const diffOf = race => DIFFICULTY[race.difficulty] ? race.difficulty : 'hard';
// Gibt es diese Fallart beim aktuellen Schwierigkeitsgrad?
export function caseAllowed(race, type) {
  return !EXCLUDED[diffOf(race)].includes(type);
}
const NEVER_DROP = new Set(['tech', 'tyreRule', 'protest', 'jumpStart']);

export function createCase(race, props) {
  const d = DIFFICULTY[diffOf(race)];
  // Fall fällt weg (Vorfall passiert trotzdem, nur ohne Entscheidung) – eigener Zufall, Rennablauf bleibt gleich
  if (!caseAllowed(race, props.type) || (d.cases < 1 && !NEVER_DROP.has(props.type) && race.chatRand() > d.cases)) {
    return { ...props, id: null, dropped: true, evidence: props.evidence || [] };
  }
  const leader = race.standings()[0];
  const c = {
    id: ++race.caseSeq,
    time: race.time,
    lap: race.preStart ? 0 : Math.min(race.laps, leader.lap + 1),
    status: 'new',          // new → investigating | post → decided  (oder nfa)
    verdict: null,
    evidence: [],
    ...props,
  };
  c.typeName = CASE_TYPES[c.type].name;
  c.options = CASE_TYPES[c.type].options;
  race.cases.push(c);
  race.emit('case', `Neue Entscheidung #${c.id}: ${c.title}`, { caseId: c.id, cars: c.cars });
  return c;
}

export function ev(kind, label, text, early = false) {
  return { kind, label, text, early };
}

// ---------- Zweikämpfe ----------

// Aufgerufen bei jedem Überholversuch in einer Überholzone
export function rollBattleIncident(race, attacker, defender, zoneCorner, success) {
  if (race.neutral || race.phase !== 'running') return;
  const aggr = (aggressionOf(attacker) + aggressionOf(defender)) / 140 * (race.incScale || 1);
  const r = race.rng;
  if (success) {
    if (!r.chance(0.015 * aggr)) return;
    const roll = r.next();
    if (roll < 0.45) collision(race, attacker, defender, zoneCorner);
    else if (roll < 0.8) offTrackPass(race, attacker, defender, zoneCorner);
    else if (attacker.team !== defender.team) complaint(race, attacker, defender, zoneCorner); // Teams beschweren sich nicht über eigene Fahrer
  } else {
    rollDefending(race, attacker, defender, zoneCorner);
    if (!r.chance(0.0015 * aggr)) return;
    if (r.chance(0.6)) forcedOff(race, attacker, defender, zoneCorner);
    else collision(race, attacker, defender, zoneCorner);
  }
}

// Messwert aus einer Verteilung (Beweise überlappen sich bewusst)
export function measure(race, mean, sd, lo, hi) {
  return Math.max(lo, Math.min(hi, mean + race.rng.gauss(sd) * DIFFICULTY[diffOf(race)].clarity));
}
const pct = x => `${Math.round(x)} %`;

// Leitlinien der Rennkommissare (helfen beim Einordnen der Messwerte)
const RULE_INSIDE = 'Wer innen angreift, hat Anspruch auf Platz, wenn seine Vorderachse beim Einlenken mindestens auf Höhe der Spiegel des anderen ist (etwa 60 % der Fahrzeuglänge). Der Verteidiger darf in der Bremszone die Linie nicht mehr wechseln.';
const RULE_OUTSIDE = 'Wer außen am Scheitelpunkt mit der Vorderachse mindestens auf Höhe der Spiegel ist (etwa 60 %), muss eine Autobreite Platz bekommen (≈ 2 m).';
const RULE_TRACK = 'Die Strecke gilt als verlassen, wenn alle vier Räder jenseits der weißen Linie sind. Ein so gewonnener Vorteil muss zurückgegeben werden.';
const RULE_YELLOW = 'Unter Gelb darf nicht überholt werden – außer an einem Auto, das offensichtlich ein Problem hat.';

// TV-Eindruck: manchmal ein Hinweis – der aber auch täuschen kann
export function tvImpression(race, truthHint, falseHint) {
  const r = race.rng;
  if (!r.chance(0.55)) return '';
  return ' ' + (r.chance(DIFFICULTY[diffOf(race)].tvTruth) ? truthHint : falseHint);
}

function collision(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  const roll = r.next();
  const blame = roll < 0.5 ? 'attacker' : roll < 0.7 ? 'defender' : 'racing';
  const victim = blame === 'attacker' ? B : blame === 'defender' ? A : (r.chance(0.5) ? A : B);
  const offender = blame === 'attacker' ? A : blame === 'defender' ? B : null;

  // Folgen
  const cr = r.next();
  const consequence = cr < 0.4 ? 'minor' : cr < 0.65 ? 'wing' : cr < 0.8 ? 'puncture' : cr < 0.95 ? 'spin' : 'dnf';
  const consText = {
    minor: 'Leichte Berührung, beide fahren ohne erkennbaren Schaden weiter.',
    wing: `${victim.id} verliert Teile des Frontflügels.`,
    puncture: `${victim.id} hat danach einen Reifenschaden.`,
    spin: `${victim.id} dreht sich und verliert mehrere Positionen.`,
    dnf: `Das Auto von ${victim.id} ist so stark beschädigt, dass es nicht weiterfahren kann.`,
  }[consequence];
  applyConsequence(race, victim, consequence, A, B);

  // Angemessene Strafe
  let expected = ['none'], points = [0, 0];
  if (offender) {
    if (consequence === 'minor') { expected = ['warning', '5s']; points = [0, 1]; }
    else if (consequence === 'dnf') { expected = ['10s']; points = [2, 3]; }
    else { expected = ['5s', '10s']; points = [1, 2]; }
  }

  // Beweise – Messwerte überlappen sich je nach Wahrheit
  const overlap = measure(race, { attacker: 34, defender: 70, racing: 55 }[blame], 14, 0, 100);
  const brake = measure(race, blame === 'attacker' ? 13 : 6, blame === 'attacker' ? 6 : 4, 0, 32);
  const steer = measure(race, blame === 'defender' ? 3.8 : 1.4, blame === 'defender' ? 1.8 : 1.1, 0, 9);
  const speed = measure(race, blame === 'attacker' ? 9 : 4, 4, -2, 20);
  const unclear = p => r.chance(p);
  const hint = blame === 'attacker'
    ? tvImpression(race, `Aus dieser Perspektive wirkt es, als käme ${A.id} sehr spät.`, `Aus dieser Perspektive wirkt es, als mache ${B.id} die Tür zu.`)
    : blame === 'defender'
      ? tvImpression(race, `Aus dieser Perspektive wirkt es, als mache ${B.id} die Tür zu.`, `Aus dieser Perspektive wirkt es, als käme ${A.id} sehr spät.`)
      : tvImpression(race, 'Beide scheinen um dieselbe Linie zu kämpfen.', r.chance(0.5) ? `Es wirkt, als käme ${A.id} sehr spät.` : `Es wirkt, als mache ${B.id} die Tür zu.`);
  const evidence = [
    ev('video', 'TV-Bilder', `${A.id} greift ${B.id} in ${cornerLabel(corner)} innen an, es kommt zur Berührung am Scheitelpunkt. ${consText}${hint}`, true),
    ev('position', 'Überlappung beim Einlenken', unclear(0.2)
      ? `Kamerawinkel ungünstig – Vorderachse von ${A.id} geschätzt bei ${pct(Math.max(0, overlap - 15))}–${pct(Math.min(100, overlap + 15))} der Fahrzeuglänge von ${B.id}.`
      : `Vorderachse von ${A.id} bei etwa ${pct(overlap)} der Fahrzeuglänge von ${B.id} (0 % = Heck, 100 % = Vorderachse).`),
    ev('telemetry', `Telemetrie ${A.id}`, unclear(0.15)
      ? 'Bremsdaten unvollständig (Signalaussetzer).'
      : `Bremspunkt ${f1(brake)} m später als im Schnitt der Vorrunden, Einlenk-Tempo ${speed >= 0 ? '+' : ''}${Math.round(speed)} km/h.`),
    ev('telemetry', `Telemetrie ${B.id}`, unclear(0.15)
      ? 'Lenkdaten nicht eindeutig.'
      : `Lenkbewegung in der Bremszone: ${f1(steer)}° in Richtung ${A.id}.`),
    ev('radio', `Funk ${A.id}`, blame === 'attacker' && r.chance(0.15) ? radio(race, 'admitAtt') : radio(race, 'doorClosed', B.id)),
    ev('radio', `Funk ${B.id}`, blame === 'defender' && r.chance(0.1) ? radio(race, 'admitDef') : radio(race, 'hitBy', A.id)),
    ev('data', 'Leitlinie', RULE_INSIDE),
  ];
  const cc = createCase(race, {
    type: 'collision', cars: [A.id, B.id], corner: corner.id,
    title: `Kollision ${A.id} / ${B.id} – ${corner.id}`,
    summary: `${A.id} und ${B.id} berühren sich in ${cornerLabel(corner)}. ${consText}`,
    evidence,
    truth: { offender: offender ? offender.id : null, expected, points, victim: victim.id },
  });
  // Szene: tatsächliche Überlappung (die Messung oben streut stärker)
  const mean = { attacker: 34, defender: 70, racing: 55 }[blame];
  cc.scene = sceneCollision(race, { A, B, corner, blame, overlap: mean + (overlap - mean) * 0.3, consequence, victim });
}

function applyConsequence(race, victim, consequence, A, B) {
  if (consequence === 'wing') {
    victim.damage = 'wing';
    markWingDamage(race, victim);
    if (race.rng.chance(0.7)) createDebris(race, A, B);
  } else if (consequence === 'puncture') {
    victim.damage = 'puncture';
    if (race.rng.chance(0.5)) createDebris(race, A, B);
  } else if (consequence === 'spin') {
    startSpin(race, victim);
  } else if (consequence === 'dnf') {
    stopCarAfterIncident(race, victim, 'Unfall (Kollision)');
    createDebris(race, A, B);
  }
}

function forcedOff(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  const fault = r.chance(0.55);
  A.slowUntil = race.time + r.range(2, 4);
  const lost = f1(r.range(1.2, 3.5));
  const overlap = measure(race, fault ? 70 : 42, 14, 0, 100);
  const space = measure(race, fault ? 0.8 : 1.3, 0.6, 0, 3.5);
  const steer = measure(race, fault ? 5 : 2.6, 2, 0, 12);
  const evidence = [
    ev('video', 'TV-Bilder', `${A.id} versucht ${B.id} in ${cornerLabel(corner)} außen zu überholen und muss neben die Strecke. ${A.id} verliert rund ${lost} s.${tvImpression(race,
      fault ? `${B.id} scheint bewusst weit nach außen zu ziehen.` : `${A.id} wirkt zu weit hinten für dieses Manöver.`,
      fault ? `${A.id} wirkt zu weit hinten für dieses Manöver.` : `${B.id} scheint bewusst weit nach außen zu ziehen.`)}`, true),
    ev('position', 'Überlappung am Scheitelpunkt', r.chance(0.2)
      ? `Kamerawinkel ungünstig – Vorderachse von ${A.id} geschätzt bei ${pct(Math.max(0, overlap - 15))}–${pct(Math.min(100, overlap + 15))} der Fahrzeuglänge von ${B.id}.`
      : `Vorderachse von ${A.id} bei etwa ${pct(overlap)} der Fahrzeuglänge von ${B.id}.`),
    ev('position', 'Platz am Kurvenausgang', `Zwischen ${B.id} und dem Streckenrand bleiben ${f1(space)} m.`),
    ev('telemetry', `Telemetrie ${B.id}`, r.chance(0.15) ? 'Lenkdaten nicht eindeutig.' : `Lenkwinkel am Ausgang ${f1(steer)}° größer als in den Vorrunden.`),
    ev('radio', `Funk ${A.id}`, radio(race, 'pushedOff', B.id)),
    ev('radio', `Funk ${B.id}`, radio(race, 'myCorner', A.id)),
    ev('data', 'Leitlinie', RULE_OUTSIDE),
  ];
  const cc = createCase(race, {
    type: 'forcedOff', cars: [B.id, A.id], corner: corner.id,
    title: `${B.id} drängt ${A.id} ab? – ${corner.id}`,
    summary: `${A.id} muss beim Überholversuch gegen ${B.id} in ${cornerLabel(corner)} neben die Strecke.`,
    evidence,
    truth: { offender: fault ? B.id : null, expected: fault ? ['5s'] : ['none'], points: fault ? [1, 2] : [0, 0], victim: A.id },
  });
  const mean = fault ? 70 : 42;
  cc.scene = sceneForcedOff(race, { A, B, corner, fault, overlap: mean + (overlap - mean) * 0.3 });
}

function offTrackPass(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  const legal = r.chance(0.25);              // nur 2–3 Räder draußen → kein Vergehen
  const wheels = legal ? r.int(2, 3) : 4;
  const gain = measure(race, legal ? 0.12 : 0.3, 0.12, 0, 0.7);
  const voluntary = !legal && r.chance(0.4);
  const c = createCase(race, {
    type: 'offTrackPass', cars: [A.id, B.id], corner: corner.id,
    title: `${A.id} überholt ${B.id} neben der Strecke? – ${corner.id}`,
    summary: `${A.id} überholt ${B.id} in ${cornerLabel(corner)} weit außen über die Randsteine.`,
    evidence: [
      ev('video', 'TV-Bilder', `${A.id} geht in ${cornerLabel(corner)} außen über die Randsteine und liegt danach vor ${B.id}.`, true),
      ev('position', 'Streckenbegrenzung', r.chance(0.25)
        ? `Kamerawinkel ungünstig – mindestens 2 Räder von ${A.id} jenseits der weißen Linie, mehr nicht erkennbar.`
        : `${wheels} Räder von ${A.id} jenseits der weißen Linie.`),
      ev('telemetry', 'Mini-Sektor', `${A.id} ist im Abschnitt ${f1(gain)} s schneller als in den Vorrunden.`),
      ev('radio', `Funk ${B.id}`, say(race, 'offTrackComplain', { o: A.id })),
      ev('data', 'Leitlinie', RULE_TRACK),
    ],
    truth: legal
      ? { offender: null, expected: ['none'], points: [0, 0], victim: B.id }
      : { offender: A.id, expected: ['giveback', '5s'], points: [0, 1], victim: B.id },
  });
  c.scene = sceneOffTrackPass(race, { A, B, corner, wheels });
  if (voluntary) {
    A.giveBack = { target: B.id, until: race.time + 70, voluntary: true, caseId: c.id };
  }
}

function complaint(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  const overlap = measure(race, 63, 13, 0, 100);
  const brake = measure(race, 6, 4, 0, 30);
  race.emit('radio', `Teamchef ${B.team.name} an die Rennleitung: „Bitte schaut euch das Manöver von ${A.id} in ${corner.id} an!“`, { cars: [A.id, B.id] });
  createCase(race, {
    type: 'complaint', cars: [A.id, B.id], corner: corner.id,
    title: `Beschwerde ${B.team.name}: ${A.id} gegen ${B.id} – ${corner.id}`,
    summary: `${B.team.name} beschwert sich über das Überholmanöver von ${A.id} in ${cornerLabel(corner)}.`,
    evidence: [
      ev('video', 'TV-Bilder', `${A.id} überholt ${B.id} innen in ${cornerLabel(corner)}. ${r.chance(0.5) ? 'Beide bleiben auf der Strecke.' : `${B.id} muss leicht ausweichen.`}`, true),
      ev('position', 'Überlappung beim Einlenken', `Vorderachse von ${A.id} bei etwa ${pct(overlap)} der Fahrzeuglänge von ${B.id}.`),
      ev('telemetry', `Telemetrie ${A.id}`, `Bremspunkt ${f1(brake)} m später als im Schnitt der Vorrunden.`),
      ev('telemetry', `Telemetrie ${B.id}`, `${B.id} muss lupfen (−${Math.round(r.range(6, 18))} km/h am Scheitelpunkt).`),
      ev('radio', `Teamfunk ${B.team.name}`, `„${A.id} hat uns abgedrängt, das muss untersucht werden!“`),
      ev('data', 'Leitlinie', RULE_INSIDE),
    ],
    truth: { offender: null, expected: ['none'], points: [0, 0], victim: B.id },
  });
}

// Platz zurückgeben: abgeschlossen, wenn das Opfer wieder vorbei ist
export function onGiveBackDone(race, car, target) {
  const gb = car.giveBack;
  car.giveBack = null;
  race.emit('rc', `${car.id} hat die Position an ${target.id} zurückgegeben.`, { cars: [car.id, target.id] });
  const c = race.cases.find(x => x.id === gb.caseId);
  if (c) {
    c.evidence.push(ev('data', 'Position zurückgegeben', `${car.id} lässt ${target.id} in Runde ${car.lap + 1} wieder vorbei.`, true));
    if (gb.voluntary) {
      c.truth.expected = ['none'];
      c.truth.points = [0, 0];
      c.truth.gaveBack = true;
    }
  }
}

// ---------- Track Limits ----------

export function rollTrackLimits(race, car) {
  if (race.neutral || race.phase !== 'running') return;
  const r = race.rng;
  if (!r.chance(0.012 * (errorsOf(car) / 28) * (race.incScale || 1))) return;
  const b = race.briefing;
  const tlc = race.track.def.tlCorners || race.track.corners.slice(-3).map(c => c.id).concat(race.track.corners[0].id);
  const corner = b && b.done ? (r.chance(0.6) ? b.hotspot : r.pick(race.track.corners).id) : r.pick(tlc);
  // In der Fahrerbesprechung nicht zur Überwachung festgelegt: kein Verstoß, aber Fahrer ärgern sich
  if (b && b.done && b.tlCorners && !b.tlCorners.includes(corner)) {
    if (corner === b.hotspot) {
      race.tlUnmonitored = (race.tlUnmonitored || 0) + 1;
      if (race.tlUnmonitored === 3) race.emit('radio', `Funk ${r.pick(race.cars.filter(c => !c.retired)).id}: „In ${corner} schneidet jeder ab – warum wird das nicht kontrolliert?!“`);
    }
    return;
  }
  car.tl = (car.tl || 0) + 1;
  car.tlLog = car.tlLog || [];
  car.tlLog.push(`Runde ${car.lap}, ${corner}`);
  race.emit('tl', `Track Limits: ${car.id} in ${corner} (Runde ${car.lap}) – Rundenzeit gestrichen. Verstoß Nr. ${car.tl}`, { cars: [car.id] });
  if (car.tl < 3) return;
  const expected = car.tl === 3 ? ['bw'] : car.tl === 4 ? ['5s'] : ['10s'];
  createCase(race, {
    type: 'trackLimits', cars: [car.id],
    title: `Track Limits ${car.id} – ${car.tl}. Verstoß`,
    summary: `${car.id} hat die Streckenbegrenzung zum ${car.tl}. Mal überschritten.`,
    evidence: [
      ev('data', 'Verstöße', car.tlLog.join(' · '), true),
      ev('data', 'Regel', '3. Verstoß: Schwarz-Weiß-Flagge · 4. Verstoß: 5 s · jeder weitere: 10 s'),
    ],
    truth: { offender: car.id, expected, points: [0, 0] },
  });
}

// ---------- Boxengasse ----------

export function rollPitSpeeding(race, car) {
  if (!race.rng.chance(0.008 * msgFactor(race, 'pit'))) return;
  const v = 80 + race.rng.range(0.6, 4.5);
  createCase(race, {
    type: 'pitSpeeding', cars: [car.id],
    title: `Speeding Boxengasse ${car.id}`,
    summary: `${car.id} war in der Boxengasse zu schnell.`,
    evidence: [
      ev('data', 'Geschwindigkeitsmessung', `${f1(v)} km/h gemessen – Limit 80 km/h.`, true),
      ev('radio', `Teamfunk ${car.team.name}`, '„Der Limiter hat zu spät gegriffen.“'),
    ],
    truth: { offender: car.id, expected: ['5s'], points: [0, 0] },
  });
}

export function rollUnsafeRelease(race, car) {
  if (!race.rng.chance(0.015)) return;
  const other = race.cars.find(c => c !== car && c.inPit && !c.retired && !c.redQueued);
  if (!other) return;
  const r = race.rng;
  // Wahrheit: wirklich zu knapp losgelassen – oder hatte der andere genug Platz?
  const unsafe = r.chance(0.7);
  const contact = unsafe && r.chance(0.35);
  const gap = unsafe ? (contact ? r.range(0.05, 0.25) : r.range(0.25, 0.6)) : r.range(0.75, 1.4);   // Sekunden beim Einfädeln
  const lift = measure(race, unsafe ? (contact ? 24 : 16) : 6, 5, 0, 40);
  const gapSeen = measure(race, gap, 0.18, 0.02, 2);
  const c = createCase(race, {
    type: 'unsafeRelease', cars: [car.id, other.id],
    title: `Unsichere Freigabe ${car.id}?`,
    summary: `${car.team.name} schickt ${car.id} aus der Box, während ${other.id} in der Fahrgasse kommt.`,
    evidence: [
      ev('video', 'Boxengassen-Kamera', contact
        ? `${car.id} fährt direkt vor ${other.id} in die Fahrgasse – Berührung der Räder.`
        : `${car.id} fährt vor ${other.id} in die Fahrgasse.${tvImpression(race,
          unsafe ? `${other.id} muss deutlich vom Gas.` : `${other.id} scheint genug Platz zu haben.`,
          unsafe ? `${other.id} scheint genug Platz zu haben.` : `${other.id} muss deutlich vom Gas.`)}`, true),
      ev('data', 'Abstand beim Einfädeln', `${f1(gapSeen)} s zwischen ${other.id} und ${car.id} (Messung Boxengasse).`),
      ev('telemetry', `Telemetrie ${other.id}`, `${other.id} verliert ${Math.round(lift)} km/h.`),
      ev('radio', `Teamfunk ${other.team.name}`, unsafe ? '„Unsafe Release! Die haben ihn direkt vor uns rausgelassen!“' : '„Das war knapp, oder?“'),
      ev('data', 'Leitlinie', 'Ein Auto darf nur freigegeben werden, wenn es sicher in die Fahrgasse einfädeln kann. Muss ein anderes Auto deutlich bremsen oder kommt es zur Berührung, ist das eine unsichere Freigabe (üblich: 5 s, mit Berührung auch 10 s).'),
    ],
    truth: unsafe
      ? { offender: car.id, expected: contact ? ['5s', '10s'] : ['warning', '5s'], points: [0, 0], victim: other.id }
      : { offender: null, expected: ['none'], points: [0, 0], victim: other.id },
  });
  c.scene = sceneUnsafeRelease(race, { A: car, B: other, box: race.track.pit.box, side: race.track.pit.side || 1, gap, contact });
}

// Rückkehr nach einem Ausritt: schneidet der Fahrer jemandem den Weg ab?
export function rollUnsafeRejoin(race, car, h) {
  if (race.neutral || race.phase !== 'running' || race.isSession) return;
  const tr = race.track;
  const behind = race.onTrackCars()
    .filter(c => c !== car)
    .map(c => ({ c, gap: wrapD(tr, car.d - c.d) }))
    .filter(x => x.gap > 5 && x.gap < 160)
    .sort((a, b) => a.gap - b.gap)[0];
  if (!behind) return;
  const r = race.rng;
  if (!r.chance(0.3 * (race.incScale || 1))) return;
  const B = behind.c;
  const unsafe = r.chance(0.6);
  const contact = unsafe && r.chance(0.25);
  const side = Math.sign(car.offTrack ? car.offTrack.lateral : (h && h.side) || 1) || 1;
  const corner = cornerNear(tr, car.d);
  const lift = measure(race, unsafe ? 42 : 12, 12, 0, 90);
  const angle = measure(race, unsafe ? 28 : 12, 7, 2, 60);
  if (contact) { B.damage = r.chance(0.5) ? 'wing' : 'puncture'; }
  const c = createCase(race, {
    type: 'unsafeRejoin', cars: [car.id, B.id], corner: corner.id,
    title: `Unsichere Rückkehr ${car.id}? – ${corner.id}`,
    summary: `${car.id} fährt nach dem Ausritt in ${cornerLabel(corner)} zurück auf die Strecke, ${B.id} kommt von hinten.`,
    evidence: [
      ev('video', 'TV-Bilder', `${car.id} kommt aus dem Auslauf zurück, ${B.id} ist ${contact ? 'nicht mehr ausgewichen – leichte Berührung' : 'dicht dahinter'}.${tvImpression(race,
        unsafe ? `${car.id} zieht quer über die Ideallinie.` : `${car.id} bleibt am Rand, bis ${B.id} vorbei ist.`,
        unsafe ? `${car.id} bleibt am Rand, bis ${B.id} vorbei ist.` : `${car.id} zieht quer über die Ideallinie.`)}`, true),
      ev('telemetry', `Telemetrie ${B.id}`, `${B.id} verliert ${Math.round(lift)} km/h, Lenkkorrektur ${f1(measure(race, unsafe ? 4 : 1.5, 1.4, 0, 10))}°.`),
      ev('position', 'Winkel beim Auffahren', `${car.id} fährt in einem Winkel von etwa ${Math.round(angle)}° auf die Strecke.`),
      ev('radio', `Funk ${B.id}`, unsafe ? say(race, 'unsafeComplain', { o: car.id }) : '„Der kam da plötzlich raus.“'),
      ev('radio', `Funk ${car.id}`, say(race, 'unsafeExcuse')),
      ev('data', 'Leitlinie', 'Wer neben die Strecke gerät, muss sicher und ohne Vorteil zurückfahren. Wird ein anderer Fahrer behindert oder gefährdet, ist das eine unsichere Rückkehr (üblich: 5 oder 10 s, bei Unfall auch mehr).'),
    ],
    truth: unsafe
      ? { offender: car.id, expected: contact ? ['10s', 'dt'] : ['5s', '10s'], points: contact ? [1, 2] : [0, 1], victim: B.id }
      : { offender: null, expected: ['none'], points: [0, 0], victim: B.id },
  });
  c.scene = sceneUnsafeRejoin(race, { A: car, B, d0: wrapD(tr, car.d), cid: corner.id, side, unsafe, contact, v: Math.min(B.v || 50, 70) });
  if (unsafe) B.slowUntil = race.time + 1.5;
}

// ---------- Neutralisierung ----------

export function createYellowPassCase(race, A, B, flag) {
  const r = race.rng;
  const sector = sectorIndexAt(race.track, A.d) + 1;
  const corner = cornerNear(race.track, A.d);
  const dbl = flag === 'double';
  const legal = r.chance(0.25);    // B hatte ein Problem → Überholen erlaubt
  const slowB = measure(race, legal ? 34 : 9, legal ? 12 : 6, 0, 70);
  const lift = measure(race, legal ? 0.3 : 0.08, 0.12, 0, 0.8);
  createCase(race, {
    type: 'yellowPass', cars: [A.id, B.id], corner: corner.id,
    title: `${A.id} überholt unter ${dbl ? 'Doppelt Gelb' : 'Gelb'} – Sektor ${sector}`,
    summary: `${A.id} überholt ${B.id} in Sektor ${sector}, während dort ${dbl ? 'Doppelt Gelb' : 'Gelb'} gezeigt wird.`,
    evidence: [
      ev('data', 'Flaggenstatus', `${dbl ? 'Doppelt Gelb' : 'Gelb'} in Sektor ${sector} aktiv.`, true),
      ev('video', 'TV-Bilder', `${A.id} geht in ${cornerLabel(corner)} an ${B.id} vorbei.`, true),
      ev('telemetry', `Telemetrie ${B.id}`, `${B.id} ist im Abschnitt ${Math.round(slowB)} km/h langsamer als üblich.`),
      ev('telemetry', `Telemetrie ${A.id}`, `${A.id} lupft im Sektor ${f1(lift)} s lang.`),
      ev('radio', `Funk ${A.id}`, legal && r.chance(0.7) ? say(race, 'slowAngry') : r.chance(0.5) ? say(race, 'flagLate') : say(race, 'slowAngry')),
      ...(legal && r.chance(0.5) ? [ev('radio', `Funk ${B.id}`, say(race, 'powerLoss'))] : []),
      ev('data', 'Leitlinie', RULE_YELLOW),
    ],
    truth: legal
      ? { offender: null, expected: ['none'], points: [0, 0], victim: B.id }
      : { offender: A.id, expected: dbl ? ['10s', 'dt'] : ['5s', '10s'], points: dbl ? [2, 3] : [1, 2], victim: B.id },
  });
}

export function rollVscDelta(race, dt) {
  const n = race.neutral;
  if (!n || n.type !== 'vsc' || n.phase !== 'active') return;
  for (const car of race.cars) {
    if (car.retired || car.finished || car.inPit || car.offTrack || car.vscCase === n.start) continue;
    if (!race.rng.chance(0.00003 * dt / 0.05)) continue;
    car.vscCase = n.start;
    const delta = race.rng.range(0.1, 0.9);
    createCase(race, {
      type: 'vscDelta', cars: [car.id],
      title: `VSC-Delta ${car.id}`,
      summary: `${car.id} unterschreitet unter VSC die vorgegebene Delta-Zeit.`,
      evidence: [
        ev('data', 'Delta', `${car.id} ist ${f1(delta)} s schneller als die erlaubte Delta-Zeit (Sektor ${sectorIndexAt(race.track, car.d) + 1}).`, true),
        ev('radio', `Funk ${car.id}`, '„Mein Delta auf dem Display war positiv.“'),
      ],
      truth: { offender: car.id, expected: delta < 0.3 ? ['warning', '5s'] : ['5s'], points: [0, 1] },
    });
  }
}

// ---------- Massenunfall (3 oder mehr Autos) ----------

// Wahrscheinlichkeit pro Runde; Startrunde deutlich höher. Regen erhöht das Risiko.
export function rollPileup(race, leaderLap) {
  if (race.neutral || race.phase !== 'running' || race.pendingPileup) return;
  const wet = 1 + 4 * race.weather.wetness;   // Regen: deutlich häufiger
  const p = (leaderLap === 0 ? 0.03 : 0.0008 * (race.incScale || 1)) * wet;
  if (!race.rng.chance(p)) return;
  const corners = leaderLap === 0
    ? race.track.corners.filter(c => c.id === 'T1' || c.id === 'T3' || c.id === 'T4')
    : race.track.corners;
  const c = race.rng.pick(corners);
  race.pendingPileup = { lap: leaderLap, at: leaderLap * race.track.L + c.d + race.rng.range(-20, 10) };
}

// Prüft nach jeder Bewegung, ob der geplante Massenunfall an einer Gruppe ausgelöst wird
export function checkPileup(race) {
  const pp = race.pendingPileup;
  if (!pp) return;
  if (race.neutral) { race.pendingPileup = null; return; }
  const tr = race.track;
  const onTrack = race.onTrackCars();
  for (const A of onTrack) {
    if (!(A.d - A.move < pp.at && A.d >= pp.at)) continue;
    const behind = onTrack
      .filter(c => c !== A && wrapD(tr, A.d - c.d) < 140)
      .sort((a, b) => wrapD(tr, A.d - a.d) - wrapD(tr, A.d - b.d));
    if (behind.length < 2) continue;
    race.pendingPileup = null;
    const r = race.rng;
    const extra = r.chance(0.6) ? 2 : r.chance(0.6) ? 3 : 4;
    startPileup(race, [A, ...behind.slice(0, extra)]);
    return;
  }
  // Runde vorbei, keine Gruppe gefunden → verfällt
  const leader = race.standings()[0];
  if (leader.d > pp.at + tr.L) race.pendingPileup = null;
}

function startPileup(race, cars) {
  const r = race.rng;
  const [A, B] = cars;
  const corner = cornerNear(race.track, A.d);
  const blame = r.chance(0.6) ? 'follower' : 'chain';

  // Folgen: mindestens zwei Ausfälle
  const outcomes = cars.map((c, i) => (i < 2 ? 'dnf' : r.chance(0.45) ? 'dnf' : r.chance(0.6) ? 'damage' : 'spin'));
  const out = [];
  cars.forEach((c, i) => {
    const o = outcomes[i];
    if (o === 'dnf') {
      retireCar(race, c, 'Massenunfall', (r.chance(0.5) ? 1 : -1) * r.range(8, 16));
      c.wreck.d = c.d - i * r.range(4, 12);
      out.push(c.id);
    } else if (o === 'damage') {
      c.damage = r.chance(0.6) ? 'wing' : 'puncture';
    } else {
      startSpin(race, c);
    }
  });
  const barrier = r.chance(cars.length >= 4 ? 0.5 : 0.25);
  const h = createHazard(race, {
    type: 'crash', carId: A.id, carIds: out, d: A.d,
    need: barrier ? 'red' : 'sc',
    work: barrier ? r.range(420, 660) : r.range(200, 300),
    needsCrane: true, medical: true,
  });
  h.medicalText = r.pick(['alle Fahrer sind in Ordnung', 'alle Beteiligten sind okay, einer wird zur Kontrolle ins Medical Centre gebracht']);
  const names = cars.map(c => c.id).join(', ');
  h.desc = `Massenunfall mit ${cars.length} Autos (${names})${barrier ? ' – Barriere beschädigt' : ' – großes Trümmerfeld'}`;
  race.emit('marshal', `Sektor ${h.sector + 1}: MASSENUNFALL in ${cornerLabel(corner)}! Beteiligt: ${names}. Ausgeschieden: ${out.join(', ')}.${barrier ? ' Die Barriere ist beschädigt.' : ' Trümmer auf der gesamten Fahrbahn.'}`, { hazard: h.id, sector: h.sector, cars: cars.map(c => c.id) });

  // Fall für die Kommissare
  const brake = measure(race, blame === 'follower' ? 14 : 6, 5, 0, 30);
  const closing = measure(race, blame === 'follower' ? 38 : 22, 9, 5, 70);
  const pc = createCase(race, {
    type: 'pileup', cars: cars.map(c => c.id), corner: corner.id,
    title: `Massenunfall ${cars.length} Autos – ${corner.id}`,
    summary: `In ${cornerLabel(corner)} kommt es zu einem Unfall mit ${cars.length} Autos: ${names}.`,
    evidence: [
      ev('video', 'TV-Bilder', `${A.id} bremst vor ${cornerLabel(corner)}, ${B.id} fährt auf, dahinter kann das Feld nicht mehr ausweichen.${tvImpression(race,
        blame === 'follower' ? `${B.id} scheint viel zu spät zu bremsen.` : `${A.id} scheint ungewöhnlich früh zu bremsen.`,
        blame === 'follower' ? `${A.id} scheint ungewöhnlich früh zu bremsen.` : `${B.id} scheint viel zu spät zu bremsen.`)}`, true),
      ev('telemetry', `Telemetrie ${B.id}`, r.chance(0.15) ? 'Bremsdaten unvollständig.' : `Bremspunkt ${f1(brake)} m später als im Schnitt der Vorrunden, Annäherung ${Math.round(closing)} km/h schneller als ${A.id}.`),
      ev('telemetry', `Telemetrie ${A.id}`, `${A.id} bremst ${f1(measure(race, blame === 'chain' ? 9 : 3, 4, 0, 20))} m früher als in den Vorrunden.`),
      ev('radio', `Funk ${B.id}`, radio(race, 'braked', A.id)),
      ev('radio', `Funk ${A.id}`, radio(race, 'rearEnded', B.id)),
      ev('data', 'Leitlinie', 'Wer auf ein vorausfahrendes Auto auffährt, ist in der Regel verantwortlich – es sei denn, der Vordermann bremst unerwartet oder es liegt eine Kettenreaktion ohne klaren Auslöser vor.'),
    ],
    truth: blame === 'follower'
      ? { offender: B.id, expected: ['10s', 'dt'], points: [2, 3], victim: A.id }
      : { offender: null, expected: ['none'], points: [0, 0], victim: A.id },
  });
  pc.scene = scenePileup(race, { cars, corner, outcomes, blame });
}

// ---------- Anhörung nach dem Rennen ----------

// Schilderungen der Fahrer und zusätzliche Daten, die erst bei der Anhörung vorliegen
export function hearingEvidence(race, c) {
  const r = race.rng;
  const t = c.truth;
  const out = [];
  const single = c.cars.length === 1;
  for (const id of c.cars) {
    const other = c.cars.find(x => x !== id);
    let text;
    const o = { o: other || 'der andere' };
    if (t.offender === id) text = r.chance(0.35) ? say(race, 'admit', o) : single ? say(race, 'noIntent') : say(race, 'defend', o);
    else if (single) text = r.chance(0.6) ? say(race, 'notWrong') : say(race, 'defend', o);
    else if (t.victim === id) text = t.offender || r.chance(0.5) ? say(race, 'blame', { o: t.offender || other }) : say(race, 'accept', o);
    else if (c.type === 'pileup') text = say(race, 'pileup');
    else text = r.chance(0.5) ? say(race, 'defend', o) : say(race, 'noChance', o);
    out.push(ev('hearing', `Schilderung ${id}`, text));
  }
  const [A, B] = c.cars;
  const sharp = (mean, sd = 6) => measure(race, mean, sd, 0, 100);
  if (c.type === 'collision' || c.type === 'complaint') {
    const mean = t.offender === A ? 34 : t.offender === B ? 70 : 57;
    out.push(ev('video', 'Zusätzliche Onboard-Aufnahmen', `Onboard von ${B}: Vorderachse von ${A} beim Einlenken bei etwa ${pct(sharp(mean))} der Fahrzeuglänge.`));
  } else if (c.type === 'forcedOff') {
    const victim = c.cars[1];
    out.push(ev('video', 'Zusätzliche Onboard-Aufnahmen', `Onboard von ${victim}: Vorderachse am Scheitelpunkt bei etwa ${pct(sharp(t.offender ? 72 : 38))} der Fahrzeuglänge von ${A}.`));
  } else if (c.type === 'offTrackPass') {
    out.push(ev('video', 'Hochauflösende Streckenkamera', `${A}: ${t.offender ? 4 : r.int(2, 3)} Räder jenseits der weißen Linie.`));
  } else if (c.type === 'yellowPass') {
    out.push(ev('data', `Teamdaten ${B}`, t.offender ? `Keine technischen Probleme bei ${B} – das Auto war voll funktionsfähig.` : `${B} hatte einen bestätigten Ausfall der Energierückgewinnung.`));
  } else if (c.type === 'pileup') {
    out.push(ev('telemetry', `Detaildaten ${B}`, `Bremspunkt ${f1(measure(race, t.offender ? 15 : 5, 3, 0, 30))} m später als in den Vorrunden.`));
  }
  return out;
}

// ---------- Anordnung nicht befolgt (Platz zurückgeben) ----------

export function createIgnoredOrderCase(race, car, victim, gb) {
  const r = race.rng;
  const behind = race.gap(victim, car);
  const gapTxt = behind && behind.time !== undefined ? `${f1(Math.abs(behind.time))} s` : 'unbekannt';
  const ignored = Boolean(gb.ignore);
  createCase(race, {
    type: 'ignoredOrder', cars: [car.id, victim.id],
    title: `${car.id} gibt Platz an ${victim.id} nicht zurück`,
    summary: `${car.id} sollte die Position an ${victim.id} zurückgeben, hat das aber innerhalb der Frist nicht getan.`,
    evidence: [
      ev('data', 'Anordnung', `Rennleitung an ${car.team.name}: ${car.id} muss die Position an ${victim.id} zurückgeben.`, true),
      ev('data', 'Abstand jetzt', `${victim.id} liegt ${gapTxt} hinter ${car.id}.`, true),
      ev('telemetry', `Telemetrie ${car.id}`, ignored
        ? `Keine Temporeduzierung erkennbar (Rundenzeiten ${f1(r.range(0, 0.2))} s langsamer als zuvor).`
        : `${car.id} fährt ${f1(r.range(0.8, 1.6))} s pro Runde langsamer, um ${victim.id} vorbeizulassen.`),
      ev('radio', `Teamfunk ${car.team.name}`, ignored ? '„Wir haben ihn informiert … er sagt, er sei nicht vorne gewesen.“' : '„Er hat gewartet, aber der andere kommt nicht ran.“'),
      ev('data', 'Leitlinie', 'Wird eine angeordnete Positionsrückgabe bewusst nicht befolgt, folgt üblicherweise eine Zeit- oder Durchfahrtsstrafe.'),
    ],
    truth: ignored
      ? { offender: car.id, expected: ['10s', 'dt'], points: [1, 2], victim: victim.id }
      : { offender: null, expected: ['none'], points: [0, 0], victim: victim.id },
  });
}

// ---------- Qualifying / Training ----------

export function createLapCase(race, car, lapRec, corner) {
  const r = race.rng;
  const four = r.chance(0.7);
  const wheels = four ? 4 : r.int(2, 3);
  const c = createCase(race, {
    type: 'tlLap', cars: [car.id], corner,
    title: `Track Limits ${car.id} in ${corner} – Runde streichen?`,
    summary: `${car.id} geht auf der gezeiteten Runde (${lapRec.label}) in ${corner} weit über die Randsteine.`,
    evidence: [
      ev('position', 'Streckenkamera', r.chance(0.2)
        ? `Kamerawinkel ungünstig – mindestens ${wheels >= 3 ? 3 : 2} Räder jenseits der weißen Linie.`
        : `${wheels} Räder jenseits der weißen Linie.`, true),
      ev('data', 'Runde', `Rundenzeit ${lapRec.label} – wird gestrichen, falls alle vier Räder draußen waren.`, true),
      ev('data', 'Leitlinie', 'Rundenzeit wird gestrichen, wenn alle vier Räder jenseits der weißen Linie waren.'),
    ],
    truth: four
      ? { offender: car.id, expected: ['deleteLap'], points: [0, 0] }
      : { offender: null, expected: ['none'], points: [0, 0] },
  });
  c.lapRef = lapRec.id;
}

export function createImpedingCase(race, slow, fast, lost) {
  const r = race.rng;
  const warned = r.chance(0.8);
  createCase(race, {
    type: 'impeding', cars: [slow.id, fast.id],
    title: `${slow.id} behindert ${fast.id}?`,
    summary: `${fast.id} trifft auf schneller Runde auf ${slow.id} und muss lupfen.`,
    evidence: [
      ev('video', 'TV-Bilder', `${fast.id} kommt mit hohem Tempo, ${slow.id} fährt auf der Ideallinie langsam.`, true),
      ev('telemetry', `Telemetrie ${fast.id}`, `Zeitverlust im Sektor etwa ${f1(lost)} s.`),
      ev('radio', `Teamfunk ${slow.team.name}`, warned ? `Aufzeichnung: „Achtung, ${fast.id} kommt auf schneller Runde.“ (${Math.round(r.range(4, 9))} s vorher)` : 'Keine Warnung an den Fahrer aufgezeichnet.'),
      ev('radio', `Funk ${fast.id}`, '„Was macht der da?! Meine Runde ist hin!“'),
      ev('data', 'Leitlinie', 'Unnötiges Behindern im Qualifying: üblich 3 Startplätze; hat das Team nicht gewarnt, oft nur Verwarnung.'),
    ],
    truth: warned
      ? { offender: slow.id, expected: lost > 0.4 ? ['grid3'] : ['warning', 'grid3'], points: [0, 1], victim: fast.id }
      : { offender: slow.id, expected: ['warning'], points: [0, 0], victim: fast.id },
  });
}

// ---------- Start ----------

// Bewegung vor dem Erlöschen der Startampel
export function createJumpStartCase(race, car, jump) {
  const r = race.rng;
  const real = jump.real;
  const early = measure(race, real ? 0.24 : 0.12, 0.08, 0.02, 0.7);
  const cm = Math.round(measure(race, jump.dist, 0.22, 0.03, 2.6) * 100);
  const still = real ? r.chance(0.2) : r.chance(0.8);
  const jc = createCase(race, {
    type: 'jumpStart', cars: [car.id],
    title: `Fehlstart ${car.id}?`,
    summary: `${car.id} bewegt sich in der Startaufstellung, bevor die Lichter ausgehen.`,
    evidence: [
      ev('video', 'TV-Bilder', `${car.id} scheint sich kurz vor dem Erlöschen der Lichter zu bewegen.${tvImpression(race,
        real ? 'Das Auto rollt sichtbar nach vorn.' : 'Es wirkt eher wie ein kurzes Zucken.',
        real ? 'Es wirkt eher wie ein kurzes Zucken.' : 'Das Auto rollt sichtbar nach vorn.')}`, true),
      ev('telemetry', 'Transponder (FIA)', `Erste Bewegung ${early.toFixed(2).replace('.', ',')} s vor Lichter aus.`),
      ev('position', 'Weg vor dem Startsignal', `${car.id} bewegt sich etwa ${cm} cm nach vorn.`),
      ev('telemetry', 'Stillstand beim Signal', still
        ? 'Sensor: Das Auto stand beim Erlöschen der Lichter wieder still.'
        : 'Sensor: Das Auto war beim Erlöschen der Lichter in Bewegung.'),
      ev('radio', `Funk ${car.id}`, r.pick(['„Die Kupplung hat gegriffen, ich konnte nichts machen.“', '„Start war okay, oder?“', '„Ich habe gestanden!“'])),
      ev('data', 'Leitlinie', 'Fehlstart: Das Auto bewegt sich, bevor die Lichter ausgehen. Ein kurzes Zucken, nach dem das Auto beim Signal wieder steht, liegt innerhalb der Toleranz. Üblich: 5- oder 10-s-Zeitstrafe, bei deutlichem Vorteil Durchfahrtsstrafe.'),
    ],
    truth: real
      ? { offender: car.id, expected: jump.dist > 1.2 ? ['10s', 'dt'] : ['5s', '10s'], points: [0, 1] }
      : { offender: null, expected: ['none'], points: [0, 0] },
  });
  // Szene: nur dieses Auto in seiner Startbox
  const d0 = car.d - (jump.moved || 0);
  const slot = Math.round((-d0 - 6) / 8);
  jc.scene = sceneJumpStart(race, { A: car, d: d0, side: slot % 2 === 0 ? -1 : 1, early: Math.max(0.05, race.lightsTimer - jump.at), dist: jump.dist, real });
}

// Auto steht nicht korrekt in seiner Startbox
export function createGridBoxCase(race, car) {
  const r = race.rng;
  const out = r.chance(0.65);
  const trueCm = out ? r.range(6, 35) : r.range(-8, -1);
  const m1 = measure(race, trueCm, 7, -20, 50);
  const m2 = measure(race, trueCm, 2.5, -20, 50);
  const txt = m => (m > 0 ? `Vorderreifen etwa ${Math.round(m)} cm über der vorderen Linie der Startbox.` : `Vorderreifen etwa ${Math.round(-m)} cm innerhalb der Startbox.`);
  createCase(race, {
    type: 'gridBox', cars: [car.id],
    title: `${car.id} falsch in der Startbox?`,
    summary: `${car.id} steht beim Start auffällig weit vorn in seiner Startbox.`,
    evidence: [
      ev('video', 'Kamera über der Startaufstellung', `${car.id} steht leicht schräg, die Vorderräder auf Höhe der Linie. ${txt(m1)}`, true),
      ev('position', 'Vermessung (Overhead-Aufnahme)', txt(m2)),
      ev('radio', `Teamfunk ${car.team.name}`, '„Er stand korrekt, die Linie ist kaum zu sehen.“'),
      ev('data', 'Leitlinie', 'Das Auto muss innerhalb seiner Startbox stehen. Steht es über der Linie, ist eine 5-s-Zeitstrafe üblich.'),
    ],
    truth: out
      ? { offender: car.id, expected: ['5s'], points: [0, 1] }
      : { offender: null, expected: ['none'], points: [0, 0] },
  });
}
