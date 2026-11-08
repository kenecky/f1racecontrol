#!/usr/bin/env python3
"""Erzeugt Streckendateien (js/data/tracks/<id>.js) aus den Mittellinien von
bacinger/f1-circuits (MIT-Lizenz).

Aufruf:  python3 tools/gen_tracks.py <pfad/zu/f1-circuits.geojson>

Kurven, Überholzonen, Sektoren, Boxengasse und Auslaufzonen werden automatisch
abgeleitet. Die Ergebnisse sind Näherungen und können pro Strecke von Hand
verfeinert werden (Red Bull Ring ist bereits handgepflegt und wird übersprungen).
"""
import json
import math
import os
import sys

# Kalender 2026: id, Datensatz, Name, GP, Land, Runden, Länge (m), Basisrunde (s), Stadtkurs, Regenwahrscheinlichkeit
CALENDAR = [
    ('albertpark',  'au-1953', 'Albert Park',             'Großer Preis von Australien',      'Australien',        58, 5278, 78.0,  False, 0.30),
    ('shanghai',    'cn-2004', 'Shanghai International',  'Großer Preis von China',          'China',             56, 5451, 93.0,  False, 0.30),
    ('suzuka',      'jp-1962', 'Suzuka',                  'Großer Preis von Japan',           'Japan',             53, 5807, 89.5,  False, 0.40),
    ('bahrain',     'bh-2002', 'Bahrain International',   'Großer Preis von Bahrain',         'Bahrain',           57, 5412, 92.0,  False, 0.03),
    ('jeddah',      'sa-2021', 'Jeddah Corniche',         'Großer Preis von Saudi-Arabien',   'Saudi-Arabien',     50, 6174, 90.0,  True,  0.03),
    ('miami',       'us-2022', 'Miami International',     'Großer Preis von Miami',           'USA',               57, 5412, 88.7,  False, 0.30),
    ('montreal',    'ca-1978', 'Circuit Gilles-Villeneuve', 'Großer Preis von Kanada',        'Kanada',            70, 4361, 73.4,  False, 0.38),
    ('monaco',      'mc-1929', 'Circuit de Monaco',       'Großer Preis von Monaco',          'Monaco',            78, 3337, 72.3,  True,  0.25),
    ('barcelona',   'es-1991', 'Barcelona-Catalunya',     'Großer Preis von Barcelona-Katalonien', 'Spanien',      66, 4657, 74.0,  False, 0.15),
    # 'redbullring' (at-1969) ist handgepflegt
    ('silverstone', 'gb-1948', 'Silverstone',             'Großer Preis von Großbritannien',  'Großbritannien',    52, 5891, 87.3,  False, 0.48),
    ('spa',         'be-1925', 'Spa-Francorchamps',       'Großer Preis von Belgien',         'Belgien',           44, 7004, 103.0, False, 0.55),
    ('hungaroring', 'hu-1986', 'Hungaroring',             'Großer Preis von Ungarn',          'Ungarn',            70, 4381, 78.0,  False, 0.28),
    ('zandvoort',   'nl-1948', 'Zandvoort',               'Großer Preis der Niederlande',     'Niederlande',       72, 4259, 71.2,  False, 0.42),
    ('monza',       'it-1922', 'Monza',                   'Großer Preis von Italien',         'Italien',           53, 5793, 81.3,  False, 0.25),
    ('madring',     'es-2026', 'Madring',                 'Großer Preis von Spanien',         'Spanien',           57, 5474, 88.0,  True,  0.12),
    ('baku',        'az-2016', 'Baku City Circuit',       'Großer Preis von Aserbaidschan',   'Aserbaidschan',     51, 6003, 103.6, True,  0.10),
    ('singapore',   'sg-2008', 'Marina Bay',              'Großer Preis von Singapur',        'Singapur',          62, 4927, 92.0,  True,  0.35),
    ('cota',        'us-2012', 'Circuit of the Americas', 'Großer Preis der USA',             'USA',               56, 5513, 95.0,  False, 0.20),
    ('mexico',      'mx-1962', 'Hermanos Rodríguez',      'Großer Preis von Mexiko',          'Mexiko',            71, 4304, 78.1,  False, 0.15),
    ('interlagos',  'br-1940', 'Interlagos',              'Großer Preis von São Paulo',       'Brasilien',         71, 4309, 72.5,  False, 0.50),
    ('lasvegas',    'us-2023', 'Las Vegas Strip',         'Großer Preis von Las Vegas',       'USA',               50, 6201, 94.8,  True,  0.03),
    ('lusail',      'qa-2004', 'Lusail',                  'Großer Preis von Katar',           'Katar',             57, 5419, 82.5,  False, 0.03),
    ('yasmarina',   'ae-2009', 'Yas Marina',              'Großer Preis von Abu Dhabi',       'Vereinigte Arabische Emirate', 58, 5281, 84.7, False, 0.03),
]
REVERSE = {'sg-2008'}  # Datensatz liegt gegen die Fahrtrichtung vor
STEP = 5.0


