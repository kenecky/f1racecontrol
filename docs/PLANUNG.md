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
- [x] **M2 – Flaggen**: 12 Marshal-Sektoren, Grün/Gelb/Doppelt Gelb/Gelb-Rot setzen,
      Autos reagieren (langsamer, Überholverbot). Gefahren: Dreher, liegengebliebene
      Autos (Defekt / festgefahren), Trümmerteile nach Kontakt. Meldungen von Marshals
      und Fahrern, Hinweisbanner, Auto-Abbremsen auf 1×, Flaggen-Bilanz im Rennbericht
- [x] **Extras**: Tempo-Menü (1×–32× direkt wählbar), Zoom & Verschieben nur in der
      Streckenkarte, Seiten-Zoom gesperrt
- [x] **M3 – Neutralisierung**: VSC (inkl. „VSC endet“), Safety Car (Feld schließt auf,
      Zurückrunden der Überrundeten, „SC kommt in dieser Runde rein“, Neustart durch den
      Führenden, Überholen erst ab der Linie), rote Flagge (Boxengasse, freier Reifenwechsel,
      Neustart hinter SC oder stehend). Schwere Unfälle (SC / Barriere → Rot), Bergungstempo
      abhängig von der Reaktion, günstige Boxenstopps unter VSC/SC, Bilanz im Rennbericht
- [x] **M4 – Vorfälle & Strafen**: Kollisionen, Abdrängen, Überholen neben der Strecke,
      Team-Beschwerden, Track Limits, Speeding Boxengasse, Unsafe Release, Überholen unter
      Gelb, VSC-Delta. Fälle-Tab mit Beweisen (TV, Telemetrie, Position, Funk), Untersuchen /
      Keine Untersuchung / Nach dem Rennen, Urteil mit Strafpunkten. Strafen wirken im Rennen
      (Zeitstrafe beim Stopp oder am Ende, Durchfahrt, Stop & Go, Platz zurückgeben, DSQ).
      Bewertung jedes Urteils und Konsistenz-Prüfung im Rennbericht
- [x] **Extras**: Bereich unter der Karte wischbar (Strecke wird größer/gedreht),
      SC-Reinholen nur bis Sektor 6, SC baut in der Einfahrtsrunde Vorsprung auf
- [x] **M5 – Bewertung**: Gesamtnote (0–100, Sterne, Sehr gut … Mangelhaft) aus Sicherheit,
      Fairness, Konsistenz, Rennfluss; Stimmen zum Rennen (Teamchefs, Fahrer, GPDA, Presse);
      Live-Reaktionen der Teams auf Urteile; Verlauf der letzten Rennen auf dem Startbildschirm
- [x] **Beweise mehrdeutig**: Messwerte aus überlappenden Verteilungen, Leitlinien als
      Bezugspunkt, unklare Kamerawinkel, täuschende TV-Eindrücke, Fälle ohne Vergehen
- [x] **Extras (nach M5)**: echte Streckenführung des Red Bull Ring (bacinger/f1-circuits, MIT),
      Gras, Asphalt-/Kies-Auslaufzonen (Näherung), rot-weiße Randsteine, Boxengebäude,
      karierte Ziellinie; Ranking-Tower im TV-Stil; Massenunfälle (3–5 Autos, selten,
      bei Regen häufiger); Bergungsfortschritt auch im Banner und Flaggen-Panel;
      Zoom wird beim Ein-/Ausklappen zurückgesetzt; keine Team-Beschwerden gegen eigene Fahrer
- [x] **Anhörungen**: „Nach dem Rennen“ verschobene Entscheidungen zählen erst nach der Anhörung
      (Schilderungen der Fahrer + zusätzliche Onboard-/Teamdaten); Tab heißt „Entscheidungen“
- [x] **Wetter / Regenrennen**: Wetter Zufällig/Trocken/Regen/Wechselhaft, Streckennässe,
      Intermediates/Regenreifen mit Wechselstrategie der Teams, mehr Dreher/Unfälle/Massenunfälle
      bei Nässe, Wetterdienst-Meldungen, „zu viel Wasser“ (SC bzw. Rot), Start hinter dem SC,
      Regen und nasse Strecke auf der Karte
