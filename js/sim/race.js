// Rennsimulation: Autos, Rundenzeiten, Überholen, Boxenstopps, Zeitnahme.
// Unabhängig von der Darstellung – kann auch ohne Browser laufen (Tests).
import { createRng } from '../util/rng.js';
import { speedAt, wrapD, inRange, crossed, accelAt, sectorIndexAt } from './trackModel.js';
import {
  FLAG_FACTOR, isYellow, rollLapIncidents, checkPendingIncident, endOffTrack,
  updateHazards,
} from './hazards.js';
import {
  rollBattleIncident, onGiveBackDone, rollTrackLimits, rollPitSpeeding, rollUnsafeRelease,
  createYellowPassCase, rollVscDelta, rollPileup, checkPileup, createIgnoredOrderCase,
} from './incidents.js';
import { unservedSecs } from '../control/stewards.js';
import {
  neutralSpeedFactor, passingBanned, moveSafetyCar, afterMove, onLineCrossed, startBehindSC,
  pitDecision, enterPitUnderRed, arriveInQueue, trackNeutralUse,
} from './neutral.js';

export const DT = 0.05;          // Simulationsschritt in Sekunden
const MS_LEN = 100;              // Mini-Sektor-Länge (m) für Abstandsberechnung

import { COMPOUNDS, wetLoss, bestCompound } from './tyres.js';
import { createWeather, updateWeather } from './weather.js';
export { COMPOUNDS };

