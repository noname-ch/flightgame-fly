// The Airbus flight decks round the cockpit camera when you fly it yourself (src/pilot.js, camera C):
//   - 'a350' (A350s, A380): six windows in dark frames, the black glareshield with the FCU and the EFIS panels, six
//     big landscape screens (information system outboard, PFD + ND in front of each pilot, the engine and warning
//     display in the middle, the systems display below it), the pedestal with the keyboards (KCCU);
//   - 'a320' (A320, A330, A340): a narrower deck with the A320 family's six square screens (PFD, ND, the E/WD over
//     the SD in the middle, ND, PFD), the standby instrument, the gear lever and the autobrake beside them, the two
//     MCDUs at the front of the pedestal.
// Both have the overhead panel, the FCU, the EFIS panels and the engine master switches working: click them in 3D
// (src/systems.js does what the overhead and the masters switch; FG.fmgc what the FCU's knobs and buttons ask).
// Knobs: the mouse wheel turns them, a click pushes, a right-click pulls (a click on their left or right edge
// turns them a step). Switches: a click on their upper half moves them up, on the lower half down. Hover shows
// what a control is. The levers, sticks, gear lever, wipers and screens move with the plane; the dome, flood and
// panel lighting follow the INT LT knobs.
//
// It is drawn after the world by the game's view3d.js planeLayer (`draw`) with its own camera in the cockpit's own
// frame (the cockpit moves with the camera, so it never needs the world's matrices), over a cleared depth buffer;
// the windows are holes, the world shows through them. Laid out after photos of the real decks: only the layout,
// proportions and colours are followed.
//
// Cockpit space: metres, x right, y ahead, z up, from the middle of the cockpit at the pilots' eye height and
// station; the captain's eye is at x = -EYE_X.
import * as THREE from 'three';

// (the systems: lights, fire, APU, engines; loaded with this file's own version)
import(`./systems.js${new URL(import.meta.url).search}`).catch((e) => console.warn('systems.js', e));

// ---------- the decks' sizes ----------
const DECKS = {
  a350: { HALF: 1.36, ROOF: 0.50, REAR: -1.75, FLOOR: -1.32, EYE_X: 0.53, wsY: 1.15, wsK: 0.294, wsZ: 0.767, scr: 1.19 },
  a320: { HALF: 1.12, ROOF: 0.46, REAR: -1.50, FLOOR: -1.25, EYE_X: 0.50, wsY: 0.98, wsK: 0.33, wsZ: 0.80, scr: 0.98 },
};
const kindOf = (type) => (/^A35|^A38/i.test(type || '') ? 'a350' : /^A3[234]/i.test(type || '') ? 'a320' : null);
export const has = (type) => !!kindOf(type);
// The current deck's numbers (set by build()).
let D = DECKS.a350, HALF = D.HALF, ROOF = D.ROOF, REAR = D.REAR, FLOOR = D.FLOOR;
export let EYE_X = D.EYE_X;
function useDeck(kind) {
  D = DECKS[kind];
  ({ HALF, ROOF, REAR, FLOOR } = D);
  EYE_X = D.EYE_X;
}
// The windscreens' plane (one each side of the centre post): y at (x, z).
const frontY = (x, z) => D.wsY - D.wsK * Math.abs(x) - D.wsZ * (z + 0.3);
// The side wall's front edge (where it meets the windscreen's plane) at height z.
const wallFrontY = (z) => frontY(HALF, z);

const COL = {
  lining: 0xc9ced3, // light grey walls and ceiling
  frame: 0x1d1f22, // window frames and posts
  shield: 0x0f1012, // the glareshield (matt black: no reflections in the windscreen)
  panel: 0x4b5058, // main panel, pedestal and overhead: Airbus's darker grey
  console: 0x575c64,
  floor: 0x2c2f35,
  seat: 0x3d434d,
  bezel: 0x101214,
  metal: 0x8a9099,
};
const P_ = () => FG.pilot;
const SYS = () => (FG.systems && FG.systems.ready && FG.systems.ready() ? FG.systems : null);
const FM = () => (FG.fmgc && FG.fmgc.on ? FG.fmgc : null);

