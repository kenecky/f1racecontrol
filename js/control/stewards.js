// Rennkommissare: Entscheidungen untersuchen, Urteile fällen, Strafen anwenden, Urteile bewerten.
export const PENALTIES = {
  none:     { name: 'Keine Strafe',         short: '–',    sev: 0 },
  warning:  { name: 'Verwarnung',           short: 'Verw.', sev: 1 },
  bw:       { name: 'Schwarz-Weiß-Flagge',  short: 'S/W',  sev: 1 },
  giveback: { name: 'Platz zurückgeben',    short: 'Platz', sev: 1.5 },
  '5s':     { name: '5-s-Zeitstrafe',       short: '+5 s', sev: 2, secs: 5 },
  '10s':    { name: '10-s-Zeitstrafe',      short: '+10 s', sev: 3, secs: 10 },
  dt:       { name: 'Durchfahrtsstrafe',    short: 'DT',   sev: 4 },
  sg:       { name: '10-s-Stop-and-Go',     short: 'SG',   sev: 5 },
  dsq:      { name: 'Disqualifikation',     short: 'DSQ',  sev: 7 },
  deleteLap: { name: 'Rundenzeit streichen', short: 'Runde gestr.', sev: 1 },
  grid3:    { name: 'Startplatzstrafe 3 Plätze (nächstes Rennen)',  short: '−3 SP',  sev: 2, places: 3 },
  grid5:    { name: 'Startplatzstrafe 5 Plätze (nächstes Rennen)',  short: '−5 SP',  sev: 3, places: 5 },
  grid10:   { name: 'Startplatzstrafe 10 Plätze (nächstes Rennen)', short: '−10 SP', sev: 4, places: 10 },
  pitstart: { name: 'Start aus der Boxengasse (nächstes Rennen)', short: 'PIT', sev: 4.5, places: 99 },
  fine:     { name: 'Geldstrafe', short: '€', sev: 1 },
  keep:     { name: 'Protest abgelehnt – Urteil bleibt', short: 'abgelehnt', sev: 0 },
};

import { hearingEvidence } from '../sim/incidents.js';

export function openCases(race) {
  return race.cases.filter(c => ['new', 'investigating', 'post', 'hearing'].includes(c.status));
}

// Nach dem Rennen: Fahrer zur Anhörung bei der Rennleitung vorladen
export function startHearing(race, c) {
  if (c.status !== 'post' || race.phase !== 'finished') return;
  c.status = 'hearing';
  c.hearing = hearingEvidence(race, c);
  race.emit('rc', `Anhörung zu Entscheidung #${c.id}: ${c.cars.join(', ')} bei der Rennleitung.`);
}

export function investigate(race, c) {
  if (c.status !== 'new') return;
  c.status = 'investigating';
  race.emit('rc', `Entscheidung #${c.id} wird untersucht: ${c.title}`);
}

export function postpone(race, c) {
  if (c.status !== 'new' && c.status !== 'investigating') return;
  c.status = 'post';
  race.emit('rc', `Entscheidung #${c.id} wird nach dem Rennen untersucht (Anhörung): ${c.title}`);
}

export function noFurtherAction(race, c) {
  if (c.status === 'decided' || c.status === 'nfa') return;
  c.status = 'nfa';
  c.verdict = { carId: null, penalty: 'none', points: 0, time: race.time };
  race.emit('rc', `Entscheidung #${c.id}: Keine weitere Untersuchung – ${c.title}`);
  reactToVerdict(race, c);
}

