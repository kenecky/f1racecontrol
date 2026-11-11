# F1 Race Control

Privates Browser-Spiel: Du bist die Rennleitung eines Formel-1-Rennens.
Flaggen, Safety Car, VSC, rote Flagge, Untersuchungen und Strafen –
Fahrer und Teams fahren automatisch.

- Optimiert fürs Handy (Hochformat), dazu Tablet quer und Desktop
- Reines HTML/CSS/JavaScript, läuft über GitHub Pages
- Daten werden lokal auf dem Gerät gespeichert

Planung und Fahrplan: [docs/PLANUNG.md](docs/PLANUNG.md)

## Spielen

Adresse: https://kenecky.github.io/racecontrol/ (früher `/f1racecontrol/`, Repo umbenannt).
Im Handy-Browser öffnen und über ⋮ → „Zum Startbildschirm hinzufügen“ → „Installieren“
als App installieren. Auf Tablet (quer) und Desktop gibt es eine eigene Ansicht mit Spalten.

Lokal testen (ES-Module brauchen einen Webserver):

```
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## Projektstruktur

```
index.html            Seite
css/style.css         Gestaltung
js/main.js            Game-Loop, Verbindung Simulation ↔ Oberfläche
js/sim/               Simulation (Strecke, Rennen)
js/ui/                Karte, Zeitentabelle, Meldungen
js/data/              Teams, Fahrer, Strecken (Werte frei anpassbar)
js/storage.js         Lokale Speicherung
sw.js                 Offline-Betrieb (PWA)
```

## Datenquellen

- Streckenverläufe aller 24 Strecken: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
  (MIT-Lizenz), siehe `THIRD_PARTY_NOTICES.md`. Erzeugt mit `tools/gen_tracks.py`.
