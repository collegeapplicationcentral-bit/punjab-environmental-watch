
import csv
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# Punjab bounding box: west, south, east, north
BBOX = (73.8, 29.5, 76.9, 32.5)
DAYS = 5

FEEDS = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT",
]

OUTPUT = Path("data/fires.geojson")
TIMEOUT = 40

def fetch_feed(session, key, feed):
    west, south, east, north = BBOX
    url = (
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
        f"{key}/{feed}/{west},{south},{east},{north}/{DAYS}"
    )

    for attempt in range(3):
        try:
            response = session.get(url, timeout=TIMEOUT)

            if response.status_code in (429, 502, 503, 504):
                if attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue

            response.raise_for_status()
            text = response.text.strip()

            if not text or "<html" in text[:500].lower():
                raise ValueError("FIRMS did not return CSV data")

            reader = csv.DictReader(io.StringIO(text))
            if not reader.fieldnames:
                raise ValueError("FIRMS CSV has no header")

            # Accept only a recognizable CSV containing coordinates.
            columns = {
                name.strip().lower()
                for name in reader.fieldnames
                if name
            }
            if not {"latitude", "longitude"}.issubset(columns):
                raise ValueError("FIRMS CSV lacks latitude/longitude")

            rows = []
            for raw in reader:
                row = {
                    (k.strip().lower() if k else ""): v
                    for k, v in raw.items()
                }

                try:
                    lat = float(row["latitude"])
                    lon = float(row["longitude"])
                except (KeyError, TypeError, ValueError):
                    continue

                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    continue

                # Keep only detections inside our Punjab search area.
                if not (west <= lon <= east and south <= lat <= north):
                    continue

                rows.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat],
                    },
                    "properties": {
                        "acq_date": row.get("acq_date"),
                        "acq_time": row.get("acq_time"),
                        "confidence": row.get("confidence"),
                        "frp": row.get("frp"),
                        "satellite": row.get("satellite"),
                        "instrument": row.get("instrument"),
                        "source": feed,
                    },
                })

            return rows

        except (requests.RequestException, ValueError, csv.Error) as exc:
            if attempt == 2:
                print(f"{feed} failed: {type(exc).__name__}")
            else:
                time.sleep(2 ** (attempt + 1))

    return None


def main():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        sys.exit("Missing FIRMS_MAP_KEY secret.")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "PunjabEnvironmentalWatch/1.0"
    })

    features = None

    for feed in FEEDS:
        print(f"Trying FIRMS feed: {feed}")
        result = fetch_feed(session, key, feed)

        # None means the request failed; [] means a valid empty result.
        if result is not None:
            features = result
            print(f"Feed succeeded: {feed}; detections: {len(result)}")
            break

    if features is None:
        # Do not overwrite the last known data if all feeds fail.
        sys.exit("All FIRMS feeds failed. Existing data was preserved.")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    document = {
        "type": "FeatureCollection",
        "metadata": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "source": "NASA FIRMS",
            "feed": features[0]["properties"]["source"] if features else None,
            "days_requested": DAYS,
            "bbox": list(BBOX),
            "note": (
                "Satellite thermal anomaly detections; "
                "not confirmation of unique fires or air quality."
            ),
        },
        "features": features,
    }

    # Write atomically so a partial file is never published.
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(document, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)

    print(f"Updated {OUTPUT} with {len(features)} detections.")


if __name__ == "__main__":
    main()
