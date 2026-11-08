// Vorfälle zwischen Fahrern und Regelverstöße → Fälle für die Rennleitung.
// Jeder Fall hat eine interne "Wahrheit" (wer schuld ist, welche Strafe angemessen wäre)
// und Beweise, die der Spieler auswerten muss. Beweise können unklar oder parteiisch sein.
import { startSpin, stopCarAfterIncident, createDebris, cornerNear, cornerLabel } from './hazards.js';
import { sectorIndexAt } from './trackModel.js';

export const CASE_TYPES = {
  collision:     { name: 'Kollision',                     options: ['warning', '5s', '10s', 'dt', 'sg', 'dsq'] },
  forcedOff:     { name: 'Abdrängen von der Strecke',     options: ['warning', '5s', '10s', 'dt'] },
  offTrackPass:  { name: 'Überholen neben der Strecke',   options: ['warning', 'giveback', '5s', '10s'] },
  complaint:     { name: 'Beschwerde eines Teams',        options: ['warning', '5s', '10s', 'dt'] },
  trackLimits:   { name: 'Track Limits',                  options: ['warning', 'bw', '5s', '10s'] },
  pitSpeeding:   { name: 'Zu schnell in der Boxengasse',  options: ['warning', '5s', '10s', 'dt'] },
  unsafeRelease: { name: 'Unsichere Boxenfreigabe',       options: ['warning', '5s', '10s'] },
  yellowPass:    { name: 'Überholen unter Gelb',          options: ['warning', '5s', '10s', 'dt', 'sg'] },
  vscDelta:      { name: 'VSC-Delta unterschritten',      options: ['warning', '5s', '10s', 'dt'] },
};

const f1 = x => x.toFixed(1).replace('.', ',');
const pick = (race, arr) => race.rng.pick(arr);

function createCase(race, props) {
  const leader = race.standings()[0];
  const c = {
    id: ++race.caseSeq,
    time: race.time,
    lap: Math.min(race.laps, leader.lap + 1),
    status: 'new',          // new → investigating | post → decided  (oder nfa)
    verdict: null,
    evidence: [],
    ...props,
  };
  c.typeName = CASE_TYPES[c.type].name;
  c.options = CASE_TYPES[c.type].options;
  race.cases.push(c);
  race.emit('case', `Neuer Fall #${c.id}: ${c.title}`, { caseId: c.id, cars: c.cars });
  return c;
}

function ev(kind, label, text, early = false) {
  return { kind, label, text, early };
}

// ---------- Zweikämpfe ----------

// Aufgerufen bei jedem Überholversuch in einer Überholzone
export function rollBattleIncident(race, attacker, defender, zoneCorner, success) {
  if (race.neutral || race.phase !== 'running') return;
  const aggr = (attacker.driver.aggression + defender.driver.aggression) / 140;
  const r = race.rng;
  if (success) {
    if (!r.chance(0.015 * aggr)) return;
    const roll = r.next();
    if (roll < 0.45) collision(race, attacker, defender, zoneCorner);
    else if (roll < 0.8) offTrackPass(race, attacker, defender, zoneCorner);
    else complaint(race, attacker, defender, zoneCorner);
  } else {
    if (!r.chance(0.0015 * aggr)) return;
    if (r.chance(0.6)) forcedOff(race, attacker, defender, zoneCorner);
    else collision(race, attacker, defender, zoneCorner);
  }
}

// Messwert aus einer Verteilung (Beweise überlappen sich bewusst)
function measure(race, mean, sd, lo, hi) {
  return Math.max(lo, Math.min(hi, mean + race.rng.gauss(sd)));
}
const pct = x => `${Math.round(x)} %`;

// Leitlinien der Rennkommissare (helfen beim Einordnen der Messwerte)
const RULE_INSIDE = 'Wer innen angreift, hat Anspruch auf Platz, wenn seine Vorderachse beim Einlenken mindestens auf Höhe der Spiegel des anderen ist (etwa 60 % der Fahrzeuglänge). Der Verteidiger darf in der Bremszone die Linie nicht mehr wechseln.';
const RULE_OUTSIDE = 'Wer außen am Scheitelpunkt mit der Vorderachse mindestens auf Höhe der Spiegel ist (etwa 60 %), muss eine Autobreite Platz bekommen (≈ 2 m).';
const RULE_TRACK = 'Die Strecke gilt als verlassen, wenn alle vier Räder jenseits der weißen Linie sind. Ein so gewonnener Vorteil muss zurückgegeben werden.';
const RULE_YELLOW = 'Unter Gelb darf nicht überholt werden – außer an einem Auto, das offensichtlich ein Problem hat.';

