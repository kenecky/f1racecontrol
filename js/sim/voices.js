// Stimmen der Fahrer und Teams in Entscheidungen (Funk, Anhörung). Viele Varianten, damit sich
// Fälle nicht wiederholen. {o} = anderer Fahrer, {t} = Team.
export const VOICES = {
  // ---------- Anhörung ----------
  admit: [
    'Ich habe mich verbremst, das war mein Fehler.', 'Ich hätte etwas früher reagieren müssen.', 'Im Nachhinein war das zu optimistisch.',
    'Ich habe die Lücke falsch eingeschätzt.', 'Das geht auf meine Kappe, tut mir leid für {o}.', 'Die Reifen waren kalt, ich bin weggerutscht – mein Fehler.',
    'Ich wollte zu viel, das gebe ich zu.', 'Ich habe {o} zu spät gesehen, das hätte nicht passieren dürfen.', 'Ehrlich gesagt war das kein guter Move von mir.',
    'Ich habe die Bremse zu spät getroffen, da gibt es nichts schönzureden.', 'Ich entschuldige mich bei {o}, das war unnötig.', 'Der Rückenwind hat mich überrascht, aber das ist keine Ausrede.',
  ],
  defend: [
    'Ich habe nichts falsch gemacht.', 'Ich hatte die Linie, der andere hätte Platz lassen müssen.', 'Das war ganz normales Racing.',
    'Ich war vorne, die Kurve gehörte mir.', 'Ich habe meine Linie gehalten wie in jeder Runde.', 'Ich habe genug Platz gelassen – mehr geht nicht.',
    'Wenn man außen angreift, muss man mit so etwas rechnen.', '{o} kam aus dem Nichts, da konnte ich nichts machen.', 'Ich habe ganz normal gebremst, schaut euch die Daten an.',
    'Das war hart, aber fair.', 'Ich habe {o} gesehen und Platz gelassen – er hat sich verbremst.', 'Ich verstehe nicht, warum das überhaupt untersucht wird.',
    'Wir fahren hier Rennen, nicht Prozession.', 'Ich war auf der Ideallinie, wo hätte ich hin sollen?',
  ],
  accept: [
    'Ehrlich gesagt: ein Rennunfall.', 'So etwas passiert im Zweikampf.', 'Keiner von uns wollte das, es war einfach eng.',
    'Ich sehe da keinen Schuldigen, das war Pech.', 'Wir sind beide ans Limit gegangen – Rennunfall.', 'Ärgerlich, aber da kann man niemandem einen Vorwurf machen.',
    'Zwei Autos, eine Kurve – das geht manchmal nicht auf.', 'Ich will nicht, dass {o} dafür bestraft wird.',
  ],
  blame: [
    'Das war klar der Fehler von {o}.', '{o} hat mich einfach abgeschossen.', 'Ich hatte keine Chance, {o} hat viel zu spät gebremst.',
    '{o} hat überhaupt nicht in die Spiegel geschaut.', 'Wenn das nicht bestraft wird, wann dann?', '{o} hat mir das Rennen ruiniert.',
    'Ich war klar vorne, {o} ist einfach reingefahren.', 'Schaut euch die Onboard an – eindeutig {o}.', '{o} macht das nicht zum ersten Mal.',
    'Das war gefährlich von {o}, so etwas darf man nicht durchgehen lassen.',
  ],
  noIntent: [
    'Das war keine Absicht.', 'Ich habe davon im Auto nichts gemerkt.', 'Mir wurde nichts über Funk gesagt.', 'Ich hatte damit viel zu tun, das Auto zu halten.',
    'Davon habe ich erst nach dem Rennen erfahren.', 'Im Cockpit sieht man das nicht so.', 'Ich war voll auf meine Runde konzentriert.',
  ],
  notWrong: [
    'Da war nichts Unerlaubtes.', 'Alles im Rahmen der Regeln.', 'Ich habe mich genau an die Vorgaben gehalten.', 'Das Team hat mir bestätigt, dass alles okay war.',
    'Ich sehe keinen Verstoß.', 'Die Daten werden zeigen, dass ich sauber war.',
  ],
  pileup: [
    'Ich konnte nicht mehr ausweichen.', 'Vor mir haben alle gebremst, da war kein Platz mehr.', 'Ich war im Windschatten und habe nichts gesehen.',
    'Das ging alles viel zu schnell.', 'Links war die Mauer, rechts ein Auto – keine Chance.', 'Ich war nur Passagier.',
  ],
  noChance: [
    '{o} hat mir keine Chance gelassen.', '{o} hat die Tür zugemacht, als ich schon daneben war.', 'Ich musste ausweichen, sonst hätte es richtig gekracht.',
    '{o} hat mich in der Bremszone abgedrängt.', 'Ich war schon halb vorbei, {o} zieht trotzdem rüber.', 'Was hätte ich machen sollen? {o} war überall.',
  ],
  // ---------- Funk im Rennen ----------
  weaving: ['Er bewegt sich zweimal! Das ist nicht erlaubt!', 'Er fährt Schlangenlinien auf der Geraden!', '{o} wechselt dauernd die Seite, gefährlich!',
    'Zweimal rüber, Leute, das ist eine Strafe!', 'Ich weiß nicht, wo ich hin soll, er zieht hin und her!', 'Das ist doch kein Verteidigen mehr!'],
  brakeTested: ['Er hat mich gerade gebremstestet!', '{o} bremst mitten auf der Geraden!', 'Fast wäre ich ihm hinten drauf – völlig grundlos gebremst!',
    'Was war das?! Er geht einfach vom Gas!', 'Das ist gefährlich, er bremst mich absichtlich!', 'Brake Test! Ganz klar!'],
  brakeExcuseGuilty: ['Ich habe nur meine Reifen geschont.', 'Ich wollte Energie sparen.', 'Ich habe nur früher gebremst als sonst.', 'Ich habe die Batterie geladen, das ist erlaubt.'],
  brakeExcuseOk: ['Ich hatte gerade einen Leistungsverlust!', 'Das Auto ist kurz ausgegangen!', 'Ich hatte einen Schaltfehler!', 'Die Hybridleistung war plötzlich weg!'],
  blueAngry: ['Blaue Flaggen! Der muss Platz machen!', 'Wie lange soll ich noch hinter dem bleiben?!', 'Blau, blau, blau! Der kostet mich Sekunden!',
    'Hat der keine Spiegel? Blaue Flagge!', 'Ich verliere hier das Rennen, er lässt mich nicht vorbei!'],
  offTrackComplain: ['Er hat mich neben der Strecke überholt! Er muss den Platz zurückgeben!', 'Alle vier Räder draußen! Das zählt nicht!',
    '{o} nutzt den Auslauf zum Überholen!', 'Er hat abgekürzt und ist jetzt vor mir!', 'Track Limits! Er war komplett neben der Strecke!'],
  unsafeComplain: ['{o} ist mir direkt vors Auto gefahren!', 'Die haben ihn genau vor mir rausgelassen!', 'Fast hätte es in der Boxengasse gekracht!',
    'Unsafe Release! Ich musste voll bremsen!', 'Was soll das? Der kommt einfach raus!'],
  unsafeExcuse: ['Ich habe in den Spiegel geschaut, da war genug Platz.', 'Die Ampel war grün, ich bin losgefahren.', 'Das Team hat mich freigegeben.',
    'Ich habe ihn gesehen und bin auf meiner Spur geblieben.'],
  slowAngry: ['Er war viel zu langsam, ich musste vorbei!', 'Der fährt ja Schritttempo!', 'Ich wäre ihm fast hinten drauf gefahren!',
    'Was macht der? Der rollt nur noch!'],
  flagLate: ['Ich habe die Flagge zu spät gesehen.', 'Das Lichtpanel war schwer zu sehen.', 'Ich hatte die Sonne im Gesicht, da war keine Flagge.',
    'Die gelbe Flagge kam erst nach der Kuppe.'],
  powerLoss: ['Ich habe Leistungsverlust!', 'Das Auto hat keine Power mehr!', 'Irgendwas stimmt mit der Hybridleistung nicht!', 'Ich bin im Notlauf!'],
};

// Text ziehen (zufällig, über die Renn-Zufallszahlen – reproduzierbar)
export function say(race, key, vars = {}) {
  const pool = VOICES[key];
  const s = race.rng.pick(pool);
  return `„${s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))}“`;
}
