// The radios, plugged into src/systems.js (FG.systems.plug):
//   - two radio management panels (RMP): each picks VHF 1, 2 or 3 and tunes its standby frequency (the knob: the
//     wheel 25 kHz a step, Shift 1 MHz; a click on the knob's left or right half a step down or up), the transfer
//     button swaps it with the active one. The crew listens to VHF 1 and 2.
//   - what's on the air: an airport's ATIS (its real frequency, src/data/navdata.js from OurAirports) read out with
//     its runway in use, the wind, visibility, cloud, temperature and QNH from the game's weather (the letter changes
//     each hour); its TOWER clears you for take-off lined up, and to land on final; APPROACH gives the ILS. Spoken
//     with the sound on (M), always written in the box at the top.
//   - the navigation receivers: VOR 1/2 (tuned on the MCDU's RAD NAV page, else the nearest VORs, as the FMGC
//     auto-tunes them) and ADF 1/2 (NDBs, by hand): the ND's bearing needles and their DME distances.
//   - the transponder (ATC/TCAS panel): the code (click a digit, or the wheel on it), STBY / AUTO / ON, ALT RPTG, the
//     IDENT button; TCAS STBY / TA / TA/RA and the traffic shown (ALL, THRT, ABV, BLW). TCAS sees the game's other
//     aircraft in the air: TRAFFIC on the ND, TRAFFIC TRAFFIC when one comes within about 40 s, and with TA/RA a
//     resolution (CLIMB / DESCEND) within about 25 s. 7500, 7600 and 7700 are the emergency codes.
(function () {
  'use strict';
  const P = FG.pilot, SYS = FG.systems;
  if (!P || !P.api || !SYS) return;
  const A = P.api, s = P.state, G = FG.game;
  const { KT, FT, DEG } = A;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const R_NM = 3440.065;
  const gc = (a, b) => {
    const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const brg = (a, b) => {
    const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
    return ((Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / DEG) + 360) % 360;
  };
  const here = () => ({ lat: s.lat, lon: s.lon });
  let S = null;

  // ---------- the navigation data ----------
  const ND = () => FG.navdata || { navaids: [], freqs: {} };
  let grid = null; // navaids by 2° cell
  function cells() {
    if (grid) return grid;
    grid = new Map();
    for (const n of ND().navaids) {
      const k = `${Math.floor(n[3] / 2)},${Math.floor(n[4] / 2)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ id: n[0], kind: n[1], freq: n[2], lat: n[3], lon: n[4], name: n[5] });
    }
    return grid;
  }
  // the navaids within `nm` of p (kinds: a string of V VD D N)
  function navaidsNear(p, nm, kinds = 'V VD D N') {
    const out = [], g = cells();
    const dLat = Math.ceil(nm / 120) + 1, dLon = Math.ceil(nm / (120 * Math.max(0.2, Math.cos(p.lat * DEG)))) + 1;
    const la = Math.floor(p.lat / 2), lo = Math.floor(p.lon / 2);
    const want = kinds.split(' ');
    for (let i = -dLat; i <= dLat; i++) for (let j = -dLon; j <= dLon; j++) {
      for (const n of g.get(`${la + i},${lo + j}`) || []) {
        if (!want.includes(n.kind)) continue;
        const d = gc(p, n);
        if (d <= nm) out.push({ ...n, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }
  function findNavaid(id, kinds = 'V VD D N') {
    const near = navaidsNear(here(), 600, kinds).filter((n) => n.id === id);
    if (near.length) return near[0];
    let best = null, bd = Infinity;
    for (const n of ND().navaids) if (n[0] === id && kinds.split(' ').includes(n[1])) { const d = gc(here(), { lat: n[3], lon: n[4] }); if (d < bd) { bd = d; best = { id: n[0], kind: n[1], freq: n[2], lat: n[3], lon: n[4], name: n[5], d }; } }
    return best;
  }
  // airports near p with a frequency of `kind` on `mhz`
  function stationOn(mhz, maxNm) {
    const fq = ND().freqs, p = here();
    let best = null;
    for (const a of airportsNear(p, maxNm)) {
      const list = fq[a.code];
      if (!list) continue;
      for (const [kind, f] of list) if (Math.abs(f - mhz) < 0.004 && (!best || a.d < best.d)) best = { ...a, kind, mhz: f };
    }
    return best;
  }
  let aptCache = null, aptAt = 0;
  function airportsNear(p, nm) {
    if (!aptCache || performance.now() - aptAt > 10000) {
      aptAt = performance.now();
      aptCache = Object.values(G.airportByCode || {})
        .filter((a) => Math.abs(a.lat - p.lat) < 4 && Math.abs(a.lon - p.lon) < 6).map((a) => ({ code: a.code, name: a.name, lat: a.lat, lon: a.lon }));
    }
    return aptCache.map((a) => ({ ...a, d: gc(p, a) })).filter((a) => a.d <= nm).sort((a, b) => a.d - b.d);
  }
  const freqsOf = (code) => (ND().freqs[code] || []);
  const freqOf = (code, kind) => { const f = freqsOf(code).find((x) => x[0] === kind); return f ? f[1] : null; };

  // ---------- state ----------
  function fresh(x) {
    S = x;
    x.radio = {
      vhf: { VHF1: { act: 121.5, stby: 118.0 }, VHF2: { act: 121.5, stby: 121.5 }, VHF3: { act: 131.725, stby: 131.725 } },
      rmp: [{ sel: 'VHF1' }, { sel: 'VHF2' }],
      nav: { vor: [null, null], vorMan: [false, false], adf: [null, null] },
      xpdr: { code: '7000', mode: 'AUTO', alt: 1, tcas: 'TA/RA', traffic: 'ALL', ident: 0 },
      heard: '', said: {}, tcasT: 0, ra: null,
    };
  }
  function begin(x) {
    S = x;
    const R = x.radio, M = FG.fmgc && FG.fmgc.F, plan = M && M.plan;
    const from = plan && plan.from, to = plan ? plan.to : null;
    const near = airportsNear(here(), 40)[0];
    const dep = from || (s.onGround && near ? near.code : null);
    const arr = to || (!s.onGround && near ? near.code : null);
    // VHF 1 on the tower (lined up) or the approach (on final), its standby the ATIS; VHF 2 the destination's ATIS
    const t1 = s.onGround ? dep && freqOf(dep, 'TWR') : arr && (freqOf(arr, s.mode === 'final' ? 'TWR' : 'APP') || freqOf(arr, 'TWR'));
    if (t1) R.vhf.VHF1.act = t1;
    const atis1 = (s.onGround ? dep : arr) && freqOf(s.onGround ? dep : arr, 'ATIS');
    if (atis1) R.vhf.VHF1.stby = atis1;
    const atis2 = arr && freqOf(arr, 'ATIS');
    if (atis2) R.vhf.VHF2.stby = atis2;
    // Europe flies 7000 VFR / 2000 IFR conspiracy aside, the airliner gets a code from clearance: a made-up one
    R.xpdr.code = String(1000 + Math.floor(Math.random() * 6777)).replace(/[89]/g, '7').padStart(4, '0');
    R.said = {};
  }

  // ---------- switches ----------
  function set(what, v, i) {
    if (!S || !S.radio) return false;
    const R = S.radio;
    switch (what) {
      case 'rmpSel': R.rmp[i].sel = v; break;
      case 'rmpTune': { // v: steps of 25 kHz (±), or { mhz: ±1 }
        const r = R.vhf[R.rmp[i].sel];
        const d = typeof v === 'object' ? v.mhz : v * 0.025;
        let f = Math.round((r.stby + d) * 1000) / 1000;
        if (f > 136.975) f = 118; if (f < 118) f = 136.975;
        r.stby = f; break;
      }
      case 'rmpXfer': { const r = R.vhf[R.rmp[i].sel]; [r.act, r.stby] = [r.stby, r.act]; R.said = {}; break; }
      case 'xpdrDigit': { // i: the digit (0..3), v: +1 / -1
        const d = R.xpdr.code.split('').map(Number);
        d[i] = (d[i] + (v < 0 ? 7 : 1)) % 8; R.xpdr.code = d.join('');
        const c = R.xpdr.code;
        if (['7500', '7600', '7700'].includes(c)) A.say(`Squawking ${c}: ${c === '7700' ? 'emergency' : c === '7600' ? 'radio failure' : 'unlawful interference'}`, 'amber', 3500);
        break;
      }
      case 'xpdrCode': if (/^[0-7]{4}$/.test(String(v))) R.xpdr.code = String(v); break;
      case 'xpdrMode': R.xpdr.mode = v !== undefined ? v : ['STBY', 'AUTO', 'ON'][(['STBY', 'AUTO', 'ON'].indexOf(R.xpdr.mode) + 1) % 3]; break;
      case 'xpdrAlt': R.xpdr.alt = v !== undefined ? v : R.xpdr.alt ? 0 : 1; break;
      case 'ident': R.xpdr.ident = 18; break;
      case 'tcas': R.xpdr.tcas = v !== undefined ? v : ['STBY', 'TA', 'TA/RA'][(['STBY', 'TA', 'TA/RA'].indexOf(R.xpdr.tcas) + 1) % 3]; break;
      case 'traffic': R.xpdr.traffic = v !== undefined ? v : ['THRT', 'ALL', 'ABV', 'BLW'][(['THRT', 'ALL', 'ABV', 'BLW'].indexOf(R.xpdr.traffic) + 1) % 4]; break;
      case 'vor': { // i: 0/1, v: an ident, or null for auto
        if (!v) { R.nav.vor[i] = null; R.nav.vorMan[i] = false; break; }
        const n = findNavaid(String(v).toUpperCase(), 'V VD D');
        if (!n) return A.say(`VOR ${v}: not in the database`, 'amber', 2500), true;
        R.nav.vor[i] = n; R.nav.vorMan[i] = true; break;
      }
      case 'adf': {
        if (!v) { R.nav.adf[i] = null; break; }
        const n = findNavaid(String(v).toUpperCase(), 'N');
        if (!n) return A.say(`NDB ${v}: not in the database`, 'amber', 2500), true;
        R.nav.adf[i] = n; break;
      }
      default: return false;
    }
    return true;
  }

  // ---------- each frame ----------
  let atT = 0, trafficAt = 0;
  const traffic = []; // { id, lat, lon, altFt, vs, d (NM), rel (ft), brg, level 0 other / 1 proximate / 2 TA / 3 RA }
  const prevPos = new Map();
  function step(dt) {
    if (!S || !S.radio) return;
    const R = S.radio;
    if (R.xpdr.ident > 0) R.xpdr.ident = Math.max(0, R.xpdr.ident - dt);
    atT += dt;
    if (atT > 1) { atT = 0; tuneAuto(); listen(); }
    trafficAt += dt;
    if (trafficAt > 0.5) { trafficAt = 0; tcas(); }
  }
  // the FMGC's auto-tuning: the nearest VOR-DMEs, the active waypoint's side first
  function tuneAuto() {
    const R = S.radio;
    if (R.nav.vorMan[0] && R.nav.vorMan[1]) return;
    const near = navaidsNear(here(), 130, 'VD V');
    for (let k = 0; k < 2; k++) if (!R.nav.vorMan[k]) R.nav.vor[k] = near[k] || null;
  }

  // ---------- on the air ----------
  let speaking = false, box = null, boxT = 0;
  function show(text, who) {
    if (!box) {
      box = document.createElement('div');
      box.id = 'fly-radio';
      box.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:2050;max-width:min(720px,90vw);background:rgba(8,12,18,.86);color:#cfe6ff;border:1px solid #2c3f55;border-radius:6px;padding:6px 10px;font:500 12px/1.4 ui-monospace,monospace;pointer-events:none';
      document.body.appendChild(box);
    }
    box.innerHTML = `<b style="color:#6fc8ff">${who}</b> ${text}`;
    box.hidden = false;
    clearTimeout(boxT); boxT = setTimeout(() => { if (box) box.hidden = true; }, Math.max(6000, text.length * 75));
  }
  function say(text, who, key, voice) {
    const R = S.radio;
    if (key && R.said[key]) return;
    if (key) R.said[key] = true;
    show(text, who);
    if (FG.sound && FG.sound.on && window.speechSynthesis && !speaking) {
      const u = new SpeechSynthesisUtterance(text.replace(/\b(\d{3})\.(\d+)\b/g, (m, a, b) => `${a.split('').join(' ')} decimal ${b.split('').join(' ')}`));
      u.rate = voice === 'atis' ? 1.05 : 1.15; u.pitch = voice === 'atis' ? 0.9 : 1.05; u.volume = 0.8;
      speaking = true; u.onend = u.onerror = () => { speaking = false; };
      speechSynthesis.speak(u);
    }
  }
  const callsign = () => { const M = FG.fmgc && FG.fmgc.F; return (M && M.fltNbr) || 'Flightgame one two three'; };
  // the weather at an airport, as an ATIS reads it
  function metar(a) {
    const w = G.weatherAt ? G.weatherAt(a.lat, a.lon, G.state.time) : null;
    if (!w) return null;
    const qnh = Math.round(1013 + (0.5 - w.cover) * 22 - w.rain * 8 - (w.storm ? 6 : 0));
    const vis = w.fog ? '800 metres, fog' : w.storm ? '3 kilometres, thunderstorm' : w.snow ? '2 kilometres, snow' : w.rain > 0.55 ? '5 kilometres, rain' : w.rain > 0.15 ? '8 kilometres, showers' : '10 kilometres or more';
    const base = Math.round((800 + (1 - w.cover) * 6000) / 100) * 100;
    const cloud = w.cover < 0.2 ? 'no significant cloud' : `${w.cover < 0.5 ? 'few' : w.cover < 0.85 ? 'broken' : 'overcast'} ${base} feet`;
    const wind = w.windKt < 3 ? 'calm' : `${String(Math.round(w.windFrom / 10) * 10 || 360).padStart(3, '0')} degrees ${w.windKt} knots${w.gustKt ? `, gusting ${w.gustKt}` : ''}`;
    return { w, qnh, vis, cloud, wind, temp: w.tempC, dew: w.tempC - Math.round(3 + (1 - w.rain) * 6) };
  }
  function runwayInUse(code) {
    try { const ends = P.runwayEnds(code); const e = ends.length ? P.bestEnd(ends, code) : null; return e ? e.name : null; } catch (e) { return null; }
  }
  function atis(a) {
    const m = metar(a);
    if (!m) return null;
    const t = G.state.time, hh = Math.floor((t % 1440) / 60), letter = String.fromCharCode(65 + Math.floor(t / 60) % 26);
    const rw = runwayInUse(a.code);
    const name = (a.name || a.code).replace(/International|Airport/g, '').trim();
    return { letter, text: `${name} information ${letter}, time ${String(hh).padStart(2, '0')}50 zulu. ${rw ? `Expect ILS approach, runway in use ${rw.split('').join(' ')}. ` : ''}Wind ${m.wind}. Visibility ${m.vis}. ${m.cloud[0].toUpperCase() + m.cloud.slice(1)}. Temperature ${m.temp}, dew point ${m.dew}. QNH ${m.qnh}. Advise on initial contact you have information ${letter}.` };
  }
  let atisNext = 0;
  function listen() {
    const R = S.radio, air = !s.onGround;
    const range = air ? Math.min(200, 30 + Math.sqrt(Math.max(0, s.h / FT)) * 1.23) : 40; // (line of sight)
    for (const k of ['VHF1', 'VHF2']) {
      const f = R.vhf[k].act;
      const st = stationOn(f, range);
      if (!st) continue;
      if (st.kind === 'ATIS') {
        if (performance.now() < atisNext || speaking) continue;
        const a = atis(st);
        if (a) { say(a.text, `${st.code} ATIS ${f.toFixed(3)}`, null, 'atis'); atisNext = performance.now() + Math.max(25000, a.text.length * 80); }
      } else if (st.kind === 'TWR' && st.d < 25) tower(st, f);
      else if ((st.kind === 'APP' || st.kind === 'DEP') && st.d < 80) approach(st, f);
    }
  }
  function tower(st, f) {
    const m = metar(st), rw = runwayInUse(st.code), cs = callsign();
    if (!m) return;
    const who = `${st.code} TOWER ${f.toFixed(3)}`;
    if (s.onGround && !s.landed && s.lever < 0.5 && s.V < 20 * KT) say(`${cs}, wind ${m.wind}, runway ${(rw || '').split('').join(' ')}, cleared for take-off.`, who, `to-${st.code}`);
    else if (!s.onGround && s.gear > 0.5 && A.ils && A.ils() && st.d < 10) say(`${cs}, runway ${(rw || '').split('').join(' ')}, wind ${m.wind}, cleared to land.`, who, `ldg-${st.code}`);
    else if (s.onGround && s.landed && s.V < 40 * KT) { const g = freqOf(st.code, 'GND'); say(`${cs}, vacate when able, contact ground ${g ? g.toFixed(3) : '121.900'}.`, who, `vac-${st.code}`); }
    else if (!s.onGround && !s.landed && A.agl() / FT > 800 && A.vsFpm() > 300 && st.d < 15) { const d = freqOf(st.code, 'DEP') || freqOf(st.code, 'APP'); say(`${cs}, contact departure ${d ? d.toFixed(3) : '125.950'}, good day.`, who, `dep-${st.code}`); }
  }
  function approach(st, f) {
    const m = metar(st), rw = runwayInUse(st.code), cs = callsign();
    if (!m || s.onGround) return;
    const who = `${st.code} ${st.kind === 'DEP' ? 'DEPARTURE' : 'APPROACH'} ${f.toFixed(3)}`;
    if (A.vsFpm() > 300 && A.agl() / FT < 15000) say(`${cs}, radar contact, climb flight level ${Math.min(240, Math.round((FG.fmgc && FG.fmgc.F.fcu ? FG.fmgc.F.fcu.alt : 24000) / 1000) * 10)}, proceed on course.`, who, `clb-${st.code}`);
    else if (A.vsFpm() < -300 && st.d < 60) { const t = freqOf(st.code, 'TWR'); say(`${cs}, descend 4000 feet, QNH ${m.qnh}, expect ILS runway ${(rw || '').split('').join(' ')}. Contact tower ${t ? t.toFixed(3) : '118.100'} established.`, who, `app-${st.code}`); }
  }

  // ---------- TCAS ----------
  function tcas() {
    const R = S.radio, X = R.xpdr;
    traffic.length = 0;
    if (X.mode === 'STBY' || X.tcas === 'STBY' || !G.state || !G.flightState) { R.ra = null; return; }
    const t = G.state.time, me = here(), myFt = s.h / FT, myVs = A.vsFpm();
    const taken = s.startOpts && s.startOpts.plane;
    for (const p of G.state.planes || []) {
      if (p.status !== 'flying' || p.id === taken) continue;
      let st;
      try { st = G.flightState(p, t); } catch (e) { st = null; }
      if (!st || st.lat == null || st.ground) continue;
      const d = gc(me, st);
      if (d > 40) continue;
      const prev = prevPos.get(p.id), now = performance.now();
      let vs = 0, close = 0;
      if (prev && now > prev.at) {
        const dtS = (now - prev.at) / 1000;
        vs = ((st.altFt - prev.alt) / dtS) * 60;
        close = (prev.d - d) / dtS; // NM/s
      }
      prevPos.set(p.id, { alt: st.altFt, d, at: now });
      const rel = st.altFt - myFt;
      // time to the closest point (s): range over closure, and the vertical one
      const tau = close > 0.002 ? d / close : Infinity, tauV = Math.abs(rel) / Math.max(1, Math.abs((vs - myVs) / 60));
      let level = Math.abs(rel) < 1200 && d < 6 ? 1 : 0;
      if (!s.onGround && Math.abs(rel) < 850 && (tau < 40 || d < 0.6)) level = 2;
      if (!s.onGround && X.tcas === 'TA/RA' && Math.abs(rel) < 700 && (tau < 25 || d < 0.4) && A.agl() / FT > 1000) level = 3;
      if (X.traffic === 'ABV' && rel < -2700 || X.traffic === 'BLW' && rel > 2700 || Math.abs(rel) > 9900) continue;
      if (X.traffic === 'THRT' && level < 2) continue;
      traffic.push({ id: p.id, lat: st.lat, lon: st.lon, altFt: st.altFt, vs, d, rel, brg: brg(me, st), level, tau, tauV });
    }
    const worst = traffic.reduce((m, x) => (x.level > (m ? m.level : 0) ? x : m), null);
    const talk = (txt) => { if (FG.sound && FG.sound.on) A.speak(txt); };
    if (worst && worst.level === 3) {
      const sense = worst.rel > 0 ? 'DESCEND' : 'CLIMB';
      if (!R.ra || R.ra.sense !== sense) { R.ra = { sense, id: worst.id }; talk(sense === 'CLIMB' ? 'climb, climb' : 'descend, descend'); A.say(`TCAS RA: ${sense} (${sense === 'CLIMB' ? '+1500' : '-1500'} ft/min)`, 'red', 5000); if (FG.fmgc && FG.fmgc.disconnect) FG.fmgc.disconnect('tcas'); }
    } else if (R.ra && !(worst && worst.level >= 2)) { R.ra = null; talk('clear of conflict'); A.say('TCAS: clear of conflict', 'info', 3000); }
    if (worst && worst.level === 2 && !R.ta) { R.ta = true; talk('traffic, traffic'); }
    if (!worst || worst.level < 2) R.ta = false;
  }

  // ---------- for the HUD and the E/WD ----------
  function warnings() { return S && S.radio && S.radio.ra ? [`TCAS RA ${S.radio.ra.sense}`] : []; }
  function cautions() {
    if (!S || !S.radio) return [];
    const c = [], X = S.radio.xpdr;
    if (!s.onGround && X.mode === 'STBY') c.push('ATC XPDR STBY');
    if (!s.onGround && X.tcas === 'STBY') c.push('NAV TCAS STBY');
    return c;
  }
  function proc(name, add) {
    if (name === 'ATC XPDR STBY') add('-XPDR ............... AUTO', 'cyan');
    if (name === 'NAV TCAS STBY') add('-TCAS ............... TA/RA', 'cyan');
    if (/^TCAS RA/.test(name)) add(`-FOLLOW RA: ${S.radio.ra.sense} 1500 FT/MIN`, 'cyan');
  }
  function memo() {
    if (!S || !S.radio) return [];
    const m = [], X = S.radio.xpdr;
    if (X.tcas === 'TA') m.push('TCAS TA ONLY');
    if (['7500', '7600', '7700'].includes(X.code)) m.push(`XPDR ${X.code}`);
    return m;
  }
  function filter(w) {
    if (!S || !S.radio) return w;
    const t = traffic.filter((x) => x.level === 2).length;
    return t && !S.radio.ra ? [...w, ['TRAFFIC', 'amber']] : w;
  }

  SYS.plug({ fresh, begin, set, step, warnings, cautions, proc, memo, filter });
  FG.radio = {
    get S() { return S && S.radio; }, traffic, navaidsNear, findNavaid, stationOn, freqsOf, atis, metar, airportsNear,
    // the bearing (°) and distance (NM) to a tuned station
    toStation(n) { return n ? { brg: brg(here(), n), d: gc(here(), n) } : null; },
  };
})();
