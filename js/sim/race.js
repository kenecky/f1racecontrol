// Rennsimulation: Autos, Rundenzeiten, Überholen, Boxenstopps, Zeitnahme.
// Unabhängig von der Darstellung – kann auch ohne Browser laufen (Tests).
import { createRng } from '../util/rng.js';
import { speedAt, wrapD, inRange, crossed, accelAt, sectorIndexAt } from './trackModel.js';
import {
  FLAG_FACTOR, isYellow, rollLapIncidents, checkPendingIncident, endOffTrack,
  maybeContactDebris, updateHazards,
} from './hazards.js';
import {
  neutralSpeedFactor, passingBanned, moveSafetyCar, afterMove, onLineCrossed,
  pitDecision, enterPitUnderRed, arriveInQueue, trackNeutralUse,
} from './neutral.js';

export const DT = 0.05;          // Simulationsschritt in Sekunden
const MS_LEN = 100;              // Mini-Sektor-Länge (m) für Abstandsberechnung

import { COMPOUNDS } from './tyres.js';
export { COMPOUNDS };

export class Race {
  constructor({ track, teams, drivers, seed }) {
    this.track = track;
    this.seed = seed;
    this.rng = createRng(seed);
    this.laps = track.laps;
    this.time = 0;              // Rennzeit seit "Lichter aus"
    this.phase = 'pre';         // pre → lights → running → chequered → finished
    this.lightsTimer = 0;
    this.lightsHold = 5 + this.rng.range(0.4, 2.4);
    this.events = [];
    this.eventSeq = 0;
    this.fastest = null;
    this.firstCross = [];
    this.finishCount = 0;

    // Rennleitung
    this.flags = track.sectors.map(() => 'clear');   // Flagge je Marshal-Sektor
    this.flagLog = [];
    this.hazards = [];
    this.hazardSeq = 0;
    this.idleFlagTime = 0;
    this.neutral = null;      // { type: 'vsc' | 'sc' | 'red', phase, ... }
    this.sc = null;           // Safety Car auf der Strecke
    this.physGap = new Map();
    this.neutralStats = { vsc: 0, sc: 0, red: 0, vscTime: 0, scTime: 0, redTime: 0, idle: 0 };

    const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
    this.cars = drivers.map(drv => {
      const team = teamById[drv.team];
      return {
        id: drv.id,
        driver: drv,
        team,
        basePenalty: (100 - team.pace) * 0.06 + (100 - drv.pace) * 0.03,
        d: 0, v: 0, move: 0,
        lap: 0, lapStart: 0, lastLap: null, bestLap: null,
        compound: 'M', tyreAge: 0, plan: [], planIdx: 0, stops: 0,
        inPit: false, stopTimer: 0, stoppedThisVisit: false, pitExitTime: -99,
        lapNoise: 0,
        pass: null, tried: new Set(),
        msK: -1, cross: [],
        reaction: 0, launch: 1,
        finished: false, finishTime: null, finishDist: 0, finishPos: null,
        retired: false, dnf: null, wreck: null,
        offTrack: null, pendingIncident: null,
        usedCompounds: new Set(), unlap: null, restartHold: false,
        redBound: false, redQueued: false, queueD: null, redSlot: null,
        launchUntil: 400,
        gridPos: 0,
      };
    });
    this.carById = Object.fromEntries(this.cars.map(c => [c.id, c]));
    this.setupGrid();
  }

  // ---------- Vorbereitung ----------

  setupGrid() {
    const r = this.rng;
    const quali = this.cars
      .map(c => ({ c, t: c.basePenalty + r.gauss(0.12) }))
      .sort((a, b) => a.t - b.t);
    quali.forEach(({ c }, i) => {
      c.gridPos = i + 1;
      c.d = -(6 + i * 8);
      c.reaction = r.range(0.18, 0.36) + (r.chance(0.08) ? r.range(0.2, 0.5) : 0);
      c.launch = r.range(0.92, 1.06);
      this.planStrategy(c, i);
      c.usedCompounds.add(c.compound);
      c.lapNoise = this.newLapNoise(c);
    });
  }

