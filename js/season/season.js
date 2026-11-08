// Saisonmodus: Kalender, WM-Wertung, Strafpunkte, Verwarnungen, Startplatzstrafen, Sperren.
import { SEASON_2026 } from '../data/season2026.js';
import { TRACKS } from '../data/tracks/index.js';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const BAN_POINTS = 12;      // Strafpunkte bis zur Rennsperre
export const WARNINGS_LIMIT = 5;   // Verwarnungen bis zur Startplatzstrafe
export const WARNINGS_GRID = 10;   // Plätze bei Erreichen des Limits

export function newSeason() {
  return {
    version: 1, year: 2026, round: 0, results: [],
    driverPts: {}, teamPts: {}, penaltyPoints: {}, warnings: {},
    gridPenalties: {},   // für das nächste Rennen: { fahrer: plätze }
    bans: {},            // { fahrer: rundenindex }
  };
}

export function currentRound(season) {
  return SEASON_2026[season.round] || null;
}

export function roundTrack(entry) {
  return TRACKS[entry.track];
}

// Vorgaben für das nächste Rennen
export function raceSetup(season) {
  const excluded = Object.entries(season.bans).filter(([, r]) => r === season.round).map(([id]) => id);
  return { gridPenalties: { ...season.gridPenalties }, excluded };
}

// Rennergebnis in die Saison übernehmen; gibt Hinweise für die Anzeige zurück
export function applyRace(season, race, rating) {
  const notes = [];
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

  // Startplatzstrafen fürs nächste Rennen
  const next = {};
  for (const g of race.carryOver || []) next[g.carId] = (next[g.carId] || 0) + g.places;

  // Verwarnungen
  for (const c of race.cases) {
    const v = c.verdict;
    if (!v || !v.carId || (v.penalty !== 'warning' && v.penalty !== 'bw')) continue;
    season.warnings[v.carId] = (season.warnings[v.carId] || 0) + 1;
    if (season.warnings[v.carId] >= WARNINGS_LIMIT) {
      season.warnings[v.carId] -= WARNINGS_LIMIT;
      next[v.carId] = (next[v.carId] || 0) + WARNINGS_GRID;
      notes.push(`${v.carId}: ${WARNINGS_LIMIT}. Verwarnung der Saison – ${WARNINGS_GRID} Startplätze Strafe im nächsten Rennen.`);
    }
  }

  // Strafpunkte → Sperre
  for (const [id, p] of Object.entries(race.penaltyPoints || {})) {
    if (!p) continue;
    season.penaltyPoints[id] = (season.penaltyPoints[id] || 0) + p;
    if (season.penaltyPoints[id] >= BAN_POINTS) {
      season.penaltyPoints[id] -= BAN_POINTS;
      season.bans[id] = season.round + 1;
      notes.push(`${id} erreicht ${BAN_POINTS} Strafpunkte und ist für das nächste Rennen gesperrt.`);
    }
  }
  for (const [id, places] of Object.entries(next)) notes.push(`${id}: Startplatzstrafe ${places} Plätze im nächsten Rennen.`);

  season.results.push({
    round: entry.round, track: entry.track,
    gp: roundTrack(entry).grandPrix,
    classification: st.map(c => ({
      id: c.id, team: c.team.id,
      pos: c.finished && !c.dsq ? classified.indexOf(c) + 1 : null,
      status: c.dsq ? 'DSQ' : c.retired ? 'DNF' : '',
      pts: pts[c.id] || 0,
    })),
    rating: rating ? rating.total : null,
    stars: rating ? rating.stars : null,
  });
  season.gridPenalties = next;
  season.round++;
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
