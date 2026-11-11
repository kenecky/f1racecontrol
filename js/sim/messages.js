// Mitteilungen der Rennleitung an alle Teams (Race Control Messages).
// Eine Warnung wirkt eine Zeit lang: Fahrer halten sich etwas besser an die Regeln.
// Zu viele Mitteilungen ohne Anlass verlieren ihre Wirkung.

export const MESSAGES = {
  yellow:  { name: 'RESPECT YELLOW FLAGS', text: 'Alle Fahrer werden daran erinnert, unter gelben Flaggen deutlich zu verlangsamen.', dur: 600 },
  blue:    { name: 'RESPECT BLUE FLAGS', text: 'Überrundete Fahrer müssen bei blauer Flagge sofort Platz machen.', dur: 600 },
  driving: { name: 'DRIVING STANDARDS', text: 'Mehrfache Richtungswechsel und Bremsmanöver auf der Geraden werden streng bestraft.', dur: 600 },
  pit:     { name: 'PIT LANE SPEED LIMIT', text: 'Teams werden an das Tempolimit von 80 km/h und die Linie an der Boxenausfahrt erinnert.', dur: 900 },
  tl:      { name: 'TRACK LIMITS', text: 'Track Limits werden ab sofort in dieser Kurve überwacht.', dur: Infinity },
};

const COOLDOWN = 120;   // Sekunden bis zur nächsten Mitteilung derselben Art

export function msgState(race) {
  if (!race.rcMsgs) race.rcMsgs = { until: {}, sent: [] };
  return race.rcMsgs;
}

export function canSend(race, key) {
  if (race.phase !== 'running' && !(race.preStart && race.phase !== 'pre')) return false;
  const s = msgState(race);
  const last = [...s.sent].reverse().find(m => m.key === key);
  return !last || race.time - last.time >= COOLDOWN || key === 'tl';
}

// Mitteilung senden; arg = Kurve bei Track Limits
export function sendMessage(race, key, arg = null) {
  const m = MESSAGES[key];
  if (!m || !canSend(race, key)) return false;
  const s = msgState(race);
  if (key === 'tl') {
    const b = race.briefing;
    if (!b || !arg) return false;
    b.tlCorners = b.tlCorners || [];
    if (b.tlCorners.includes(arg)) return false;
    b.tlCorners.push(arg);
    race.emit('rc', `RACE CONTROL MESSAGE an alle Teams: TRACK LIMITS – ${arg} wird ab sofort überwacht.`);
  } else {
    // Wiederholte Warnungen wirken schwächer
    const n = s.sent.filter(x => x.key === key).length;
    s.until[key] = race.time + m.dur;
    s.strength = s.strength || {};
    s.strength[key] = Math.max(0.2, 0.5 - 0.1 * n);
    race.emit('rc', `RACE CONTROL MESSAGE an alle Teams: ${m.name} – ${m.text}`);
  }
  s.sent.push({ key, arg, time: race.time, lap: race.standings()[0].lap + 1 });
  return true;
}

// Faktor für die Wahrscheinlichkeit eines Verstoßes (1 = keine Warnung aktiv)
export function msgFactor(race, key) {
  const s = race.rcMsgs;
  if (!s || !(s.until[key] > race.time)) return 1;
  return s.strength ? s.strength[key] ?? 0.5 : 0.5;
}

export function msgActive(race, key) {
  const s = race.rcMsgs;
  return Boolean(s && s.until[key] > race.time);
}