def project(coords):
    if coords[0] == coords[-1]:
        coords = coords[:-1]
    lat0 = sum(p[1] for p in coords) / len(coords)
    lon0 = sum(p[0] for p in coords) / len(coords)
    k = math.cos(math.radians(lat0))
    return [((lon - lon0) * 111320 * k, -(lat - lat0) * 110540) for lon, lat in coords]


def resample(pts, step):
    closed = pts + [pts[0]]
    out, carry = [pts[0]], 0.0
    for a, b in zip(closed, closed[1:]):
        seg = math.dist(a, b)
        t = step - carry
        while t <= seg:
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
            t += step
        carry = seg - (t - step)
    return out[:-1] if math.dist(out[-1], out[0]) < step / 2 else out


def wrap_angle(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def analyse(pts):
    n = len(pts)
    head = [math.atan2(pts[(i + 1) % n][1] - pts[i][1], pts[(i + 1) % n][0] - pts[i][0]) for i in range(n)]
    dth = [wrap_angle(head[i] - head[i - 1]) for i in range(n)]
    W = 4
    curv = [sum(dth[(i + j) % n] for j in range(-W, W + 1)) / ((2 * W + 1) * STEP) for i in range(n)]
    # Kurvenbereiche: |Krümmung| > 1/260 m
    kmin = 1 / 260
    regions, i = [], 0
    inside = [abs(c) > kmin for c in curv]
    start = next((j for j in range(n) if not inside[j]), 0)
    j = start
    visited = 0
    while visited < n:
        idx = j % n
        if inside[idx]:
            sign = 1 if curv[idx] > 0 else -1
            r_start = j
            while inside[j % n] and (1 if curv[j % n] > 0 else -1) == sign and j - r_start < n:
                j += 1
            regions.append((r_start, j - 1, sign))
            visited += j - r_start
        else:
            j += 1
            visited += 1
    corners = []
    for a, b, sign in regions:
        idxs = [k % n for k in range(a, b + 1)]
        angle = sum(dth[k] for k in idxs)
        if abs(math.degrees(angle)) < 22:
            continue
        apex = max(idxs, key=lambda k: abs(curv[k]))
        radius = 1 / max(abs(curv[apex]), 1e-4)
        corners.append({'a': a, 'b': b, 'apex': apex, 'sign': sign, 'angle': math.degrees(angle), 'R': radius})
    # nahe gleichgerichtete Kurven zusammenfassen
    merged = []
    for c in sorted(corners, key=lambda c: c['apex']):
        if merged and c['sign'] == merged[-1]['sign'] and (c['a'] - merged[-1]['b']) * STEP < 45:
            m = merged[-1]
            m['b'] = c['b']
            m['angle'] += c['angle']
            if c['R'] < m['R']:
                m['apex'], m['R'] = c['apex'], c['R']
        else:
            merged.append(dict(c))
    return merged, n


def js_track(entry, feat):
    tid, geo, name, gp, country, laps, length, base, street, rain = entry
    pts = project(feat['geometry']['coordinates'])
    if geo in REVERSE:
        pts = [pts[0]] + pts[1:][::-1]
    dense = resample(pts, STEP)
    corners, n = analyse(dense)
    L = n * STEP
    scale = length / L

    def d_of(idx):
        return round(idx * STEP * scale)

    cdefs = []
    for i, c in enumerate(corners):
        x, y = dense[c['apex']]
        vmax = max(60, min(320, math.sqrt(30 * c['R']) * 3.6))
        cdefs.append({'id': f'T{i + 1}', 'at': [round(x, 1), round(y, 1)], 'vmax': round(vmax), 'R': c['R'],
                      'd': d_of(c['apex']), 'a': d_of(c['a']), 'b': d_of(c['b'])})

    # Überholzonen: die drei längsten Geraden
    straights = []
    for i, c in enumerate(cdefs):
        prev = cdefs[i - 1]
        gap = (c['a'] - prev['b']) % length
        straights.append((gap, c))
    straights.sort(key=lambda s: -s[0])
    zones = []
    for rank, (gap, c) in enumerate(straights[:3]):
        if gap < 280:
            continue
        zones.append({'corner': c['id'], 'before': round(min(460, gap * 0.8)), 'after': 20, 'factor': [1.0, 0.8, 0.65][rank]})

    # Auslaufzonen nach Kurvenradius
    runoffs = []
    for c in cdefs:
        span_a = max(-60, c['a'] - c['d'] - 20)
        span_b = min(160, c['b'] - c['d'] + 70)
        if street:
            if c['R'] < 45:
                runoffs.append({'corner': c['id'], 'from': span_a, 'to': span_b, 'side': 'out', 'type': 'asphalt', 'width': 14})
            continue
        if c['R'] < 40:
            runoffs.append({'corner': c['id'], 'from': span_a, 'to': span_b, 'side': 'out', 'type': 'asphalt', 'width': 34})
            runoffs.append({'corner': c['id'], 'from': span_a + 20, 'to': span_b - 20, 'side': 'out', 'type': 'gravel', 'width': 14, 'offset': 34})
        elif c['R'] < 100:
            runoffs.append({'corner': c['id'], 'from': span_a, 'to': span_b, 'side': 'out', 'type': 'asphalt', 'width': 26})
            runoffs.append({'corner': c['id'], 'from': span_a + 10, 'to': span_b - 10, 'side': 'out', 'type': 'gravel', 'width': 18, 'offset': 26})
        else:
            runoffs.append({'corner': c['id'], 'from': span_a, 'to': span_b, 'side': 'out', 'type': 'gravel', 'width': 32})

    # Boxengasse
    first, last = cdefs[0], cdefs[-1]
    pit_entry = {'d': (last['d'] + 60) % length} if length - last['d'] < 700 else {'d': length - 350}
    pit_exit = {'d': first['d'] + 100} if first['d'] < 800 else {'d': 400}

    marshal = [{'line': True}] + [{'d': round(length * k / 12)} for k in range(1, 12)]
    timing = [{'d': round(length / 3)}, {'d': round(2 * length / 3)}]
    for c in cdefs:
        for k in ('R', 'a', 'b', 'd'):
            c.pop(k)
    cp = [[round(x, 1), round(y, 1)] for x, y in pts]
    rows = ['    ' + ' '.join(f'[{p[0]}, {p[1]}],' for p in cp[i:i + 5]) for i in range(0, len(cp), 5)]
    corners_js = '\n'.join(f"    {{ id: '{c['id']}', name: '{c['id']}', at: [{c['at'][0]}, {c['at'][1]}], vmax: {c['vmax']} }}," for c in cdefs)
    js = f"""// {name} – automatisch erzeugt mit tools/gen_tracks.py (nicht von Hand bearbeiten,
// sondern Generator oder handgepflegte Kopie verwenden).
// Streckenverlauf: github.com/bacinger/f1-circuits – © 2019-2025 Tomislav Bacinger, MIT-Lizenz.
// Kurven, Zonen, Auslaufzonen und Boxengasse sind automatisch abgeleitete Näherungen.
export default {{
  id: '{tid}',
  name: '{name}',
  grandPrix: '{gp}',
  country: '{country}',
  lengthM: {length},
  laps: {laps},
  baseLap: {base},
  pitLaneSpeed: {60 if tid == 'monaco' else 80},
  pitLaneSide: 1,
  street: {'true' if street else 'false'},
  rainChance: {rain},
  generated: true,
  controlPoints: [
{chr(10).join(rows)}
  ],
  corners: [
{corners_js}
  ],
  overtakeZones: {json.dumps(zones)},
  timingSectors: {json.dumps(timing)},
  marshalSectors: {json.dumps(marshal)},
  runoffs: {json.dumps(runoffs)},
  pit: {{ entry: {json.dumps(pit_entry)}, exit: {json.dumps(pit_exit)}, boxOffsetAfterLine: 120 }},
}};
"""
    return js, len(cdefs), len(zones)


def main():
    src = sys.argv[1]
    data = json.load(open(src, encoding='utf-8'))
    feats = {f['properties']['id']: f for f in data['features']}
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'tracks')
    for entry in CALENDAR:
        js, nc, nz = js_track(entry, feats[entry[1]])
        with open(os.path.join(out_dir, f'{entry[0]}.js'), 'w', encoding='utf-8') as fh:
            fh.write(js)
        print(f'{entry[0]:12s} Kurven {nc:2d}  Überholzonen {nz}')


if __name__ == '__main__':
    main()
