// Ranking-Tower links in der Karte (wie in der TV-Übertragung)
export function renderTower(el, race, selected) {
  const st = race.standings();
  const leader = st[0];
  const started = race.phase !== 'pre' && race.phase !== 'lights';
  const lap = started ? `<b>${race.leaderLap}</b> / ${race.laps}` : `<b>START</b>`;
  const rows = st.map((car, i) => {
    let gap = '';
    if (car.dsq) gap = 'DSQ';
    else if (car.retired) gap = 'OUT';
    else if (!started) gap = '';
    else if (i === 0) gap = car.finished ? '🏁' : 'Leader';
    else if (car.inPit || car.stopTimer > 0) gap = 'BOX';
    else {
      const g = race.gap(car, leader);
      gap = !g ? '' : g.laps ? `+${g.laps} Rd` : `+${g.time.toFixed(3).replace('.', ',')}`;
    }
    const cls = ['tw-row', i === 0 ? 'p1' : '', car.retired ? 'out' : '', selected === car.id ? 'sel' : ''].join(' ');
    return `
      <div class="${cls}" data-id="${car.id}">
        <span class="tw-pos">${car.retired ? '–' : i + 1}</span>
        <span class="tw-team" style="background:${car.team.color}">${car.team.short}</span>
        <span class="tw-code">${car.id}</span>
        <span class="tw-gap">${gap}</span>
        <span class="tw-tyre ${car.compound}">${car.retired ? '' : car.compound}</span>
      </div>`;
  }).join('');
  el.innerHTML = `<div class="tw-head">RUNDE ${lap}</div>${rows}`;
}
