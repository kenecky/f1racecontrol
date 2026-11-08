// Zeitentabelle
import { COMPOUNDS, formatLap } from '../sim/race.js';
import { unservedSecs } from '../control/stewards.js';

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

// Qualifying: Autos in der Ausscheidungszone hervorheben
function danger(race, car, i) {
  if (!race.isSession || race.phase !== 'running' || race.segState !== 'run') return false;
  const keep = race.segment.keep;
  return keep && car.elimSeg === null && i >= keep;
}

export function renderTiming(el, race, { gapMode, selected }) {
  let st = race.standings();
  // Qualifying: Ausgeschiedene werden ab dem nächsten Abschnitt nicht mehr angezeigt
  if (race.isSession && race.phase !== 'finished') st = st.filter(c => c.elimSeg === null || c.elimSeg === undefined);
  const leader = st[0];
  const started = !race.preStart;
  const rows = st.map((car, i) => {
    const pos = i + 1;
    let gapText;
    if (race.isSession) {
      // Training/Qualifying: Bestzeit des Ersten, sonst Rückstand
      const t = race.rankTime(car);
      if (!started || t === null) gapText = '–';
      else if (i === 0) gapText = formatLap(t);
      else gapText = formatGap(race.gap(car, gapMode === 'interval' ? st[i - 1] : leader), false);
    } else if (!started && car.retired) gapText = 'Ausfall';
    else if (!started) gapText = car.pitStart ? 'Boxengasse' : `Startplatz ${car.gridPos}`;
    else if (car.retired) gapText = car.dsq ? 'DSQ' : 'Ausfall';
    else if (gapMode === 'interval') gapText = i === 0 ? (car.finished ? '🏁' : 'Intervall') : formatGap(race.gap(car, st[i - 1]), false);
    else gapText = i === 0 ? (car.finished ? '🏁' : 'Führung') : formatGap(race.gap(car, leader), false);

    const delta = race.isSession ? 0 : car.gridPos - pos;
    const deltaHtml = !started || delta === 0 ? '<span class="delta"></span>'
      : `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</span>`;

    let status = '';
    if (car.dsq) status = '<span class="badge badge-out">DSQ</span>';
    else if (car.retired) status = '<span class="badge badge-out">DNF</span>';
    else if (car.offTrack) status = '<span class="badge badge-off">AUS</span>';
    else if (car.finished) status = '<span class="badge badge-fin">🏁</span>';
    else if (car.redQueued) status = '<span class="badge badge-red">ROT</span>';
    else if (car.unlap) status = '<span class="badge badge-unlap">+1 RD</span>';
    else if (race.isSession && car.elimSeg !== null && car.elimSeg !== undefined) status = `<span class="badge badge-elim">${race.info.segments[car.elimSeg].id}</span>`;
    else if (race.isSession && car.inGarage) status = '<span class="badge badge-garage">BOX</span>';
    else if (race.isSession && car.prog && car.prog.phase === 'push') status = '<span class="badge badge-push">⏱</span>';
    else if (race.isSession && car.prog && car.prog.phase === 'out') status = '<span class="badge badge-pit">OUT</span>';
    else if (race.isSession && car.prog && car.prog.phase === 'cool') status = '<span class="badge badge-pit">IN</span>';
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
    const pen = unservedSecs(car);
    const pending = [...car.serve, ...(car.serving ? [car.serving] : [])].map(p => p.type.toUpperCase()).join(' ');
    const penHtml = (pen ? `<span class="pen">+${pen}</span>` : '') + (pending ? `<span class="pen">${pending}</span>` : '')
      + (car.giveBack ? '<span class="pen">↩</span>' : '');

    return `
      <div class="row${sel ? ' selected' : ''}${car.retired ? ' retired' : ''}${danger(race, car, i) ? ' danger' : ''}" data-id="${car.id}">
        <span class="pos">${pos}</span>
        <span class="teambar" style="background:${car.team.color}"></span>
        <span class="code">${car.id}${fl}${penHtml}</span>
        ${deltaHtml}
        <span class="rst">${status}</span>
        <span class="gap">${gapText}</span>
        <span class="tyrecell">${tyreBadge(car.compound, car.tyreAge)}</span>
        <span class="stops">${car.stops}</span>
      </div>${details}`;
  });
  el.innerHTML = rows.join('');
}
