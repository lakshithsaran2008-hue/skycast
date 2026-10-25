/* Skycast v1: weather map + forecast. Data: Open-Meteo (no API key needed). */
const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const REV = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const FALLBACK = { lat: 28.6139, lon: 77.209, name: 'New Delhi, India' };
function getHome() { try { const h = JSON.parse(localStorage.getItem('sc_home')); return h && isFinite(h.lat) && isFinite(h.lon) ? h : null; } catch (e) { return null; } }
function fallbackPlace() { const h = getHome(); return h ? { lat: h.lat, lon: h.lon, name: h.name, src: 'Your saved home' } : { lat: FALLBACK.lat, lon: FALLBACK.lon, name: FALLBACK.name, src: 'Default location' }; }

const $ = (s) => document.querySelector(s);
const state = { lat: null, lon: null, name: '', layer: 'rain', tempUnit: 'C', windUnit: 'kmh', data: null };
let map, pin, searchTimer;

/* ---------- helpers ---------- */
const WMO = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Freezing fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'], 56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 66: ['🌧️', 'Freezing rain'],
  67: ['🌧️', 'Freezing rain'], 71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'],
  77: ['🌨️', 'Snow grains'], 80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'],
  85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Heavy snow showers'], 95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Thunderstorm, heavy hail'],
};
const wmo = (c) => WMO[c] || ['❓', 'Unknown'];
const WIND_F = { kmh: 1, ms: 1 / 3.6, kt: 1 / 1.852, mph: 1 / 1.609344 };
const WIND_L = { kmh: 'km/h', ms: 'm/s', kt: 'kt', mph: 'mph' };
const tConv = (c) => (state.tempUnit === 'F' ? (c * 9) / 5 + 32 : c);
const fmtT = (c) => `${Math.round(tConv(c))}°`;
const fmtW = (k) => `${Math.round(k * WIND_F[state.windUnit])} ${WIND_L[state.windUnit]}`;
const wNum = (k) => Math.round(k * WIND_F[state.windUnit]);
const compass = (d) => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d / 22.5) % 16];

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

function ramp(v, stops) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
      return `rgb(${ca.map((x, j) => Math.round(x + (cb[j] - x) * t)).join(',')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`;
}
const TEMP_STOPS = [[-10, [120, 90, 220]], [0, [80, 160, 255]], [15, [90, 220, 190]], [25, [250, 220, 90]], [35, [255, 140, 60]], [45, [230, 50, 50]]];
const RAIN_STOPS = [[0, [200, 215, 225]], [1, [130, 200, 255]], [5, [60, 140, 255]], [15, [120, 70, 230]], [40, [220, 60, 200]]];
const CLOUD_STOPS = [[0, [255, 230, 150]], [50, [200, 210, 220]], [100, [140, 155, 170]]];
const PRESS_STOPS = [[980, [140, 100, 230]], [1000, [80, 170, 255]], [1013, [120, 220, 190]], [1025, [250, 220, 90]], [1040, [255, 140, 60]]];
const WIND_STOPS = [[0, [180, 220, 235]], [15, [95, 208, 194]], [30, [250, 220, 90]], [50, [255, 140, 60]], [80, [240, 60, 90]]];

