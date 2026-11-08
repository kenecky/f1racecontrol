// Zufallsgenerator mit Seed → Rennen sind reproduzierbar.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    getState: () => a,                 // für Speichern/Laden
    setState: st => { a = st >>> 0; },
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: p => next() < p,
    gauss: (sd = 1) => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
    },
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}
