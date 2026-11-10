// Saisonmodus: Kalender, Rennwochenenden (Training, Qualifying, Sprint, Rennen), WM-Wertung,
// Strafpunkte (gelten 12 Monate), Verwarnungen, Startplatzstrafen, Sperren.
import { SEASON_2026 } from '../data/season2026.js';
import { TRACKS } from '../data/tracks/index.js';
import { createRng } from '../util/rng.js';
import { evaluateCase, PENALTIES } from '../control/stewards.js';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];
export const BAN_POINTS = 12;      // Strafpunkte (innerhalb von 12 Monaten) bis zur Rennsperre
export const WARNINGS_LIMIT = 5;   // Verwarnungen bis zur Startplatzstrafe
export const WARNINGS_GRID = 10;   // Plätze bei Erreichen des Limits
// Sprint-Wochenenden 2026 (laut veröffentlichtem Kalender; anpassbar)
export const SPRINT_TRACKS = ['shanghai', 'miami', 'montreal', 'silverstone', 'zandvoort', 'singapore'];
export const KIND_NAME = { fp: 'Freies Training', sq: 'Sprint-Qualifying', sprint: 'Sprint', quali: 'Qualifying', race: 'Rennen' };
export const KIND_SHORT = { fp: 'FP', sq: 'SQ', sprint: 'Sprint', quali: 'Q', race: 'Rennen' };

export function newSeason(prev = null) {
  return {
    version: 2,
    year: prev ? prev.year + 1 : 2026,
    round: 0, results: [], weekend: null,
    driverPts: {}, teamPts: {},
    penaltyLog: prev ? prev.penaltyLog || [] : [],   // { id, pts, date, used } – gelten 12 Monate
    warnings: {},
    gridPenalties: prev ? prev.gridPenalties || {} : {},
    bans: {},
  };
}

// alte Saisonstände (Version 1) auf das neue Format bringen
export function migrateSeason(s) {
  if (!s) return null;
  if (!s.penaltyLog) {
    s.penaltyLog = Object.entries(s.penaltyPoints || {}).filter(([, p]) => p > 0)
      .map(([id, pts]) => ({ id, pts, date: `${s.year}-01-01`, used: 0 }));
    delete s.penaltyPoints;
  }
  if (s.weekend === undefined) s.weekend = null;
  s.version = 2;
  return s;
}

export function currentRound(season) {
  return SEASON_2026[season.round] || null;
}

export function roundTrack(entry) {
  return TRACKS[entry.track];
}

export function roundDate(season, entry) {
  return `${season.year}${entry.date.slice(4)}`;
}

// ---------- Strafpunkte (12 Monate gültig) ----------

export function activePoints(season, id, refDate) {
  const ref = new Date(refDate).getTime();
  return season.penaltyLog
    .filter(e => e.id === id && ref - new Date(e.date).getTime() < 365 * 86400000)
    .reduce((s, e) => s + e.pts - (e.used || 0), 0);
}

function addPenaltyPoints(season, race, date, notes) {
  for (const [id, p] of Object.entries(race.penaltyPoints || {})) {
    if (!p) continue;
    season.penaltyLog.push({ id, pts: p, date, used: 0 });
    if (activePoints(season, id, date) >= BAN_POINTS) {
      // 12 Punkte werden nach der Sperre gelöscht (älteste zuerst)
      let left = BAN_POINTS;
      for (const e of season.penaltyLog.filter(x => x.id === id).sort((a, b) => a.date.localeCompare(b.date))) {
        const take = Math.min(left, e.pts - (e.used || 0));
        e.used = (e.used || 0) + take;
        left -= take;
        if (!left) break;
      }
      season.bans[id] = season.round + 1;
      notes.push(`${id} erreicht ${BAN_POINTS} Strafpunkte und ist für das nächste Rennwochenende gesperrt.`);
    }
  }
}