- [x] **Streckengrafik**: Luftbild-Stil mit Texturen, Auslaufzonen mit verjüngten Enden,
      Leitplanken/Reifenstapel, feine Randsteine, Boxenmauer und Garagen
- [x] **M6 – Speichern/Laden**: laufendes Rennen wird automatisch gespeichert (IndexedDB,
      alle 10 s, bei Pause und beim Verlassen der App) und lässt sich exakt fortsetzen – auch nach
      Rennende für offene Entscheidungen/Anhörungen; Statistik über alle Rennen (bis 100)
- [x] **M7 – Saison**: Kalender 2026 mit allen 24 Strecken (echte Streckenführungen aus
      bacinger/f1-circuits; Kurven, Zonen, Sektoren, Boxengasse, Auslaufzonen automatisch erzeugt
      mit `tools/gen_tracks.py`), Fahrer- und Teamwertung (25-18-15-12-10-8-6-4-2-1),
      Strafpunkte über die Saison (12 → Rennsperre), Verwarnungen (5 → 10 Startplätze),
      Startplatzstrafen fürs nächste Rennen, Einzelrennen auf jeder Strecke
- [x] **Rennwochenende**: Freies Training (20 Min.), Qualifying Q1–Q3 (10/8/7 Min., je 6 scheiden aus),
      Sprint-Wochenenden (FP, Sprint-Quali SQ1–SQ3, Sprint ~100 km mit Punkten 8–1, Quali, Rennen);
      Autos aus der Garage mit Aufwärm-/schnellen/Auslaufrunden, Session-Uhr steht bei Rot,
      Entscheidungen „Rundenzeit streichen“ und „Behinderung“; im Saisonmodus alles Pflicht
- [x] **Platz zurückgeben ignoriert**: wird zur neuen Entscheidung (Verwarnung bis DSQ)
- [x] **Strafpunkte wie in echt** (12 Monate gültig, über Saisons hinweg; nach Sperre −12) und
      nicht abbaubare Startplatzstrafen als Zeitstrafe (1–5 Plätze: 5 s, 6–10: 10 s, mehr: Durchfahrt)
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

### Flaggen & Gefahren (M2)
| Flagge | Wirkung auf die Autos |
|---|---|
| Gelb | ca. 8 % langsamer im Sektor, Überholverbot |
| Doppelt Gelb | ca. 20 % langsamer im Sektor, Überholverbot |
| Gelb-Rot | ca. 3 % langsamer, Überholen erlaubt |

| Gefahr | Angemessene Flagge | Dauer |
|---|---|---|
| Kurzer Dreher (Auto fährt weiter) | Gelb (nicht zwingend) | 6–14 s |
| Auto steht hinter Leitplanke / weit im Auslauf | Gelb | Bergung 70–180 s |
| Auto steht ungeschützt neben der Fahrbahn | Doppelt Gelb | Bergung 70–180 s |
| Trümmerteile | Gelb oder Gelb-Rot | 40–110 s |

### Neutralisierung & Bergung (M3)
Jede Gefahr hat eine nötige Stufe: Gelb → Doppelt Gelb → VSC → Safety Car → Rote Flagge.
Die Bergung läuft umso schneller, je stärker neutralisiert ist. Ist die Reaktion zu schwach,
kommen die Marshals kaum voran (Barrierenschaden: ohne Rot praktisch keine Reparatur).

| Gefahr | Nötig | Bergung (bei passender Reaktion) |
|---|---|---|
| Auto quer am Streckenrand, Kran muss auf die Strecke | VSC | 70–170 s |
| Schwerer Unfall, Trümmerfeld | Safety Car | 150–240 s |
| Schwerer Unfall, Barriere beschädigt | Rote Flagge | 6–10 min |

Tempo: VSC ≈ 62 % der Renngeschwindigkeit, Safety Car ≈ 60 %, Weg in die Box bei Rot ≈ 55 %.
„Unnötige Neutralisierung“ zählt VSC/SC/Rot-Zeit ohne passende Gefahr
(Kulanz nach Freigabe: VSC 25 s, SC 200 s, Rot 150 s).

