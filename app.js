const BBOX = {
  west: 73.8,
  south: 29.5,
  east: 76.9,
  north: 32.5
};

const map = L.map("map").setView([30.9, 75.8], 8);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(map);

const firesLayer = L.layerGroup().addTo(map);
const waterLayer = L.layerGroup().addTo(map);
map.createPane("waterPane").style.zIndex = 350;
map.createPane("firePane").style.zIndex = 650;
const fireRenderer = L.canvas({ pane: "firePane" });

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
        interactive: false,
        style: { color: "#8a9ba3", weight: 1, fillOpacity: 0 }
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
    pointToLayer: (feature, latlng) => {
      const frp = parseFloat(feature.properties?.frp) || 1;
      return L.circleMarker(latlng, {
        pane: "firePane",
        renderer: fireRenderer,
        radius: Math.min(2.5 + Math.sqrt(frp) * 0.6, 8),
        color: "#7b1e12",
        weight: 0.5,
        fillColor: frp > 20 ? "#b10026" : frp > 8 ? "#fc4e2a" : "#fd8d3c",
        fillOpacity: 0.55
      });
    },

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
  const response = await fetch("data/waterways.geojson");
  if (!response.ok) throw new Error("Waterway file missing");
  const geo = await response.json();

  waterLayer.clearLayers();
  L.geoJSON(geo, {
    pane: "waterPane",
    style: f => ({
      color: "#3b8fd1",
      weight: f.properties.type === "river" ? 2 : 1,
      opacity: 0.7
    }),
    onEachFeature: (f, layer) => {
      if (f.properties.name) layer.bindTooltip(f.properties.name);
    }
  }).addTo(waterLayer);
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
const aqiLayer = L.layerGroup();

const AQI_CITIES = {
  Amritsar: [31.634, 74.872], Ludhiana: [30.901, 75.857],
  Jalandhar: [31.326, 75.576], Patiala: [30.340, 76.387],
  Bathinda: [30.211, 74.945], Ferozepur: [30.925, 74.613],
  Sangrur: [30.245, 75.844], Pathankot: [32.274, 75.652],
  Hoshiarpur: [31.532, 75.917], Mohali: [30.704, 76.717]
};

function aqiColor(v) {
  return v <= 50 ? "#2e9e5b" : v <= 100 ? "#e0b700" : v <= 150 ? "#f08a24"
       : v <= 200 ? "#d63a2f" : v <= 300 ? "#8e3a9d" : "#6b1a2b";
}

async function loadAqi() {
  const names = Object.keys(AQI_CITIES);
  const lats = names.map(n => AQI_CITIES[n][0]).join(",");
  const lons = names.map(n => AQI_CITIES[n][1]).join(",");
  const url = "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${lats}&longitude=${lons}&current=us_aqi,pm2_5`;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Air quality request failed");
  const data = await response.json();

  aqiLayer.clearLayers();
  data.forEach((d, i) => {
    const aqi = Math.round(d.current.us_aqi);
    L.marker(AQI_CITIES[names[i]], {
      icon: L.divIcon({
        className: "aqi-badge",
        html: `<span style="background:${aqiColor(aqi)}">${aqi}</span>`,
        iconSize: [36, 22]
      })
    }).bindPopup(
      `<b>${names[i]}</b><br>US AQI: ${aqi}<br>PM2.5: ${d.current.pm2_5} µg/m³` +
      `<br><small>Modelled data (Open-Meteo)</small>`
    ).addTo(aqiLayer);
  });
}

document.getElementById("aqi-toggle").addEventListener("change", event => {
  if (event.target.checked) map.addLayer(aqiLayer);
  else map.removeLayer(aqiLayer);
});

async function startMap() {
  const boundaryLoaded = await loadBoundary();

  try {
    await loadWaterways();
  } catch (error) {
    console.warn(error);
  }
  try { await loadAqi(); } catch (error) { console.warn(error); }

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