function countWarnings(season, race, next, notes) {
  for (const c of race.cases) {
    const v = c.verdict;
    if (!v || !v.carId || (v.penalty !== 'warning' && v.penalty !== 'bw')) continue;
    season.warnings[v.carId] = (season.warnings[v.carId] || 0) + 1;
    if (season.warnings[v.carId] >= WARNINGS_LIMIT) {
      season.warnings[v.carId] -= WARNINGS_LIMIT;
      next[v.carId] = (next[v.carId] || 0) + WARNINGS_GRID;
      notes.push(`${v.carId}: ${WARNINGS_LIMIT}. Verwarnung der Saison – ${WARNINGS_GRID} Startplätze Strafe.`);
    }
  }
}

// ---------- Rennwochenende ----------

export function weekendSessions(trackId) {
  return SPRINT_TRACKS.includes(trackId) ? ['fp', 'sq', 'sprint', 'quali', 'race'] : ['fp', 'quali', 'race'];
}

export function currentWeekend(season) {
  const e = currentRound(season);
  if (!e) return null;
  if (!season.weekend || season.weekend.round !== season.round) {
    season.weekend = {
      round: season.round, idx: 0, sessions: weekendSessions(e.track),
      sprintGrid: null, raceGrid: null, pending: { sprint: {}, race: {} }, ratings: [],
    };
  }
  return season.weekend;
}

// Vorgaben für die nächste Session
export function sessionSetup(season) {
  const wk = currentWeekend(season);
  const entry = currentRound(season);
  const kind = wk.sessions[wk.idx];
  const excluded = Object.entries(season.bans).filter(([, r]) => r === season.round).map(([id]) => id);
  const track = roundTrack(entry);
  let gridPenalties = {}, gridOrder = null, laps = null;
  if (kind === 'sprint') {
    gridPenalties = { ...wk.pending.sprint };
    gridOrder = wk.sprintGrid;
    laps = Math.ceil(100000 / track.lengthM);
  } else if (kind === 'race') {
    gridPenalties = { ...season.gridPenalties };
    for (const [id, p] of Object.entries(wk.pending.race)) gridPenalties[id] = (gridPenalties[id] || 0) + p;
    gridOrder = wk.raceGrid;
  }
  return { kind, gridPenalties, gridOrder, laps, excluded, entry };
}

// Session abgeschlossen → Ergebnis übernehmen; gibt Hinweise zurück
export function finishSession(season, race, rating) {
  const wk = currentWeekend(season);
  const entry = currentRound(season);
  const kind = wk.sessions[wk.idx];
  const notes = [];
  const date = roundDate(season, entry);
  wk.ratings.push({ kind, total: rating ? rating.total : null, stars: rating ? rating.stars : null });
  recordFiles(season, race, entry, kind);

  if (kind === 'race') return applyRace(season, race, rating, notes);

  // Startplatzstrafen aus Training/Qualifying/Sprint → nächstes Rennen dieses Wochenendes
  const target = wk.sessions.slice(wk.idx + 1).find(k => k === 'sprint' || k === 'race') || 'race';
  for (const g of race.carryOver || []) {
    wk.pending[target][g.carId] = (wk.pending[target][g.carId] || 0) + g.places;
    notes.push(`${g.carId}: Startplatzstrafe ${g.places} Plätze für ${target === 'sprint' ? 'den Sprint' : 'das Rennen'}.`);
  }
  countWarnings(season, race, wk.pending[target], notes);
  addPenaltyPoints(season, race, date, notes);

  if (kind === 'quali') wk.raceGrid = race.resultOrder();
  if (kind === 'sq') wk.sprintGrid = race.resultOrder();
  if (kind === 'sprint') {
    const classified = race.standings().filter(c => c.finished && !c.dsq);
    classified.slice(0, SPRINT_POINTS.length).forEach((c, i) => {
      season.driverPts[c.id] = (season.driverPts[c.id] || 0) + SPRINT_POINTS[i];
      season.teamPts[c.team.id] = (season.teamPts[c.team.id] || 0) + SPRINT_POINTS[i];
    });
    wk.sprintResult = classified.map(c => c.id);
    notes.push(`Sprint-Punkte vergeben (8-7-6-5-4-3-2-1). Sieger: ${classified[0] ? classified[0].id : '–'}.`);
  }
  wk.idx++;
  return notes;
}

