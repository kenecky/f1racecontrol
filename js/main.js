// Einstieg: verbindet Simulation und Oberfläche, Game-Loop.
import { TEAMS } from './data/teams.js';
import { DRIVERS } from './data/drivers.js';
import { TRACKS } from './data/tracks/index.js';
import { SEASON_2026 } from './data/season2026.js';
import {
  newSeason, migrateSeason, currentRound, currentWeekend, sessionSetup, finishSession, roundDate,
  activePoints, driverStandings, teamStandings, BAN_POINTS, KIND_NAME, KIND_SHORT, SPRINT_TRACKS,
} from './season/season.js';
import { Session } from './sim/session.js';
import { buildTrack } from './sim/trackModel.js';
import { Race, DT, formatLap, COMPOUNDS } from './sim/race.js';
import { randomSeed } from './util/rng.js';
import { setSectorFlag, clearAllFlags, trackStatus, flagReport } from './control/flags.js';
import { TrackMap } from './ui/map.js';
import { renderTiming, formatClock, formatGap } from './ui/timing.js';
import { Feed, FEED_FILTERS, HELMET_ICON } from './ui/feed.js';
import { FlagPanel } from './ui/flagPanel.js';
import { ControlPanel } from './ui/controlPanel.js';
import { CasesPanel } from './ui/casesPanel.js';
import { renderTower } from './ui/tower.js';
import { ScenePlayer } from './ui/scenePlayer.js';
import { Sound } from './ui/sound.js';
import { deployMedical, deploySweeper, deployCrane, recallCrane, setPitClosed } from './sim/services.js';
import { showBlackOrange } from './sim/events.js';
import { WeatherPanel } from './ui/weatherPanel.js';
import { hazardProgress, hazardWhere } from './sim/hazards.js';
import { weatherLabel } from './sim/weather.js';
import {
  investigate, postpone, noFurtherAction, decide, openCases, stewardReport, unservedSecs, startHearing, PENALTIES, rollProtests, reviseCase,
} from './control/stewards.js';
import {
  deployVSC, endVSC, deploySC, allowUnlap, scInThisLap, redFlag, restartRace, canRestart, endRaceUnderRed,
} from './sim/neutral.js';
import {
  loadSettings, saveSettings, loadHistory, saveHistoryEntry, clearHistory,
  saveRaceState, loadRaceState, clearRaceState, loadSeason, saveSeason, saveReplay, loadReplay,
} from './storage.js';
import { serializeRace, restoreRace } from './sim/persist.js';
import { abortStart, startFromGridBehindSC, releaseFormation, startLights, lightsOut, restartLights, restartLightsOut, ALL_ON } from './sim/start.js';
import { distanceFor, LENGTHS } from './sim/length.js';
import { runScrutiny, TECH_CHECKS, EXTRA_CHECKS } from './sim/scrutiny.js';
import { prepareBriefing } from './sim/regs.js';
import { rateRace, AXES } from './control/rating.js';
import { DIFFICULTY } from './sim/incidents.js';
import { sendMessage } from './sim/messages.js';
import { Recorder, ReplayViewer } from './ui/replay.js';

const SPEEDS = [1, 2, 4, 8, 16, 32];
const $ = id => document.getElementById(id);

const settings = loadSettings();
const builtTracks = {};
function getTrack(id) {
  if (!TRACKS[id]) id = 'redbullring';
  return builtTracks[id] || (builtTracks[id] = buildTrack(TRACKS[id]));
}
let track = getTrack(settings.trackId);
let season = null;
const map = new TrackMap($('map'), track);
// ---------- Ton ----------
const sound = new Sound();
sound.enabled = settings.sound !== false;
document.addEventListener('pointerdown', () => { sound.unlock(); sound.setEnabled(settings.sound !== false); }, true);
const snd = { lights: 0, phase: null, neutral: null, evId: 0, lastRadio: 0 };
function updateSound(now) {
  if (!sound.ctx || !race) return;
  let level = 0, rpm = 0;
  const n = race.neutral;
  if (!paused && settings.sound !== false) {
    const onTrack = race.cars.filter(c => !c.retired && !c.finished && !c.inPit && !c.inGarage).length;
    const crowd = Math.min(1, 0.25 + onTrack / 16);
    if (race.phase === 'formation') { level = 0.55; rpm = 0.3; }
    else if (race.phase === 'grid') { level = 0.35; rpm = 0.12; }
    // Ab dem Pre-Start (Ampel eingeschaltet) heulen die Motoren auf
    else if (race.phase === 'lights') { level = 0.8; rpm = 0.38 + 0.25 * Math.abs(Math.sin(now / 230)); }
    else if (race.phase === 'running' || race.phase === 'chequered') {
      level = 0.75 * crowd;
      rpm = n ? 0.42 : 0.66 + 0.06 * Math.sin(now / 900);
      // Rote Flagge: Autos fahren noch langsam in die Box – Stille erst, wenn alle stehen
      if (n && n.type === 'red') {
        const moving = race.cars.filter(c => !c.retired && !c.finished && !c.redQueued).length;
        if (n.restart && n.phase === 'formation') { level = 0.55; rpm = 0.3; }
        else if (n.restart && n.phase === 'grid') { level = 0.35; rpm = 0.12; }
        else if (n.restart && n.phase === 'lights') { level = 0.8; rpm = 0.38 + 0.25 * Math.abs(Math.sin(now / 230)); }
        else if (moving) { level = 0.25 + 0.5 * Math.min(1, moving / 16); rpm = 0.3; }
        else level = 0;
      }
    }
    if (sound.launchUntil && sound.ctx.currentTime < sound.launchUntil) { level = 1; rpm = 0.95; }
  }
  sound.setEngine(level, rpm);
  // Startampel
  const lo = race.lightsOn || 0;
  if (lo > snd.lights) sound.light();
  snd.lights = lo;
  if (snd.phase === 'lights' && race.phase === 'running') sound.lightsOut();
  const rl = Boolean(race.neutral && race.neutral.restart && race.neutral.phase === 'lights');
  if (snd.rl && !race.neutral) sound.lightsOut();
  snd.rl = rl;
  snd.phase = race.phase;
  // Neutralisierungen
  const nt = n ? n.type : null;
  if (nt && nt !== snd.neutral) sound.neutral(nt);
  snd.neutral = nt;
  // Ereignisse
  for (let i = race.events.length - 1; i >= 0 && race.events[i].id > snd.evId; i--) {
    const e = race.events[i];
    if (e.type === 'radio' && now - snd.lastRadio > 1500) { snd.lastRadio = now; sound.radio(); }
    if (e.type === 'chequered') sound.chequered();
  }
  if (race.events.length) snd.evId = race.events[race.events.length - 1].id;
}

// ---------- Wetter-Fenster ----------
const weatherPanel = new WeatherPanel({ root: $('wxScreen'), body: $('wxBody'), getRace: () => race });
$('wxOpen').addEventListener('click', () => { if (race) weatherPanel.open(); });
$('wxCloseBtn').addEventListener('click', () => weatherPanel.close());
$('wxScreen').addEventListener('click', e => { if (e.target.id === 'wxScreen') weatherPanel.close(); });

const feed = new Feed($('feed'), { colorOf: id => (race && race.carById[id] ? race.carById[id].team.color : null) });

// Meldungen filtern: Alle (ohne Funk) · Rennleitung · Strecke · Funk
function renderFeedFilter() {
  const cur = settings.feedFilter || 'all';
  $('feed').dataset.filter = cur;
  $('feedFilter').innerHTML = FEED_FILTERS.map(f => `<button class="fk-chip${f.id === cur ? ' on' : ''}" data-filter="${f.id}">${f.id === 'radio' ? HELMET_ICON : ''}${f.label}</button>`).join('');
}
$('feedFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  settings.feedFilter = b.dataset.filter;
  saveSettings(settings);
  renderFeedFilter();
  $('panel-feed').scrollTop = 0;
});
renderFeedFilter();
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
  foot: $('ctlFoot'),
  onAction: action => {
    const actions = {
      'vsc-on': () => deployVSC(race),
      'vsc-off': () => endVSC(race),
      'sc-on': () => deploySC(race),
      'sc-unlap': () => allowUnlap(race),
      'sc-in': () => scInThisLap(race),
      'red-on': () => (race.isSession ? race.sessionRedFlag() : redFlag(race)),
      'session-resume': () => race.sessionResume(),
      'session-end': () => race.sessionAbandon(),
      'race-end': () => endRaceUnderRed(race),
      'restart-sc': () => restartRace(race, 'sc'),
      'restart-standing': () => restartRace(race, 'standing'),
      'start-abort': () => abortStart(race),
      'med-go': n => deployMedical(race, n),
      'sweep-go': n => deploySweeper(race, n),
      'crane-go': n => deployCrane(race, n),
      'crane-off': n => recallCrane(race, n),
      'pit-close': () => setPitClosed(race, true),
      'pit-open': () => setPitClosed(race, false),
      'bo-go': i => showBlackOrange(race, race.cars[i]),
      'start-lights': () => doStartLights(),
      'start-sc': () => startFromGridBehindSC(race),
      'seq-formation': () => releaseFormation(race),
      'seq-out': () => doLightsOut(),
      'msg-yellow': () => sendMessage(race, 'yellow'),
      'msg-blue': () => sendMessage(race, 'blue'),
      'msg-driving': () => sendMessage(race, 'driving'),
      'msg-pit': () => sendMessage(race, 'pit'),
      'msg-tl': i => sendMessage(race, 'tl', race.track.corners[i] && race.track.corners[i].id),
    };
    const [name, arg] = action.split(':');
    if (actions[name]) actions[name](arg !== undefined ? Number(arg) : undefined);
    if (name === 'restart-standing' && race.neutral && race.neutral.restart) openControl('start');
    controlPanel.sig = '';
    refreshUi();
  },
});

function caseAction(act, id, form) {
    const c = id ? race.cases.find(x => x.id === id) : null;
    if (act === 'scene-full') { openSceneFull(c, form.t); return; }
    if (act === 'scene-map') { closeDecisions(); startMapReplay(c); return; }
    if (act === 'investigate') investigate(race, c);
    else if (act === 'investigate-now') { c.status = 'investigating'; race.emit('rc', `Entscheidung #${c.id} wird untersucht: ${c.title}`); }
    else if (act === 'hearing') startHearing(race, c);
    else if (act === 'nfa') noFurtherAction(race, c);
    else if (act === 'post') postpone(race, c);
    else if (act === 'decide') decide(race, c, { carId: form.carId, penalty: form.penalty || 'none', points: form.points });
    else if (act === 'revise') reviseCase(race, c);
    else if (act === 'decide-keep') decide(race, c, { carId: null, penalty: 'keep', points: 0 });
    else if (act === 'results') { closeDecisions(); finishFlow(); return; }
    casesPanel.render(race);
    if (decOpen()) renderDec(true);
    updateCasesBadge();
    if (act !== 'render') { renderTiming($('timing'), race, timingOpts()); autosave(); }
    if (postOpen()) renderPost(act === 'render');
}
const casesPanel = new CasesPanel($('decDocBody'), { onAction: caseAction, single: true, actionsEl: $('decDocFoot') });
// Nach dem Rennen: offene Entscheidungen einzeln abarbeiten
const postPanel = new CasesPanel($('postBody'), { onAction: caseAction, single: true, noRevise: true });

let race = null;
let savedRace = null;   // gespeichertes Rennen, das fortgesetzt werden kann
let lastSave = 0;
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
let seenStartIssue = 0;
const prevD = new Map();

map.showLabels = settings.showLabels;
map.onSelectCar = id => select(id);
map.onSelectSector = idx => openFlags(idx);
map.onZoomChange = z => $('zoomResetBtn').classList.toggle('hidden', z <= 1.01);

// ---------- Rennen ----------

function getSeason() {
  return migrateSeason(loadSeason());
}

