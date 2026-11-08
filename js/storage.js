// Lokale Speicherung auf dem Gerät.
// Einstellungen: localStorage. Spielstände/Saison folgen später in IndexedDB.
const KEY = 'f1rc.settings.v1';

const DEFAULTS = {
  speed: 4,
  gapMode: 'leader',   // 'leader' | 'interval'
  showLabels: false,
  slowOnIncident: true,
  panelCollapsed: false,
  showTower: true,       // Ranking-Tower in der Karte // Zeiten/Meldungen/Fälle eingeklappt // bei neuen Vorfällen auf 1× abbremsen
};

const HISTORY_KEY = 'f1rc.history.v1';

// Bewertungen der letzten Rennen (neueste zuerst, max. 20)
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // Speicher nicht verfügbar – ignorieren
  }
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