// Teams reagieren per Funk auf Urteile (nicht immer sachlich)
function reactToVerdict(race, c) {
  const r = race.rng;
  const v = c.verdict, t = c.truth;
  const { verdict } = evaluateCase(race, c);
  const team = id => race.carById[id].team.name;
  if (v.carId) {
    const rep = race.teamRep ? race.teamRep[race.carById[v.carId].team.id] || 0 : 0;
    const furious = verdict === 'wrong' || (verdict === 'harsh' && !t.offender) || r.chance(rep <= -25 ? 0.6 : rep <= -10 ? 0.35 : 0.2);
    const text = furious ? r.pick(['„Das ist ein Skandal! Wir prüfen einen Protest.“', '„Völlig unverständlich!“'])
      : verdict === 'harsh' ? '„Viel zu hart für so etwas.“'
        : r.pick(['„Wir sehen das anders, akzeptieren es aber.“', '„Schwer nachzuvollziehen.“', '„Verstanden.“']);
    race.emit('radio', `Teamfunk ${team(v.carId)}: ${text}`, { cars: [v.carId] });
  }
  if (t.victim && race.carById[t.victim]) {
    if (t.offender && (verdict === 'lenient' || !v.carId) && r.chance(0.75)) {
      race.emit('radio', `Teamfunk ${team(t.victim)}: „${v.carId ? 'Das ist doch keine angemessene Strafe!' : 'Keine Strafe?! Das kann nicht sein.'}“`, { cars: [t.victim] });
    } else if (!t.offender && !v.carId && r.chance(0.5)) {
      race.emit('radio', `Teamfunk ${team(t.victim)}: „Wir hätten uns eine Strafe gewünscht.“`, { cars: [t.victim] });
    } else if (verdict === 'ok' && v.carId && r.chance(0.4)) {
      race.emit('radio', `Teamfunk ${team(t.victim)}: „Gerechte Entscheidung.“`, { cars: [t.victim] });
    }
  }
}

export function decide(race, c, { carId, penalty, points }) {
  if (c.status === 'decided' || c.status === 'nfa') return;
  // Protest / Antrag auf Überprüfung: Urteil bleibt, wird aufgehoben oder ersetzt
  if (c.type === 'protest') {
    const base = race.cases.find(x => x.id === c.base);
    c.status = 'decided';
    if (penalty === 'keep') {
      c.verdict = { carId: null, penalty: 'keep', points: 0, time: race.time };
      race.emit('rc', `Entscheidung #${c.id}: Protest abgelehnt – das Urteil zu DOC ${c.base} bleibt bestehen.`);
      return;
    }
    revertPenalty(race, base);
    if (!carId || penalty === 'none') {
      c.verdict = { carId: null, penalty: 'none', points: 0, time: race.time };
      race.emit('rc', `Entscheidung #${c.id}: Protest angenommen – die Strafe aus DOC ${c.base} wird aufgehoben.`);
      return;
    }
    c.verdict = { carId, penalty, points, time: race.time };
    race.penaltyPoints[carId] = (race.penaltyPoints[carId] || 0) + points;
    race.emit('rc', `Entscheidung #${c.id}: Protest angenommen – neues Urteil zu DOC ${c.base}: ${PENALTIES[penalty].name} für ${carId}.`, { cars: [carId] });
    applyPenalty(race, race.carById[carId], penalty, c);
    return;
  }
  if (!carId || penalty === 'none') {
    c.status = 'decided';
    c.verdict = { carId: null, penalty: 'none', points: 0, time: race.time };
    race.emit('rc', `Entscheidung #${c.id}: Keine Strafe – ${c.title}`);
    reactToVerdict(race, c);
    return;
  }
  c.status = 'decided';
  c.verdict = { carId, penalty, points, time: race.time };
  const car = race.carById[carId];
  race.penaltyPoints[carId] = (race.penaltyPoints[carId] || 0) + points;
  const pts = points ? `, ${points} Strafpunkt${points > 1 ? 'e' : ''}` : '';
  race.emit('rc', `STRAFE: ${PENALTIES[penalty].name} für ${carId}${pts} – ${c.typeName}`, { cars: [carId] });
  applyPenalty(race, car, penalty, c);
  reactToVerdict(race, c);
  raiseCaution(race, car, PENALTIES[penalty].sev);
}