/* ---------- map ---------- */
let baseLayer, labelLayer, osmFallback = false, tileErrors = 0;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
const ESRI_ATTR = 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors';
function setBase(dark) {
  document.body.classList.toggle('dark-map', dark);
  document.body.classList.toggle('osm-base', osmFallback);
  if (baseLayer) map.removeLayer(baseLayer);
  if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
  if (osmFallback) {
    baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    return;
  }
  const kind = dark ? 'World_Dark_Gray' : 'World_Light_Gray';
  baseLayer = L.tileLayer(`${ESRI}${kind}_Base/MapServer/tile/{z}/{y}/{x}`, { minZoom: 7, maxZoom: 18, maxNativeZoom: 16, attribution: ESRI_ATTR }).addTo(map);   // zoomed out: clean flat background + our own outlines and English names
  labelLayer = L.tileLayer(`${ESRI}${kind}_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 18, maxNativeZoom: 16, minZoom: 9, pane: 'labels' }).addTo(map);
  baseLayer.on('tileerror', () => {
    if (++tileErrors === 6) { osmFallback = true; setBase(document.body.classList.contains('dark-map')); }
  });
}

function initMap() {
  map = L.map('map', { zoomControl: false, minZoom: 3, worldCopyJump: true }).setView([22.5, 79], 5);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.createPane('labels'); const lp = map.getPane('labels'); lp.style.zIndex = 300; lp.style.pointerEvents = 'none';
  setBase(load('sc_map') !== 'light');
  map.on('click', (e) => setLocation(e.latlng.lat, wrapLon(e.latlng.lng), null, null, 'You tapped this point on the map'));
}
const wrapLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

function loadGrid() { if (typeof WM !== 'undefined') WM.reload(true); }
function drawGrid() { if (typeof WM !== 'undefined') WM.redraw(); }

/* ---------- location ---------- */
function openPanel() { $('#panel').classList.remove('closed'); document.body.classList.add('panel-open'); setTimeout(() => state.data && drawChart(), 260); }
function closePanel() { $('#panel').classList.add('closed'); document.body.classList.remove('panel-open'); }
function showStatus(msg, err) {
  const s = $('#status'); s.textContent = msg; s.hidden = !msg; s.classList.toggle('err', !!err);
}

async function setLocation(lat, lon, name, zoom, source) {
  state.lat = lat; state.lon = lon; state.source = source || '';
  if (pin) pin.setLatLng([lat, lon]);
  else pin = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: true, keyboard: false }).addTo(map);
  if (!pin._wired) { pin._wired = true; pin.bindTooltip('', { permanent: true, direction: 'top', offset: [0, -14], className: 'pin-tip' }); pin.on('click', openPanel); }
  map.setView([lat, lon], zoom || Math.max(map.getZoom(), 8));
  if (state.quiet) state.quiet = false; else openPanel();
  showStatus('Loading forecast…');
  $('#now').hidden = true;
  const namePromise = name ? Promise.resolve(name) : reverseName(lat, lon);
  try {
    const url = `${API}?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&hourly=temperature_2m,precipitation,precipitation_probability' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max' +
      '&forecast_days=16&timezone=auto&wind_speed_unit=kmh';
    for (let tryNo = 0; ; tryNo++) {   // the free weather service is sometimes busy: wait and try again
      try { state.data = await getJSON(url); break; }
      catch (err) { if (tryNo >= 2) throw err; showStatus('Weather service is busy, trying again…'); await new Promise((r) => setTimeout(r, 2000 * (tryNo + 1))); }
    }
    state.name = await namePromise;
    showStatus('');
    render();
    loadSeasonal(lat, lon);
  } catch (e) {
    const why = String((e && e.message) || '');
    showStatus(/429/.test(why)
      ? 'The free weather service has paused requests from your network for a while (too many requests). Please try again in a few minutes, or after 5:30 AM IST if it stays blocked.'
      : 'Could not load the forecast (' + (why || 'no connection') + '). Check your connection and tap the map to try again.', true);
  }
}

