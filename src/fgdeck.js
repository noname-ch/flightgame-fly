// The real A320-family flight deck from FlightGear (github.com/legoboyvdlp/A320-family, GPLv2: Josh Davidson,
// Jonathan Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran), as the Rust app packs it
// (cockpits/A320-family.fgck, made by its `--pack-cockpits` step: lianhirter-arch/flightgame-rust src/fgcockpit.rs,
// src/fgdeck.rs). src/cockpit3d.js draws it for the A320s, A330s and A340s in place of the deck it builds itself.
//
//   - load(url): the pack read: its parts (geometry, texture, colour, own light, the node that moves it), its seven
//     screens (the game's instruments are drawn on them), its textures (blobs), and its deck: the property tree,
//     the JSBSim rules that move its levers and light its buttons, the animations (select, rotate, translate, emit)
//     and its controls (picks: what a click, the wheel or a knob does to the properties).
//   - new Deck(pack): plays it: set() and get() properties, step(dt) runs the rules and poses every node, press()
//     clicks a control; what a click asks of the aircraft lands in `events` (src/cockpit3d.js carries them out).
//
// Pack: "FGCK", version (u32), the description's length (u32) and the description (JSON), the geometry's length
// (u64) and the geometry (raw deflate: for each part, then each screen, its corners: position in mm 3 × i16, normal
// 3 × i8 and a spare byte, texture place in 1/2048 2 × i16, or 2 × f32 where `uv32`; then its triangles 3 × u32),
// the deck's length (u64) and the deck (raw deflate JSON), then the textures one after the other.
// Pack space: the captain's eye at the origin, x right, y ahead, z up (metres).

const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

export async function load(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'FGCK') throw new Error(`${url}: not a flight deck pack`);
  const version = dv.getUint32(4, true);
  if (version < 2 || version > 3) throw new Error(`${url}: pack version ${version}`);
  const ml = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(data.subarray(12, 12 + ml)));
  let at = 12 + ml;
  const gl = Number(dv.getBigUint64(at, true)); at += 8;
  const geo = await inflate(data.subarray(at, at + gl)); at += gl;
  let deck = null;
  if (version >= 3) {
    const dl = Number(dv.getBigUint64(at, true)); at += 8;
    if (dl > 0) deck = JSON.parse(new TextDecoder().decode(await inflate(data.subarray(at, at + dl))));
    at += dl;
  }
  const gv = new DataView(geo.buffer, geo.byteOffset, geo.byteLength);
  let g = 0;
  const batch = (e) => {
    const nv = e.verts, ni = e.idx, uv32 = !!e.uv32, cs = uv32 ? 18 : 14;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++, g += cs) {
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = gv.getInt16(g + k * 2, true) / 1000; nor[i * 3 + k] = gv.getInt8(g + 6 + k) / 127; }
      if (uv32) { uv[i * 2] = gv.getFloat32(g + 10, true); uv[i * 2 + 1] = gv.getFloat32(g + 14, true); }
      else { uv[i * 2] = gv.getInt16(g + 10, true) / 2048; uv[i * 2 + 1] = gv.getInt16(g + 12, true) / 2048; }
    }
    const idx = new Uint32Array(ni);
    for (let i = 0; i < ni; i++, g += 4) idx[i] = gv.getUint32(g, true);
    return { pos, nor, uv, idx };
  };
  const parts = meta.parts.map((e) => ({ tex: e.tex || null, rgb: e.rgb || [1, 1, 1], emis: e.emis || 0, node: e.node || 0, ...batch(e) }));
  const screens = meta.screens.map((e) => ({ screen: e.screen, n: e.n || 0, ...batch(e) }));
  const textures = new Map();
  for (const t of meta.textures) {
    const bytes = data.subarray(at, at + t.len); at += t.len;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    textures.set(t.key, new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }));
  }
  return { dir: meta.dir, source: meta.source, behind: meta.behind, parts, screens, textures, deck };
}