// ---------- canvas pictures of the panels ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// A panel's picture: its face (`base`) and what glows on it at night (`glow`: legends, lit buttons).
function panelArt(wPx, hPx, paint, bg = '#4b5058') {
  const base = canvas(wPx, hPx), glow = canvas(wPx, hPx);
  const b = base.getContext('2d'), g = glow.getContext('2d');
  b.fillStyle = bg; b.fillRect(0, 0, wPx, hPx);
  g.fillStyle = '#000'; g.fillRect(0, 0, wPx, hPx);
  paint(b, g, wPx, hPx);
  return { map: texture(base), glow: texture(glow) };
}
// Annunciator lights: TEST lights them all, DIM dims them.
const annTest = () => { const S = SYS(); return !!(S && S.S.lt.ann === 'TEST'); };
const annDim = () => { const S = SYS(); return !!(S && S.S.lt.ann === 'DIM'); };
const LIT = { amber: '#ffb000', red: '#ff3b30', blue: '#6fc8ff', white: '#ffffff', green: '#30d158' };
// The tools for painting panels: Airbus pushbuttons (square, dark, a lit legend), knobs, number windows, labels.
function tools(b, g) {
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
    pb(x, y, s, top = '', bot = '', lit = null) { // pushbutton, legends unlit (or the bottom lit blue)
      T.pb2(x, y, s, top ? { t: top, col: 'amber', on: false } : null, bot ? { t: bot, col: 'blue', on: !!lit } : null);
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
    window(x, y, w, h, text, dot) { // a number window (orange LCD digits, as the FCU's)
      b.fillStyle = '#050505'; b.fillRect(x - w / 2, y - h / 2, w, h);
      for (const c of [b, g]) {
        c.font = `600 ${h * 0.72}px ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = c === b ? '#f2b35a' : '#f0a640'; c.fillText(text, x - (dot ? h * 0.25 : 0), y + 1);
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
    rows(x0, y0, cols, rows, dx, dy, s, legends) { // a grid of pushbuttons
      let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const L = legends[i++ % legends.length];
        T.pb(x0 + c * dx, y0 + r * dy, s, L[0], L[1], L[2]);
      }
    },
  };
  return T;
}

// ---------- panels with controls ----------
// A panel painted from its controls: the picture is painted again when what they show changes (sig()); a click
// at (u, v) on its mesh finds the control there. Controls: { x, y, w, h (canvas px, centred), draw(T, b, g),
// sig(), click({ fx, fy, button, wheel, shift }) (fx, fy: -1 … 1 across the control), tip }.
function livePanel(W, H, bg, paintBase, controls) {
  const base = canvas(W, H), glow = canvas(W, H);
  const b = base.getContext('2d'), g = glow.getContext('2d');
  const p = {
    W, H, controls, map: texture(base), glow: texture(glow), sig: null,
    paint(force) {
      const sig = controls.map((c) => (c.sig ? c.sig() : '')).join('|') + (annTest() ? 'T' : annDim() ? 'D' : '');
      if (!force && sig === p.sig) return;
      p.sig = sig;
      b.fillStyle = bg; b.fillRect(0, 0, W, H);
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const T = tools(b, g);
      paintBase(T, b, g, W, H);
      for (const c of controls) if (c.draw) c.draw(T, b, g);
      p.map.needsUpdate = true; p.glow.needsUpdate = true;
    },
    hit(uv) {
      const x = uv.x * W, y = (1 - uv.y) * H;
      for (const c of controls) {
        if (!c.click) continue;
        if (Math.abs(x - c.x) <= c.w / 2 && Math.abs(y - c.y) <= c.h / 2) return { c, fx: (x - c.x) / (c.w / 2), fy: (y - c.y) / (c.h / 2) };
      }
      return null;
    },
  };
  p.paint(true);
  return p;
}
const J = (v) => JSON.stringify(v);
// A pushbutton: top / bot give { t, col, on } now.
function pbC(x, y, s, { top, bot, click, tip, w }) {
  return { x, y, w: w || s, h: s, tip, click, sig: () => J([top && top(), bot && bot()]), draw: (T) => T.pb2(x, y, s, top && top(), bot && bot(), w || s) };
}
// A toggle switch with its positions (top first) [[value, label], ...]; get() the value now, set(v).
function swC(x, y, s, label, opts, get, set, tip) {
  return {
    x: x + s * 0.4, y, w: s * 2.2, h: s * 1.6, tip: tip || label, sig: () => J(get()),
    draw(T) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      T.toggle(x, y, s, at, opts.length);
      opts.forEach(([, l], i) => T.label(x + s * 0.42, y - s * 0.32 + (opts.length > 1 ? (i / (opts.length - 1)) * s * 0.64 : 0), l, Math.max(7, s * 0.22), '#e9edf1', 'left'));
      if (label) T.label(x + s * 0.3, y - s * 0.95, label, Math.max(8, s * 0.26));
    },
    click({ fy }) {
      const at = Math.max(0, opts.findIndex((o) => String(o[0]) === String(get())));
      const to = Math.max(0, Math.min(opts.length - 1, at + (fy < 0 ? -1 : 1)));
      if (to !== at) set(opts[to][0]);
    },
  };
}
// A rotary selector: positions round its top (left to right) [[value, label], ...].
function rotC(x, y, r, label, opts, get, set, tip) {
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
      if (to !== at) set(opts[to][0]);
    },
  };
}
// A continuous knob (lighting): 0 … 1; a click on its left half turns it down, on the right half up.
function dimC(x, y, r, label, get, set) {
  return {
    x, y, w: r * 3, h: r * 3, tip: `${label}: click left / right or the wheel`, sig: () => J(Math.round(get() * 20)),
    draw(T) { T.knob(x, y, r, '#2a2d31', -2.3 + 4.6 * get()); T.label(x, y + r * 1.6, label, Math.max(8, r * 0.5)); T.label(x - r * 1.2, y + r * 0.9, 'OFF', 7); T.label(x + r * 1.2, y + r * 0.9, 'BRT', 7); },
    click({ fx, wheel }) { set(Math.max(0, Math.min(1, get() + (wheel ? wheel * 0.1 : fx < 0 ? -0.25 : 0.25)))); },
  };
}
// The big red FIRE pushbutton of an engine or the APU, under its clear guard.
function fireC(x, y, w, h, name, lit, pushed, click) {
  return {
    x, y, w, h, tip: `${name} FIRE pushbutton: push to cut its fuel and arm the agents`, click, sig: () => J([lit(), pushed(), annTest()]),
    draw(T, b, g) {
      const on = lit() || annTest(), dn = pushed();
      b.fillStyle = '#16181b'; b.fillRect(x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8);
      b.fillStyle = on ? '#d0261a' : '#4a1410'; b.fillRect(x - w / 2, y - h / 2 + (dn ? 3 : 0), w, h - (dn ? 3 : 0));
      if (on) { g.fillStyle = '#ff3b30'; g.fillRect(x - w / 2, y - h / 2, w, h); }
      for (const c of [b, g]) {
        c.font = `800 ${h * 0.24}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = c === b ? (on ? '#fff3e8' : '#d9a39b') : (on ? '#ffffff' : '#200806');
        c.fillText(name, x, y - h * 0.18); c.fillText('FIRE', x, y + h * 0.16);
      }
      T.label(x, y + h * 0.41, 'PUSH', Math.max(7, h * 0.14), '#e9edf1');
      // the guard (clear, its frame)
      b.strokeStyle = 'rgba(220,230,240,0.55)'; b.lineWidth = 2; b.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
    },
  };
}
// An FCU button: its name, and the green bar lit when it is on.
function fcuBtnC(x, y, w, h, label, lit, click, tip) {
  return {
    x, y, w, h, tip: tip || label, click, sig: () => J(lit()),
    draw(T, b, g) {
      b.fillStyle = '#25282c'; b.fillRect(x - w / 2, y - h / 2, w, h);
      b.strokeStyle = '#5c636c'; b.lineWidth = 1; b.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
      const on = lit() || annTest();
      b.fillStyle = on ? '#30d158' : '#123018'; b.fillRect(x - w * 0.3, y - h * 0.32, w * 0.6, h * 0.12);
      if (on) { g.fillStyle = '#30d158'; g.fillRect(x - w * 0.3, y - h * 0.32, w * 0.6, h * 0.12); }
      const lines = label.split('\n');
      lines.forEach((l, i) => T.label(x, y + h * 0.12 + (i - (lines.length - 1) / 2) * h * 0.26, l, Math.max(7, Math.min(h * 0.3, (w * 1.5) / l.length)), '#e9edf1'));
    },
  };
}
// An FCU knob: wheel turns, click pushes, right-click pulls; a click on its left or right edge turns it a step.
function fcuKnobC(x, y, r, name) {
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
function winC(x, y, w, h, text) {
  return { x, y, w, h, sig: () => J(text()), draw: (T) => { const [t, dot] = text(); T.window(x, y, w, h, t, dot); } };
}

// ---------- the glareshield (both decks): master warning / caution, EFIS panels, FCU ----------
function glareshieldPanel(span) {
  const W = 2560, H = 128;
  const px = (x) => ((x + span) / (2 * span)) * W; // (cockpit x → canvas x)
  const F = () => (FG.fmgc ? FG.fmgc.F : null);
  const s = () => P_().state;
  const press = (b) => { const M = FM(); if (M) M.press(b); else if (FG.fmgc) FG.fmgc.press(b); };
  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
  const C = [];
  // master warning and caution, before each pilot
  for (const x of [-span * 0.82, span * 0.82]) {
    const cx = px(x);
    C.push(pbC(cx - 34, 64, 58, { top: () => ({ t: 'MASTER', col: 'red', on: !!(SYS() && SYS().S.mw && Math.floor(performance.now() / 400) % 2) }), bot: () => ({ t: 'WARN', col: 'red', on: !!(SYS() && SYS().S.mw && Math.floor(performance.now() / 400) % 2) }), click: () => SYS() && SYS().set('masterWarn'), tip: 'MASTER WARN: push to silence the chime' }));
    C.push(pbC(cx + 34, 64, 58, { top: () => ({ t: 'MASTER', col: 'amber', on: !!(SYS() && SYS().S.mc) }), bot: () => ({ t: 'CAUT', col: 'amber', on: !!(SYS() && SYS().S.mc) }), click: () => SYS() && SYS().set('masterCaut'), tip: 'MASTER CAUT: push to clear' }));
  }
  // EFIS control panels
  for (const x of [-span * 0.55, span * 0.55]) {
    const cx = px(x);
    C.push(fcuBtnC(cx - 120, 40, 44, 34, 'FD', () => !!(F() && F().fd), () => press('FD'), 'FD: the flight directors on the PFD'));
    C.push(fcuBtnC(cx - 120, 90, 44, 34, 'LS', () => !!(F() && F().ls), () => press('LS'), 'LS: the ILS deviations on the PFD'));
    const leg = ['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT'];
    leg.forEach((l, i) => C.push(fcuBtnC(cx - 62 + i * 38, 32, 34, 28, l, () => (l === 'ARPT' ? !!(F() && F().nd.arpt) : false), l === 'ARPT' ? () => press('ARPT') : null, l === 'ARPT' ? 'ARPT: the airports on the ND' : l)));
    C.push(rotC(cx + 0, 96, 13, 'MODE', [['ROSE', 'ROSE'], ['ARC', 'ARC'], ['PLAN', 'PLAN']], () => (F() ? F().nd.mode : 'ARC'), (v) => { const f = F(); if (f) f.nd.mode = v; }, 'ND MODE: ROSE NAV · ARC · PLAN'));
    C.push(rotC(cx + 86, 96, 13, 'RANGE', [[10, '10'], [20, '20'], [40, '40'], [80, '80'], [160, '160'], [320, '320']], () => (F() ? F().nd.range : 40), (v) => { const f = F(); if (f) f.nd.range = v; }, 'ND RANGE (NM)'));
  }
  // the FCU
  const f0 = px(-span * 0.33), fw = px(span * 0.33) - f0;
  const at = (f) => f0 + f * fw;
  const managedSpd = () => s().spdSel == null && s().machSel == null;
  C.push(fcuBtnC(at(0.05), 92, 50, 34, 'SPD\nMACH', () => false, () => press('SPDMACH')));
  C.push(winC(at(0.15), 40, 84, 28, () => {
    const f = F(); if (!f) return ['---', false];
    if (f.fcu.spdPreset != null) return [pad(f.fcu.spdPreset, 3), false];
    if (managedSpd()) return ['---', true];
    return s().machSel != null ? [`.${pad(s().machSel * 100, 2)}`, false] : [pad(s().spdSel, 3), false];
  }));
  C.push(fcuKnobC(at(0.15), 94, 19, 'spd'));
  C.push(fcuBtnC(at(0.25), 92, 50, 34, 'LOC', () => !!(F() && F().locBtn && !F().appr), () => press('LOC')));
  const hdgMgd = () => { const f = F(); return !!f && (f.hdgMgd || ['NAV', 'LOC*', 'LOC', 'LAND', 'FLARE', 'ROLL OUT'].includes(f.lat)); };
  C.push(winC(at(0.35), 40, 84, 28, () => { const f = F(); if (!f) return ['---', false]; if (f.fcu.hdgPreset != null) return [pad(f.fcu.hdgPreset, 3), false]; return hdgMgd() ? ['---', true] : [pad(f.fcu.hdg % 360, 3), false]; }));
  C.push(fcuKnobC(at(0.35), 94, 19, 'hdg'));
  C.push(fcuBtnC(at(0.44), 40, 62, 34, 'HDG V/S\nTRK FPA', () => false, () => press('TRKFPA')));
  C.push(fcuBtnC(at(0.50), 92, 46, 32, 'AP1', () => !!(F() && F().ap1), () => press('AP1')));
  C.push(fcuBtnC(at(0.565), 92, 46, 32, 'AP2', () => !!(F() && F().ap2), () => press('AP2')));
  C.push(fcuBtnC(at(0.532), 40, 60, 30, 'A/THR', () => !!(s().athr && s().spec && s().spec.athr), () => press('ATHR')));
  C.push(winC(at(0.66), 40, 104, 28, () => { const f = F(); return f ? [pad(f.fcu.alt, 5), f.altMgd] : ['-----', false]; }));
  C.push(fcuKnobC(at(0.66), 94, 19, 'alt'));
  C.push(fcuBtnC(at(0.755), 40, 50, 30, 'ALT\n100/1000', () => false, () => press('ALTINC'), 'the ALT knob: 100 or 1000 ft a step'));
  C.push(winC(at(0.755), 92, 50, 22, () => { const f = F(); return [f ? String(f.fcu.altInc) : '1000', false]; }));
  C.push(fcuBtnC(at(0.83), 92, 52, 34, 'EXPED', () => !!(F() && F().exped), () => press('EXPED')));
  C.push(winC(at(0.885), 40, 84, 28, () => {
    const f = F(); if (!f) return ['-----', false];
    if (f.vert === 'V/S') return [`${f.fcu.vs < 0 ? '-' : '+'}${pad(Math.abs(f.fcu.vs) / 100, 2)}oo`, false];
    if (f.vert === 'FPA') return [`${f.fcu.fpa < 0 ? '-' : '+'}${Math.abs(f.fcu.fpa).toFixed(1)}`, false];
    return ['-----', false];
  }));
  C.push(fcuKnobC(at(0.885), 94, 19, 'vs'));
  C.push(fcuBtnC(at(0.96), 92, 50, 34, 'APPR', () => !!(F() && F().appr), () => press('APPR')));
  return livePanel(W, H, '#16181b', (T) => {
    for (const x of [-span * 0.82, span * 0.82]) T.plate(px(x) - 74, 14, 148, 100, '#202326');
    for (const x of [-span * 0.55, span * 0.55]) { T.plate(px(x) - 150, 6, 300, 116); T.label(px(x) - 8, 66, 'EFIS', 9, '#9aa1aa'); }
    T.plate(f0 - 6, 4, fw + 12, 120, '#33373d');
    const lbl = (f, y, t) => T.label(at(f), y, t, 11);
    lbl(0.15, 14, 'SPD   MACH'); lbl(0.35, 14, 'HDG   TRK   LAT'); lbl(0.66, 14, 'ALT    LVL/CH'); lbl(0.885, 14, 'V/S   FPA');
  }, C);
}

// ---------- the overhead panel (both decks) ----------
// Laid out as on the A320 (looking up, aft at the top): ADIRS, calls and the like aft; FIRE with HYD and FUEL; ELEC,
// AIR (APU BLEED) and ANTI ICE; then forward EXT LT, APU and SIGNS, and the wipers either side of INT LT.
function overheadPanel(nEng) {
  const W = 1024, H = 1004;
  const sys = () => SYS();
  const S = () => (sys() ? sys().S : null);
  const set = (what, v, i) => { const x = sys(); if (x) x.set(what, v, i); };
  const C = [];
  const lit = (t, col, on) => ({ t, col, on: !!on });
  // FIRE: one block per engine and the APU, with the TEST button
  const fireY = 136, blocks = [...Array(nEng).keys(), 'apu'];
  const fx0 = nEng > 2 ? 30 : 290, fx1 = nEng > 2 ? 994 : 734;
  const bw = (fx1 - fx0) / blocks.length;
  blocks.forEach((i, k) => {
    const x = fx0 + bw * (k + 0.5);
    const name = i === 'apu' ? 'APU' : `ENG ${i + 1}`;
    const e = () => (S() ? (i === 'apu' ? S().apu : S().eng[i]) : null);
    C.push(fireC(x, fireY + 70, Math.min(96, bw - 22), 66, name, () => !!(e() && e().fire), () => !!(e() && e().firePb), () => set('firePb', undefined, i)));
    const ag = i === 'apu' ? [0] : [0, 1];
    ag.forEach((b) => {
      const ax = ag.length === 1 ? x : x + (b ? 1 : -1) * Math.min(26, bw * 0.24);
      const done = () => (e() ? (i === 'apu' ? !!e().agent : !!e().agents[b]) : false);
      C.push(pbC(ax, fireY + 162, 44, { top: () => lit('SQUIB', 'white', e() && e().firePb && !done()), bot: () => lit('DISCH', 'amber', done()), click: () => set('agent', b, i), tip: `${name} AGENT ${ag.length > 1 ? b + 1 : ''}: discharge the bottle (FIRE pushbutton pushed first)` }));
    });
  });
  C.push(pbC(512, fireY + 222, 36, { bot: () => lit('TEST', 'white', S() && S().test > 0), click: () => set('fireTest'), tip: 'FIRE TEST: every fire light and the chime' }));
  // AIR: APU BLEED
  C.push(pbC(512, 478, 50, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().apu.bleed), click: () => set('apuBleed'), tip: 'APU BLEED: the APU\'s air for the engine starts' }));
  // ANTI ICE: wing, each engine; probe / window heat (always AUTO)
  C.push(pbC(724, 482, 46, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().wingAntiIce), click: () => set('wingAntiIce'), tip: 'WING ANTI ICE' }));
  for (let i = 0; i < nEng; i++) {
    const x = 800 + i * (nEng > 2 ? 52 : 80);
    C.push(pbC(x, 482, 46, { top: () => lit('FAULT', 'amber', false), bot: () => lit('ON', 'blue', S() && S().eng[i] && S().eng[i].antiIce), click: () => set('engAntiIce', undefined, i), tip: `ENG ${i + 1} ANTI ICE` }));
  }
  // EXT LT
  const xl = [['STROBE', 'strobe', [['ON', 'ON'], ['AUTO', 'AUTO'], ['OFF', 'OFF']]], ['BEACON', 'beacon', [[1, 'ON'], [0, 'OFF']]], ['WING', 'wing', [[1, 'ON'], [0, 'OFF']]],
    ['NAV&LOGO', 'nav', [[1, '1'], [0, 'OFF']]], ['RWY TURN OFF', 'rwy', [[1, 'ON'], [0, 'OFF']]], ['LAND', 'land', [['ON', 'ON'], ['OFF', 'OFF'], ['RETRACT', 'RETR']]], ['NOSE', 'nose', [['TO', 'T.O'], ['TAXI', 'TAXI'], ['OFF', 'OFF']]]];
  xl.forEach(([label, key, opts], k) => C.push(swC(48 + k * 68, 756, 34, label, opts, () => (S() ? S().lt[key] : opts[0][0]), (v) => set(key, v), `${label} light`)));
  // APU
  C.push(pbC(590, 744, 50, { top: () => lit('FAULT', 'amber', S() && S().apu.fire), bot: () => lit('ON', 'blue', S() && S().apu.master), click: () => set('apuMaster'), tip: 'APU MASTER SW' }));
  C.push(pbC(660, 744, 50, { top: () => lit('ON', 'blue', S() && S().apu.start), bot: () => lit('AVAIL', 'green', S() && S().apu.avail), click: () => set('apuStart'), tip: 'APU START (master on first): about a minute to AVAIL' }));
  // SIGNS
  C.push(swC(770, 756, 34, 'SEAT BELTS', [[1, 'ON'], [0, 'OFF']], () => (S() ? S().signs.belts : 1), (v) => set('belts', v)));
  C.push(swC(860, 756, 34, 'NO SMOKING', [[1, 'ON'], [0, 'OFF']], () => (S() ? S().signs.smoke : 1), (v) => set('smoke', v)));
  // INT LT and the wipers
  C.push(rotC(80, 942, 20, 'WIPER', [[0, 'OFF'], [1, 'SLOW'], [2, 'FAST']], () => (S() ? S().wipers[0] : 0), (v) => set('wiper', v, 0), 'Captain\'s wiper'));
  C.push(rotC(944, 942, 20, 'WIPER', [[0, 'OFF'], [1, 'SLOW'], [2, 'FAST']], () => (S() ? S().wipers[1] : 0), (v) => set('wiper', v, 1), 'First officer\'s wiper'));
  C.push(dimC(240, 930, 18, 'OVHD INTEG LT', () => (S() ? S().lt.integ : 0.8), (v) => set('integ', v)));
  C.push(dimC(360, 930, 18, 'FLOOD LT', () => (S() ? S().lt.flood : 0), (v) => set('flood', v)));
  C.push(swC(480, 936, 32, 'DOME', [['BRT', 'BRT'], ['DIM', 'DIM'], ['OFF', 'OFF']], () => (S() ? S().lt.dome : 'OFF'), (v) => set('dome', v), 'DOME light'));
  C.push(swC(600, 936, 32, 'ANN LT', [['TEST', 'TEST'], ['BRT', 'BRT'], ['DIM', 'DIM']], () => (S() ? S().lt.ann : 'BRT'), (v) => set('ann', v), 'ANN LT: TEST lights every light'));
  return livePanel(W, H, '#4b5058', (T) => {
    // aft: the parts that are only pictures
    T.plate(10, 8, 1004, 120); T.title(10, 22, 1004, 'ADIRS · EVAC · EMER ELEC · GPWS · RCDR · OXYGEN · CALLS');
    T.rows(46, 76, 14, 1, 71, 0, 40, [['FAULT', 'ALIGN'], ['FAULT', 'ALIGN'], ['FAULT', 'ALIGN'], ['', 'CMD'], ['FAULT', 'GEN 1'], ['', 'SYS'], ['', 'TERR'], ['', 'G/S'], ['', 'FLAP'], ['', 'GND'], ['', 'MASK'], ['', 'CREW'], ['', 'MECH'], ['', 'ALL']]);
    // FIRE, HYD, FUEL
    if (nEng <= 2) {
      T.plate(10, 136, 270, 260); T.title(10, 150, 270, 'HYD');
      T.rows(55, 210, 3, 2, 90, 90, 44, [['FAULT', 'OFF'], ['FAULT', 'AUTO'], ['FAULT', 'OFF'], ['', 'ENG 1'], ['', 'PTU'], ['', 'ENG 2']]);
      T.plate(744, 136, 270, 260); T.title(744, 150, 270, 'FUEL');
      T.rows(789, 210, 3, 2, 90, 90, 44, [['FAULT', 'OFF'], ['FAULT', 'AUTO'], ['FAULT', 'OFF'], ['FAULT', 'OFF'], ['', 'X FEED'], ['FAULT', 'OFF']]);
    }
    T.plate(fx0 - 10, 136, fx1 - fx0 + 20, 260, '#454a52'); T.title(fx0 - 10, 150, fx1 - fx0 + 20, 'FIRE');
    // ELEC, AIR, ANTI ICE
    T.plate(10, 404, 330, 230); T.title(10, 418, 330, 'ELEC');
    T.rows(55, 470, 4, 2, 80, 80, 44, [['FAULT', 'OFF'], ['FAULT', 'OFF'], ['', 'AUTO'], ['FAULT', 'OFF'], ['FAULT', 'GEN 1'], ['', 'APU GEN'], ['', 'EXT PWR'], ['FAULT', 'GEN 2']]);
    T.label(175, 612, 'BAT 1   BAT 2   BUS TIE', 10);
    T.plate(350, 404, 324, 230); T.title(350, 418, 324, 'AIR COND');
    T.rows(392, 478, 2, 1, 240, 0, 44, [['FAULT', 'ON'], ['FAULT', 'ON']]);
    T.label(512, 446, 'APU BLEED', 10);
    T.rows(392, 576, 2, 1, 240, 0, 40, [['FAULT', 'OFF'], ['FAULT', 'OFF']]);
    T.label(512, 576, 'PACK 1 · PACK 2', 9);
    T.plate(684, 404, 330, 230); T.title(684, 418, 330, 'ANTI ICE');
    T.label(724, 448, 'WING', 10);
    T.label(nEng > 2 ? 878 : 840, 448, nEng > 2 ? 'ENG 1 · 2 · 3 · 4' : 'ENG 1      ENG 2', 10);
    T.rows(760, 576, 3, 1, 90, 0, 40, [['FAULT', 'AUTO'], ['', 'ON'], ['', 'AUTO']]);
    T.label(850, 608, 'PROBE / WINDOW HEAT', 9);
    // EXT LT, APU, SIGNS, INT LT
    T.plate(10, 642, 500, 200); T.title(10, 656, 500, 'EXT LT');
    T.plate(520, 642, 210, 200); T.title(520, 656, 210, 'APU');
    T.label(590, 786, 'MASTER SW', 9); T.label(660, 786, 'START', 9);
    T.plate(740, 642, 274, 200); T.title(740, 656, 274, 'SIGNS');
    T.toggle(955, 756, 34, 1, 3); T.label(955, 720, 'EMER EXIT LT', 9);
    T.plate(10, 850, 140, 146); T.plate(874, 850, 140, 146);
    T.plate(160, 850, 704, 146); T.title(160, 864, 704, 'INT LT');
    T.label(740, 896, 'ICE IND & STBY COMPASS', 9); T.toggle(740, 940, 30, 1, 2);
  }, C);
}

