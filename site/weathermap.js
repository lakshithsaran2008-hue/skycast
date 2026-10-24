/* Skycast weather map: smooth colour field, animated wind, timeline and legend.
   Data: Open-Meteo hourly forecast on a grid covering the visible map. */

/* WXCORE-START */
const WXCORE = {
  build(res, ROWS, COLS, south, north, west, east) {
    const arr = Array.isArray(res) ? res : [res];
    const nz = (x) => (x || []).map((q) => (q == null ? NaN : q));
    const nodes = arr.map((r) => {
      const h = r.hourly, n = h.time.length, sp = h.wind_speed_10m, dr = h.wind_direction_10m;
      const u = new Array(n), v = new Array(n);
      for (let k = 0; k < n; k++) {
        if (sp[k] == null || dr[k] == null) { u[k] = NaN; v[k] = NaN; continue; }
        const a = (dr[k] * Math.PI) / 180;
        u[k] = -sp[k] * Math.sin(a); v[k] = -sp[k] * Math.cos(a);
      }
      return { t: nz(h.temperature_2m), hum: nz(h.relative_humidity_2m), rain: nz(h.precipitation), cloud: nz(h.cloud_cover), pres: nz(h.pressure_msl), gust: nz(h.wind_gusts_10m), u, v };
    });
    return { rows: ROWS, cols: COLS, south, west, dLat: (north - south) / (ROWS - 1), dLon: (east - west) / (COLS - 1), nodes, times: arr[0].hourly.time };
  },
  hour0(times, nowMs) {
    for (let i = 0; i < times.length; i++) if (Date.parse(times[i] + 'Z') >= nowMs - 30 * 60000) return i;
    return 0;
  },
  sample(f, lat, lon, h) {
    const fy = (lat - f.south) / f.dLat, fx = (lon - f.west) / f.dLon;
    if (!(fy >= -0.02 && fx >= -0.02 && fy <= f.rows - 0.98 && fx <= f.cols - 0.98)) return null;
    const cy = Math.min(Math.max(fy, 0), f.rows - 1), cx = Math.min(Math.max(fx, 0), f.cols - 1);
    const i = Math.min(f.rows - 2, Math.floor(cy)), j = Math.min(f.cols - 2, Math.floor(cx));
    const ty = cy - i, tx = cx - j;
    const a = f.nodes[i * f.cols + j], b = f.nodes[i * f.cols + j + 1], c = f.nodes[(i + 1) * f.cols + j], d = f.nodes[(i + 1) * f.cols + j + 1];
    const mix = (k) => (1 - ty) * ((1 - tx) * a[k][h] + tx * b[k][h]) + ty * ((1 - tx) * c[k][h] + tx * d[k][h]);
    const u = mix('u'), v = mix('v');
    return { temp: mix('t'), hum: mix('hum'), rain: mix('rain'), cloud: mix('cloud'), pres: mix('pres'), gust: mix('gust'), u, v, speed: Math.hypot(u, v) };
  },
  gfsSample(g, lat, lon, A, B, w) {
    const fy = (lat - g.south) / g.dLat, fx = (lon - g.west) / g.dLon;
    if (!(fy >= 0 && fx >= 0 && fy <= g.rows - 1 && fx <= g.cols - 1)) return null;
    const i = Math.min(g.rows - 2, Math.floor(fy)), j = Math.min(g.cols - 2, Math.floor(fx));
    const ty = fy - i, tx = fx - j, n = g.rows * g.cols, C = g.cols, p = i * C + j, M = -32768;
    const bil = (arr, o) => {
      const a = arr[o], b = arr[o + 1], c = arr[o + C], d = arr[o + C + 1];
      if (a === M || b === M || c === M || d === M) return NaN;
      return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
    };
    const o = new Array(8);
    for (let k = 0; k < 8; k++) {
      const v0 = bil(A, k * n + p), v1 = B === A ? v0 : bil(B, k * n + p);
      o[k] = (v0 + (v1 - v0) * w) / g.sc[k] + g.off[k];
    }
    const u = o[0], v = o[1], speed = Math.hypot(u, v);
    return { u, v, speed, gust: o[2] === o[2] ? o[2] : speed, temp: o[3], hum: o[4], cloud: o[5], pres: o[6], rain: o[7] === o[7] ? Math.max(0, o[7]) : 0 };
  },
  dirFrom(u, v) { return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360; },
};
/* WXCORE-END */