function newRace(seed = randomSeed()) {
  if (map.follow) { map.follow = null; map.resetView(); $('driverCard').classList.add('hidden'); followRestore = null; }
  let gridPenalties = {}, drivers = DRIVERS, roundNo = null, gridOrder = null, laps = null;
  const caution = {};   // Fahrer mit vielen Strafen fahren vorsichtiger
  let seasonFile = null, seasonPrec = null;
  let kind = 'race';
  if (settings.mode === 'season') {
    season = getSeason();
    if (!season) season = newSeason();
    const entry = currentRound(season);
    if (entry) {
      currentWeekend(season);
      const setup = sessionSetup(season);
      track = getTrack(entry.track);
      kind = setup.kind;
      gridPenalties = setup.gridPenalties;
      gridOrder = setup.gridOrder;
      drivers = DRIVERS.filter(d => !setup.excluded.includes(d.id));
      roundNo = season.round;
      const ref = roundDate(season, entry);
      for (const d of DRIVERS) {
        const c = activePoints(season, d.id, ref) * 0.07 + (season.warnings[d.id] || 0) * 0.04;
        if (c > 0) caution[d.id] = c;
      }
      // Fahrerakte und Präzedenzfälle (nur Saison)
      seasonFile = {};
      for (const d of drivers) seasonFile[d.id] = { pts: activePoints(season, d.id, ref), warn: season.warnings[d.id] || 0, list: ((season.file || {})[d.id] || []).slice(0, 4) };
      seasonPrec = (season.precedents || []).slice(0, 60);
    }
    saveSeason(season);
  } else {
    // Einzelrennen: gewählte Teile des Wochenendes nacheinander
    track = getTrack(settings.trackId);
    const wk = singleWeekend();
    kind = wk.sessions[wk.idx];
    if (kind === 'race' || kind === 'sprint') {
      gridOrder = kind === 'race' ? wk.raceGrid : wk.sprintGrid;
      gridPenalties = { ...wk.pending[kind] };
    }
  }
  // Renndistanz nach Einstellung „Dauer“
  let fullLaps = null;
  if (kind === 'race' || kind === 'sprint') ({ laps, full: fullLaps } = distanceFor(track, kind, settings.length));
  map.setTrack(track);
  deskMap.setTrack(track);
  const opts = {
    track, teams: TEAMS, drivers, seed, weather: settings.mode === 'season' ? 'random' : settings.weatherMode, gridPenalties, gridOrder, laps, fullLaps, kind, caution,
    length: settings.length, difficulty: settings.mode === 'season' ? 'hard' : (settings.difficulty || 'medium'),
  };
  race = ['fp', 'quali', 'sq'].includes(kind) ? new Session(opts) : new Race(opts);
  if (seasonFile) { race.driverFile = seasonFile; race.precedents = seasonPrec; }
  if (roundNo !== null) { race.seasonRound = roundNo; race.weekendIdx = season.weekend.idx; race.teamRep = { ...(season.rep || {}) }; }
  else race.singleIdx = settings.singleWk.idx;
  renderForecast();
  renderEventCard();
  paused = true;
  acc = 0;
  resultShown = false;
  seenHazards = 0;
  seenCases = 0;
  seenStartIssue = 0;
  snd.evId = race.events.length ? race.events[race.events.length - 1].id : 0;
  snd.neutral = null;
  casesPanel.open.clear();
  casesPanel.forms = {};
  casesPanel.sig = '';
  prevD.clear();
  feed.reset();
  unread = 0;
  updateBadge();
  closeDesk();
  closeDecisions();
  map.selected = null;
  $('seedInfo').textContent = `Rennen #${seed} · ${(DIFFICULTY[race.difficulty] || DIFFICULTY.hard).name}`;
  renderHistory();
  $('seedInput').value = '';
  $('resultScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  drawStartHero();
  refreshUi();
  updatePauseBtn();
}

// ---------- Startbildschirm: Modus, Strecke ----------

function renderEventCard() {
  const def = track.def;
  const isSeason = settings.mode === 'season';
  $('modeSingle').classList.toggle('active', !isSeason);
  $('modeSeason').classList.toggle('active', isSeason);
  $('seasonBtn').classList.toggle('hidden', !isSeason);
  $('gpList').classList.toggle('hidden', isSeason);
  $('sessionChecks').classList.toggle('hidden', isSeason);
  $('diffRow').classList.toggle('hidden', isSeason);
  $('weatherSeg').classList.toggle('hidden', isSeason);
  $('wxSeasonNote').classList.toggle('hidden', !isSeason);
  const entry = isSeason && season ? currentRound(season) : null;
  const wk = isSeason ? (entry ? season.weekend : null) : settings.singleWk;
  $('startBtn').disabled = false;
  const km = `<div><span>${(def.lengthM / 1000).toFixed(3).replace('.', ',')}</span> km</div>`;
  const gpName = def.grandPrix.replace('Großer Preis ', 'GP ');
  if (isSeason && !entry) {
    $('evRound').textContent = `Saison ${season.year} beendet`;
    $('gpInfo').innerHTML = '<b>Alle Rennen gefahren</b><div>Endwertung in der Saison-Übersicht</div>';
    $('startBtn').disabled = true;
  } else if (isSeason) {
    $('evRound').textContent = `Saison ${season.year} · Rennen ${entry.round}/${SEASON_2026.length} · ${new Date(roundDate(season, entry)).toLocaleDateString('de-DE')}`;
    const n = race.isSession ? Math.round(race.info.segments.reduce((s, x) => s + x.dur, 0) / 60) : race.laps;
    $('gpInfo').innerHTML = `<b>${gpName}</b><div><span>${n}</span> ${race.isSession ? 'Min.' : 'Runden'}</div>${km}`;
  } else {
    $('evRound').textContent = '';
    renderSingleSetup();
    const parts = singleParts();
    const race_ = distanceFor(track, 'race', settings.length).laps;
    const sprint_ = distanceFor(track, 'sprint', settings.length).laps;
    $('gpInfo').innerHTML = `<b>${gpName}</b>
      <div><span>${parts.includes('race') ? race_ : sprint_}</span> Runden${parts.includes('race') && parts.includes('sprint') ? ` <small>(Sprint ${sprint_})</small>` : ''}</div>${km}`;
  }
  const steps = isSeason && wk && wk.sessions.length > 1;
  $('weekendSteps').innerHTML = steps ? wk.sessions.map((k, i) => `<span class="wstep${i < wk.idx ? ' done' : i === wk.idx ? ' now' : ''}">${i < wk.idx ? '✓ ' : ''}${KIND_SHORT[k]}</span>`).join('<span class="wsep">›</span>') : '';
  // Saison: Karte „Rennwochenende“ zeigt nur den Ablauf (die Teile stehen fest)
  $('sessionBox').classList.toggle('hidden', isSeason && !steps);
  renderSegs();
  drawStartHero();
  if (!savedRace) $('startBtn').textContent = `${KIND_NAME[race.kind]} starten`;
}

// Auswahl-Tasten auf der Startseite (Wetter, Dauer, Schwierigkeit)
const SEGS = {
  weatherSeg: { key: 'weatherMode', items: [['random', '🎲', 'Zufällig'], ['dry', '☀️', 'Trocken'], ['rain', '🌧', 'Regen'], ['changeable', '🌦', 'Wechselhaft']] },
  lengthSeg: { key: 'length', items: [['short', '', 'Kurz', '¼ Distanz'], ['medium', '', 'Mittel', '½ Distanz'], ['full', '', 'Lang', 'volle Distanz']] },
  diffSeg: { key: 'difficulty', items: [['easy', '', 'Leicht', 'klare Fälle · Auto-Pause'], ['medium', '', 'Mittel', 'mehr Fallarten'], ['hard', '', 'Schwer', 'alle Fälle · keine Pause']] },
};
function renderSegs() {
  for (const [id, { key, items }] of Object.entries(SEGS)) {
    const cur = items.some(x => x[0] === settings[key]) ? settings[key] : items[1][0];
    $(id).innerHTML = items.map(([v, icon, label, sub]) =>
      `<button class="seg-b${v === cur ? ' on' : ''}" data-v="${v}" role="radio" aria-checked="${v === cur}">${icon ? `<i>${icon}</i>` : ''}<b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</button>`).join('');
  }
}
for (const [id, { key }] of Object.entries(SEGS)) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b || settings[key] === b.dataset.v) return;
    settings[key] = b.dataset.v;
    saveSettings(settings);
    if (race && race.phase === 'pre') newRace(race.seed); else renderSegs();
  });
}

// Großes Streckenbild und Rennleiste (neu zeichnen, sobald die Startseite sichtbar ist)
function drawStartHero() {
  drawTrackPreview($('trackPreview'), track);
  const list = $('gpList');
  const on = list.querySelector('.gp-item.on');
  if (on && list.clientWidth && !list.dataset.scrolled) {
    list.scrollLeft = on.offsetLeft - list.offsetLeft - (list.clientWidth - on.offsetWidth) / 2;
    list.dataset.scrolled = '1';
  }
}

function setMode(mode) {
  if (settings.mode === mode) return;
  settings.mode = mode;
  saveSettings(settings);
  newRace();
}

// ---------- Einzelrennen: Auswahl und Wochenend-Ablauf ----------

const SINGLE_ORDER = ['fp', 'sprint', 'quali', 'race'];
function singleParts() {
  const p = (settings.singleParts || ['race']).filter(x => SINGLE_ORDER.includes(x));
  if (!p.includes('race')) p.push('race');                       // Rennen ist immer dabei
  if (p.includes('fp') && !p.includes('quali')) p.push('quali');  // FP nur mit Qualifying
  return p;
}
// Reihenfolge wie an einem echten Wochenende: FP › SQ › Sprint › Q › Rennen
function singleSessionList() {
  const p = singleParts();
  const out = [];
  if (p.includes('fp')) out.push('fp');
  if (p.includes('sprint')) out.push('sq', 'sprint');
  if (p.includes('quali')) out.push('quali');
  if (p.includes('race')) out.push('race');
  return out;
}
function singleWeekend() {
  const sessions = singleSessionList();
  const key = `${settings.trackId}|${sessions.join(',')}`;
  let wk = settings.singleWk;
  if (!wk || wk.key !== key || wk.idx >= sessions.length) {
    wk = settings.singleWk = { key, sessions, idx: 0, raceGrid: null, sprintGrid: null, pending: { sprint: {}, race: {} } };
    saveSettings(settings);
  }
  return wk;
}
function resetSingleWeekend() {
  settings.singleWk = null;
  saveSettings(settings);
}
// Session fertig → Startaufstellung und Strafen an die nächste Session weitergeben
function advanceSingle(r) {
  const wk = settings.singleWk;
  if (!wk || wk.idx !== r.singleIdx) return false;
  const target = wk.sessions.slice(wk.idx + 1).find(k => k === 'sprint' || k === 'race');
  if (target) for (const g of r.carryOver || []) wk.pending[target][g.carId] = (wk.pending[target][g.carId] || 0) + g.places;
  if (r.kind === 'quali') wk.raceGrid = r.resultOrder();
  if (r.kind === 'sq') wk.sprintGrid = r.resultOrder();
  wk.idx++;
  saveSettings(settings);
  return true;
}

function renderSingleSetup() {
  const list = $('gpList');
  if (!list.children.length) {
    list.innerHTML = SEASON_2026.map(e => {
      const t = TRACKS[e.track];
      return `<button class="gp-item" data-track="${t.id}" role="option"><span class="gp-no">${String(e.round).padStart(2, '0')}</span><span><b>${t.country}</b><small>${t.name}</small></span></button>`;
    }).join('');
  }
  for (const b of list.children) b.classList.toggle('on', b.dataset.track === settings.trackId);
  for (const cb of $('sessionChecks').querySelectorAll('input')) cb.checked = singleParts().includes(cb.value);
}

