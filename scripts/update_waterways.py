import json
import os
import time
import requests

S, W, N, E = 29.5, 73.8, 32.5, 76.9

HEADERS = {
    "User-Agent": "PunjabEnvironmentalWatch/1.0 (student project; collegeapplicationcentral@gmail.com)",
    "Accept": "application/json, */*",
}

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

CACHE = "scripts/waterway_cache.json"


def tiles(rows=2, cols=3):
    dy = (N - S) / rows
    dx = (E - W) / cols
    for i in range(rows):
        for j in range(cols):
            yield (S + i * dy, W + j * dx, S + (i + 1) * dy, W + (j + 1) * dx)


def fetch_tile(s, w, n, e):
    query = (f'[out:json][timeout:90];'
             f'way["waterway"~"^(river|canal)$"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});'
             f'out geom;')
    for attempt in range(4):
        for url in ENDPOINTS:
            try:
                r = requests.post(url, data={"data": query},
                                  headers=HEADERS, timeout=120)
                r.raise_for_status()
                return r.json().get("elements", [])
            except Exception as exc:
                print(f"   failed: {url.split('/')[2]} - {str(exc)[:70]}")
                time.sleep(5)
        wait = 20 * (attempt + 1)
        print(f"   all servers busy, waiting {wait}s")
        time.sleep(wait)
    return None


cache = {}
if os.path.exists(CACHE):
    with open(CACHE) as f:
        cache = json.load(f)

all_tiles = list(tiles())
for idx, t in enumerate(all_tiles):
    key = str(idx)
    if key in cache:
        print(f"Tile {idx + 1}/{len(all_tiles)}: cached")
        continue
    print(f"Tile {idx + 1}/{len(all_tiles)}: downloading")
    elements = fetch_tile(*t)
    if elements is None:
        raise SystemExit(f"Tile {idx + 1} failed. Run the script again later; "
                         f"finished tiles are saved and will be skipped.")
    cache[key] = elements
    with open(CACHE, "w") as f:
        json.dump(cache, f)
    time.sleep(5)

ways = {}
for elements in cache.values():
    for el in elements:
        if "geometry" in el:
            ways[el["id"]] = el

features = []
for el in ways.values():
    tags = el.get("tags", {})
    features.append({
        "type": "Feature",
        "properties": {"name": tags.get("name", ""), "type": tags.get("waterway", "")},
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(p["lon"], 4), round(p["lat"], 4)] for p in el["geometry"]],
        },
    })

with open("data/waterways.geojson", "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f,
              separators=(",", ":"))

os.remove(CACHE)
print(f"Saved {len(features)} waterway segments")