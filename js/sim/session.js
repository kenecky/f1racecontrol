// Training und Qualifying: Autos starten aus der Garage, fahren Aufwärm-, schnelle und
// Auslaufrunden; Session-Uhr (steht bei Rot), Q1–Q3 mit Ausscheiden, Bestzeiten.
import { Race, DT, formatLap } from './race.js';
import { COMPOUNDS, bestCompound } from './tyres.js';
import { rollLapIncidents } from './hazards.js';
import { createLapCase, createImpedingCase } from './incidents.js';
import { sessionDurations } from './length.js';

export const SESSION_INFO = {
  fp:    { name: 'Freies Training',   short: 'FP', segments: [{ id: 'FP', dur: 1200 }] },
  quali: { name: 'Qualifying',        short: 'Q',  segments: [{ id: 'Q1', dur: 600, keep: 16 }, { id: 'Q2', dur: 480, keep: 10 }, { id: 'Q3', dur: 420 }] },
  sq:    { name: 'Sprint-Qualifying', short: 'SQ', segments: [{ id: 'SQ1', dur: 420, keep: 16 }, { id: 'SQ2', dur: 360, keep: 10 }, { id: 'SQ3', dur: 300 }] },
};
export class Session extends Race {
  constructor(opts) {
    // Abschnittsdauern je nach Einstellung „Dauer“
    const base = SESSION_INFO[opts.kind];
    const { segs, brk } = sessionDurations(opts.kind, opts.length || 'full');
    const info = { ...base, brk, segments: base.segments.map((x, i) => ({ ...x, dur: segs[i] ?? x.dur })) };
    const total = info.segments.reduce((s, x) => s + x.dur, 0) + brk * (info.segments.length - 1);
    super({ ...opts, laps: 999, durationSec: total });
    this.info = info;
    this.segIdx = 0;
    this.clock = 0;          // aktive Zeit im Abschnitt (steht bei Rot)
    this.segFlag = false;    // Zielflagge des Abschnitts
    this.segState = 'run';   // run | break
    this.breakLeft = 0;
    this.lapSeq = 0;
    this.sessionBest = null;
  }

  get isSession() { return true; }

  get segment() { return this.info.segments[this.segIdx]; }

  get remaining() { return Math.max(0, this.segment.dur - this.clock); }

  get leaderLap() { return 0; }

  emit(type, text, data = {}) {
    super.emit(type, text, data);
    const e = this.events[this.events.length - 1];
    e.lap = 0;
    if (this.info) e.seg = this.segment.id;
  }

  // ---------- Rote Flagge (Session-Uhr steht, alle in die Garage) ----------

  sessionRedFlag() {
    if (this.phase !== 'running' || this.segState !== 'run' || (this.neutral && this.neutral.type === 'red')) return false;
    this.neutral = { type: 'red', phase: 'stopping', start: this.time, session: true, clearAnnounced: false };
    this.neutralStats.red++;
    for (const c of this.cars) {
      c.pass = null;
      if (!c.inGarage && c.prog.phase !== 'garage') c.prog.phase = 'cool';
    }
    this.emit('rc', `ROTE FLAGGE – ${this.info.name} unterbrochen, die Uhr steht. Alle Autos in die Box.`);
    return true;
  }

  sessionResume() {
    const n = this.neutral;
    if (!n || n.type !== 'red' || n.phase !== 'stopped' || this.hazards.some(h => !h.ended)) return false;
    this.neutral = null;
    for (const c of this.cars) {
      for (let i = c.prog.runIdx; i < c.prog.runs.length; i++) {
        c.prog.runs[i].depart = Math.max(c.prog.runs[i].depart, this.clock + this.rng.range(15, 90));
      }
      // Wer durch Rot einen Versuch verloren hat, bekommt einen neuen (sofern Zeit bleibt)
      if (c.prog.runIdx >= c.prog.runs.length && c.elimSeg === null && !c.retired && this.remaining > 150) {
        c.prog.runs.push({ depart: this.clock + this.rng.range(20, 80), push: 1, compound: 'S', fuel: 0.05 });
      }
    }
    this.emit('rc', `${this.info.name} wird fortgesetzt – noch ${Math.ceil(this.remaining / 60)} Minuten.`);
    return true;
  }

  // ---------- Aufbau: alle Autos in der Garage ----------

