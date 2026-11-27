// The ND's airport map: the EFIS's RANGE knob turned left past 10 NM to ZOOM (Airbus's OANS), at 5, 2, 1, 0.5 or
// 0.2 NM. The airport the aircraft is at or near (the nearest within 8 km) from its real layout (the game's
// FG.layouts: aprons, taxiways, terminals, hangars, stands) and runways, on black as on the real screen:
// - aprons and taxiways in greys, the taxiways as wide as they are (23 m), their centre lines yellow;
// - runways dark with white edges, threshold bars, piano keys and a dashed centre line, their names boxed at the
//   ends (grass ones brown);
// - terminals blue with a light outline, hangars darker, other buildings darker still;
// - close in (1 NM and less) the stands' yellow lead-in lines and stop bars, at 0.5 NM and less their names where
//   there is room;
// - the aircraft as the ND's yellow symbol, at its real size where that is bigger;
// - heading up (ARC, ROSE) or north up (PLAN), the compass round it as on the ND.
// FG.oans.draw(c, nd, side) draws it in the ND's 324 × 324 (src/fmgc.js drawNd; the 3D decks scale it).
// The same colours as the Rust app's (src/instruments.rs oans).
(function () {
  'use strict';
  const APRON = 'rgb(54,59,68)', TAXI = 'rgb(84,90,100)', RWY = 'rgb(34,36,41)', UNPAVED = 'rgb(70,62,46)';
  const PAINT = 'rgb(236,196,60)', PAINT_FAINT = 'rgba(236,196,60,0.67)';
  const TERMINAL = 'rgb(40,84,118)', TERMINAL_EDGE = 'rgb(110,166,206)';
  const HANGAR = 'rgb(44,66,84)', HANGAR_EDGE = 'rgb(88,124,148)', OTHER = 'rgb(40,54,66)';
  const WHITE = '#ffffff', GREEN = '#30d158', CYAN = '#3ccfff', AMBER = '#ffb000', YELLOW = '#ffd60a';
  const KT = 0.514444, R = Math.PI / 180;
  const W = 324, H = 324;

  // ---------- the airport round the aircraft ----------
  let nearAt = 0, nearCode = null;
  // The nearest airport within 8 km (its code), looked up every 2 s.
  function nearest(s) {
    const G = FG.game, now = performance.now();
    if (now - nearAt < 2000) return nearCode;
    nearAt = now; nearCode = null;
    if (!G || !G.airportByCode) return null;
    let bd = 8;
    const k = Math.max(0.05, Math.cos(s.lat * R));
    for (const a of Object.values(G.airportByCode)) {
      if (a.factory || Math.abs(a.lat - s.lat) > 0.1 || Math.abs(a.lon - s.lon) * k > 0.1) continue;
      const d = G.distanceKm({ lat: s.lat, lon: s.lon }, a);
      if (d < bd) { bd = d; nearCode = a.code; }
    }
    return nearCode;
  }
  const designator = (h) => String(Math.round((((h % 360) + 360) % 360) / 10) || 36).padStart(2, '0');
  const bearing = (a, b) => {
    const p1 = a[0] * R, p2 = b[0] * R, dl = (b[1] - a[1]) * R;
    return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / R;
  };
  // The map of that airport: its layout (null while it loads, or none) and its runways with their names.
  let mapKey = '', map = null;
  function airportMap(code) {
    if (!code) return null;
    const G = FG.game, L = FG.layouts;
    const lay = L ? L.get(code) : null;
    const rws = (G && G.airportRunways && G.airportRunways(code)) || [];
    const key = `${code}|${L ? L.version : 0}|${lay ? 1 : 0}|${rws.length}`;
    if (key === mapKey) return map;
    mapKey = key;
    map = {
      code, lay,
      rwys: rws.map((r) => ({ a: [r[0], r[1]], b: [r[2], r[3]], width: r[4] > 5 ? r[4] : 45, paved: !!r[5],
        names: [designator(bearing([r[0], r[1]], [r[2], r[3]])), designator(bearing([r[2], r[3]], [r[0], r[1]]))] })),
    };
    return map;
  }
  // The aircraft's length and span (m), from the game's looks.
  function size(s) {
    const look = (FG.data && FG.data.looks && FG.data.looks[s.type]) || {};
    return [look.len || 40, look.span || 36];
  }

  // ---------- the picture ----------
  // nd: { mode (ROSE LS, ROSE VOR, ROSE, ARC, PLAN), range (NM) }
  function draw(c, nd, side = 0) {
    const s = FG.pilot.state;
    const mode = nd.mode, arc = mode === 'ARC', plan = mode === 'PLAN';
    // (the compass where the ND has it: ARC's arc low, ROSE and PLAN round the middle)
    const cx = W / 2, cy = arc ? H - 44 : H / 2 + 6, rad = arc ? 238 : 118;
    const rng = arc ? nd.range : nd.range / 2, ppm = rad / (rng * 1852);
    const hdg = plan ? 0 : (((s.psi || 0) % 360) + 360) % 360;
    const ch = Math.cos(hdg * R), sh = Math.sin(hdg * R), kx = Math.cos(s.lat * R);
    const proj = (p) => {
      const e = (p[1] - s.lon) * 111320 * kx, n = (p[0] - s.lat) * 111320;
      return [cx + (e * ch - n * sh) * ppm, cy - (n * ch + e * sh) * ppm];
    };
    // (on the screen, or near it)
    const seen = (q, pad = 0) => {
      let lx = 1e9, ly = 1e9, hx = -1e9, hy = -1e9;
      for (const [x, y] of q) { if (x < lx) lx = x; if (x > hx) hx = x; if (y < ly) ly = y; if (y > hy) hy = y; }
      return hx + pad >= -4 && lx - pad <= W + 4 && hy + pad >= -4 && ly - pad <= H + 4;
    };
    // (a direction on the screen for a true heading: x right, y down)
    const way = (brg) => [Math.sin((brg - hdg) * R), -Math.cos((brg - hdg) * R)];
    const fill = (q, col) => { c.beginPath(); q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = col; c.fill(); };
    const poly = (q, lw, col, close) => {
      c.beginPath(); q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath();
      c.lineWidth = lw; c.strokeStyle = col; c.stroke();
    };
    const line = (a, b, lw, col) => { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineWidth = lw; c.strokeStyle = col; c.stroke(); };
    const fs = 18;

    c.save();
    c.fillStyle = '#000'; c.beginPath(); c.roundRect ? c.roundRect(0, 0, W, H, 10) : c.rect(0, 0, W, H); c.fill();
    c.beginPath(); c.rect(0, 0, W, H); c.clip();
    c.lineCap = 'butt'; c.lineJoin = 'round'; c.textBaseline = 'middle';
    const code = nearest(s), m = airportMap(code), L = m && m.lay;
    if (m) {
      // the pavement: aprons, then the taxiways as wide as they are
      if (L) for (const a of L.aprons || []) { const q = a.map(proj); if (q.length > 2 && seen(q)) fill(q, APRON); }
      const tw = Math.max(1.5, 23 * ppm);
      const taxis = L ? (L.taxiways || []).map((t) => t.map(proj)).filter((q) => q.length > 1 && seen(q, tw)) : [];
      c.lineCap = 'round';
      for (const q of taxis) poly(q, tw, TAXI);
      c.lineCap = 'butt';
      // the runways: dark, white edges, threshold bars and piano keys, the dashed centre line
      for (const rw of m.rwys) {
        const a = proj(rw.a), b = proj(rw.b), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.max(1e-3, Math.hypot(dx, dy));
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, half = Math.max(1.5, (rw.width / 2) * ppm);
        const quad = [[a[0] + nx * half, a[1] + ny * half], [b[0] + nx * half, b[1] + ny * half], [b[0] - nx * half, b[1] - ny * half], [a[0] - nx * half, a[1] - ny * half]];
        if (!seen(quad, fs * 2)) continue;
        fill(quad, rw.paved ? RWY : UNPAVED);
        if (!rw.paved) continue;
        const lw = Math.max(0.8, Math.min(2, 0.9 * ppm));
        line(quad[0], quad[1], lw, WHITE); line(quad[3], quad[2], lw, WHITE);
        const lenM = len / ppm;
        // (along the runway from end a, metres; across it from its middle, metres)
        const at = (along, across) => [a[0] + ux * along * ppm + nx * across * ppm, a[1] + uy * along * ppm + ny * across * ppm];
        for (const [start, sign] of [[0, 1], [lenM, -1]]) {
          line(at(start, -rw.width / 2), at(start, rw.width / 2), Math.max(1, 3 * ppm), WHITE);
          // the piano keys, 30 m long, when they can be told apart
          if (1.8 * ppm >= 1) {
            const n = Math.max(2, Math.floor((rw.width - 6) / 3.6));
            for (let k = 0; k < n; k++) {
              const y = -rw.width / 2 + 3 + 1.8 + (k * (rw.width - 6 - 1.8)) / (n - 1);
              if (Math.abs(y) < 2.5) continue;
              line(at(start + sign * 6, y), at(start + sign * 36, y), 1.8 * ppm, WHITE);
            }
          }
        }
        if (30 * ppm >= 3) { for (let x = 80; x + 30 < lenM - 80; x += 50) line(at(x, 0), at(x + 30, 0), Math.max(1, 0.9 * ppm), WHITE); }
        else line(at(60, 0), at(lenM - 60, 0), 0.8, 'rgba(255,255,255,0.6)');
      }
      // the taxiways' yellow centre lines (thin and faint while the taxiways are narrow on the screen)
      const [clw, ccol] = tw >= 4 ? [Math.max(1, Math.min(1.8, tw * 0.1)), PAINT] : [0.7, PAINT_FAINT];
      for (const q of taxis) poly(q, clw, ccol);
      // the buildings
      if (L) {
        for (const [list, col, edge] of [[L.others, OTHER, null], [L.hangars, HANGAR, HANGAR_EDGE], [L.terminals, TERMINAL, TERMINAL_EDGE]]) {
          for (const r of list || []) {
            const q = r.map(proj);
            if (q.length < 3 || !seen(q)) continue;
            fill(q, col);
            if (edge) poly(q, 1, edge, true);
          }
        }
      }
      // the stands close in: the yellow lead-in line to the stop bar, the stand's name where it has room
      if (L && nd.range <= 1) {
        const taken = [];
        c.font = `${Math.round(fs * 0.5)}px ui-monospace, Consolas, monospace`; c.textAlign = 'center'; c.fillStyle = WHITE;
        for (const st of L.stands || []) {
          const p = proj(st);
          if (p[0] < -4 || p[0] > W + 4 || p[1] < -4 || p[1] > H + 4) continue;
          const [dx, dy] = way(st[2] || 0);
          const f = [p[0] + dx * 18 * ppm, p[1] + dy * 18 * ppm], b = [p[0] - dx * 40 * ppm, p[1] - dy * 40 * ppm];
          line(f, b, 1, PAINT);
          const k = Math.max(2, 5 * ppm);
          line([f[0] - dy * k, f[1] + dx * k], [f[0] + dy * k, f[1] - dx * k], 1.4, PAINT);
          if (nd.range <= 0.5 && st[3]) {
            const t = [b[0] - dx * fs * 0.4, b[1] - dy * fs * 0.4], hw = c.measureText(st[3]).width / 2 + 1;
            const bx = [t[0] - hw, t[1] - fs * 0.3, t[0] + hw, t[1] + fs * 0.3];
            if (!taken.some((o) => bx[0] < o[2] && o[0] < bx[2] && bx[1] < o[3] && o[1] < bx[3])) { c.fillText(st[3], t[0], t[1]); taken.push(bx); }
          }
        }
      }
      // the runways' names in boxes at their ends
      const k = nd.range >= 2 ? 0.55 : 0.7;
      c.font = `${Math.round(fs * k)}px ui-monospace, Consolas, monospace`; c.textAlign = 'center';
      for (const rw of m.rwys) {
        const a = proj(rw.a), b = proj(rw.b), len = Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]));
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        for (const [q, name, sgn] of [[a, rw.names[0], -1], [b, rw.names[1], 1]]) {
          const t = [q[0] + sgn * ux * fs * 0.9, q[1] + sgn * uy * fs * 0.9];
          if (t[0] < 0 || t[0] > W || t[1] < 0 || t[1] > H) continue;
          const hw = c.measureText(name).width / 2 + fs * 0.2, hh = fs * k * 0.65;
          c.fillStyle = '#000'; c.fillRect(t[0] - hw, t[1] - hh, hw * 2, hh * 2);
          c.strokeStyle = WHITE; c.lineWidth = 1; c.strokeRect(t[0] - hw, t[1] - hh, hw * 2, hh * 2);
          c.fillStyle = WHITE; c.fillText(name, t[0], t[1] + 0.5);
        }
      }
    }

    // the compass round the aircraft as on the ND, a dashed ring at half the range with its distance
    const [a0, a1] = arc ? [-90, 90] : [-180, 180];
    c.strokeStyle = WHITE; c.lineWidth = 1;
    for (let a = a0; a < a1; a += 7) { c.beginPath(); c.arc(cx, cy, rad * 0.5, (a - 90) * R, (a + 3 - 90) * R); c.stroke(); }
    const half = String(Number((rng * 0.5).toFixed(2)));
    c.fillStyle = CYAN; c.font = '11px ui-monospace, Consolas, monospace'; c.textAlign = 'center';
    c.fillText(half, cx + Math.sin(-58 * R) * rad * 0.5, cy - Math.cos(-58 * R) * rad * 0.5);
    c.lineWidth = 1.4; c.beginPath(); c.arc(cx, cy, rad, (a0 - 90) * R, (a1 - 90) * R); c.stroke();
    c.font = '11px ui-monospace, Consolas, monospace'; c.fillStyle = WHITE; c.lineWidth = 1.2;
    for (let i = 0; i < 72; i++) {
      const a = ((i * 5 - hdg + 540) % 360) - 180;
      if (arc && Math.abs(a) > 88) continue;
      const dx = Math.sin(a * R), dy = -Math.cos(a * R), out = i % 2 ? 1.02 : 1.04;
      line([cx + dx * rad, cy + dy * rad], [cx + dx * rad * out, cy + dy * rad * out], 1.2, WHITE);
      if (i % 6 === 0 && (!arc || Math.abs(a) < 80)) c.fillText(String((i * 5) / 10), cx + dx * (rad - 12), cy + dy * (rad - 12));
    }
    if (!plan) { c.fillStyle = YELLOW; c.fillRect(cx - 1, cy - rad - 14, 2, 12); }

    // the aircraft: the ND's yellow symbol, as big as the aircraft where that is bigger, its nose its way
    const [len, span] = size(s), kk = Math.max(1, (len * ppm) / 28);
    const [bx, by] = way(s.psi || 0);
    const pt = (fwd, right) => [cx + bx * fwd - by * right, cy + by * fwd + bx * right];
    c.lineCap = 'butt';
    const wing = Math.max(13, (span * ppm) / 2);
    line(pt(14 * kk, 0), pt(-14 * kk, 0), 3, YELLOW);
    line(pt(3 * kk, -wing), pt(3 * kk, wing), 3, YELLOW);
    line(pt(-10 * kk, -6 * kk), pt(-10 * kk, 6 * kk), 3, YELLOW);

    // GS and TAS (top left), the airport (top right), ZOOM and the range (bottom)
    c.font = '600 11px ui-monospace, Consolas, monospace'; c.textAlign = 'left';
    c.fillStyle = WHITE; c.fillText('GS', 8, 13); c.fillStyle = GREEN; c.fillText(String(Math.round(((s.gsMs != null ? s.gsMs : s.V * Math.cos(s.gamma || 0)) || 0) / KT)), 28, 13);
    c.fillStyle = WHITE; c.fillText('TAS', 62, 13); c.fillStyle = GREEN; c.fillText(String(Math.round((s.V || 0) / KT)), 88, 13);
    c.textAlign = 'right'; c.fillStyle = WHITE;
    if (m) {
      c.font = '600 14px ui-monospace, Consolas, monospace'; c.fillText(m.code, W - 8, 14);
      if (!L && FG.layouts && FG.layouts.pending && FG.layouts.pending(m.code)) { c.textAlign = 'center'; c.font = '600 13px ui-monospace, Consolas, monospace'; c.fillText('PLEASE WAIT', W / 2, 44); }
    } else { c.textAlign = 'center'; c.fillStyle = AMBER; c.font = '600 14px ui-monospace, Consolas, monospace'; c.fillText('NO AIRPORT NEARBY', W / 2, 96); }
    c.font = '10px ui-monospace, monospace'; c.textAlign = 'left'; c.fillStyle = WHITE;
    c.fillText(`${mode === 'ROSE' ? 'ROSE NAV' : mode}  ${nd.range} NM`, 8, H - 10);
    c.textAlign = 'right'; c.fillStyle = CYAN; c.fillText('ZOOM', W - 8, H - 10);
    c.restore();
    void side;
    return m;
  }

  FG.oans = { draw, nearest, airportMap };
})();
