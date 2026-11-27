// The MCDU, laid out as the A320's: a 24-column screen with six line select keys on each side, the function keys
// (DIR PROG PERF INIT DATA / F-PLN RAD NAV FUEL PRED SEC F-PLN ATC COMM MCDU MENU / AIRPORT and the slew keys) and
// the alphanumeric keypad with CLR, OVFY, / and SP. Pages: INIT (FROM/TO, flight number, cruise level), F-PLN
// (the waypoints, insert or CLR them), DIR (direct to), PROG, PERF (take-off or approach) and RAD NAV (the ILS).
// Type on the keypad or, once the MCDU is clicked, on the keyboard (Esc gives the keys back to the flying).
(function () {
  'use strict';
  const M = FG.fmgc, F = M.F, s = FG.pilot.state, G = FG.game;
  const { gcDist, gcBrg } = M.geo;
  const KT = 0.514444, FT = 0.3048;
  let el = null, scr = null, kbd = null;
  const st = { page: 'INIT', scroll: 0, pad: '', msg: null, fltNbr: '' };

  // colours as on the real one: white titles and labels, cyan what can be changed, green what the FMGC worked out,
  // amber what it needs, magenta constraints, yellow temporary
  const C = { w: '#f2f5f8', c: '#3ccfff', g: '#30e05a', a: '#ffaa00', m: '#ff5af0', y: '#ffe14a' };
  const fmtAlt = (ft) => (ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : String(Math.round(ft / 10) * 10));
  const pad3 = (n) => String(Math.round(n) % 360).padStart(3, '0');

  function build() {
    el = document.createElement('div');
    el.id = 'mcdu';
    const lsk = (side) => [1, 2, 3, 4, 5, 6].map((i) => `<button class="mc-lsk" data-lsk="${side}${i}">—</button>`).join('');
    const fkeys = [['DIR', 'PROG', 'PERF', 'INIT', 'DATA', ''], ['F-PLN', 'RAD NAV', 'FUEL PRED', 'SEC F-PLN', 'ATC COMM', 'MCDU MENU'], ['AIRPORT', '', '', '', '', '']];
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['-', '+', 'SP', 'OVFY', 'CLR', '/']);
    el.innerHTML = `
      <div class="mc-head"><span>MCDU</span><span class="mc-kbd" title="Click the MCDU to type on the keyboard; Esc to fly again">⌨ off</span><button class="mc-close" title="Close (Y)">×</button></div>
      <div class="mc-face">
        <div class="mc-lsks">${lsk('L')}</div>
        <div class="mc-screen"></div>
        <div class="mc-lsks">${lsk('R')}</div>
      </div>
      <div class="mc-fkeys">${fkeys.map((r) => `<div>${r.map((k) => (k ? `<button data-f="${k}">${k}</button>` : '<span></span>')).join('')}</div>`).join('')}
        <div class="mc-slew"><button data-f="←">←</button><button data-f="↑">↑</button><button data-f="→">→</button><button data-f="↓">↓</button></div>
      </div>
      <div class="mc-pad">
        <div class="mc-num">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
        <div class="mc-alpha">${keys.map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      </div>
      <input class="mc-in" aria-label="MCDU keyboard" autocomplete="off" spellcheck="false">`;
    document.body.appendChild(el);
    scr = el.querySelector('.mc-screen');
    kbd = el.querySelector('.mc-in');
    el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) { kbd.focus(); return; }
      if (b.classList.contains('mc-close')) { show(false); return; }
      if (b.dataset.lsk) lskPress(b.dataset.lsk);
      else if (b.dataset.f) fkey(b.dataset.f);
      else if (b.dataset.k) key(b.dataset.k);
      render();
    });
    kbd.addEventListener('focus', () => el.classList.add('typing'));
    kbd.addEventListener('blur', () => el.classList.remove('typing'));
    kbd.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { kbd.blur(); return; }
      if (e.key === 'Backspace') { st.pad = st.pad.slice(0, -1); st.msg = null; }
      else if (e.key === 'Delete') key('CLR');
      else if (e.key === ' ') key('SP');
      else if (/^[a-zA-Z0-9./+-]$/.test(e.key)) key(e.key.toUpperCase());
      else if (e.key === 'ArrowUp') fkey('↑');
      else if (e.key === 'ArrowDown') fkey('↓');
      else return;
      e.preventDefault();
      render();
    });
    // the header can drag it
    const head = el.querySelector('.mc-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
      const mv = (ev) => { el.style.left = `${Math.max(0, ev.clientX - x0)}px`; el.style.top = `${Math.max(0, ev.clientY - y0)}px`; el.style.right = 'auto'; el.style.bottom = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }

  // ---------- keys ----------
  function key(k) {
    if (st.msg) { st.msg = null; }
    // CLR: rubs out the last letter; on an empty scratchpad it writes CLR (then a line select key deletes)
    if (k === 'CLR') { st.pad = st.pad === 'CLR' ? '' : st.pad ? st.pad.slice(0, -1) : 'CLR'; return; }
    if (st.pad === 'CLR') st.pad = '';
    if (k === 'SP') k = ' ';
    if (k === '+/-') { st.pad = st.pad.startsWith('-') ? st.pad.slice(1) : `-${st.pad}`; return; }
    if (k === 'OVFY') k = 'Δ';
    if (st.pad.length < 22) st.pad += k;
  }
  function fkey(f) {
    st.msg = null;
    if (f === '↑' || f === '↓') { st.scroll = Math.max(0, st.scroll + (f === '↓' ? 1 : -1)); return; }
    if (f === '←' || f === '→') return;
    if (f === 'AIRPORT') { st.page = 'F-PLN'; st.scroll = F.plan ? Math.max(0, F.plan.wps.length - 4) : 0; return; }
    if (['INIT', 'F-PLN', 'DIR', 'PROG', 'PERF', 'RAD NAV', 'DATA', 'FUEL PRED', 'SEC F-PLN', 'ATC COMM', 'MCDU MENU'].includes(f)) {
      st.page = f; st.scroll = f === 'F-PLN' && F.plan ? Math.max(0, F.plan.active - 1) : 0; st.perfPh = null; return;
    }
    st.msg = 'NOT AVAILABLE';
  }
  const take = () => { const v = st.pad.trim(); st.pad = ''; return v; };
  const notAllowed = () => { st.msg = 'NOT ALLOWED'; };
  const formatErr = () => { st.msg = 'FORMAT ERROR'; };

  function lskPress(id) {
    const side = id[0], n = Number(id[1]);
    const p = F.plan;
    switch (st.page) {
      case 'INIT':
        if (id === 'R1') {
          const v = take(); const m = v.match(/^([A-Z0-9]{3,4})\/([A-Z0-9]{3,4})$/);
          if (!m) return formatErr();
          if (!G.airportByCode[m[1]] || !G.airportByCode[m[2]]) { st.msg = 'NOT IN DATABASE'; return; }
          newPlan(m[1], m[2]);
        } else if (id === 'L3') { st.fltNbr = take().slice(0, 8); F.fltNbr = st.fltNbr; }
        else if (id === 'L6') {
          const v = take().replace(/^FL/, ''); const fl = Number(v.split('/')[0]);
          if (!(fl >= 50 && fl <= 410)) return formatErr();
          if (p) { p.crz = fl; M.predict(p); } else F.pendingCrz = fl;
        } else if (st.pad) notAllowed();
        break;
      case 'F-PLN': {
        if (!p) return notAllowed();
        if (side !== 'L' || n > 5) return st.pad ? notAllowed() : undefined;
        const i = st.scroll + n - 1;
        if (i >= p.wps.length) return;
        const v = take();
        if (!v) { st.page = 'DIR'; st.scroll = 0; return; }
        if (v === 'CLR') {
          if (i <= p.active - 1 || p.wps[i].kind === 'thr' || p.wps.length < 3) return notAllowed();
          p.wps.splice(i, 1);
          if (p.active > i) p.active--;
          M.predict(p);
          return;
        }
        const w = findFix(v);
        if (!w) { st.msg = 'NOT IN DATABASE'; return; }
        if (i < p.active) return notAllowed();
        p.wps.splice(i, 0, w);
        M.predict(p);
        break;
      }
      case 'DIR': {
        if (!p) return notAllowed();
        if (id === 'L1') {
          const v = take();
          const i = p.wps.findIndex((w, k) => k >= p.active - 1 && w.id === v);
          if (i >= 0) { M.directTo(i); st.page = 'F-PLN'; st.scroll = Math.max(0, i - 1); return; }
          const w = findFix(v);
          if (!w) { st.msg = 'NOT IN DATABASE'; return; }
          p.wps.splice(p.active, 0, w); M.predict(p); M.directTo(p.active); st.page = 'F-PLN';
          return;
        }
        if (side === 'L') {
          const i = p.active + st.scroll + n - 2;
          if (i < p.wps.length) { M.directTo(i); st.page = 'F-PLN'; st.scroll = Math.max(0, i - 1); }
        }
        break;
      }
      case 'PERF': {
        const P1 = F.perf, v = take(), to = perfPhase() === 'TAKEOFF';
        if (id === 'R6') { st.perfPh = to ? 'APPR' : 'TAKEOFF'; return; }
        const num = (lo, hi) => { if (v === 'CLR') return null; const x = Number(v); if (!(x >= lo && x <= hi)) { formatErr(); return undefined; } return x; };
        const put = (k, lo, hi) => { const x = num(lo, hi); if (x !== undefined) P1[k] = x; };
        if (to) {
          if (id === 'L1') put('v1', 90, 200); else if (id === 'L2') put('vr', 90, 200); else if (id === 'L3') put('v2', 90, 210);
          else if (id === 'R4') put('flex', 0, 75); else if (v) notAllowed();
        } else {
          if (id === 'L1') put('qnh', 900, 1100); else if (id === 'R2') put('mda', 0, 20000); else if (id === 'R3') put('dh', 0, 1000);
          else if (id === 'R4') { P1.ldgConf = P1.ldgConf === 'FULL' ? '3' : 'FULL'; if (FG.systems) FG.systems.set('gpwsLdg3', P1.ldgConf === '3' ? 1 : 0); }
          else if (v) notAllowed();
        }
        break;
      }
      case 'RAD NAV': {
        const v = take(), sys = FG.systems;
        if (!sys) return;
        const slot = { L1: ['vor', 0], R1: ['vor', 1], L5: ['adf', 0], R5: ['adf', 1] }[id];
        if (!slot) { if (v) notAllowed(); return; }
        sys.set(slot[0], v === 'CLR' || !v ? null : v, slot[1]);
        break;
      }
      case 'DATA': {
        const v = take();
        if (id === 'L1') st.page = 'POS MON'; else if (id === 'L2') st.page = 'IRS MON'; else if (id === 'L4') st.page = 'A/C STATUS';
        else if (id === 'R1' || id === 'R2') { st.look = v ? (id === 'R1' ? findFix(v) : FG.radio && FG.radio.findNavaid(v)) : null; st.lookKind = id === 'R1' ? 'WAYPOINT' : 'NAVAID'; if (v && !st.look) st.msg = 'NOT IN DATABASE'; else st.page = 'LOOKUP'; }
        break;
      }
      case 'POS MON': case 'IRS MON': case 'A/C STATUS': case 'LOOKUP': case 'AIDS': case 'CFDS': case 'ATIS':
        if (id === 'L6') st.page = { 'POS MON': 'DATA', 'IRS MON': 'DATA', 'A/C STATUS': 'DATA', LOOKUP: 'DATA', AIDS: 'MCDU MENU', CFDS: 'MCDU MENU', ATIS: 'ATC COMM' }[st.page];
        break;
      case 'SEC F-PLN': {
        if (id === 'L1') { if (!F.plan) return notAllowed(); F.secPlan = structuredClone(F.plan); st.msg = 'SEC F-PLN: ACTIVE COPIED'; }
        else if (id === 'L4') { F.secPlan = null; st.msg = 'SEC F-PLN DELETED'; }
        else if (id === 'R3') {
          if (!F.secPlan) return notAllowed();
          const a = F.plan; F.plan = F.secPlan; F.secPlan = a ? structuredClone(a) : null; M.predict(F.plan); st.msg = 'SEC F-PLN ACTIVATED';
        }
        break;
      }
      case 'ATC COMM': {
        const p = F.plan;
        const code = id === 'L1' ? p && p.from : id === 'R1' ? p && p.to : null;
        if (id === 'L1' || id === 'R1') {
          const v = take(), c = v || code;
          const a = c && G.airportByCode[c];
          if (!a || !FG.radio) { st.msg = 'NOT IN DATABASE'; return; }
          const at = FG.radio.atis(a);
          if (!at) { st.msg = 'NO ATIS'; return; }
          st.atis = { code: c, text: at.text, letter: at.letter }; st.page = 'ATIS'; st.scroll = 0;
        }
        break;
      }
      case 'MCDU MENU':
        if (id === 'L1') st.page = 'INIT'; else if (id === 'L2') st.page = 'ATC COMM'; else if (id === 'L3') st.page = 'AIDS'; else if (id === 'L4') st.page = 'CFDS';
        break;
      default:
        if (st.pad) notAllowed();
    }
  }
  // a fix typed in: an airport code, a waypoint already in the plan, or a town (its first letters)
  function findFix(v) {
    if (G.airportByCode[v]) { const a = G.airportByCode[v]; return { id: v, lat: a.lat, lon: a.lon, kind: 'apt' }; }
    if (F.plan) { const w = F.plan.wps.find((x) => x.id === v); if (w) return { ...w }; }
    if (v.length >= 3) {
      const here = { lat: s.lat, lon: s.lon };
      let best = null, bd = Infinity;
      for (const t of FG.data.towns || []) {
        const name = Array.isArray(t) ? t[0] : t.name;
        const id = (name || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
        if (!id.startsWith(v)) continue;
        const p = Array.isArray(t) ? { lat: t[2], lon: t[3] } : t;
        const d = gcDist(here, p);
        if (d < bd) { bd = d; best = { id: id.slice(0, 5), lat: p.lat, lon: p.lon, kind: 'wpt', town: name }; }
      }
      if (best && bd < 1500) return best;
    }
    return null;
  }
  function newPlan(from, to) {
    const crz = (F.plan && F.plan.crz) || F.pendingCrz || 340;
    const opts = s.startOpts || {};
    let plan;
    if (s.onGround && !s.landed && opts.end && opts.end.code === from) plan = M.buildPlan({ from, to, crz, depEnd: opts.end });
    else if (s.onGround && !s.landed) plan = M.buildPlan({ from, to, crz });
    else plan = M.buildPlan({ to, crz, pos: { lat: s.lat, lon: s.lon } });
    if (!plan) { st.msg = 'NOT IN DATABASE'; return; }
    F.plan = plan;
    if (s.onGround) { F.latArm = 'NAV'; F.hdgMgd = true; F.altMgd = true; if (F.vertArm === 'OP CLB') F.vertArm = 'CLB'; }
    st.msg = `F-PLN ${from}/${to}: ${plan.wps.length} WPTS`;
  }

  const perfPhase = () => st.perfPh || (F.phase === 'TAKEOFF' || (s.onGround && !s.landed) ? 'TAKEOFF' : 'APPR');
  // a text broken into the screen's 24 columns
  const wrap = (text, n = 24) => { const out = []; let line = ''; for (const w of text.split(/\s+/)) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) out.push(line.trim()); return out; };
  const ll = (lat, lon) => `${String(Math.floor(Math.abs(lat))).padStart(2, '0')}°${(Math.abs(lat) % 1 * 60).toFixed(1).padStart(4, '0')}${lat >= 0 ? 'N' : 'S'}/${String(Math.floor(Math.abs(lon))).padStart(3, '0')}°${(Math.abs(lon) % 1 * 60).toFixed(1).padStart(4, '0')}${lon >= 0 ? 'E' : 'W'}`;

  // ---------- pages ----------
  // a page: title, then six pairs of lines (label, data); each line a left and a right part [text, colour]
  function page() {
    const p = F.plan;
    const L = Array.from({ length: 12 }, () => ({ l: ['', C.w], r: ['', C.w], c: null }));
    const lab = (i, l, r) => { L[i * 2] = { l: [l || '', C.w], r: [r || '', C.w] }; };
    const dat = (i, l, lc, r, rc) => { L[i * 2 + 1] = { l: [l || '', lc || C.g], r: [r || '', rc || C.g] }; };
    let title = st.page;
    switch (st.page) {
      case 'INIT':
        title = 'INIT';
        lab(0, ' CO RTE', 'FROM/TO  ');
        dat(0, 'NONE', C.c, p ? `${p.from || 'PPOS'}/${p.to}` : '□□□□/□□□□', p ? C.c : C.a);
        lab(1, 'ALTN/CO RTE', '');
        dat(1, '----/------', C.c);
        lab(2, 'FLT NBR', '');
        dat(2, st.fltNbr || '□□□□□□□□', st.fltNbr ? C.c : C.a);
        lab(4, 'COST INDEX', '');
        dat(4, '35', C.c);
        lab(5, 'CRZ FL/TEMP', 'TROPO');
        dat(5, `FL${p ? p.crz : F.pendingCrz || 340} /---°`, C.c, '36090', C.c);
        break;
      case 'F-PLN': {
        title = p ? `FROM ${p.from || 'PPOS'}${st.fltNbr ? '   ' + st.fltNbr : ''}` : 'F-PLN';
        if (!p) { dat(2, '------ NO F-PLN ------', C.w); dat(3, ' INIT: FROM/TO (R1)', C.w); break; }
        for (let k = 0; k < 5; k++) {
          const i = st.scroll + k;
          const w = p.wps[i];
          if (!w) { if (i === p.wps.length) dat(k, '------END OF F-PLN------', C.w); continue; }
          const prev = p.wps[i - 1];
          const lblL = prev ? ` C${pad3(gcBrg(prev, w))}°` : '';
          const lblR = prev ? `${Math.round(gcDist(prev, w))}NM ` : '';
          lab(k, lblL, lblR);
          const spd = w.kind === 'thr' ? Math.round(FG.pilot.api.vls(FG.pilot.api.conf().length - 1) + 5) : w.alt < 10000 ? 250 : (s.spec && s.spec.clbKt) || 290;
          const col = i === p.active ? C.w : C.g;
          dat(k, `${w.id}${w.kind === 'thr' ? '' : ''}`, col, `${spd}/${fmtAlt(w.alt)}`, C.g);
        }
        const dist = M.dtg();
        lab(5, ' DEST', 'DIST  EFOB');
        dat(5, `${p.to}${p.arrEnd ? p.arrEnd.name : ''}`, C.w, `${Math.round(dist || 0)}  ---`, C.g);
        break;
      }
      case 'DIR':
        title = 'DIR TO';
        lab(0, ' WAYPOINT', '');
        dat(0, '[      ]', C.c);
        if (p) {
          lab(1, ' F-PLN WPTS', '');
          for (let k = 1; k < 6; k++) {
            const i = p.active + st.scroll + k - 1;
            const w = p.wps[i];
            if (w) dat(k, `←${w.id}`, C.c, w.town ? w.town.toUpperCase().slice(0, 11) : '', C.g);
          }
        }
        break;
      case 'PROG': {
        title = `${({ TAKEOFF: 'TAKE OFF', CLIMB: 'CLIMB', CRUISE: 'CRUISE', DESCENT: 'DES', APPROACH: 'APPR', DONE: 'DONE' })[F.phase] || F.phase} ${st.fltNbr}`;
        lab(0, ' CRZ', 'OPT    REC MAX');
        dat(0, `FL${p ? p.crz : 340}`, C.c, 'FL---  FL390', C.g);
        lab(2, ' BRG / DIST', 'TO');
        if (p) {
          const B = G.airportByCode[p.to]; const here = { lat: s.lat, lon: s.lon };
          dat(2, `${pad3(gcBrg(here, B))}° /${Math.round(gcDist(here, B))}`, C.g, p.to, C.c);
          const gs = Math.max(100, s.V / KT);
          const eta = new Date(Date.now() + ((M.dtg() || 0) / gs) * 3600e3);
          lab(3, ' PREDICTED ARRIVAL', '');
          dat(3, `${String(eta.getHours()).padStart(2, '0')}${String(eta.getMinutes()).padStart(2, '0')}`, C.g);
        }
        lab(4, ' POSITION', 'ALT');
        dat(4, `${Math.abs(s.lat).toFixed(1)}${s.lat >= 0 ? 'N' : 'S'}/${Math.abs(s.lon).toFixed(1)}${s.lon >= 0 ? 'E' : 'W'}`, C.g, fmtAlt(s.h / FT), C.g);
        lab(5, ' REQUIRED ACCUR ESTIMATED', '');
        dat(5, '1.0NM    HIGH   0.07NM', C.g);
        break;
      }
      case 'PERF': {
        const api = FG.pilot.api, sp = s.spec || {}, P1 = F.perf;
        const val = (x, dflt) => (x != null ? [String(x), C.c] : [String(dflt), C.g]);
        if (perfPhase() === 'TAKEOFF') {
          title = 'TAKE OFF';
          lab(0, ' V1', 'RWY'); const v1 = val(P1.v1, sp.vr - 5); dat(0, v1[0], v1[1], s.startOpts && s.startOpts.end ? s.startOpts.end.name : '--', C.g);
          lab(1, ' VR', 'TO SHIFT'); const vr = val(P1.vr, sp.vr); dat(1, vr[0], vr[1], '[M][  ]*', C.c);
          lab(2, ' V2', 'FLAPS/THS'); const v2 = val(P1.v2, sp.vr + 5); dat(2, v2[0], v2[1], `${api.conf()[sp.toConf] ? api.conf()[sp.toConf].name : '-'}/UP0.5`, C.c);
          lab(3, 'TRANS ALT', 'FLEX TO TEMP');
          const oat = FG.systems && FG.systems.oatC ? Math.round(FG.systems.oatC(s.groundH)) : 15;
          dat(3, '5000', C.c, P1.flex != null ? `${P1.flex}°` : `[ ]° (OAT ${oat})`, P1.flex != null ? C.c : C.a);
          lab(4, 'THR RED/ACC', 'ENG OUT ACC');
          dat(4, '1500/1500', C.c, '1500', C.c);
          lab(5, '', 'NEXT ');
          dat(5, '', C.w, 'PHASE>', C.w);
        } else {
          title = 'APPR';
          const last = api.conf().length - 1;
          const rw = F.plan && F.plan.to && FG.radio ? FG.radio.metar(G.airportByCode[F.plan.to] || { lat: s.lat, lon: s.lon }) : null;
          lab(0, ' QNH', 'FINAL');
          dat(0, P1.qnh != null ? String(P1.qnh) : rw ? `[ ] (${rw.qnh})` : '[    ]', P1.qnh != null ? C.c : C.a, F.plan && F.plan.arrEnd ? `ILS${F.plan.arrEnd.name}` : '---', C.g);
          lab(1, ' TEMP', 'BARO');
          dat(1, rw ? `${rw.temp}°` : '15°', C.c, P1.mda != null ? String(P1.mda) : '[    ]', P1.mda != null ? C.c : C.c);
          lab(2, 'MAG WIND', 'RADIO');
          dat(2, rw ? `${String(Math.round(rw.w.windFrom)).padStart(3, '0')}°/${String(rw.w.windKt).padStart(3, '0')}` : '000°/000', C.c, P1.dh != null ? String(P1.dh) : '[    ]', C.c);
          lab(3, 'VLS', 'LDG CONF');
          dat(3, String(Math.round(api.vls(last))), C.g, P1.ldgConf === '3' && last > 1 ? `CONF ${api.conf()[last - 1].name}*` : api.conf()[last] ? `CONF ${api.conf()[last].name}*` : '-', C.c);
          lab(4, ' GREEN DOT', 'VAPP');
          dat(4, String(Math.round(api.vls(0) + 25)), C.g, String(Math.round(api.vls(last) + 5)), C.c);
          lab(5, '', 'PREV ');
          dat(5, '', C.w, 'PHASE>', C.w);
        }
        break;
      }
      case 'FUEL PRED': {
        title = 'FUEL PRED';
        const Fu = FG.systems && FG.systems.S && FG.systems.S.fuel;
        if (!Fu) { dat(2, ' NOT AVAILABLE', C.a); break; }
        const fob = Fu.L + Fu.C + Fu.R;
        const ff = (FG.systems.S.eng || []).reduce((a, e, i) => a + FG.systems.ffOf(i), 0) * 3600; // kg/h
        const gs = Math.max(120, s.V * Math.cos(s.gamma) / KT);
        const dist = M.dtg() || 0, hrs = dist / gs;
        const efob = Math.max(0, fob - Math.max(ff, s.mass * 0.025) * hrs);
        const eta = new Date(Date.now() + hrs * 3600e3);
        const t2 = (n) => (n / 1000).toFixed(1);
        lab(0, ' AT', 'UTC   EFOB');
        dat(0, p ? p.to : '----', C.g, `${String(eta.getUTCHours()).padStart(2, '0')}${String(eta.getUTCMinutes()).padStart(2, '0')}  ${t2(efob)}`, efob < s.mass * 0.03 ? C.a : C.g);
        lab(2, ' GW   /CG', 'FOB');
        dat(2, `${t2(s.mass)} /25.0`, C.g, `${t2(fob)}`, C.g);
        lab(3, ' RTE RSV/%', 'FF');
        dat(3, `${t2(fob * 0.05)} /5.0`, C.c, `${Math.round(ff)} KG/H`, C.g);
        lab(4, ' FINAL/TIME', 'F.USED');
        dat(4, `${t2(s.mass * 0.032 * 0.5)} /0030`, C.c, t2(Fu.used), C.g);
        lab(5, ' EXTRA/TIME', '');
        const extra = efob - s.mass * 0.032 * 0.5;
        dat(5, `${t2(Math.max(0, extra))} /${String(Math.max(0, Math.round(extra / Math.max(1, ff) * 60))).padStart(4, '0')}`, extra < 0 ? C.a : C.g);
        break;
      }
      case 'DATA':
        title = 'DATA INDEX';
        lab(0, ' POSITION', 'WAYPOINTS'); dat(0, '<MONITOR', C.w, '[     ]>', C.c);
        lab(1, ' IRS', 'NAVAIDS'); dat(1, '<MONITOR', C.w, '[     ]>', C.c);
        lab(3, ' A/C', ''); dat(3, '<STATUS', C.w);
        dat(5, ' (IDENT, THEN R1 OR R2)', C.w);
        break;
      case 'POS MON': {
        title = 'POSITION MONITOR';
        const pos = ll(s.lat, s.lon);
        lab(0, ' FMGC1', ''); dat(0, pos, C.g);
        lab(1, ' FMGC2', ''); dat(1, pos, C.g);
        const D = FG.systems && FG.systems.S && FG.systems.S.adirs;
        lab(2, ' GPIRS', ''); dat(2, pos, C.g);
        lab(3, ' IRS1/IRS2/IRS3', '');
        dat(3, D ? D.ir.map((r) => (r.mode === 'NAV' && r.ok ? 'NAV' : r.mode === 'ATT' ? 'ATT' : r.align > 0 ? 'ALIGN' : 'INVAL')).join('  ') : 'NAV  NAV  NAV', C.g);
        dat(5, '<RETURN', C.w);
        break;
      }
      case 'IRS MON': {
        title = 'IRS MONITOR';
        const D = FG.systems && FG.systems.S && FG.systems.S.adirs;
        (D ? D.ir : [0, 1, 2]).forEach((r, k) => {
          lab(k, ` IRS${k + 1}`, D && D.adr[k] ? 'ADR ON' : 'ADR OFF');
          dat(k, D ? `${r.mode}${r.align > 0 ? ` ALIGN TTN ${Math.ceil(r.align / 60)}` : r.align < 0 ? ' ALIGN FAULT' : r.ok ? '' : ' NOT ALIGNED'}` : 'NAV', r.ok || !D ? C.g : C.a);
        });
        lab(3, ' ATT HDG / AIR DATA', '');
        dat(3, D ? `${D.attHdg} / ${D.airData}` : 'NORM / NORM', C.c);
        dat(5, '<RETURN', C.w);
        break;
      }
      case 'A/C STATUS':
        title = (s.spec && s.spec.name || 'A/C').toUpperCase().slice(0, 24);
        lab(0, ' ENG', ''); dat(0, `${s.spec ? s.spec.engines : 2} x ${(s.spec && s.spec.engine || 'JET').toUpperCase()}`, C.g);
        lab(1, ' ACTIVE NAV DATA BASE', ''); dat(1, ' OURAIRPORTS (PD)', C.c);
        lab(2, ' NAVAIDS', ''); dat(2, ` ${(FG.navdata && FG.navdata.navaids.length) || 0}`, C.g);
        lab(3, ' CHG CODE', 'IDLE/PERF'); dat(3, '[   ]', C.c, '+0.0/+0.0', C.g);
        dat(5, '<RETURN', C.w);
        break;
      case 'LOOKUP': {
        const n = st.look;
        title = st.lookKind;
        if (!n) { dat(2, ' NOT IN DATABASE', C.a); dat(5, '<RETURN', C.w); break; }
        lab(0, ' IDENT', st.lookKind === 'NAVAID' ? 'FREQ' : ''); dat(0, n.id, C.g, n.freq ? (n.kind === 'N' ? `${n.freq}` : n.freq.toFixed(2)) : '', C.g);
        lab(1, ' LAT/LONG', ''); dat(1, ll(n.lat, n.lon), C.g);
        lab(2, ' CLASS', 'DIST'); dat(2, n.kind === 'N' ? 'NDB' : n.kind === 'VD' ? 'VOR-DME' : n.kind === 'D' ? 'DME' : n.kind === 'V' ? 'VOR' : 'WAYPOINT', C.g, `${Math.round(gcDist({ lat: s.lat, lon: s.lon }, n))}NM`, C.g);
        if (n.name || n.town) { lab(3, ' NAME', ''); dat(3, (n.name || n.town).toUpperCase().slice(0, 24), C.g); }
        dat(5, '<RETURN', C.w);
        break;
      }
      case 'SEC F-PLN': {
        title = 'SEC INDEX';
        const q = F.secPlan;
        lab(0, '', ''); dat(0, '<COPY ACTIVE', C.w);
        lab(1, ' SEC F-PLN', ''); dat(1, q ? `${q.from || 'PPOS'}/${q.to} ${q.wps.length} WPTS` : '----', q ? C.g : C.w);
        lab(2, '', ''); dat(2, '', C.w, q ? 'ACTIVATE SEC*' : '', C.a);
        dat(3, q ? '<DELETE SEC' : '', C.w);
        break;
      }
      case 'ATC COMM':
        title = 'ATC COMM / ATIS';
        lab(0, ' DEP ATIS', 'ARR ATIS');
        dat(0, `<${(p && p.from) || '[  ]'}`, C.c, `${(p && p.to) || '[  ]'}>`, C.c);
        dat(2, ' (OR TYPE AN AIRPORT)', C.w);
        lab(3, ' DATALINK', ''); dat(3, ' ACARS: AVAIL', C.g);
        break;
      case 'ATIS': {
        const a = st.atis;
        title = `${a ? a.code : ''} ATIS ${a ? a.letter : ''}`;
        const lines = a ? wrap(a.text) : [];
        for (let k = 0; k < 10; k++) { const ln = lines[st.scroll + k]; if (!ln) break; if (k % 2) dat((k - 1) / 2, ln, C.g); else lab(k / 2, ln); }
        dat(5, '<RETURN  (↑↓ SCROLL)', C.w);
        break;
      }
      case 'MCDU MENU':
        title = 'MCDU MENU';
        dat(0, '<FMGC', C.g); dat(1, '<ATSU', C.w); dat(2, '<AIDS', C.w); dat(3, '<CFDS', C.w);
        break;
      case 'AIDS': {
        title = 'AIDS  ENGINE REPORT';
        const SY = FG.systems && FG.systems.S;
        (s.n1 || []).slice(0, 4).forEach((n, i) => { lab(i, ` ENG ${i + 1}`, 'FF KG/H'); dat(i, `N1 ${n.toFixed(1)}  ${SY && SY.eng[i] && SY.eng[i].run ? 'RUN' : 'OFF'}`, C.g, SY ? String(Math.round(FG.systems.ffOf(i) * 3600)) : '--', C.g); });
        if (SY && SY.air) { lab(4, ' CAB ALT', 'CAB V/S'); dat(4, `${Math.round(SY.air.cabAlt / 10) * 10}`, C.g, `${Math.round(SY.air.cabVs / 10) * 10}`, C.g); }
        dat(5, '<RETURN', C.w);
        break;
      }
      case 'CFDS': {
        title = 'CFDS  LAST LEG REPORT';
        const SY = FG.systems && FG.systems.S;
        const items = SY ? [...FG.systems.currentWarnings(), ...FG.systems.currentCautions(), ...SY.log.map((l) => l.text)] : [];
        if (!items.length) dat(1, ' NO FAULT', C.g);
        items.slice(st.scroll, st.scroll + 9).forEach((x, k) => { const t2 = String(x).toUpperCase().slice(0, 24); if (k % 2) dat((k - 1) / 2, t2, C.a); else lab(k / 2, t2); });
        dat(5, '<RETURN', C.w);
        break;
      }
      case 'RAD NAV': {
        title = 'RADIO NAV';
        const N = FG.radio && FG.radio.S ? FG.radio.S.nav : { vor: [null, null], vorMan: [false, false], adf: [null, null] };
        const fq = (n) => (n ? (n.kind === 'N' ? String(n.freq) : n.freq.toFixed(2)) : '');
        lab(0, 'VOR1/FREQ', 'FREQ/VOR2');
        dat(0, N.vor[0] ? `${N.vor[0].id}/${fq(N.vor[0])}` : '[ ]/[  . ]', N.vorMan[0] ? C.c : C.g, N.vor[1] ? `${fq(N.vor[1])}/${N.vor[1].id}` : '[  . ]/[ ]', N.vorMan[1] ? C.c : C.g);
        lab(1, 'CRS', 'CRS'); dat(1, '[ ]', C.c, '[ ]', C.c);
        const e = (F.plan && F.plan.arrEnd) || (F.ilsNow && F.ilsNow.e);
        lab(2, 'LS /FREQ', '');
        dat(2, e ? `I${e.code}${e.name}/---.--` : '[  ]/[  . ]', C.g);
        lab(3, 'CRS', '');
        dat(3, e ? `${pad3(e.course)}` : '[ ]', C.g);
        lab(4, 'ADF1/FREQ', 'FREQ/ADF2');
        dat(4, N.adf[0] ? `${N.adf[0].id}/${fq(N.adf[0])}` : '[ ]/[  . ]', C.c, N.adf[1] ? `${fq(N.adf[1])}/${N.adf[1].id}` : '[  . ]/[ ]', C.c);
        dat(5, ' VOR: IDENT (CLR = AUTO)', C.w);
        break;
      }
      default:
    }
    return { title, L };
  }

  const esc = (t) => String(t).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  function render() {
    if (!el || el.hidden) return;
    const { title, L } = page();
    const rows = [`<div class="mc-r mc-title">${esc(title)}</div>`];
    L.forEach((ln, i) => {
      rows.push(`<div class="mc-r ${i % 2 ? 'mc-dat' : 'mc-lab'}"><span style="color:${ln.l[1]}">${esc(ln.l[0])}</span><span style="color:${ln.r[1]}">${esc(ln.r[0])}</span></div>`);
    });
    rows.push(`<div class="mc-r mc-pad-line"><span style="color:${st.msg ? C.a : C.w}">${esc(st.msg || st.pad)}</span></div>`);
    const html = rows.join('');
    if (scr.innerHTML !== html) scr.innerHTML = html;
    const k = el.querySelector('.mc-kbd');
    k.textContent = document.activeElement === kbd ? '⌨ typing' : '⌨ click to type';
  }

  let timer = null;
  function show(on) {
    if (on && !el) build();
    if (!el) return;
    el.hidden = !on;
    clearInterval(timer);
    if (on) { render(); timer = setInterval(render, 250); } else if (document.activeElement === kbd) kbd.blur();
  }
  // The same pages on a canvas (the 3D MCDUs' screens: src/cockpit3d.js), W × H: the title, twelve lines, the
  // scratchpad, 24 columns; and their keys: press('lsk', 'L1'), press('f', 'F-PLN'), press('k', 'A').
  function draw(c, W, H) {
    c.fillStyle = '#04070a'; c.fillRect(0, 0, W, H);
    if (!FG.fmgc.on) return;
    const { title, L } = page();
    const row = H / 14.2, fs = Math.round(row * 0.86), x0 = W * 0.03, x1 = W * 0.97;
    c.textBaseline = 'middle';
    const line = (y, l, r, small) => {
      c.font = `${small ? 500 : 600} ${Math.round(small ? fs * 0.78 : fs)}px ui-monospace, Consolas, monospace`;
      c.textAlign = 'left'; c.fillStyle = l[1]; c.fillText(l[0], x0, y);
      c.textAlign = 'right'; c.fillStyle = r[1]; c.fillText(r[0], x1, y);
    };
    c.font = `600 ${fs}px ui-monospace, Consolas, monospace`; c.textAlign = 'center'; c.fillStyle = C.w;
    c.fillText(title, W / 2, row * 0.7);
    L.forEach((ln, i) => line(row * (1.75 + i), ln.l, ln.r, i % 2 === 0));
    line(row * 13.6, [st.msg || st.pad, st.msg ? C.a : C.w], ['', C.w]);
  }
  function press(kind, k) {
    if (!FG.fmgc.on) return;
    if (kind === 'lsk') lskPress(k); else if (kind === 'f') fkey(k); else key(k);
    render();
  }
  FG.mcdu = { show, draw, press, toggle() { if (!FG.fmgc.on) return; show(!el || el.hidden); }, get open() { return !!el && !el.hidden; } };
})();