// Wer bestraft wird, fährt danach vorsichtiger (weniger Risiko, aber auch etwas langsamer)
const CAUTION_TALK = [
  'Keine weiteren Risiken jetzt, wir können uns keine Strafe mehr leisten.',
  'Ruhig bleiben – sauber fahren, die Kommissare schauen genau hin.',
  'Wir brauchen die Punkte. Keine Brechstange mehr, okay?',
  'Lass die Zweikämpfe etwas ruhiger angehen.',
  'Noch eine Strafe und es wird teuer. Konzentrier dich.',
  'Bitte sauber bleiben, auch wenn es Zeit kostet.',
];
function raiseCaution(race, car, sev) {
  if (!car || car.dsq) return;
  const before = car.caution || 0;
  car.caution = Math.min(1, before + (sev >= 2 ? 0.25 : 0.1));
  if (!race.isSession && !car.retired && !car.finished && race.phase === 'running' && car.caution >= 0.25 && before < car.caution) {
    race.emit('radio', `Teamfunk ${car.team.name} an ${car.id}: „${race.rng.pick(CAUTION_TALK)}“`, { cars: [car.id] });
  }
}

// Strafe eines Falls zurücknehmen (nach erfolgreichem Protest)
export function revertPenalty(race, base) {
  const v = base && base.verdict;
  if (!v || !v.carId) return;
  const car = race.carById[v.carId];
  car.timePens = car.timePens.filter(p => p.caseId !== base.id || p.served);
  car.serve = car.serve.filter(p => p.caseId !== base.id);
  race.carryOver = (race.carryOver || []).filter(g => g.caseId !== base.id);
  if (v.penalty === 'dsq' && car.dsq) { car.dsq = false; if (car.finished) { car.retired = false; car.dnf = null; } }
  if (v.penalty === 'warning' || v.penalty === 'bw') car.warnings = Math.max(0, (car.warnings || 1) - 1);
  race.penaltyPoints[v.carId] = Math.max(0, (race.penaltyPoints[v.carId] || 0) - (v.points || 0));
  v.revoked = true;
}

// ---------- Proteste und Anträge auf Überprüfung nach dem Rennen ----------
export function rollProtests(race) {
  if (race.protestsDone) return 0;
  race.protestsDone = true;
  const r = race.rng;
  let n = 0;
  for (const c of [...race.cases]) {
    if (n >= 2 || !['decided', 'nfa'].includes(c.status) || c.type === 'protest' || c.type === 'tech' || !c.truth) continue;
    const { verdict } = evaluateCase(race, c);
    const v = c.verdict || { carId: null };
    const t = c.truth;
    let team = null, review = false, founded = false;
    if ((verdict === 'lenient' || verdict === 'wrong') && t.victim && r.chance(0.6)) { team = race.carById[t.victim].team; founded = true; }
    else if ((verdict === 'harsh' || verdict === 'wrong') && v.carId && r.chance(0.6)) { team = race.carById[v.carId].team; review = true; founded = true; }
    else if (verdict === 'ok' && r.chance(0.08)) {
      const other = c.cars.map(id => race.carById[id]).find(x => x && (!v.carId || x.id !== v.carId));
      if (other) team = other.team;
      review = Boolean(v.carId && race.carById[v.carId].team === team);
    }
    if (!team) continue;
    n++;
    const extra = hearingEvidence(race, c).filter(e => e.kind !== 'hearing');
    const pc = {
      id: ++race.caseSeq, time: race.time, lap: c.lap, status: 'new', verdict: null, type: 'protest',
      typeName: review ? 'Antrag auf Überprüfung' : 'Protest', base: c.id, cars: c.cars,
      title: `${review ? 'Antrag auf Überprüfung' : 'Protest'} von ${team.name} zu DOC ${c.id}`,
      summary: `${team.name} ${review ? 'legt neue Beweise vor und beantragt, das Urteil' : 'protestiert gegen das Urteil'} zu „${c.title}“ ${review ? 'zu überprüfen' : ''}. Bisheriges Urteil: ${v.carId ? `${PENALTIES[v.penalty].name} für ${v.carId}` : 'keine Strafe'}.`,
      evidence: [
        { kind: 'data', label: 'Bisheriges Urteil', text: `DOC ${c.id}: ${v.carId ? `${PENALTIES[v.penalty].name} für ${v.carId}` : 'keine Strafe'}.`, early: true },
        { kind: 'data', label: `Vorgelegt von ${team.name}`, text: founded ? 'Neue Onboard-Aufnahmen und Telemetrie, die bisher nicht vorlagen.' : 'Teamdaten aus der eigenen Auswertung.', early: true },
        ...(founded ? extra : [{ kind: 'data', label: 'Prüfung', text: 'Die vorgelegten Daten zeigen nichts Neues gegenüber den bereits bekannten Beweisen.' }]),
        ...c.evidence.filter(e => e.kind !== 'data' || e.label === 'Leitlinie').slice(0, 3),
      ],
      truth: founded ? { ...t, unfounded: false } : { offender: v.carId || null, expected: ['keep'], points: [0, 0], unfounded: true },
      options: ['keep', ...c.options.filter(o => o !== 'deleteLap')],
      when: 'Nach dem Rennen',
    };
    race.cases.push(pc);
    race.emit('case', `${pc.typeName} von ${team.name} zu DOC ${c.id} eingegangen.`, { caseId: pc.id, cars: pc.cars });
  }
  return n;
}

