// Weitere Entscheidungen: Fahrverhalten (blaue Flaggen, Weben, Bremstest, Safety-Car-Phasen,
// Neustart, Schikane abgekürzt), unsicher abgestellt, Boxengasse (Linie, gesperrt, Arbeiten unter Rot,
// Stau in der Fahrgasse im Qualifying).
import { wrapD } from './trackModel.js';
import { cornerNear, cornerLabel } from './hazards.js';
import { createCase, ev, measure, tvImpression } from './incidents.js';
import { aggressionOf } from './race.js';

const f1 = x => x.toFixed(1).replace('.', ',');
const pct = x => `${Math.round(x)} %`;

// ---------- Blaue Flaggen ----------
export function rollBlueFlag(race, lapped, leader) {
  if (race.isSession || race.neutral) return;
  if (!race.rng.chance(0.012 * aggressionOf(lapped) / 70 * (race.incScale || 1))) return;
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
      ev('radio', `Funk ${leader.id}`, '„Blaue Flaggen! Der muss Platz machen!“'),
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
  if (!r.chance(0.0009 * aggressionOf(defender) / 70 * (race.incScale || 1))) return;
  const corner = race.track.corners.find(c => c.id === cornerId) || cornerNear(race.track, defender.d);
  if (r.chance(0.6)) {
    const guilty = r.chance(0.55);
    const moves = guilty ? r.int(2, 3) : 1;
    createCase(race, {
      type: 'weaving', cars: [defender.id, attacker.id], corner: corner.id,
      title: `${defender.id} verteidigt mit mehreren Richtungswechseln? – vor ${corner.id}`,
      summary: `${defender.id} wechselt auf der Geraden vor ${cornerLabel(corner)} mehrmals die Linie, ${attacker.id} folgt im Windschatten.`,
      evidence: [
        ev('video', 'TV-Bilder', `${defender.id} zieht nach links, dann wieder nach rechts.${tvImpression(race, guilty ? 'Das wirkt wie zwei Bewegungen.' : 'Die zweite Bewegung wirkt wie die Rückkehr zur Ideallinie.', guilty ? 'Die zweite Bewegung wirkt wie die Rückkehr zur Ideallinie.' : 'Das wirkt wie zwei Bewegungen.')}`, true),
        ev('telemetry', `Lenkdaten ${defender.id}`, `${moves} deutliche Richtungswechsel, Seitenversatz ${f1(measure(race, guilty ? 3.2 : 2, 0.8, 0.5, 6))} m.`),
        ev('radio', `Funk ${attacker.id}`, '„Er bewegt sich zweimal! Das ist nicht erlaubt!“'),
        ev('data', 'Leitlinie', 'Ein Richtungswechsel zur Verteidigung ist erlaubt. Wer danach zurück zur Ideallinie will, muss eine Autobreite Platz lassen. Mehrfaches Hin und Her ist verboten (üblich: Schwarz-Weiß-Flagge oder 5 s).'),
      ],
      truth: guilty ? { offender: defender.id, expected: ['bw', '5s'], points: [0, 1], victim: attacker.id } : { offender: null, expected: ['none'], points: [0, 0], victim: attacker.id },
    });
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
        ev('radio', `Funk ${attacker.id}`, '„Er hat mich gerade gebremstestet!“'),
        ev('radio', `Funk ${defender.id}`, guilty ? '„Ich habe nur meine Reifen geschont.“' : '„Ich hatte gerade einen Leistungsverlust!“'),
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
        ev('radio', `Funk ${A.id}`, legal ? '„Er war viel zu langsam, ich musste vorbei.“' : '„Er hat mich vorbeigelassen, oder?“'),
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
  createCase(race, {
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
  if (race.isSession || !race.rng.chance(0.006)) return;
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