### Vorfälle & Strafen (M4)
Pro Rennen entstehen ca. 6–8 Fälle. Jeder Fall hat eine interne Wahrheit (Verantwortlicher,
angemessene Strafe, übliche Strafpunkte). Die Beweise führen dorthin, können aber unklar
(Signalaussetzer) oder parteiisch (Funk) sein.

| Fall | Schuld (Wahrscheinlichkeit) | Angemessen |
|---|---|---|
| Kollision | Angreifer 50 %, Verteidiger 20 %, Rennunfall 30 % | leicht: Verwarnung/5 s · Schaden: 5–10 s · Ausfall: 10 s · Rennunfall: keine |
| Abdrängen | Verteidiger 55 %, sonst kein Vergehen | 5 s |
| Überholen neben der Strecke | Angreifer (40 % geben freiwillig zurück) | Platz zurückgeben oder 5 s; zurückgegeben: keine |
| Team-Beschwerde | kein Vergehen | keine |
| Track Limits | 3./4./5.+ Verstoß | S/W-Flagge / 5 s / 10 s |
| Speeding Boxengasse | Fahrer | 5 s |
| Unsafe Release | Team/Fahrer | Verwarnung–5 s (mit Kontakt 5–10 s) |
| Überholen unter Gelb | Fahrer | Gelb: 5–10 s · Doppelt Gelb: 10 s–Durchfahrt |
| VSC-Delta | Fahrer | 5 s (knapp: Verwarnung) |

Durchfahrt/Stop & Go mit weniger als 3 Runden Rest bzw. nach dem Rennen → +20 s / +30 s.

### Bewertung (M5)
| Achse | Gewicht | Abzüge |
|---|---|---|
| Sicherheit | 35 % | verpasste Gefahr: Gelb 10, Doppelt Gelb 15, VSC 18, SC 25, Rot 35 · zu spät: anteilig |
| Fairness | 35 % | zu mild/zu hart 9 · Strafe ohne Vergehen 12 · falscher Fahrer 15 · offen 15 |
| Konsistenz | 15 % | je inkonsequente Fallgruppe 15 · Strafpunkte-Abweichung >1: 5 (nur bewertbar mit vergleichbaren Urteilen) |
| Rennfluss | 15 % | 1 je 10 s unnötig Gelb · 1 je 6 s unnötige Neutralisierung · 8 je überzogener Reaktion |

Noten: ≥ 90 Sehr gut (5★) · ≥ 78 Gut · ≥ 64 Befriedigend · ≥ 50 Ausreichend · darunter Mangelhaft.

Bewertung (Vorstufe zu M5): rechtzeitig = angemessene Flagge innerhalb von 20 s;
zusätzlich wird „unnötig gelb“ gemessen (Flagge ohne Gefahr, 10 s Kulanz nach Freigabe).

## 12. Offene Punkte

- Marshal-Sektoren: aktuell 12 (vereinfacht), ggf. an echte Einteilung anpassen
- Auslaufzonen/Grasflächen genauer: OpenStreetMap-Daten (Server in der Cloud-Umgebung derzeit gesperrt)
- Konkrete Stärkewerte für Teams/Fahrer
- Reifenstrategien der CPU-Teams (Detailtiefe)
- Gewichtung der Bewertungsachsen


## 13. Offene Planung

### Strafen für ausgeschiedene Fahrer (umgesetzt als Vorschlag, anpassbar)
Kann eine Strafe im Rennen nicht mehr wirken, weil der Fahrer ausgeschieden ist,
wird sie in eine Startplatzstrafe für das nächste Rennen umgewandelt:

| Strafe | Umwandlung |
|---|---|
| 5-s-Zeitstrafe / Platz zurückgeben | 3 Startplätze |
| 10-s-Zeitstrafe | 5 Startplätze |
| Durchfahrtsstrafe | 5 Startplätze |
| 10-s-Stop-and-Go | 10 Startplätze |
| Disqualifikation | keine Umwandlung (Ergebnis gestrichen) |

