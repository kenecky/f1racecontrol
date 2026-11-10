// Lokale Speicherung auf dem Gerät.
// Einstellungen und Verlauf: localStorage · laufendes Rennen: IndexedDB (Fallback localStorage).
const KEY = 'f1rc.settings.v1';

const DEFAULTS = {
  speed: 4,
  gapMode: 'leader',   // 'leader' | 'interval'
  showLabels: false,
  slowOnIncident: true,  // bei neuen Vorfällen auf 1× abbremsen
  panelCollapsed: false, // Zeiten/Meldungen/Entscheidungen eingeklappt
  showTower: true,       // Ranking-Tower in der Karte
  weatherMode: 'random', // Wetter: random | dry | rain | changeable
  mode: 'single',        // single | season
  trackId: 'redbullring', // Strecke im Einzelrennen
  startMode: 'standing', // Start: standing | sc (hinter dem Safety Car)
  length: 'medium',      // Dauer: short | medium | full
  difficulty: 'medium',  // Einzelrennen: easy | medium | hard (Saison immer hard)
  vibrate: true,         // Vibration bei neuen Vorfällen
};

const HISTORY_KEY = 'f1rc.history.v1';

// Bewertungen der letzten Rennen (neueste zuerst, max. 100)
export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry) {
  try {
    const list = loadHistory().filter(e => e.key !== entry.key);
    list.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    // Speicher nicht verfügbar – ignorieren
  }
}

const SEASON_KEY = 'f1rc.season.v1';

export function loadSeason() {
  try {
    const raw = localStorage.getItem(SEASON_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSeason(season) {
  try { localStorage.setItem(SEASON_KEY, JSON.stringify(season)); } catch { /* egal */ }
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* egal */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Speicher nicht verfügbar (z. B. privater Modus) – ignorieren
  }
}

// ---------- Spielstand (laufendes Rennen) ----------

const DB_NAME = 'f1rc';
const STORE = 'saves';
const SAVE_KEY = 'current';
const LS_SAVE = 'f1rc.save.v1';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('kein IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req && req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export async function saveRaceState(data) {
  try {
    await idb('readwrite', st => st.put(data, SAVE_KEY));
  } catch {
    try { localStorage.setItem(LS_SAVE, JSON.stringify(data)); } catch { /* voll/gesperrt */ }
  }
}

export async function loadRaceState() {
  try {
    const d = await idb('readonly', st => st.get(SAVE_KEY));
    if (d) return d;
  } catch { /* weiter mit Fallback */ }
  try {
    const raw = localStorage.getItem(LS_SAVE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearRaceState() {
  try { await idb('readwrite', st => st.delete(SAVE_KEY)); } catch { /* egal */ }
  try { localStorage.removeItem(LS_SAVE); } catch { /* egal */ }
}

// ---------- Wiederholung des letzten Rennens (nur eines, in IndexedDB) ----------
const REPLAY_KEY = 'replay';
export async function saveReplay(data) {
  try { await idb('readwrite', st => st.put(data, REPLAY_KEY)); } catch { /* nicht verfügbar */ }
}
export async function loadReplay() {
  try { return (await idb('readonly', st => st.get(REPLAY_KEY))) || null; } catch { return null; }
}