  planStrategy(car, gridIdx) {
    const r = this.rng;
    const roll = r.next();
    if (gridIdx >= 12 && roll < 0.35) {
      car.compound = 'H';
      car.plan = [{ lap: r.int(34, 44), compound: 'M' }];
    } else if (roll < 0.25) {
      car.compound = 'S';
      car.plan = [{ lap: r.int(14, 19), compound: 'M' }, { lap: r.int(40, 46), compound: 'H' }];
    } else {
      car.compound = 'M';
      car.plan = [{ lap: r.int(24, 34), compound: 'H' }];
    }
  }

  newLapNoise(car) {
    return this.rng.gauss(0.06 + (100 - car.driver.consistency) * 0.008);
  }

  // ---------- Ablauf ----------

  start() {
    if (this.phase === 'pre') {
      this.phase = 'lights';
      this.emit('info', 'Formationsrunde beendet – Autos in der Startaufstellung.');
    }
  }

  get lightsOn() {
    const n = this.neutral;
    if (n && n.type === 'red' && n.phase === 'grid') return Math.min(5, Math.floor(n.lightsTimer) + 1);
    if (this.phase !== 'lights') return 0;
    return Math.min(5, Math.floor(this.lightsTimer) + 1);
  }

  get leaderLap() {
    const leader = this.standings()[0];
    return Math.min(this.laps, leader.lap + 1);
  }

  emit(type, text, data = {}) {
    const leader = this.standings()[0];
    this.events.push({
      id: ++this.eventSeq, type, text, t: this.time,
      lap: this.phase === 'pre' || this.phase === 'lights' ? 0 : Math.min(this.laps, leader.lap + 1),
      ...data,
    });
  }

  lapTarget(car) {
    const tr = this.track;
    const progress = Math.min(1, Math.max(0, car.d / (this.laps * tr.L)));
    const C = COMPOUNDS[car.compound];
    let deg = car.tyreAge * C.deg;
    if (car.tyreAge > C.cliff) deg += (car.tyreAge - C.cliff) * 0.22;
    return tr.baseLap + car.basePenalty + C.offset + deg + 2.2 * (1 - progress) + car.lapNoise;
  }

