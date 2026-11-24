// FMGC: the A320's flight guidance in one place: autopilot (AP1/AP2), flight directors, autothrust modes and a
// flight plan, flown on top of the physics in src/pilot.js. The FCU panel (src/fcu.js) and the MCDU (src/mcdu.js)
// only call into this file.
//
// How the autopilot flies: each physics step (FG.pilot calls control(dt) before physics(dt)) it works out the
// flight path angle (gamma, °) and the bank (°) the active modes want, then moves the stick and the roll input as
// a pilot would. The stick input means a pitch rate on the Airbus law and an angle-of-attack rate on the
// conventional one (src/pilot.js), so the pitch loop is written for both.
//
// Modes as on the A320's FMA (flight mode annunciator):
//   thrust:   SPEED / MACH, THR CLB, THR IDLE, MAN TOGA / MAN FLX / MAN THR, A.FLOOR
//   vertical: SRS, CLB, OP CLB, DES, OP DES, EXP CLB, EXP DES, ALT*, ALT, V/S, FPA, G/S*, G/S
//   lateral:  RWY, RWY TRK, HDG, TRK, NAV, LOC*, LOC
//   common:   LAND, FLARE, ROLL OUT
// In the speed-on-elevator modes (SRS, CLB, OP CLB, DES, OP DES, EXPED) the thrust is fixed (climb or idle) and the
// path is picked from the thrust left over: sin(gamma) = (T - D) / W - (the acceleration wanted) / g.
(function () {
  'use strict';
  const G = FG.game;
  const P = FG.pilot;
  const A = P.api;
  const { KT, FT, DEG } = A;
  const G0 = 9.80665, R_NM = 3440.065;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap360 = (d) => ((d % 360) + 360) % 360;
  const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);
  const R = Math.PI / 180;

  // ---------- great circles (NM, degrees) ----------
  function gcDist(a, b) {
    const dLat = (b.lat - a.lat) * R, dLon = (b.lon - a.lon) * R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function gcBrg(a, b) {
    const y = Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R);
    const x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R);
    return wrap360(Math.atan2(y, x) / R);
  }
  function gcMove(a, brg, nm) {
    const d = nm / R_NM, t = brg * R, la = a.lat * R, lo = a.lon * R;
    const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
    const lon = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
    return { lat: lat / R, lon: ((lon / R + 540) % 360) - 180 };
  }
  function gcInterp(a, b, f) {
    const d = gcDist(a, b);
    return d < 1e-6 ? { lat: a.lat, lon: a.lon } : gcMove(a, gcBrg(a, b), d * f);
  }
  // Cross-track (NM, + right of the course a→b) and along-track distance (NM from a) of p.
  function xtrack(a, b, p) {
    const d13 = gcDist(a, p) / R_NM;
    const t = (gcBrg(a, p) - gcBrg(a, b)) * R;
    const dxt = Math.asin(clamp(Math.sin(d13) * Math.sin(t), -1, 1));
    const at = Math.acos(clamp(Math.cos(d13) / Math.max(1e-9, Math.cos(dxt)), -1, 1)) * Math.sign(Math.cos(t) || 1);
    return { xtk: dxt * R_NM, along: at * R_NM };
  }

  // ---------- state ----------
  const F = {
    on: false, ap1: false, ap2: false, fd: true, ls: true,
    fcu: { hdg: 0, alt: 5000, altInc: 1000, vs: 0, fpa: 0, trkFpa: false, spdPreset: null, hdgPreset: null, presetAt: 0, visible: true },
    lat: null, latArm: null, vert: null, vertArm: null, appr: false, locBtn: false, exped: false,
    altMgd: false, hdgMgd: false, plan: null, cmd: { bank: null, gamma: null }, abrk: null, abrkOn: false,
    nd: { mode: 'ARC', range: 40, arpt: true }, phase: 'PREFLIGHT', capVs: 1000, msgs: [],
  };
  const s = P.state;
  const apOn = () => F.ap1 || F.ap2;
  const altFt = () => s.h / FT;
  const say = (t, lvl, ms) => A.say(t, lvl, ms);

  const SPEED_ELEV = ['SRS', 'CLB', 'OP CLB', 'DES', 'OP DES', 'EXP CLB', 'EXP DES'];
  const CLIMBS = ['CLB', 'OP CLB', 'EXP CLB'], DESCENTS = ['DES', 'OP DES', 'EXP DES'];
  const LANDING = ['LAND', 'FLARE', 'ROLL OUT'];

  function setLat(m) {
    if (F.lat === m) return;
    F.lat = m; F.latAt = performance.now();
    if (!['LOC*', 'LOC', 'LAND', 'FLARE', 'ROLL OUT'].includes(m)) F.locEnd = null;
  }
  function setVert(m, opts = {}) {
    if (F.vert === m && !opts.force) return;
    F.vert = m; F.vertAt = performance.now();
    if (m === 'V/S' && opts.vs != null) F.fcu.vs = Math.round(opts.vs / 100) * 100;
    if (m === 'FPA' && opts.fpa != null) F.fcu.fpa = Math.round(opts.fpa * 10) / 10;
    if (m !== 'EXP CLB' && m !== 'EXP DES') F.exped = false;
  }

  // ---------- the flight plan ----------
  // Waypoints: the runway, a fix on the climb-out, then towns along the great circle (named after them, as the
  // game's own towns and cities: js/data/towns.js, cities.js), then the approach to the runway the wind favours.
  let towns = null;
  function townList() {
    if (towns) return towns;
    towns = (FG.data.towns || []).map((t) => (Array.isArray(t) ? { name: t[0], lat: t[2], lon: t[3], pop: t[4] } : t))
      .filter((t) => t && isFinite(t.lat) && isFinite(t.lon) && (t.pop || 0) >= 20000);
    return towns;
  }
  const ident = (name) => (name || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5) || 'WPT';
  function nearestTown(p, maxNm, used) {
    let best = null, bd = maxNm;
    const dLat = maxNm / 60, dLon = maxNm / (60 * Math.max(0.15, Math.cos(p.lat * R)));
    for (const t of townList()) {
      if (Math.abs(t.lat - p.lat) > dLat || Math.abs(wrap180(t.lon - p.lon)) > dLon) continue;
      const id = ident(t.name);
      if (used.has(id)) continue;
      // bigger towns win a little: they are the names a pilot would know
      const d = gcDist(p, t) / (1 + Math.log10(Math.max(1, t.pop / 20000)) * 0.25);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  const llIdent = (p) => `${p.lat >= 0 ? 'N' : 'S'}${String(Math.round(Math.abs(p.lat))).padStart(2, '0')}${p.lon >= 0 ? 'E' : 'W'}${String(Math.round(Math.abs(p.lon))).padStart(3, '0')}`;

  // from: airport code or null (then `pos` is where it starts: present position); depEnd/arrEnd: runway ends
  function buildPlan({ from, to, crz, depEnd, pos, approachOnly, arrEnd }) {
    const B = G.airportByCode[to];
    if (!B) return null;
    const arrEnds = P.runwayEnds(to);
    arrEnd = arrEnd || (arrEnds.length ? P.bestEnd(arrEnds, to) : null);
    const wps = [];
    const used = new Set();
    const add = (id, p, kind, extra) => { used.add(id); wps.push({ id, lat: p.lat, lon: p.lon, kind, ...extra }); };
    const Aap = from && G.airportByCode[from];
    let startPt;
    if (!approachOnly) {
      if (Aap) {
        const ends = P.runwayEnds(from);
        depEnd = depEnd || (ends.length ? P.bestEnd(ends, from) : null);
        if (depEnd) {
          add(`RW${depEnd.name}`, depEnd, 'rwy', { course: depEnd.course });
          const far = { lat: depEnd.far[0], lon: depEnd.far[1] };
          startPt = gcMove(far, depEnd.course, 5);
          add(`${from.slice(0, 3)}${depEnd.name}`.slice(0, 5), startPt, 'fix');
        } else { startPt = { lat: Aap.lat, lon: Aap.lon }; add(from, startPt, 'apt'); }
      } else {
        startPt = { lat: pos.lat, lon: pos.lon };
        add('PPOS', startPt, 'ppos');
      }
    }
    // the approach: 15 NM and 5 NM on the extended centre line, then the threshold
    const thr = arrEnd ? { lat: arrEnd.lat, lon: arrEnd.lon } : { lat: B.lat, lon: B.lon };
    const back = arrEnd ? wrap360(arrEnd.course + 180) : 0;
    const ci = arrEnd ? gcMove(thr, back, 15) : null, ff = arrEnd ? gcMove(thr, back, 5) : null;
    if (!approachOnly && startPt) {
      const end = ci || thr;
      const D = gcDist(startPt, end);
      const step = clamp(D / 10, 35, 150);
      const n = Math.floor(D / step);
      for (let i = 1; i < n; i++) {
        const p = gcInterp(startPt, end, i / n);
        const t = nearestTown(p, step * 0.4, used);
        if (t) add(ident(t.name), t, 'wpt', { town: t.name });
        else { const id = llIdent(p); if (!used.has(id)) add(id, p, 'wpt'); }
      }
    }
    if (arrEnd) {
      // coming in from the far side of the airport: a downwind (abeam the threshold, then abeam the 15 NM point,
      // 5 NM to the side it comes from) and a base turn, instead of a U-turn onto the final
      const prev = wps[wps.length - 1] || pos;
      if (prev && Math.abs(wrap180(arrEnd.course - gcBrg(prev, ci))) > 100) {
        const side = xtrack(ci, thr, prev).xtk >= 0 ? 90 : -90;
        add(`DW${arrEnd.name}`, gcMove(gcMove(thr, arrEnd.course, 2), arrEnd.course + side, 5), 'app');
        add(`BS${arrEnd.name}`, gcMove(ci, arrEnd.course + side, 5), 'app');
      }
      add(`CI${arrEnd.name}`, ci, 'app');
      add(`FF${arrEnd.name}`, ff, 'app');
      add(`RW${arrEnd.name}`, thr, 'thr', { course: arrEnd.course });
    } else add(to, thr, 'thr');
    const plan = { from: from || null, to, crz: crz || 340, depEnd, arrEnd, wps, active: Math.min(1, wps.length - 1), legFrom: null, arrElev: 0, depElev: 0 };
    predict(plan);
    // the runways' heights (for the descent path and the glide slope)
    if (FG.flat) {
      const pts = [[thr.lat, thr.lon]];
      if (depEnd) pts.push([depEnd.lat, depEnd.lon]);
      FG.flat.heightsAt(pts, 12).then((h) => {
        if (h[0] != null) { plan.arrElev = h[0] / FT; if (arrEnd) arrEnd.h = arrEnd.h ?? h[0]; }
        if (h[1] != null) plan.depElev = h[1] / FT;
        predict(plan);
      }, () => {});
    }
    return plan;
  }
  // Each waypoint's distance from the start and the predicted altitude (climb about 300 ft/NM, descent on 3°:
  // 318 ft/NM), the top of climb and top of descent.
  function predict(plan) {
    let x = 0;
    plan.wps.forEach((w, i) => { if (i) x += gcDist(plan.wps[i - 1], w); w.cum = x; });
    plan.total = x;
    const crzFt = plan.crz * 100;
    for (const w of plan.wps) {
      const clb = plan.depElev + w.cum * 300, des = plan.arrElev + 50 + (plan.total - w.cum) * 318;
      w.alt = Math.round(Math.min(crzFt, clb, des) / 10) * 10;
    }
    plan.toc = (crzFt - plan.depElev) / 300;
    plan.tod = plan.total - (crzFt - plan.arrElev) / 318;
  }
  // Distance to go: to the active waypoint, then along the rest.
  function dtg() {
    const p = F.plan;
    if (!p) return null;
    const w = p.wps[p.active];
    if (!w) return 0;
    return gcDist({ lat: s.lat, lon: s.lon }, w) + (p.total - w.cum);
  }
  // the altitude on the 3° path down to the destination (ft)
  const profileAlt = () => (F.plan ? F.plan.arrElev + 50 + dtg() * 318 : null);
  function activeLeg() {
    const p = F.plan;
    if (!p || p.active >= p.wps.length) return null;
    const to = p.wps[p.active];
    const from = p.legFrom || p.wps[p.active - 1] || { lat: s.lat, lon: s.lon };
    return { from, to };
  }
  function directTo(i) {
    const p = F.plan;
    if (!p || i < 0 || i >= p.wps.length) return;
    p.active = i;
    p.legFrom = null; p.turning = true; // (straight at it: the leg starts where the turn toward it ends)
    if (apOn() || F.fd) setLat('NAV');
    F.hdgMgd = true;
  }
  // Sequence the waypoints: the next one once inside the turn's lead (or past the waypoint).
  function sequence() {
    const p = F.plan;
    const leg = activeLeg();
    if (!leg) return;
    const here = { lat: s.lat, lon: s.lon };
    const x = xtrack(leg.from, leg.to, here);
    const len = gcDist(leg.from, leg.to);
    const next = p.wps[p.active + 1];
    let lead = 0.3;
    if (next) {
      const turn = Math.abs(wrap180(gcBrg(leg.to, next) - gcBrg(leg.from, leg.to)));
      const rNm = (s.V * s.V) / (G0 * Math.tan(25 * R)) / 1852;
      // fly-by up to 100°, beyond that it flies over the waypoint and then turns
      lead = turn <= 100 ? Math.min(6, rNm * Math.tan(turn * R / 2)) + 0.2 : 0.3;
    }
    if (len - x.along < lead && p.active < p.wps.length - 1) {
      p.active++;
      // past a fly-over (a turn of more than 100°): turn straight toward the next one (navTrack), and the leg starts
      // where the turn ends, instead of flying back onto the old line
      p.legFrom = null; p.turning = lead < 0.5 && !!next;
    }
  }
  function navTrack() {
    const leg = activeLeg();
    if (!leg) return s.psi;
    const here = { lat: s.lat, lon: s.lon };
    const x = xtrack(leg.from, leg.to, here);
    // the leg's course where the plane is (a great circle's course changes along it), less 30° per NM off it
    const toWp = gcBrg(here, leg.to);
    if (F.plan.turning) {
      if (Math.abs(wrap180(toWp - s.psi)) > 15) return toWp;
      F.plan.turning = false; F.plan.legFrom = here;
    }
    if (gcDist(here, leg.to) < 2) return toWp;
    const legCrs = wrap360(toWp + clamp(Math.asin(clamp(x.xtk / Math.max(0.1, gcDist(here, leg.to)), -1, 1)) / R, -60, 60));
    return wrap360(legCrs - clamp(x.xtk * 30, -45, 45));
  }

  // ---------- the ILS ----------
  // The destination runway's ILS when there is a flight plan, else the one the plane is lined up with.
  // Once the localizer is captured it stays on that runway (F.locEnd), even past it.
  function ilsTo(e) {
    const here = { lat: s.lat, lon: s.lon };
    const d = Math.max(1, gcDist(here, e) * 1852);
    const loc = wrap180(gcBrg(here, e) - e.course);
    const gs = e.h == null ? null : Math.atan2(s.h - e.h - 15, d) / DEG - 3;
    return { e, d, loc, gs };
  }
  function ils() {
    if (F.locEnd && ['LOC*', 'LOC', ...LANDING].includes(F.lat)) {
      const l = ilsTo(F.locEnd);
      if (Math.abs(l.loc) > 90) { l.loc = wrap180(l.loc + 180); l.d = -l.d; l.gs = null; } // (past the threshold: along the runway)
      return l;
    }
    // with a flight plan only the destination runway's ILS is tuned (else it would catch any runway that lines up)
    const e = F.plan && F.plan.arrEnd;
    if (e) {
      const l = ilsTo(e);
      return l.d < 50000 && l.d > 30 && Math.abs(l.loc) < 35 ? l : null;
    }
    return A.ils();
  }
  // metres left (+) of the centre line, and above (+) the glide slope
  const locDev = (l) => l.d * Math.sin(l.loc * DEG);
  const gsDev = (l) => (l.gs == null ? 0 : l.d * Math.tan(l.gs * DEG));

  // ---------- modes ----------
  let gPrev = null, gdot = 0, vPrev = null, decel = 0, retardSaid = false, tdSaid = false;
  function modes(dt) {
    const alt = altFt(), agl = A.agl(), vs = A.vsFpm(), tgt = F.fcu.alt;
    const l = (F.latArm === 'LOC' || ['LOC*', 'LOC', ...LANDING].includes(F.lat)) ? ils() : null;
    F.ilsNow = l;
    // after the take-off
    if (F.lat === 'RWY' && !s.onGround && agl > 30) {
      if (F.latArm === 'NAV' && F.plan) { F.latArm = null; setLat('NAV'); } else { setLat('RWY TRK'); F.rwyTrk = s.psi; }
    }
    if (F.vert === 'SRS' && !s.onGround && agl > 1500) {
      F.vertArm = null;
      if (tgt > alt + 250) setVert(F.altMgd && F.plan ? 'CLB' : 'OP CLB');
      else { F.capVs = Math.max(500, Math.abs(vs)); setVert('ALT*'); }
    }
    if (F.lat === 'NAV' && F.plan) sequence();
    // altitude capture: from the climbs, descents and V/S toward the FCU altitude
    if (['V/S', 'FPA', ...CLIMBS, ...DESCENTS].includes(F.vert)) {
      const err = tgt - alt;
      const toward = (vs > 50 && err > 0) || (vs < -50 && err < 0);
      if (toward && Math.abs(err) < Math.max(60, Math.abs(vs) / 4)) { F.capVs = Math.max(300, Math.abs(vs)); setVert('ALT*'); }
      else if (CLIMBS.includes(F.vert) && err < -150) setVert('V/S', { vs });
      else if (DESCENTS.includes(F.vert) && err > 150) setVert('V/S', { vs });
    }
    if (F.vert === 'ALT*' && Math.abs(tgt - alt) < 20 && Math.abs(vs) < 250) setVert('ALT');
    // top of descent: the FMGC never descends by itself; it tells the pilot
    if (F.plan && F.vert === 'ALT' && alt > F.plan.crz * 100 - 600 && profileAlt() < alt - 100 && !tdSaid) {
      tdSaid = true; say('T/D REACHED: set a lower altitude on the FCU and push the ALT knob (DES)', 'amber', 9000); A.speak('top of descent');
    }
    // the localizer and the glide slope
    if (F.latArm === 'LOC' && l && Math.abs(locDev(l)) < Math.max(600, l.d * Math.sin(2.5 * DEG)) && Math.abs(wrap180(s.psi - l.e.course)) < 100) {
      F.latArm = null; F.locEnd = l.e; setLat('LOC*');
    }
    if (F.lat === 'LOC*' && l && Math.abs(locDev(l)) < 40 && Math.abs(wrap180(s.psi - l.e.course)) < 6) setLat('LOC');
    if (F.vertArm === 'G/S' && l && l.gs != null && ['LOC*', 'LOC'].includes(F.lat) && l.gs > -0.5 && l.gs < 0.15) {
      F.vertArm = null; setVert('G/S*');
    }
    if (F.vert === 'G/S*' && l && l.gs != null && Math.abs(l.gs) < 0.08) setVert('G/S');
    if (F.vert === 'G/S' && F.lat === 'LOC' && agl < 400 && !s.onGround) { setVert('LAND'); setLat('LAND'); }
    // (heavier, slower aircraft flare higher: about 60 ft for an A320, 85 ft for a 747)
    if (F.vert === 'LAND' && agl < 30 + 40 * (s.spec.inertia || 0.8) && !s.onGround) { setVert('FLARE'); setLat('FLARE'); }
    if (F.vert === 'FLARE' && agl < 20 && !retardSaid && apOn()) {
      retardSaid = true; A.speak('retard'); say('RETARD: the autothrust brings the thrust levers to idle', 'info', 3000);
      if (s.athr && s.lever > 0) s.lever = 0; // (on the real one the pilot does it at the callout)
    }
    if ((F.vert === 'FLARE' || F.vert === 'LAND') && s.onGround) {
      setVert('ROLL OUT'); setLat('ROLL OUT');
      if (s.lever > 0 && s.athr) s.lever = 0; // (the levers come back to idle with the autothrust's retard)
    }
    // the phase (for the MCDU and the managed speed)
    const crzFt = (F.plan ? F.plan.crz : 340) * 100;
    if (s.onGround) F.phase = s.landed ? 'DONE' : 'TAKEOFF';
    else if (['G/S*', 'G/S', 'LOC*', 'LOC', ...LANDING].includes(F.vert) || ['LOC*', 'LOC'].includes(F.lat) || (F.plan && (dtg() < 20 || (F.plan.wps[F.plan.active] || {}).kind === 'app'))) F.phase = 'APPROACH';
    else if (DESCENTS.includes(F.vert) || F.phase === 'DESCENT') F.phase = DESCENTS.includes(F.vert) || alt < crzFt - 1000 ? 'DESCENT' : 'CRUISE';
    else if (alt > crzFt - 300) F.phase = 'CRUISE';
    else if (agl > 1500) F.phase = 'CLIMB';
    // the autopilot gives up when it has nothing to fly
    if (apOn() && s.onGround && s.V < 20 * KT && F.lat === 'ROLL OUT') disconnect('stopped');
  }

  // ---------- what the modes ask for: bank and flight path angle (°) ----------
  function commands() {
    const sp = s.spec, alt = altFt(), agl = A.agl();
    const hdgTo = (trk, most = 25) => clamp(wrap180(trk - s.psi) * 1.3, -most, most);
    let bank = null, gamma = null;
    const l = F.ilsNow;
    const locTrack = () => (l ? wrap360(l.e.course + clamp(locDev(l) / 1852 * 40, -30, 30)) : s.psi);
    switch (F.lat) {
      case 'RWY': case 'RWY TRK': bank = s.onGround ? null : hdgTo(F.rwyTrk || s.psi, 10); break;
      case 'HDG': case 'TRK': bank = hdgTo(F.fcu.hdg); break;
      case 'NAV': bank = hdgTo(navTrack()); break;
      case 'LOC*': case 'LOC': bank = hdgTo(locTrack()); break;
      case 'LAND': bank = hdgTo(locTrack(), 10); break;
      case 'FLARE': bank = hdgTo(locTrack(), 3); break;
      default:
    }
    const V = Math.max(30, s.V);
    const vsGamma = (fpm) => Math.asin(clamp((fpm * FT) / 60 / V, -0.4, 0.4)) / DEG;
    // noDecel: high on the descent path, it goes down first and slows down later (as the real one)
    const speedPath = (dir, noDecel) => {
      let want = clamp((A.spdTarget().kt - A.ias()) * 0.12, -0.8, 0.8) * KT; // m/s²
      if (noDecel) want = Math.max(want, 0);
      let g = Math.asin(clamp((s.TmD || 0) - want / G0, -0.35, 0.35)) / DEG;
      if (dir > 0) g = Math.max(g, 0.3); else if (dir < 0) g = Math.min(g, -0.3);
      return clamp(g, vsGamma(-6000), vsGamma(6000));
    };
    F.desSpeed = false; F.moreDrag = F.vert === 'DES' ? F.moreDrag : false;
    switch (F.vert) {
      case 'SRS': gamma = s.onGround ? null : Math.min(speedPath(1), 18 - (s.alpha || 0)); break;
      case 'CLB': case 'OP CLB': case 'EXP CLB': gamma = speedPath(1); break;
      case 'OP DES': case 'EXP DES': gamma = speedPath(-1); break;
      case 'DES': {
        const prof = profileAlt();
        if (prof != null && alt < prof - 250) { F.desSpeed = true; gamma = vsGamma(-clamp((alt - (prof - 800)) * 2, 300, 1000)); } // below the path: shallower, on SPEED
        else gamma = speedPath(-1, prof != null && alt > prof + 300);
        // above the path: idle is not enough; the speed may run up to 20 kt over, and it asks for the speed brakes
        const high = prof != null && alt > prof + 300;
        if (high && A.ias() < A.spdTarget().kt + 20) gamma = Math.min(gamma, vsGamma(-clamp((alt - prof) * 1.5, 1000, 3500)));
        F.moreDrag = high && alt > prof + 600 && s.sb < 0.5;
        if (F.moreDrag && !F.moreDragSaid) { F.moreDragSaid = true; say('MORE DRAG: above the descent path, speed brakes out (X)', 'amber', 6000); }
        if (!high) F.moreDragSaid = false;
        break;
      }
      case 'ALT*': gamma = vsGamma(clamp((F.fcu.alt - alt) * 4, -F.capVs, F.capVs)); break;
      case 'ALT': gamma = vsGamma(clamp((F.fcu.alt - alt) * 4, -1000, 1000)); break;
      case 'V/S': gamma = vsGamma(F.fcu.vs); break;
      case 'FPA': gamma = F.fcu.fpa; break;
      case 'G/S*': case 'G/S': case 'LAND':
        gamma = l && l.gs != null ? clamp(-3 - gsDev(l) / 25, -5.5, -0.5) : -3; break;
      // the flare: the sink rate eased off with the height it will have in 1.5 s (the pitch takes that long to
      // answer): about -400 ft/min at 60 ft, -80 at the wheels
      case 'FLARE': {
        const ahead = Math.max(0, agl + (A.vsFpm() / 60) * (0.5 + 1.3 * (s.spec.inertia || 0.8)));
        gamma = vsGamma(-Math.max(80, ahead * 6 + 60)); break;
      }
      default:
    }
    return { bank, gamma };
  }

  function athrMode() {
    if (!apOn() && !F.fd) return 'SPEED';
    const v = F.vert;
    if (CLIMBS.includes(v) || v === 'SRS') return 'CLB';
    if (DESCENTS.includes(v)) return v === 'DES' && F.desSpeed ? 'SPEED' : 'IDLE';
    if (v === 'FLARE' && A.agl() < 25) return 'IDLE';
    return 'SPEED';
  }

  // ---------- autobrake (LO, MED on landing; MAX for a rejected take-off) ----------
  function autobrake(dt) {
    if (!F.abrk) { F.abrkOn = false; return; }
    if (vPrev != null && dt > 0) decel += ((vPrev - s.V) / dt - decel) * (1 - Math.exp(-dt / 0.3));
    vPrev = s.V;
    if (['Space', ' ', 'b', '.'].some((k) => s.keys.has(k))) { F.abrk = null; F.abrkOn = false; say('AUTO BRK off (brake pedals)', 'amber', 2500); return; }
    const ias = A.ias();
    let on = false, target = 0;
    if (F.abrk === 'MAX') { on = s.onGround && !s.landed && s.lever <= 0.02 && ias > 72; target = 99; }
    // (it starts with the ground spoilers, at the touchdown on types without them, and brakes to a full stop)
    else { on = s.onGround && s.landed && (s.gs > 0.5 || !s.spec.groundSpoilers || F.abrkOn) && s.V > 0.5 * KT; target = F.abrk === 'LO' ? 1.7 : 3.0; }
    if (on && !F.abrkOn) F.abrkAt = performance.now();
    F.abrkOn = on;
    if (!on) { if (s.landed && s.onGround && s.V < 3 * KT && F.abrk !== 'MAX') F.abrk = null; return; }
    if (F.abrk === 'LO' && performance.now() - F.abrkAt < 4000) return; // (LO: four seconds after the spoilers)
    s.brake = target > 50 ? 1 : clamp(s.brake + (target - decel) * 0.6 * dt, 0, 1);
  }

  // ---------- each physics step ----------
  function control(dt) {
    if (!F.on || s.crashed) return;
    modes(dt);
    const cmd = commands();
    F.cmd = cmd;
    s.athrMode = athrMode();
    autobrake(dt);
    const g = s.gamma / DEG;
    if (gPrev != null && dt > 0) gdot += ((g - gPrev) / dt - gdot) * (1 - Math.exp(-dt / 0.2));
    gPrev = g;
    if (!apOn()) return;
    if (s.onGround) {
      // roll out: steer along the centre line with the nose wheel
      if (F.lat === 'ROLL OUT') {
        const l = ils() || F.ilsNow;
        const want = l ? wrap360(l.e.course + clamp(locDev(l) * 0.4, -10, 10)) : s.psi;
        s.roll = clamp(wrap180(want - s.psi) * 0.15, -0.5, 0.5);
        s.stick = s.theta > 0.5 ? -0.4 : 0; // (derotation: the nose wheel down, so it stays on the ground)
      }
      return;
    }
    const lim = F.vert === 'FLARE' ? 0.7 : 0.35;
    if (cmd.gamma != null) {
      if (A.airbus()) {
        const gref = s.gref != null ? s.gref / DEG : g;
        s.stick = clamp((cmd.gamma - gref) * 0.5, -lim, lim);
      } else {
        const flare = F.vert === 'FLARE', T = FG.fmgc.tune;
        // (a wing whose lift changes little with the angle of attack, Concorde's delta, needs more of it for the same path change)
        const wing = clamp(0.085 / (s.spec.clA || 0.085), 1, 2);
        const rate = wing * ((flare ? T.flareKp : T.kp) * (cmd.gamma - g) - (flare ? T.flareKd : T.kd) * gdot);
        s.stick = clamp(rate / (s.spec.pitchRate || 3), -lim * 1.5, lim * 1.5);
        // no protections on these: the autopilot itself never pulls closer than 3° to the stall
        if (s.aStall && s.alpha > s.aStall - 3 && s.stick > 0) s.stick = Math.min(s.stick, -0.1 * (s.alpha - (s.aStall - 3)));
      }
    } else s.stick = 0;
    if (cmd.bank != null) s.roll = clamp((cmd.bank - s.phi) * 0.07 - (s.p || 0) * 0.04, -0.35, 0.35);
    else s.roll = clamp(-s.phi * 0.07 - (s.p || 0) * 0.04, -0.35, 0.35);
    s.rud = 0;
  }

  // ---------- engaging and disconnecting ----------
  function pilotInput(pitch, roll) {
    if (!apOn() || !F.on) return;
    if (pitch || roll) disconnect('stick');
  }
  function disconnect(why) {
    if (!apOn()) return;
    F.ap1 = F.ap2 = false;
    if (why === 'stopped') { say('AP OFF', 'info', 2500); return; }
    say(why === 'stick' ? 'AP OFF: you took over with the stick' : 'AP OFF', 'red', 3500);
    FG.fmgc.sounds.cavalry();
  }
  function engage(n) {
    if (!F.on) return;
    const key = n === 2 ? 'ap2' : 'ap1', other = n === 2 ? 'ap1' : 'ap2';
    if (F[key]) { F[key] = false; if (!apOn()) { say('AP OFF', 'red', 2500); FG.fmgc.sounds.cavalry(); } return; }
    if (s.onGround || A.agl() < 100) { say('AP: engages from 100 ft after take-off. The FD bars show where to fly until then.', 'amber', 4000); return; }
    if (!F.lat || F.lat === 'RWY') { setLat(F.fcu.trkFpa ? 'TRK' : 'HDG'); F.fcu.hdg = Math.round(s.psi); F.hdgMgd = false; }
    if (!F.vert) setVert(F.fcu.trkFpa ? 'FPA' : 'V/S', { vs: A.vsFpm(), fpa: s.gamma / DEG });
    const both = F.appr && (F.vertArm === 'G/S' || ['G/S*', 'G/S', ...LANDING].includes(F.vert));
    if (!both) F[other] = false;
    F[key] = true;
    gPrev = null;
  }
  function apToggle() { if (apOn()) disconnect('button'); else engage(1); }

  // ---------- FCU knobs and buttons (src/fcu.js) ----------
  const mgdSpd = () => s.spdSel == null && s.machSel == null;
  function turn(knob, clicks, big) {
    const now = performance.now();
    if (knob === 'spd') {
      if (mgdSpd()) {
        const base = F.fcu.spdPreset ?? Math.round(A.spdTarget().kt);
        F.fcu.spdPreset = clamp(base + clicks * (big ? 10 : 1), 100, A.vmo()); F.fcu.presetAt = now;
      } else if (s.machSel != null) s.machSel = clamp(Math.round((s.machSel + clicks * (big ? 0.05 : 0.01)) * 100) / 100, 0.1, A.mmo());
      else s.spdSel = clamp(s.spdSel + clicks * (big ? 10 : 1), 100, A.vmo());
    } else if (knob === 'hdg') {
      if (F.hdgMgd || F.lat === 'NAV' || LANDING.includes(F.lat) || F.lat === 'LOC' || F.lat === 'LOC*') {
        const base = F.fcu.hdgPreset ?? Math.round(s.psi);
        F.fcu.hdgPreset = wrap360(base + clicks * (big ? 10 : 1)); F.fcu.presetAt = now;
      } else F.fcu.hdg = wrap360(Math.round(F.fcu.hdg) + clicks * (big ? 10 : 1));
    } else if (knob === 'alt') {
      const inc = big ? 1000 : F.fcu.altInc;
      F.fcu.alt = clamp(Math.round((F.fcu.alt + clicks * inc) / inc) * inc, 100, 49000);
      if (F.vert === 'ALT*') setVert('V/S', { vs: A.vsFpm() }); // (a new altitude during the capture: V/S as it is)
    } else if (knob === 'vs') {
      if (F.fcu.trkFpa) {
        if (F.vert !== 'FPA') setVert('FPA', { fpa: s.gamma / DEG });
        F.fcu.fpa = clamp(Math.round((F.fcu.fpa + clicks * 0.1) * 10) / 10, -9.9, 9.9);
      } else {
        if (F.vert !== 'V/S') setVert('V/S', { vs: A.vsFpm() });
        F.fcu.vs = clamp(F.fcu.vs + clicks * (big ? 1000 : 100), -6000, 6000);
      }
      F.vertArm = F.vertArm === 'G/S' ? 'G/S' : null;
    }
  }
  function push(knob) {
    if (knob === 'spd') { s.spdSel = null; s.machSel = null; F.fcu.spdPreset = null; }
    else if (knob === 'hdg') {
      F.fcu.hdgPreset = null;
      if (!F.plan) { say('NAV: no flight plan (MCDU INIT: FROM/TO)', 'amber', 3000); return; }
      F.hdgMgd = true;
      if (s.onGround) { F.latArm = 'NAV'; return; }
      if (F.plan.legFrom == null && F.lat !== 'NAV') F.plan.legFrom = { lat: s.lat, lon: s.lon };
      setLat('NAV');
    } else if (knob === 'alt') {
      F.altMgd = true;
      if (!F.plan) { pull('alt'); F.altMgd = false; return; }
      const err = F.fcu.alt - altFt();
      if (Math.abs(err) < 250) return;
      setVert(err > 0 ? 'CLB' : 'DES');
      if (err < 0) tdSaid = true;
    } else if (knob === 'vs') {
      // level off: V/S zero
      if (F.fcu.trkFpa) setVert('FPA', { fpa: 0, force: true }); else setVert('V/S', { vs: 0, force: true });
    }
  }
  function pull(knob) {
    if (knob === 'spd') {
      const kt = F.fcu.spdPreset ?? Math.round(A.spdTarget().kt);
      F.fcu.spdPreset = null;
      s.spdSel = kt; s.machSel = null;
    } else if (knob === 'hdg') {
      F.fcu.hdg = F.fcu.hdgPreset ?? (F.hdgMgd || F.lat === 'NAV' ? Math.round(s.psi) : F.fcu.hdg);
      F.fcu.hdgPreset = null;
      F.hdgMgd = false;
      if (['LOC*', 'LOC'].includes(F.lat)) { F.appr = false; F.locBtn = false; F.vertArm = null; if (F.vert === 'G/S*' || F.vert === 'G/S') setVert('V/S', { vs: A.vsFpm() }); }
      if (!LANDING.includes(F.lat)) setLat(F.fcu.trkFpa ? 'TRK' : 'HDG');
    } else if (knob === 'alt') {
      F.altMgd = false;
      const err = F.fcu.alt - altFt();
      if (Math.abs(err) < 250) return;
      setVert(err > 0 ? 'OP CLB' : 'OP DES');
      if (err < 0) tdSaid = true;
    } else if (knob === 'vs') {
      if (F.fcu.trkFpa) setVert('FPA', { fpa: s.gamma / DEG, force: true }); else setVert('V/S', { vs: A.vsFpm(), force: true });
    }
  }
  function press(btn) {
    switch (btn) {
      case 'AP1': engage(1); break;
      case 'AP2': engage(2); break;
      case 'ATHR':
        if (!s.spec.athr) { say(`The ${s.spec.name} has no autothrust`, 'info', 2500); break; }
        s.athr = !s.athr; s.athrN1 = null;
        if (!s.athr) { say('A/THR OFF', 'amber', 2500); FG.fmgc.sounds.chime(); }
        break;
      case 'LOC':
        if (F.locBtn || F.appr) { F.locBtn = false; F.appr = false; if (F.latArm === 'LOC') F.latArm = null; if (F.vertArm === 'G/S') F.vertArm = null; break; }
        F.locBtn = true; if (!['LOC*', 'LOC'].includes(F.lat)) F.latArm = 'LOC';
        break;
      case 'APPR':
        if (F.appr) {
          if (['G/S', 'G/S*', ...LANDING].includes(F.vert) && apOn()) { say('APPR: the glide slope is captured; disconnect or go around', 'info', 2500); break; }
          F.appr = false; F.locBtn = false; if (F.latArm === 'LOC') F.latArm = null; if (F.vertArm === 'G/S') F.vertArm = null; break;
        }
        F.appr = true; F.locBtn = false;
        if (!['LOC*', 'LOC'].includes(F.lat)) F.latArm = 'LOC';
        if (!['G/S*', 'G/S'].includes(F.vert)) F.vertArm = 'G/S';
        if (!ils() && !F.plan) say('APPR armed: fly toward a runway\'s ILS (HDG) to capture it', 'info', 3500);
        break;
      case 'EXPED': {
        if (F.exped) { F.exped = false; pull('alt'); break; }
        const err = F.fcu.alt - altFt();
        if (Math.abs(err) < 250 || s.onGround) break;
        setVert(err > 0 ? 'EXP CLB' : 'EXP DES'); F.exped = true; F.altMgd = false;
        break;
      }
      case 'SPDMACH': {
        if (mgdSpd()) break;
        const at = A.atmo(s.h), k = Math.sqrt(at.rho / 1.225);
        if (s.machSel != null) { s.spdSel = Math.round((s.machSel * at.a * k) / KT); s.machSel = null; }
        else { s.machSel = Math.round(((s.spdSel * KT) / (at.a * k)) * 100) / 100; }
        break;
      }
      case 'TRKFPA':
        F.fcu.trkFpa = !F.fcu.trkFpa;
        if (F.lat === 'HDG' || F.lat === 'TRK') setLat(F.fcu.trkFpa ? 'TRK' : 'HDG');
        if (F.vert === 'V/S' && F.fcu.trkFpa) setVert('FPA', { fpa: s.gamma / DEG });
        else if (F.vert === 'FPA' && !F.fcu.trkFpa) setVert('V/S', { vs: A.vsFpm() });
        break;
      case 'ALTINC': F.fcu.altInc = F.fcu.altInc === 1000 ? 100 : 1000; break;
      case 'FD': F.fd = !F.fd; break;
      case 'LS': F.ls = !F.ls; break;
      case 'ARPT': F.nd.arpt = !F.nd.arpt; break;
      case 'NDMODE': F.nd.mode = { ARC: 'ROSE', ROSE: 'PLAN', PLAN: 'ARC' }[F.nd.mode]; break;
      case 'RNG+': F.nd.range = Math.min(320, F.nd.range * 2); break;
      case 'RNG-': F.nd.range = Math.max(10, F.nd.range / 2); break;
      case 'BRK LO': case 'BRK MED': case 'BRK MAX': {
        const m = btn.slice(4);
        F.abrk = F.abrk === m ? null : m;
        if (m === 'MAX' && !s.onGround) { F.abrk = null; say('AUTO BRK MAX is for the take-off only', 'info', 2500); }
        break;
      }
      default:
    }
  }

  // ---------- start and stop (src/pilot.js) ----------
  function begin(opts) {
    const sp = s.spec;
    Object.assign(F, { on: sp.law !== 'classic', ap1: false, ap2: false, lat: null, latArm: null, vert: null, vertArm: null,
      appr: false, locBtn: false, exped: false, altMgd: false, hdgMgd: false, plan: null, abrk: null, abrkOn: false, phase: 'TAKEOFF',
      locEnd: null, moreDrag: false, moreDragSaid: false });
    F.fcu.spdPreset = F.fcu.hdgPreset = null; F.fcu.vs = 0; F.fcu.fpa = 0;
    s.machSel = null; s.athrMode = 'SPEED';
    gPrev = null; gdot = 0; vPrev = null; decel = 0; retardSaid = false; tdSaid = false;
    if (!F.on) { FG.fmgc.panels(false); return; }
    const e = opts.end;
    const crz = opts.crz || 340;
    try {
      if (opts.mode === 'final' && e) F.plan = buildPlan({ to: e.code, crz, approachOnly: true, arrEnd: e });
      else if (opts.to && opts.mode === 'runway' && e) F.plan = buildPlan({ from: e.code, to: opts.to, crz, depEnd: e });
      else if (opts.to && opts.mode === 'takeover') F.plan = buildPlan({ to: opts.to, crz, pos: { lat: s.lat, lon: s.lon } });
    } catch (err) { console.warn('flight plan', err); F.plan = null; }
    if (opts.mode === 'runway') {
      setLat('RWY'); setVert('SRS'); F.rwyTrk = e.course;
      F.latArm = F.plan ? 'NAV' : null; F.vertArm = F.plan ? 'CLB' : 'OP CLB';
      F.fcu.hdg = Math.round(e.course); F.hdgMgd = !!F.plan; F.altMgd = !!F.plan;
      F.fcu.alt = F.plan ? crz * 100 : Math.ceil((s.h / FT + 5000) / 1000) * 1000;
      F.abrk = 'MAX';
    } else if (opts.mode === 'final') {
      F.fcu.hdg = Math.round(e.course); F.fcu.alt = Math.round((s.h / FT + 3000) / 1000) * 1000;
      setLat('HDG'); setVert('V/S', { vs: -700 });
      F.appr = true; F.latArm = 'LOC'; F.vertArm = 'G/S';
      F.abrk = 'MED';
      F.ap1 = true; // (on final with the autopilot in: press U or move the stick to fly it by hand)
    } else {
      F.fcu.hdg = Math.round(s.psi); F.fcu.alt = Math.round(s.h / FT / 1000) * 1000;
      setLat('HDG'); setVert('ALT*'); F.capVs = 1000;
      if (F.plan) { F.plan.legFrom = null; F.plan.active = Math.min(1, F.plan.wps.length - 1); setLat('NAV'); F.hdgMgd = true; }
      F.ap1 = true;
    }
    FG.fmgc.panels(true);
  }
  function end() { F.on = false; F.ap1 = F.ap2 = false; FG.fmgc.panels(false); }
  function snapshot() {
    const { fcu, nd, msgs, ...rest } = F;
    const snap = structuredClone({ ...rest, fcu, nd, plan: null });
    snap.planActive = F.plan ? F.plan.active : null;
    snap.planLegFrom = F.plan ? F.plan.legFrom : null;
    return snap;
  }
  function restore(snap) {
    const plan = F.plan;
    Object.assign(F, structuredClone(snap));
    F.plan = plan;
    if (plan && snap.planActive != null) { plan.active = snap.planActive; plan.legFrom = snap.planLegFrom; }
    gPrev = null;
  }

  // ---------- managed speed ----------
  function managedSpeed() {
    if (!F.on || !s.spec) return null;
    const sp = s.spec, alt = altFt();
    if (F.vert === 'SRS') return sp.vr + 15; // (V2 + 10)
    if (F.vert === 'EXP CLB') return A.vls(0) + 25; // (green dot)
    if (F.vert === 'EXP DES') return A.vmo() - 10;
    // (flaps out, or the gear on a type without flaps: pilot.js's own speeds for the configuration)
    if (s.conf > 0 || (A.conf().length === 1 && s.gearDown && !s.onGround && sp.gear !== 'fixed')) return null;
    if (F.phase === 'APPROACH' && alt < 10000 && !s.onGround) return Math.round(A.vls(0) + 25); // (decelerate to green dot: flaps next)
    if (F.phase === 'DESCENT' || DESCENTS.includes(F.vert)) return alt < 10300 ? 250 : Math.min(sp.clbKt, A.vmo() - 30);
    return null;
  }

  // ---------- the FMA (above the PFD, 400 × 48) ----------
  const GREEN = '#30e05a', BLUE = '#3ccfff', WHITE = '#f2f5f8', AMBER = '#ffaa00', MAGENTA = '#ff5af0';
  function drawFma(c) {
    c.fillStyle = 'rgba(0,0,0,0.88)'; c.fillRect(0, 0, 400, 48);
    c.strokeStyle = '#555'; c.lineWidth = 1;
    for (const x of [80, 160, 240, 320]) { c.beginPath(); c.moveTo(x, 3); c.lineTo(x, 45); c.stroke(); }
    c.font = '600 12px ui-monospace, Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const t = (txt, x, y, col, boxed) => {
      c.fillStyle = col; c.fillText(txt, x, y);
      if (boxed) { const w = c.measureText(txt).width + 6; c.strokeStyle = WHITE; c.strokeRect(x - w / 2, y - 7, w, 14); }
    };
    const fresh = (at) => at && performance.now() - at < 10000;
    // 1: thrust
    const dn = A.detentName(s.lever);
    if (s.afloor) t('A.FLOOR', 40, 10, GREEN, true);
    else if (A.athrOn()) {
      const m = s.athrMode === 'CLB' ? 'THR CLB' : s.athrMode === 'IDLE' ? 'THR IDLE' : s.machSel != null ? 'MACH' : 'SPEED';
      t(m, 40, 10, GREEN, fresh(F.vertAt));
    } else if (s.spec.athr && !s.onGround && s.lever < 0.87 && s.lever > 0.01 && !s.athr) t('MAN THR', 40, 10, WHITE);
    else if (s.lever >= 0.87) t(`MAN ${dn === 'FLX/MCT' ? 'FLX' : dn === 'TOGA' ? 'TOGA' : dn}`, 40, 10, WHITE);
    else if (s.lever < 0) t('REV', 40, 10, WHITE);
    if (s.athr && s.spec.athr && !s.onGround && s.lever > 0.87 && A.agl() > 1200 && Math.floor(performance.now() / 500) % 2) t('LVR CLB', 40, 38, WHITE);
    // 2-3: vertical and lateral (LAND, FLARE, ROLL OUT across both)
    if (!F.fd && !apOn()) { /* no FD, no AP: no modes */ }
    else if (LANDING.includes(F.vert)) t(F.vert, 160, 10, GREEN, fresh(F.vertAt));
    else {
      const vtxt = F.vert === 'V/S' ? `V/S ${F.fcu.vs >= 0 ? '+' : ''}${F.fcu.vs}` : F.vert === 'FPA' ? `FPA ${F.fcu.fpa >= 0 ? '+' : ''}${F.fcu.fpa.toFixed(1)}°` : F.vert || '';
      t(vtxt, 120, 10, GREEN, fresh(F.vertAt));
      t(F.lat || '', 200, 10, GREEN, fresh(F.latAt));
      const varm = [F.vertArm === 'CLB' && !F.altMgd ? null : F.vertArm, (['CLB', 'OP CLB', 'DES', 'OP DES', 'V/S', 'FPA', 'EXP CLB', 'EXP DES', 'SRS'].includes(F.vert) && F.fcu.alt) ? 'ALT' : null].filter(Boolean);
      c.font = '600 11px ui-monospace, Consolas, monospace';
      t(varm.join(' '), 120, 24, BLUE);
      t(F.latArm || '', 200, 24, BLUE);
      c.font = '600 12px ui-monospace, Consolas, monospace';
    }
    // 4: approach capability
    if (F.appr || LANDING.includes(F.vert) || F.vert === 'G/S') {
      t(F.ap1 && F.ap2 ? 'CAT 3' : apOn() ? 'CAT 3' : 'CAT 1', 280, 10, WHITE);
      t(F.ap1 && F.ap2 ? 'DUAL' : apOn() ? 'SINGLE' : '', 280, 24, WHITE);
      c.font = '11px ui-monospace, Consolas, monospace'; t(F.ap1 && F.ap2 ? 'NO DH' : 'DH 100', 280, 38, WHITE); c.font = '600 12px ui-monospace, Consolas, monospace';
    }
    // 5: engagement
    t(F.ap1 && F.ap2 ? 'AP1+2' : F.ap1 ? 'AP1' : F.ap2 ? 'AP2' : '', 360, 10, WHITE);
    t(F.fd ? '1 FD 2' : '', 360, 24, WHITE);
    if (s.spec.athr && s.athr) t('A/THR', 360, 38, A.athrOn() ? WHITE : BLUE);
    if (F.abrkOn) { c.font = '600 10px ui-monospace, monospace'; t(`BRK ${F.abrk}`, 200, 38, GREEN); }
  }

  // FD bars on the PFD's attitude ball (called from src/pilot.js pfd())
  function drawFd(c, ax, ay, ppd, r) {
    if (!F.fd || !F.on || s.onGround) return;
    const cmd = F.cmd || {};
    c.save(); c.strokeStyle = GREEN; c.lineWidth = 3;
    if (cmd.gamma != null) {
      const dy = clamp(-(cmd.gamma - s.gamma / DEG) * ppd * 1.5, -r * 0.8, r * 0.8);
      c.beginPath(); c.moveTo(ax - 55, ay + dy); c.lineTo(ax + 55, ay + dy); c.stroke();
    }
    if (cmd.bank != null) {
      const dx = clamp((cmd.bank - s.phi) * 2.2, -r * 0.8, r * 0.8);
      c.beginPath(); c.moveTo(ax + dx, ay - 55); c.lineTo(ax + dx, ay + 55); c.stroke();
    }
    c.restore();
  }
  // the FCU altitude on the altitude tape (cyan; magenta when managed)
  function drawTapes(c, { alt }) {
    if (!F.on) return;
    const y = 128 - (F.fcu.alt - alt) * 0.18;
    const col = F.altMgd ? MAGENTA : BLUE;
    c.save(); c.font = '600 12px ui-monospace, monospace'; c.textAlign = 'center'; c.fillStyle = col;
    if (y < 40) c.fillText(String(F.fcu.alt), 337, 32);
    else if (y > 216) c.fillText(String(F.fcu.alt), 337, 226);
    else { c.strokeStyle = col; c.lineWidth = 2; c.strokeRect(306, y - 8, 10, 16); }
    c.restore();
  }

  // ---------- ND (navigation display, 324 × 324) ----------
  let ndAirports = null, ndAirAt = 0;
  function drawNd(c) {
    const W = 324, H = 324;
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.9)'; c.beginPath(); c.roundRect ? c.roundRect(0, 0, W, H, 10) : c.rect(0, 0, W, H); c.fill();
    c.beginPath(); c.rect(0, 0, W, H); c.clip();
    const here = { lat: s.lat, lon: s.lon };
    const mode = F.nd.mode, range = F.nd.range;
    const plan = mode === 'PLAN';
    const cx = W / 2, cy = mode === 'ARC' ? H - 44 : H / 2 + 6;
    const rad = mode === 'ARC' ? 238 : 118;
    const ppn = rad / (mode === 'ARC' ? range : range / 2);
    const up = plan ? 0 : s.psi;
    const xy = (p) => {
      const d = gcDist(here, p), b = (gcBrg(here, p) - up) * R;
      return [cx + Math.sin(b) * d * ppn, cy - Math.cos(b) * d * ppn];
    };
    c.textBaseline = 'middle';
    // compass
    c.strokeStyle = WHITE; c.fillStyle = WHITE; c.lineWidth = 1.2; c.font = '11px ui-monospace, Consolas, monospace'; c.textAlign = 'center';
    c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.stroke();
    for (let d = 0; d < 360; d += 5) {
      const a = (d - up) * R;
      const l = d % 10 === 0 ? 9 : 5;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * rad, cy - Math.cos(a) * rad); c.lineTo(cx + Math.sin(a) * (rad - l), cy - Math.cos(a) * (rad - l)); c.stroke();
      if (d % 30 === 0) c.fillText(String(d / 10), cx + Math.sin(a) * (rad - 18), cy - Math.cos(a) * (rad - 18));
    }
    // range rings
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.setLineDash([3, 5]);
    c.beginPath(); c.arc(cx, cy, rad / 2, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    c.fillStyle = BLUE; c.font = '10px ui-monospace, monospace';
    c.fillText(String(mode === 'ARC' ? range / 2 : range / 4), cx - rad / 2 * 0.7 - 8, cy - rad / 2 * 0.7);
    // selected heading (cyan) when not managed
    if (!F.hdgMgd || F.fcu.hdgPreset != null) {
      const a = ((F.fcu.hdgPreset ?? F.fcu.hdg) - up) * R;
      c.fillStyle = BLUE; c.beginPath();
      c.moveTo(cx + Math.sin(a) * rad, cy - Math.cos(a) * rad);
      c.lineTo(cx + Math.sin(a - 0.03) * (rad + 10), cy - Math.cos(a - 0.03) * (rad + 10));
      c.lineTo(cx + Math.sin(a + 0.03) * (rad + 10), cy - Math.cos(a + 0.03) * (rad + 10)); c.fill();
    }
    // airports
    const now = performance.now();
    if (F.nd.arpt && (!ndAirports || now - ndAirAt > 2000)) {
      ndAirAt = now;
      ndAirports = Object.values(G.airportByCode).filter((a) => !a.factory && Math.abs(a.lat - s.lat) < range / 50 && gcDist(here, a) < range * 1.1).slice(0, 60);
    }
    if (F.nd.arpt && ndAirports) {
      c.font = '10px ui-monospace, monospace'; c.textAlign = 'left';
      for (const a of ndAirports) {
        const [x, y] = xy(a);
        c.strokeStyle = MAGENTA; c.fillStyle = MAGENTA;
        c.beginPath(); for (let i = 0; i < 4; i++) { const t = i * Math.PI / 4; c.moveTo(x - Math.cos(t) * 5, y - Math.sin(t) * 5); c.lineTo(x + Math.cos(t) * 5, y + Math.sin(t) * 5); } c.stroke();
        c.fillText(a.code, x + 7, y + 6);
      }
    }
    // the flight plan: green legs, the active waypoint white
    const p = F.plan;
    if (p) {
      c.lineWidth = 2; c.strokeStyle = GREEN;
      c.beginPath();
      const startI = Math.max(0, p.active - 1);
      const first = p.legFrom && p.active === startI + 1 ? p.legFrom : p.wps[startI];
      let [x0, y0] = xy(first); c.moveTo(x0, y0);
      for (let i = startI + 1; i < p.wps.length; i++) { const [x, y] = xy(p.wps[i]); c.lineTo(x, y); }
      c.stroke();
      c.font = '10px ui-monospace, monospace'; c.textAlign = 'left';
      for (let i = startI; i < p.wps.length; i++) {
        const w = p.wps[i]; const [x, y] = xy(w);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const col = i === p.active ? WHITE : GREEN;
        c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.stroke();
        c.fillText(w.id, x + 8, y - 6);
      }
      // T/C and T/D
      for (const [d, lbl] of [[p.toc, 'T/C'], [p.tod, 'T/D']]) {
        if (!(d > 0 && d < p.total)) continue;
        const i = p.wps.findIndex((w) => w.cum >= d);
        if (i < 1 || i < p.active) continue;
        const a = p.wps[i - 1], b = p.wps[i];
        const pt = gcInterp(a, b, (d - a.cum) / Math.max(1e-6, b.cum - a.cum));
        const [x, y] = xy(pt);
        c.fillStyle = WHITE; c.fillText(lbl, x + 5, y + 8); c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill();
      }
    }
    // the ILS course
    const l = F.ilsNow || (F.ls ? ils() : null);
    if (l && F.ls) {
      const e = l.e; const [x1, y1] = xy(e); const far = gcMove(e, wrap360(e.course + 180), 15); const [x2, y2] = xy(far);
      c.strokeStyle = MAGENTA; c.setLineDash([6, 4]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.setLineDash([]);
    }
    c.restore(); c.save();
    // the aircraft
    c.strokeStyle = '#ffd60a'; c.lineWidth = 3;
    if (plan) {
      c.save(); c.translate(cx, cy); c.rotate(s.psi * R);
      c.beginPath(); c.moveTo(0, -12); c.lineTo(0, 12); c.moveTo(-10, -2); c.lineTo(10, -2); c.moveTo(-5, 9); c.lineTo(5, 9); c.stroke();
      c.restore();
    } else {
      c.beginPath(); c.moveTo(cx, cy - 14); c.lineTo(cx, cy + 14); c.moveTo(cx - 13, cy - 3); c.lineTo(cx + 13, cy - 3); c.moveTo(cx - 6, cy + 10); c.lineTo(cx + 6, cy + 10); c.stroke();
      c.fillStyle = '#ffd60a'; c.fillRect(cx - 1, cy - rad - 14, 2, 12);
    }
    // texts: GS / TAS top left, the active waypoint top right, mode and range bottom
    c.font = '600 11px ui-monospace, Consolas, monospace'; c.textAlign = 'left'; c.fillStyle = WHITE;
    c.fillText('GS', 8, 13); c.fillStyle = GREEN; c.fillText(String(Math.round(s.V * Math.cos(s.gamma) / KT)), 28, 13);
    c.fillStyle = WHITE; c.fillText('TAS', 62, 13); c.fillStyle = GREEN; c.fillText(String(Math.round(s.V / KT)), 88, 13);
    if (!plan) { c.fillStyle = WHITE; c.fillText(String(Math.round(wrap360(s.psi))).padStart(3, '0'), cx - 12, 30); }
    if (p && p.wps[p.active]) {
      const w = p.wps[p.active];
      const d = gcDist(here, w), b = gcBrg(here, w);
      const gs = Math.max(60, s.V / KT);
      const eta = new Date(Date.now() + (d / gs) * 3600e3);
      c.textAlign = 'right';
      c.fillStyle = WHITE; c.fillText(w.id, W - 60, 13); c.fillStyle = GREEN; c.fillText(`${String(Math.round(b)).padStart(3, '0')}°`, W - 8, 13);
      c.fillText(`${d < 10 ? d.toFixed(1) : Math.round(d)} NM`, W - 8, 28);
      c.fillText(`${String(eta.getHours()).padStart(2, '0')}${String(eta.getMinutes()).padStart(2, '0')}`, W - 8, 43);
    }
    c.textAlign = 'left'; c.fillStyle = WHITE; c.font = '10px ui-monospace, monospace';
    c.fillText(`${mode === 'ROSE' ? 'ROSE NAV' : mode}  ${range} NM${F.nd.arpt ? '  ARPT' : ''}`, 8, H - 10);
    if (l && F.ls) { c.textAlign = 'right'; c.fillStyle = MAGENTA; c.fillText(`ILS ${l.e.code}${l.e.name} ${(l.d / 1852).toFixed(1)}`, W - 8, H - 10); }
    c.restore();
  }

  // ---------- sounds: the cavalry charge (AP off) and the single chime (A/THR off) ----------
  let ac = null;
  function tone(freqs, dur, gap, vol = 0.12, type = 'square') {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime + 0.02;
      for (const f of freqs) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setValueAtTime(vol, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
        t += dur + gap;
      }
    } catch (e) { /* no audio */ }
  }
  const sounds = {
    cavalry: () => tone([523, 659, 784, 1047, 784, 1047], 0.11, 0.02, 0.08),
    chime: () => tone([1200], 0.25, 0, 0.08, 'sine'),
  };

  FG.fmgc = {
    get on() { return F.on; }, get ls() { return F.ls; }, F,
    control, pilotInput, managedSpeed, begin, end, snapshot, restore,
    apToggle, engage, disconnect, turn, push, pull, press, directTo, buildPlan, predict, dtg, ils,
    drawFma, drawFd, drawTapes, drawNd, sounds,
    // the conventional-law pitch loop's gains (alpha rate per degree of path error, per degree/s of path change)
    tune: { kp: 0.5, kd: 1.2, flareKp: 0.7, flareKd: 2.0 },
    fcuToggle() { F.fcu.visible = !F.fcu.visible; FG.fmgc.panels(F.on); },
    mcduToggle() { if (FG.mcdu) FG.mcdu.toggle(); },
    panels(on) { if (FG.fcu) FG.fcu.show(on && F.fcu.visible); if (FG.mcdu && !on) FG.mcdu.show(false); },
    geo: { gcDist, gcBrg, gcMove, xtrack },
    apOn,
  };
})();
