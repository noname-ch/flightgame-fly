// The Airbus flight decks round the cockpit camera when you fly it yourself (src/pilot.js, camera C):
//   - 'a350' (A350s, A380): six windows in dark frames, the black glareshield with the FCU and the EFIS panels, six
//     big landscape screens (information system outboard, PFD + ND in front of each pilot, the engine and warning
//     display in the middle, the systems display below it), the pedestal with the keyboards (KCCU);
//   - the A320s, A330s and A340s: FlightGear's real A320-family flight deck (cockpits/A320-family.fgck, played by
//     src/fgdeck.js: buildFg, fgSync, fgLight below), once its pack has come; until then, or with ?built, these:
//   - 'a320' (A320): a narrower deck with the A320 family's six square screens (PFD, ND, the E/WD over the SD in the
//     middle, ND, PFD), the standby instrument, the gear lever and the autobrake beside them, the two MCDUs at the
//     front of the pedestal;
//   - the A330s and A340s: the same deck in their wider nose, each version as it was built (src/panels.js deckOf):
//     'a330' (A330-200, -300) LCD screens and the ISIS; 'a330neo' (A330-900) the same with the trackball and the
//     airport map (OANS) on the NDs; 'a340' (A340-300) CRT screens and the three round standby instruments; 'a346'
//     (A340-600) LCDs, the ISIS and the TAXI CAMERA's picture on the SD. Their overhead HYD and FUEL panels are
//     their own (no PTU; the trim tank; the A340's four feed tanks and cross-feed valves).
// Their panels are modules laid out per deck (src/panels.js LAYOUTS: move a module, or give another deck one, there),
// all working: click them in 3D (src/systems.js, src/aircraft.js and src/radio.js do what they switch; FG.fmgc what
// the FCU's knobs and buttons ask). The screens go dark without power, show a failed IR's flags and dim with
// their brightness knobs.
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

// (the panels' modules and layouts, then the systems: lights, fire, APU, engines; then the aircraft's other systems
// and the radios, which plug into them; all with this file's own version, so a browser never mixes old and new)
const V = new URL(import.meta.url).search;
const { canvas, texture, panelArt, tools, LIT, annTest, annDim, surface, deckOf } = await import(`./panels.js${V}`);
import(`./systems.js${V}`).then(() => Promise.all([import(`./aircraft.js${V}`), import(`./radio.js${V}`)])).catch((e) => console.warn('systems', e));

// ---------- the decks' sizes ----------
const DECKS = {
  a350: { HALF: 1.36, ROOF: 0.50, REAR: -1.75, FLOOR: -1.32, EYE_X: 0.53, wsY: 1.15, wsK: 0.294, wsZ: 0.767, scr: 1.19 },
  a320: { HALF: 1.12, ROOF: 0.46, REAR: -1.50, FLOOR: -1.25, EYE_X: 0.50, wsY: 0.98, wsK: 0.33, wsZ: 0.80, scr: 0.98, six: true },
};
// (the A330's and A340's: the A320's panels in a wider, roomier nose; six: the A320 family's six square screens)
const WIDE = { ...DECKS.a320, HALF: 1.24, ROOF: 0.50, REAR: -1.70, EYE_X: 0.53, wsK: 0.30, scr: 1.04 };
DECKS.a330 = { ...WIDE };
DECKS.a330neo = { ...WIDE, oans: true };
DECKS.a340 = { ...WIDE, crt: true, stby3: true };
DECKS.a346 = { ...WIDE, taxiCam: true };
const kindOf = deckOf; // (which deck a type flies with: src/panels.js)
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

