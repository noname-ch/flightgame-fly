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
// The overhead panel itself (0, or 🔆 Overhead in the HUD bar) is a page of switches here; the A320 family's 3D
// flight deck (src/cockpit3d.js) has the same switches on its overhead and pedestal, clicked in 3D: both call set().
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

  // Starting positions of the switches: as a crew would have them for where the flight starts.
  function begin() {
    const sp = s.spec;
    S = fresh(sp.engines);
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
  const startAir = (i) => (S.apu.avail && S.apu.bleed) || S.eng.some((e, j) => j !== i && e.run === 1) || (!s.onGround && A.ias() > 220);
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
      default: return;
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
    const off = fuelCut(e) || e.failed;
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
    // the overhead page, now and then
    if (page && !page.hidden && (S.pageAt = (S.pageAt || 0) + dt) > 0.25) { S.pageAt = 0; render(); }
  }

  // Red warnings (each with its procedure) and amber cautions, for the E/WD and the HUD.
  function currentWarnings() {
    if (!S) return [];
    const w = [];
    S.eng.forEach((e, i) => { if (e.fire) w.push(`${engName(i)} FIRE`); });
    if (S.apu.fire) w.push('APU FIRE');
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
    if (S.apu.fire) {
      add('APU FIRE', 'red');
      if (!S.apu.firePb) add('-APU FIRE P/B ....... PUSH', 'cyan');
      if (!S.apu.agent) add('-AGENT .............. DISCH', 'cyan');
      if (S.apu.master) add('-APU MASTER SW ....... OFF', 'cyan');
    }
    for (const c of currentCautions()) {
      add(c, 'amber');
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
      pair('FLAPS', s.conf >= s.spec.conf.length - 1, s.spec.conf[s.spec.conf.length - 1].name);
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
    for (const m of memo) add(m, 'green');
    return out;
  }
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
    return { nav: L.nav ? 1 : 0, beacon: L.beacon && anyRun ? 1 : 0, strobe: strobe ? 1 : 0, land, wing: L.wing ? 1 : 0 };
  }

  // ---------- keys (what src/pilot.js leaves free) ----------
  function key(k) {
    if (!ready()) return false;
    if (k === '0') { show(!page || page.hidden); return true; }
    return false;
  }
  // ---------- checkpoints ----------
  const snapshot = () => (S ? structuredClone(S) : null);
  function restore(snap) { if (snap) { S = structuredClone(snap); refreshAll(); } }

  // ---------- the overhead page (HTML): every switch, for any camera and type ----------
  let page = null;
  const listeners = new Set(); // (the 3D deck repaints its panels when a switch moves)
  function refreshAll() { if (page && !page.hidden) render(); for (const f of listeners) try { f(); } catch (e) { /* */ } }
  function show(on) {
    if (!page) {
      page = document.createElement('div');
      page.id = 'fly-ovhd';
      page.hidden = true;
      const css = document.createElement('style');
      css.textContent = `
#fly-ovhd { position: fixed; right: 12px; top: 56px; z-index: 60; width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 120px); overflow: auto;
  background: #3a3f46; color: #e9edf1; border: 2px solid #23262b; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
  font: 600 11px system-ui, sans-serif; padding: 8px 10px 10px; user-select: none; }
#fly-ovhd h3 { margin: 0 0 6px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; letter-spacing: .05em; }
#fly-ovhd h3 button { background: #23262b; color: #cfd8e2; border: 0; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
#fly-ovhd .ov-sec { background: #4b5058; border: 1px solid #2a2d31; border-radius: 4px; margin: 6px 0; padding: 6px 6px 4px; }
#fly-ovhd .ov-sec > b { display: block; text-align: center; color: #fff; font-size: 10px; letter-spacing: .12em; margin-bottom: 5px; border-bottom: 1px solid #fff4; padding-bottom: 2px; }
#fly-ovhd .ov-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
#fly-ovhd .ov-c { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 58px; }
#fly-ovhd .ov-c > span { font-size: 9px; color: #e9edf1; text-align: center; }
#fly-ovhd button.pb { width: 46px; height: 40px; background: #0b0c0e; border: 2px solid #6c737c; border-radius: 2px; color: #3a4048; cursor: pointer;
  display: flex; flex-direction: column; justify-content: space-between; align-items: center; padding: 3px 1px; font: 700 8px system-ui; }
#fly-ovhd button.pb i { font-style: normal; height: 10px; }
#fly-ovhd button.pb .t.on { color: #ffb000; text-shadow: 0 0 6px #ffb000; }
#fly-ovhd button.pb .t.red { color: #ff3b30; text-shadow: 0 0 6px #ff3b30; }
#fly-ovhd button.pb .b.on { color: #6fc8ff; text-shadow: 0 0 6px #6fc8ff; }
#fly-ovhd button.pb .b.w { color: #fff; text-shadow: 0 0 6px #fff; }
#fly-ovhd button.pb .b.g { color: #30d158; text-shadow: 0 0 6px #30d158; }
#fly-ovhd button.pb.fire { width: 70px; height: 46px; background: #2a0d0b; border-color: #a12a1d; }
#fly-ovhd button.pb.fire.lit { background: #a12a1d; color: #fff; box-shadow: 0 0 14px #ff3b30; }
#fly-ovhd button.pb.fire.pushed { transform: translateY(3px); border-style: inset; }
#fly-ovhd .sw { display: flex; flex-direction: column; border-radius: 3px; overflow: hidden; border: 1px solid #23262b; }
#fly-ovhd .sw button { background: #2a2d31; border: 0; color: #9aa1aa; font: 700 8px system-ui; padding: 3px 6px; cursor: pointer; }
#fly-ovhd .sw button.on { background: #d9dee4; color: #111; }
#fly-ovhd .knob { width: 70px; }
#fly-ovhd .apu { color: #30d158; font: 600 11px ui-monospace, monospace; }
#fly-ovhd .log { color: #b9c4cf; font: 500 10px ui-monospace, monospace; white-space: pre-line; margin-top: 4px; }
#fly-ovhd .fails button { background: #5a2a24; color: #ffd8d0; border: 1px solid #2a0d0b; border-radius: 3px; padding: 4px 6px; font: 700 9px system-ui; cursor: pointer; }
#fly-ovhd .fails button.tog.on { background: #a12a1d; }
`;
      document.head.appendChild(css);
      document.body.appendChild(page);
      page.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-s]');
        if (!b) return;
        const i = b.dataset.i === undefined ? undefined : b.dataset.i === 'apu' ? 'apu' : Number(b.dataset.i);
        let v = b.dataset.v;
        if (v !== undefined) v = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        if (b.dataset.s === 'close') { show(false); return; }
        set(b.dataset.s, v, i);
      });
      page.addEventListener('input', (ev) => { const r = ev.target; if (r.dataset.s) set(r.dataset.s, Number(r.value)); });
      // the page's keys are the browser's, not the flying's
      page.addEventListener('keydown', (ev) => ev.stopPropagation(), true);
    }
    page.hidden = !on;
    if (on) render();
  }
  function render() {
    if (!page || !ready()) return;
    const L = S.lt;
    const pb = (attrs, top, topOn, bot, botOn, cls = '') => `<button class="pb ${cls}" ${attrs}><i class="t ${topOn || ''}">${top}</i><i class="b ${botOn || ''}">${bot}</i></button>`;
    const sw = (what, cur, opts, i) => `<div class="sw">${opts.map(([v, txt]) => `<button data-s="${what}" data-v="${v}"${i !== undefined ? ` data-i="${i}"` : ''} class="${String(cur) === String(v) ? 'on' : ''}">${txt}</button>`).join('')}</div>`;
    const col = (label, inner) => `<div class="ov-c">${inner}<span>${label}</span></div>`;
    const test = S.test > 0;
    const fireBlock = (i, name) => {
      const e = i === 'apu' ? S.apu : S.eng[i];
      const lit = e.fire || test;
      const agents = i === 'apu' ? [S.apu.agent] : e.agents;
      return `<div class="ov-c">${pb(`data-s="firePb" data-i="${i}"`, name, '', 'FIRE', '', `fire ${lit ? 'lit' : ''} ${e.firePb ? 'pushed' : ''}`)}<span>${name} FIRE · PUSH</span>
        <div class="ov-row">${agents.map((a, b) => pb(`data-s="agent" data-i="${i}" data-v="${b}"`, e.firePb && !a || test ? 'SQUIB' : '', e.firePb && !a || test ? 'w' : '', a || test ? 'DISCH' : '', a || test ? 'on' : '').replace('class="t w"', 'class="t" style="color:#fff;text-shadow:0 0 6px #fff"').replace('class="b on"', 'class="b" style="color:#ffb000;text-shadow:0 0 6px #ffb000"')).join('')}</div>
        <span>${i === 'apu' ? 'AGENT' : 'AGENT 1 · AGENT 2'}</span></div>`;
    };
    const engs = S.eng.map((e, i) => i);
    const apu = S.apu;
    page.innerHTML = `<h3><span>OVERHEAD · ${s.spec.name}</span><span><button data-s="masterWarn" style="background:${S.mw ? '#a12a1d' : '#23262b'}">MASTER WARN</button> <button data-s="masterCaut" style="background:${S.mc ? '#a87412' : '#23262b'}">MASTER CAUT</button> <button data-s="close">✕ (0)</button></span></h3>
      <div class="ov-sec"><b>FIRE</b><div class="ov-row">${engs.map((i) => fireBlock(i, `ENG ${i + 1}`)).join('')}${fireBlock('apu', 'APU')}
        ${col('TEST', pb('data-s="fireTest"', '', '', 'TEST', test ? 'w' : ''))}</div></div>
      <div class="ov-sec"><b>ENG</b><div class="ov-row">${engs.map((i) => col(`MASTER ${i + 1}${S.eng[i].fire || test ? ' · <span style="color:#ff3b30">FIRE</span>' : ''}${S.eng[i].failed ? ' · <span style="color:#ffb000">FAULT</span>' : ''}`, sw('master', S.eng[i].master, [[1, 'ON'], [0, 'OFF']], i))).join('')}
        ${col('ENG MODE', sw('engMode', S.engMode, [['CRANK', 'CRANK'], ['NORM', 'NORM'], ['IGN', 'IGN START']]))}
        ${col('N1', `<div class="apu">${s.n1.map((n, i) => `${i + 1}: ${n.toFixed(1)}%${S.eng[i].start ? ' ST' : ''}`).join('<br>')}</div>`)}</div></div>
      <div class="ov-sec"><b>APU</b><div class="ov-row">
        ${col('MASTER SW', pb('data-s="apuMaster"', apu.fire ? 'FAULT' : '', apu.fire ? 'on' : '', apu.master ? 'ON' : '', apu.master ? 'on' : ''))}
        ${col('START', pb('data-s="apuStart"', '', '', apu.avail ? 'AVAIL' : apu.start ? 'ON' : '', apu.avail ? 'g' : apu.start ? 'on' : ''))}
        ${col('APU BLEED', pb('data-s="apuBleed"', '', '', apu.bleed ? 'ON' : '', apu.bleed ? 'on' : ''))}
        ${col('APU N', `<div class="apu">${Math.round(apu.n)} %${apu.avail ? '<br>AVAIL' : ''}</div>`)}</div></div>
      <div class="ov-sec"><b>EXT LT</b><div class="ov-row">
        ${col('STROBE', sw('strobe', L.strobe, [['ON', 'ON'], ['AUTO', 'AUTO'], ['OFF', 'OFF']]))}
        ${col('BEACON', sw('beacon', L.beacon, [[1, 'ON'], [0, 'OFF']]))}
        ${col('WING', sw('wing', L.wing, [[1, 'ON'], [0, 'OFF']]))}
        ${col('NAV & LOGO', sw('nav', L.nav, [[1, 'ON'], [0, 'OFF']]))}
        ${col('RWY TURN OFF', sw('rwy', L.rwy, [[1, 'ON'], [0, 'OFF']]))}
        ${col('LAND', sw('land', L.land, [['ON', 'ON'], ['OFF', 'OFF'], ['RETRACT', 'RETRACT']]))}
        ${col('NOSE', sw('nose', L.nose, [['TO', 'T.O'], ['TAXI', 'TAXI'], ['OFF', 'OFF']]))}</div></div>
      <div class="ov-sec"><b>SIGNS · INT LT</b><div class="ov-row">
        ${col('SEAT BELTS', sw('belts', S.signs.belts, [[1, 'ON'], [0, 'OFF']]))}
        ${col('NO SMOKING', sw('smoke', S.signs.smoke, [[1, 'ON'], [0, 'OFF']]))}
        ${col('DOME', sw('dome', L.dome, [['BRT', 'BRT'], ['DIM', 'DIM'], ['OFF', 'OFF']]))}
        ${col('ANN LT', sw('ann', L.ann, [['TEST', 'TEST'], ['BRT', 'BRT'], ['DIM', 'DIM']]))}
        ${col('INTEG LT', `<input class="knob" type="range" min="0" max="1" step="0.05" value="${L.integ}" data-s="integ">`)}
        ${col('FLOOD LT', `<input class="knob" type="range" min="0" max="1" step="0.05" value="${L.flood}" data-s="flood">`)}</div></div>
      <div class="ov-sec"><b>ANTI ICE · WIPER</b><div class="ov-row">
        ${engs.map((i) => col(`ENG ${i + 1}`, pb(`data-s="engAntiIce" data-i="${i}"`, '', '', S.eng[i].antiIce ? 'ON' : '', S.eng[i].antiIce ? 'on' : ''))).join('')}
        ${col('WING', pb('data-s="wingAntiIce"', '', '', S.wingAntiIce ? 'ON' : '', S.wingAntiIce ? 'on' : ''))}
        ${col('WIPER CAPT', sw('wiper', S.wipers[0], [[2, 'FAST'], [1, 'SLOW'], [0, 'OFF']], 0))}
        ${col('WIPER F/O', sw('wiper', S.wipers[1], [[2, 'FAST'], [1, 'SLOW'], [0, 'OFF']], 1))}</div></div>
      <div class="ov-sec fails"><b>FAILURES (instructor)</b><div class="ov-row">
        ${engs.map((i) => `<button data-s="fail" data-v="fire" data-i="${i}">ENG ${i + 1} FIRE</button>`).join('')}
        <button data-s="fail" data-v="apuFire">APU FIRE</button>
        ${engs.map((i) => `<button data-s="fail" data-v="fail" data-i="${i}">ENG ${i + 1} FAIL</button>`).join('')}
        <button class="tog ${S.random ? 'on' : ''}" data-s="random">RANDOM ${S.random ? 'ON' : 'OFF'}</button></div>
        <div class="log">${S.log.map((l) => l.text).join('\n')}</div></div>`;
  }
  // A button in the HUD's bar (it is made when the flight starts)
  const addBarButton = () => {
    const bar = document.querySelector('#pilot-hud .pl-bar');
    if (!bar || bar.querySelector('[data-pl="ovhd"]')) return;
    const b = document.createElement('button');
    b.dataset.pl = 'ovhd'; b.title = 'Overhead panel: lights, signs, APU, engines, fire (0)'; b.textContent = '🔆 Overhead';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (ready()) show(!page || page.hidden); b.blur(); });
    bar.insertBefore(b, bar.querySelector('[data-pl="help"]'));
  };
  setInterval(() => { if (s.active) addBarButton(); else { if (page && !page.hidden) show(false); crc(false); } }, 500);

  FG.systems = {
    get S() { return S; }, ready, set, engine, step, warnings, lights, ecamLines, key, snapshot, restore, show,
    currentWarnings, currentCautions, onChange(f) { listeners.add(f); },
    get open() { return !!page && !page.hidden; },
  };
})();
