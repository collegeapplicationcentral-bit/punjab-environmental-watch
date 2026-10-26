const BBOX = { west: 73.8, south: 29.5, east: 76.9, north: 32.5 };
const HOME_VIEW = { center: [30.9, 75.8], zoom: 8 };

const map = L.map("map").setView(HOME_VIEW.center, HOME_VIEW.zoom);

/* ---------- Basemaps ---------- */
const CARTO_KEY = "cb1_4v43_1_c7cd23befc351136daaafd67"; // optional: paste your free key from carto.com/basemaps/apikey

const esriLight = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  { maxNativeZoom: 16, maxZoom: 19, attribution: "Tiles &copy; Esri" }
);
const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
});
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 18, attribution: "Tiles &copy; Esri" }
);

let baseMaps = { "Light (Esri)": esriLight, "Streets": streets, "Satellite": satellite };
let defaultBase = esriLight;

if (CARTO_KEY) {
  const cartoLight = L.tileLayer(
    `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
    { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }
  );
  baseMaps = { "Light (CARTO)": cartoLight, ...baseMaps };
  defaultBase = cartoLight;
}

defaultBase.addTo(map);
L.control.layers(baseMaps, null, { position: "topright" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

/* ---------- Panes and layers ---------- */
map.createPane("waterPane").style.zIndex = 350;
map.createPane("firePane").style.zIndex = 650;
map.createPane("aqiPane").style.zIndex = 700;
const fireRenderer = L.canvas({ pane: "firePane" });

const firesLayer = L.layerGroup().addTo(map);
const waterLayer = L.layerGroup().addTo(map);
const aqiLayer = L.layerGroup();

/* ---------- Reset-view button and legend ---------- */
const resetControl = L.control({ position: "topleft" });
resetControl.onAdd = () => {
  const a = L.DomUtil.create("a", "leaflet-bar reset-btn");
  a.href = "#";
  a.title = "Reset view";
  a.textContent = "⌂";
  L.DomEvent.on(a, "click", event => {
    L.DomEvent.preventDefault(event);
    map.setView(HOME_VIEW.center, HOME_VIEW.zoom);
  });
  return a;
};
resetControl.addTo(map);

const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML =
    "<b>Fire intensity (FRP)</b><br>" +
    '<i style="background:#fd8d3c"></i> under 8 MW<br>' +
    '<i style="background:#fc4e2a"></i> 8 to 20 MW<br>' +
    '<i style="background:#b10026"></i> over 20 MW<br>' +
    "<small>Dot size grows with intensity</small>";
  L.DomEvent.disableClickPropagation(div);
  return div;
};
legend.addTo(map);

/* ---------- Districts (hover, fire counts, shading) ---------- */
const boundaryUrls = [
  "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/geojson/states/punjab.geojson",
  "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states/punjab.geojson"
];

const districts = []; // { name, layer, geom, count }
const BASE_STYLE = { color: "#8a9ba3", weight: 1, fill: true, fillColor: "#fc4e2a", fillOpacity: 0 };

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inGeometry(pt, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some(poly => inRing(pt, poly[0]) && !poly.slice(1).some(hole => inRing(pt, hole)));
}

function shadeStyle(d, maxCount) {
  const shade = document.getElementById("shade-toggle")?.checked;
  return {
    ...BASE_STYLE,
    fillOpacity: shade && maxCount ? 0.6 * (d.count / maxCount) : 0
  };
}

function updateDistricts(points) {
  districts.forEach(d => (d.count = 0));

  for (const pt of points) {
    for (const d of districts) {
      if (d.layer.getBounds().contains([pt[1], pt[0]]) && inGeometry(pt, d.geom)) {
        d.count++;
        break;
      }
    }
  }

  const maxCount = Math.max(0, ...districts.map(d => d.count));
  districts.forEach(d => {
    d.layer.setStyle(shadeStyle(d, maxCount));
    d.layer.setTooltipContent(`<b>${d.name}</b><br>${d.count} fire detections`);
  });
}

async function loadBoundary() {
  for (const url of boundaryUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Boundary request failed");
      const geojson = await response.json();

      L.geoJSON(geojson, {
        style: BASE_STYLE,
        onEachFeature: (feature, layer) => {
          const name = feature.properties.district || "District";
          districts.push({ name, layer, geom: feature.geometry, count: 0 });
          layer.bindTooltip(`<b>${name}</b>`, { sticky: true });
          layer.on("mouseover", () => layer.setStyle({ weight: 2.5, color: "#176b57" }));
          layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#8a9ba3" }));
        }
      }).addTo(map);

      return true;
    } catch (error) {
      console.warn("Trying the alternate boundary source.", error);
    }
  }
  return false;
}

/* ---------- Fires ---------- */
let fireData = null;

async function loadFires() {
  const response = await fetch(`data/fires.geojson?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load fire-detection data.");

  fireData = await response.json();
  renderFires();

  const generated = fireData.metadata?.generated_at_utc;
  document.getElementById("updated").textContent =
    generated ? `Data generated: ${generated}` : "Data timestamp unavailable";
}

function renderFires() {
  if (!fireData) return;

  const days = Number(document.getElementById("days-select").value);
  const hideLow = document.getElementById("conf-toggle").checked;

  const dates = fireData.features
    .map(f => f.properties?.acq_date)
    .filter(Boolean)
    .sort();
  const latest = new Date(dates[dates.length - 1] + "T00:00:00Z");
  const cutoff = new Date(latest);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

  firesLayer.clearLayers();
  const points = [];

  L.geoJSON(fireData, {
    filter: feature => {
      const p = feature.properties || {};
      if (p.acq_date && new Date(p.acq_date + "T00:00:00Z") < cutoff) return false;
      if (hideLow && p.confidence === "l") return false;
      return true;
    },

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
      points.push(feature.geometry.coordinates);
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
    `Detections: ${points.length.toLocaleString()}`;

  updateDistricts(points);
}

/* ---------- Waterways ---------- */
async function loadWaterways() {
  const response = await fetch("data/waterways.geojson");
  if (!response.ok) throw new Error("Waterway file missing");
  const geo = await response.json();

  waterLayer.clearLayers();
  L.geoJSON(geo, {
    pane: "waterPane",
    style: f => {
      const kind = f.properties.type || f.properties.waterway;
      return { color: "#3b8fd1", weight: kind === "river" ? 2 : 1, opacity: 0.7 };
    },
    onEachFeature: (f, layer) => {
      if (f.properties.name) layer.bindTooltip(f.properties.name, { sticky: true });
    }
  }).addTo(waterLayer);
}

/* ---------- Air quality (modelled) ---------- */
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
      pane: "aqiPane",
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

/* ---------- Controls ---------- */
function bindToggle(id, layer) {
  document.getElementById(id).addEventListener("change", event => {
    if (event.target.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
}
bindToggle("fires-toggle", firesLayer);
bindToggle("water-toggle", waterLayer);
bindToggle("aqi-toggle", aqiLayer);

document.getElementById("days-select").addEventListener("change", renderFires);
document.getElementById("conf-toggle").addEventListener("change", renderFires);
document.getElementById("shade-toggle").addEventListener("change", renderFires);

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

/* ---------- Start ---------- */
async function startMap() {
  const boundaryLoaded = await loadBoundary();

  try { await loadWaterways(); } catch (error) { console.warn(error); }
  try { await loadAqi(); } catch (error) { console.warn(error); }

  try {
    await loadFires();
    document.getElementById("status").textContent =
      boundaryLoaded ? "Map ready" : "Map ready; boundary unavailable";
  } catch (error) {
    document.getElementById("status").textContent = error.message;
  }

  // Reloads the latest published data file, not NASA's API directly.
  setInterval(() => loadFires().catch(error => console.warn(error)), 5 * 60 * 1000);
  setInterval(() => loadAqi().catch(error => console.warn(error)), 30 * 60 * 1000);
}

startMap();