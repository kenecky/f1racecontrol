// Panel für VSC, Safety Car und rote Flagge.
import { canRestart, scInPossibleThisLap, scInLastSector } from '../sim/neutral.js';
import { sectorIndexAt } from '../sim/trackModel.js';
import { WARN_ICON } from './feed.js';
import { hazardProgress, hazardWhere } from '../sim/hazards.js';
import { MESSAGES, canSend, msgActive } from '../sim/messages.js';
import { ALL_ON, canResumeStart } from '../sim/start.js';
import { svcPhase } from '../sim/services.js';

const TITLES = {
  vsc: 'VIRTUAL SAFETY CAR', sc: 'SAFETY CAR', red: 'RED FLAG', start: 'STARTING PROCEDURE',
  medical: 'MEDICAL CAR', sweeper: 'SWEEPER', crane: 'RECOVERY CRANE', pit: 'PIT LANE', bo: 'BLACK/ORANGE FLAG', msg: 'RACE CONTROL MESSAGE',
};
// Auslösende Aktionen brauchen zwei Drücke: ARM (scharf schalten) → DEPLOY
const ARMED = new Set(['vsc-on', 'sc-on', 'red-on', 'med-go', 'sweep-go', 'crane-go', 'pit-close', 'bo-go', 'start-suspend']);
// Beschriftung nach dem ersten Druck (scharf geschaltet)
const ARMED_LABEL = {
  'vsc-on': 'ARMED – DEPLOY VSC NOW', 'sc-on': 'ARMED – DEPLOY SC NOW', 'red-on': 'ARMED – RED FLAG NOW',
  'med-go': 'ARMED – DEPLOY MEDICAL CAR NOW', 'sweep-go': 'ARMED – DEPLOY SWEEPER NOW', 'crane-go': 'ARMED – DEPLOY CRANE NOW',
  'pit-close': 'ARMED – CLOSE PIT LANE NOW', 'start-suspend': 'ARMED – DELAY START NOW',
};
const armKey = a => a.split(':')[0];

