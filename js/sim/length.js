// Spieldauer: Renndistanz und Session-Längen (Einstellung „Dauer“).
// Kürzere Rennen verschleißen die Reifen entsprechend schneller, damit die
// Strategien (Boxenstopps, Reifenwahl) gleich bleiben.
export const LENGTHS = {
  short:  { name: 'Kurz',   hint: '¼ Renndistanz, kurze Sessions',   race: 0.25, sprint: 0.5,  fp: 480,  quali: [300, 240, 180], sq: [240, 210, 180], brk: 45 },
  medium: { name: 'Mittel', hint: '½ Renndistanz, mittlere Sessions', race: 0.5,  sprint: 0.75, fp: 720,  quali: [420, 360, 300], sq: [300, 270, 240], brk: 60 },
  full:   { name: 'Lang',   hint: 'volle Renndistanz',               race: 1,    sprint: 1,    fp: 1200, quali: [600, 480, 420], sq: [420, 360, 300], brk: 120 },
};

export function lengthOf(id) {
  return LENGTHS[id] || LENGTHS.medium;
}

// Rundenzahl für Rennen und Sprint; full = Rundenzahl der vollen Distanz
export function distanceFor(track, kind, lengthId) {
  const len = lengthOf(lengthId);
  if (kind === 'sprint') {
    const full = Math.ceil(100000 / track.def.lengthM);
    return { laps: Math.max(5, Math.round(full * len.sprint)), full };
  }
  return { laps: Math.max(8, Math.round(track.laps * len.race)), full: track.laps };
}

// Dauer der Abschnitte (Sekunden) für Training/Qualifying
export function sessionDurations(kind, lengthId) {
  const len = lengthOf(lengthId);
  return { segs: kind === 'fp' ? [len.fp] : len[kind], brk: len.brk };
}
