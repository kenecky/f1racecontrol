// Rennkommissare: Fälle untersuchen, Urteile fällen, Strafen anwenden, Urteile bewerten.
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
};

export function openCases(race) {
  return race.cases.filter(c => c.status === 'new' || c.status === 'investigating' || c.status === 'post');
}

export function investigate(race, c) {
  if (c.status !== 'new') return;
  c.status = 'investigating';
  race.emit('rc', `Fall #${c.id} wird untersucht: ${c.title}`);
}

export function postpone(race, c) {
  if (c.status !== 'new' && c.status !== 'investigating') return;
  c.status = 'post';
  race.emit('rc', `Fall #${c.id} wird nach dem Rennen untersucht: ${c.title}`);
}

export function noFurtherAction(race, c) {
  if (c.status === 'decided' || c.status === 'nfa') return;
  c.status = 'nfa';
  c.verdict = { carId: null, penalty: 'none', points: 0, time: race.time };
  race.emit('rc', `Fall #${c.id}: Keine weitere Untersuchung – ${c.title}`);
  reactToVerdict(race, c);
}

// Teams reagieren per Funk auf Urteile (nicht immer sachlich)
function reactToVerdict(race, c) {
  const r = race.rng;
  const v = c.verdict, t = c.truth;
  const { verdict } = evaluateCase(race, c);
  const team = id => race.carById[id].team.name;
  if (v.carId) {
    const furious = verdict === 'wrong' || (verdict === 'harsh' && !t.offender) || r.chance(0.2);
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
  if (!carId || penalty === 'none') {
    c.status = 'decided';
    c.verdict = { carId: null, penalty: 'none', points: 0, time: race.time };
    race.emit('rc', `Fall #${c.id}: Keine Strafe – ${c.title}`);
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
}

function applyPenalty(race, car, penalty, c) {
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
        car.giveBack = { target: victim.id, until: race.time + 120, voluntary: false, caseId: c.id };
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
    inconsistent,
  };
}
