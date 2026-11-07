# F1 Race Control – Planungsdokument

> Lebendes Dokument. Wird bei jeder größeren Entscheidung aktualisiert.
> Privates Projekt, keine Veröffentlichung geplant.

---

## 1. Vision

Wir sind **Rennleiter (Race Director)** eines Formel-1-Rennens. Fahrer und Teams
sind komplett CPU-gesteuert – auf Fahrverhalten und Strategien haben wir **keinen**
Einfluss. Unsere Aufgabe: Situationen erkennen, bewerten und richtig reagieren.

- Kein Rennspiel, kein Manager.
- Fokus: Flaggen, Safety Car, VSC, rote Flagge, Untersuchungen und Strafen.
- Ziel langfristig: komplette Saison mit allen Strecken spielbar.

---

## 2. Festgelegte Grundentscheidungen

| Thema | Entscheidung |
|---|---|
| Plattform | Browser-Spiel, **reines HTML/CSS/JavaScript**, kein Build-Schritt |
| Hosting | GitHub Pages (Repo `kenecky/f1racecontrol`) |
| Gerät | **Handy, Hochformat** (Desktop später, keine Priorität) |
| Installierbar | PWA (Homescreen-Icon, offline spielbar) |
| Speicherung | Lokal auf dem Handy (localStorage / IndexedDB) |
| Zeitablauf | **Mischform**: Live-Simulation im Zeitraffer, bei wichtigen Ereignissen Zeitlupe/Auto-Pause |
| Fahrer/Teams | **Echte Namen**, Stärken an echter Leistung orientiert |
| Erste Strecke | **Red Bull Ring** (Österreich) |
| Session-Umfang | Zunächst **nur das Rennen** (Start mit fertiger Startaufstellung) |
| Regelwerk | Am echten FIA-Sportreglement orientiert, wo nötig vereinfacht |
| Sprache | UI auf Deutsch, Fachbegriffe Englisch (Safety Car, Track Limits, …) |

---

## 3. Spielablauf (Mischform)

1. **Rennstart**: Startaufstellung steht, Formationsrunde wird übersprungen
   (später evtl. Startfreigabe als Entscheidung).
2. **Rennen läuft im Zeitraffer** – Geschwindigkeit wählbar (1×, 2×, 4×, 8×, 16×, 32×).
   Ein 71-Runden-Rennen dauert real ca. 83 Min. → bei Standard-Tempo **4× ca. 21 Min.**
3. **Ereignisse** (Unfall, Dreher, Trümmerteil, Kontakt, Track-Limits-Verstoß,
   Team-Beschwerde, Wetter …) erscheinen im Meldungsfeed.
   - **Kritische Ereignisse** (Auto steht auf der Strecke, schwerer Unfall)
     → Spiel verlangsamt sich bzw. pausiert automatisch.
   - **Normale Ereignisse** → Meldung, Rennen läuft weiter.
4. **Wir reagieren**: Flagge setzen, SC/VSC auslösen, Vorfall notieren, untersuchen,
   bestrafen – oder bewusst nichts tun.
5. **Untersuchungen** können sofort, später im Rennen oder „nach dem Rennen“
   entschieden werden.
6. **Rennende**: Zielflagge, Ergebnis (inkl. Zeitstrafen), Rennbericht mit Bewertung.

Pause ist jederzeit manuell möglich.

---

## 4. Bildschirm-Layout (Hochformat)

```
┌────────────────────────────┐
│ Runde 23/71  🟢 GRÜN  20× ⏸ │  ← Statusleiste (Runde, Rennstatus, Tempo, Pause)
├────────────────────────────┤
│                            │
│      STRECKENKARTE (2D)    │  ← Autos als Punkte, Marshal-Sektoren farbig
│                            │
├────────────────────────────┤
│ [Zeiten] [Meldungen] [Fälle]│  ← Tabs
│ 1 VER  —                   │
│ 2 NOR  +1.2                │  ← Inhalt des aktiven Tabs
│ 3 LEC  +3.8                │
│ …                          │
├────────────────────────────┤
│ [Flagge] [VSC] [SC] [ROT]  │  ← Aktionsleiste (immer sichtbar, daumenfreundlich)
└────────────────────────────┘
```

- **Streckenkarte**: Tippen auf einen Sektor → Flaggen für diesen Sektor setzen.
  Tippen auf ein Auto → Fahrerinfo.
- **Zeiten**: Position, Kürzel, Abstand, Reifen, Boxenstopps, Strafen.
- **Meldungen**: Live-Feed (Marshals, Funk, Teams, Systeme).
- **Fälle**: offene Vorfälle/Untersuchungen mit Beweismitteln und Urteil.

---

## 5. Entscheidungen der Rennleitung

