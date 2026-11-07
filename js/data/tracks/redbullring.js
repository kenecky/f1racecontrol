// Red Bull Ring, Spielberg (Österreich)
// Das Layout ist eine vereinfachte Nachbildung (nicht maßstabsgetreu).
// Koordinaten: x nach rechts, y nach unten. Fahrtrichtung im Uhrzeigersinn.
// Der erste Kontrollpunkt liegt auf der Start-/Ziellinie.
export const RED_BULL_RING = {
  id: 'redbullring',
  name: 'Red Bull Ring',
  grandPrix: 'Großer Preis von Österreich',
  country: 'Österreich',
  lengthM: 4318,
  laps: 71,
  baseLap: 66.4,        // theoretisch schnellste Runde (s) des besten Autos ohne Sprit
  pitLaneSpeed: 80,     // km/h
  pitLaneSide: 1,       // 1 = rechts der Fahrtrichtung (innen)

  controlPoints: [
    [150, 430],                                   // Start/Ziel
    [163, 360], [178, 290], [196, 228],           // Start-Ziel-Gerade
    [214, 186], [242, 158], [282, 144],           // T1
    [400, 126], [520, 106], [640, 86],            // Bergauf-Gerade
    [700, 76], [800, 60],                         // T2 (Knick)
    [858, 54], [892, 68], [900, 98], [876, 120],  // T3 (Haarnadel)
    [780, 160], [660, 210], [545, 258],           // Bergab-Gerade
    [496, 280], [468, 306], [460, 342],           // T4
    [450, 390], [438, 430],                       // Abfahrt
    [446, 468], [474, 492],                       // T5
    [512, 504], [548, 498],                       // T6
    [580, 488], [604, 498], [614, 524],           // T7
    [606, 552], [576, 570], [528, 578],           // T8
    [430, 586], [330, 590],                       // Gerade zu T9
    [268, 588], [224, 576],                       // T9
    [188, 556], [164, 524], [153, 482],           // T10
  ],

  // Kurven: Ankerpunkt (nächster Punkt auf der Strecke wird gesucht), vmax = Kurvengeschw. km/h
  corners: [
    { id: 'T1',  name: 'Niki Lauda Kurve', at: [242, 158], vmax: 125 },
    { id: 'T2',  name: 'T2',               at: [750, 68], vmax: 265 },
    { id: 'T3',  name: 'Remus',            at: [900, 98], vmax: 78 },
    { id: 'T4',  name: 'Schlossgold',      at: [468, 306], vmax: 118 },
    { id: 'T5',  name: 'T5',               at: [446, 468], vmax: 195 },
    { id: 'T6',  name: 'Rauch',            at: [530, 502], vmax: 150 },
    { id: 'T7',  name: 'Würth',            at: [604, 498], vmax: 165 },
    { id: 'T8',  name: 'T8',               at: [576, 570], vmax: 185 },
    { id: 'T9',  name: 'Jochen Rindt',     at: [246, 583], vmax: 205 },
    { id: 'T10', name: 'T10',              at: [164, 524], vmax: 180 },
  ],

  // Überholzonen: Bremszonen vor diesen Kurven. factor = wie leicht hier überholt wird.
  overtakeZones: [
    { corner: 'T1', before: 330, after: 20, factor: 0.7 },
    { corner: 'T3', before: 420, after: 20, factor: 1.0 },
    { corner: 'T4', before: 380, after: 20, factor: 0.8 },
  ],

  // Zeitsektoren: Enden von Sektor 1 und 2, relativ zu einer Kurve (Meter danach)
  timingSectors: [
    { corner: 'T3', offset: 150 },
    { corner: 'T8', offset: 100 },
  ],

  // Boxengasse: Einfahrt nach T10, Ausfahrt nach T1 (Meter relativ zur Kurve)
  pit: {
    entry: { corner: 'T10', offset: 60 },
    exit:  { corner: 'T1',  offset: 110 },
    boxOffsetAfterLine: 120,
  },
};
