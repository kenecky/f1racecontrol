// Flaggen-Panel: Marshal-Sektoren mit Flaggenwahl und Gefahrenhinweisen.
import { FLAGS } from '../control/flags.js';
import { WARN_ICON } from './feed.js';
import { hazardProgress } from '../sim/hazards.js';

const ORDER = ['clear', 'yellow', 'double', 'slippery'];

export class FlagPanel {
  constructor({ root, list, track, onSet }) {
    this.root = root;
    this.list = list;
    this.track = track;
    this.onSet = onSet;
    this.focus = null;
    this.sig = '';
    list.addEventListener('click', e => {
      const b = e.target.closest('.fbtn');
      if (!b) return;
      const idx = Number(b.dataset.sector);
      this.focus = idx;
      this.onSet(idx, b.dataset.flag);
    });
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open(race, focusIdx = null) {
    this.focus = focusIdx;
    this.root.classList.remove('hidden');
    this.sig = '';
    this.render(race, true);
  }

  close() {
    this.root.classList.add('hidden');
    this.focus = null;
  }

  render(race, scroll = false) {
    if (!this.isOpen || !race) return;
    const t = race.time;
    const sig = JSON.stringify([
      race.flags, this.focus,
      race.hazards.map(h => [h.id, h.ended, h.type, h.need, t - (h.endTime ?? t) < 30, Math.round(hazardProgress(h) * 20)]),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    const title = document.getElementById('flagTitle');
    if (title) title.textContent = this.focus !== null ? `FLAG CONTROL · MARSHAL SECTOR ${this.focus + 1}` : 'FLAG CONTROL · ALL SECTORS';

    this.list.innerHTML = race.track.sectors.map((sec, i) => {
      const flag = race.flags[i];
      const active = race.hazards.filter(h => h.sector === i && !h.ended && !h.global);
      const recentlyCleared = race.hazards.filter(h => h.sector === i && h.ended && t - h.endTime < 30);
      let notes = active.map(h => `<div class="hazard-note">${WARN_ICON} ${h.desc}${h.workTotal ? `<div class="progress"><span style="width:${Math.round(hazardProgress(h) * 100)}%"></span></div><div class="ctl-small">Bergung ${Math.round(hazardProgress(h) * 100)} %</div>` : ''}</div>`).join('');
      if (!active.length && recentlyCleared.length && flag !== 'clear') {
        notes += '<div class="hazard-note ok">✓ Gefahr beseitigt – Sektor kann wieder auf Grün.</div>';
      }
      const corners = sec.corners.length ? sec.corners.join(', ') : 'Gerade';
      const btns = ORDER.map(f => `
        <button class="fbtn fbtn-${f}${flag === f ? ' active' : ''}" data-sector="${i}" data-flag="${f}" title="${FLAGS[f].name}">${FLAGS[f].short}</button>`).join('');
      return `
        <div class="frow${this.focus === i ? ' focus' : ''}" data-sector="${i}">
          <div class="frow-top">
            <span class="sec-badge led-${flag}">${sec.id}</span>
            <div>
              <div class="sec-name">MS ${String(sec.id).padStart(2, '0')}</div>
              <div class="sec-corners">${corners}</div>
            </div>
            <div class="fbtns">${btns}</div>
          </div>
          ${notes}
        </div>`;
    }).join('') + `
      <div class="flag-legend">G = Grün · Y = Gelb · YY = Doppelt Gelb · YR = Gelb-Rot</div>`;

    if (scroll && this.focus !== null) {
      const row = this.list.querySelector(`.frow[data-sector="${this.focus}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }
  }
}
