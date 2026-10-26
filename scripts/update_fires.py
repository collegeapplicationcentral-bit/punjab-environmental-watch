
import csv
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BBOX = (73.8, 29.5, 76.9, 32.5)
DAYS = 5
FEEDS = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT",
]
OUTPUT = Path("data/fires.geojson")

session = requests.Session()
session.headers.update({
    "User-Agent": "PunjabEnvironmentalWatch/1.0"
})


def fetch_feed(key, feed):
    west, south, east, north = BBOX
    url = (
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
        f"{key}/{feed}/"
        f"{west},{south},{east},{north}/{DAYS}"
    )

    last_error = None

    for attempt in range(3):
        try:
            response = session.get(url, timeout=40)
            response.raise_for_status()

            body = response.text.strip()

            if (
                not body
                or "latitude" not in body.splitlines()[0].lower()
                or "<html" in body[:500].lower()
            ):
                raise ValueError("Response was not valid FIRMS CSV")

            return list(csv.DictReader(io.StringIO(body)))

        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))

    raise RuntimeError(f"{feed} failed: {last_error}")


def main():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()

    if not key:
        sys.exit("FIRMS_MAP_KEY is missing.")

    rows = None
    chosen_feed = None

    for feed in FEEDS:
        try:
            candidate_rows = fetch_feed(key, feed)
            valid_rows = []

            for row in candidate_rows:
                try:
                    lat = float(row["latitude"])
                    lon = float(row["longitude"])
                except (ValueError, TypeError, KeyError):
                    continue

                west, south, east, north = BBOX

                if west <= lon <= east and south <= lat <= north:
                    valid_rows.append((row, lat, lon))

            rows = valid_rows
            chosen_feed = feed
            break

        except Exception as exc:
            print(f"{feed} failed: {exc}")

    if rows is None:
        # Preserve the last good file if every NASA feed fails.
        sys.exit("All FIRMS feeds failed; existing data was preserved.")

    features = []

    for row, lat, lon in rows:
        properties = {
            "acq_date": row.get("acq_date"),
            "acq_time": row.get("acq_time"),
            "confidence": row.get("confidence"),
            "frp": row.get("frp"),
            "satellite": row.get("satellite"),
            "source": chosen_feed,
        }

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat],
            },
            "properties": {
                k: v for k, v in properties.items()
                if v not in (None, "")
            },
        })

    result = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "NASA FIRMS",
            "feed": chosen_feed,
            "days_requested": DAYS,
            "generated_at_utc": datetime.now(
                timezone.utc
            ).isoformat(timespec="seconds"),
            "detection_count": len(features),
        },
        "features": features,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp_file = OUTPUT.with_suffix(".geojson.tmp")
    temp_file.write_text(
        json.dumps(result, separators=(",", ":")),
        encoding="utf-8",
    )
    temp_file.replace(OUTPUT)

    print(f"Saved {len(features)} detections from {chosen_feed}.")


if __name__ == "__main__":
    main()
