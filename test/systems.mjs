#!/usr/bin/env node
// Systems test for the fly page (src/systems.js, src/cockpit3d.js): an A320 lined up at Zurich. Its 3D flight deck is
// built; the switches start where a crew would have them and reach the 3D aircraft's lights; real mouse clicks on
// the 3D overhead, FCU and pedestal move their switches; an engine fire is fought (FIRE pushbutton, AGENT 1) with the
// master warning and the procedure on the E/WD; an engine shut down with its master starts again with IGN and the
// APU's bleed; the overhead page (0) works; a checkpoint keeps the switches. Saves screenshots of the deck when
// SHOTS=<dir> is set. Fails on any script error, console.error or missing file of our own.
//
//   node test/systems.mjs          (needs Node 22+ and Chrome or Chromium; CHROME=/path overrides)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_RUN_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const warnings = [];

// ---------- static server on a free port ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (file.endsWith('/')) file += 'index.html';
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------- headless Chrome ----------
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* next */ }
  }
  throw new Error('No Chrome or Chromium found (set CHROME=/path/to/chrome)');
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-fly-systems-'));
const chrome = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-sandbox', '--window-size=1400,900',
  // on a desktop the real graphics chip (the hand-flown plane steps once a frame: software 3D draws about one a second
  // and sometimes none for a minute); elsewhere (CI, SOFT3D=1) software
  ...(!process.env.SOFT3D && (process.env.WAYLAND_DISPLAY || process.env.DISPLAY)
    ? ['--enable-gpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  '--autoplay-policy=no-user-gesture-required', // (the aircraft sounds start without a real click)
  '--mute-audio', // (... and are measured, not heard: the meter and spectrum still work)
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  // (not the user's ~/.config/chromium-flags.conf, which Arch's chromium reads: Omarchy's extensions and Wayland flags
  // there made the page hidden after the start, so the game drew nothing and half the steps failed)
  env: { ...process.env, XDG_CONFIG_HOME: profile },
});
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}) before it was ready`)));
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  chrome.kill('SIGKILL');
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Chrome still writing: left for the OS */ }
  process.exit(code);
}
setTimeout(() => { console.error(`✗ smoke test took longer than ${MAX_RUN_MS / 60000} min`); finish(1); }, MAX_RUN_MS).unref();

// ---------- DevTools protocol ----------
const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const handlers = [];
browser.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
  } else if (msg.method) for (const h of handlers) h(msg);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  browser.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cmd = (method, params) => send(method, params, sessionId);

const ours = (url) => url && url.startsWith(ORIGIN);
const where = (st) => {
  const f = st && st.callFrames && st.callFrames[0];
  return f ? ` (${f.url.replace(ORIGIN, '')}:${f.lineNumber + 1})` : '';
};
const requests = new Map();
handlers.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  const p = msg.params;
  switch (msg.method) {
    case 'Runtime.exceptionThrown': {
      const d = p.exceptionDetails;
      const text = (d.exception && d.exception.description) || d.text;
      const url = d.url || (d.stackTrace && d.stackTrace.callFrames[0] && d.stackTrace.callFrames[0].url) || '';
      // A script from a CDN failing is the network's fault; ours failing is a bug.
      if (url && !ours(url) && !text.includes(ORIGIN)) warnings.push(`script error in ${url}: ${text.split('\n')[0]}`);
      else errors.push(`exception: ${text}`);
      break;
    }
    case 'Runtime.consoleAPICalled':
      if (p.type === 'error' || p.type === 'assert') {
        const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
        // (a map tile that did not come is the network's fault, not ours)
        if (/AJAXError: .*https?:\/\/(?!127\.0\.0\.1)/.test(text)) { warnings.push(`map tile: ${text.split('\n')[0]}`); break; }
        errors.push(`console.${p.type}: ${text}${where(p.stackTrace)}`);
      }
      break;
    case 'Network.requestWillBeSent': requests.set(p.requestId, p.request.url); break;
    case 'Network.responseReceived':
      // (the airport editor asks whether ./play.sh's server is there: not on a plain server)
      if (ours(p.response.url) && p.response.status >= 400 && !/\/__(fixes|checks|bugs)\b/.test(p.response.url)) errors.push(`HTTP ${p.response.status}: ${p.response.url.replace(ORIGIN, '')}`);
      break;
    case 'Network.loadingFailed': {
      const url = requests.get(p.requestId) || '?';
      if (p.canceled) break;
      if (ours(url)) errors.push(`failed to load ${url.replace(ORIGIN, '')}: ${p.errorText}`);
      else if (p.type === 'Script') warnings.push(`could not load ${url}: ${p.errorText}`);
      break;
    }
  }
});
await cmd('Runtime.enable');
await cmd('Network.enable');
await cmd('Page.enable');
// (headless Chrome here marks the page hidden after a while: the game then stops its sound, and the sound steps hung)
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });

async function evaluate(fn, ...args) {
  const r = await cmd('Runtime.evaluate', {
    expression: `(() => { const G = window.FG && FG.game; return (${fn})(...${JSON.stringify(args)}); })()`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(`in page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(fn, ms, what, ...args) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(fn, ...args).catch(() => false)) return true;
    await sleep(250);
  }
  if (what) throw new Error(`timed out waiting for ${what}`);
  return false;
}
const key = (k) => evaluate((k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), k);
const step = (s) => console.log(`· ${s}`);