// Ausgeschiedene Fahrer: Strafen wirken als Startplatzstrafe im nächsten Rennen
export const CARRY_OVER = { '5s': 3, '10s': 5, giveback: 3, dt: 5, sg: 10 };

function carryOver(race, car, places, why, caseId = null) {
  race.carryOver = race.carryOver || [];
  race.carryOver.push({ carId: car.id, places, why, caseId });
  race.emit('rc', places >= 99 ? `${car.id} startet im nächsten Rennen aus der Boxengasse (${why}).` : `${car.id}: Startplatzstrafe von ${places} Plätzen für das nächste Rennen (${why}).`, { cars: [car.id] });
}

function applyPenalty(race, car, penalty, c) {
  if (penalty === 'deleteLap') {
    if (race.deleteLap) race.deleteLap(car, c.lapRef);
    return;
  }
  if (PENALTIES[penalty].places) {
    carryOver(race, car, PENALTIES[penalty].places, c.typeName, c.id);
    return;
  }
  if (car.retired && !car.dsq && CARRY_OVER[penalty]) {
    carryOver(race, car, CARRY_OVER[penalty], `${PENALTIES[penalty].name} umgewandelt – Fahrer ausgeschieden`, c.id);
    return;
  }
  const running = race.phase === 'running' && !car.finished && !car.retired;
  const lapsLeft = race.laps - car.lap;
  switch (penalty) {
    case 'warning':
    case 'bw':
      car.warnings = (car.warnings || 0) + 1;
      break;
    case 'giveback': {
      const victim = race.carById[c.truth.victim || c.cars.find(id => id !== car.id)];
      const victimBehind = victim && !victim.retired && race.raceDist(victim) < race.raceDist(car);
      if (!running || !victim || victim.retired) {
        car.timePens.push({ secs: 5, served: false, caseId: c.id, note: 'Platz konnte nicht mehr zurückgegeben werden' });
        race.emit('rc', `${car.id} kann den Platz nicht mehr zurückgeben – stattdessen 5-s-Zeitstrafe.`);
      } else if (!victimBehind) {
        race.emit('rc', `${victim.id} liegt bereits wieder vor ${car.id}.`);
      } else {
        // Manche Fahrer ignorieren die Anordnung (abhängig von der Aggressivität)
        const ignore = race.rng.chance(Math.max(0.05, (car.driver.aggression - 50) / 150));
        car.giveBack = { target: victim.id, until: race.time + 120, voluntary: false, caseId: c.id, ignore };
      }
      break;
    }
    case '5s':
    case '10s':
      car.timePens.push({ secs: PENALTIES[penalty].secs, served: false, caseId: c.id });
      break;
    case 'dt':
    case 'sg':
      if (!running || lapsLeft < 3) {
        const secs = penalty === 'dt' ? 20 : 30;
        car.timePens.push({ secs, served: false, caseId: c.id, note: 'umgewandelt' });
        race.emit('rc', `${PENALTIES[penalty].name} für ${car.id} wird in +${secs} s umgewandelt.`);
      } else {
        car.serve.push({ type: penalty, issuedLap: car.lap, caseId: c.id });
      }
      break;
    case 'dsq':
      car.dsq = true;
      car.retired = true;
      car.dnf = 'Disqualifiziert';
      car.inPit = false;
      car.offTrack = null;
      car.pass = null;
      race.emit('rc', `SCHWARZE FLAGGE: ${car.id} ist disqualifiziert.`, { cars: [car.id] });
      break;
    default:
  }
}