// Fahrerakte und Präzedenzfälle der Saison
function recordFiles(season, race, entry, kind) {
  season.file = season.file || {};
  season.precedents = season.precedents || [];
  const gp = TRACKS[entry.track] ? TRACKS[entry.track].grandPrix.replace('Großer Preis von ', 'GP ') : entry.track;
  const where = `${gp}, ${KIND_SHORT[kind]}`;
  for (const c of race.cases) {
    const v = c.verdict;
    if (!v || v.revoked || !['decided', 'nfa'].includes(c.status) || c.type === 'protest') continue;
    if (c.type !== 'tech' && c.type !== 'tlLap') {
      season.precedents.unshift({ type: c.type, carId: v.carId, penalty: v.penalty, points: v.points || 0, status: c.status, where });
    }
    if (v.carId && v.penalty !== 'none') {
      const list = season.file[v.carId] = season.file[v.carId] || [];
      list.unshift({ what: c.typeName, pen: PENALTIES[v.penalty] ? PENALTIES[v.penalty].name : v.penalty, points: v.points || 0, where });
      if (list.length > 12) list.length = 12;
    }
  }
  if (season.precedents.length > 150) season.precedents.length = 150;
}

// Ruf der Rennleitung bei den Teams (−100 … +100): faire Urteile schaffen Vertrauen,
// zu harte oder falsche Urteile verärgern das bestrafte Team, zu milde das benachteiligte.
export function updateReputation(season, race, rating, notes) {
  season.rep = season.rep || {};
  const add = (teamId, v) => { season.rep[teamId] = Math.max(-100, Math.min(100, (season.rep[teamId] || 0) + v)); };
  for (const c of race.cases) {
    if (!c.truth || !c.verdict) continue;
    const { verdict } = evaluateCase(race, c);
    const v = c.verdict, t = c.truth;
    const team = id => id && race.carById[id] ? race.carById[id].team.id : null;
    if (verdict === 'ok') for (const id of c.cars) add(team(id), 1);
    if ((verdict === 'harsh' || verdict === 'wrong') && v.carId) add(team(v.carId), -6);
    if ((verdict === 'lenient' || verdict === 'wrong') && t.victim) add(team(t.victim), -4);
  }
  // Revidierte Urteile kosten Glaubwürdigkeit bei allen Teams
  for (let i = 0; i < (race.revisions || 0); i++) for (const t of new Set(race.cars.map(c => c.team.id))) add(t, -1.5);
  if (race.revisions) notes.push(`Ruf: ${race.revisions} revidierte${race.revisions > 1 ? '' : 's'} Urteil${race.revisions > 1 ? 'e' : ''} – die Teams zweifeln an der Linie der Rennleitung.`);
  if (rating && rating.total >= 85) for (const c of race.cars) add(c.team.id, 0.5);
  if (rating && rating.total < 50) for (const c of race.cars) add(c.team.id, -1);
  delete season.rep.null;
  const worst = Object.entries(season.rep).sort((a, b) => a[1] - b[1])[0];
  if (worst && worst[1] <= -25) notes.push(`Ruf: Das Team ${worst[0]} ist mit der Rennleitung sehr unzufrieden (${Math.round(worst[1])}).`);
}

// ---------- Berufungsgericht (nur Saison) ----------
// Teams können gegen schwere Strafen Berufung einlegen. Das Gericht entscheidet zwei Rennen später:
// Falsche oder zu harte Urteile werden gekippt (Punkte und Strafpunkte werden korrigiert, Glaubwürdigkeit leidet).
export const APPEAL_DELAY = 2;
const APPEALABLE = new Set(['10s', 'dt', 'sg', 'dsq', 'grid5', 'grid10', 'pitstart']);

function pointsWithout(race, car, table, secs) {
  // Platz, den das Auto ohne die Strafe erreicht hätte (nur wenn es im Ziel war)
  if (!car.finished) return null;
  const mine = race.adjustedFinish(car) - secs;
  const ahead = race.cars.filter(o => o !== car && o.finished && !o.dsq
    && (o.lap > car.lap || (o.lap === car.lap && race.adjustedFinish(o) < mine))).length;
  return table[ahead] || 0;
}

