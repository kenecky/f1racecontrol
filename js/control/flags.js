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

import { NEED_LEVEL, NEED_LABEL } from '../sim/hazards.js';

// Sekunden: bis dahin gilt die Reaktion als rechtzeitig
const LATE = { yellow: 20, double: 20, vsc: 30, sc: 30, red: 45, pit: 30 };
const RESPONSE_LABEL = ['keine', 'Gelb', 'Doppelt Gelb', 'VSC', 'Safety Car', 'Rote Flagge'];

// Bilanz der Entscheidungen für den Rennbericht
export function flagReport(race) {
  // Kurze Dreher, nach denen das Auto weiterfährt, müssen nicht zwingend abgesichert werden
  const spins = race.hazards.filter(h => h.type === 'spin');
  // Wandernde Gefahr (langsames Auto): jeder Sektor zählt einzeln (sehr kurze Abschnitte ausgenommen)
  const expand = h => {
    if (!h.legs) return [h];
    const legs = h.legs.filter(l => (l.end ?? h.endTime ?? race.time) - l.start >= 4);
    if (!legs.length) return [h];
    return legs.map(l => ({ ...h, start: l.start, adequateAt: l.adequateAt, sector: l.sector, desc: `${h.desc} – Sektor ${l.sector + 1}`, weight: 1 / Math.sqrt(legs.length) }));
  };
  const items = race.hazards.filter(h => h.type !== 'spin').flatMap(expand).map(h => {
    let verdict, note;
    const need = NEED_LEVEL[h.need];
    if (h.adequateAt === null) {
      verdict = 'missed';
      note = h.legs ? 'Kein Gelb, während das langsame Auto in diesem Sektor war'
        : `Nötig: ${NEED_LABEL[h.need]} – deine höchste Reaktion: ${RESPONSE_LABEL[h.maxResponse]}`;
    } else {
      const rt = h.adequateAt - h.start;
      verdict = rt <= (LATE[h.need] ?? 30) ? 'ok' : 'late';
      note = `${verdict === 'ok' ? 'Reaktion' : 'zu spät'} nach ${Math.round(rt)} s (nötig: ${NEED_LABEL[h.need]})`;
    }
    if (h.maxResponse >= 3 && h.maxResponse - need >= 2) note += ` · ${RESPONSE_LABEL[h.maxResponse]} war überzogen`;
    else if (h.maxResponse === 2 && need === 1 && h.type !== 'debris') note += ' · Doppelt Gelb war nicht nötig';
    return { h, verdict, note, weight: h.weight ?? 1 };
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
    neutral: race.neutralStats,
  };
}
