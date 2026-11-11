// Weitere Entscheidungen: Fahrverhalten (blaue Flaggen, Weben, Bremstest, Safety-Car-Phasen,
// Neustart, Schikane abgekürzt), unsicher abgestellt, Boxengasse (Linie, gesperrt, Arbeiten unter Rot,
// Stau in der Fahrgasse im Qualifying).
import { msgFactor } from './messages.js';
import { wrapD } from './trackModel.js';
import { cornerNear, cornerLabel } from './hazards.js';
import { createCase, ev, measure, tvImpression } from './incidents.js';
import { sceneWeaving, sceneChicaneCut } from './scenes.js';
import { aggressionOf } from './race.js';
import { say } from './voices.js';

const f1 = x => x.toFixed(1).replace('.', ',');
const pct = x => `${Math.round(x)} %`;

// ---------- Blaue Flaggen ----------
export function rollBlueFlag(race, lapped, leader) {
  if (race.isSession || race.neutral) return;
  if (!race.rng.chance(0.012 * aggressionOf(lapped) / 70 * (race.incScale || 1) * msgFactor(race, 'blue'))) return;
  const r = race.rng;
  const guilty = r.chance(0.6);
  const corners = guilty ? r.int(3, 6) : r.int(1, 3);
  const lost = measure(race, guilty ? 1.3 : 0.4, 0.35, 0.05, 3);
  createCase(race, {
    type: 'blueFlag', cars: [lapped.id, leader.id],
    title: `${lapped.id} lässt ${leader.id} nicht vorbei? – Blaue Flaggen`,
    summary: `${lapped.id} wird überrundet und hält ${leader.id} über mehrere Kurven auf.`,
    evidence: [
      ev('data', 'Blaue Flaggen', `${lapped.id} sieht über ${corners} Kurven blaue Flaggen (3 Marshal-Posten).`, true),
      ev('telemetry', `Zeitverlust ${leader.id}`, `${f1(lost)} s hinter ${lapped.id}.`),
      ev('radio', `Funk ${leader.id}`, say(race, 'blueAngry')),
      ev('radio', `Teamfunk ${lapped.team.name}`, guilty ? 'Kein Hinweis an den Fahrer aufgezeichnet.' : `„Blaue Flagge, lass ${leader.id} vorbei.“ (rechtzeitig)`),
      ev('data', 'Leitlinie', 'Wer überrundet wird, muss bei der ersten Gelegenheit Platz machen – spätestens nach drei Marshal-Posten mit blauen Flaggen.'),
    ],
    truth: guilty ? { offender: lapped.id, expected: ['5s'], points: [0, 1], victim: leader.id } : { offender: null, expected: ['none'], points: [0, 0], victim: leader.id },
  });
}

