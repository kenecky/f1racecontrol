// Gesamtbewertung der Rennleitung: Sicherheit, Fairness, Konsistenz, Rennfluss.
import { flagReport } from './flags.js';
import { stewardReport, PENALTIES } from './stewards.js';
import { NEED_LEVEL, NEED_LABEL } from '../sim/hazards.js';

const HAZARD_WEIGHT = { yellow: 10, double: 15, vsc: 18, sc: 25, red: 35 };
const LATE = { yellow: 20, double: 20, vsc: 30, sc: 30, red: 45 };
const CASE_COST = { ok: 0, lenient: 9, harsh: 9, wrong: 15, open: 15 };
export const AXES = [
  { id: 'safety', name: 'Sicherheit', weight: 0.35, hint: 'Gefahren rechtzeitig und ausreichend abgesichert' },
  { id: 'fairness', name: 'Fairness', weight: 0.35, hint: 'Urteile treffen den Richtigen in angemessener Höhe' },
  { id: 'consistency', name: 'Konsistenz', weight: 0.15, hint: 'Gleiche Vergehen gleich bestraft' },
  { id: 'flow', name: 'Rennfluss', weight: 0.15, hint: 'Keine unnötigen Flaggen und Neutralisierungen' },
];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function gradeFor(total) {
  if (total >= 90) return { grade: 'Sehr gut', stars: 5 };
  if (total >= 78) return { grade: 'Gut', stars: 4 };
  if (total >= 64) return { grade: 'Befriedigend', stars: 3 };
  if (total >= 50) return { grade: 'Ausreichend', stars: 2 };
  return { grade: 'Mangelhaft', stars: 1 };
}

