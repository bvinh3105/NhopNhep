#!/usr/bin/env python3
"""Inline data/poi.json into index.html so it ships as part of the HTML.

Necessary because Netlify's current publish config only serves index.html —
no sibling files or subdirectories are exposed. Embedding poi.json inside
a <script id="poi-data" type="application/json"> tag makes the data
travel with the HTML and load without a separate fetch.

Idempotent: replaces content of the tag if the block already exists,
or inserts a new one just before </body>.
"""

import json
import io
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
INDEX = ROOT / 'index.html'
POI = ROOT / 'data' / 'poi.json'

MARK_BEGIN = '<!-- POI_INLINE_BEGIN -->'
MARK_END   = '<!-- POI_INLINE_END -->'

def main():
    with open(POI, 'rb') as f:
        poi_bytes = f.read()
    # Validate JSON
    data = json.loads(poi_bytes.decode('utf-8'))
    n = len(data.get('r', []))

    html = INDEX.read_text(encoding='utf-8')

    # Build the tag block. type="application/json" so browser doesn't try to
    # parse it as JS; content escapes </script only.
    payload = poi_bytes.decode('utf-8').replace('</', '<\\/')
    block = f'{MARK_BEGIN}\n<script id="poi-data" type="application/json">{payload}</script>\n{MARK_END}'

    if MARK_BEGIN in html and MARK_END in html:
        # Replace existing block
        pat = re.compile(re.escape(MARK_BEGIN) + r'.*?' + re.escape(MARK_END), re.DOTALL)
        html = pat.sub(block, html)
    else:
        # Insert just before </body>
        html = html.replace('</body>', block + '\n</body>')

    INDEX.write_text(html, encoding='utf-8', newline='\n')

    size = INDEX.stat().st_size
    print(f'Embedded {n} POIs · index.html now {size/1024:.1f} KB')

if __name__ == '__main__':
    main()
