// The flight deck's panels as modules: each module is one real panel (the FCU, an EFIS control panel, a radio
// management panel, the transponder, the fire panel, the exterior lights, ...) with its own picture and its own
// controls, laid out from its own top-left corner. A deck is a list of where its modules sit on each of its four
// surfaces (the glareshield, the main panel, the pedestal and the overhead):
//
//     LAYOUTS.a320.pedestal = [['rmp', 8, 410, { i: 0 }], ['xpdr', 14, 880], ...]
//
// To give another aircraft a module, add a line to its deck's list; to move one, change its x and y (canvas pixels
// of that surface: the glareshield 2560 × 128, the main panel 1024 × 256, the pedestal 512 × 1024 front at the top,
// the overhead 1024 × 1004 aft at the top). DECK_OF says which deck (and so which layout) each type flies with.
// Every module works the same wherever it is: its switches set FG.systems (src/systems.js, src/aircraft.js,
// src/radio.js) and FG.fmgc (src/fmgc.js), and its lights read them.
//
// The same surfaces are the 2D pages: 0 the overhead, 9 the pedestal (FG.panels.page), for any type and camera.
//
// Controls: { x, y, w, h (centred, module pixels), draw(T, b, g), sig() (it is painted again when this changes),
// click({ fx, fy, button, wheel, shift }) (fx, fy: -1 … 1 across it), tip }. A click on a switch's upper half moves
// it up; on a knob's left or right half turns it; the wheel turns knobs; a right-click pulls the FCU's knobs.
import * as THREE from 'three';

// ---------- the systems ----------
const P_ = () => FG.pilot;
export const SYS = () => (FG.systems && FG.systems.ready && FG.systems.ready() ? FG.systems : null);
export const FM = () => (FG.fmgc && FG.fmgc.on ? FG.fmgc : null);
const S = () => (SYS() ? SYS().S : null);
const set = (what, v, i) => { const x = SYS(); if (x) x.set(what, v, i); };
const F = () => (FG.fmgc ? FG.fmgc.F : null);
const press = (b) => { const M = FM(); if (M) M.press(b); else if (FG.fmgc) FG.fmgc.press(b); };
const lit = (t, col, on) => ({ t, col, on: !!on });
const J = (v) => JSON.stringify(v);
const pad = (n, w) => String(Math.round(n)).padStart(w, '0');

// ---------- canvas pictures ----------
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// A panel's picture: its face (`base`) and what glows on it at night (`glow`: legends, lit buttons).
export function panelArt(wPx, hPx, paint, bg = '#4b5058') {
  const base = canvas(wPx, hPx), glow = canvas(wPx, hPx);
  const b = base.getContext('2d'), g = glow.getContext('2d');
  b.fillStyle = bg; b.fillRect(0, 0, wPx, hPx);
  g.fillStyle = '#000'; g.fillRect(0, 0, wPx, hPx);
  paint(b, g, wPx, hPx);
  return { map: texture(base), glow: texture(glow) };
}
// Annunciator lights: TEST lights them all, DIM dims them.
export const annTest = () => { const x = S(); return !!(x && x.lt.ann === 'TEST'); };
export const annDim = () => { const x = S(); return !!(x && x.lt.ann === 'DIM'); };
export const LIT = { amber: '#ffb000', red: '#ff3b30', blue: '#6fc8ff', white: '#ffffff', green: '#30d158' };
// The tools for painting panels: Airbus pushbuttons (square, dark, a lit legend), knobs, number windows, labels.
export function tools(b, g) {
  const T = {
    label(x, y, text, size = 11, color = '#e9edf1', align = 'center') {
      for (const c of [b, g]) {
        c.font = `600 ${size}px system-ui, sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
        c.fillStyle = c === b ? color : '#cfd8e2';
        c.fillText(text, x, y);
      }
    },
    plate(x, y, w, h, color = '#3d4249') { // a sub-panel, with its screws
      b.fillStyle = color; b.fillRect(x, y, w, h);
      b.strokeStyle = 'rgba(0,0,0,0.55)'; b.lineWidth = 2; b.strokeRect(x + 1, y + 1, w - 2, h - 2);
      b.strokeStyle = 'rgba(255,255,255,0.08)'; b.beginPath(); b.moveTo(x + 2, y + h - 2); b.lineTo(x + 2, y + 2); b.lineTo(x + w - 2, y + 2); b.stroke();
      b.fillStyle = '#9aa1aa';
      for (const [sx, sy] of [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]]) { b.beginPath(); b.arc(sx, sy, 1.6, 0, 7); b.fill(); }
    },
    // a section's title on a panel: white letters with a line either side
    title(x, y, w, text, size = 12) {
      T.label(x + w / 2, y, text, size, '#ffffff');
      b.font = `600 ${size}px system-ui, sans-serif`;
      const tw = b.measureText(text).width / 2 + 6;
      b.strokeStyle = '#e9edf1'; b.lineWidth = 1.2;
      b.beginPath(); b.moveTo(x + 6, y); b.lineTo(x + w / 2 - tw, y); b.moveTo(x + w / 2 + tw, y); b.lineTo(x + w - 6, y); b.stroke();
    },
    pb(x, y, s, top = '', bot = '', on = null) {
      T.pb2(x, y, s, top ? { t: top, col: 'amber', on: false } : null, bot ? { t: bot, col: 'blue', on: !!on } : null);
    },
    // pushbutton with its two legends { t, col (a LIT name), on }
    pb2(x, y, s, top, bot, w = s) {
      b.fillStyle = '#16181b'; b.fillRect(x - w / 2, y - s / 2, w, s);
      b.strokeStyle = '#6c737c'; b.lineWidth = 1.2; b.strokeRect(x - w / 2 + 0.5, y - s / 2 + 0.5, w - 1, s - 1);
      b.fillStyle = '#0b0c0e'; b.fillRect(x - w / 2 + 3, y - s / 2 + 3, w - 6, s - 6);
      const f = Math.max(6, Math.min(s * 0.24, (w * 1.6) / Math.max(4, Math.max((top && top.t.length) || 0, (bot && bot.t.length) || 0))));
      const test = annTest(), dim = annDim();
      for (const [L, dy] of [[top, -0.2], [bot, 0.2]]) {
        if (!L || !L.t) continue;
        const on = L.on || test;
        for (const c of [b, g]) {
          c.font = `700 ${f}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
          if (on) {
            c.globalAlpha = dim ? 0.6 : 1;
            c.fillStyle = LIT[L.col] || LIT.white;
            if (c === b) { c.shadowColor = LIT[L.col] || '#fff'; c.shadowBlur = 6; }
          } else c.fillStyle = c === b ? '#33383f' : '#101214';
          c.fillText(L.t, x, y + s * dy);
          c.globalAlpha = 1; c.shadowBlur = 0;
          if (L.box && on) { c.strokeStyle = LIT[L.col]; c.lineWidth = 1.5; c.strokeRect(x - w * 0.38, y + s * dy - f * 0.62, w * 0.76, f * 1.24); }
        }
      }
    },
    knob(x, y, r, color = '#2a2d31', angle = 0) {
      b.fillStyle = '#0d0e10'; b.beginPath(); b.arc(x, y + 1.5, r + 1.5, 0, 7); b.fill();
      const grd = b.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grd.addColorStop(0, '#5d636b'); grd.addColorStop(1, color);
      b.fillStyle = grd; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
      b.strokeStyle = '#d9dee4'; b.lineWidth = 1.5; b.beginPath();
      b.moveTo(x + Math.sin(angle) * r * 0.2, y - Math.cos(angle) * r * 0.2); b.lineTo(x + Math.sin(angle) * r * 0.9, y - Math.cos(angle) * r * 0.9); b.stroke();
    },
    window(x, y, w, h, text, dot, color) { // a number window (orange LCD digits, as the FCU's)
      b.fillStyle = '#050505'; b.fillRect(x - w / 2, y - h / 2, w, h);
      for (const c of [b, g]) {
        c.font = `600 ${h * 0.72}px ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = color || (c === b ? '#f2b35a' : '#f0a640'); c.fillText(text, x - (dot ? h * 0.25 : 0), y + 1);
        if (dot) { c.beginPath(); c.arc(x + w / 2 - h * 0.35, y, h * 0.14, 0, 7); c.fill(); }
      }
    },
    // a toggle switch from below: the slot, the lever's knob at position `at` of n (0 = top)
    toggle(x, y, s, at = 0, n = 2) {
      b.fillStyle = '#16181b'; b.fillRect(x - s * 0.3, y - s * 0.55, s * 0.6, s * 1.1);
      b.strokeStyle = '#5c636c'; b.lineWidth = 1; b.strokeRect(x - s * 0.3 + 0.5, y - s * 0.55 + 0.5, s * 0.6 - 1, s * 1.1 - 1);
      const ky = y - s * 0.32 + (n > 1 ? (at / (n - 1)) * s * 0.64 : 0);
      b.fillStyle = '#8a9099'; b.fillRect(x - s * 0.06, Math.min(y, ky), s * 0.12, Math.abs(ky - y));
      const grd = b.createRadialGradient(x - s * 0.05, ky - s * 0.05, 1, x, ky, s * 0.2);
      grd.addColorStop(0, '#f1f4f7'); grd.addColorStop(1, '#8b939c');
      b.fillStyle = grd; b.beginPath(); b.arc(x, ky, s * 0.19, 0, 7); b.fill();
    },
  };
  return T;
}

// ---------- a surface: its modules' pictures and controls in one canvas ----------
// `items`: [{ m (the module), x, y }]. Controls keep their module's own coordinates (c.ox, c.oy: the module's corner).
export function livePanel(W, H, bg, paintBase, controls) {
  const base = canvas(W, H), glow = canvas(W, H);
  const b = base.getContext('2d'), g = glow.getContext('2d');
  const at = (c, f) => { b.save(); g.save(); b.translate(c.ox || 0, c.oy || 0); g.translate(c.ox || 0, c.oy || 0); try { f(); } finally { b.restore(); g.restore(); } };
  const p = {
    W, H, controls, base, glow, map: texture(base), glow3: texture(glow), sig: null,
    paint(force) {
      const sig = controls.map((c) => (c.sig ? c.sig() : '')).join('|') + (annTest() ? 'T' : annDim() ? 'D' : '');
      if (!force && sig === p.sig) return false;
      p.sig = sig;
      b.fillStyle = bg; b.fillRect(0, 0, W, H);
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const T = tools(b, g);
      paintBase(T, b, g, W, H);
      for (const c of controls) if (c.draw) at(c, () => c.draw(T, b, g));
      p.map.needsUpdate = true; p.glow3.needsUpdate = true;
      return true;
    },
    // a point on the picture (canvas pixels) → the control there
    hitXY(x, y) {
      for (const c of controls) {
        if (!c.click) continue;
        const cx = c.x + (c.ox || 0), cy = c.y + (c.oy || 0);
        if (Math.abs(x - cx) <= c.w / 2 && Math.abs(y - cy) <= c.h / 2) return { c, fx: (x - cx) / (c.w / 2), fy: (y - cy) / (c.h / 2) };
      }
      return null;
    },
    hit(uv) { return p.hitXY(uv.x * W, (1 - uv.y) * H); },
  };
  p.glow = p.glow3; // (the 3D deck's emissive map)
  p.paint(true);
  return p;
}

// ---------- the controls ----------
// A pushbutton: top / bot give { t, col, on } now.
export function pbC(x, y, s, { top, bot, click, tip, w }) {
  return { x, y, w: w || s, h: s, tip, click, sig: () => J([top && top(), bot && bot()]), draw: (T) => T.pb2(x, y, s, top && top(), bot && bot(), w || s) };
}
// A toggle switch with its positions (top first) [[value, label], ...]; get() the value now, set(v).
export function swC(x, y, s, label, opts, get, setv, tip) {
  return {
    x: x + s * 0.4, y, w: s * 2.2, h: s * 1.6, tip: tip || label, sig: () => J(get()),
    draw(T) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      T.toggle(x, y, s, at, opts.length);
      opts.forEach(([, l], i) => T.label(x + s * 0.42, y - s * 0.32 + (opts.length > 1 ? (i / (opts.length - 1)) * s * 0.64 : 0), l, Math.max(7, s * 0.22), '#e9edf1', 'left'));
      if (label) T.label(x + s * 0.3, y - s * 0.95, label, Math.max(8, s * 0.26));
    },
    click({ fy, wheel }) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      const d = wheel ? (wheel > 0 ? -1 : 1) : fy < 0 ? -1 : 1;
      const to = Math.max(0, Math.min(opts.length - 1, at + d));
      if (to !== at) setv(opts[to][0]);
    },
  };
}
// A rotary selector: positions round its top (left to right) [[value, label], ...].
export function rotC(x, y, r, label, opts, get, setv, tip) {
  const ang = (i) => (opts.length > 1 ? -0.9 + (1.8 * i) / (opts.length - 1) : 0);
  return {
    x, y: y - r * 0.4, w: r * 4.2, h: r * 3.6, tip: tip || label, sig: () => J(get()),
    draw(T) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      opts.forEach(([, l], i) => T.label(x + Math.sin(ang(i)) * r * 1.75, y - Math.cos(ang(i)) * r * 1.6, l, Math.max(7, r * 0.42)));
      T.knob(x, y, r, '#2a2d31', ang(at));
      if (label) T.label(x, y + r * 1.45, label, Math.max(8, r * 0.48));
    },
    click({ fx, wheel }) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      const d = wheel ? (wheel > 0 ? 1 : -1) : fx < 0 ? -1 : 1;
      const to = Math.max(0, Math.min(opts.length - 1, at + d));
      if (to !== at) setv(opts[to][0]);
    },
  };
}
// A continuous knob (lighting, brightness): 0 … 1; a click on its left half turns it down, on the right half up.
export function dimC(x, y, r, label, get, setv) {
  return {
    x, y, w: r * 3, h: r * 3, tip: `${label}: click left / right or the wheel`, sig: () => J(Math.round(get() * 20)),
    draw(T) { T.knob(x, y, r, '#2a2d31', -2.3 + 4.6 * get()); T.label(x, y + r * 1.6, label, Math.max(7, r * 0.5)); T.label(x - r * 1.2, y + r * 0.9, 'OFF', 7); T.label(x + r * 1.2, y + r * 0.9, 'BRT', 7); },
    click({ fx, wheel }) { setv(Math.max(0, Math.min(1, get() + (wheel ? wheel * 0.1 : fx < 0 ? -0.25 : 0.25)))); },
  };
}
// The big red FIRE pushbutton of an engine or the APU, under its clear guard.
export function fireC(x, y, w, h, name, litF, pushed, click) {
  return {
    x, y, w, h, tip: `${name} FIRE pushbutton: push to cut its fuel and arm the agents`, click, sig: () => J([litF(), pushed(), annTest()]),
    draw(T, b, g) {
      const on = litF() || annTest(), dn = pushed();
      b.fillStyle = '#16181b'; b.fillRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
      b.fillStyle = on ? '#d0261a' : '#4a1410'; b.fillRect(x - w / 2, y - h / 2 + (dn ? 3 : 0), w, h - (dn ? 3 : 0));
      if (on) { g.fillStyle = '#ff3b30'; g.fillRect(x - w / 2, y - h / 2, w, h); }
      for (const c of [b, g]) {
        c.font = `800 ${h * 0.24}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = c === b ? (on ? '#fff3e8' : '#d9a39b') : (on ? '#ffffff' : '#200806');
        c.fillText(name, x, y - h * 0.18); c.fillText('FIRE', x, y + h * 0.16);
      }
      T.label(x, y + h * 0.41, 'PUSH', Math.max(7, h * 0.14), '#e9edf1');
      b.strokeStyle = 'rgba(220,230,240,0.55)'; b.lineWidth = 2; b.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
    },
  };
}
// An FCU-style button: its name, and the green bar lit when it is on.
export function fcuBtnC(x, y, w, h, label, litF, click, tip) {
  return {
    x, y, w, h, tip: tip || label.replace('\n', ' '), click, sig: () => J(litF()),
    draw(T, b, g) {
      b.fillStyle = '#25282c'; b.fillRect(x - w / 2, y - h / 2, w, h);
      b.strokeStyle = '#5c636c'; b.lineWidth = 1; b.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
      const on = litF() || annTest();
      b.fillStyle = on ? '#30d158' : '#123018'; b.fillRect(x - w * 0.3, y - h * 0.32, w * 0.6, h * 0.12);
      if (on) { g.fillStyle = '#30d158'; g.fillRect(x - w * 0.3, y - h * 0.32, w * 0.6, h * 0.12); }
      const lines = label.split('\n');
      lines.forEach((l, i) => T.label(x, y + h * 0.12 + (i - (lines.length - 1) / 2) * h * 0.26, l, Math.max(7, Math.min(h * 0.3, (w * 1.5) / l.length)), '#e9edf1'));
    },
  };
}
// An FCU knob: wheel turns, click pushes, right-click pulls; a click on its left or right edge turns it a step.
export function fcuKnobC(x, y, r, name) {
  let ang = 0;
  return {
    x, y, w: r * 2.6, h: r * 2.6, tip: `${name.toUpperCase()} knob: wheel turns · click PUSH · right-click PULL · click its edge: a step`, sig: () => J(ang),
    draw(T) { T.knob(x, y, r, '#2a2d31', ang); },
    click({ fx, button, wheel, shift }) {
      const M = FM();
      if (!M) return;
      if (wheel) { M.turn(name, wheel > 0 ? 1 : -1, shift); ang += wheel > 0 ? 0.26 : -0.26; }
      else if (button === 2) M.pull(name);
      else if (Math.abs(fx) > 0.6) { M.turn(name, fx > 0 ? 1 : -1, shift); ang += fx > 0 ? 0.26 : -0.26; }
      else M.push(name);
    },
  };
}
// A number window: text() gives [text, dot] (or { t, dot, col }).
export function winC(x, y, w, h, text, click, tip) {
  return { x, y, w, h, click, tip, sig: () => J(text()), draw: (T) => { const v = text(); const [t, dot, col] = Array.isArray(v) ? v : [v.t, v.dot, v.col]; T.window(x, y, w, h, t, dot, col); } };
}
// A plain area that does something when clicked (a keyboard, an MCDU's face).
export function areaC(x, y, w, h, tip, click) { return { x, y, w, h, tip, click, sig: () => '' }; }

