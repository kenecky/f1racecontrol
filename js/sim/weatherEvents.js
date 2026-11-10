// Wetter- und Umgebungsereignisse: Gewitter mit Blitzgefahr, Rettungshubschrauber kann nicht fliegen,
// stehendes Wasser in einzelnen Kurven, Hitze (Kreislaufprobleme), Regen kurz vor dem Start.
import { createHazard, cornerLabel, NEED_LEVEL } from './hazards.js';
import { rainAt } from './weather.js';
import { createRng } from '../util/rng.js';

export const HOT_TRACKS = ['bahrain', 'jeddah', 'singapore', 'lusail', 'miami', 'yasmarina'];

// Eigener Zufall für Ereignisse, die beim Erstellen festliegen (verändert den übrigen Ablauf nicht)
function plan(race) {
  if (race.wxPlan) return race.wxPlan;
  const r = createRng(((race.seed || 1) * 104729) ^ 0x7ea7);
  const wx = race.weather;
  const p = { storms: [], heli: null, heat: null };
  wx.showers.forEach((s, i) => {
    if (s.peak > 0.55 && r.chance(0.25)) {
      const t0 = Math.max(60, s.t0 + 120);
      p.storms.push({ i, t0, t1: Math.max(t0 + 240, s.t1 - 200) });
    }
  });
  const fog = wx.mode === 'rain' ? 0.06 : 0.015;
  if (r.chance(fog)) p.heli = { t0: r.range(300, 2400), dur: r.range(300, 900) };
  if (HOT_TRACKS.includes(race.track.def.id) && r.chance(0.35)) p.heat = { t: r.range(0.55, 0.9) };
  race.wxPlan = p;
  return p;
}

export function updateWeatherEvents(race, dt) {
  if (race.phase !== 'running' || race.isSession) return;
  const p = plan(race);
  const t = race.time;
  // Gewitter: Blitzgefahr → Unterbrechung
  for (const s of p.storms) {
    if (!s.on && t >= s.t0 && t < s.t1) {
      s.on = true;
      race.emit('weather', 'Wetterdienst: GEWITTERWARNUNG – Blitzeinschläge im Umkreis von wenigen Kilometern.');
      const h = createHazard(race, { type: 'storm', d: 0, need: 'red', global: true });
      h.desc = 'Gewitter mit Blitzgefahr über der Strecke – Fahren und Arbeiten im Freien zu gefährlich';
      h.endAt = s.t1;
      race.emit('marshal', `Gesamte Strecke: ${h.desc}.`, { hazard: h.id });
    }
  }
  // Rettungshubschrauber nicht einsatzbereit (Nebel, tiefe Wolken)
  if (p.heli && !p.heli.on && t >= p.heli.t0) {
    p.heli.on = true;
    const h = createHazard(race, { type: 'heli', d: 0, need: 'red', global: true });
    h.desc = 'Der Rettungshubschrauber kann wegen tiefer Wolken nicht fliegen – ohne ihn darf nicht gefahren werden';
    h.endAt = t + p.heli.dur;
    race.emit('marshal', `Medizinisches Zentrum: ${h.desc}.`, { hazard: h.id });
  }
  // Hitze: ein Fahrer bekommt Kreislaufprobleme
  if (p.heat && !p.heat.done) {
    const leader = race.standings()[0];
    if (leader.lap >= p.heat.t * race.laps) {
      p.heat.done = true;
      const r = race.rng;
      const cand = race.onTrackCars().filter(c => !c.limp);
      if (cand.length) {
        const car = r.pick(cand);
        race.emit('radio', `Funk ${car.id}: „${r.pick(['Mir ist schwindlig, ich sehe Sterne …', 'Es ist so heiß im Auto, ich kann kaum noch.', 'Mir ist schlecht, ich komme rein.'])}“`, { cars: [car.id] });
        car.limp = { hazardId: null, since: t, factor: 0.6, heat: true };
        race.emit('info', `${car.id} hat bei der Hitze Kreislaufprobleme und fährt langsam an die Box.`, { cars: [car.id] });
      }
    }
  }
  // Stehendes Wasser in einer Kurve bei starkem Regen
  const wx = race.weather;
  if (wx.rain > 0.6 && wx.wetness > 0.55 && !race.neutral && !race.hazards.some(h => h.type === 'water' && !h.ended)) {
    if (race.rng.chance(0.0006 * dt / 0.05)) {
      const c = race.rng.pick(race.track.corners);
      const h = createHazard(race, { type: 'water', d: c.d, need: 'double' });
      h.desc = `Ein Bach läuft quer über die Fahrbahn in ${cornerLabel(c)} – Aquaplaning`;
      h.endAt = t + race.rng.range(240, 600);
      race.emit('marshal', `Sektor ${h.sector + 1}: ${h.desc}.`, { hazard: h.id, sector: h.sector });
    }
  }
  for (const h of race.hazards) if (h.type === 'water' && !h.ended && wx.rain < 0.3 && h.endAt > t + 30) h.endAt = t + 30;
}

// Regen kurz vor dem Start? (für die Startaufstellung)
export function rainAtStart(race) {
  return rainAt(race.weather, 0) > 0.25 || rainAt(race.weather, 240) > 0.35;
}
export { NEED_LEVEL };