// ---------- the test ----------
const SHOTS = process.env.SHOTS;
// a screen of the 3D deck on its own (its canvas), into SHOTS
async function screenShot(kind, name) {
  if (!SHOTS) return;
  const url = await evaluate((kind) => FG.cockpit3d.pit.screens.find((x) => x.kind === kind).cv.toDataURL('image/png'), kind);
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}
async function shot(name) {
  if (!SHOTS) return;
  await sleep(600);
  const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
// A real click on a control of FlightGear's flight deck (src/fgdeck.js), found by its label: the head turns to it,
// then its middle is projected through the deck's camera.
async function clickFg(label, button = 'left', accept = [label], near = false) {
  const p = await evaluate((label, near) => FG.cockpit3d.fgSpot(label, near), label, near);
  if (!p) throw new Error(`no control "${label}" on the deck`);
  const ex = await evaluate(() => FG.cockpit3d.EYE_X), lookDown = await evaluate(() => FG.pilot.LOOK_DOWN);
  const [dx, dy, dz] = [p[0] + ex, p[1], p[2]];
  await look(Math.atan2(dx, dy) * 180 / Math.PI, Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI + lookDown);
  const at = await evaluate((p) => {
    const v = FG.cockpit3d.project(p), r = FG.view3d.map.getCanvas().getBoundingClientRect();
    return { x: r.left + (v[0] + 1) / 2 * r.width, y: r.top + (1 - v[1]) / 2 * r.height, z: v[2] };
  }, p);
  if (at.z > 1 || at.z < -1) throw new Error(`"${label}" is behind the camera`);
  const hit = await evaluate((x, y) => FG.cockpit3d.hitAt(x, y).tip, at.x, at.y);
  if (!accept.includes(hit)) throw new Error(`a click aimed at "${label}" meets "${hit}"`);
  const n0 = await evaluate(() => FG.cockpit3d.clickCount);
  // (the click lands when the page gets to it, busy drawing: a moment later, or not at all: then once more)
  for (let i = 0; i < 3; i++) {
    const b = button === 'right' ? 'right' : 'left';
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: b, clickCount: 1 });
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: b, clickCount: 1 });
    if (await waitFor((n0) => FG.cockpit3d.clickCount > n0, 4000, null, n0)) break;
    if (i === 2) throw new Error(`the click on "${label}" never landed`);
  }
  await frame();
  if (process.env.DEBUG) console.log('   ', label, JSON.stringify(await evaluate(() => ({ clicks: FG.cockpit3d.clicks.slice(-1), cover: FG.cockpit3d.pit.fg.deck.get('controls/engines/engine/fire-btn-cover'), btn: FG.cockpit3d.pit.fg.deck.get('controls/engines/engine/fire-btn'), pb: FG.systems.S.eng[0].firePb }))));
  await look(FG_LOOK.yaw, FG_LOOK.pitch);
}
// a frame drawn (the deck's clicks are carried out and its switches set as the systems have them, once a frame)
async function frame() {
  const t0 = await evaluate(() => { FG.view3d.map.triggerRepaint(); return performance.now(); });
  await waitFor((t0) => { FG.view3d.map.triggerRepaint(); return FG.cockpit3d.drawnAt > t0 + 30; }, 10000, 'a frame drawn', t0);
}
const FG_LOOK = { yaw: 0, pitch: 0 };
// Turn the head, then wait for a frame drawn with it (headless Chrome draws few frames a second).
async function look(yaw, pitch) {
  const t0 = await evaluate((yaw, pitch) => { FG.view3d.look.yaw = yaw; FG.view3d.look.pitch = pitch; FG.view3d.map.triggerRepaint(); return performance.now(); }, yaw, pitch);
  await waitFor((t0) => { FG.view3d.map.triggerRepaint(); return FG.cockpit3d.drawnAt > t0 + 50; }, 10000, 'a frame with the head turned', t0);
}
const S = () => evaluate(() => JSON.parse(JSON.stringify(FG.systems.S)));

