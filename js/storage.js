// Lokale Speicherung auf dem Gerät.
// Einstellungen: localStorage. Spielstände/Saison folgen später in IndexedDB.
const KEY = 'f1rc.settings.v1';

const DEFAULTS = {
  speed: 4,
  gapMode: 'leader',   // 'leader' | 'interval'
  showLabels: false,
  slowOnIncident: true,
  panelCollapsed: false, // Zeiten/Meldungen/Fälle eingeklappt // bei neuen Vorfällen auf 1× abbremsen
};

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