Zusätzlich direkt wählbar: Startplatzstrafe 3 / 5 / 10 Plätze. Strafpunkte bleiben die Saison
über bestehen; 12 Punkte → Sperre für ein Rennen (danach −12). 5 Verwarnungen → 10 Startplätze.

### Training & Qualifying (noch zu besprechen)
Siehe Gespräch – Ideen: Rennwochenende mit FP1–FP3 (Track Limits, Unsafe Release,
Behinderung, rote Flaggen ohne Neustart-Druck), Qualifying Q1–Q3 mit Ausscheiden,
gestrichenen Rundenzeiten, Behinderungen (Blocking), gelben Flaggen, die Runden zerstören.

### Dauer (umgesetzt)
Option „Dauer“ im Startbildschirm: **Kurz** (¼ Renndistanz, FP 8 Min., Q 5/4/3 Min.),
**Mittel** (½ Renndistanz, FP 12 Min., Q 7/6/5 Min., Standard) und **Lang** (volle Distanz,
FP 20 Min., Q 10/8/7 Min.). Bei kürzerer Distanz verschleißen die Reifen entsprechend schneller,
Boxenstopp-Runden werden als Anteil der Distanz geplant; Zwischenfälle pro Runde etwas häufiger.
Training/Qualifying-Abschnitte enden mit der letzten gezeiteten Runde (Auslaufrunden laufen in der Pause).

### Startablauf (umgesetzt)
- Die Rennleitung steuert den Start selbst: **Formationsrunde freigeben** → **Startampel einschalten**
  (erst wenn alle Autos in ihren Startboxen stehen, sonst großer Abzug bei Sicherheit) → 5 s Pre-Start,
  fünf rote Lichter im Sekundentakt → **Lichter aus** per Klick. Üblich: bis 3 s nach dem fünften Licht;
  längeres Warten kostet Punkte (Rennfluss) und macht Fehlstarts wahrscheinlicher, nach 8 s gehen die Lichter automatisch aus.
- **Formationsrunde** vor jedem stehenden Start. Möglich: Auto kommt nicht los (→ Boxengassenstart),
  technischer Defekt (Ausfall, Gefahr absichern), Dreher beim Reifenaufwärmen (→ Start vom Ende des Feldes).
- **Abgestorbener Motor in der Startaufstellung**: Die Ampel wartet auf die Rennleitung –
  Start abbrechen (Extra-Formationsrunde, Distanz −1 Runde, Auto startet aus der Boxengasse),
  Start hinter dem Safety Car oder Start trotzdem freigeben (gefährlich, Abzug bei Sicherheit).
- **Fehlstart**: Auto bewegt sich vor dem Erlöschen der Lichter (Transponder, Weg, Stillstand beim Signal;
  kurzes Zucken innerhalb der Toleranz ist kein Fehlstart).
- **Falsche Startposition**: Auto steht über der Linie der Startbox (üblich 5 s).

### Technische Abnahme (umgesetzt, vereinfacht)
Nach Rennen und Sprint prüft die FIA die Top 3, die Rennleitung kann bis zu 3 weitere Autos wählen.
Geprüft wird (vereinfachte Werte nach Reglement 2026):
- Mindestgewicht 768 kg (inkl. Fahrer, ohne Kraftstoff)
- Kraftstoffprobe: mindestens 1,0 l muss entnommen werden können
- Unterboden-Planke: neu 10 mm, nach dem Rennen an jedem Messpunkt mindestens 9,0 mm
- Antriebsleistung: MGU-K max. 350 kW (FIA-Sensor, Sensorfehler möglich)
- Flügel-Belastungstest (Durchbiegung unter Prüflast)
Klare Werte sind sofort erledigt; Grenzfälle werden zu Entscheidungen (keine Strafe / Verwarnung / Disqualifikation).
Erst nach der Abnahme kann das Ergebnis in die Saison übernommen werden.
Ideen für später: Reifendruck-Kontrolle vor dem Start, Parc-fermé-Verstöße (→ Boxengassenstart),
schwarz-orange Flagge für beschädigte Autos, Kraftstofftemperatur, Verhalten unter Rot.

