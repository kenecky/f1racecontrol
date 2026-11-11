// Reifenmischungen (Slicks + Intermediates + Regenreifen)
export const COMPOUNDS = {
  S: { id: 'S', name: 'Soft',         offset: 0.00, deg: 0.075, cliff: 18 },
  M: { id: 'M', name: 'Medium',       offset: 0.35, deg: 0.045, cliff: 30 },
  H: { id: 'H', name: 'Hard',         offset: 0.70, deg: 0.028, cliff: 44 },
  I: { id: 'I', name: 'Inter',        offset: 0,    deg: 0.06,  cliff: 28, wet: true },
  W: { id: 'W', name: 'Regenreifen',  offset: 0,    deg: 0.05,  cliff: 32, wet: true },
};

// Zeitverlust pro Runde (s) einer Mischung bei Streckennässe w (0 = trocken, 1 = überflutet)
export function wetLoss(id, w) {
  if (id === 'I') return w < 0.3 ? 1.2 + (0.3 - w) * 14 : w > 0.65 ? 1.2 + (w - 0.65) * 18 : 1.2;
  if (id === 'W') return w < 0.65 ? 3.2 + (0.65 - w) * 16 : 3.2;
  return w < 0.08 ? 0 : (w - 0.08) * 30 + w * w * 10;
}

// Beste Mischung für eine Nässe (Slick-Wahl nach Restrunden)
export function bestCompound(w, lapsLeft) {
  const slick = lapsLeft > 34 ? 'H' : lapsLeft > 16 ? 'M' : 'S';
  let best = slick, bl = wetLoss(slick, w) + COMPOUNDS[slick].offset;
  for (const id of ['I', 'W']) {
    const l = wetLoss(id, w);
    if (l < bl) { bl = l; best = id; }
  }
  return best;
}
