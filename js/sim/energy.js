// Hybrid-Energie (Saison 2026: deutlich mehr elektrische Leistung).
// Auf den Geraden wird Energie eingesetzt (mehr Tempo, vor allem beim Überholen), in Kurven und beim Bremsen
// zurückgewonnen. Lange Geraden kosten besonders viel. Topteams gewinnen effizienter zurück.
// Ist der Akku fast leer, teilt der Fahrer ein – auf der Geraden fehlt dann Tempo.
import { speedAt } from './trackModel.js';

const LAP_HARVEST = 0.5;     // pro Runde zurückgewonnen (Anteil Akku, bei voller Effizienz)
const LAP_DEPLOY = 0.55;     // pro Runde eingesetzt bei vollem Einsatz auf allen Geraden
const BOOST = 0.04;          // Tempo-Unterschied je Einsatz-Stufe (normaler Einsatz 0,6 = ±0)
const ATTACK = 1.6;          // Einsatz beim Überholen

// Gerade = Abschnitt mit hohem Tempo; Zeitanteile je Runde einmal pro Strecke berechnen
function prep(track) {
  if (track.energy) return track.energy;
  const vTop = Math.max(...track.v);
  let ts = 0, tc = 0;
  for (let i = 0; i < track.N; i++) {
    const t = track.ds / Math.max(5, track.v[i]);
    if (track.v[i] > vTop * 0.78) ts += t; else tc += t;
  }
  track.energy = { vTop, harvest: LAP_HARVEST / tc, deploy: LAP_DEPLOY / ts };
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
  if (e > 0.6) return 0.8;
  if (e > 0.3) return 0.6;
  if (e > 0.1) return 0.35;
  return 0.1;
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
