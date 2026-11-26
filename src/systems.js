// Aircraft systems for Fly it yourself: what the overhead panel and the pedestal switch, and what follows from it.
//   - exterior lights: beacon, strobe (OFF / AUTO / ON), NAV & LOGO, wing, runway turn-off, landing (RETRACT / OFF /
//     ON) and the nose light (OFF / TAXI / T.O). The 3D view draws them on the aircraft (pose().pilot.lights);
//   - the cockpit's own: dome (OFF / DIM / BRT), the panels' integral lighting and the flood light (knobs);
//   - signs: seat belts, no smoking (a chime in the cabin each time);
//   - engines: a master switch per engine and the ENG MODE selector (CRANK / NORM / IGN START). A master OFF cuts the
//     fuel: the engine runs down to windmilling and gives no thrust. Back ON with IGN selected it starts again (about
//     40 s to idle) if there is air for the starter: the APU's bleed, another engine running, or 220 kt of ram air;
//   - the APU: MASTER SW then START, about 60 s to AVAIL; its bleed;
//   - fire: an engine or the APU catches fire (the failures menu, or now and then by itself if random failures are
//     on). Red master warning, the continuous chime, the FIRE pushbutton and the ENG MASTER's FIRE light lit, and the
//     procedure on the E/WD. Push the FIRE pushbutton (the engine's fuel and bleed are cut, the squibs armed), wait
//     10 s, AGENT 1; still burning after 30 s, AGENT 2. An engine left running in a fire seizes after 40 s; a fire
//     no bottle puts out goes on to the end of the flight (LAND ASAP);
//   - anti-ice (engines, wing), the wipers, the fire test;
//   - the E/WD's memo and warnings: T.O MEMO on the ground, LDG MEMO under 2000 ft, the green memos (SEAT BELTS, APU
//     AVAIL, IGNITION, ...), amber cautions (ENG 1 SHUT DOWN) and red warnings with their procedures, cyan lines
//     that go when done.
//
// The overhead panel itself (0, or 🔆 Overhead in the HUD bar) and the pedestal (9) are pages of src/panels.js's
// modules, the same as the 3D flight deck's (src/cockpit3d.js), clicked in 2D or 3D: all call set().
// Hooks in src/pilot.js: engine(i, n1, dt) in the engines' loop, warnings() into the HUD's list, lights() into
// pose(), step(dt) each frame, key(k) for the keys pilot.js leaves free, snapshot() / restore() with the
// checkpoints.
(function () {
  'use strict';
  const P = FG.pilot;
  if (!P || !P.api) return;
  const A = P.api;
  const { KT, FT } = A;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const s = P.state;

  // ---------- the state ----------
  let S = null;
  // More systems plug in here (src/aircraft.js: electrics, hydraulics, fuel, air, ADIRS, GPWS, ice; src/radio.js:
  // the radios, the transponder and TCAS). Each may have: fresh(S, n) its part of the state; begin(S) where the crew
  // would have its switches; set(what, v, i) → true when it took the switch; step(dt); warnings() / cautions() →
  // names; proc(name, add, air) → the procedure's lines under its name on the E/WD; memo() → green memo names;
  // starved(i) → true when engine i gets no fuel; lights(L) → the exterior lights after power; sd(c, W, H, page) →
  // true when it drew that SD page; filter(w) → the HUD's warnings it leaves.
  const plugins = [];
  const fresh = (n) => ({
    startAt: null,
    lt: { beacon: 1, strobe: 'AUTO', nav: 1, wing: 0, rwy: 1, land: 'ON', nose: 'TO', dome: 'OFF', integ: 0.8, flood: 0, ann: 'BRT' },
    signs: { belts: 1, smoke: 1 },
    engMode: 'NORM',
    eng: Array.from({ length: n }, () => ({ master: 1, run: 1, start: 0, fire: false, fireT: 0, firePb: false, agents: [0, 0], agentT: null, failed: false, antiIce: 0 })),
    apu: { master: 0, start: 0, n: 0, avail: false, bleed: 0, fire: false, firePb: false, agent: 0 },
    wingAntiIce: 0, wipers: [0, 0], wiperPhase: [0, 0],
    test: 0, // fire test: seconds left
    mw: false, mc: false, mwSilenced: false, // master warning / caution lit; the chime silenced
    seen: {}, // warnings already announced (so the caution chime sounds once)
    random: false, nextRandom: 0,
    log: [], // what happened, for the systems page
  });
  const freshAll = (n) => { const x = fresh(n); for (const p of plugins) if (p.fresh) p.fresh(x, n); return x; };

  // Starting positions of the switches: as a crew would have them for where the flight starts.
  function begin() {
    const sp = s.spec;
    S = freshAll(sp.engines);
    S.startAt = s.startAt;
    S.random = !!(prefs().random);
    S.nextRandom = 300 + Math.random() * 900;
    const L = S.lt;
    const low = s.onGround || A.agl() < 10000 * FT;
    if (s.mode === 'runway') Object.assign(L, { strobe: 'ON', land: 'ON', nose: 'TO', rwy: 1 });
    else if (s.mode === 'final') Object.assign(L, { strobe: 'AUTO', land: 'ON', nose: 'TO', rwy: 1 });
    else Object.assign(L, { strobe: 'AUTO', land: low ? 'ON' : 'RETRACT', nose: low ? 'TO' : 'OFF', rwy: low ? 1 : 0 });
    S.signs.belts = low ? 1 : 0;
    L.dome = 'OFF';
    for (const p of plugins) if (p.begin) p.begin(S);
    refreshAll();
  }
  function prefs() { try { return JSON.parse(localStorage.getItem('flightgame.fly.systems') || '{}'); } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem('flightgame.fly.systems', JSON.stringify({ ...prefs(), ...p })); } catch (e) { /* */ } }
  function ready() {
    if (!s.active || !s.spec) return false;
    if (!S || S.startAt !== s.startAt || S.eng.length !== s.spec.engines) begin();
    return true;
  }

  // ---------- sounds ----------
  let ac = null, crcTimer = null;
  function tone(freqs, dur, gap, vol = 0.1, type = 'sine') {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime + 0.02;
      for (const f of freqs) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
        t += dur + gap;
      }
    } catch (e) { /* no audio */ }
  }
  const snd = {
    crc: () => tone([1100, 1100, 1100], 0.13, 0.04, 0.09, 'triangle'), // (the continuous repetitive chime, once round)
    caution: () => tone([1000], 0.5, 0, 0.08),
    cabin: () => tone([988, 784], 0.6, 0.05, 0.06), // (the cabin's two-tone ding for the signs)
    click: () => tone([2400], 0.012, 0, 0.05, 'square'),
  };
  function crc(on) {
    if (on && !crcTimer) { snd.crc(); crcTimer = setInterval(() => { if (!s.active || s.paused || s.menu) return; snd.crc(); }, 620); }
    else if (!on && crcTimer) { clearInterval(crcTimer); crcTimer = null; }
  }

  // ---------- what happens ----------
  function note(text) { S.log.unshift({ text, at: s.flightT || 0 }); S.log.length = Math.min(S.log.length, 8); }
  const engName = (i) => `ENG ${i + 1}`;
  // Air for an engine start: the APU's bleed, another engine turning, or ram air fast enough to windmill it up.
  // (another engine's air only with its bleed valve open: src/aircraft.js S.air)
  const engBleed = (j) => !S.air || !!S.air.engBleed[j];
  const startAir = (i) => (S.apu.avail && S.apu.bleed) || S.eng.some((e, j) => j !== i && e.run === 1 && engBleed(j)) || (!s.onGround && A.ias() > 220);
  // The fuel to engine i is cut: master off, or its FIRE pushbutton pushed.
  const fuelCut = (e) => !e.master || e.firePb;

  // Set a switch: called by the overhead page, the 3D deck's clicks and the keys. `what` names it, `v` its new
  // position (or undefined: the next one).
  function set(what, v, i) {
    if (!ready()) return;
    const L = S.lt, cycle = (cur, list) => (v !== undefined ? v : list[(list.indexOf(cur) + 1) % list.length]);
    snd.click();
    switch (what) {
      case 'beacon': case 'nav': case 'wing': case 'rwy': L[what] = v !== undefined ? v : L[what] ? 0 : 1; break;
      case 'strobe': L.strobe = cycle(L.strobe, ['OFF', 'AUTO', 'ON']); break;
      case 'land': L.land = cycle(L.land, ['RETRACT', 'OFF', 'ON']); break;
      case 'nose': L.nose = cycle(L.nose, ['OFF', 'TAXI', 'TO']); break;
      case 'dome': L.dome = cycle(L.dome, ['OFF', 'DIM', 'BRT']); break;
      case 'integ': L.integ = clamp(v !== undefined ? v : (L.integ >= 0.99 ? 0 : L.integ + 0.25), 0, 1); break;
      case 'flood': L.flood = clamp(v !== undefined ? v : (L.flood >= 0.99 ? 0 : L.flood + 0.25), 0, 1); break;
      case 'ann': L.ann = cycle(L.ann, ['TEST', 'BRT', 'DIM']); break;
      case 'belts': S.signs.belts = v !== undefined ? v : S.signs.belts ? 0 : 1; snd.cabin(); break;
      case 'smoke': S.signs.smoke = v !== undefined ? v : S.signs.smoke ? 0 : 1; snd.cabin(); break;
      case 'engMode': S.engMode = cycle(S.engMode, ['CRANK', 'NORM', 'IGN']); break;
      case 'master': {
        const e = S.eng[i];
        if (!e) break;
        e.master = v !== undefined ? v : e.master ? 0 : 1;
        if (!e.master) { if (e.run) note(`${engName(i)} master off: fuel cut`); }
        else if (!e.run && !e.firePb) {
          if (e.failed) A.say(`${engName(i)} has failed: it will not start again`, 'amber', 3000);
          else if (S.engMode !== 'IGN') A.say('ENG MODE selector to IGN START first, then the master on', 'amber', 3500);
          else if (!startAir(i)) A.say(`No air for the starter: APU bleed on (APU running), or another engine${s.onGround ? '' : ', or more than 220 kt'}`, 'amber', 4000);
        }
        break;
      }
      case 'engAntiIce': if (S.eng[i]) S.eng[i].antiIce = v !== undefined ? v : S.eng[i].antiIce ? 0 : 1; break;
      case 'wingAntiIce': S.wingAntiIce = v !== undefined ? v : S.wingAntiIce ? 0 : 1; break;
      case 'wiper': S.wipers[i || 0] = cycle(S.wipers[i || 0], [0, 1, 2]); break;
      case 'apuMaster': S.apu.master = v !== undefined ? v : S.apu.master ? 0 : 1; if (!S.apu.master) { S.apu.start = 0; } break;
      case 'apuStart': if (S.apu.master && !S.apu.avail && !S.apu.firePb) S.apu.start = 1; break;
      case 'apuBleed': S.apu.bleed = v !== undefined ? v : S.apu.bleed ? 0 : 1; break;
      case 'firePb': {
        const e = i === 'apu' ? S.apu : S.eng[i];
        if (!e || e.firePb) break;
        e.firePb = true;
        if (i === 'apu') { S.apu.master = 0; S.apu.start = 0; }
        else e.agentT = 0;
        note(`${i === 'apu' ? 'APU' : engName(i)} FIRE pushbutton pushed: fuel, bleed and hydraulics cut, squibs armed`);
        S.mwSilenced = true; // (pushing it silences the chime)
        break;
      }
      case 'agent': { // i: engine index or 'apu'; v: bottle 0 or 1
        const e = i === 'apu' ? S.apu : S.eng[i];
        if (!e || !e.firePb) { A.say('Push the FIRE pushbutton first: it arms the squibs', 'amber', 3000); break; }
        if (i === 'apu') { if (S.apu.agent) break; S.apu.agent = 1; discharge(e, 0.95, 'APU'); break; }
        const b = v || 0;
        if (e.agents[b]) break;
        e.agents[b] = 1;
        // (a bottle into a running engine helps little; into one shut down and cooling, nearly always; the second
        // bottle into the same engine nearly always)
        const p = !e.run && e.n1 < 40 ? (b ? 0.92 : 0.75) : (b ? 0.6 : 0.25);
        discharge(e, p, engName(i));
        break;
      }
      case 'fireTest': S.test = 3; break;
      case 'masterWarn': S.mwSilenced = true; S.mw = false; break;
      case 'masterCaut': S.mc = false; S.cautAck = currentCautions().join('|'); break;
      case 'random': S.random = v !== undefined ? !!v : !S.random; savePrefs({ random: S.random }); break;
      case 'fail': fail(v, i); break;
      default:
        if (!plugins.some((p) => p.set && p.set(what, v, i))) return;
    }
    refreshAll();
  }
  function discharge(e, p, name) {
    note(`${name} agent discharged`);
    // the agent takes a few seconds to work
    setTimeout(() => {
      if (!S || !e.fire) return;
      if (Math.random() < p) { e.fire = false; note(`${name} fire out`); A.say(`${name} FIRE: out`, 'info', 4000); refreshAll(); }
    }, 2500 + Math.random() * 2000);
  }
  // Failures: 'fire' (engine i), 'apuFire', 'fail' (engine i flames out and cannot be started again).
  function fail(kind, i) {
    if (kind === 'apuFire') { S.apu.fire = true; S.apu.fireT = 0; note('APU FIRE'); }
    else if (kind === 'fire') { const e = S.eng[i]; if (!e || e.fire) return; e.fire = true; e.fireT = 0; note(`${engName(i)} FIRE`); }
    else if (kind === 'fail') { const e = S.eng[i]; if (!e) return; e.failed = true; note(`${engName(i)} FAIL`); }
    S.mwSilenced = false;
  }

  // Each engine, each physics step (src/pilot.js): null when it runs as the physics wants, else its N1 now (and it
  // gives no thrust). `n` its N1, `idle` the idle N1.
  function engine(i, n, dt) {
    if (!S || !S.eng[i]) return null;
    const e = S.eng[i], idle = A.idle();
    e.n1 = n;
    const off = fuelCut(e) || e.failed || plugins.some((p) => p.starved && p.starved(i)); // (no fuel reaching it: a flame-out)
    if (!off && e.run === 1) return null;
    // windmilling: the air turns the fan a little, more the faster it flies
    const wind = s.onGround ? 0 : clamp(A.ias() / 30, 0, 12);
    if (off) {
      e.run = 0; e.start = 0;
      return Math.max(wind, n - (n > idle ? 6 : 2.5) * dt);
    }
    // master on, fuel on: start it (IGN), or it stays at windmilling
    if (!e.start) {
      if (S.engMode === 'IGN' && startAir(i)) { e.start = 1; note(`${engName(i)} start`); }
      else return Math.max(wind, n - 2.5 * dt);
    }
    // starting: the starter takes it to about 20 %, then the fire lights and it runs up to idle (about 40 s in all)
    const to = idle + 0.3;
    const rate = n < 20 ? 1.1 : 0.55;
    const n2 = Math.min(to, n + rate * dt);
    if (n2 >= to - 0.01) { e.run = 1; e.start = 0; note(`${engName(i)} running (AVAIL)`); A.say(`${engName(i)} AVAIL`, 'info', 2500); refreshAll(); }
    return n2;
  }

  // Once a frame (src/pilot.js step).
  function step(dt) {
    if (!ready()) return;
    if (s.paused || s.menu || s.crashed) { crc(false); return; }
    const air = !s.onGround;
    // the APU: 60 s to AVAIL, then running
    const ap = S.apu;
    if (ap.master && ap.start && !ap.firePb) {
      ap.n = Math.min(100, ap.n + dt * (ap.n < 95 ? 1.8 : 0.8));
      if (ap.n >= 95 && !ap.avail) { ap.avail = true; ap.start = 0; note('APU AVAIL'); refreshAll(); }
    } else if (!ap.master || ap.firePb) {
      ap.n = Math.max(0, ap.n - dt * 4); if (ap.avail) { ap.avail = false; refreshAll(); }
    }
    // fires: an engine running in a fire seizes after 40 s; on the ground the APU fire puts itself out (auto)
    for (const [k, e] of S.eng.entries()) {
      if (!e.fire) continue;
      e.fireT += dt;
      if (e.firePb && e.agentT != null) e.agentT += dt;
      if (e.fireT > 40 && !fuelCut(e) && !e.failed) { e.failed = true; note(`${engName(k)} seized in the fire`); A.say(`${engName(k)} seized: the fire was not fought`, 'red', 4000); }
    }
    if (ap.fire) {
      ap.fireT = (ap.fireT || 0) + dt;
      if (!air && !ap.firePb && ap.fireT > 3) { set('firePb', undefined, 'apu'); set('agent', 0, 'apu'); }
    }
    // random failures, now and then (about once an hour of flying, half of them fires)
    if (S.random && air) {
      S.nextRandom -= dt;
      if (S.nextRandom <= 0) {
        S.nextRandom = 1800 + Math.random() * 3600;
        const i = Math.floor(Math.random() * S.eng.length), r = Math.random();
        fail(r < 0.5 ? 'fire' : r < 0.85 ? 'fail' : 'apuFire', i);
        refreshAll();
      }
    }
    // the fire test (3 s): every fire light, the master warning and the chime
    if (S.test > 0) S.test = Math.max(0, S.test - dt);
    // wipers
    for (let w = 0; w < 2; w++) if (S.wipers[w]) S.wiperPhase[w] += dt * (S.wipers[w] === 2 ? 1.4 : 0.7);
    // master warning and caution, and the chimes
    const red = currentWarnings().length > 0 || S.test > 0;
    if (red && !S.mwSilenced) S.mw = true;
    if (!red) { S.mw = false; S.mwSilenced = false; }
    crc((S.mw && !S.mwSilenced) || S.test > 0);
    const cauts = currentCautions().join('|');
    if (cauts && cauts !== S.cautAck && cauts !== S.cautSeen) { S.mc = true; snd.caution(); }
    S.cautSeen = cauts;
    if (!cauts) { S.mc = false; S.cautAck = ''; }
    for (const p of plugins) if (p.step) p.step(dt);
  }

  // Red warnings (each with its procedure) and amber cautions, for the E/WD and the HUD.
  function currentWarnings() {
    if (!S) return [];
    const w = [];
    S.eng.forEach((e, i) => { if (e.fire) w.push(`${engName(i)} FIRE`); });
    if (S.apu.fire) w.push('APU FIRE');
    for (const p of plugins) if (p.warnings) w.push(...p.warnings());
    return w;
  }
  function currentCautions() {
    if (!S) return [];
    const c = [];
    S.eng.forEach((e, i) => {
      if (e.fire) return;
      if (e.failed) c.push(`${engName(i)} FAIL`);
      else if (!e.run && !e.start && !s.onGround) c.push(`${engName(i)} SHUT DOWN`);
    });
    for (const p of plugins) if (p.cautions) c.push(...p.cautions());
    return c;
  }
  // The E/WD's lower half: [text, colour] lines. Red warnings with cyan actions still to do, then cautions, then
  // the memo (T.O / LDG memo, or the green memos).
  function ecamLines() {
    if (!ready()) return [];
    const out = [], air = !s.onGround;
    const add = (t, c) => out.push([t, c]);
    S.eng.forEach((e, i) => {
      if (!e.fire) return;
      const n = i + 1;
      add(`ENG ${n} FIRE`, 'red');
      if (air) { if (s.lever > 0.02) add(`-THR LEVERS ........ IDLE`, 'cyan'); }
      else { add('-THR LEVERS ........ IDLE', s.lever > 0.02 ? 'cyan' : null); if (s.V > 2) add('-PARKING BRK ........ ON', s.parking ? null : 'cyan'); }
      if (e.master) add(`-ENG MASTER ${n} ........ OFF`, 'cyan');
      if (!e.firePb) add(`-ENG ${n} FIRE P/B ...... PUSH`, 'cyan');
      if (!e.agents[0]) {
        const left = e.agentT == null ? 10 : Math.max(0, Math.ceil(10 - e.agentT));
        add(left > 0 && air ? `-AGENT 1 AFTER ${left} S .. DISCH` : '-AGENT 1 ........... DISCH', 'cyan');
      }
      if (air) {
        if (e.agents[0] && !e.agents[1]) add('.IF FIRE AFTER 30 S:', 'white');
        if (!e.agents[1]) add('-AGENT 2 ........... DISCH', 'cyan');
        add('-ATC ............... NOTIFY', 'cyan');
      } else add('-EVAC .............. INITIATE', 'cyan');
    });
    for (const p of plugins) if (p.warnings) for (const w of p.warnings()) { add(w, 'red'); procOf(w, add, air); }
    if (S.apu.fire) {
      add('APU FIRE', 'red');
      if (!S.apu.firePb) add('-APU FIRE P/B ....... PUSH', 'cyan');
      if (!S.apu.agent) add('-AGENT .............. DISCH', 'cyan');
      if (S.apu.master) add('-APU MASTER SW ....... OFF', 'cyan');
    }
    for (const c of currentCautions()) {
      add(c, 'amber');
      procOf(c, add, air);
      if (/SHUT DOWN|FAIL/.test(c) && air) { add('-LAND ASAP', 'amber'); }
      if (/SHUT DOWN/.test(c) && air) add(`-RELIGHT: ENG MODE IGN, MASTER ON`, 'cyan');
    }
    if (S.eng.some((e) => e.fire && e.agents[1]) && air) add('LAND ASAP', 'red');
    if (out.length) return out;
    // the memo
    const a = A.agl() / FT;
    const flapsTo = s.conf >= 1 && s.conf <= Math.max(1, s.spec.toConf);
    if (!air && !s.landed && A.ias() < 60 && s.spec.maker === 'Airbus') {
      add('T.O', 'white');
      const pair = (k, ok, want) => add(ok ? `${k} ${want}` : `${k} ........ ${want}`, ok ? 'green' : 'cyan');
      pair('AUTO BRK', !!(FG.fmgc && FG.fmgc.F && FG.fmgc.F.abrk === 'MAX'), 'MAX');
      pair('SIGNS', S.signs.belts && S.signs.smoke, 'ON');
      pair('SPLRS', !!s.armed, 'ARM');
      pair('FLAPS', flapsTo, 'T.O');
      pair('T.O CONFIG', flapsTo && !s.parking && !s.sb, 'NORMAL');
    } else if (air && a < 2000 && A.vsFpm() < 0 && s.spec.maker === 'Airbus') {
      add('LDG', 'white');
      const pair = (k, ok, want) => add(ok ? `${k} ${want}` : `${k} ........ ${want}`, ok ? 'green' : 'cyan');
      pair('LDG GEAR', s.gear > 0.99, 'DN');
      pair('SIGNS', S.signs.belts && S.signs.smoke, 'ON');
      pair('SPLRS', !!s.armed, 'ARM');
      const ldg3 = plugins.some((p) => p.ldgConf3 && p.ldgConf3()) && s.spec.conf.length > 2; // (GPWS LDG FLAP 3: CONF 3 is the landing flap)
      const want = ldg3 ? s.spec.conf.length - 2 : s.spec.conf.length - 1;
      pair('FLAPS', s.conf >= want, s.spec.conf[want].name);
    }
    if (out.length) return out;
    const memo = [];
    if (S.signs.belts) memo.push('SEAT BELTS');
    if (S.signs.smoke) memo.push('NO SMOKING');
    if (air && S.lt.strobe === 'OFF') memo.push('STROBE LT OFF');
    if (S.lt.land === 'ON' && air && a > 10000) memo.push('LDG LT');
    if (S.apu.avail) memo.push(S.apu.bleed ? 'APU BLEED' : 'APU AVAIL');
    if (S.engMode === 'IGN') memo.push('IGNITION');
    if (S.eng.some((e) => e.antiIce)) memo.push('ENG A.ICE');
    if (S.wingAntiIce) memo.push('WING A.ICE');
    if (s.parking) memo.push('PARK BRK');
    if (s.sb > 0 && air) memo.push('SPEED BRK');
    for (const p of plugins) if (p.memo) memo.push(...p.memo());
    for (const m of memo) add(m, 'green');
    return out;
  }
  const procOf = (name, add, air) => { for (const p of plugins) if (p.proc) p.proc(name, add, air); };
  // For the HUD's list (src/pilot.js warnings()).
  function warnings() {
    if (!ready()) return [];
    const w = [];
    for (const t of currentWarnings()) w.push([`${t} — 0: overhead (FIRE p/b, AGENT)`, 'red']);
    for (const t of currentCautions()) w.push([t, 'amber']);
    return w;
  }
  // The exterior lights for the 3D view: 0..1 each of nav, beacon, strobe, landing (the nose and turn-off lights
  // count as a dimmer landing light).
  function lights() {
    if (!S) return null;
    const L = S.lt, air = !s.onGround;
    const strobe = L.strobe === 'ON' || (L.strobe === 'AUTO' && air);
    const land = L.land === 'ON' ? 1 : L.nose === 'TO' ? 0.8 : L.nose === 'TAXI' || L.rwy ? 0.5 : 0;
    const anyRun = S.eng.some((e) => e.run || e.start) || S.apu.avail;
    let out = { nav: L.nav ? 1 : 0, beacon: L.beacon && anyRun ? 1 : 0, strobe: strobe ? 1 : 0, land, wing: L.wing ? 1 : 0 };
    for (const p of plugins) if (p.lights) out = p.lights(out) || out;
    return out;
  }

  // ---------- keys (what src/pilot.js leaves free) ----------
  function key(k) {
    if (!ready()) return false;
    if (k === '0') { show(!open(), 'overhead'); return true; }
    if (k === '9') { show(!open('pedestal'), 'pedestal'); return true; }
    for (const p of plugins) if (p.key && p.key(k)) return true;
    return false;
  }
  // ---------- checkpoints ----------
  const snapshot = () => (S ? structuredClone(S) : null);
  function restore(snap) { if (snap) { S = structuredClone(snap); refreshAll(); } }

  // ---------- the panels as pages (src/panels.js draws them: the same modules as the 3D flight deck's) ----------
  const listeners = new Set(); // (the 3D deck and the pages repaint their panels when a switch moves)
  function refreshAll() { for (const f of listeners) try { f(); } catch (e) { /* */ } }
  function show(on, which = 'overhead') { if (FG.panels) FG.panels.page(which, on); }
  const open = (which = 'overhead') => !!(FG.panels && FG.panels.isOpen(which));

  // A button in the HUD's bar (it is made when the flight starts)
  const addBarButton = () => {
    const bar = document.querySelector('#pilot-hud .pl-bar');
    if (!bar || bar.querySelector('[data-pl="ovhd"]')) return;
    const b = document.createElement('button');
    b.dataset.pl = 'ovhd'; b.title = 'Overhead panel: lights, signs, APU, engines, fire (0)'; b.textContent = '🔆 Overhead';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (ready()) show(!open()); b.blur(); });
    bar.insertBefore(b, bar.querySelector('[data-pl="help"]'));
  };
  setInterval(() => { if (s.active) addBarButton(); else { if (FG.panels) FG.panels.closeAll(); crc(false); } }, 500);

  FG.systems = {
    get S() { return S; }, ready, set, engine, step, warnings, lights, ecamLines, key, snapshot, restore, show,
    currentWarnings, currentCautions, onChange(f) { listeners.add(f); }, refresh: refreshAll, note: (t) => S && note(t),
    get open() { return open(); },
    // the HUD's warnings after the plug-ins' filters (the GPWS switched off)
    filter(w) { for (const p of plugins) if (p.filter) w = p.filter(w); return w; },
    // an SD page a plug-in draws (true when one did)
    sd(c, W, H, page) { return ready() && plugins.some((p) => p.sd && p.sd(c, W, H, page)); },
    plug(p) { plugins.push(p); if (S && p.fresh) { p.fresh(S, S.eng.length); if (p.begin) p.begin(S); } },
    snd, tone,
  };
})();