function fileAppeals(season, race, table, notes) {
  season.appeals = season.appeals || [];
  const r = createRng((season.year * 1000 + season.round) * 13 + 5);
  const gp = TRACKS[race.track.def.id] ? race.track.def.grandPrix.replace('Großer Preis von ', 'GP ') : '';
  let filed = 0;
  for (const c of race.cases) {
    if (filed >= 2) break;   // höchstens zwei Berufungen je Rennen
    const v = c.verdict;
    if (!v || !v.carId || v.revoked || c.status !== 'decided' || !APPEALABLE.has(v.penalty) || ['protest', 'tlLap'].includes(c.type)) continue;
    const { verdict } = evaluateCase(race, c);
    const p = verdict === 'wrong' ? 0.75 : verdict === 'harsh' ? 0.5 : 0.06;
    if (!r.chance(p)) continue;
    filed++;
    const car = race.carById[v.carId];
    const secs = car.timePens.filter(x => x.caseId === c.id).reduce((a, x) => a + x.secs, 0);
    const now = car.dsq || !car.finished ? 0 : pointsWithout(race, car, table, 0);
    const alt = v.penalty === 'dsq' ? pointsWithout(race, car, table, 0) : secs ? pointsWithout(race, car, table, secs) : null;
    season.appeals.push({
      carId: car.id, team: car.team.id, teamName: car.team.name, title: c.title, penalty: PENALTIES[v.penalty].name,
      points: v.points || 0, where: gp, filed: season.round, due: season.round + APPEAL_DELAY,
      overturn: verdict === 'wrong' || verdict === 'harsh', ptsGain: alt !== null ? Math.max(0, alt - (now || 0)) : 0, done: false,
    });
    notes.push(`Berufung: ${car.team.name} geht gegen „${PENALTIES[v.penalty].name}“ für ${car.id} (${c.typeName}) vor das Berufungsgericht – Entscheidung in ${APPEAL_DELAY} Rennen.`);
  }
}

function resolveAppeals(season, notes) {
  season.rep = season.rep || {};
  const add = (teamId, v) => { season.rep[teamId] = Math.max(-100, Math.min(100, (season.rep[teamId] || 0) + v)); };
  for (const a of season.appeals || []) {
    if (a.done || season.round < a.due) continue;
    a.done = true;
    if (!a.overturn) {
      add(a.team, -1);
      notes.push(`Berufungsgericht: Die Berufung von ${a.teamName} (${a.where}, ${a.carId}) wird abgewiesen – das Urteil der Rennleitung bleibt bestehen.`);
      continue;
    }
    if (a.ptsGain) {
      season.driverPts[a.carId] = (season.driverPts[a.carId] || 0) + a.ptsGain;
      season.teamPts[a.team] = (season.teamPts[a.team] || 0) + a.ptsGain;
      const res = season.results.find(x => x.round === a.filed + 1);
      const row = res && res.classification.find(x => x.id === a.carId);
      if (row) { row.pts += a.ptsGain; row.appeal = true; }
    }
    // Strafpunkte aus dem Urteil zurücknehmen (jüngster passender Eintrag)
    let left = a.points;
    for (const e of [...season.penaltyLog].reverse()) {
      if (!left || e.id !== a.carId) continue;
      const take = Math.min(left, e.pts - (e.used || 0));
      e.pts -= take;
      left -= take;
    }
    add(a.team, 4);
    for (const t of new Set([...Object.keys(season.teamPts), ...Object.keys(season.rep)])) if (t !== a.team) add(t, -0.5);
    notes.push(`Berufungsgericht: Das Urteil gegen ${a.carId} (${a.where}: ${a.penalty}) wird aufgehoben${a.ptsGain ? ` – ${a.carId} erhält ${a.ptsGain} WM-Punkt${a.ptsGain > 1 ? 'e' : ''} zurück` : ''}${a.points ? `, ${a.points} Strafpunkt${a.points > 1 ? 'e' : ''} gestrichen` : ''}. Ein Rückschlag für die Glaubwürdigkeit der Rennleitung.`);
  }
}

