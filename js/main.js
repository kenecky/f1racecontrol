// Einstieg: verbindet Simulation und Oberfläche, Game-Loop.
import { TEAMS } from './data/teams.js';
import { DRIVERS } from './data/drivers.js';
import { RED_BULL_RING } from './data/tracks/redbullring.js';
import { buildTrack } from './sim/trackModel.js';
import { Race, DT, formatLap } from './sim/race.js';
import { randomSeed } from './util/rng.js';
import { TrackMap } from './ui/map.js';
import { renderTiming, formatClock, formatGap } from './ui/timing.js';
import { Feed } from './ui/feed.js';
import { loadSettings, saveSettings } from './storage.js';

const SPEEDS = [1, 2, 4, 8, 16, 32];
const $ = id => document.getElementById(id);

const settings = loadSettings();
const track = buildTrack(RED_BULL_RING);
const map = new TrackMap($('map'), track);
const feed = new Feed($('feed'));

let race = null;
let paused = true;
let acc = 0;
let lastFrame = performance.now();
let lastTiming = 0;
let touching = false;
let activeTab = 'timing';
let unread = 0;
let resultShown = false;
let wakeLock = null;
const prevD = new Map();

map.showLabels = settings.showLabels;
map.onSelect = id => select(id);

// ---------- Rennen ----------

function newRace(seed = randomSeed()) {
  race = new Race({ track, teams: TEAMS, drivers: DRIVERS, seed });
  paused = true;
  acc = 0;
  resultShown = false;
  prevD.clear();
  feed.reset();
  unread = 0;
  updateBadge();
  $('seedInfo').textContent = `Rennen #${seed}`;
  $('seedInput').value = '';
  $('resultScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  updateStatus();
  renderTiming($('timing'), race, timingOpts());
}

function startRace() {
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
    }
  }

  if (race) {
    const alpha = paused ? 1 : Math.min(1, acc / DT);
    const renderD = new Map();
    for (const c of race.cars) {
      const p = prevD.get(c);
      renderD.set(c, p === undefined ? c.d : p + (c.d - p) * alpha);
    }
    map.draw(race, renderD);

    if (now - lastTiming > 300) {
      lastTiming = now;
      updateStatus();
      if (!touching) renderTiming($('timing'), race, timingOpts());
      const added = feed.update(race.events);
      if (added && activeTab !== 'feed') { unread += added; updateBadge(); }
      if (race.phase === 'finished' && !resultShown) showResults();
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Anzeige ----------

function timingOpts() {
  return { gapMode: settings.gapMode, selected: map.selected };
}

function updateStatus() {
  const lapEl = $('lap');
  if (race.phase === 'pre' || race.phase === 'lights') lapEl.textContent = `Start · ${race.laps} Rd`;
  else lapEl.textContent = `${race.leaderLap}/${race.laps}`;
  $('clock').textContent = formatClock(race.phase === 'running' || race.phase === 'chequered' || race.phase === 'finished' ? race.time : 0);

  const flag = $('flag');
  if (race.phase === 'chequered' || race.phase === 'finished') { flag.textContent = 'ZIEL'; flag.className = 'flag-chip flag-chequered'; }
  else if (race.phase === 'pre' || race.phase === 'lights') { flag.textContent = 'START'; flag.className = 'flag-chip flag-start'; }
  else { flag.textContent = 'GRÜN'; flag.className = 'flag-chip flag-green'; }

  const lights = $('lights');
  lights.classList.toggle('hidden', race.phase !== 'lights');
  [...lights.children].forEach((el, i) => el.classList.toggle('on', i < race.lightsOn));

  $('gapHead').textContent = settings.gapMode === 'interval' ? 'Intervall' : 'Abstand';
}

function updatePauseBtn() {
  $('pauseBtn').textContent = paused ? '▶' : '❚❚';
  $('pauseBtn').setAttribute('aria-label', paused ? 'Weiter' : 'Pause');
  $('app').classList.toggle('is-paused', paused && race && race.phase !== 'pre');
}

function updateBadge() {
  const b = $('feedBadge');
  b.textContent = unread > 99 ? '99+' : unread;
  b.classList.toggle('hidden', unread === 0);
}

function select(id) {
  map.selected = map.selected === id ? null : id;
  renderTiming($('timing'), race, timingOpts());
}

function showResults() {
  resultShown = true;
  const st = race.standings();
  const winner = st[0];
  const rows = st.map((c, i) => `
    <tr>
      <td class="r-pos">${i + 1}</td>
      <td><span class="teambar" style="background:${c.team.color}"></span>${c.driver.first[0]}. ${c.driver.last}</td>
      <td class="r-gap">${i === 0 ? formatClock(c.finishTime) : formatGap(race.gap(c, winner), false)}</td>
      <td class="r-stops">${c.stops}</td>
    </tr>`).join('');
  const fl = race.fastest ? `${race.carById[race.fastest.carId].driver.last} – ${formatLap(race.fastest.time)} (Runde ${race.fastest.lap})` : '–';
  const overtakes = race.events.filter(e => e.type === 'overtake').length;
  $('resultBody').innerHTML = `
    <table class="results">
      <thead><tr><th>Pos</th><th>Fahrer</th><th>Zeit/Abstand</th><th>Stopps</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="result-facts">
      <div><span>Schnellste Runde</span>${fl}</div>
      <div><span>Überholmanöver</span>${overtakes}</div>
    </div>`;
  $('resultScreen').classList.remove('hidden');
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  if (tab === 'feed') { unread = 0; updateBadge(); }
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
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

$('speedBtn').addEventListener('click', () => {
  const i = SPEEDS.indexOf(settings.speed);
  settings.speed = SPEEDS[(i + 1) % SPEEDS.length];
  $('speedBtn').textContent = `${settings.speed}×`;
  saveSettings(settings);
});

$('labelsBtn').addEventListener('click', () => {
  settings.showLabels = !settings.showLabels;
  map.showLabels = settings.showLabels;
  $('labelsBtn').classList.toggle('active', settings.showLabels);
  saveSettings(settings);
});

$('gapHead').addEventListener('click', () => {
  settings.gapMode = settings.gapMode === 'interval' ? 'leader' : 'interval';
  saveSettings(settings);
  updateStatus();
  renderTiming($('timing'), race, timingOpts());
});

const timingEl = $('timing');
timingEl.addEventListener('pointerdown', () => { touching = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { touching = false; }, 50); });
window.addEventListener('pointercancel', () => { touching = false; });
timingEl.addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (row) select(row.dataset.id);
});

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

document.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => {
  toast(`${b.dataset.label}: kommt in Meilenstein ${b.dataset.soon}`);
}));

$('newRaceBtn').addEventListener('click', () => newRace());
$('closeResultBtn').addEventListener('click', () => $('resultScreen').classList.add('hidden'));
$('menuBtn').addEventListener('click', () => {
  if (!race || race.phase === 'pre') return;
  paused = true;
  updatePauseBtn();
  if (confirm('Aktuelles Rennen abbrechen und ein neues Rennen vorbereiten?')) newRace();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !paused) requestWakeLock();
});

// ---------- Start ----------

$('speedBtn').textContent = `${settings.speed}×`;
$('labelsBtn').classList.toggle('active', settings.showLabels);
newRace();
updatePauseBtn();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