// TV-Eindruck: manchmal ein Hinweis – der aber auch täuschen kann
function tvImpression(race, truthHint, falseHint) {
  const r = race.rng;
  if (!r.chance(0.55)) return '';
  return ' ' + (r.chance(0.65) ? truthHint : falseHint);
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
    ev('radio', `Funk ${A.id}`, blame === 'attacker' && r.chance(0.15) ? '„Hm … vielleicht etwas zu optimistisch.“' : `„${B.id} hat mir die Tür zugemacht!“`),
    ev('radio', `Funk ${B.id}`, blame === 'defender' && r.chance(0.1) ? '„Ich habe ihn zu spät gesehen.“' : `„${A.id} ist mir einfach reingefahren!“`),
    ev('data', 'Leitlinie', RULE_INSIDE),
  ];
  createCase(race, {
    type: 'collision', cars: [A.id, B.id], corner: corner.id,
    title: `Kollision ${A.id} / ${B.id} – ${corner.id}`,
    summary: `${A.id} und ${B.id} berühren sich in ${cornerLabel(corner)}. ${consText}`,
    evidence,
    truth: { offender: offender ? offender.id : null, expected, points, victim: victim.id },
  });
}

function applyConsequence(race, victim, consequence, A, B) {
  if (consequence === 'wing') {
    victim.damage = 'wing';
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
    ev('radio', `Funk ${A.id}`, '„Er hat mich rausgedrückt! Keine Autobreite Platz!“'),
    ev('radio', `Funk ${B.id}`, r.chance(0.5) ? '„Ich war vorne, das ist meine Kurve.“' : '„Ganz normales Racing.“'),
    ev('data', 'Leitlinie', RULE_OUTSIDE),
  ];
  createCase(race, {
    type: 'forcedOff', cars: [B.id, A.id], corner: corner.id,
    title: `${B.id} drängt ${A.id} ab? – ${corner.id}`,
    summary: `${A.id} muss beim Überholversuch gegen ${B.id} in ${cornerLabel(corner)} neben die Strecke.`,
    evidence,
    truth: { offender: fault ? B.id : null, expected: fault ? ['5s'] : ['none'], points: fault ? [1, 2] : [0, 0], victim: A.id },
  });
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
      ev('radio', `Funk ${B.id}`, '„Er hat mich neben der Strecke überholt! Er muss den Platz zurückgeben!“'),
      ev('data', 'Leitlinie', RULE_TRACK),
    ],
    truth: legal
      ? { offender: null, expected: ['none'], points: [0, 0], victim: B.id }
      : { offender: A.id, expected: ['giveback', '5s'], points: [0, 1], victim: B.id },
  });
  if (voluntary) {
    A.giveBack = { target: B.id, until: race.time + 70, voluntary: true, caseId: c.id };
  }
}

function complaint(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  const overlap = measure(race, 63, 13, 0, 100);
  const brake = measure(race, 6, 4, 0, 30);
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
  if (!r.chance(0.012 * (car.driver.errors / 28))) return;
  const corner = r.pick(['T9', 'T10', 'T10', 'T1', 'T6']);
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
  if (!race.rng.chance(0.008)) return;
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
  const contact = race.rng.chance(0.3);
  createCase(race, {
    type: 'unsafeRelease', cars: [car.id, other.id],
    title: `Unsichere Freigabe ${car.id}`,
    summary: `${car.team.name} schickt ${car.id} vor ${other.id} in die Fahrgasse.`,
    evidence: [
      ev('video', 'Boxengassen-Kamera', contact
        ? `${car.id} wird direkt vor ${other.id} losgelassen – leichte Berührung der Räder.`
        : `${car.id} wird vor ${other.id} losgelassen, ${other.id} muss abbremsen.`, true),
      ev('data', 'Geschwindigkeit', `${other.id} verliert ${Math.round(race.rng.range(8, 25))} km/h.`),
    ],
    truth: { offender: car.id, expected: contact ? ['5s', '10s'] : ['warning', '5s'], points: [0, 0], victim: other.id },
  });
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
      ev('radio', `Funk ${A.id}`, legal && r.chance(0.7) ? '„Er war viel zu langsam, ich musste vorbei!“' : r.chance(0.5) ? '„Ich habe die Flagge zu spät gesehen.“' : '„Er war viel zu langsam, ich musste vorbei!“'),
      ...(legal && r.chance(0.5) ? [ev('radio', `Funk ${B.id}`, '„Ich habe Leistungsverlust!“')] : []),
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
