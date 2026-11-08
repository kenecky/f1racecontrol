// Tab "Entscheidungen": Vorfälle untersuchen und Urteile fällen.
import { PENALTIES } from '../control/stewards.js';

const STATUS = {
  new: ['NEU', 'st-new'],
  investigating: ['IN UNTERSUCHUNG', 'st-inv'],
  post: ['NACH DEM RENNEN', 'st-post'],
  hearing: ['ANHÖRUNG', 'st-hear'],
  decided: ['ENTSCHIEDEN', 'st-done'],
  nfa: ['KEINE UNTERSUCHUNG', 'st-nfa'],
};
const EV_ICON = { video: '🎥', telemetry: '📊', position: '📍', radio: '📻', data: '📋', hearing: '🗣️' };

export class CasesPanel {
  constructor(el, { onAction }) {
    this.el = el;
    this.onAction = onAction;
    this.open = new Set();
    this.forms = {};
    this.sig = '';
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const card = b.closest('.case');
      const id = card ? Number(card.dataset.id) : null;
      const act = b.dataset.act;
      if (act === 'toggle') {
        this.open.has(id) ? this.open.delete(id) : this.open.add(id);
        this.sig = '';
        this.onAction('render');
        return;
      }
      const f = this.forms[id] || (this.forms[id] = { carId: undefined, penalty: null, points: 0 });
      if (act === 'car') { f.carId = b.dataset.val === '' ? null : b.dataset.val; if (f.carId === null) f.penalty = null; }
      else if (act === 'pen') f.penalty = b.dataset.val;
      else if (act === 'pts') f.points = Number(b.dataset.val);
      else { this.onAction(act, id, f); }
      this.sig = '';
      this.onAction('render');
    });
  }

  render(race) {
    const finished = race.phase === 'finished';
    const sig = JSON.stringify([
      finished, [...this.open], this.forms,
      race.cases.map(c => [c.id, c.status, c.evidence.length, c.verdict && c.verdict.penalty, c.hearing ? c.hearing.length : 0]),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;

    if (!race.cases.length) {
      this.el.innerHTML = `<div class="empty"><div class="empty-icon">⚖️</div>Noch keine Entscheidungen.<br>Vorfälle zwischen Fahrern und Regelverstöße erscheinen hier.</div>`;
      return;
    }
    const head = finished
      ? '<div class="cases-bar"><span>Rennen beendet</span><button class="pill-btn" data-act="results">Ergebnis anzeigen</button></div>'
      : '';
    const list = [...race.cases].reverse().map(c => this.card(race, c, finished)).join('');
    this.el.innerHTML = head + list;
  }

  card(race, c, finished) {
    let [label, cls] = STATUS[c.status];
    if (c.status === 'post' && finished) label = 'ANHÖRUNG OFFEN';
    const open = this.open.has(c.id);
    let body = '';
    if (open) {
      const showAll = c.status !== 'new';
      const evs = c.evidence.filter(e => showAll || e.early);
      const evHtml = evs.map(e => `
        <div class="ev"><span class="ev-icon">${EV_ICON[e.kind] || '•'}</span>
          <div><div class="ev-label">${e.label}</div><div>${e.text}</div></div></div>`).join('');
      const hearing = c.hearing ? `
        <div class="hearing-title">Anhörung bei der Rennleitung</div>
        ${c.hearing.map(e => `
          <div class="ev ev-hearing"><span class="ev-icon">${EV_ICON[e.kind] || '•'}</span>
            <div><div class="ev-label">${e.label}</div><div>${e.text}</div></div></div>`).join('')}` : '';
      const more = !showAll && c.evidence.length > evs.length
        ? `<div class="ev-more">Weitere Beweise (Telemetrie, Positionen, Funk) nach Untersuchungsbeginn.</div>` : '';
      body = `
        <div class="case-body">
          <p class="case-summary">${c.summary}</p>
          <div class="evidence">${evHtml}${more}${hearing}</div>
          ${this.actions(race, c, finished)}
        </div>`;
    }
    return `
      <div class="case ${cls}-card${open ? ' open' : ''}" data-id="${c.id}">
        <button class="case-head" data-act="toggle">
          <span class="case-no">#${c.id}</span>
          <span class="case-main">
            <span class="case-title">${c.title}</span>
            <span class="case-meta">${c.when || (c.lap ? `Runde ${c.lap}` : 'Vor dem Start')} · ${c.typeName}${c.verdict && c.verdict.carId ? ` · ${PENALTIES[c.verdict.penalty].short} ${c.verdict.carId}` : ''}</span>
          </span>
          <span class="case-status ${cls}">${label}</span>
        </button>
        ${body}
      </div>`;
  }

  actions(race, c, finished) {
    if (c.status === 'new') {
      return `
        <div class="case-actions">
          <button class="ctl-btn ctl-sc" data-act="investigate">Untersuchen</button>
          <div class="case-actions-row">
            <button class="ctl-btn ctl-ghost" data-act="nfa">Keine Untersuchung</button>
            ${finished ? '' : '<button class="ctl-btn ctl-ghost" data-act="post">Nach dem Rennen</button>'}
          </div>
        </div>`;
    }
    if (c.status === 'post' && !finished) {
      return `
        <p class="ctl-small">Nach dem Rennen werden die beteiligten Fahrer zur Anhörung vorgeladen. Erst danach wird entschieden.</p>
        <button class="ctl-btn ctl-ghost" data-act="investigate-now">Doch jetzt untersuchen</button>`;
    }
    if (c.status === 'post') {
      return `
        <p class="ctl-small">Die Fahrer schildern ihre Sicht, dazu kommen weitere Aufnahmen und Daten.</p>
        <button class="ctl-btn ctl-sc" data-act="hearing">Fahrer zur Anhörung vorladen</button>`;
    }
    if (c.status === 'investigating' || c.status === 'hearing') return this.form(c, finished);
    const v = c.verdict;
    if (!v || !v.carId) return '<div class="verdict">Urteil: <b>Keine Strafe</b></div>';
    const pts = v.points ? ` · ${v.points} Strafpunkt${v.points > 1 ? 'e' : ''}` : '';
    return `<div class="verdict">Urteil: <b>${PENALTIES[v.penalty].name}</b> für <b>${v.carId}</b>${pts}</div>`;
  }

  form(c, finished) {
    const f = this.forms[c.id] || { carId: undefined, penalty: null, points: 0 };
    const chip = (act, val, text, on) => `<button class="chip${on ? ' on' : ''}" data-act="${act}" data-val="${val}">${text}</button>`;
    const cars = c.cars.map(id => chip('car', id, id, f.carId === id)).join('') + chip('car', '', 'Niemand', f.carId === null);
    const pens = f.carId ? c.options.map(k => chip('pen', k, PENALTIES[k].name, f.penalty === k)).join('') : '';
    const pts = f.carId ? [0, 1, 2, 3].map(n => chip('pts', n, String(n), f.points === n)).join('') : '';
    const ready = f.carId === null || (f.carId && f.penalty);
    return `
      <div class="verdict-form">
        <div class="vf-label">Verantwortlich</div><div class="chips">${cars}</div>
        ${f.carId ? `<div class="vf-label">Strafe</div><div class="chips">${pens}</div>
        <div class="vf-label">Strafpunkte (Superlizenz)</div><div class="chips">${pts}</div>` : ''}
        <button class="ctl-btn ctl-red" data-act="decide" ${ready ? '' : 'disabled'}>Urteil verkünden</button>
        ${c.status === 'investigating' && !finished ? '<button class="ctl-btn ctl-ghost" data-act="post">Nach dem Rennen entscheiden</button>' : ''}
      </div>`;
  }
}