// ---------- the modules ----------
// MODULES[name](o) → { w, h, paint(T, b, g) (its face, from its corner), controls }. o: the deck's { kind, nEng }
// and the layout line's own options ({ i } for the side, ...).
const sideName = (i) => (i ? 'F/O' : 'CAPT');
export const MODULES = {
  // MASTER WARN / MASTER CAUT, before each pilot
  warn: () => ({
    w: 148, h: 100,
    paint: (T) => T.plate(0, 0, 148, 100, '#202326'),
    controls: [
      pbC(40, 50, 58, { top: () => lit('MASTER', 'red', S() && S().mw && Math.floor(performance.now() / 400) % 2), bot: () => lit('WARN', 'red', S() && S().mw && Math.floor(performance.now() / 400) % 2), click: () => set('masterWarn'), tip: 'MASTER WARN: push to silence the chime' }),
      pbC(108, 50, 58, { top: () => lit('MASTER', 'amber', S() && S().mc), bot: () => lit('CAUT', 'amber', S() && S().mc), click: () => set('masterCaut'), tip: 'MASTER CAUT: push to clear' }),
    ],
  }),
  // an EFIS control panel: FD, LS, the ND's options (one at a time, as the real ones), mode and range
  efis: () => ({
    w: 300, h: 116,
    paint: (T) => { T.plate(0, 0, 300, 116); T.label(142, 60, 'EFIS', 9, '#9aa1aa'); },
    controls: [
      fcuBtnC(30, 34, 44, 34, 'FD', () => !!(F() && F().fd), () => press('FD'), 'FD: the flight directors on the PFD'),
      fcuBtnC(30, 84, 44, 34, 'LS', () => !!(F() && F().ls), () => press('LS'), 'LS: the ILS deviations on the PFD'),
      ...['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'].map((l, i) => fcuBtnC(88 + i * 38, 26, 34, 28, l, () => !!(F() && F().nd && F().nd.opt === l), () => press(`ND ${l}`),
        { CSTR: 'CSTR: the flight plan\'s altitudes at its waypoints', WPT: 'WPT: waypoints round you (the towns the MCDU knows)', 'VOR.D': 'VOR.D: VORs and DMEs', NDB: 'NDB: the NDBs', ARPT: 'ARPT: the airports' }[l])),
      swC(60, 88, 16, '1', [['ADF', 'ADF'], ['OFF', 'OFF'], ['VOR', 'VOR']], () => (F() && F().nd.needle ? F().nd.needle[0] : 'OFF'), (v) => { const f = F(); if (f) f.nd.needle[0] = v; }, 'Bearing needle 1: ADF 1 · OFF · VOR 1'),
      swC(98, 88, 16, '2', [['ADF', 'ADF'], ['OFF', 'OFF'], ['VOR', 'VOR']], () => (F() && F().nd.needle ? F().nd.needle[1] : 'OFF'), (v) => { const f = F(); if (f) f.nd.needle[1] = v; }, 'Bearing needle 2: ADF 2 · OFF · VOR 2'),
      rotC(150, 90, 13, 'MODE', [['ROSE', 'ROSE'], ['ARC', 'ARC'], ['PLAN', 'PLAN']], () => (F() ? F().nd.mode : 'ARC'), (v) => { const f = F(); if (f) f.nd.mode = v; }, 'ND MODE: ROSE NAV · ARC · PLAN'),
      rotC(236, 90, 13, 'RANGE', [[10, '10'], [20, '20'], [40, '40'], [80, '80'], [160, '160'], [320, '320']], () => (F() ? F().nd.range : 40), (v) => { const f = F(); if (f) f.nd.range = v; }, 'ND RANGE (NM)'),
    ],
  }),
  // the FCU: speed, heading, altitude and vertical speed windows with their knobs, the autopilot's buttons
  fcu: () => {
    const fw = 844.8, at = (f) => 6 + f * fw;
    const s = () => P_().state;
    const managedSpd = () => s().spdSel == null && s().machSel == null;
    const hdgMgd = () => { const f = F(); return !!f && (f.hdgMgd || ['NAV', 'LOC*', 'LOC', 'LAND', 'FLARE', 'ROLL OUT'].includes(f.lat)); };
    return {
      w: fw + 12, h: 120,
      paint: (T) => {
        T.plate(0, 0, fw + 12, 120, '#33373d');
        const lbl = (f, y, t) => T.label(at(f), y, t, 11);
        lbl(0.15, 10, 'SPD   MACH'); lbl(0.35, 10, 'HDG   TRK   LAT'); lbl(0.66, 10, 'ALT    LVL/CH'); lbl(0.885, 10, 'V/S   FPA');
      },
      controls: [
        fcuBtnC(at(0.05), 88, 50, 34, 'SPD\nMACH', () => false, () => press('SPDMACH')),
        winC(at(0.15), 36, 84, 28, () => {
          const f = F(); if (!f) return ['---', false];
          if (f.fcu.spdPreset != null) return [pad(f.fcu.spdPreset, 3), false];
          if (managedSpd()) return ['---', true];
          return s().machSel != null ? [`.${pad(s().machSel * 100, 2)}`, false] : [pad(s().spdSel, 3), false];
        }),
        fcuKnobC(at(0.15), 90, 19, 'spd'),
        fcuBtnC(at(0.25), 88, 50, 34, 'LOC', () => !!(F() && F().locBtn && !F().appr), () => press('LOC')),
        winC(at(0.35), 36, 84, 28, () => { const f = F(); if (!f) return ['---', false]; if (f.fcu.hdgPreset != null) return [pad(f.fcu.hdgPreset, 3), false]; return hdgMgd() ? ['---', true] : [pad(f.fcu.hdg % 360, 3), false]; }),
        fcuKnobC(at(0.35), 90, 19, 'hdg'),
        fcuBtnC(at(0.44), 36, 62, 34, 'HDG V/S\nTRK FPA', () => false, () => press('TRKFPA')),
        fcuBtnC(at(0.50), 88, 46, 32, 'AP1', () => !!(F() && F().ap1), () => press('AP1')),
        fcuBtnC(at(0.565), 88, 46, 32, 'AP2', () => !!(F() && F().ap2), () => press('AP2')),
        fcuBtnC(at(0.532), 36, 60, 30, 'A/THR', () => !!(s().athr && s().spec && s().spec.athr), () => press('ATHR')),
        winC(at(0.66), 36, 104, 28, () => { const f = F(); return f ? [pad(f.fcu.alt, 5), f.altMgd] : ['-----', false]; }),
        fcuKnobC(at(0.66), 90, 19, 'alt'),
        fcuBtnC(at(0.755), 36, 50, 30, 'ALT\n100/1000', () => false, () => press('ALTINC'), 'the ALT knob: 100 or 1000 ft a step'),
        winC(at(0.755), 88, 50, 22, () => { const f = F(); return [f ? String(f.fcu.altInc) : '1000', false]; }),
        fcuBtnC(at(0.83), 88, 52, 34, 'EXPED', () => !!(F() && F().exped), () => press('EXPED')),
        winC(at(0.885), 36, 84, 28, () => {
          const f = F(); if (!f) return ['-----', false];
          if (f.vert === 'V/S') return [`${f.fcu.vs < 0 ? '-' : '+'}${pad(Math.abs(f.fcu.vs) / 100, 2)}oo`, false];
          if (f.vert === 'FPA') return [`${f.fcu.fpa < 0 ? '-' : '+'}${Math.abs(f.fcu.fpa).toFixed(1)}`, false];
          return ['-----', false];
        }),
        fcuKnobC(at(0.885), 90, 19, 'vs'),
        fcuBtnC(at(0.96), 88, 50, 34, 'APPR', () => !!(F() && F().appr), () => press('APPR')),
      ],
    };
  },

  // ---- overhead ----
  // ADIRS: the three IRs' mode selectors and their lights, the air data pushbuttons
  adirs: () => {
    const ir = (k) => (S() && S().adirs ? S().adirs.ir[k] : { mode: 'NAV', ok: true, align: 0 });
    const C = [];
    for (let k = 0; k < 3; k++) {
      const x = 48 + k * 88;
      C.push(pbC(x, 40, 34, { top: () => lit('FAULT', 'amber', ir(k).align < 0 || (ir(k).mode !== 'OFF' && !ir(k).ok && ir(k).mode === 'NAV' && P_().state.onGround === false)), bot: () => lit('ALIGN', 'white', ir(k).align > 0 && Math.floor(performance.now() / 500) % 2 || ir(k).align < 0), tip: `IR ${k + 1}: FAULT · ALIGN (flashing while it aligns)` }));
      C.push(rotC(x, 92, 11, `IR ${k + 1}`, [['OFF', 'OFF'], ['NAV', 'NAV'], ['ATT', 'ATT']], () => ir(k).mode, (v) => set('irMode', v, k), `IR ${k + 1} MODE: OFF · NAV · ATT`));
      C.push(pbC(x + 34, 40, 30, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', S() && S().adirs && !S().adirs.adr[k]), click: () => set('adr', undefined, k), tip: `ADR ${k + 1} (air data)` }));
    }
    return { w: 270, h: 120, paint: (T) => { T.plate(0, 0, 270, 120); T.title(0, 12, 270, 'ADIRS', 11); }, controls: C };
  },
  evac: () => ({
    w: 70, h: 120, paint: (T) => { T.plate(0, 0, 70, 120); T.title(0, 12, 70, 'EVAC', 10); },
    controls: [pbC(35, 60, 44, { top: () => lit('EVAC', 'red', S() && S().misc && S().misc.evac && Math.floor(performance.now() / 300) % 2), bot: () => lit('ON', 'white', S() && S().misc && S().misc.evac), click: () => set('evac'), tip: 'EVAC COMMAND: the evacuation horn (again: off)' })],
  }),
  emerElec: () => ({
    w: 110, h: 120, paint: (T) => { T.plate(0, 0, 110, 120); T.title(0, 12, 110, 'EMER ELEC', 10); T.label(30, 96, 'GEN 1 LINE', 7); T.label(80, 96, 'EMER PWR', 7); },
    controls: [
      pbC(30, 60, 38, { top: () => lit('SMOKE', 'amber', false), bot: () => lit('OFF', 'white', S() && S().elec && !S().elec.gen1Line), click: () => set('gen1Line'), tip: 'GEN 1 LINE: off takes generator 1 off its bus (smoke drill)' }),
      pbC(80, 60, 38, { top: () => lit('FAULT', 'red', S() && S().elec && S().elec.level === 'bat'), bot: () => lit('MAN ON', 'blue', S() && S().elec && S().elec.rat), click: () => set('ratMan'), tip: 'EMER ELEC PWR MAN ON: drops the RAT (ram air turbine)' }),
    ],
  }),
  gpws: () => {
    const G = () => (S() && S().gpws) || {};
    const b = (x, k, what, label, botT, tip) => pbC(x, 60, 40, { top: () => lit('FAULT', 'amber', false), bot: () => (what === 'gpwsLdg3' ? lit('ON', 'blue', G().ldg3) : lit(botT || 'OFF', 'white', !G()[k])), click: () => set(what), tip });
    return {
      w: 250, h: 120, paint: (T) => { T.plate(0, 0, 250, 120); T.title(0, 12, 250, 'GPWS', 10); ['SYS', 'TERR', 'G/S MODE', 'FLAP MODE', 'LDG FLAP 3'].forEach((l, i) => T.label(28 + i * 48, 96, l, 7)); },
      controls: [
        b(28, 'sys', 'gpwsSys', 'SYS', 'OFF', 'GPWS SYS: off, no PULL UP, SINK RATE, TOO LOW, TERRAIN'),
        b(76, 'terr', 'gpwsTerr', 'TERR', 'OFF', 'GPWS TERR: the terrain ahead (TERRAIN AHEAD, PULL UP)'),
        b(124, 'gs', 'gpwsGs', 'G/S', 'OFF', 'G/S MODE: GLIDE SLOPE below the beam'),
        b(172, 'flap', 'gpwsFlap', 'FLAP', 'OFF', 'FLAP MODE: off, no TOO LOW FLAPS'),
        b(220, 'ldg3', 'gpwsLdg3', 'LDG 3', 'ON', 'LDG FLAP 3: land with flaps 3 (no TOO LOW FLAPS, LDG memo)'),
      ],
    };
  },
  rcdr: () => ({
    w: 60, h: 120, paint: (T) => { T.plate(0, 0, 60, 120); T.title(0, 12, 60, 'RCDR', 10); T.label(30, 96, 'GND CTL', 7); },
    controls: [pbC(30, 60, 38, { bot: () => lit('ON', 'blue', S() && S().misc && S().misc.rcdr), click: () => set('rcdr'), tip: 'RCDR GND CTL: the voice and data recorders on, on the ground' })],
  }),
  oxygen: () => ({
    w: 110, h: 120, paint: (T) => { T.plate(0, 0, 110, 120); T.title(0, 12, 110, 'OXYGEN', 10); T.label(30, 96, 'MASK MAN ON', 7); T.label(80, 96, 'CREW SUPPLY', 7); },
    controls: [
      pbC(30, 60, 38, { top: () => lit('SYS ON', 'white', S() && S().air && S().air.paxMasks), click: () => set('paxMasks'), tip: 'MASK MAN ON: drops the passengers\' oxygen masks' }),
      pbC(80, 60, 38, { bot: () => lit('OFF', 'white', S() && S().misc && !S().misc.crewOxy), click: () => set('crewOxy'), tip: 'CREW SUPPLY: the crew\'s oxygen (off up there: hypoxia)' }),
    ],
  }),
  calls: () => ({
    w: 110, h: 120, paint: (T) => { T.plate(0, 0, 110, 120); T.title(0, 12, 110, 'CALLS', 10); T.label(30, 96, 'MECH', 8); T.label(80, 96, 'ALL', 8); },
    controls: [
      pbC(30, 60, 38, { bot: () => lit('CALL', 'white', false), click: () => set('callMech'), tip: 'MECH: call the ground mechanic' }),
      pbC(80, 60, 38, { bot: () => lit('CALL', 'white', false), click: () => set('callAll'), tip: 'ALL: call the cabin crew' }),
    ],
  }),
  hyd: ({ nEng }) => {
    const H = () => (S() && S().hyd) || { engPump: [], p: {} };
    const sysOf = (i) => (nEng >= 4 ? (i === 0 || i === 3 ? 'GREEN' : i === 1 ? 'BLUE' : 'YELLOW') : i === 0 ? 'GREEN' : 'YELLOW');
    const C = [];
    const dx = 230 / nEng;
    for (let i = 0; i < nEng; i++) C.push(pbC(20 + dx * (i + 0.5), 70, 40, { top: () => lit('FAULT', 'amber', S() && S().eng[i] && S().eng[i].run === 1 && !H().engPump[i]), bot: () => lit('OFF', 'white', !H().engPump[i]), click: () => set('engPump', undefined, i), tip: `${sysOf(i)} ENG ${i + 1} PUMP` }));
    C.push(pbC(55, 170, 40, { top: () => lit('FAULT', 'amber', H().p.B < 1450 && H().bElec), bot: () => lit('OFF', 'white', !H().bElec), click: () => set('bElec'), tip: 'BLUE ELEC PUMP (AUTO: runs with an engine running)' }));
    C.push(pbC(135, 170, 40, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !H().ptu), click: () => set('ptu'), tip: 'PTU: green and yellow drive each other' }));
    C.push(pbC(215, 170, 40, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', H().yElec), click: () => set('yElec'), tip: 'YELLOW ELEC PUMP' }));
    return {
      w: 270, h: 260,
      paint: (T) => { T.plate(0, 0, 270, 260); T.title(0, 14, 270, 'HYD'); for (let i = 0; i < nEng; i++) T.label(20 + dx * (i + 0.5), 104, `${sysOf(i)[0]} ENG ${i + 1}`, 8); T.label(55, 204, 'BLUE ELEC', 8); T.label(135, 204, 'PTU', 8); T.label(215, 204, 'Y ELEC', 8); },
      controls: C,
    };
  },
  fuel: () => {
    const Fu = () => (S() && S().fuel) || { pump: {} };
    const pump = (x, y, k, tip) => pbC(x, y, 40, { top: () => lit('FAULT', 'amber', S() && S().eng.some((e) => e.run === 1) && !Fu().pump[k]), bot: () => lit('OFF', 'white', !Fu().pump[k]), click: () => set('fuelPump', undefined, k), tip });
    return {
      w: 270, h: 260,
      paint: (T) => {
        T.plate(0, 0, 270, 260); T.title(0, 14, 270, 'FUEL');
        [['L TK 1', 38], ['L TK 2', 102], ['CTR L', 166], ['CTR R', 230]].forEach(([l, x]) => T.label(x, 104, l, 8));
        [['MODE SEL', 38], ['X FEED', 102], ['R TK 1', 166], ['R TK 2', 230]].forEach(([l, x]) => T.label(x, 204, l, 8));
      },
      controls: [
        pump(38, 70, 'L1', 'L TK PUMP 1'), pump(102, 70, 'L2', 'L TK PUMP 2'), pump(166, 70, 'CL', 'CTR TK PUMP 1'), pump(230, 70, 'CR', 'CTR TK PUMP 2'),
        pbC(38, 170, 40, { top: () => lit('FAULT', 'amber', false), bot: () => lit('MAN', 'white', Fu().modeSel === 'MAN'), click: () => set('modeSel'), tip: 'MODE SEL: AUTO runs the centre pumps while there is fuel there' }),
        pbC(102, 170, 40, { top: () => lit('OPEN', 'green', Fu().xfeed), bot: () => lit('ON', 'blue', Fu().xfeed), click: () => set('xfeed'), tip: 'X FEED: either wing feeds either engine' }),
        pump(166, 170, 'R1', 'R TK PUMP 1'), pump(230, 170, 'R2', 'R TK PUMP 2'),
      ],
    };
  },
  fire: ({ nEng }) => {
    const W = 444, blocks = [...Array(nEng).keys(), 'apu'];
    const bw = W / blocks.length;
    const C = [];
    blocks.forEach((i, k) => {
      const x = bw * (k + 0.5);
      const name = i === 'apu' ? 'APU' : `ENG ${i + 1}`;
      const e = () => (S() ? (i === 'apu' ? S().apu : S().eng[i]) : null);
      C.push(fireC(x, 70, Math.min(96, bw - 22), 66, name, () => !!(e() && e().fire), () => !!(e() && e().firePb), () => set('firePb', undefined, i)));
      const ag = i === 'apu' ? [0] : [0, 1];
      const as = Math.min(44, bw / 2 - 4);
      ag.forEach((b) => {
        const ax = ag.length === 1 ? x : x + (b ? 1 : -1) * Math.min(26, bw * 0.24);
        const done = () => (e() ? (i === 'apu' ? !!e().agent : !!e().agents[b]) : false);
        C.push(pbC(ax, 162, as, { top: () => lit('SQUIB', 'white', e() && e().firePb && !done()), bot: () => lit('DISCH', 'amber', done()), click: () => set('agent', b, i), tip: `${name} AGENT ${ag.length > 1 ? b + 1 : ''}: discharge the bottle (FIRE pushbutton pushed first)` }));
      });
    });
    C.push(pbC(W / 2, 222, 36, { bot: () => lit('TEST', 'white', S() && S().test > 0), click: () => set('fireTest'), tip: 'FIRE TEST: every fire light and the chime' }));
    return { w: W + 20, h: 260, paint: (T) => { T.plate(0, 0, W + 20, 260, '#454a52'); T.title(0, 14, W + 20, 'FIRE'); }, controls: C.map((c) => ({ ...c, x: c.x + 10 })) };
  },
  elec: ({ nEng }) => {
    const E = () => (S() && S().elec) || { bat: [], gen: [], batCharge: [] };
    const C = [];
    for (let k = 0; k < 2; k++) {
      C.push(winC(k ? 235 : 95, 46, 54, 22, () => [`${(24 + 4 * (E().batCharge[k] || 0)).toFixed(1)}`, false]));
      C.push(pbC(k ? 235 : 95, 82, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !E().bat[k]), click: () => set('bat', undefined, k), tip: `BAT ${k + 1}` }));
    }
    const dx = 300 / nEng;
    for (let i = 0; i < nEng; i++) C.push(pbC(15 + dx * (i + 0.5), 140, 36, { top: () => lit('FAULT', 'amber', S() && E().gen[i] && S().eng[i] && S().eng[i].run !== 1), bot: () => lit('OFF', 'white', !E().gen[i]), click: () => set('gen', undefined, i), tip: `GEN ${i + 1}` }));
    C.push(pbC(50, 200, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !E().apuGen), click: () => set('apuGen'), tip: 'APU GEN' }));
    C.push(pbC(125, 200, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !E().busTie), click: () => set('busTie'), tip: 'BUS TIE (AUTO): either side\'s generator feeds both buses' }));
    C.push(pbC(200, 200, 36, { top: () => lit('AVAIL', 'green', P_().state.onGround && P_().state.V < 0.6), bot: () => lit('ON', 'blue', E().ext), click: () => set('extPwr'), tip: 'EXT PWR: ground power, parked' }));
    C.push(pbC(275, 200, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !E().galley), click: () => set('galley'), tip: 'GALY & CAB: the galleys and the cabin' }));
    return {
      w: 330, h: 230,
      paint: (T) => {
        T.plate(0, 0, 330, 230); T.title(0, 14, 330, 'ELEC');
        T.label(165, 82, 'BAT 1       BAT 2', 9);
        for (let i = 0; i < nEng; i++) T.label(15 + dx * (i + 0.5), 166, `GEN ${i + 1}`, 8);
        [['APU GEN', 50], ['BUS TIE', 125], ['EXT PWR', 200], ['GALY&CAB', 275]].forEach(([l, x]) => T.label(x, 224, l, 8));
      },
      controls: C,
    };
  },
  air: ({ nEng }) => {
    const R = () => (S() && S().air) || { engBleed: [], pack: [] };
    const C = [];
    const dx = 230 / nEng;
    for (let i = 0; i < nEng; i++) C.push(pbC(15 + dx * (i + 0.5), 56, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !R().engBleed[i]), click: () => set('engBleed', undefined, i), tip: `ENG ${i + 1} BLEED` }));
    C.push(pbC(290, 56, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().apu.bleed), click: () => set('apuBleed'), tip: 'APU BLEED: the APU\'s air for the engine starts and the packs' }));
    C.push(pbC(80, 122, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !R().pack[0]), click: () => set('pack', undefined, 0), tip: 'PACK 1: air conditioning and pressure' }));
    C.push(pbC(240, 122, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !R().pack[1]), click: () => set('pack', undefined, 1), tip: 'PACK 2' }));
    C.push(pbC(60, 190, 36, { top: () => lit('FAULT', 'amber', false), bot: () => lit('MAN', 'white', R().mode === 'MAN'), click: () => set('pressMode'), tip: 'CAB PRESS MODE SEL: AUTO, or MAN with the V/S switch' }));
    C.push(swC(150, 190, 30, 'MAN V/S', [[1, 'UP'], [0, '·'], [-1, 'DN']], () => R().manVs || 0, (v) => set('manVs', v), 'MAN V/S CTL: the cabin climbs (UP) or descends (DN) in MAN'));
    C.push(pbC(270, 190, 36, { bot: () => lit('ON', 'blue', R().ditching), click: () => set('ditching'), tip: 'DITCHING' }));
    return {
      w: 324, h: 230,
      paint: (T) => {
        T.plate(0, 0, 324, 230); T.title(0, 14, 324, 'AIR COND · CAB PRESS');
        for (let i = 0; i < nEng; i++) T.label(15 + dx * (i + 0.5), 82, `ENG ${i + 1} BLEED`, 7);
        T.label(290, 82, 'APU BLEED', 7); T.label(80, 148, 'PACK 1', 8); T.label(240, 148, 'PACK 2', 8);
        T.label(60, 216, 'MODE SEL', 7); T.label(270, 216, 'DITCHING', 7);
      },
      controls: C,
    };
  },
  antiIce: ({ nEng }) => {
    const C = [];
    C.push(pbC(40, 60, 40, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().wingAntiIce), click: () => set('wingAntiIce'), tip: 'WING ANTI ICE (needs bleed air)' }));
    const dx = 240 / nEng;
    for (let i = 0; i < nEng; i++) C.push(pbC(80 + dx * (i + 0.5), 60, 40, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().eng[i] && S().eng[i].antiIce), click: () => set('engAntiIce', undefined, i), tip: `ENG ${i + 1} ANTI ICE` }));
    C.push(pbC(165, 160, 44, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().ice && S().ice.probe === 'ON'), click: () => set('probeHeat'), tip: 'PROBE/WINDOW HEAT: AUTO (in flight, engines running) or ON' }));
    return {
      w: 330, h: 230,
      paint: (T) => {
        T.plate(0, 0, 330, 230); T.title(0, 14, 330, 'ANTI ICE');
        T.label(40, 92, 'WING', 9);
        for (let i = 0; i < nEng; i++) T.label(80 + dx * (i + 0.5), 92, `ENG ${i + 1}`, 9);
        T.label(165, 196, 'PROBE / WINDOW HEAT', 9);
      },
      controls: C,
    };
  },
  extLt: () => {
    const xl = [['STROBE', 'strobe', [['ON', 'ON'], ['AUTO', 'AUTO'], ['OFF', 'OFF']]], ['BEACON', 'beacon', [[1, 'ON'], [0, 'OFF']]], ['WING', 'wing', [[1, 'ON'], [0, 'OFF']]],
      ['NAV&LOGO', 'nav', [[1, '1'], [0, 'OFF']]], ['RWY TURN OFF', 'rwy', [[1, 'ON'], [0, 'OFF']]], ['LAND', 'land', [['ON', 'ON'], ['OFF', 'OFF'], ['RETRACT', 'RETR']]], ['NOSE', 'nose', [['TO', 'T.O'], ['TAXI', 'TAXI'], ['OFF', 'OFF']]]];
    return {
      w: 500, h: 200, paint: (T) => { T.plate(0, 0, 500, 200); T.title(0, 14, 500, 'EXT LT'); },
      controls: xl.map(([label, key, opts], k) => swC(38 + k * 68, 114, 34, label, opts, () => (S() ? S().lt[key] : opts[0][0]), (v) => set(key, v), `${label} light`)),
    };
  },
  apu: () => ({
    w: 210, h: 200,
    paint: (T) => { T.plate(0, 0, 210, 200); T.title(0, 14, 210, 'APU'); T.label(70, 144, 'MASTER SW', 9); T.label(140, 144, 'START', 9); },
    controls: [
      pbC(70, 102, 50, { top: () => lit('FAULT', 'amber', S() && S().apu.fire), bot: () => lit('ON', 'blue', S() && S().apu.master), click: () => set('apuMaster'), tip: 'APU MASTER SW' }),
      pbC(140, 102, 50, { top: () => lit('ON', 'blue', S() && S().apu.start), bot: () => lit('AVAIL', 'green', S() && S().apu.avail), click: () => set('apuStart'), tip: 'APU START (master on first): about a minute to AVAIL' }),
      winC(105, 176, 70, 22, () => [`${Math.round(S() ? S().apu.n : 0)}%`, false]),
    ],
  }),
  signs: () => ({
    w: 274, h: 200, paint: (T) => { T.plate(0, 0, 274, 200); T.title(0, 14, 274, 'SIGNS'); },
    controls: [
      swC(30, 114, 34, 'SEAT BELTS', [[1, 'ON'], [0, 'OFF']], () => (S() ? S().signs.belts : 1), (v) => set('belts', v)),
      swC(120, 114, 34, 'NO SMOKING', [[1, 'ON'], [0, 'OFF']], () => (S() ? S().signs.smoke : 1), (v) => set('smoke', v)),
      swC(205, 114, 34, 'EMER EXIT LT', [['ON', 'ON'], ['ARM', 'ARM'], ['OFF', 'OFF']], () => (S() && S().misc ? S().misc.emerExit : 'ARM'), (v) => set('emerExit', v), 'EMER EXIT LT: ARM (on by themselves when the power goes)'),
    ],
  }),
  wiper: ({ i = 0 }) => ({
    w: 140, h: 146, paint: (T) => T.plate(0, 0, 140, 146),
    controls: [rotC(70, 92, 20, 'WIPER', [[0, 'OFF'], [1, 'SLOW'], [2, 'FAST']], () => (S() ? S().wipers[i] : 0), (v) => set('wiper', v, i), `${i ? 'First officer' : 'Captain'}'s wiper`)],
  }),
  intLt: () => ({
    w: 704, h: 146, paint: (T) => { T.plate(0, 0, 704, 146); T.title(0, 14, 704, 'INT LT'); },
    controls: [
      dimC(80, 80, 18, 'OVHD INTEG LT', () => (S() ? S().lt.integ : 0.8), (v) => set('integ', v)),
      dimC(200, 80, 18, 'FLOOD LT', () => (S() ? S().lt.flood : 0), (v) => set('flood', v)),
      swC(320, 86, 32, 'DOME', [['BRT', 'BRT'], ['DIM', 'DIM'], ['OFF', 'OFF']], () => (S() ? S().lt.dome : 'OFF'), (v) => set('dome', v), 'DOME light'),
      swC(440, 86, 32, 'ANN LT', [['TEST', 'TEST'], ['BRT', 'BRT'], ['DIM', 'DIM']], () => (S() ? S().lt.ann : 'BRT'), (v) => set('ann', v), 'ANN LT: TEST lights every light'),
      swC(580, 86, 30, 'ICE IND & STBY COMPASS', [[1, 'ON'], [0, 'OFF']], () => (S() && S().misc ? S().misc.iceInd : 1), (v) => set('iceInd', v), 'ICE IND: the ice indicator on the systems display'),
    ],
  }),

  // ---- glareshield / main panel ----
  autobrk: ({ dir = 'v' }) => {
    const v = dir === 'v';
    return {
      w: v ? 40 : 112, h: v ? 108 : 36, paint: () => {},
      controls: ['LO', 'MED', 'MAX'].map((m, i) => pbC(v ? 20 : 20 + i * 36, v ? 18 + i * 34 : 18, v ? 30 : 28, {
        top: () => lit('DECEL', 'green', F() && F().abrk === m && F().abrkOn),
        bot: () => lit(m, 'blue', F() && F().abrk === m),
        click: () => { if (FG.fmgc) FG.fmgc.press(`BRK ${m}`); }, tip: `AUTO BRK ${m}` })),
    };
  },
  // a pilot's screen brightness knobs (PFD, ND) and TERR ON ND
  bright: ({ i = 0 }) => {
    const B = () => (S() && S().misc ? S().misc.bright : {});
    return {
      w: 200, h: 50, paint: () => {},
      controls: [
        dimC(22, 22, 9, 'PFD', () => (B()[`pfd${i + 1}`] ?? 1), (v) => set('bright', v, `pfd${i + 1}`)),
        dimC(178, 22, 9, 'ND', () => (B()[`nd${i + 1}`] ?? 1), (v) => set('bright', v, `nd${i + 1}`)),
        pbC(100, 22, 30, { top: () => lit('TERR', 'white', false), bot: () => lit('ON ND', 'green', S() && S().misc && S().misc.terrNd[i]), click: () => set('terrNd', undefined, i), tip: `${sideName(i)} TERR ON ND: the terrain on the ND` }),
      ],
    };
  },
  clock: () => {
    const X = () => (S() && S().misc) || {};
    const utc = () => { const t = FG.game && FG.game.state ? FG.game.state.time : Date.now() / 60000; const m = Math.floor(t % 1440); return `${pad(Math.floor(m / 60), 2)}:${pad(m % 60, 2)}`; };
    const chr = () => { const c = X().chrono; return c == null ? '--:--' : `${pad(Math.floor(c / 60), 2)}:${pad(Math.floor(c % 60), 2)}`; };
    return {
      w: 70, h: 96, paint: (T) => { T.plate(0, 0, 70, 96); T.label(35, 10, 'CLOCK', 8); },
      controls: [
        winC(35, 30, 60, 20, () => ({ t: chr(), col: '#30d158' })),
        winC(35, 54, 60, 20, () => ({ t: utc(), col: '#30d158' })),
        pbC(35, 80, 22, { bot: () => lit('CHR', 'white', X().chronoRun), click: () => set('chrono'), tip: 'CHR: the chronometer (start, stop, reset)' }),
      ],
    };
  },
  askid: () => ({
    w: 60, h: 96, paint: (T) => { T.plate(0, 0, 60, 96); T.label(30, 12, 'A/SKID &', 7); T.label(30, 22, 'N/W STRG', 7); },
    controls: [swC(18, 62, 28, '', [[1, 'ON'], [0, 'OFF']], () => (S() && S().misc ? S().misc.askid : 1), (v) => set('askid', v), 'A/SKID & N/W STRG: off, no anti-skid and no nose wheel steering')],
  }),

  // ---- pedestal ----
  mcdu: ({ i = 0 }) => ({
    w: 236, h: 310,
    paint: (T, b, g) => {
      const cx = 118;
      T.plate(0, 0, 236, 310, '#2c3035');
      b.fillStyle = '#05070a'; b.fillRect(cx - 92, 14, 184, 120);
      const f = F(), plan = f && f.plan;
      const lines = [plan ? `${(plan.from && plan.from.code) || plan.from || ''}/${plan.to || ''}` : 'MCDU MENU', 'F-PLN', 'INIT  PERF', 'PROG  DIR', 'RAD NAV'];
      lines.forEach((l, k) => { for (const c of [b, g]) { c.font = '600 13px ui-monospace, monospace'; c.textAlign = 'center'; c.fillStyle = k ? '#30d158' : '#e9edf1'; c.fillText(l, cx, 32 + k * 22); } });
      b.fillStyle = '#1a1c1f';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) b.fillRect(cx - 96 + c * 33, 146 + r * 26, 28, 20);
      for (let r = 0; r < 6; r++) { b.fillRect(cx - 114, 22 + r * 19, 14, 11); b.fillRect(cx + 100, 22 + r * 19, 14, 11); }
      T.label(cx, 302, `MCDU ${i + 1}`, 8, '#9aa1aa');
    },
    controls: [areaC(118, 155, 230, 300, 'MCDU: click to open (Y)', () => { if (FG.mcdu) FG.mcdu.toggle(); })],
  }),
  // the A350's keyboard and cursor control units (they open the MCDU pages here)
  kccu: () => ({
    w: 228, h: 300,
    paint: (T, b, g) => {
      const cx = 114;
      T.plate(4, 0, 220, 300, '#2c3035');
      b.fillStyle = '#1a1c1f';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) b.fillRect(cx - 100 + c * 25, 20 + r * 26, 21, 21);
      g.fillStyle = '#20262c';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) g.fillRect(cx - 96 + c * 25, 27 + r * 26, 12, 6);
      const grd = b.createRadialGradient(cx - 6, 230, 3, cx, 235, 30);
      grd.addColorStop(0, '#8d949c'); grd.addColorStop(1, '#25282c');
      b.fillStyle = grd; b.beginPath(); b.arc(cx, 235, 28, 0, 7); b.fill();
    },
    controls: [areaC(114, 150, 220, 300, 'KCCU: the flight management pages (Y)', () => { if (FG.mcdu) FG.mcdu.toggle(); })],
  }),
  // the ECAM control panel: the systems display's pages, CLR, STS, RCL, T.O CONFIG, EMER CANC
  ecp: () => {
    const X = () => (S() && S().misc) || {};
    const keys = ['ENG', 'BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'APU', 'COND', 'DOOR', 'WHEEL', 'F/CTL', 'ALL', 'STS', 'RCL', 'CLR', 'TO CONFIG', 'EMER CANC', 'CRUISE'];
    const tips = { ALL: 'ALL: every page in turn', STS: 'STS: the status page (limitations, inoperative systems)', RCL: 'RCL: recall the cleared cautions', CLR: 'CLR: clear the cautions shown', 'TO CONFIG': 'T.O CONFIG: test the take-off configuration', 'EMER CANC': 'EMER CANC: silence the warning, cancel the caution', CRUISE: 'CRUISE page' };
    return {
      w: 484, h: 64, paint: (T) => T.plate(0, 0, 484, 64, '#33373d'),
      controls: keys.map((k, j) => {
        const r = j < 9 ? 0 : 1, c = j % 9;
        const tog = !['CLR', 'RCL', 'TO CONFIG', 'EMER CANC'].includes(k);
        return pbC(28 + c * 53.5, 17 + r * 30, 26, { w: 50,
          top: () => null,
          bot: () => ({ t: k, col: k === 'CLR' || k === 'EMER CANC' ? 'white' : k === 'TO CONFIG' ? 'blue' : 'white', on: tog ? X().ecp === k : k === 'CLR' && SYS() && SYS().currentCautions().length > 0 }),
          click: () => set('ecp', k), tip: tips[k] || `${k}: the systems display's ${k} page (again: back to automatic)` });
      }),
    };
  },
  // a radio management panel: ACTIVE and STBY windows, the transfer button, the tuning knob, VHF 1 2 3
  rmp: ({ i = 0 }) => {
    const R = () => (S() && S().radio) || null;
    const sel = () => (R() ? R().rmp[i].sel : 'VHF1');
    const fq = (k) => (R() ? R().vhf[sel()][k].toFixed(3) : '---.---');
    return {
      w: 242, h: 110,
      paint: (T) => { T.plate(0, 0, 242, 110); T.label(60, 10, 'ACTIVE', 8); T.label(182, 10, 'STBY/CRS', 8); T.label(121, 104, `RMP ${i + 1}`, 7, '#9aa1aa'); },
      controls: [
        winC(60, 30, 100, 24, () => ({ t: fq('act'), col: '#f2b35a' })),
        winC(182, 30, 100, 24, () => ({ t: fq('stby'), col: '#f2b35a' })),
        pbC(121, 30, 26, { bot: () => lit('⇄', 'white', true), click: () => set('rmpXfer', undefined, i), tip: 'TRANSFER: the standby frequency becomes the active one' }),
        { x: 182, y: 72, w: 40, h: 40, tip: 'Tuning knob: the wheel 25 kHz a step (Shift: 1 MHz); a click on its left or right half', sig: () => '',
          draw: (T) => { T.knob(182, 72, 16); T.knob(182, 72, 9, '#3a3e44'); },
          click: ({ fx, wheel, shift }) => { const d = wheel ? (wheel > 0 ? 1 : -1) : fx < 0 ? -1 : 1; set('rmpTune', shift ? { mhz: d } : d, i); } },
        ...['VHF1', 'VHF2', 'VHF3'].map((k, j) => pbC(28 + j * 42, 72, 30, { bot: () => lit(k.replace('VHF', 'VHF '), 'green', sel() === k), click: () => set('rmpSel', k, i), tip: `${k}: tune ${k.replace('VHF', 'VHF ')} on this panel` })),
      ],
    };
  },
  // the ATC / TCAS panel
  xpdr: () => {
    const X = () => (S() && S().radio ? S().radio.xpdr : { code: '7000', mode: 'AUTO', tcas: 'TA/RA', traffic: 'ALL', alt: 1, ident: 0 });
    return {
      w: 484, h: 52, paint: (T) => { T.plate(0, 0, 484, 52, '#33373d'); T.label(26, 26, 'ATC', 9); },
      controls: [
        { x: 92, y: 26, w: 84, h: 28, tip: 'Transponder code: click a digit (left, right half: down, up) or the wheel on it', sig: () => J(X().code),
          draw: (T) => T.window(92, 26, 84, 26, X().code, false, '#f2b35a'),
          click: ({ fx, fy, wheel }) => { const d = Math.max(0, Math.min(3, Math.floor((fx + 1) * 2))); set('xpdrDigit', wheel ? (wheel > 0 ? 1 : -1) : fy < 0 ? 1 : -1, d); } },
        rotC(176, 34, 11, '', [['STBY', 'STBY'], ['AUTO', 'AUTO'], ['ON', 'ON']], () => X().mode, (v) => set('xpdrMode', v), 'XPDR: STBY · AUTO · ON'),
        pbC(232, 26, 30, { bot: () => lit('IDENT', 'white', X().ident > 0), click: () => set('ident'), tip: 'IDENT' }),
        pbC(280, 26, 30, { bot: () => lit('ALT', 'green', X().alt), click: () => set('xpdrAlt'), tip: 'ALT RPTG: report the altitude' }),
        rotC(350, 34, 11, '', [['STBY', 'STBY'], ['TA', 'TA'], ['TA/RA', 'TA/RA']], () => X().tcas, (v) => set('tcas', v), 'TCAS: STBY · TA · TA/RA'),
        rotC(440, 34, 11, '', [['THRT', 'THRT'], ['ALL', 'ALL'], ['ABV', 'ABV'], ['BLW', 'BLW']], () => X().traffic, (v) => set('traffic', v), 'TCAS TRAFFIC: THRT · ALL · ABV · BLW'),
      ],
    };
  },
  // the engine master switches with their FIRE and FAULT lights, and the mode selector
  engPanel: ({ nEng }) => {
    const W = 484, C = [];
    const h = nEng > 2 ? 250 : 170, y0 = 96;
    for (let i = 0; i < nEng; i++) {
      const x = nEng > 2 ? 96 + i * 64 : (i ? W * 0.62 : W * 0.38);
      C.push(pbC(x, y0 - 58, 38, { top: () => lit('FIRE', 'red', S() && S().eng[i] && S().eng[i].fire), bot: () => lit('FAULT', 'amber', S() && S().eng[i] && (S().eng[i].failed || S().eng[i].start)), tip: `ENG ${i + 1}: FIRE and FAULT lights` }));
      C.push(swC(x - 8, y0 + 10, 44, `MASTER ${i + 1}`, [[1, 'ON'], [0, 'OFF']], () => (S() && S().eng[i] ? S().eng[i].master : 1), (v) => set('master', v, i), `ENG MASTER ${i + 1}: OFF cuts its fuel; ON with IGN starts it`));
    }
    C.push(rotC(nEng > 2 ? 386 : W * 0.5, y0 + (nEng > 2 ? 110 : 20), 20, 'MODE', [['CRANK', 'CRANK'], ['NORM', 'NORM'], ['IGN', 'IGN/START']], () => (S() ? S().engMode : 'NORM'), (v) => set('engMode', v), 'ENG MODE selector: IGN/START to start or relight an engine'));
    return { w: W, h, paint: (T) => { T.plate(0, 0, W, h, '#33373d'); T.label(W * 0.5, 12, 'ENG', 13); }, controls: C };
  },
  // the switching panel: which IR and ADR feed each pilot's screens
  switching: () => {
    const D = () => (S() && S().adirs) || { attHdg: 'NORM', airData: 'NORM' };
    const opts = [['CAPT 3', 'C3'], ['NORM', 'NORM'], ['F/O 3', 'F3']];
    return {
      w: 120, h: 80, paint: (T) => T.plate(0, 0, 120, 80),
      controls: [
        rotC(32, 40, 11, 'ATT HDG', opts, () => D().attHdg, (v) => set('attHdg', v), 'ATT HDG switching: IR 3 for a pilot whose IR failed'),
        rotC(88, 40, 11, 'AIR DATA', opts, () => D().airData, (v) => set('airData', v), 'AIR DATA switching: ADR 3 for a pilot whose ADR failed'),
      ],
    };
  },
  // the E/WD's and SD's brightness
  dispBright: () => {
    const B = () => (S() && S().misc ? S().misc.bright : {});
    return {
      w: 120, h: 80, paint: (T) => T.plate(0, 0, 120, 80),
      controls: [dimC(32, 34, 11, 'UPPER DISP', () => B().ewd ?? 1, (v) => set('bright', v, 'ewd')), dimC(88, 34, 11, 'LOWER DISP', () => B().sd ?? 1, (v) => set('bright', v, 'sd'))],
    };
  },
  parkBrk: () => ({
    w: 160, h: 60, paint: (T) => T.plate(0, 0, 160, 60, '#33373d'),
    controls: [{ x: 80, y: 30, w: 160, h: 60, tip: 'PARKING BRK (K)', sig: () => J(!!P_().state.parking),
      draw(T) { T.label(80, 16, 'PARK BRK', 10); T.label(80, 42, P_().state.parking ? 'ON' : 'OFF', 12, P_().state.parking ? '#ffb000' : '#e9edf1'); },
      click: () => { const s = P_().state; s.parking = !s.parking; } }],
  }),
  // painted only: the thrust levers' quadrant under the 3D levers
  quadrant: () => ({ w: 307, h: 240, paint: (T) => { T.plate(0, 0, 307, 240, '#24272b'); T.label(153, 16, 'TOGA · FLX MCT · CL · IDLE', 9, '#9aa1aa'); }, controls: [] }),

  // ---- the A330's and A340's own (src/aircraft.js PLAN) ----
  // HYD without a PTU: an engine-driven pump per system and engine (the A330: green and blue on engine 1, green and
  // yellow on engine 2; the A340: green on 1 and 4, blue on 2, yellow on 3), an electric pump per system, the RAT
  // (on green).
  hydW: ({ nEng }) => {
    const H = () => (S() && S().hyd) || { edp: {}, elecP: {}, p: {} };
    const edp = nEng >= 4 ? [['G', 0], ['B', 1], ['Y', 2], ['G', 3]] : [['G', 0], ['B', 0], ['G', 1], ['Y', 1]];
    const NAME = { G: 'GREEN', B: 'BLUE', Y: 'YELLOW' };
    const C = edp.map(([k, i], j) => pbC(42 + j * 62, 64, 40, {
      top: () => lit('FAULT', 'amber', S() && S().eng[i] && S().eng[i].run === 1 && !H().edp[k + i]),
      bot: () => lit('OFF', 'white', !H().edp[k + i]), click: () => set('edp', k + i), tip: `${NAME[k]} ENG ${i + 1} PUMP` }));
    ['G', 'B', 'Y'].forEach((k, j) => C.push(pbC(52 + j * 83, 150, 40, {
      top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', H().elecP[k]), click: () => set('elecPump', k), tip: `${NAME[k]} ELEC PUMP: ON on the ground without an engine, or when its engine pumps are lost` })));
    C.push(pbC(135, 224, 34, { top: () => lit('', 'amber', false), bot: () => lit('MAN ON', 'blue', S() && S().elec && S().elec.rat), click: () => set('ratMan'), tip: 'RAT MAN ON: drops the ram air turbine (green pressure, and the emergency generator)' }));
    return {
      w: 270, h: 260,
      paint: (T) => {
        T.plate(0, 0, 270, 260); T.title(0, 14, 270, 'HYD');
        edp.forEach(([k, i], j) => T.label(42 + j * 62, 96, `${k} ENG ${i + 1}`, 8));
        ['G', 'B', 'Y'].forEach((k, j) => T.label(52 + j * 83, 182, `${k} ELEC`, 8));
        T.label(195, 224, 'RAT MAN ON', 8, '#e9edf1', 'left');
      },
      controls: C,
    };
  },
  // the A330's FUEL: two main pumps and a standby in each wing, the centre's pumps, the cross-feed, the trim tank's feed
  fuel330: () => {
    const Fu = () => (S() && S().fuel) || { pump: {} };
    const pump = (x, y, k, tip) => pbC(x, y, 38, { top: () => lit('FAULT', 'amber', S() && S().eng.some((e) => e.run === 1) && !Fu().pump[k] && !/S$/.test(k)), bot: () => lit('OFF', 'white', !Fu().pump[k]), click: () => set('fuelPump', undefined, k), tip });
    const L = [['L 1', 38, 58], ['L 2', 102, 58], ['R 1', 166, 58], ['R 2', 230, 58], ['L STBY', 38, 132], ['CTR L', 102, 132], ['CTR R', 166, 132], ['R STBY', 230, 132], ['MODE SEL', 38, 206], ['X FEED', 102, 206], ['T TK FEED', 166, 206]];
    return {
      w: 270, h: 260,
      paint: (T) => { T.plate(0, 0, 270, 260); T.title(0, 14, 270, 'FUEL'); L.forEach(([l, x, y]) => T.label(x, y + 30, l, 8)); },
      controls: [
        pump(38, 58, 'L1', 'L TK PUMP 1'), pump(102, 58, 'L2', 'L TK PUMP 2'), pump(166, 58, 'R1', 'R TK PUMP 1'), pump(230, 58, 'R2', 'R TK PUMP 2'),
        pump(38, 132, 'LS', 'L TK STBY PUMP: runs when the main pumps fail'), pump(102, 132, 'CL', 'CTR TK PUMP L'), pump(166, 132, 'CR', 'CTR TK PUMP R'), pump(230, 132, 'RS', 'R TK STBY PUMP'),
        pbC(38, 206, 38, { top: () => lit('FAULT', 'amber', false), bot: () => lit('MAN', 'white', Fu().modeSel === 'MAN'), click: () => set('modeSel'), tip: 'MODE SEL: AUTO runs the centre pumps while there is fuel there' }),
        pbC(102, 206, 38, { top: () => lit('OPEN', 'green', Fu().xfeed), bot: () => lit('ON', 'blue', Fu().xfeed), click: () => set('xfeed'), tip: 'X FEED: either wing feeds either engine' }),
        pbC(166, 206, 38, { top: () => lit('XFR', 'green', Fu().tXfr), bot: () => lit('ISOL', 'white', Fu().trim === 'ISOL'), click: () => set('trimFeed'), tip: 'T TK FEED: the trim tank in the tail sends its fuel forward in the cruise (AUTO) · ISOL keeps it there' }),
      ],
    };
  },
  // the A340's FUEL: each engine its own feed tank with a main and a standby pump and its own cross-feed valve; the
  // centre tank's pumps, the trim tank's feed, the mode selector
  fuel340: () => {
    const Fu = () => (S() && S().fuel) || { pump: {}, xfeedE: [] };
    const C = [];
    for (let i = 0; i < 4; i++) {
      const x = 38 + i * 64;
      C.push(pbC(x, 54, 32, { top: () => lit('FAULT', 'amber', S() && S().eng[i] && S().eng[i].run === 1 && !Fu().pump[`E${i}`]), bot: () => lit('OFF', 'white', !Fu().pump[`E${i}`]), click: () => set('fuelPump', undefined, `E${i}`), tip: `ENG ${i + 1} FEED TK MAIN PUMP` }));
      C.push(pbC(x, 112, 32, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !Fu().pump[`E${i}S`]), click: () => set('fuelPump', undefined, `E${i}S`), tip: `ENG ${i + 1} FEED TK STBY PUMP` }));
      C.push(pbC(x, 170, 32, { top: () => lit('OPEN', 'green', Fu().xfeedE[i]), bot: () => lit('ON', 'blue', Fu().xfeedE[i]), click: () => set('xfeedE', undefined, i), tip: `X FEED ${i + 1}: engine ${i + 1} on the cross-feed line (open two: one feeds the other)` }));
    }
    C.push(pbC(38, 226, 32, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !Fu().pump.CL), click: () => set('fuelPump', undefined, 'CL'), tip: 'CTR TK PUMP L' }));
    C.push(pbC(102, 226, 32, { top: () => lit('FAULT', 'amber', false), bot: () => lit('OFF', 'white', !Fu().pump.CR), click: () => set('fuelPump', undefined, 'CR'), tip: 'CTR TK PUMP R' }));
    C.push(pbC(166, 226, 32, { top: () => lit('XFR', 'green', Fu().tXfr), bot: () => lit('ISOL', 'white', Fu().trim === 'ISOL'), click: () => set('trimFeed'), tip: 'T TK FEED: the trim tank sends its fuel forward in the cruise (AUTO) · ISOL keeps it there' }));
    C.push(pbC(230, 226, 32, { top: () => lit('FAULT', 'amber', false), bot: () => lit('MAN', 'white', Fu().modeSel === 'MAN'), click: () => set('modeSel'), tip: 'MODE SEL: AUTO runs the centre pumps while there is fuel there' }));
    return {
      w: 270, h: 260,
      paint: (T) => {
        T.plate(0, 0, 270, 260); T.title(0, 12, 270, 'FUEL', 11);
        for (let i = 0; i < 4; i++) { const x = 38 + i * 64; T.label(x, 78, `ENG ${i + 1}`, 7); T.label(x, 136, `STBY ${i + 1}`, 7); T.label(x, 194, `X FEED ${i + 1}`, 7); }
        [['CTR L', 38], ['CTR R', 102], ['T TK', 166], ['MODE', 230]].forEach(([l, x]) => T.label(x, 250, l, 7));
      },
      controls: C,
    };
  },
  // the A340-500/-600's TAXI CAMERA: the fin and belly cameras' picture on the systems display, on the ground
  taxiCam: () => ({
    w: 48, h: 64, paint: (T) => { T.plate(0, 0, 48, 64); T.label(24, 9, 'TAXI', 7); T.label(24, 18, 'CAMERA', 6); },
    controls: [pbC(24, 42, 30, { bot: () => lit('ON', 'blue', S() && S().misc && S().misc.taxiCam), click: () => set('taxiCam'), tip: 'TAXI CAMERA: the fin and belly cameras on the systems display (on the ground): the nose and main gear over the taxiway\'s centre line' })],
  }),
  // the A330neo's trackball (EIS2): the airport map (OANS) on the NDs, and its range
  oans: () => {
    const X = () => (S() && S().misc) || {};
    return {
      w: 150, h: 86,
      paint: (T, b) => {
        T.plate(0, 0, 150, 86, '#2c3035'); T.label(75, 9, 'CURSOR CTL', 7, '#9aa1aa');
        const grd = b.createRadialGradient(68, 44, 3, 75, 50, 24);
        grd.addColorStop(0, '#9aa1aa'); grd.addColorStop(1, '#24272b');
        b.fillStyle = grd; b.beginPath(); b.arc(75, 50, 22, 0, 7); b.fill();
      },
      controls: [
        pbC(24, 46, 30, { bot: () => lit('OANS', 'green', X().oans), click: () => set('oans'), tip: 'OANS: the airport map on both NDs (the stands, taxiways, runways and you)' }),
        pbC(126, 46, 30, { bot: () => lit(`${X().oansRange || 1} NM`, 'white', true), click: () => set('oansRange'), tip: 'OANS range: 0.5 · 1 · 2 · 5 NM' }),
        areaC(75, 50, 46, 46, 'Trackball: the wheel zooms the airport map', () => set('oansRange')),
      ],
    };
  },
};