### 5.1 Flaggen (pro Marshal-Sektor bzw. global)
| Flagge | Bedeutung | Ebene |
|---|---|---|
| Grün | Strecke frei | Sektor / global |
| Gelb | Gefahr, langsamer, nicht überholen | Sektor |
| Doppelt Gelb | Große Gefahr, bereit zum Anhalten | Sektor |
| Gelb-Rot gestreift | Rutschige Strecke / Öl / Trümmer | Sektor |
| Blau | Überrundung, Platz machen | Fahrer |
| Weiß | Langsames Fahrzeug im Sektor | Sektor |
| Schwarz-Weiß | Verwarnung unsportliches Verhalten | Fahrer |
| Schwarz-Orange | Technischer Defekt, sofort an die Box | Fahrer |
| Schwarz | Disqualifikation | Fahrer |
| Rot | Rennunterbrechung | global |

### 5.2 Neutralisierungen
- **VSC** (Virtual Safety Car): Delta-Zeit, Überholverbot, keine Bergung auf
  Ideallinie nötig.
- **SC** (Safety Car): Feld fährt auf, Boxengasse ggf. geschlossen,
  Entscheidung „Überrundete dürfen sich zurückrunden“, SC-Rückkehr.
- **Rote Flagge**: Feld in die Boxengasse, Uhr läuft weiter/hält an,
  Reifenwechsel erlaubt, Neustart (stehend oder hinter SC).

### 5.3 Vorfälle und Strafen
Status eines Vorfalls:
`Notiert` → `Wird untersucht` → `Urteil` oder `Untersuchung nach dem Rennen`

Mögliche Urteile:
- Keine weiteren Maßnahmen (NFA)
- Verwarnung
- Schwarz-Weiß-Flagge
- 5 s / 10 s Zeitstrafe
- Durchfahrtsstrafe (Drive-Through)
- 10 s Stop-and-Go
- Startplatzstrafe fürs nächste Rennen (relevant ab Saisonmodus)
- Disqualifikation
- zusätzlich: Strafpunkte auf die Superlizenz (0–3)

Vorfalltypen (Ausbaustufen):
- Kollision / Kontakt
- Abdrängen von der Strecke
- Überholen neben der Strecke mit Vorteil
- Track Limits (mehrfach → Verwarnung → Strafe)
- Missachtung gelber / blauer Flaggen
- Überholen unter SC/VSC
- Unsichere Boxenfreigabe (Unsafe Release)
- Speeding in der Boxengasse
- Erratisches Fahren / Bremstest

---

## 6. Vorfall-System (Kern der Spielmechanik)

Jeder generierte Vorfall hat eine **interne Wahrheit**, die der Spieler nicht direkt sieht:
- Schuldverteilung (z. B. Fahrer A 80 %, Fahrer B 20 %)
- Schwere (Folgen: Schaden, Positionsverlust, Ausfall)
- „Angemessene“ Strafe laut Regelwerk/Präzedenz

Der Spieler bekommt **Indizien**:
- Textbeschreibung der Szene
- Telemetrie-Ausschnitt (Bremspunkt, Geschwindigkeit, Lenkeinschlag)
- Positionierung (wer war „vorne“ am Scheitelpunkt?)
- Funksprüche / Aussagen der Fahrer und Teams
- später: kleine Replay-Animation

Indizien können unvollständig oder widersprüchlich sein (z. B. Team-Funk ist parteiisch).

---

## 7. Bewertung

Bewertungsachsen (je 0–100):
| Achse | Beispiele |
|---|---|
| **Sicherheit** | Gelb/SC zu spät → Folgeunfall; Bergung ohne Neutralisierung |
| **Fairness** | Urteil nah an der „wahren“ Schuld und angemessenen Strafe |
| **Konsistenz** | Gleiche Fälle gleich bestraft (Präzedenzfälle) |
| **Rennfluss** | Unnötige SC-/Rot-Phasen, zu lange Neutralisierung, zu späte Urteile |

Feedback-Kanäle:
- Reaktionen von Teams/Fahrern im Feed
- Rennbericht nach dem Rennen
- Später (Saisonmodus): Ruf/Reputation der Rennleitung über die Saison

---

## 8. Daten

### 8.1 Teams und Fahrer (Saison 2026)
Jedes Team bekommt Werte für Auto-Pace, Zuverlässigkeit, Boxenstopp-Qualität.
Jeder Fahrer bekommt Pace, Konstanz, Aggressivität, Regen-Können, Fehleranfälligkeit.
Die Werte liegen in einer Datendatei und können jederzeit angepasst werden.

| Team | Fahrer |
|---|---|
| McLaren | Lando Norris, Oscar Piastri |
| Ferrari | Charles Leclerc, Lewis Hamilton |
| Red Bull Racing | Max Verstappen, Isack Hadjar |
| Mercedes | George Russell, Kimi Antonelli |
| Aston Martin | Fernando Alonso, Lance Stroll |
| Alpine | Pierre Gasly, Franco Colapinto |
| Williams | Alexander Albon, Carlos Sainz |
| Racing Bulls | Liam Lawson, Arvid Lindblad |
| Haas | Esteban Ocon, Oliver Bearman |
| Audi | Nico Hülkenberg, Gabriel Bortoleto |
| Cadillac | Sergio Pérez, Valtteri Bottas |

