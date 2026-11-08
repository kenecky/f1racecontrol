// Saisonmodus: Kalender, Rennwochenenden (Training, Qualifying, Sprint, Rennen), WM-Wertung,
// Strafpunkte (gelten 12 Monate), Verwarnungen, Startplatzstrafen, Sperren.
import { SEASON_2026 } from '../data/season2026.js';
import { TRACKS } from '../data/tracks/index.js';

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

function applyRace(season, race, rating, notes) {
  const wk = season.weekend;
  const entry = currentRound(season);
  const st = race.standings();
  const classified = st.filter(c => c.finished && !c.dsq);
  const pts = {};
  classified.forEach((c, i) => {
    const p = POINTS[i] || 0;
    if (!p) return;
    pts[c.id] = p;
    season.driverPts[c.id] = (season.driverPts[c.id] || 0) + p;
    season.teamPts[c.team.id] = (season.teamPts[c.team.id] || 0) + p;
  });
  const next = {};
  for (const g of race.carryOver || []) next[g.carId] = (next[g.carId] || 0) + g.places;
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
