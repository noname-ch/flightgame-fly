// The flight deck's sounds for the hand-flown aircraft (src/pilot.js): what the crew hears.
//
// - The warning computer's voice: GPWS (pull up, terrain, sink rate, too low gear/flaps, glide slope, bank angle),
//   the radio altitude callouts, V1/rotate, minimum, retard, stall. Recorded per family (tools/build_voices.py →
//   sounds/voice/<family>/<key>.mp3), each family its own voice and wording: Airbus, Boeing, the turboprops and the
//   Global 7500, Concorde (an older box). The DC-3 and the Ju 52 have none.
// - The warning tones, as each maker has them: Airbus' continuous repetitive chime, cricket and cavalry charge;
//   Boeing's fire bell, overspeed clacker, stick shaker, autopilot wailer, take-off config horn; the GPWS "whoop".
// - The aircraft itself: the air rushing past (louder with speed, muffled in the cockpit), the engines, the flap
//   and gear motors (hydraulic or electric) with their clunks, the gear and flaps and speed brakes in the airflow,
//   buffet, the runway under the wheels, touchdowns; metal creaking when overstressed, parts tearing off (a wing tip,
//   a wing, the elevators, the rudder), scraping a wing, the impact, the fireball and the fire.
//
// Off with the game's sound (FG.sound.on), as loud as its volume. Nothing here changes the flying: it reads
// FG.pilot.state 20 times a second (s.warn: the warnings the HUD shows) and src/pilot.js speak() asks say(text)
// first. FG.cocksnd.log lists what played (for tests: they run muted).
(() => {
  'use strict';
  const FG = (window.FG = window.FG || {});
  const VOICE = new URL('../sounds/voice/', document.baseURI).href; // (the page's base is the game's folder)
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const KT = 0.514444;

  // ---------- each family's sounds ----------
  // voice: the folder of its recordings (null: no warning computer); whoop: the GPWS sweeps before "pull up";
  // stall / overspeed / master / fire / ap / config: what sounds; motor: the flaps' and gear's (Hz, kind)
  const FAM = {
    airbus: { voice: 'airbus', whoop: false, stall: 'cricket', overspeed: 'crc', vfe: 'crc', master: 'crc', fire: 'crc', ap: 'cavalry', config: 'crc', motor: { flap: 410, gear: 330, kind: 'hyd' } },
    boeing: { voice: 'boeing', whoop: true, stall: 'shaker', overspeed: 'clacker', master: 'beeper', fire: 'bell', ap: 'wailer', config: 'horn', motor: { flap: 260, gear: 290, kind: 'hyd' } },
    regional: { voice: 'regional', whoop: true, stall: 'shaker', overspeed: 'clacker', master: 'beeper', fire: 'bell', ap: 'wailer', config: 'horn', motor: { flap: 190, gear: 240, kind: 'elec' } },
    concorde: { voice: 'concorde', whoop: true, stall: 'shaker', overspeed: 'clacker', master: 'gong', fire: 'bell', ap: 'wailer', config: 'horn', motor: { flap: 0, gear: 300, kind: 'hyd' } },
    classic: { voice: null, crew: 'regional', whoop: false, stall: null, overspeed: null, master: null, fire: 'bell', ap: null, config: null, motor: { flap: 150, gear: 210, kind: 'elec' } },
  };
  function familyOf(sp) {
    if (!sp) return 'airbus';
    if (/Airbus/.test(sp.maker || '')) return 'airbus';
    if (/Boeing/.test(sp.maker || '')) return 'boeing';
    if (sp.engine === 'sst') return 'concorde';
    if (sp.law === 'classic') return 'classic';
    return 'regional';
  }
  // the words src/pilot.js, src/fmgc.js and src/aircraft.js speak → recordings
  const SAY = {
    'v one': 'v1', rotate: 'rotate', 'one hundred above': 'hundredAbove', minimum: 'minimum', retard: 'retard',
    'twenty five hundred': 'a2500', 'one thousand': 'a1000', 'five hundred': 'a0500', 'one hundred': 'a0100',
    50: 'a0050', 40: 'a0040', 30: 'a0030', 20: 'a0020', 10: 'a0010',
    'terrain ahead, pull up': 'terrainAheadPullup', 'terrain ahead': 'terrainAhead', 'evacuate, evacuate': 'evacuate',
    config: 'config', 'top of descent': 'topOfDescent', 'thrust levers climb': 'thrustLeversClimb',
    'you have control': 'youHaveControl', 'tail strike': 'tailStrike', stall: 'stall',
  };
  const CREW = new Set(['v1', 'rotate', 'youHaveControl', 'evacuate']); // (said by the crew: on every type)
  const FX_WORDS = new Set(['crash', 'master warning', 'wing strike']); // (sounds here instead of words)
  // what each family has recorded (tools/build_voices.py)
  const ALL = ['pullup', 'terrain', 'terrainAhead', 'terrainAheadPullup', 'cautionTerrain', 'sinkrate', 'lowGear', 'lowFlaps', 'lowTerrain', 'glideslope',
    'bankAngle', 'v1', 'rotate', 'a2500', 'a1000', 'a0500', 'a0100', 'a0050', 'a0040', 'a0030', 'a0020', 'a0010', 'hundredAbove', 'evacuate', 'tailStrike',
    'config', 'topOfDescent', 'youHaveControl', 'windshear', 'overspeed', 'minimum', 'retard', 'stall'];
  const HAS = {
    airbus: new Set([...ALL, 'thrustLeversClimb', 'speed', 'dualInput']),
    boeing: new Set([...ALL, 'dontSink', 'approachingMinimums']),
    regional: new Set([...ALL, 'dontSink']),
    concorde: new Set(ALL.filter((k) => k !== 'thrustLeversClimb')),
  };

  // The GPWS and the other warnings the HUD shows (s.warn) → what is heard: priority (1 first), the words, the gap
  // before they're said again while it lasts.
  const MODES = [
    [/^TERRAIN AHEAD — PULL UP/, 1, 'terrainAheadPullup', 0.25],
    [/^PULL UP/, 1, 'pullup', 0.2],
    [/^TERRAIN AHEAD/, 3, 'terrainAhead', 4],
    [/^SINK RATE/, 3, 'sinkrate', 0.9],
    [/^TOO LOW — GEAR/, 4, 'lowGear', 0.9],
    [/^TOO LOW — FLAPS/, 4, 'lowFlaps', 0.9],
    [/^GLIDE SLOPE/, 6, 'glideslope', 2.5],
  ];

  // ---------- audio ----------
  let ac = null, out = null, fxBus = null, fxTone = null, spk = null, noise = null;
  const L = {}; // the loops
  const bufs = new Map(); // "fam/key" → AudioBuffer | Promise | null (failed)
  const log = [];
  const note = (what) => { log.push({ what, at: performance.now() }); if (log.length > 60) log.shift(); };
  function build() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ac = new AC(); } catch (e) { return false; }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    out = ac.createGain(); out.gain.value = 0;
    out.connect(comp).connect(ac.destination);
    out.connect(meter = ac.createAnalyser());
    meter.fftSize = 2048;
    // the aircraft's own sounds (muffled through the cockpit's walls) and the flight deck's loudspeaker
    fxTone = ac.createBiquadFilter(); fxTone.type = 'lowpass'; fxTone.frequency.value = 12000; fxTone.Q.value = 0.5;
    fxBus = ac.createGain(); fxBus.connect(fxTone).connect(out);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
    spk = ac.createGain(); spk.gain.value = 0.9; spk.connect(hp).connect(lp).connect(out);
    const n = ac.sampleRate * 6;
    noise = ac.createBuffer(1, n, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    loops();
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); }, true);
    return true;
  }
  let meter = null;
  function src(rate = 1) {
    const b = ac.createBufferSource();
    b.buffer = noise; b.loop = true; b.playbackRate.value = rate;
    b.start(0, Math.random() * 5);
    return b;
  }
  const filt = (type, f, q = 0.7) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  // A loop: noise (or an oscillator) through filters into a gain that tick() sets.
  function loops() {
    // the air rushing past: pink-ish (two lowpasses), its brightness up with the speed
    L.wind = { f: filt('lowpass', 500), g: gain() };
    src().connect(filt('lowpass', 2500, 0.5)).connect(L.wind.f).connect(filt('highpass', 60)).connect(L.wind.g).connect(out);
    // the engines: a deep rush up with N1 (jets), a thrum at the blades' rate (propellers)
    L.eng = { f: filt('lowpass', 120), g: gain(), am: gain(1), lfo: ac.createOscillator(), depth: gain(0) };
    src(0.5).connect(L.eng.f).connect(L.eng.am).connect(L.eng.g).connect(fxBus);
    L.eng.lfo.frequency.value = 60; L.eng.lfo.connect(L.eng.depth).connect(L.eng.am.gain); L.eng.lfo.start();
    L.eng.hi = { f: filt('bandpass', 1800, 1.2), g: gain() }; // (the fan's hiss)
    src().connect(L.eng.hi.f).connect(L.eng.hi.g).connect(fxBus);
    // the runway under the wheels
    L.roll = { f: filt('lowpass', 160), g: gain(), am: gain(1) };
    src(0.7).connect(L.roll.f).connect(L.roll.am).connect(L.roll.g).connect(fxBus);
    // gear, flaps and speed brakes in the airflow, and buffet: a low shaking rumble
    L.drag = { f: filt('bandpass', 220, 0.6), g: gain() };
    src(0.8).connect(L.drag.f).connect(L.drag.g).connect(fxBus);
    L.buffet = { f: filt('lowpass', 90), g: gain(), am: gain(1) };
    src(0.4).connect(L.buffet.f).connect(L.buffet.am).connect(L.buffet.g).connect(fxBus);
    // the flap and gear motors: a whine (sawtooth, lowpassed: no beating pairs) and the gearbox's grind
    for (const k of ['flapM', 'gearM']) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 300;
      const g = gain(), lp = filt('lowpass', 1400, 1.5);
      o.connect(lp).connect(g); o.start();
      const grind = { f: filt('bandpass', 900, 2), am: gain(0.5), lfo: ac.createOscillator() };
      grind.lfo.frequency.value = 22; grind.lfo.connect(grind.am.gain); grind.lfo.start();
      src().connect(grind.f).connect(grind.am).connect(g);
      g.connect(fxBus);
      L[k] = { o, g, lp, grind };
    }
    // a wing scraping along the ground, the wreck sliding: grinding metal
    L.scrape = { f: filt('bandpass', 1300, 2.5), f2: filt('bandpass', 3100, 4), g: gain(), am: gain(1) };
    const sn = src(1.3);
    sn.connect(L.scrape.f).connect(L.scrape.am); sn.connect(L.scrape.f2).connect(L.scrape.am);
    L.scrape.am.connect(L.scrape.g).connect(fxBus);
    // fire: a low roar with crackles (the gain jumps about)
    L.fire = { f: filt('lowpass', 380), g: gain(), cr: { f: filt('highpass', 1500), g: gain() } };
    src(0.6).connect(L.fire.f).connect(L.fire.g).connect(fxBus);
    src(1.1).connect(L.fire.cr.f).connect(L.fire.cr.g).connect(fxBus);
    // the stick shaker's motor: a rattle at about 18 Hz
    L.shaker = { g: gain(), am: gain(0), lfo: ac.createOscillator() };
    L.shaker.lfo.type = 'square'; L.shaker.lfo.frequency.value = 18;
    L.shaker.lfo.connect(L.shaker.am.gain); L.shaker.lfo.start();
    src().connect(filt('bandpass', 420, 1.5)).connect(L.shaker.am).connect(L.shaker.g).connect(fxBus);
  }
  const T = (param, v, tau = 0.08) => param.setTargetAtTime(Number.isFinite(v) ? v : 0, ac.currentTime, tau);

  // ---------- one-shot sounds ----------
  // a burst of noise through a filter, with an envelope
  function burst({ type = 'lowpass', f = 1000, f1 = null, q = 0.7, a = 0.005, d = 0.3, v = 0.5, rate = 1, at = 0, to = fxBus }) {
    const t = ac.currentTime + 0.01 + at;
    const b = ac.createBufferSource(); b.buffer = noise; b.playbackRate.value = rate;
    const fl = filt(type, f, q), g = gain(0);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
    b.connect(fl).connect(g).connect(to);
    b.start(t, Math.random() * 5); b.stop(t + a + d + 0.05);
  }
  function osc({ type = 'sine', f = 440, f1 = null, a = 0.005, d = 0.3, hold = 0, v = 0.3, at = 0, to = spk, curve = 'exp' }) {
    const t = ac.currentTime + 0.01 + at;
    const o = ac.createOscillator(), g = gain(0);
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + hold + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a);
    if (hold) g.gain.setValueAtTime(v, t + a + hold);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0008, t + a + hold + d);
    else g.gain.linearRampToValueAtTime(0, t + a + hold + d);
    o.connect(g).connect(to);
    o.start(t); o.stop(t + a + hold + d + 0.05);
  }
  const fx = {
    // a heavy part going: a crack, a deep bang and the long tearing of metal (size 0.3 … 1.5)
    tear(size = 1, at = 0) {
      burst({ type: 'highpass', f: 1500, d: 0.04, v: 0.7 * size, at }); // (the crack)
      burst({ type: 'lowpass', f: 900, f1: 60, d: 0.5 + 0.4 * size, v: 0.9 * size, at: at + 0.01 }); // (the bang)
      osc({ type: 'sine', f: 70, f1: 30, d: 0.6 + 0.3 * size, v: 0.6 * size, at, to: fxBus });
      // tearing: resonant bands sweeping down, in fits
      const n = Math.round(4 + 6 * size);
      for (let i = 0; i < n; i++) {
        const t0 = at + 0.05 + (i / n) * (0.5 + 0.9 * size) + Math.random() * 0.05;
        const f0 = 2600 - 1800 * (i / n) + Math.random() * 600;
        burst({ type: 'bandpass', f: f0, f1: f0 * 0.6, q: 6, a: 0.01, d: 0.08 + Math.random() * 0.15, v: 0.5 * size, at: t0 });
      }
      note('tear');
    },
    // metal groaning under load (more and deeper the more it's overstressed)
    creak(k = 1) {
      const f = 120 + Math.random() * 260;
      burst({ type: 'bandpass', f, f1: f * (0.7 + Math.random() * 0.6), q: 12, a: 0.08, d: 0.3 + Math.random() * 0.5, v: 0.6 * k, rate: 0.6 });
      if (Math.random() < 0.4) burst({ type: 'bandpass', f: 1800 + Math.random() * 1500, q: 10, a: 0.002, d: 0.05, v: 0.25 * k, at: 0.2 * Math.random() }); // (a tick)
      note('creak');
    },
    // a gear lock, a door, a flap reaching its stop
    clunk(v = 0.5, f = 110) {
      osc({ type: 'sine', f, f1: f * 0.5, d: 0.18, v, to: fxBus });
      burst({ type: 'bandpass', f: f * 6, q: 2, d: 0.06, v: v * 0.7 });
      note('clunk');
    },
    // the wheels meeting the runway: a thump as hard as the landing and the tyres' chirp
    thump(fpm) {
      const k = clamp(fpm / 600, 0.15, 1.6);
      osc({ type: 'sine', f: 80, f1: 35, d: 0.25 + 0.2 * k, v: 0.5 * k, to: fxBus });
      burst({ type: 'lowpass', f: 600, d: 0.25, v: 0.5 * k });
      burst({ type: 'bandpass', f: 2400, q: 3, d: 0.18, v: 0.25, at: 0.01 }); // (the chirp)
      burst({ type: 'bandpass', f: 2100, q: 3, d: 0.12, v: 0.15, at: 0.09 });
      note('touchdown');
    },
    // the impact: a crushing boom and crunching wreckage, more of it the harder (S: src/pilot.js crash)
    crash(S = 1) {
      const k = clamp(0.5 + S / 3, 0.6, 2);
      osc({ type: 'sine', f: 55, f1: 22, d: 1.5, v: 0.9, to: fxBus });
      burst({ type: 'lowpass', f: 1800, f1: 80, d: 1.4 * k, v: 1.0 });
      for (let i = 0; i < 6 + 6 * k; i++) burst({ type: 'bandpass', f: 400 + Math.random() * 3000, q: 4, a: 0.005, d: 0.05 + Math.random() * 0.2, v: 0.6, at: Math.random() * 1.2 * k });
      note('crash');
    },
    // the fuel going up: a deep whoosh swelling and rolling away
    whoomp(scale = 1) {
      burst({ type: 'lowpass', f: 200, f1: 900, a: 0.25, d: 2.5, v: 0.8 * clamp(scale, 0.4, 1.5), rate: 0.5 });
      osc({ type: 'sine', f: 40, f1: 25, a: 0.1, d: 2, v: 0.5, to: fxBus });
      note('fireball');
    },
    // the flap lever into its next detent
    detent() { burst({ type: 'bandpass', f: 2200, q: 3, d: 0.03, v: 0.3 }); note('detent'); },
  };
  // the warning tones, through the loudspeaker
  const tones = {
    chime() { osc({ f: 1100, d: 0.16, v: 0.25 }); osc({ f: 2200, d: 0.1, v: 0.06 }); }, // (one of the CRC's)
    crc() { for (let i = 0; i < 3; i++) { osc({ f: 1100, d: 0.14, v: 0.25, at: i * 0.17 }); osc({ f: 2200, d: 0.08, v: 0.06, at: i * 0.17 }); } note('crc'); },
    cricket() { for (let i = 0; i < 3; i++) { osc({ type: 'square', f: 3800, hold: 0.07, d: 0.01, v: 0.08, at: i * 0.12, curve: 'lin' }); } note('cricket'); },
    whoop(at = 0) { osc({ type: 'triangle', f: 360, f1: 1250, a: 0.02, hold: 0.22, d: 0.05, v: 0.3, at, curve: 'lin' }); note('whoop'); },
    clacker() { for (let i = 0; i < 4; i++) { burst({ type: 'bandpass', f: 1600, q: 5, a: 0.001, d: 0.03, v: 0.8, at: i * 0.125, to: spk }); } note('clacker'); },
    bell() { for (const [f, v] of [[700, 0.22], [1680, 0.12], [2810, 0.07], [3930, 0.04]]) for (let i = 0; i < 9; i++) osc({ f, d: 0.07, v, at: i * 0.055 }); note('bell'); },
    beeper() { for (let i = 0; i < 3; i++) osc({ type: 'square', f: 1000, hold: 0.09, d: 0.01, v: 0.06, at: i * 0.16, curve: 'lin' }); note('beeper'); },
    gong() { osc({ f: 520, d: 1.1, v: 0.3 }); osc({ f: 1310, d: 0.6, v: 0.1 }); note('gong'); },
    horn() { for (let i = 0; i < 2; i++) { osc({ type: 'sawtooth', f: 440, hold: 0.22, d: 0.02, v: 0.06, at: i * 0.45, curve: 'lin' }); osc({ type: 'sawtooth', f: 554, hold: 0.22, d: 0.02, v: 0.05, at: i * 0.45, curve: 'lin' }); } note('horn'); },
    wailer() {
      const t = ac.currentTime + 0.01, o = ac.createOscillator(), g = gain(0), lfo = ac.createOscillator(), dep = gain(320);
      o.type = 'triangle'; o.frequency.value = 900; lfo.frequency.value = 3.2;
      lfo.connect(dep).connect(o.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03); g.gain.setValueAtTime(0.22, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 1.6);
      o.connect(g).connect(spk); o.start(t); lfo.start(t); o.stop(t + 1.7); lfo.stop(t + 1.7);
      note('wailer');
    },
    cavalry() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => osc({ type: 'square', f, hold: 0.09, d: 0.02, v: 0.06, at: i * 0.13, curve: 'lin' })); note('cavalry'); },
  };

  // ---------- the voice ----------
  function load(fam, key) {
    const id = `${fam}/${key}`;
    if (bufs.has(id)) return bufs.get(id);
    const p = fetch(VOICE + id + '.mp3').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => ac.decodeAudioData(b)).then((b) => { bufs.set(id, b); return b; }, () => { bufs.set(id, null); return null; });
    bufs.set(id, p);
    return p;
  }
  function preload(fam) {
    const f = FAM[fam], v = f && (f.voice || f.crew);
    if (!v || !ac) return;
    for (const k of HAS[v]) load(v, k);
  }
  let cur = null; // { key, prio, src, ends }
  const lastEnd = {};
  let pending = []; // [{ key, prio, at }]: one-shot words waiting for the voice
  function voiceOf(key) {
    const f = FAM[fam];
    if (f.voice && HAS[f.voice].has(key)) return f.voice;
    if (CREW.has(key) && f.crew) return f.crew;
    return null;
  }
  // Says key now (cutting in on anything less urgent). Returns whether it plays.
  function play(key, prio) {
    const v = voiceOf(key);
    if (!v) return false;
    const b = bufs.get(`${v}/${key}`);
    if (!(b instanceof AudioBuffer)) { if (!bufs.has(`${v}/${key}`)) load(v, key); return false; }
    if (cur && cur.ends > ac.currentTime) { if (prio >= cur.prio) return false; try { cur.src.stop(); } catch (e) { /* */ } }
    let at = ac.currentTime + 0.02;
    if (key === 'pullup' && FAM[fam].whoop) { tones.whoop(0); tones.whoop(0.36); at += 0.74; }
    const s0 = ac.createBufferSource(); s0.buffer = b; s0.connect(spk); s0.start(at);
    cur = { key, prio, src: s0, ends: at + b.duration };
    s0.onended = () => { lastEnd[key] = ac.currentTime; if (cur && cur.src === s0) cur = null; };
    note('say ' + key);
    return true;
  }
  function silence() { if (cur) { try { cur.src.stop(); } catch (e) { /* */ } cur = null; } pending = []; }

  // src/pilot.js speak(text): true if it's taken care of here (said in the aircraft's own voice, or a sound instead,
  // or a warning this type doesn't have); false: the browser's speech says it.
  function say(text) {
    if (!FG.sound || !FG.sound.on || !ready()) return false;
    const t = String(text).trim().toLowerCase();
    if (FX_WORDS.has(t)) return true;
    const key = SAY[t];
    if (!key) return false;
    if (!voiceOf(key)) return !!FAM[fam] && !CREW.has(key); // (no GPWS on a DC-3: silence, not the browser's voice)
    if (performance.now() - (said[key] || 0) < 1500) return true; // (two parts calling the same: once)
    said[key] = performance.now();
    pending.push({ key, prio: /^a\d/.test(key) || key === 'minimum' || key === 'hundredAbove' || key === 'retard' ? 5 : 4, at: performance.now() });
    return true;
  }
  const said = {};

  // ---------- each tick ----------
  let fam = 'airbus', prev = null, startAt = null, stallT = 0, ovsT = 0, cfgT = 0, mwT = 0, mwSeen = '', creakT = 0, bankT = 0;
  function ready() {
    if (!FG.sound || !FG.sound.on) return false;
    if (!ac && !build()) return false;
    return true;
  }
  function tick() {
    const P = FG.pilot, s = P && P.state;
    if (!s || !s.active || s.loading || !FG.sound || !FG.sound.on) { if (ac) { T(out.gain, 0, 0.1); silence(); } prev = null; return; }
    if (!ready()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (s.startAt !== startAt) { startAt = s.startAt; fam = familyOf(s.spec); preload(fam); prev = null; silence(); stallT = ovsT = cfgT = mwT = creakT = bankT = 0; mwSeen = ''; }
    const idle = s.paused || s.menu;
    T(out.gain, idle ? 0 : 0.9 * (FG.sound.volume ?? 0.6), 0.1);
    if (idle) { silence(); return; }
    const F = FAM[fam], sp = s.spec, now = performance.now(), dt = 0.05;
    const inside = s.cam === 'cockpit';
    T(fxTone.frequency, inside ? 1800 : 12000, 0.2);
    T(spk.gain, inside ? 0.9 : 0.45, 0.2);
    const kt = s.crashed ? 0 : (P.api && P.api.ias ? P.api.ias() : s.V / KT);
    const q = (kt / 250) ** 2; // (the dynamic pressure, about 1 at 250 kt)
    const air = !s.onGround && !s.crashed;

    // the air rushing past
    T(L.wind.f.frequency, inside ? 250 + kt * 2.2 : 500 + kt * 9);
    T(L.wind.g.gain, clamp(0.35 * q, 0, 0.9) * (inside ? 0.8 : 1));
    // the engines
    const n1 = s.crashed ? 0 : (s.n1 || []).reduce((a, b) => a + b, 0) / Math.max(1, (s.n1 || []).length);
    const k1 = clamp(n1 / 100, 0, 1.1), prop = sp.engine === 'prop' || sp.engine === 'piston';
    T(L.eng.f.frequency, prop ? 220 + 200 * k1 : 70 + 260 * k1 ** 1.5);
    T(L.eng.g.gain, (prop ? 0.5 : 0.35) * k1 ** 1.4 * (inside ? 0.7 : 1));
    T(L.eng.lfo.frequency, prop ? (sp.engine === 'piston' ? 14 + 40 * k1 : 55 + 25 * k1) : 1);
    T(L.eng.depth.gain, prop ? 0.7 : 0);
    T(L.eng.hi.f.frequency, 900 + 1400 * k1);
    T(L.eng.hi.g.gain, prop ? 0.02 * k1 : 0.07 * k1 ** 2 * (inside ? 0.25 : 1));
    // the runway rumbling under the wheels
    const rollK = s.onGround && !s.crashed ? clamp(kt / 120, 0, 1.3) : 0;
    T(L.roll.g.gain, 0.45 * rollK); T(L.roll.f.frequency, 90 + 120 * rollK);
    L.roll.am.gain.setTargetAtTime(0.6 + 0.6 * Math.random(), ac.currentTime, 0.03);
    // gear, flaps and speed brakes out in the air; buffet
    const flap = s.flapPos / Math.max(1, (sp.conf || []).length - 1 || 1);
    const drag = air ? q * ((sp.gear !== 'fixed' ? 0.5 * s.gear : 0) + 0.35 * clamp(flap, 0, 1) + 0.6 * (s.sb || 0)) : s.onGround ? 0.3 * rollK * Math.max(s.sb || 0, s.gs || 0) : 0;
    T(L.drag.g.gain, clamp(0.5 * drag, 0, 0.8));
    const bf = s.crashed ? 0 : Math.max(s.buffet || 0, s.stallAmt || 0, air ? 0.5 * (s.sb || 0) * q : 0);
    T(L.buffet.g.gain, clamp(0.8 * bf, 0, 1));
    L.buffet.am.gain.setTargetAtTime(0.3 + Math.random() * 1.2, ac.currentTime, 0.02);
    // the motors: the flaps moving to the lever's detent, the gear in transit
    const M = F.motor;
    const flapMoving = !s.crashed && Math.abs(s.conf - s.flapPos) > 0.002 && M.flap > 0;
    T(L.flapM.g.gain, flapMoving ? (M.kind === 'hyd' ? 0.05 : 0.07) : 0, 0.15);
    T(L.flapM.o.frequency, M.flap * (1 + 0.04 * Math.sin(now / 700)), 0.2);
    T(L.flapM.lp.frequency, M.kind === 'hyd' ? 1600 : 900);
    const gearMoving = !s.crashed && sp.gear !== 'fixed' && s.gear > 0.002 && s.gear < 0.998;
    T(L.gearM.g.gain, gearMoving ? 0.06 : 0, 0.15);
    T(L.gearM.o.frequency, M.gear * (s.gearDown ? 0.92 : 1.05));
    // scraping metal: a wing on the ground, the wreck sliding
    const slide = s.crashed && s.wreck ? clamp(s.wreck.v / 40, 0, 1.2) : 0;
    const scr = Math.max(s.scrape > 0 && !s.crashed ? clamp(kt / 100, 0.3, 1.2) : 0, slide);
    T(L.scrape.g.gain, 0.5 * scr, 0.05);
    L.scrape.am.gain.setTargetAtTime(0.4 + Math.random(), ac.currentTime, 0.02);
    // fire: a burning wing, a burning wreck
    const pose = P.pose ? P.pose() : null;
    const fw = pose && pose.fire ? Math.max(...(pose.fire.wing || [0]), pose.fire.slide || 0) : 0;
    const burning = s.burnAt && now - s.burnAt < 240000 ? clamp(1 - (now - s.burnAt) / 240000, 0.3, 1) : 0;
    const fire = Math.max(fw, burning);
    T(L.fire.g.gain, 0.5 * fire, 0.3);
    L.fire.cr.g.gain.setTargetAtTime(fire * (Math.random() < 0.3 ? 0.4 * Math.random() : 0), ac.currentTime, 0.01);

    // the events since the last tick
    const d = s.dmg || {};
    const cur0 = { cut0: (d.cut || [])[0] || 0, cut1: (d.cut || [])[1] || 0, elev: d.elev || 0, rud: d.rud || 0, crashed: !!s.crashed,
      touch: s.touch ? s.touch.at : 0, gearDown: s.gearDown, gearUp: s.gear < 0.002, gearDn: s.gear > 0.998, conf: s.conf, flapAt: !flapMoving && !s.crashed,
      body: (d.body || []).join(','), gone: !!s.gone };
    if (prev) {
      for (const k of ['cut0', 'cut1']) if (cur0[k] && cur0[k] !== prev[k]) fx.tear(cur0[k] <= 0.55 ? 1.4 : 0.6); // (a wing: 0.5 of the span, a tip: 0.8)
      if (cur0.elev === 2 && prev.elev !== 2) fx.tear(0.6);
      else if (cur0.elev === 1 && !prev.elev) fx.clunk(0.7, 90);
      if (cur0.rud && !prev.rud) fx.tear(0.5);
      if (cur0.crashed && !prev.crashed) {
        silence();
        fx.crash(s.impact || 1);
        if (s.gone || (s.impact || 0) > 0.9 || s.burnAt) fx.whoomp(s.gone ? 1.5 : 1);
      }
      if (cur0.touch && cur0.touch !== prev.touch && !s.crashed) fx.thump(Math.abs(s.touch.fpm || 200));
      if (cur0.gearDown !== prev.gearDown && sp.gear !== 'fixed' && !s.crashed) fx.clunk(0.35, 140); // (the doors open)
      if ((cur0.gearUp && !prev.gearUp) || (cur0.gearDn && !prev.gearDn)) if (sp.gear !== 'fixed' && !s.crashed) { fx.clunk(cur0.gearDn ? 0.8 : 0.6, cur0.gearDn ? 95 : 120); }
      if (cur0.conf !== prev.conf) fx.detent();
      if (cur0.flapAt && !prev.flapAt && M.flap) fx.clunk(0.25, 160);
    }
    prev = cur0;
    if (s.crashed) { stopWarnings(); return; }

    // creaking under load: from 85 % of the limit load (or pushing past -0.6 g), more often and louder towards the break
    const over = sp.gLimit ? Math.max((s.load || 1) / sp.gLimit, -(s.load || 0) / 1) : 0;
    if (air && over > 0.85) {
      creakT -= dt;
      if (creakT <= 0) { fx.creak(clamp((over - 0.75) * 2, 0.3, 1.5)); creakT = 0.15 + Math.random() * 0.9 / Math.max(1, (over - 0.85) * 8); }
    }

    // the warnings, as this family sounds them
    const W = (s.warn || []).map((x) => x[0]);
    const has = (re) => W.some((t) => re.test(t));
    const stall = has(/^(STALL|STICK SHAKER)/);
    T(L.shaker.g.gain, stall && F.stall === 'shaker' ? 0.35 : 0, 0.03);
    if (stall && F.stall === 'cricket') { stallT -= dt; if (stallT <= 0) { tones.cricket(); stallT = 1.1; } }
    if (stall && F.stall === 'cricket') want('stall', 1, 0.4); // (Airbus: "stall, stall"; the others shake the stick)
    if (!stall) stallT = 0;
    const ovs = has(/^OVERSPEED/) ? 'overspeed' : has(/^(FLAP|GEAR) SPEED/) ? 'vfe' : null;
    const ovTone = ovs && F[ovs];
    if (ovTone) { ovsT -= dt; if (ovsT <= 0) { tones[ovTone](); ovsT = ovTone === 'clacker' ? 0.5 : 0.62; } } else ovsT = 0;
    if (has(/^CONFIG:/) && F.config) { cfgT -= dt; if (cfgT <= 0) { tones[F.config](); cfgT = F.config === 'horn' ? 0.9 : 0.62; } } else cfgT = 0;
    // damage: the master warning for a few seconds when something new goes
    const dmg = W.filter((t) => /LOST|F\/CTL|OUT OF CONTROL|OVERSTRESS/.test(t)).join('|');
    if (dmg && dmg !== mwSeen && F.master) mwT = 4;
    mwSeen = dmg;
    if (mwT > 0) { const b = mwT; mwT -= dt; const per = F.master === 'gong' ? 1.2 : 0.62; if (Math.floor(b / per) !== Math.floor(mwT / per) || b === 4) tones[F.master](); }
    // the GPWS: its modes, the bank angle, then the callouts waiting
    if (F.voice) {
      for (const [re, prio, key, gap] of MODES) if (has(re)) want(key, prio, gap);
      const bankLim = fam === 'airbus' ? 40 : 35;
      if (air && Math.abs(s.phi) > bankLim && !(FG.systems && FG.systems.S && FG.systems.S.gpws && !FG.systems.S.gpws.sys)) { bankT += dt; if (bankT > 0.5) want('bankAngle', 7, 1.5); } else bankT = 0;
    }
    pending = pending.filter((p) => now - p.at < 2500);
    for (const p of pending) wants.push(p);
    resolve();
  }
  let wants = [];
  function want(key, prio, gap) {
    if (ac.currentTime - (lastEnd[key] ?? -99) < gap) return;
    wants.push({ key, prio });
  }
  function resolve() {
    if (wants.length) {
      wants.sort((a, b) => a.prio - b.prio);
      const w = wants[0];
      if (play(w.key, w.prio)) pending = pending.filter((p) => p.key !== w.key);
    }
    wants = [];
  }
  function stopWarnings() { T(L.shaker.g.gain, 0, 0.05); T(L.flapM.g.gain, 0, 0.1); T(L.gearM.g.gain, 0, 0.1); T(L.drag.g.gain, 0, 0.3); T(L.buffet.g.gain, 0, 0.3); T(L.roll.g.gain, 0, 0.3); T(L.wind.g.gain, 0, 0.5); }
  setInterval(() => { try { tick(); } catch (e) { console.warn('cocksnd', e); } }, 50);

  // ---------- for the other parts ----------
  // the fire bell and the autopilot's disconnect, as this family has them (src/systems.js, src/fmgc.js): true if
  // played here (else they play their Airbus tones)
  function ours(kind) {
    const s = FG.pilot && FG.pilot.state;
    if (!s || !s.active || !ready()) return false;
    const t = FAM[familyOf(s.spec)][kind];
    if (!t || t === 'crc' || t === 'cavalry') return false;
    tones[t]();
    return true;
  }
  FG.cocksnd = {
    say,
    bell: () => ours('fire'), // (the fire warning, once round)
    apOff: () => ours('ap'),
    familyOf, get family() { return fam; },
    tones, fx, log,
    level() { // (the loudness now, 0 … 1: tests run muted)
      if (!meter) return 0;
      const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a);
      let e = 0; for (const x of a) e += x * x; return Math.sqrt(e / a.length);
    },
    get ctx() { return ac; },
  };
})();