### Fahrerverhalten nach Strafen (umgesetzt)
Jede Strafe macht einen Fahrer vorsichtiger (im Rennen sofort, in der Saison über aktive Strafpunkte
und Verwarnungen): weniger riskante Manöver und Fehler, aber bis zu 0,3 s pro Runde langsamer.

### Fahrer verfolgen (umgesetzt)
Klick auf einen Fahrer im Tower: Karte zoomt auf ihn und folgt ihm, oberhalb der Karte erscheinen
seine Details, der Bereich unten wird eingeklappt. ✕ oder erneuter Klick beendet das Verfolgen.

### Rennszenen (umgesetzt, erste Stufe)
Kollision, Abdrängen und Überholen neben der Strecke werden als kurze Draufsicht nachgestellt
(Fahrzeug-Variante C, siehe docs/fahrzeug_varianten.png). Die Szene entsteht aus dem tatsächlichen
Ablauf des Vorfalls. In der Entscheidungskarte zuerst unscharfes TV-Bild, nach „Untersuchen“ scharfe
Übersicht mit Hilfslinien (Überlappung/Spiegel-Linie, Streckenbegrenzung). Dazu Vollbild, Zeitlupe,
Zeitleiste und „🗺“ = Wiederholung auf der großen Karte (Rennen pausiert so lange).
Später: Massenunfall, Überholen unter Gelb, unsichere Freigabe, Fehlstart.

### Meldungen und Funk (umgesetzt)
Filter in „Meldungen“: Alle (ohne Funk) · Rennleitung · Strecke · Funk. Funksprüche als Blasen in Teamfarbe,
Helm = Fahrer, Kopfhörer = Team.

### Ton (umgesetzt, erste Stufe)
Alle Geräusche werden im Browser erzeugt (Web Audio, keine Dateien): Motoren des Feldes (Leerlauf in der
Startaufstellung, Formationsrunde, Aufheulen beim Start, leiser unter SC/VSC), Startampel-Töne, Funk-Knacken,
Hinweise für neue Vorfälle/Entscheidungen, VSC/SC/Rot, Zielflagge. Schalter „Ton“ im Tempo-Menü.
Option für später: echte Aufnahmen (z. B. CC0-Lizenz von freesound.org) für realistischere Motoren.

### Kontrollraum-Design (umgesetzt)
Grundlook wie Timing-Software (Monitore, Festbreitenschrift JetBrains Mono, Farbe nur als Status),
Statusanzeige auf Englisch (TRACK GREEN, YELLOW S7, SAFETY CAR, RED FLAG …), RC LOG im Stil der
Race-Control-Messages (Uhrzeit, Kürzel, Großbuchstaben). Pult mit beleuchteten Tastern (leuchten bei aktiver
Maßnahme), rote Flagge unter Schutzklappe, VSC/SC/Rot mit ARM → zweiter Druck löst aus.
Menüs als Konsolen zwischen Karte und Pult. Entscheidungen als Stewards-Dokumente mit Exhibits und Stempel.

### Nach dem Rennen (umgesetzt)
Vor dem Ergebnis erscheint automatisch „POST-RACE · STEWARDS“: alle offenen Entscheidungen einzeln
nacheinander (verschobene Fälle direkt als Anhörung), danach die technische Abnahme, dann das Ergebnis mit Bewertung.
Neue Fälle mit Rennszene: unsichere Boxenfreigabe (jetzt auch mit „kein Vergehen“) und unsichere Rückkehr auf die Strecke.

### Startbildschirm Einzelrennen (umgesetzt)
Grand-Prix-Liste (scrollbar) mit Streckenvorschau, Runden und km; darunter Wetter, Teile des Wochenendes
(FP, Qualifying, Sprint inkl. Sprint-Qualifying, Rennen – laufen nacheinander, Startaufstellung und Strafen
werden weitergegeben) und Dauer. Start immer stehend.