const WM = (function () {
  const ROWS = 7, COLS = 9, CELL = 8, K = 0.025;
  let WCELL = 14;
  const VARS = 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  const HUM_STOPS = [[0, [230, 200, 140]], [40, [200, 225, 150]], [70, [90, 200, 190]], [100, [60, 110, 230]]];
  /* Windy-style palettes */
  const WX_WIND = [[0, [72, 98, 186]], [8, [62, 140, 205]], [18, [66, 184, 166]], [28, [140, 208, 90]], [40, [240, 214, 62]], [55, [242, 146, 52]], [72, [228, 68, 62]], [95, [176, 48, 150]]];
  const WX_TEMP = [[-20, [128, 62, 190]], [-10, [100, 112, 224]], [0, [70, 160, 240]], [10, [88, 208, 204]], [18, [138, 220, 104]], [25, [250, 230, 80]], [31, [250, 168, 58]], [38, [236, 82, 58]], [48, [160, 30, 62]]];
  const WX_RAIN = [[0, [58, 110, 198]], [1.5, [52, 136, 228]], [2, [56, 172, 216]], [3, [84, 204, 118]], [7, [238, 228, 50]], [10, [248, 150, 40]], [20, [232, 48, 62]], [30, [208, 42, 188]]];
  const LAYERS = {
    wind:     { label: 'Wind', stops: WX_WIND, lo: 0, hi: 95, a: () => 0.5, val: (s) => s.speed, fmt: (v) => fmtW(v) },
    gusts:    { label: 'Gusts', stops: WX_WIND, lo: 0, hi: 95, a: () => 0.5, val: (s) => s.gust, fmt: (v) => fmtW(v) },
    temp:     { label: 'Temperature', stops: WX_TEMP, lo: -20, hi: 48, a: () => 0.58, val: (s) => s.temp, fmt: (v) => fmtT(v) },
    rain:     { label: 'Rain, thunder', stops: WX_RAIN, lo: 0, hi: 30, even: true, a: (v) => (v < 0.05 ? 0 : Math.min(0.95, 0.3 + v * 0.75)), val: (s) => s.rain * 3, fmt: (v) => (v >= 30 ? '30+' : v.toFixed(1)) + ' mm/3h' },
    cloud:    { label: 'Clouds', stops: [[0, [255, 255, 255]], [100, [255, 255, 255]]], legend: [[0, [40, 52, 62]], [100, [255, 255, 255]]], lo: 0, hi: 100, a: (v) => 0.75 * Math.pow(v / 100, 1.3), val: (s) => s.cloud, fmt: (v) => Math.round(v) + '%' },
    pressure: { label: 'Pressure', stops: PRESS_STOPS, lo: 980, hi: 1040, a: () => 0.5, val: (s) => s.pres, fmt: (v) => Math.round(v) + ' hPa' },
    humidity: { label: 'Humidity', stops: HUM_STOPS, lo: 0, hi: 100, a: () => 0.5, val: (s) => s.hum, fmt: (v) => Math.round(v) + '%' },
  };
  LAYERS.waves = { label: 'Waves', stops: [[0, [70, 100, 200]], [1, [60, 170, 220]], [2, [80, 210, 170]], [3.5, [240, 210, 70]], [5, [240, 120, 50]], [8, [170, 40, 120]]], lo: 0, hi: 8, a: () => 0.62, val: (s) => s.x, fmt: (v) => v.toFixed(1) + ' m' };
  LAYERS.aqi = { label: 'Air quality (US AQI)', stops: [[0, [80, 200, 120]], [50, [170, 220, 90]], [100, [250, 220, 70]], [150, [245, 140, 50]], [200, [225, 70, 70]], [300, [140, 40, 120]]], lo: 0, hi: 300, a: () => 0.6, val: (s) => s.x, fmt: (v) => Math.round(v) + ' AQI' };
  const EXTRA = {
    waves: { url: 'https://marine-api.open-meteo.com/v1/marine', vars: 'wave_height', days: 16 },
    aqi: { url: 'https://air-quality-api.open-meteo.com/v1/air-quality', vars: 'us_aqi', days: 5 },
  };
  const extra = {};
  const WIND_LAYERS = ['wind', 'gusts'];
  let particlesOn = true;
  try { particlesOn = localStorage.getItem('sc_particles') !== '0'; } catch (e) {}

  /* [name, lat, lon, minimum zoom] */
  const CITIES = [
    ['Delhi',28.61,77.21,3],['Mumbai',19.08,72.88,3],['Kolkata',22.57,88.36,3],['Chennai',13.08,80.27,3],['Bengaluru',12.97,77.59,3],['Hyderabad',17.39,78.49,3],
    ['Karachi',24.86,67.01,3],['Dhaka',23.81,90.41,3],['Bangkok',13.76,100.5,3],
    ['Ahmedabad',23.02,72.57,4],['Pune',18.52,73.86,4],['Jaipur',26.91,75.79,4],['Lucknow',26.85,80.95,4],['Nagpur',21.15,79.09,4],['Patna',25.59,85.14,4],
    ['Lahore',31.55,74.34,4],['Islamabad',33.68,73.05,4],['Kabul',34.53,69.17,4],['Kathmandu',27.72,85.32,4],['Colombo',6.93,79.86,4],['Yangon',16.84,96.17,4],
    ['Hanoi',21.03,105.85,4],['Ho Chi Minh City',10.82,106.63,4],['Kuala Lumpur',3.14,101.69,4],['Singapore',1.35,103.82,4],['Dubai',25.2,55.27,4],['Tehran',35.69,51.39,4],
    ['Kunming',25.04,102.71,4],['Chengdu',30.57,104.07,4],
    ['Surat',21.17,72.83,5],['Kanpur',26.45,80.35,5],['Indore',22.72,75.86,5],['Bhopal',23.26,77.41,5],['Visakhapatnam',17.69,83.22,5],['Coimbatore',11.02,76.96,5],
    ['Kochi',9.93,76.27,5],['Thiruvananthapuram',8.52,76.94,5],['Guwahati',26.14,91.74,5],['Bhubaneswar',20.3,85.82,5],['Ranchi',23.34,85.31,5],['Raipur',21.25,81.63,5],
    ['Chandigarh',30.73,76.78,5],['Srinagar',34.08,74.8,5],['Varanasi',25.32,83.01,5],['Port Blair',11.62,92.73,5],['Chittagong',22.36,91.78,5],['Naypyidaw',19.76,96.08,5],
    ['Mandalay',21.97,96.08,5],['Chiang Mai',18.79,98.99,5],['Phnom Penh',11.56,104.93,5],['Vientiane',17.97,102.6,5],['Medan',3.59,98.67,5],['Male',4.18,73.51,5],
    ['Muscat',23.59,58.41,5],['Abu Dhabi',24.45,54.38,5],['Doha',25.29,51.53,5],['Mashhad',36.3,59.6,5],['Tashkent',41.3,69.24,5],['Lhasa',29.65,91.12,5],
    ['Vadodara',22.31,73.18,6],['Madurai',9.93,78.12,6],['Mangaluru',12.91,74.86,6],['Mysuru',12.3,76.64,6],['Vijayawada',16.51,80.65,6],['Amritsar',31.63,74.87,6],
    ['Dehradun',30.32,78.03,6],['Shimla',31.1,77.17,6],['Jammu',32.73,74.87,6],['Leh',34.15,77.58,6],['Agra',27.18,78.02,6],['Jodhpur',26.24,73.02,6],
    ['Udaipur',24.58,73.71,6],['Gwalior',26.22,78.18,6],['Jabalpur',23.18,79.95,6],['Nashik',19.99,73.79,6],['Aurangabad',19.88,75.34,6],['Panaji',15.5,73.83,6],
    ['Tiruchirappalli',10.79,78.69,6],['Kozhikode',11.26,75.78,6],['Jamshedpur',22.8,86.2,6],['Siliguri',26.73,88.4,6],['Imphal',24.82,93.94,6],['Shillong',25.57,91.88,6],
    ['Agartala',23.83,91.28,6],['Kavaratti',10.57,72.64,6],['Rajkot',22.3,70.8,6],['Bikaner',28.02,73.31,6],['Prayagraj',25.43,81.85,6],['Ludhiana',30.9,75.86,6],
    ['Thimphu',27.47,89.64,6],['Kandy',7.29,80.63,6],['Jaffna',9.67,80.01,6],['Phuket',7.88,98.39,6],['Quetta',30.18,66.99,6],['Peshawar',34.01,71.58,6],
    ['Kandahar',31.62,65.71,6],['Multan',30.2,71.47,6],['Faisalabad',31.42,73.08,6],['Sylhet',24.9,91.87,6],['Khulna',22.85,89.54,6],['Da Nang',16.05,108.22,6],
    ['Salem',11.66,78.15,7],['Puducherry',11.93,79.83,7],['Vellore',12.92,79.13,7],['Tirupati',13.63,79.42,7],['Warangal',17.97,79.59,7],['Thrissur',10.53,76.21,7],
    ['Dhanbad',23.8,86.43,7],['Gangtok',27.34,88.61,7],['Itanagar',27.08,93.61,7],['Kohima',25.67,94.11,7],['Aizawl',23.73,92.72,7],['Jamnagar',22.47,70.07,7],
    ['Ajmer',26.45,74.64,7],['Meerut',28.98,77.71,7],['Gorakhpur',26.76,83.37,7],['Kota',25.18,75.84,7],['Nellore',14.44,79.99,7],['Kurnool',15.83,78.04,7],
    ['Belagavi',15.85,74.5,7],['Hubballi',15.36,75.12,7],['Ballari',15.14,76.92,7],['Kadapa',14.47,78.82,7],['Thanjavur',10.79,79.14,7],['Tirunelveli',8.73,77.7,7],
    ['Nagercoil',8.18,77.43,7],['Kakinada',16.99,82.25,7],['Cuttack',20.46,85.88,7],['Sambalpur',21.47,83.97,7],['Bilaspur',22.08,82.15,7],['Rajshahi',24.37,88.6,7],
    ['Pokhara',28.21,83.99,7],['Cox\'s Bazar',21.45,91.98,7],['Sittwe',20.15,92.9,7],['Hat Yai',7.0,100.47,7],
  ].sort((a, b) => a[3] - b[3]);
  const AREAS = [
    ['INDIA',22.5,79.5,3,5],['PAKISTAN',29.5,69.5,3,5],['CHINA',33.5,100,3,6],['MYANMAR',21.5,96.3,3,6],['THAILAND',15.3,101,3,6],['BANGLADESH',23.9,90.2,5,7],
    ['NEPAL',28.4,84,5,7],['SRI LANKA',7.6,80.7,5,8],['AFGHANISTAN',34,66,3,6],['IRAN',32.5,54.5,3,6],['OMAN',20.5,56.5,3,6],['LAOS',19.6,102.4,5,7],['VIETNAM',15.5,107.7,5,7],
    ['MALAYSIA',4.2,102.3,5,7],['Arabian Sea',15,65,3,7],['Bay of Bengal',14.5,88,3,7],['Indian Ocean',2,76,3,7],
  ];

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let field = null, fieldBounds = null, fieldZoom = 0, h0 = 0, offset = 0, token = 0, fetchTimer, playTimer;
  let gfs = null, source = 'om', baseNow = Math.round(Date.now() / 3600e3) * 3600e3, tA = null, tB = null, tW = 0, redrawTimer;
  const stepCache = {}, pending = {};
  let heatC, windC, lblC, geoC, hctx, wctx, lctx, gctx, W = 0, H = 0, geo = null;
  let U = null, V = null, wCols = 0, wRows = 0;
  let px, py, age, N = 0, running = false, moving = false, lastProbe = 0;

  /* ---------- canvases ---------- */
  function setup() {
    map.createPane('wx'); const pane = map.getPane('wx');
    pane.style.zIndex = 250; pane.style.pointerEvents = 'none';
    heatC = document.createElement('canvas'); windC = document.createElement('canvas');
    heatC.className = 'wx-canvas wx-heat';
    windC.className = 'wx-canvas';
    geoC = document.createElement('canvas'); geoC.className = 'wx-canvas';
    pane.appendChild(heatC); pane.appendChild(windC); pane.appendChild(geoC); gctx = geoC.getContext('2d');
    hctx = heatC.getContext('2d'); wctx = windC.getContext('2d');
    const lp = map.getPane('labels') || map.createPane('labels');
    lblC = document.createElement('canvas'); lblC.className = 'wx-canvas'; lp.appendChild(lblC); lctx = lblC.getContext('2d');
    sizeAndPlace();
  }
  function sizeAndPlace() {
    const s = map.getSize();
    if (s.x !== W || s.y !== H) { W = s.x; H = s.y; heatC.width = windC.width = lblC.width = geoC.width = W; heatC.height = windC.height = lblC.height = geoC.height = H; }
    const p = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(heatC, p); L.DomUtil.setPosition(windC, p); L.DomUtil.setPosition(lblC, p); L.DomUtil.setPosition(geoC, p);
  }

  /* ---------- data ---------- */
  /* Grid nodes sit on fixed multiples of 'step' degrees, so a given place always gets the same
     data no matter how you pan or zoom (no more wind pattern jumping around). */
  function lattice() {
    const bb = map.getBounds().pad(0.2);
    for (const step of [0.25, 0.5, 1, 2, 3, 5, 8, 12, 20]) {
      const south = Math.max(-84, Math.floor(bb.getSouth() / step) * step), north = Math.min(84, Math.ceil(bb.getNorth() / step) * step);
      const west = Math.max(-180, Math.floor(bb.getWest() / step) * step), east = Math.min(180, Math.ceil(bb.getEast() / step) * step);
      const rows = Math.round((north - south) / step) + 1, cols = Math.round((east - west) / step) + 1;
      if (rows * cols <= 54 || step === 20) return { step, south, north, west, east, rows, cols };
    }
  }
  const fieldCache = {};
  let retryTimer, inflight = '', lastErr = '';
  async function fetchField() {
    if (source === 'gfs') return;
    const my = ++token;
    const lat = lattice();
    const { south, north, west, east, rows: ROWS, cols: COLS } = lat, lats = [], lons = [];
    for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
      lats.push((south + lat.step * i).toFixed(3));
      lons.push((west + lat.step * j).toFixed(3));
    }
    setProbe('Loading map data… (build 24b)');
    const key = [lat.step, south, west, ROWS, COLS].join('|');
    if (inflight === key) return;
    inflight = key;
    try {
      let res, hit = fieldCache[key];
      if (hit && Date.now() - hit.at < 20 * 60e3) res = hit.res;
      else {
        const mk = (d) => `${API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${VARS}&forecast_days=${d}&timezone=GMT&wind_speed_unit=kmh`;
        for (let tryNo = 0; ; tryNo++) {   // busy? wait and retry; the last try asks for fewer days (much lighter)
          try { res = await getJSON(mk(tryNo >= 2 ? 4 : 16)); break; }
          catch (err) { lastErr = err.message || String(err); if (tryNo >= 3 || my !== token) throw err; setProbe('Map data is busy (' + lastErr + '), retrying…'); await new Promise((r) => setTimeout(r, 2000 * (tryNo + 1))); if (my !== token) return; }
        }
        const keys = Object.keys(fieldCache); if (keys.length > 6) delete fieldCache[keys[0]];
        fieldCache[key] = { at: Date.now(), res };
      }
      if (my !== token) return;
      field = WXCORE.build(res, ROWS, COLS, south, north, west, east);
      fieldBounds = L.latLngBounds([south, west], [north, east]); fieldZoom = lat.step;
      h0 = WXCORE.hour0(field.times, Date.now());
      const range = $('#tl-range'); range.max = Math.max(0, Math.min(383, field.times.length - h0 - 1));
      if (offset > +range.max) offset = 0; range.value = offset;
      setProbe('Move the pointer over the map');
      inflight = '';
      if (source === 'om') redraw();
    } catch (e) {
      if (my === token) { inflight = ''; setProbe('Map data error: ' + (lastErr || (e && e.message) || 'unknown') + '. Retrying shortly…'); clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (!field || my === token) fetchField(); }, 15000); }
    }
  }
  function reload(force) {
    if (source === 'gfs') return;
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      if (!force && field && fieldBounds.contains(map.getBounds()) && lattice().step === fieldZoom) return;
      fetchField();
    }, 350);
  }
  async function ensureExtra() {
    const name = state.layer, X = EXTRA[name];
    if (!X || !field || !fieldBounds) return;
    const cur = extra[name];
    if (cur && (cur.fb === fieldBounds || cur.busy)) return;
    const fb = fieldBounds, my = { fb, busy: true, data: cur ? cur.data : null };
    extra[name] = my;
    const south = fb.getSouth(), west = fb.getWest(), ROWS = field.rows, COLS = field.cols, st = field.dLat, lats = [], lons = [];
    for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
      lats.push((south + st * i).toFixed(3));
      lons.push((west + st * j).toFixed(3));
    }
    setProbe('Loading ' + LAYERS[name].label + '…');
    try {
      const res = await getJSON(`${X.url}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${X.vars}&forecast_days=${X.days}&timezone=GMT`);
      const arr = Array.isArray(res) ? res : [res];
      my.data = { times: arr[0].hourly.time, nodes: arr.map((r) => (r.hourly[X.vars] || []).map((q) => (q == null ? NaN : q))) };
      my.busy = false;
      setProbe('Move the pointer over the map');
      if (state.layer === name) redraw();
    } catch (e) { my.busy = false; my.fb = fb; setProbe(LAYERS[name].label + ' data is not available here.'); }
  }
  function extraValue(f, X, lat, lon) {
    const fy = (lat - f.south) / f.dLat, fx = (lon - f.west) / f.dLon;
    const cy = Math.min(Math.max(fy, 0), f.rows - 1), cx = Math.min(Math.max(fx, 0), f.cols - 1);
    const i = Math.min(f.rows - 2, Math.floor(cy)), j = Math.min(f.cols - 2, Math.floor(cx)), ty = cy - i, tx = cx - j;
    const t = Date.parse(f.times[h0 + offset] + 'Z'), k = Math.round((t - Date.parse(X.times[0] + 'Z')) / 3600e3);
    if (k < 0) return NaN;
    const q = [[i, j, (1 - ty) * (1 - tx)], [i, j + 1, (1 - ty) * tx], [i + 1, j, ty * (1 - tx)], [i + 1, j + 1, ty * tx]];
    let s = 0, wsum = 0;
    for (const [a, b, wt] of q) { const v = X.nodes[a * f.cols + b] && X.nodes[a * f.cols + b][k]; if (v === v && v != null && wt > 0) { s += v * wt; wsum += wt; } }
    return wsum > 0.35 ? s / wsum : NaN;
  }
  const sampleAt = (lat, lon) => {
    if (EXTRA[state.layer]) {
      const base = field ? WXCORE.sample(field, lat, lon, h0 + offset) : null; if (!base) return null;
      const e = extra[state.layer];
      base.x = e && e.data ? extraValue(field, e.data, lat, lon) : NaN;
      return base;
    }
    if (source === 'gfs') return tA ? WXCORE.gfsSample(gfs.g, lat, lon, tA, tB, tW) : null;
    return field ? WXCORE.sample(field, lat, lon, h0 + offset) : null;
  };

  /* ---------- GFS files (written hourly by the pipeline) ---------- */
  async function loadGfs() {
    if (typeof DecompressionStream === 'undefined') return;
    try {
      const r = await fetch('data/gfs/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const m = await r.json(), cycleMs = Date.parse(m.cycleTime), maxFh = m.hours[m.hours.length - 1];
      if (!(cycleMs > 0) || (Date.now() - cycleMs) / 3600e3 > 60) return;      // missing or stale: use Open-Meteo instead
      gfs = {
        g: { rows: m.rows, cols: m.cols, south: m.south, north: m.north, west: m.west, east: m.east, dLat: m.dlat, dLon: m.dlon, sc: m.vars.map((v) => v.scale), off: m.vars.map((v) => v.offset) },
        cycleMs, maxFh, hours: m.hours, ver: m.cycle,
      };
    } catch (e) { gfs = null; }
  }
  function loadStep(si) {
    if (stepCache[si] || pending[si]) return pending[si];
    const hh = String(gfs.hours[si]).padStart(3, '0');
    pending[si] = (async () => {
      const res = await fetch(`data/gfs/f${hh}.bin.gz?v=${gfs.ver}`);
      if (!res.ok) throw new Error('step');
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      const n = buf.length >> 1, out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = buf[i] | (buf[n + i] << 8);
      stepCache[si] = out;
    })().catch(() => {}).finally(() => { delete pending[si]; if (source === 'gfs') { clearTimeout(redrawTimer); redrawTimer = setTimeout(redraw, 60); } });
    return pending[si];
  }
  function prepGfs() {
    const fh = Math.min(gfs.maxFh, Math.max(0, (baseNow + offset * 3600e3 - gfs.cycleMs) / 3600e3));
    const hrs = gfs.hours;
    let s0 = 0; while (s0 < hrs.length - 1 && hrs[s0 + 1] <= fh) s0++;
    const s1 = Math.min(s0 + 1, hrs.length - 1);
    tW = s1 === s0 ? 0 : (fh - hrs[s0]) / (hrs[s1] - hrs[s0]);
    for (let k = 2; k <= 3; k++) if (s0 + k < hrs.length) loadStep(s0 + k);   // warm up the next steps while playing
    let A = stepCache[s0], B = stepCache[s1];
    if (!A || !B) { loadStep(s0); loadStep(s1); }
    if (!A && !B) { tA = tB = null; return false; }
    tA = A || B; tB = B || A; if (!A || !B) tW = 0;
    return true;
  }
  function gfsMaxOffset() { return Math.max(0, Math.floor(gfs.maxFh - (baseNow - gfs.cycleMs) / 3600e3)); }
  const inRegion = (lat, lon) => !!gfs && lat >= gfs.g.south && lat <= gfs.g.north && lon >= gfs.g.west && lon <= gfs.g.east;
  function chooseSource() {
    const c = map.getCenter(), want = !EXTRA[state.layer] && inRegion(c.lat, c.lng) ? 'gfs' : 'om';
    if (want === source && $('#src').textContent) return;
    source = want;
    const range = $('#tl-range');
    if (source === 'gfs') {
      range.max = gfsMaxOffset(); if (offset > +range.max) offset = 0; range.value = offset;
      const d = new Date(gfs.cycleMs);
      $('#src').textContent = `GFS 25 km · run ${String(d.getUTCHours()).padStart(2, '0')}Z`;
    } else {
      $('#src').textContent = 'Open-Meteo';
      if (!field || !fieldBounds.contains(map.getBounds())) fetchField(); else { range.max = Math.max(0, Math.min(383, field.times.length - h0 - 1)); }
    }
  }

  /* ---------- drawing ---------- */
  function lonLatGrid(step) {
    const cols = Math.ceil(W / step), rows = Math.ceil(H / step), lons = new Array(cols), lats = new Array(rows);
    for (let c = 0; c < cols; c++) lons[c] = map.containerPointToLatLng([c * step + step / 2, 0]).lng;
    for (let r = 0; r < rows; r++) lats[r] = map.containerPointToLatLng([0, r * step + step / 2]).lat;
    return { cols, rows, lons, lats };
  }
  function drawHeat() {
    hctx.clearRect(0, 0, W, H);
    if (source === 'om' && !field) return;
    if (source === 'gfs' && !tA) return;
    const CL = source === 'gfs' ? 6 : CELL, Ly = LAYERS[state.layer] || LAYERS.wind, g = lonLatGrid(CL);
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const s = sampleAt(g.lats[r], g.lons[c]); if (!s) continue;
      const v = Ly.val(s); if (!(v === v)) continue;
      const a = Ly.a(v); if (a <= 0) continue;
      hctx.globalAlpha = a; hctx.fillStyle = ramp(v, Ly.stops);
      hctx.fillRect(c * CL, r * CL, CL + 0.5, CL + 0.5);
    }
    hctx.globalAlpha = 1;
  }
  function buildWind() {
    wctx.clearRect(0, 0, W, H);
    U = null;
    if ((source === 'om' && !field) || (source === 'gfs' && !tA)) return;
    WCELL = source === 'gfs' ? 9 : 14;
    const g = lonLatGrid(WCELL); wCols = g.cols; wRows = g.rows;
    U = new Float32Array(wCols * wRows); V = new Float32Array(wCols * wRows);
    for (let r = 0; r < wRows; r++) for (let c = 0; c < wCols; c++) {
      const s = sampleAt(g.lats[r], g.lons[c]), k = r * wCols + c;
      if (s && s.u === s.u && s.v === s.v) { U[k] = s.u; V[k] = s.v; } else { U[k] = NaN; V[k] = NaN; }
    }
    N = Math.min(3200, Math.round((W * H) / 900));
    px = new Float32Array(N); py = new Float32Array(N); age = new Float32Array(N);
    for (let i = 0; i < N; i++) spawn(i, true);
  }
  function spawn(i, scatter) {
    px[i] = Math.random() * W; py[i] = Math.random() * H;
    age[i] = scatter ? Math.random() * 38 : 0;
  }
  let lastT = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.max(0.5, Math.min(3, ((ts || 0) - lastT) / 16.67)); lastT = ts || 0;   // same speed on 60 Hz and 120 Hz screens
    const on = !reduced && !moving && U && particlesOn && !EXTRA[state.layer] && !document.hidden;
    if (!on) return;
    const dark = document.body.classList.contains('dark-map');
    wctx.globalCompositeOperation = 'destination-out';
    wctx.fillStyle = 'rgba(0,0,0,' + (0.2 * dt).toFixed(3) + ')'; wctx.fillRect(0, 0, W, H);
    wctx.globalCompositeOperation = 'source-over';
    wctx.lineWidth = 1.7; wctx.lineCap = 'round';
    wctx.strokeStyle = dark ? 'rgba(255,255,255,0.95)' : 'rgba(8,28,44,0.85)';
    wctx.beginPath();
    const spd = K * dt * Math.min(2.4, Math.max(0.8, Math.pow(2, (map.getZoom() - 6) * 0.3)));   // a little faster as you zoom in, like Windy
    for (let i = 0; i < N; i++) {
      const cx = (px[i] / WCELL) | 0, cy = (py[i] / WCELL) | 0;
      if (cx < 0 || cy < 0 || cx >= wCols || cy >= wRows || (age[i] += dt) > 38) { spawn(i, false); continue; }
      const k = cy * wCols + cx, u = U[k], v = V[k];
      if (u !== u || v !== v) { spawn(i, false); continue; }
      const nx = px[i] + u * spd, ny = py[i] - v * spd;
      wctx.moveTo(px[i], py[i]); wctx.lineTo(nx, ny);
      px[i] = nx; py[i] = ny;
    }
    wctx.stroke();
  }

  /* ---------- legend, timeline, probe ---------- */
  function drawLegend() {
    const Ly = LAYERS[state.layer] || LAYERS.wind, span = Ly.hi - Ly.lo;
    $('#lg-bar').style.background = 'linear-gradient(90deg,' +
      (Ly.legend || Ly.stops).map(([v, c], i, arr) => `rgb(${c.join(',')}) ${(Ly.even ? (i / (arr.length - 1)) * 100 : Math.max(0, Math.min(100, ((v - Ly.lo) / span) * 100))).toFixed(0)}%`).join(',') + ')';
    $('#lg-min').textContent = Ly.fmt(Ly.lo); $('#lg-max').textContent = Ly.fmt(Ly.hi);
    $('#lg-name').textContent = Ly.label;
  }
  function drawTime() {
    const lab = $('#tl-label');
    let ms = null;
    if (source === 'gfs') ms = baseNow + offset * 3600e3;
    else if (field) ms = Date.parse(field.times[h0 + offset] + 'Z');
    if (ms === null) { lab.textContent = '…'; return; }
    markDay();
    lab.textContent = (offset === 0 ? 'Now · ' : '') + new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function setProbe(t) { const p = $('#probe'); if (p) p.textContent = t; }
  function probe(e) {
    const now = Date.now(); if (now - lastProbe < 60 || (source === 'om' && !field) || (source === 'gfs' && !tA)) return; lastProbe = now;
    const s = sampleAt(e.latlng.lat, e.latlng.lng); if (!s) return;
    const Ly = LAYERS[state.layer] || LAYERS.wind, v = Ly.val(s); if (!(v === v)) return;
    let t = `${Ly.label} ${Ly.fmt(v)}`;
    if (WIND_LAYERS.includes(state.layer) && s.u === s.u) t += ` from ${compass(WXCORE.dirFrom(s.u, s.v))}`;
    setProbe(t);
  }

      /* ---------- coastlines, borders and India state outlines drawn above the colours ---------- */
  async function loadGeo() {
    try {
      const r = await fetch('data/geo.json'); if (!r.ok) return;
      const d = await r.json();
      const prep = (arr) => arr.map((p) => {
        let a = 1e9, b = -1e9, c = 1e9, e = -1e9;
        for (let i = 0; i < p.length; i += 2) { const x = p[i] / 100, y = p[i + 1] / 100; if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > e) e = y; }
        return { p, minX: a, maxX: b, minY: c, maxY: e };
      });
      geo = { w: prep(d.w), i: prep(d.i) };
      drawGeo();
    } catch (e) { geo = null; }
  }
  function drawGeo() {
    if (!gctx) return;
    gctx.clearRect(0, 0, W, H);
    if (!geo) return;
    const bb = map.getBounds(), s = bb.getSouth(), n = bb.getNorth(), w0 = bb.getWest(), e = bb.getEast();
    const dark = document.body.classList.contains('dark-map'), z = map.getZoom();
    const pass = (lines, style, width) => {
      gctx.beginPath();
      for (const l of lines) {
        if (l.maxX < w0 || l.minX > e || l.maxY < s || l.minY > n) continue;
        const p = l.p;
        for (let i = 0; i < p.length; i += 2) {
          const pt = map.latLngToContainerPoint([p[i + 1] / 100, p[i] / 100]);
          if (i === 0) gctx.moveTo(pt.x, pt.y); else gctx.lineTo(pt.x, pt.y);
        }
      }
      gctx.strokeStyle = style; gctx.lineWidth = width; gctx.lineJoin = 'round'; gctx.stroke();
    };
    pass(geo.w, dark ? 'rgba(255,255,255,0.62)' : 'rgba(16,32,44,0.6)', z < 6 ? 1 : 1.4);
    pass(geo.i, dark ? 'rgba(255,255,255,0.5)' : 'rgba(16,32,44,0.5)', z < 6 ? 0.9 : 1.3);
  }

    /* ---------- day bar above the slider (click a day to jump there) ---------- */
  function timeAt(o) {
    if (source === 'gfs') return baseNow + o * 3600e3;
    return field && field.times[h0 + o] ? Date.parse(field.times[h0 + o] + 'Z') : null;
  }
  function buildDays() {
    const box = $('#tl-days'), max = +$('#tl-range').max;
    if (!box) return;
    const key = source + ':' + max + ':' + new Date(baseNow).getDate();
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.innerHTML = '';
    let start = 0, prev = null;
    const flush = (end) => {
      if (prev === null) return;
      const b = document.createElement('button');
      const d = new Date(timeAt(start));
      b.textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      b.style.flexGrow = String(end - start + 1); b.dataset.a = start; b.dataset.b = end;
      b.setAttribute('aria-label', 'Jump to ' + b.textContent);
      b.addEventListener('click', () => setOffset(Math.min(end, Math.max(start, start === 0 ? 0 : start + 8))));
      box.appendChild(b);
    };
    for (let o = 0; o <= max; o++) {
      const t = timeAt(o); if (t === null) break;
      const k = new Date(t).toDateString();
      if (prev !== null && k !== prev) { flush(o - 1); start = o; }
      prev = k;
    }
    flush(max);
    fitDays();
  }
  function fitDays() {
    const box = $('#tl-days'); if (!box) return;
    for (const b of box.children) {
      const d = new Date(timeAt(+b.dataset.a));
      b.textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      if (b.scrollWidth > b.clientWidth) b.textContent = String(d.getDate());
      if (b.scrollWidth > b.clientWidth) b.textContent = '';
    }
  }
  function markDay() {
    const box = $('#tl-days'); if (!box) return;
    for (const b of box.children) b.classList.toggle('on', offset >= +b.dataset.a && offset <= +b.dataset.b);
  }

  /* ---------- city names with temperatures, like Windy ---------- */
  function drawLabels() {
    if (!lctx) return;
    lctx.clearRect(0, 0, W, H);
    const z = map.getZoom(), dark = document.body.classList.contains('dark-map');
    const ink = dark ? '#ffffff' : '#10202c', halo = dark ? 'rgba(10,20,30,.9)' : 'rgba(255,255,255,.92)';
    const placed = [], FONT = 'Figtree, system-ui, sans-serif';
    lctx.textAlign = 'center'; lctx.lineJoin = 'round'; lctx.lineWidth = 3;
    const fits = (x, y, w, h) => { for (const b of placed) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; placed.push([x, y, w, h]); return true; };
    const text = (t, x, y, font, color) => { lctx.font = font; lctx.strokeStyle = halo; lctx.strokeText(t, x, y); lctx.fillStyle = color; lctx.fillText(t, x, y); };
    if (z < 9) {
      for (const [n, la, lo, z0] of CITIES) {
        if (z < z0) continue;
        const p = map.latLngToContainerPoint([la, lo]); if (p.x < -30 || p.y < -10 || p.x > W + 30 || p.y > H + 10) continue;
        lctx.font = '600 12px ' + FONT; const tw = lctx.measureText(n).width;
        if (!fits(p.x - tw / 2 - 3, p.y - 14, tw + 6, 32)) continue;
        const s = sampleAt(la, lo);
        text(n, p.x, p.y - 2, '600 12px ' + FONT, ink);
        if (s && s.temp === s.temp) text(fmtT(s.temp), p.x, p.y + 12, '700 13px ' + FONT, ink);
      }
      for (const [n, la, lo, z0, z1] of AREAS) {
        if (z < z0 || z > z1) continue;
        const p = map.latLngToContainerPoint([la, lo]); if (p.x < 0 || p.y < 0 || p.x > W - (W > 760 ? 150 : 0) || p.y > H) continue;
        const sea = n !== n.toUpperCase();
        lctx.font = (sea ? 'italic 500 13px ' : '600 12px ') + FONT; const aw = lctx.measureText(n).width;
        if (!fits(p.x - aw / 2 - 4, p.y - 12, aw + 8, 18)) continue;
        lctx.globalAlpha = 0.7; text(n, p.x, p.y, (sea ? 'italic 500 13px ' : '600 12px ') + FONT, dark ? '#c3d3de' : '#44566a'); lctx.globalAlpha = 1;
      }
    }
  }

  function redraw() {
    if (!heatC) return;
    chooseSource(); ensureExtra(); sizeAndPlace(); if (source === 'gfs') prepGfs(); drawLegend(); buildDays(); drawTime(); drawHeat(); buildWind(); drawGeo(); drawLabels();
  }
  function setOffset(o) { offset = Math.max(0, Math.min(+$('#tl-range').max, o)); $('#tl-range').value = offset; if (source === 'gfs') prepGfs(); drawTime(); drawHeat(); buildWind(); drawLabels(); }
  function togglePlay() {
    const b = $('#tl-play');
    if (playTimer) { clearInterval(playTimer); playTimer = null; b.textContent = '▶'; b.setAttribute('aria-label', 'Play'); return; }
    b.textContent = '❚❚'; b.setAttribute('aria-label', 'Pause');
    playTimer = setInterval(() => setOffset(offset >= +$('#tl-range').max ? 0 : offset + 1), 650);
  }

  function init() {
    setup();
    const pt = $('#pt-toggle');
    if (pt) { pt.setAttribute('aria-pressed', String(particlesOn)); pt.addEventListener('click', () => { particlesOn = !particlesOn; try { localStorage.setItem('sc_particles', particlesOn ? '1' : '0'); } catch (e) {} pt.setAttribute('aria-pressed', String(particlesOn)); if (!particlesOn) wctx.clearRect(0, 0, W, H); redraw(); }); }
    map.on('movestart', () => { moving = true; });
    window.addEventListener('resize', () => setTimeout(fitDays, 150));
    map.on('zoomstart', () => { heatC.style.opacity = 0; windC.style.opacity = 0; lblC.style.opacity = 0; geoC.style.opacity = 0; });
    map.on('moveend', () => {
      moving = false; heatC.style.opacity = ''; windC.style.opacity = ''; lblC.style.opacity = ''; geoC.style.opacity = '';
      chooseSource(); redraw(); reload(false);
    });
    map.on('resize', redraw);
    map.on('mousemove', probe);
    $('#tl-range').addEventListener('input', (e) => setOffset(+e.target.value));
    $('#tl-play').addEventListener('click', togglePlay);
    drawLegend(); drawTime();
    requestAnimationFrame(frame);
    setProbe('Loading map data…');
    loadGeo();
    loadGfs().then(() => {
      chooseSource();
      if (source === 'gfs') { setProbe('Move the pointer over the map'); redraw(); } else if (!field) fetchField();
    });
  }
  if (typeof map !== 'undefined' && map) init();
  return { reload, redraw };
})();
