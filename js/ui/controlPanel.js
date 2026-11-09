// Panel für VSC, Safety Car und rote Flagge.
import { canRestart, scInPossibleThisLap, scInLastSector } from '../sim/neutral.js';
import { sectorIndexAt } from '../sim/trackModel.js';
import { WARN_ICON } from './feed.js';
import { hazardProgress, hazardWhere } from '../sim/hazards.js';

const TITLES = {
  vsc: 'VIRTUAL SAFETY CAR', sc: 'SAFETY CAR', red: 'RED FLAG', start: 'START PROCEDURE',
  medical: 'MEDICAL CAR', sweeper: 'SWEEPER', crane: 'RECOVERY CRANE', pit: 'PIT LANE',
};
// Auslösende Aktionen brauchen zwei Drücke: ARM (scharf schalten) → DEPLOY
const ARMED = new Set(['vsc-on', 'sc-on', 'red-on', 'med-go', 'sweep-go', 'crane-go', 'pit-close']);
const armKey = a => a.split(':')[0];

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
    this.armed = null;
    this.sel = {};          // gewählter Sektor je Konsole
    body.addEventListener('click', e => {
      const pick = e.target.closest('[data-sec]');
      if (pick) { this.sel[this.kind] = Number(pick.dataset.sec); this.sig = ''; this.render(this.lastRace); return; }
      const b = e.target.closest('[data-action]');
      if (!b || b.disabled) return;
      const a = b.dataset.action;
      if (ARMED.has(armKey(a)) && (!this.armed || this.armed.action !== a || performance.now() > this.armed.until)) {
        this.armed = { action: a, until: performance.now() + 4000 };
        this.sig = '';
        this.lastRace && this.render(this.lastRace);
        setTimeout(() => { if (this.armed && performance.now() > this.armed.until) { this.armed = null; this.sig = ''; this.lastRace && this.render(this.lastRace); } }, 4100);
        return;
      }
      this.armed = null;
      onAction(a);
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
    this.lastRace = race;
    const n = race.neutral;
    const kind = this.kind;
    const active = race.hazards.filter(h => !h.ended && h.type !== 'spin');
    const sig = JSON.stringify([
      kind, n && n.type, n && n.phase, n && n.unlap, n && n.go, Math.floor(race.time / 2),
      scInPossibleThisLap(race),
      race.cars.filter(c => c.unlap).length, race.cars.filter(c => c.redQueued).length,
      active.map(h => Math.round(hazardProgress(h) * 50)), canRestart(race),
      race.phase, race.startIssue && race.startIssue.carId, race.startIssue && race.startIssue.released, race.laps,
      this.armed && this.armed.action, this.sel[kind],
      race.svc && [!!race.svc.medical, race.svc.medical && race.svc.medical.phase, !!race.svc.sweeper, race.svc.cranes.map(c => c.sector), race.svc.pitClosed],
    ]);
    if (sig === this.sig) return;
    this.sig = sig;

    this.titleEl.textContent = TITLES[kind];
    let sub = '', html = '';
    const running = race.phase === 'running';
    const since = n ? mmss(race.time - (n.start ?? race.time)) : '';

    if (race.isSession && kind !== 'red') {
      sub = 'Nicht verfügbar';
      html = '<p class="ctl-text">Im Training und Qualifying gibt es kein VSC und kein Safety Car. Bei größerer Gefahr wird die Session mit der roten Flagge unterbrochen – die Uhr hält dann an.</p>';
    } else if (kind === 'vsc') {
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

    if (kind === 'sc' && !race.isSession) {
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

    if (kind === 'medical' || kind === 'sweeper' || kind === 'crane') {
      const sv = race.svc || { cranes: [] };
      const needKey = { medical: 'medical', sweeper: 'needsSweeper', crane: 'needsCrane' }[kind];
      const needSecs = new Set(race.hazards.filter(h => !h.ended && !h.global && h[needKey] && !(kind === 'medical' && h.medicalDone)).map(h => h.sector));
      if (this.sel[kind] === undefined) this.sel[kind] = needSecs.size ? [...needSecs][0] : 0;
      const sel = this.sel[kind];
      const busy = new Set(kind === 'crane' ? sv.cranes.map(c => c.sector) : []);
      const grid = race.track.sectors.map((sec, i) => `<button class="sec-pick${needSecs.has(i) ? ' need' : ''}${busy.has(i) ? ' busy' : ''}${i === sel ? ' sel' : ''}" data-sec="${i}">${i + 1}</button>`).join('');
      const scNote = '<p class="ctl-small">Regel: Vorher muss das Safety Car (oder Rot) draußen sein. Sonst gibt es Abzug bei der Sicherheit.</p>';
      sub = { medical: 'Zur Unfallstelle – Fahrer untersuchen', sweeper: 'Kies und Schmutz von der Fahrbahn räumen', crane: 'Steht im jeweiligen Streckenabschnitt bereit' }[kind];
      html = `<div class="ctl-small">Sektor wählen (gelb = dort wird ${kind === 'medical' ? 'das Medical Car' : kind === 'sweeper' ? 'eine Kehrmaschine' : 'ein Kran'} gebraucht):</div><div class="sec-grid">${grid}</div>`;
      if (kind === 'medical') {
        const m = sv.medical;
        html += m ? `<div class="ctl-status">Medical Car im Einsatz – ${m.phase === 'out' ? `unterwegs zu Sektor ${m.sector + 1}` : m.phase === 'onsite' ? `an der Unfallstelle in Sektor ${m.sector + 1}` : 'zurück zur Box'}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="med-go:${sel}" ${running ? '' : 'disabled'}>MEDICAL CAR → SEKTOR ${sel + 1}</button>${scNote}`;
      } else if (kind === 'sweeper') {
        html += sv.sweeper ? `<div class="ctl-status">Kehrmaschine räumt Sektor ${sv.sweeper.sector + 1}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="sweep-go:${sel}" ${running ? '' : 'disabled'}>KEHRMASCHINE → SEKTOR ${sel + 1}</button>${scNote}`;
      } else {
        html += busy.has(sel)
          ? `<div class="ctl-status">Kran in Sektor ${sel + 1} im Einsatz</div><button class="ctl-btn ctl-ghost" data-action="crane-off:${sel}">KRAN ABZIEHEN</button>`
          : `<button class="ctl-btn ctl-vsc" data-action="crane-go:${sel}" ${running ? '' : 'disabled'}>KRAN IN SEKTOR ${sel + 1} EINSETZEN</button>`;
        html += '<p class="ctl-small">Ein Kran neben der Strecke braucht mindestens Doppelt Gelb in diesem Sektor (bei Nässe Safety Car). Ein Kran im falschen Sektor kostet Punkte.</p>';
      }
    }

    if (kind === 'pit') {
      const closed = race.svc && race.svc.pitClosed;
      sub = 'Einfahrt in die Boxengasse sperren oder freigeben';
      html = closed
        ? `<div class="ctl-status">Boxengasse ist GESCHLOSSEN</div><button class="ctl-btn ctl-green" data-action="pit-open">BOXENGASSE ÖFFNEN</button>`
        : `<div class="ctl-status">Boxengasse ist offen</div><button class="ctl-btn ctl-red" data-action="pit-close" ${running ? '' : 'disabled'}>BOXENGASSE SCHLIESSEN</button>`;
      html += '<p class="ctl-small">Bei einem Unfall in der Boxengasse, an der Ein- oder Ausfahrt sofort schließen. Wer trotzdem hineinfährt, bekommt eine Entscheidung.</p>';
    }

    if (kind === 'start') {
      sub = 'Formationsrunde und Startfreigabe';
      const issue = race.startIssue;
      const atGrid = (race.phase === 'grid' || race.phase === 'lights') && race.formation && race.formation.arrived;
      if (race.phase === 'ready') {
        html = `<div class="ctl-status">Autos in der Startaufstellung</div>
          <p class="ctl-text">Mit „Formationsrunde freigeben“ (Knopf auf der Karte) beginnt die Formationsrunde. Danach schaltest du die Startampel ein – aber erst, wenn alle Autos in ihren Startboxen stehen. Wenn alle fünf Lichter brennen, löschst du sie per Klick (üblich: innerhalb von 3 Sekunden).</p>`;
      } else if (race.phase === 'formation') {
        html = `<div class="ctl-status">${race.formation && race.formation.n > 1 ? 'Extra-' : ''}Formationsrunde läuft</div>
          <p class="ctl-text">Die Autos wärmen Reifen und Bremsen auf. Defekte oder Dreher sind möglich – sichere Gefahren wie im Rennen mit Flaggen ab. Wer seinen Platz verliert, startet von hinten; wer nicht losfährt, aus der Boxengasse.</p>`;
      } else if (atGrid && issue && !issue.released) {
        html = `<div class="ctl-status">⚠ ${issue.carId} steht mit abgestorbenem Motor in der Startaufstellung</div>
          <p class="ctl-text">Schalte die Startampel jetzt nicht ein – ein stehendes Auto beim Start ist gefährlich.</p>
          <button class="ctl-btn ctl-red" data-action="start-abort">Start abbrechen – Extra-Formationsrunde</button>
          <p class="ctl-small">${issue.carId} wird in die Boxengasse geschoben und startet von dort. Das Rennen wird um eine Runde verkürzt (dann ${Math.max(3, race.laps - 1)} Runden).</p>
          <button class="ctl-btn ctl-sc" data-action="start-sc">Start hinter dem Safety Car</button>
          <button class="ctl-btn ctl-ghost" data-action="start-lights">Startampel trotzdem einschalten</button>`;
      } else if (atGrid) {
        html = `<div class="ctl-status">${race.phase === 'lights' ? 'Startampel läuft' : 'Startaufstellung komplett – Startampel über den Knopf auf der Karte'}</div>
          <button class="ctl-btn ctl-ghost" data-action="start-abort">Start abbrechen – Extra-Formationsrunde</button>
          <button class="ctl-btn ctl-ghost" data-action="start-sc">Start hinter dem Safety Car</button>
          <p class="ctl-small">Nur bei einem Problem in der Startaufstellung oder auf der Strecke. Ein Startabbruch kostet eine Runde Renndistanz.</p>`;
      } else {
        html = `<div class="ctl-status">${race.phase === 'pre' ? 'Der Start wurde noch nicht freigegeben.' : race.phase === 'lights' ? 'Startampel läuft.' : 'Das Rennen ist gestartet.'}</div>`;
      }
    }

    if (kind === 'red') {
      sub = 'Rennunterbrechung';
      if (!n || n.type !== 'red') {
        html = `<p class="ctl-text">${race.isSession ? 'Die Session wird unterbrochen, alle Autos fahren in die Box, die Uhr hält an.' : 'Alle Autos fahren langsam in die Boxengasse und stellen sich an. Freier Reifenwechsel. Nur bei großer Gefahr, z. B. beschädigter Barriere.'}</p>
          <button class="ctl-btn ctl-red" data-action="red-on" ${running ? '' : 'disabled'}>Rote Flagge zeigen</button>`;
      } else if (n.phase === 'stopping') {
        const racing = race.cars.filter(c => !c.retired && !c.finished).length;
        const q = race.cars.filter(c => c.redQueued).length;
        html = `<div class="ctl-status">Rote Flagge seit ${since} – ${q}/${racing} Autos in der Boxengasse</div>`;
      } else if (n.phase === 'stopped' && race.isSession) {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Session unterbrochen seit ${since} – die Uhr steht (noch ${Math.ceil(race.remaining / 60)} Min.)</div>
          <button class="ctl-btn ctl-green" data-action="session-resume" ${ok ? '' : 'disabled'}>Session fortsetzen</button>
          ${ok ? '' : '<p class="ctl-small">Fortsetzen erst möglich, wenn die Strecke geräumt ist.</p>'}`;
      } else if (n.phase === 'stopped') {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Rennen unterbrochen seit ${since}</div>
          <button class="ctl-btn ctl-sc" data-action="restart-sc" ${ok ? '' : 'disabled'}>Neustart hinter dem Safety Car</button>
          <button class="ctl-btn ctl-ghost" data-action="restart-standing" ${ok ? '' : 'disabled'}>Stehender Neustart</button>
          ${ok ? '' : '<p class="ctl-small">Neustart erst möglich, wenn die Strecke geräumt ist.</p>'}`;
      } else {
        html = `<div class="ctl-status">${n.phase === 'formation' ? 'Formationsrunde zum Neustart läuft' : n.phase === 'grid' ? 'Startaufstellung komplett – Startampel über den Knopf auf der Karte' : 'Startampel läuft'}</div>
          <p class="ctl-small">Die Autos kommen in Rennreihenfolge aus der Boxengasse, fahren eine Runde und stellen sich auf. Schalte die Ampel erst ein, wenn alle stehen.</p>`;
      }
    }

    this.subEl.textContent = sub;
    // Scharf geschaltete Taste hervorheben
    if (this.armed) {
      html = html.replace(new RegExp(`(<button class="ctl-btn[^"]*)("[^>]*data-action="${this.armed.action}"[^>]*>)([^<]*)`), '$1 armed$2ARMED – ZUM AUSLÖSEN ERNEUT DRÜCKEN');
    }
    this.body.innerHTML = html + `<div class="ctl-section">TRACK STATUS</div>${this.hazardsHtml(race)}`;
  }
}
