// Ranking-Tower links in der Karte (wie in der TV-Übertragung)
import { formatLap } from '../sim/race.js';
import { unservedSecs } from '../control/stewards.js';
export function renderTower(el, race, selected, gapMode = 'leader') {
  let st = race.standings();
  if (race.isSession && race.phase !== 'finished') st = st.filter(c => c.elimSeg === null || c.elimSeg === undefined);
  const leader = st[0];
  const started = !race.preStart;
  let lap = started ? `<b>${race.leaderLap}</b> / ${race.laps}` : `<b>${race.phase === 'formation' ? 'FORMATION' : 'START'}</b>`;
  if (race.isSession) {
    const rem = race.segState === 'break' ? race.breakLeft : race.remaining;
    const mm = `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`;
    lap = race.phase === 'finished' ? '<b>ENDE</b>' : `<b>${race.segState === 'break' ? 'PAUSE' : race.segment.id}</b> ${mm}`;
  }
  const rows = st.map((car, i) => {
    let gap = '';
    if (race.isSession) {
      const t = race.rankTime(car);
      if (car.elimSeg !== null && car.elimSeg !== undefined && i > 0) gap = t === null ? race.info.segments[car.elimSeg].id : `+${(t - race.rankTime(leader)).toFixed(3).replace('.', ',')}`;
      else if (t === null) gap = car.inGarage ? 'BOX' : '';
      else if (i === 0) gap = formatLap(t);
      else { const g = race.gap(car, leader); gap = g ? `+${g.time.toFixed(3).replace('.', ',')}` : ''; }
    } else if (car.dsq) gap = 'DSQ';
    else if (car.retired) gap = 'OUT';
    else if (!started) gap = car.pitStart ? 'BOX' : '';
    else if (i === 0) gap = car.finished ? '🏁' : 'Leader';
    else if (car.inPit || car.stopTimer > 0) gap = 'BOX';
    else {
      const ref = gapMode === 'interval' ? st[i - 1] : leader;
      const g = race.gap(car, ref);
      gap = !g ? '' : g.laps ? `+${g.laps} Rd` : `+${g.time.toFixed(3).replace('.', ',')}`;
    }
    // offene Strafen: Zeitstrafe, Durchfahrt/Stop-and-Go, Platz zurückgeben
    let pen = '';
    if (!race.isSession && !car.retired) {
      const secs = unservedSecs(car);
      const serve = [...(car.serve || []), ...(car.serving ? [car.serving] : [])].map(p => p.type === 'dt' ? 'DT' : 'SG');
      pen = [secs ? `+${secs}` : '', ...serve, car.giveBack ? '↩' : ''].filter(Boolean).join(' ');
    }
    const cls = ['tw-row', i === 0 ? 'p1' : '', race.isSession && race.segState === 'run' && race.segment.keep && car.elimSeg === null && i >= race.segment.keep ? 'danger' : '', car.retired ? 'out' : '', selected === car.id ? 'sel' : ''].join(' ');
    return `
      <div class="${cls}" data-id="${car.id}">
        <span class="tw-pos">${car.retired ? '–' : i + 1}</span>
        <span class="tw-team" style="background:${car.team.color}">${car.team.short}</span>
        <span class="tw-code">${car.id}${pen ? `<i class="tw-pen">${pen}</i>` : ''}</span>
        <span class="tw-gap">${gap}</span>
        <span class="tw-tyre ${car.compound}">${car.retired ? '' : car.compound}</span>
      </div>`;
  }).join('');
  el.innerHTML = `<div class="tw-head">${race.isSession || !started ? '' : 'RUNDE '}${lap}${!race.isSession && started ? `<small class="tw-mode">${gapMode === 'interval' ? 'INTERVALL' : 'ABSTAND'} ⇄</small>` : ''}</div>${rows}`;
}
