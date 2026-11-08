# F1 Race Control

Privates Browser-Spiel: Du bist die Rennleitung eines Formel-1-Rennens.
Flaggen, Safety Car, VSC, rote Flagge, Untersuchungen und Strafen –
Fahrer und Teams fahren automatisch.

- Optimiert fürs Handy (Hochformat)
- Reines HTML/CSS/JavaScript, läuft über GitHub Pages
- Daten werden lokal auf dem Gerät gespeichert

Planung und Fahrplan: [docs/PLANUNG.md](docs/PLANUNG.md)

## Spielen

Über GitHub Pages im Handy-Browser öffnen und über „Zum Startbildschirm hinzufügen“
als App installieren.

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

- Streckenverlauf: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT-Lizenz),
  siehe `THIRD_PARTY_NOTICES.md`
