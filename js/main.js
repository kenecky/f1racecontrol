// Einstieg: verbindet Simulation und Oberfläche, Game-Loop.
import { TEAMS } from './data/teams.js';
import { DRIVERS } from './data/drivers.js';
import { RED_BULL_RING } from './data/tracks/redbullring.js';
import { buildTrack } from './sim/trackModel.js';
import { Race, DT, formatLap } from './sim/race.js';
import { randomSeed } from './util/rng.js';
import { setSectorFlag, clearAllFlags, trackStatus, flagReport } from './control/flags.js';
import { TrackMap } from './ui/map.js';
import { renderTiming, formatClock, formatGap } from './ui/timing.js';
import { Feed } from './ui/feed.js';
import { FlagPanel } from './ui/flagPanel.js';
import { ControlPanel } from './ui/controlPanel.js';
import { CasesPanel } from './ui/casesPanel.js';
import {
  investigate, postpone, noFurtherAction, decide, openCases, stewardReport, unservedSecs,
} from './control/stewards.js';
import {
  deployVSC, endVSC, deploySC, allowUnlap, scInThisLap, redFlag, restartRace, canRestart,
} from './sim/neutral.js';
import { loadSettings, saveSettings, loadHistory, saveHistoryEntry } from './storage.js';
import { rateRace, AXES } from './control/rating.js';

const SPEEDS = [1, 2, 4, 8, 16, 32];
const $ = id => document.getElementById(id);

const settings = loadSettings();
const track = buildTrack(RED_BULL_RING);
const map = new TrackMap($('map'), track);
const feed = new Feed($('feed'));
const flagPanel = new FlagPanel({
  root: $('flagSheet'),
  list: $('flagList'),
  track,
  onSet: (idx, flag) => {
    setSectorFlag(race, idx, flag);
    map.highlightSector = idx;
    flagPanel.render(race);
    refreshUi();
  },
});

const controlPanel = new ControlPanel({
  root: $('controlSheet'),
  title: $('ctlTitle'),
  sub: $('ctlSub'),
  body: $('ctlBody'),
  onAction: action => {
    const actions = {
      'vsc-on': () => deployVSC(race),
      'vsc-off': () => endVSC(race),
      'sc-on': () => deploySC(race),
      'sc-unlap': () => allowUnlap(race),
      'sc-in': () => scInThisLap(race),
      'red-on': () => redFlag(race),
      'restart-sc': () => restartRace(race, 'sc'),
      'restart-standing': () => restartRace(race, 'standing'),
    };
    if (actions[action]) actions[action]();
    controlPanel.sig = '';
    refreshUi();
  },
});

const casesPanel = new CasesPanel($('cases'), {
  onAction: (act, id, form) => {
    const c = id ? race.cases.find(x => x.id === id) : null;
    if (act === 'investigate') investigate(race, c);
    else if (act === 'investigate-now') { c.status = 'investigating'; race.emit('rc', `Fall #${c.id} wird untersucht: ${c.title}`); }
    else if (act === 'nfa') noFurtherAction(race, c);
    else if (act === 'post') postpone(race, c);
    else if (act === 'decide') decide(race, c, { carId: form.carId, penalty: form.penalty || 'none', points: form.points });
    else if (act === 'results') { showResults(); return; }
    casesPanel.render(race);
    updateCasesBadge();
    if (act !== 'render') renderTiming($('timing'), race, timingOpts());
  },
});

let race = null;
let paused = true;
let seenCases = 0;
let acc = 0;
let lastFrame = performance.now();
let lastUi = 0;
let touching = false;
let activeTab = 'timing';
let unread = 0;
let resultShown = false;
let wakeLock = null;
let seenHazards = 0;
const prevD = new Map();

map.showLabels = settings.showLabels;
map.onSelectCar = id => select(id);
map.onSelectSector = idx => openFlags(idx);
map.onZoomChange = z => $('zoomResetBtn').classList.toggle('hidden', z <= 1.01);

