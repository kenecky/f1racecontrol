#!/usr/bin/env python3
"""Erzeugt die Umgebung der Strecken für die Intros (js/data/scenery/<id>.js) aus OpenStreetMap.

Aufruf:  python3 tools/gen_scenery.py <pfad/zu/f1-circuits.geojson> <cache-ordner> [strecken-ids …]

Holt per Overpass-API Gewässer, Küstenlinie, Wald, Sand/Strand, Stadtflächen, Parks,
Gebäude (mit Höhe) und Stadtmauern rund um jede Strecke und rechnet sie in die
Streckenkoordinaten um (gleiche Projektion wie tools/gen_tracks.py).

Ergebnis je Strecke:
  - Bodenraster (Zellen à CELL m): Klasse je Zelle, zeilenweise lauflängenkodiert
      0 Standardboden (je Klima Gras/Wüste), 1 Wasser, 2 Wald, 3 Sand/Strand/Wüste,
      4 Stadt/Bebauung, 5 Park/Rasen, 6 Parkplatz/Asphalt
  - Gebäude: Grundriss (vereinfacht) + Höhe
  - Mauern (z. B. Altstadtmauer Baku)
Kartendaten: © OpenStreetMap-Mitwirkende, ODbL.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import deque

from PIL import Image, ImageDraw

TRACKS = {
    'albertpark': 'au-1953', 'shanghai': 'cn-2004', 'suzuka': 'jp-1962', 'bahrain': 'bh-2002',
    'jeddah': 'sa-2021', 'miami': 'us-2022', 'montreal': 'ca-1978', 'monaco': 'mc-1929',
    'barcelona': 'es-1991', 'redbullring': 'at-1969', 'silverstone': 'gb-1948', 'spa': 'be-1925',
    'hungaroring': 'hu-1986', 'zandvoort': 'nl-1948', 'monza': 'it-1922', 'madring': 'es-2026',
    'baku': 'az-2016', 'singapore': 'sg-2008', 'cota': 'us-2012', 'mexico': 'mx-1962',
    'interlagos': 'br-1940', 'lasvegas': 'us-2023', 'lusail': 'qa-2004', 'yasmarina': 'ae-2009',
}
MARGIN = 900          # m rund um die Strecke
CELL = 20             # m je Rasterzelle
BUILD_DIST = 520      # Gebäude nur bis zu dieser Entfernung von der Strecke
MAX_BUILD = 1800
OVERPASS = 'https://overpass-api.de/api/interpreter'


def project_fn(coords):
    if coords[0] == coords[-1]:
        coords = coords[:-1]
    lat0 = sum(p[1] for p in coords) / len(coords)
    lon0 = sum(p[0] for p in coords) / len(coords)
    k = math.cos(math.radians(lat0))
    fwd = lambda lon, lat: ((lon - lon0) * 111320 * k, -(lat - lat0) * 110540)
    inv = lambda x, y: (x / (111320 * k) + lon0, -y / 110540 + lat0)
    return fwd, inv, [fwd(lo, la) for lo, la in coords]


def query(bbox):
    s, w, n, e = bbox
    b = f'({s:.6f},{w:.6f},{n:.6f},{e:.6f})'
    q = f"""[out:json][timeout:180];
