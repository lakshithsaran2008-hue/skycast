/* India area browser: State > District > Taluk > Urban > Sub-urban (ward), plus Village.
   Names: Local Government Directory (data/*.json). Positions: OpenStreetMap Nominatim, matched by name. */
(function () {
  const el = {
    btn: $('#browse-btn'), box: $('#browse'), close: $('#b-close'),
    state: $('#b-state'), district: $('#b-district'), taluk: $('#b-taluk'),
    urban: $('#b-urban'), ward: $('#b-ward'), village: $('#b-village'),
  };
  const stateCache = {};
  let cur = null, token = 0, lastCall = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fill(sel, label, items, disabled) {
    sel.innerHTML = `<option value="">${label}</option>` +
      items.map((t, i) => `<option value="${i}">${String(t).replace(/</g, '&lt;')}</option>`).join('');
    sel.disabled = disabled !== undefined ? disabled : !items.length;
  }
  function reset(from) {
    const order = [['district', 'Select district'], ['taluk', 'Select taluk'], ['urban', 'Select town or city'], ['ward', 'Select ward'], ['village', 'Select village']];
    let on = false;
    order.forEach(([k, l]) => { if (k === from) on = true; if (on) fill(el[k], l, [], true); });
  }

  async function getState(code) {
    if (!stateCache[code]) {
      const r = await fetch(`data/s${code}.json`);
      if (!r.ok) throw new Error('data');
      stateCache[code] = await r.json();
    }
    return stateCache[code];
  }

  /* ---- name matching ---- */
  const PREFIX = /^(special grade|selection grade|grade i+|grade \d)?\s*(municipal corporation|municipal council|municipal committee|municipality|nagar panchayat|nagar palika parishad|nagar palika|nagar parishad|town panchayat|town area committee|notified area council|notified area committee|cantonment board|city council|city municipal council|town municipal council)\s+/i;
  const SUFFIX = /\s+(municipal corporation|municipal council|municipality|nagar panchayat|town panchayat|cantonment board|\(.*\))$/i;
  const cleanTown = (n) => n.replace(PREFIX, '').replace(SUFFIX, '').replace(/\s+/g, ' ').trim() || n;

  async function geocode(q) {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await sleep(wait);
    lastCall = Date.now();
    try {
      const r = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&accept-language=en&q=${encodeURIComponent(q)}`);
      return r[0] ? { lat: +(+r[0].lat).toFixed(4), lon: +(+r[0].lon).toFixed(4) } : null;
    } catch (e) { return null; }
  }

  /* chain of [label, query] from most to least specific; first hit wins */
  function chain(level) {
    const S = cur.s, D = cur.dName, T = cur.tName, U = cur.uName, V = cur.vName, out = [];
    if (level === 'village' && V) { out.push(['village', `${V}, ${T}, ${D}, ${S}, India`], ['village', `${V}, ${D}, ${S}, India`]); }
    if ((level === 'urban' || level === 'ward') && U) { const c = cleanTown(U); out.push(['town', `${c}, ${D}, ${S}, India`], ['town', `${c}, ${S}, India`]); }
    if (T && ['taluk', 'urban', 'ward', 'village'].includes(level)) { out.push(['taluk', `${T}, ${D}, ${S}, India`], ['taluk', `${T} taluk, ${D}, ${S}, India`]); }
    if (D) out.push(['district', `${D} district, ${S}, India`], ['district', `${D}, ${S}, India`]);
    out.push(['state', `${S}, India`]);
    return out;
  }

  const ZOOM = { state: 6, district: 9, taluk: 10, urban: 12, ward: 13, village: 12 };

  async function go(level) {
    const my = ++token;
    showStatus('Finding the place on the map…');
    let hit = null, found = null;
    for (const [lab, q] of chain(level)) {
      hit = await geocode(q);
      if (my !== token) return;
      if (hit) { found = lab; break; }
    }
    if (!hit) { showStatus('Could not place that area on the map. Try another level or use search.', true); return; }
    const parts = [];
    if (level === 'ward') parts.push(cur.wName);
    if (level === 'village') parts.push(cur.vName);
    if (['ward', 'urban'].includes(level)) parts.push(cur.uName);
    if (level !== 'district' && level !== 'state') parts.push(cur.tName);
    if (level !== 'state') parts.push(cur.dName);
    parts.push(cur.s);
    const uniq = parts.filter((x, i) => x && parts.indexOf(x) === i);
    let note = 'India area picker';
    if (level === 'ward') note += found === 'town' ? ' (ward is shown at the town centre)' : ` (shown at the ${found} centre)`;
    else if (found !== level && !(level === 'urban' && found === 'town')) note += ` (exact spot not found, shown at the ${found} centre)`;
    setLocation(hit.lat, hit.lon, uniq.join(', '), ZOOM[level], note);
  }

  /* ---- events ---- */
  el.btn.addEventListener('click', () => {
    el.box.hidden = !el.box.hidden;
    el.btn.setAttribute('aria-expanded', String(!el.box.hidden));
    if (!el.box.hidden && el.state.options.length < 2) init();
  });
  el.close.addEventListener('click', () => { el.box.hidden = true; el.btn.setAttribute('aria-expanded', 'false'); });

  async function init() {
    try {
      const idx = await (await fetch('data/index.json')).json();
      el.state.dataset.codes = JSON.stringify(idx.map((x) => x[0]));
      fill(el.state, 'Select state', idx.map((x) => x[1] + (x[2] === 'U' ? ' (UT)' : '')), false);
    } catch (e) { showStatus('Could not load the India area list.', true); }
  }

  el.state.addEventListener('change', async () => {
    reset('district'); cur = null;
    if (el.state.value === '') return;
    const code = JSON.parse(el.state.dataset.codes)[+el.state.value];
    try {
      cur = Object.assign({}, await getState(code));
      cur.sd = stateCache[code];
      fill(el.district, 'Select district', cur.sd.d.map((d) => d[0]));
      cur.dName = cur.tName = cur.uName = cur.wName = cur.vName = '';
      go('state');
    } catch (e) { showStatus('Could not load that state. Please try again.', true); }
  });

  el.district.addEventListener('change', () => {
    reset('taluk'); if (!cur || el.district.value === '') return;
    cur.d = cur.sd.d[+el.district.value]; cur.dName = cur.d[0]; cur.tName = cur.uName = cur.wName = cur.vName = '';
    fill(el.taluk, 'Select taluk', cur.d[1].map((t) => t[0]));
    go('district');
  });

  el.taluk.addEventListener('change', () => {
    reset('urban'); if (!cur || el.taluk.value === '') return;
    cur.t = cur.d[1][+el.taluk.value]; cur.tName = cur.t[0]; cur.uName = cur.wName = cur.vName = '';
    fill(el.urban, cur.t[1].length ? 'Select town or city' : 'No towns in this taluk', cur.t[1].map((u) => u[0]));
    fill(el.village, cur.t[2].length ? 'Select village' : 'No villages listed', cur.t[2]);
    go('taluk');
  });

  el.urban.addEventListener('change', () => {
    if (!cur) return;
    fill(el.ward, 'Select ward', [], true); fill(el.village, cur.t[2].length ? 'Select village' : 'No villages listed', cur.t[2]);
    cur.wName = cur.vName = '';
    if (false) return;
    if (el.urban.value === '') { cur.uName = ''; return; }
    cur.u = cur.t[1][+el.urban.value]; cur.uName = cur.u[0];
    fill(el.ward, cur.u[1].length ? 'Select ward' : 'No wards listed', cur.u[1]);
    go('urban');
  });

  el.ward.addEventListener('change', () => {
    if (!cur || el.ward.value === '') { if (cur) cur.wName = ''; return; }
    cur.wName = cur.u[1][+el.ward.value]; go('ward');
  });

  el.village.addEventListener('change', () => {
    if (!cur || el.village.value === '') { if (cur) cur.vName = ''; return; }
    cur.vName = cur.t[2][+el.village.value];
    cur.uName = cur.wName = ''; el.urban.value = ''; fill(el.ward, 'Select ward', [], true);
    go('village');
  });
})();