// ---------- Weben / Bremstest bei der Verteidigung ----------
export function rollDefending(race, attacker, defender, cornerId) {
  if (race.isSession || race.neutral) return;
  const r = race.rng;
  if (!r.chance(0.0009 * aggressionOf(defender) / 70 * (race.incScale || 1) * msgFactor(race, 'driving'))) return;
  const corner = race.track.corners.find(c => c.id === cornerId) || cornerNear(race.track, defender.d);
  if (r.chance(0.6)) {
    const guilty = r.chance(0.55);
    const moves = guilty ? r.int(2, 3) : 1;
    const wc = createCase(race, {
      type: 'weaving', cars: [defender.id, attacker.id], corner: corner.id,
      title: `${defender.id} verteidigt mit mehreren Richtungswechseln? – vor ${corner.id}`,
      summary: `${defender.id} wechselt auf der Geraden vor ${cornerLabel(corner)} mehrmals die Linie, ${attacker.id} folgt im Windschatten.`,
      evidence: [
        ev('video', 'TV-Bilder', `${defender.id} zieht nach links, dann wieder nach rechts.${tvImpression(race, guilty ? 'Das wirkt wie zwei Bewegungen.' : 'Die zweite Bewegung wirkt wie die Rückkehr zur Ideallinie.', guilty ? 'Die zweite Bewegung wirkt wie die Rückkehr zur Ideallinie.' : 'Das wirkt wie zwei Bewegungen.')}`, true),
        ev('telemetry', `Lenkdaten ${defender.id}`, `${moves} deutliche Richtungswechsel, Seitenversatz ${f1(measure(race, guilty ? 3.2 : 2, 0.8, 0.5, 6))} m.`),
        ev('radio', `Funk ${attacker.id}`, say(race, 'weaving', { o: defender.id })),
        ev('data', 'Leitlinie', 'Ein Richtungswechsel zur Verteidigung ist erlaubt. Wer danach zurück zur Ideallinie will, muss eine Autobreite Platz lassen. Mehrfaches Hin und Her ist verboten (üblich: Schwarz-Weiß-Flagge oder 5 s).'),
      ],
      truth: guilty ? { offender: defender.id, expected: ['bw', '5s'], points: [0, 1], victim: attacker.id } : { offender: null, expected: ['none'], points: [0, 0], victim: attacker.id },
    });
    wc.scene = sceneWeaving(race, { A: defender, B: attacker, corner, moves });
  } else {
    const guilty = r.chance(0.5);
    const decel = measure(race, guilty ? 2.6 : 1.4, 0.6, 0.4, 5);
    attacker.slowUntil = race.time + 1.5;
    createCase(race, {
      type: 'brakeTest', cars: [defender.id, attacker.id], corner: corner.id,
      title: `Bremstest von ${defender.id}? – vor ${corner.id}`,
      summary: `${defender.id} bremst vor ${cornerLabel(corner)} unerwartet, ${attacker.id} muss ausweichen.`,
      evidence: [
        ev('video', 'TV-Bilder', `${attacker.id} weicht im letzten Moment aus.`, true),
        ev('telemetry', `Telemetrie ${defender.id}`, `Verzögerung ${f1(decel)} g an einer Stelle, an der normalerweise kaum gebremst wird; ${guilty ? 'kein Gasverlust durch Technik erkennbar' : 'kurzer Leistungsabfall der Hybridunterstützung registriert'}.`),
        ev('radio', `Funk ${attacker.id}`, say(race, 'brakeTested', { o: defender.id })),
        ev('radio', `Funk ${defender.id}`, say(race, guilty ? 'brakeExcuseGuilty' : 'brakeExcuseOk')),
        ev('data', 'Leitlinie', 'Absichtliches, unnötiges Bremsen vor einem Gegner ist gefährlich (üblich: 10 s oder Durchfahrt, bei schweren Fällen mehr).'),
      ],
      truth: guilty ? { offender: defender.id, expected: ['10s', 'dt'], points: [2, 3], victim: attacker.id } : { offender: null, expected: ['none'], points: [0, 0], victim: attacker.id },
    });
  }
}