// ---------- the deck's values: serde's JSON of src/fgdeck.rs (V, Cond, Fx, Rule, Value, Anim, Cmd) ----------
const num = (x, inf = Infinity) => (x == null ? inf : x); // (serde writes a non-finite number as null)
const val = (v, x) => (typeof x === 'object' && x !== null ? ('P' in x ? v[x.P] || 0 : num(x.N, 0)) : 0);
function test(c, v) {
  if (c === 'T') return true;
  if (c === 'F') return false;
  if ('P' in c) return (v[c.P] || 0) !== 0;
  if ('Not' in c) return !test(c.Not, v);
  if ('And' in c) return c.And.every((x) => test(x, v));
  if ('Or' in c) return c.Or.some((x) => test(x, v));
  if ('Cmp' in c) {
    const [op, A, B] = c.Cmp, a = val(v, A), b = val(v, B);
    return op === 0 ? Math.abs(a - b) < 1e-9 : op === 1 ? Math.abs(a - b) >= 1e-9 : op === 2 ? a < b : op === 3 ? a <= b : op === 4 ? a > b : a >= b;
  }
  return false;
}
function fx(f, v) {
  if ('V' in f) return val(v, f.V);
  if ('Sum' in f) return f.Sum.reduce((a, x) => a + fx(x, v), 0);
  if ('Diff' in f) { const l = f.Diff.map((x) => fx(x, v)); return l.length ? l.slice(1).reduce((a, b) => a - b, l[0]) : 0; }
  if ('Prod' in f) return f.Prod.reduce((a, x) => a * fx(x, v), 1);
  if ('Quot' in f) { const d = fx(f.Quot[1], v); return d === 0 ? 0 : fx(f.Quot[0], v) / d; }
  if ('Abs' in f) return Math.abs(fx(f.Abs, v));
  if ('Min' in f) return Math.min(...f.Min.map((x) => fx(x, v)));
  if ('Max' in f) return Math.max(...f.Max.map((x) => fx(x, v)));
  return 0;
}
// one rule over dt seconds (Infinity: settled)
function apply(r, v, dt) {
  const fin = Number.isFinite(dt);
  if (r.Lag) {
    const { out, inp, c1 } = r.Lag, target = fx(inp, v), now = v[out] || 0;
    let x = now + (target - now) * (fin ? 1 - Math.exp(-num(c1) * dt) : 1);
    if (Math.abs(x - target) < 1e-6) x = target;
    v[out] = x;
  } else if (r.Act) {
    const { out, inp } = r.Act, rate = num(r.Act.rate), lag = num(r.Act.lag, 0), target = fx(inp, v), now = v[out] || 0;
    let x = lag > 0 && fin ? now + (target - now) * (1 - Math.exp(-lag * dt)) : target;
    if (fin && Number.isFinite(rate)) x = now + Math.max(-rate * dt, Math.min(rate * dt, x - now));
    if (Math.abs(x - target) < 1e-6) x = target;
    v[out] = x;
  } else if (r.Fn) v[r.Fn.out] = fx(r.Fn.f, v);
  else if (r.Switch) {
    const { out, def, tests } = r.Switch;
    const hit = tests.find(([c]) => test(c, v));
    const x = hit ? val(v, hit[1]) : val(v, def);
    for (const o of out) v[o] = x;
  }
}
function value(a, v) {
  const x = a.prop != null ? v[a.prop] || 0 : 0;
  let y;
  const t = a.interp || [];
  if (!t.length) y = x * a.factor + a.offset;
  else if (x <= t[0][0]) y = t[0][1];
  else if (x >= t[t.length - 1][0]) y = t[t.length - 1][1];
  else {
    let k = 0;
    while (k < t.length - 2 && x >= t[k + 1][0]) k++;
    const [a0, b0] = t[k], [a1, b1] = t[k + 1];
    y = b0 + (b1 - b0) * (x - a0) / Math.max(1e-12, a1 - a0);
  }
  if (a.min != null) y = Math.max(y, a.min);
  if (a.max != null) y = Math.min(y, a.max);
  return y;
}
// (FlightGear's rotations turn clockwise looking along the axis)
const ROT_SIGN = -1;
// A 4×4 column-major matrix (as three.js's Matrix4.elements) for a rotation or translation (pack space).
function animMat(a, v) {
  if (a.Rotate) {
    const ang = value(a.Rotate.v, v);
    if (ang === 0) return null;
    const [cx, cy, cz] = a.Rotate.c;
    let [x, y, z] = a.Rotate.d;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    const t = ROT_SIGN * ang * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    // R, then the translation c - R c
    const r = [k * x * x + c, k * x * y + s * z, k * x * z - s * y, k * x * y - s * z, k * y * y + c, k * y * z + s * x, k * x * z + s * y, k * y * z - s * x, k * z * z + c];
    const tx = cx - (r[0] * cx + r[3] * cy + r[6] * cz), ty = cy - (r[1] * cx + r[4] * cy + r[7] * cz), tz = cz - (r[2] * cx + r[5] * cy + r[8] * cz);
    return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, tx, ty, tz, 1];
  }
  if (a.Translate) {
    const d = a.Translate.d, s = value(a.Translate.v, v);
    if (s === 0) return null;
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0] * s, d[1] * s, d[2] * s, 1];
  }
  return null;
}
function mul(a, b) { // a × b, column-major
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

// The properties whose clicks go to the aircraft's systems (an event 'prop').
const SYS_PROPS = ['controls/switches/', 'controls/lighting/', 'controls/electrical/', 'controls/hydraulic/', 'controls/fuel/', 'controls/pneumatics/',
  'controls/ice-protection/', 'controls/navigation/', 'controls/oxygen/', 'controls/engines/engine', 'controls/apu/', 'controls/ignition/',
  'controls/atc/', 'controls/cockpit/', 'instrumentation/mk-viii/inputs/discretes/', 'instrumentation/efis'];
export const norm = (p) => String(p).trim().replace(/^\/+/, '').replace(/\[0\]/g, '');

// ---------- a deck being played ----------
export class Deck {
  constructor(pack) {
    const def = pack.deck;
    this.def = def;
    this.v = Float64Array.from(def.init);
    this.index = new Map(def.names.map((n, i) => [n, i]));
    this.events = [];
    this.ups = []; // [seconds, bindings]: what is let go after a click
    this.slides = []; // [property, target, units a second] (FlightGear's interpolate)
    this.poses = def.nodes.map(() => ({ m: null, vis: true, emit: null }));
    this.ran = 0; // (bindings run: press() tells whether a click did anything)
    this.gen = 0;
    this.step(Infinity);
  }
  at(name) { return this.index.get(norm(name)); }
  get(name) { const i = this.at(name); return i == null ? 0 : this.v[i]; }
  set(name, x) { const i = this.at(name); if (i != null) this.v[i] = x; }
  slide(name, to, secs) {
    const p = this.at(name);
    if (p == null) return;
    this.slides = this.slides.filter((s) => s[0] !== p);
    this.slides.push([p, to, Math.abs(to - this.v[p]) / Math.max(1e-3, secs)]);
  }
  // dt seconds: what is let go let go, the rules stepped, every node posed (`gen` bumps when a pose changed)
  step(dt) {
    const def = this.def, v = this.v;
    if (Number.isFinite(dt)) {
      const due = [];
      this.ups = this.ups.filter((u) => { u[0] -= dt; if (u[0] <= 0) { due.push(u[1]); return false; } return true; });
      for (const b of due) this.run(b, 1);
      this.slides = this.slides.filter(([p, to, rate]) => { v[p] += Math.max(-rate * dt, Math.min(rate * dt, to - v[p])); return v[p] !== to; });
    }
    for (let n = Number.isFinite(dt) ? 1 : 4; n > 0; n--) for (const r of def.rules) apply(r, v, dt);
    let changed = false;
    def.nodes.forEach((nd, i) => {
      let m = null, vis = true, emit = null;
      for (const ai of nd.anims) {
        const a = def.anims[ai];
        if (a.Select) vis = vis && test(a.Select, v);
        else if (a.Emit) {
          if (test(a.Emit.cond, v)) { const k = a.Emit.factor != null ? v[a.Emit.factor] || 0 : 1; emit = a.Emit.rgb.map((c) => c * k); }
        } else {
          const am = animMat(a, v);
          if (am) m = m ? mul(m, am) : am;
        }
      }
      const p = this.poses[i];
      const same = p.vis === vis && String(p.m) === String(m) && String(p.emit) === String(emit);
      if (!same) { this.poses[i] = { m, vis, emit }; changed = true; }
    });
    if (changed) this.gen++;
  }
  // A click on a control (button: 0 left, 1 middle, 2 right, 3 wheel up, 4 wheel down): whether it did anything
  // (a binding whose condition held).
  press(picks, button) {
    const def = this.def, ran0 = this.ran;
    for (const k of picks) {
      const pk = def.picks[k];
      if (!pk) continue;
      if (pk.knob) {
        // (left click or the wheel up: increase; middle or right click, the wheel down: decrease)
        const up = button === 0 || button === 3;
        const own = up ? pk.inc : pk.dec;
        if (own.length) this.run(own, 1);
        for (const a of pk.actions) { this.run(a.does, up ? 1 : -1); if (a.up.length) this.ups.push([0.15, a.up]); }
        if (pk.release.length) this.ups.push([0.15, pk.release]);
      } else {
        // (the action for that button (right counts as middle: FlightGear's right button looks round), else for a
        // left click the first action without buttons)
        const b = button === 2 ? 1 : button;
        const a = pk.actions.find((x) => x.buttons.includes(b)) || (b === 0 ? pk.actions.find((x) => !x.buttons.length) : null);
        if (a) { this.run(a.does, 1); if (a.up.length) this.ups.push([0.15, a.up]); }
      }
    }
    this.step(0);
    return this.ran > ran0;
  }
  label(picks) { for (const k of picks) { const p = this.def.picks[k]; if (p && p.label) return p.label; } return ''; }
  // bindings run (`dir`: a knob's direction)
  run(bs, dir) {
    const v = this.v;
    for (const b of bs) {
      if (!test(b.cond, v)) continue;
      this.ran++;
      const c = b.cmd;
      if (c.Assign) this.put(c.Assign[0], val(v, c.Assign[1]));
      else if (c.Toggle != null) this.put(c.Toggle, v[c.Toggle] ? 0 : 1);
      else if (c.Adjust) {
        const { p, step, factor, min, max, wrap } = c.Adjust;
        let x = v[p] + (step != null ? step : factor * dir);
        if (wrap && min != null && max != null && max > min) x = min + ((((x - min) % (max - min)) + (max - min)) % (max - min));
        else { if (min != null) x = Math.max(x, min); if (max != null) x = Math.min(x, max); }
        this.put(p, x);
      } else if (c.Cycle) {
        const { p, vals, wrap } = c.Cycle;
        if (!vals.length) continue;
        const k = vals.findIndex((x) => Math.abs(x - v[p]) < 1e-9), n = vals.length;
        let j = k < 0 ? 0 : k + (dir < 0 ? -1 : 1);
        j = wrap ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j));
        this.put(p, vals[j]);
      } else if (c.Call) this.call(c.Call[0], c.Call[1] || []);
    }
  }
  // a property set by a click, the aircraft told where it is one of its controls
  put(p, x) {
    const name = this.def.names[p], was = this.v[p];
    this.v[p] = x;
    if (x === was) return;
    if (name === 'controls/gear/brake-parking') { if (!!x !== !!was) this.events.push({ e: 'parking', on: !!x }); }
    else if (name === 'controls/flight/speedbrake-arm') { if (!!x !== !!was) this.events.push({ e: 'armed', on: !!x }); }
    else if (name === 'controls/flight/speedbrake') this.events.push({ e: 'speedbrake', x });
    else if (name === 'controls/engines/engine/throttle' || name === 'controls/engines/engine[1]/throttle') this.events.push({ e: 'thrust', dx: x - was });
    else if (SYS_PROPS.some((s) => name.startsWith(s))) this.events.push({ e: 'prop', name, x, was });
  }
  // FlightGear's Nasal calls the deck knows (none of its scripts run)
  call(name, args) {
    const n = (k) => { const x = parseFloat(args[k]); return Number.isFinite(x) ? x : 0; };
    const step = (a) => { const s = String(a || '').replace(/ /g, ''); return s.endsWith('+1') ? 1 : s.endsWith('-1') ? -1 : parseFloat(s) || 0; };
    const short = name.split('.').pop();
    const KNOB = { SPD: 'spd', HDG: 'hdg', ALT: 'alt', VS: 'vs' };
    let m;
    if ((m = short.match(/^(SPD|HDG|ALT|VS)Adjust$/))) {
      const d = n(0), k = KNOB[m[1]];
      const big = Math.abs(d) >= 10 || (k === 'alt' && Math.abs(d) === 1 && this.get('it-autoflight/config/altitude-dial-mode') !== 0);
      this.events.push({ e: 'fcu', knob: k, steps: Math.sign(d), big });
      return;
    }
    if ((m = short.match(/^(SPD|HDG|ALT|VS)(Push|Pull)$/))) {
      const k = KNOB[m[1]], push = m[2] === 'Push';
      if (k === 'spd') this.set('it-autoflight/input/spd-managed', push ? 1 : 0);
      this.events.push({ e: push ? 'fcuPush' : 'fcuPull', knob: k });
      return;
    }
    const toggle = (p) => { const on = this.get(p) === 0; this.set(p, on ? 1 : 0); return on; };
    switch (name) {
      case 'controls.gearDownSmart': if (n(0) !== 0) this.events.push({ e: 'gear' }); break;
      case 'controls.flapsDown': this.events.push({ e: 'flaps', up: n(0) < 0 }); break;
      case 'fcu.FCUController.ATHR': this.events.push({ e: 'athr' }); break;
      case 'fcu.FCUController.ATDisc': this.events.push({ e: 'athrOff' }); break;
      case 'fcu.FCUController.AP1': this.events.push({ e: 'ap', n: 1, on: toggle('it-autoflight/output/ap1') }); break;
      case 'fcu.FCUController.AP2': this.events.push({ e: 'ap', n: 2, on: toggle('it-autoflight/output/ap2') }); break;
      case 'fcu.FCUController.APDisc':
        if (this.get('it-autoflight/output/ap1') || this.get('it-autoflight/output/ap2')) {
          this.set('it-autoflight/output/ap1', 0); this.set('it-autoflight/output/ap2', 0);
          this.events.push({ e: 'ap', n: 0, on: false });
        }
        break;
      case 'fcu.FCUController.FD1': case 'fcu.FCUController.FD2': this.events.push({ e: 'press', btn: 'FD' }); break;
      case 'fcu.FCUController.LOC': this.events.push({ e: 'press', btn: 'LOC' }); break;
      case 'fcu.FCUController.APPR': this.events.push({ e: 'press', btn: 'APPR' }); break;
      // (the RANGE knobs: fcu.setNDRange(side, ±1), the captain's 0, the first officer's 1; left of 10 NM: ZOOM)
      case 'fcu.setNDRange': this.events.push({ e: 'press', btn: `${n(0) ? 'ND2 ' : ''}RNG${n(1) > 0 ? '+' : '-'}` }); break;
      // (the ND's MODE knob: FlightGear's numbers 0 ROSE ILS, 1 ROSE VOR, 2 ROSE NAV, 3 ARC, 4 PLAN, one a click)
      case 'fcu.setCptND': case 'fcu.setFoND': {
        const p = name.endsWith('CptND') ? 'instrumentation/efis/mfd/pnl_mode-num' : 'instrumentation/efis[1]/mfd/pnl_mode-num';
        const was = this.get(p), x = Math.max(0, Math.min(4, was + Math.sign(n(0))));
        this.set(p, x);
        if (x !== was) this.events.push({ e: 'prop', name: p, x, was });
        break;
      }
      case 'systems.doRevThrust': this.events.push({ e: 'reverse', on: true }); break;
      case 'systems.unRevThrust': this.events.push({ e: 'reverse', on: false }); break;
      case 'core.deploySpeedbrake': this.events.push({ e: 'speedbrake', x: Math.min(1, this.get('controls/flight/speedbrake') + 0.5) }); break;
      case 'core.retractSpeedbrake': this.events.push({ e: 'speedbrake', x: Math.max(0, this.get('controls/flight/speedbrake') - 0.5) }); break;
      case 'ecam.ECAMControlPanel.sysPageBtn': case 'ecam.ECAMControlPanel.stsBtn': {
        const PAGES = { apuPage: 'APU', bleedPage: 'BLEED', condPage: 'COND', doorPage: 'DOOR', elecPage: 'ELEC', enginePage: 'ENG', fctlPage: 'F/CTL', fuelPage: 'FUEL', hydraulicPage: 'HYD', cabPressPage: 'PRESS', wheelPage: 'WHEEL' };
        const key = name.endsWith('stsBtn') ? 'STS' : PAGES[args[0]];
        if (key) this.events.push({ e: 'prop', name: 'ecp', key });
        break;
      }
      case 'systems.Autobrake.arm_autobrake': this.events.push({ e: 'press', btn: ['', 'BRK LO', 'BRK MED', 'BRK MAX'][Math.round(n(0))] || '' }); break;
      case 'systems.ADIRSControlPanel.adrSw': case 'systems.ADIRSControlPanel.irSw': {
        const k = Math.min(2, Math.round(n(0)));
        const p = `controls/navigation/adirscp/lights/${name.endsWith('adrSw') ? 'adr' : 'ir'}-${k + 1}-off`;
        const i = this.at(p);
        if (i != null) this.put(i, 1 - this.v[i]);
        break;
      }
      case 'systems.ADIRSControlPanel.irModeSw': {
        const p = `controls/navigation/adirscp/switches/ir-${Math.min(2, Math.round(n(0))) + 1}-mode`, i = this.at(p);
        if (i != null) this.put(i, Math.max(0, Math.min(2, this.v[i] + step(args[1]))));
        break;
      }
      case 'systems.SwitchingPanel.doAirData': case 'systems.SwitchingPanel.doAttHdg': {
        const i = this.at(name.endsWith('doAirData') ? 'controls/navigation/switching/air-data' : 'controls/navigation/switching/att-hdg');
        if (i != null) this.put(i, Math.max(-1, Math.min(1, this.v[i] + step(args[0]))));
        break;
      }
      case 'core.lTray': case 'core.rTray': {
        const p = name === 'core.lTray' ? 'controls/tray/lefttrayext' : 'controls/tray/righttrayext', now = this.get(p);
        if (now < 0.5) this.slide(p, 0.5, 0.5); else if (now === 0.5) this.slide(p, 1, 0.5); else this.slide(p, 0, 1);
        break;
      }
      case 'core.lFootrest': case 'core.rFootrest': {
        const p = name === 'core.lFootrest' ? 'controls/footrest-cpt' : 'controls/footrest-fo';
        this.slide(p, this.get(p) < 1 ? 1 : 0, 1);
        break;
      }
      case 'core.slewPitchWheel': this.events.push({ e: 'trim', d: Math.sign(n(0)) }); break;
      case 'core.increaseManVS': case 'core.decreaseManVS': {
        const p = 'systems/pressurization/outflowpos-man';
        this.set(p, Math.max(0, Math.min(1, this.get(p) + (name.endsWith('increaseManVS') ? 0.05 : -0.05))));
        break;
      }
      default:
    }
  }
}