(
  way["natural"~"^(water|wood|sand|beach|scrub|bare_rock|heath|grassland|wetland|desert|coastline)$"]{b};
  relation["natural"~"^(water|wood|sand|beach|wetland)$"]{b};
  way["landuse"~"^(forest|grass|meadow|residential|commercial|industrial|retail|reservoir|basin|recreation_ground|construction|railway|brownfield|village_green|orchard|vineyard|farmland)$"]{b};
  relation["landuse"~"^(forest|residential|commercial|industrial|retail|reservoir)$"]{b};
  way["leisure"~"^(park|golf_course|pitch|marina|stadium|garden)$"]{b};
  way["waterway"="riverbank"]{b};
  way["water"]{b};
  relation["water"]{b};
  way["amenity"="parking"]{b};
  way["barrier"="city_wall"]{b};
  way["man_made"~"^(pier|breakwater)$"]{b};
  way["building"]{b};
);
out geom;"""
    data = urllib.parse.urlencode({'data': q}).encode()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(OVERPASS, data=data, headers={'User-Agent': 'race-control-scenery/1.0'}), timeout=240) as r:
                return json.load(r)
        except Exception as ex:  # Overpass ist manchmal überlastet
            print('  Overpass-Fehler', ex, '– neuer Versuch')
            time.sleep(10 * (attempt + 1))
    raise RuntimeError('Overpass nicht erreichbar')


def classify(tags):
    nat, lu, le = tags.get('natural'), tags.get('landuse'), tags.get('leisure')
    if nat == 'water' or 'water' in tags or lu in ('reservoir', 'basin') or tags.get('waterway') == 'riverbank' or le == 'marina':
        return 1
    if nat in ('wood',) or lu in ('forest', 'orchard'):
        return 2
    if nat in ('sand', 'beach', 'bare_rock', 'desert'):
        return 3
    if lu in ('residential', 'commercial', 'industrial', 'retail', 'construction', 'railway', 'brownfield'):
        return 4
    if le in ('park', 'golf_course', 'pitch', 'garden', 'stadium') or lu in ('grass', 'meadow', 'recreation_ground', 'village_green', 'vineyard', 'farmland') or nat in ('grassland', 'heath', 'scrub', 'wetland'):
        return 5
    if tags.get('amenity') == 'parking':
        return 6
    return None


def height_of(tags):
    for k in ('height', 'building:height'):
        v = tags.get(k)
        if v:
            try:
                return max(3.0, min(320.0, float(v.replace('m', '').strip().split(';')[0])))
            except ValueError:
                pass
    lv = tags.get('building:levels')
    if lv:
        try:
            return max(3.0, min(320.0, float(lv.split(';')[0]) * 3.2 + 1))
        except ValueError:
            pass
    return None


def simplify(pts, tol):
    if len(pts) < 4:
        return pts
    def rdp(a, b):
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, idx = 0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            return rdp(a, idx)[:-1] + rdp(idx, b)
        return [pts[a], pts[b]]
    return rdp(0, len(pts) - 1)


def build(tid, feat, cache):
    fwd, inv, tpts = project_fn(feat['geometry']['coordinates'])
    xs = [p[0] for p in tpts]; ys = [p[1] for p in tpts]
    x0, x1 = min(xs) - MARGIN, max(xs) + MARGIN
    y0, y1 = min(ys) - MARGIN, max(ys) + MARGIN
    lo0, la1 = inv(x0, y0); lo1, la0 = inv(x1, y1)
    cf = os.path.join(cache, f'{tid}.json')
    if os.path.exists(cf):
        data = json.load(open(cf, encoding='utf-8'))
    else:
        print(' lade OSM …')
        data = query((la0, lo0, la1, lo1))
        json.dump(data, open(cf, 'w', encoding='utf-8'))
    W, H = int(math.ceil((x1 - x0) / CELL)), int(math.ceil((y1 - y0) / CELL))
    img = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(img)
    to_px = lambda x, y: ((x - x0) / CELL, (y - y0) / CELL)

    def geom(el):
        if el['type'] == 'way':
            return [[fwd(p['lon'], p['lat']) for p in el.get('geometry', [])]]
        out = []
        for m in el.get('members', []):
            if m.get('role', 'outer') == 'outer' and m.get('geometry'):
                out.append([fwd(p['lon'], p['lat']) for p in m['geometry']])
        return out

    # Flächen in sinnvoller Reihenfolge übereinander malen (Wasser zuletzt)
    areas = {c: [] for c in range(1, 7)}
    coast, buildings, walls = [], [], []
    for el in data.get('elements', []):
        tags = el.get('tags', {})
        if tags.get('natural') == 'coastline':
            for g in geom(el):
                coast.append(g)
            continue
        if tags.get('barrier') == 'city_wall':
            for g in geom(el):
                walls.append(g)
            continue
        if tags.get('man_made') in ('pier', 'breakwater'):
            for g in geom(el):
                walls.append(g + [None])   # Mole: flach
            continue
        if 'building' in tags:
            for g in geom(el):
                if len(g) >= 4:
                    buildings.append((g, height_of(tags), tags))
            continue
        c = classify(tags)
        if c:
            for g in geom(el):
                if len(g) >= 3:
                    areas[c].append(g)
    for c in (4, 5, 6, 2, 3, 1):
        for g in areas[c]:
            dr.polygon([to_px(x, y) for x, y in g], fill=c)

    # Meer aus der Küstenlinie: Land liegt links, Wasser rechts der Linienrichtung
    if coast:
        barrier = Image.new('L', (W, H), 0)
        bd = ImageDraw.Draw(barrier)
        seeds_w, seeds_l = [], []
        for g in coast:
            pts = [to_px(x, y) for x, y in g]
            bd.line(pts, fill=1, width=2)
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay
                L = math.hypot(dx, dy) or 1
                mx, my = (ax + bx) / 2, (ay + by) / 2
                # rechts der Richtung (Bild: y nach unten) = (−dy, dx)
                seeds_w.append((int(mx - dy / L * 2.5), int(my + dx / L * 2.5)))
                seeds_l.append((int(mx + dy / L * 2.5), int(my - dx / L * 2.5)))
        B = barrier.load()
        lab = [[0] * W for _ in range(H)]
        def flood(seeds, val):
            dq = deque()
            for sx, sy in seeds:
                if 0 <= sx < W and 0 <= sy < H and not B[sx, sy] and not lab[sy][sx]:
                    lab[sy][sx] = val; dq.append((sx, sy))
            while dq:
                x, y = dq.popleft()
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H and not B[nx, ny] and not lab[ny][nx]:
                        lab[ny][nx] = val; dq.append((nx, ny))
        flood(seeds_l, 2)
        flood(seeds_w, 1)
        P = img.load()
        for y in range(H):
            for x in range(W):
                if lab[y][x] == 1 and P[x, y] not in (6,):
                    P[x, y] = 1
                elif B[x, y]:
                    P[x, y] = 3 if P[x, y] == 0 else P[x, y]   # Küstensaum

    # Strecke selbst nie Wasser (z. B. Uferstraßen)
    P = img.load()
    for x, y in tpts:
        cx, cy = int((x - x0) / CELL), int((y - y0) / CELL)
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                if 0 <= cx + a < W and 0 <= cy + b < H and P[cx + a, cy + b] == 1:
                    P[cx + a, cy + b] = 0

    # Lauflängen je Zeile: [Klasse, Länge, Klasse, Länge, …]
    rows = []
    for y in range(H):
        r, cur, n = [], None, 0
        for x in range(W):
            v = P[x, y]
            if v == cur:
                n += 1
            else:
                if cur is not None:
                    r += [cur, n]
                cur, n = v, 1
        r += [cur, n]
        rows.append(r)

    # Gebäude nahe der Strecke
    G = 40
    near = {}
    for x, y in tpts:
        near[(int(x // G), int(y // G))] = True
    R = int(BUILD_DIST // G) + 1
    def dist_ok(x, y):
        gx, gy = int(x // G), int(y // G)
        for a in range(-R, R + 1):
            for b in range(-R, R + 1):
                if (gx + a, gy + b) in near:
                    return True
        return False
    blist = []
    for g, h, tags in buildings:
        cx = sum(p[0] for p in g) / len(g); cy = sum(p[1] for p in g) / len(g)
        if not dist_ok(cx, cy):
            continue
        area = 0.0
        for (ax, ay), (bx, by) in zip(g, g[1:] + g[:1]):
            area += ax * by - bx * ay
        area = abs(area) / 2
        if area < 25:
            continue
        hh = h or (min(14.0, 4 + math.sqrt(area) * 0.25))
        sp = simplify(g[:-1] if g[0] == g[-1] else g, 1.5)
        if len(sp) < 3:
            continue
        blist.append((area * (1 + hh / 20), round(hh, 1), sp, tags.get('name', '')))
    blist.sort(key=lambda b: -b[0])
    blist = blist[:MAX_BUILD]
    bout = [[b[1]] + [round(v) for p in b[2] for v in p] for b in blist]
    wout = []
    for g in walls:
        flat = g[-1] is None
        g = [p for p in g if p is not None]
        if len(g) >= 2 and any(dist_ok(x, y) for x, y in g[:: max(1, len(g) // 6)]):
            wout.append([0 if flat else 1] + [round(v) for p in simplify(g, 1.5) for v in p])
    return {'cell': CELL, 'x0': round(x0), 'y0': round(y0), 'w': W, 'h': H, 'rows': rows, 'b': bout, 'walls': wout}


def main():
    geo = json.load(open(sys.argv[1], encoding='utf-8'))
    cache = sys.argv[2]
    os.makedirs(cache, exist_ok=True)
    feats = {f['properties']['id']: f for f in geo['features']}
    ids = sys.argv[3:] or list(TRACKS)
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'scenery')
    os.makedirs(out_dir, exist_ok=True)
    for tid in ids:
        print(tid)
        sc = build(tid, feats[TRACKS[tid]], cache)
        with open(os.path.join(out_dir, f'{tid}.js'), 'w', encoding='utf-8') as fh:
            fh.write('// Umgebung für das Intro – erzeugt mit tools/gen_scenery.py aus OpenStreetMap-Daten\n')
            fh.write('// (© OpenStreetMap-Mitwirkende, ODbL). Nicht von Hand bearbeiten.\n')
            fh.write('export default ' + json.dumps(sc, separators=(',', ':')) + ';\n')
        print(f"  Raster {sc['w']}×{sc['h']} · Gebäude {len(sc['b'])} · Mauern {len(sc['walls'])}")


if __name__ == '__main__':
    main()
