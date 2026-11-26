#!/usr/bin/env node
// Smoke test for the fly page: serves this repo (the game comes from the flightgame/ submodule), loads index.html in
// headless Chrome and flies: the start screen, an A350 lined up at Zurich (TOGA, the keys are the plane's, its 3D
// cockpit, a checkpoint, Esc menu, leave), then each of the sixteen types starts and spools up. Fails on any script
// error, console.error or missing file of our own.
//
//   node test/smoke.mjs            (needs Node 22+ and Chrome or Chromium; CHROME=/path overrides)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_RUN_MS = 9 * 60 * 1000;
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-fly-smoke-'));
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
        // (a map error object logged without its message: MapLibre's minified AJAXError and the like)
        if (/^[A-Za-z]{1,3}$/.test(text.trim())) { warnings.push(`map error: ${text}`); break; }
        // (a terrain tile the leveller could not download: the network again)
        if (/^TypeError: Failed to fetch\s+at protocol \(\S*flatground\.js/.test(text)) { warnings.push('terrain tile did not download'); break; }
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
try {
  step(`loading ${ORIGIN}/?from=ZRH`);
  await cmd('Page.navigate', { url: `${ORIGIN}/?from=ZRH` });
  await waitFor(() => window.FG && FG.pilot && FG.view3d && FG.view3d.map && FG.game.state, 90000, 'the fly page with its 3D view');
  await waitFor(() => !!document.getElementById('pilot-start'), 20000, 'the start screen');
  step('the start screen opened by itself; the game\'s save is never written (src/guard.js)');
  if (await evaluate(() => FG.game.save() !== false)) errors.push('FG.game.save wrote the save (src/guard.js)');

  step('start screen: a gallery of every type, airport search, runways at ZRH, start modes, livery, time and wind');
  const ss = await evaluate(() => {
    const el = document.getElementById('pilot-start');
    const q = (s) => el.querySelector(s);
    const out = { cards: el.querySelectorAll('.fs-plane').length, types: Object.keys(FG.pilot.types).length, rw: el.querySelectorAll('[data-rw]').length,
      map: !!q('.fs-map .leaflet-pane'), livs: q('#fs-livery').options.length, go: !!q('[data-ps=go]') };
    q('[data-fs-group=props]').click();
    out.props = el.querySelectorAll('.fs-plane').length;
    q('[data-fs-group=all]').click();
    const ap = q('#ps-ap'); ap.value = 'genev'; ap.dispatchEvent(new Event('input', { bubbles: true }));
    out.suggest = [...el.querySelectorAll('#fs-suggest [data-ap]')].map((b) => b.dataset.ap);
    const gva = q('#fs-suggest [data-ap=GVA]'); if (gva) gva.click();
    out.gvaRw = el.querySelectorAll('[data-rw]').length;
    q('[data-type="A350-900"]').click();
    q('[data-wind=set]').click();
    const f = q('#fs-wfrom'), k = q('#fs-wkt'); f.value = '270'; k.value = '20'; k.dispatchEvent(new Event('input', { bubbles: true }));
    q('[data-time=day]').click();
    out.clock = q('#fs-clock').textContent;
    out.xwind = q('#fs-xwind').textContent;
    return out;
  });
  if (ss.cards !== ss.types || ss.cards < 16 || !ss.rw || !ss.map || ss.livs < 2 || !ss.go) errors.push(`start screen: ${JSON.stringify(ss)}`);
  if (!(ss.props > 0 && ss.props < ss.cards)) errors.push(`start screen: the Propellers filter shows ${ss.props} of ${ss.cards}`);
  if (!ss.suggest.includes('GVA') || !ss.gvaRw) errors.push(`start screen: searching "genev" did not find Geneva and its runways: ${JSON.stringify(ss)}`);
  if (!/^12:00 local at GVA/.test(ss.clock) || !/crosswind/.test(ss.xwind)) errors.push(`start screen: time or wind not shown: ${JSON.stringify(ss)}`);
  await evaluate(() => document.querySelector('#pilot-start [data-ps=go]').click());
  await waitFor(() => FG.pilot.active && !FG.pilot.state.loading, 20000, 'the A350 from the start screen');
  await sleep(1500);
  const started = await evaluate(() => {
    const s = FG.pilot.state, a = G.airportByCode.GVA;
    const lt = ((Math.floor(G.localTime('GVA', FG.ui.time)) % 1440) + 1440) % 1440;
    return { type: FG.pilot.type, near: G.distanceKm(s, a) < 5, wind: s.wind && Math.round(s.wind.kt), from: s.wind && s.wind.from, lt, gone: !document.getElementById('pilot-start') };
  });
  if (started.type !== 'A350-900' || !started.near || started.wind !== 20 || started.from !== 270 || Math.abs(started.lt - 720) > 10 || !started.gone) errors.push(`start screen: the flight did not start as picked: ${JSON.stringify(started)}`);
  // in the air the wind moves the plane: 900 m up, nose north at 130 m/s, a 20 kt west wind makes the track ~4.5° (headless
  // frames are slow, so the track, not the distance, is what to check)
  const drift = await evaluate(async () => {
    const s = FG.pilot.state;
    Object.assign(s, { onGround: false, h: s.groundH + 900, V: 130, gamma: 0, psi: 0, theta: 3, alpha: 3, lever: 0.86, gearDown: false, gear: 0 });
    const lon0 = s.lon;
    await new Promise((r) => setTimeout(r, 2500));
    return { east: (s.lon - lon0) * 111320 * Math.cos(s.lat * Math.PI / 180), track: s.track };
  });
  if (!(drift.east > 0.5) || !(drift.track > 3 && drift.track < 7)) errors.push(`wind: a 270° wind did not drift the plane east: ${JSON.stringify(drift)}`);
  await evaluate(() => FG.pilot.stop());
  await waitFor(() => !!document.getElementById('pilot-start'), 5000, 'the start screen again after leaving');
  await evaluate(() => { const el = document.getElementById('pilot-start'); el.querySelector('[data-wind=game]').click(); el.querySelector('[data-ps=no]').click(); });

    step('fly it yourself (P): an A350 lined up at Zurich, TOGA spools the engines, the keys are the plane\'s, its 3D cockpit, a checkpoint goes back, Esc opens its menu, Q leaves');
    await evaluate(() => {
      const r = G.airportRunways('ZRH')[0];
      const course = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      FG.pilot.start({ type: 'A350-900', mode: 'runway', end: { code: 'ZRH', lat: r[0], lon: r[1], far: [r[2], r[3]], course, len: G.runwayLength(r), width: 45, name: 'T' } });
    });
    {
      await waitFor(() => FG.pilot.active && !FG.pilot.state.loading, 20000, 'the hand-flown A350 to be ready');
      const speed0 = await evaluate(() => FG.ui.speed);
      await key('4');
      await key('ArrowRight'); // (the plane's now: not the game's speed key)
      await waitFor(() => FG.pilot.state.n1[0] > 30, 30000);
      const fl = await evaluate(() => ({ n1: FG.pilot.state.n1[0], lever: FG.pilot.state.lever, follow: FG.view3d.follow, drawn: !!FG.view3d.pilotE, speed: FG.ui.speed, hud: !document.getElementById('pilot-hud').hidden }));
      if (!(fl.n1 > 30) || fl.lever !== 1 || !fl.follow || !fl.drawn || !fl.hud) errors.push(`fly it yourself: ${JSON.stringify(fl)}`);
      if (fl.speed !== speed0) errors.push('fly it yourself: → changed the game speed while flying');
      // the A350's 3D flight deck round the cockpit camera (js/cockpit3d.js): built, its screens painted, the head turns
      await evaluate(() => { FG.pilot.state.cam = 'cockpit'; FG.view3d.pilotCam('cockpit'); });
      const deck = await waitFor(() => FG.cockpit3d && FG.cockpit3d.pit && FG.cockpit3d.pit.screens.length >= 7, 20000);
      if (!deck) errors.push('fly it yourself: the A350\'s 3D cockpit was not drawn in the cockpit camera');
      else {
        const pit = await evaluate(() => {
          const sc = FG.cockpit3d.pit.screens.find((x) => x.kind === 'pfdnd-c');
          const px = sc.ctx.getImageData(sc.cv.width * 0.25, sc.cv.height * 0.45, 1, 1).data; // (the PFD's sky or ground)
          FG.view3d.look.yaw = -60; // (a drag turns the head)
          return { lit: px[0] + px[1] + px[2] > 60, eye: FG.pilot.LOOK_DOWN };
        });
        if (!pit.lit) errors.push(`fly it yourself: the cockpit's PFD screen stayed blank: ${JSON.stringify(pit)}`);
        await evaluate(() => { FG.view3d.look.yaw = 0; FG.pilot.state.cam = 'chase'; FG.view3d.pilotCam('chase'); });
      }
      // checkpoint: Z keeps the flight, Backspace puts it back there (paused), even after a crash
      await key('z');
      await evaluate(() => { const s = FG.pilot.state; s.lever = 0; s.crashed = 'test'; s.lat += 0.01; });
      await key('Backspace');
      const ck = await evaluate(() => { const s = FG.pilot.state; return { lever: s.lever, crashed: s.crashed, paused: s.paused, moved: !!s.ck && s.lat === s.ck.state.lat }; });
      if (ck.lever !== 1 || ck.crashed || !ck.paused || !ck.moved) errors.push(`fly it yourself: Backspace did not go back to the checkpoint: ${JSON.stringify(ck)}`);
      await key('p');
      // Esc: the flight's own menu (the flight waits), Esc again resumes, Q from the menu leaves
      await key('Escape');
      const pm = await evaluate(() => ({ active: FG.pilot.active, menu: !!document.getElementById('pilot-menu'), paused: FG.pilot.state.menu, game: !document.getElementById('menu').hidden }));
      if (!pm.active || !pm.menu || !pm.paused || pm.game) errors.push(`fly it yourself: Esc did not open the flight's menu: ${JSON.stringify(pm)}`);
      await key('Escape');
      if (await evaluate(() => !!document.getElementById('pilot-menu') || !FG.pilot.active)) errors.push('fly it yourself: Esc did not resume the flight');
      await key('Escape'); await key('q');
      const off = await evaluate(() => ({ active: FG.pilot.active, drawn: !!FG.view3d.pilotE, menu: !document.getElementById('menu').hidden, pm: !!document.getElementById('pilot-menu') }));
      if (off.active || off.menu || off.pm) errors.push(`fly it yourself: Esc, Q did not just leave the plane: ${JSON.stringify(off)}`);
      // every other type: starts on the runway with its own engines and spools up at take-off thrust
      step('fly it yourself: each of the sixteen aircraft starts, is drawn and spools up');
      const types = await evaluate(() => Object.keys(FG.pilot.types));
      if (types.length < 16) errors.push(`fly it yourself: only ${types.length} aircraft`);
      for (const type of types) {
        await evaluate((type) => {
          const r = G.airportRunways('ZRH')[0];
          const course = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
          FG.pilot.start({ type, mode: 'runway', end: { code: 'ZRH', lat: r[0], lon: r[1], far: [r[2], r[3]], course, len: G.runwayLength(r), width: 45, name: 'T' } });
        }, type);
        await waitFor(() => FG.pilot.active && !FG.pilot.state.loading, 20000, `the hand-flown ${type} to be ready`);
        await evaluate(() => { FG.pilot.state.lever = 1; });
        if (!await waitFor(() => FG.pilot.state.n1.every((n) => n > FG.pilot.state.spec.idle + 10) || FG.pilot.state.crashed, 75000)) { // (software 3D: few frames)
          const d = await evaluate(() => { const s = FG.pilot.state; return { n1: s.n1, lever: s.lever, idle: s.spec.idle, loading: s.loading, paused: s.paused, menu: s.menu, athr: s.athr, athrMode: s.athrMode, fm: !!(FG.fmgc && FG.fmgc.on), active: FG.pilot.active }; });
          throw new Error(`the ${type}'s engines did not spool up: ${JSON.stringify(d)}`);
        }
        const st = await evaluate(() => { const s = FG.pilot.state; return { type: FG.pilot.type, engines: s.n1.length, want: s.spec.engines, crashed: s.crashed, drawn: !!FG.view3d.pilotE && FG.view3d.pilotE.type === FG.pilot.type }; });
        if (st.type !== type || st.engines !== st.want || st.crashed || !st.drawn) errors.push(`fly it yourself, ${type}: ${JSON.stringify(st)}`);
        if (type === 'A350-900') {
          // the limiter: L turns the protections off (direct law) and back on, the 🛡 button says which
          await key('l');
          const off = await evaluate(() => ({ lim: FG.pilot.state.limiter, btn: document.querySelector('#pilot-hud [data-pl=limiter]').textContent }));
          await key('l');
          const on = await evaluate(() => FG.pilot.state.limiter);
          if (off.lim !== false || !/off/.test(off.btn) || on !== true) errors.push(`fly it yourself: the limiter did not toggle: ${JSON.stringify({ off, on })}`);
        }
        await evaluate(() => FG.pilot.stop());
      }
    }
} catch (e) {
  errors.push(`test stopped: ${e.message}`);
}

for (const w of [...new Set(warnings)]) console.log(`⚠ ${w}`);
const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`\n✗ smoke test failed with ${unique.length} error(s):`);
  for (const e of unique) console.error(`  ${e}`);
  finish(1);
} else {
  console.log('\n✓ smoke test passed');
  finish(0);
}