// ---------- Rennen ----------

function newRace(seed = randomSeed()) {
  race = new Race({ track, teams: TEAMS, drivers: DRIVERS, seed });
  paused = true;
  acc = 0;
  resultShown = false;
  seenHazards = 0;
  seenCases = 0;
  casesPanel.open.clear();
  casesPanel.forms = {};
  casesPanel.sig = '';
  prevD.clear();
  feed.reset();
  unread = 0;
  updateBadge();
  closeFlags();
  closeControl();
  map.selected = null;
  $('seedInfo').textContent = `Rennen #${seed}`;
  renderHistory();
  $('seedInput').value = '';
  $('resultScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  refreshUi();
  updatePauseBtn();
}

function renderHistory() {
  const list = loadHistory();
  const el = $('history');
  if (!list.length) { el.innerHTML = ''; return; }
  const best = Math.max(...list.map(e => e.total));
  el.innerHTML = `
    <div class="history-title">Deine letzten Rennen <span>Bestwert ${best}/100</span></div>
    ${list.slice(0, 5).map(e => `
      <div class="history-row">
        <span>${new Date(e.date).toLocaleDateString('de-DE')} · #${e.seed}</span>
        <span class="history-stars">${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</span>
        <b>${e.total}${e.provisional ? '*' : ''}</b>
      </div>`).join('')}`;
}

function startRace() {
  race.startedAt = Date.now();
  $('startScreen').classList.add('hidden');
  race.start();
  paused = false;
  updatePauseBtn();
  requestWakeLock();
}

// ---------- Game-Loop ----------

function frame(now) {
  const realDt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (race && !paused) {
    acc += realDt * settings.speed;
    let n = 0;
    while (acc >= DT && n < 2000) {
      for (const c of race.cars) prevD.set(c, c.d);
      race.step();
      acc -= DT;
      n++;
      if (race.hazards.length > seenHazards) {
        onNewHazard();
        break;
      }
    }
  }

  if (race) {
    const alpha = paused ? 1 : Math.min(1, acc / DT);
    const renderD = new Map();
    for (const c of race.cars) {
      const p = prevD.get(c);
      renderD.set(c, p === undefined ? c.d : p + (c.d - p) * alpha);
    }
    map.paused = paused;
    map.draw(race, renderD);

    if (now - lastUi > 300) {
      lastUi = now;
      refreshUi();
      const added = feed.update(race.events);
      if (added && activeTab !== 'feed') { unread += added; updateBadge(); }
      if (race.phase === 'finished' && !resultShown) showResults();
    }
  }
  requestAnimationFrame(frame);
}

function onNewHazard() {
  seenHazards = race.hazards.length;
  acc = 0;
  if (settings.slowOnIncident && settings.speed > 1) {
    setSpeed(1);
    toast('Vorfall auf der Strecke – Tempo auf 1× reduziert');
  }
  refreshUi();
}

// ---------- Anzeige ----------

function timingOpts() {
  return { gapMode: settings.gapMode, selected: map.selected };
}

function refreshUi() {
  updateStatus();
  updateAlert();
  flagPanel.render(race);
  controlPanel.render(race);
  if (activeTab === 'cases') casesPanel.render(race);
  updateCasesBadge();
  if (race.cases.length > seenCases) {
    const c = race.cases[race.cases.length - 1];
    seenCases = race.cases.length;
    if (activeTab !== 'cases') toast(`Neuer Fall #${c.id}: ${c.typeName}`);
  }
  if (!touching) renderTiming($('timing'), race, timingOpts());
}

function updateStatus() {
  const lapEl = $('lap');
  if (race.phase === 'pre' || race.phase === 'lights') lapEl.textContent = `Start · ${race.laps} Rd`;
  else lapEl.textContent = `${race.leaderLap}/${race.laps}`;
  const running = race.phase === 'running' || race.phase === 'chequered' || race.phase === 'finished';
  $('clock').textContent = formatClock(running ? race.time : 0);

  const flag = $('flag');
  const status = trackStatus(race);
  const n = race.neutral;
  if (race.phase === 'chequered' || race.phase === 'finished') { flag.textContent = 'ZIEL'; flag.className = 'flag-chip flag-chequered'; }
  else if (n && n.type === 'red' && n.phase === 'grid') { flag.textContent = 'NEUSTART'; flag.className = 'flag-chip flag-start'; }
  else if (n && n.type === 'red') { flag.textContent = 'ROT'; flag.className = 'flag-chip flag-red'; }
  else if (n && n.type === 'sc') { flag.textContent = n.go ? 'SC NEUSTART' : n.phase === 'in' ? 'SC IN' : 'SAFETY CAR'; flag.className = 'flag-chip flag-sc'; }
  else if (n && n.type === 'vsc') { flag.textContent = n.phase === 'ending' ? 'VSC ENDET' : 'VSC'; flag.className = 'flag-chip flag-vsc'; }
  else if (race.phase === 'pre' || race.phase === 'lights') { flag.textContent = 'START'; flag.className = 'flag-chip flag-start'; }
  else if (status === 'double') { flag.textContent = 'GELB ×2'; flag.className = 'flag-chip flag-double'; }
  else if (status === 'yellow') { flag.textContent = 'GELB'; flag.className = 'flag-chip flag-yellow'; }
  else if (status === 'slippery') { flag.textContent = 'RUTSCHIG'; flag.className = 'flag-chip flag-slippery'; }
  else { flag.textContent = 'GRÜN'; flag.className = 'flag-chip flag-green'; }

  const lights = $('lights');
  lights.classList.toggle('hidden', race.lightsOn === 0);
  $('vscBtn').classList.toggle('on', Boolean(n && n.type === 'vsc'));
  $('scBtn').classList.toggle('on', Boolean(n && n.type === 'sc'));
  $('redBtn').classList.toggle('on', Boolean(n && n.type === 'red'));
  [...lights.children].forEach((el, i) => el.classList.toggle('on', i < race.lightsOn));

  $('gapHead').textContent = settings.gapMode === 'interval' ? 'Intervall' : 'Abstand';
}

// Hinweisbanner über der Karte: ungesicherte Gefahr oder Sektor wieder frei
function updateAlert() {
  const el = $('alertBanner');
  const t = race.time;
  el.style.background = '';
  const open = race.hazards.filter(h => !h.ended && h.adequateAt === null);
  const h = open[open.length - 1];
  if (h) {
    el.dataset.kind = 'flags';
    el.dataset.sector = h.sector;
    // orange: es wurde reagiert, aber (noch) nicht ausreichend
    el.className = `alert${h.maxResponse > 0 ? ' alert-double' : ''}`;
    el.innerHTML = `<span class="alert-text">⚠ Sektor ${h.sector + 1}: ${h.desc}</span><span class="alert-go">Flaggen ›</span>`;
    return;
  }
  const n = race.neutral;
  const anyOpen = race.hazards.some(x => !x.ended && x.type !== 'spin');
  let neutralMsg = null;
  if (n && n.type === 'red' && canRestart(race)) neutralMsg = ['red', '✓ Strecke geräumt – Neustart freigeben'];
  else if (n && n.type === 'red' && n.phase === 'stopped') neutralMsg = ['red', 'Rennen unterbrochen – Bergung läuft'];
  else if (n && n.type === 'vsc' && n.phase === 'active' && !anyOpen) neutralMsg = ['vsc', '✓ Strecke frei – VSC beenden'];
  else if (n && n.type === 'sc' && n.phase === 'out' && !anyOpen) neutralMsg = ['sc', '✓ Strecke frei – Safety Car reinholen'];
  if (neutralMsg) {
    el.dataset.kind = neutralMsg[0];
    el.className = `alert${neutralMsg[1].startsWith('✓') ? ' alert-ok' : ''}`;
    el.innerHTML = `<span class="alert-text">${neutralMsg[1]}</span><span class="alert-go">Öffnen ›</span>`;
    return;
  }
  const done = race.hazards.find(x => x.ended && t - x.endTime < 60 && race.flags[x.sector] !== 'clear'
    && !race.hazards.some(y => y.sector === x.sector && !y.ended));
  if (done) {
    el.dataset.kind = 'flags';
    el.dataset.sector = done.sector;
    el.className = 'alert alert-ok';
    el.innerHTML = `<span class="alert-text">✓ Sektor ${done.sector + 1} ist wieder frei</span><span class="alert-go">Grün setzen ›</span>`;
    return;
  }
  el.className = 'alert hidden';
}

function updatePauseBtn() {
  $('pauseBtn').textContent = paused ? '▶' : '❚❚';
  $('pauseBtn').setAttribute('aria-label', paused ? 'Weiter' : 'Pause');
  $('app').classList.toggle('is-paused', Boolean(paused && race && race.phase !== 'pre'));
}

function updateCasesBadge() {
  const n = race ? race.cases.filter(c => c.status === 'new').length : 0;
  const b = $('casesBadge');
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
}

function updateBadge() {
  const b = $('feedBadge');
  b.textContent = unread > 99 ? '99+' : unread;
  b.classList.toggle('hidden', unread === 0);
}

function select(id) {
  map.selected = id === null || map.selected === id ? null : id;
  renderTiming($('timing'), race, timingOpts());
}

function setSpeed(v) {
  settings.speed = v;
  $('speedBtn').textContent = `${v}×`;
  saveSettings(settings);
  renderSpeedMenu();
}

// ---------- Flaggen-Panel ----------

function openFlags(idx = null) {
  if (!race) return;
  closeControl();
  map.showSectors = true;
  map.highlightSector = idx;
  flagPanel.open(race, idx);
}

function openControl(kind) {
  if (!race) return;
  closeFlags();
  if (controlPanel.isOpen && controlPanel.kind === kind) { closeControl(); return; }
  controlPanel.open(race, kind);
}

function closeControl() {
  controlPanel.close();
}

function closeFlags() {
  flagPanel.close();
  map.showSectors = false;
  map.highlightSector = null;
}

// ---------- Tempo-Menü ----------

function renderSpeedMenu() {
  $('speedMenu').querySelector('.speed-grid').innerHTML = SPEEDS.map(v =>
    `<button class="speed-opt${v === settings.speed ? ' active' : ''}" data-speed="${v}">${v}×</button>`).join('');
  $('slowToggle').checked = settings.slowOnIncident;
}

function toggleSpeedMenu(show) {
  const menu = $('speedMenu');
  const open = show ?? menu.classList.contains('hidden');
  if (!open) { menu.classList.add('hidden'); return; }
  renderSpeedMenu();
  const r = $('speedBtn').getBoundingClientRect();
  menu.classList.remove('hidden');
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
}

// ---------- Ergebnis ----------

function showResults() {
  resultShown = true;
  const st = race.standings();
  const winner = st[0];
  const rows = st.map((c, i) => `
    <tr>
      <td class="r-pos">${c.retired ? '–' : i + 1}</td>
      <td><span class="teambar" style="background:${c.team.color}"></span>${c.driver.first[0]}. ${c.driver.last}${unservedSecs(c) ? `<span class="pen">+${unservedSecs(c)} s</span>` : ''}</td>
      <td class="r-gap">${c.dsq ? 'DSQ' : c.retired ? 'DNF' : i === 0 ? formatClock(race.adjustedFinish(c)) : formatGap(race.gap(c, winner), false)}</td>
      <td class="r-stops">${c.stops}</td>
    </tr>`).join('');
  const fl = race.fastest ? `${race.carById[race.fastest.carId].driver.last} – ${formatLap(race.fastest.time)} (Runde ${race.fastest.lap})` : '–';
  const overtakes = race.events.filter(e => e.type === 'overtake').length;

  const rep = flagReport(race);
  const icon = { ok: '✅', late: '⏱', missed: '❌' };
  const items = rep.items.map(i => `
    <div class="report-item"><span class="v">${icon[i.verdict]}</span>
      <div>Sektor ${i.h.sector + 1}: ${i.h.desc}<br><span class="n">${i.note}</span></div></div>`).join('');
  const report = `
    <div class="report">
      <h3>Rennleitung · Bilanz</h3>
      <div class="report-stats">
        <div><b>${rep.ok}/${rep.total}</b><span>rechtzeitig</span></div>
        <div><b>${rep.avgReaction === null ? '–' : Math.round(rep.avgReaction) + ' s'}</b><span>Ø Reaktion</span></div>
        <div><b>${Math.round(rep.idleFlagTime)} s</b><span>unnötig gelb</span></div>
      </div>
      <div class="report-stats">
        <div><b>${rep.neutral.vsc}× · ${formatMin(rep.neutral.vscTime)}</b><span>VSC</span></div>
        <div><b>${rep.neutral.sc}× · ${formatMin(rep.neutral.scTime)}</b><span>Safety Car</span></div>
        <div><b>${rep.neutral.red}× · ${formatMin(rep.neutral.redTime)}</b><span>Rote Flagge</span></div>
      </div>
      ${rep.neutral.idle > 5 ? `<div class="report-item"><span class="v">⚠</span><div>Neutralisierung ohne ausreichenden Grund: <b>${formatMin(rep.neutral.idle)}</b><br><span class="n">VSC/SC/Rot länger oder öfter als nötig – schlecht für den Rennfluss.</span></div></div>` : ''}
      ${items || '<div class="report-item"><span class="v">✓</span><div>Keine Gefahren, die eine Flagge erforderten.</div></div>'}
      ${rep.spins ? `<div class="report-item"><span class="v">↺</span><div><span class="n">${rep.spins} kurze(r) Dreher ohne Folgen (keine Flagge zwingend nötig)</span></div></div>` : ''}
    </div>`;

  const open = openCases(race).length;
  const srep = stewardReport(race);
  const sIcon = { ok: '✅', lenient: '🔽', harsh: '🔼', wrong: '❌', open: '⏳' };
  const sItems = srep.items.map(i => `
    <div class="report-item"><span class="v">${sIcon[i.verdict]}</span>
      <div>#${i.c.id} ${i.c.title}<br><span class="n">${i.note}</span></div></div>`).join('');
  const stewards = `
    <div class="report">
      <h3>Rennkommissare · Urteile</h3>
      <div class="report-stats">
        <div><b>${srep.ok}/${srep.total}</b><span>angemessen</span></div>
        <div><b>${srep.lenient + srep.harsh}</b><span>zu mild/hart</span></div>
        <div><b>${srep.wrong + srep.open}</b><span>falsch/offen</span></div>
      </div>
      ${sItems || '<div class="report-item"><span class="v">✓</span><div>Keine Fälle in diesem Rennen.</div></div>'}
      ${srep.inconsistent.map(g => `<div class="report-item"><span class="v">⚖</span><div>Inkonsequent: gleichartige Fälle ${g} unterschiedlich bestraft.</div></div>`).join('')}
    </div>`;
  $('resultTitle').textContent = open ? `⏳ Vorläufiges Ergebnis – ${open} ${open > 1 ? 'Fälle' : 'Fall'} offen` : '🏁 Rennergebnis';
  $('openCasesBtn').classList.toggle('hidden', open === 0);
  // Gesamtbewertung
  const rating = rateRace(race);
  const stars = '★'.repeat(rating.stars) + '☆'.repeat(5 - rating.stars);
  const bars = AXES.map(a => {
    const v = rating.scores[a.id];
    const cls = v === null ? '' : v >= 80 ? 'good' : v >= 60 ? 'mid' : 'bad';
    return `
      <div class="axis">
        <div class="axis-top"><span>${a.name}</span><b>${v === null ? '–' : v}</b></div>
        <div class="axis-bar"><span class="${cls}" style="width:${v ?? 0}%"></span></div>
        <div class="axis-hint">${v === null ? 'Nicht bewertbar – keine vergleichbaren Urteile' : a.hint}</div>
      </div>`;
  }).join('');
  const voices = rating.voices.map(v => `
    <div class="voice voice-${v.tone}"><div class="voice-who">${v.who}</div><div>${v.text}</div></div>`).join('');
  const ratingHtml = `
    <div class="rating">
      <div class="rating-head">
        <div class="rating-stars" aria-label="${rating.stars} von 5 Sternen">${stars}</div>
        <div class="rating-grade">${rating.grade}${rating.provisional ? ' <span class="prov">(vorläufig)</span>' : ''}</div>
        <div class="rating-total">${rating.total}<span>/100</span></div>
      </div>
      <div class="axes">${bars}</div>
    </div>
    ${voices ? `<div class="report"><h3>Stimmen zum Rennen</h3><div class="voices">${voices}</div></div>` : ''}`;
  saveHistoryEntry({
    key: `${race.seed}-${race.startedAt}`,
    date: new Date().toISOString(),
    gp: race.track.def.grandPrix,
    seed: race.seed,
    total: rating.total,
    grade: rating.grade,
    stars: rating.stars,
    provisional: rating.provisional,
  });

  $('resultBody').innerHTML = `
    ${ratingHtml}
    <h3 class="section-title">Ergebnis</h3>
    <table class="results">
      <thead><tr><th>Pos</th><th>Fahrer</th><th>Zeit/Abstand</th><th>Stopps</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="result-facts">
      <div><span>Schnellste Runde</span>${fl}</div>
      <div><span>Überholmanöver</span>${overtakes}</div>
    </div>
    <details class="report-details" open>
      <summary>Details zur Bewertung</summary>
      ${report}
      ${stewards}
    </details>`;
  closeFlags();
  closeControl();
  $('resultScreen').classList.remove('hidden');
}

function formatMin(t) {
  t = Math.round(t);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ---------- Sonstiges ----------

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  if (tab === 'feed') { unread = 0; updateBadge(); }
  if (tab === 'cases' && race) { casesPanel.sig = ''; casesPanel.render(race); }
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* nicht unterstützt */ }
}

// ---------- Ereignisse ----------

$('startBtn').addEventListener('click', () => {
  const s = parseInt($('seedInput').value, 10);
  if (Number.isFinite(s) && s > 0 && s !== race.seed) newRace(s);
  startRace();
});

$('pauseBtn').addEventListener('click', () => {
  if (!race || race.phase === 'pre') return;
  paused = !paused;
  updatePauseBtn();
});

$('speedBtn').addEventListener('click', e => {
  e.stopPropagation();
  toggleSpeedMenu();
});
$('speedMenu').addEventListener('click', e => {
  const b = e.target.closest('.speed-opt');
  if (b) {
    setSpeed(Number(b.dataset.speed));
    toggleSpeedMenu(false);
  }
});
$('slowToggle').addEventListener('change', e => {
  settings.slowOnIncident = e.target.checked;
  saveSettings(settings);
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#speedMenu') && !e.target.closest('#speedBtn')) toggleSpeedMenu(false);
});

$('labelsBtn').addEventListener('click', () => {
  settings.showLabels = !settings.showLabels;
  map.showLabels = settings.showLabels;
  $('labelsBtn').classList.toggle('active', settings.showLabels);
  saveSettings(settings);
});
$('zoomResetBtn').addEventListener('click', () => map.resetView());

$('gapHead').addEventListener('click', () => {
  settings.gapMode = settings.gapMode === 'interval' ? 'leader' : 'interval';
  saveSettings(settings);
  refreshUi();
});

const timingEl = $('timing');
timingEl.addEventListener('pointerdown', () => { touching = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { touching = false; }, 50); });
window.addEventListener('pointercancel', () => { touching = false; });
timingEl.addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (row) select(row.dataset.id);
});

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  if (suppressTabClick) return;
  if (settings.panelCollapsed) setCollapsed(false);
  setTab(b.dataset.tab);
}));