// ---------- the pedestal's top (per deck): MCDUs or KCCUs at the front, radios, the levers' quadrant, ENG ----------
function pedestalPanel(kind, nEng) {
  const W = 512, H = 1024;
  const S = () => (SYS() ? SYS().S : null);
  const set = (what, v, i) => { const x = SYS(); if (x) x.set(what, v, i); };
  const C = [];
  const engY = kind === 'a320' ? 800 : 640;
  // the engine masters, each with its FIRE and FAULT lights, and the mode selector
  for (let i = 0; i < nEng; i++) {
    const x = nEng > 2 ? 110 + i * 64 : (i ? W * 0.62 : W * 0.38);
    C.push(pbC(x, engY - 58, 38, { top: () => ({ t: 'FIRE', col: 'red', on: !!(S() && S().eng[i] && S().eng[i].fire) }), bot: () => ({ t: 'FAULT', col: 'amber', on: !!(S() && S().eng[i] && (S().eng[i].failed || S().eng[i].start)) }), tip: `ENG ${i + 1}: FIRE and FAULT lights` }));
    C.push(swC(x - 8, engY + 10, 44, `MASTER ${i + 1}`, [[1, 'ON'], [0, 'OFF']], () => (S() && S().eng[i] ? S().eng[i].master : 1), (v) => set('master', v, i), `ENG MASTER ${i + 1}: OFF cuts its fuel; ON with IGN starts it`));
  }
  C.push(rotC(nEng > 2 ? 400 : W * 0.5, engY + (nEng > 2 ? 110 : 20), 20, 'MODE', [['CRANK', 'CRANK'], ['NORM', 'NORM'], ['IGN', 'IGN/START']], () => (S() ? S().engMode : 'NORM'), (v) => set('engMode', v), 'ENG MODE selector: IGN/START to start or relight an engine'));
  // the MCDUs (a click opens the MCDU)
  if (kind === 'a320') {
    for (const cx of [W * 0.25, W * 0.75]) {
      C.push({ x: cx, y: 175, w: 230, h: 300, tip: 'MCDU: click to open (Y)', click: () => { if (FG.mcdu) FG.mcdu.toggle(); }, sig: () => '' });
    }
  }
  // the parking brake
  C.push({ x: W * 0.5, y: kind === 'a320' ? 965 : 980, w: 160, h: 60, tip: 'PARKING BRK (K)', sig: () => J(!!P_().state.parking),
    draw(T) { T.plate(W * 0.5 - 80, (kind === 'a320' ? 965 : 980) - 30, 160, 60, '#33373d'); T.label(W * 0.5, (kind === 'a320' ? 965 : 980) - 14, 'PARK BRK', 10); T.label(W * 0.5, (kind === 'a320' ? 965 : 980) + 12, P_().state.parking ? 'ON' : 'OFF', 12, P_().state.parking ? '#ffb000' : '#e9edf1'); },
    click: () => { const s = P_().state; s.parking = !s.parking; } });
  return livePanel(W, H, '#4b5058', (T, b, g) => {
    if (kind === 'a320') {
      // the two MCDUs, their screens with the page's outline
      for (const cx of [W * 0.25, W * 0.75]) {
        T.plate(cx - 118, 22, 236, 310, '#2c3035');
        b.fillStyle = '#05070a'; b.fillRect(cx - 92, 36, 184, 120);
        g.fillStyle = '#0a2a14';
        const f = FG.fmgc && FG.fmgc.F, plan = f && f.plan;
        const lines = [plan ? `${(plan.from && plan.from.code) || ''}/${(plan.to && plan.to.code) || ''}` : 'MCDU MENU', 'F-PLN', 'INIT  PERF', 'PROG  DIR', 'RAD NAV'];
        lines.forEach((l, i) => { for (const c of [b, g]) { c.font = '600 13px ui-monospace, monospace'; c.textAlign = 'center'; c.fillStyle = i ? '#30d158' : '#e9edf1'; c.fillText(l, cx, 54 + i * 22); } });
        b.fillStyle = '#1a1c1f';
        for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) b.fillRect(cx - 96 + c * 33, 168 + r * 26, 28, 20);
        for (let r = 0; r < 6; r++) { b.fillRect(cx - 114, 44 + r * 19, 14, 11); b.fillRect(cx + 100, 44 + r * 19, 14, 11); }
      }
    } else {
      // KCCUs (front part, ahead of the levers)
      for (const cx of [W * 0.24, W * 0.76]) {
        T.plate(cx - 110, 20, 220, 300, '#2c3035');
        b.fillStyle = '#1a1c1f';
        for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) b.fillRect(cx - 100 + c * 25, 40 + r * 26, 21, 21);
        g.fillStyle = '#20262c';
        for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) g.fillRect(cx - 96 + c * 25, 47 + r * 26, 12, 6);
        const grd = b.createRadialGradient(cx - 6, 250, 3, cx, 255, 30);
        grd.addColorStop(0, '#8d949c'); grd.addColorStop(1, '#25282c');
        b.fillStyle = grd; b.beginPath(); b.arc(cx, 255, 28, 0, 7); b.fill(); // track ball
      }
    }
    // radios and the transponder
    const ry = kind === 'a320' ? 345 : 720;
    for (let i = 0; i < 2; i++) {
      const y = ry + i * (kind === 'a320' ? 0 : 145), x0 = kind === 'a320' ? (i ? W / 2 + 4 : 14) : 14, w = kind === 'a320' ? W / 2 - 18 : W - 28;
      if (kind === 'a320' && i) { /* side by side */ }
      T.plate(x0, y, w, kind === 'a320' ? 120 : 135);
      T.window(x0 + w * 0.3, y + 36, w * 0.36, 26, i ? '121.500' : '118.705');
      T.window(x0 + w * 0.72, y + 36, w * 0.36, 26, i ? '7000' : '121.500');
      T.rows(x0 + w * 0.14, y + 88, kind === 'a320' ? 4 : 6, 1, kind === 'a320' ? w * 0.24 : 64, 0, 30, [['', 'VHF1', 1], ['', 'VHF2'], ['', 'VHF3'], ['', 'HF1'], ['', 'HF2'], ['', 'INT']]);
    }
    // the levers' quadrant
    if (kind === 'a320') { T.plate(W * 0.2, 480, W * 0.6, 240, '#24272b'); T.label(W * 0.5, 496, 'TOGA · FLX MCT · CL · IDLE', 9, '#9aa1aa'); }
    // ENG panel
    T.plate(14, engY - 96, W - 28, nEng > 2 ? 250 : 170, '#33373d');
    T.label(W * 0.5, engY - 84, 'ENG', 13);
  }, C);
}