// Streckenbild auf der Startseite (Umriss mit Start/Ziel); unten bleibt Platz für die Beschriftung
function drawTrackPreview(cv, tr) {
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < tr.N; i += 4) { minX = Math.min(minX, tr.xs[i]); maxX = Math.max(maxX, tr.xs[i]); minY = Math.min(minY, tr.ys[i]); maxY = Math.max(maxY, tr.ys[i]); }
  const pad = 14, padTop = 22, padBottom = 46;
  const k = Math.min((r.width - 2 * pad) / (maxX - minX), (r.height - padTop - padBottom) / (maxY - minY));
  const ox = (r.width - (maxX - minX) * k) / 2 - minX * k;
  const oy = padTop + (r.height - padTop - padBottom - (maxY - minY) * k) / 2 - minY * k;
  ctx.beginPath();
  for (let i = 0; i <= tr.N; i += 2) { const j = i % tr.N; const x = ox + tr.xs[j] * k, y = oy + tr.ys[j] * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(250, 204, 21, .35)'; ctx.shadowBlur = 14;
  ctx.strokeStyle = '#3a4352'; ctx.lineWidth = 8; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#f1f4f8'; ctx.lineWidth = 2.6; ctx.stroke();
  const x0 = ox + tr.xs[0] * k, y0 = oy + tr.ys[0] * k;
  ctx.fillStyle = '#ef4444'; ctx.fillRect(x0 - 4, y0 - 4, 8, 8);
}

$('gpList').addEventListener('click', e => {
  const b = e.target.closest('[data-track]');
  if (!b || b.dataset.track === settings.trackId) return;
  settings.trackId = b.dataset.track;
  resetSingleWeekend();
  saveSettings(settings);
  newRace();
});
$('sessionChecks').addEventListener('change', e => {
  // Regeln: Rennen immer dabei · FP nur mit Qualifying · Sprint und Qualifying nur mit Rennen
  const box = v => $('sessionChecks').querySelector(`input[value="${v}"]`);
  const v = e.target.value, on = e.target.checked;
  if (v === 'fp' && on) box('quali').checked = true;
  if (v === 'quali' && !on) box('fp').checked = false;
  box('race').checked = true;
  const sel = [...$('sessionChecks').querySelectorAll('input:checked')].map(x => x.value);
  settings.singleParts = sel;
  resetSingleWeekend();
  saveSettings(settings);
  newRace();
});

// ---------- Saison-Übersicht ----------

let seasonTab = 'drivers';
function showSeason(notes = []) {
  season = getSeason() || newSeason();
  $('seasonScreen').querySelector('.sheet-title').textContent = `🏆 Saison ${season.year}`;
  $('seasonResetBtn').textContent = currentRound(season) ? 'Saison neu starten' : `Neue Saison ${season.year + 1}`;
  $('seasonNotes').innerHTML = notes.map(n => `<div class="season-note">${n}</div>`).join('');
  renderSeasonTab();
  $('seasonScreen').classList.remove('hidden');
}

function renderSeasonTab() {
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.stab === seasonTab));
  const el = $('seasonBody');
  const teamOf = id => TEAMS.find(t => t.id === DRIVERS.find(d => d.id === id).team);
  if (seasonTab === 'drivers') {
    const done = !currentRound(season);
    el.innerHTML = (done ? `<div class="season-note">🏆 Weltmeister 2026: <b>${driverStandings(season, DRIVERS)[0].d.first} ${driverStandings(season, DRIVERS)[0].d.last}</b></div>` : '')
      + driverStandings(season, DRIVERS).map((x, i) => `
        <div class="srow"><span>${i + 1}</span><span class="teambar" style="background:${teamOf(x.d.id).color}"></span>
          <span>${x.d.first} ${x.d.last}<div class="sub">${teamOf(x.d.id).name}${x.wins ? ` · ${x.wins} Sieg${x.wins > 1 ? 'e' : ''}` : ''}</div></span><b>${x.pts}</b></div>`).join('');
  } else if (seasonTab === 'teams') {
    el.innerHTML = teamStandings(season, TEAMS).map((x, i) => `
      <div class="srow"><span>${i + 1}</span><span class="teambar" style="background:${x.t.color}"></span><span>${x.t.name}</span><b>${x.pts}</b></div>`).join('');
  } else if (seasonTab === 'calendar') {
    el.innerHTML = SEASON_2026.map((e, i) => {
      const t = TRACKS[e.track];
      const res = season.results.find(r => r.round === e.round);
      const winner = res && res.classification.find(c => c.pos === 1);
      const right = res ? `🏁 ${winner ? winner.id : '–'}${res.stars ? ` · ${'★'.repeat(res.stars)}` : ''}` : i === season.round ? '▶ als Nächstes' : '';
      const sprint = SPRINT_TRACKS.includes(e.track) ? ' · Sprint' : '';
      return `<div class="cal-row${i === season.round ? ' next' : ''}"><span>${e.round}</span>
        <span>${t.grandPrix}<div class="sub">${t.name} · ${new Date(roundDate(season, e)).toLocaleDateString('de-DE')}${sprint}</div></span><span>${right}</span></div>`;
    }).join('');
  } else if (seasonTab === 'rep') {
    const rep = season.rep || {};
    const label = v => (v >= 25 ? 'vertraut der Rennleitung' : v >= 5 ? 'zufrieden' : v > -10 ? 'neutral' : v > -25 ? 'skeptisch' : 'verärgert');
    el.innerHTML = '<p class="ctl-small">Wie die Teams die Rennleitung sehen. Faire Urteile schaffen Vertrauen, zu harte oder zu milde verärgern. Verärgerte Teams reagieren im Funk und in den Medien schärfer.</p>'
      + TEAMS.map(t => ({ t, v: rep[t.id] || 0 })).sort((a, b) => b.v - a.v).map(({ t, v }) => `
        <div class="srow"><span></span><span class="teambar" style="background:${t.color}"></span>
          <span>${t.name}<div class="sub">${label(v)}</div><div class="rep-bar"><i style="left:50%;width:${Math.abs(v) / 2}%;${v < 0 ? `transform:translateX(-100%);background:var(--st-red)` : 'background:var(--st-green)'}"></i></div></span><b>${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`).join('')
      + appealsHtml(season);
  } else {
    const entryNow = currentRound(season) || SEASON_2026[SEASON_2026.length - 1];
    const ref = roundDate(season, entryNow);
    const pts = id => activePoints(season, id, ref);
    const ids = DRIVERS.map(d => d.id).filter(id => pts(id) || season.warnings[id] || season.gridPenalties[id] || season.bans[id] !== undefined);
    el.innerHTML = `<p class="ctl-small">${BAN_POINTS} Strafpunkte innerhalb von 12 Monaten → Sperre für ein Rennwochenende · 5 Verwarnungen → 10 Startplätze Strafe</p>`
      + (ids.length ? ids.map(id => {
        const parts = [];
        if (pts(id)) parts.push(`${pts(id)} Strafpunkte (12 Monate)`);
        if (season.warnings[id]) parts.push(`${season.warnings[id]} Verwarnung${season.warnings[id] > 1 ? 'en' : ''}`);
        if (season.gridPenalties[id]) parts.push(`nächstes Rennen −${season.gridPenalties[id]} Startplätze`);
        if (season.bans[id] !== undefined && season.bans[id] >= season.round) parts.push(`gesperrt für Rennen ${season.bans[id] + 1}`);
        return `<div class="srow"><span></span><span class="teambar" style="background:${teamOf(id).color}"></span><span>${id}<div class="sub">${parts.join(' · ')}</div></span><b></b></div>`;
      }).join('') : '<p class="ctl-text">Noch keine Strafen in dieser Saison.</p>');
  }
}

// Berufungen vor dem Berufungsgericht (Saison)
function appealsHtml(season) {
  const list = season.appeals || [];
  if (!list.length) return '';
  return '<h3 class="section-title">Berufungen</h3>' + list.slice().reverse().map(a => `
    <div class="srow"><span></span><span class="teambar" style="background:${(TEAMS.find(t => t.id === a.team) || {}).color}"></span>
      <span>${a.carId} · ${a.where}<div class="sub">${a.penalty} – ${a.done ? (a.overturn ? `aufgehoben${a.ptsGain ? `, +${a.ptsGain} Pkt.` : ''}` : 'bestätigt') : `Entscheidung nach Rennen ${a.due}`}</div></span><b>${a.done ? (a.overturn ? '✗' : '✓') : '…'}</b></div>`).join('');
}

// Zeit/Abstand in der Ergebnisliste von Training und Qualifying
function sessionTime(c, i, first) {
  const t = race.rankTime(c);
  if (t === null) return c.retired ? 'DNF' : 'keine Zeit';
  if (i === 0) return formatLap(t);
  const ref = race.rankTime(first);
  const seg = c.elimSeg !== null && c.elimSeg !== undefined ? ` (${race.info.segments[c.elimSeg].id})` : '';
  return seg ? `${formatLap(t)}${seg}` : `+${(t - ref).toFixed(3).replace('.', ',')}`;
}

function renderForecast() {
  const wx = race.weather;
  const el = $('forecast');
  let text;
  if (!wx.showers.length) text = '☀️ Vorhersage: trocken';
  else if (wx.wetness > 0.2) text = `🌧 Vorhersage: Regen zum Start${wx.showers.length > 1 ? ', später weitere Schauer' : ''}`;
  else text = '🌦 Vorhersage: wechselhaft – Regenschauer im Rennen möglich';
  el.textContent = text;
}