### Wetter-Fenster (umgesetzt)
Antippen von Uhr/Wetter oben: aktueller Regen, Streckennässe, Vorhersage +5/+15/+30/+60 min, Regenradar
(Strecke als Linie in der Mitte, Regenzellen ziehen mit dem Wind darüber, Farbskala hellblau → rot) mit Zeitregler bis +60 min.
Das Radar wird aus dem festgelegten Regenverlauf abgeleitet und passt daher zur Vorhersage.
Außerdem: Massenunfall mit Rennszene, Wochenend-Regeln im Startbildschirm (Rennen immer dabei).

### Neustart nach Rot, Defekt-Rückfahrt (umgesetzt)
Stehender Neustart: Autos verlassen die Boxengasse in Rennreihenfolge, Formationsrunde, Startaufstellung,
Ampel und „Lichter aus“ durch die Rennleitung (wie beim Start). Motorengeräusch bei Rot erst aus, wenn alle stehen.
Technischer Defekt mit Notlauf: Auto rollt langsam zur Box (wandernde Gefahr – Gelb von Sektor zu Sektor),
wird in der Garage abgestellt.

### Große Erweiterung (umgesetzt)
- Kontrollpult zum Aufklappen (FLAGS, VSC, SC, RED, MEDICAL, SWEEPER, CRANE, PIT LANE, BLK/ORG), Leiste mit Statuslampen.
- Einsatzfahrzeuge nur sichtbar, wenn im Einsatz: Safety Car, Medical Car (Regel: vorher SC), Kehrmaschine (Regel: vorher SC),
  Bergungskran je Sektor (falscher Sektor bzw. Kran ohne Absicherung kostet Punkte), Boxengasse sperren, Medical Car in Runde 1.
- Gefahren: Ölspur, loses Rad (Boxengasse oder erste Kurven), Feuer, Tier, Person, Kanaldeckel (Stadtkurse ~1×/Saison),
  loser Randstein, Kies, Marshal auf der Strecke, verlorene Teile, Schwarz-Orange-Flagge, Unfall in der Boxengasse.
- Wetter: Gewitter, Rettungshubschrauber, Regen in der Startaufstellung, stehendes Wasser, Hitze (heiße Strecken).
- Entscheidungen: blaue Flaggen, Gelb missachtet, Weben, Bremstest, SC-Phasen (Auffahren, Überholen, Abstand), Neustart,
  Schikane, unsicher abgestellt, Boxenlinie, geschlossene Boxengasse, Arbeiten unter Rot, Stau in der Boxengasse,
  absichtlich abgestellt (Quali), zu langsame Aufwärmrunde, Schimpfwörter.
- Reglement: Reifenregel, Parc fermé (Boxengassenstart), Abnahme nach dem Qualifying, Antriebseinheiten (Saison),
  Energiefluss, aktive Aero, Overtake-Modus, Reifendruck, Mechaniker in der Startaufstellung, zu spät in der Aufstellung.
- Rennende: Abbruch unter Rot mit Wertung (gestaffelte Punkte), Zeitlimit; Session nach Rot beenden.
- Nach dem Rennen: Proteste und Anträge auf Überprüfung mit neuen Beweisen (Urteil bleibt / aufheben / ersetzen).
- Fahrerbesprechung vor dem Rennen: Track-Limits-Kurven festlegen.
- Saison: Ruf der Rennleitung bei den Teams, Medienecho.

### Schwierigkeitsgrad (v33, nur Einzelrennen – Saison immer „Schwer“)
| | Leicht | Mittel | Schwer |
|---|---|---|---|
| Anteil der Fälle | 60 % | 85 % | 100 % |
| Streuung der Messwerte | ×0,5 | ×0,8 | ×1 |
| TV-Eindruck stimmt | 90 % | 78 % | 65 % |
| Pause | automatisch bei jedem neuen Fall | frei | gesperrt, solange Fälle neu/in Untersuchung sind |
| Proteste / Überprüfungen | keine | nur Proteste | beides |

