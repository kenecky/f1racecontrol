// Meldungsfeed (neueste oben)
export const WARN_ICON = '<svg class="warn-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
  + '<path d="M12 2.5 23 21.5H1Z" fill="#ffd12e" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/>'
  + '<rect x="11" y="8.5" width="2" height="7.2" rx="1" fill="#000"/><circle cx="12" cy="18.4" r="1.25" fill="#000"/></svg>';

const ICONS = {
  info: 'ℹ️', start: '🚦', overtake: '↗', fastest: '⏱', pit: '🔧', chequered: '🏁', finish: '🏁',
  marshal: WARN_ICON, radio: '📻', rc: '🚩', case: '⚖️', tl: '📏', weather: '🌦',
};

export class Feed {
  constructor(el) {
    this.el = el;
    this.lastId = 0;
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
    const html = fresh.reverse().map(e => `
      <li class="msg msg-${e.type}">
        <span class="msg-lap">${e.seg ? e.seg : e.lap ? 'R' + e.lap : '–'}</span>
        <span class="msg-icon">${ICONS[e.type] || '•'}</span>
        <span class="msg-text">${escapeHtml(e.text)}</span>
      </li>`).join('');
    this.el.insertAdjacentHTML('afterbegin', html);
    while (this.el.children.length > 300) this.el.lastElementChild.remove();
    return fresh.length;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
