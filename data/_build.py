#!/usr/bin/env python3
"""Build compact POI JSON from OSM raw dumps.

Reads data/_hcmc_raw.json + data/_hn_raw.json (Overpass out center JSON),
writes data/poi.json — a flat array of restaurants ready for the client.

Fields per item: {i, n, la, lo, c, p, d}
  i  = numeric id (offset by region)
  n  = name
  la = lat, lo = lng
  c  = category (0=restaurant, 1=street, 2=snack, 3=cafe)
  p  = price bucket (0=cheap, 1=mid, 2=premium)
  d  = short description (empty string if none)

Client uses short keys to keep the file small.
"""

import json
import io
from pathlib import Path

CAT_IDX = {'restaurant': 0, 'street': 1, 'snack': 2, 'cafe': 3}

def load(path):
    with open(path, 'rb') as f:
        return json.load(io.BytesIO(f.read()))

def map_cat(tags):
    a = (tags.get('amenity') or '').lower()
    s = (tags.get('shop') or '').lower()
    c = (tags.get('cuisine') or '').lower()

    if a == 'cafe' or a == 'bar' or a == 'pub' or s == 'coffee': return 3
    if a in ('ice_cream', 'food_court') or s in ('bakery', 'confectionery', 'pastry', 'beverages'):
        # food_court often street food
        if a == 'food_court': return 1
        return 2
    if a == 'fast_food': return 1
    if a == 'bbq': return 1
    if a == 'restaurant':
        vn = any(k in c for k in ['vietnamese', 'noodle', 'pho', 'bun', 'rice', 'street'])
        return 1 if vn else 0
    if s in ('deli', 'greengrocer', 'dairy'): return 2
    return 0

def guess_price_bucket(tags):
    """0 = cheap (<80k), 1 = mid (80-200k), 2 = premium (>200k)"""
    c = (tags.get('cuisine') or '').lower()
    cat = map_cat(tags)

    if any(k in c for k in ['luxury', 'fine_dining', 'steak', 'sushi', 'japanese', 'french', 'italian', 'western']):
        return 2
    if cat == 2: return 0   # ăn vặt
    if cat == 3: return 0   # cà phê
    if cat == 1: return 0   # vỉa hè
    return 1                # nhà hàng default mid

def build_desc(tags):
    parts = []
    cuisine = tags.get('cuisine')
    if cuisine:
        parts.append(cuisine.replace(';', ', ').replace('_', ' '))
    hours = tags.get('opening_hours')
    if hours and len(hours) < 40:
        parts.append(hours)
    return ' · '.join(parts)[:120]

def parse(raw, id_offset):
    items = []
    seen = set()
    for e in raw.get('elements', []):
        tags = e.get('tags', {})
        name = tags.get('name')
        if not name: continue
        if tags.get('disused:amenity') or tags.get('closed') == 'yes': continue

        lat = e.get('lat') or (e.get('center') or {}).get('lat')
        lon = e.get('lon') or (e.get('center') or {}).get('lon')
        if lat is None or lon is None: continue

        # Dedup on rounded coord + name
        key = f"{name}_{round(lat, 4)}_{round(lon, 4)}"
        if key in seen: continue
        seen.add(key)

        # Type prefix: node=1e13, way=3e13 (both in Number safe int range)
        type_prefix = 10_000_000_000_000 if e['type'] == 'node' else 30_000_000_000_000
        # Add region offset so HCMC and HN can't collide
        item_id = type_prefix + id_offset + e['id']

        items.append({
            'i': item_id,
            'n': name[:60],
            'la': round(lat, 6),
            'lo': round(lon, 6),
            'c': map_cat(tags),
            'p': guess_price_bucket(tags),
            'd': build_desc(tags),
        })
    return items

def main():
    root = Path(__file__).parent
    hcmc = load(root / '_hcmc_raw.json')
    hn = load(root / '_hn_raw.json')

    # Region offsets don't overlap with (region_offset + osm_id) collisions
    hcmc_items = parse(hcmc, id_offset=0)                   # HCMC
    hn_items   = parse(hn,   id_offset=100_000_000_000)     # HN (100 billion offset)

    all_items = hcmc_items + hn_items
    # Global dedup across regions (a chain restaurant near border etc.)
    seen = set()
    unique = []
    for it in all_items:
        key = f"{it['n']}_{round(it['la'], 4)}_{round(it['lo'], 4)}"
        if key in seen: continue
        seen.add(key)
        unique.append(it)

    print(f"HCMC parsed: {len(hcmc_items)}")
    print(f"HN parsed:   {len(hn_items)}")
    print(f"Total unique: {len(unique)}")

    # Category distribution
    cats = {0: 'restaurant', 1: 'street', 2: 'snack', 3: 'cafe'}
    from collections import Counter
    dist = Counter(it['c'] for it in unique)
    for k, v in dist.items():
        print(f"  {cats[k]:12s}: {v}")

    out = {
        'v': 1,
        'gen': '2026-08-24',
        'src': 'OpenStreetMap · Overpass API',
        'note': 'Vietnamese food POIs · HCMC + HN metro',
        'r': unique,
    }
    (root / 'poi.json').write_bytes(
        json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    )
    size = (root / 'poi.json').stat().st_size
    print(f"\nWrote poi.json: {size/1024:.1f} KB")

if __name__ == '__main__':
    main()