// ---------- the decks' layouts ----------
// [module, x, y, options]: the module's top-left corner on that surface. `n4` / `n2`: only with 4 / 2 engines.
export const LAYOUTS = {
  a320: {
    glareshield: [['warn', 156, 14, { i: 0 }], ['efis', 426, 6, { i: 0 }], ['fcu', 851.6, 4], ['efis', 1834, 6, { i: 1 }], ['warn', 2256, 14, { i: 1 }]],
    main: [['bright', 10, 206, { i: 0 }], ['autobrk', 388, 112, { dir: 'v' }], ['clock', 668, 146], ['askid', 744, 146], ['bright', 818, 206, { i: 1 }]],
    pedestal: [
      ['mcdu', 10, 22, { i: 0 }], ['mcdu', 266, 22, { i: 1 }], ['ecp', 14, 338],
      ['rmp', 8, 410, { i: 0 }], ['rmp', 262, 410, { i: 1 }], ['quadrant', 102, 524],
      ['switching', 6, 528], ['dispBright', 386, 528],
      ['engPanel', 14, 704, { n2: true }], ['engPanel', 14, 616, { n4: true }],
      ['xpdr', 14, 880], ['parkBrk', 176, 938],
    ],
    overhead: [
      ['adirs', 10, 8], ['evac', 284, 8], ['emerElec', 358, 8], ['gpws', 472, 8], ['rcdr', 726, 8], ['oxygen', 790, 8], ['calls', 904, 8],
      ['hyd', 10, 136], ['fire', 280, 136], ['fuel', 744, 136],
      ['elec', 10, 404], ['air', 350, 404], ['antiIce', 684, 404],
      ['extLt', 10, 642], ['apu', 520, 642], ['signs', 740, 642],
      ['wiper', 10, 850, { i: 0 }], ['intLt', 160, 850], ['wiper', 874, 850, { i: 1 }],
    ],
  },
  a350: {
    glareshield: [['warn', 156, 14, { i: 0 }], ['efis', 426, 6, { i: 0 }], ['fcu', 851.6, 4], ['efis', 1834, 6, { i: 1 }], ['warn', 2256, 14, { i: 1 }]],
    main: [['bright', 56, 206, { i: 0 }], ['autobrk', 456, 210, { dir: 'h' }], ['clock', 600, 156], ['askid', 680, 156], ['bright', 750, 206, { i: 1 }]],
    pedestal: [
      ['kccu', 14, 20, { i: 0 }], ['kccu', 270, 20, { i: 1 }], ['ecp', 14, 326],
      ['rmp', 8, 396, { i: 0 }], ['rmp', 262, 396, { i: 1 }],
      ['switching', 6, 512], ['dispBright', 386, 512],
      ['engPanel', 14, 604, { n2: true }], ['engPanel', 14, 604, { n4: true }],
      ['xpdr', 14, 862], ['parkBrk', 176, 930],
    ],
    overhead: null, // (the same as the A320's: below)
  },
};
LAYOUTS.a350.overhead = LAYOUTS.a320.overhead;
// The A330s and A340s: the A320's deck (the same modules, the same places), with their own overhead HYD (no PTU)
// and FUEL (a standby pump per wing and the trim tank on the A330; a feed tank, two pumps and a cross-feed valve per
// engine on the A340) and what each version added:
//   'a330'    A330-200, -300: the enhanced A330 (LCD screens and the ISIS since 2003)
//   'a330neo' A330-800, -900: its EIS2 with the trackball for the airport map (OANS) on the pedestal
//   'a340'    A340-200, -300: CRT screens and the three round standby instruments
//   'a346'    A340-500, -600: LCDs, the ISIS, and the TAXI CAMERA (75 m long: the main gear is 33 m behind you)
const swap = (list, from, to) => list.map((l) => (l[0] === from ? [to, ...l.slice(1)] : l));
const wideOverhead = (fuel) => swap(swap(LAYOUTS.a320.overhead, 'hyd', 'hydW'), 'fuel', fuel);
LAYOUTS.a330 = { ...LAYOUTS.a320, overhead: wideOverhead('fuel330') };
LAYOUTS.a330neo = { ...LAYOUTS.a330, pedestal: [...LAYOUTS.a320.pedestal.filter((l) => l[0] !== 'parkBrk'), ['parkBrk', 340, 938], ['oans', 14, 936]] };
LAYOUTS.a340 = { ...LAYOUTS.a320, overhead: wideOverhead('fuel340') };
LAYOUTS.a346 = { ...LAYOUTS.a340, pedestal: [...LAYOUTS.a320.pedestal, ['taxiCam', 14, 940]] }; // (on the pedestal: its page (9) has it too)
export const SURFACES = { glareshield: [2560, 128, '#16181b'], main: [1024, 256, '#4b5058'], pedestal: [512, 1024, '#4b5058'], overhead: [1024, 1004, '#4b5058'] };
// which deck each type flies with (the 3D flight deck where it has one; the 2D pages take the A320's otherwise)
export function deckOf(type) {
  const t = String(type || '').toUpperCase();
  if (/^A35|^A38/.test(t)) return 'a350';
  if (/^A33(0-)?[89]|^A33[89]/.test(t)) return 'a330neo';
  if (/^A33/.test(t)) return 'a330';
  if (/^A34(0-)?[56]|^A34[56]/.test(t)) return 'a346';
  if (/^A34/.test(t)) return 'a340';
  if (/^A3[12]/.test(t)) return 'a320';
  return null;
}