// (the panels: modules laid out per deck, src/panels.js)
// The main panel's face round the screens (the modules on it: src/panels.js LAYOUTS[kind].main).
function mainFace(kind) {
  return (T, b, g, W, H) => {
    const six = DECKS[kind] && DECKS[kind].six;
    for (const cx of six ? [200, 824] : [W * 0.27, W * 0.73]) {
      b.fillStyle = '#2f3339'; for (let i = 0; i < 9; i++) b.fillRect(cx - 30 + i * 7, six ? 220 : H * 0.84, 3, 22);
    }
  };
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
  const a320 = !!D.six; // (the A320 family's six square screens: the A320, A330, A340)
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
    const gp = surface('glareshield', kind, nEng);
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
  const mainP = surface('main', kind, nEng, mainFace(kind));
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
    screens.push({ kind: kindS, cv, ctx: cv.getContext('2d'), tex, side: u < 0 ? 0 : 1 });
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
  // the standby instrument (the ISIS, or the A340-300's three round ones: the horizon over the airspeed and the
  // altimeter) and the gear lever
  if (D.stby3) {
    const at = new THREE.Vector3(...panelAt(isisAt[0], isisAt[1] + 0.02)), nrm = panelFaceNormal(0);
    const g = new THREE.Group(); g.up.set(0, 0, 1); g.position.copy(at).addScaledVector(nrm, 0.01); g.lookAt(at.clone().addScaledVector(nrm, 1));
    g.add(box(0.13, 0.13, 0.02, M.bezel, 0, 0, 0));
    const cv = canvas(320, 320), tex = texture(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0105; g.add(face);
    root.add(g);
    screens.push({ kind: 'stby3', cv, ctx: cv.getContext('2d'), tex });
  } else {
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
    const pp = surface('pedestal', kind, nEng);
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
    for (const dx of [-0.09, 0.09]) root.add(box(0.07, 0.03, 0.14, M.knob, s * EYE_X + dx, P.y - 0.2, -1.05, [-0.5, 0, 0]));
  }

  // the overhead panel, under the ceiling from behind the windscreens back over the pilots' heads
  {
    const op = surface('overhead', kind, nEng);
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

// ---------- the real A320-family flight deck (FlightGear's, src/fgdeck.js) ----------
// The A320s, A330s and A340s fly with it once its pack has come (cockpits/A320-family.fgck); the deck built above
// stands in until then, or if it can't be read. Each version keeps what it has on its screens (the A340-300's CRT
// look and round standby instruments, the A340-600's taxi camera on the SD, the A330neo's airport map on the NDs);
// their own overhead panels are on the overhead page (0).
const FG_PACK = new URL('../cockpits/A320-family.fgck', import.meta.url).href;
const fg = { pack: null, loading: null, failed: false, Deck: null };
const fgKind = (kind) => ['a320', 'a330', 'a330neo', 'a340', 'a346'].includes(kind) && !fg.failed && !/[?&]built\b/.test(location.search);
function fgLoad() {
  if (fg.loading) return;
  fg.loading = import(`./fgdeck.js${V}`).then(async (m) => { fg.Deck = m.Deck; fg.pack = await m.load(FG_PACK); })
    .then(() => { for (const k of Object.keys(pits)) if (fgKind(pits[k].kind) && !pits[k].fg) delete pits[k]; if (FG.view3d && FG.view3d.map) FG.view3d.map.triggerRepaint(); })
    .catch((e) => { fg.failed = true; console.warn('the A320 family\'s flight deck (FlightGear) did not load:', e); });
}
// how bright a lamp the model lights (its emission colour × this)
const LAMP = 1.6;
function buildFg(kind, nEng) {
  const pack = fg.pack;
  // (pack space: the captain's eye at the origin; the middle of the deck halfway between the two PFDs)
  const mid = (sc) => { let x = 0; for (let i = 0; i < sc.pos.length; i += 3) x += sc.pos[i]; return x / (sc.pos.length / 3); };
  const pfds = pack.screens.filter((s) => s.screen === 'pfd');
  const cx = pfds.length === 2 ? (mid(pfds[0]) + mid(pfds[1])) / 2 : 0.5;
  D = { ...DECKS[kind], EYE_X: cx };
  ({ HALF, ROOF, REAR, FLOOR } = D); EYE_X = D.EYE_X;
  const root = new THREE.Group();
  root.position.set(-cx, 0, 0);
  const deck = pack.deck ? new fg.Deck(pack) : null;
  const def = deck && deck.def;
  // the textures (sRGB pictures, repeated)
  const texs = new Map();
  const texOf = (key) => {
    if (!key || !pack.textures.has(key)) return null;
    if (texs.has(key)) return texs.get(key);
    const img = new Image();
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.flipY = false; // (the pack's texture places count from the top)
    img.onload = () => { t.needsUpdate = true; if (FG.view3d && FG.view3d.map) FG.view3d.map.triggerRepaint(); };
    img.src = URL.createObjectURL(pack.textures.get(key));
    t.userData.png = pack.textures.get(key).type === 'image/png';
    texs.set(key, t);
    return t;
  };
  const geoOf = (b, uv) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv || b.uv, 2));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    g.computeBoundingSphere();
    return g;
  };
  // the nodes that move, light up or are clicked: a group each, posed from the deck
  const nodes = new Map();
  const nodeOf = (n) => {
    if (!n || !def || !def.nodes[n]) return root;
    if (!nodes.has(n)) { const g = new THREE.Group(); g.matrixAutoUpdate = false; root.add(g); nodes.set(n, g); }
    return nodes.get(n);
  };
  const litBy = (n) => !!(def && def.nodes[n] && def.nodes[n].anims.some((a) => def.anims[a].Emit));
  // materials: the parts with the same texture and colour share one, a part an animation lights has its own
  const shared = new Map(), mats = [];
  const clickables = [];
  for (const b of pack.parts) {
    const lamp = !!(def && def.nodes[b.node] && def.nodes[b.node].lamp), lit = litBy(b.node) ? b.node : 0;
    const key = `${b.tex}|${b.rgb}|${b.emis}|${lamp}`;
    let m = lit ? null : shared.get(key);
    if (!m) {
      const map = texOf(b.tex);
      m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x000000, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide, alphaTest: map && map.userData.png ? 0.5 : 0 });
      m.color.setRGB(b.rgb[0], b.rgb[1], b.rgb[2], THREE.SRGBColorSpace);
      const lin = b.rgb.map((c) => Math.pow(c, 2.2));
      // (a lamp of the model's own glows in its colour; a lamp an animation shows glows while shown)
      const own = b.emis > 0 ? lin.map((c) => c * b.emis * LAMP) : lamp ? lin.map((c) => c * LAMP * 0.6) : [0, 0, 0];
      mats.push({ m, own, node: lit, last: '' });
      if (!lit) shared.set(key, m);
    }
    const mesh = new THREE.Mesh(geoOf(b), m);
    nodeOf(b.node).add(mesh);
    if (def && b.node && def.nodes[b.node] && def.nodes[b.node].picks.length) { mesh.userData.fgNode = b.node; clickables.push(mesh); }
  }
  // the screens: each a canvas the instruments are drawn on (the A340-300's standby: its three round instruments)
  const screens = [];
  for (const s of pack.screens) {
    const kindS = s.screen === 'pfd' ? 'pfd' : s.screen === 'nd' ? 'nd' : s.screen === 'engines' ? 'ewd' : s.screen === 'systems' ? 'sd' : D.stby3 ? 'stby3' : 'isis';
    const px = kindS === 'isis' ? 256 : kindS === 'stby3' ? 320 : 640;
    const cv = canvas(px, px), tex = texture(cv);
    const uv = new Float32Array(s.uv.length);
    for (let i = 0; i < s.uv.length; i += 2) { uv[i] = Math.min(1, Math.max(0, s.uv[i])); uv[i + 1] = 1 - Math.min(1, Math.max(0, s.uv[i + 1])); }
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    root.add(new THREE.Mesh(geoOf(s, uv), mat));
    screens.push({ kind: kindS, cv, ctx: cv.getContext('2d'), tex, side: s.n ? 1 : 0 });
  }
  // lights: the sky through the windows, the sun, the dome light and the flood light under the glareshield
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3a3630, 1.2);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  const dome = new THREE.PointLight(0xffe2b8, 0, 4, 1); dome.position.set(0, -0.3, 0.35);
  const flood = new THREE.PointLight(0xfff0d8, 0, 1.8, 1.2);
  { const s = pack.screens.find((x) => x.screen === 'engines'); let y = 0.7, z = -0.2; if (s) { y = 0; z = 0; for (let i = 0; i < s.pos.length; i += 3) { y += s.pos[i + 1]; z += s.pos[i + 2]; } y /= s.pos.length / 3; z /= s.pos.length / 3; } flood.position.set(0, y - 0.3, z + 0.12); }
  const scene = new THREE.Scene();
  scene.add(root, hemi, sun, sun.target, amb, dome, flood);
  return { kind, nEng, eyeX: cx, D, scene, screens, lit: [], panels: [], clickables, hemi, sun, amb, dome, flood, fg: { deck, nodes, mats, gen: -1, glow: -1 } };
}
// The FlightGear flight deck's switches from the systems, and its clicks to them: FlightGear's A320 properties
// (switches 0 / 0.5 / 1 from the bottom up; momentary buttons a pulse on their *-translate).
function fgProp(name, x, was) {
  const y = SYS(), P = P_();
  if (!y || !P) return;
  const S = y.S, on = x > 0.25, pulse = x !== 0 && was === 0, b = (v) => (v ? 1 : 0);
  const tri = (a, m, c) => (x < 0.25 ? a : x < 0.75 ? m : c);
  const eng = /engine\[(\d)\]/.test(name) ? +name.match(/engine\[(\d)\]/)[1] : 0;
  const set = (w, v, i) => y.set(w, v, i);
  const wide = S.hyd && S.hyd.plan;
  // (the A320 overhead's pumps on a widebody: its engine pumps per system, its electric pumps)
  const edp = (k) => { for (const key of Object.keys(S.hyd.edp)) if (key[0] === k && !!S.hyd.edp[key] !== on) set('edp', key); };
  const elecP = (k) => { if (!!S.hyd.elecP[k] !== on) set('elecPump', k); };
  switch (name) {
    case 'controls/switches/strobe': return set('strobe', tri('OFF', 'AUTO', 'ON'));
    case 'controls/switches/beacon': return set('beacon', b(on));
    case 'controls/switches/wing-lights': return set('wing', b(on));
    case 'controls/lighting/nav-lights-switch': return set('nav', b(on));
    case 'controls/lighting/turnoff-light-switch': return set('rwy', b(on));
    case 'controls/switches/landing-lights-l': case 'controls/switches/landing-lights-r': return set('land', tri('RETRACT', 'OFF', 'ON'));
    case 'controls/lighting/taxi-light-switch': return set('nose', tri('OFF', 'TAXI', 'TO'));
    case 'controls/switches/seatbelt-sign': return set('belts', b(on));
    case 'controls/switches/no-smoking-sign': return set('smoke', b(on));
    case 'controls/switches/emer-lights': return set('emerExit', tri('OFF', 'ARM', 'ON'));
    case 'controls/lighting/dome-norm': return set('dome', tri('OFF', 'DIM', 'BRT'));
    case 'controls/switches/annun-test': return set('ann', on ? 'TEST' : 'BRT');
    case 'controls/lighting/overhead-panel-knb': return set('integ', x);
    case 'controls/lighting/main-flood-knb': return set('flood', x);
    case 'controls/switches/wiperLspd': return set('wiper', Math.round(x), 0);
    case 'controls/switches/wiperRspd': return set('wiper', Math.round(x), 1);
    case 'controls/switches/terr_on_nd_l': return set('terrNd', b(on), 0);
    case 'controls/switches/terr_on_nd_r': return set('terrNd', b(on), 1);
    case 'controls/electrical/switches/bat-1': return set('bat', b(on), 0);
    case 'controls/electrical/switches/bat-2': return set('bat', b(on), 1);
    case 'controls/electrical/switches/gen-1': return set('gen', b(on), 0);
    case 'controls/electrical/switches/gen-2': return set('gen', b(on), S.eng.length - 1);
    case 'controls/electrical/switches/apu': return set('apuGen', b(on));
    case 'controls/electrical/switches/ext-pwr': return set('extPwr', b(on));
    case 'controls/electrical/switches/bus-tie': return set('busTie', b(on));
    case 'controls/electrical/switches/galley': return set('galley', b(on));
    case 'controls/electrical/switches/gen-1-line-contactor': return set('gen1Line', b(!on));
    case 'controls/electrical/switches/emer-elec-man-on': case 'controls/hydraulic/switches/rat-man': if (on) set('ratMan'); return;
    case 'controls/hydraulic/switches/green-edp': return wide ? edp('G') : set('engPump', b(on), 0);
    case 'controls/hydraulic/switches/yellow-edp': return wide ? edp('Y') : set('engPump', b(on), S.eng.length - 1);
    case 'controls/hydraulic/switches/ptu': return wide ? edp('B') : set('ptu', b(on));
    case 'controls/hydraulic/switches/yellow-elec': return wide ? elecP('Y') : set('yElec', b(on));
    case 'controls/hydraulic/switches/blue-elec': return wide ? elecP('B') : set('bElec', b(on));
    case 'controls/fuel/switches/pump-left-1': return set('fuelPump', b(on), 'L1');
    case 'controls/fuel/switches/pump-left-2': return set('fuelPump', b(on), 'L2');
    case 'controls/fuel/switches/pump-center-1': return set('fuelPump', b(on), 'CL');
    case 'controls/fuel/switches/pump-center-2': return set('fuelPump', b(on), 'CR');
    case 'controls/fuel/switches/pump-right-1': return set('fuelPump', b(on), 'R1');
    case 'controls/fuel/switches/pump-right-2': return set('fuelPump', b(on), 'R2');
    case 'controls/fuel/switches/crossfeed': return set('xfeed', b(on));
    case 'controls/fuel/switches/center-mode': return set('modeSel', on ? 'AUTO' : 'MAN');
    case 'controls/pneumatics/switches/bleed-1': return set('engBleed', b(on), 0);
    case 'controls/pneumatics/switches/bleed-2': return set('engBleed', b(on), S.eng.length - 1);
    case 'controls/pneumatics/switches/apu': return set('apuBleed', b(on));
    case 'controls/pneumatics/switches/pack-1': return set('pack', b(on), 0);
    case 'controls/pneumatics/switches/pack-2': return set('pack', b(on), 1);
    case 'controls/ice-protection/wing': return set('wingAntiIce', b(on));
    case 'controls/ice-protection/leng': return set('engAntiIce', b(on), 0);
    case 'controls/ice-protection/reng': return set('engAntiIce', b(on), S.eng.length - 1);
    case 'controls/ice-protection/windowprobeheat': return set('probeHeat', on ? 'ON' : 'AUTO');
    case 'controls/oxygen/cockpit-oxygen-supply-pb': return set('crewOxy', b(!on));
    case 'controls/oxygen/passenger-mask-deploy-man': if (on) set('paxMasks'); return;
    case 'controls/apu/master': return set('apuMaster', b(on));
    case 'controls/cockpit/apu-start-translate': if (pulse) set('apuStart'); return;
    case 'controls/apu/fire-btn': if (on) set('firePb', undefined, 'apu'); return;
    case 'controls/apu/agent-btn': if (on) set('agent', 0, 'apu'); return;
    case 'controls/ignition/start-sw': return set('engMode', ['CRANK', 'NORM', 'IGN'][Math.min(2, Math.max(0, Math.round(x)))]);
    case 'controls/cockpit/evac-translate': if (pulse) set('evac'); return;
    case 'controls/cockpit/gndcall-translate': if (pulse) set('callMech'); return;
    case 'controls/cockpit/allcall-translate': if (pulse) set('callAll'); return;
    case 'controls/atc/mode-knob': return set('xpdrMode', ['STBY', 'AUTO', 'ON'][Math.min(2, Math.max(0, Math.round(x)))]);
    case 'controls/atc/abv-blw': return set('traffic', x < -0.5 ? 'BLW' : x > 0.5 ? 'ABV' : 'ALL');
    case 'controls/cockpit/atc-ident-translate': if (pulse) set('ident'); return;
    case 'controls/cockpit/atc-clr-translate': if (pulse) set('xpdrCode', '0000'); return;
    case 'controls/navigation/switching/att-hdg': return set('attHdg', x < -0.5 ? 'CAPT 3' : x > 0.5 ? 'F/O 3' : 'NORM');
    case 'controls/navigation/switching/air-data': return set('airData', x < -0.5 ? 'CAPT 3' : x > 0.5 ? 'F/O 3' : 'NORM');
    case 'instrumentation/mk-viii/inputs/discretes/gpws-inhibit': return set('gpwsSys', b(!on));
    case 'instrumentation/mk-viii/inputs/discretes/ta-tcf-inhibit': return set('gpwsTerr', b(!on));
    case 'instrumentation/mk-viii/inputs/discretes/glideslope-inhibit': return set('gpwsGs', b(!on));
    case 'instrumentation/mk-viii/inputs/discretes/momentary-flap-all-override': return set('gpwsFlap', b(!on));
    case 'instrumentation/mk-viii/inputs/discretes/momentary-flap-3-override': return set('gpwsLdg3', b(on));
    default: {
      let m;
      if ((m = name.match(/^controls\/navigation\/adirscp\/switches\/ir-(\d)-mode$/))) set('irMode', ['OFF', 'NAV', 'ATT'][Math.min(2, Math.max(0, Math.round(x)))], m[1] - 1);
      else if ((m = name.match(/^controls\/navigation\/adirscp\/lights\/adr-(\d)-off$/))) set('adr', b(!on), m[1] - 1);
      else if ((m = name.match(/^controls\/cockpit\/adr(\d)-translate$/))) { if (pulse && m[1] >= 1 && m[1] <= 3) set('adr', undefined, m[1] - 1); }
      else if (name.endsWith('/cutoff-switch')) { for (const i of engsOf(eng, S.eng.length)) set('master', b(!on), i); }
      else if (name.endsWith('/fire-btn')) { if (on) for (const i of engsOf(eng, S.eng.length)) set('firePb', undefined, i); }
      else if (name.endsWith('/agent1-btn')) { if (on) for (const i of engsOf(eng, S.eng.length)) set('agent', 0, i); }
      else if (name.endsWith('/agent2-btn')) { if (on) for (const i of engsOf(eng, S.eng.length)) set('agent', 1, i); }
      else if ((m = name.match(/^controls\/cockpit\/atc-(\d)-translate$/))) { if (pulse && S.radio) set('xpdrCode', `${String(S.radio.xpdr.code).slice(1)}${m[1]}`); }
      else if ((m = name.match(/^controls\/cockpit\/(\w+)-btn-translate$/))) {
        const key = { eng: 'ENG', apu: 'APU', bleed: 'BLEED', cond: 'COND', press: 'PRESS', door: 'DOOR', elec: 'ELEC', wheel: 'WHEEL', hyd: 'HYD', fctl: 'F/CTL', fuel: 'FUEL', all: 'ALL', sts: 'STS', rcl: 'RCL', clrl: 'CLR', clrr: 'CLR' }[m[1]];
        if (pulse && key) set('ecp', key);
      }
    }
  }
}
// (the A320 deck's two engine controls on a four-engined aircraft: the left one works engines 1 and 2, the right 3 and 4)
const engsOf = (side, n) => (n === 4 ? (side ? [2, 3] : [0, 1]) : [side ? n - 1 : 0]);
// the deck's clicks carried out, then its switches, levers and lights set as the aircraft has them
function fgSync(dt) {
  const f = pit.fg, d = f.deck, P = P_();
  if (!d || !P) return;
  const s = P.state, M = FG.fmgc, y = SYS();
  for (const e of d.events.splice(0)) {
    switch (e.e) {
      case 'gear': gearLever(); break;
      case 'flaps': {
        const C = (s.spec && s.spec.conf) || [];
        if (C.length < 2) break;
        const notch = (k) => ({ 0: 0, 1: 1, '1+F': 1, 2: 2, 3: 3, FULL: 4 }[C[k] && C[k].name] ?? k);
        const was = notch(s.conf), dir = e.up ? -1 : 1;
        s.conf = Math.max(0, Math.min(C.length - 1, s.conf + dir));
        if (notch(s.conf) === was) s.conf = Math.max(0, Math.min(C.length - 1, s.conf + dir)); // (1 and 1+F: one notch)
        break;
      }
      case 'fcu': if (M) M.turn(e.knob, e.steps, e.big); break;
      case 'fcuPush': if (M) M.push(e.knob); break;
      case 'fcuPull': if (M) M.pull(e.knob); break;
      case 'athr': if (M) M.press('ATHR'); break;
      case 'athrOff': if (M && s.athr) M.press('ATHR'); break;
      case 'ap':
        if (!M) break;
        if (e.n === 0) M.disconnect('button');
        else if (e.on !== !!M.F[`ap${e.n}`]) M.engage(e.n);
        break;
      case 'press': if (M && e.btn) M.press(e.btn); break;
      case 'thrust': s.lever = Math.max(0, Math.min(1, Math.max(0, s.lever || 0) + e.dx)); s.afloor = false; break;
      case 'reverse':
        if (!s.spec.rev || !s.onGround) break;
        if (e.on !== (s.lever < 0)) s.lever = e.on ? -1 : 0;
        break;
      case 'speedbrake': if (s.spec.speedBrake) s.sb = Math.max(0, Math.min(1, e.x)); break;
      case 'armed': if (s.spec.groundSpoilers) s.armed = e.on; break;
      case 'parking': s.parking = e.on; P.api.say(e.on ? 'Parking brake set' : 'Parking brake released', 'info', 1500); break;
      case 'prop': if (e.name === 'ecp') { if (y) y.set('ecp', e.key); } else fgProp(e.name, e.x, e.was); break;
      default:
    }
  }
  // the switches as the systems have them (set on the overhead page, by the keys or by the systems)
  if (y && y.S && y.S.elec) {
    const S = y.S, b = (v) => (v ? 1 : 0), tri = (v, a, m) => (v === a ? 0 : v === m ? 0.5 : 1), n = S.eng.length;
    const L = S.lt, E = S.elec, H = S.hyd, F = S.fuel, R = S.air, X = S.misc || {}, A = S.adirs, G = S.gpws;
    const set = (k, v) => d.set(k, v);
    set('controls/switches/strobe', tri(L.strobe, 'OFF', 'AUTO'));
    set('controls/switches/beacon', b(L.beacon));
    set('controls/switches/wing-lights', b(L.wing));
    set('controls/lighting/nav-lights-switch', b(L.nav));
    set('controls/lighting/turnoff-light-switch', b(L.rwy));
    set('controls/switches/landing-lights-l', tri(L.land, 'RETRACT', 'OFF'));
    set('controls/switches/landing-lights-r', tri(L.land, 'RETRACT', 'OFF'));
    set('controls/lighting/taxi-light-switch', tri(L.nose, 'OFF', 'TAXI'));
    set('controls/lighting/dome-norm', tri(L.dome, 'OFF', 'DIM'));
    set('controls/lighting/overhead-panel-knb', L.integ);
    set('controls/lighting/main-flood-knb', L.flood);
    set('controls/switches/seatbelt-sign', b(S.signs.belts));
    set('controls/switches/no-smoking-sign', b(S.signs.smoke));
    if (X.emerExit) set('controls/switches/emer-lights', tri(X.emerExit, 'OFF', 'ARM'));
    set('controls/electrical/switches/bat-1', b(E.bat[0]));
    set('controls/electrical/switches/bat-2', b(E.bat[1]));
    set('controls/electrical/switches/gen-1', b(E.gen[0]));
    set('controls/electrical/switches/gen-2', b(E.gen[n - 1]));
    set('controls/electrical/switches/apu', b(E.apuGen));
    set('controls/electrical/switches/bus-tie', b(E.busTie));
    set('controls/electrical/switches/galley', b(E.galley));
    if (H.plan) {
      const any = (k) => b(Object.keys(H.edp).some((key) => key[0] === k && H.edp[key]));
      set('controls/hydraulic/switches/green-edp', any('G'));
      set('controls/hydraulic/switches/yellow-edp', any('Y'));
      set('controls/hydraulic/switches/ptu', any('B'));
      set('controls/hydraulic/switches/yellow-elec', b(H.elecP.Y));
      set('controls/hydraulic/switches/blue-elec', b(H.elecP.B));
    } else {
      set('controls/hydraulic/switches/green-edp', b(H.engPump[0]));
      set('controls/hydraulic/switches/yellow-edp', b(H.engPump[n - 1]));
      set('controls/hydraulic/switches/ptu', b(H.ptu));
      set('controls/hydraulic/switches/yellow-elec', b(H.yElec));
      set('controls/hydraulic/switches/blue-elec', b(H.bElec));
    }
    for (const [k, p] of [['L1', 'left-1'], ['L2', 'left-2'], ['CL', 'center-1'], ['CR', 'center-2'], ['R1', 'right-1'], ['R2', 'right-2']]) set(`controls/fuel/switches/pump-${p}`, b(F.pump[k]));
    set('controls/fuel/switches/crossfeed', b(F.xfeed));
    set('controls/fuel/switches/center-mode', b(F.modeSel === 'AUTO'));
    set('controls/pneumatics/switches/bleed-1', b(R.engBleed[0]));
    set('controls/pneumatics/switches/bleed-2', b(R.engBleed[n - 1]));
    set('controls/pneumatics/switches/apu', b(S.apu.bleed));
    set('controls/pneumatics/switches/pack-1', b(R.pack[0]));
    set('controls/pneumatics/switches/pack-2', b(R.pack[1]));
    set('controls/ice-protection/wing', b(S.wingAntiIce));
    set('controls/ice-protection/leng', b(S.eng[0] && S.eng[0].antiIce));
    set('controls/ice-protection/reng', b(S.eng[n - 1] && S.eng[n - 1].antiIce));
    if (S.ice) set('controls/ice-protection/windowprobeheat', b(S.ice.probe === 'ON'));
    set('controls/apu/master', b(S.apu.master));
    set('controls/apu/fire-btn', b(S.apu.firePb));
    set('controls/ignition/start-sw', S.engMode === 'CRANK' ? 0 : S.engMode === 'IGN' ? 2 : 1);
    const sides = n === 4 ? [[0, 1], [2, 3]] : [[0], [n - 1]];
    sides.forEach((es, k) => {
      const p = k ? 'controls/engines/engine[1]' : 'controls/engines/engine';
      set(`${p}/cutoff-switch`, b(!es.every((i) => S.eng[i] && S.eng[i].master)));
      set(`${p}/fire-btn`, b(es.some((i) => S.eng[i] && S.eng[i].firePb)));
    });
    if (X.crewOxy != null) set('controls/oxygen/cockpit-oxygen-supply-pb', b(!X.crewOxy));
    if (A) for (let k = 0; k < 3; k++) {
      if (A.ir && A.ir[k]) set(`controls/navigation/adirscp/switches/ir-${k + 1}-mode`, A.ir[k].mode === 'OFF' ? 0 : A.ir[k].mode === 'ATT' ? 2 : 1);
      if (A.adr) set(`controls/navigation/adirscp/lights/adr-${k + 1}-off`, b(!A.adr[k]));
    }
    if (G) {
      set('instrumentation/mk-viii/inputs/discretes/gpws-inhibit', b(!G.sys));
      set('instrumentation/mk-viii/inputs/discretes/ta-tcf-inhibit', b(!G.terr));
      set('instrumentation/mk-viii/inputs/discretes/glideslope-inhibit', b(!G.gs));
      set('instrumentation/mk-viii/inputs/discretes/momentary-flap-all-override', b(!G.flap));
      set('instrumentation/mk-viii/inputs/discretes/momentary-flap-3-override', b(G.ldg3));
    }
  }
  // the flight's own: gear, flaps, the thrust levers, speed brakes, brakes, the side-sticks, the FCU's lights
  d.set('controls/gear/lever-cockpit', s.gearDown ? 3 : 0);
  const gr = s.gear ?? 1, status = gr > 0.99 ? 2 : gr < 0.01 ? 0 : 1;
  for (const k of ['systems/gear/unit/status', 'systems/gear/unit[1]/status', 'systems/gear/unit[2]/status']) d.set(k, status);
  for (const k of ['gear/gear/wow', 'gear/gear[1]/wow', 'gear/gear[2]/wow']) d.set(k, s.onGround ? 1 : 0);
  const C = (s.spec && s.spec.conf) || [];
  d.set('controls/flight/flaps-input', ({ 0: 0, 1: 1, '1+F': 1, 2: 2, 3: 3, FULL: 4 }[C[s.conf] && C[s.conf].name] ?? Math.min(4, s.conf || 0)));
  // (the thrust levers: idle 0°, CL 25°, FLX/MCT 35°, TOGA 45°; the reversers' latches)
  const l = Math.max(0, s.lever || 0), AT = [0, 0.86, 0.93, 1], DEGS = [0, 25, 35, 45];
  let k = 1; while (k < 3 && l > AT[k]) k++;
  const ang = DEGS[k - 1] + (DEGS[k] - DEGS[k - 1]) * Math.max(0, Math.min(1, (l - AT[k - 1]) / (AT[k] - AT[k - 1])));
  const rev = s.lever < 0 ? 0.1 + 0.9 * Math.min(1, -s.lever) : 0;
  for (const [a, r, t] of [['systems/fadec/control-1/lever/angle', 'systems/fadec/reverse-1/throttle-lever', 'controls/engines/engine/throttle'], ['systems/fadec/control-2/lever/angle', 'systems/fadec/reverse-2/throttle-lever', 'controls/engines/engine[1]/throttle']]) {
    d.set(a, ang); d.set(r, rev); d.set(t, l);
  }
  d.set('spoilers/lever-cmd', s.sb || 0);
  d.set('controls/flight/speedbrake', s.sb || 0);
  d.set('controls/flight/speedbrake-arm', s.armed ? 1 : 0);
  d.set('controls/gear/brake-parking', s.parking ? 1 : 0);
  d.set('controls/gear/brake-left', s.brake || 0);
  d.set('controls/gear/brake-right', s.brake || 0);
  d.set('controls/flight/aileron', s.roll || 0);
  d.set('controls/flight/elevator', -(s.stick || 0));
  d.set('systems/fbw/sidestick/yaw-input-cmd', s.rud || 0);
  d.set('it-autoflight/output/athr', s.athr && s.spec.athr ? 1 : 0);
  d.set('it-autoflight/input/spd-managed', s.spdSel == null ? 1 : 0);
  if (M && M.F) {
    d.set('it-autoflight/output/ap1', M.F.ap1 ? 1 : 0); d.set('it-autoflight/output/ap2', M.F.ap2 ? 1 : 0);
    d.set('it-autoflight/output/fd1', M.F.fd ? 1 : 0); d.set('it-autoflight/output/fd2', M.F.fd ? 1 : 0);
    d.set('it-autoflight/output/loc-arm', M.F.locBtn || M.F.appr ? 1 : 0); d.set('it-autoflight/output/gs-arm', M.F.appr ? 1 : 0);
    d.set('controls/autobrake/mode', { LO: 1, MED: 2, MAX: 3 }[M.F.abrk] || 0);
    if (M.F.nd) { d.set('instrumentation/efis/inputs/range-nm', M.F.nd.range); d.set('instrumentation/efis[1]/inputs/range-nm', M.F.nd.range); }
  }
  if (y && y.S && y.S.misc) {
    const pg = y.S.misc.ecp;
    for (const [key, p] of [['APU', 'apu'], ['BLEED', 'bleed'], ['COND', 'cond'], ['DOOR', 'door'], ['ELEC', 'elec'], ['ENG', 'eng'], ['F/CTL', 'fctl'], ['FUEL', 'fuel'], ['HYD', 'hyd'], ['PRESS', 'press'], ['WHEEL', 'wheel'], ['STS', 'sts']]) d.set(`ECAM/Lower/light/${p}`, pg === key ? 1 : 0);
  }
  d.step(dt);
  // every node posed (only when a pose changed)
  if (d.gen !== f.gen) {
    f.gen = d.gen;
    for (const [n, g] of f.nodes) {
      const p = d.poses[n];
      if (!p) continue;
      g.visible = p.vis;
      if (p.m) g.matrix.fromArray(p.m); else g.matrix.identity();
      g.matrixWorldNeedsUpdate = true;
    }
  }
}
// its lighting: a little of each texture's own colour (the panels lit from within at night, as INT LT has them),
// the model's lamps, and the lamps its animations light
function fgLight(day) {
  const f = pit.fg, d = f.deck, y = SYS();
  const L = y ? y.S.lt : null;
  const night = 1 - Math.max(0, Math.min(1, day));
  const k = 0.03 * (1 - night) + 0.10 * night * night * (L ? 0.2 + 0.8 * L.integ : 1);
  for (const x of f.mats) {
    const lamp = x.node && d ? d.poses[x.node] && d.poses[x.node].emit : null;
    const e = [0, 1, 2].map((c) => k * [1, 0.97, 0.92][c] + x.own[c] + (lamp ? lamp[c] * LAMP : 0));
    const key = e.map((v) => v.toFixed(3)).join();
    if (key !== x.last) { x.last = key; x.m.emissive.setRGB(e[0], e[1], e[2]); }
  }
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
// The A340-300's standby instruments: three round electromechanical ones, the horizon over the airspeed and the
// altimeter (the ISIS replaced them on the later A330s and A340s).
function stby3(c, W, H, st) {
  c.fillStyle = '#101214'; c.fillRect(0, 0, W, H);
  const dial = (x, y, r) => {
    c.fillStyle = '#2a2d31'; c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.fill();
    c.fillStyle = '#060708'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  };
  const ticks = (x, y, r, n, every, label) => {
    c.strokeStyle = '#e8eef8'; c.fillStyle = '#e8eef8'; c.font = `600 ${Math.round(r * 0.2)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2, big = k % every === 0;
      c.lineWidth = big ? 2.5 : 1.2;
      c.beginPath(); c.moveTo(x + Math.cos(a) * r * (big ? 0.8 : 0.88), y + Math.sin(a) * r * (big ? 0.8 : 0.88)); c.lineTo(x + Math.cos(a) * r * 0.97, y + Math.sin(a) * r * 0.97); c.stroke();
      if (big && label) c.fillText(label(k / every), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64);
    }
  };
  const needle = (x, y, r, a, w = 3, col = '#f4f6f8') => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a - Math.PI / 2) * r, y + Math.sin(a - Math.PI / 2) * r); c.stroke(); };
  // the horizon
  const hx = W / 2, hy = H * 0.29, hr = W * 0.24;
  dial(hx, hy, hr);
  c.save(); c.beginPath(); c.arc(hx, hy, hr, 0, 7); c.clip();
  c.translate(hx, hy); c.rotate(-(st.phi || 0) * Math.PI / 180);
  const py = (st.theta || 0) * hr / 25;
  c.fillStyle = '#2b6fb6'; c.fillRect(-hr, -2 * hr + py, 2 * hr, 2 * hr);
  c.fillStyle = '#5a3a1e'; c.fillRect(-hr, py, 2 * hr, 2 * hr);
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-hr, py); c.lineTo(hr, py); c.stroke();
  for (const d of [-10, 10, 20]) { const y = py - d * hr / 25; c.beginPath(); c.moveTo(-hr * 0.2, y); c.lineTo(hr * 0.2, y); c.stroke(); }
  c.restore();
  c.strokeStyle = '#ffb000'; c.lineWidth = 5; c.beginPath(); c.moveTo(hx - hr * 0.6, hy); c.lineTo(hx - hr * 0.18, hy); c.moveTo(hx + hr * 0.18, hy); c.lineTo(hx + hr * 0.6, hy); c.stroke();
  c.fillStyle = '#ffb000'; c.beginPath(); c.arc(hx, hy, 4, 0, 7); c.fill();
  // the airspeed (knots: 60 at the top … 400 round once)
  const kt = (st.V || 0) / 0.514444, ax = W * 0.26, ay = H * 0.76, ar = W * 0.2;
  dial(ax, ay, ar); ticks(ax, ay, ar, 34, 2, (k) => (k % 2 ? '' : String(60 + k * 20)));
  needle(ax, ay, ar * 0.85, (Math.max(60, Math.min(400, kt)) - 60) / 340 * Math.PI * 2);
  c.fillStyle = '#9aa1aa'; c.font = '600 11px system-ui, sans-serif'; c.fillText('KNOTS', ax, ay + ar * 0.42);
  // the altimeter (one turn a thousand feet, the thousands in a window)
  const ft = (st.h || 0) / 0.3048, lx = W * 0.74, ly = H * 0.76, lr = W * 0.2;
  dial(lx, ly, lr); ticks(lx, ly, lr, 50, 5, (k) => String(k));
  c.fillStyle = '#000'; c.fillRect(lx - lr * 0.42, ly + lr * 0.2, lr * 0.84, lr * 0.3);
  c.fillStyle = '#e8eef8'; c.font = `600 ${Math.round(lr * 0.24)}px ui-monospace, monospace`; c.fillText(String(Math.floor(Math.max(0, ft) / 1000)).padStart(2, '0'), lx, ly + lr * 0.36);
  needle(lx, ly, lr * 0.85, ((((ft % 1000) + 1000) % 1000) / 1000) * Math.PI * 2);
  c.fillStyle = '#9aa1aa'; c.font = '600 11px system-ui, sans-serif'; c.fillText('ALT', lx, ly - lr * 0.4);
}
// A CRT screen's look (the A340-300's): its scan lines, the corners darker, the glass's own glow.
function crtLook(c, W, H) {
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.74);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(16,26,34,0.5)'; c.fillRect(0, 0, W, H);
  c.restore();
}

// ---------- the airport round the aircraft: the taxi camera's picture and the airport map (OANS) ----------
// The nearest airport's real layout (the game's FG.layouts: aprons, taxiways, stands, buildings) and runways, in
// metres ahead (y) and right (x) of the aircraft.
let groundAt = 0, groundNow = null;
function groundOf(P) {
  const s = P.state, G = FG.game, now = performance.now();
  if (now - groundAt < 2000) return groundNow;
  groundAt = now; groundNow = null;
  if (!G || !G.airportByCode) return null;
  let best = null, bd = 1e9;
  for (const a of Object.values(G.airportByCode)) {
    if (Math.abs(a.lat - s.lat) > 0.12 || Math.abs(a.lon - s.lon) > 0.2) continue;
    const d = G.distanceKm({ lat: s.lat, lon: s.lon }, a);
    if (d < bd) { bd = d; best = a; }
  }
  if (!best || bd > 10) return null;
  groundNow = { code: best.code, lay: FG.layouts ? FG.layouts.get(best.code) : null, rws: G.airportRunways(best.code) || [] };
  return groundNow;
}
// (lat, lon) → [x right, y ahead] metres from the aircraft
function localXY(s) {
  const cosL = Math.cos(s.lat * Math.PI / 180), ps = (s.psi || 0) * Math.PI / 180, cp = Math.cos(ps), sp = Math.sin(ps);
  return (lat, lon) => { const e = (lon - s.lon) * 111320 * cosL, n = (lat - s.lat) * 111320; return [e * cp - n * sp, n * cp + e * sp]; };
}
// a polyline's pavement as quads either side of it (w metres wide)
function stripes(pts, w) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (-(y1 - y0) / l) * w / 2, ny = ((x1 - x0) / l) * w / 2;
    out.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
  }
  return out;
}
// The aircraft's own measures: length, span, fuselage diameter; the nose gear and the main gear (y ahead of its middle).
function bodyOf(P) {
  const s = P.state, look = (FG.data && FG.data.looks && FG.data.looks[s.type]) || {};
  const len = look.len || 60, span = look.span || 60, dia = look.dia || 5.6, wb = (s.spec && s.spec.wheelbase) || len * 0.45;
  const noseGear = len / 2 - 0.075 * len;
  return { len, span, dia, nose: len / 2, noseGear, main: noseGear - wb, track: Math.min(12, span * 0.17) };
}
// The ground (aprons, runways, taxiways with their centre lines) through a drawing function's project(x, y, z).
function drawGround(c, P, project, { plan = false, near = 0.3 } = {}) {
  const g = groundOf(P), s = P.state;
  if (!g) return null;
  const xy = localXY(s);
  // a polygon on the ground (z = 0) cut at the camera's near plane, then filled
  const poly = (pts, fill, stroke, lw = 1) => {
    const q = project.clip ? project.clip(pts.map(([x, y]) => [x, y, 0]), near) : pts.map(([x, y]) => [x, y, 0]);
    if (q.length < 2) return;
    c.beginPath();
    q.forEach((p, i) => { const [u, v] = project(p); if (i) c.lineTo(u, v); else c.moveTo(u, v); });
    if (fill) { c.closePath(); c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  };
  const line = (pts, col, lw, dash) => {
    c.setLineDash(dash || []);
    for (let i = 1; i < pts.length; i++) {
      const q = project.clip ? project.clip([[...pts[i - 1], 0], [...pts[i], 0]], near, true) : [[...pts[i - 1], 0], [...pts[i], 0]];
      if (q.length < 2) continue;
      const [a, b] = [project(q[0]), project(q[1])];
      c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    c.setLineDash([]);
  };
  // (in reach: a side of it passes within `far` of the aircraft; a runway's ends can both be kilometres away)
  const far = plan ? 12000 : 900;
  const segNear = ([x0, y0], [x1, y1]) => {
    const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, -(x0 * dx + y0 * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x0 + dx * t, y0 + dy * t) < far;
  };
  const inReach = (pts) => pts.some((p, i) => (i ? segNear(pts[i - 1], p) : pts.length === 1 && Math.hypot(p[0], p[1]) < far));
  const L = g.lay;
  if (L) {
    for (const r of L.aprons || []) { const p = r.map(([la, lo]) => xy(la, lo)); if (inReach(p)) poly(p, '#3b4047'); }
    for (const w of L.taxiways || []) { const p = w.map(([la, lo]) => xy(la, lo)); if (inReach(p)) for (const q of stripes(p, 23)) poly(q, '#454a52'); }
  }
  for (const r of g.rws) {
    const a = xy(r[0], r[1]), b = xy(r[2], r[3]);
    if (!inReach([a, b])) continue;
    for (const q of stripes([a, b], r[4] || 45)) poly(q, '#55595f', '#d8dde3', plan ? 1 : 1.5);
    line([a, b], '#f2f4f6', plan ? 1.5 : 2, plan ? [8, 8] : [14, 10]);
  }
  if (L) {
    for (const w of L.taxiways || []) { const p = w.map(([la, lo]) => xy(la, lo)); if (inReach(p)) line(p, '#e8c547', plan ? 1.5 : 2.5); }
    if (plan) {
      for (const r of L.terminals || []) { const p = r.map(([la, lo]) => xy(la, lo)); if (inReach(p)) poly(p, '#3e6f8f', '#7fb0cf', 1); }
      for (const r of L.hangars || []) { const p = r.map(([la, lo]) => xy(la, lo)); if (inReach(p)) poly(p, '#3a5566', '#6d8fa3', 1); }
    }
  }
  return g;
}
// The A340-600's TAXI CAMERA on the SD: the fin camera looking ahead over the fuselage (the nose and the main gear's
// wheels marked over the ground), and the camera under the fuselage looking down at the nose wheel.
function taxiCamScreen(c, W, H, P) {
  const B = bodyOf(P);
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  const pane = (x0, y0, w, h, cam, pitchDeg, fovDeg, parts, title) => {
    c.save(); c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    c.fillStyle = '#26302a'; c.fillRect(x0, y0, w, h); // (grass)
    const a = pitchDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), f = (h / 2) / Math.tan(fovDeg * Math.PI / 360);
    const depth = (p) => (p[1] - cam[1]) * ca - (p[2] - cam[2]) * sa;
    const project = (p) => {
      const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
      const zc = Math.max(0.05, dy * ca - dz * sa), up = dy * sa + dz * ca;
      return [x0 + w / 2 + (dx / zc) * f, y0 + h / 2 - (up / zc) * f];
    };
    // (Sutherland–Hodgman against the near plane; `open`: a line, not a polygon)
    project.clip = (pts, near, open) => {
      const out = [], n = pts.length;
      for (let i = 0; i < (open ? n - 1 : n); i++) {
        const p = pts[i], q = pts[(i + 1) % n], dp = depth(p) - near, dq = depth(q) - near;
        if (dp >= 0 && (open ? i === 0 : true)) out.push(p);
        if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
        if (open && dq >= 0) out.push(q);
      }
      return out;
    };
    drawGround(c, P, project, { near: 0.5 });
    const shape = (pts, fill, stroke) => {
      const q = project.clip(pts, 0.5);
      if (q.length < 3) return;
      c.beginPath(); q.forEach((p, i) => { const [u, v] = project(p); if (i) c.lineTo(u, v); else c.moveTo(u, v); }); c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
    };
    parts(shape, project);
    c.restore();
    c.fillStyle = '#e8eef8'; c.font = `600 ${Math.round(H * 0.035)}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(title, x0 + 8, y0 + 6);
    c.strokeStyle = '#6d7480'; c.lineWidth = 2; c.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  };
  const r = B.dia / 2, zc = 0.9 + r; // (the fuselage's centre: its belly about 0.9 m up)
  // the fin camera: ahead and down over the fuselage
  pane(0, 0, W, H * 0.6, [0, -B.len * 0.36, zc + r + 7.5], 19, 54, (shape, project) => {
    const y0 = -B.len * 0.36 + 4;
    shape([[-r * 0.8, y0, zc + r], [r * 0.8, y0, zc + r], [r * 0.7, B.nose - 6, zc + r * 0.8], [0, B.nose, zc], [-r * 0.7, B.nose - 6, zc + r * 0.8]], '#d9dde2', '#9aa1aa');
    for (const sd of [-1, 1]) {
      const wy = B.main + 8;
      shape([[sd * r, wy, zc - 0.6], [sd * B.span / 2, wy - B.span * 0.33, zc + 0.8], [sd * B.span / 2, wy - B.span * 0.33 - 3, zc + 0.8], [sd * r, wy - 13, zc - 0.6]], '#c4c9cf', '#8d949c');
    }
    // the guides: the nose wheel and the main gear's outer wheels, projected to the ground (cyan) and where the nose is
    c.strokeStyle = '#4fd6ff'; c.lineWidth = 2;
    for (const x of [-B.track / 2 - 0.7, B.track / 2 + 0.7]) {
      const a = project([x, B.main, 0]), b = project([x, B.main + 60, 0]);
      c.setLineDash([6, 6]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]);
    }
    const n = project([0, B.noseGear, 0]);
    c.fillStyle = '#4fd6ff'; c.beginPath(); c.arc(n[0], n[1], 5, 0, 7); c.fill();
  }, 'FIN CAMERA');
  // under the fuselage, behind the nose gear, looking down at it
  pane(0, H * 0.6, W, H * 0.4, [0, B.noseGear - 4.5, 1.9], 40, 62, (shape) => {
    for (const x of [-0.45, 0.45]) shape([[x - 0.2, B.noseGear - 0.6, 0.02], [x + 0.2, B.noseGear - 0.6, 0.02], [x + 0.2, B.noseGear + 0.6, 0.02], [x - 0.2, B.noseGear + 0.6, 0.02]], '#111315', '#555b62');
    shape([[-0.08, B.noseGear - 0.5, 1.3], [0.08, B.noseGear - 0.5, 1.3], [0.08, B.noseGear + 0.2, 0.4], [-0.08, B.noseGear + 0.2, 0.4]], '#9aa1aa');
  }, 'NOSE GEAR');
  if (!groundOf(P)) { c.fillStyle = '#ffb000'; c.textAlign = 'center'; c.fillText('NO AIRPORT DATA', W / 2, H * 0.3); }
}
// The A330neo's airport map (OANS) on the ND: the stands, taxiways, runways and buildings round you, heading up.
function oansScreen(c, W, H, P, side) {
  const s = P.state, sys = SYS(), X = sys && sys.S.misc;
  const range = (X && X.oansRange) || 1, cx = W / 2, cy = H * 0.66, ppm = (H * 0.56) / (range * 1852);
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  c.save(); c.beginPath(); c.rect(0, H * 0.08, W, H * 0.86); c.clip();
  const project = ([x, y]) => [cx + x * ppm, cy - y * ppm];
  const g = drawGround(c, P, project, { plan: true });
  if (g && g.lay && range <= 2) {
    const xy = localXY(s);
    c.fillStyle = '#ff4fd8'; c.font = `600 ${Math.round(H * 0.026)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const st of g.lay.stands || []) {
      const [x, y] = xy(st[0], st[1]);
      if (Math.abs(x) * ppm > W || Math.abs(y) * ppm > H) continue;
      const [u, v] = project([x, y]);
      c.fillRect(u - 2, v - 2, 4, 4);
      if (st[3] && range <= 1) c.fillText(st[3], u, v - H * 0.02);
    }
  }
  c.restore();
  // you: the yellow aircraft symbol at its size
  const B = bodyOf(P), k = Math.max(1, B.len * ppm / 2);
  c.strokeStyle = '#ffd60a'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx, cy - k); c.lineTo(cx, cy + k); c.moveTo(cx - Math.max(6, B.span * ppm / 2), cy); c.lineTo(cx + Math.max(6, B.span * ppm / 2), cy);
  c.moveTo(cx - k * 0.35, cy + k * 0.85); c.lineTo(cx + k * 0.35, cy + k * 0.85); c.stroke();
  c.fillStyle = '#e8eef8'; c.font = `600 ${Math.round(H * 0.04)}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(`OANS ${g ? g.code : '----'}`, W * 0.03, H * 0.04);
  c.fillStyle = '#30d158'; c.fillText(`GS ${Math.round((s.gsMs != null ? s.gsMs : s.V) / 0.514444)}`, W * 0.03, H * 0.97);
  c.textAlign = 'right'; c.fillStyle = '#4fd6ff'; c.fillText(`${range} NM`, W * 0.97, H * 0.97);
  c.fillStyle = '#e8eef8'; c.fillText(`HDG ${String(Math.round(((s.psi || 0) % 360 + 360) % 360)).padStart(3, '0')}`, W * 0.97, H * 0.04);
  if (!g) { c.textAlign = 'center'; c.fillStyle = '#ffb000'; c.fillText('ARPT NOT IN DATABASE', W / 2, H * 0.4); }
  void side;
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
function ndScreen(c, W, H, P, side = 0) {
  { const x = SYS(); if (D.oans && x && x.S.misc && x.S.misc.oans) { oansScreen(c, W, H, P, side); return; } }
  const M = FM();
  if (!M) { P.panel(c, 'nd', W, H); return; }
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  const k = Math.min(W, H) / 324;
  c.save(); c.translate((W - 324 * k) / 2, (H - 324 * k) / 2); c.scale(k, k); M.drawNd(c, side); c.restore();
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
  if (D.taxiCam && sys && sys.S.misc && sys.S.misc.taxiCam && s.onGround) { taxiCamScreen(c, W, H, P); return; }
  // the page: the ECAM control panel's, or the one the systems call up (src/aircraft.js sdPage)
  const pg = sys && sys.sdPage ? sys.sdPage() : sys && sys.S.eng.some((e) => e.fire || e.start || !e.run) ? 'ENG' : sys && (sys.S.apu.n > 1 || sys.S.apu.fire) ? 'APU' : 'WHEEL';
  const engPage = pg === 'ENG', apuPage = pg === 'APU';
  if (!engPage && !apuPage) { if (!(sys && sys.sd(c, W, H, pg))) P.panel(c, 'sd', W, H); return; }
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

// After a screen is drawn: dark without power, the failure flags of a pilot's IR (src/aircraft.js), its brightness.
const SCREEN_IDS = { stby3: ['isis'], pfd: ['pfd'], nd: ['nd'], 'pfdnd-c': ['pfd', 'nd'], 'pfdnd-f': ['pfd', 'nd'], ewd: ['ewd'], sd: ['sd'], isis: ['isis'], ois: ['sd'], 'ois-f': ['sd'] };
function finish(c, W, H, sc) {
  const sys = SYS();
  if (!sys || !sys.screenOn) return;
  const ids = (SCREEN_IDS[sc.kind] || ['sd']).map((k) => (k === 'pfd' || k === 'nd' ? `${k}${sc.side + 1}` : k));
  if (!ids.some((id) => sys.screenOn(id))) { c.fillStyle = '#020203'; c.fillRect(0, 0, W, H); return; }
  const side = sys.side ? sys.side(sc.side) : { att: true, nav: true, air: true };
  const flag = (t, x, y, k = 0.07) => { c.font = `700 ${Math.round(H * k)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ff3b30'; c.fillText(t, x, y); };
  const two = ids.length === 2, pfdLeft = sc.kind === 'pfdnd-c';
  for (const id of ids) {
    const x0 = two ? ((id.startsWith('pfd') === pfdLeft) ? 0 : W / 2) : 0, w = two ? W / 2 : W;
    if (id.startsWith('pfd') && !side.att) { c.fillStyle = '#05070a'; c.fillRect(x0, H * 0.18, w, H * 0.64); flag('ATT', x0 + w / 2, H / 2, 0.09); }
    if (id.startsWith('pfd') && !side.air) { flag('SPD', x0 + w * 0.12, H / 2); flag('ALT', x0 + w * 0.86, H / 2); }
    if (id.startsWith('nd') && !side.nav) { c.fillStyle = '#05070a'; c.fillRect(x0, H * 0.1, w, H * 0.8); flag(side.att ? 'MAP NOT AVAIL' : 'HDG', x0 + w / 2, H / 2, 0.06); }
  }
  const B = sys.S.misc && sys.S.misc.bright;
  if (B) for (const id of ids) {
    const b = B[id] ?? 1;
    if (b >= 0.99) continue;
    const x0 = two ? ((id.startsWith('pfd') === pfdLeft) ? 0 : W / 2) : 0, w = two ? W / 2 : W;
    c.fillStyle = `rgba(0,0,0,${Math.min(1, 1 - b)})`; c.fillRect(x0, 0, w, H);
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
      c.save(); c.translate(pfdLeft ? W / 2 : 0, 0); ndScreen(c, W / 2, H, P, sc.side); c.restore();
      c.fillStyle = '#1a1d21'; c.fillRect(W / 2 - 2, 0, 4, H);
    } else if (sc.kind === 'pfd') pfdScreen(c, W, H, P);
    else if (sc.kind === 'nd') ndScreen(c, W, H, P, sc.side);
    else if (sc.kind === 'ewd') ewdScreen(c, W, H, P);
    else if (sc.kind === 'sd') sdScreen(c, W, H, P);
    else if (sc.kind === 'isis') isis(c, W, H, info);
    else if (sc.kind === 'stby3') stby3(c, W, H, info);
    else ois(c, W, H, info, sc.kind === 'ois-f');
    finish(c, W, H, sc);
    if (D.crt && sc.kind !== 'stby3') crtLook(c, W, H);
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
let clickCount = 0;
const shown = () => !!pit && performance.now() - drawnAt < 1500 && !!FG.pilot && FG.pilot.active && FG.pilot.cam === 'cockpit' && has(FG.pilot.type); // (slow machines draw few frames)
function pick(ev) {
  if (!shown() || !FG.view3d || !FG.view3d.map) return null;
  const r = FG.view3d.map.getCanvas().getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pit.clickables, false), hit = hits[0];
  if (!hit) return null;
  const u = hit.object.userData;
  if (u.click) return { c: u.click, fx: 0, fy: 0 };
  if (u.fgNode && pit.fg && pit.fg.deck) {
    // (FlightGear's deck: the node's controls; left click, right click (its middle button), the wheel. A click that
    // does nothing there goes on to the control behind it: a guard's pushbutton is in front of the guard's hinge)
    const dk = pit.fg.deck, nodes = [...new Set(hits.map((h) => h.object.userData.fgNode).filter(Boolean))].slice(0, 5);
    const picks = dk.def.nodes[u.fgNode].picks;
    return { c: { tip: dk.label(picks) || '', click: (o = {}) => {
      const b = o.wheel ? (o.wheel > 0 ? 3 : 4) : o.button === 2 || o.shift ? 2 : 0;
      for (const n of nodes) if (dk.press(dk.def.nodes[n].picks, b)) break;
    } }, fx: 0, fy: 0 };
  }
  if (u.panel && hit.uv) { const h = u.panel.hit(hit.uv); if (h) h.panel = u.panel; return h; }
  return null;
}
function act(h, opts) {
  if (!h || !h.c.click) return false;
  clicks.push({ tip: typeof h.c.tip === 'function' ? h.c.tip() : h.c.tip, fx: h.fx, fy: h.fy, ...opts });
  clickCount++;
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
  // (the A320s, A330s and A340s: FlightGear's real deck once its pack has come, the deck built here until then)
  const real = fgKind(kind);
  if (real && !fg.pack) fgLoad();
  const key = `${real && fg.pack ? 'fg-' : ''}${kind}${nEng}`;
  if (!pits[key]) pits[key] = real && fg.pack ? buildFg(kind, nEng) : build(kind, nEng);
  const was = pit;
  pit = pits[key];
  useDeck(kind);
  if (pit.D) { D = pit.D; EYE_X = D.EYE_X; }
  // (another deck: the eye where the station picked is on this one)
  if (was && was !== pit && seat.x != null) { seat.x = stationX(at.rear ? 'R' : VIEWS[at.r][at.c][0]); if (seatTo.x != null) seatTo.x = seat.x; }
  hook();
  const now = performance.now();
  const dt = Math.min(0.1, (now - (drawnAt || now)) / 1000);
  glide(dt);
  drawnAt = now;
  // (the 3D FCU is the one to use here: the FCU window over the view goes while the deck is shown)
  const fcuEl = document.getElementById('fcu');
  if (fcuEl && !fcuEl.hidden && FG.fcu) { fcuHidden = true; FG.fcu.show(false); }
  paintScreens(now, P);
  if (now - panelsAt > 100) { panelsAt = now; for (const p of pit.panels) p.paint(); }
  if (pit.fg) fgSync(dt); else poseControls(P.state);
  // light: the sky, the sun, and the cockpit's own (dome, flood, the panels' integral lighting: INT LT)
  const sys = SYS();
  const L = sys ? sys.S.lt : null;
  const d = Math.max(0, Math.min(1, day));
  pit.hemi.intensity = 0.3 + 0.75 * d;
  pit.amb.intensity = 0.12 + 0.28 * d;
  const ex = seat.x == null ? pit.eyeX : seat.x; // (the eye's side: the captain's, the middle, the first officer's)
  if (sunB && d > 0.05) { pit.sun.intensity = 1.8 * d; pit.sun.position.set(sunB[0] * 10 - ex, sunB[1] * 10, sunB[2] * 10); pit.sun.target.position.set(-ex, 0, 0); }
  else pit.sun.intensity = 0;
  pit.dome.intensity = L ? { OFF: 0, DIM: 1.2, BRT: 3.2 }[L.dome] : 2.5 * (1 - d);
  pit.flood.intensity = L ? 2.2 * L.flood : 0;
  const glow = (0.15 + 0.85 * (1 - d)) * (L ? 0.15 + 0.85 * L.integ : 1);
  for (const m of pit.lit) m.emissive.setScalar(glow * 0.9);
  if (pit.fg) fgLight(d);
  // camera: the captain's eye, looking a little down the nose, turned with the head
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix();
  camera.position.set(-ex, -seat.back, seat.up);
  const yaw = (look.yaw || 0) * Math.PI / 180, pitch = (-(lookDown || 0) + (look.pitch || 0)) * Math.PI / 180;
  // (the head's own up: looking up past the vertical never turns the picture over)
  camera.up.set(-Math.sin(yaw) * Math.sin(pitch), -Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch));
  camera.lookAt(-ex + Math.sin(yaw) * Math.cos(pitch), -seat.back + Math.cos(yaw) * Math.cos(pitch), seat.up + Math.sin(pitch));
  camera.updateMatrixWorld();
  renderer.clearDepth();
  renderer.render(pit.scene, camera);
}
// Where the eye sits in the aircraft (the game's view3d.js cockpit camera): metres behind the nose and above the
// wheels, scaled from the A350's by the fuselage's diameter; moved back and up for the view from behind the seats.
export function eye(type) {
  const look = FG.data && FG.data.looks && FG.data.looks[type];
  const k = /^A38/i.test(type || '') ? 1.05 : look && look.dia ? look.dia / 6.1 : 1;
  return { back: 4.6 * k + seat.back, up: 7.6 * k + seat.up };
}

// ---------- the cockpit's views: Ctrl + arrows (src/pilot.js) ----------
// A grid of places to look from and at, moved round with Ctrl + ← → ↑ ↓: across, the left window, the captain, the
// middle, the first officer, the right window; up, the overhead; down, the screens, the pedestal and the consoles.
// Ctrl + Home: the captain looking ahead; Ctrl + End: from behind the seats. Each move glides there (about 0.3 s).
// Station: C the captain's seat, M the middle, F the first officer's, R behind the seats. Yaw and pitch (°) are the
// head's turn (the pitch from the usual look a little down the nose).
const VIEWS = [
  [['C', -70, 30, 'Left window, up'], ['C', 10, 65, 'Overhead (captain)'], ['M', 0, 78, 'Overhead'], ['F', -10, 65, 'Overhead (first officer)'], ['F', 70, 30, 'Right window, up']],
  [['C', -90, 0, 'Left window'], ['C', 0, 0, 'Captain'], ['M', 0, -6, 'Middle: FCU and E/WD'], ['F', 0, 0, 'First officer'], ['F', 90, 0, 'Right window']],
  [['C', -60, -38, 'Left console'], ['C', 0, -20, "Captain's PFD and ND"], ['M', 0, -48, 'Pedestal'], ['F', 0, -20, "First officer's PFD and ND"], ['F', 60, -38, 'Right console']],
];
const BEHIND = ['R', 0, -8, 'Behind the seats'];
const at = { r: 1, c: 1, rear: false };
// where the eye is now (metres: its x as EYE_X counts it, + the captain's side; back and up from the captain's eye),
// and where it is going
const seat = { x: null, back: 0, up: 0 };
const seatTo = { x: null, back: 0, up: 0, yaw: 0, pitch: 0, t: 0 };
const stationX = (st) => (st === 'C' ? D.EYE_X : st === 'F' ? -D.EYE_X : 0);
function goTo(v) {
  const [st, yaw, pitch, name] = v;
  seatTo.x = stationX(st); seatTo.back = st === 'R' ? 0.9 : 0; seatTo.up = st === 'R' ? 0.12 : 0;
  seatTo.yaw = yaw; seatTo.pitch = pitch; seatTo.t = 1;
  if (FG.pilot && FG.pilot.api) FG.pilot.api.say(`View: ${name}`, 'info', 1500);
}
// move round the views (dr, dc: rows down, columns right); 'home' and 'rear'
export function move(dr, dc) {
  if (dr === 'home') { at.r = 1; at.c = 1; at.rear = false; goTo(VIEWS[1][1]); return; }
  if (dr === 'rear') { at.rear = !at.rear; goTo(at.rear ? BEHIND : VIEWS[at.r][at.c]); return; }
  at.rear = false;
  at.r = Math.max(0, Math.min(2, at.r + dr));
  at.c = Math.max(0, Math.min(4, at.c + dc));
  goTo(VIEWS[at.r][at.c]);
}
// each frame: the head and the seat glide to the view picked (a drag of the mouse still turns the head from there)
function glide(dt) {
  if (seat.x == null) seat.x = D.EYE_X;
  if (seatTo.x == null) return;
  const k = 1 - Math.exp(-dt / 0.09);
  seat.x += (seatTo.x - seat.x) * k; seat.back += (seatTo.back - seat.back) * k; seat.up += (seatTo.up - seat.up) * k;
  const L = FG.view3d && FG.view3d.look;
  if (L && seatTo.t > 0) {
    L.yaw += (seatTo.yaw - L.yaw) * k; L.pitch += (seatTo.pitch - L.pitch) * k;
    if (Math.abs(seatTo.yaw - L.yaw) < 0.3 && Math.abs(seatTo.pitch - L.pitch) < 0.3) seatTo.t = 0;
    if (FG.view3d.map) FG.view3d.map.triggerRepaint();
  }
}
// (for debugging and test/systems.mjs: FG.cockpit3d.pit is the deck drawn last, project() a cockpit point → NDC)
// (where the FlightGear deck's control with that label is, as it stands: its corners' mean, or with `near` the mean
// of the corners nearest the eye (a hollow guard's middle is in its opening); cockpit space; for the tests)
function fgSpot(label, near) {
  if (!pit || !pit.fg || !pit.fg.deck) return null;
  const dk = pit.fg.deck, pts = [];
  for (const m of pit.clickables) {
    if (!m.userData.fgNode || dk.label(dk.def.nodes[m.userData.fgNode].picks) !== label) continue;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  }
  if (!pts.length) return null;
  let use = pts;
  if (near) {
    const eyeP = new THREE.Vector3(-pit.eyeX, 0, 0), d0 = Math.min(...pts.map((p) => p.distanceTo(eyeP)));
    use = pts.filter((p) => p.distanceTo(eyeP) < d0 + 0.006);
  }
  return use.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(use.length).toArray();
}
FG.cockpit3d = { get pit() { return pit; }, get clickCount() { return clickCount; }, fgSpot, get drawnAt() { return drawnAt; }, clicks, has, draw, eye, project: (p) => new THREE.Vector3(...p).project(camera).toArray(),
  hitAt(x, y) { const h = pick({ clientX: x, clientY: y }); return h ? { tip: typeof h.c.tip === 'function' ? h.c.tip() : h.c.tip || '', shown: shown() } : { tip: null, shown: shown() }; }, get EYE_X() { const k = FG.pilot && kindOf(FG.pilot.type); return seat.x != null && k ? seat.x : (k ? DECKS[k] : DECKS.a350).EYE_X; }, move }; // (move: the views, Ctrl + arrows) // (the game's view3d.js draws through this)