// ---------- the main panel's face round the screens ----------
function mainPanelArt(kind) {
  if (kind === 'a320') {
    return livePanel(1024, 256, '#4b5058', (T, b) => {
      b.fillStyle = 'rgba(255,255,255,0.04)';
      for (let x = 0; x < 1024; x += 64) b.fillRect(x, 0, 1, 256);
      // the brightness knobs and the loudspeaker grilles under the screens
      for (const cx of [200, 824]) {
        T.knob(cx - 80, 232, 8); T.knob(cx + 80, 232, 8);
        b.fillStyle = '#2f3339'; for (let i = 0; i < 9; i++) b.fillRect(cx - 30 + i * 7, 220, 3, 22);
      }
      // the clock and the A/SKID & N/W STRG switch round the middle
      T.plate(712, 150, 70, 96); T.label(747, 166, 'CLOCK', 8);
      b.fillStyle = '#050505'; b.fillRect(718, 180, 58, 22);
      T.label(747, 228, 'A/SKID & N/W STRG', 6);
    }, autobrakeCtl(408, 200, 'a320'));
  }
  return livePanel(1024, 256, '#4b5058', (T, b) => {
    b.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < 1024; x += 64) b.fillRect(x, 0, 1, 256);
    for (const cx of [1024 * 0.27, 1024 * 0.73]) {
      T.knob(cx - 60, 256 * 0.88, 9); T.knob(cx + 60, 256 * 0.88, 9);
      b.fillStyle = '#2f3339'; for (let i = 0; i < 9; i++) b.fillRect(cx - 30 + i * 7, 256 * 0.84, 3, 22);
    }
    T.plate(1024 * 0.43, 256 * 0.80, 1024 * 0.14, 256 * 0.18);
  }, autobrakeCtl(1024 * 0.465, 256 * 0.89, 'a350'));
}
// The AUTO BRK buttons (LO, MED, MAX: the FMGC's).
function autobrakeCtl(x0, y0, kind) {
  const F = () => (FG.fmgc ? FG.fmgc.F : null);
  return ['LO', 'MED', 'MAX'].map((m, i) => pbC(kind === 'a320' ? x0 : x0 + i * 36, kind === 'a320' ? y0 - 70 + i * 34 : y0, kind === 'a320' ? 30 : 28, {
    top: () => ({ t: 'DECEL', col: 'green', on: !!(F() && F().abrk === m && F().abrkOn) }),
    bot: () => ({ t: m, col: 'blue', on: !!(F() && F().abrk === m) }),
    click: () => { if (FG.fmgc) FG.fmgc.press(`BRK ${m}`); }, tip: `AUTO BRK ${m}` }));
}

