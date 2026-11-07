// Rennleitung: Flaggen in den Marshal-Sektoren setzen und auswerten.
export const FLAGS = {
  clear:    { id: 'clear',    name: 'Grün',        short: 'G',  rc: 'Grün – Sektor frei' },
  yellow:   { id: 'yellow',   name: 'Gelb',        short: 'Y',  rc: 'Gelbe Flagge' },
  double:   { id: 'double',   name: 'Doppelt Gelb', short: 'YY', rc: 'Doppelt Gelb' },
  slippery: { id: 'slippery', name: 'Gelb-Rot',    short: 'YR', rc: 'Gelb-Rot gestreift (rutschig)' },
};

export function setSectorFlag(race, sectorIdx, flag) {
  if (race.flags[sectorIdx] === flag) return;
  race.flags[sectorIdx] = flag;
  race.flagLog.push({ t: race.time, sector: sectorIdx, flag });
  race.emit('rc', `Rennleitung: ${FLAGS[flag].rc} in Sektor ${sectorIdx + 1}`, { sector: sectorIdx });
}

export function clearAllFlags(race) {
  race.flags.forEach((f, i) => { if (f !== 'clear') setSectorFlag(race, i, 'clear'); });
}

// Höchste Flagge auf der Strecke (für die Statusanzeige)
export function trackStatus(race) {
  if (race.flags.includes('double')) return 'double';
  if (race.flags.includes('yellow')) return 'yellow';
  if (race.flags.includes('slippery')) return 'slippery';
  return 'clear';
}

const LATE = 20; // Sekunden: bis dahin gilt die Reaktion als rechtzeitig

// Bilanz der Flaggen-Entscheidungen für den Rennbericht
export function flagReport(race) {
  // Kurze Dreher, nach denen das Auto weiterfährt, müssen nicht zwingend abgesichert werden
  const spins = race.hazards.filter(h => h.type === 'spin');
  const items = race.hazards.filter(h => h.type !== 'spin').map(h => {
    let verdict, note;
    if (h.adequateAt === null) {
      verdict = 'missed';
      note = h.firstFlagAt === null ? 'nicht abgesichert' : 'Flagge nicht ausreichend';
    } else {
      const rt = h.adequateAt - h.start;
      verdict = rt <= LATE ? 'ok' : 'late';
      note = `${rt <= LATE ? 'Reaktion' : 'zu spät'} nach ${Math.round(rt)} s`;
    }
    if (h.overflag) note += ', Doppelt Gelb war nicht nötig';
    return { h, verdict, note };
  });
  const reacted = items.filter(i => i.h.adequateAt !== null);
  const avgReaction = reacted.length
    ? reacted.reduce((s, i) => s + (i.h.adequateAt - i.h.start), 0) / reacted.length
    : null;
  return {
    items,
    spins: spins.length,
    total: items.length,
    ok: items.filter(i => i.verdict === 'ok').length,
    late: items.filter(i => i.verdict === 'late').length,
    missed: items.filter(i => i.verdict === 'missed').length,
    avgReaction,
    idleFlagTime: race.idleFlagTime,
  };
}