  setupGrid() {
    const tr = this.track;
    const span = Math.max(30, Math.min(190, (tr.pit.exit > tr.pit.box ? tr.pit.exit - tr.pit.box : 200) - 30));
    const teams = [...new Set(this.cars.map(c => c.team.id))];
    this.cars.forEach((c, i) => {
      const ti = teams.indexOf(c.team.id);
      c.garageOffset = 3 + (ti * 2 + (i % 2)) * (span / (teams.length * 2));
      c.gridPos = i + 1;
      c.d = tr.pit.box + c.garageOffset;
      c.inPit = true;
      c.inGarage = true;
      c.stopTimer = Infinity;
      c.stoppedThisVisit = true;
      c.launchUntil = -1;
      c.reaction = 0;
      c.compound = 'S';
      c.plan = [];
      c.fuel = 0.2;
      c.sLaps = [];          // gezeitete Runden: { id, seg, time, valid, label }
      c.prog = { runs: [], runIdx: 0, phase: 'garage', pushLeft: 0 };
      c.elimSeg = null;
      c.lapNoise = this.newLapNoise(c);
    });
  }

  start() {
    if (this.phase !== 'pre') return;
    this.phase = 'running';
    this.time = 0;
    this.startSegment(0);
  }

  startSegment(i) {
    this.segIdx = i;
    this.clock = 0;
    this.segFlag = false;
    this.segState = 'run';
    const seg = this.segment;
    this.emit('start', `${this.info.name}${this.info.segments.length > 1 ? ` – ${seg.id}` : ''} beginnt (${Math.round(seg.dur / 60)} Minuten).`);
    const out = Math.round(this.track.baseLap * 1.25 + 25);   // Boxengasse + Aufwärmrunde
    for (const c of this.cars) {
      if (c.retired || c.elimSeg !== null) { c.prog.runs = []; continue; }
      const r = this.rng;
      const lap = this.track.baseLap;
      let runs;
      if (this.kind === 'fp') {
        // Je nach Dauer 1–3 Ausfahrten, die längeren mit mehr Sprit
        const n = seg.dur >= 1000 ? 3 : seg.dur >= 650 ? 2 : 1;
        const slot = seg.dur / n;
        const maxPush = Math.max(1, Math.floor((slot - out - 50) / lap));
        runs = [];
        for (let j = 0; j < n; j++) {
          runs.push({
            depart: j * slot + r.range(0.04, 0.4) * slot,
            push: r.int(Math.min(2, maxPush), Math.min(maxPush, j === 0 ? 6 : 4)),
            compound: j === n - 1 ? 'S' : r.pick(['M', 'H', 'S']),
            fuel: j === n - 1 ? r.range(0.1, 0.4) : r.range(0.3, 0.9),
          });
        }
      } else {
        const last = { depart: Math.max(15, seg.dur - out - lap * r.range(0.15, 0.7)), push: 1, compound: 'S', fuel: 0.05 };
        const cycle = out + lap * 2 + 20;     // Garage → schnelle Runde → zurück
        runs = seg.dur >= 2 * cycle + 60
          ? [{ depart: r.range(20, seg.dur * 0.3), push: r.chance(0.4) ? 2 : 1, compound: 'S', fuel: 0.08 }, last]
          : [{ ...last, depart: r.range(Math.min(20, last.depart), last.depart) }];
      }
      c.prog = { runs, runIdx: 0, phase: c.inGarage ? 'garage' : c.prog.phase, pushLeft: c.prog.pushLeft || 0 };
    }
  }

  // ---------- Simulation ----------

  step() {
    if (this.phase === 'pre' || this.phase === 'finished') return;
    if (this.segState === 'break') {
      // Pause: Autos auf der Auslaufrunde fahren noch in die Box
      this.breakLeft -= DT;
      if (this.cars.some(c => !c.retired && !c.inGarage)) super.step();
      else this.time += DT;
      if (this.breakLeft <= 0) this.startSegment(this.segIdx + 1);
      return;
    }
    const red = this.neutral && this.neutral.type === 'red';
    if (!red) {
      this.clock += DT;
      if (!this.segFlag && this.clock >= this.segment.dur) {
        this.segFlag = true;
        this.emit('chequered', `Zielflagge für ${this.segment.id}. Begonnene Runden dürfen noch beendet werden.`);
        for (const c of this.cars) if (c.prog.phase === 'out') c.prog.phase = 'cool';
      }
      // Abfahrten aus der Garage
      if (!this.segFlag) {
        for (const c of this.cars) {
          const run = c.prog.runs[c.prog.runIdx];
          if (!c.inGarage || c.retired || !run || this.clock < run.depart) continue;
          c.prog.runIdx++;
          c.prog.current = run;
          c.stopTimer = 0.001;   // → leaveGarage über finishStop
        }
      }
    }
    super.step();
    const n = this.neutral;
    if (n && n.type === 'red' && n.phase === 'stopping' && this.cars.every(c => c.retired || c.inGarage)) {
      n.phase = 'stopped';
      this.emit('rc', 'Alle Autos sind in der Box.');
    }
    // Abschnitt endet, wenn die letzte gezeitete Runde beendet ist (Auslaufrunden zählen nicht)
    if (this.segFlag && !n && this.cars.every(c => c.retired || c.inGarage || c.prog.phase !== 'push')) this.endSegment();
  }

