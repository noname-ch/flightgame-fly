// The A320 glareshield, as in the real cockpit from left to right: the captain's EFIS control panel (FD, LS, ND
// mode and range, ARPT), the FCU (SPD/MACH, HDG/TRK, ALT, V/S/FPA windows with their knobs; SPD MACH, LOC, AP1, AP2,
// A/THR, EXPED, APPR; HDG V/S - TRK FPA and the 100/1000 switch) and the AUTO BRK buttons.
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

  function build() {
    el = document.createElement('div');
    el.id = 'fcu';
    el.innerHTML = `
      <div class="fcu-efis">
        <div class="fcu-title">EFIS</div>
        <div class="fcu-row">${btn('FD', 'FD')}${btn('LS', 'LS')}${btn('ARPT', 'ARPT')}</div>
        <div class="fcu-row"><button class="fcu-sel" data-btn="NDMODE" title="ND mode">ARC</button>
          <button class="fcu-sel" data-btn="RNG-" title="ND range">−</button><span class="fcu-rng">40</span><button class="fcu-sel" data-btn="RNG+" title="ND range">+</button></div>
      </div>
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
      </div>
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
  function refresh() {
    if (!el || el.hidden) return;
    const now = performance.now();
    if (now - F.fcu.presetAt > 10000) { F.fcu.spdPreset = null; F.fcu.hdgPreset = null; }
    const q = (sel) => el.querySelector(sel);
    const set = (sel, txt) => { const n = q(sel); if (n.textContent !== txt) n.textContent = txt; };
    const light = (id, on) => { const n = q(`[data-btn="${id}"]`); if (n) n.classList.toggle('lit', !!on); };
    const lbl = (id, on) => q(`[data-l="${id}"]`).classList.toggle('on', !!on);
    // SPD / MACH
    const managed = s.spdSel == null && s.machSel == null;
    if (F.fcu.spdPreset != null) set('[data-w="spd"]', pad(F.fcu.spdPreset, 3));
    else if (managed) set('[data-w="spd"]', '---');
    else if (s.machSel != null) set('[data-w="spd"]', `.${pad(s.machSel * 100, 2)}`);
    else set('[data-w="spd"]', pad(s.spdSel, 3));
    q('[data-d="spd"]').classList.toggle('on', managed);
    lbl('SPD', s.machSel == null); lbl('MACH', s.machSel != null);
    // HDG / TRK
    const hdgMgd = F.hdgMgd || ['NAV', 'LOC*', 'LOC', 'LAND', 'FLARE', 'ROLL OUT'].includes(F.lat);
    if (F.fcu.hdgPreset != null) set('[data-w="hdg"]', pad(F.fcu.hdgPreset, 3));
    else set('[data-w="hdg"]', hdgMgd ? '---' : pad(F.fcu.hdg % 360, 3));
    q('[data-d="hdg"]').classList.toggle('on', hdgMgd);
    lbl('HDG', !F.fcu.trkFpa); lbl('TRK', F.fcu.trkFpa); lbl('HV', !F.fcu.trkFpa); lbl('TF', F.fcu.trkFpa);
    // ALT
    set('[data-w="alt"]', pad(F.fcu.alt, 5));
    q('[data-d="alt"]').classList.toggle('on', F.altMgd);
    set('[data-btn="ALTINC"]', String(F.fcu.altInc));
    // V/S / FPA
    if (F.vert === 'V/S') set('[data-w="vs"]', `${F.fcu.vs < 0 ? '-' : '+'}${pad(Math.abs(F.fcu.vs) / 100, 2)}oo`);
    else if (F.vert === 'FPA') set('[data-w="vs"]', `${F.fcu.fpa < 0 ? '-' : '+'}${Math.abs(F.fcu.fpa).toFixed(1)}`);
    else set('[data-w="vs"]', '-----');
    lbl('VS', !F.fcu.trkFpa); lbl('FPA', F.fcu.trkFpa);
    // lights
    light('AP1', F.ap1); light('AP2', F.ap2); light('ATHR', s.athr && s.spec && s.spec.athr);
    light('LOC', F.locBtn && !F.appr); light('APPR', F.appr); light('EXPED', F.exped);
    light('FD', F.fd); light('LS', F.ls); light('ARPT', F.nd.arpt);
    for (const m of ['LO', 'MED', 'MAX']) {
      const n = q(`[data-btn="BRK ${m}"]`);
      n.classList.toggle('lit', F.abrk === m);
      n.classList.toggle('decel', F.abrk === m && F.abrkOn);
    }
    set('[data-btn="NDMODE"]', F.nd.mode === 'ROSE' ? 'ROSE NAV' : F.nd.mode);
    set('.fcu-rng', String(F.nd.range));
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
  };
})();
