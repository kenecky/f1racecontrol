// Rennen speichern und wiederherstellen (Spielstand).
import { Race } from './race.js';

const VERSION = 1;
// Laufzeit-Strukturen, die beim Laden neu aufgebaut werden
const SKIP = new Set(['track', 'rng', 'cars', 'carById', 'physGap', 'behindSC']);

export function serializeRace(race) {
  const data = { version: VERSION, trackId: race.track.def.id, rngState: race.rng.getState() };
  for (const [k, v] of Object.entries(race)) if (!SKIP.has(k)) data[k] = v;
  data.cars = race.cars.map(c => ({
    ...c,
    driver: c.driver.id,
    team: c.team.id,
    tried: [...c.tried],
    usedCompounds: [...c.usedCompounds],
  }));
  // Tiefe Kopie als reine Daten (Infinity bleibt erhalten)
  return JSON.parse(JSON.stringify(data, (k, v) => (v === Infinity ? '__INF__' : v)),
    (k, v) => (v === '__INF__' ? Infinity : v));
}

export function restoreRace({ track, teams, drivers, data }) {
  if (!data || data.version !== VERSION || data.trackId !== track.def.id) return null;
  const race = new Race({ track, teams, drivers, seed: data.seed });
  const { cars, rngState, version, trackId, ...rest } = data;
  Object.assign(race, rest);
  race.rng.setState(rngState);
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
  const driverById = Object.fromEntries(drivers.map(d => [d.id, d]));
  race.cars = cars.map(c => ({
    ...c,
    driver: driverById[c.driver],
    team: teamById[c.team],
    tried: new Set(c.tried),
    usedCompounds: new Set(c.usedCompounds),
  }));
  race.carById = Object.fromEntries(race.cars.map(c => [c.id, c]));
  race.physGap = new Map();
  race.behindSC = new Set();
  return race;
}