  programFactor(car) {
    const ph = car.prog && car.prog.phase;
    if (ph === 'out') return 0.82;
    if (ph === 'cool') return 0.72;
    return 1;
  }

  lapTarget(car) {
    const base = super.lapTarget(car);
    // Rennsprit-Anteil aus der Basis entfernen, Session-Sprit und Streckenentwicklung einrechnen
    const progress = Math.min(1, Math.max(0, car.d / (this.laps * this.track.L)));
    const evolution = -0.5 * Math.min(1, this.time / 2400);
    return base - 2.2 * (1 - progress) + 2.2 * (car.fuel ?? 0.2) + evolution;
  }

  // Autos auf Aufwärm-/Auslaufrunde lassen Autos auf schneller Runde vorbei – meistens
  yieldsTo(B, A) {
    if (!B.prog || !A.prog || B.prog.phase !== 'push' || A.prog.phase === 'push') return false;
    const key = `${A.id}>${B.id}:${B.lap}`;
    this.impedeChecked = this.impedeChecked || {};
    if (!this.impedeChecked[key]) {
      this.impedeChecked[key] = true;
      if (this.kind !== 'fp' && this.rng.chance(0.009 * A.driver.aggression / 70)) {
        const lost = this.rng.range(0.2, 1.2);
        B.slowUntil = this.time + 1.2 + lost;
        B.compromised = true;
        createImpedingCase(this, A, B, lost);
        A.impedeUntil = this.time + 2.5;
        return false;
      }
    }
    return !(A.impedeUntil > this.time);
  }

  sessionPitDecision(car) {
    if (this.neutral && this.neutral.type === 'red') return 'garage';
    if (car.prog.phase === 'cool') return 'garage';
    return null;
  }

  enterGarage(car) {
    car.toGarage = false;
    car.stoppedThisVisit = true;
    car.inGarage = true;
    car.stopTimer = Infinity;
    car.v = 0;
    car.move = 0;
    car.d += Math.max(0, car.garageOffset - 2);
    car.prog.phase = 'garage';
    car.pass = null;
  }

  // Aus der Garage losfahren
  finishStop(car) {
    if (!car.inGarage) { super.finishStop(car); return; }
    const run = car.prog.current || { compound: 'S', push: 1, fuel: 0.1 };
    const w = this.weather.wetness;
    car.compound = w > 0.15 ? bestCompound(w, 20) : run.compound;
    car.fuel = run.fuel;
    car.tyreAge = 0;
    car.inGarage = false;
    car.stopTimer = 0;
    car.stoppedThisVisit = true;
    car.prog.phase = 'out';
    car.prog.pushLeft = run.push;
    car.compromised = false;
  }

  onSessionLap(car, lapTime) {
    const p = car.prog;
    if (p.phase === 'push' && !car.inPit) {
      const rec = {
        id: ++this.lapSeq, seg: this.segIdx, time: lapTime, valid: !car.compromised,
        label: formatLap(lapTime), compromised: Boolean(car.compromised),
      };
      rec.valid = true;
      car.sLaps.push(rec);
      car.compromised = false;
      this.recalcBest(car);
      if (!this.sessionBest || lapTime < this.sessionBest.time) {
        this.sessionBest = { carId: car.id, time: lapTime };
        this.emit('fastest', `Bestzeit: ${car.id} ${formatLap(lapTime)}`, { cars: [car.id] });
      }
      // Track Limits auf der gezeiteten Runde?
      if (this.rng.chance((this.kind === 'fp' ? 0.012 : 0.025) * (car.driver.errors / 28))) {
        createLapCase(this, car, rec, this.rng.pick(this.track.corners).id);
      }
      rollLapIncidents(this, car);
      p.pushLeft--;
      p.phase = p.pushLeft > 0 && !this.segFlag ? 'push' : 'cool';
    } else if (p.phase === 'out') {
      p.phase = this.segFlag ? 'cool' : 'push';
    }
  }