// Noch nicht abgesessene Zeitstrafen (Sekunden)
export function unservedSecs(car) {
  return (car.timePens || []).filter(p => !p.served).reduce((s, p) => s + p.secs, 0);
}

function expectedText(t) {
  return t.expected.map(k => PENALTIES[k].name).join(' oder ');
}

// Bewertung eines Urteils
export function evaluateCase(race, c) {
  const t = c.truth;
  const v = c.verdict;
  if (c.type === 'protest' && v) {
    const kept = v.penalty === 'keep' || c.status === 'nfa';
    if (t.unfounded) return kept ? { verdict: 'ok', note: 'Unbegründeter Protest – zu Recht abgelehnt' } : { verdict: 'harsh', note: 'Unbegründeter Protest – das Urteil hätte bleiben sollen' };
    if (kept) return { verdict: 'lenient', note: `Begründeter Protest abgelehnt (${t.offender ? `angemessen: ${expectedText(t)} für ${t.offender}` : 'die Strafe hätte aufgehoben werden müssen'})` };
  }
  if (!v && (c.status === 'post' || c.status === 'hearing')) return { verdict: 'pending', note: 'Anhörung nach dem Rennen ausstehend' };
  if (!v) return { verdict: 'open', note: 'Nicht entschieden' };
  const fine = 'angemessen';
  if (!t.offender) {
    if (!v.carId || v.penalty === 'none') return { verdict: 'ok', note: `Kein Vergehen – keine Strafe war richtig` };
    return { verdict: 'harsh', note: 'Kein Vergehen – die Strafe war unberechtigt' };
  }
  if (!v.carId || v.penalty === 'none') return { verdict: 'lenient', note: `Vergehen nicht bestraft (${fine}: ${expectedText(t)} für ${t.offender})` };
  if (v.carId !== t.offender) return { verdict: 'wrong', note: `Falscher Fahrer bestraft – verantwortlich war ${t.offender}` };
  const sevs = t.expected.map(k => PENALTIES[k].sev);
  const s = PENALTIES[v.penalty].sev;
  let verdict = 'ok';
  let note = `${PENALTIES[v.penalty].name} – ${fine}`;
  if (s < Math.min(...sevs)) { verdict = 'lenient'; note = `${PENALTIES[v.penalty].name} – zu mild (${fine}: ${expectedText(t)})`; }
  if (s > Math.max(...sevs)) { verdict = 'harsh'; note = `${PENALTIES[v.penalty].name} – zu hart (${fine}: ${expectedText(t)})`; }
  if (v.points < t.points[0] || v.points > t.points[1]) {
    note += ` · Strafpunkte ${v.points}, üblich: ${t.points[0] === t.points[1] ? t.points[0] : `${t.points[0]}–${t.points[1]}`}`;
  }
  return { verdict, note };
}

// Bilanz der Kommissare für den Rennbericht
export function stewardReport(race) {
  const items = race.cases.map(c => ({ c, ...evaluateCase(race, c) }));
  // Konsistenz: gleichartige Fälle mit gleicher Einstufung unterschiedlich bestraft?
  const groups = new Map();
  for (const it of items) {
    const v = it.c.verdict;
    if (!v || !it.c.truth.offender || v.carId !== it.c.truth.offender) continue;
    const key = `${it.c.type}|${it.c.truth.expected.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const inconsistent = [];
  for (const list of groups.values()) {
    const sevs = new Set(list.map(it => PENALTIES[it.c.verdict.penalty].sev));
    if (list.length > 1 && sevs.size > 1) inconsistent.push(list.map(it => `#${it.c.id}`).join(', '));
  }
  const count = v => items.filter(i => i.verdict === v).length;
  return {
    items,
    total: items.length,
    ok: count('ok'), lenient: count('lenient'), harsh: count('harsh'), wrong: count('wrong'), open: count('open'),
    pending: count('pending'),
    inconsistent,
  };
}
