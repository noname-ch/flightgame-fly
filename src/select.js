// The start screen of Fly it yourself (FG.flySelect.open, called by FG.pilot.open): pick
//   - the aircraft from a gallery (pictures in the chosen livery, maker filter, search),
//   - the airport by code, name or city, or on a small map, then its runway,
//   - where to start: lined up on the runway, on final at a distance, or taking over a plane of yours in the air,
//   - a destination and cruise level for the flight plan (the FMGC's MCDU),
//   - the livery, the time of day (local at the airport) and the wind (the game's weather, calm, or set by hand).
// It keeps the old dialog's contract: #pilot-start, [data-ps=go] starts (src/boot.js clicks it for ?go=1).
(function () {
  'use strict';
  const G = FG.game;
  const DEG = Math.PI / 180;
  const DAY = 1440;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // what was picked last time (kept for this browser)
  const KEY = 'flightgame.fly.pick';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const keep = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* full or private */ } };

  // The livery picked here is the hand-flown plane's (view3d draws it with FG.livery(null) unless it is one of yours).
  let flyLivery = null;
  const ownLivery = FG.livery;
  FG.livery = function (p) {
    if (p == null && flyLivery && FG.pilot && FG.pilot.active) { const l = FG.liveries.find(flyLivery); if (l) return l; }
    return ownLivery.apply(this, arguments);
  };

  const GROUPS = [
    ['all', 'All'],
    ['Airbus', 'Airbus'],
    ['Boeing', 'Boeing'],
    ['props', 'Propellers'],
    ['other', 'Concorde & business'],
  ];
  const groupOf = (t) => (t.engine === 'prop' || t.engine === 'piston' ? 'props' : t.maker === 'Airbus' || t.maker === 'Boeing' ? t.maker : 'other');
  const has3d = (k) => !!(FG.cockpit3d && FG.cockpit3d.has(k));
  const hasFmgc = (t) => t.law !== 'classic';
  // (the airline types have a picture in models/hangar; the others, as the Global 7500, are rendered here)
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const picture = (type, livery) => {
    const l = livery ? FG.liveries.find(livery) : null;
    const hangar = FG.data.aircraft && FG.data.aircraft[type];
    const shot = FG.planeShots && (l || !hangar ? FG.planeShots.get(type, l || FG.livery()) : null);
    return shot || (hangar ? `models/hangar/${FG.data.typeSlug(type)}.webp` : BLANK);
  };
  const airportName = (a) => `${a.city || a.name}${a.city && a.name && a.name !== a.city ? ` · ${a.name}` : ''}`;
  const timeNow = () => (FG.ui && FG.ui.time != null ? FG.ui.time : G.state.time);
  const localMin = (code, t) => ((Math.floor(G.localTime(code, t)) % DAY) + DAY) % DAY;
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const parseClock = (s) => { const m = /^(\d+):(\d+)/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  // Airports matching a search: code first, then names and cities (bigger airports first).
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const a of Object.values(G.airportByCode)) {
      const code = a.code.toLowerCase();
      let score = -1;
      if (code === q) score = 100;
      else if (code.startsWith(q)) score = 60;
      else if ((a.city || '').toLowerCase().startsWith(q)) score = 40;
      else if ((a.name || '').toLowerCase().includes(q) || (a.city || '').toLowerCase().includes(q)) score = 20;
      if (score >= 0) out.push({ a, score: score + (a.size || 0) * 2 });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 8).map((x) => x.a);
  }

  let mapObj = null;
  function open(opts0 = {}) {
    const P = FG.pilot;
    if (!P || P.active) return;
    if (!FG.view3d) return;
    let el = document.getElementById('pilot-start');
    if (el) el.remove();
    const TYPES = P.types;
    const ui = FG.ui || {};
    const t0 = timeNow();
    // my planes in the air, of a type that can be flown here
    const flying = (G.state.planes || []).filter((p) => TYPES[p.type] && p.status === 'flying').map((p) => ({ p, st: G.flightState(p, t0) }))
      .filter(({ st }) => st && !st.ground && !['boarding', 'pushback'].includes(st.phase) && !String(st.phase).startsWith('taxi'));
    const want = opts0.plane || ui.selectedPlane;
    const pick = {
      type: TYPES[opts0.type] ? opts0.type : TYPES[saved.type] ? saved.type : 'A320',
      code: opts0.from && G.airportByCode[opts0.from] ? opts0.from : saved.code && G.airportByCode[saved.code] && !opts0.plane ? saved.code : P.defaultAirport(),
      end: null,
      mode: opts0.mode === 'final' ? 'final' : opts0.mode === 'takeover' && flying.length ? 'takeover' : 'runway',
      finalNm: saved.finalNm || 0,
      plane: (flying.find(({ p }) => String(p.id) === String(want)) || flying[0] || {}).p || null,
      to: opts0.to || '', crz: opts0.crz || saved.crz || 340,
      livery: saved.livery || '', time: saved.time || 'now', hour: saved.hour != null ? saved.hour : 12 * 60,
      wind: saved.wind || 'game', windFrom: saved.windFrom != null ? saved.windFrom : 270, windKt: saved.windKt != null ? saved.windKt : 15,
      group: 'all', q: '',
    };
    if (pick.plane && opts0.mode === 'takeover') pick.type = pick.plane.type;

    el = document.createElement('div');
    el.id = 'pilot-start';
    el.className = 'fs';
    el.innerHTML = `<div class="fs-card" role="dialog" aria-modal="true" aria-label="Fly it yourself">
      <header class="fs-head">
        <h2>✈ Fly it yourself</h2>
        <span class="fs-sub">Each aircraft flies in its own way, in real time, in the game's world.</span>
        ${FG.fly && FG.fly.backUrl ? `<a class="fs-back" href="${esc(FG.fly.backUrl)}">← Back to Flightgame</a>` : ''}
      </header>
      <div class="fs-body">
        <section class="fs-planes">
          <h3>Aircraft</h3>
          <div class="fs-filter">
            ${GROUPS.map(([k, n]) => `<button data-fs-group="${k}">${n}</button>`).join('')}
            <input id="fs-q" type="search" placeholder="Search…" spellcheck="false" autocomplete="off">
          </div>
          <div class="fs-gallery" id="fs-gallery"></div>
          <p class="fs-blurb" id="fs-blurb"></p>
        </section>
        <section class="fs-where">
          <h3>Airport</h3>
          <div class="fs-ap">
            <input id="ps-ap" spellcheck="false" autocomplete="off" placeholder="Code, city or name">
            <span id="fs-ap-name" class="fs-muted"></span>
            <div id="fs-suggest" class="fs-suggest" hidden></div>
          </div>
          <div id="fs-map" class="fs-map"></div>
          <div class="fs-rw" id="ps-rw"></div>
          <h3>Start</h3>
          <div class="fs-modes">
            <label class="fs-mode"><input type="radio" name="ps-mode" value="runway"> <b>On the runway</b><span>Lined up, ready for take-off</span></label>
            <label class="fs-mode"><input type="radio" name="ps-mode" value="final"> <b>On final</b><span>On the ILS, gear up, <select id="fs-final"></select></span></label>
            <label class="fs-mode${flying.length ? '' : ' off'}"><input type="radio" name="ps-mode" value="takeover"${flying.length ? '' : ' disabled'}> <b>Take over</b><span>${flying.length ? `<select id="fs-plane">${flying.map(({ p, st }) => `<option value="${esc(p.id)}">${esc(p.reg || p.name || p.type)} · ${esc(p.type)} · ${esc(p.flight ? `${p.flight.from}→${p.flight.to}` : '')} · ${Math.round(st.altFt / 100) * 100} ft</option>`).join('')}</select>` : 'none of your planes is in the air'}</span></label>
          </div>
          <div class="fs-row">
            <label>Destination <input id="ps-to" maxlength="4" spellcheck="false" autocomplete="off" placeholder="optional"></label>
            <label>Cruise <select id="ps-crz">${[100, 150, 200, 250, 280, 300, 320, 340, 360, 380, 390, 410, 450, 550].map((f) => `<option value="${f}">FL${f}</option>`).join('')}</select></label>
          </div>
          <p class="fs-muted" id="ps-route"></p>
        </section>
        <section class="fs-more">
          <h3>Livery</h3>
          <select id="fs-livery"></select>
          <h3>Time of day <span class="fs-muted" id="fs-clock"></span></h3>
          <div class="fs-chips" id="fs-time">
            <button data-time="now">Now</button><button data-time="dawn">Sunrise</button><button data-time="day">Midday</button>
            <button data-time="dusk">Sunset</button><button data-time="night">Night</button><button data-time="set">Set</button>
          </div>
          <input id="fs-hour" type="range" min="0" max="1425" step="15">
          <h3>Wind <span class="fs-muted" id="fs-wx"></span></h3>
          <div class="fs-chips" id="fs-wind">
            <button data-wind="game">Game weather</button><button data-wind="calm">Calm</button><button data-wind="set">Set</button>
          </div>
          <div class="fs-row" id="fs-windset">
            <label>From <input id="fs-wfrom" type="number" min="0" max="359" step="10">°</label>
            <label>Speed <input id="fs-wkt" type="number" min="0" max="60" step="1"> kt</label>
          </div>
          <p class="fs-muted" id="fs-xwind"></p>
          <h3>Scenery <span class="fs-muted" id="fs-scn"></span></h3>
          <div class="fs-chips"><button data-fs-scenery="1" title="Pick an area on a map whose 3D ground is fetched ahead: sharp and there at once when you fly over it, even offline">🗺 Prepare an area…</button></div>
        </section>
      </div>
      <footer class="fs-foot">
        <p class="ps-err" id="ps-err"></p>
        <p class="ps-keys">U autopilot · O FCU · Y MCDU · ↑↓ pitch · ←→ roll · PgUp/PgDn or +/− thrust · 1-4 detents · G gear · F flaps · Space brakes · R reverse · L limiter · C camera · H all keys</p>
        <div class="row"><button data-ps="no">Cancel</button><button class="primary" data-ps="go">Fly</button></div>
      </footer>
    </div>`;
    document.body.appendChild(el);
    const $ = (sel) => el.querySelector(sel);
    const err = $('#ps-err');

    // ---------- aircraft ----------
    function gallery() {
      const q = pick.q.trim().toLowerCase();
      const list = Object.entries(TYPES).filter(([k, t]) => (pick.group === 'all' || groupOf(t) === pick.group)
        && (!q || k.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || (t.maker || '').toLowerCase().includes(q)));
      $('#fs-gallery').innerHTML = list.map(([k, t]) => `<button class="fs-plane${k === pick.type ? ' on' : ''}" data-type="${esc(k)}" title="${esc(t.blurb || '')}">
          <img src="${esc(picture(k, pick.livery))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <b>${esc(t.name)}</b>
          <span>${t.engines} × ${t.engine === 'piston' ? 'piston' : t.engine === 'prop' ? 'turboprop' : t.engine === 'sst' ? 'reheat' : 'jet'}${t.law === 'airbus' ? ' · fly-by-wire' : ''}</span>
          <i>${hasFmgc(t) ? '<em>autopilot</em>' : ''}${has3d(k) ? '<em>3D cockpit</em>' : ''}</i>
        </button>`).join('') || '<p class="fs-muted">No aircraft match.</p>';
      el.querySelectorAll('[data-fs-group]').forEach((b) => b.classList.toggle('on', b.dataset.fsGroup === pick.group));
      const t = TYPES[pick.type];
      $('#fs-blurb').textContent = t ? `${t.name}: ${t.blurb || ''}` : '';
    }
    // pictures in a livery are rendered in the background: show them when they come
    const shotsTimer = setInterval(() => {
      if (!document.body.contains(el)) { clearInterval(shotsTimer); return; }
      el.querySelectorAll('.fs-plane img').forEach((img) => {
        const k = img.parentElement.dataset.type;
        const url = picture(k, pick.livery);
        if (img.getAttribute('src') !== url) { img.style.visibility = ''; img.src = url; }
      });
    }, 1500);

    // ---------- airport, map and runway ----------
    const ap = $('#ps-ap');
    const need = () => { const t = TYPES[pick.type]; return t.engine === 'piston' ? 600 : t.engine === 'prop' ? 1200 : t.toMass > 150000 ? 2500 : 1800; };
    let ends = [];
    function runways(keepEnd) {
      const code = pick.code;
      const a = G.airportByCode[code];
      $('#fs-ap-name').textContent = a ? `${airportName(a)}${a.country ? `, ${a.country}` : ''}` : '';
      const n = need();
      ends = a ? P.ends(code).filter((e) => e.len >= Math.min(800, n)) : [];
      const prev = keepEnd && pick.end && ends.find((e) => e.name === pick.end.name && Math.abs(e.len - pick.end.len) < 1);
      pick.end = prev || (ends.length ? P.bestEnd(ends, code) : null);
      const w = windHere();
      $('#ps-rw').innerHTML = ends.length ? ends.map((e, i) => {
        const head = w ? Math.cos((w.from - e.course) * DEG) * w.kt : 0;
        const cross = w ? Math.abs(Math.sin((w.from - e.course) * DEG) * w.kt) : 0;
        const note = e.len < n ? '<em class="bad">short!</em>' : w && w.kt >= 3 ? (head >= 0 ? `<em>${Math.round(head)} kt head</em>` : `<em class="bad">${Math.round(-head)} kt tail</em>`) + (cross >= 5 ? `<em>${Math.round(cross)} kt cross</em>` : '') : '';
        return `<button data-rw="${i}" class="${e === pick.end ? 'on' : ''}"><b>${esc(e.name)}</b><span>${Math.round(e.len).toLocaleString()} m</span>${note}</button>`;
      }).join('') : `<p class="fs-muted">${a ? 'No runways known there.' : 'Type an airport, or click one on the map.'}</p>`;
      if (opts0.rw && !keepEnd) {
        const e = ends.find((x) => x.name === opts0.rw);
        if (e) { pick.end = e; el.querySelectorAll('[data-rw]').forEach((b) => b.classList.toggle('on', ends[Number(b.dataset.rw)] === e)); }
      }
      route(); clock(); weather();
    }
    function setAirport(code, fly) {
      if (!G.airportByCode[code]) return;
      pick.code = code;
      ap.value = code;
      $('#fs-suggest').hidden = true;
      runways(false);
      if (mapObj) {
        const a = G.airportByCode[code];
        if (fly) mapObj.setView([a.lat, a.lon], Math.max(mapObj.getZoom(), 6)); else mapObj.panTo([a.lat, a.lon]);
        markers();
      }
    }
    ap.addEventListener('input', () => {
      const code = ap.value.trim().toUpperCase();
      const hits = search(ap.value);
      const box = $('#fs-suggest');
      box.innerHTML = hits.map((a) => `<button data-ap="${esc(a.code)}"><b>${esc(a.code)}</b> ${esc(airportName(a))}<span>${esc(a.country || '')}</span></button>`).join('');
      box.hidden = !hits.length;
      if (G.airportByCode[code] && code !== pick.code && code.length >= 3) { pick.code = code; runways(false); if (mapObj) { const a = G.airportByCode[code]; mapObj.panTo([a.lat, a.lon]); markers(); } }
    });
    ap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('#fs-suggest').hidden) { const b = $('#fs-suggest button'); if (b) { e.preventDefault(); e.stopPropagation(); setAirport(b.dataset.ap, true); } }
    });

    // the small map: airports as dots (big ones zoomed out, all of them zoomed in), a click picks one
    let layer = null;
    function markers() {
      if (!mapObj) return;
      if (layer) layer.clearLayers(); else layer = L.layerGroup().addTo(mapObj);
      const z = mapObj.getZoom();
      const b = mapObj.getBounds().pad(0.1);
      const min = z < 4 ? 5 : z < 6 ? 4 : z < 7 ? 3 : z < 8 ? 2 : 0;
      let n = 0;
      for (const a of Object.values(G.airportByCode)) {
        if (a.code !== pick.code && ((a.size || 0) < min || !b.contains([a.lat, a.lon]))) continue;
        if (++n > 900 && a.code !== pick.code) continue;
        const on = a.code === pick.code;
        L.circleMarker([a.lat, a.lon], { radius: on ? 7 : 2 + Math.min(4, a.size || 1), weight: on ? 2 : 1, color: on ? '#ffb000' : '#7fd4ff', fillOpacity: on ? 0.9 : 0.6 })
          .bindTooltip(`${a.code} · ${airportName(a)}`).on('click', () => setAirport(a.code, false)).addTo(layer);
      }
    }
    function makeMap() {
      if (!window.L) { $('#fs-map').hidden = true; return; }
      const a = G.airportByCode[pick.code] || { lat: 47, lon: 8 };
      mapObj = L.map($('#fs-map'), { zoomControl: true, attributionControl: false, worldCopyJump: true }).setView([a.lat, a.lon], 6);
      // (the game's own tiles: Esri's dark grey canvas, its labels on top)
      const esri = (svc) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
      L.tileLayer(esri('Canvas/World_Dark_Gray_Base'), { maxZoom: 12, maxNativeZoom: 16 }).addTo(mapObj);
      L.tileLayer(esri('Canvas/World_Dark_Gray_Reference'), { maxZoom: 12, maxNativeZoom: 16 }).addTo(mapObj);
      mapObj.on('moveend', markers);
      markers();
    }

    // ---------- start, destination ----------
    function modes() {
      el.querySelectorAll('input[name="ps-mode"]').forEach((r) => { r.checked = r.value === pick.mode; r.closest('.fs-mode').classList.toggle('on', r.checked); });
      const tk = pick.mode === 'takeover';
      el.querySelector('.fs-where').classList.toggle('takeover', tk);
      if (tk && pick.plane && TYPES[pick.plane.type] && pick.type !== pick.plane.type) { pick.type = pick.plane.type; gallery(); }
      clock();
    }
    const finalSel = $('#fs-final');
    function finals() {
      const def = TYPES[pick.type].finalNm || 10;
      finalSel.innerHTML = [3, 5, 8, 10, 15, 20].map((nm) => `<option value="${nm}"${nm === (pick.finalNm || def) ? ' selected' : ''}>${nm} NM out${nm === def ? '' : ''}</option>`).join('');
    }
    function route() {
      const a = G.airportByCode[pick.code];
      const b = G.airportByCode[$('#ps-to').value.trim().toUpperCase()];
      $('#ps-route').textContent = a && b && a !== b ? `${a.city || a.name} → ${b.city || b.name}: ${Math.round(G.distanceKm(a, b) / 1.852)} NM great circle, waypoints named after the towns on the way` : 'With a destination the MCDU has a flight plan for the autopilot (U).';
    }

    // ---------- livery ----------
    const livSel = $('#fs-livery');
    const livs = FG.liveries.all();
    livSel.innerHTML = `<option value="">Your airline's livery</option>${livs.map((l) => `<option value="${esc(l.id)}">${esc(l.name || l.id)}</option>`).join('')}`;
    livSel.value = livs.some((l) => l.id === pick.livery) ? pick.livery : '';
    pick.livery = livSel.value;

    // ---------- time of day ----------
    function targetMin() {
      const code = pick.code;
      if (!G.airportByCode[code]) return null;
      const sun = G.sunTimes(code, timeNow()) || {};
      const rise = parseClock(sun.rise), set = parseClock(sun.set);
      switch (pick.time) {
        case 'dawn': return rise != null ? rise + 15 : 6 * 60;
        case 'day': return 12 * 60;
        case 'dusk': return set != null ? set - 20 : 18 * 60;
        case 'night': return set != null ? Math.min(23 * 60 + 30, set + 120) : 23 * 60;
        case 'set': return pick.hour;
        default: return null;
      }
    }
    function clock() {
      const code = pick.code;
      const tk = pick.mode === 'takeover';
      el.querySelectorAll('[data-time]').forEach((b) => { b.classList.toggle('on', b.dataset.time === (tk ? 'now' : pick.time)); b.disabled = tk && b.dataset.time !== 'now'; });
      const hour = $('#fs-hour');
      hour.hidden = tk || pick.time !== 'set';
      hour.value = String(pick.hour);
      if (!G.airportByCode[code]) { $('#fs-clock').textContent = ''; return; }
      const now = localMin(code, timeNow());
      const tgt = tk ? null : targetMin();
      const sun = G.sunTimes(code, timeNow()) || {};
      $('#fs-clock').textContent = `${hhmm(tgt != null ? tgt : now)} local at ${code}${tgt != null ? ` (now ${hhmm(now)})` : ''}${sun.rise ? ` · sun ${sun.rise}–${sun.set}` : ''}`;
    }

    // ---------- wind ----------
    function windHere() {
      const a = G.airportByCode[pick.code];
      if (pick.wind === 'calm') return { from: 0, kt: 0 };
      if (pick.wind === 'set') return { from: pick.windFrom, kt: pick.windKt };
      if (!a) return null;
      try { return G.windAt(a.lat, a.lon, timeNow(), 0); } catch (e) { return null; }
    }
    function weather() {
      el.querySelectorAll('[data-wind]').forEach((b) => b.classList.toggle('on', b.dataset.wind === pick.wind));
      $('#fs-windset').hidden = pick.wind !== 'set';
      $('#fs-wfrom').value = String(pick.windFrom); $('#fs-wkt').value = String(pick.windKt);
      const w = windHere();
      const a = G.airportByCode[pick.code];
      let wx = '';
      try { const x = a && G.airportWeather(a.code); if (x && pick.wind === 'game' && x.name) wx = `${x.icon ? `${x.icon} ` : ''}${x.name}, ${Math.round(x.tempC)} °C`; } catch (e) { /* */ }
      $('#fs-wx').textContent = w ? (w.kt < 1 ? 'calm' : `${String(Math.round(w.from)).padStart(3, '0')}° at ${Math.round(w.kt)} kt${w.gusty ? ', gusty' : ''}`) + (wx ? ` · ${wx}` : '') : '';
      const e = pick.end;
      $('#fs-xwind').textContent = w && e && w.kt >= 1 ? `Runway ${e.name}: ${Math.round(Math.cos((w.from - e.course) * DEG) * w.kt)} kt headwind, ${Math.round(Math.abs(Math.sin((w.from - e.course) * DEG) * w.kt))} kt crosswind. In the air the plane drifts with it: crab into a crosswind.` : '';
    }
    // a wind set here is placed round the airport (as the game's developer tools place one), and taken away again
    let placed = null;
    function applyWind() {
      const s = G.state;
      if (!Array.isArray(s.winds)) s.winds = [];
      if (placed != null) { G.removeWind(placed); placed = null; }
      const a = G.airportByCode[pick.code];
      if (!a || pick.wind === 'game') return;
      const kt = pick.wind === 'calm' ? 0 : pick.windKt;
      if (G.placeWind(a.lat, a.lon, pick.wind === 'calm' ? 0 : pick.windFrom, kt, 400) === null) placed = s.winds.reduce((m, w) => Math.max(m, w.id), 0);
    }
    function applyTime() {
      if (pick.mode === 'takeover') return;
      const tgt = targetMin();
      if (tgt == null) return;
      const ahead = ((tgt - localMin(pick.code, timeNow())) % DAY + DAY) % DAY;
      if (ahead >= 1) G.advance(Math.round(ahead)); // (the world goes on to then: never back, never saved)
      G.dirty = true;
    }

    // ---------- wiring ----------
    // (prepared scenery, the game's js/scenery.js: what is kept and what is being fetched)
    const scenery = () => { const s = $('#fs-scn'); if (s && FG.scenery) s.textContent = FG.scenery.status(); };
    if (FG.scenery) FG.scenery.onchange = scenery;
    function close() { if (FG.scenery && FG.scenery.onchange === scenery) FG.scenery.onchange = null; clearInterval(shotsTimer); if (mapObj) { mapObj.remove(); mapObj = null; layer = null; } el.remove(); }
    function go() {
      err.textContent = '';
      const type = pick.type;
      const crz = Number($('#ps-crz').value);
      const dest = $('#ps-to').value.trim().toUpperCase();
      if (dest && !G.airportByCode[dest]) { err.textContent = 'No destination airport with that code.'; return; }
      keep({ type, code: pick.code, finalNm: pick.finalNm, crz, livery: pick.livery, time: pick.time, hour: pick.hour, wind: pick.wind, windFrom: pick.windFrom, windKt: pick.windKt });
      flyLivery = pick.livery || null;
      if (pick.mode === 'takeover') {
        const p = pick.plane;
        const st = p && G.flightState(p, timeNow());
        if (!st || st.ground) { err.textContent = 'That plane is not in the air any more.'; return; }
        flyLivery = null; // (your own plane: its own livery)
        applyWind();
        close();
        P.start({ type: p.type, mode: 'takeover', plane: p, state: st, to: p.flight && p.flight.to, crz });
        return;
      }
      if (!pick.end) { err.textContent = 'Pick an airport with a runway.'; return; }
      applyTime();
      applyWind();
      close();
      P.start({ type, mode: pick.mode, end: pick.end, finalNm: pick.mode === 'final' ? Number(finalSel.value) : 0, to: dest || null, crz });
    }
    el.addEventListener('click', (e) => {
      const t = e.target;
      const b = t.closest('button');
      if (t === el || (b && b.dataset.ps === 'no')) { close(); return; }
      if (!b) return;
      if (b.dataset.ps === 'go') go();
      else if (b.dataset.type) { pick.type = b.dataset.type; if (pick.mode === 'takeover') pick.mode = 'runway'; gallery(); finals(); runways(true); modes(); }
      else if (b.dataset.fsGroup) { pick.group = b.dataset.fsGroup; gallery(); }
      else if (b.dataset.ap) setAirport(b.dataset.ap, true);
      else if (b.dataset.rw) { pick.end = ends[Number(b.dataset.rw)]; el.querySelectorAll('[data-rw]').forEach((x) => x.classList.toggle('on', x === b)); weather(); }
      else if (b.dataset.time) { pick.time = b.dataset.time; clock(); }
      else if (b.dataset.wind) { pick.wind = b.dataset.wind; runways(true); }
      else if (b.dataset.fsScenery && FG.scenery) FG.scenery.open({ code: pick.code });
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'ps-mode') { pick.mode = t.value; modes(); }
      else if (t.id === 'fs-plane') { pick.plane = (flying.find(({ p }) => String(p.id) === t.value) || {}).p || null; pick.mode = 'takeover'; modes(); }
      else if (t.id === 'fs-final') { pick.finalNm = Number(t.value); pick.mode = 'final'; modes(); }
      else if (t.id === 'fs-livery') { pick.livery = t.value; gallery(); }
    });
    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'fs-q') { pick.q = t.value; gallery(); }
      else if (t.id === 'fs-hour') { pick.hour = Number(t.value); clock(); }
      else if (t.id === 'fs-wfrom' || t.id === 'fs-wkt') {
        pick.windFrom = ((Number($('#fs-wfrom').value) || 0) % 360 + 360) % 360;
        pick.windKt = Math.max(0, Math.min(60, Number($('#fs-wkt').value) || 0));
        runways(true);
      } else if (t.id === 'ps-to') route();
    });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (the game's keys wait while choosing)
      if (e.key === 'Escape') { if (!$('#fs-suggest').hidden) $('#fs-suggest').hidden = true; else close(); }
      else if (e.key === 'Enter' && e.target.id !== 'ps-ap' && e.target.tagName !== 'BUTTON') go();
    });

    if (pick.plane) { const s = $('#fs-plane'); if (s) s.value = String(pick.plane.id); }
    if (opts0.to) $('#ps-to').value = opts0.to;
    $('#ps-crz').value = String(pick.crz);
    if (!$('#ps-crz').value) $('#ps-crz').value = '340';
    ap.value = pick.code;
    gallery(); finals(); runways(false); modes(); scenery();
    makeMap();
    setTimeout(() => { if (mapObj) mapObj.invalidateSize(); }, 50);
  }

  FG.flySelect = { open };
})();