export function rateRace(race) {
  const fr = flagReport(race);
  const sr = stewardReport(race);

  // Sicherheit
  let safety = 100;
  for (const it of fr.items) {
    const h = it.h;
    const w = HAZARD_WEIGHT[h.need];
    if (it.verdict === 'missed') safety -= w;
    else if (it.verdict === 'late') safety -= w * clamp((h.adequateAt - h.start - LATE[h.need]) / 60, 0.25, 0.8);
  }

  // Fairness
  let fairness = 100;
  for (const it of sr.items) {
    let cost = CASE_COST[it.verdict];
    if (it.verdict === 'harsh' && !it.c.truth.offender) cost = 12;   // Strafe ohne Vergehen
    fairness -= cost;
  }

  // Konsistenz: gleiche Einstufung → gleiche Strafe und ähnliche Strafpunkte
  let consistency = 100 - 15 * sr.inconsistent.length;
  const groups = new Map();
  for (const it of sr.items) {
    const v = it.c.verdict;
    if (!v || !v.carId || v.carId !== it.c.truth.offender) continue;
    const key = `${it.c.type}|${it.c.truth.expected.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v.points);
  }
  for (const pts of groups.values()) if (pts.length > 1 && Math.max(...pts) - Math.min(...pts) > 1) consistency -= 5;
  // Nur bewertbar, wenn es mindestens zwei vergleichbare Urteile gab
  const comparable = [...groups.values()].some(p => p.length > 1) || sr.inconsistent.length > 0;

  // Rennfluss
  const over = fr.items.filter(i => i.h.maxResponse >= 3 && i.h.maxResponse - NEED_LEVEL[i.h.need] >= 2).length;
  const flow = 100 - fr.idleFlagTime / 10 - fr.neutral.idle / 6 - 8 * over;

  const scores = {
    safety: Math.round(clamp(safety, 0, 100)),
    fairness: Math.round(clamp(fairness, 0, 100)),
    consistency: comparable ? Math.round(clamp(consistency, 0, 100)) : null,
    flow: Math.round(clamp(flow, 0, 100)),
  };
  // Nicht bewertbare Achsen fallen heraus, ihr Gewicht wird verteilt
  const rated = AXES.filter(a => scores[a.id] !== null);
  const wsum = rated.reduce((s, a) => s + a.weight, 0);
  const total = Math.round(rated.reduce((s, a) => s + scores[a.id] * a.weight, 0) / wsum);
  return {
    scores, total, ...gradeFor(total),
    provisional: sr.open > 0,
    voices: buildVoices(race, fr, sr, scores, total, over),
    fr, sr,
  };
}

// ---------- Stimmen zum Rennen ----------

function buildVoices(race, fr, sr, scores, total, over) {
  const r = race.rng;
  const voices = [];
  const team = id => race.carById[id].team.name;
  const say = (who, text, tone) => voices.push({ who, text, tone });

  for (const it of sr.items) {
    const c = it.c, v = c.verdict, t = c.truth;
    if (it.verdict === 'wrong') {
      say(`Teamchef ${team(v.carId)}`, `„Wir wurden für etwas bestraft, das ${t.offender} verursacht hat. Das ist nicht hinnehmbar.“`, 'neg');
    } else if (it.verdict === 'harsh' && !t.offender) {
      say(`Teamchef ${team(v.carId)}`, `„${PENALTIES[v.penalty].name} für ein ganz normales Manöver? Absolut unverständlich.“`, 'neg');
    } else if (it.verdict === 'harsh') {
      say(`Teamchef ${team(v.carId)}`, `„Ja, das war nicht sauber – aber ${PENALTIES[v.penalty].name} ist viel zu hart.“`, 'neg');
    } else if (it.verdict === 'lenient' && t.victim) {
      say(`Teamchef ${team(t.victim)}`, `„Bei Fall #${c.id} kommt ${t.offender} viel zu billig davon.“`, 'neg');
    }
  }
  if (sr.open) say('Presse', `„Die Kommissare lassen ${sr.open === 1 ? 'einen Fall' : `${sr.open} Fälle`} unentschieden – Teams fordern Klarheit.“`, 'neg');
  for (const it of fr.items) {
    const h = it.h;
    if (it.verdict === 'missed') {
      const need = NEED_LEVEL[h.need];
      say(need >= 4 ? 'Fahrervereinigung (GPDA)' : 'Fahrer', need >= 4
        ? `„${NEED_LABEL[h.need]} wäre in ${h.corner.id} zwingend nötig gewesen. Wir erwarten eine Erklärung.“`
        : `„In ${h.corner.id} war die Gefahr nicht abgesichert. So etwas darf nicht passieren.“`, 'neg');
    } else if (it.verdict === 'late') {
      say('Fahrer', `„In ${h.corner.id} kam die Reaktion der Rennleitung viel zu spät.“`, 'neg');
    }
  }
  if (fr.neutral.idle > 90) say('Presse', `„Fans pfeifen: ${Math.round(fr.neutral.idle / 60)} Minuten Neutralisierung ohne erkennbaren Grund.“`, 'neg');
  if (fr.idleFlagTime > 60) say('Fahrer', '„Ständig gelbe Flaggen, wo gar nichts war. Das nervt.“', 'neg');
  if (over) say('Presse', '„Mit Kanonen auf Spatzen: Die Rennleitung reagiert überzogen.“', 'neg');

  if (total >= 88) say('Presse', `„Souveräne Rennleitung in Spielberg – kaum etwas zu kritisieren.“`, 'pos');
  else if (total >= 75) say('Presse', '„Solide Arbeit der Rennleitung mit kleinen Schwächen.“', 'pos');
  if (scores.fairness === 100 && sr.total >= 3) say('Teamchef', '„Klare, nachvollziehbare Entscheidungen heute. So soll es sein.“', 'pos');
  if (scores.safety === 100 && fr.total >= 2) say('Fahrervereinigung (GPDA)', '„Gefahren wurden schnell und richtig abgesichert. Danke an die Marshals und die Rennleitung.“', 'pos');

  const winner = race.standings().find(c => c.finished && !c.dsq);
  if (winner) say(`${winner.driver.first} ${winner.driver.last} (Sieger)`, r.pick([
    '„Was für ein Rennen! Danke an das ganze Team.“',
    '„Ein harter Kampf, aber fair. Ich bin überglücklich.“',
    '„Heute hat einfach alles gepasst.“',
  ]), 'neu');

  const order = { neg: 0, pos: 1, neu: 2 };
  return voices.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 7);
}
