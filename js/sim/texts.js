// Textbausteine für Meldungen und Funksprüche – viele Varianten, damit es nicht eintönig wird.
// Platzhalter: {id} Fahrer, {c} Kurve, {o} anderer Fahrer, {team} Team, {n} Zahl.

export const T = {
  // ---------- Dreher / Ausrutscher ----------
  spin: [
    '{id} dreht sich in {c} und steht neben der Strecke',
    '{id} rutscht in {c} von der Strecke ins Kiesbett',
    '{id} verliert in {c} das Heck und dreht sich',
    '{id} verbremst sich in {c} und landet im Auslauf',
    '{id} kommt in {c} mit allen vier Rädern von der Strecke ab',
    '{id} touchiert in {c} den Randstein und dreht sich',
    '{id} – Dreher in {c}, das Auto steht quer im Auslauf',
    '{id} verliert in {c} die Kontrolle und rutscht ins Gras',
    '{id} schießt in {c} geradeaus in die Auslaufzone',
    '{id} blockiert in {c} die Vorderräder und rutscht von der Strecke',
    '{id} ist in {c} zu schnell und dreht sich um die eigene Achse',
  ],
  spinRadio: [
    'Sorry, Jungs.', 'Ich hab das Heck verloren!', 'Die Reifen sind komplett weg.', 'Was war das denn?!',
    'Mein Fehler, mein Fehler.', 'Zu viel Randstein …', 'Keine Haftung da hinten!', 'Ich drehe mich!',
    'Bin wieder dran, alles gut.', 'Rückenwind in der Bremszone, hat mich überrascht.', 'Bremsen haben blockiert.',
    'Die Strecke ist da total rutschig!', 'Ich versuche weiterzufahren …', 'Mist! Okay, weiter geht’s.',
  ],
  stuckExposed: [
    '{id} kommt nicht mehr frei. Das Auto steht ungeschützt direkt neben der Fahrbahn.',
    '{id} steckt fest – das Auto steht gefährlich nah an der Ideallinie.',
    '{id} hängt im Kies fest, das Heck ragt fast auf die Strecke.',
    '{id} kann nicht mehr weiterfahren. Das Auto steht ohne Schutz am Streckenrand.',
  ],
  stuckSafe: [
    '{id} kommt nicht mehr frei. Das Auto steht weit im Auslauf, Bergung läuft.',
    '{id} steckt tief im Kiesbett – das Auto steht sicher hinter der Begrenzung.',
    '{id} hat sich festgefahren, das Auto steht weit weg von der Strecke.',
    '{id} gibt auf: Das Auto steckt im Kies, die Marshals sind unterwegs.',
  ],
  stuckRadio: [
    'Ich stecke fest, keine Chance.', 'Das war’s. Ich komme nicht mehr raus.', 'Sorry, ich habe es weggeworfen.',
    'Ich bin raus. Tut mir leid, Team.', 'Die Räder drehen nur durch …', 'Nichts zu machen, das Kiesbett hat mich.',
  ],

  // ---------- Technischer Defekt ----------
  failureRadio: [
    'Ich verliere Leistung … ich muss anhalten.', 'Kein Antrieb mehr!', 'Etwas ist kaputt, ich stelle das Auto ab.',
    'Motor ist aus, Motor ist aus!', 'Getriebe! Ich habe keine Gänge mehr!', 'Ich rieche Rauch im Cockpit!',
    'Die Hydraulik ist weg.', 'Bremsen! Ich habe kein Pedal mehr!', 'Der Motor ist einfach ausgegangen.',
    'Da raucht was hinten!', 'Lauter Fehlermeldungen … jetzt ist alles aus.', 'Batterie leer, nichts geht mehr.',
    'Öldruck weg! Soll ich abstellen?', 'Der Motor klingt komisch … nein, das war’s.', 'Ich habe keinen Strom mehr!',
    'Die Kupplung ist weg, ich rolle aus.',
  ],
  failureTeam: [
    'Verstanden, stell das Auto sicher ab.', 'Okay, Auto abstellen. Tut uns leid.', 'Abstellen, abstellen. Wir sehen es auch.',
    'Bestätigt. Bitte so weit wie möglich von der Strecke weg.', 'Verstanden. Schade – das war ein gutes Rennen.',
    'Okay. Motor aus und raus aus dem Auto, wenn es sicher ist.',
  ],

  // ---------- Schwerer Unfall ----------
  crash: [
    '{id} schlägt in {c} heftig in die Barriere ein.',
    '{id} verliert in {c} bei hohem Tempo die Kontrolle und kracht in die Reifenstapel.',
    '{id} fliegt in {c} von der Strecke und prallt gegen die Mauer.',
    '{id} berührt in {c} die Mauer und zerlegt sich die Aufhängung, das Auto schlittert quer über die Strecke.',
    '{id} rutscht in {c} rückwärts in die Begrenzung.',
    '{id} schlägt in {c} frontal in den Reifenstapel ein.',
    '{id} kommt in {c} von der Ideallinie ab und knallt in die Leitplanke.',
  ],
  crashOk: [
    'Mir geht’s gut.', 'Alles okay, nur ein harter Einschlag.', 'Ich bin okay … das Auto nicht.',
    'Mir geht es gut, sorry an das Team.', 'Autsch. Alles in Ordnung.', 'Okay, okay. Ich steige aus.',
    'Ich bin in Ordnung. Was für ein Einschlag …', 'Kopf und Nacken okay, alles gut.',
  ],

  // ---------- Trümmer ----------
  debris: [
    'Trümmerteile auf der Ideallinie nach Berührung {id}/{o} in {c}.',
    'Teile des Frontflügels liegen nach Kontakt {id}/{o} in {c} auf der Strecke.',
    'Nach der Berührung {id}/{o} liegen Karbonteile in {c}.',
    'Kleine Trümmer in {c} – Überreste der Berührung {id}/{o}.',
    'In {c} liegt ein größeres Teil auf der Fahrbahn (Kontakt {id}/{o}).',
  ],

  // ---------- Fahrer beschweren sich über fehlende Absicherung ----------
  complainStopped: [
    'Da steht ein Auto in {c} – keine gelbe Flagge?!', 'Auto in {c}! Habt ihr das gesehen?', 'Da steht jemand in {c}, gelbe Flagge bitte!',
    'Ich sehe ein Auto in {c}, aber keine Flagge!', 'Gefährlich in {c}, da steht ein Auto!',
  ],
  complainDebris: [
    'Da liegen überall Teile in {c}!', 'Trümmer in {c}! Ich bin fast drübergefahren.', 'Teile auf der Ideallinie in {c}!',
    'In {c} liegt was rum, bitte aufräumen!',
  ],
  complainCrash: [
    'Riesiger Unfall in {c}! Da liegt alles voll!', 'Heftiger Crash in {c}! Wir brauchen das Safety Car!',
    'Da ist gerade einer in {c} reingeknallt!', 'Unfall in {c}, überall Trümmer!',
  ],
  complainWeather: [
    'Ich sehe gar nichts mehr, hier steht überall Wasser!', 'Aquaplaning! Das ist zu gefährlich!',
    'Viel zu viel Wasser auf der Strecke!', 'Ich fahre blind hinter den anderen her!',
  ],

  // ---------- Allgemeiner Funkverkehr ----------
  boxCall: [
    'Box, box!', 'Box this lap, box this lap.', 'Diese Runde reinkommen, Plan B.', 'Wir kommen rein – Reifen sind bereit.',
    'Box, box, box. Bestätige.', 'Rein jetzt, wir haben das Fenster.',
  ],
  boxReply: ['Verstanden.', 'Bestätigt, komme rein.', 'Okay, Box.', 'Copy.', 'Sicher? … Okay, ich komme.'],
  tyresGone: [
    'Die Hinterreifen sind am Ende!', 'Ich habe keinen Grip mehr.', 'Wie lange noch auf diesem Satz?',
    'Die Reifen bauen massiv ab.', 'Vorne links ist komplett hinüber.', 'Ich rutsche nur noch herum.',
    'Wir müssen bald reinkommen, die Reifen sind fertig.',
  ],
  passGood: [
    'Vorbei! Weiter pushen.', 'Ja! Das war sauber.', 'Der nächste bitte.', 'Endlich vorbei!', 'Guter Move!',
  ],
  passBad: [
    'Er hatte einfach mehr Speed.', 'Ich konnte nichts machen.', 'Der war hart, aber fair.', 'Mist, er war zu schnell.',
    'Okay, ich hänge mich dran.',
  ],
  blueFlag: [
    'Blaue Flaggen! Der muss Platz machen!', 'Er blockiert mich seit zwei Kurven!', 'Blaue Flagge für den vor mir, bitte!',
  ],
  fastest: ['Schnellste Runde! Super gemacht.', 'Purple Sector, purple Lap – stark!', 'Das war eine Hammerrunde.'],
  lateRace: [
    'Noch {n} Runden – bring es nach Hause.', 'Noch {n} Runden. Reifen schonen, keine Risiken.',
    'Noch {n} Runden, der Abstand passt.', 'Noch {n} Runden – jetzt alles geben!',
  ],
  scRadio: [
    'Safety Car, Safety Car. Delta positiv halten.', 'SC ist draußen, Reifen warm halten.', 'Safety Car – bleib konzentriert, keine Überholmanöver.',
  ],
  vscRadio: ['VSC, VSC. Delta einhalten.', 'Virtual Safety Car – auf das Delta achten.', 'VSC aktiv, nicht zu langsam werden.'],
  rainRadio: [
    'Es fängt an zu tröpfeln.', 'Ein paar Tropfen auf dem Visier.', 'Wie sieht das Radar aus?', 'Wird es noch mehr regnen?',
    'Die Strecke wird rutschig, Achtung.',
  ],
  general: [
    'Untersteuern in den langsamen Kurven.', 'Wie groß ist der Abstand nach hinten?', 'Ich komme näher ran!',
    'Er ist in den Kurven langsamer.', 'Kann ich mehr Leistung haben?', 'Die Batterie ist leer am Ende der Geraden.',
    'Übersteuern am Kurvenausgang.', 'Die Bremsen ziehen nach links.', 'Mein Getränk funktioniert nicht.',
    'Wo verliere ich die Zeit?', 'Wie sind die Reifen beim Vordermann?', 'Der Wind dreht in der letzten Kurve.',
    'Das Lenkrad vibriert ein bisschen.', 'Ich hänge im Verkehr fest.', 'Sag mir einfach, wann ich pushen soll.',
    'Der Hintermann kommt näher, oder?', 'Das Auto fühlt sich gut an.', 'Zu viel Gischt, ich sehe kaum was.',
  ],
  teamGeneral: [
    'Die Pace ist gut, weiter so.', 'Sprit sparen, Modus 3.', 'Bremsen werden heiß – Lift and Coast.',
    'Abstand nach hinten {n} Sekunden.', 'Der Vordermann hat ältere Reifen.', 'Sektor 2 ist dein bester, weiter so.',
    'Strategie bleibt bei Plan A.', 'Wir schauen auf Plan B, bleib dran.', 'Achte auf die Track Limits in der letzten Kurve.',
    'Du bist zwei Zehntel schneller als er.', 'Ruhig bleiben, das Rennen ist lang.', 'Motor-Modus 5, wenn du bereit bist.',
  ],
};

