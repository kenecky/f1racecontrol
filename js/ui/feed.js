// Meldungsfeed (neueste oben)
const ICONS = {
  info: 'ℹ️', start: '🚦', overtake: '↗', fastest: '⏱', pit: '🔧', chequered: '🏁', finish: '🏁',
  marshal: '🦺', radio: '📻', rc: '🚩',
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
        <span class="msg-lap">${e.lap ? 'R' + e.lap : '–'}</span>
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
