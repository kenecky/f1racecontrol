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
const ARMED = new Set(['vsc-on', 'sc-on', 'red-on', 'med-go', 'sweep-go', 'crane-go', 'pit-close', 'bo-go']);
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

  hazardsHtml(race) {
    const active = race.hazards.filter(h => !h.ended && h.type !== 'spin');
    if (!active.length) return '<div class="ctl-ok">✓ Keine offene Gefahr auf der Strecke.</div>';
    return active.map(h => {
      const p = Math.round(hazardProgress(h) * 100);
      // Einsatzfahrzeuge in diesem Sektor
      const sv = race.svc || { cranes: [] };
      const svc = [];
      if (!h.global && sv.medical && sv.medical.sector === h.sector) svc.push(`<span class="svc-med">MEDICAL ${sv.medical.phase === 'onsite' ? 'vor Ort' : sv.medical.phase === 'out' ? 'unterwegs' : 'fährt zurück'}</span>`);
      if (!h.global && sv.cranes.some(c => c.sector === h.sector)) svc.push('<span class="svc-crane">KRAN im Einsatz</span>');
      if (!h.global && sv.sweeper && sv.sweeper.sector === h.sector) svc.push('<span class="svc-crane">KEHRMASCHINE im Einsatz</span>');
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
          <button class="ctl-btn ctl-green" data-action="vsc-off">VSC beenden</button>${stratHtml(n)}
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
        html = `<p class="ctl-text">Das Safety Car fährt an der Boxenausfahrt raus, sobald der Führende dort ankommt, und das Feld schließt auf. Gut für längere Bergungen und Trümmerfelder.${n ? ' Das VSC wird dadurch ersetzt.' : ''}</p>
          <button class="ctl-btn ctl-sc" data-action="sc-on" ${running ? '' : 'disabled'}>Safety Car einsetzen</button>`;
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
      const scNote = race.phase === 'delay'
        ? '<p class="ctl-small">Start verschoben – das Feld ist in der Boxengasse, die Strecke ist gesperrt. Kein Safety Car nötig.</p>'
        : '<p class="ctl-small">Regel: Vorher muss das Safety Car (oder Rot) draußen sein. Sonst gibt es Abzug bei der Sicherheit. Vor dem Start: erst „Start verschieben“ (Feld in die Boxengasse).</p>';
      sub = { medical: 'Zur Unfallstelle – Fahrer untersuchen', sweeper: 'Kies und Schmutz von der Fahrbahn räumen', crane: 'Steht im jeweiligen Streckenabschnitt bereit' }[kind];
      html = `<div class="ctl-small">Sektor wählen (gelb = dort wird ${kind === 'medical' ? 'das Medical Car' : kind === 'sweeper' ? 'eine Kehrmaschine' : 'ein Kran'} gebraucht):</div><div class="sec-grid">${grid}</div>`;
      if (kind === 'medical') {
        const m = sv.medical;
        html += m ? `<div class="ctl-status">Medical Car im Einsatz – ${m.phase === 'out' ? `unterwegs zu Sektor ${m.sector + 1}` : m.phase === 'onsite' ? `an der Unfallstelle in Sektor ${m.sector + 1}` : 'zurück zur Box'}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="med-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>MEDICAL CAR → SEKTOR ${sel + 1}</button>${scNote}`;
      } else if (kind === 'sweeper') {
        html += sv.sweeper ? `<div class="ctl-status">Kehrmaschine räumt Sektor ${sv.sweeper.sector + 1}</div>`
          : `<button class="ctl-btn ctl-vsc" data-action="sweep-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>KEHRMASCHINE → SEKTOR ${sel + 1}</button>${scNote}`;
      } else {
        html += busy.has(sel)
          ? `<div class="ctl-status">Kran in Sektor ${sel + 1} im Einsatz</div><button class="ctl-btn ctl-ghost" data-action="crane-off:${sel}">KRAN ABZIEHEN</button>`
          : `<button class="ctl-btn ctl-vsc" data-action="crane-go:${sel}" ${svcPhase(race) ? '' : 'disabled'}>KRAN IN SEKTOR ${sel + 1} EINSETZEN</button>`;
        html += '<p class="ctl-small">Ein Kran neben der Strecke braucht mindestens Doppelt Gelb in diesem Sektor (bei Nässe Safety Car). Ein Kran im falschen Sektor kostet Punkte.</p>';
      }
    }

    if (kind === 'bo') {
      sub = 'Beschädigtes Auto muss sofort an die Box';
      const dmg = race.cars.map((c, i) => ({ c, i })).filter(({ c }) => c.damage === 'wing' && !c.retired && !c.finished && !c.inPit);
      // Eindruck aus der Onboard-Kamera: bei losen Teilen meist starke Vibration – aber nicht immer eindeutig
      const vib = c => { const x = Math.sin((c.id.charCodeAt(0) + c.id.charCodeAt(2)) * 7.3) * 0.5 + 0.5; return Math.round((c.wingLoose ? 55 + x * 40 : 15 + x * 45)); };
      html = dmg.length ? dmg.map(({ c, i }) => `
        <div class="ctl-hazard"><div><b>${c.id}</b> – Frontflügel beschädigt${c.boShown ? ' · <b>Schwarz-Orange gezeigt</b>' : ''}</div>
          <div class="ctl-small">Onboard: Vibration am Flügel ${vib(c)} % · ${c.damageStayOut ? 'Team lässt ihn draußen' : 'kommt zur Reparatur'}</div>
          ${c.boShown ? '' : `<button class="ctl-btn ctl-sc" data-action="bo-go:${i}">SCHWARZ-ORANGE FÜR ${c.id}</button>`}</div>`).join('')
        : '<div class="ctl-ok">Kein Auto mit losem oder beschädigtem Teil auf der Strecke.</div>';
      html += '<p class="ctl-small">Nur zeigen, wenn Teile abzufallen drohen (starke Vibration). Fällt ein Teil ab, bevor die Flagge gezeigt wurde, gibt es Abzug – eine unnötige Flagge ist unfair gegenüber dem Team.</p>';
    }

    if (kind === 'msg') {
      sub = 'Mitteilung an alle Teams';
      const live = race.phase === 'running' || (race.preStart && race.phase !== 'pre');
      const st = race.rcMsgs || { until: {}, sent: [] };
      html = '<p class="ctl-small">Eine Warnung an alle wirkt etwa 10 Minuten: Die Fahrer halten sich besser an die Regeln. Wiederholte Warnungen verlieren an Wirkung.</p>';
      for (const key of ['yellow', 'blue', 'driving', 'pit']) {
        const m = MESSAGES[key];
        const act = msgActive(race, key);
        const left = act ? mmss(st.until[key] - race.time) : '';
        html += `<button class="ctl-btn ${act ? 'ctl-ghost' : 'ctl-vsc'}" data-action="msg-${key}" ${live && canSend(race, key) ? '' : 'disabled'}>${m.name}${act ? ` · aktiv ${left}` : ''}</button>`;
      }
      const b = race.briefing;
      if (b && b.done && b.tlCorners) {
        const free = race.track.corners.map((c, i) => ({ c, i })).filter(({ c }) => !b.tlCorners.includes(c.id));
        if (this.sel.msg === undefined || !free.some(x => x.i === this.sel.msg)) this.sel.msg = free.length ? free[0].i : 0;
        html += `<div class="ctl-section">TRACK LIMITS</div><div class="ctl-small">Überwacht: ${b.tlCorners.join(', ') || '–'}. Weitere Kurve wählen:</div>`;
        html += free.length ? `<div class="sec-grid">${free.map(({ c, i }) => `<button class="sec-pick${i === this.sel.msg ? ' sel' : ''}" data-sec="${i}">${c.id}</button>`).join('')}</div>
          <button class="ctl-btn ctl-vsc" data-action="msg-tl:${this.sel.msg}" ${live ? '' : 'disabled'}>${race.track.corners[this.sel.msg].id} ÜBERWACHEN</button>` : '<div class="ctl-ok">Alle Kurven werden überwacht.</div>';
      }
      if (st.sent.length) html += `<div class="ctl-section">GESENDET</div>${st.sent.slice(-5).reverse().map(x => `<div class="ctl-small">Rd ${x.lap} · ${x.key === 'tl' ? `TRACK LIMITS ${x.arg}` : MESSAGES[x.key].name}</div>`).join('')}`;
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
      const rs = Boolean(n && n.type === 'red' && n.restart);
      const ph = rs ? n.phase : race.phase;
      const lt = rs ? n.lightsTimer : race.lightsTimer;
      const f = race.formation;
      const issue = rs ? null : race.startIssue;
      sub = rs ? 'Neustart nach der roten Flagge' : '';
      const live = rs ? ['formation', 'grid', 'lights'].includes(ph) : race.preStart && ph !== 'pre';
      // Ablauf
      const STEPS = [['ready', 'FREIGABE'], ['formation', 'FORMATION'], ['grid', 'GRID'], ['lights', 'AMPEL'], ['go', 'START']];
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
        html += `<div class="ctl-kv"><div><span>IN DER BOXENGASSE</span><b class="${inLane < ds.length ? 'warn' : 'ok'}">${inLane}/${ds.length}</b></div><div><span>OFFENE GEFAHREN</span><b class="${open ? 'warn' : 'ok'}">${open}</b></div><div><span>RENNDISTANZ</span><b>${race.laps} RD</b></div></div>`;
      } else if (live && ph !== 'ready') {
        html += `<div class="ctl-kv"><div><span>IN DER STARTBOX</span><b class="${inBox < grid.length ? 'warn' : 'ok'}">${inBox}/${grid.length}</b></div><div><span>${rs ? 'NEUSTART' : 'FORMATION'}</span><b>${rs ? 'STEHEND' : f && f.n > 1 ? `${f.n}. RUNDE` : '1. RUNDE'}</b></div><div><span>BOXENGASSE</span><b>${pitStart}</b></div></div>`;
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
        html += `<button class="ctl-btn ctl-green ctl-big" data-action="seq-formation">START FORMATION LAP</button>`;
      } else if (ph === 'delay') {
        const D = race.delay, ok = canResumeStart(race);
        html += `<div class="ctl-status warn">START VERSCHOBEN – ${D.stage === 'toPit' ? 'das Feld fährt in die Boxengasse' : 'das Feld steht in der Boxengasse'}</div>
          <p class="ctl-small">Die Strecke ist gesperrt: Medical Car, Kehrmaschine und Kran dürfen ohne Safety Car raus. Ist alles geborgen, geht es mit einer neuen Formationsrunde aus der Boxengasse weiter.</p>
          <button class="ctl-btn ctl-green ctl-big" data-action="start-resume" ${ok ? '' : 'disabled'}>${D.stage === 'toPit' ? 'FELD FÄHRT IN DIE BOXENGASSE …' : ok ? 'NEUE FORMATIONSRUNDE STARTEN' : 'ERST BERGEN – STRECKE NICHT FREI'}</button>`;
      } else if (issue && !issue.released && f && f.arrived) {
        html += issue.type === 'rain'
          ? '<div class="ctl-status warn">⚠ Starker Regen in der Startaufstellung – die Autos stehen auf Trockenreifen</div><p class="ctl-text">Start abbrechen (Startverschiebung, Reifenwechsel) oder hinter dem Safety Car starten.</p>'
          : `<div class="ctl-status warn">⚠ ${issue.carId} steht mit abgestorbenem Motor in der Startaufstellung</div><p class="ctl-text">Schalte die Startampel jetzt nicht ein – ein stehendes Auto beim Start ist gefährlich.</p>`;
        html += `<p class="ctl-small">${issue.type === 'rain' ? 'Alle wechseln auf Regenreifen.' : `${issue.carId} wird in die Boxengasse geschoben und startet von dort.`} Ein Startabbruch kostet eine Runde (dann ${Math.max(3, race.laps - 1)} Runden).</p>
          <button class="ctl-btn ctl-red" data-action="start-abort">EXTRA-FORMATIONSRUNDE</button>
          <button class="ctl-btn ctl-sc" data-action="start-sc">START HINTER DEM SC</button>
          <button class="ctl-btn ctl-ghost" data-action="start-suspend">START VERSCHIEBEN · FELD IN DIE BOX</button>
          <button class="ctl-btn ctl-ghost" data-action="start-lights">STARTAMPEL TROTZDEM EINSCHALTEN</button>`;
      } else if (ph === 'formation' && !(f && f.arrived)) {
        html += `<p class="ctl-text">${f && f.n > 1 ? 'Extra-' : ''}Formationsrunde: Die Autos wärmen Reifen und Bremsen auf. Defekte oder Dreher sind möglich – sichere Gefahren wie im Rennen mit Flaggen ab.</p>
          <p class="ctl-small">Ampel erst einschalten, wenn alle Autos stehen – sonst großer Abzug bei der Sicherheit. Muss vor dem Start etwas geborgen werden: Start verschieben – das Feld fährt nach dieser Runde in die Boxengasse.</p>
          <button class="ctl-btn ctl-ghost" data-action="start-suspend">START VERSCHIEBEN · FELD IN DIE BOX</button>
          <button class="ctl-btn ctl-ghost ctl-big" data-action="start-lights">AMPEL EINSCHALTEN · NOCH ${grid.length - inBox} UNTERWEGS</button>`;
      } else if (ph === 'grid' || ph === 'formation') {
        html += `<div class="ctl-status ok">Startaufstellung komplett</div>
          ${rs ? '' : '<button class="ctl-btn ctl-ghost" data-action="start-abort">EXTRA-FORMATIONSRUNDE</button><button class="ctl-btn ctl-ghost" data-action="start-sc">START HINTER SC</button><button class="ctl-btn ctl-ghost" data-action="start-suspend">START VERSCHIEBEN · FELD IN DIE BOX</button>'}
          <button class="ctl-btn ctl-amber ctl-big" data-action="start-lights">STARTAMPEL EINSCHALTEN</button>`;
      } else if (ph === 'lights' && !allOn) {
        html += `<button class="ctl-btn ctl-ghost ctl-big" disabled>${lit ? `LICHTER ${lit} / 5 …` : 'PRE-START …'}</button>`;
      } else {
        html += `<button class="ctl-btn ctl-red ctl-big lights-out" data-action="seq-out">LIGHTS OUT</button>`;
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
          ${ok ? '' : '<p class="ctl-small">Fortsetzen erst möglich, wenn die Strecke geräumt ist.</p>'}
          <button class="ctl-btn ctl-ghost" data-action="session-end">Session nicht fortsetzen</button>
          <p class="ctl-small">Sinnvoll nur, wenn kaum noch Zeit übrig ist oder die Strecke lange nicht frei wird.</p>`;
      } else if (n.phase === 'stopped') {
        const ok = canRestart(race);
        html = `<div class="ctl-status">Rennen unterbrochen seit ${since}</div>
          <button class="ctl-btn ctl-sc" data-action="restart-sc" ${ok ? '' : 'disabled'}>Neustart hinter dem Safety Car</button>
          <button class="ctl-btn ctl-ghost" data-action="restart-standing" ${ok ? '' : 'disabled'}>Stehender Neustart</button>
          ${ok ? '' : '<p class="ctl-small">Neustart erst möglich, wenn die Strecke geräumt ist.</p>'}
          <button class="ctl-btn ctl-ghost" data-action="race-end">Rennen nicht neu starten (Wertung)</button>
          <p class="ctl-small">Punkte je nach gefahrener Distanz: unter 2 Runden keine, bis 25 % / 50 % / 75 % gestaffelt, ab 75 % volle Punkte.</p>`;
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
    // Vollbild-Pult: Aktionsknöpfe nach unten an den Daumen
    if (this.foot) {
      this.foot.innerHTML = '';
      for (const b of [...this.body.children].filter(x => x.matches('button.ctl-btn'))) this.foot.appendChild(b);
    }
  }
}