Nicht auf „Mittel“ (und „Leicht“): Energiefluss, aktive Aero, Overtake-Modus, Reifendruck, Mechaniker in der
Startaufstellung, Parc fermé, absichtlich abgestellt (Quali), zu langsame Aufwärmrunde, Arbeiten unter Rot,
unregelmäßiger Neustart, Schimpfwörter, Behinderung in der Boxengasse.

Zusätzlich nicht auf „Leicht“: Beschwerde eines Teams, Richtungswechsel, Bremstest, blaue Flaggen, Gelb missachtet,
unsichere Rückkehr, Berührung hinter dem SC, Überholen unter SC/VSC, Abstand zum SC, VSC-Delta, Schikane abgekürzt,
Auto unsicher abgestellt, Linie an der Boxengasse, Überholen in der Aufwärmrunde, falsche Startposition, Proteste –
außerdem keine Ereignisse Gewitter, Rettungshubschrauber, Gullydeckel, Person und Streckenposten auf der Strecke.

Vibration bei neuen Vorfällen/Entscheidungen: im Tempo-Menü abschaltbar.

### Fahrerakte, Präzedenzfälle, Urteil revidieren, Mitteilungen (v34)
- **Fahrerakte (nur Saison):** Strafpunkte der letzten 12 Monate, Verwarnungen und die letzten Strafen – in der Fahrerkarte
  und als Beweisstück „DRIVER RECORD“ in jedem Fall (nach Untersuchungsbeginn).
- **Präzedenzfälle:** Beweisstück „PRECEDENTS“ mit bis zu 4 früheren Urteilen derselben Fallart (dieses Rennen, in der
  Saison auch frühere Rennen; gespeichert werden die letzten 150).
- **Urteil revidieren:** einmal je Fall, zweistufig bestätigt. Strafe wird zurückgenommen (bereits verbüßte bleiben),
  der Fall geht zurück in die Untersuchung (nach dem Rennen: Anhörung). Kosten: Konsistenz −8 je Revision,
  Pressestimme, in der Saison Ruf −1,5 bei allen Teams.
- **RC MSG (Mitteilungen an alle Teams):** Gelbe Flaggen, Blaue Flaggen, Fahrverhalten in Zweikämpfen (Richtungswechsel,
  Bremstests), Tempolimit Boxengasse → Verstöße 10 bzw. 15 Minuten lang halb so häufig, wiederholte Warnungen wirken
  schwächer (bis 20 %). Track Limits: weitere Kurve während des Rennens überwachen lassen.

### Folgen ungesicherter Gefahren, Teamstrategie unter SC/VSC (v35)
- **Reifenschaden durch Trümmer:** Wer durch einen Sektor mit Trümmerteilen fährt, kann einen Reifenschaden bekommen
  (abgesichert 1 %, nicht ausreichend abgesichert 4 % je Durchfahrt, unter Neutralisierung halbiert). Ungesichert: Sicherheit −4.
- **Folgeunfälle:** An nicht ausreichend abgesicherten Stellen (Unfall, stehendes Auto, Öl, Wasser, Kies, Tier, Person,
  Marshals, Trümmer …) kann ein weiteres Auto verunglücken (Dreher, 30 % Ausfall) – Sicherheit −12, Stimme der GPDA.
  Vorher oft ein Funkspruch „Das war knapp!“ als Warnung.
- **Strategie unter VSC/SC:** Funksprüche „Box, box – wir nutzen das Safety Car!“ bzw. „Bleib draußen“; in der VSC-/SC-Konsole
  steht, wer an der Box war und wer draußen geblieben ist.

### Statistik je Strecke, Überholen vor der Linie, Berufungsgericht (v36)
- **Statistik je Strecke:** Tabelle im Statistik-Fenster (Rennen, Ø-Punkte, Bestwert, Gefahren und Fälle pro Rennen,
  SC+VSC/Rot). Neue Einträge speichern Strecke, Schwierigkeitsgrad und ob es ein Saisonrennen war.
- **Überholen vor der Linie (Aufwärmrunde, Qualifying/Sprint-Qualifying):** etwa ein Fall pro Qualifying;
  Beweise: Ort vor der Linie, Tempounterschied, Funk. Angemessen: Verwarnung bis 3 Startplätze. Ab „Mittel“.
