// Fahrer der Saison 2026.
// Werte 0–100 sind Schätzungen und können frei angepasst werden.
//   pace        – reine Geschwindigkeit
//   consistency – wie gleichmäßig die Rundenzeiten sind
//   aggression  – Bereitschaft zu riskanten Manövern (Überholen, Verteidigen)
//   wet         – Können im Regen (ab Wetter-Meilenstein)
//   errors      – Neigung zu Fehlern (ab Vorfall-Meilenstein)
export const DRIVERS = [
  { id: 'NOR', number: 1,  first: 'Lando',    last: 'Norris',     team: 'mclaren',     pace: 95, consistency: 90, aggression: 66, wet: 90, errors: 22 },
  { id: 'PIA', number: 81, first: 'Oscar',    last: 'Piastri',    team: 'mclaren',     pace: 93, consistency: 91, aggression: 64, wet: 84, errors: 20 },
  { id: 'LEC', number: 16, first: 'Charles',  last: 'Leclerc',    team: 'ferrari',     pace: 94, consistency: 87, aggression: 72, wet: 86, errors: 28 },
  { id: 'HAM', number: 44, first: 'Lewis',    last: 'Hamilton',   team: 'ferrari',     pace: 91, consistency: 90, aggression: 65, wet: 95, errors: 18 },
  { id: 'VER', number: 3,  first: 'Max',      last: 'Verstappen', team: 'redbull',     pace: 98, consistency: 95, aggression: 85, wet: 98, errors: 15 },
  { id: 'HAD', number: 6,  first: 'Isack',    last: 'Hadjar',     team: 'redbull',     pace: 86, consistency: 82, aggression: 70, wet: 80, errors: 32 },
  { id: 'RUS', number: 63, first: 'George',   last: 'Russell',    team: 'mercedes',    pace: 94, consistency: 92, aggression: 68, wet: 88, errors: 18 },
  { id: 'ANT', number: 12, first: 'Kimi',     last: 'Antonelli',  team: 'mercedes',    pace: 91, consistency: 82, aggression: 70, wet: 82, errors: 34 },
  { id: 'ALO', number: 14, first: 'Fernando', last: 'Alonso',     team: 'astonmartin', pace: 90, consistency: 94, aggression: 80, wet: 92, errors: 14 },
  { id: 'STR', number: 18, first: 'Lance',    last: 'Stroll',     team: 'astonmartin', pace: 80, consistency: 78, aggression: 62, wet: 84, errors: 38 },
  { id: 'GAS', number: 10, first: 'Pierre',   last: 'Gasly',      team: 'alpine',      pace: 87, consistency: 87, aggression: 66, wet: 86, errors: 22 },
  { id: 'COL', number: 43, first: 'Franco',   last: 'Colapinto',  team: 'alpine',      pace: 81, consistency: 76, aggression: 72, wet: 76, errors: 42 },
  { id: 'ALB', number: 23, first: 'Alexander',last: 'Albon',      team: 'williams',    pace: 87, consistency: 88, aggression: 62, wet: 84, errors: 22 },
  { id: 'SAI', number: 55, first: 'Carlos',   last: 'Sainz',      team: 'williams',    pace: 89, consistency: 90, aggression: 70, wet: 86, errors: 20 },
  { id: 'LAW', number: 30, first: 'Liam',     last: 'Lawson',     team: 'racingbulls', pace: 83, consistency: 80, aggression: 82, wet: 80, errors: 36 },
  { id: 'LIN', number: 41, first: 'Arvid',    last: 'Lindblad',   team: 'racingbulls', pace: 80, consistency: 76, aggression: 74, wet: 76, errors: 40 },
  { id: 'OCO', number: 31, first: 'Esteban',  last: 'Ocon',       team: 'haas',        pace: 85, consistency: 85, aggression: 78, wet: 84, errors: 28 },
  { id: 'BEA', number: 87, first: 'Oliver',   last: 'Bearman',    team: 'haas',        pace: 85, consistency: 82, aggression: 72, wet: 80, errors: 30 },
  { id: 'HUL', number: 27, first: 'Nico',     last: 'Hülkenberg', team: 'audi',        pace: 85, consistency: 89, aggression: 64, wet: 86, errors: 20 },
  { id: 'BOR', number: 5,  first: 'Gabriel',  last: 'Bortoleto',  team: 'audi',        pace: 84, consistency: 82, aggression: 66, wet: 80, errors: 30 },
  { id: 'PER', number: 11, first: 'Sergio',   last: 'Pérez',      team: 'cadillac',    pace: 85, consistency: 82, aggression: 72, wet: 82, errors: 30 },
  { id: 'BOT', number: 77, first: 'Valtteri', last: 'Bottas',     team: 'cadillac',    pace: 84, consistency: 88, aggression: 58, wet: 82, errors: 22 },
];
