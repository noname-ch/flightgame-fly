// The A320 glareshield, as in the real cockpit from left to right: the captain's EFIS control panel (FD, LS, ND
// mode and range, ARPT), the FCU (SPD/MACH, HDG/TRK, ALT, V/S/FPA windows with their knobs; SPD MACH, LOC, AP1, AP2,
// A/THR, EXPED, APPR; HDG V/S - TRK FPA and the 100/1000 switch), the first officer's EFIS (their own ND) and the
// AUTO BRK buttons. RANGE − past 10 NM goes to ZOOM: the ND is the airport map (5, 2, 1, 0.5, 0.2 NM).
// Knobs: the mouse wheel turns them (Shift: ten at a time), a click PUSHES (managed: the FMGC flies it; V/S: level
// off), a right-click PULLS (selected: the window's value). The small ‹ › PUSH PULL buttons do the same.
(function () {
  'use strict';
  const M = FG.fmgc, F = M.F, s = FG.pilot.state;
  let el = null, timer = null;

  const knob = (k, label) => `<div class="fcu-knobwrap" data-knob="${k}">
      <button class="fcu-turn" data-turn="${k}" data-dir="-1" title="Turn left">‹</button>
      <div class="fcu-knob" data-knobk="${k}" title="${label}: wheel turns (Shift ×10) · click PUSH · right-click PULL"><i></i></div>
      <button class="fcu-turn" data-turn="${k}" data-dir="1" title="Turn right">›</button>
      <div class="fcu-pp"><button data-push="${k}">PUSH</button><button data-pull="${k}">PULL</button></div>
    </div>`;
  const btn = (id, label, cls = '') => `<button class="fcu-btn ${cls}" data-btn="${id}"><span class="bar"></span>${label}</button>`;

  // an EFIS control panel: the captain's (side 0) or the first officer's (side 1), each for its own ND
  const efis = (side) => {
    const pre = side ? 'ND2 ' : '', who = side ? 'F/O' : 'CAPT';
    return `
      <div class="fcu-efis">
        <div class="fcu-title">EFIS ${who}</div>
        <div class="fcu-row">${btn('FD', 'FD')}${btn('LS', 'LS')}</div>
        <div class="fcu-row">${['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'].map((o) => btn(`${side ? 'ND2' : 'ND'} ${o}`, o, 'fcu-opt')).join('')}</div>
        <div class="fcu-row"><button class="fcu-sel" data-btn="${side ? 'ND2 MODE' : 'NDMODE'}" title="${who} ND mode">ARC</button>
          <button class="fcu-sel" data-btn="${pre}RNG-" title="${who} ND range (left of 10 NM: ZOOM, the airport map)">−</button><span class="fcu-rng" data-side="${side}">40</span><button class="fcu-sel" data-btn="${pre}RNG+" title="${who} ND range">+</button></div>
      </div>`;
  };

  function build() {
    el = document.createElement('div');
    el.id = 'fcu';
    el.innerHTML = `${efis(0)}
      <div class="fcu-main">
        <div class="fcu-col">
          <div class="fcu-lbls"><span data-l="SPD">SPD</span><span data-l="MACH">MACH</span></div>
          <div class="fcu-win"><b data-w="spd">---</b><i class="dot" data-d="spd"></i></div>
          ${knob('spd', 'Speed')}
          ${btn('SPDMACH', 'SPD MACH')}
        </div>
        <div class="fcu-col">
          <div class="fcu-lbls"><span data-l="HDG">HDG</span><span data-l="TRK">TRK</span><span class="on">LAT</span></div>
          <div class="fcu-win"><b data-w="hdg">---</b><i class="dot" data-d="hdg"></i></div>
          ${knob('hdg', 'Heading')}
          ${btn('LOC', 'LOC')}
        </div>
        <div class="fcu-col fcu-mid">
          <div class="fcu-lbls"><span data-l="HV">HDG V/S</span></div>
          <div class="fcu-lbls"><span data-l="TF">TRK FPA</span></div>
          <button class="fcu-sel fcu-hvtf" data-btn="TRKFPA" title="HDG V/S - TRK FPA">HDG-V/S<br>TRK-FPA</button>
          <div class="fcu-row fcu-aps">${btn('AP1', 'AP1')}${btn('AP2', 'AP2')}</div>
          ${btn('ATHR', 'A/THR', 'wide')}
        </div>
        <div class="fcu-col">
          <div class="fcu-lbls"><span class="on">ALT</span><span class="on">LVL/CH</span></div>
          <div class="fcu-win"><b data-w="alt">05000</b><i class="dot" data-d="alt"></i></div>
          ${knob('alt', 'Altitude')}
          <div class="fcu-row"><button class="fcu-sel fcu-inc" data-btn="ALTINC" title="Altitude knob: 100 or 1000 ft a click">1000</button>${btn('EXPED', 'EXPED')}</div>
        </div>
        <div class="fcu-col">
          <div class="fcu-lbls"><span data-l="VS">V/S</span><span data-l="FPA">FPA</span></div>
          <div class="fcu-win"><b data-w="vs">-----</b></div>
          ${knob('vs', 'Vertical speed')}
          ${btn('APPR', 'APPR')}
        </div>
      </div>${efis(1)}
      <div class="fcu-abrk">
        <div class="fcu-title">AUTO BRK</div>
        ${btn('BRK LO', 'LO')}${btn('BRK MED', 'MED')}${btn('BRK MAX', 'MAX')}
        <button class="fcu-sel fcu-mcdu" data-mcdu title="MCDU: the flight plan (Y)">MCDU</button>
      </div>`;
    document.body.appendChild(el);
    // (keep the keys for flying: no button keeps the focus)
    el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button, .fcu-knob');
      if (!b) return;
      if (b.dataset.btn) M.press(b.dataset.btn);
      else if (b.dataset.turn) M.turn(b.dataset.turn, Number(b.dataset.dir), e.shiftKey);
      else if (b.dataset.push) M.push(b.dataset.push);
      else if (b.dataset.pull) M.pull(b.dataset.pull);
      else if (b.dataset.knobk) M.push(b.dataset.knobk);
      else if (b.hasAttribute('data-mcdu')) M.mcduToggle();
      refresh();
    });
    el.addEventListener('contextmenu', (e) => {
      const k = e.target.closest('.fcu-knob');
      if (!k) return;
      e.preventDefault();
      M.pull(k.dataset.knobk); refresh();
    });
    el.addEventListener('wheel', (e) => {
      const w = e.target.closest('[data-knob]');
      if (!w) return;
      e.preventDefault();
      M.turn(w.dataset.knob, e.deltaY < 0 ? 1 : -1, e.shiftKey);
      const k = w.querySelector('.fcu-knob i');
      k.style.transform = `rotate(${(Number(k.dataset.r || 0) + (e.deltaY < 0 ? 15 : -15))}deg)`; k.dataset.r = Number(k.dataset.r || 0) + (e.deltaY < 0 ? 15 : -15);
      refresh();
    }, { passive: false });
  }

  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
  const LAT_MGD = ['NAV', 'LOC*', 'LOC', 'LAND', 'FLARE', 'ROLL OUT'];
  // What the FCU's four windows show (this panel and the 3D flight deck's FCU): null where it shows dashes. A value
  // turned in while managed (a preset) shows for 10 s.
  function windows() {
    if (performance.now() - F.fcu.presetAt > 10000) { F.fcu.spdPreset = null; F.fcu.hdgPreset = null; }
    const spdMgd = s.spdSel == null && s.machSel == null;
    const hdgMgd = F.hdgMgd || LAT_MGD.includes(F.lat);
    let spd = null;
    if (F.fcu.spdPreset != null) spd = pad(F.fcu.spdPreset, 3);
    else if (s.machSel != null) spd = `.${pad(s.machSel * 100, 2)}`;
    else if (!spdMgd) spd = pad(s.spdSel, 3);
    const hdg = F.fcu.hdgPreset != null ? pad(F.fcu.hdgPreset, 3) : hdgMgd ? null : pad(F.fcu.hdg % 360, 3);
    // (V/S: hundreds of feet a minute, the last two digits the small "oo")
    const vs = F.vert === 'V/S' ? `${F.fcu.vs < 0 ? '-' : '+'}${pad(Math.abs(F.fcu.vs) / 100, 2)}oo`
      : F.vert === 'FPA' ? `${F.fcu.fpa < 0 ? '-' : '+'}${Math.abs(F.fcu.fpa).toFixed(1)}` : null;
    return { spd, spdMgd, mach: s.machSel != null, hdg, hdgMgd, alt: pad(F.fcu.alt, 5), altMgd: !!F.altMgd, vs, trkFpa: !!F.fcu.trkFpa };
  }
  function refresh() {
    if (!el || el.hidden) return;
    const q = (sel) => el.querySelector(sel);
    const set = (sel, txt) => { const n = q(sel); if (n.textContent !== txt) n.textContent = txt; };
    const light = (id, on) => { for (const n of el.querySelectorAll(`[data-btn="${id}"]`)) n.classList.toggle('lit', !!on); };
    const lbl = (id, on) => q(`[data-l="${id}"]`).classList.toggle('on', !!on);
    const w = windows();
    // SPD / MACH
    set('[data-w="spd"]', w.spd ?? '---');
    q('[data-d="spd"]').classList.toggle('on', w.spdMgd);
    lbl('SPD', !w.mach); lbl('MACH', w.mach);
    // HDG / TRK
    set('[data-w="hdg"]', w.hdg ?? '---');
    q('[data-d="hdg"]').classList.toggle('on', w.hdgMgd);
    lbl('HDG', !F.fcu.trkFpa); lbl('TRK', F.fcu.trkFpa); lbl('HV', !F.fcu.trkFpa); lbl('TF', F.fcu.trkFpa);
    // ALT
    set('[data-w="alt"]', w.alt);
    q('[data-d="alt"]').classList.toggle('on', w.altMgd);
    set('[data-btn="ALTINC"]', String(F.fcu.altInc));
    // V/S / FPA
    set('[data-w="vs"]', w.vs ?? '-----');
    lbl('VS', !F.fcu.trkFpa); lbl('FPA', F.fcu.trkFpa);
    // lights
    light('AP1', F.ap1); light('AP2', F.ap2); light('ATHR', s.athr && s.spec && s.spec.athr);
    light('LOC', F.locBtn && !F.appr); light('APPR', F.appr); light('EXPED', F.exped);
    light('FD', F.fd); light('LS', F.ls);
    for (const o of ['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT']) { light(`ND ${o}`, F.nds[0].opt === o); light(`ND2 ${o}`, F.nds[1].opt === o); }
    for (const m of ['LO', 'MED', 'MAX']) {
      const n = q(`[data-btn="BRK ${m}"]`);
      n.classList.toggle('lit', F.abrk === m);
      n.classList.toggle('decel', F.abrk === m && F.abrkOn);
    }
    F.nds.forEach((nd, k) => {
      set(`[data-btn="${k ? 'ND2 MODE' : 'NDMODE'}"]`, nd.mode === 'ROSE' ? 'ROSE NAV' : nd.mode);
      set(`.fcu-rng[data-side="${k}"]`, nd.range < 10 ? `ZOOM ${nd.range}` : String(nd.range));
    });
  }

  FG.fcu = {
    show(on) {
      if (on && !el) build();
      if (!el) return;
      el.hidden = !on;
      clearInterval(timer);
      if (on) { refresh(); timer = setInterval(refresh, 100); }
    },
    refresh,
    windows,
  };
})();