function renderHistory() {
  const list = loadHistory();
  const el = $('history');
  if (!list.length) { el.innerHTML = ''; return; }
  const best = Math.max(...list.map(e => e.total));
  el.innerHTML = `
    <div class="history-title">Deine letzten Rennen <span><button id="histReplayBtn" class="link-btn hidden">Replay ›</button> <button id="statsBtn" class="link-btn">Statistik ›</button></span></div>
    <div class="history-best">Bestwert ${best}/100</div>
    ${list.slice(0, 5).map(e => `
      <div class="history-row">
        <span>${new Date(e.date).toLocaleDateString('de-DE')} · #${e.seed}</span>
        <span class="history-stars">${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</span>
        <b>${e.total}${e.provisional ? '*' : ''}</b>
      </div>`).join('')}`;
  $('statsBtn').addEventListener('click', () => { renderStats(); $('statsScreen').classList.remove('hidden'); });
  $('histReplayBtn').addEventListener('click', openReplay);
  loadReplay().then(d => { const b = document.getElementById('histReplayBtn'); if (b && d && d.frames && d.frames.length > 1) { b.classList.remove('hidden'); b.title = d.gp; } });
}

// ---------- Speichern / Fortsetzen ----------

function autosave() {
  if (!race || race.phase === 'pre') return;
  saveRaceState(serializeRace(race));
}

function renderResume() {
  const box = $('resumeBox');
  if (!savedRace) {
    box.innerHTML = '';
    $('startBtn').textContent = 'Rennen starten';
    $('startBtn').className = 'primary-btn';
    return;
  }
  const r = savedRace;
  const open = openCases(r).length;
  const label = r.phase === 'finished'
    ? `Zum Rennergebnis${open ? ` – ${open} Entscheidung${open > 1 ? 'en' : ''} offen` : ''}`
    : r.isSession ? `${r.info.name} fortsetzen` : `${r.kind === 'sprint' ? 'Sprint' : 'Rennen'} fortsetzen – Runde ${r.leaderLap}/${r.laps}`;
  box.innerHTML = `<button id="resumeBtn" class="primary-btn resume-btn">▶ ${label}</button>
    <div class="resume-info">Rennen #${r.seed} · gespeichert auf diesem Gerät</div>`;
  $('startBtn').textContent = 'Neues Rennen starten';
  $('startBtn').className = 'secondary-btn';
  $('resumeBtn').addEventListener('click', resumeRace);
}

function resumeRace() {
  race = savedRace;
  recorder = null;
  if (!race.isSession) loadReplay().then(prev => { if (race && !race.isSession) recorder = new Recorder(race, prev); });
  track = race.track;
  map.setTrack(track);
  deskMap.setTrack(track);
  savedRace = null;
  paused = true;
  acc = 0;
  resultShown = false;
  seenHazards = race.hazards.length;
  seenCases = race.cases.length;
  seenStartIssue = race.startIssueSeq || 0;
  snd.evId = race.events.length ? race.events[race.events.length - 1].id : 0;
  snd.neutral = race.neutral ? race.neutral.type : null;
  snd.phase = race.phase;
  casesPanel.open.clear();
  casesPanel.forms = {};
  casesPanel.sig = '';
  prevD.clear();
  feed.reset();
  feed.update(race.events);
  unread = 0;
  updateBadge();
  map.selected = null;
  $('startScreen').classList.add('hidden');
  refreshUi();
  updatePauseBtn();
  if (race.phase !== 'finished') toast('Rennen geladen – mit ▶ geht es weiter');
}

// ---------- Statistik ----------

// Statistik je Strecke
function trackStatsHtml(list) {
  const groups = new Map();
  for (const e of list) {
    const key = e.trackId || e.gp;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  if (!groups.size) return '';
  const short = gp => (gp || '').replace('Großer Preis von ', '').replace('Großer Preis der ', '').replace('Großer Preis ', '');
  const rows = [...groups.values()].sort((a, b) => b.length - a.length).map(g => {
    const avgT = Math.round(g.reduce((s, e) => s + e.total, 0) / g.length);
    const best = Math.max(...g.map(e => e.total));
    const sc = g.reduce((s, e) => s + (e.neutral ? e.neutral.sc + e.neutral.vsc : 0), 0);
    const red = g.reduce((s, e) => s + (e.neutral ? e.neutral.red : 0), 0);
    const haz = g.reduce((s, e) => s + (e.hazards ? e.hazards.total : 0), 0);
    const cases = g.reduce((s, e) => s + (e.cases ? e.cases.total : 0), 0);
    return `<tr><td>${short(g[0].gp)}</td><td>${g.length}</td><td><b>${avgT}</b></td><td>${best}</td><td>${(haz / g.length).toFixed(1).replace('.', ',')}</td><td>${(cases / g.length).toFixed(1).replace('.', ',')}</td><td>${sc}/${red}</td></tr>`;
  }).join('');
  return `<h3 class="section-title">Je Strecke</h3>
    <div class="track-stats"><table><thead><tr><th>GP</th><th>Rennen</th><th>Ø</th><th>Best</th><th>Gef./R.</th><th>Fälle/R.</th><th>SC+VSC/Rot</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderStats() {
  const list = loadHistory();
  const el = $('statsBody');
  if (!list.length) { el.innerHTML = '<p class="ctl-text">Noch keine Rennen gespielt.</p>'; return; }
  const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const withScores = list.filter(e => e.scores);
  const axis = id => avg(withScores.map(e => e.scores[id]).filter(v => v !== null && v !== undefined));
  const sum = f => list.reduce((s, e) => s + (f(e) || 0), 0);
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '–');
  const tile = (v, l) => `<div><b>${v ?? '–'}</b><span>${l}</span></div>`;
  el.innerHTML = `
    <div class="report-stats">${tile(list.length, 'Rennen')}${tile(avg(list.map(e => e.total)), 'Ø Punkte')}${tile(Math.max(...list.map(e => e.total)), 'Bestwert')}</div>
    <h3 class="section-title">Ø Bewertung</h3>
    <div class="report-stats">${tile(axis('safety'), 'Sicherheit')}${tile(axis('fairness'), 'Fairness')}${tile(axis('flow'), 'Rennfluss')}</div>
    <div class="report-stats">${tile(axis('consistency'), 'Konsistenz')}${tile(pct(sum(e => e.hazards && e.hazards.ok), sum(e => e.hazards && e.hazards.total)), 'Gefahren rechtzeitig')}${tile(pct(sum(e => e.cases && e.cases.ok), sum(e => e.cases && e.cases.total)), 'Urteile angemessen')}</div>
    <h3 class="section-title">Gesamt</h3>
    <div class="report-stats">${tile(sum(e => e.neutral && e.neutral.vsc), 'VSC')}${tile(sum(e => e.neutral && e.neutral.sc), 'Safety Cars')}${tile(sum(e => e.neutral && e.neutral.red), 'Rote Flaggen')}</div>
    <div class="report-stats">${tile(sum(e => e.cases && e.cases.total), 'Entscheidungen')}${tile(sum(e => e.penalties), 'Strafen')}${tile(list.filter(e => e.stars === 5).length, '5-Sterne-Rennen')}</div>
    ${trackStatsHtml(list)}
    <h3 class="section-title">Letzte Rennen</h3>
    ${list.slice(0, 15).map(e => `
      <div class="history-row">
        <span>${new Date(e.date).toLocaleDateString('de-DE')} · #${e.seed}</span>
        <span class="history-stars">${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</span>
        <b>${e.total}${e.provisional ? '*' : ''}</b>
      </div>`).join('')}
    <p class="ctl-small" style="margin-top:8px">* vorläufig (Entscheidungen offen)</p>`;
}

// ---------- Fahrerbesprechung vor dem Rennen ----------
let briefPick = new Set();
function showBriefing() {
  const b = race.briefing;
  briefPick = new Set();
  const notes = b.notes.map(n => `<div class="brief-note"><b>${n.who}</b><span>${n.text}</span></div>`).join('');
  const chips = race.track.corners.map(c => `<button class="chip" data-brief="${c.id}">${c.id}</button>`).join('');
  $('briefBody').innerHTML = `<div class="setup-label">HINWEISE DER FAHRER</div>${notes}
    <div class="setup-label" style="margin-top:12px">TRACK LIMITS ÜBERWACHEN</div><div class="chips brief-chips">${chips}</div>`;
  $('startScreen').classList.add('hidden');
  $('briefScreen').classList.remove('hidden');
}
$('briefBody').addEventListener('click', e => {
  const b = e.target.closest('[data-brief]');
  if (!b) return;
  const id = b.dataset.brief;
  if (briefPick.has(id)) briefPick.delete(id);
  else if (briefPick.size < 3) briefPick.add(id);
  else toast('Höchstens 3 Kurven');
  for (const x of $('briefBody').querySelectorAll('[data-brief]')) x.classList.toggle('on', briefPick.has(x.dataset.brief));
});
$('briefOkBtn').addEventListener('click', () => {
  race.briefing.tlCorners = [...briefPick];
  race.briefing.done = true;
  race.emit('rc', briefPick.size ? `Fahrerbesprechung: Track Limits werden in ${[...briefPick].join(', ')} überwacht.` : 'Fahrerbesprechung: keine Kurve zur Überwachung der Track Limits festgelegt.');
  $('briefScreen').classList.add('hidden');
  startRace();
});

function startRace() {
  if (!race.isSession && prepareBriefing(race) && !race.briefing.done) { showBriefing(); return; }
  race.startedAt = Date.now();
  savedRace = null;
  renderResume();
  $('startScreen').classList.add('hidden');
  race.start('standing');
  recorder = race.isSession ? null : new Recorder(race);
  if (!race.isSession) openControl('start');
  paused = false;
  updatePauseBtn();
  requestWakeLock();
}

// ---------- Wiederholung des ganzen Rennens ----------
let recorder = null, lastReplaySave = 0;
const replayViewer = new ReplayViewer($('replayScreen'));
function persistReplay() {
  if (!recorder || !recorder.dirty) return;
  recorder.dirty = false;
  lastReplaySave = performance.now();
  saveReplay(recorder.data);
}
async function openReplay() {
  let data = recorder && recorder.data.done ? recorder.data : await loadReplay();
  if (!data || !data.frames || data.frames.length < 2) { toast('Keine Wiederholung gespeichert'); return; }
  replayViewer.open(data, getTrack(data.trackId));
}
$('replayBtn').addEventListener('click', openReplay);

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
      if (recorder) recorder.tick(race);
      acc -= DT;
      n++;
      if (race.hazards.length > seenHazards) {
        onNewHazard();
        break;
      }
      if (race.startIssueSeq > seenStartIssue) {
        onStartIssue();
        break;
      }
    }
  }

  if (race) {
    const alpha = paused ? 1 : Math.min(1, acc / DT);
    const renderD = new Map();
    for (const c of race.cars) {
      const p = prevD.get(c);
      // Sprünge (Ende der Formationsrunde, Boxengassenstart) nicht interpolieren
      renderD.set(c, p === undefined || Math.abs(c.d - p) > 200 ? c.d : p + (c.d - p) * alpha);
    }
    map.paused = paused;
    map.draw(race, renderD);
    if (deskOpen()) {
      deskMap.paused = paused;
      deskMap.showSectors = map.showSectors;
      deskMap.highlightSector = map.highlightSector;
      deskMap.draw(race, renderD);
    }
    updateStartCtl();
    updateSound(now);

    if (!paused && now - lastSave > 10000) { lastSave = now; autosave(); }
    if (recorder && recorder.dirty && (recorder.data.done || now - lastReplaySave > 30000)) persistReplay();

    if (now - lastUi > 300) {
      lastUi = now;
      refreshUi();
      const added = feed.update(race.events);
      if (added && activeTab !== 'feed') { unread += added; updateBadge(); }
      if (race.phase === 'finished' && !resultShown) finishFlow();
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Rennszenen: Vollbild und Wiederholung auf der Karte ----------

let fullPlayer = null;
function openSceneFull(c, t = 0) {
  if (!c || !c.scene) return;
  if (fullPlayer) fullPlayer.destroy();
  $('sceneFullTitle').textContent = `🎥 #${c.id} ${c.title}`;
  $('sceneFull').classList.remove('hidden');
  fullPlayer = new ScenePlayer($('sceneFullBody'), { track: race.track, scene: c.scene, sharp: c.status !== 'new', t, big: true });
}
$('sceneFullClose').addEventListener('click', () => {
  $('sceneFull').classList.add('hidden');
  if (fullPlayer) { fullPlayer.destroy(); fullPlayer = null; }
});

let replayResume = false;
function startMapReplay(c) {
  if (!c || !c.scene) return;
  if (map.follow) stopFollow();
  replayResume = !paused && race.phase !== 'finished';
  paused = true;
  updatePauseBtn();
  map.startReplay(c.scene, c.status !== 'new', () => {
    if (replayResume) { paused = false; updatePauseBtn(); }
    replayResume = false;
  });
  toast(`Wiederholung #${c.id} auf der Karte – das Rennen ist so lange angehalten`);
}

// ---------- Startablauf: Formationsrunde, Ampel, Lichter aus ----------

let speedBeforeLights = null;
function doStartLights() {
  const n = race.neutral;
  if (!(n && n.type === 'red' && n.restart ? restartLights(race) : startLights(race))) return;
  if (settings.speed > 1) {
    speedBeforeLights = settings.speed;
    setSpeed(1);
    toast('Startampel läuft – Tempo 1×');
  }
}

// Lights out (Start oder Neustart); danach Desk kurz offen lassen und zur großen Karte wechseln
function doLightsOut() {
  const ok = race.neutral && race.neutral.restart ? restartLightsOut(race) : lightsOut(race);
  if (!ok) return;
  if (speedBeforeLights) { setSpeed(speedBeforeLights); speedBeforeLights = null; }
  setTimeout(() => { if (deskKind === 'start') closeDesk(); }, 1500);
}

function startCtlState() {
  const n = race && race.neutral;
  if (n && n.type === 'red' && n.restart) {
    if (n.phase === 'formation' || n.phase === 'grid') return { cls: 'amber', text: '🚦 AMPEL EINSCHALTEN', act: 'lights' };
    if (n.phase === 'lights') {
      if (n.lightsTimer < ALL_ON) { const k = race.lightsOn; return { cls: 'wait', text: k ? `${'●'.repeat(k)}${'○'.repeat(5 - k)}` : 'Pre-Start …', act: null }; }
      return { cls: 'red', text: 'LICHTER AUS', act: 'out' };
    }
  }
  if (!race || race.isSession || !race.preStart || race.phase === 'pre') return null;
  if (race.phase === 'ready') return { cls: 'go', text: '🏁 START FORMATION LAP', act: 'formation' };
  if (race.phase === 'formation' || race.phase === 'grid') return { cls: 'amber', text: '🚦 AMPEL EINSCHALTEN', act: 'lights' };
  if (race.phase === 'lights') {
    if (race.lightsTimer < ALL_ON) {
      const n = race.lightsOn;
      return { cls: 'wait', text: n ? `${'●'.repeat(n)}${'○'.repeat(5 - n)}` : 'Pre-Start …', act: null };
    }
    return { cls: 'red', text: 'LICHTER AUS', act: 'out' };
  }
  return null;
}

function updateStartCtl() {
  const el = $('startCtl');
  const st = startCtlState();
  const key = st ? `${st.cls}|${st.text}` : '';
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.classList.toggle('hidden', !st);
  if (!st) return;
  // nicht unter dem Warnbanner verschwinden
  const al = $('alertBanner');
  el.style.top = al.classList.contains('hidden') ? '' : `${al.offsetTop + al.offsetHeight + 6}px`;
  el.className = `start-ctl start-${st.cls}`;
  el.textContent = st.text;
  el.disabled = false;
  el.dataset.act = st.act || '';
}

// Knopf auf der Karte: öffnet die Start-Konsole im Desk (dort laufen Freigabe, Ampel und Lights out)
$('startCtl').addEventListener('click', () => openControl('start'));

function onStartIssue() {
  seenStartIssue = race.startIssueSeq;
  acc = 0;
  if (settings.slowOnIncident && settings.speed > 1) setSpeed(1);
  toast('Problem in der Startaufstellung – Rennleitung muss entscheiden');
  openControl('start');
}

function onNewHazard() {
  seenHazards = race.hazards.length;
  sound.alert();
  vibrate([120, 60, 120]);
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
  $('pauseBtn').classList.toggle('blocked', Boolean(pauseBlocked()));
  updateAlert();
  flagPanel.render(race);
  controlPanel.render(race);
  if (decOpen()) renderDec();
  if (deskOpen()) renderDeskHead();
  updateCasesBadge();
  if (race.cases.length > seenCases) {
    const c = race.cases[race.cases.length - 1];
    seenCases = race.cases.length;
    sound.chime();
    vibrate(80);
    if (race.difficulty === 'easy' && !paused && race.phase !== 'finished') {
      paused = true;
      acc = 0;
      updatePauseBtn();
      toast(`Neue Entscheidung #${c.id}: ${c.typeName} – Spiel pausiert`);
    } else if (settings.slowOnIncident && settings.speed > 1) {
      setSpeed(1);
      toast(`Neue Entscheidung #${c.id}: ${c.typeName} – Tempo auf 1×`);
    } else if (!decOpen()) toast(`Neue Entscheidung #${c.id}: ${c.typeName}`);
  }
  if (map.follow) renderDriverCard();
  if (weatherPanel.isOpen && weatherPanel.offset === 0) weatherPanel.drawRadar();
  if (!touching) {
    renderTiming($('timing'), race, timingOpts());
    if (settings.showTower) renderTower($('tower'), race, map.selected);
  }
}

function updateStatus() {
  const lapEl = $('lap');
  if (race.isSession) {
    $('lapLabel').textContent = race.info.name;
    const rem = race.segState === 'break' ? race.breakLeft : race.remaining;
    const mm = `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`;
    lapEl.textContent = race.phase === 'pre' ? 'Start' : race.phase === 'finished' ? 'Ende'
      : race.segState === 'break' ? `Pause ${mm}` : `${race.segment.id} · ${mm}`;
  } else {
    $('lapLabel').textContent = race.phase === 'formation' ? 'FORMATION' : race.preStart ? 'START' : race.kind === 'sprint' ? 'SPRINT LAP' : 'LAP';
    if (race.preStart) lapEl.textContent = `${race.laps} LAPS`;
    else lapEl.textContent = `${race.leaderLap}/${race.laps}`;
  }
  const running = race.phase === 'running' || race.phase === 'chequered' || race.phase === 'finished';
  $('clock').textContent = formatClock(running ? race.time : 0);
  const wl = weatherLabel(race.weather);
  $('wx').textContent = `${wl.icon} ${wl.track}`;

  const flag = $('flag');
  const status = trackStatus(race);
  const n = race.neutral;
  // Statusanzeige wie in der Rennleitung (englische Begriffe)
  const yellowSecs = race.flags.map((f, i) => (f === 'yellow' || f === 'double' ? i + 1 : null)).filter(Boolean);
  const ms = yellowSecs.length === 1 ? ` S${yellowSecs[0]}` : '';
  if (race.phase === 'chequered' || race.phase === 'finished') { flag.textContent = 'CHEQUERED'; flag.className = 'flag-chip flag-chequered'; }
  else if (n && n.type === 'red' && n.restart) { flag.textContent = n.phase === 'formation' ? 'FORMATION' : 'RESTART'; flag.className = 'flag-chip flag-start'; }
  else if (n && n.type === 'red') { flag.textContent = 'RED FLAG'; flag.className = 'flag-chip flag-red'; }
  else if (n && n.type === 'sc') { flag.textContent = n.go ? 'SC RESTART' : n.phase === 'in' ? 'SC IN' : 'SAFETY CAR'; flag.className = 'flag-chip flag-sc'; }
  else if (n && n.type === 'vsc') { flag.textContent = n.phase === 'ending' ? 'VSC ENDING' : 'VSC'; flag.className = 'flag-chip flag-vsc'; }
  else if (race.startIssue) { flag.textContent = 'START HOLD'; flag.className = 'flag-chip flag-double'; }
  else if (race.phase === 'formation') { flag.textContent = 'FORMATION'; flag.className = 'flag-chip flag-start'; }
  else if (race.preStart) { flag.textContent = 'START'; flag.className = 'flag-chip flag-start'; }
  else if (status === 'double') { flag.textContent = `DBL YELLOW${ms}`; flag.className = 'flag-chip flag-double'; }
  else if (status === 'yellow') { flag.textContent = `YELLOW${ms}`; flag.className = 'flag-chip flag-yellow'; }
  else if (status === 'slippery') { flag.textContent = 'SURFACE'; flag.className = 'flag-chip flag-slippery'; }
  else { flag.textContent = 'TRACK GREEN'; flag.className = 'flag-chip flag-green'; }

  const lights = $('lights');
  lights.classList.toggle('hidden', race.lightsOn === 0);
  $('vscBtn').classList.toggle('on', Boolean(n && n.type === 'vsc'));
  $('scBtn').classList.toggle('on', Boolean(n && n.type === 'sc'));
  $('redBtn').classList.toggle('on', Boolean(n && n.type === 'red'));
  $('flagBtn').classList.toggle('on', race.flags.some(f => f !== 'clear'));
  const sv = race.svc || { cranes: [] };
  $('medBtn').classList.toggle('on', Boolean(sv.medical));
  $('sweepBtn').classList.toggle('on', Boolean(sv.sweeper));
  $('craneBtn').classList.toggle('on', sv.cranes.length > 0);
  $('pitBtn').classList.toggle('on', Boolean(sv.pitClosed));
  $('startDeskBtn').classList.toggle('on', Boolean(!race.isSession && ((race.preStart && race.phase !== 'pre') || (n && n.restart))));
  $('msgBtn').classList.toggle('on', ['yellow', 'blue', 'driving', 'pit'].some(k => race.rcMsgs && race.rcMsgs.until[k] > race.time));
  const lamp = (id, on) => $(id).classList.toggle('on', Boolean(on));
  lamp('lampFlag', race.flags.some(f => f !== 'clear'));
  lamp('lampVsc', n && n.type === 'vsc');
  lamp('lampSc', n && n.type === 'sc');
  lamp('lampRed', n && n.type === 'red');
  lamp('lampMed', sv.medical || sv.startMed);
  lamp('lampPit', sv.pitClosed);
  [...lights.children].forEach((el, i) => el.classList.toggle('on', i < race.lightsOn));

  $('gapHead').textContent = settings.gapMode === 'interval' ? 'Intervall' : 'Abstand';
}

// Hinweisbanner über der Karte: ungesicherte Gefahr oder Sektor wieder frei
function updateAlert() {
  const el = $('alertBanner');
  const t = race.time;
  el.style.background = '';
  if (race.phase === 'finished') { el.className = 'alert hidden'; return; }
  if (race.startIssue && !race.startIssue.released) {
    el.dataset.kind = 'start';
    el.className = 'alert';
    el.innerHTML = `<span class="alert-text">⚠ Startaufstellung: ${race.startIssue.type === 'rain' ? 'Starker Regen – Autos auf Trockenreifen' : `${race.startIssue.carId} steht mit abgestorbenem Motor`}</span><span class="alert-go">Start ›</span>`;
    return;
  }
  // offen: noch nie ausreichend abgesichert – oder wanderndes langsames Auto in einem Sektor ohne Gelb
  const open = race.hazards.filter(h => !h.ended && (h.adequateAt === null || (h.moving && race.flags[h.sector] === 'clear')));
  const h = open[open.length - 1];
  if (h) {
    el.dataset.kind = h.global ? 'sc' : h.need === 'pit' ? 'pit' : 'flags';
    el.dataset.sector = h.sector;
    // orange: es wurde reagiert, aber (noch) nicht ausreichend
    el.className = `alert${h.maxResponse > 0 ? ' alert-double' : ''}`;
    const prog = h.workTotal ? ` · Bergung ${Math.round(hazardProgress(h) * 100)} %` : '';
    el.innerHTML = `<span class="alert-text">⚠ ${hazardWhere(h)}: ${h.desc}${prog}</span><span class="alert-go">${h.global ? 'Maßnahmen' : h.need === 'pit' ? 'Boxengasse' : 'Flaggen'} ›</span>`;
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
  if (settings.showTower) renderTower($('tower'), race, map.selected);
}

function setSpeed(v) {
  settings.speed = v;
  $('speedBtn').textContent = `${v}×`;
  saveSettings(settings);
  renderSpeedMenu();
}

// ---------- Flaggen-Panel ----------

// Kontrollpult im Vollbild: Live-Karte, Konsolenwahl, Details, Aktionsknöpfe unten
const deskMap = new TrackMap($('deskMap'), track);
deskMap.padTop = 34;
deskMap.onSelectSector = idx => openFlags(idx);
deskMap.onSelectCar = () => {};
const KIND_BTN = { flags: 'flagBtn', vsc: 'vscBtn', sc: 'scBtn', red: 'redBtn', start: 'startDeskBtn', medical: 'medBtn', sweeper: 'sweepBtn', crane: 'craneBtn', pit: 'pitBtn', bo: 'boBtn', msg: 'msgBtn' };
let deskKind = null, lastDeskKind = 'flags';
function deskOpen() { return !$('desk').classList.contains('hidden'); }
function showDesk() {
  if (deskOpen()) return;
  $('desk').classList.remove('hidden');
  $('deckBtn').setAttribute('aria-expanded', 'true');
  renderDeskHead();
}
function closeDesk() {
  $('desk').classList.add('hidden');
  $('deckBtn').setAttribute('aria-expanded', 'false');
  flagPanel.close();
  controlPanel.close();
  map.showSectors = false;
  map.highlightSector = null;
  deskKind = null;
}
function markDesk() {
  for (const id of Object.values(KIND_BTN)) $(id).classList.remove('cur');
  if (deskKind) $(KIND_BTN[deskKind]).classList.add('cur');
}
function renderDeskHead() {
  if (!race) return;
  $('deskSub').textContent = `${$('lapLabel').textContent.toUpperCase()} ${$('lap').textContent} · ${$('clock').textContent}`;
  const f = $('flag');
  $('deskTag').textContent = f.textContent;
  $('deskTag').className = `desk-tag ${f.className}`;
  $('deskSpeed').textContent = paused ? 'PAUSE' : `LIVE · ${settings.speed}×`;
}

function openFlags(idx = null) {
  if (!race) return;
  showDesk();
  controlPanel.close();
  deskKind = lastDeskKind = 'flags';
  map.showSectors = true;
  map.highlightSector = idx;
  flagPanel.open(race, idx);
  markDesk();
}

function openControl(kind) {
  if (!race) return;
  showDesk();
  flagPanel.close();
  map.showSectors = false;
  map.highlightSector = null;
  deskKind = lastDeskKind = kind;
  controlPanel.open(race, kind);
  markDesk();
}

function closeControl() {
  if (deskKind && deskKind !== 'flags') closeDesk();
  else controlPanel.close();
}

function closeFlags() {
  if (deskKind === 'flags') closeDesk();
  else {
    flagPanel.close();
    map.showSectors = false;
    map.highlightSector = null;
  }
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
      <td class="r-gap">${race.isSession ? sessionTime(c, i, winner) : c.dsq ? 'DSQ' : c.retired ? 'DNF' : i === 0 ? formatClock(race.adjustedFinish(c)) : formatGap(race.gap(c, winner), false)}</td>
      <td class="r-stops">${race.isSession ? c.sLaps.length : c.stops}</td>
    </tr>`).join('');
  const fl = race.fastest ? `${race.carById[race.fastest.carId].driver.last} – ${formatLap(race.fastest.time)} (Runde ${race.fastest.lap})` : '–';
  const overtakes = race.events.filter(e => e.type === 'overtake').length;

  const rep = flagReport(race);
  const icon = { ok: '✅', late: '⏱', missed: '❌' };
  const items = rep.items.map(i => `
    <div class="report-item"><span class="v">${icon[i.verdict]}</span>
      <div>${hazardWhere(i.h)}: ${i.h.desc}<br><span class="n">${i.note}</span></div></div>`).join('');
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
  const sIcon = { ok: '✅', lenient: '🔽', harsh: '🔼', wrong: '❌', open: '❓', pending: '⏳' };
  const sItems = srep.items.map(i => `
    <div class="report-item"><span class="v">${sIcon[i.verdict]}</span>
      <div>#${i.c.id} ${i.c.title}<br><span class="n">${i.note}</span></div></div>`).join('');
  const stewards = `
    <div class="report">
      <h3>Rennkommissare · Entscheidungen</h3>
      <div class="report-stats">
        <div><b>${srep.ok}/${srep.total}</b><span>angemessen</span></div>
        <div><b>${srep.lenient + srep.harsh}</b><span>zu mild/hart</span></div>
        <div><b>${srep.wrong + srep.open + srep.pending}</b><span>falsch/offen</span></div>
      </div>
      ${sItems || '<div class="report-item"><span class="v">✓</span><div>Keine Entscheidungen in diesem Rennen.</div></div>'}
      ${srep.inconsistent.map(g => `<div class="report-item"><span class="v">⚖</span><div>Inkonsequent: gleichartige Vorfälle ${g} unterschiedlich bestraft.</div></div>`).join('')}
    </div>`;
  const hearings = race.cases.filter(c => c.status === 'post' || c.status === 'hearing').length;
  const scr = race.scrutiny;
  const techOpen = Boolean(scr && !scr.done);
  const parts = [];
  if (techOpen) parts.push('technische Abnahme');
  if (hearings) parts.push(`${hearings} ${hearings > 1 ? 'Anhörungen' : 'Anhörung'}`);
  if (open - hearings > 0) parts.push(`${open - hearings} ${open - hearings > 1 ? 'Entscheidungen' : 'Entscheidung'}`);
  const what = race.isSession ? race.info.name : race.kind === 'sprint' ? 'Sprint' : 'Rennen';
  $('resultTitle').textContent = open || techOpen ? `⏳ Vorläufiges Ergebnis – ${parts.join(' und ')} offen` : `🏁 Ergebnis ${what}`;
  $('openCasesBtn').classList.toggle('hidden', open === 0);
  const sBtn = $('applySeasonBtn');
  const seasonNow = getSeason();
  const wkNow = seasonNow && seasonNow.weekend;
  const sWk = settings.mode !== 'season' ? settings.singleWk : null;
  const singleNext = sWk && race.singleIdx === sWk.idx && sWk.idx < sWk.sessions.length - 1;
  const canApply = singleNext || (race.seasonRound !== undefined && !race.seasonApplied && seasonNow && seasonNow.round === race.seasonRound
    && wkNow && wkNow.idx === race.weekendIdx);
  sBtn.classList.toggle('hidden', !canApply);
  sBtn.disabled = open > 0 || techOpen;
  const nextKind = singleNext ? sWk.sessions[sWk.idx + 1] : wkNow ? wkNow.sessions[wkNow.idx + 1] : null;
  sBtn.textContent = techOpen ? 'Erst technische Abnahme durchführen' : open > 0 ? 'Erst alle Entscheidungen treffen'
    : race.kind === 'race' && !singleNext ? 'In die Saison übernehmen' : `Weiter: ${KIND_NAME[nextKind] || 'Rennen'}`;
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
    ${voices ? `<div class="report"><h3>Stimmen zum Rennen</h3><div class="voices">${voices}</div></div>` : ''}
    ${race.seasonRound !== undefined && !race.isSession ? mediaHtml(race, rating) : ''}`;
  if (race.kind === 'race') saveHistoryEntry({
    key: `${race.seed}-${race.startedAt}`,
    date: new Date().toISOString(),
    gp: race.track.def.grandPrix,
    trackId: race.track.def.id,
    difficulty: race.difficulty,
    season: race.seasonRound !== undefined,
    seed: race.seed,
    total: rating.total,
    grade: rating.grade,
    stars: rating.stars,
    provisional: rating.provisional,
    scores: rating.scores,
    hazards: { total: rating.fr.total, ok: rating.fr.ok },
    cases: { total: rating.sr.total, ok: rating.sr.ok },
    neutral: { vsc: rating.fr.neutral.vsc, sc: rating.fr.neutral.sc, red: rating.fr.neutral.red },
    penalties: race.cases.filter(c => c.verdict && c.verdict.carId).length,
  });
  autosave();

  $('resultBody').innerHTML = `
    ${scrutinyHtml()}
    ${ratingHtml}
    <h3 class="section-title">Ergebnis</h3>
    <table class="results">
      <thead><tr><th>Pos</th><th>Fahrer</th><th>Zeit/Abstand</th><th>${race.isSession ? 'Runden' : 'Stopps'}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="result-facts">
      ${race.isSession ? '' : `<div><span>Schnellste Runde</span>${fl}</div>`}
      ${race.isSession ? '' : `<div><span>Überholmanöver</span>${overtakes}</div>`}
    </div>
    <details class="report-details" open>
      <summary>Details zur Bewertung</summary>
      ${report}
      ${stewards}
    </details>`;
  closeFlags();
  closeControl();
  if (recorder) { if (!recorder.data.done) recorder.tick(race); persistReplay(); }
  $('replayBtn').classList.toggle('hidden', !(recorder && recorder.data.frames.length > 1));
  $('resultScreen').classList.remove('hidden');
}

// ---------- Technische Abnahme ----------

let scrutinyPick = new Set();
const CHECK_SHORT = { weight: 'Gewicht', fuel: 'Kraftstoff', plank: 'Planke', power: 'Leistung', wing: 'Flügel' };

function scrutinyHtml() {
  const s = race.scrutiny;
  if (!s) return '';
  if (!s.done) {
    const others = race.standings().filter(c => s.hidden[c.id] && !s.mandatory.includes(c.id));
    const chips = others.map(c => `<button class="chip${scrutinyPick.has(c.id) ? ' on' : ''}" data-scr-pick="${c.id}">${c.id}</button>`).join('');
    return `
      <div class="report tech-box">
        <h3>🔧 Technische Abnahme</h3>
        <p class="ctl-small">Die FIA prüft die Top 3 (${s.mandatory.join(', ')}): Gewicht, Kraftstoffprobe, Unterboden-Planke, Antriebsleistung und Flügel. Du kannst bis zu ${EXTRA_CHECKS} weitere Autos prüfen lassen.</p>
        <div class="chips">${chips}</div>
        <button class="ctl-btn ctl-sc" data-scr-run="1">Abnahme durchführen (${s.mandatory.length + scrutinyPick.size} Autos)</button>
      </div>`;
  }
  const rows = s.results.map(r => `
    <div class="tech-row"><b>${r.carId}</b><span>${r.items.map(it => it.ok
      ? `<span class="tech-ok">${CHECK_SHORT[it.check]} ${it.text} ✓</span>`
      : `<span class="tech-bad">${CHECK_SHORT[it.check]} ${it.text} ⚖ #${it.caseId}</span>`).join(' ')}</span></div>`).join('');
  return `
    <details class="report tech-box">
      <summary><h3>🔧 Technische Abnahme</h3></summary>
      <p class="ctl-small">${Object.values(TECH_CHECKS).map(c => `${c.name}: ${c.rule}`).join(' · ')}</p>
      ${rows}
    </details>`;
}

function scrutinyClick(e) {
  const pick = e.target.closest('[data-scr-pick]');
  if (pick) {
    const id = pick.dataset.scrPick;
    if (scrutinyPick.has(id)) scrutinyPick.delete(id);
    else if (scrutinyPick.size < EXTRA_CHECKS) scrutinyPick.add(id);
    else toast(`Höchstens ${EXTRA_CHECKS} zusätzliche Autos`);
    if (postOpen()) renderPost(); else showResults();
    return;
  }
  if (e.target.closest('[data-scr-run]')) {
    const created = runScrutiny(race, [...scrutinyPick]);
    scrutinyPick = new Set();
    seenCases = race.cases.length;
    updateCasesBadge();
    autosave();
    toast(created.length ? `Technische Abnahme: ${created.length} Auffälligkeit${created.length > 1 ? 'en' : ''}` : 'Technische Abnahme: alles in Ordnung');
    if (postOpen()) renderPost(); else showResults();
  }
}
$('resultBody').addEventListener('click', scrutinyClick);
$('postBody').addEventListener('click', scrutinyClick);

// ---------- Nach dem Rennen: Anhörungen, offene Entscheidungen, technische Abnahme ----------
// Kommt automatisch vor dem Ergebnis. Es wird immer nur das Nächste gezeigt.
let postDone = [];
function postOpen() { return !$('postScreen').classList.contains('hidden'); }
function postPending() {
  return openCases(race).length > 0 || Boolean(race.scrutiny && !race.scrutiny.done);
}
function finishFlow() {
  closeDecisions();
  closeDesk();
  resultShown = true;
  if (!race.protestsDone && !openCases(race).length && rollProtests(race) > 0) { seenCases = race.cases.length; autosave(); }
  closeFlags();
  closeControl();
  if (postPending()) { postDone = []; $('resultScreen').classList.add('hidden'); $('postScreen').classList.remove('hidden'); renderPost(); }
  else showResults();
}
function renderPost(keepScroll = false) {
  const open = openCases(race).sort((a, b) => a.id - b.id);
  const cur = open[0];
  const body = $('postBody');
  if (cur) {
    // Anhörung startet sofort – Fahrer sind bereits vorgeladen
    if (cur.status === 'post') startHearing(race, cur);
    if (postPanel.onlyId !== cur.id) {
      if (postPanel.onlyId && !postDone.includes(postPanel.onlyId)) postDone.push(postPanel.onlyId);
      postPanel.onlyId = cur.id;
      postPanel.sig = '';
      keepScroll = false;
    }
    const total = postDone.length + open.length;
    $('postProgress').textContent = `ENTSCHEIDUNG ${postDone.length + 1} / ${total}`;
    $('postSteps').innerHTML = open.map((c, i) => `<span class="post-step${i === 0 ? ' now' : ''}">DOC ${c.id}</span>`).join('')
      + (race.scrutiny && !race.scrutiny.done ? '<span class="post-step">TECHNIK</span>' : '');
    if (!body.querySelector('.case')) postPanel.sig = '';
    postPanel.render(race);
    if (!keepScroll) $('postScreen').querySelector('.sheet').scrollTop = 0;
    return;
  }
  if (postPanel.onlyId && !postDone.includes(postPanel.onlyId)) postDone.push(postPanel.onlyId);
  // Nach den offenen Entscheidungen: Proteste und Anträge auf Überprüfung
  if (!race.protestsDone && rollProtests(race) > 0) { seenCases = race.cases.length; autosave(); renderPost(); return; }
  postPanel.onlyId = null;
  if (race.scrutiny && !race.scrutiny.done) {
    $('postProgress').textContent = 'TECHNISCHE ABNAHME';
    $('postSteps').innerHTML = '<span class="post-step now">TECHNIK</span>';
    for (const p of postPanel.players.values()) p.destroy();
    postPanel.players.clear();
    body.innerHTML = scrutinyHtml();
    return;
  }
  // alles erledigt → Ergebnis
  $('postScreen').classList.add('hidden');
  showResults();
}

// Medienecho (nur in der Saison): Schlagzeilen zur Arbeit der Rennleitung
function mediaHtml(r, rating) {
  const sr = rating.sr;
  const gp = r.track.def.grandPrix.replace('Großer Preis von ', 'GP ').replace('Großer Preis ', 'GP ');
  const lines = [];
  if (rating.total >= 88) lines.push(`${gp}: Lob für eine souveräne Rennleitung`);
  else if (rating.total >= 70) lines.push(`${gp}: Solide Rennleitung mit kleinen Fragezeichen`);
  else if (rating.total >= 55) lines.push(`${gp}: Rennleitung in der Kritik`);
  else lines.push(`${gp}: Chaos in der Rennleitung – Teams fordern Konsequenzen`);
  const wrong = sr.items.find(i => i.verdict === 'wrong' || (i.verdict === 'harsh' && !i.c.truth.offender));
  if (wrong) lines.push(`„Skandal-Urteil“: ${wrong.c.title}`);
  const lenient = sr.items.find(i => i.verdict === 'lenient');
  if (lenient) lines.push(`Zu milde? Diskussion um DOC ${lenient.c.id}`);
  if (rating.fr.missed) lines.push(`Sicherheitsdebatte: ${rating.fr.missed} Gefahr${rating.fr.missed > 1 ? 'en' : ''} nicht rechtzeitig abgesichert`);
  if (rating.fr.neutral.red) lines.push('Rote Flagge sorgt für Unterbrechung');
  const angry = Object.entries(r.teamRep || {}).filter(([, v]) => v <= -25).map(([id]) => TEAMS.find(t => t.id === id)).filter(Boolean);
  if (angry.length) lines.push(`${angry[0].name} weiter auf Konfrontationskurs mit der Rennleitung`);
  return `<div class="report"><h3>MEDIA</h3>${lines.slice(0, 4).map(l => `<div class="media-line">📰 ${l}</div>`).join('')}</div>`;
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
  if (tab === 'cases' && race) {
    casesPanel.sig = '';
    casesPanel.render(race);
    $('panel-cases').scrollTop = 0;   // beim Öffnen immer oben beginnen
  }
}

// ---------- Entscheidungen im Vollbild ----------
const DEC_STATUS = {
  new: ['NOTED', '#facc15'], investigating: ['INVESTIGATION', '#fb923c'], post: ['POST-RACE', '#60a5fa'],
  hearing: ['HEARING', '#c084fc'], decided: ['DECISION', '#22c55e'], nfa: ['NFA', '#9aa4b2'],
};
const DEC_ORDER = { new: 0, investigating: 1, hearing: 2, post: 3, decided: 4, nfa: 5 };
const OPEN_ST = ['new', 'investigating', 'post', 'hearing'];
let decFilter = 'open', decDocId = null, decSig = '';
function decOpen() { return !$('decScreen').classList.contains('hidden'); }
function decCases() {
  if (!race) return [];
  const list = race.cases.filter(c => decFilter === 'all' || (decFilter === 'open' ? OPEN_ST.includes(c.status) : !OPEN_ST.includes(c.status)));
  return list.sort((a, b) => (decFilter === 'open' ? DEC_ORDER[a.status] - DEC_ORDER[b.status] : 0) || b.id - a.id);
}
function openDecisions(id = null) {
  if (!race) return;
  $('decScreen').classList.remove('hidden');
  if (id) showDecDoc(id); else showDecList();
}
function closeDecisions() {
  $('decScreen').classList.add('hidden');
  decDocId = null;
}
function showDecList() {
  decDocId = null;
  $('decListView').classList.remove('hidden');
  $('decDocView').classList.add('hidden');
  renderDec(true);
}
function showDecDoc(id) {
  decDocId = id;
  casesPanel.onlyId = id;
  casesPanel.sig = '';
  $('decListView').classList.add('hidden');
  $('decDocView').classList.remove('hidden');
  $('decDocBody').scrollTop = 0;
  renderDec(true);
}
function renderDec(force = false) {
  if (!race || !decOpen()) return;
  const live = race.phase === 'finished' ? 'RENNEN BEENDET' : `${paused ? 'PAUSE' : 'LIVE'} · ${$('lapLabel').textContent.toUpperCase()} ${$('lap').textContent} · ${$('flag').textContent} · ${settings.speed}×`;
  if (decDocId !== null) {
    const list = decCases();
    const i = list.findIndex(c => c.id === decDocId);
    const c = race.cases.find(x => x.id === decDocId);
    if (!c) { showDecList(); return; }
    const name = { open: 'OFFEN', done: 'ENTSCHIEDEN', all: 'ALLE' }[decFilter];
    $('decDocTitle').innerHTML = `DOC ${c.id}${i >= 0 ? ` · ${i + 1} / ${list.length} ${name}` : ''}<small>${c.typeName.toUpperCase()} · ${c.when || (c.lap ? `RD ${c.lap}` : 'VOR DEM START')} · ${live}</small>`;
    $('decPrev').disabled = i <= 0;
    $('decNextDoc').disabled = i < 0 ? !list.some(x => x.id !== c.id) : i >= list.length - 1;
    casesPanel.render(race);
    return;
  }
  const count = st => race.cases.filter(c => st.includes(c.status)).length;
  const list = decCases();
  const sig = JSON.stringify([decFilter, live, pauseBlocked(), race.cases.map(c => [c.id, c.status, c.verdict && c.verdict.penalty])]);
  if (!force && sig === decSig) return;
  decSig = sig;
  $('decSub').textContent = `${race.track.def.grandPrix.replace('Großer Preis von ', 'GP ').replace('Großer Preis der ', 'GP ')} · ${(KIND_NAME[race.kind] || '').toUpperCase()}`;
  $('decLive').innerHTML = `<i class="${race.phase === 'finished' ? 'off' : paused ? 'pz' : ''}"></i><span>${live}</span>${pauseBlocked() ? '<b>PAUSE GESPERRT (SCHWER)</b>' : ''}`;
  $('decCount').innerHTML = [['NEU', ['new'], '#facc15'], ['UNTERSUCH.', ['investigating'], '#fb923c'], ['NACH RENNEN', ['post', 'hearing'], '#60a5fa'], ['ENTSCHIEDEN', ['decided', 'nfa'], '#e6e9ef']]
    .map(([l, st, col]) => `<div><b style="color:${count(st) ? col : '#4b5563'}">${count(st)}</b><span>${l}</span></div>`).join('');
  for (const b of $('decTabs').children) {
    b.classList.toggle('on', b.dataset.f === decFilter);
    if (b.dataset.f === 'open') b.textContent = `OFFEN (${count(OPEN_ST)})`;
  }
  $('decList').innerHTML = list.length ? list.map(c => {
    const [lab, col] = DEC_STATUS[c.status];
    const v = c.verdict;
    const meta = [c.when ? c.when.toUpperCase() : c.lap ? `RD ${c.lap}` : 'VOR DEM START', c.typeName.toUpperCase()];
    if (v && v.carId) meta.push(`${PENALTIES[v.penalty].short} ${v.carId}`);
    else if (c.scene) meta.push('🎥 SZENE');
    const done = !OPEN_ST.includes(c.status);
    return `<button class="dec-it${c.status === 'new' ? ' new' : c.status === 'investigating' ? ' inv' : ''}${done ? ' done' : ''}" data-doc="${c.id}">
      <span class="dec-no">DOC<b>${c.id}</b></span><span><span class="dec-tt">${c.title}</span><span class="dec-mt">${meta.join(' · ')}</span></span>
      <span class="dec-st" style="color:${col};border-color:${col}">${lab}</span></button>`;
  }).join('') : `<div class="empty"><div class="empty-icon">⚖️</div>${race.cases.length ? 'Keine Fälle in dieser Ansicht.' : 'Noch keine Entscheidungen.<br>Vorfälle zwischen Fahrern und Regelverstöße erscheinen hier.'}</div>`;
  const next = decCases().find(c => c.status === 'new') || race.cases.filter(c => c.status === 'new').sort((a, b) => a.id - b.id)[0];
  const btn = $('decNext');
  if (race.phase === 'finished' && !next) { btn.textContent = 'ERGEBNIS ANZEIGEN ›'; btn.dataset.mode = 'results'; btn.disabled = false; }
  else { btn.textContent = next ? 'NÄCHSTEN NEUEN FALL ÖFFNEN ›' : 'KEINE NEUEN FÄLLE'; btn.dataset.mode = next ? String(next.id) : ''; btn.disabled = !next; }
}
$('decList').addEventListener('click', e => { const b = e.target.closest('[data-doc]'); if (b) showDecDoc(Number(b.dataset.doc)); });
$('decTabs').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { decFilter = b.dataset.f; renderDec(true); $('decList').scrollTop = 0; } });
$('decClose').addEventListener('click', closeDecisions);
$('decBack').addEventListener('click', showDecList);
$('decNext').addEventListener('click', () => {
  const m = $('decNext').dataset.mode;
  if (m === 'results') { closeDecisions(); finishFlow(); } else if (m) showDecDoc(Number(m));
});
const decStep = d => {
  const list = decCases();
  const i = list.findIndex(c => c.id === decDocId);
  if (i >= 0 && list[i + d]) showDecDoc(list[i + d].id);
  else if (i < 0 && d > 0 && list.length) showDecDoc(list[0].id);   // entschiedener Fall fällt aus „Offen“: weiter zum ersten offenen
};
$('decPrev').addEventListener('click', () => decStep(-1));
$('decNextDoc').addEventListener('click', () => decStep(1));

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

// Schwer: keine Pause, solange Fälle offen sind (neu oder in Untersuchung)
function pendingCases() {
  return race ? race.cases.filter(c => c.status === 'new' || c.status === 'investigating').length : 0;
}
function pauseBlocked() {
  return race && race.difficulty === 'hard' && !paused && !['finished', 'chequered'].includes(race.phase) && pendingCases() > 0;
}
function vibrate(pattern) {
  if (settings.vibrate === false || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* nicht unterstützt */ }
}

$('pauseBtn').addEventListener('click', () => {
  if (!race || race.phase === 'pre') return;
  if (pauseBlocked()) {
    const n = pendingCases();
    toast(`Schwer: Pause erst möglich, wenn alle Fälle bearbeitet sind (${n} offen)`);
    return;
  }
  paused = !paused;
  updatePauseBtn();
  if (paused) autosave();
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
$('soundToggle').checked = settings.sound !== false;
$('soundToggle').addEventListener('change', e => {
  settings.sound = e.target.checked;
  saveSettings(settings);
  sound.unlock();
  sound.setEnabled(settings.sound);
});
$('vibrateToggle').checked = settings.vibrate !== false;
$('vibrateToggle').addEventListener('change', e => {
  settings.vibrate = e.target.checked;
  saveSettings(settings);
  if (e.target.checked) vibrate(60);
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
$('zoomResetBtn').addEventListener('click', () => { if (map.follow) stopFollow(); else map.resetView(); });

// Ranking-Tower
const TOWER_PAD = 164;
function applyTower() {
  $('tower').classList.toggle('hidden', !settings.showTower);
  $('towerBtn').classList.toggle('active', settings.showTower);
  map.setPadLeft(settings.showTower ? TOWER_PAD : 0);
  if (settings.showTower && race) renderTower($('tower'), race, map.selected);
}
$('towerBtn').addEventListener('click', () => {
  settings.showTower = !settings.showTower;
  saveSettings(settings);
  applyTower();
});
$('tower').addEventListener('pointerdown', () => { touching = true; });
$('tower').addEventListener('click', e => {
  const row = e.target.closest('.tw-row');
  // ausgeschiedene Fahrer lassen sich nicht verfolgen
  if (row && race && race.carById[row.dataset.id] && !race.carById[row.dataset.id].retired) toggleFollow(row.dataset.id);
});

// ---------- Fahrer verfolgen (Klick im Tower) ----------
let followRestore = null;   // war der Bereich unten vorher ausgeklappt?
function toggleFollow(id) {
  if (map.follow === id) { stopFollow(); return; }
  if (!map.follow) followRestore = !settings.panelCollapsed;
  map.selected = id;
  map.startFollow(id);
  renderDriverCard();
  $('driverCard').classList.remove('hidden');
  if (!settings.panelCollapsed) animatePanel(true, mapWrap.getBoundingClientRect().height);
  renderTiming($('timing'), race, timingOpts());
  if (settings.showTower) renderTower($('tower'), race, map.selected);
}

function stopFollow() {
  if (!map.follow) return;
  map.stopFollow();
  map.selected = null;
  $('driverCard').classList.add('hidden');
  if (followRestore) animatePanel(false, mapWrap.getBoundingClientRect().height);
  followRestore = null;
  if (race) {
    renderTiming($('timing'), race, timingOpts());
    if (settings.showTower) renderTower($('tower'), race, map.selected);
  }
}

function renderDriverCard() {
  const el = $('driverCard');
  if (!map.follow || !race) return;
  const car = race.carById[map.follow];
  if (!car) { stopFollow(); return; }
  const st = race.standings();
  const i = st.indexOf(car);
  const ahead = i > 0 ? st[i - 1] : null, behind = st[i + 1];
  const g = (a, b) => { const x = race.gap(a, b); return !x ? '–' : x.laps ? `${x.laps} Rd` : `${x.time.toFixed(1).replace('.', ',')} s`; };
  let status = 'Auf der Strecke';
  if (car.dsq) status = 'Disqualifiziert';
  else if (car.retired) status = `Ausfall – ${car.dnf}`;
  else if (car.finished) status = 'Im Ziel';
  else if (car.inGarage) status = 'In der Garage';
  else if (car.pitStart && race.preStart) status = 'Start aus der Boxengasse';
  else if (car.inPit) status = 'Boxengasse';
  else if (car.offTrack) status = 'Neben der Strecke';
  else if (car.damage) status = car.damage === 'wing' ? 'Frontflügel beschädigt' : 'Reifenschaden';
  const pens = [];
  const sec = unservedSecs(car);
  if (sec) pens.push(`+${sec} s offen`);
  for (const p of [...car.serve, ...(car.serving ? [car.serving] : [])]) pens.push(PENALTIES[p.type].short);
  if (car.warnings) pens.push(`${car.warnings} Verw.`);
  if (race.penaltyPoints[car.id]) pens.push(`${race.penaltyPoints[car.id]} Strafpkt.`);
  const file = race.driverFile && race.driverFile[car.id];
  const fileHtml = file ? `<div class="dc-file"><b>FAHRERAKTE</b> ${file.pts} Strafpunkte (12 Monate) · ${file.warn} Verwarnung${file.warn === 1 ? '' : 'en'}${file.list.length ? `<br>${file.list.slice(0, 3).map(e => `${e.where}: ${e.what} – ${e.pen}`).join('<br>')}` : ' · keine Strafen in dieser Saison'}</div>` : '';
  const careful = car.caution >= 0.2 ? `<span class="dc-tag">${car.caution >= 0.5 ? 'fährt sehr vorsichtig' : 'fährt vorsichtiger'}</span>` : '';
  const cell = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
  el.style.setProperty('--team', car.team.color);
  el.innerHTML = `
    <div class="dc-head">
      <span class="dc-pos">${car.retired ? '–' : `P${i + 1}`}</span>
      <span class="dc-num">${car.driver.number}</span>
      <span class="dc-name"><b>${car.driver.first} ${car.driver.last}</b><small>${car.team.name} · ${status}</small></span>
      ${careful}
      <button class="dc-close" aria-label="Verfolgen beenden">✕</button>
    </div>
    <div class="dc-grid">
      ${race.isSession ? cell('Beste Runde', formatLap(car.bestLap)) : cell('Vordermann', ahead ? `${ahead.id} ${g(car, ahead)}` : '–')}
      ${race.isSession ? cell('Runden', car.sLaps ? car.sLaps.length : 0) : cell('Hintermann', behind ? `${behind.id} ${g(behind, car)}` : '–')}
      ${cell('Letzte', formatLap(car.lastLap))}
      ${cell('Beste', formatLap(car.bestLap))}
      ${cell('Reifen', `${COMPOUNDS[car.compound].name} · ${car.tyreAge} Rd`)}
      ${cell(race.isSession ? 'Startplatz' : 'Stopps', race.isSession ? '–' : car.stops)}
      ${cell('Strafen', pens.join(' · ') || 'keine')}
      ${cell('Startplatz', race.isSession ? '–' : car.gridPos)}
    </div>${fileHtml}`;
}
$('driverCard').addEventListener('click', e => { if (e.target.closest('.dc-close')) stopFollow(); });

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
  if (b.dataset.tab === 'cases') { openDecisions(); return; }
  if (settings.panelCollapsed) animatePanel(false, mapWrap.getBoundingClientRect().height);
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

// Höhenbereich der Karte (ausgeklappt … eingeklappt) – steuert die Drehung beim Wischen
map.heightRange = () => [Math.max(200, window.innerHeight * 0.34), maxMapHeight()];

function maxMapHeight() {
  const used = ['.status', '#driverCard', '#dragHandle', '.tabs', '.actions']
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
// Karte weich auf die Zielhöhe animieren (die Drehung folgt dabei der Höhe)
function animatePanel(collapse, fromH) {
  const expandedH = Math.max(200, window.innerHeight * 0.34);
  const toH = collapse ? maxMapHeight() : expandedH;
  const start = performance.now();
  appEl.classList.add('dragging');
  appEl.classList.remove('collapsed');
  const stepAnim = now => {
    const k = Math.min(1, (now - start) / 260);
    const e = 1 - Math.pow(1 - k, 3);
    mapWrap.style.height = `${fromH + (toH - fromH) * e}px`;
    if (k < 1) { requestAnimationFrame(stepAnim); return; }
    appEl.classList.remove('dragging');
    mapWrap.style.height = '';
    setCollapsed(collapse);
  };
  requestAnimationFrame(stepAnim);
}

const dragEnd = () => {
  if (!drag) return;
  if (drag.moved) {
    const expandedH = Math.max(200, window.innerHeight * 0.34);
    const collapse = drag.last > (expandedH + maxMapHeight()) / 2;
    animatePanel(collapse, drag.last);
    suppressTabClick = true;
    setTimeout(() => { suppressTabClick = false; }, 50);
  }
  drag = null;
};
window.addEventListener('pointerup', dragEnd);
window.addEventListener('pointercancel', dragEnd);

$('flagBtn').addEventListener('click', () => openFlags());
$('flagCloseBtn').addEventListener('click', closeDesk);
$('deskClose').addEventListener('click', closeDesk);
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
$('ctlCloseBtn').addEventListener('click', closeDesk);
$('medBtn').addEventListener('click', () => openControl('medical'));
$('sweepBtn').addEventListener('click', () => openControl('sweeper'));
$('craneBtn').addEventListener('click', () => openControl('crane'));
$('pitBtn').addEventListener('click', () => openControl('pit'));
$('msgBtn').addEventListener('click', () => openControl('msg'));
$('startDeskBtn').addEventListener('click', () => openControl('start'));
$('boBtn').addEventListener('click', () => openControl('bo'));

// Kontrollpult öffnen: passende Konsole zur aktuellen Meldung, sonst die zuletzt benutzte
$('deckBtn').addEventListener('click', () => {
  if (!race) return;
  if (deskOpen()) { closeDesk(); return; }
  const el = $('alertBanner');
  if (!el.classList.contains('hidden') && el.dataset.kind) {
    if (el.dataset.kind === 'flags') openFlags(Number(el.dataset.sector));
    else openControl(el.dataset.kind);
  } else if (lastDeskKind === 'flags') openFlags();
  else openControl(lastDeskKind);
});

document.querySelectorAll('.act[data-soon]').forEach(b => b.addEventListener('click', () => {
  toast(`${b.dataset.label}: kommt in Meilenstein ${b.dataset.soon}`);
}));

$('newRaceBtn').addEventListener('click', () => {
  // Einzelrennen: nach der letzten Session beginnt das Wochenende neu
  const wk = settings.singleWk;
  if (settings.mode !== 'season' && wk && race && race.phase === 'finished' && race.singleIdx === wk.sessions.length - 1) resetSingleWeekend();
  newRace();
});
$('closeResultBtn').addEventListener('click', () => $('resultScreen').classList.add('hidden'));
$('openCasesBtn').addEventListener('click', () => {
  if (race && race.phase === 'finished') { $('resultScreen').classList.add('hidden'); finishFlow(); return; }
  $('resultScreen').classList.add('hidden');
  openDecisions();
});
$('menuBtn').addEventListener('click', () => {
  if (!race || race.phase === 'pre') return;
  paused = true;
  updatePauseBtn();
  if (confirm('Aktuelles Rennen abbrechen und ein neues Rennen vorbereiten?')) {
    clearRaceState();
    savedRace = null;
    newRace();
  }
});
$('modeSingle').addEventListener('click', () => setMode('single'));
$('modeSeason').addEventListener('click', () => setMode('season'));
$('seasonBtn').addEventListener('click', () => showSeason());
$('seasonCloseBtn').addEventListener('click', () => $('seasonScreen').classList.add('hidden'));
document.querySelectorAll('.stab').forEach(b => b.addEventListener('click', () => { seasonTab = b.dataset.stab; renderSeasonTab(); }));
$('seasonResetBtn').addEventListener('click', () => {
  const cur = getSeason();
  const finished = cur && !currentRound(cur);
  if (finished) {
    if (!confirm(`Neue Saison ${cur.year + 1} starten? Strafpunkte gelten wie in echt 12 Monate weiter.`)) return;
    saveSeason(newSeason(cur));
  } else {
    if (!confirm('Die Saison komplett neu beginnen? Alle Punkte und Strafen werden gelöscht.')) return;
    saveSeason(newSeason());
  }
  newRace();
  showSeason();
});
$('applySeasonBtn').addEventListener('click', () => {
  if (settings.mode !== 'season') {
    if (openCases(race).length || !advanceSingle(race)) return;
    clearRaceState();
    savedRace = null;
    $('resultScreen').classList.add('hidden');
    newRace();
    return;
  }
  season = getSeason();
  if (!season || race.seasonApplied || race.seasonRound !== season.round || openCases(race).length) return;
  if (!season.weekend || season.weekend.idx !== race.weekendIdx) return;
  const wasRace = race.kind === 'race';
  const notes = finishSession(season, race, rateRace(race));
  race.seasonApplied = true;
  saveSeason(season);
  clearRaceState();
  savedRace = null;
  $('resultScreen').classList.add('hidden');
  newRace();
  if (wasRace) {
    seasonTab = 'drivers';
    showSeason(notes);
  } else if (notes.length) {
    showSeason(notes);
  }
});
$('statsCloseBtn').addEventListener('click', () => $('statsScreen').classList.add('hidden'));
$('statsResetBtn').addEventListener('click', () => {
  if (!confirm('Den gesamten Verlauf und die Statistik löschen?')) return;
  clearHistory();
  renderStats();
  renderHistory();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !paused) requestWakeLock();
  if (document.visibilityState === 'hidden') autosave();
});
window.addEventListener('pagehide', autosave);

// Seiten-Zoom verhindern (iOS ignoriert user-scalable=no)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// ---------- Start ----------

$('speedBtn').textContent = `${settings.speed}×`;
if (!LENGTHS[settings.length]) settings.length = 'medium';
if (!['easy', 'medium', 'hard'].includes(settings.difficulty)) settings.difficulty = 'medium';
appEl.classList.toggle('collapsed', settings.panelCollapsed);
applyTower();
$('labelsBtn').classList.toggle('active', settings.showLabels);
newRace();
requestAnimationFrame(frame);

// Gespeichertes Rennen vorhanden? → auf dem Startbildschirm zum Fortsetzen anbieten
loadRaceState().then(data => {
  const r = data && TRACKS[data.trackId] && restoreRace({ track: getTrack(data.trackId), teams: TEAMS, drivers: DRIVERS, data });
  if (r && r.phase !== 'pre') {
    savedRace = r;
    renderResume();
  }
}).catch(() => {});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  // Neue Version aktiv: auf dem Startbildschirm direkt neu laden, sonst Hinweis
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    if (!race || race.phase === 'pre') { reloaded = true; location.reload(); }
    else toast('Neue Version verfügbar – nach dem Rennen die App neu laden');
  });
}
