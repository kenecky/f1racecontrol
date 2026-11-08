// Service Worker: macht das Spiel offline spielbar.
// Strategie "Netzwerk zuerst": neue Versionen kommen sofort an,
// ohne Netz wird die zuletzt geladene Version aus dem Cache genutzt.
// Wichtig: Andere Apps auf kenecky.github.io (z. B. Reise-Ausgaben) teilen sich den
// Cache-Speicher mit uns. Deshalb nur eigene Caches (Präfix 'f1rc-') löschen.
const PREFIX = 'f1rc-';
const CACHE = PREFIX + 'v11';
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
  'js/sim/persist.js',
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
  'icons/icon-192.png',
  'icons/icon-512.png',
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
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.open(CACHE).then(c => c.match(e.request).then(r => r || c.match('index.html'))))
  );
});
