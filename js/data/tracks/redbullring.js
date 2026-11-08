// Red Bull Ring, Spielberg (Österreich)
// Streckenverlauf: github.com/bacinger/f1-circuits – © 2019-2025 Tomislav Bacinger, MIT-Lizenz
// (siehe THIRD_PARTY_NOTICES.md). Koordinaten in Metern, x nach Osten, y nach Süden.
// Fahrtrichtung im Uhrzeigersinn. Der erste Kontrollpunkt liegt auf der Start-/Ziellinie.
// Auslaufzonen und Randsteine sind Näherungen (keine Vermessungsdaten).
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

  // Echte Streckenführung (Meter, Norden oben), umgerechnet aus bacinger/f1-circuits (MIT-Lizenz)
  controlPoints: [
    [235.4, 374.9], [149.1, 397.7], [-64.8, 455.5], [-79.5, 456.6], [-89.4, 447.7],
    [-105.9, 415.9], [-158.3, 345.6], [-215.2, 265.3], [-259.8, 194.5], [-300.6, 124.6],
    [-367.3, -19.7], [-385.6, -58.2], [-413.8, -103.5], [-457.2, -156.3], [-529.3, -228.1],
    [-596.0, -294.3], [-600.0, -303.2], [-599.5, -312.6], [-591.9, -317.2], [-574.4, -320.3],
    [-519.8, -326.6], [-465.2, -328.7], [-408.8, -328.1], [-355.2, -322.9], [-292.9, -313.0],
    [-102.8, -276.5], [-16.0, -265.1], [171.5, -257.3], [186.7, -252.1], [196.1, -241.7],
    [199.7, -230.2], [198.8, -218.2], [193.9, -206.8], [175.1, -180.1], [160.3, -162.4],
    [133.0, -138.5], [103.1, -122.3], [66.8, -110.4], [27.4, -104.1], [-13.8, -106.7],
    [-173.5, -132.3], [-195.0, -129.6], [-212.4, -123.4], [-227.6, -112.9], [-241.1, -98.9],
    [-249.6, -82.2], [-254.1, -64.0], [-254.9, -47.3], [-252.3, -29.0], [-247.4, -15.5],
    [-169.9, 118.9], [-156.9, 133.0], [-136.4, 146.0], [-112.6, 151.3], [-89.8, 149.2],
    [-65.7, 139.2], [-50.9, 127.3], [-35.7, 108.5], [-21.4, 90.3], [-6.1, 74.7],
    [12.2, 62.2], [33.7, 49.6], [63.7, 38.6], [95.0, 31.9], [342.9, 26.7],
    [533.5, 22.0], [553.6, 22.5], [573.3, 29.3], [589.5, 41.3], [602.4, 57.4],
    [612.2, 78.8], [651.2, 209.1], [653.4, 221.0], [651.2, 229.9], [646.7, 236.7],
    [631.5, 248.7], [611.4, 260.6], [585.4, 273.6], [555.9, 286.1], [521.0, 297.6],
  ],

  // Kurven: Ankerpunkt (nächster Punkt auf der Strecke wird gesucht), vmax = Kurvengeschw. km/h
  corners: [
    { id: 'T1',  name: 'Niki Lauda Kurve', at: [-79.5, 456.6], vmax: 125 },
    { id: 'T2',  name: 'T2',               at: [-413.8, -103.5], vmax: 265 },
    { id: 'T3',  name: 'Remus',            at: [-599.5, -312.6], vmax: 78 },
    { id: 'T4',  name: 'Schlossgold',      at: [199.7, -230.2], vmax: 118 },
    { id: 'T5',  name: 'T5',               at: [-249.6, -82.2], vmax: 195 },
    { id: 'T6',  name: 'Rauch',            at: [-112.6, 151.3], vmax: 150 },
    { id: 'T7',  name: 'Würth',            at: [-6.1, 74.7], vmax: 165 },
    { id: 'T8',  name: 'T8',               at: [95.0, 31.9], vmax: 185 },
    { id: 'T9',  name: 'Jochen Rindt',     at: [589.5, 41.3], vmax: 205 },
    { id: 'T10', name: 'T10',              at: [651.2, 229.9], vmax: 180 },
  ],

  // Auslaufzonen – Näherung an die echte Strecke (keine Vermessungsdaten).
  // from/to: Meter relativ zum Kurvenscheitel · width/offset: Meter · side: 'out' | 'in'
  runoffs: [
    { corner: 'T1',  from: -50, to: 150, side: 'out', type: 'asphalt', width: 38 },
    { corner: 'T2',  from: -40, to: 80,  side: 'out', type: 'asphalt', width: 18 },
    { corner: 'T3',  from: -80, to: 90,  side: 'out', type: 'asphalt', width: 42 },
    { corner: 'T3',  from: -40, to: 60,  side: 'out', type: 'gravel',  width: 16, offset: 42 },
    { corner: 'T4',  from: -50, to: 110, side: 'out', type: 'asphalt', width: 34 },
    { corner: 'T4',  from: -10, to: 90,  side: 'out', type: 'gravel',  width: 16, offset: 34 },
    { corner: 'T5',  from: -30, to: 90,  side: 'out', type: 'gravel',  width: 26 },
    { corner: 'T6',  from: -30, to: 90,  side: 'out', type: 'gravel',  width: 32 },
    { corner: 'T7',  from: -30, to: 90,  side: 'out', type: 'gravel',  width: 32 },
    { corner: 'T8',  from: -20, to: 110, side: 'out', type: 'gravel',  width: 28 },
    { corner: 'T9',  from: -30, to: 100, side: 'out', type: 'asphalt', width: 24 },
    { corner: 'T9',  from: 0,   to: 90,  side: 'out', type: 'gravel',  width: 14, offset: 24 },
    { corner: 'T10', from: -30, to: 130, side: 'out', type: 'asphalt', width: 28 },
    { corner: 'T10', from: 10,  to: 120, side: 'out', type: 'gravel',  width: 14, offset: 28 },
  ],

  // Randsteine (Standard: innen am Scheitel, außen am Ausgang); hier nur Abweichungen
  kerbs: {
    T2: { inFrom: -20, inTo: 20, out: false },
  },

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

  // Marshal-Sektoren (Streckenposten-Abschnitte für Flaggen).
  // Jeder Eintrag ist der Beginn eines Sektors relativ zu einer Kurve; Sektor 1 beginnt an der Ziellinie.
  marshalSectors: [
    { line: true },
    { corner: 'T1', offset: -120 },
    { corner: 'T1', offset: 150 },
    { corner: 'T2', offset: -120 },
    { corner: 'T3', offset: -130 },
    { corner: 'T3', offset: 200 },
    { corner: 'T4', offset: -300 },
    { corner: 'T4', offset: 150 },
    { corner: 'T5', offset: 120 },
    { corner: 'T7', offset: 60 },
    { corner: 'T9', offset: -200 },
    { corner: 'T10', offset: 80 },
  ],

  // Boxengasse: Einfahrt nach T10, Ausfahrt nach T1 (Meter relativ zur Kurve)
  pit: {
    entry: { corner: 'T10', offset: 60 },
    exit:  { corner: 'T1',  offset: 110 },
    boxOffsetAfterLine: 120,
  },
};
