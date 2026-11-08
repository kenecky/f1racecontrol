// Service Worker: macht das Spiel offline spielbar.
// Strategie "Netzwerk zuerst": neue Versionen kommen sofort an,
// ohne Netz wird die zuletzt geladene Version aus dem Cache genutzt.
// Wichtig: Andere Apps auf kenecky.github.io (z. B. Reise-Ausgaben) teilen sich den
// Cache-Speicher mit uns. Deshalb nur eigene Caches (Präfix 'f1rc-') löschen.
const PREFIX = 'f1rc-';
const CACHE = PREFIX + 'v20';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/storage.js',
  'js/util/rng.js',
  'js/sim/trackModel.js',
  'js/sim/race.js',
  'js/sim/hazards.js',
  'js/sim/incidents.js',
  'js/control/stewards.js',
  'js/control/rating.js',
  'js/ui/casesPanel.js',
  'js/ui/tower.js',
  'js/ui/trackArt.js',
  'js/sim/neutral.js',
  'js/sim/session.js',
  'js/sim/persist.js',
  'js/sim/length.js',
  'js/sim/start.js',
  'js/sim/scrutiny.js',
  'js/sim/texts.js',
  'js/sim/scenes.js',
  'js/ui/scenePlayer.js',
  'js/ui/sound.js',
  'js/sim/tyres.js',
  'js/sim/weather.js',
  'js/ui/controlPanel.js',
  'js/control/flags.js',
  'js/ui/flagPanel.js',
  'js/ui/map.js',
  'js/ui/timing.js',
  'js/ui/feed.js',
  'js/data/teams.js',
  'js/data/drivers.js',
  'js/data/tracks/redbullring.js',
  'js/data/tracks/albertpark.js',
  'js/data/tracks/bahrain.js',
  'js/data/tracks/baku.js',
  'js/data/tracks/barcelona.js',
  'js/data/tracks/cota.js',
  'js/data/tracks/hungaroring.js',
  'js/data/tracks/index.js',
  'js/data/tracks/interlagos.js',
  'js/data/tracks/jeddah.js',
  'js/data/tracks/lasvegas.js',
  'js/data/tracks/lusail.js',
  'js/data/tracks/madring.js',
  'js/data/tracks/mexico.js',
  'js/data/tracks/miami.js',
  'js/data/tracks/monaco.js',
  'js/data/tracks/montreal.js',
  'js/data/tracks/monza.js',
  'js/data/tracks/shanghai.js',
  'js/data/tracks/silverstone.js',
  'js/data/tracks/singapore.js',
  'js/data/tracks/spa.js',
  'js/data/tracks/suzuka.js',
  'js/data/tracks/yasmarina.js',
  'js/data/tracks/zandvoort.js',
  'js/data/season2026.js',
  'js/season/season.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })   // immer beim Server nachfragen (GitHub cacht sonst bis zu 10 Min.)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.open(CACHE).then(c => c.match(e.request).then(r => r || c.match('index.html'))))
  );
});
