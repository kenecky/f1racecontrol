// Zeitentabelle
import { COMPOUNDS, formatLap } from '../sim/race.js';

export function formatGap(g, isRef) {
  if (isRef) return '';
  if (!g) return '–';
  if (g.laps) return `+${g.laps} Rd`;
  return `+${g.time.toFixed(1).replace('.', ',')}`;
}

export function formatClock(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function tyreBadge(compound, age) {
  const c = COMPOUNDS[compound];
  return `<span class="tyre tyre-${c.id}" title="${c.name}">${c.id}</span><span class="tyre-age">${age}</span>`;
}

export function renderTiming(el, race, { gapMode, selected }) {
  const st = race.standings();
  const leader = st[0];
  const started = race.phase !== 'pre' && race.phase !== 'lights';
  const rows = st.map((car, i) => {
    const pos = i + 1;
    let gapText;
    if (!started) gapText = `Startplatz ${car.gridPos}`;
    else if (car.retired) gapText = 'Ausfall';
    else if (gapMode === 'interval') gapText = i === 0 ? (car.finished ? '🏁' : 'Intervall') : formatGap(race.gap(car, st[i - 1]), false);
    else gapText = i === 0 ? (car.finished ? '🏁' : 'Führung') : formatGap(race.gap(car, leader), false);

    const delta = car.gridPos - pos;
    const deltaHtml = !started || delta === 0 ? '<span class="delta"></span>'
      : `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</span>`;

    let status = '';
    if (car.retired) status = '<span class="badge badge-out">DNF</span>';
    else if (car.offTrack) status = '<span class="badge badge-off">AUS</span>';
    else if (car.finished) status = '<span class="badge badge-fin">🏁</span>';
    else if (car.redQueued) status = '<span class="badge badge-red">ROT</span>';
    else if (car.unlap) status = '<span class="badge badge-unlap">+1 RD</span>';
    else if (car.stopTimer > 0) status = '<span class="badge badge-pit">STOPP</span>';
    else if (car.inPit) status = '<span class="badge badge-pit">BOX</span>';

    const sel = selected === car.id;
    const details = sel ? `
      <div class="row-details">
        <div><span>Fahrer</span>#${car.driver.number} ${car.driver.first} ${car.driver.last}</div>
        <div><span>Team</span>${car.team.name}</div>
        <div><span>Letzte Runde</span>${formatLap(car.lastLap)}</div>
        <div><span>Beste Runde</span>${formatLap(car.bestLap)}</div>
        <div><span>Reifen</span>${COMPOUNDS[car.compound].name}, ${car.tyreAge} Rd</div>
        <div><span>Stopps</span>${car.stops}</div>
        ${car.retired ? `<div><span>Ausfall</span>${car.dnf}</div>` : ''}
      </div>` : '';
    const fl = race.fastest && race.fastest.carId === car.id ? '<span class="fl" title="Schnellste Runde">⏱</span>' : '';

    return `
      <div class="row${sel ? ' selected' : ''}${car.retired ? ' retired' : ''}" data-id="${car.id}">
        <span class="pos">${pos}</span>
        <span class="teambar" style="background:${car.team.color}"></span>
        <span class="code">${car.id}${fl}</span>
        ${deltaHtml}
        <span class="rst">${status}</span>
        <span class="gap">${gapText}</span>
        <span class="tyrecell">${tyreBadge(car.compound, car.tyreAge)}</span>
        <span class="stops">${car.stops}</span>
      </div>${details}`;
  });
  el.innerHTML = rows.join('');
}
