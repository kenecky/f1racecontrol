// Tab "Entscheidungen": Vorfälle untersuchen und Urteile fällen.
import { PENALTIES } from '../control/stewards.js';
import { ScenePlayer } from './scenePlayer.js';

const STATUS = {
  new: ['NOTED', 'st-new'],
  investigating: ['INVESTIGATION', 'st-inv'],
  post: ['POST-RACE', 'st-post'],
  hearing: ['HEARING', 'st-hear'],
  decided: ['DECISION', 'st-done'],
  nfa: ['NFA', 'st-nfa'],
};
// Überschrift des Dokuments je Stand des Verfahrens
const DOC_TITLE = {
  new: 'INCIDENT NOTED', investigating: 'UNDER INVESTIGATION', post: 'SUMMONS',
  hearing: 'HEARING', decided: 'DECISION', nfa: 'NO FURTHER ACTION',
};
const SESSION = { race: 'Rennen', sprint: 'Sprint', quali: 'Qualifying', sq: 'Sprint-Qualifying', fp: 'Freies Training' };
const EV_ICON = { video: '🎥', telemetry: '📊', position: '📍', radio: '📻', data: '📋', hearing: '🗣️' };

export class CasesPanel {
  constructor(el, { onAction }) {
    this.el = el;
    this.onAction = onAction;
    this.open = new Set();
    this.forms = {};
    this.sig = '';
    this.players = new Map();   // Rennszenen je Fall (Wiedergabezeit bleibt beim Neuzeichnen erhalten)
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
    const times = new Map([...this.players].map(([id, p]) => [id, { t: p.t, playing: p.playing }]));
    for (const p of this.players.values()) p.destroy();
    this.players.clear();
    this.el.innerHTML = head + list;
    this.mountScenes(race, times);
  }

  mountScenes(race, times) {
    for (const box of this.el.querySelectorAll('.scene-box')) {
      const id = Number(box.dataset.scene);
      const c = race.cases.find(x => x.id === id);
      if (!c || !c.scene) continue;
      const prev = times.get(id);
      const p = new ScenePlayer(box, {
        track: race.track, scene: c.scene, sharp: c.status !== 'new', t: prev ? prev.t : 0, autoplay: prev ? prev.playing : true,
        onFull: t => this.onAction('scene-full', id, { t }),
        onMap: () => this.onAction('scene-map', id, {}),
      });
      this.players.set(id, p);
    }
  }

  card(race, c, finished) {
    let [label, cls] = STATUS[c.status];
    if (c.status === 'post' && finished) label = 'HEARING DUE';
    const open = this.open.has(c.id);
    let body = '';
    if (open) {
      const showAll = c.status !== 'new';
      const evs = c.evidence.filter(e => showAll || e.early);
      let n = 0;
      const exhibit = e => `
        <div class="exhibit"><div class="ex-label">EXHIBIT ${++n} · ${e.label}</div><div>${e.text}</div></div>`;
      const scene = c.scene ? `
          <div class="exhibit"><div class="ex-label">EXHIBIT ${++n} · CCTV ${c.scene.corner}${c.status === 'new' ? ' (TV)' : ''}</div>
            <div class="scene-box" data-scene="${c.id}"></div>
            <div class="scene-hint">${c.status === 'new' ? 'TV-Bild – genauere Übersicht mit Hilfslinien nach „Untersuchen“' : 'Nachstellung aus Daten und Kameras – Hilfslinien zur Bewertung'}</div></div>` : '';
      const evHtml = evs.map(exhibit).join('');
      const hearing = c.hearing ? `<div class="doc-sub">HEARING</div>${c.hearing.map(exhibit).join('')}` : '';
      const more = !showAll && c.evidence.length > evs.length
        ? '<div class="ev-more">Weitere Beweise (Telemetrie, Positionen, Funk) nach Untersuchungsbeginn.</div>' : '';
      const cars = c.cars.map(id => race.carById[id]).filter(Boolean);
      const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
      const v = c.verdict;
      const decision = v ? row('DECISION', v.carId
        ? `<b>${PENALTIES[v.penalty].name} für ${v.carId}${v.points ? ` · ${v.points} Strafpunkt${v.points > 1 ? 'e' : ''}` : ''}</b>`
        : `<b>${c.status === 'nfa' ? 'Keine weitere Untersuchung' : 'Keine Strafe'}</b>`) : '';
      const stamp = v ? `<div class="doc-stamp ${v.carId ? 'pen' : 'ok'}">${v.carId ? 'PENALTY' : c.status === 'nfa' ? 'NFA' : 'NO PENALTY'}</div>` : '';
      body = `
        <div class="case-body">
          <div class="doc">
            <div class="doc-hd"><div><b>RACE CONTROL – STEWARDS</b><small>${race.track.def.grandPrix} · ${SESSION[race.kind] || ''}</small></div>
              <div class="doc-no"><small>DOCUMENT</small><b>${c.id}</b></div></div>
            <div class="doc-title">${DOC_TITLE[c.status]}</div>
            <table class="doc-table">
              ${cars.map(car => row('NO / DRIVER', `${car.driver.number} – ${car.driver.first} ${car.driver.last}`)).join('')}
              ${row('COMPETITOR', [...new Set(cars.map(car => car.team.name))].join(', '))}
              ${row('TIME / LAP', c.when || (c.lap ? `Runde ${c.lap}` : 'Vor dem Start'))}
              ${row('FACT', c.summary)}
              ${row('OFFENCE', c.typeName)}
              ${decision}
            </table>
            ${scene}${evHtml}${more}${hearing}
            ${stamp}
          </div>
          ${this.actions(race, c, finished)}
        </div>`;
    }
    return `
      <div class="case ${cls}-card${open ? ' open' : ''}" data-id="${c.id}">
        <button class="case-head" data-act="toggle">
          <span class="case-no">DOC<b>${c.id}</b></span>
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
    return '';
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