export class Race {
  constructor({
    track, teams, drivers, seed, weather = 'dry', gridPenalties = {},
    kind = 'race', laps = null, gridOrder = null, durationSec = null,
  }) {
    this.kind = kind;            // race | sprint | fp | quali | sq
    this.gridPenalties = gridPenalties;
    this.gridOrder = gridOrder;  // Startaufstellung aus dem Qualifying (Fahrer-IDs)
    this.track = track;
    this.seed = seed;
    this.rng = createRng(seed);
    this.laps = laps || track.laps;
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
    this.behindSC = new Set();
    this.weather = createWeather(seed, weather, durationSec || this.laps * track.baseLap * 1.05, track.def.rainChance ?? 0.38);
    this.pendingPileup = null;
    this.maxLeaderLap = -1;
    this.cases = [];          // Fälle für die Rennkommissare
    this.caseSeq = 0;
    this.penaltyPoints = {};
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
        damage: null, slowUntil: 0, giveBack: null,
        timePens: [], serve: [], serving: null, tl: 0, warnings: 0, dsq: false,
        gridPos: 0,
      };
    });
    this.carById = Object.fromEntries(this.cars.map(c => [c.id, c]));
    this.carryOver = [];       // Startplatzstrafen für das nächste Rennen
    this.setupGrid();
    for (const [id, places] of Object.entries(gridPenalties)) {
      if (this.carById[id]) this.emit('rc', `${id} startet mit einer Startplatzstrafe von ${places} Plätzen von Platz ${this.carById[id].gridPos}.`, { cars: [id] });
    }
    for (const u of this.unservedGrid || []) {
      const what = u.places > 10 ? 'Durchfahrtsstrafe' : `${u.places > 5 ? 10 : 5}-s-Zeitstrafe`;
      this.emit('rc', `${u.id} kann ${u.places} Startplätze nicht abbauen – dafür ${what} im Rennen.`, { cars: [u.id] });
    }
  }

  // ---------- Vorbereitung ----------

  setupGrid() {
    const r = this.rng;
    let quali = this.cars
      .map(c => ({ c, t: c.basePenalty + r.gauss(0.12) }))
      .sort((a, b) => a.t - b.t);
    // Startaufstellung aus dem Qualifying, falls gefahren
    if (this.gridOrder) {
      const idx = id => { const i = this.gridOrder.indexOf(id); return i < 0 ? 99 : i; };
      quali.sort((a, b) => idx(a.c.id) - idx(b.c.id));
    }
    // Startplatzstrafen anwenden; was nicht abgebaut werden kann, wird zur Zeitstrafe
    const n = quali.length;
    if (Object.keys(this.gridPenalties).length) {
      quali.forEach((q, i) => {
        const p = this.gridPenalties[q.c.id] || 0;
        q.slot = i + p + (p ? 0.5 : 0);
        const unserved = Math.max(0, i + p - (n - 1));
        if (unserved > 0) {
          if (unserved > 10) q.c.serve.push({ type: 'dt', issuedLap: 0, caseId: null });
          else q.c.timePens.push({ secs: unserved > 5 ? 10 : 5, served: false, caseId: null, note: 'Rest-Startplatzstrafe' });
          q.unserved = unserved;
        }
      });
      quali.sort((a, b) => a.slot - b.slot);
      this.unservedGrid = quali.filter(q => q.unserved).map(q => ({ id: q.c.id, places: q.unserved }));
    }
    quali.forEach(({ c }, i) => {
      c.gridPos = i + 1;
      c.d = -(6 + i * 8);
      c.reaction = r.range(0.18, 0.36) + (r.chance(0.08) ? r.range(0.2, 0.5) : 0);
      c.launch = r.range(0.92, 1.06);
      this.planStrategy(c, i);
      // Nasser Start: alle auf Intermediates bzw. Regenreifen
      if (this.weather.wetness > 0.2) {
        c.compound = this.weather.wetness > 0.76 ? 'W' : 'I';
        c.plan = [];
      }
      c.usedCompounds.add(c.compound);
      c.lapNoise = this.newLapNoise(c);
    });
  }

  planStrategy(car, gridIdx) {
    const r = this.rng;
    if (this.kind === 'sprint') {
      // Sprint: kein Pflichtstopp
      car.compound = r.chance(0.3) ? 'S' : 'M';
      car.plan = [];
      return;
    }
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

  // mode: 'standing' (Startampel) oder 'sc' (Start hinter dem Safety Car)
  start(mode = 'standing') {
    if (this.phase !== 'pre') return;
    if (mode === 'sc') {
      this.phase = 'running';
      this.time = 0;
      this.emit('start', 'Start hinter dem Safety Car – das Rennen ist freigegeben.');
      startBehindSC(this);
      return;
    }
    this.phase = 'lights';
    this.emit('info', 'Formationsrunde beendet – Autos in der Startaufstellung.');
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
    const w = this.weather.wetness;
    let deg = car.tyreAge * C.deg * (C.wet && w < 0.3 ? 3 : 1); // Regenreifen überhitzen auf trockener Strecke
    if (car.tyreAge > C.cliff) deg += (car.tyreAge - C.cliff) * 0.22;
    const dmg = car.damage === 'wing' ? 1.2 : 0;
    const wet = wetLoss(car.compound, w) + w * (100 - car.driver.wet) * 0.025;
    return tr.baseLap + car.basePenalty + (C.wet ? 0 : C.offset) + wet + deg + 2.2 * (1 - progress) + car.lapNoise + dmg;
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
          if (car.damage === 'puncture') vt *= 0.55;           // Reifenschaden: langsam zur Box
          if (this.time < car.slowUntil) vt *= 0.7;            // nach Ausritt
          if (car.giveBack) {
            const gb = car.giveBack;
            const victim = this.carById[gb.target];
            if (!victim || victim.retired || victim.finished) {
              car.giveBack = null;
            } else if (this.time > gb.until) {
              car.giveBack = null;
              if (!gb.voluntary) createIgnoredOrderCase(this, car, victim, gb);
            } else if (!gb.ignore) vt *= 0.93;                 // wartet auf den Gegner
          }
          // Überholverbot unter Gelb bzw. bis zur Linie nach einem Neustart
          if (car.pass && !car.pass.slow && !car.pass.violation && (isYellow(flag) || passingBanned(this, car))) car.pass = null;
          if (car.pass && this.time < car.pass.until) vt *= car.pass.blue ? 1.02 : 1.06;
          if (car.defendUntil > this.time) vt *= 0.985;
          vt *= this.programFactor(car);                       // Sessions: Aufwärm-/Auslaufrunde
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
        if (car.pass.giveback && target.giveBack && target.giveBack.target === car.id) {
          onGiveBackDone(this, target, car);
        }
        if (!car.pass.blue) {
          const pos = this.standings().indexOf(car) + 1;
          const zone = car.pass.zone ? ` (${car.pass.zone})` : '';
          this.emit('overtake', `${car.id} überholt ${target.id} – P${pos}${zone}`, { cars: [car.id, target.id], slow: car.pass.slow });
        }
        car.pass = null;
      } else if (this.time >= car.pass.until || target.inPit || target.finished || target.retired || target.offTrack) {
        car.pass = null;
      }
    }

    afterMove(this, DT);
    updateWeather(this, DT);
    // Massenunfall: neue Führungsrunde → würfeln, dann an einer Gruppe auslösen
    if (!this.isSession) {
      const leadLap = Math.max(0, ...this.cars.filter(c => !c.retired).map(c => c.lap));
      if (leadLap > this.maxLeaderLap) { this.maxLeaderLap = leadLap; rollPileup(this, leadLap); }
      checkPileup(this);
    }
    rollVscDelta(this, DT);
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
        if (this.yieldsTo(B, A)) {
          this.startPass(B, A, { slow: true });
          continue;
        }
        if (!banned && A.giveBack && A.giveBack.target === B.id && !A.giveBack.ignore) {
          this.startPass(B, A, { slow: true, giveback: true });
          continue;
        }
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
        if (zone && !banned) {
          const key = `${B.lap}:${zone.corner}`;
          const zoneName = tr.corners.find(c => c.id === zone.corner).name;
          if (!B.tried.has(key)) {
            B.tried.add(key);
            if (underYellow) {
              // seltener Regelverstoß: Überholen trotz gelber Flagge
              if (this.rng.chance(0.04 * B.driver.aggression / 70)) {
                const fB = this.flags[sectorIndexAt(tr, B.d)], fA = this.flags[sectorIndexAt(tr, A.d)];
                this.startPass(B, A, { zone: zoneName, violation: true });
                createYellowPassCase(this, B, A, fB === 'double' || fA === 'double' ? 'double' : 'yellow');
                continue;
              }
            } else {
              const ok = this.rng.chance(this.overtakeChance(B, A, zone));
              if (!this.isSession) rollBattleIncident(this, B, A, zone.corner, ok);
              if (ok && !B.retired && !B.offTrack) {
                this.startPass(B, A, { zone: zoneName });
                continue;
              }
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

  // Teams entscheiden je Runde, ob sie wegen der Bedingungen die Reifen wechseln
  weatherTyreDecision(car) {
    const wx = this.weather;
    if (!wx.showers.length || car.weatherStop || car.finished || car.retired) return;
    const lapsLeft = this.laps - car.lap;
    if (lapsLeft < 2) return;
    const w = wx.wetness;
    const wf = Math.min(1, Math.max(0, w + (wx.rain - w) * 0.6));  // Trend der nächsten Runden
    const loss = id => wetLoss(id, wf) + (COMPOUNDS[id].wet ? 0 : COMPOUNDS[id].offset);
    const best = bestCompound(wf, lapsLeft);
    if (best === car.compound || (!COMPOUNDS[best].wet && !COMPOUNDS[car.compound].wet)) return;
    if (car.tyreCall === undefined) car.tyreCall = 0.8 + this.rng.next() * 2.6;   // wie mutig das Team ist
    if (loss(car.compound) - loss(best) > car.tyreCall) car.weatherStop = best;
  }

  onTrackCars() {
    return this.cars.filter(c => !c.retired && !c.finished && !c.inPit && !c.offTrack && !c.redQueued && c.stopTimer <= 0);
  }

  // Abstand jedes Autos zum physisch Vorausfahrenden (inkl. Safety Car)
  computePhysGap() {
    this.physGap.clear();
    this.behindSC.clear();
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
      if (ahead.isSC) this.behindSC.add(c);
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
    p *= 1 - 0.35 * this.weather.wetness;   // Gischt und wenig Grip bei Nässe
    return Math.max(0.02, Math.min(0.85, p));
  }

  // Hooks für Sessions (Training/Qualifying)
  programFactor() { return 1; }
  yieldsTo() { return false; }
  get isSession() { return false; }

  startPass(B, A, { blue = false, zone = null, slow = false, violation = false, giveback = false }) {
    B.pass = { target: A.id, until: this.time + (blue ? 8 : 6), blue, zone, slow, violation, giveback };
    if (!blue) A.defendUntil = this.time + 4;
  }

  handleCrossings(car, prev) {
    const tr = this.track;
    const L = tr.L;

    // Boxengasse
    if (!car.inPit && this.phase === 'running' && crossed(tr, prev, car.d, tr.pit.entry)) {
      const next = car.plan[car.planIdx];
      let decision = this.isSession ? this.sessionPitDecision(car) : pitDecision(this, car, next);
      if (decision === 'garage') {
        car.inPit = true;
        car.pass = null;
        car.toGarage = true;
        car.stoppedThisVisit = false;
        decision = null;
      }
      const neutralNow = this.neutral && this.neutral.type !== 'red';
      if (decision !== 'red' && car.serve.length && !neutralNow) decision = 'serve';
      else if (decision !== 'red' && car.damage) decision = 'damage';
      else if (decision !== 'red' && car.weatherStop && car.lap < this.laps - 1) decision = 'weather';
      if (decision === 'serve') {
        car.inPit = true;
        car.pass = null;
        car.unlap = null;
        car.serving = car.serve.shift();
        car.stoppedThisVisit = car.serving.type === 'dt'; // Durchfahrt: kein Halt
      } else if (decision === 'weather') {
        car.inPit = true;
        car.pass = null;
        car.unlap = null;
        car.stoppedThisVisit = false;
        car.weatherPit = true;
      } else if (decision === 'damage') {
        car.inPit = true;
        car.pass = null;
        car.unlap = null;
        car.stoppedThisVisit = false;
        car.damageStop = true;
      } else if (decision === 'red') {
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
      if (!car.stoppedThisVisit && car.toGarage && crossed(tr, prev, car.d, tr.pit.box)) {
        this.enterGarage(car);
      } else if (!car.stoppedThisVisit && crossed(tr, prev, car.d, tr.pit.box)) {
        car.stoppedThisVisit = true;
        const crew = car.team.pitCrew;
        let t = 2.0 + (100 - crew) * 0.03 + Math.abs(this.rng.gauss(0.25));
        if (this.rng.chance(0.03)) t += this.rng.range(2.5, 8);
        if (car.damageStop && car.damage === 'wing') t += 6;    // neue Nase
        let penaltyTime = 0;
        if (car.serving && car.serving.type === 'sg') {
          t = 10;                                              // Stop-and-Go: 10 s stehen, keine Arbeit
          car.sgStop = true;
        } else {
          // offene Zeitstrafen werden vor der Arbeit abgesessen
          for (const p of car.timePens) if (!p.served) { p.served = true; penaltyTime += p.secs; }
          if (penaltyTime) this.emit('pit', `${car.id} sitzt beim Stopp ${penaltyTime} s Zeitstrafe ab.`, { cars: [car.id] });
        }
        car.stopTimer = t + penaltyTime;
        car.lastStopTime = t;
        car.v = 0;
      } else if (crossed(tr, prev, car.d, tr.pit.exit)) {
        car.inPit = false;
        car.pitExitTime = this.time;
        if (car.serving && car.serving.type === 'dt') {
          this.emit('rc', `${car.id} hat die Durchfahrtsstrafe abgesessen.`, { cars: [car.id] });
          car.serving = null;
        }
        if (!car.redBound) rollPitSpeeding(this, car);
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
      if (this.isSession) { this.onSessionLap(car, lapTime, prev); return; }
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
        rollTrackLimits(this, car);
        this.weatherTyreDecision(car);
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
    car.stopTimer = 0;
    if (car.sgStop) {
      car.sgStop = false;
      car.serving = null;
      this.emit('rc', `${car.id} hat die Stop-and-Go-Strafe abgesessen.`, { cars: [car.id] });
      return;
    }
    if (car.weatherPit) {
      // Reifenwechsel wegen Wetter
      car.weatherPit = false;
      const from = COMPOUNDS[car.compound].name;
      car.compound = car.weatherStop;
      car.weatherStop = null;
      car.damage = null;
      car.damageStop = false;
      car.tyreAge = 0;
      car.stops++;
      car.usedCompounds.add(car.compound);
      car.plan = [];
      car.planIdx = 0;
      const C = COMPOUNDS[car.compound];
      const left = this.laps - car.lap;
      if (!C.wet && left > C.cliff + 3) car.plan = [{ lap: car.lap + C.cliff - 4, compound: 'H' }];
      this.emit('pit', `Boxenstopp ${car.id}: ${from} → ${C.name} (${car.lastStopTime.toFixed(1).replace('.', ',')} s)`, { cars: [car.id] });
      rollUnsafeRelease(this, car);
      return;
    }
    if (car.damageStop) {
      // Reparatur: geplanten Stopp vorziehen, wenn er ohnehin bald käme
      car.damageStop = false;
      const repaired = car.damage === 'wing' ? 'neue Nase' : 'neue Reifen';
      car.damage = null;
      const nx = car.plan[car.planIdx];
      if (!nx || nx.lap - car.lap > 8) {
        car.tyreAge = 0;
        car.stops++;
        this.emit('pit', `Reparaturstopp ${car.id}: ${repaired} (${car.lastStopTime.toFixed(1).replace('.', ',')} s)`, { cars: [car.id] });
        rollUnsafeRelease(this, car);
        return;
      }
    }
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
    rollUnsafeRelease(this, car);
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
      return this.adjustedFinish(a) - this.adjustedFinish(b);
    });
  }

  // Zielzeit inkl. nicht abgesessener Zeitstrafen
  adjustedFinish(car) {
    return (car.finishTime ?? 0) + unservedSecs(car);
  }

  // Abstand von car hinter ref: { laps } oder { time } oder null
  gap(car, ref) {
    if (!ref || car === ref) return null;
    const L = this.track.L;
    const lapsDown = Math.floor((this.raceDist(ref) - this.raceDist(car)) / L);
    if (lapsDown >= 1) return { laps: lapsDown };
    if (car.finished && ref.finished) return { time: this.adjustedFinish(car) - this.adjustedFinish(ref) };
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