// Zufälligen Text auswählen und Platzhalter füllen
export function pickText(race, key, vars = {}) {
  const pool = T[key];
  const s = pool[Math.floor(race.rng.next() * pool.length)];
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

// Gelegentlicher Funkverkehr ohne Folgen für das Rennen (eigener Zufall – ändert den Ablauf nicht)
export function ambientRadio(race, dt, rand) {
  if (race.isSession || race.phase !== 'running') return;
  race.nextChatter = race.nextChatter ?? 25;
  if (race.time < race.nextChatter) return;
  race.nextChatter = race.time + 18 + rand() * 30;
  const running = race.cars.filter(c => !c.retired && !c.finished && !c.inPit);
  if (!running.length) return;
  const car = running[Math.floor(rand() * running.length)];
  const leader = race.standings()[0];
  const left = race.laps - leader.lap;
  const pick = key => { const p = T[key]; return p[Math.floor(rand() * p.length)]; };
  const n = race.neutral;
  let text, who = `Funk ${car.id}`;
  if (n && n.type === 'sc') { text = pick('scRadio'); who = `Teamfunk ${car.team.name} an ${car.id}`; }
  else if (n && n.type === 'vsc') { text = pick('vscRadio'); who = `Teamfunk ${car.team.name} an ${car.id}`; }
  else if (race.weather.rain > 0.1 && race.weather.wetness < 0.3 && rand() < 0.6) text = pick('rainRadio');
  else if (car.tyreAge * (race.wear || 1) > 22 && rand() < 0.6) text = pick('tyresGone');
  else if (left > 0 && left <= 5 && rand() < 0.4) {
    text = pick('lateRace').replace('{n}', left);
    who = `Teamfunk ${car.team.name} an ${car.id}`;
  } else if (rand() < 0.45) {
    text = pick('teamGeneral').replace('{n}', (1 + rand() * 6).toFixed(1).replace('.', ','));
    who = `Teamfunk ${car.team.name} an ${car.id}`;
  } else text = pick('general');
  race.emit('radio', `${who}: „${text}“`, { cars: [car.id] });
}