// Antriebseinheiten: 4 pro Saison. Jede weitere bringt Startplatzstrafen (erste 10, danach 5 Plätze).
export const PU_LIMIT = 4;
function powerUnits(season, race, next, notes) {
  season.pu = season.pu || {};
  const r = createRng((season.year * 1000 + season.round) * 7 + 3);
  for (const c of race.cars) {
    const failed = c.dnf && /Defekt|Motor/.test(c.dnf);
    if (!failed && !r.chance(0.07)) continue;
    const n = (season.pu[c.id] = (season.pu[c.id] || 1) + 1);
    if (n <= PU_LIMIT) { notes.push(`${c.id}: neue Antriebseinheit (${n}/${PU_LIMIT}).`); continue; }
    const places = n === PU_LIMIT + 1 ? 10 : 5;
    next[c.id] = (next[c.id] || 0) + places;
    notes.push(`${c.id}: ${n}. Antriebseinheit – über dem Kontingent, ${places} Startplätze Strafe im nächsten Rennen.`);
  }
}

// Abgebrochene Rennen: Punkte nach gefahrener Distanz (Reglement seit 2022)
export function pointsTable(race) {
  const e = race.endedEarly;
  if (!e) return POINTS;
  if (e.laps < 2) return [];
  if (e.share <= 0.25) return [6, 4, 3, 2, 1];
  if (e.share <= 0.5) return [13, 10, 8, 6, 5, 4, 3, 2, 1];
  if (e.share <= 0.75) return [19, 14, 12, 9, 8, 6, 5, 3, 2, 1];
  return POINTS;
}

function applyRace(season, race, rating, notes) {
  const wk = season.weekend;
  const entry = currentRound(season);
  const st = race.standings();
  const classified = st.filter(c => c.finished && !c.dsq);
  const pts = {};
  const table = pointsTable(race);
  if (race.endedEarly) notes.push(`Rennen abgebrochen nach ${race.endedEarly.laps} Runden – ${table === POINTS ? 'volle Punkte' : table.length ? 'reduzierte Punkte' : 'keine Punkte'}.`);
  classified.forEach((c, i) => {
    const p = table[i] || 0;
    if (!p) return;
    pts[c.id] = p;
    season.driverPts[c.id] = (season.driverPts[c.id] || 0) + p;
    season.teamPts[c.team.id] = (season.teamPts[c.team.id] || 0) + p;
  });
  const next = {};
  for (const g of race.carryOver || []) next[g.carId] = (next[g.carId] || 0) + g.places;
  powerUnits(season, race, next, notes);
  updateReputation(season, race, rating, notes);
  resolveAppeals(season, notes);
  fileAppeals(season, race, table, notes);
  countWarnings(season, race, next, notes);
  addPenaltyPoints(season, race, roundDate(season, entry), notes);
  for (const [id, places] of Object.entries(next)) notes.push(`${id}: Startplatzstrafe ${places} Plätze im nächsten Rennen.`);

  const ratings = (wk ? wk.ratings : []).filter(r => r.total !== null);
  const avg = ratings.length ? Math.round(ratings.reduce((s, r) => s + r.total, 0) / ratings.length) : (rating ? rating.total : null);
  season.results.push({
    round: entry.round, track: entry.track,
    gp: roundTrack(entry).grandPrix,
    classification: st.map(c => ({
      id: c.id, team: c.team.id,
      pos: c.finished && !c.dsq ? classified.indexOf(c) + 1 : null,
      status: c.dsq ? 'DSQ' : c.retired ? 'DNF' : '',
      pts: pts[c.id] || 0,
    })),
    sprint: wk && wk.sprintResult ? wk.sprintResult.slice(0, 3) : null,
    rating: avg,
    stars: avg === null ? null : avg >= 90 ? 5 : avg >= 78 ? 4 : avg >= 64 ? 3 : avg >= 50 ? 2 : 1,
  });
  season.gridPenalties = next;
  season.round++;
  season.weekend = null;
  return notes;
}

export function driverStandings(season, drivers) {
  return drivers
    .map(d => ({ d, pts: season.driverPts[d.id] || 0, wins: season.results.filter(r => r.classification.find(x => x.id === d.id && x.pos === 1)).length }))
    .sort((a, b) => b.pts - a.pts || b.wins - a.wins);
}

export function teamStandings(season, teams) {
  return teams.map(t => ({ t, pts: season.teamPts[t.id] || 0 })).sort((a, b) => b.pts - a.pts);
}