async function reverseName(lat, lon) {
  try {
    const r = await getJSON(`${REV}?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const parts = [r.city || r.locality, r.principalSubdivision, r.countryName].filter(Boolean);
    const uniq = parts.filter((x, i) => parts.indexOf(x) === i);
    if (uniq.length) return uniq.join(', ');
  } catch (e) {}
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

function locateMe(initial) {
  if (!navigator.geolocation) {
    showStatus('Your browser cannot share location. Search for a place or tap the map.');
    if (initial) { const f = fallbackPlace(); setLocation(f.lat, f.lon, f.name, 8, f.src); }
    return;
  }
  showStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const km = pos.coords.accuracy / 1000;
      const acc = km >= 1 ? `±${Math.round(km)} km` : `±${Math.round(pos.coords.accuracy)} m`;
      const warn = km > 25 ? '. This is rough. Search for your town or tap the map to correct it' : '';
      setLocation(+pos.coords.latitude.toFixed(4), +pos.coords.longitude.toFixed(4), null, initial ? 7 : 10, `Your device location (${acc})${warn}`);
    },
    () => {
      if (initial) { const f = fallbackPlace(); setLocation(f.lat, f.lon, f.name, 8, f.src); }
      showStatus('Location access is off. Showing ' + fallbackPlace().name + '. Allow location in your browser, or search for a place.', true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

/* ---------- render panel ---------- */
function render() {
  const d = state.data; if (!d) return;
  const c = d.current, [icon, desc] = wmo(c.weather_code);
  $('#now').hidden = false;
  $('#place').textContent = state.name;
  if (pin) pin.setTooltipContent(`${icon} ${fmtT(c.temperature_2m)} · ${fmtW(c.wind_speed_10m)} · ${state.name.split(',')[0]}`);
  $('#place-src').textContent = `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}${state.source ? ' · ' + state.source : ''}`;
  $('#now-icon').textContent = icon;
  $('#now-temp').textContent = fmtT(c.temperature_2m);
  $('#now-desc').textContent = `${desc}. Feels like ${fmtT(c.apparent_temperature)}`;
  const stats = [
    ['Wind', `${fmtW(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}`],
    ['Gusts', fmtW(c.wind_gusts_10m)],
    ['Humidity', `${Math.round(c.relative_humidity_2m)}%`],
    ['Pressure', `${Math.round(c.pressure_msl)} hPa`],
    ['Cloud cover', `${Math.round(c.cloud_cover)}%`],
    ['Rain now', `${c.precipitation.toFixed(1)} mm`],
    ['UV index (today)', d.daily.uv_index_max[0] != null ? d.daily.uv_index_max[0].toFixed(1) : '–'],
    ['Sunrise / sunset', `${d.daily.sunrise[0].slice(11)} / ${d.daily.sunset[0].slice(11)}`],
  ];
  $('#stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  drawChart();
  drawDaily();
  drawSeasonal();
  drawGrid();
}

function drawDaily() {
  const d = state.data.daily;
  const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max), span = hi - lo || 1;
  $('#daily').innerHTML = d.time.map((day, i) => {
    const label = i === 0 ? 'Today' : new Date(day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    const l = ((d.temperature_2m_min[i] - lo) / span) * 100, w = ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100;
    const pop = d.precipitation_probability_max[i];
    return `<li><span>${label}</span><span title="${wmo(d.weather_code[i])[1]}">${wmo(d.weather_code[i])[0]}</span>` +
      `<span class="pop">${pop != null ? pop + '%' : ''}</span>` +
      `<span class="bar"><i style="left:${l}%;width:${Math.max(w, 6)}%"></i></span>` +
      `<span><span class="lo">${fmtT(d.temperature_2m_min[i])}</span> <span class="hi">${fmtT(d.temperature_2m_max[i])}</span></span></li>`;
  }).join('');
}

function drawChart() {
  const d = state.data, cv = $('#chart'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 170;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const nowKey = d.current.time.slice(0, 13);
  let start = d.hourly.time.findIndex((t) => t.slice(0, 13) >= nowKey); if (start < 0) start = 0;
  const N = 48, T = d.hourly.temperature_2m.slice(start, start + N), P = d.hourly.precipitation.slice(start, start + N), times = d.hourly.time.slice(start, start + N);
  const padL = 30, padB = 22, padT = 8, cw = W - padL - 4, ch = H - padB - padT;
  const tmin = Math.floor(Math.min(...T)) - 1, tmax = Math.ceil(Math.max(...T)) + 1;
  const pmax = Math.max(2, ...P);
  const x = (i) => padL + (i / (N - 1)) * cw;
  const yT = (v) => padT + ch - ((v - tmin) / (tmax - tmin)) * ch;
  g.font = '11px Figtree, sans-serif'; g.fillStyle = '#93aab6'; g.strokeStyle = '#25404f'; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = tmin + ((tmax - tmin) * k) / 3, y = yT(v);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - 4, y); g.stroke();
    g.fillText(Math.round(tConv(v)) + '°', 0, y + 4);
  }
  g.fillStyle = 'rgba(74,163,255,.75)';
  const bw = Math.max(2, cw / N - 1.5);
  P.forEach((v, i) => { const h = (v / pmax) * ch * 0.55; g.fillRect(x(i) - bw / 2, padT + ch - h, bw, h); });
  g.strokeStyle = '#ffb547'; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath();
  T.forEach((v, i) => (i ? g.lineTo(x(i), yT(v)) : g.moveTo(x(i), yT(v)))); g.stroke();
  g.fillStyle = '#93aab6'; g.textAlign = 'center';
  times.forEach((t, i) => { if (i % 8 === 0) g.fillText(t.slice(11, 16), Math.min(Math.max(x(i), padL + 12), W - 16), H - 6); });
}


/* SEASONAL-START */
/* ---------- 3-month outlook (ECMWF SEAS5 via Open-Meteo) ---------- */
let seasonToken = 0;
const SEASON_URL = 'https://seasonal-api.open-meteo.com/v1/seasonal';
const SEASON_VARS = 'temperature_2m_mean,temperature_2m_anomaly,temperature_max24h_2m_mean,temperature_min24h_2m_mean,precipitation_mean,precipitation_anomaly';

function seasonSeries(m, name) {
  if (Array.isArray(m[name])) return m[name];
  const keys = Object.keys(m).filter((k) => k !== 'time' && k.startsWith(name + '_') && Array.isArray(m[k]));
  if (!keys.length) return null;
  return m.time.map((_, i) => {
    const v = keys.map((k) => m[k][i]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
}

function buildSeason(res) {
  const m = res && res.monthly;
  if (!m || !Array.isArray(m.time)) return null;
  const S = {};
  ['temperature_2m_mean', 'temperature_2m_anomaly', 'temperature_max24h_2m_mean', 'temperature_min24h_2m_mean', 'precipitation_mean', 'precipitation_anomaly']
    .forEach((n) => { S[n] = seasonSeries(m, n); });
  if (!S.temperature_2m_mean) return null;
  const now = new Date(), firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = [];
  m.time.forEach((t, i) => {
    const d = new Date((t.length === 7 ? t + '-01' : t.slice(0, 10)) + 'T00:00');
    if (d < firstNext || rows.length >= 3) return;
    const g = (n) => (S[n] && S[n][i] != null ? S[n][i] : null);
    rows.push({
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      days: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
      t: g('temperature_2m_mean'), ta: g('temperature_2m_anomaly'),
      tmax: g('temperature_max24h_2m_mean'), tmin: g('temperature_min24h_2m_mean'),
      p: g('precipitation_mean'), pa: g('precipitation_anomaly'),
    });
  });
  if (!rows.length) return null;
  const maxP = Math.max(...rows.map((r) => r.p || 0));
  rows.forEach((r) => { r.perDay = maxP <= 60; });
  return rows;
}

async function loadSeasonal(lat, lon) {
  const tok = ++seasonToken;
  state.season = null; state.seasonState = 'loading'; drawSeasonal();
  const base = `${SEASON_URL}?latitude=${lat}&longitude=${lon}&monthly=${SEASON_VARS}&timezone=auto`;
  let res = null;
  try { res = await getJSON(base + '&models=ecmwf_seas5_ensemble_mean'); }
  catch (e) { try { res = await getJSON(base); } catch (e2) { res = null; } }
  if (tok !== seasonToken) return;
  const rows = res ? buildSeason(res) : null;
  state.season = rows; state.seasonState = rows ? 'ok' : 'error';
  drawSeasonal();
}

function drawSeasonal() {
  const box = $('#season'); if (!box) return;
  if (state.seasonState === 'loading') { box.innerHTML = '<p class="msg">Loading the outlook…</p>'; return; }
  if (!state.season) { box.innerHTML = '<p class="msg">The 3-month outlook is not available for this spot right now.</p>'; return; }
  const dT = (a) => (state.tempUnit === 'F' ? a * 1.8 : a);
  const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  box.innerHTML = state.season.map((r) => {
    let tAdj = '';
    if (r.ta != null) {
      const a = dT(r.ta), mag = Math.abs(a).toFixed(1);
      tAdj = Math.abs(r.ta) < 0.3 ? '<span class="adj same">near normal</span>'
        : `<span class="adj ${r.ta > 0 ? 'warm' : 'cool'}">${sign(a)}${mag}° ${r.ta > 0 ? 'warmer' : 'cooler'}</span>`;
    }
    let rain = '', rAdj = '';
    if (r.p != null) {
      const total = r.perDay ? r.p * r.days : r.p;
      rain = `${Math.round(total)} mm`;
      if (r.pa != null) {
        const normal = (r.p - r.pa) * (r.perDay ? r.days : 1), pct = normal > 1 ? ((r.pa * (r.perDay ? r.days : 1)) / normal) * 100 : null;
        if (pct != null) rAdj = Math.abs(pct) < 10 ? '<span class="adj same">near normal</span>'
          : `<span class="adj ${pct > 0 ? 'wet' : 'dry'}">${sign(pct)}${Math.abs(Math.round(pct))}% ${pct > 0 ? 'wetter' : 'drier'}</span>`;
      }
    }
    return `<div class="mcard"><div class="mname">${r.label}</div>` +
      (r.t != null ? `<div class="mline"><span>Average temperature <span class="v">${fmtT(r.t)}</span></span>${tAdj}</div>` : '') +
      (r.tmin != null && r.tmax != null ? `<div class="mrange">Typical day ${fmtT(r.tmin)} to ${fmtT(r.tmax)}</div>` : '') +
      (rain ? `<div class="mline"><span>Rain for the month <span class="v">${rain}</span></span>${rAdj}</div>` : '') + '</div>';
  }).join('') +
    '<p class="note">This shows the lean for whole months compared with a normal year, not daily weather. It comes from ECMWF SEAS5 and is not corrected for local conditions, so read "warmer" or "wetter" as a tendency, not a promise.</p>';
}
/* SEASONAL-END */

/* ---------- search ---------- */
function initSearch() {
  const input = $('#q'), list = $('#results');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await getJSON(`${GEO}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`);
        const items = r.results || [];
        list.innerHTML = items.length
          ? items.map((p, i) => `<li tabindex="0" data-i="${i}">${p.name}<small>${[p.admin2, p.admin1, p.country].filter(Boolean).join(', ')}</small></li>`).join('')
          : '<li>No places found</li>';
        list.hidden = false;
        list.onclick = list.onkeydown = (e) => {
          if (e.type === 'keydown' && e.key !== 'Enter') return;
          const li = e.target.closest('li[data-i]'); if (!li) return;
          const p = items[+li.dataset.i];
          list.hidden = true; input.value = p.name;
          setLocation(p.latitude, p.longitude, [p.name, p.admin1, p.country].filter(Boolean).join(', '), 10, 'Search result');
        };
      } catch (e) { list.innerHTML = '<li>Search is unavailable right now</li>'; list.hidden = false; }
    }, 300);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) list.hidden = true; });
}

/* ---------- boot ---------- */
function init() {
  if (/netlify\.app$/.test(location.hostname)) document.body.classList.add('netlify');
  state.tempUnit = load('sc_temp') || 'C'; state.windUnit = load('sc_wind') || 'kmh';
  $('#u-temp').value = state.tempUnit; $('#u-wind').value = state.windUnit;
  initMap(); initSearch();
  $('#layers').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-layer]'); if (!b) return;
    state.layer = b.dataset.layer;
    document.querySelectorAll('#layers button').forEach((x) => x.classList.toggle('on', x === b));
    drawGrid();
  });
  $('#u-temp').addEventListener('change', (e) => { state.tempUnit = e.target.value; store('sc_temp', state.tempUnit); render(); });
  $('#u-wind').addEventListener('change', (e) => { state.windUnit = e.target.value; store('sc_wind', state.windUnit); render(); });
  $('#locate').addEventListener('click', () => locateMe(false));
  const homeBtn = $('#home-go');
  const refreshHome = () => { homeBtn.hidden = !getHome(); };
  refreshHome();
  homeBtn.addEventListener('click', () => { const h = getHome(); if (h) setLocation(h.lat, h.lon, h.name, 10, 'Your saved home'); });
  $('#save-home').addEventListener('click', () => {
    if (state.lat == null) return;
    store('sc_home', JSON.stringify({ lat: state.lat, lon: state.lon, name: state.name }));
    refreshHome();
    const b = $('#save-home'); b.textContent = 'Saved as home'; setTimeout(() => { b.textContent = 'Set as home'; }, 2000);
  });
  const styleBtn = $('#map-style');
  const labelStyle = () => { const d = document.body.classList.contains('dark-map'); styleBtn.querySelector('span').textContent = d ? 'Light map' : 'Dark map'; styleBtn.setAttribute('aria-pressed', String(d)); };
  labelStyle();
  styleBtn.addEventListener('click', () => { const d = !document.body.classList.contains('dark-map'); setBase(d); store('sc_map', d ? 'dark' : 'light'); labelStyle(); if (typeof WM !== 'undefined') WM.redraw(); });
  $('#panel-close').addEventListener('click', closePanel);
  $('#open-forecast').addEventListener('click', () => ($('#panel').classList.contains('closed') ? openPanel() : closePanel()));
  $('#sheet-toggle').addEventListener('click', () => { const c = $('#panel').classList.toggle('collapsed'); document.body.classList.toggle('sheet-collapsed', c); });
  window.addEventListener('resize', () => state.data && drawChart());
  state.quiet = true;
  locateMe(true);
}
init();
