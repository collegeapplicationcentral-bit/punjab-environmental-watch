
const BBOX = {
  west: 73.8,
  south: 29.5,
  east: 76.9,
  north: 32.5
};

const map = L.map("map").setView([30.9, 75.8], 8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const firesLayer = L.layerGroup().addTo(map);
const waterLayer = L.layerGroup().addTo(map);

const boundaryUrls = [
  "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/geojson/states/punjab.geojson",
  "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states/punjab.geojson"
];

async function loadBoundary() {
  for (const url of boundaryUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Boundary request failed");

      const geojson = await response.json();

      L.geoJSON(geojson, {
        style: {
          color: "#176b57",
          weight: 3,
          fillColor: "#77c7a7",
          fillOpacity: 0.08
        }
      }).addTo(map);

      return true;
    } catch (error) {
      console.warn("Trying the alternate boundary source.", error);
    }
  }

  return false;
}

async function loadFires() {
  const response = await fetch(
    `data/fires.geojson?t=${Date.now()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Could not load fire-detection data.");
  }

  const geo = await response.json();

  firesLayer.clearLayers();

  let count = 0;

  L.geoJSON(geo, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        color: "#7b1e12",
        weight: 1,
        fillColor: "#ef553b",
        fillOpacity: 0.82
      }),

    onEachFeature: (feature, layer) => {
      count++;

      const p = feature.properties || {};

      layer.bindPopup(
        `<b>NASA FIRMS thermal anomaly</b><br>` +
        `Date: ${p.acq_date || "Unknown"}<br>` +
        `Time: ${p.acq_time || "Unknown"} UTC<br>` +
        `Confidence: ${p.confidence ?? "Not supplied"}<br>` +
        `Fire radiative power: ${p.frp ?? "Not supplied"}<br>` +
        `Feed: ${p.source || p.satellite || "NASA FIRMS"}`
      );
    }
  }).addTo(firesLayer);

  document.getElementById("count").textContent =
    `Detections: ${count.toLocaleString()}`;

  const generated = geo.metadata?.generated_at_utc;

  document.getElementById("updated").textContent =
    generated ? `Data generated: ${generated}` : "Data timestamp unavailable";
}

async function loadWaterways() {
  const query =
    `[out:json][timeout:25];` +
    `(way["waterway"~"^(river|canal)$"]` +
    `(${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});` +
    `);out geom;`;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query })
      });

      if (!response.ok) throw new Error("Waterway request failed");

      const data = await response.json();
      waterLayer.clearLayers();

      for (const element of data.elements || []) {
        if (!element.geometry) continue;

        const points = element.geometry.map(
          point => [point.lat, point.lon]
        );

        const line = L.polyline(points, {
          color: "#238acb",
          weight: 2,
          opacity: 0.8
        });

        if (element.tags?.name) {
          line.bindTooltip(element.tags.name);
        }

        line.addTo(waterLayer);
      }

      return;
    } catch (error) {
      console.warn("Trying another waterway endpoint.", error);
    }
  }

  console.warn("Waterways could not be loaded.");
}

document.getElementById("fires-toggle").addEventListener("change", event => {
  if (event.target.checked) map.addLayer(firesLayer);
  else map.removeLayer(firesLayer);
});

document.getElementById("water-toggle").addEventListener("change", event => {
  if (event.target.checked) map.addLayer(waterLayer);
  else map.removeLayer(waterLayer);
});

document.getElementById("refresh-button").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await loadFires();
    document.getElementById("status").textContent = "Detections refreshed";
  } catch (error) {
    document.getElementById("status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function startMap() {
  const boundaryLoaded = await loadBoundary();

  try {
    await loadWaterways();
  } catch (error) {
    console.warn(error);
  }

  try {
    await loadFires();
    document.getElementById("status").textContent =
      boundaryLoaded ? "Map ready" : "Map ready; boundary unavailable";
  } catch (error) {
    document.getElementById("status").textContent = error.message;
  }

  // This reloads the latest published data file, not NASA's API directly.
  setInterval(() => {
    loadFires().catch(error => console.warn(error));
  }, 5 * 60 * 1000);
}

startMap();