// ---------- geometry ----------
// A flat polygon (cockpit space) from 2D points through `to(u, v) → [x, y, z]`, with holes.
function shapeMesh(outer, holes, to, mat) {
  const sh = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ShapeGeometry(sh, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = to(p.getX(i), p.getY(i));
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
// A window's outline grown outwards by d (its frame's outer edge): each corner moved along the bisector.
function grow(poly, d) {
  const n = poly.length, out = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1; // (counter-clockwise: the outside is to the right of each edge)
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const n1 = norm([(b[1] - a[1]) * sgn, -(b[0] - a[0]) * sgn]), n2 = norm([(c[1] - b[1]) * sgn, -(c[0] - b[0]) * sgn]);
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const k = d / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    out.push([b[0] + m[0] * k, b[1] + m[1] * k]);
  }
  return out;
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// A box between two corners, turned by `rot` (Euler, radians) about its centre.
function box(w, d, h, mat, x, y, z, rot) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}
// A rounded box (side-stick grips, lever knobs, cushions).
function rounded(w, d, h, r, mat) {
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -d / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r); s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d); s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 });
  geo.translate(0, 0, -h / 2);
  return new THREE.Mesh(geo, mat);
}
// A flat quad between four corners (cockpit space) as the viewer sees them: top-left, top-right, bottom-left,
// bottom-right; the canvas's top-left at the top-left.
function quad(tl, tr, bl, br, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...tl, ...tr, ...bl, ...br], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  geo.setIndex([0, 2, 1, 1, 2, 3]); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function build(kind, nEng) {
  useDeck(kind);
  const a320 = kind === 'a320';
  // The windows (2D outlines): the windscreen in its plane (u = |x|, v = z), the side windows in the wall's (u = y, v = z).
  const k = D.scr / 1.19;
  const SCREEN = [[0.075, -0.25], [1.13 * k, -0.25], [1.19 * k, -0.19], [1.19 * k, 0.17], [1.08 * k, 0.27], [0.075, 0.27]];
  const SIDE1 = [[wallFrontY(-0.17) - 0.09, -0.17], [-0.02, -0.17], [-0.02, 0.24], [wallFrontY(0.24) - 0.09, 0.24]];
  const SIDE2 = [[-0.14, -0.15], [-0.74 * k, -0.13], [-0.74 * k, 0.18], [-0.14, 0.22]];
  const root = new THREE.Group();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, ...extra });
  const M = {
    lining: std(COL.lining, { roughness: 0.9 }),
    frame: std(COL.frame, { roughness: 0.6 }),
    shield: std(COL.shield, { roughness: 1 }),
    panel: std(COL.panel),
    console: std(COL.console),
    floor: std(COL.floor, { roughness: 1 }),
    seat: std(COL.seat, { roughness: 0.95 }),
    leather: std(0x23262b, { roughness: 0.55 }),
    bezel: std(COL.bezel, { roughness: 0.4 }),
    metal: std(COL.metal, { roughness: 0.35, metalness: 0.7 }),
    knob: std(0x2a2d31, { roughness: 0.45 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide }),
  };
  const lit = []; // materials with a glow map (night lighting)
  const panels = []; // live panels (painted again when their controls change)
  const clickables = []; // meshes a click can hit
  const livePanelMat = (p) => { const m = std(0xffffff, { map: p.map, emissiveMap: p.glow, emissive: 0x000000, roughness: 0.7 }); lit.push(m); panels.push(p); return m; };
  const clickable = (mesh, panel) => { mesh.userData.panel = panel; clickables.push(mesh); return mesh; };
  const wipers = [];

  // windscreens and the walls round them, either side of the centre post
  for (const s of [-1, 1]) {
    const to = (u, v) => [s * u, frontY(u, v), v];
    const outer = [[0, -0.40], [HALF, -0.40], [HALF, ROOF], [0, ROOF]]; // (below the glareshield's top: hidden)
    const ring = grow(SCREEN, 0.045);
    root.add(shapeMesh(outer, [ring], to, M.lining));
    root.add(shapeMesh(ring, [SCREEN], (u, v) => { const p = to(u, v); p[1] -= 0.012; return p; }, M.frame));
    root.add(shapeMesh(SCREEN, [], (u, v) => { const p = to(u, v); p[1] += 0.01; return p; }, M.glass));
    // side wall with its two windows (u = y ahead, v = z), and their frames
    const toW = (u, v) => [s * (HALF - 0.004 * (v - FLOOR)), u, v];
    const wall = [[wallFrontY(FLOOR), FLOOR], [REAR, FLOOR], [REAR, ROOF], [wallFrontY(ROOF), ROOF]];
    const r1 = grow(SIDE1, 0.05), r2 = grow(SIDE2, 0.05);
    root.add(shapeMesh(wall, [r1, r2], toW, M.lining));
    for (const [r, w] of [[r1, SIDE1], [r2, SIDE2]]) {
      root.add(shapeMesh(r, [w], (u, v) => { const p = toW(u, v); p[0] -= s * 0.012; return p; }, M.frame));
      root.add(shapeMesh(w, [], (u, v) => { const p = toW(u, v); p[0] += s * 0.008; return p; }, M.glass));
    }
    // a sun visor folded up against the frame
    const vx = 0.62 * k;
    root.add(box(0.55 * k, 0.012, 0.16, std(0x2b2f35, { transparent: true, opacity: 0.8 }), s * vx, frontY(vx, 0.3) - 0.08, 0.36, [-0.2, 0, 0]));
    // the wiper: it turns about its foot at the bottom outboard corner of the windscreen, across the glass
    const footX = 0.86 * k, footZ = -0.235;
    const piv = new THREE.Group();
    piv.position.set(s * footX, frontY(footX, footZ) - 0.022, footZ);
    // (the windscreen's plane: its normal, the axis the wiper turns about)
    const nrm = new THREE.Vector3(s * D.wsK, 1, D.wsZ).normalize();
    piv.userData = { axis: nrm, side: s };
    const arm = box(0.50 * k, 0.008, 0.010, M.frame, -s * 0.25 * k, 0, 0);
    // (lying along the bottom of the glass, inward)
    const tilt = new THREE.Group();
    tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.clone());
    tilt.add(arm); arm.rotation.z = 0;
    piv.add(tilt);
    root.add(piv);
    wipers.push(piv);
  }
  // the centre post
  root.add(shapeMesh([[-0.045, -0.25], [0.045, -0.25], [0.045, 0.30], [-0.045, 0.30]], [], (u, v) => [u, frontY(u, v) - 0.014, v], M.frame));

  // roof, floor, rear wall
  root.add(shapeMesh([[-HALF, REAR], [HALF, REAR], [HALF, wallFrontY(ROOF)], [0, frontY(0, ROOF)], [-HALF, wallFrontY(ROOF)]], [], (u, v) => [u, v, ROOF], M.lining));
  root.add(shapeMesh([[-HALF, REAR], [HALF, REAR], [HALF, 1.2], [-HALF, 1.2]], [], (u, v) => [u, v, FLOOR], M.floor));
  root.add(shapeMesh([[-HALF, FLOOR], [HALF, FLOOR], [HALF, ROOF], [-HALF, ROOF]], [[[-0.4, FLOOR + 0.02], [0.4, FLOOR + 0.02], [0.4, 0.38], [-0.4, 0.38]]], (u, v) => [u, REAR, v], M.lining));
  root.add(box(0.82, 0.05, 1.72, std(0x3a3e44), 0, REAR + 0.02, (FLOOR + 0.38) / 2)); // the door

  // the glareshield: its top from the windscreen's sill back to its lip, the face with the FCU and EFIS panels
  const lipY = (x) => (a320 ? 0.62 : 0.71) - (a320 ? 0.28 : 0.36) * Math.pow(Math.abs(x) / HALF, 2);
  const GT = -0.245, GF = 0.085; // top height, face height
  const pts = [];
  for (let i = 0; i <= 20; i++) { const x = -HALF + (2 * HALF * i) / 20; pts.push([x, lipY(x)]); }
  const topOutline = [...pts, ...pts.slice().reverse().map(([x]) => [x, frontY(x, GT) + 0.02])];
  root.add(shapeMesh(topOutline, [], (u, v) => [u, v, GT], M.shield));
  {
    const span = a320 ? 0.86 : 1.05;
    const gp = glareshieldPanel(span);
    const mat = livePanelMat(gp);
    const n = 40, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const x = -span + (2 * span * i) / n, y = lipY(x) + 0.004;
      pos.push(x, y, GT, x, y + 0.03, GT - GF);
      uv.push(i / n, 1, i / n, 0);
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    root.add(clickable(new THREE.Mesh(geo, mat), gp));
    // the face's ends out to the walls, plain
    for (const s of [-1, 1]) {
      const pos2 = [], idx2 = [];
      for (let i = 0; i <= 8; i++) {
        const x = s * (span + ((HALF - span) * i) / 8), y = lipY(x) + 0.004;
        pos2.push(x, y, GT, x, y + 0.03, GT - GF);
        if (i < 8) idx2.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      g2.setIndex(idx2); g2.computeVertexNormals();
      root.add(new THREE.Mesh(g2, M.shield));
    }
    // the underside of the lip (seen from below: shadows the top of the screens)
    const under = [...pts.map(([x, y]) => [x, y + 0.03]), ...pts.slice().reverse().map(([x, y]) => [x, y + 0.10])];
    root.add(shapeMesh(under, [], (u, v) => [u, v, GT - GF], M.shield));
  }

  // the main panel: the middle flat, the outer parts turned towards the pilots; the screens in it
  const P = a320
    ? { top: GT - GF - 0.005, bot: -0.80, y: 0.70, lean: 0.12, mid: 0.20, wing: 14 * Math.PI / 180, end: 0.92 }
    : { top: GT - GF - 0.005, bot: -0.86, y: 0.84, lean: 0.14, mid: 0.66, wing: 24 * Math.PI / 180, end: 1.10 };
  const mainP = mainPanelArt(kind);
  const panelMat = livePanelMat(mainP);
  // (u across the panel's face from the middle, v down from its top: cockpit space)
  const panelAt = (u, v) => {
    const s = Math.sign(u) || 1, a = Math.abs(u);
    const z = P.top - v, y = P.y + P.lean * (z - P.bot) / (P.top - P.bot) - 0.06;
    if (a <= P.mid) return [u, y, z];
    const d = a - P.mid;
    return [s * (P.mid + d * Math.cos(P.wing)), y - d * Math.sin(P.wing), z];
  };
  const panelFaceNormal = (u) => {
    const a = Math.abs(u), s = Math.sign(u) || 1;
    const n = new THREE.Vector3(0, -1, P.lean / (P.top - P.bot)).normalize();
    if (a > P.mid) n.applyAxisAngle(new THREE.Vector3(0, 0, 1), -s * P.wing);
    return n;
  };
  {
    const n = 48, m = 6, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      const u = -P.end + (2 * P.end * i) / n, v = ((P.top - P.bot) * j) / m;
      pos.push(...panelAt(u, v)); uv.push(i / n, 1 - j / m);
      if (i < n && j < m) { const a = i * (m + 1) + j, b = a + m + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    root.add(clickable(new THREE.Mesh(geo, panelMat), mainP));
  }
  // the screens: bezel boxes standing out of the panel, each face a canvas the instruments are drawn on
  const screens = [];
  const addScreen = (u, vTop, w, h, kindS, canvasW = 1024) => {
    const at = new THREE.Vector3(...panelAt(u, vTop + h / 2));
    const nrm = panelFaceNormal(u);
    const g = new THREE.Group(); g.up.set(0, 0, 1);
    g.position.copy(at).addScaledVector(nrm, 0.012);
    g.lookAt(at.clone().addScaledVector(nrm, 1)); // (+z of the group towards the pilots)
    g.add(box(w + 0.03, h + 0.03, 0.024, M.bezel, 0, 0, -0.004));
    const cv = canvas(canvasW, Math.round(canvasW * h / w));
    const tex = texture(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0085;
    g.add(face);
    // a faint reflection layer over the glass
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
    sheen.position.z = 0.0095;
    g.add(sheen);
    root.add(g);
    screens.push({ kind: kindS, cv, ctx: cv.getContext('2d'), tex });
  };
  const vS = 0.012;
  let isisAt, gearAt;
  if (a320) {
    // six square screens: PFD, ND · E/WD over SD · ND, PFD
    const S6 = 0.168;
    addScreen(-0.64, vS, S6, S6, 'pfd', 640);
    addScreen(-0.42, vS, S6, S6, 'nd', 640);
    addScreen(0.03, vS, S6, S6, 'ewd', 640);
    addScreen(0.03, vS + S6 + 0.03, S6, S6, 'sd', 640);
    addScreen(0.42, vS, S6, S6, 'nd', 640);
    addScreen(0.64, vS, S6, S6, 'pfd', 640);
    isisAt = [-0.135, 0.07]; gearAt = [0.165, 0.27];
  } else {
    const W = 0.305, H = 0.229;
    addScreen(-0.86, vS, W * 0.92, H, 'ois-c', 768);
    addScreen(-0.475, vS, W, H, 'pfdnd-c');
    addScreen(0, vS, W * 0.98, H, 'ewd');
    addScreen(0.475, vS, W, H, 'pfdnd-f');
    addScreen(0.86, vS, W * 0.92, H, 'ois-f', 768);
    addScreen(0, vS + H + 0.035, W * 0.95, H * 0.95, 'sd');
    isisAt = [-0.235, 0.10]; gearAt = [0.235, 0.12];
  }
  // the standby instrument and the gear lever
  {
    const at = new THREE.Vector3(...panelAt(isisAt[0], isisAt[1])), nrm = panelFaceNormal(0);
    const g = new THREE.Group(); g.up.set(0, 0, 1); g.position.copy(at).addScaledVector(nrm, 0.01); g.lookAt(at.clone().addScaledVector(nrm, 1));
    g.add(box(0.095, 0.095, 0.02, M.bezel, 0, 0, 0));
    const cv = canvas(256, 256), tex = texture(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0105; g.add(face);
    root.add(g);
    screens.push({ kind: 'isis', cv, ctx: cv.getContext('2d'), tex });
  }
  const gear = new THREE.Group();
  {
    const at = new THREE.Vector3(...panelAt(gearAt[0], gearAt[1])), nrm = panelFaceNormal(0);
    gear.up.set(0, 0, 1);
    gear.position.copy(at).addScaledVector(nrm, 0.012); gear.lookAt(at.clone().addScaledVector(nrm, 1));
    const plate = box(0.075, 0.2, 0.012, M.bezel, 0, 0, 0);
    gear.add(plate);
    gear.add(box(0.016, 0.15, 0.004, std(0x000000), 0, 0, 0.007));
    const arm = new THREE.Group(); arm.position.set(0, 0, 0.008); gear.add(arm);
    arm.add(box(0.012, 0.012, 0.07, M.metal, 0, 0, 0.035));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 18), std(0xdadfe4, { roughness: 0.5 }));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0, 0.075); arm.add(wheel);
    gear.userData.arm = arm;
    for (const m of [plate, wheel]) { m.userData.click = { tip: 'Landing gear lever (G)', click: gearLever }; clickables.push(m); }
    // the three green triangles above it
    const tri = new THREE.MeshBasicMaterial({ color: 0x1fd15a, toneMapped: false });
    gear.userData.tris = [];
    for (const [dx, dy] of [[0, 0.125], [-0.022, 0.108], [0.022, 0.108]]) {
      const t = new THREE.Mesh(new THREE.CircleGeometry(0.008, 3), tri.clone());
      t.position.set(dx, dy, 0.007); t.rotation.z = -Math.PI / 2; gear.add(t); gear.userData.tris.push(t);
    }
    root.add(gear);
  }

  // the pedestal: from under the panel back between the seats
  const ped = a320 ? { w: 0.25, top: -0.72, front: 0.62, slope: 0.30, rear: -0.70 } : { w: 0.27, top: -0.76, front: 0.74, slope: 0.36, rear: -0.70 };
  {
    const pp = pedestalPanel(kind, nEng);
    const mat = livePanelMat(pp);
    // its top: the slope then flat (u = x, v = along)
    const prof = [[ped.front, P.bot + 0.02], [ped.slope, ped.top], [ped.rear, ped.top]];
    const len = prof.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]) : 0), 0);
    const pos = [], uv = [], idx = [];
    let acc = 0;
    prof.forEach((p, i) => {
      if (i) acc += Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]);
      pos.push(-ped.w, p[0], p[1], ped.w, p[0], p[1]);
      uv.push(0, 1 - acc / len, 1, 1 - acc / len);
      if (i < prof.length - 1) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    root.add(clickable(new THREE.Mesh(geo, mat), pp));
    for (const s of [-1, 1]) {
      const side = [[ped.front, P.bot + 0.02], [ped.slope, ped.top], [ped.rear, ped.top], [ped.rear, FLOOR], [ped.front + 0.1, FLOOR]];
      root.add(shapeMesh(side, [], (u, v) => [s * ped.w, u, v], M.console));
    }
  }
  // the levers on the pedestal: thrust (one per engine), speed brake (left), flaps (right)
  const levers = {};
  {
    const ly = a320 ? 0.02 : 0.08;
    const base = new THREE.Group(); base.position.set(0, ly, ped.top + 0.005); root.add(base);
    base.add(box(0.20, 0.30, 0.03, std(0x24272b), 0, 0, 0.012));
    levers.thrust = [];
    const xs = nEng > 2 ? [-0.066, -0.022, 0.022, 0.066] : [-0.04, 0.04];
    for (const x of xs) {
      const arm = new THREE.Group(); arm.position.set(x, 0, 0.02); base.add(arm);
      arm.add(box(0.012, 0.012, 0.20, M.metal, 0, 0, 0.10));
      const grip = rounded(nEng > 2 ? 0.04 : 0.075, 0.035, 0.035, 0.012, std(0x1d1f22, { roughness: 0.5 }));
      grip.position.set(nEng > 2 ? 0 : -x * 0.6, 0, 0.215); arm.add(grip);
      arm.add(box(nEng > 2 ? 0.03 : 0.05, 0.01, 0.015, std(0xb6bcc4), nEng > 2 ? 0 : -x * 0.6, -0.022, 0.20));
      levers.thrust.push(arm);
    }
    const sb = new THREE.Group(); sb.position.set(-0.17, ly + 0.02, ped.top + 0.01); root.add(sb);
    sb.add(box(0.01, 0.01, 0.12, M.metal, 0, 0, 0.06));
    const sbg = rounded(0.03, 0.05, 0.02, 0.008, std(0x23262b)); sbg.position.set(0, 0, 0.125); sb.add(sbg);
    levers.sb = sb;
    const fl = new THREE.Group(); fl.position.set(0.17, ly - 0.08, ped.top + 0.01); root.add(fl);
    fl.add(box(0.01, 0.01, 0.12, M.metal, 0, 0, 0.06));
    const flg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.022), std(0xdfe3e8, { roughness: 0.5 })); flg.position.set(0, 0, 0.125); fl.add(flg);
    levers.flaps = fl;
  }

  // side consoles with the side-sticks and tillers
  const sticks = [];
  for (const s of [-1, 1]) {
    const mat = std(0xffffff, { map: consoleArt(s < 0).map, emissiveMap: consoleArt(s < 0).glow, emissive: 0x000000 });
    lit.push(mat);
    const x0 = s * (HALF - 0.38), x1 = s * (HALF - 0.01), y0 = 0.62, y1 = -0.75, zt = -0.60;
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    root.add(quad([xa, y0, zt], [xb, y0, zt], [xa, y1, zt], [xb, y1, zt], mat)); // (forward at the picture's top)
    root.add(shapeMesh([[y0, zt], [y1, zt], [y1, FLOOR], [y0, FLOOR]], [], (u, v) => [x0, u, v], M.console));
    root.add(shapeMesh([[x0, zt], [x1, zt], [x1, FLOOR], [x0, FLOOR]], [], (u, v) => [u, y0, v], M.console));
    // the side-stick: a boot, the grip leaning a little forward and outward
    const st = new THREE.Group(); st.position.set(s * (HALF - 0.23), 0.30, zt + 0.004); root.add(st);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.03, 20), M.leather); boot.rotation.x = Math.PI / 2; boot.position.z = 0.015; st.add(boot);
    const grip = new THREE.Group(); grip.position.z = 0.03; st.add(grip);
    const g1 = rounded(0.038, 0.045, 0.11, 0.016, std(0x1c1e21, { roughness: 0.6 })); g1.position.z = 0.06; grip.add(g1);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10), std(0x1c1e21, { roughness: 0.6 })); top.position.z = 0.12; grip.add(top);
    grip.add(box(0.012, 0.012, 0.025, std(0xb33a2a), 0, 0.022, 0.09)); // (the take-over button is red)
    sticks.push({ side: s, grip });
    // tiller wheel ahead of the stick
    const til = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 24), M.knob); til.rotation.x = Math.PI / 2; til.position.set(s * (HALF - 0.28), 0.50, zt + 0.012); root.add(til);
    // the rudder pedals under the panel
    for (const dx of [-0.09, 0.09]) root.add(box(0.07, 0.03, 0.14, M.metal, s * EYE_X + dx, P.y - 0.2, -1.05, [-0.5, 0, 0]));
  }

  // the overhead panel, under the ceiling from behind the windscreens back over the pilots' heads
  {
    const op = overheadPanel(nEng);
    const mat = livePanelMat(op);
    // (sloped as the real one: its front end lower, over the windscreens; as long as its picture says)
    const w = a320 ? 0.42 : 0.46, zf = ROOF - 0.20, zb = ROOF - 0.02, f = frontY(0, zf) - 0.03;
    const len = (2 * w * op.H) / op.W, b = f - Math.sqrt(len * len - (zb - zf) * (zb - zf));
    // (aft is the top of the picture: looking up from the seat, aft is up)
    root.add(clickable(quad([-w, b, zb], [w, b, zb], [-w, f, zf], [w, f, zf], mat), op));
    for (const s of [-1, 1]) root.add(shapeMesh([[f, zf], [b, zb], [b, ROOF], [f, ROOF]], [], (u, v) => [s * w, u, v], M.panel));
    root.add(shapeMesh([[-w, zf], [w, zf], [w, ROOF], [-w, ROOF]], [], (u, v) => [u, f, v], M.panel));
  }

  // the seats (the captain's is behind the camera; the first officer's is seen looking right)
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * EYE_X, -0.42, 0); root.add(g);
    const cush = rounded(0.50, 0.50, 0.10, 0.05, M.seat); cush.position.set(0, 0.05, -0.80); g.add(cush);
    const back = rounded(0.50, 0.12, 0.70, 0.05, M.seat); back.position.set(0, -0.22, -0.40); back.rotation.x = -0.18; g.add(back);
    const head = rounded(0.30, 0.10, 0.16, 0.04, M.seat); head.position.set(0, -0.30, 0.06); head.rotation.x = -0.18; g.add(head);
    for (const dx of [-0.29, 0.29]) { const arm = rounded(0.06, 0.38, 0.05, 0.02, M.leather); arm.position.set(dx, -0.02, -0.62); g.add(arm); }
    g.add(box(0.12, 0.3, 0.45, M.metal, 0, 0, -1.08));
  }

  // lights: the sky through the windows, the sun, the dome light and the flood light under the glareshield
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3a3630, 1.2);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  const dome = new THREE.PointLight(0xffe2b8, 0, 4, 1); dome.position.set(0, -0.2, ROOF - 0.08);
  const flood = new THREE.PointLight(0xfff0d8, 0, 1.6, 1.2); flood.position.set(0, P.y - 0.25, GT - GF - 0.04);
  root.add(hemi, sun, sun.target, amb, dome, flood);

  const scene = new THREE.Scene();
  scene.add(root);
  return { kind, nEng, eyeX: D.EYE_X, scene, screens, gear, levers, sticks, lit, panels, clickables, wipers, hemi, sun, amb, dome, flood };
}

