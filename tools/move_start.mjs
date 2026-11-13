#!/usr/bin/env node
// Verlegt Start/Ziel einer Strecke: node tools/move_start.mjs <id> <neuer Start als d (m) der bisherigen Strecke> [Boxeneinfahrt-d] [Boxenausfahrt-d]
// Kurven werden ab dem neuen Start neu nummeriert, Sektoren neu verteilt, Boxengasse auf die neuen Werte gesetzt.
import fs from 'fs';
const [id, d0s, entryS, exitS] = process.argv.slice(2);
const F = `/home/user/f1racecontrol/js/data/tracks/${id}.js`;
const { default: def } = await import(F);
const { buildTrack, pointAt } = await import('/home/user/f1racecontrol/js/sim/trackModel.js');
const old = buildTrack(def), L = old.L, d0 = +d0s;
const nearestD = (tr, at) => { let b = 0, bd = Infinity; for (let i = 0; i < tr.N; i++) { const q = (tr.xs[i] - at[0]) ** 2 + (tr.ys[i] - at[1]) ** 2; if (q < bd) { bd = q; b = i; } } return b * tr.ds; };
const cp = def.controlPoints;
const cpD = cp.map(p => nearestD(old, p));
let k = cpD.findIndex(d => d > d0);
if (k < 0) k = 0;
const start = pointAt(old, d0).map(v => +v.toFixed(1));
const ncp = [start, ...cp.slice(k), ...cp.slice(0, k)];
const nd = { ...def, controlPoints: ncp };
const tr = buildTrack(nd);
const cs = def.corners.map(c => ({ ...c, d: nearestD(tr, c.at) })).sort((a, b) => a.d - b.d);
const ren = {}; cs.forEach((c, i) => { ren[c.id] = `T${i + 1}`; });
const corners = cs.map((c, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, at: c.at, vmax: c.vmax }));
const shift = d => Math.round(((d - d0) % L + L) % L);
const pit = { entry: { d: entryS ? shift(+entryS) : shift(def.pit.entry.d) }, exit: { d: exitS ? shift(+exitS) : shift(def.pit.exit.d) }, boxOffsetAfterLine: 120 };
let src = fs.readFileSync(F, 'utf8');
const cpTxt = '  controlPoints: [\n' + ncp.map((p, i) => (i % 5 === 0 ? '    ' : ' ') + `[${p[0].toFixed(1)}, ${p[1].toFixed(1)}],` + (i % 5 === 4 || i === ncp.length - 1 ? '\n' : '')).join('') + '  ],';
src = src.replace(/  controlPoints: \[[\s\S]*?\n  \],/, cpTxt);
src = src.replace(/  corners: \[[\s\S]*?\n  \],/, '  corners: [\n' + corners.map(c => `    { id: '${c.id}', name: '${c.name}', at: [${c.at[0]}, ${c.at[1]}], vmax: ${c.vmax} },`).join('\n') + '\n  ],');
src = src.replace(/  overtakeZones: .*\n/, `  overtakeZones: ${JSON.stringify(def.overtakeZones.map(z => ({ ...z, corner: ren[z.corner] })))},\n`);
src = src.replace(/  timingSectors: .*\n/, `  timingSectors: ${JSON.stringify([{ d: Math.round(L / 3) }, { d: Math.round(2 * L / 3) }])},\n`);
src = src.replace(/  marshalSectors: .*\n/, `  marshalSectors: ${JSON.stringify([{ line: true }, ...Array.from({ length: def.marshalSectors.length - 1 }, (_, i) => ({ d: Math.round((i + 1) * L / def.marshalSectors.length) }))])},\n`);
src = src.replace(/  runoffs: .*\n/, `  runoffs: ${JSON.stringify(def.runoffs.map(r => ({ ...r, corner: ren[r.corner] })))},\n`);
src = src.replace(/  pit: .*\n/, `  pit: { entry: ${JSON.stringify(pit.entry)}, exit: ${JSON.stringify(pit.exit)}, boxOffsetAfterLine: 120 },\n`);
fs.writeFileSync(F, src);
console.log(id, 'neuer Start bei', start, '| Kurven', cs.map(c => `${ren[c.id]}(alt ${c.id})@${Math.round(c.d)}`).join(' '), '| Box', JSON.stringify(pit));
