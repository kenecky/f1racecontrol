// Meldungsfeed (neueste oben)
export const WARN_ICON = '<svg class="warn-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
  + '<path d="M12 2.5 23 21.5H1Z" fill="#ffd12e" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/>'
  + '<rect x="11" y="8.5" width="2" height="7.2" rx="1" fill="#000"/><circle cx="12" cy="18.4" r="1.25" fill="#000"/></svg>';

// Fahrerhelm (Funk vom Fahrer) und Kopfhörer (Funk vom Team)
export const HELMET_ICON = '<svg class="fk-icon" viewBox="0 0 24 24" width="18" height="18" aria-label="Fahrer">'
  + '<path d="M3 14.5C3 8.7 7.4 4 13 4c4.6 0 8 3.4 8 8v3.5c0 1.4-1.1 2.5-2.5 2.5H9.5L7 20H4.5C3.7 20 3 19.3 3 18.5Z" fill="currentColor"/>'
  + '<path d="M11 9.5h8.6c.3.8.4 1.6.4 2.5v1.5h-7.5A1.5 1.5 0 0 1 11 12Z" fill="#0b0f17"/></svg>';
export const HEADSET_ICON = '<svg class="fk-icon" viewBox="0 0 24 24" width="18" height="18" aria-label="Team">'
  + '<path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" stroke-width="2.2"/>'
  + '<rect x="2.5" y="13" width="5" height="7" rx="2" fill="currentColor"/><rect x="16.5" y="13" width="5" height="7" rx="2" fill="currentColor"/>'
  + '<path d="M19 20c0 1.5-2 2.3-5 2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="13.5" cy="22.2" r="1.3" fill="currentColor"/></svg>';

// Kategorien für den Filter: Rennleitung, Strecke, Funk
const CAT = {
  rc: 'rc', case: 'rc', start: 'rc', info: 'rc', chequered: 'rc', finish: 'rc',
  marshal: 'track', overtake: 'track', fastest: 'track', pit: 'track', weather: 'track', tl: 'track',
  radio: 'radio',
};
export const FEED_FILTERS = [
  { id: 'all', label: 'ALL' },
  { id: 'rc', label: 'RACE CONTROL' },
  { id: 'track', label: 'TRACK' },
  { id: 'radio', label: 'RADIO' },
];

// Kürzel statt bunter Symbole (wie im Race-Control-Protokoll)
const TAGS = {
  info: ['INF', ''], start: ['STA', 'g'], overtake: ['OVT', ''], fastest: ['FL', 'p'], pit: ['PIT', 'b'],
  chequered: ['FIN', ''], finish: ['FIN', ''], radio: ['RAD', ''], rc: ['RC', 'w'], case: ['DOC', 'y'],
  tl: ['TL', 'y'], weather: ['WX', 'b'],
};
const tagHtml = type => {
  if (type === 'marshal') return WARN_ICON;
  const [t, c] = TAGS[type] || ['•', ''];
  return `<span class="msg-tag ${c}">${t}</span>`;
};
const clock = t => {
  if (t === undefined || t < 0) return 'PRE';
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

export class Feed {
  constructor(el, { colorOf = () => null } = {}) {
    this.el = el;
    this.lastId = 0;
    this.colorOf = colorOf;
  }

  // Funkspruch: „Funk VER: …“ oder „Teamfunk Red Bull Racing an VER: …“
  radioHtml(e) {
    const m = e.text.match(/^(?:Teamfunk (.+?)(?: an (\w+))?|Funk (\w+)): „([\s\S]*)“$/);
    if (!m) return null;
    const team = Boolean(m[1]);
    const id = team ? m[2] : m[3];
    const col = (id && this.colorOf(id)) || '#3d8bff';
    const who = team ? `${escapeHtml(m[1])}${id ? ` → ${id}` : ''}` : id;
    return `
      <li class="msg-fk${team ? ' team' : ''}" data-cat="radio">
        <span class="fk-bar" style="background:${col}"></span>
        <div class="fk-body">
          <div class="fk-who"><b>${team ? HEADSET_ICON : HELMET_ICON}${who}</b><span>${clock(e.t)}${e.lap ? ` · L${e.lap}` : ''}</span></div>
          <div class="fk-txt">„${escapeHtml(m[4])}“</div>
        </div>
      </li>`;
  }

  reset() {
    this.el.innerHTML = '';
    this.lastId = 0;
  }

  // Gibt die Anzahl neuer Meldungen zurück
  update(events) {
    const fresh = events.filter(e => e.id > this.lastId);
    if (!fresh.length) return 0;
    this.lastId = fresh[fresh.length - 1].id;
    const html = fresh.reverse().map(e => (e.type === 'radio' && this.radioHtml(e)) || `
      <li class="msg msg-${e.type}" data-cat="${CAT[e.type] || 'rc'}">
        <span class="msg-lap">${clock(e.t)}<small>${e.seg ? e.seg : e.lap ? 'L' + e.lap : ''}</small></span>
        <span class="msg-icon">${tagHtml(e.type)}</span>
        <span class="msg-text">${escapeHtml(e.text)}</span>
      </li>`).join('');
    this.el.insertAdjacentHTML('afterbegin', html);
    while (this.el.children.length > 300) this.el.lastElementChild.remove();
    // Zähler: nur, was im aktuellen Filter sichtbar ist
    const f = this.el.dataset.filter || 'all';
    return fresh.filter(e => (f === 'all' ? e.type !== 'radio' : (CAT[e.type] || 'rc') === f)).length;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