try {
  step(`loading ${ORIGIN}/?from=ZRH`);
  await cmd('Page.navigate', { url: `${ORIGIN}/?from=ZRH` });
  await waitFor(() => window.FG && FG.pilot && FG.view3d && FG.view3d.map && FG.game.state && FG.systems, 90000, 'the fly page with its 3D view and the systems');
  // (the map's style comes from tiles.openfreemap.org: a fetch of it that failed is the network's, so load again)
  for (let i = 0; i < 3 && !await waitFor(() => FG.view3d.map.isStyleLoaded(), 30000); i++) {
    step('the map\'s style did not load: loading the page again');
    await cmd('Page.reload', {});
    await sleep(2000);
    await waitFor(() => window.FG && FG.pilot && FG.view3d && FG.view3d.map && FG.game.state && FG.systems, 90000, 'the fly page with its 3D view and the systems');
  }
  await waitFor(() => !!document.getElementById('pilot-start'), 20000, 'the start screen');
  await evaluate(() => { const el = document.getElementById('pilot-start'); if (el) el.remove(); });

  step('an A320 lined up at Zurich: its systems start as a crew would have them, the lights reach the 3D aircraft');
  await evaluate(() => {
    const r = G.airportRunways('ZRH')[0];
    const course = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
    FG.pilot.start({ type: 'A320', mode: 'runway', end: { code: 'ZRH', lat: r[0], lon: r[1], far: [r[2], r[3]], course, len: G.runwayLength(r), width: 45, name: 'T' } });
  });
  await waitFor(() => FG.pilot.active && !FG.pilot.state.loading && FG.systems.ready(), 20000, 'the A320 to be ready');
  let st = await S();
  if (st.lt.strobe !== 'ON' || st.lt.land !== 'ON' || !st.lt.beacon || !st.signs.belts || st.eng.length !== 2 || !st.eng.every((e) => e.run && e.master)) errors.push(`switches at the start: ${JSON.stringify({ lt: st.lt, signs: st.signs, eng: st.eng })}`);
  const lights = await evaluate(() => FG.pilot.pose().pilot.lights);
  if (!lights || lights.strobe !== 1 || lights.beacon !== 1 || lights.land !== 1) errors.push(`pose().pilot.lights: ${JSON.stringify(lights)}`);
  if (!await evaluate(() => document.querySelector('#pilot-hud [data-pl="ovhd"]') !== null || new Promise((r) => setTimeout(() => r(!!document.querySelector('#pilot-hud [data-pl="ovhd"]')), 800)))) errors.push('no 🔆 Overhead button in the HUD bar');

  step('its 3D flight deck: FlightGear\'s real A320 deck (cockpits/A320-family.fgck), six screens and the standby instrument');
  await evaluate(() => { FG.pilot.state.cam = 'cockpit'; FG.view3d.pilotCam('cockpit'); });
  await waitFor(() => { FG.view3d.map.triggerRepaint(); return FG.cockpit3d.pit && FG.cockpit3d.pit.kind === 'a320' && !!FG.cockpit3d.pit.fg; }, 40000, 'the A320\'s FlightGear deck to be drawn');
  const deck = await evaluate(() => ({ screens: FG.cockpit3d.pit.screens.map((x) => x.kind), controls: FG.cockpit3d.pit.clickables.length, eyeX: FG.cockpit3d.EYE_X, fcuHidden: !FG.fcu || !document.getElementById('fcu') || document.getElementById('fcu').hidden }));
  if (deck.screens.join() !== 'pfd,nd,ewd,sd,nd,pfd,isis' || deck.controls < 300 || !(deck.eyeX > 0.3 && deck.eyeX < 0.7)) errors.push(`the A320 deck: ${JSON.stringify(deck)}`);
  if (!await waitFor(() => { const f = document.getElementById('fcu'); return !f || f.hidden; }, 4000)) {
    errors.push(`the FCU window stayed over the view in the 3D deck: ${JSON.stringify(await evaluate(() => ({ hidden: document.getElementById('fcu').hidden, hit: FG.cockpit3d.hitAt(0, 0), cam: FG.pilot.cam, type: FG.pilot.type, ago: performance.now() - FG.cockpit3d.drawnAt })))}`);
  }
  await sleep(1500);
  const ewdLit = await evaluate(() => { const sc = FG.cockpit3d.pit.screens.find((x) => x.kind === 'ewd'); const d = sc.ctx.getImageData(0, Math.round(sc.cv.height * 0.55), sc.cv.width, Math.round(sc.cv.height * 0.4)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++; return n; });
  if (ewdLit < 200) errors.push(`the E/WD's memo stayed blank (${ewdLit} lit pixels)`);
  await shot('a320-ahead');

  step('real clicks: the overhead\'s STROBE and BEACON, the FCU\'s FD and ALT knob, the EFIS\'s ND RANGE, MODE and VOR/ADF switch (pressed), the pedestal\'s ENG 2 master');
  await look(55, 62);
  await shot('a320-overhead');
  // (the strobe switch: a right click moves it down a position, ON to AUTO; the beacon: a click toggles it)
  await clickFg('Strobe lights switch', 'right');
  st = await S();
  if (st.lt.strobe !== 'AUTO') errors.push(`a click on STROBE: ${st.lt.strobe} (wanted AUTO)`);
  await clickFg('Beacon lights switch');
  st = await S();
  if (st.lt.beacon !== 0) errors.push(`a click on BEACON: ${st.lt.beacon} (wanted 0)`);
  if ((await evaluate(() => FG.pilot.pose().pilot.lights.beacon)) !== 0) errors.push('the beacon switched off stayed on on the 3D aircraft');
  // (the deck's switch follows the systems: STROBE set on the overhead page)
  await evaluate(() => FG.systems.set('strobe', 'OFF'));
  await frame();
  if (await evaluate(() => FG.cockpit3d.pit.fg.deck.get('controls/switches/strobe')) !== 0) errors.push('STROBE OFF on the overhead page: the deck\'s switch stayed');
  await evaluate(() => FG.systems.set('strobe', 'AUTO'));
  await look(0, 0);
  await sleep(400);
  // (FD: AP1 does not engage on the ground)
  const fd0 = await evaluate(() => FG.fmgc.F.fd);
  await clickFg('Toggle FD1');
  const fd1 = await evaluate(() => FG.fmgc.F.fd);
  if (fd1 === fd0) errors.push(`a click on FD did nothing (${fd0} → ${fd1})`);
  await clickFg('Toggle FD1');
  const alt0 = await evaluate(() => FG.fmgc.F.fcu.alt);
  // (the ALT knob: the wheel turns it)
  await evaluate(() => { const dk = FG.cockpit3d.pit.fg.deck; const k = dk.def.picks.findIndex((p) => p.label.startsWith('Scroll for altitude target')); dk.press([k], 3); });
  await frame();
  const alt1 = await evaluate(() => FG.fmgc.F.fcu.alt);
  if (alt1 === alt0) errors.push(`the ALT knob did not turn (${alt0} → ${alt1})`);
  // (the EFIS: the ND's RANGE and MODE knobs by the wheel, a click on the VOR/ADF switch 1)
  const nd0 = await evaluate(() => ({ ...FG.fmgc.F.nd }));
  await evaluate(() => { const dk = FG.cockpit3d.pit.fg.deck, k = (l) => dk.def.picks.findIndex((p) => p.label === l); dk.press([k('ND range')], 3); dk.press([k('ND mode')], 3); });
  await frame();
  const nd1 = await evaluate(() => ({ ...FG.fmgc.F.nd }));
  if (nd1.range !== nd0.range * 2) errors.push(`the ND RANGE knob did not turn the range up (${nd0.range} → ${nd1.range})`);
  if (nd0.mode !== 'ARC' || nd1.mode !== 'PLAN') errors.push(`the ND MODE knob did not turn ARC to PLAN (${nd0.mode} → ${nd1.mode})`);
  await evaluate(() => { const dk = FG.cockpit3d.pit.fg.deck, k = (l) => dk.def.picks.findIndex((p) => p.label === l); dk.press([k('ND range')], 4); dk.press([k('ND mode')], 4); dk.press([k('Toggle VOR1 / ADF1')], 0); });
  await frame();
  const nd2 = await evaluate(() => ({ ...FG.fmgc.F.nd, needle: [...FG.fmgc.F.nd.needle] }));
  if (nd2.needle[0] !== 'VOR') errors.push(`a click on the VOR/ADF switch 1 did not show the VOR needle (${nd2.needle[0]})`);
  if (nd2.mode !== 'ARC' || nd2.range !== nd0.range) errors.push(`the ND knobs did not turn back (${nd2.mode} ${nd2.range})`);
  await evaluate(() => { FG.fmgc.F.nd.needle[0] = 'OFF'; });
  // (each pilot's own EFIS: the captain's knobs left the first officer's ND; RANGE left of 10 NM is ZOOM, the airport
  // map at the range it had last, on down to 0.2 NM and back; TERR ON ND the captain's on at the start, each its own
  // button and light; ARPT lit at the start, CSTR takes over, one at a time)
  const efis = await evaluate(async () => {
    const dk = FG.cockpit3d.pit.fg.deck, F = FG.fmgc.F, out = [];
    const picks = (l) => dk.def.picks.map((p, i) => (p.label === l ? i : -1)).filter((i) => i >= 0);
    const frame = () => new Promise((r) => { const t0 = performance.now(); const go = () => { FG.view3d.map.triggerRepaint(); if (FG.cockpit3d.drawnAt > t0 + 30) r(); else setTimeout(go, 50); }; go(); });
    const [rng] = picks('ND range'), [mode] = picks('ND mode');
    const fo0 = { ...F.nds[1] };
    dk.press([mode], 4); await frame();
    if (F.nds[0].mode !== 'ROSE') out.push(`MODE one click left of ARC: ${F.nds[0].mode} (wanted ROSE NAV)`);
    dk.press([mode], 4); await frame();
    if (F.nds[0].mode !== 'ROSE VOR') out.push(`MODE two clicks left of ARC: ${F.nds[0].mode} (wanted ROSE VOR)`);
    if (F.nds[1].mode !== fo0.mode || F.nds[1].range !== fo0.range) out.push(`the F/O's ND moved with the captain's knobs (${F.nds[1].mode} ${F.nds[1].range})`);
    dk.press([mode], 3); dk.press([mode], 3); await frame();
    if (F.nds[0].mode !== 'ARC') out.push(`MODE back to ARC: ${F.nds[0].mode}`);
    FG.fmgc.setRange(0, 10); await frame();
    dk.press([rng], 4); await frame();
    if (!(F.nds[0].range < 10 && F.nds[0].range === F.nds[0].zoom)) out.push(`RANGE left of 10 NM: ${F.nds[0].range} (wanted ZOOM at ${F.nds[0].zoom})`);
    for (let i = 0; i < 6; i++) { dk.press([rng], 4); await frame(); }
    if (F.nds[0].range !== 0.2) out.push(`ZOOM's shortest range: ${F.nds[0].range} (wanted 0.2)`);
    for (let i = 0; i < 5; i++) { dk.press([rng], 3); await frame(); }
    if (F.nds[0].range !== 10) out.push(`out of ZOOM again: ${F.nds[0].range} (wanted 10)`);
    F.nds[0].range = 40;
    const S = FG.systems.S.misc;
    if (S.terrNd[0] !== 1 || S.terrNd[1] !== 0) out.push(`TERR ON ND at the start: ${S.terrNd} (wanted 1,0)`);
    await frame();
    if (dk.get('controls/indicators/terr-on-nd-capt') !== 1) out.push('the captain\'s TERR ON ND not lit');
    const terr = picks('Show terrain on ND');
    if (terr.length !== 2) out.push(`TERR ON ND buttons: ${terr.length} (wanted 2)`);
    for (const k of terr) { dk.press([k], 0); await frame(); }
    if (S.terrNd[0] !== 0 || S.terrNd[1] !== 1) out.push(`both TERR ON ND pressed: ${S.terrNd} (wanted 0,1)`);
    if (dk.get('controls/indicators/terr-on-nd-fo') !== 1) out.push('the F/O\'s TERR ON ND not lit');
    for (const k of terr) { dk.press([k], 0); await frame(); }
    if (F.nds[0].opt !== 'ARPT' || dk.get('controls/indicators/efis-capt-arpt') !== 1) out.push(`ARPT at the start: ${F.nds[0].opt}, light ${dk.get('controls/indicators/efis-capt-arpt')}`);
    const [cstr] = picks('Toggle CSTR layer');
    dk.press([cstr], 0); await frame();
    if (F.nds[0].opt !== 'CSTR') out.push(`CSTR pressed: ${F.nds[0].opt}`);
    if (dk.get('controls/indicators/efis-capt-arpt') !== 0 || dk.get('controls/indicators/efis-capt-cstr') !== 1) out.push('CSTR pressed: the ARPT and CSTR lights did not follow');
    if (F.nds[1].opt !== 'ARPT') out.push(`the F/O's EFIS option moved with the captain's: ${F.nds[1].opt}`);
    dk.press([cstr], 0); FG.fmgc.press('ND ARPT'); await frame();
    return out;
  });
  errors.push(...efis);
  // (the airport map: the captain's ND at ZOOM 1 NM draws Zurich's aprons, taxiways and their yellow lines, the
  // runway's white paint; the first officer's at 40 NM does not)
  await evaluate(() => FG.fmgc.setRange(0, 1));
  await waitFor(() => FG.layouts.has('ZRH'), 15000);
  await sleep(2500);
  const zoom = await evaluate(() => {
    const count = (sc) => {
      const d = sc.ctx.getImageData(0, 0, sc.cv.width, sc.cv.height).data, near = (i, c) => Math.abs(d[i] - c[0]) < 14 && Math.abs(d[i + 1] - c[1]) < 14 && Math.abs(d[i + 2] - c[2]) < 14;
      const n = { apron: 0, taxi: 0, paint: 0, white: 0 };
      for (let i = 0; i < d.length; i += 4) {
        if (near(i, [54, 59, 68])) n.apron++; else if (near(i, [84, 90, 100])) n.taxi++; else if (near(i, [236, 196, 60])) n.paint++;
        else if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n.white++;
      }
      return n;
    };
    const nds = FG.cockpit3d.pit.screens.filter((x) => x.kind === 'nd');
    return { cap: count(nds.find((x) => !x.side) || nds[0]), fo: nds.length > 1 ? count(nds.find((x) => x.side) || nds[1]) : null, code: FG.oans.nearest(FG.pilot.state) };
  });
  if (zoom.code !== 'ZRH') errors.push(`the airport map's airport: ${zoom.code} (wanted ZRH)`);
  if (zoom.cap.apron + zoom.cap.taxi < 2000 || zoom.cap.paint < 100 || zoom.cap.white < 200) errors.push(`the airport map at ZOOM 1 NM: ${JSON.stringify(zoom.cap)}`);
  if (zoom.fo && zoom.fo.paint > 50) errors.push(`the F/O's ND at 40 NM has the airport map's yellow lines: ${JSON.stringify(zoom.fo)}`);
  console.log('    airport map pixels:', JSON.stringify(zoom));
  await screenShot('nd', 'A320-zoom-1nm');
  await evaluate(() => { FG.fmgc.setRange(0, 0.5); });
  await sleep(1200);
  await screenShot('nd', 'A320-zoom-0.5nm');
  await evaluate(() => { const nd = FG.fmgc.F.nds[0]; FG.fmgc.setRange(0, 2); nd.mode = 'PLAN'; });
  await sleep(1200);
  await screenShot('nd', 'A320-zoom-2nm-plan');
  await evaluate(() => { const nd = FG.fmgc.F.nds[0]; nd.mode = 'ARC'; nd.range = 40; });
  await look(25, -40);
  await shot('a320-pedestal');
  // (the engine master: a right click turns it OFF)
  await clickFg('Right engine cutoff', 'right');
  st = await S();
  if (st.eng[1].master !== 0) errors.push(`a click on ENG 2's master left it ${st.eng[1].master}`);
  await look(0, 0);

  step('ENG 2 master off: it runs down and gives no thrust; IGN, the APU\'s bleed and the master on start it again');
  await waitFor(() => FG.pilot.state.n1[1] < FG.pilot.state.spec.idle - 5, 20000, 'ENG 2 to run down');
  await evaluate(() => { const y = FG.systems; y.set('apuMaster', 1); y.set('apuStart'); y.S.apu.n = 94.5; });
  await waitFor(() => FG.systems.S.apu.avail, 10000, 'the APU to be AVAIL');
  await evaluate(() => { const y = FG.systems; y.set('apuBleed', 1); y.set('engMode', 'IGN'); y.set('master', 1, 1); });
  if (!await waitFor(() => FG.systems.S.eng[1].start === 1 || FG.systems.S.eng[1].run === 1, 5000)) {
    throw new Error(`ENG 2 did not start: ${JSON.stringify(await evaluate(() => ({ eng: FG.systems.S.eng, mode: FG.systems.S.engMode, apu: FG.systems.S.apu, n1: FG.pilot.state.n1, paused: FG.pilot.state.paused, menu: FG.pilot.state.menu, crashed: FG.pilot.state.crashed, msgs: FG.pilot.state.msgs.map((m) => m.text) })))}`);
  }
  await evaluate(() => { FG.pilot.state.n1[1] = FG.pilot.state.spec.idle - 0.5; });
  await waitFor(() => FG.systems.S.eng[1].run === 1, 15000, 'ENG 2 to run again');

  step('ENG 1 FIRE: master warning, the chime, the procedure; the FIRE pushbutton and AGENT 1 put it out');
  await evaluate(() => { Math.random = () => 0.1; FG.systems.set('fail', 'fire', 0); }); // (the bottle always works here)
  await waitFor(() => FG.systems.S.mw, 3000, 'the master warning');
  const lines = await evaluate(() => FG.systems.ecamLines().map((l) => l[0]).join(' / '));
  if (!/ENG 1 FIRE/.test(lines) || !/ENG 1 FIRE P\/B/.test(lines) || !/AGENT 1/.test(lines)) errors.push(`the E/WD's procedure: ${lines}`);
  const hud = await evaluate(() => FG.systems.warnings().map((w) => w[0]).join(' / '));
  if (!/ENG 1 FIRE/.test(hud)) errors.push(`the HUD's warnings: ${hud}`);
  await look(80, 55);
  await shot('a320-fire');
  // (its guard up first: a click on it goes past the pushbutton in front, which does nothing while guarded)
  await clickFg('Engine 1 Fire Cover', 'left', ['Engine 1 Fire Pushbutton', 'Engine 1 Fire Cover'], true);
  await clickFg('Engine 1 Fire Pushbutton');
  st = await S();
  if (!st.eng[0].firePb) errors.push('a click on the ENG 1 FIRE pushbutton did not push it');
  // (AGENT 1: its control has no label; pressed on the deck)
  await evaluate(() => {
    const dk = FG.cockpit3d.pit.fg.deck, p = dk.at('controls/engines/engine/agent1-btn');
    const k = dk.def.picks.findIndex((pk) => JSON.stringify(pk.actions).includes(`{"Assign":[${p},`) || JSON.stringify(pk.actions).includes(`"Toggle":${p}}`));
    if (k >= 0) dk.press([k], 0);
  });
  await frame();
  // (its squib armed only once the FIRE pushbutton is out on the deck's own clock: the systems' AGENT 1 then)
  if (!(await S()).eng[0].agents[0]) await evaluate(() => FG.systems.set('agent', 0, 0));
  await waitFor(() => !FG.systems.S.eng[0].fire, 8000, 'the fire to go out');
  await waitFor(() => !FG.systems.S.mw, 3000, 'the master warning to go out');
  await waitFor(() => FG.pilot.state.n1[0] < FG.pilot.state.spec.idle - 5, 20000, 'ENG 1 to run down (its fuel cut)');
  await look(0, 0);

  step('the cockpit views: Ctrl + arrows move the head and the seat (overhead, pedestal, the first officer, the window)');
  {
    const ctrl = (k) => evaluate((k) => { for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: k, ctrlKey: true, bubbles: true })); }, k);
    const state = () => evaluate(() => ({ yaw: FG.view3d.look.yaw, pitch: FG.view3d.look.pitch, x: FG.cockpit3d.EYE_X }));
    const settle = async () => { for (let i = 0; i < 40; i++) { await evaluate(() => FG.view3d.map.triggerRepaint()); await sleep(100); } };
    await ctrl('Home'); await settle();
    const x0 = (await state()).x;
    await ctrl('ArrowUp'); await settle(); await shot('view-overhead');
    let st = await state();
    if (st.pitch < 50) errors.push(`Ctrl+↑ did not look up at the overhead: ${JSON.stringify(st)}`);
    await ctrl('ArrowDown'); await ctrl('ArrowDown'); await ctrl('ArrowRight'); await settle(); await shot('view-pedestal');
    st = await state();
    if (st.pitch > -30 || Math.abs(st.x) > 0.05) errors.push(`Ctrl+↓↓→ did not look at the pedestal from the middle: ${JSON.stringify(st)}`);
    await ctrl('ArrowUp'); await ctrl('ArrowRight'); await settle(); await shot('view-fo');
    st = await state();
    if (!(st.x < -0.3 && x0 > 0.3)) errors.push(`Ctrl+↑→ did not move to the first officer's seat: ${JSON.stringify(st)} (captain ${x0})`);
    await ctrl('ArrowRight'); await settle(); await shot('view-right-window');
    st = await state();
    if (st.yaw < 60) errors.push(`Ctrl+→ did not look out of the right window: ${JSON.stringify(st)}`);
    await ctrl('Home'); await settle();
  }

  step('the overhead page (0): it opens, its switches work; a checkpoint keeps the switches');
  await key('0');
  if (!await evaluate(() => FG.panels.isOpen('overhead'))) errors.push('0 did not open the overhead page');
  // (a real click on the page's picture: NAV & LOGO's lower half, from ON to OFF; the page is the overhead's modules)
  const navAt = await evaluate(() => {
    const p = FG.panels.pagePanel('overhead'), c = p.controls.find((x) => x.tip === 'NAV&LOGO light'), r = p.base.getBoundingClientRect();
    return { x: r.left + ((c.x + c.ox) / p.W) * r.width, y: r.top + ((c.y + c.oy + c.h * 0.3) / p.H) * r.height };
  });
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: navAt.x, y: navAt.y, button: 'left', clickCount: 1 });
  await sleep(150);
  if ((await S()).lt.nav !== 0) errors.push('the overhead page\'s NAV & LOGO OFF did nothing');
  // the new systems: the hydraulics, the fuel and the radios answer their switches
  const sys2 = await evaluate(() => {
    const y = FG.systems, out = [];
    y.set('engPump', 0, 0); y.set('ptu', 0);
    out.push(['HYD G pump off', y.S.hyd.engPump[0] === 0]);
    y.set('engPump', 1, 0); y.set('ptu', 1);
    y.set('xfeed'); out.push(['X FEED', y.S.fuel.xfeed === 1]); y.set('xfeed');
    out.push(['fuel loaded', y.S.fuel.L + y.S.fuel.R + y.S.fuel.C > 1000]);
    const was = y.S.radio.vhf.VHF1.stby; y.set('rmpTune', 4, 0); out.push(['RMP tunes', Math.abs(y.S.radio.vhf.VHF1.stby - was - 0.1) < 0.001 || y.S.radio.vhf.VHF1.stby === 118]);
    y.set('xpdrCode', '7700'); out.push(['squawk', y.S.radio.xpdr.code === '7700']); y.set('xpdrCode', '2000');
    y.set('ecp', 'HYD'); out.push(['SD page HYD', y.sdPage() === 'HYD']); y.set('ecp', 'HYD');
    out.push(['navaids loaded', (FG.navdata && FG.navdata.navaids.length) > 5000]);
    out.push(['VOR auto-tuned', !!(y.S.radio.nav.vor[0])]);
    return out.filter(([, ok]) => !ok).map(([n]) => n);
  });
  if (sys2.length) errors.push(`new systems: ${sys2.join(', ')}`);
  // every SD page and every ND option draws, every MCDU page shows (no script errors), the systems answer
  const draws = await evaluate(() => {
    const out = [], c = document.createElement('canvas'); c.width = 400; c.height = 400; const x = c.getContext('2d');
    for (const pg of ['BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'COND', 'DOOR', 'F/CTL', 'CRUISE', 'STS']) { try { if (!FG.systems.sd(x, 400, 400, pg)) out.push(`SD ${pg} not drawn`); } catch (e) { out.push(`SD ${pg}: ${e.message}`); } }
    for (const o of ['CSTR', 'WPT', 'VOR.D', 'NDB', 'ARPT', null]) { FG.fmgc.F.nd.opt = o; FG.fmgc.F.nd.needle = ['VOR', 'ADF']; try { FG.fmgc.drawNd(x, 0); } catch (e) { out.push(`ND ${o}: ${e.message}`); } }
    FG.fmgc.F.nd.opt = 'ARPT'; FG.fmgc.F.nd.needle = ['OFF', 'OFF'];
    FG.systems.S.misc.terrNd[0] = 1; try { FG.fmgc.drawNd(x, 0); } catch (e) { out.push(`ND TERR: ${e.message}`); } FG.systems.S.misc.terrNd[0] = 0;
    // (the first officer's ND, every MODE, and the airport map at each ZOOM range on both)
    { const F = FG.fmgc.F, keep = structuredClone(F.nds);
      for (const side of [0, 1]) for (const m of FG.fmgc.ND_MODES) for (const r of [5, 2, 1, 0.5, 0.2, 40]) {
        F.nds[side].mode = m; FG.fmgc.setRange(side, r);
        try { FG.fmgc.drawNd(x, side); } catch (e) { out.push(`ND ${side} ${m} ${r}: ${e.message}`); }
      }
      F.nds = keep; }
    FG.mcdu.show(true);
    for (const f of ['DATA', 'FUEL PRED', 'SEC F-PLN', 'ATC COMM', 'MCDU MENU', 'PERF', 'RAD NAV', 'INIT', 'F-PLN', 'PROG', 'DIR']) {
      const b = document.querySelector(`#mcdu [data-f="${f}"]`); if (!b) { out.push(`MCDU key ${f}`); continue; } b.click();
      const t = document.querySelector('#mcdu .mc-screen').textContent; if (/NOT AVAILABLE/.test(t)) out.push(`MCDU ${f} not available`);
    }
    // ATC COMM: an airport's ATIS by datalink (typed in: this flight has no flight plan)
    document.querySelector('#mcdu [data-f="ATC COMM"]').click();
    for (const k of 'GVA') document.querySelector(`#mcdu [data-k="${k}"]`).click();
    document.querySelector('#mcdu [data-lsk="R1"]').click();
    const atis = document.querySelector('#mcdu .mc-screen').textContent;
    if (!/ATIS/.test(atis) || !/WIND|QNH/i.test(atis)) out.push(`MCDU ATIS: ${atis.slice(0, 80)}`);
    FG.mcdu.show(false);
    return out;
  });
  if (draws.length) errors.push(`drawing: ${draws.join('; ')}`);
  const effects = await evaluate(() => {
    const y = FG.systems, s = FG.pilot.state, out = [];
    // all generators off on the ground with the APU off: on the batteries, the F/O's screens dark
    y.set('gen', 0, 0); y.set('gen', 0, 1); y.set('apuGen', 0); y.step(0.1);
    if (y.S.elec.level !== 'bat') out.push(`ELEC with no generator: ${y.S.elec.level}`);
    if (y.screenOn('pfd2')) out.push('the F/O PFD has power on the batteries');
    if (!y.screenOn('pfd1')) out.push('the captain PFD dark on the batteries');
    if (!s.altLaw) out.push('no ALTN LAW without AC');
    y.set('gen', 1, 0); y.set('gen', 1, 1); y.set('apuGen', 1); y.step(0.1);
    if (y.S.elec.level !== 'normal' || s.altLaw) out.push(`ELEC back: ${y.S.elec.level} altLaw ${s.altLaw}`);
    // hydraulics: green pump off and the PTU off: green goes, the gear can't come up
    y.set('engPump', 0, 0); y.set('ptu', 0); for (let k = 0; k < 60; k++) y.step(0.5);
    if (y.S.hyd.p.G > 1450) out.push(`HYD G with its pump off: ${Math.round(y.S.hyd.p.G)}`);
    if (s.sysK.gearUp !== 0) out.push('the gear could still come up without green');
    if (!y.currentCautions().some((c) => /HYD G/.test(c))) out.push('no HYD G caution');
    y.set('engPump', 1, 0); y.set('ptu', 1); for (let k = 0; k < 30; k++) y.step(0.5);
    // the IRs: IR 1 off: the captain's ATT flag; ATT HDG CAPT 3 brings it back
    y.set('irMode', 'OFF', 0); y.step(4);
    if (y.side(0).att) out.push('IR 1 off: the captain still has the attitude');
    y.set('attHdg', 'CAPT 3'); if (!y.side(0).att) out.push('ATT HDG CAPT 3 did not give IR 3');
    y.set('attHdg', 'NORM'); y.set('irMode', 'NAV', 0); s.V = 0; y.step(0.1);
    if (!(y.S.adirs.ir[0].align > 0)) out.push(`IR 1 back to NAV on the ground does not align (${y.S.adirs.ir[0].align})`);
    y.S.adirs.ir[0].ok = true; y.S.adirs.ir[0].align = 0;
    // the fuel burns: the weight comes off
    const m0 = s.mass, f0 = y.S.fuel.L + y.S.fuel.R + y.S.fuel.C; for (let k = 0; k < 20; k++) y.step(1);
    if (!(y.S.fuel.L + y.S.fuel.R + y.S.fuel.C < f0) || !(s.mass < m0)) out.push('no fuel burnt');
    return out;
  });
  if (effects.length) errors.push(`effects: ${effects.join('; ')}`);
  await key('0');
  await key('z');
  await evaluate(() => FG.systems.set('nav', 1));
  await key('Backspace');
  if ((await S()).lt.nav !== 0) errors.push('back to the checkpoint, NAV & LOGO did not come back to OFF');
  await evaluate(() => FG.pilot.stop());

  step('the A350, A330 and A340 decks build too, each version its own (four engines: four masters, four FIRE blocks)');
  const DECK = { 'A350-900': 'a350', 'A330-200': 'a330', 'A330-900': 'a330neo', 'A340-300': 'a340', 'A340-600': 'a346' };
  for (const type of Object.keys(DECK)) {
    await evaluate((type) => {
      const r = G.airportRunways('ZRH')[0];
      const course = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      FG.pilot.start({ type, mode: 'runway', end: { code: 'ZRH', lat: r[0], lon: r[1], far: [r[2], r[3]], course, len: G.runwayLength(r), width: 45, name: 'T' } });
    }, type);
    await waitFor(() => FG.pilot.active && !FG.pilot.state.loading, 20000, `the ${type} to be ready`);
    await evaluate(() => { FG.pilot.state.cam = 'cockpit'; FG.view3d.pilotCam('cockpit'); });
    const n4 = /^A34/.test(type), want = DECK[type] + (n4 ? 4 : 2);
    await waitFor((want) => FG.cockpit3d.pit && FG.cockpit3d.pit.kind + FG.cockpit3d.pit.nEng === want, 20000, `the ${type}'s deck`, want);
    // (its own panels: the overhead page's, src/panels.js; the 3D deck is FlightGear's A320 one for the A320s, A330s and A340s)
    const d = await evaluate(async (n4) => {
      const pit = FG.cockpit3d.pit, pn = await import(new URL('src/panels.js', location.href).href);
      const surf = (name) => pn.surface(name, pit.kind, n4 ? 4 : 2), mods = (name) => surf(name).items.map((it) => it.name);
      return { fire: surf('overhead').controls.filter((c) => c.tip && /FIRE pushbutton: push/.test(c.tip)).length, screens: pit.screens.map((x) => x.kind),
        ovh: mods('overhead'), main: mods('main'), ped: mods('pedestal'), fg: !!pit.fg };
    }, n4);
    if (/^A3[34]/.test(type) && !d.fg) errors.push(`${type}: not FlightGear's deck`);
    if (d.fire !== (n4 ? 5 : 3)) errors.push(`${type}: ${d.fire} FIRE pushbuttons`);
    if (/^A3[34]/.test(type)) {
      if (!d.ovh.includes('hydW') || d.ovh.includes('hyd')) errors.push(`${type}: overhead HYD ${d.ovh.join(',')}`);
      if (!d.ovh.includes(n4 ? 'fuel340' : 'fuel330')) errors.push(`${type}: overhead FUEL ${d.ovh.join(',')}`);
      if (d.screens.includes('stby3') !== (type === 'A340-300')) errors.push(`${type}: standby instruments ${d.screens.join(',')}`);
      if (d.ped.includes('taxiCam') !== (type === 'A340-600')) errors.push(`${type}: TAXI CAMERA ${d.ped.join(',')}`);
      if (d.ped.includes('oans') !== (type === 'A330-900')) errors.push(`${type}: OANS ${d.ped.join(',')}`);
      // the hydraulics without a PTU: green from its engine pumps; both off, it goes; its electric pump brings it back
      const hyd = await evaluate(async (n4) => {
        const y = FG.systems, out = [], H = y.S.hyd, step = (k) => { for (let j = 0; j < k; j++) y.step(0.5); };
        if (H.ptu) out.push('a PTU');
        for (const e of n4 ? ['G0', 'G3'] : ['G0', 'G1']) y.set('edp', e);
        step(40);
        if (H.p.G > 1450) out.push(`green still ${Math.round(H.p.G)} psi with its engine pumps off`);
        if (H.p.B < 1450 || H.p.Y < 1450) out.push(`blue or yellow lost too (${JSON.stringify({ p: H.p, edp: H.edp, plan: H.plan, eng: y.S.eng.map((e) => [e.run, Math.round(e.n1), e.master]), elec: y.S.elec.level })})`);
        y.set('elecPump', 'G'); step(20);
        if (H.p.G < 2500) out.push(`green ELEC PUMP gave ${Math.round(H.p.G)} psi`);
        for (const e of n4 ? ['G0', 'G3'] : ['G0', 'G1']) y.set('edp', e);
        y.set('elecPump', 'G');
        // the trim tank and the A340's own cross-feed
        const F = y.S.fuel;
        if (!(F.T > 0)) out.push('no fuel in the trim tank');
        if (n4) {
          // (up high, no gravity feed) engine 1's pumps off: it starves; X FEED 1 and 2 open: engine 2's pumps feed it
          const s = FG.pilot.state, h0 = s.h, g0 = s.onGround;
          s.onGround = false; s.h = 10000;
          y.set('fuelPump', 0, 'CL'); y.set('fuelPump', 0, 'CR');
          y.set('fuelPump', 0, 'E0'); y.set('fuelPump', 0, 'E0S'); step(4);
          if (!(F.starve[0] > 1)) out.push('engine 1 fed with its pumps off up high');
          y.set('xfeedE', 1, 0); y.set('xfeedE', 1, 1); step(2);
          if (F.starve[0] > 0) out.push('X FEED 1+2 did not feed engine 1');
          y.set('fuelPump', 1, 'E0'); y.set('fuelPump', 1, 'E0S'); y.set('xfeedE', 0, 0); y.set('xfeedE', 0, 1);
          y.set('fuelPump', 1, 'CL'); y.set('fuelPump', 1, 'CR');
          s.h = h0; s.onGround = g0; F.starve.fill(0);
        }
        return out;
      }, n4);
      if (hyd.length) errors.push(`${type} systems: ${hyd.join('; ')}`);
      if (type === 'A340-600') {
        await evaluate(() => FG.systems.set('taxiCam', 1));
        await sleep(1500);
        const cam = await evaluate(() => { const sc = FG.cockpit3d.pit.screens.find((x) => x.kind === 'sd'); const d = sc.ctx.getImageData(0, 0, sc.cv.width, Math.round(sc.cv.height * 0.6)).data; let n = 0, w = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) w++; if (d[i] > 180 && d[i + 1] > 150 && d[i + 2] < 120) n++; } return { white: w, yellow: n }; });
        if (cam.white < 500) errors.push(`TAXI CAMERA: no fuselage on the SD (${JSON.stringify(cam)})`);
        await screenShot('sd', 'A340-600-taxicam-sd'); await look(0, -32); await shot('A340-600-taxicam'); await look(0, 0);
        await evaluate(() => FG.systems.set('taxiCam', 0));
      }
      if (type === 'A330-900') {
        await evaluate(() => FG.systems.set('oans', 1));
        await sleep(2500);
        const map = await evaluate(() => { const sc = FG.cockpit3d.pit.screens.find((x) => x.kind === 'nd'); const d = sc.ctx.getImageData(0, 0, sc.cv.width, sc.cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 150 && d[i + 2] < 120) n++; return n; });
        if (map < 200) errors.push(`OANS: no taxiways on the ND (${map} yellow pixels)`);
        await screenShot('nd', 'A330-900-oans-nd'); await look(-18, -22); await shot('A330-900-oans'); await look(0, 0);
        await evaluate(() => FG.systems.set('oans', 0));
      }
    }
    if (type === 'A340-300') await screenShot('stby3', 'A340-300-standby');
    await shot(`${type}-ahead`);
    await look(60, 60); await shot(`${type}-overhead`); await look(0, 0);
    await evaluate(() => FG.pilot.stop());
  }
} catch (e) {
  errors.push(`test stopped: ${e.message}`);
}

for (const w of [...new Set(warnings)]) console.log(`⚠ ${w}`);
const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`\n✗ systems test failed with ${unique.length} error(s):`);
  for (const e of unique) console.error(`  ${e}`);
  finish(1);
} else {
  console.log('\n✓ systems test passed');
  finish(0);
}