function mmss(t) {
  t = Math.max(0, Math.floor(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Strategie der Teams unter VSC/SC
function stratHtml(n) {
  if (!n || (!n.cheap && !n.stayed)) return '';
  const stayed = (n.stayed || []).filter(id => !(n.cheap || []).includes(id));
  return `<div class="ctl-small strat">STRATEGIE · An der Box: ${(n.cheap || []).join(', ') || '–'}${stayed.length ? ` · Draußen geblieben: ${stayed.slice(0, 8).join(', ')}${stayed.length > 8 ? ' …' : ''}` : ''}</div>`;
}

export class ControlPanel {
  constructor({ root, title, sub, body, foot = null, onAction }) {
    this.root = root;
    this.foot = foot;     // Aktionsknöpfe unten (Vollbild-Pult)
    this.titleEl = title;
    this.subEl = sub;
    this.body = body;
    this.kind = null;
    this.sig = '';
    this.armed = null;
    this.sel = {};          // gewählter Sektor je Konsole
    const onClick = e => {
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
    };
    body.addEventListener('click', onClick);
    if (foot) foot.addEventListener('click', onClick);
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

  hazardsHtml(race, compact = false) {
    const active = race.hazards.filter(h => !h.ended && h.type !== 'spin');
    if (!active.length) return '<div class="ctl-ok">✓ Keine offene Gefahr auf der Strecke.</div>';
    // Starting Procedure: eine Zeile je Gefahr, damit die Konsole nicht scrollt
    if (compact) return active.map(h => `<div class="ctl-hazard ctl-hz-line">${WARN_ICON} <b>${hazardWhere(h)}:</b><span class="hz-d">${h.desc}</span><em>${Math.round(hazardProgress(h) * 100)} %</em></div>`).join('');
    return active.map(h => {
      const p = Math.round(hazardProgress(h) * 100);
      // Einsatzfahrzeuge in diesem Sektor
      const sv = race.svc || { cranes: [] };
      const svc = [];
      if (!h.global && sv.medical && sv.medical.sector === h.sector) svc.push(`<span class="svc-med">MEDICAL ${sv.medical.phase === 'onsite' ? 'vor Ort' : sv.medical.phase === 'out' ? 'unterwegs' : 'fährt zurück'}</span>`);
      if (!h.global && sv.cranes.some(c => c.sector === h.sector)) svc.push('<span class="svc-crane">CRANE im Einsatz</span>');
      if (!h.global && sv.sweeper && sv.sweeper.sector === h.sector) svc.push('<span class="svc-crane">SWEEPER im Einsatz</span>');
      return `
        <div class="ctl-hazard">
          <div>${WARN_ICON} <b>${hazardWhere(h)}:</b> ${h.desc}</div>
          <div class="progress"><span style="width:${p}%"></span></div>
          <div class="ctl-small">Bergung ${p} %${svc.length ? ` · ${svc.join(' · ')}` : ''}</div>
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
      kind, n && n.type, n && n.phase, n && (n.cheap || []).length, n && (n.stayed || []).length, n && n.unlap, n && n.go, Math.floor(race.time / 2),
      scInPossibleThisLap(race),
      race.cars.filter(c => c.unlap).length, race.cars.filter(c => c.redQueued).length,
      active.map(h => Math.round(hazardProgress(h) * 50)), canRestart(race),
      race.phase, race.lightsOn, kind === 'start' && Math.floor(((n && n.restart ? n.lightsTimer : race.lightsTimer) || 0) * 5), kind === 'start' && race.formation && race.cars.filter(c => c.fTarget !== undefined && c.fTarget - c.d <= 0.6).length, race.formation && race.formation.arrived, race.startIssue && race.startIssue.carId, race.startIssue && race.startIssue.released, race.laps,
      this.armed && this.armed.action, this.sel[kind],
      n && n.type === 'vsc' && n.phase === 'ending' && Math.ceil(n.endAt - race.time),
      race.inspection && [race.inspection.stage, race.inspection.report, race.sc && sectorIndexAt(race.track, race.sc.d)],
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
      sub = '';
      if (!n) {
        html = `<p class="ctl-text">Alle Autos fahren rund 40 % langsamer. Gut für Bergungen, die nur kurz dauern.</p>
          <button class="ctl-btn ctl-vsc" data-action="vsc-on" ${running ? '' : 'disabled'}>ACTIVATE VSC</button>`;
      } else if (n.type === 'vsc' && n.phase === 'active') {
        html = `<div class="ctl-status">VSC aktiv seit ${since}</div>
          <button class="ctl-btn ctl-green" data-action="vsc-off">END VSC</button>${stratHtml(n)}
          <p class="ctl-small">Nach „END VSC“ läuft ein Countdown von 5 s, dann ist Grün.</p>`;
      } else if (n.type === 'vsc') {
        const left = Math.max(0, Math.ceil(n.endAt - race.time));
        html = `<div class="vsc-count"><span>VSC ENDING</span><b>${left}</b><span>GREEN IN ${left} s</span></div>`;
      } else {
        html = `<p class="ctl-text">Nicht verfügbar, solange ${n.type === 'sc' ? 'das Safety Car' : 'die rote Flagge'} aktiv ist.</p>`;
      }
    }

    if (kind === 'sc' && !race.isSession) {
      sub = '';
      if (!n || n.type === 'vsc') {
        html = `<p class="ctl-text">Das Safety Car fährt an der Boxenausfahrt raus, sobald der Führende dort ankommt, und das Feld schließt auf. Gut für längere Bergungen und Trümmerfelder.${n ? ' Das VSC wird dadurch ersetzt.' : ''}</p>
          <button class="ctl-btn ctl-sc" data-action="sc-on" ${running ? '' : 'disabled'}>ACTIVATE SC</button>`;
      } else if (n.type === 'sc' && race.sc && race.sc.waiting) {
        const lead = race.standings().find(c => !c.retired && !c.finished);
        const dist = lead ? Math.round(((race.track.pit.exit - lead.d) % race.track.L + race.track.L) % race.track.L) : 0;
        html = `<div class="ctl-status">Safety Car wartet an der Boxenausfahrt</div>
          <p class="ctl-text">Es fährt raus, sobald ${lead ? lead.id : 'der Führende'} kurz vor der Ausfahrt ist (noch ${dist} m). Bis dahin gilt für alle Delta-Tempo, Überholen verboten.</p>`;
      } else if (n.type === 'sc') {
        const leader = race.standings().find(c => !c.retired);
        const laps = Math.max(0, leader.lap - (n.startLap ?? leader.lap));
        const unlapping = race.cars.filter(c => c.unlap).map(c => c.id);
        if (n.phase === 'out') {
          const sec0 = race.sc && !race.sc.inPit ? sectorIndexAt(race.track, race.sc.d) + 1 : null;
          html = `<div class="ctl-status">Safety Car seit ${since}${n.startLap !== undefined ? ` · ${laps} Rd` : ''}</div>
            <div class="ctl-kv"><div><span>SC VOR</span><b>${leader ? leader.id : '–'}</b></div><div><span>SC IN</span><b>${sec0 ? `SEKTOR ${sec0}` : 'BOX'}</b></div><div><span>AUTOS</span><b>${race.cars.filter(c => !c.retired && !c.finished).length}</b></div></div>${stratHtml(n)}`;
          if (n.release && n.release.length) html += `<p class="ctl-small">Boxenausfahrt: ${n.release.length} Autos warten noch.</p>`;
          html += n.unlap
            ? `<div class="ctl-small">${unlapping.length ? `Zurückrunden läuft: ${unlapping.join(', ')}` : 'Überrundete haben sich zurückgerundet.'}</div>`
            : `<button class="ctl-btn ctl-ghost" data-action="sc-unlap">ALLOW LAPPED CARS TO UNLAP</button>
               <p class="ctl-small">Überrundete Autos überholen das Feld und das Safety Car und schließen hinten wieder an. Dauert etwa eine Runde.</p>`;
          const now = scInPossibleThisLap(race);
          const sec = race.sc && !race.sc.inPit ? sectorIndexAt(race.track, race.sc.d) + 1 : null;
          const last = scInLastSector(race.track);
          html += `<button class="ctl-btn ctl-green" data-action="sc-in">${now ? 'SC IN THIS LAP' : 'SC IN NEXT LAP'}</button>
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
      const scNote = '';
      sub = '';
      html = `<div class="sec-grid">${grid}</div>`;
      if (kind === 'medical') {
        const m = sv.medical;
        html += m ? `<div class="ctl-status">Medical Car im Einsatz – ${m.phase === 'out' ? `unterwegs zu Sektor ${m.sector + 1}` : m.phase === 'onsite' ? `an der Unfallstelle in Sektor ${m.sector + 1}` : 'zurück zur Box'}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="med-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>MEDICAL CAR → SEKTOR ${sel + 1}</button>${scNote}`;
      } else if (kind === 'sweeper') {
        html += sv.sweeper ? `<div class="ctl-status">Kehrmaschine räumt Sektor ${sv.sweeper.sector + 1}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="sweep-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>SWEEPER → SEKTOR ${sel + 1}</button>${scNote}`;
      } else {
        html += busy.has(sel)
          ? `<div class="ctl-status">Crane in Sektor ${sel + 1} im Einsatz</div><button class="ctl-btn ctl-ghost" data-action="crane-off:${sel}">REMOVE CRANE</button>`
          : `<button class="ctl-btn ctl-vsc" data-action="crane-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>CRANE → SEKTOR ${sel + 1}</button>`;
      }
    }

    if (kind === 'bo') {
      sub = '';
      // Jedes Auto kann an die Box beordert werden; beschädigte sind gelb markiert. Grundlos = Abzug.
      const cars = race.cars.map((c, i) => ({ c, i })).filter(({ c }) => !c.retired && !c.finished);
      const vib = c => { const x = Math.sin((c.id.charCodeAt(0) + c.id.charCodeAt(2)) * 7.3) * 0.5 + 0.5; return Math.round((c.wingLoose ? 55 + x * 40 : c.damage ? 15 + x * 45 : 2 + x * 8)); };
      if (this.sel.bo === undefined || !cars.some(x => x.i === this.sel.bo)) {
        const dmg = cars.find(({ c }) => c.damage && !c.boShown);
        this.sel.bo = dmg ? dmg.i : cars.length ? cars[0].i : 0;
      }
      const sel = race.cars[this.sel.bo];
      html = `<div class="sec-grid car-grid">${cars.map(({ c, i }) => `<button class="sec-pick${c.damage ? ' need' : ''}${c.boShown ? ' busy' : ''}${i === this.sel.bo ? ' sel' : ''}" data-sec="${i}">${c.id}</button>`).join('')}</div>`;
      if (sel) {
        html += `<div class="ctl-hazard"><div><b>${sel.id}</b> – ${sel.damage === 'wing' ? 'Frontflügel beschädigt' : sel.damage === 'puncture' ? 'Reifenschaden' : 'keine Schäden gemeldet'}${sel.boShown ? ' · <b>Schwarz-Orange gezeigt</b>' : ''}</div>
          <div class="ctl-small">Onboard: Vibration ${vib(sel)} %${sel.damage ? ` · ${sel.damageStayOut ? 'Team lässt ihn draußen' : 'kommt zur Reparatur'}` : ''}${sel.inPit ? ' · in der Boxengasse' : ''}</div></div>`;
        if (!sel.boShown) html += `<button class="ctl-btn ctl-sc" data-action="bo-go:${this.sel.bo}" ${running && !sel.inPit ? '' : 'disabled'}>BLACK-ORANGE FLAG FOR ${sel.id}</button>`;
      }
    }

    if (kind === 'msg') {
      sub = '';
      const live = race.phase === 'running' || (race.preStart && race.phase !== 'pre');
      const st = race.rcMsgs || { until: {}, sent: [] };
      html = '<div class="msg-grid">';
      for (const key of ['yellow', 'blue', 'driving', 'pit']) {
        const m = MESSAGES[key];
        const act = msgActive(race, key);
        const left = act ? mmss(st.until[key] - race.time) : '';
        html += `<button class="ctl-btn ${act ? 'ctl-ghost' : 'ctl-vsc'}" data-action="msg-${key}" ${live && canSend(race, key) ? '' : 'disabled'}>${m.name}${act ? ` · ${left}` : ''}</button>`;
      }
      html += '</div>';
      const b = race.briefing;
      if (b && b.done && b.tlCorners) {
        const free = race.track.corners.map((c, i) => ({ c, i })).filter(({ c }) => !b.tlCorners.includes(c.id));
        if (this.sel.msg === undefined || !free.some(x => x.i === this.sel.msg)) this.sel.msg = free.length ? free[0].i : 0;
        html += `<div class="ctl-section">TRACK LIMITS · ÜBERWACHT: ${b.tlCorners.join(', ') || '–'}</div>`;
        html += free.length ? `<div class="sec-grid car-grid">${free.map(({ c, i }) => `<button class="sec-pick${i === this.sel.msg ? ' sel' : ''}" data-sec="${i}">${c.id}</button>`).join('')}</div>
          <button class="ctl-btn ctl-vsc" data-action="msg-tl:${this.sel.msg}" ${live ? '' : 'disabled'}>MONITOR TRACK LIMITS ${race.track.corners[this.sel.msg].id}</button>` : '<div class="ctl-ok">Alle Kurven werden überwacht.</div>';
      }
      if (st.sent.length) html += `<div class="ctl-section">GESENDET</div>${st.sent.slice(-2).reverse().map(x => `<div class="ctl-small">Rd ${x.lap} · ${x.key === 'tl' ? `TRACK LIMITS ${x.arg}` : MESSAGES[x.key].name}</div>`).join('')}`;
    }

    if (kind === 'pit') {
      const closed = race.svc && race.svc.pitClosed;
      sub = '';
      html = closed
        ? `<div class="ctl-status">Boxengasse ist GESCHLOSSEN</div><button class="ctl-btn ctl-green" data-action="pit-open">OPEN PIT LANE</button>`
        : `<div class="ctl-status">Boxengasse ist offen</div><button class="ctl-btn ctl-red" data-action="pit-close" ${race.phase !== 'pre' && race.phase !== 'finished' ? '' : 'disabled'}>CLOSE PIT LANE</button>`;
      html += '<p class="ctl-small">Liegt im Ermessen der Rennleitung. Ohne Grund geschlossen kostet es Punkte beim Rennfluss.</p>';
    }

    if (kind === 'start') {
      const rs = Boolean(n && n.type === 'red' && n.restart);
      const ph = rs ? n.phase : race.phase;
      const lt = rs ? n.lightsTimer : race.lightsTimer;
      const f = race.formation;
      const issue = rs ? null : race.startIssue;
      sub = rs ? 'Neustart nach der roten Flagge' : '';
      const live = rs ? ['formation', 'grid', 'lights'].includes(ph) : race.preStart && ph !== 'pre';
      // Ablauf
      const STEPS = [['ready', 'INSPECTION'], ['formation', 'FORMATION'], ['grid', 'GRID'], ['lights', 'LIGHTS'], ['go', 'START']];
      const order = STEPS.map(x => x[0]);
      const curI = !live ? 4 : ph === 'delay' ? 1 : order.indexOf(ph === 'formation' && f && f.arrived ? 'grid' : ph);
      html = `<div class="seq">${STEPS.filter(x => !rs || x[0] !== 'ready').map(([k, l]) => {
        const i = order.indexOf(k);
        return `<span class="seq-step${i < curI ? ' done' : i === curI ? ' now' : ''}">${i < curI ? '✓ ' : ''}${l}</span>`;
      }).join('')}</div>`;
      // Startboxen
      const grid = f && f.order ? f.order.map(id => race.carById[id]).filter(c => c && !c.retired && !c.pitStart) : [];
      const inBox = f && f.arrived ? grid.length : grid.filter(c => c.fTarget !== undefined && c.fTarget - c.d <= 0.6).length;
      const pitStart = race.cars.filter(c => c.pitStart && !c.retired).length;
      if (ph === 'delay') {
        const ds = (race.delay.order || []).map(id => race.carById[id]).filter(c => c && !c.retired && !c.pitStart);
        const inLane = ds.filter(c => c.pTarget !== undefined && c.pTarget - c.d < 0.6).length;
        const open = race.hazards.filter(h => !h.ended && h.type !== 'spin').length;
        html += `<div class="ctl-kv"><div><span>BOXENGASSE</span><b class="${inLane < ds.length ? 'warn' : 'ok'}">${inLane}/${ds.length}</b></div><div><span>GEFAHREN</span><b class="${open ? 'warn' : 'ok'}">${open}</b></div><div><span>RENNDISTANZ</span><b>${race.laps} RD</b></div></div>`;
      } else if (live && ph !== 'ready') {
        html += `<div class="ctl-kv"><div><span>STARTBOX</span><b class="${inBox < grid.length ? 'warn' : 'ok'}">${inBox}/${grid.length}</b></div><div><span>${rs ? 'NEUSTART' : 'FORMATION'}</span><b>${rs ? 'STEHEND' : f && f.n > 1 ? `${f.n}. RUNDE` : '1. RUNDE'}</b></div><div><span>BOXENGASSE</span><b>${pitStart}</b></div></div>`;
      }
      // Startampel
      const lit = race.lightsOn;
      const allOn = ph === 'lights' && lt >= ALL_ON;
      html += `<div class="sl-wrap"><div class="sl${allOn ? ' all' : ''}">${[0, 1, 2, 3, 4].map(i => `<div class="sl-col"><i class="${i < lit ? 'on' : ''}"></i><i class="${i < lit ? 'on' : ''}"></i></div>`).join('')}</div>
        <div class="sl-txt">${ph === 'lights' ? (allOn ? `ALLE LICHTER AN · ${(lt - ALL_ON).toFixed(1).replace('.', ',')} s` : lit ? `${lit} / 5` : 'PRE-START') : !live ? 'LICHTER AUS – RENNEN LÄUFT' : 'AMPEL AUS'}</div></div>`;
      // Lage und Hauptaktion
      if (!live) {
        html += `<div class="ctl-status">${race.phase === 'pre' ? 'Der Start wurde noch nicht freigegeben.' : 'Das Rennen ist gestartet.'}</div>`;
      } else if (ph === 'ready') {
        // Zuerst die Inspektionsrunde des Safety Cars, dann die Formationsrunde
        const I = race.inspection;
        if (!I) {
          html += `<button class="ctl-btn ctl-sc ctl-big" data-action="seq-inspect">SEND SC ON INSPECTION LAP</button>`;
        } else if (!I.report) {
          html += `<div class="ctl-status">Safety Car auf der Inspektionsrunde${race.sc ? ` · Sektor ${sectorIndexAt(race.track, race.sc.d) + 1}` : ''}</div>
            <button class="ctl-btn ctl-ghost ctl-big" disabled>SC ON INSPECTION LAP …</button>`;
        } else {
          const h = I.issue && race.hazards.find(x => x.id === I.issue);
          html += h && !h.ended
            ? `<div class="ctl-status warn">⚠ SC meldet: ${h.desc}</div>`
            : `<div class="ctl-status ok">✓ SC: Strecke in Ordnung${h ? ' (Problem behoben)' : ''}</div>`;
          html += `<button class="ctl-btn ctl-green ctl-big" data-action="seq-formation">START FORMATION LAP</button>`;
        }
      } else if (ph === 'delay') {
        const D = race.delay, ok = canResumeStart(race);
        html += `<div class="ctl-status warn">START VERSCHOBEN – ${D.stage === 'toPit' ? 'das Feld fährt in die Boxengasse' : 'das Feld steht in der Boxengasse'}</div>
          <p class="ctl-small">Die Strecke ist gesperrt: Medical Car, Kehrmaschine und Kran dürfen ohne Safety Car raus. Ist alles geborgen, geht es mit einer neuen Formationsrunde aus der Boxengasse weiter.</p>
          <button class="ctl-btn ctl-green ctl-big" data-action="start-resume" ${ok ? '' : 'disabled'}>${D.stage === 'toPit' ? 'FIELD ENTERING PIT LANE …' : ok ? 'START NEW FORMATION LAP' : 'TRACK NOT CLEAR YET'}</button>`;
      } else if (issue && !issue.released && f && f.arrived) {
        html += issue.type === 'rain'
          ? '<div class="ctl-status warn">⚠ Starker Regen in der Startaufstellung – die Autos stehen auf Trockenreifen</div><p class="ctl-text">Start abbrechen (Startverschiebung, Reifenwechsel) oder hinter dem Safety Car starten.</p>'
          : `<div class="ctl-status warn">⚠ ${issue.carId} steht mit abgestorbenem Motor in der Startaufstellung</div><p class="ctl-text">Schalte die Startampel jetzt nicht ein – ein stehendes Auto beim Start ist gefährlich.</p>`;
        html += `<p class="ctl-small">${issue.type === 'rain' ? 'Alle wechseln auf Regenreifen.' : `${issue.carId} wird in die Boxengasse geschoben und startet von dort.`} Ein Startabbruch kostet eine Runde (dann ${Math.max(3, race.laps - 1)} Runden).</p>
          <button class="ctl-btn ctl-red" data-action="start-abort">EXTRA FORMATION LAP</button>
          <button class="ctl-btn ctl-sc" data-action="start-sc">START BEHIND SC</button>
          <button class="ctl-btn ctl-ghost" data-action="start-suspend">DELAY START</button>
          <button class="ctl-btn ctl-ghost" data-action="start-lights">START LIGHTS ANYWAY</button>`;
      } else if (ph === 'formation' && !(f && f.arrived)) {
        html += `<button class="ctl-btn ctl-ghost" data-action="start-suspend">DELAY START</button>
          <button class="ctl-btn ctl-ghost ctl-big" data-action="start-lights">START LIGHTS · ${grid.length - inBox} CARS STILL MOVING</button>`;
      } else if (ph === 'grid' || ph === 'formation') {
        // „Startaufstellung komplett“ zeigt schon STARTBOX x/x – die drei Alternativen passen in eine Reihe
        html += `${rs ? '' : '<button class="ctl-btn ctl-ghost ctl-third" data-action="start-suspend">DELAY START</button><button class="ctl-btn ctl-ghost ctl-third" data-action="start-abort">EXTRA FORMATION LAP</button><button class="ctl-btn ctl-ghost ctl-third" data-action="start-sc">START BEHIND SC</button>'}
          <button class="ctl-btn ctl-amber ctl-big" data-action="start-lights">START LIGHTS</button>`;
      } else if (ph === 'lights' && !allOn) {
        html += `<button class="ctl-btn ctl-ghost ctl-big" disabled>${lit ? `LICHTER ${lit} / 5 …` : 'PRE-START …'}</button>`;
      } else {
        html += `<button class="ctl-btn ctl-red ctl-big lights-out" data-action="seq-out">LIGHTS OUT</button>`;
      }
    }

    if (kind === 'red') {
      sub = '';
      if (!n || n.type !== 'red') {
        html = `<p class="ctl-text">${race.isSession ? 'Die Session wird unterbrochen, alle Autos fahren in die Box, die Uhr hält an.' : 'Alle Autos fahren langsam in die Boxengasse und stellen sich an. Freier Reifenwechsel. Nur bei großer Gefahr, z. B. beschädigter Barriere.'}</p>
          <button class="ctl-btn ctl-red" data-action="red-on" ${running ? '' : 'disabled'}>ACTIVATE RED FLAG</button>`;
      } else if (n.phase === 'stopping') {
        const racing = race.cars.filter(c => !c.retired && !c.finished).length;
        const q = race.cars.filter(c => c.redQueued).length;
        html = `<div class="ctl-status">Rote Flagge seit ${since} – ${q}/${racing} Autos in der Boxengasse</div>`;
      } else if (n.phase === 'stopped' && race.isSession) {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Session unterbrochen seit ${since} – die Uhr steht (noch ${Math.ceil(race.remaining / 60)} Min.)</div>
          <button class="ctl-btn ctl-green" data-action="session-resume" ${ok ? '' : 'disabled'}>RESUME SESSION</button>
          ${ok ? '' : '<p class="ctl-small">Fortsetzen erst möglich, wenn die Strecke geräumt ist.</p>'}
          <button class="ctl-btn ctl-ghost" data-action="session-end">END SESSION</button>
          <p class="ctl-small">Sinnvoll nur, wenn kaum noch Zeit übrig ist oder die Strecke lange nicht frei wird.</p>`;
      } else if (n.phase === 'stopped') {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Rennen unterbrochen seit ${since}</div>
          <button class="ctl-btn ctl-sc" data-action="restart-sc" ${ok ? '' : 'disabled'}>RESTART BEHIND SC</button>
          <button class="ctl-btn ctl-ghost" data-action="restart-standing" ${ok ? '' : 'disabled'}>STANDING RESTART</button>
          ${ok ? '' : '<p class="ctl-small">Neustart erst möglich, wenn die Strecke geräumt ist.</p>'}
          <button class="ctl-btn ctl-ghost" data-action="race-end">END RACE · NO RESTART</button>
          <p class="ctl-small">Punkte je nach gefahrener Distanz: unter 2 Runden keine, bis 25 % / 50 % / 75 % gestaffelt, ab 75 % volle Punkte.</p>`;
      } else {
        html = `<div class="ctl-status">${n.phase === 'formation' ? 'Formationsrunde zum Neustart läuft' : n.phase === 'grid' ? 'Startaufstellung komplett – Startampel über den Knopf auf der Karte' : 'Startampel läuft'}</div>
          <p class="ctl-small">Die Autos kommen in Rennreihenfolge aus der Boxengasse, fahren eine Runde und stellen sich auf. Schalte die Ampel erst ein, wenn alle stehen.</p>`;
      }
    }

    this.subEl.textContent = sub;
    // Scharf geschaltete Taste hervorheben
    if (this.armed) {
      const key = armKey(this.armed.action);
      const boCar = key === 'bo-go' ? race.cars[Number(this.armed.action.split(':')[1])] : null;
      const label = boCar ? `ARMED – BLK/ORG FOR ${boCar.id} NOW` : ARMED_LABEL[key] || 'ARMED – NOW';
      html = html.replace(new RegExp(`(<button class="ctl-btn[^"]*)("[^>]*data-action="${this.armed.action}"[^>]*>)([^<]*)`), `$1 armed$2${label}`);
    }
    this.body.innerHTML = html + `<div class="ctl-section">TRACK STATUS</div>${this.hazardsHtml(race, this.kind === 'start')}`;
    // Vollbild-Pult: Aktionsknöpfe nach unten an den Daumen
    if (this.foot) {
      this.foot.innerHTML = '';
      for (const b of [...this.body.children].filter(x => x.matches('button.ctl-btn'))) this.foot.appendChild(b);
    }
  }
}