// The side console: the tiller, the nose-wheel and a tray table's outline.
const consoleArts = {};
function consoleArt(left) {
  if (consoleArts[left]) return consoleArts[left];
  return (consoleArts[left] = panelArt(256, 512, (b, g, W) => {
    const T = tools(b, g);
    T.plate(20, 40, W - 40, 150, '#3d4249');
    T.label(W / 2, 60, left ? 'CAPT' : 'F/O', 12);
    T.pb(W * 0.35, 120, 40, '', 'PRIO');
    T.knob(W * 0.7, 120, 16);
    b.strokeStyle = 'rgba(0,0,0,0.5)'; b.lineWidth = 2; b.strokeRect(24, 250, W - 48, 220); // tray table
  }, '#575c64'));
}

// The gear lever, clicked: as G.
function gearLever() {
  const s = P_().state;
  if (!s.spec) return;
  if (s.spec.gear === 'fixed') return;
  if (s.onGround && s.gearDown) { P_().api.say('The gear cannot come up on the ground', 'amber'); return; }
  s.gearDown = !s.gearDown;
}

// ---------- each frame ----------
const pits = {};
let pit = null;
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 20);
camera.up.set(0, 0, 1);
let paintedAt = 0, panelsAt = 0, drawnAt = 0;

// The standby instrument (ISIS): attitude, speed and altitude in one small round-cornered picture.
function isis(c, W, H, st) {
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  c.save(); c.translate(W / 2, H / 2); c.rotate(-(st.phi || 0) * Math.PI / 180);
  const hy = (st.theta || 0) * 4;
  c.fillStyle = '#2f7dd1'; c.fillRect(-W, -2 * H + hy, 2 * W, 2 * H);
  c.fillStyle = '#7a4b22'; c.fillRect(-W, hy, 2 * W, 2 * H);
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-W, hy); c.lineTo(W, hy); c.stroke();
  c.restore();
  c.strokeStyle = '#ffd60a'; c.lineWidth = 6; c.beginPath(); c.moveTo(W * 0.3, H / 2); c.lineTo(W * 0.43, H / 2); c.moveTo(W * 0.57, H / 2); c.lineTo(W * 0.7, H / 2); c.stroke();
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W * 0.22, H); c.fillRect(W * 0.78, 0, W * 0.22, H);
  c.fillStyle = '#e8eef8'; c.font = '600 26px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(Math.round((st.V || 0) / 0.514444)), W * 0.11, H / 2);
  c.font = '600 20px system-ui, sans-serif';
  c.fillText(String(Math.round((st.h || 0) / 0.3048 / 10) * 10), W * 0.89, H / 2);
}
// The information system: a page of the flight's papers (departure, runway, weights, the checklist).
function ois(c, W, H, st, side) {
  c.fillStyle = '#0b1016'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#16202b'; c.fillRect(0, 0, W, H * 0.11);
  c.fillStyle = '#9fc3e6'; c.font = `600 ${Math.round(H * 0.06)}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(side ? 'OIS · FLT OPS' : 'OIS · AVNCS', W * 0.04, H * 0.055);
  const tabs = ['T.O PERF', 'LDG PERF', 'W&B', 'CHARTS', 'CHECKLIST'];
  c.font = `${Math.round(H * 0.045)}px system-ui, sans-serif`;
  tabs.forEach((t, i) => {
    const on = i === (side ? 4 : (st.onGround ? 0 : 1));
    c.fillStyle = on ? '#2b4f74' : '#18222d'; c.fillRect(W * 0.03 + i * W * 0.19, H * 0.14, W * 0.18, H * 0.08);
    c.fillStyle = on ? '#fff' : '#8aa0b6'; c.textAlign = 'center'; c.fillText(t, W * 0.12 + i * W * 0.19, H * 0.18);
  });
  c.textAlign = 'left';
  const rows = side
    ? [['BEFORE START', '✓'], ['BEFORE TAKEOFF', st.onGround ? '…' : '✓'], ['AFTER TAKEOFF', st.onGround ? '' : '✓'], ['APPROACH', ''], ['LANDING', ''], ['PARKING', '']]
    : [['AIRCRAFT', st.name || 'A350'], ['WEIGHT', `${Math.round((st.mass || 0) / 1000)} t`], ['FLAPS', st.flaps || ''], ['V1 / VR / V2', st.vr ? `${st.vr - 4} / ${st.vr} / ${st.vr + 8}` : '—'], ['THR', st.thr || ''], ['ALT', `${Math.round((st.h || 0) / 0.3048)} ft`]];
  c.font = `${Math.round(H * 0.05)}px system-ui, sans-serif`;
  rows.forEach(([k, val], i) => {
    const y = H * (0.31 + i * 0.105);
    c.fillStyle = '#16202b'; c.fillRect(W * 0.03, y - H * 0.045, W * 0.94, H * 0.09);
    c.fillStyle = '#c9d6e2'; c.fillText(k, W * 0.06, y);
    c.fillStyle = val === '✓' ? '#30d158' : '#4fd6ff'; c.textAlign = 'right'; c.fillText(val, W * 0.94, y); c.textAlign = 'left';
  });
}
// The PFD with the FMA above it (the FMGC's), in W × H.
function pfdScreen(c, W, H, P) {
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  const M = FM();
  const h = M ? 48 + 270 : 270, k = Math.min(W / 400, H / h);
  c.save(); c.translate((W - 400 * k) / 2, (H - h * k) / 2); c.scale(k, k);
  if (M) { M.drawFma(c); c.translate(0, 48); }
  c.restore();
  // (the PFD itself through FG.pilot.panel, into the part under the FMA)
  c.save(); c.translate(0, M ? (H - h * k) / 2 + 48 * k : 0); P.panel(c, 'pfd', W, M ? 270 * k : H); c.restore();
}
// The ND: the FMGC's (flight plan, modes, ranges) when it is on, else the plain one.
function ndScreen(c, W, H, P) {
  const M = FM();
  if (!M) { P.panel(c, 'nd', W, H); return; }
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  const k = Math.min(W, H) / 324;
  c.save(); c.translate((W - 324 * k) / 2, (H - 324 * k) / 2); c.scale(k, k); M.drawNd(c); c.restore();
}
// The E/WD: N1 for each engine, the flaps, and the warnings, cautions and memo (src/systems.js) below.
const ECOL = { red: '#ff3b30', amber: '#ffb000', cyan: '#4fd6ff', green: '#30d158', white: '#e8eef8' };
function ewdScreen(c, W, H, P) {
  const s = P.state, sys = SYS();
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle'; c.textAlign = 'center';
  const n = s.n1.length, idle = P.api.idle();
  const r = W * (n > 2 ? 0.085 : 0.13);
  for (let i = 0; i < n; i++) {
    const cx = n > 2 ? W * (0.14 + i * 0.205) : W * (0.25 + i * 0.3), cy = H * 0.19;
    const e = sys && sys.S.eng[i];
    const off = e && !e.run && !e.start;
    c.lineWidth = Math.max(2, W * 0.006); c.strokeStyle = '#6d7480';
    c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.05); c.stroke();
    c.strokeStyle = '#ff3b30'; c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.95, Math.PI * 2.05); c.stroke();
    const f = Math.max(0, Math.min(1, s.n1[i] / 110));
    const a = Math.PI * (0.8 + 1.25 * f);
    c.strokeStyle = off ? '#ffb000' : '#30d158'; c.lineWidth = Math.max(2, W * 0.008);
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.stroke();
    const tl = s.lever < 0 ? idle : idle + (100 - idle) * s.lever, ta = Math.PI * (0.8 + 1.25 * tl / 110);
    c.fillStyle = '#4fd6ff'; c.beginPath(); c.arc(cx + Math.cos(ta) * (r + W * 0.012), cy + Math.sin(ta) * (r + W * 0.012), W * 0.008, 0, 7); c.fill();
    c.font = `600 ${Math.round(W * (n > 2 ? 0.04 : 0.05))}px ui-monospace, monospace`;
    c.fillStyle = off ? '#ffb000' : '#30d158';
    c.fillText(off && s.n1[i] < 2 ? 'XX' : s.n1[i].toFixed(1), cx + r * 0.15, cy + r * 0.55);
    if (e && e.fire) { c.fillStyle = '#ff3b30'; c.font = `700 ${Math.round(W * 0.035)}px system-ui, sans-serif`; c.fillText('FIRE', cx, cy - r * 0.35); }
    if (e && e.start) { c.fillStyle = '#e8eef8'; c.font = `600 ${Math.round(W * 0.03)}px system-ui, sans-serif`; c.fillText('AVAIL', cx, cy - r * 0.35); }
    c.fillStyle = '#e8eef8'; c.font = `${Math.round(W * 0.032)}px system-ui, sans-serif`; c.fillText(String(i + 1), cx, cy + r * 1.15);
  }
  c.fillStyle = '#4fd6ff'; c.font = `600 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
  c.fillText(s.spec.gauge || 'N1 %', W / 2, H * 0.19 + r * 1.15);
  // thrust limit and the flaps
  c.textAlign = 'right'; c.font = `600 ${Math.round(W * 0.04)}px system-ui, sans-serif`;
  c.fillStyle = '#4fd6ff'; c.fillText(P.api.detentName(s.lever), W * 0.97, H * 0.05);
  const conf = P.api.conf();
  c.fillStyle = '#e8eef8'; c.textAlign = 'center'; c.font = `${Math.round(W * 0.032)}px system-ui, sans-serif`;
  c.fillText('FLAP', W * 0.75, H * 0.42);
  c.fillStyle = '#30d158'; c.font = `600 ${Math.round(W * 0.042)}px system-ui, sans-serif`;
  c.fillText(conf.length > 1 ? String(conf[s.conf].name) : '—', W * 0.75, H * 0.48);
  c.fillStyle = '#e8eef8'; c.font = `${Math.round(W * 0.032)}px system-ui, sans-serif`; c.textAlign = 'left';
  c.fillText(`GW ${Math.round(s.mass / 1000)} t`, W * 0.05, H * 0.45);
  // the lower half: warnings and memo
  c.strokeStyle = '#e8eef8'; c.lineWidth = 2; c.beginPath(); c.moveTo(W * 0.03, H * 0.54); c.lineTo(W * 0.97, H * 0.54); c.stroke();
  const lines = sys ? sys.ecamLines() : [];
  const fs = Math.round(H * 0.048);
  c.font = `600 ${fs}px ui-monospace, Consolas, monospace`; c.textAlign = 'left';
  const left = lines.slice(0, 8);
  left.forEach(([t, col], i) => {
    if (!col) return;
    c.fillStyle = ECOL[col] || ECOL.white;
    const y = H * 0.59 + i * fs * 1.12;
    c.fillText(t, W * 0.04, y);
    if (col === 'red' && /FIRE/.test(t)) { c.strokeStyle = ECOL.red; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W * 0.04, y + fs * 0.55); c.lineTo(W * 0.04 + c.measureText(t).width, y + fs * 0.55); c.stroke(); }
  });
}
// The SD: the ENG page when an engine is shut down, on fire or starting; the APU page while the APU runs on the
// ground; else the WHEEL page.
function sdScreen(c, W, H, P) {
  const s = P.state, sys = SYS();
  const engPage = sys && sys.S.eng.some((e) => e.fire || e.start || !e.run);
  const apuPage = sys && !engPage && (sys.S.apu.n > 1 || sys.S.apu.fire);
  if (!engPage && !apuPage) { P.panel(c, 'sd', W, H); return; }
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  c.textBaseline = 'middle'; c.textAlign = 'center';
  const f = Math.round(H * 0.05);
  c.font = `600 ${f}px system-ui, sans-serif`; c.fillStyle = '#e8eef8';
  c.fillText(engPage ? 'ENG' : 'APU', W / 2, H * 0.07);
  c.strokeStyle = '#e8eef8'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W * 0.43, H * 0.1); c.lineTo(W * 0.57, H * 0.1); c.stroke();
  if (engPage) {
    const n = s.n1.length;
    const rows = [['N1 %', (i) => s.n1[i].toFixed(1)], ['N2 %', (i) => (s.n1[i] < 2 ? '0' : Math.min(102, 55 + s.n1[i] * 0.45).toFixed(1))],
      ['FF KG/H', (i) => (sys.S.eng[i].run ? String(Math.round(250 + s.n1[i] * 28)) : '0')], ['OIL PSI', (i) => String(Math.round(Math.min(60, s.n1[i] * 0.7)))]];
    rows.forEach(([name, val], r) => {
      const y = H * (0.24 + r * 0.13);
      c.fillStyle = '#4fd6ff'; c.font = `${Math.round(H * 0.04)}px system-ui, sans-serif`; c.fillText(name, W / 2, y);
      for (let i = 0; i < n; i++) {
        const e = sys.S.eng[i], x = n > 2 ? W * (0.1 + i * 0.27 - (i > 1 ? -0.0 : 0)) : W * (0.2 + i * 0.6);
        c.fillStyle = e.fire ? '#ff3b30' : !e.run && !e.start ? '#ffb000' : '#30d158';
        c.font = `600 ${Math.round(H * 0.05)}px ui-monospace, monospace`; c.fillText(val(i), n > 2 ? (i < 2 ? W * (0.1 + i * 0.16) : W * (0.74 + (i - 2) * 0.16)) : x, y);
      }
    });
    for (let i = 0; i < n; i++) {
      const e = sys.S.eng[i], x = n > 2 ? (i < 2 ? W * (0.1 + i * 0.16) : W * (0.74 + (i - 2) * 0.16)) : W * (0.2 + i * 0.6);
      c.font = `600 ${Math.round(H * 0.04)}px system-ui, sans-serif`;
      c.fillStyle = e.fire ? '#ff3b30' : e.failed ? '#ffb000' : e.start ? '#e8eef8' : !e.run ? '#ffb000' : '#e8eef8';
      c.fillText(`${i + 1} ${e.fire ? 'FIRE' : e.failed ? 'FAIL' : e.start ? 'START' : !e.run ? 'SHUT' : ''}`, x, H * 0.82);
    }
    c.fillStyle = '#e8eef8'; c.font = `${Math.round(H * 0.04)}px system-ui, sans-serif`;
    c.fillText(`ENG MODE ${sys.S.engMode === 'IGN' ? 'IGN START' : sys.S.engMode}`, W / 2, H * 0.92);
  } else {
    const a = sys.S.apu;
    c.font = `${Math.round(H * 0.045)}px system-ui, sans-serif`;
    c.fillStyle = a.avail ? '#30d158' : '#e8eef8'; c.fillText(a.avail ? 'AVAIL' : a.start ? 'STARTING' : '', W / 2, H * 0.2);
    c.fillStyle = '#4fd6ff'; c.fillText('N %', W * 0.3, H * 0.4); c.fillText('EGT °C', W * 0.7, H * 0.4);
    c.fillStyle = '#30d158'; c.font = `600 ${Math.round(H * 0.07)}px ui-monospace, monospace`;
    c.fillText(String(Math.round(a.n)), W * 0.3, H * 0.52); c.fillText(String(Math.round(a.n > 1 ? 300 + a.n * 3.5 : 20)), W * 0.7, H * 0.52);
    c.font = `${Math.round(H * 0.045)}px system-ui, sans-serif`;
    c.fillStyle = a.bleed ? '#30d158' : '#e8eef8'; c.fillText(`APU BLEED ${a.bleed ? 'OPEN' : 'CLOSED'}`, W / 2, H * 0.72);
    if (a.fire) { c.fillStyle = '#ff3b30'; c.fillText('FIRE', W / 2, H * 0.85); }
  }
}

