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
    dnf: `${victim.id} ist so stark beschädigt, dass er nicht weiterfahren kann.`,
  }[consequence];
  applyConsequence(race, victim, consequence, A, B);

  // Angemessene Strafe
  let expected = ['none'], points = [0, 0];
  if (offender) {
    if (consequence === 'minor') { expected = ['warning', '5s']; points = [0, 1]; }
    else if (consequence === 'dnf') { expected = ['10s']; points = [2, 3]; }
    else { expected = ['5s', '10s']; points = [1, 2]; }
  }

  // Beweise
  const lateA = blame === 'attacker' ? r.range(12, 26) : r.range(1, 7);
  const alongside = blame === 'attacker'
    ? `Vorderachse von ${A.id} nur auf Höhe des Hinterrads von ${B.id} – ${A.id} war beim Einlenken nicht neben ${B.id}.`
    : blame === 'defender'
      ? `Vorderachse von ${A.id} mindestens auf Höhe der Spiegel von ${B.id} – ${A.id} war beim Einlenken klar neben ${B.id}.`
      : `Vorderachse von ${A.id} etwa auf Höhe der Seitenkästen von ${B.id} – Grenzfall.`;
  const steerB = blame === 'defender'
    ? `${B.id} wechselt in der Bremszone die Linie (Lenkbewegung ${f1(r.range(3, 7))}° Richtung ${A.id}).`
    : `${B.id} bleibt auf seiner Linie und lenkt normal ein.`;
  const brakeA = `${A.id} bremst ${f1(lateA)} m später als in den Runden zuvor${lateA > 15 ? ', blockierendes Vorderrad' : ''}.`;
  const evidence = [
    ev('video', 'TV-Bilder', `${A.id} greift ${B.id} in ${cornerLabel(corner)} innen an, es kommt zur Berührung am Scheitelpunkt. ${consText}`, true),
    ev('position', 'Position beim Einlenken', alongside),
    ev('telemetry', `Telemetrie ${A.id}`, r.chance(0.15) ? 'Bremsdaten nicht eindeutig (Signalaussetzer).' : brakeA),
    ev('telemetry', `Telemetrie ${B.id}`, r.chance(0.15) ? 'Lenkdaten nicht eindeutig.' : steerB),
    ev('radio', `Funk ${A.id}`, blame === 'attacker' && r.chance(0.3) ? '„Sorry, das war mein Fehler.“' : `„${B.id} hat mir die Tür zugemacht!“`),
    ev('radio', `Funk ${B.id}`, `„${A.id} ist mir einfach reingefahren! Das ist eine Strafe!“`),
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
  const evidence = [
    ev('video', 'TV-Bilder', `${A.id} versucht ${B.id} in ${cornerLabel(corner)} außen zu überholen und muss neben die Strecke. ${A.id} verliert rund ${lost} s.`, true),
    ev('position', 'Position am Scheitelpunkt', fault
      ? `${A.id} liegt am Scheitelpunkt mit der Vorderachse vor der Vorderachse von ${B.id}.`
      : `${A.id} liegt am Scheitelpunkt deutlich hinter ${B.id} – Vorderachse nur auf Höhe des Hinterrads.`),
    ev('telemetry', `Telemetrie ${B.id}`, fault
      ? `${B.id} lässt am Kurvenausgang bis zum Rand laufen, obwohl ${A.id} daneben ist (Lenkwinkel ${f1(r.range(4, 9))}° mehr als üblich).`
      : `${B.id} fährt die normale Linie, Lenkwinkel wie in den Vorrunden.`),
    ev('radio', `Funk ${A.id}`, `„Er hat mich rausgedrückt! Keine Autobreite Platz!“`),
    ev('radio', `Funk ${B.id}`, r.chance(0.5) ? '„Ich war vorne, das ist meine Kurve.“' : '„Ganz normales Racing.“'),
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
  const voluntary = r.chance(0.4);
  const c = createCase(race, {
    type: 'offTrackPass', cars: [A.id, B.id], corner: corner.id,
    title: `${A.id} überholt ${B.id} neben der Strecke – ${corner.id}`,
    summary: `${A.id} überholt ${B.id} in ${cornerLabel(corner)} mit allen vier Rädern jenseits der weißen Linie.`,
    evidence: [
      ev('video', 'TV-Bilder', `${A.id} geht in ${cornerLabel(corner)} außen über die Randsteine und liegt danach vor ${B.id}.`, true),
      ev('position', 'Streckenbegrenzung', `Alle vier Räder von ${A.id} jenseits der weißen Linie beim Überholen.`),
      ev('telemetry', 'Mini-Sektor', `${A.id} ist im Abschnitt ${f1(r.range(0.2, 0.5))} s schneller als in den Vorrunden.`),
      ev('radio', `Funk ${B.id}`, `„Er hat mich neben der Strecke überholt! Er muss den Platz zurückgeben!“`),
    ],
    truth: { offender: A.id, expected: ['giveback', '5s'], points: [0, 1], victim: B.id },
  });
  if (voluntary) {
    A.giveBack = { target: B.id, until: race.time + 70, voluntary: true, caseId: c.id };
  }
}

function complaint(race, A, B, cornerId) {
  const r = race.rng;
  const corner = race.track.corners.find(c => c.id === cornerId);
  createCase(race, {
    type: 'complaint', cars: [A.id, B.id], corner: corner.id,
    title: `Beschwerde ${B.team.name}: ${A.id} gegen ${B.id} – ${corner.id}`,
    summary: `${B.team.name} beschwert sich über das Überholmanöver von ${A.id} in ${cornerLabel(corner)}.`,
    evidence: [
      ev('video', 'TV-Bilder', `${A.id} überholt ${B.id} innen in ${cornerLabel(corner)}. Beide bleiben auf der Strecke, keine Berührung zu sehen.`, true),
      ev('position', 'Position beim Einlenken', `${A.id} beim Einlenken mit der Vorderachse vor den Spiegeln von ${B.id}.`),
      ev('telemetry', `Telemetrie ${A.id}`, `${A.id} bremst ${f1(r.range(2, 6))} m später als in den Vorrunden – im normalen Rahmen.`),
      ev('telemetry', `Telemetrie ${B.id}`, `${B.id} muss leicht lupfen (−${Math.round(r.range(6, 14))} km/h am Scheitelpunkt).`),
      ev('radio', `Teamfunk ${B.team.name}`, `„${A.id} hat uns abgedrängt, das muss untersucht werden!“`),
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
  const sector = sectorIndexAt(race.track, A.d) + 1;
  const corner = cornerNear(race.track, A.d);
  const dbl = flag === 'double';
  createCase(race, {
    type: 'yellowPass', cars: [A.id, B.id], corner: corner.id,
    title: `${A.id} überholt unter ${dbl ? 'Doppelt Gelb' : 'Gelb'} – Sektor ${sector}`,
    summary: `${A.id} überholt ${B.id} in Sektor ${sector}, obwohl dort ${dbl ? 'Doppelt Gelb' : 'Gelb'} gezeigt wird.`,
    evidence: [
      ev('data', 'Flaggenstatus', `${dbl ? 'Doppelt Gelb' : 'Gelb'} in Sektor ${sector} aktiv.`, true),
      ev('video', 'TV-Bilder', `${A.id} geht in ${cornerLabel(corner)} an ${B.id} vorbei.`, true),
      ev('telemetry', `Telemetrie ${A.id}`, `Kein Lupfen erkennbar, Mini-Sektor nur ${f1(race.rng.range(0.0, 0.2))} s langsamer als normal.`),
      ev('radio', `Funk ${A.id}`, '„Ich habe die Flagge zu spät gesehen.“'),
    ],
    truth: { offender: A.id, expected: dbl ? ['10s', 'dt'] : ['5s', '10s'], points: dbl ? [2, 3] : [1, 2], victim: B.id },
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