  step() {
    if (this.phase === 'pre' || this.phase === 'finished') return;
    if (this.phase === 'lights') {
      this.lightsTimer += DT;
      if (this.lightsTimer >= this.lightsHold) {
        this.phase = 'running';
        this.time = 0;
        this.emit('start', 'Lichter aus – das Rennen ist gestartet!');
      }
      return;
    }

    this.time += DT;
    const tr = this.track;
    const L = tr.L;
    this.computePhysGap();
    moveSafetyCar(this, DT);

    // 1) Wunschgeschwindigkeit jedes Autos
    for (const car of this.cars) {
      car.move = 0;
      if (car.retired) continue;
      if (car.redQueued) { car.v = 0; continue; }
      if (car.offTrack) {
        car.v = 0;
        if (this.time >= car.offTrack.until) endOffTrack(this, car);
        continue;
      }
      if (car.stopTimer > 0) {
        car.v = 0;
        car.stopTimer -= DT;
        if (car.stopTimer <= 0) this.finishStop(car);
        continue;
      }
      let vt;
      if (car.finished) {
        vt = speedAt(tr, car.d) * 0.55;
      } else if (car.inPit) {
        vt = tr.pitLaneSpeed;
      } else {
        const nf = neutralSpeedFactor(this, car);
        if (nf !== null) {
          // Neutralisierung: einheitliches Tempo für alle
          vt = speedAt(tr, car.d) * nf;
          if (car.pass && !car.pass.slow) car.pass = null;
        } else {
          vt = speedAt(tr, car.d) * (tr.baseLap / this.lapTarget(car));
          const flag = this.flags[sectorIndexAt(tr, car.d)];
          vt *= FLAG_FACTOR[flag];
          // Überholverbot unter Gelb bzw. bis zur Linie nach einem Neustart
          if (car.pass && !car.pass.slow && (isYellow(flag) || passingBanned(this, car))) car.pass = null;
          if (car.pass && this.time < car.pass.until) vt *= car.pass.blue ? 1.02 : 1.06;
          if (car.defendUntil > this.time) vt *= 0.985;
        }
      }
      if (this.time < car.reaction) vt = 0;
      const launch = car.d < car.launchUntil ? car.launch : 1;
      if (vt > car.v) car.v = Math.min(vt, car.v + accelAt(car.v) * launch * DT);
      else car.v = Math.max(vt, car.v - 50 * DT);
      car.desiredV = vt;
      car.move = car.v * DT;
      // Rote Flagge: an der zugewiesenen Position in der Boxengasse anhalten
      if (car.redBound && car.inPit && car.queueD !== null && car.d + car.move >= car.queueD) {
        car.move = Math.max(0, car.queueD - car.d);
      }
    }

    // 2) Zweikämpfe: niemand fährt durch den Vordermann hindurch
    this.resolveTraffic();

    // 3) Bewegung anwenden, Linien und Boxengasse prüfen
    for (const car of this.cars) {
      if (car.retired) continue;
      const prev = car.d;
      car.d += car.move;
      if (car.finished) continue;
      this.handleCrossings(car, prev);
      checkPendingIncident(this, car, prev);
      if (car.redBound && car.inPit && !car.redQueued && car.queueD !== null && car.d >= car.queueD - 0.01) {
        arriveInQueue(this, car);
      }
    }

    // 4) Überholmanöver abschließen
    for (const car of this.cars) {
      if (!car.pass) continue;
      const target = this.carById[car.pass.target];
      const ahead = wrapD(tr, car.d - target.d);
      if (ahead > 6 && ahead < L / 2) {
        if (!car.pass.blue) {
          const pos = this.standings().indexOf(car) + 1;
          const zone = car.pass.zone ? ` (${car.pass.zone})` : '';
          this.emit('overtake', `${car.id} überholt ${target.id} – P${pos}${zone}`, { cars: [car.id, target.id], slow: car.pass.slow });
          if (car.pass.zone) maybeContactDebris(this, car, target);
        }
        car.pass = null;
      } else if (this.time >= car.pass.until || target.inPit || target.finished || target.retired || target.offTrack) {
        car.pass = null;
      }
    }

    afterMove(this, DT);
    updateHazards(this, DT);
    trackNeutralUse(this, DT);

    if (this.phase === 'chequered' && this.cars.every(c => c.finished || c.retired)) {
      this.phase = 'finished';
      this.emit('finish', 'Alle Autos im Ziel. Rennen beendet.');
    }
  }

  resolveTraffic() {
    const tr = this.track;
    const L = tr.L;
    const onTrack = this.onTrackCars();
    if (onTrack.length < 1) return;
    const scObj = this.sc && !this.sc.inPit
      ? { id: 'SC', isSC: true, d: this.sc.d, move: this.sc.move, v: this.sc.v } : null;

    // Physische Reihenfolge auf der Runde (inkl. Safety Car)
    const phys = [...onTrack, ...(scObj ? [scObj] : [])].sort((a, b) => wrapD(tr, a.d) - wrapD(tr, b.d));
    const aheadOf = new Map();
    phys.forEach((c, i) => aheadOf.set(c, phys[(i + 1) % phys.length]));

    // Von vorne nach hinten (Rennreihenfolge)
    const order = [...onTrack].sort((a, b) => b.d - a.d);
    for (const B of order) {
      const A = aheadOf.get(B);
      if (!A || A === B) continue;
      const gapOld = wrapD(tr, A.d - B.d);
      if (gapOld > 200) continue;
      if (B.unlap) continue; // Zurückrunden hinter dem SC: darf am Feld vorbei
      if (B.pass && B.pass.target === A.id && this.time < B.pass.until) continue;

      const gapNew = gapOld + A.move - B.move;
      const minGap = A.isSC ? 35 : Math.max(7, 0.3 * B.v);
      const banned = passingBanned(this, B);

      if (!A.isSC && gapNew < minGap * 1.8) {
        const lapping = B.d - A.d > L / 2;
        const underYellow = isYellow(this.flags[sectorIndexAt(tr, B.d)]) || isYellow(this.flags[sectorIndexAt(tr, A.d)]);
        if (lapping && !underYellow && !banned) {
          // Überrundung: blaue Flagge, Hinterbänkler macht Platz
          this.startPass(B, A, { blue: true });
          continue;
        }
        const startPhase = A.d < A.launchUntil;
        const slowA = banned
          ? A.v < 6 && B.desiredV > 15
          : !startPhase && B.desiredV > 40 && A.v < speedAt(tr, A.d) * 0.6;
        if (slowA) {
          // deutlich langsameres Auto (z. B. Boxenausfahrt, nach Dreher) – auch unter Gelb erlaubt
          this.startPass(B, A, { slow: true });
          continue;
        }
        const zone = tr.zones.find(z => inRange(tr, B.d, z.start, z.end));
        if (zone && !underYellow && !banned) {
          const key = `${B.lap}:${zone.corner}`;
          if (!B.tried.has(key)) {
            B.tried.add(key);
            if (this.rng.chance(this.overtakeChance(B, A, zone))) {
              this.startPass(B, A, { zone: tr.corners.find(c => c.id === zone.corner).name });
              continue;
            }
          }
        }
      }

      if (gapNew < minGap) {
        const maxMove = Math.max(0, gapOld + A.move - Math.min(minGap, gapOld));
        if (B.move > maxMove) {
          B.move = maxMove;
          B.v = maxMove / DT;
        }
      }
    }
  }