function paintScreens(now, P) {
  if (now - paintedAt < 80) return; // (about 12 times a second)
  paintedAt = now;
  const st = P.state;
  const info = { V: st.V, h: st.h, theta: st.theta, phi: st.phi, onGround: st.onGround, mass: st.mass,
    name: st.spec && st.spec.name, vr: st.spec && st.spec.vr, flaps: '', thr: '' };
  for (const sc of pit.screens) {
    const { ctx: c, cv } = sc;
    const W = cv.width, H = cv.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (sc.kind === 'pfdnd-c' || sc.kind === 'pfdnd-f') {
      // PFD outboard, ND inboard
      const pfdLeft = sc.kind === 'pfdnd-c';
      c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
      c.save(); c.translate(pfdLeft ? 0 : W / 2, 0); pfdScreen(c, W / 2, H, P); c.restore();
      c.save(); c.translate(pfdLeft ? W / 2 : 0, 0); ndScreen(c, W / 2, H, P); c.restore();
      c.fillStyle = '#1a1d21'; c.fillRect(W / 2 - 2, 0, 4, H);
    } else if (sc.kind === 'pfd') pfdScreen(c, W, H, P);
    else if (sc.kind === 'nd') ndScreen(c, W, H, P);
    else if (sc.kind === 'ewd') ewdScreen(c, W, H, P);
    else if (sc.kind === 'sd') sdScreen(c, W, H, P);
    else if (sc.kind === 'isis') isis(c, W, H, info);
    else ois(c, W, H, info, sc.kind === 'ois-f');
    sc.tex.needsUpdate = true;
  }
}

