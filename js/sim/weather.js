// Wetter: Regenverlauf, Streckennässe, Wetterdienst-Meldungen, Gefahr durch zu viel Wasser.
import { createRng } from '../util/rng.js';
import { createHazard } from './hazards.js';

export const WEATHER_MODES = {
  random: 'Zufällig',
  dry: 'Trocken',
  rain: 'Regen',
  changeable: 'Wechselhaft',
};

// Regenverlauf wird beim Erstellen vollständig festgelegt (eigener Zufallsgenerator,
// damit trockene Rennen mit gleicher Rennen-Nr. unverändert bleiben).
export function createWeather(seed, mode, raceSec, rainChance = 0.38) {
  const r = createRng((seed ^ 0x9e3779b9) >>> 0);
  let m = mode;
  if (m === 'random') {
    // Regenwahrscheinlichkeit je Strecke (z. B. Spa hoch, Bahrain fast null)
    const x = r.next();
    m = x >= rainChance ? 'dry' : x < rainChance * 0.4 ? 'rain' : 'changeable';
  }
  const showers = [];
  if (m === 'rain') {
    showers.push({ t0: -600, t1: raceSec * r.range(0.35, 0.8), peak: r.chance(0.2) ? r.range(0.86, 0.98) : r.range(0.4, 0.78) });
    if (r.chance(0.4)) {
      const t0 = raceSec * r.range(0.6, 0.85);
      showers.push({ t0, t1: t0 + r.range(300, 900), peak: r.range(0.35, 0.7) });
    }
  } else if (m === 'changeable') {
    const t0 = raceSec * r.range(0.2, 0.55);
    showers.push({ t0, t1: t0 + r.range(600, 1500), peak: r.chance(0.2) ? r.range(0.86, 0.98) : r.range(0.35, 0.8) });
  }
  const startWet = showers.some(s => s.t0 < 0) ? showers[0].peak * 0.9 : 0;
  return {
    mode: m,
    showers,
    rain: 0,
    wetness: startWet,
    announced: {},
    hazardId: null,
  };
}

// Regenintensität zum Zeitpunkt t (weiche Übergänge von 3 Minuten)
export function rainAt(wx, t) {
  let v = 0;
  for (const s of wx.showers) {
    const ramp = 180;
    const k = Math.min(1, Math.max(0, (t - s.t0) / ramp), Math.max(0, (s.t1 - t) / ramp));
    v = Math.max(v, s.peak * k);
  }
  return v;
}

export function weatherLabel(wx) {
  const w = wx.wetness;
  const icon = wx.rain > 0.7 ? '⛈' : wx.rain > 0.15 ? '🌧' : w > 0.1 ? '🌦' : '☀️';
  const track = w < 0.08 ? 'trocken' : w < 0.3 ? 'feucht' : w < 0.7 ? 'nass' : 'sehr nass';
  return { icon, track };
}

export function updateWeather(race, dt) {
  const wx = race.weather;
  if (!wx || !wx.showers.length) return;
  const t = race.time;
  wx.rain = rainAt(wx, t);
  // Nässe: wird schnell nass, trocknet langsam ab
  if (wx.rain > wx.wetness) wx.wetness = Math.min(1, wx.wetness + (wx.rain - wx.wetness) * dt / 80);
  else wx.wetness = Math.max(wx.rain, wx.wetness - dt * 0.0011);

  // Meldungen des Wetterdienstes
  wx.showers.forEach((s, i) => {
    const key = `s${i}`;
    if (s.t0 > 0 && !wx.announced[key + 'f'] && t > s.t0 - 360) {
      wx.announced[key + 'f'] = true;
      const lvl = s.peak > 0.75 ? 'starker Regen' : s.peak > 0.45 ? 'Regen' : 'leichter Regen';
      race.emit('weather', `Wetterdienst: ${lvl} in ca. ${Math.max(1, Math.round((s.t0 - t) / 60))} Minuten erwartet.`);
    }
    if (s.t0 > 0 && !wx.announced[key + 's'] && t > s.t0) {
      wx.announced[key + 's'] = true;
      race.emit('weather', 'Es beginnt zu regnen.');
    }
    if (!wx.announced[key + 'e'] && t > s.t1) {
      wx.announced[key + 'e'] = true;
      race.emit('weather', 'Der Regen hat aufgehört – die Strecke trocknet langsam ab.');
    }
  });

  // Zu viel Wasser: Gefahr für die ganze Strecke
  const h = wx.hazardId ? race.hazards.find(x => x.id === wx.hazardId) : null;
  if (!h && wx.wetness > 0.82 && race.phase === 'running') {
    const nh = createHazard(race, { type: 'weather', d: 0, need: 'sc', global: true });
    nh.desc = 'Viel stehendes Wasser – Aquaplaning-Gefahr und kaum Sicht';
    wx.hazardId = nh.id;
    race.emit('marshal', 'Gesamte Strecke: Viel stehendes Wasser, Fahrer melden Aquaplaning und kaum Sicht.', { hazard: nh.id });
  } else if (h && !h.ended) {
    if (h.need === 'sc' && wx.wetness > 0.93) {
      h.need = 'red';
      h.adequateAt = null;
      h.start = t;
      h.desc = 'Starkregen – unter diesen Bedingungen kann nicht gefahren werden';
      race.emit('marshal', 'Gesamte Strecke: Starkregen, die Strecke steht unter Wasser – Fahren nicht mehr möglich.', { hazard: h.id });
    }
    const limit = h.need === 'red' ? 0.78 : 0.72;
    if (wx.wetness < limit) h.endAt = t;   // wird in updateHazards beendet
  } else if (h && h.ended) {
    wx.hazardId = null;
  }
}