// A surface of a deck, built from its layout: a live panel (its picture, its controls).
export function surface(name, kind, nEng, extraPaint) {
  const [W, H, bg] = SURFACES[name];
  const items = [];
  for (const [mod, x, y, o = {}] of (LAYOUTS[kind] || LAYOUTS.a320)[name] || []) {
    if ((o.n4 && nEng <= 2) || (o.n2 && nEng > 2)) continue;
    const make = MODULES[mod];
    if (!make) { console.warn('panels: no module', mod); continue; }
    const m = make({ kind, nEng, ...o });
    items.push({ m, x, y, name: mod });
  }
  const controls = [];
  for (const it of items) for (const c of it.m.controls) { c.ox = it.x; c.oy = it.y; c.module = it.name; controls.push(c); }
  const p = livePanel(W, H, bg, (T, b, g) => {
    if (extraPaint) extraPaint(T, b, g, W, H);
    for (const it of items) { b.save(); g.save(); b.translate(it.x, it.y); g.translate(it.x, it.y); try { it.m.paint(T, b, g); } finally { b.restore(); g.restore(); } }
  }, controls);
  p.items = items;
  return p;
}

// ---------- the 2D pages: 0 the overhead, 9 the pedestal ----------
const pages = {};
function pageOf(which) {
  const s = P_().state;
  const kind = deckOf(s.type) || 'a320', nEng = s.spec ? s.spec.engines : 2;
  const key = `${which}|${kind}|${nEng}`;
  let pg = pages[which];
  if (pg && pg.key === key) return pg;
  if (pg) pg.el.remove();
  const el = document.createElement('div');
  el.className = 'fly-page';
  el.hidden = true;
  if (!document.getElementById('fly-page-css')) {
    const css = document.createElement('style');
    css.id = 'fly-page-css';
    css.textContent = `
.fly-page { position: fixed; right: 12px; top: 56px; z-index: 2160; background: #2b2f35; color: #e9edf1; border: 2px solid #23262b; border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5); font: 600 11px system-ui, sans-serif; padding: 6px 8px 8px; user-select: none; max-height: calc(100vh - 120px); overflow: auto; }
.fly-page h3 { margin: 0 0 6px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; letter-spacing: .05em; gap: 12px; }
.fly-page h3 button, .fly-page .fails button { background: #23262b; color: #cfd8e2; border: 0; border-radius: 4px; padding: 3px 8px; cursor: pointer; font: 700 10px system-ui; }
.fly-page canvas { display: block; cursor: pointer; border-radius: 3px; }
.fly-page .fails { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.fly-page .fails button { background: #5a2a24; color: #ffd8d0; }
.fly-page .fails button.on { background: #a12a1d; }
.fly-page .log { color: #b9c4cf; font: 500 10px ui-monospace, monospace; white-space: pre-line; margin-top: 4px; }
.fly-page .tip { position: fixed; z-index: 2170; pointer-events: none; background: rgba(10,12,16,.9); color: #e8eef8; font: 600 11px system-ui; padding: 3px 7px; border-radius: 4px; }`;
    document.head.appendChild(css);
  }
  const panel = surface(which, kind, nEng);
  const scale = which === 'overhead' ? Math.min(0.62, (innerHeight - 220) / panel.H) : Math.min(0.62, (innerHeight - 140) / panel.H);
  el.innerHTML = `<h3><span>${which === 'overhead' ? 'OVERHEAD' : 'PEDESTAL'} · ${(s.spec && s.spec.name) || ''}</span><span>${which === 'overhead' ? '<button data-pg="ped">Pedestal (9)</button>' : '<button data-pg="ovh">Overhead (0)</button>'} <button data-pg="close">✕</button></span></h3>`;
  const cv = panel.base;
  cv.style.width = `${Math.round(panel.W * scale)}px`; cv.style.height = `${Math.round(panel.H * scale)}px`;
  el.appendChild(cv);
  let fails = null, log = null;
  if (which === 'overhead') {
    fails = document.createElement('div'); fails.className = 'fails';
    log = document.createElement('div'); log.className = 'log';
    el.append(fails, log);
    fails.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-f]');
      if (!b) return;
      const [k, i] = b.dataset.f.split(':');
      if (k === 'random') set('random'); else set('fail', k, i === undefined ? undefined : Number(i));
    });
  }
  const tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.hidden = true; el.appendChild(tipEl);
  const at = (ev) => { const r = cv.getBoundingClientRect(); return panel.hitXY(((ev.clientX - r.left) / r.width) * panel.W, ((ev.clientY - r.top) / r.height) * panel.H); };
  const act = (h, o) => { if (!h || !h.c.click) return false; h.c.click({ fx: h.fx, fy: h.fy, ...o }); panel.paint(); if (FG.systems) FG.systems.refresh(); return true; };
  cv.addEventListener('click', (ev) => act(at(ev), { button: 0, shift: ev.shiftKey }));
  cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); act(at(ev), { button: 2, shift: ev.shiftKey }); });
  cv.addEventListener('wheel', (ev) => { const h = at(ev); if (h && h.c.click) { ev.preventDefault(); act(h, { wheel: ev.deltaY < 0 ? 1 : -1, shift: ev.shiftKey }); } }, { passive: false });
  cv.addEventListener('mousemove', (ev) => {
    const h = at(ev), t = h && h.c.tip;
    tipEl.hidden = !t; cv.style.cursor = h && h.c.click ? 'pointer' : 'default';
    if (t) { tipEl.textContent = t; tipEl.style.left = `${ev.clientX + 14}px`; tipEl.style.top = `${ev.clientY + 16}px`; }
  });
  cv.addEventListener('mouseleave', () => { tipEl.hidden = true; });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pg]');
    if (!b) return;
    if (b.dataset.pg === 'close') page(which, false);
    else page(b.dataset.pg === 'ped' ? 'pedestal' : 'overhead', true);
  });
  el.addEventListener('keydown', (ev) => ev.stopPropagation(), true);
  document.body.appendChild(el);
  pg = pages[which] = { el, panel, key, fails, log };
  return pg;
}
function refreshPage(pg) {
  pg.panel.paint();
  if (pg.fails) {
    const x = S();
    if (!x) return;
    const engs = x.eng.map((e, i) => i);
    const html = `${engs.map((i) => `<button data-f="fire:${i}">ENG ${i + 1} FIRE</button>`).join('')}<button data-f="apuFire">APU FIRE</button>${engs.map((i) => `<button data-f="fail:${i}">ENG ${i + 1} FAIL</button>`).join('')}<button data-f="random" class="${x.random ? 'on' : ''}">RANDOM ${x.random ? 'ON' : 'OFF'}</button>`;
    if (pg.fails.dataset.h !== html) { pg.fails.innerHTML = `<b style="width:100%;font-size:10px;letter-spacing:.1em">FAILURES (instructor)</b>${html}`; pg.fails.dataset.h = html; }
    pg.log.textContent = x.log.map((l) => l.text).join('\n');
  }
}
export function page(which, on) {
  if (on && !SYS()) return;
  if (on) {
    for (const k of Object.keys(pages)) if (k !== which && pages[k]) pages[k].el.hidden = true;
    const pg = pageOf(which);
    pg.el.hidden = false;
    refreshPage(pg);
  } else if (pages[which]) pages[which].el.hidden = true;
}
setInterval(() => { for (const pg of Object.values(pages)) if (pg && !pg.el.hidden) refreshPage(pg); }, 250);
FG.panels = {
  page, isOpen: (which) => !!(pages[which] && !pages[which].el.hidden),
  closeAll() { for (const pg of Object.values(pages)) if (pg) pg.el.hidden = true; },
  MODULES, LAYOUTS, surface, deckOf,
  pagePanel: (which) => (pages[which] ? pages[which].panel : null),
};
