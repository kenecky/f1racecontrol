// Gesamtbewertung der Rennleitung: Sicherheit, Fairness, Konsistenz, Rennfluss.
import { flagReport } from './flags.js';
import { stewardReport, PENALTIES } from './stewards.js';
import { NEED_LEVEL, NEED_LABEL } from '../sim/hazards.js';
import { createRng } from '../util/rng.js';

const HAZARD_WEIGHT = { yellow: 10, double: 15, vsc: 18, sc: 25, red: 35 };
const LATE = { yellow: 20, double: 20, vsc: 30, sc: 30, red: 45 };
const CASE_COST = { ok: 0, lenient: 9, harsh: 9, wrong: 15, open: 15, pending: 0 };
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
    const w = HAZARD_WEIGHT[h.need] * (it.weight ?? 1);
    if (it.verdict === 'missed') safety -= w;
    else if (it.verdict === 'late') safety -= w * clamp((h.adequateAt - h.start - LATE[h.need]) / 60, 0.25, 0.8);
  }

  // Start: stehendes Auto in der Startaufstellung, Startabbruch ohne Grund
  const startLog = race.startLog || [];
  for (const s of startLog) {
    if (s.action === 'released') safety -= s.crash ? 35 : 25;
    if (s.type === 'lights' && s.action === 'early') safety -= 40;   // Ampel, obwohl noch Autos fahren
  }

  let fairnessAdj = 0;
  // Einsatzfahrzeuge: Regeln der Rennleitung
  const svcLog = race.svc ? race.svc.log : [];
  for (const e of svcLog) {
    if (e.type === 'medicalNoSC' || e.type === 'sweeperNoSC') safety -= 10;
    if (e.type === 'craneUnsafe') safety -= e.wet ? 15 : 10;
  }
  for (const b of race.boLog || []) {
    if (b.late) safety -= 10;                 // Teil abgefallen, bevor Schwarz-Orange gezeigt wurde
  }
  const boNeedless = (race.boLog || []).filter(b => b.needed === false).length;
  fairnessAdj = -5 * boNeedless;
  const svcWrong = svcLog.filter(e => e.type === 'craneWrong' || e.type === 'sweeperWrong').length;

  // Fairness
  let fairness = 100 + fairnessAdj;
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
  const needless = startLog.filter(s => s.type === 'none' && s.action !== 'released').length;
  // Lichter aus: üblich bis 3 s nach dem fünften Licht – länger macht die Fahrer nervös
  const lateLights = startLog.filter(s => s.type === 'lights' && s.action === 'out')
    .reduce((sum, s) => sum + (s.auto ? 25 : Math.min(25, Math.max(0, s.hold - 3) * 8)), 0);
  const flow = 100 - 8 * svcWrong - fr.idleFlagTime / 10 - fr.neutral.idle / 6 - 8 * over - 10 * needless - lateLights;

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
    provisional: sr.open > 0 || sr.pending > 0,
    voices: buildVoices(race, fr, sr, scores, total, over),
    fr, sr,
  };
}

// ---------- Stimmen zum Rennen ----------

function buildVoices(race, fr, sr, scores, total, over) {
  const r = createRng(race.seed ^ 0x5eed);   // eigener Zufall: Anzeige verändert das Rennen nicht
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
      say(`Teamchef ${team(t.victim)}`, `„Bei Entscheidung #${c.id} kommt ${t.offender} viel zu billig davon.“`, 'neg');
    }
  }
  for (const e of race.svc ? race.svc.log : []) {
    if (e.type === 'medicalNoSC') say('Fahrervereinigung (GPDA)', '„Das Medical Car fuhr ohne Safety Car auf die Strecke – das ist gegen die Regeln.“', 'neg');
    if (e.type === 'sweeperNoSC') say('Fahrer', '„Eine Kehrmaschine auf der Strecke ohne Safety Car? Brandgefährlich.“', 'neg');
    if (e.type === 'craneWrong') say('Presse', `„Der Bergungskran rückte in Sektor ${e.sector + 1} aus – dort war gar nichts.“`, 'neg');
    if (e.type === 'craneUnsafe') say('Fahrervereinigung (GPDA)', `„Ein Kran neben der Strecke in Sektor ${e.sector + 1}${e.wet ? ' bei Regen' : ''} ohne ausreichende Absicherung – das darf nie wieder passieren.“`, 'neg');
  }
  for (const s of race.startLog || []) {
    if (s.action === 'released') {
      say('Fahrervereinigung (GPDA)', s.crash
        ? `„Start freigegeben, obwohl ${s.carId} in der Startaufstellung stand – und dann kracht es. Unverantwortlich.“`
        : `„Start freigegeben, obwohl ${s.carId} in der Startaufstellung stand. Da hätte viel passieren können.“`, 'neg');
    } else if (s.type === 'lights' && s.action === 'early') {
      say('Fahrervereinigung (GPDA)', `„Die Startampel lief, während noch ${s.missing || 'einige'} Auto${s.missing === 1 ? '' : 's'} auf der Formationsrunde ${s.missing === 1 ? 'war' : 'waren'}. Das ist brandgefährlich!“`, 'neg');
    } else if (s.type === 'lights' && s.action === 'out' && (s.auto || s.hold > 3)) {
      say('Fahrer', `„${s.auto ? 'Gefühlt eine Ewigkeit' : `${s.hold.toFixed(1).replace('.', ',')} Sekunden`} mit allen Lichtern an – die Kupplung kocht, so provoziert man Fehlstarts.“`, 'neg');
    } else if (s.type === 'lights' && s.action === 'out') {
      say('Presse', '„Sauberer Start – die Lichter gingen genau im richtigen Moment aus.“', 'pos');
    } else if (s.type === 'none') {
      say('Presse', '„Startabbruch ohne erkennbaren Grund – das Publikum versteht die Rennleitung nicht.“', 'neg');
    } else if (s.type === 'stall' && s.action === 'abort') {
      say('Fahrer', `„Richtig, den Start abzubrechen, als ${s.carId} stand.“`, 'pos');
    }
  }
  if (sr.open) say('Presse', `„Die Kommissare lassen ${sr.open === 1 ? 'eine Entscheidung' : `${sr.open} Entscheidungen`} offen – Teams fordern Klarheit.“`, 'neg');
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

  if (total >= 88) say('Presse', '„Souveräne Rennleitung heute – kaum etwas zu kritisieren.“', 'pos');
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
