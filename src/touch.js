// Flying on a phone or tablet: touch controls over the 3D view while you fly (FG.touch).
//
//   left edge     the thrust lever: drag it (it clicks into IDLE, CL, FLX/MCT and TOGA); REV beside it on the ground
//   beside it     gear, flaps down / up, speed brakes, wheel brakes (hold)
//   right side    the stick: put a thumb down anywhere there and move it (down = nose up, as a real stick;
//                 let go and it centres); or tilt the phone like a steering wheel (📱 Tilt, ⊙ sets the middle)
//   top           pause, camera, autopilot, checkpoint and retry, ⋯ more (autothrust, speed, trim, FCU, MCDU,
//                 overhead, limiter, parking brake, ground spoilers, full screen, …) and ☰ the menu
//   PFD button    which instruments are drawn: PFD · PFD + ND · all · none
//
// The rest of the screen is the 3D view's: one finger turns the camera round the plane (or the head in a cockpit).
// It turns itself on on touch screens (and on a desktop at the first touch); the ⋯ panel and the menu turn it off
// (localStorage flightgame.fly.touch). src/pilot.js reads FG.touch.input() each step and FG.touch.layout() to draw.
(function () {
  'use strict';
  const FG = (window.FG = window.FG || {});
  const PREF = 'flightgame.fly.touch';
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch { pref = {}; }
  const keep = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* private mode */ } };
  if (pref.inst == null) pref.inst = 0;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let touched = false; // (a touch screen on a desktop: on at its first touch)
  const wanted = () => pref.mode === 'on' || (pref.mode !== 'off' && (coarse || touched));

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const P = () => FG.pilot;
  const S = () => (FG.pilot ? FG.pilot.state : null);
  // a finer middle, the full throw at the edge
  const curve = (v) => clamp(0.35 * v + 0.65 * v * v * v, -1, 1);

  // ---------- keys: the buttons press the plane's own keys, so they do exactly what the keyboard does ----------
  function key(k, type = 'keydown', extra = {}) {
    window.dispatchEvent(new KeyboardEvent(type, { key: k, code: extra.code || '', shiftKey: !!extra.shift, bubbles: true, cancelable: true }));
  }
  const press = (k, extra) => { key(k, 'keydown', extra); key(k, 'keyup', extra); };
  const buzz = (ms = 8) => { if (navigator.vibrate) try { navigator.vibrate(ms); } catch { /* not allowed */ } };

  // ---------- state ----------
  const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 }; // (x, y: -1..1, y down = pull = nose up)
  const tilt = { on: false, roll: 0, pitch: 0, mid: null, last: null, ok: false };
  let brakeHeld = false;
  let ui = null; // the overlay
  let fcuOffOnce = false;

  function input() {
    let pitch = 0, roll = 0;
    if (stick.id != null) { pitch = curve(stick.y); roll = curve(stick.x); }
    else if (tilt.on && tilt.ok) { pitch = tilt.pitch; roll = tilt.roll; }
    if (pref.invert) pitch = -pitch;
    return { pitch, roll, rud: 0, brake: brakeHeld };
  }

  // the space the controls take, for the instruments drawn by src/pilot.js
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const small = Math.min(W, H) < 500;
    const thr = ui ? ui.querySelector('.tc-left').getBoundingClientRect() : { right: 150 };
    const top = ui ? ui.querySelector('.tc-top').getBoundingClientRect().bottom + 4 : 56;
    return {
      left: thr.right + 8, right: small ? Math.min(160, W * 0.2) : 200, top, bottom: 8 + safe('bottom'),
      share: H > W ? 0.4 : small ? 0.62 : 0.5, // (how much of the height the instruments may take)
      inst: [0, 1, 2, -1][pref.inst] ?? 0,
    };
  }
  function safe(side) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--tc-safe-${side}`);
    return parseFloat(v) || 0;
  }

  // ---------- the overlay ----------
  const INST = ['PFD', 'PFD+ND', 'ALL', 'NONE'];
  function build() {
    ui = document.createElement('div');
    ui.id = 'touch-ui';
    ui.innerHTML = `
      <div class="tc-top">
        <div class="tc-group">
          <button data-tc="inst" title="Instruments shown">PFD</button>
          <button data-tc="tilt" title="Steer by tilting the phone">📱 Tilt</button>
          <button data-tc="mid" title="Tilt: the way you hold it now is the middle" hidden>⊙</button>
        </div>
        <div class="tc-group">
          <button data-tc="pause" title="Pause">⏸</button>
          <button data-tc="cam" title="Camera">🎥</button>
          <button data-tc="ap" title="Autopilot on / off" hidden>AP</button>
          <button data-tc="ck-save" title="Save a checkpoint">⚑</button>
          <button data-tc="ck-back" title="Back to the checkpoint">⟲</button>
          <button data-tc="more" title="More controls">⋯</button>
          <button data-tc="menu" title="Menu">☰</button>
        </div>
      </div>
      <div class="tc-left">
        <div class="tc-thr" aria-label="Thrust levers">
          <div class="tc-thr-track"><div class="tc-thr-fill"></div></div>
          <div class="tc-thr-marks"></div>
          <div class="tc-thr-handle"><b>IDLE</b></div>
        </div>
        <div class="tc-col">
          <button data-tc="gear" class="tc-big">GEAR<small>DOWN</small></button>
          <button data-tc="flapdn" class="tc-big">FLAPS ▼<small>1+F</small></button>
          <button data-tc="flapup" class="tc-big">FLAPS ▲</button>
          <button data-tc="sb" class="tc-big">SPD BRK<small>RET</small></button>
          <button data-tc="brake" class="tc-big">BRAKES<small>hold</small></button>
          <button data-tc="rev" class="tc-big tc-rev" hidden>REV</button>
        </div>
      </div>
      <div class="tc-stick-zone"><div class="tc-stick-hint">stick</div><div class="tc-stick-base"><i></i></div></div>
      <div class="tc-more" hidden>
        <button data-k="t">A/THR</button>
        <button data-k="[">SPD −5</button>
        <button data-k="]">SPD +5</button>
        <button data-k="\\">SPD managed</button>
        <button data-hold="End">TRIM nose ▲</button>
        <button data-hold="Home">TRIM nose ▼</button>
        <button data-k="j" data-fm>APPR</button>
        <button data-k="o" data-fm>FCU</button>
        <button data-k="y" data-fm>MCDU</button>
        <button data-k="0">Overhead</button>
        <button data-k="l">Limiter</button>
        <button data-k="k">Parking brake</button>
        <button data-k="x" data-shift>Arm spoilers</button>
        <button data-k="i">Big PFD (3D deck)</button>
        <button data-tc="invert">Stick: pull = nose up</button>
        <button data-tc="full">⛶ Full screen</button>
        <button data-tc="off">Touch controls off</button>
      </div>
      <div class="tc-rotate">↻ Turn your phone sideways to fly</div>`;
    document.body.appendChild(ui);
    // never let a touch on the controls reach the 3D view or the page (no camera drags, no zoom, no text selection)
    for (const t of ['pointerdown', 'touchstart', 'mousedown', 'dblclick', 'contextmenu', 'wheel']) {
      ui.addEventListener(t, (e) => {
        if (e.target.closest('button, .tc-thr, .tc-stick-zone, .tc-more')) { e.stopPropagation(); if (t === 'contextmenu' || t === 'dblclick') e.preventDefault(); }
      });
    }
    marks();
    bindThrust(ui.querySelector('.tc-thr'));
    bindStick(ui.querySelector('.tc-stick-zone'));
    bindButtons();
  }

  function marks() {
    const box = ui.querySelector('.tc-thr-marks');
    const ds = P() && P().detents ? P().detents() : [];
    box.innerHTML = ds.map((d) => `<span style="bottom:${d.at * 100}%"><i></i>${d.name}</span>`).join('');
    ui.dataset.type = P() ? P().type || '' : '';
  }

  // the thrust lever: where the finger is is where the lever goes, clicking into the detents on the way
  function bindThrust(el) {
    let id = null, last = null;
    const at = (ev) => {
      const r = el.querySelector('.tc-thr-track').getBoundingClientRect();
      let v = clamp((r.bottom - ev.clientY) / r.height, 0, 1);
      const ds = P() && P().detents ? P().detents() : [];
      for (const d of ds) if (Math.abs(v - d.at) < 0.025) v = d.at; // (the detents hold it)
      const near = ds.find((d) => d.at === v);
      if (near && last !== near.name) { buzz(12); last = near.name; } else if (!near) last = null;
      P().setLever(v);
      refresh();
    };
    el.addEventListener('pointerdown', (ev) => {
      if (id != null) return;
      id = ev.pointerId; el.setPointerCapture(id); el.classList.add('held'); at(ev); ev.preventDefault();
    });
    el.addEventListener('pointermove', (ev) => { if (ev.pointerId === id) at(ev); });
    const up = (ev) => { if (ev.pointerId !== id) return; id = null; el.classList.remove('held'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // the stick: it starts where the thumb goes down and follows it, a ring 62 px round
  function bindStick(zone) {
    const base = zone.querySelector('.tc-stick-base'), knob = base.querySelector('i');
    const R = () => (Math.min(window.innerWidth, window.innerHeight) < 500 ? 56 : 70);
    const show = () => {
      const r = R();
      base.style.width = base.style.height = `${2 * r}px`;
      const zr = zone.getBoundingClientRect();
      base.style.left = `${stick.x0 - zr.left - r}px`; base.style.top = `${stick.y0 - zr.top - r}px`;
      knob.style.transform = `translate(${stick.x * r}px, ${stick.y * r}px)`;
    };
    zone.addEventListener('pointerdown', (ev) => {
      if (stick.id != null) return;
      stick.id = ev.pointerId; zone.setPointerCapture(stick.id);
      stick.x0 = ev.clientX; stick.y0 = ev.clientY; stick.x = stick.y = 0;
      zone.classList.add('held'); show(); ev.preventDefault();
    });
    zone.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== stick.id) return;
      const r = R();
      let dx = (ev.clientX - stick.x0) / r, dy = (ev.clientY - stick.y0) / r;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      stick.x = dx; stick.y = dy; show();
    });
    const up = (ev) => {
      if (ev.pointerId !== stick.id) return;
      stick.id = null; stick.x = stick.y = 0; zone.classList.remove('held');
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  function bindButtons() {
    ui.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b || !ui.contains(b)) return;
      buzz(6);
      const more = ui.querySelector('.tc-more');
      if (b.dataset.k != null) { press(b.dataset.k, { shift: b.hasAttribute('data-shift') }); refresh(); return; }
      switch (b.dataset.tc) {
        case 'inst': pref.inst = (pref.inst + 1) % INST.length; keep(); break;
        case 'tilt': setTilt(!tilt.on); break;
        case 'mid': tilt.mid = null; break; // (the next reading is the middle)
        case 'pause': press('p'); break;
        case 'cam': press('c'); break;
        case 'ap': press('u'); break;
        case 'ck-save': press('z'); break;
        case 'ck-back': press('Backspace'); break;
        case 'more': more.hidden = !more.hidden; break;
        case 'menu': more.hidden = true; if (P().menu) P().menu(); break;
        case 'gear': press('g'); break;
        case 'flapdn': press('f'); break;
        case 'flapup': press('f', { shift: true }); break;
        case 'sb': press('x'); break;
        case 'rev': press('r'); break;
        case 'invert': pref.invert = !pref.invert; keep(); break;
        case 'full': fullScreen(); break;
        case 'off': pref.mode = 'off'; keep(); more.hidden = true; apply(); break;
        default: break;
      }
      refresh();
    });
    // held buttons: the wheel brakes and the trim
    const holdOn = (b) => {
      if (b.dataset.tc === 'brake') brakeHeld = true;
      else if (b.dataset.hold) key(b.dataset.hold, 'keydown');
      b.classList.add('down');
    };
    const holdOff = (b) => {
      if (b.dataset.tc === 'brake') brakeHeld = false;
      else if (b.dataset.hold) key(b.dataset.hold, 'keyup');
      b.classList.remove('down');
    };
    for (const b of ui.querySelectorAll('[data-tc=brake], [data-hold]')) {
      b.addEventListener('pointerdown', (ev) => { b.setPointerCapture(ev.pointerId); holdOn(b); });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => holdOff(b));
    }
  }
  const say = (t) => { const s = S(); if (s && s.msgs) s.msgs.push({ text: t, level: 'info', until: performance.now() + 3000 }); };

  function fullScreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const el = d.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { say('Full screen: add this page to the home screen (Share → Add to Home Screen)'); return; }
    Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => say('Full screen was not allowed'));
  }

  // ---------- tilt: the phone as a steering wheel ----------
  // The way up, in the screen's own frame (x right, y up, z out of the screen), from the phone's orientation; then
  // roll = how far the screen is turned like a wheel, pitch = how far it leans back from where it was held at first.
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b), uz = Math.cos(b) * Math.cos(g);
    const ang = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
    const sx = ux * Math.cos(ang) - uy * Math.sin(ang), sy = ux * Math.sin(ang) + uy * Math.cos(ang);
    const rollDeg = Math.asin(clamp(-sx, -1, 1)) * 180 / Math.PI; // (turned clockwise = right)
    const leanDeg = Math.atan2(uz, sy) * 180 / Math.PI; // (0 upright, 90 flat on its back)
    if (tilt.mid == null) { tilt.mid = leanDeg; buzz(20); }
    const dz = (v, d) => (Math.abs(v) < d ? 0 : v - Math.sign(v) * d);
    tilt.roll = clamp(dz(rollDeg, 2) / 28, -1, 1);
    tilt.pitch = clamp(dz(tilt.mid - leanDeg, 2) / 20, -1, 1); // (the top edge tipped towards you = pulling = nose up)
    tilt.ok = true;
  }
  async function setTilt(on) {
    if (on) {
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) { say('This device has no tilt sensor'); return; }
      if (typeof DOE.requestPermission === 'function') { // (iPhone: asked once, from this tap)
        try { if ((await DOE.requestPermission()) !== 'granted') { say('Tilt needs the motion sensor: allow it in the browser'); return; } } catch { say('Tilt was not allowed'); return; }
      }
      tilt.mid = null; tilt.ok = false;
      window.addEventListener('deviceorientation', onOrient);
      setTimeout(() => { if (tilt.on && !tilt.ok) say('No tilt readings from this device'); }, 1500);
    } else {
      window.removeEventListener('deviceorientation', onOrient);
      tilt.ok = false;
    }
    tilt.on = on; pref.tilt = on; keep();
    refresh();
  }

  // ---------- what the buttons say ----------
  function refresh() {
    if (!ui || ui.hidden) return;
    const s = S(), p = P();
    if (!s || !s.spec) return;
    const q = (sel) => ui.querySelector(sel);
    if (ui.dataset.type !== (p.type || '')) marks();
    // the lever
    const lv = s.lever;
    q('.tc-thr-fill').style.height = `${clamp(lv, 0, 1) * 100}%`;
    q('.tc-thr-handle').style.bottom = `calc(18px + ${clamp(lv, 0, 1).toFixed(4)} * (100% - 36px))`;
    q('.tc-thr-handle b').textContent = lv < 0 ? 'REV' : p.detentName ? p.detentName(lv) : '';
    q('.tc-thr').classList.toggle('rev', lv < 0);
    // the buttons
    const fixed = s.spec.gear === 'fixed';
    const gb = q('[data-tc=gear]');
    gb.querySelector('small').textContent = fixed ? 'FIXED' : s.gearDown ? (s.gear > 0.998 ? 'DOWN' : '▼ …') : (s.gear < 0.002 ? 'UP' : '▲ …');
    gb.classList.toggle('lit', !fixed && s.gearDown);
    const C = p.confs ? p.confs() : [];
    q('[data-tc=flapdn] small').textContent = C.length > 1 ? C[s.conf].name : 'none';
    q('[data-tc=flapdn]').disabled = q('[data-tc=flapup]').disabled = C.length <= 1;
    const sbb = q('[data-tc=sb]');
    sbb.hidden = !s.spec.speedBrake;
    sbb.querySelector('small').textContent = s.sb >= 1 ? 'FULL' : s.sb > 0 ? '½' : s.armed ? 'ARMED' : 'RET';
    sbb.classList.toggle('lit', s.sb > 0);
    q('[data-tc=brake]').classList.toggle('lit', !!s.parking);
    q('[data-tc=brake] small').textContent = s.parking ? 'PARK' : 'hold';
    const rv = q('[data-tc=rev]');
    rv.hidden = !(s.spec.rev && s.onGround);
    rv.classList.toggle('lit', lv < 0);
    q('[data-tc=pause]').textContent = s.paused ? '▶' : '⏸';
    q('[data-tc=pause]').classList.toggle('lit', !!s.paused);
    q('[data-tc=ck-back]').disabled = !s.ck;
    const fm = !!(FG.fmgc && FG.fmgc.on);
    const ap = q('[data-tc=ap]');
    ap.hidden = !fm;
    if (fm) ap.classList.toggle('lit', !!FG.fmgc.apOn());
    for (const b of ui.querySelectorAll('[data-fm]')) b.hidden = !fm;
    q('[data-k=t]').classList.toggle('lit', !!s.athr);
    q('[data-k=l]').textContent = !s.spec.prot ? 'No limiter' : s.limiter ? 'Limiter: on' : 'Limiter: OFF';
    q('[data-k=k]').classList.toggle('lit', !!s.parking);
    q('[data-k=i]').hidden = !(FG.cockpit3d && s.cam === 'cockpit');
    q('[data-tc=inst]').textContent = INST[pref.inst];
    q('[data-tc=tilt]').classList.toggle('lit', tilt.on);
    q('[data-tc=mid]').hidden = !tilt.on;
    q('[data-tc=invert]').textContent = pref.invert ? 'Stick: pull = nose down' : 'Stick: pull = nose up';
    ui.querySelector('.tc-stick-zone').classList.toggle('tilt', tilt.on);
  }

  // ---------- on and off with the flight ----------
  let wasOn = false, padNow = 0;
  function apply() {
    const on = !!(P() && P().active && wanted());
    T.on = on;
    if (on && !ui) build();
    if (ui) ui.hidden = !on;
    document.body.classList.toggle('fly-touch', on);
    if (on && !wasOn) {
      // a phone has no room for the glareshield: it waits under ⋯ → FCU
      if (!fcuOffOnce && FG.fmgc && FG.fcu) {
        const el = document.getElementById('fcu');
        if (el && !el.hidden) { FG.fmgc.fcuToggle(); fcuOffOnce = true; }
      }
      if (pref.tilt && !tilt.on && !(window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission)) setTilt(true);
      marks();
    }
    if (!on) { stick.id = null; stick.x = stick.y = 0; brakeHeld = false; }
    wasOn = on;
    // outside the cockpit the plane sits higher on the screen, above the instruments and between the thumbs
    const map = FG.view3d && FG.view3d.map, s = S();
    if (map && map.setPadding && !T.noPad) {
      const want = on && s && s.cam !== 'cockpit' ? Math.round(window.innerHeight * (window.innerHeight > window.innerWidth ? 0.25 : 0.3)) : 0;
      const pad = map.getPadding ? map.getPadding().bottom || 0 : padNow;
      if (Math.abs(pad - want) > 1 && (want || padNow)) { map.setPadding({ top: 0, left: 0, right: 0, bottom: want }); padNow = want; }
    }
    refresh();
  }
  setInterval(apply, 150);
  // a desktop with a touch screen: touch controls from the first touch
  window.addEventListener('touchstart', () => { if (!touched) { touched = true; apply(); } }, { passive: true, capture: true });

  const T = {
    on: false, input, layout, apply, onOrient, noPad: false,
    get pref() { return pref; },
    // the menu's switch: on, off (kept)
    set(on) { pref.mode = on ? 'on' : 'off'; keep(); apply(); },
    stick, tilt, // (tests)
  };
  FG.touch = T;
})();