  onTrackCars() {
    return this.cars.filter(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !c.redQueued && c.stopTimer <= 0);
  }

  // Abstand jedes Autos zum physisch Vorausfahrenden (inkl. Safety Car)
  computePhysGap() {
    this.physGap.clear();
    if (!this.neutral || this.neutral.type !== 'sc') return;
    const tr = this.track;
    const list = [...this.onTrackCars()];
    if (this.sc && !this.sc.inPit) list.push({ d: this.sc.d, isSC: true });
    if (list.length < 2) return;
    list.sort((a, b) => wrapD(tr, a.d) - wrapD(tr, b.d));
    list.forEach((c, i) => {
      if (c.isSC) return;
      const ahead = list[(i + 1) % list.length];
      this.physGap.set(c, wrapD(tr, ahead.d - c.d));
    });
  }

  overtakeChance(B, A, zone) {
    const paceDiff = this.lapTarget(A) - this.lapTarget(B); // >0: B schneller
    let p;
    if (paceDiff < 0.1) p = 0.04;
    else p = 0.08 + paceDiff * 0.45;
    p += (B.driver.aggression - 65) / 300;
    p -= (A.driver.aggression - 65) / 400;
    if (B.lap === 0) p += 0.12;   // Startrunde: mehr Bewegung im Feld
    p *= zone.factor;
    return Math.max(0.02, Math.min(0.85, p));
  }

  startPass(B, A, { blue = false, zone = null, slow = false }) {
    B.pass = { target: A.id, until: this.time + (blue ? 8 : 6), blue, zone, slow };
    if (!blue) A.defendUntil = this.time + 4;
  }