> ⚠️ Fahrerbesetzung und Stärken bitte vor Meilenstein 1 gegenprüfen –
> Stand muss ggf. an die aktuelle Saison angepasst werden.

### 8.2 Strecke: Red Bull Ring
- Länge ca. 4,318 km, 71 Runden, 10 Kurven
- 3 Zeitsektoren, mehrere Marshal-Sektoren (Anzahl wird bei der Umsetzung festgelegt)
- Streckenlayout als vereinfachter Pfad (Polyline) für die 2D-Karte
- Daten pro Kurve: Gefahrenpotenzial, typische Vorfälle (z. B. T3/T4 Überholduelle,
  Track Limits in T9/T10), Kiesbett/Asphalt-Auslauf
- Boxengasse inkl. Ein-/Ausfahrt

Jede Strecke ist eine eigene Datendatei → weitere Strecken später einfach ergänzbar.

---

## 9. Technik

- **Vanilla JS mit ES-Modulen**, kein Framework, kein Build-Schritt
- **Canvas** für die Streckenkarte, normales HTML für Tabellen/Feed/Dialoge
- **Simulation getrennt von der Darstellung** (Simulations-Tick unabhängig von der Bildrate)
- **Zufallsgenerator mit Seed** → Rennen reproduzierbar (hilft beim Testen)
- **Speicherung**: Einstellungen in localStorage, Spielstände/Saison in IndexedDB
- **PWA**: `manifest.webmanifest` + Service Worker für Offline-Betrieb
- **Deployment**: GitHub Pages

### Geplante Ordnerstruktur
```
index.html
manifest.webmanifest
sw.js
css/
  style.css
js/
  main.js              Einstieg, Game-Loop
  sim/                 Simulation (Autos, Rundenzeiten, Überholen, Vorfälle)
  control/             Rennleitung (Flaggen, SC/VSC, rote Flagge, Strafen)
  ui/                  Karte, Zeitentabelle, Feed, Fälle, Aktionsleiste
  data/
    teams.js
    drivers.js
    tracks/
      redbullring.js
  storage.js           localStorage / IndexedDB
docs/
  PLANUNG.md
```

---

## 10. Meilensteine

- [x] **M1 – Grundgerüst**: Seite + PWA-Basis, Red Bull Ring als 2D-Karte,
      22 Autos fahren im Zeitraffer, Zeitentabelle, Tempo/Pause
      (inkl. Startampel, Überholen in Zonen, Boxenstopps, Reifen, Meldungsfeed, Ergebnis)
- [ ] **M2 – Flaggen**: Marshal-Sektoren, gelb/doppelt gelb/grün setzen,
      Autos reagieren darauf
- [ ] **M3 – Neutralisierung**: VSC, Safety Car, rote Flagge inkl. Neustart
- [ ] **M4 – Vorfälle & Strafen**: Vorfälle generieren, Indizien, Untersuchung, Urteil,
      Strafen wirken sich aufs Ergebnis aus
- [ ] **M5 – Bewertung**: Bewertungsachsen, Reaktionen, Rennbericht
- [ ] **M6 – Speichern/Laden**: Rennen fortsetzen, Statistik
- [ ] **M7 – Saison**: weitere Strecken, Meisterschaftstabelle, Strafpunkte über die Saison
- [ ] **Später**: Wetter, Track Limits im Detail, Unsafe Release, blaue Flaggen,
      Boxengassen-Speeding, Replay-Animationen, Training/Qualifying, Desktop-Layout

---

## 11. Stand der Simulation (M1)

- Strecke: Spline aus Kontrollpunkten, Geschwindigkeitsprofil aus Kurvenradien
  plus Kurven-Höchstgeschwindigkeiten (`vmax` in den Streckendaten)
- Rundenzeit = Basiszeit + Team-/Fahrer-Abschlag + Reifenmischung + Abnutzung
  + Spritlast + Tagesform-Streuung (Konstanz)
- Überholen nur in Überholzonen (Bremszonen T1, T3, T4) mit Wahrscheinlichkeit
  aus Pace-Vorteil und Aggressivität; Überrundete machen Platz (blaue Flagge)
- Boxenstopps nach vorab geplanter Strategie (1- oder 2-Stopp), Pflicht: 2 Mischungen
- Startaufstellung aus simuliertem Qualifying
- Rennen-Nr. (Seed): gleiche Nummer = identisches Rennen

## 12. Offene Punkte

- Genaue Anzahl und Lage der Marshal-Sektoren am Red Bull Ring
- Konkrete Stärkewerte für Teams/Fahrer
- Reifenstrategien der CPU-Teams (Detailtiefe)
- Gewichtung der Bewertungsachsen