// ---------- Bereich unter der Karte herunter-/hochwischen ----------
const appEl = $('app');
const mapWrap = document.querySelector('.map-wrap');
let drag = null;
let suppressTabClick = false;

function setCollapsed(on) {
  settings.panelCollapsed = on;
  appEl.classList.toggle('collapsed', on);
  saveSettings(settings);
}

function maxMapHeight() {
  const used = ['.status', '#dragHandle', '.tabs', '.actions']
    .reduce((sum, sel) => sum + document.querySelector(sel).getBoundingClientRect().height, 0);
  return appEl.getBoundingClientRect().height - used;
}

function dragStart(e) {
  drag = { y: e.clientY, h: mapWrap.getBoundingClientRect().height, moved: false, last: null };
}
$('dragHandle').addEventListener('pointerdown', dragStart);
document.querySelector('.tabs').addEventListener('pointerdown', dragStart);
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dy) < 8) return;
  if (!drag.moved) {
    drag.moved = true;
    appEl.classList.add('dragging');
    appEl.classList.remove('collapsed');
  }
  const minH = 200;
  drag.last = Math.max(minH, Math.min(maxMapHeight(), drag.h + dy));
  mapWrap.style.height = `${drag.last}px`;
});
const dragEnd = () => {
  if (!drag) return;
  if (drag.moved) {
    const expandedH = Math.max(200, window.innerHeight * 0.34);
    const collapse = drag.last > (expandedH + maxMapHeight()) / 2;
    appEl.classList.remove('dragging');
    mapWrap.style.height = '';
    setCollapsed(collapse);
    suppressTabClick = true;
    setTimeout(() => { suppressTabClick = false; }, 50);
  }
  drag = null;
};
window.addEventListener('pointerup', dragEnd);
window.addEventListener('pointercancel', dragEnd);