  recalcBest(car) {
    const valid = car.sLaps.filter(l => l.valid);
    car.bestLap = valid.length ? Math.min(...valid.map(l => l.time)) : null;
    car.segBest = {};
    for (const l of valid) if (car.segBest[l.seg] === undefined || l.time < car.segBest[l.seg]) car.segBest[l.seg] = l.time;
  }

  deleteLap(car, lapId) {
    const l = car.sLaps.find(x => x.id === lapId);
    if (!l || !l.valid) return;
    l.valid = false;
    this.recalcBest(car);
    this.emit('rc', `Rundenzeit ${l.label} von ${car.id} gestrichen (Track Limits).`, { cars: [car.id] });
  }

  endSegment() {
    const seg = this.segment;
    const ranked = this.segmentRanking();
    if (seg.keep && this.segIdx < this.info.segments.length - 1) {
      const keep = Math.min(seg.keep, ranked.length);
      const out = ranked.slice(keep);
      out.forEach(c => { if (c.elimSeg === null) c.elimSeg = this.segIdx; });
      this.emit('rc', `Ausgeschieden in ${seg.id}: ${out.map(c => c.id).join(', ')}`);
      this.segState = 'break';
      this.breakLeft = this.info.brk ?? 120;
      const mins = this.breakLeft / 60;
      this.emit('info', `Pause – ${this.info.segments[this.segIdx + 1].id} beginnt in ${mins >= 1 ? `${String(mins).replace('.', ',')} Minuten` : `${this.breakLeft} Sekunden`}.`);
      return;
    }
    this.phase = 'finished';
    const order = this.standings();
    this.emit('finish', `${this.info.name} beendet. ${this.kind === 'fp' ? 'Schnellster' : 'Pole Position'}: ${order[0].driver.first} ${order[0].driver.last}.`);
  }

  // Reihenfolge im laufenden Abschnitt (aktive Autos)
  segmentRanking() {
    const active = this.cars.filter(c => c.elimSeg === null);
    const t = c => (c.segBest && c.segBest[this.segIdx] !== undefined ? c.segBest[this.segIdx] : Infinity);
    return active.sort((a, b) => t(a) - t(b) || a.gridPos - b.gridPos);
  }

  // Gesamtwertung: wer länger dabei war, steht vorne; innerhalb nach Bestzeit im letzten Abschnitt
  standings() {
    if (this.kind === 'fp') {
      return [...this.cars].sort((a, b) => (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity) || a.gridPos - b.gridPos);
    }
    const lastSeg = c => (c.elimSeg === null ? this.segIdx : c.elimSeg);
    const t = c => (c.segBest && c.segBest[lastSeg(c)] !== undefined ? c.segBest[lastSeg(c)] : Infinity);
    return [...this.cars].sort((a, b) => lastSeg(b) - lastSeg(a) || t(a) - t(b) || a.gridPos - b.gridPos);
  }

  // Abstand zur Bestzeit des Vorausliegenden in der Wertung
  gap(car, ref) {
    if (!ref || car === ref) return null;
    const seg = this.kind === 'fp' ? null : (car.elimSeg === null ? this.segIdx : car.elimSeg);
    const tc = seg === null ? car.bestLap : car.segBest && car.segBest[seg];
    const tr = seg === null ? ref.bestLap : ref.segBest && ref.segBest[seg];
    if (tc === undefined || tc === null || tr === undefined || tr === null) return null;
    return { time: tc - tr };
  }

  // Maßgebliche Zeit für die Wertung (im Qualifying: Bestzeit im letzten erreichten Abschnitt)
  rankTime(car) {
    if (this.kind === 'fp') return car.bestLap;
    const seg = car.elimSeg === null ? this.segIdx : car.elimSeg;
    return car.segBest && car.segBest[seg] !== undefined ? car.segBest[seg] : null;
  }

  // Startaufstellung (Fahrer-IDs) aus dem Ergebnis
  resultOrder() {
    return this.standings().map(c => c.id);
  }
}

export { COMPOUNDS };
