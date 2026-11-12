#!/usr/bin/env python3
"""Teilt scenery.json (aus tools/scenery.html) in js/data/scenery/<id>.js auf.
Aufruf:  python3 tools/split_scenery.py <pfad/zu/scenery.json>"""
import json
import os
import sys

data = json.load(open(sys.argv[1], encoding='utf-8'))
out_dir = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'scenery')
os.makedirs(out_dir, exist_ok=True)
for tid, sc in data.items():
    if not tid.isalnum():
        continue
    with open(os.path.join(out_dir, f'{tid}.js'), 'w', encoding='utf-8') as fh:
        fh.write('// Umgebung für das Intro – erzeugt mit tools/scenery.html aus OpenStreetMap-Daten\n')
        fh.write('// (© OpenStreetMap-Mitwirkende, ODbL). Nicht von Hand bearbeiten.\n')
        fh.write('export default ' + json.dumps(sc, separators=(',', ':')) + ';\n')
    print(f"{tid:12s} {sc['w']}×{sc['h']} Zellen · {len(sc['b'])} Gebäude · {len(sc['walls'])} Mauern")