$('flagBtn').addEventListener('click', () => {
  if (flagPanel.isOpen) closeFlags();
  else openFlags();
});
$('flagCloseBtn').addEventListener('click', closeFlags);
$('allGreenBtn').addEventListener('click', () => {
  clearAllFlags(race);
  flagPanel.render(race);
  refreshUi();
});
$('alertBanner').addEventListener('click', () => {
  const el = $('alertBanner');
  if (el.dataset.kind === 'flags') openFlags(Number(el.dataset.sector));
  else openControl(el.dataset.kind);
});
$('vscBtn').addEventListener('click', () => openControl('vsc'));
$('scBtn').addEventListener('click', () => openControl('sc'));
$('redBtn').addEventListener('click', () => openControl('red'));
$('ctlCloseBtn').addEventListener('click', closeControl);

document.querySelectorAll('.act[data-soon]').forEach(b => b.addEventListener('click', () => {
  toast(`${b.dataset.label}: kommt in Meilenstein ${b.dataset.soon}`);
}));

$('newRaceBtn').addEventListener('click', () => newRace());
$('closeResultBtn').addEventListener('click', () => $('resultScreen').classList.add('hidden'));
$('openCasesBtn').addEventListener('click', () => {
  $('resultScreen').classList.add('hidden');
  setCollapsed(false);
  setTab('cases');
});
$('menuBtn').addEventListener('click', () => {
  if (!race || race.phase === 'pre') return;
  paused = true;
  updatePauseBtn();
  if (confirm('Aktuelles Rennen abbrechen und ein neues Rennen vorbereiten?')) newRace();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !paused) requestWakeLock();
});

// Seiten-Zoom verhindern (iOS ignoriert user-scalable=no)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// ---------- Start ----------

$('speedBtn').textContent = `${settings.speed}×`;
appEl.classList.toggle('collapsed', settings.panelCollapsed);
$('labelsBtn').classList.toggle('active', settings.showLabels);
newRace();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