const ease = (a, b, k) => a + (b - a) * k;
// Levers, sticks, the gear lever and the wipers where they are.
function poseControls(st) {
  const L = pit.levers;
  const lev = st.lever ?? 0;
  const ang = lev < 0 ? 0.55 + 0.25 * Math.min(1, -lev) : 0.55 - 1.0 * lev; // (back = idle, forward = TOGA; reverse pulls it back further)
  for (const a of L.thrust) a.rotation.x = ease(a.rotation.x, -ang + 0.25, 0.3);
  L.sb.rotation.x = ease(L.sb.rotation.x, 0.5 - 0.9 * Math.max(st.sb || 0, st.gs || 0), 0.3);
  const confs = Math.max(1, (st.spec && st.spec.conf ? st.spec.conf.length - 1 : 4));
  L.flaps.rotation.x = ease(L.flaps.rotation.x, -0.5 + 1.0 * Math.min(1, (st.conf || 0) / confs), 0.3);
  for (const s of pit.sticks) {
    const pitch = st.stick || 0, roll = st.roll || 0;
    s.grip.rotation.x = ease(s.grip.rotation.x, -0.25 * pitch, 0.4); // (pulled back: nose up)
    s.grip.rotation.y = ease(s.grip.rotation.y, 0.25 * roll, 0.4);
  }
  const gArm = pit.gear.userData.arm;
  gArm.position.y = ease(gArm.position.y, st.gearDown ? -0.06 : 0.06, 0.25);
  const gr = st.gear ?? 1;
  for (const t of pit.gear.userData.tris) t.material.color.set(gr > 0.99 ? 0x1fd15a : gr > 0.01 ? 0xff3b30 : 0x1a1c1f);
  // the wipers sweep in from their foot (about 75°) and back
  const sys = SYS();
  pit.wipers.forEach((w, i) => {
    const ph = sys ? sys.S.wiperPhase[w.userData.side < 0 ? 0 : 1] : 0;
    const on = sys && sys.S.wipers[w.userData.side < 0 ? 0 : 1];
    const a = on ? (1 - Math.cos(ph * Math.PI * 2)) / 2 * 1.3 : ease(w.userData.a || 0, 0, 0.2);
    w.userData.a = a;
    w.quaternion.setFromAxisAngle(w.userData.axis, w.userData.side * a); // (up the glass)
    void i;
  });
}

// ---------- clicking the controls ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let tipEl = null, hooked = false, downAt = null;
const clicks = []; // (the last clicks on controls: FG.cockpit3d.clicks, for the tests)
const shown = () => !!pit && performance.now() - drawnAt < 1500 && !!FG.pilot && FG.pilot.active && FG.pilot.cam === 'cockpit' && has(FG.pilot.type); // (slow machines draw few frames)
function pick(ev) {
  if (!shown() || !FG.view3d || !FG.view3d.map) return null;
  const r = FG.view3d.map.getCanvas().getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pit.clickables, false)[0];
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.click) return { c: u.click, fx: 0, fy: 0 };
  if (u.panel && hit.uv) { const h = u.panel.hit(hit.uv); if (h) h.panel = u.panel; return h; }
  return null;
}
function act(h, opts) {
  if (!h || !h.c.click) return false;
  clicks.push({ tip: typeof h.c.tip === 'function' ? h.c.tip() : h.c.tip, fx: h.fx, fy: h.fy, ...opts });
  if (clicks.length > 20) clicks.shift();
  h.c.click({ fx: h.fx, fy: h.fy, ...opts });
  if (h.panel) h.panel.paint();
  if (FG.view3d && FG.view3d.map) FG.view3d.map.triggerRepaint();
  return true;
}
function tip(ev, h) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.style.cssText = 'position:fixed;z-index:70;pointer-events:none;background:rgba(10,12,16,.85);color:#e8eef8;font:600 11px system-ui,sans-serif;padding:3px 7px;border-radius:4px;border:1px solid #3b4250;max-width:280px';
    document.body.appendChild(tipEl);
  }
  const t = h && h.c && (typeof h.c.tip === 'function' ? h.c.tip() : h.c.tip);
  tipEl.hidden = !t;
  if (t) { tipEl.textContent = t; tipEl.style.left = `${ev.clientX + 14}px`; tipEl.style.top = `${ev.clientY + 16}px`; }
}
function hook() {
  if (hooked || !FG.view3d || !FG.view3d.map) return;
  hooked = true;
  const box = FG.view3d.map.getCanvasContainer();
  box.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; }, true);
  box.addEventListener('click', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    if (act(pick(ev), { button: 0, shift: ev.shiftKey })) ev.stopPropagation();
  }, true);
  box.addEventListener('contextmenu', (ev) => {
    const h = pick(ev);
    if (h && h.c.click) { ev.preventDefault(); ev.stopPropagation(); act(h, { button: 2, shift: ev.shiftKey }); }
  }, true);
  box.addEventListener('dblclick', (ev) => { if (pick(ev)) ev.stopPropagation(); }, true); // (no "look ahead" from a double click on a control)
  box.addEventListener('wheel', (ev) => {
    const h = pick(ev);
    if (!h || !h.c.click) return;
    ev.preventDefault(); ev.stopPropagation();
    act(h, { wheel: ev.deltaY < 0 ? 1 : -1, shift: ev.shiftKey });
  }, { capture: true, passive: false });
  let moveAt = 0;
  box.addEventListener('pointermove', (ev) => {
    const now = performance.now();
    if (now - moveAt < 40) return;
    moveAt = now;
    const h = shown() ? pick(ev) : null;
    box.style.cursor = h && h.c.click ? 'pointer' : '';
    tip(ev, h);
  });
  box.addEventListener('pointerleave', () => { if (tipEl) tipEl.hidden = true; });
}
// Leaving the cockpit camera: the tooltip goes, the FCU window comes back (it is hidden while the 3D FCU is there).
let fcuHidden = false;
setInterval(() => {
  if (shown()) return;
  if (tipEl) tipEl.hidden = true;
  if (fcuHidden) { fcuHidden = false; if (FG.fmgc && FG.fmgc.panels) FG.fmgc.panels(FG.fmgc.on); }
}, 300);

// Draw the cockpit over the world (view3d.js planeLayer, after its own pass). `sunB`: the sun in cockpit space
// (x right, y ahead, z up; null under the horizon), `day` 0 … 1, `fov` the map's vertical field of view (°),
// `look` the head's turn { yaw, pitch } (°).
export function draw(renderer, gl, { sunB, day, fov, look, lookDown }) {
  const P = FG.pilot;
  if (!P || !P.active) return;
  const kind = kindOf(P.type) || 'a350', nEng = (P.state.spec && P.state.spec.engines) || 2;
  const key = `${kind}${nEng}`;
  if (!pits[key]) pits[key] = build(kind, nEng);
  pit = pits[key];
  useDeck(kind);
  hook();
  const now = performance.now();
  drawnAt = now;
  // (the 3D FCU is the one to use here: the FCU window over the view goes while the deck is shown)
  const fcuEl = document.getElementById('fcu');
  if (fcuEl && !fcuEl.hidden && FG.fcu) { fcuHidden = true; FG.fcu.show(false); }
  paintScreens(now, P);
  if (now - panelsAt > 100) { panelsAt = now; for (const p of pit.panels) p.paint(); }
  poseControls(P.state);
  // light: the sky, the sun, and the cockpit's own (dome, flood, the panels' integral lighting: INT LT)
  const sys = SYS();
  const L = sys ? sys.S.lt : null;
  const d = Math.max(0, Math.min(1, day));
  pit.hemi.intensity = 0.25 + 0.8 * d;
  pit.amb.intensity = 0.08 + 0.32 * d;
  if (sunB && d > 0.05) { pit.sun.intensity = 1.8 * d; pit.sun.position.set(sunB[0] * 10 - pit.eyeX, sunB[1] * 10, sunB[2] * 10); pit.sun.target.position.set(-pit.eyeX, 0, 0); }
  else pit.sun.intensity = 0;
  pit.dome.intensity = L ? { OFF: 0, DIM: 1.2, BRT: 3.2 }[L.dome] : 2.5 * (1 - d);
  pit.flood.intensity = L ? 2.2 * L.flood : 0;
  const glow = (0.15 + 0.85 * (1 - d)) * (L ? 0.15 + 0.85 * L.integ : 1);
  for (const m of pit.lit) m.emissive.setScalar(glow * 0.9);
  // camera: the captain's eye, looking a little down the nose, turned with the head
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix();
  camera.position.set(-pit.eyeX, 0, 0);
  const yaw = (look.yaw || 0) * Math.PI / 180, pitch = (-(lookDown || 0) + (look.pitch || 0)) * Math.PI / 180;
  // (the head's own up: looking up past the vertical never turns the picture over)
  camera.up.set(-Math.sin(yaw) * Math.sin(pitch), -Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch));
  camera.lookAt(-pit.eyeX + Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
  camera.updateMatrixWorld();
  renderer.clearDepth();
  renderer.render(pit.scene, camera);
}
// Where the eye sits in the aircraft (the game's view3d.js cockpit camera): metres behind the nose and above the
// wheels, scaled from the A350's by the fuselage's diameter.
export function eye(type) {
  const look = FG.data && FG.data.looks && FG.data.looks[type];
  const k = /^A38/i.test(type || '') ? 1.05 : look && look.dia ? look.dia / 6.1 : 1;
  return { back: 4.6 * k, up: 7.6 * k };
}
// (for debugging and test/systems.mjs: FG.cockpit3d.pit is the deck drawn last, project() a cockpit point → NDC)
FG.cockpit3d = { get pit() { return pit; }, get drawnAt() { return drawnAt; }, clicks, has, draw, eye, project: (p) => new THREE.Vector3(...p).project(camera).toArray(),
  hitAt(x, y) { const h = pick({ clientX: x, clientY: y }); return h ? { tip: typeof h.c.tip === 'function' ? h.c.tip() : h.c.tip || '', shown: shown() } : { tip: null, shown: shown() }; }, get EYE_X() { const k = FG.pilot && kindOf(FG.pilot.type); return (k ? DECKS[k] : DECKS.a350).EYE_X; } }; // (the game's view3d.js draws through this)
