// Hybrid-Energie (Saison 2026: deutlich mehr elektrische Leistung).
// Auf den Geraden wird Energie eingesetzt (mehr Tempo, vor allem beim Überholen), in Kurven und beim Bremsen
// zurückgewonnen. Lange Geraden kosten besonders viel. Topteams gewinnen effizienter zurück.
// Ist der Akku fast leer, teilt der Fahrer ein – auf der Geraden fehlt dann Tempo.
import { speedAt } from './trackModel.js';

// Reale Größenordnung 2026: MGU-K 350 kW, nutzbarer Akku ~4 MJ → voller Einsatz leert ihn in ~11 s
// (auf einer langen Geraden also leicht über 50 %). Zurückgewonnen werden bis ~8 MJ pro Runde (≈ 2 Akkus),
// vor allem beim Bremsen und in Kurven.
const DEPLOY_RATE = 0.088;   // Anteil Akku pro Sekunde bei vollem Einsatz (350 kW / 4 MJ)
const HARVEST_RATE = 0.075;  // Anteil Akku pro Sekunde in Kurven/beim Bremsen (bei voller Effizienz)
const LAP_HARVEST_MAX = 2.0; // höchstens ~8 MJ pro Runde
const BOOST = 0.04;          // Tempo-Unterschied je Einsatz-Stufe (normaler Einsatz 0,6 = ±0)
const ATTACK = 1.3;          // Überholmodus: zusätzliche Energie zum Angreifen

// Gerade = Abschnitt mit hohem Tempo; Zeitanteile je Runde einmal pro Strecke berechnen
function prep(track) {
  if (track.energy) return track.energy;
  const vTop = Math.max(...track.v);
  let ts = 0, tc = 0;
  for (let i = 0; i < track.N; i++) {
    const t = track.ds / Math.max(5, track.v[i]);
    if (track.v[i] > vTop * 0.78) ts += t; else tc += t;
  }
  track.energy = { vTop, harvest: Math.min(HARVEST_RATE, LAP_HARVEST_MAX / tc), deploy: DEPLOY_RATE };
  return track.energy;
}

export function isStraight(track, d) {
  return speedAt(track, d) > prep(track).vTop * 0.78;
}

// Effizienz der Rückgewinnung: Topteams ~1,0, Hinterbänkler ~0,81
export function efficiency(car) {
  return Math.min(1, 0.8 + Math.max(0, car.team.pace - 64) * 0.006);
}

// Einsatz-Stufe des Fahrers je nach Ladestand
function useLevel(car) {
  const e = car.energy;
  const attack = car.pass && !car.pass.slow && !car.pass.blue;
  if (attack && e > 0.12) return ATTACK;
  if (e > 0.6) return 1;
  if (e > 0.3) return 0.7;
  if (e > 0.1) return 0.45;
  return 0.15;   // „Clipping“: Akku leer, die E-Leistung fehlt
}

// Ein Zeitschritt: Akku aktualisieren, Tempofaktor zurückgeben (1 = neutral)
export function energyStep(race, car, dt, neutral) {
  if (car.energy === undefined) car.energy = 1;
  const E = prep(race.track);
  if (neutral) {   // unter Neutralisierung wird nur geladen
    car.energy = Math.min(1, car.energy + E.harvest * 0.6 * dt);
    car.deploy = 0;
    return 1;
  }
  if (!isStraight(race.track, car.d)) {
    car.energy = Math.min(1, car.energy + E.harvest * efficiency(car) * dt);
    car.deploy = 0;
    return 1;
  }
  const use = useLevel(car);
  car.energy = Math.max(0, car.energy - E.deploy * use * dt);
  car.deploy = use;
  return 1 + BOOST * (use - 0.6);
}

// Bonus auf die Überholchance: mehr Energie als der Vordermann hilft auf der Geraden
export function energyEdge(B, A) {
  const diff = (B.energy ?? 1) - (A.energy ?? 1);
  return Math.max(-0.08, Math.min(0.2, diff * 0.4));
}