- **Berufungsgericht (nur Saison):** Gegen schwere Strafen (10 s, Durchfahrt, Stop-and-Go, DSQ, ab 5 Startplätzen)
  legen Teams Berufung ein (falsches Urteil 75 %, zu hart 50 %, angemessen 6 %, höchstens 2 je Rennen).
  Entscheidung zwei Rennen später: Falsche/zu harte Urteile werden aufgehoben – WM-Punkte (soweit berechenbar:
  Platz ohne die Zeitstrafe bzw. DSQ) und Strafpunkte werden korrigiert, Ruf: betroffenes Team +4, alle anderen −0,5.
  Abgewiesene Berufung: Team −1. Übersicht im Saison-Reiter „Ruf“.

### Wiederholung des ganzen Rennens (v37)
- Aufzeichnung alle 2 s Rennzeit (Position, Runde, Status je Auto, Reihenfolge, Flaggen je Sektor, VSC/SC/Rot, Safety Car),
  nur Rennen und Sprint. Gespeichert wird nur das letzte Rennen in IndexedDB (≈ 25 KB pro Runde), Zwischenstand alle 30 s,
  ein fortgesetztes Rennen setzt die Aufzeichnung fort.
- Wiedergabe im Vollbild (Ergebnis: „▶ Replay des Rennens“, Startbildschirm: „Replay ›“): Karte mit allen Autos,
  Ranking zum Zeitpunkt (antippen = verfolgen), Zeitleiste mit Bändern für VSC/SC/Rot und Markierungen für Vorfälle,
  Fälle, Führungswechsel und Zielflagge, Tempo 4×/16×/32×/64×, Ereignisliste zum Springen (6 s vor dem Ereignis).

### Kontrollpult und Entscheidungen im Vollbild (v38)
- **Kontrollpult („CONTROL ▲“):** Vollbild mit Kopfzeile (Runde, Uhr), Live-Karte (Sektor antippen → Flaggen),
  Konsolenwahl (10 Schalter, LED = aktiv, Rahmen = gewählt), Details der Konsole (beim SC: Kennzahlen, Strategie,
  Track Status mit Bergung und Einsatzfahrzeugen) und Aktionsknöpfen unten am Daumen. Öffnet die Konsole zur aktuellen
  Meldung, sonst die zuletzt benutzte. Das Rennen läuft weiter.
- **Entscheidungen (Reiter „DECISIONS“):** Vollbild-Liste mit Live-Zeile (Runde, Status, Tempo, „Pause gesperrt“ auf
  Schwer), Zählern (neu, in Untersuchung, nach dem Rennen, entschieden), Filter OFFEN/ENTSCHIEDEN/ALLE und Knopf
  „Nächsten neuen Fall öffnen“. Fall im Vollbild: Dokument mit großer Szene, ‹ › zum Blättern, Urteil fest unten.

### Startablauf im Desk, Medical Car, Szene Boxengasse (v39)
- **Start-Konsole (Schalter „START“ im Desk):** öffnet sich beim Rennstart automatisch. Ablaufleiste
  (Freigabe → Formation → Grid → Ampel → Start), Autos in der Startbox, Startampel mit fünf Lichtern, großer Knopf unten:
  FORMATIONSRUNDE FREIGEBEN → STARTAMPEL EINSCHALTEN → LIGHTS OUT. Probleme in der Startaufstellung (Motor aus, Regen)
  mit Startabbruch / Start hinter dem SC hier. Gilt auch für den stehenden Neustart nach Rot. Der Knopf auf der Karte
  öffnet die Start-Konsole; nach Lights out schließt der Desk nach 1,5 s.
- **Medical Car der ersten Runde:** fährt an der Boxeneinfahrt am Ende von Runde 1 hinein (vorher erst nach Runde 2).
- **Szene Unsafe Release:** Garagen, Linien und Randsteine sind fest an der Strecke verankert (vorher wanderte das
  Strichmuster mit der Kamera und wirkte rückwärts). Garagen als einzelne Boxen mit farbiger Kante.