  handleCrossings(car, prev) {
    const tr = this.track;
    const L = tr.L;

    // Boxengasse
    if (!car.inPit && this.phase === 'running' && crossed(tr, prev, car.d, tr.pit.entry)) {
      const next = car.plan[car.planIdx];
      const decision = pitDecision(this, car, next);
      if (decision === 'red') {
        car.inPit = true;
        car.pass = null;
        car.unlap = null;
        if (!car.redBound) enterPitUnderRed(this, car);
        car.stoppedThisVisit = true;
      } else if (decision && car.lap < this.laps - 2) {
        car.inPit = true;
        car.stoppedThisVisit = false;
        car.pass = null;
        car.unlap = null;
        if (decision === 'cheap') car.cheapStop = true;
      }
    }
    if (car.inPit) {
      if (!car.stoppedThisVisit && crossed(tr, prev, car.d, tr.pit.box)) {
        car.stoppedThisVisit = true;
        const crew = car.team.pitCrew;
        let t = 2.0 + (100 - crew) * 0.03 + Math.abs(this.rng.gauss(0.25));
        if (this.rng.chance(0.03)) t += this.rng.range(2.5, 8);
        car.stopTimer = t;
        car.lastStopTime = t;
        car.v = 0;
      } else if (crossed(tr, prev, car.d, tr.pit.exit)) {
        car.inPit = false;
        car.pitExitTime = this.time;
      }
    }

    // Exakter Zeitpunkt, an dem Rennmeter m überfahren wurde (Interpolation im Schritt)
    const moved = car.d - prev;
    const timeAt = m => moved > 0 ? this.time - DT * (car.d - m) / moved : this.time;

    // Zeitnahme: Mini-Sektoren
    if (car.d >= 0) {
      const k = Math.floor(car.d / MS_LEN);
      while (car.msK < k) {
        car.msK++;
        const t = timeAt(car.msK * MS_LEN);
        car.cross[car.msK] = t;
        if (this.firstCross[car.msK] === undefined) this.firstCross[car.msK] = t;
      }
    }

    // Start/Ziel
    if (car.d >= L && Math.floor(car.d / L) > Math.floor(prev / L)) {
      car.lap = Math.floor(car.d / L);
      const tLine = timeAt(car.lap * L);
      const lapTime = tLine - car.lapStart;
      car.lapStart = tLine;
      car.lastLap = lapTime;
      car.tyreAge++;
      car.lapNoise = this.newLapNoise(car);
      if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime;
      if (car.lap >= 2 && (!this.fastest || lapTime < this.fastest.time)) {
        this.fastest = { carId: car.id, time: lapTime, lap: car.lap };
        this.emit('fastest', `Schnellste Runde: ${car.id} ${formatLap(lapTime)}`, { cars: [car.id] });
      }

      onLineCrossed(this, car);
      if (this.phase === 'running' && car.lap >= this.laps) {
        this.phase = 'chequered';
        if (this.neutral) {
          this.neutral = null;
          this.sc = null;
        }
        this.finishCar(car);
        this.emit('chequered', `Zielflagge! ${car.driver.first} ${car.driver.last} gewinnt den ${tr.def.grandPrix}.`, { cars: [car.id] });
      } else if (this.phase === 'chequered') {
        this.finishCar(car);
      } else {
        rollLapIncidents(this, car);
      }
    }
  }

  finishCar(car) {
    car.finished = true;
    car.finishTime = car.lapStart;
    car.finishDist = car.lap * this.track.L;
    car.finishPos = ++this.finishCount;
    car.pass = null;
  }

  finishStop(car) {
    const next = car.plan[car.planIdx];
    const from = COMPOUNDS[car.compound].name;
    if (next) {
      car.compound = next.compound;
      car.planIdx++;
    }
    car.usedCompounds.add(car.compound);
    const cheap = car.cheapStop ? ' – günstiger Stopp unter Neutralisierung' : '';
    car.cheapStop = false;
    car.tyreAge = 0;
    car.stops++;
    car.stopTimer = 0;
    this.emit('pit', `Boxenstopp ${car.id}: ${from} → ${COMPOUNDS[car.compound].name} (${car.lastStopTime.toFixed(1).replace('.', ',')} s)${cheap}`, { cars: [car.id] });
  }

  // ---------- Abfragen ----------

  raceDist(car) {
    return car.finished ? car.finishDist : car.d;
  }

  standings() {
    return [...this.cars].sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      const da = this.raceDist(a), db = this.raceDist(b);
      if (da !== db) return db - da;
      return (a.finishTime ?? 0) - (b.finishTime ?? 0);
    });
  }

  // Abstand von car hinter ref: { laps } oder { time } oder null
  gap(car, ref) {
    if (!ref || car === ref) return null;
    const L = this.track.L;
    const lapsDown = Math.floor((this.raceDist(ref) - this.raceDist(car)) / L);
    if (lapsDown >= 1) return { laps: lapsDown };
    if (car.finished && ref.finished) return { time: car.finishTime - ref.finishTime };
    const k = car.msK;
    if (k < 0 || ref.cross[k] === undefined) return null;
    return { time: car.cross[k] - ref.cross[k] };
  }
}

export function formatLap(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0').replace('.', ',')}`;
}