// ---------- Safety-Car- und VSC-Phasen ----------
export function rollNeutralCases(race, dt) {
  const n = race.neutral;
  if (!n || race.isSession || race.phase !== 'running') return;
  const r = race.rng;
  const p = dt / 0.05;
  const field = race.onTrackCars().sort((a, b) => b.d - a.d);
  if (field.length < 4) return;
  if (n.type === 'sc' && n.phase === 'out' && r.chance(0.00006 * p)) {
    const i = r.int(1, field.length - 1);
    const A = field[i - 1], B = field[i];
    const guilty = r.chance(0.65);
    if (guilty) A.damage = A.damage || (r.chance(0.5) ? 'wing' : null);
    createCase(race, {
      type: 'scContact', cars: [B.id, A.id],
      title: `${B.id} fährt hinter dem Safety Car auf ${A.id} auf`,
      summary: `Hinter dem Safety Car berühren sich ${B.id} und ${A.id}.`,
      evidence: [
        ev('video', 'TV-Bilder', `${A.id} bremst, ${B.id} fährt auf.${tvImpression(race, guilty ? `${B.id} war unaufmerksam.` : `${A.id} hat abrupt gebremst.`, guilty ? `${A.id} hat abrupt gebremst.` : `${B.id} war unaufmerksam.`)}`, true),
        ev('telemetry', `Telemetrie ${A.id}`, `Verzögerung ${f1(measure(race, guilty ? 1.1 : 2.4, 0.5, 0.3, 4))} g, Reifen aufwärmen.`),
        ev('data', 'Leitlinie', 'Hinter dem Safety Car muss jeder Fahrer so fahren, dass er jederzeit anhalten kann. Wer auffährt, ist in der Regel verantwortlich.'),
      ],
      truth: guilty ? { offender: B.id, expected: ['5s', '10s'], points: [1, 2], victim: A.id } : { offender: A.id, expected: ['warning', '5s'], points: [0, 1], victim: B.id },
    });
  }
  if ((n.type === 'sc' || n.type === 'vsc') && !n.go && r.chance(0.00005 * p)) {
    const i = r.int(1, field.length - 1);
    const A = field[i], B = field[i - 1];
    const legal = r.chance(0.3);
    createCase(race, {
      type: 'neutralPass', cars: [A.id, B.id],
      title: `${A.id} überholt ${B.id} unter ${n.type === 'sc' ? 'Safety Car' : 'VSC'}?`,
      summary: `${A.id} liegt plötzlich vor ${B.id}, obwohl Überholverbot gilt.`,
      evidence: [
        ev('data', 'Zeitnahme', `${A.id} vor ${B.id} am Mini-Sektor ${r.int(10, 40)}.`, true),
        ev('telemetry', `Telemetrie ${B.id}`, legal ? `${B.id} fährt mit deutlich reduziertem Tempo (Problem gemeldet).` : `${B.id} fährt normales Delta-Tempo.`),
        ev('radio', `Funk ${A.id}`, legal ? say(race, 'slowAngry') : '„Er hat mich vorbeigelassen, oder?“'),
        ev('data', 'Leitlinie', 'Unter SC und VSC darf nicht überholt werden – außer an einem Auto, das offensichtlich ein Problem hat oder in die Box fährt. Üblich: Platz zurückgeben oder Zeitstrafe.'),
      ],
      truth: legal ? { offender: null, expected: ['none'], points: [0, 0], victim: B.id } : { offender: A.id, expected: ['giveback', '5s'], points: [0, 1], victim: B.id },
    });
  }
  if (n.type === 'sc' && n.phase === 'out' && r.chance(0.00004 * p)) {
    const A = field[r.int(1, field.length - 1)];
    const guilty = r.chance(0.55);
    const lengths = measure(race, guilty ? 13 : 9, 2, 4, 25);
    createCase(race, {
      type: 'scGap', cars: [A.id],
      title: `${A.id}: Abstand hinter dem Safety Car zu groß?`,
      summary: `${A.id} lässt hinter dem Safety Car eine große Lücke zum Vordermann.`,
      evidence: [
        ev('data', 'Abstand', `Etwa ${Math.round(lengths)} Autolängen zum Vordermann (Messung GPS).`, true),
        ev('radio', `Teamfunk ${A.team.name}`, guilty ? '„Wir wollten die Reifen kühlen.“' : '„Er hatte kurz einen Verbremser, holt jetzt auf.“'),
        ev('data', 'Leitlinie', 'Hinter dem Safety Car höchstens 10 Autolängen Abstand zum Vordermann.'),
      ],
      truth: guilty ? { offender: A.id, expected: ['warning', '5s'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
    });
  }
}

// Unregelmäßiger Neustart durch den Führenden (bei „SC kommt rein“, Moment des Gasgebens)
export function rollRestartCase(race, head, second) {
  if (!head || !second || race.isSession || !race.rng.chance(0.12)) return;
  const r = race.rng;
  const guilty = r.chance(0.5);
  createCase(race, {
    type: 'restartIrreg', cars: [head.id, second.id],
    title: `Unregelmäßiger Neustart von ${head.id}?`,
    summary: `${head.id} beschleunigt und bremst vor dem Neustart mehrmals, ${second.id} kann kaum reagieren.`,
    evidence: [
      ev('telemetry', `Telemetrie ${head.id}`, `${guilty ? 3 : 1} deutliche Bremsungen nach dem Anfahren, Verzögerung bis ${f1(measure(race, guilty ? 1.8 : 0.9, 0.4, 0.2, 4))} g.`, true),
      ev('radio', `Funk ${second.id}`, '„Er bremst mich ständig ab, das ist gefährlich!“'),
      ev('data', 'Leitlinie', 'Der Führende bestimmt das Tempo, darf aber nach dem Losfahren nicht unregelmäßig beschleunigen und bremsen.'),
    ],
    truth: guilty ? { offender: head.id, expected: ['warning', '5s'], points: [0, 1], victim: second.id } : { offender: null, expected: ['none'], points: [0, 0], victim: second.id },
  });
}

// ---------- Schikane abgekürzt ----------
export function rollChicaneCut(race, car) {
  if (race.neutral || race.isSession || race.phase !== 'running') return;
  const r = race.rng;
  if (!r.chance(0.0009 * (race.incScale || 1))) return;
  const slow = race.track.corners.filter(c => (c.vmax || 200) < 140);
  if (!slow.length) return;
  const corner = r.pick(slow);
  const gain = measure(race, r.chance(0.6) ? 0.45 : 0.1, 0.15, 0, 1.2);
  const guilty = gain > 0.25;
  const backed = guilty && r.chance(0.3);
  const cc = createCase(race, {
    type: 'chicaneCut', cars: [car.id], corner: corner.id,
    title: `${car.id} kürzt ${corner.id} ab`,
    summary: `${car.id} fährt in ${cornerLabel(corner)} über den Auslauf und kommt hinter der Kurve wieder auf die Strecke.`,
    evidence: [
      ev('video', 'Streckenkamera', `${car.id} verbremst sich und nimmt die Abkürzung über den Auslauf.`, true),
      ev('telemetry', 'Zeitgewinn', `${car.id} ist im Abschnitt ${f1(gain)} s schneller als in den Vorrunden${backed ? ', danach aber deutlich vom Gas' : ''}.`),
      ev('data', 'Leitlinie', 'Wer eine Kurve abkürzt, darf dadurch keinen Vorteil haben – sonst muss der Vorteil zurückgegeben werden (oder 5 s).'),
    ],
    truth: guilty && !backed ? { offender: car.id, expected: ['giveback', '5s'], points: [0, 1] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
  cc.scene = sceneChicaneCut(race, { A: car, corner, gain });
}

// ---------- Auto unsicher abgestellt ----------
export function rollUnsafeParking(race, car, h) {
  if (race.isSession || !race.rng.chance(0.15)) return;
  const r = race.rng;
  const guilty = r.chance(0.6);
  createCase(race, {
    type: 'unsafeParking', cars: [car.id],
    title: `${car.id} hat das Auto unsicher abgestellt?`,
    summary: `${car.id} steigt nach dem Defekt aus – das Auto rollt danach noch ein Stück ${guilty ? 'Richtung Fahrbahn' : 'im Auslauf'}.`,
    evidence: [
      ev('video', 'Streckenkamera', `Das Auto rollt nach dem Aussteigen ${f1(measure(race, guilty ? 4 : 1.2, 1, 0, 10))} m weiter.`, true),
      ev('data', 'Fahrzeugdaten', guilty ? 'Kein Gang eingelegt, Lenkrad nicht wieder aufgesteckt.' : 'Gang eingelegt, Lenkrad aufgesteckt – Hang leicht abschüssig.'),
      ev('data', 'Leitlinie', 'Wer sein Auto abstellt, muss es sichern (Gang, Lenkrad, möglichst weit weg von der Fahrbahn). Ein Verstoß bringt meist eine Startplatzstrafe.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', 'grid3'], points: [0, 1] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

// ---------- Boxengasse ----------
export function rollPitLine(race, car, exit) {
  if (race.isSession || !race.rng.chance(0.006 * msgFactor(race, 'pit'))) return;
  const r = race.rng;
  const over = r.chance(0.6);
  createCase(race, {
    type: 'pitLine', cars: [car.id],
    title: `${car.id} überfährt die Linie an der Boxen${exit ? 'ausfahrt' : 'einfahrt'}?`,
    summary: `${car.id} fährt an der Boxen${exit ? 'ausfahrt' : 'einfahrt'} sehr nah an der weißen Linie.`,
    evidence: [
      ev('position', 'Kamera an der Linie', r.chance(0.25) ? 'Bild unscharf – mindestens ein Rad auf der Linie.' : `${over ? 'Beide linken Räder vollständig' : 'Die Räder berühren die Linie, sind aber nicht'} jenseits der Linie.`, true),
      ev('data', 'Leitlinie', 'Die Linie an der Boxenein- und -ausfahrt darf nicht mit einem Rad vollständig überfahren werden (üblich: 5 s).'),
    ],
    truth: over ? { offender: car.id, expected: ['5s'], points: [0, 1] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

// Wer trotz geschlossener Boxengasse hineinfährt
export function rollPitClosedEntry(race, car) {
  if (!race.rng.chance(0.08 * aggressionOf(car) / 70)) return false;
  const emergency = Boolean(car.damage);
  createCase(race, {
    type: 'pitClosedEntry', cars: [car.id],
    title: `${car.id} fährt in die geschlossene Boxengasse`,
    summary: `${car.id} biegt in die Boxengasse ein, obwohl sie geschlossen ist.`,
    evidence: [
      ev('data', 'Boxengasse', 'Rotes Licht an der Einfahrt, Meldung „PIT LANE CLOSED“ an alle Teams.', true),
      ev('data', 'Fahrzeug', emergency ? `${car.id} hat einen Schaden am Auto (Notfall).` : `${car.id} hat keinen erkennbaren Schaden.`),
      ev('radio', `Teamfunk ${car.team.name}`, emergency ? '„Wir mussten reinkommen, das Auto ist beschädigt!“' : '„Box, box – oh, Moment …“'),
      ev('data', 'Leitlinie', 'Einfahrt in die geschlossene Boxengasse nur im Notfall. Sonst üblich: 10-s-Stop-and-Go.'),
    ],
    truth: emergency ? { offender: null, expected: ['none'], points: [0, 0] } : { offender: car.id, expected: ['sg', 'dt'], points: [0, 1] },
  });
  return true;
}

// Unerlaubte Arbeiten unter roter Flagge
export function rollRedWork(race, car) {
  if (race.isSession || !race.rng.chance(0.04)) return;
  const r = race.rng;
  const guilty = r.chance(0.55);
  createCase(race, {
    type: 'redWork', cars: [car.id],
    title: `Unerlaubte Arbeiten an ${car.id} unter Rot?`,
    summary: `Mechaniker arbeiten während der Unterbrechung länger an ${car.id}.`,
    evidence: [
      ev('video', 'Boxengassen-Kamera', `Mechaniker öffnen ${guilty ? 'die Motorabdeckung' : 'nur die Kühlöffnung'} an ${car.id}.`, true),
      ev('data', 'Technischer Delegierter', guilty ? 'Veränderungen an der Aufhängung festgestellt.' : 'Reifenwechsel und Reinigung der Kühler – erlaubt.'),
      ev('data', 'Leitlinie', 'Unter Rot erlaubt: Reifenwechsel, Reinigung, Reparatur von Unfallschäden in der Startaufstellung nach Anweisung. Andere Arbeiten sind verboten.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['10s', 'dt'], points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

// Stau in der Fahrgasse beim Qualifying
export function rollPitQueue(race, car) {
  if (!race.isSession || race.kind === 'fp' || !race.rng.chance(0.012)) return;
  const others = race.cars.filter(c => c !== car && c.inPit && !c.inGarage && !c.retired);
  if (!others.length) return;
  const B = race.rng.pick(others);
  const guilty = race.rng.chance(0.55);
  createCase(race, {
    type: 'pitQueue', cars: [car.id, B.id],
    title: `${car.id} blockiert ${B.id} in der Boxengasse?`,
    summary: `${car.id} wartet am Ende der Boxengasse auf eine Lücke, ${B.id} steht dahinter.`,
    evidence: [
      ev('video', 'Boxengassen-Kamera', `${car.id} bleibt ${f1(measure(race, guilty ? 8 : 3, 2, 0, 20))} s in der Fahrgasse stehen.`, true),
      ev('radio', `Funk ${B.id}`, '„Was macht der da? Die Zeit läuft ab!“'),
      ev('data', 'Leitlinie', 'In der Fahrgasse der Boxengasse darf nicht unnötig angehalten oder blockiert werden.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', 'grid3'], points: [0, 1], victim: B.id } : { offender: null, expected: ['none'], points: [0, 0], victim: B.id },
  });
}

// ---------- Qualifying: absichtlich abgestellt, zu langsame Aufwärmrunde ----------
export function rollParkedQuali(race, car) {
  if (!race.isSession || race.kind === 'fp' || race.remaining > 120 || !race.rng.chance(0.35)) return;
  const r = race.rng;
  const pos = race.segmentRanking ? race.segmentRanking().indexOf(car) + 1 : 1;
  if (pos > 5) return;
  const guilty = r.chance(0.45);
  createCase(race, {
    type: 'parkedQuali', cars: [car.id],
    title: `${car.id} absichtlich abgestellt? – Qualifying`,
    summary: `${car.id} (P${pos}) bleibt kurz vor Ende von ${race.segment.id} auf der Strecke stehen. Gelb bzw. Rot verhindert die Runden der Gegner.`,
    evidence: [
      ev('telemetry', `Telemetrie ${car.id}`, guilty ? `Ungewöhnlich frühes Bremsen (${f1(measure(race, 32, 6, 10, 60))} m früher), Lenkeinschlag ohne Grund.` : `Blockierendes Rad durch Bremsproblem, Bremsdruck ${f1(measure(race, 140, 20, 60, 200))} bar.`, true),
      ev('video', 'Onboard', guilty ? 'Kein Kontakt, kein Rutschen – das Auto bleibt einfach stehen.' : 'Das Heck bricht aus, das Auto rutscht in den Auslauf.'),
      ev('radio', `Funk ${car.id}`, guilty ? '„Ich habe das Auto verloren … sorry.“' : '„Die Bremse ist weg!“'),
      ev('data', 'Leitlinie', 'Wer absichtlich anhält, um anderen die Runde zu verderben, wird aus dem Qualifying ausgeschlossen (Start von hinten).'),
    ],
    truth: guilty ? { offender: car.id, expected: ['dsq'], points: [2, 3] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

export function rollSlowOutlap(race, car) {
  if (!race.isSession || race.kind === 'fp' || !race.rng.chance(0.012)) return;
  const r = race.rng;
  const guilty = r.chance(0.55);
  const over = measure(race, guilty ? 2.5 : -0.8, 1.2, -4, 8);
  createCase(race, {
    type: 'slowOutlap', cars: [car.id],
    title: `${car.id} zu langsam auf der Aufwärmrunde?`,
    summary: `${car.id} fährt auf der Aufwärmrunde langsamer als die vorgeschriebene Höchstzeit.`,
    evidence: [
      ev('data', 'Maximale Rundenzeit', `${car.id} ist zwischen zwei Messpunkten ${over > 0 ? `${f1(over)} s langsamer` : `${f1(-over)} s schneller`} als die Höchstzeit.`, true),
      ev('radio', `Teamfunk ${car.team.name}`, guilty ? '„Wir suchen eine Lücke.“' : '„Achtung, Delta beachten.“'),
      ev('data', 'Leitlinie', 'Auf Aufwärm- und Auslaufrunden gilt eine maximale Zeit zwischen den Messpunkten, um gefährliche Tempounterschiede zu vermeiden.'),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', 'grid3'], points: [0, 1] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}

// Qualifying: kurz vor der Linie auf der Aufwärmrunde überholt, um freie Bahn zu haben
export function rollOutlapPass(race, car) {
  if (!race.isSession || race.kind === 'fp' || !race.rng.chance(0.03)) return;
  const r = race.rng;
  const others = race.cars.filter(c => c !== car && !c.inGarage && c.prog && c.prog.phase === 'out');
  if (!others.length) return;
  const B = r.pick(others);
  const guilty = r.chance(0.6);
  const dist = Math.round(measure(race, guilty ? 180 : 700, 120, 60, 1400));
  const dv = Math.round(measure(race, guilty ? 70 : 35, 18, 5, 120));
  const late = r.chance(0.5);
  createCase(race, {
    type: 'outlapPass', cars: [car.id, B.id],
    title: `${car.id} überholt ${B.id} vor der Linie (Aufwärmrunde)`,
    summary: `${car.id} überholt ${B.id} auf der Aufwärmrunde kurz vor Beginn der schnellen Runde.`,
    evidence: [
      ev('video', 'TV-Bilder', `${car.id} zieht in der letzten Kurve an ${B.id} vorbei, beide auf der Aufwärmrunde.${tvImpression(race, guilty ? 'Es wirkt knapp und hektisch.' : 'Es wirkt kontrolliert.', guilty ? 'Es wirkt kontrolliert.' : 'Es wirkt knapp und hektisch.')}`, true),
      ev('position', 'Ort des Manövers', `Etwa ${dist} m vor der Ziellinie.`),
      ev('telemetry', 'Geschwindigkeiten', `${car.id} ist beim Überholen ${dv} km/h schneller als ${B.id}.`),
      ev('radio', `Funk ${B.id}`, guilty ? '„Er fliegt einfach vorbei, direkt vor der Linie! Gefährlich!“' : '„Okay, ich lasse ihn durch, ich brauche Abstand.“'),
      ev('data', 'Leitlinie', `Auf der Aufwärmrunde ist Überholen erlaubt, aber nicht unmittelbar vor der Linie mit großem Tempounterschied${late ? ' – besonders in den letzten Minuten, wenn alle gleichzeitig auf die Strecke gehen' : ''}. Wer freiwillig Platz macht, wird nicht behindert.`),
    ],
    truth: guilty ? { offender: car.id, expected: ['warning', 'grid3'], points: [0, 1], victim: B.id } : { offender: null, expected: ['none'], points: [0, 0], victim: B.id },
  });
}

// ---------- Schimpfwörter im Funk ----------
// Funksprüche mit Schimpfwörtern (zensiert). to: rc = gegen die Rennleitung, driver = gegen einen Fahrer ({o}), self = Frust ohne Ziel
const SWEAR = [
  { to: 'rc', t: 'What the f*** is race control doing?! Are they blind?!' },
  { to: 'rc', t: "Seriously?! That's a f***ing joke of a penalty!" },
  { to: 'rc', t: 'He pushed me off! The stewards need to wake the f*** up!' },
  { to: 'rc', t: 'Sh*t, sh*t, sh*t! Who is running this circus?!' },
  { to: 'rc', t: 'Unbelievable. F***ing unbelievable. Five seconds for that?!' },
  { to: 'rc', t: 'What a load of sh*t! The stewards are asleep!' },
  { to: 'driver', t: '{o} is a complete f***ing id**t! Look at that!' },
  { to: 'rc', t: 'Tell race control they can shove that blue flag up their a**!' },
  { to: 'rc', t: 'Are you f***ing kidding me? Yellow flag? Where?!' },
  { to: 'rc', t: 'Who the f*** came up with this rule?!' },
  { to: 'driver', t: '{o} just drove straight into me, the f***ing moron!' },
  { to: 'self', t: 'F***! F***! The tyres are f***ing gone!' },
  { to: 'driver', t: 'Get this d*ckhead {o} out of my way!' },
  { to: 'self', t: "Oh for f***'s sake, again?! Every single lap!" },
  { to: 'rc', t: 'Race control, you are an absolute f***ing disgrace!' },
  { to: 'self', t: 'This car is a piece of sh*t, mate. Honestly.' },
  { to: 'driver', t: 'Did you see that?! {o} brake-tested me, the b*stard!' },
  { to: 'driver', t: 'Who gave this guy a superlicence?! {o} is a f***ing danger!' },
  { to: 'self', t: 'Stop talking to me in the f***ing corners!' },
  { to: 'rc', t: 'Give him a penalty, for f***\'s sake! Do your f***ing job!' },
];

export function rollLanguage(race) {
  if (race.phase !== 'running' || !race.rng.chance(0.0004)) return;
  if (race.languageDone) return;
  race.languageDone = true;
  const r = race.rng;
  const car = r.pick(race.cars.filter(c => !c.retired));
  if (!car) return;
  const broadcast = r.chance(0.7);
  const line = r.pick(SWEAR);
  const other = r.pick(race.cars.filter(c => c !== car && !c.retired)) || car;
  const text = line.t.replace(/\{o\}/g, other.id);
  const target = line.to === 'rc' ? 'die Rennleitung bzw. die Kommissare' : line.to === 'driver' ? `${other.id} (anderer Fahrer)` : 'niemanden direkt – Frust über die Situation, das Auto oder das eigene Team';
  race.emit('radio', `Funk ${car.id}: „${text}“`, { cars: [car.id] });
  const expected = line.to === 'rc' ? ['fine'] : line.to === 'driver' ? ['warning', 'fine'] : ['warning'];
  createCase(race, {
    type: 'language', cars: [car.id],
    title: `Schimpfwörter im Funk von ${car.id}`,
    summary: `${car.id} flucht im Funk${line.to === 'rc' ? ' über die Rennleitung' : line.to === 'driver' ? ` über ${other.id}` : ''}${broadcast ? ' – der Spruch wird im TV übertragen' : ''}.`,
    evidence: [
      ev('radio', 'TEAM RADIO TRANSCRIPT', `${car.id}: „${text}“`, true),
      ev('data', 'Gerichtet an', target),
      ev('data', 'Übertragung', broadcast ? 'Live im Fernsehen gesendet.' : 'Nur im internen Teamfunk, nicht gesendet.'),
      ev('data', 'Leitlinie', 'Öffentliche Beleidigung von Offiziellen: Geldstrafe. Beleidigung anderer Fahrer: Verwarnung oder Geldstrafe. Fluchen ohne Ziel: höchstens Verwarnung. Interner, nicht gesendeter Funk wird nicht bestraft.'),
    ],
    truth: broadcast ? { offender: car.id, expected, points: [0, 0] } : { offender: null, expected: ['none'], points: [0, 0] },
  });
}
