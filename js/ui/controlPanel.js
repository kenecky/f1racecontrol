// Panel für VSC, Safety Car und rote Flagge.
import { canRestart, scInPossibleThisLap, scInLastSector } from '../sim/neutral.js';
import { sectorIndexAt } from '../sim/trackModel.js';
import { WARN_ICON } from './feed.js';
import { hazardProgress, hazardWhere } from '../sim/hazards.js';

const TITLES = { vsc: 'Virtual Safety Car', sc: 'Safety Car', red: 'Rote Flagge' };

function mmss(t) {
  t = Math.max(0, Math.floor(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class ControlPanel {
  constructor({ root, title, sub, body, onAction }) {
    this.root = root;
    this.titleEl = title;
    this.subEl = sub;
    this.body = body;
    this.kind = null;
    this.sig = '';
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (b && !b.disabled) onAction(b.dataset.action);
    });
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open(race, kind) {
    this.kind = kind;
    this.sig = '';
    this.root.classList.remove('hidden');
    this.render(race);
  }

  close() {
    this.root.classList.add('hidden');
    this.kind = null;
  }

  hazardsHtml(race) {
    const active = race.hazards.filter(h => !h.ended && h.type !== 'spin');
    if (!active.length) return '<div class="ctl-ok">✓ Keine offene Gefahr auf der Strecke.</div>';
    return active.map(h => {
      const p = Math.round(hazardProgress(h) * 100);
      return `
        <div class="ctl-hazard">
          <div>${WARN_ICON} ${hazardWhere(h)}: ${h.desc}</div>
          <div class="progress"><span style="width:${p}%"></span></div>
          <div class="ctl-small">Bergung ${p} %</div>
        </div>`;
    }).join('');
  }

  render(race) {
    if (!this.isOpen || !race) return;
    const n = race.neutral;
    const kind = this.kind;
    const active = race.hazards.filter(h => !h.ended && h.type !== 'spin');
    const sig = JSON.stringify([
      kind, n && n.type, n && n.phase, n && n.unlap, n && n.go, Math.floor(race.time / 2),
      scInPossibleThisLap(race),
      race.cars.filter(c => c.unlap).length, race.cars.filter(c => c.redQueued).length,
      active.map(h => Math.round(hazardProgress(h) * 50)), canRestart(race),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;

    this.titleEl.textContent = TITLES[kind];
    let sub = '', html = '';
    const running = race.phase === 'running';
    const since = n ? mmss(race.time - (n.start ?? race.time)) : '';

    if (kind === 'vsc') {
      sub = 'Delta-Tempo für alle, Überholverbot – Marshals können sicherer arbeiten';
      if (!n) {
        html = `<p class="ctl-text">Alle Autos fahren rund 40 % langsamer. Gut für Bergungen, die nur kurz dauern.</p>
          <button class="ctl-btn ctl-vsc" data-action="vsc-on" ${running ? '' : 'disabled'}>VSC aktivieren</button>`;
      } else if (n.type === 'vsc' && n.phase === 'active') {
        html = `<div class="ctl-status">VSC aktiv seit ${since}</div>
          <button class="ctl-btn ctl-green" data-action="vsc-off">VSC beenden</button>
          <p class="ctl-small">Nach „VSC endet“ folgt in 8–14 s Grün.</p>`;
      } else if (n.type === 'vsc') {
        html = '<div class="ctl-status">VSC endet – gleich Grün.</div>';
      } else {
        html = `<p class="ctl-text">Nicht verfügbar, solange ${n.type === 'sc' ? 'das Safety Car' : 'die rote Flagge'} aktiv ist.</p>`;
      }
    }

    if (kind === 'sc') {
      sub = 'Feld fährt hinter dem Safety Car, Überholverbot';
      if (!n || n.type === 'vsc') {
        html = `<p class="ctl-text">Das Safety Car setzt sich vor den Führenden, das Feld schließt auf. Gut für längere Bergungen und Trümmerfelder.${n ? ' Das VSC wird dadurch ersetzt.' : ''}</p>
          <button class="ctl-btn ctl-sc" data-action="sc-on" ${running ? '' : 'disabled'}>Safety Car einsetzen</button>`;
      } else if (n.type === 'sc') {
        const leader = race.standings().find(c => !c.retired);
        const laps = Math.max(0, leader.lap - (n.startLap ?? leader.lap));
        const unlapping = race.cars.filter(c => c.unlap).map(c => c.id);
        if (n.phase === 'out') {
          html = `<div class="ctl-status">Safety Car seit ${since}${n.startLap !== undefined ? ` · ${laps} Rd` : ''}</div>`;
          if (n.release && n.release.length) html += `<p class="ctl-small">Boxenausfahrt: ${n.release.length} Autos warten noch.</p>`;
          html += n.unlap
            ? `<div class="ctl-small">${unlapping.length ? `Zurückrunden läuft: ${unlapping.join(', ')}` : 'Überrundete haben sich zurückgerundet.'}</div>`
            : `<button class="ctl-btn ctl-ghost" data-action="sc-unlap">Überrundete zurückrunden lassen</button>
               <p class="ctl-small">Überrundete Autos überholen das Feld und das Safety Car und schließen hinten wieder an. Dauert etwa eine Runde.</p>`;
          const now = scInPossibleThisLap(race);
          const sec = race.sc && !race.sc.inPit ? sectorIndexAt(race.track, race.sc.d) + 1 : null;
          const last = scInLastSector(race.track);
          html += `<button class="ctl-btn ctl-green" data-action="sc-in">${now ? 'Safety Car kommt in dieser Runde rein' : 'Safety Car kommt nächste Runde rein'}</button>
            <p class="ctl-small">${sec ? `SC ist in Sektor ${sec}. ` : ''}Reinholen in dieser Runde nur bis Sektor ${last} möglich, danach erst in der nächsten Runde.</p>`;
        } else {
          html = `<div class="ctl-status">${n.go ? 'Neustart läuft – Grün an der Ziellinie.' : 'Safety Car kommt in dieser Runde rein. Der Führende bestimmt das Tempo.'}</div>`;
        }
      } else {
        html = '<p class="ctl-text">Nicht verfügbar während der roten Flagge.</p>';
      }
    }

    if (kind === 'red') {
      sub = 'Rennunterbrechung';
      if (!n || n.type !== 'red') {
        html = `<p class="ctl-text">Alle Autos fahren langsam in die Boxengasse und stellen sich an. Freier Reifenwechsel. Nur bei großer Gefahr, z. B. beschädigter Barriere.</p>
          <button class="ctl-btn ctl-red" data-action="red-on" ${running ? '' : 'disabled'}>Rote Flagge zeigen</button>`;
      } else if (n.phase === 'stopping') {
        const racing = race.cars.filter(c => !c.retired && !c.finished).length;
        const q = race.cars.filter(c => c.redQueued).length;
        html = `<div class="ctl-status">Rote Flagge seit ${since} – ${q}/${racing} Autos in der Boxengasse</div>`;
      } else if (n.phase === 'stopped') {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Rennen unterbrochen seit ${since}</div>
          <button class="ctl-btn ctl-sc" data-action="restart-sc" ${ok ? '' : 'disabled'}>Neustart hinter dem Safety Car</button>
          <button class="ctl-btn ctl-ghost" data-action="restart-standing" ${ok ? '' : 'disabled'}>Stehender Neustart</button>
          ${ok ? '' : '<p class="ctl-small">Neustart erst möglich, wenn die Strecke geräumt ist.</p>'}`;
      } else {
        html = '<div class="ctl-status">Stehender Neustart – Startaufstellung.</div>';
      }
    }

    this.subEl.textContent = sub;
    this.body.innerHTML = html + `<div class="ctl-section">Lage auf der Strecke</div>${this.hazardsHtml(race)}`;
  }
}
