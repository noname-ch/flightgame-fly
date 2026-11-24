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
    if (['INIT', 'F-PLN', 'DIR', 'PROG', 'PERF', 'RAD NAV'].includes(f)) { st.page = f; st.scroll = f === 'F-PLN' && F.plan ? Math.max(0, F.plan.active - 1) : 0; return; }
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
        } else if (id === 'L3') st.fltNbr = take().slice(0, 8);
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
        const api = FG.pilot.api, sp = s.spec || {};
        if (F.phase === 'TAKEOFF') {
          title = 'TAKE OFF';
          lab(0, ' V1', 'RWY');
          dat(0, String(sp.vr - 5), C.c, s.startOpts && s.startOpts.end ? s.startOpts.end.name : '--', C.g);
          lab(1, ' VR', 'TO SHIFT');
          dat(1, String(sp.vr), C.c, '[M][  ]*', C.c);
          lab(2, ' V2', 'FLAPS/THS');
          dat(2, String(sp.vr + 5), C.c, `${api.conf()[sp.toConf] ? api.conf()[sp.toConf].name : '-'}/UP0.5`, C.c);
          lab(3, 'TRANS ALT', 'FLEX TO TEMP');
          dat(3, '5000', C.c, '---°', C.c);
          lab(4, 'THR RED/ACC', 'ENG OUT ACC');
          dat(4, '1500/1500', C.c, '1500', C.c);
        } else {
          title = 'APPR';
          const last = api.conf().length - 1;
          lab(0, ' QNH', 'FINAL');
          dat(0, '1013', C.c, F.plan && F.plan.arrEnd ? `ILS${F.plan.arrEnd.name}` : '---', C.g);
          lab(1, ' TEMP', 'VLS');
          dat(1, '15°', C.c, String(Math.round(api.vls(last))), C.g);
          lab(2, 'MAG WIND', 'VAPP');
          dat(2, '000°/000', C.c, String(Math.round(api.vls(last) + 5)), C.c);
          lab(3, 'TRANS FL', 'LDG CONF');
          dat(3, 'FL050', C.c, api.conf()[last] ? `CONF ${api.conf()[last].name}*` : '-', C.c);
          lab(4, ' GREEN DOT', '');
          dat(4, String(Math.round(api.vls(0) + 25)), C.g);
        }
        break;
      }
      case 'RAD NAV': {
        title = 'RADIO NAV';
        lab(0, 'VOR1/FREQ', 'FREQ/VOR2');
        dat(0, '[ ]/[  . ]', C.c, '[  . ]/[ ]', C.c);
        const e = (F.plan && F.plan.arrEnd) || (F.ilsNow && F.ilsNow.e);
        lab(2, 'LS /FREQ', '');
        dat(2, e ? `I${e.code}${e.name}/---.--` : '[  ]/[  . ]', C.c);
        lab(3, 'CRS', '');
        dat(3, e ? `${pad3(e.course)}` : '[ ]', C.c);
        lab(4, 'ADF1/FREQ', 'FREQ/ADF2');
        dat(4, '[ ]/[  . ]', C.c, '[  . ]/[ ]', C.c);
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
  FG.mcdu = { show, toggle() { if (!FG.fmgc.on) return; show(!el || el.hidden); }, get open() { return !!el && !el.hidden; } };
})();
