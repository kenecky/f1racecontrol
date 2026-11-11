// Teams der Saison 2026.
// Werte 0–100 sind Schätzungen und können frei angepasst werden.
//   pace        – Grundgeschwindigkeit des Autos
//   reliability – Zuverlässigkeit (wird ab späteren Meilensteinen genutzt)
//   pitCrew     – Qualität der Boxencrew (beeinflusst Standzeit)
export const TEAMS = [
  { id: 'mercedes',    name: 'Mercedes',        short: 'MER', color: '#27F4D2', pace: 96, reliability: 90, pitCrew: 90 },
  { id: 'ferrari',     name: 'Ferrari',         short: 'FER', color: '#E8002D', pace: 92, reliability: 86, pitCrew: 92 },
  { id: 'mclaren',     name: 'McLaren',         short: 'MCL', color: '#FF8000', pace: 91, reliability: 90, pitCrew: 94 },
  { id: 'redbull',     name: 'Red Bull Racing', short: 'RBR', color: '#3671C6', pace: 89, reliability: 82, pitCrew: 96 },
  { id: 'alpine',      name: 'Alpine',          short: 'ALP', color: '#0093CC', pace: 82, reliability: 84, pitCrew: 82 },
  { id: 'haas',        name: 'Haas',            short: 'HAA', color: '#9C9FA2', pace: 82, reliability: 84, pitCrew: 80 },
  { id: 'racingbulls', name: 'Racing Bulls',    short: 'RB',  color: '#6692FF', pace: 81, reliability: 82, pitCrew: 86 },
  { id: 'williams',    name: 'Williams',        short: 'WIL', color: '#64C4FF', pace: 80, reliability: 84, pitCrew: 85 },
  { id: 'audi',        name: 'Audi',            short: 'AUD', color: '#B0122E', pace: 81, reliability: 80, pitCrew: 80 },
  { id: 'astonmartin', name: 'Aston Martin',    short: 'AST', color: '#229971', pace: 69, reliability: 76, pitCrew: 84 },
  { id: 'cadillac',    name: 'Cadillac',        short: 'CAD', color: '#F2F2F2', pace: 66, reliability: 78, pitCrew: 78 },
];

export const TEAM_BY_ID = Object.fromEntries(TEAMS.map(t => [t.id, t]));
