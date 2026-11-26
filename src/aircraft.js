// The aircraft's systems behind the overhead panel's other switches, plugged into src/systems.js (FG.systems.plug):
//   - ELEC: two batteries, a generator on each engine, the APU's generator, external power on the ground and the bus
//     tie. With no generator at all the aircraft is in its emergency configuration: the ram air turbine (RAT) drops
//     out (or MAN ON) and keeps only the captain's PFD and ND, the E/WD and the first MCDU alive; the autopilot is
//     lost and the flight controls drop to alternate law. On the batteries alone (no RAT) about 30 minutes;
//     batteries off as well: everything dark but the standby instrument.
//   - HYD: green (engine 1's pump; the outer engines on four), yellow (engine 2's; engine 3 on four, or its electric
//     pump), blue (an electric pump, the RAT) and the PTU between green and yellow. Green raises the gear (down it
//     falls by gravity) and works the normal brakes; yellow the nose wheel steering and the alternate brakes; the
//     flaps need green and yellow (half speed on one); two systems lost: alternate law.
//   - The A330s and A340s (PLAN): no PTU but an engine-driven pump per system and engine (the A330: green and blue
//     on engine 1, green and yellow on engine 2; the A340: green on 1 and 4, blue on 2, yellow on 3), an electric
//     pump for each system and the RAT on green. Their FUEL has a trim tank in the tail (its fuel goes forward in the
//     cruise, T TK FEED AUTO; ISOL keeps it there); the A330 a standby pump in each wing, the A340 a feed tank per
//     engine with a main and a standby pump and its own cross-feed valve (open two: one engine's pumps feed the other).
//   - FUEL: left, centre and right tanks, two pumps in each wing and two in the centre (MODE SEL AUTO runs them
//     while there's fuel), the cross-feed valve. Engines burn from their own wing (the centre first); a wing with
//     both pumps off feeds by gravity only below FL150; an empty side (cross-feed shut) or a starved engine flames
//     out. The fuel's weight comes off the aircraft as it burns. An imbalance or a low level is a caution.
//   - AIR: a bleed valve per engine, the two packs and the cabin's pressure (AUTO, or MAN with the V/S switch). No
//     air: the cabin climbs with the aircraft; above 9,550 ft CAB PR EXCESS CAB ALT, above 14,000 ft the passengers'
//     masks drop. Crew oxygen off up there: the crew gets hypoxic (the picture darkens).
//   - ANTI ICE and probe/window heat: in cloud between +2 and -30 °C ice grows on an unprotected wing (drag, an
//     earlier stall) and engine (less thrust). The ICE IND light shows ice.
//   - ADIRS: three inertial reference units (OFF / NAV / ATT) and their air data (ADR) pushbuttons, with the ATT HDG
//     and AIR DATA switching on the pedestal. An IR switched off is lost; back to NAV it aligns on the ground (two
//     minutes here, ten in the real one) but not in flight, where ATT gives the attitude only. A PFD without its IR
//     shows the ATT flag, its ND MAP NOT AVAIL; two IRs or ADRs lost: alternate law and no autopilot.
//   - GPWS: SYS, TERR (terrain ahead: the ground along the flight path looked up a minute ahead), G/S MODE (GLIDE
//     SLOPE below the beam), FLAP MODE (TOO LOW FLAPS) and LDG FLAP 3.
//   - EVAC (the horn), CALLS (MECH, ALL), OXYGEN (CREW SUPPLY, MASK MAN ON), RCDR GND CTL, EMER EXIT LT, ICE IND &
//     STBY COMPASS, the A/SKID & N/W STRG switch, the clock and its chrono, the screens' brightness, TERR ON ND.
//   - The ECAM control panel picks the systems display's page (ENG BLEED PRESS ELEC HYD FUEL APU COND DOOR WHEEL
//     F/CTL, ALL, STS), T.O CONFIG tests the take-off configuration, CLR / RCL / EMER CANC the cautions.
// Everything here is in S (systems.js's state): checkpoints keep it.
(function () {
  'use strict';
  const P = FG.pilot;
  if (!P || !P.api || !FG.systems) return;
  const A = P.api;
  const { KT, FT, DEG } = A;
  const s = P.state;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const SYS = FG.systems;
  let S = null; // (systems.js's state, given in fresh())

  // which engines drive which hydraulic system, and which wing tank feeds them
  const hydOf = (n) => (n >= 4 ? { G: [0, 3], B: [1], Y: [2] } : n === 3 ? { G: [0], B: [1], Y: [2] } : { G: [0], B: [], Y: [n - 1] });
  // the systems' layout of the type flown: the A320 family's, the A330's or the A340's
  function planOf(type, n) {
    const t = String(type || '').toUpperCase();
    if (/^A33/.test(t) && n === 2) return { wide: 'a330', edp: [['G', 0], ['B', 0], ['G', 1], ['Y', 1]], ptu: false, rat: 'G', trim: true };
    if (/^A34/.test(t) && n === 4) return { wide: 'a340', edp: [['G', 0], ['B', 1], ['Y', 2], ['G', 3]], ptu: false, rat: 'G', trim: true };
    const m = hydOf(n);
    return { wide: null, edp: ['G', 'B', 'Y'].flatMap((k) => m[k].map((i) => [k, i])), ptu: true, rat: 'B', trim: false };
  }
  let PLAN = planOf(null, 2);
  // the switches the type's systems have (fresh() may come before the type is known: begin() shapes it again)
  function shape(x, n) {
    const H = x.hyd, F = x.fuel;
    if (H.plan === PLAN.wide && Object.keys(H.edp).length === PLAN.edp.length) return;
    H.plan = PLAN.wide;
    H.edp = Object.fromEntries(PLAN.edp.map(([k, i]) => [k + i, 1]));
    H.ptu = PLAN.ptu ? 1 : 0;
    F.pump = { L1: 1, L2: 1, R1: 1, R2: 1, CL: 1, CR: 1 };
    if (PLAN.wide === 'a330') Object.assign(F.pump, { LS: 1, RS: 1 });
    if (PLAN.wide === 'a340') for (let i = 0; i < n; i++) Object.assign(F.pump, { [`E${i}`]: 1, [`E${i}S`]: 1 });
    F.xfeedE = Array(n).fill(0);
  }
  const sideOf = (i, n) => (n === 3 ? (i === 0 ? 0 : i === 2 ? 1 : -1) : i < n / 2 ? 0 : 1); // (-1: the middle engine, from the centre)

  function fresh(x, n) {
    S = x;
    PLAN = planOf(s.type, n);
    x.elec = { bat: [1, 1], gen: Array(n).fill(1), apuGen: 1, ext: 0, busTie: 1, galley: 1, gen1Line: 1, ratMan: 0, rat: 0, batCharge: [1, 1], ac: [true, true], level: 'normal' };
    x.hyd = { engPump: Array(n).fill(1), bElec: 1, yElec: 0, ptu: 1, p: { G: 3000, B: 3000, Y: 3000 }, edp: {}, elecP: { G: 0, B: 0, Y: 0 } };
    x.fuel = { L: 0, C: 0, R: 0, T: 0, cap: 0, wingCap: 0, pump: { L1: 1, L2: 1, R1: 1, R2: 1, CL: 1, CR: 1 }, modeSel: 'AUTO', xfeed: 0,
      xfeedE: Array(n).fill(0), trim: 'AUTO', tXfr: 0, starve: Array(n).fill(0), used: 0, imbal: 0 };
    shape(x, n);
    x.air = { engBleed: Array(n).fill(1), pack: [1, 1], cabAlt: 0, cabVs: 0, mode: 'AUTO', manVs: 0, ditching: 0, paxMasks: 0, hypoxia: 0 };
    x.ice = { wing: 0, eng: 0, probe: 'AUTO' };
    x.adirs = { ir: [0, 1, 2].map(() => ({ mode: 'NAV', ok: true, align: 0, att: 0, offT: 0 })), adr: [1, 1, 1], attHdg: 'NORM', airData: 'NORM' };
    x.gpws = { sys: 1, terr: 1, gs: 1, flap: 1, ldg3: 0, terrAhead: 0 };
    x.misc = { evac: 0, evacT: 0, crewOxy: 1, rcdr: 0, emerExit: 'ARM', iceInd: 1, askid: 1, chrono: null, chronoRun: false, terrNd: [0, 0], burst: false,
      bright: { pfd1: 1, nd1: 1, pfd2: 1, nd2: 1, ewd: 1, sd: 1 }, ecp: null, all: 0, allT: 0, tocfg: 0, cleared: [], callT: 0,
      taxiCam: 0, oans: 0, oansRange: 1 };
  }
  function begin(x) {
    S = x;
    const n = S.eng.length, F = S.fuel, cap = Math.round(s.mass * 0.3);
    PLAN = planOf(s.type, n);
    shape(S, n);
    F.cap = cap; F.wingCap = Math.round(cap * 0.32);
    // the fuel for the flight: the trip (about 450 kt over the ground) and 45 minutes, more on a long flight
    const ffH = s.mass * 0.032; // kg/h, all engines, in the cruise
    const M = FG.fmgc && FG.fmgc.F, plan = M && M.plan;
    let need;
    if (s.mode === 'final') need = ffH * 1.2;
    else if (plan && plan.total) need = ffH * (plan.total / 450 + 0.75) + 300;
    else need = ffH * 2.5;
    need = clamp(need, cap * 0.12, cap);
    F.L = F.R = Math.round(Math.min(need / 2, F.wingCap));
    F.C = Math.round(Math.max(0, need - F.L - F.R));
    // the trim tank (A330, A340): 6 % of the fuel, from the centre's share first, then the wings'
    F.T = PLAN.trim ? Math.round(need * 0.06) : 0;
    { const fromC = Math.min(F.C, F.T); F.C -= fromC; F.L -= (F.T - fromC) / 2; F.R -= (F.T - fromC) / 2; }
    F.tXfr = 0;
    F.used = 0;
    S.air.cabAlt = s.onGround ? s.groundH / FT : clamp((s.h / FT) * 0.21, s.groundH / FT, 8000);
    S.misc.chrono = null; S.misc.chronoRun = false;
    // the gear-up start (taking over a plane in the air): the systems as in the cruise
    if (!s.onGround) S.hyd.p = { G: 3000, B: 3000, Y: 3000 };
  }

  // ---------- each frame ----------
  let terrBusy = false, terrAt = 0;
  function step(dt) {
    if (!S || !S.elec) return;
    const air = !s.onGround, n = S.eng.length;
    const altFt = s.h / FT, agl = A.agl() / FT;
    const run = (i) => S.eng[i].run === 1;
    // ELEC: the sources on each side's AC bus
    const E = S.elec;
    const genOk = (i) => E.gen[i] && run(i) && (i !== 0 || E.gen1Line);
    const apuGenOk = E.apuGen && S.apu.avail;
    const extAvail = !air && s.V < 1 * KT;
    const extOk = E.ext && extAvail;
    const sideGen = [0, 1].map((k) => S.eng.some((e, i) => sideOf(i, n) === k && genOk(i)));
    const anySrc = sideGen[0] || sideGen[1] || apuGenOk || extOk;
    E.ac = [0, 1].map((k) => sideGen[k] || ((E.busTie || !S.eng.some((e, i) => sideOf(i, n) === k)) && anySrc));
    // no AC at all: the RAT comes out above 100 kt (or MAN ON), the emergency generator from it
    if (!E.ac[0] && !E.ac[1]) {
      if ((air && A.ias() > 100) || E.ratMan) { if (!E.rat) { E.rat = 1; SYS.note('RAT deployed: EMER GEN'); } }
    }
    const bats = E.bat[0] + E.bat[1];
    const emerGen = E.rat && A.ias() > 100;
    const prev = E.level;
    if (E.ac[0] && E.ac[1]) E.level = 'normal';
    else if (E.ac[0] || E.ac[1]) E.level = 'one';
    else if (emerGen) E.level = 'emer';
    else if (bats && E.batCharge.some((c, k) => E.bat[k] && c > 0)) E.level = 'bat';
    else E.level = 'dark';
    // the batteries: charged by the generators, about 30 minutes alone
    for (let k = 0; k < 2; k++) {
      if (E.level === 'bat' && E.bat[k]) E.batCharge[k] = Math.max(0, E.batCharge[k] - dt / 1800);
      else if (E.level === 'normal' || E.level === 'one') E.batCharge[k] = Math.min(1, E.batCharge[k] + dt / 900);
    }
    if (prev !== E.level) {
      SYS.note(`ELEC: ${E.level === 'normal' ? 'normal' : E.level === 'one' ? 'one AC bus' : E.level === 'emer' ? 'EMER CONFIG (RAT)' : E.level === 'bat' ? 'on the batteries' : 'no power'}`);
      if ((E.level === 'emer' || E.level === 'bat' || E.level === 'dark') && FG.fmgc && FG.fmgc.disconnect) FG.fmgc.disconnect('power');
    }
    const ac = E.level === 'normal' || E.level === 'one';

    // HYD
    const H = S.hyd, map = hydOf(n);
    const engP = (k) => PLAN.edp.some(([sy, i]) => sy === k && edpOn(sy, i) && run(i) && (S.eng[i].n1 ?? s.n1[i] ?? 0) > 15);
    const ratP = E.rat && A.ias() > 140;
    const want = PLAN.wide ? {
      G: engP('G') || (H.elecP.G && ac) || ratP, B: engP('B') || (H.elecP.B && ac), Y: engP('Y') || (H.elecP.Y && ac),
    } : {
      G: engP('G'),
      Y: engP('Y') || (H.yElec && ac),
      B: engP('B') || (H.bElec && ac && S.eng.some((e) => e.run === 1)) || ratP,
    };
    void map;
    // the PTU: one of green and yellow drives the other (AUTO, when they differ by 500 psi)
    if (H.ptu && ac) { if (want.G && !want.Y) want.Y = 'ptu'; else if (want.Y && !want.G) want.G = 'ptu'; }
    for (const k of ['G', 'B', 'Y']) {
      const to = want[k] ? (want[k] === 'ptu' ? 2900 : 3000) : 0;
      H.p[k] += (to - H.p[k]) * (1 - Math.exp(-dt / (to > H.p[k] ? 2 : 8)));
    }
    const up = (k) => H.p[k] > 1450;
    const hydLost = ['G', 'B', 'Y'].filter((k) => !up(k));
    // ADIRS: switched off, aligning, ATT
    const D = S.adirs;
    D.ir.forEach((r, k) => {
      if (r.mode === 'OFF') { r.offT += dt; if (r.offT > 3 && r.ok) { r.ok = false; SYS.note(`IR ${k + 1} off`); } r.align = 0; r.att = 0; return; }
      r.offT = 0;
      if (r.ok) return;
      if (r.mode === 'NAV') {
        if (air || s.V > 1 * KT) { r.align = -1; return; } // (ALIGN FAULT: it can't align moving)
        if (r.align <= 0) r.align = 120;
        r.align -= dt;
        if (r.align <= 0) { r.align = 0; r.ok = true; SYS.note(`IR ${k + 1} aligned (NAV)`); SYS.refresh(); }
      } else if (r.mode === 'ATT') { r.att += dt; r.align = 0; }
    });
    // the flight controls: alternate law with two hydraulic systems, two IRs or two ADRs lost, or on emergency power
    const irLost = D.ir.filter((r) => !irAtt(r)).length, adrLost = D.adr.filter((a) => !a).length;
    const isAirbus = s.spec.law === 'airbus';
    const alt = isAirbus && (hydLost.length >= 2 || irLost >= 2 || adrLost >= 2 || !ac);
    if (alt !== !!s.altLaw) {
      s.altLaw = alt;
      if (alt) { A.say('ALTN LAW: protections lost', 'amber', 4000); if (FG.fmgc && FG.fmgc.disconnect) FG.fmgc.disconnect('altn'); }
    }

    // FUEL
    const F = S.fuel;
    const gravity = !air || altFt < 15000;
    const ctrAuto = F.modeSel === 'AUTO' && S.eng.some((e) => e.run === 1);
    const ctrFeeds = F.C > 0 && ac && ((F.pump.CL || F.pump.CR) && (F.modeSel === 'MAN' || ctrAuto));
    const wingPumps = [ac && (F.pump.L1 || F.pump.L2 || F.pump.LS), ac && (F.pump.R1 || F.pump.R2 || F.pump.RS)];
    const tank = (k) => (k === 0 ? 'L' : 'R');
    let burned = 0;
    // the trim tank's fuel goes forward in the cruise (and whenever the wings run low), into the centre or the wings
    F.tXfr = 0;
    if (F.T > 0 && F.trim === 'AUTO' && ac && air && ((altFt > 20000 && F.C < 1000) || F.L + F.R < F.wingCap * 0.25)) {
      const t = Math.min(F.T, 1.5 * dt);
      F.T -= t; F.tXfr = 1;
      if (F.C > 0 || ctrFeeds) F.C += t; else { F.L += t / 2; F.R += t / 2; }
    }
    if (PLAN.wide === 'a340') burned = feed340(F, n, ac, gravity, ctrFeeds, dt);
    else for (let i = 0; i < n; i++) {
      const e = S.eng[i];
      const ff = e.run === 1 || e.start ? ffOf(i) : 0; // kg/s
      const side = sideOf(i, n);
      // where it draws from: the centre (its pumps win), its wing (pumps, or gravity low down), the other wing over the
      // cross-feed (that wing's pumps)
      let from = null;
      if (ctrFeeds) from = 'C';
      else if (side < 0) from = F.C > 0 && gravity ? 'C' : wingPumps[0] && F.L > 0 ? 'L' : wingPumps[1] && F.R > 0 ? 'R' : null;
      else if (F[tank(side)] > 0 && (wingPumps[side] || gravity)) from = tank(side);
      if (F.xfeed && (!from || (from !== 'C' && !wingPumps[side]))) {
        const o = 1 - Math.max(0, side);
        if (wingPumps[o] && F[tank(o)] > 0) from = tank(o);
      }
      if (!from) { F.starve[i] += dt; } else F.starve[i] = 0;
      if (from && ff) { const take = Math.min(F[from], ff * dt); F[from] -= take; burned += take; }
    }
    // (the A340: each engine from its own feed tank, the cross-feed line between those whose valve is open)
    // a wing torn open (src/pilot.js s.dmg.leak) pours its fuel out
    if (s.dmg && s.dmg.leak) for (let k = 0; k < 2; k++) if (s.dmg.leak[k] > 0) { const t = Math.min(F[tank(k)], 12 * dt); F[tank(k)] -= t; burned += t; }
    F.used += burned;
    s.mass = Math.max(s.mass - burned, s.mass * 0.3);
    F.imbal = F.L - F.R;

    // AIR: the cabin's altitude
    const R = S.air;
    const bleedOk = S.eng.some((e, i) => e.run === 1 && R.engBleed[i]) || (S.apu.avail && S.apu.bleed && altFt < 22500);
    const inflow = bleedOk && ac ? R.pack[0] + R.pack[1] : 0;
    const field = s.groundH / FT;
    let vs;
    if (!inflow && air) vs = clamp((altFt - R.cabAlt) / 90 * 60, -2000, 4000); // (leaking: towards the outside)
    else if (R.mode === 'MAN') vs = R.manVs * 1000 + (inflow ? 0 : 1500);
    else {
      const target = air ? clamp(altFt * 0.21, Math.min(field, 8000), 8000) : field;
      vs = clamp((target - R.cabAlt) * 2, -350, 600);
    }
    if (!air && inflow && R.mode !== 'MAN') vs = clamp((field - R.cabAlt) * 4, -500, 500);
    R.cabVs += (vs - R.cabVs) * (1 - Math.exp(-dt / 3));
    R.cabAlt = Math.min(Math.max(R.cabAlt + (R.cabVs / 60) * dt, -1000), Math.max(altFt, field));
    if (R.cabAlt > 14000 && !R.paxMasks) { R.paxMasks = 1; SYS.note('PAX OXY MASKS dropped'); A.say('Passenger oxygen masks dropped', 'amber', 4000); }
    // hypoxia: up there without the crew's oxygen
    const thin = R.cabAlt > 12000 && !S.misc.crewOxy;
    R.hypoxia = clamp(R.hypoxia + (thin ? dt * (R.cabAlt - 10000) / 1.2e6 : -dt / 20), 0, 0.85);
    hypoxiaVeil(R.hypoxia);

    // ICE: in cloud between +2 and -30 °C
    const I = S.ice;
    const icing = air && iceConditions();
    const wingProt = S.wingAntiIce && bleedOk;
    const engProt = (i) => S.eng[i].antiIce;
    const engsBare = S.eng.filter((e, i) => !engProt(i)).length / n;
    if (icing && !wingProt) I.wing = Math.min(1, I.wing + dt / 240); else I.wing = Math.max(0, I.wing - dt / (wingProt ? 30 : 600));
    if (icing && engsBare > 0) I.eng = Math.min(1, I.eng + (dt / 200) * engsBare); else I.eng = Math.max(0, I.eng - dt / 40);

    // what the physics gets (src/pilot.js s.sysK)
    const flapK = (up('G') ? 0.5 : 0) + (up('Y') ? 0.5 : 0);
    s.sysK = {
      flap: flapK, gearUp: up('G') ? 1 : 0, gearDn: up('G') ? 1 : 0.6,
      thrust: (1 - 0.12 * I.eng * engsBare) * flexK(),
      cd: 0.012 * I.wing, stallDrop: 3.5 * I.wing,
      brake: (up('G') ? 1 : up('Y') ? 0.85 : 0.45) * (S.misc.askid ? 1 : 0.8) * (S.misc.burst ? 0.6 : 1),
      steer: up('Y') && S.misc.askid && ac ? 1 : 0,
    };
    // braking hard without anti-skid at speed bursts tyres
    if (!S.misc.askid && !S.misc.burst && s.onGround && s.brake > 0.7 && s.V > 60 * KT && Math.random() < dt * 0.6) {
      S.misc.burst = true; A.say('Tyres burst: braking without anti-skid', 'red', 5000); SYS.note('Main gear tyres burst');
    }

    // GPWS: the ground ahead, once a second
    const G = S.gpws;
    if (G.sys && G.terr && air && FG.flat && !terrBusy && performance.now() - terrAt > 1000) {
      terrBusy = true; terrAt = performance.now();
      const trk = s.psi * DEG, vh = s.V * Math.cos(s.gamma), vv = s.V * Math.sin(s.gamma);
      const ts = [10, 20, 30, 45, 60];
      const pts = ts.map((t) => [s.lat + (vh * t * Math.cos(trk)) / 111320, s.lon + (vh * t * Math.sin(trk)) / (111320 * Math.cos(s.lat * DEG))]);
      FG.flat.heightsAt(pts, 11).then((hs) => {
        let worst = 0;
        hs.forEach((h, k) => {
          if (h == null || !isFinite(h)) return;
          const at = s.h + vv * ts[k], clear = (at - h) / FT;
          if (clear < 300) worst = Math.max(worst, ts[k] <= 30 ? 2 : 1);
        });
        // (on the approach the runway is meant to come up: not near the field with the gear down)
        if (s.gear > 0.99 && A.agl() / FT < 1500) worst = 0;
        if (worst > G.terrAhead && FG.sound && FG.sound.on) A.speak(worst === 2 ? 'terrain ahead, pull up' : 'terrain ahead');
        G.terrAhead = worst;
      }, () => {}).finally(() => { terrBusy = false; });
    } else if (!air || !G.sys || !G.terr) G.terrAhead = 0;
    G.gsLow = false;
    if (G.sys && G.gs && air && agl < 1000 && agl > 50 && s.gear > 0.99) {
      const l = A.ils && A.ils();
      if (l && l.gs != null && l.gs < -0.45) G.gsLow = true; // (1.3 dots below the beam: a dot is about 0.35°)
    }

    // misc: the evac horn, the chrono, the call buttons, T.O CONFIG, the ECAM's ALL
    const X = S.misc;
    if (X.evac) {
      X.evacT += dt;
      if (Math.floor(X.evacT / 1.2) !== Math.floor((X.evacT - dt) / 1.2) && X.evacT < 20) SYS.tone([440, 0], 0.5, 0.1, 0.06, 'square');
      if (!air && s.V < 1 * KT && X.evacT > 45 && !X.evacDone) { X.evacDone = true; A.say('Evacuation complete: everyone is off the aircraft', 'info', 6000); SYS.note('Evacuation complete'); }
    }
    if (X.chronoRun) X.chrono = (X.chrono || 0) + dt;
    if (X.tocfg > 0) X.tocfg = Math.max(0, X.tocfg - dt);
    if (X.ecp === 'ALL') { X.allT += dt; if (X.allT > 1) { X.allT = 0; X.all = (X.all + 1) % SD_PAGES.length; } }
  }

  // The A340's feeding: each engine's feed tank (in its wing) with a main and a standby pump; below FL150 gravity
  // feeds it without them. An engine whose own tank can't feed it, with its X FEED valve open, draws from the line:
  // another engine's tank with its valve open and a pump running. The centre's pumps feed every engine first.
  function feed340(F, n, ac, gravity, ctrFeeds, dt) {
    const tank = (i) => (i < n / 2 ? 'L' : 'R');
    const pumps = (i) => ac && (F.pump[`E${i}`] || F.pump[`E${i}S`]);
    let burned = 0;
    for (let i = 0; i < n; i++) {
      const e = S.eng[i];
      const ff = e.run === 1 || e.start ? ffOf(i) : 0;
      let from = null;
      if (ctrFeeds) from = 'C';
      else if (F[tank(i)] > 0 && (pumps(i) || gravity)) from = tank(i);
      if (F.xfeedE[i] && (!from || (from !== 'C' && !pumps(i)))) {
        for (let j = 0; j < n; j++) if (j !== i && F.xfeedE[j] && pumps(j) && F[tank(j)] > 0) { from = tank(j); break; }
      }
      if (!from) F.starve[i] += dt; else F.starve[i] = 0;
      if (from && ff) { const take = Math.min(F[from], ff * dt); F[from] -= take; burned += take; }
    }
    return burned;
  }
  // an engine-driven hydraulic pump: switched on (the A320's one pump per engine, or the A330's / A340's per system)
  const edpOn = (k, i) => (PLAN.wide ? !!S.hyd.edp[k + i] : !!S.hyd.engPump[i]);

  // fuel flow, kg/s, of engine i: from about 12 % at idle to its share of the cruise flow at climb thrust
  function ffOf(i) {
    const n = S.eng.length, idle = A.idle(), n1 = S.eng[i].n1 || s.n1[i] || 0;
    const f = clamp((n1 - idle) / (97 - idle), 0, 1.1);
    const cruise = (s.mass + (S.fuel.used || 0)) * 0.032 / 3600 / n;
    return cruise * (0.12 + 0.88 * Math.pow(f, 1.6)) * (S.eng[i].antiIce ? 1.03 : 1);
  }
  // the FLEX temperature (the MCDU's PERF page) takes thrust off at FLX/MCT for the take-off
  function flexK() {
    const M = FG.fmgc && FG.fmgc.F;
    if (!M || !M.perf || M.perf.flex == null || !s.onGround || s.landed) return 1;
    if (Math.abs(s.lever - 0.93) > 0.03) return 1;
    return clamp(1 - 0.008 * Math.max(0, M.perf.flex - oatC(s.groundH)), 0.75, 1);
  }
  // the air's temperature (°C): the game's at the surface, 2 °C colder each 1000 ft
  function oatC(h = s.h) {
    const w = wx();
    return (w ? w.tempC : 15) - 2 * Math.max(0, h - s.groundH) / FT / 1000;
  }
  let wxAt = 0, wxNow = null;
  function wx() {
    const G = FG.game;
    if (!G || !G.weatherAt || !G.state) return null;
    if (performance.now() - wxAt > 5000) { wxAt = performance.now(); try { wxNow = G.weatherAt(s.lat, s.lon, G.state.time); } catch (e) { wxNow = null; } }
    return wxNow;
  }
  // in cloud: from a base low over the ground (lower the more it's covered) to tops higher with rain
  function iceConditions() {
    const w = wx();
    if (!w || w.cover < 0.55) return false;
    const agl = (s.h - s.groundH) / FT, base = 800 + (1 - w.cover) * 6000, tops = base + 5000 + w.rain * 18000;
    const t = oatC();
    return agl > base && agl < tops && t <= 2 && t >= -30;
  }
  // the air's pressure (Pa) at h metres, standard atmosphere
  const isaP = (h) => (h < 11000 ? 101325 * Math.pow((288.15 - 0.0065 * h) / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6));
  const irAtt = (r) => (r.mode === 'NAV' && r.ok) || (r.mode === 'ATT' && (r.ok || r.att > 20));
  const irNav = (r) => r.mode === 'NAV' && r.ok;

  // the darkening of the picture as the crew gets hypoxic
  let veil = null;
  function hypoxiaVeil(k) {
    if (!veil && k > 0.01) {
      veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3650;transition:opacity .5s;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 20%, rgba(0,0,0,.95) 75%)';
      document.body.appendChild(veil);
    }
    if (veil) { veil.style.opacity = String(k); veil.hidden = k < 0.01 || !s.active; }
  }

  // ---------- switches (FG.systems.set) ----------
  const tog = (v, cur) => (v !== undefined ? v : cur ? 0 : 1);
  const cyc = (cur, list) => list[(list.indexOf(cur) + 1) % list.length];
  function set(what, v, i) {
    if (!S || !S.elec) return false;
    const E = S.elec, H = S.hyd, F = S.fuel, R = S.air, D = S.adirs, G = S.gpws, X = S.misc;
    switch (what) {
      case 'bat': E.bat[i] = tog(v, E.bat[i]); break;
      case 'gen': E.gen[i] = tog(v, E.gen[i]); break;
      case 'apuGen': E.apuGen = tog(v, E.apuGen); break;
      case 'extPwr': if (s.onGround && s.V < 1 * KT) E.ext = tog(v, E.ext); else A.say('EXT PWR: only parked on the ground', 'info', 2000); break;
      case 'busTie': E.busTie = tog(v, E.busTie); break;
      case 'galley': E.galley = tog(v, E.galley); break;
      case 'gen1Line': E.gen1Line = tog(v, E.gen1Line); break;
      case 'ratMan': E.ratMan = 1; break;
      case 'engPump': H.engPump[i] = tog(v, H.engPump[i]); break;
      case 'bElec': H.bElec = tog(v, H.bElec); break;
      case 'yElec': H.yElec = tog(v, H.yElec); break;
      case 'ptu': if (PLAN.ptu) H.ptu = tog(v, H.ptu); break;
      case 'edp': H.edp[v] = H.edp[v] ? 0 : 1; break;
      case 'elecPump': H.elecP[v] = H.elecP[v] ? 0 : 1; break;
      case 'xfeedE': F.xfeedE[i] = tog(v, F.xfeedE[i]); break;
      case 'trimFeed': F.trim = v !== undefined ? v : F.trim === 'AUTO' ? 'ISOL' : 'AUTO'; break;
      case 'taxiCam': X.taxiCam = tog(v, X.taxiCam); break;
      case 'oans': X.oans = tog(v, X.oans); break;
      case 'oansRange': X.oansRange = v !== undefined ? v : cyc(X.oansRange, [0.5, 1, 2, 5]); break;
      case 'fuelPump': F.pump[i] = tog(v, F.pump[i]); break;
      case 'modeSel': F.modeSel = v !== undefined ? v : F.modeSel === 'AUTO' ? 'MAN' : 'AUTO'; break;
      case 'xfeed': F.xfeed = tog(v, F.xfeed); break;
      case 'engBleed': R.engBleed[i] = tog(v, R.engBleed[i]); break;
      case 'pack': R.pack[i] = tog(v, R.pack[i]); break;
      case 'pressMode': R.mode = v !== undefined ? v : R.mode === 'AUTO' ? 'MAN' : 'AUTO'; break;
      case 'manVs': R.manVs = v !== undefined ? v : cyc(R.manVs, [0, 1, -1]); break;
      case 'ditching': R.ditching = tog(v, R.ditching); break;
      case 'paxMasks': if (!R.paxMasks) { R.paxMasks = 1; SYS.note('PAX OXY MASKS: MAN ON'); } break;
      case 'crewOxy': X.crewOxy = tog(v, X.crewOxy); break;
      case 'probeHeat': S.ice.probe = v !== undefined ? v : S.ice.probe === 'AUTO' ? 'ON' : 'AUTO'; break;
      case 'irMode': {
        const r = D.ir[i];
        r.mode = v !== undefined ? v : cyc(r.mode, ['OFF', 'NAV', 'ATT']);
        if (r.mode !== 'OFF' && !r.ok && r.mode === 'NAV' && !s.onGround) A.say(`IR ${i + 1}: it cannot align in flight; ATT gives the attitude after 20 s`, 'amber', 4000);
        break;
      }
      case 'adr': D.adr[i] = tog(v, D.adr[i]); break;
      case 'attHdg': D.attHdg = v !== undefined ? v : cyc(D.attHdg, ['CAPT 3', 'NORM', 'F/O 3']); break;
      case 'airData': D.airData = v !== undefined ? v : cyc(D.airData, ['CAPT 3', 'NORM', 'F/O 3']); break;
      case 'gpwsSys': G.sys = tog(v, G.sys); break;
      case 'gpwsTerr': G.terr = tog(v, G.terr); break;
      case 'gpwsGs': G.gs = tog(v, G.gs); break;
      case 'gpwsFlap': G.flap = tog(v, G.flap); break;
      case 'gpwsLdg3': G.ldg3 = tog(v, G.ldg3); break;
      case 'evac':
        X.evac = tog(v, X.evac); X.evacT = 0; X.evacDone = false;
        if (X.evac) { A.say(s.onGround ? 'EVAC: evacuate, evacuate!' : 'EVAC commanded: the cabin crew wait for the aircraft to stop', 'red', 5000); if (FG.sound && FG.sound.on) A.speak('evacuate, evacuate'); SYS.note('EVAC command'); }
        break;
      case 'callMech':
        SYS.tone([1300, 1300], 0.25, 0.15, 0.06, 'square');
        A.say(s.onGround && s.V < 1 * KT ? 'Ground mechanic: "Cockpit from ground, go ahead."' : 'MECH call: nobody on the ground to answer', 'info', 3500);
        break;
      case 'callAll': SYS.snd.cabin(); A.say('ALL call: cabin crew to the interphone', 'info', 3000); break;
      case 'rcdr': X.rcdr = tog(v, X.rcdr); break;
      case 'emerExit': X.emerExit = v !== undefined ? v : cyc(X.emerExit, ['ON', 'ARM', 'OFF']); break;
      case 'iceInd': X.iceInd = tog(v, X.iceInd); break;
      case 'askid': X.askid = tog(v, X.askid); break;
      case 'chrono': // CHR: start, stop, reset
        if (X.chronoRun) X.chronoRun = false; else if (X.chrono != null && X.chrono > 0) X.chrono = null; else { X.chrono = 0; X.chronoRun = true; }
        break;
      case 'bright': X.bright[i] = clamp(v, 0, 1); break;
      case 'terrNd': X.terrNd[i] = tog(v, X.terrNd[i]); break;
      case 'ecp':
        if (v === 'CLR') { const c = SYS.currentCautions(); if (c.length) X.cleared = c; S.mc = false; break; }
        if (v === 'RCL') { X.cleared = []; break; }
        if (v === 'EMER CANC') { S.mwSilenced = true; S.mc = false; X.cleared = SYS.currentCautions(); break; }
        if (v === 'TO CONFIG') { X.tocfg = 6; if (FG.sound && FG.sound.on && !toConfigOk()) A.speak('config'); break; }
        X.ecp = X.ecp === v ? null : v; X.all = 0; X.allT = 0;
        break;
      default: return false;
    }
    return true;
  }

  // ---------- warnings, cautions, procedures, memos ----------
  const ac = () => S.elec.level === 'normal' || S.elec.level === 'one';
  function warnings() {
    if (!S || !S.elec) return [];
    const w = [], air = !s.onGround;
    if (air && (S.elec.level === 'emer' || S.elec.level === 'bat')) w.push('ELEC EMER CONFIG');
    if (air && S.air.cabAlt > 9550) w.push('CAB PR EXCESS CAB ALT');
    if (S.misc.tocfg > 0 && !toConfigOk()) w.push('CONFIG');
    return w;
  }
  function toConfigOk() {
    const tc = s.spec.toConf || 1;
    return s.conf >= 1 && s.conf <= Math.max(1, tc) && !s.parking && !s.sb;
  }
  function cautions() {
    if (!S || !S.elec) return [];
    const c = [], air = !s.onGround, n = S.eng.length, X = S.misc;
    const E = S.elec, H = S.hyd, F = S.fuel, R = S.air, D = S.adirs;
    S.eng.forEach((e, i) => { if (e.run === 1 && !E.gen[i]) c.push(`ELEC GEN ${i + 1} OFF`); });
    if (air) E.bat.forEach((b, k) => { if (!b) c.push(`ELEC BAT ${k + 1} OFF`); });
    if (E.level === 'one') c.push(`ELEC AC BUS ${E.ac[0] ? 2 : 1} FAULT`);
    const lost = ['G', 'B', 'Y'].filter((k) => H.p[k] < 1450 && (k !== 'B' || n !== 2 || true));
    const NAME = { G: 'G', B: 'B', Y: 'Y' };
    if (S.eng.some((e) => e.run === 1) || air) {
      if (lost.length >= 2) c.push(`HYD ${lost.map((k) => NAME[k]).join('+')} SYS LO PR`);
      else if (lost.length === 1) c.push(`HYD ${NAME[lost[0]]} SYS LO PR`);
    }
    const anyRun = S.eng.some((e) => e.run === 1);
    if (anyRun) {
      if (PLAN.wide === 'a340') S.eng.forEach((e, i) => { if (!F.pump[`E${i}`] && !F.pump[`E${i}S`]) c.push(`FUEL ENG ${i + 1} FEED PUMPS LO PR`); });
      else {
        if (!F.pump.L1 && !F.pump.L2 && !F.pump.LS) c.push(`FUEL L TK PUMP 1+2${PLAN.wide ? '+STBY' : ''} LO PR`);
        if (!F.pump.R1 && !F.pump.R2 && !F.pump.RS) c.push(`FUEL R TK PUMP 1+2${PLAN.wide ? '+STBY' : ''} LO PR`);
      }
      if (F.C > 300 && !F.pump.CL && !F.pump.CR) c.push('FUEL CTR TK PUMPS OFF');
    }
    if (Math.abs(F.imbal) > F.wingCap * 0.2) c.push('FUEL IMBALANCE');
    if (F.T > 0 && F.trim === 'ISOL' && air && F.L + F.R < F.wingCap * 0.25) c.push('FUEL TRIM TK XFR FAULT');
    if ((F.L < F.wingCap * 0.1 || F.R < F.wingCap * 0.1) && F.C < 50) c.push(`FUEL ${F.L < F.wingCap * 0.1 && F.R < F.wingCap * 0.1 ? 'L+R' : F.L < F.wingCap * 0.1 ? 'L' : 'R'} WING TK LO LVL`);
    S.eng.forEach((e, i) => { if (F.starve[i] > 2 && e.master) c.push(`FUEL ENG ${i + 1} NO FEED`); });
    if (air && R.pack[0] + R.pack[1] === 0) c.push('AIR PACK 1+2 OFF');
    else if (air && R.pack[0] + R.pack[1] === 1) c.push(`AIR PACK ${R.pack[0] ? 2 : 1} OFF`);
    if (air && !S.eng.some((e, i) => e.run === 1 && R.engBleed[i]) && !(S.apu.avail && S.apu.bleed)) c.push('AIR ENG BLEED OFF');
    D.ir.forEach((r, k) => { if (!irAtt(r)) c.push(`NAV IR ${k + 1} FAULT`); else if (!irNav(r)) c.push(`NAV IR ${k + 1} ATT ONLY`); });
    D.adr.forEach((a, k) => { if (!a) c.push(`NAV ADR ${k + 1} FAULT`); });
    if (S.ice.wing > 0.15 && !S.wingAntiIce) c.push('ANTI ICE ICE DETECTED');
    if (S.ice.eng > 0.15 && S.eng.some((e) => !e.antiIce)) c.push('ANTI ICE ENG ICE');
    if (!ac() && air && S.ice.probe !== 'ON' && iceConditions()) c.push('ANTI ICE PROBES HEAT');
    if (X.burst) c.push('WHEEL TYRES BURST');
    if (!X.askid && s.onGround) c.push('BRAKES ANTI SKID OFF');
    if (s.altLaw && air) c.push('F/CTL ALTN LAW');
    if (!X.crewOxy && air) c.push('OXY CREW SUPPLY OFF');
    return c.filter((x) => !X.cleared.includes(x));
  }
  function proc(name, add, air) {
    if (!S || !S.elec) return;
    const E = S.elec, H = S.hyd, F = S.fuel, R = S.air, D = S.adirs;
    const cy = (t) => add(t, 'cyan'), wh = (t) => add(t, 'white');
    if (name === 'ELEC EMER CONFIG') {
      cy('-GEN 1+2 ...... OFF THEN ON');
      if (S.apu.avail) cy('-APU GEN ............ ON'); else if (s.h / FT < 25000) cy('-APU (BELOW FL250) .. START');
      if (!E.rat) cy('-EMER ELEC PWR .... MAN ON');
      wh('.ALTN LAW: PROT LOST');
      if (E.level === 'bat') add('-LAND ASAP (BAT ONLY)', 'red');
    } else if (name === 'CAB PR EXCESS CAB ALT') {
      cy('-CREW OXY MASKS ...... USE'); cy('-SIGNS ................ ON'); cy('-EMER DESCENT ..... INITIATE');
      if (!R.paxMasks) cy('-PAX OXY MASKS ..... MAN ON');
      if (R.pack[0] + R.pack[1] < 2) cy('-PACK 1+2 .............. ON');
    } else if (name === 'CONFIG') {
      const tc = s.spec.toConf || 1;
      if (s.conf < 1 || s.conf > Math.max(1, tc)) cy('-FLAPS ............. T.O');
      if (s.parking) cy('-PARK BRK ............ OFF');
      if (s.sb) cy('-SPD BRK ......... RETRACT');
    } else if (/^ELEC GEN (\d) OFF/.test(name)) cy(`-GEN ${name.match(/\d/)[0]} .................. ON`);
    else if (/^ELEC BAT (\d) OFF/.test(name)) cy(`-BAT ${name.match(/\d/)[0]} .................. AUTO`);
    else if (/^HYD /.test(name)) {
      const ks = name.replace(/^HYD | SYS LO PR$/g, '').split('+');
      const map = hydOf(S.eng.length);
      for (const k of ks) {
        const NM = k === 'G' ? 'GREEN' : k === 'Y' ? 'YELLOW' : 'BLUE';
        for (const [sy, i] of PLAN.edp) if (sy === k && !edpOn(sy, i)) cy(`-${NM} ENG ${i + 1} PUMP .. ON`);
        void map;
        if (PLAN.wide) { if (!H.elecP[k]) cy(`-${NM} ELEC PUMP ....... ON`); continue; }
        if (k === 'B' && !H.bElec) cy('-BLUE ELEC PUMP ...... AUTO');
        if (k === 'Y' && !H.yElec) cy('-YELLOW ELEC PUMP ...... ON');
        if ((k === 'G' || k === 'Y') && !H.ptu) cy('-PTU ................ AUTO');
      }
      if (ks.length >= 2) { wh('.ALTN LAW: PROT LOST'); if (ks.includes('G')) wh('.LDG GEAR: GRAVITY EXTN'); if (ks.includes('G') && ks.includes('Y')) wh('.FLAPS: STUCK'); add('-LAND ASAP', 'amber'); }
    } else if (/^FUEL ([LR]) TK PUMP/.test(name)) cy(`-FUEL ${name[5]} TK PUMPS ........ ON`);
    else if (/^FUEL ENG (\d) FEED PUMPS/.test(name)) { const k = name.match(/\d/)[0]; cy(`-ENG ${k} FEED PUMPS ...... ON`); cy(`-X FEED ${k} ............ OPEN`); }
    else if (name === 'FUEL TRIM TK XFR FAULT') cy('-T TK FEED ............ AUTO');
    else if (name === 'FUEL CTR TK PUMPS OFF') cy('-CTR TK PUMPS ........ ON');
    else if (name === 'FUEL IMBALANCE') { cy('-FUEL X FEED ........ OPEN'); cy(`-${F.imbal > 0 ? 'R' : 'L'} TK PUMPS ......... OFF`); }
    else if (/LO LVL/.test(name)) { if (!xfeedOpen()) cy('-FUEL X FEED ........ OPEN'); add('-LAND ASAP', 'amber'); }
    else if (/NO FEED/.test(name)) { cy(PLAN.wide === 'a340' ? '-FEED TK PUMPS ......... ON' : '-WING TK PUMPS ......... ON'); cy('-FUEL X FEED ........ OPEN'); wh('.BELOW FL150: GRAVITY FEED'); }
    else if (/^AIR PACK/.test(name)) cy('-PACK 1+2 .............. ON');
    else if (name === 'AIR ENG BLEED OFF') { cy('-ENG BLEED ............ ON'); if (s.h / FT < 22500 && S.apu.avail) cy('-APU BLEED ............. ON'); }
    else if (/^NAV IR (\d)/.test(name)) {
      const k = Number(name.match(/\d/)[0]) - 1;
      if (D.ir[k].mode === 'OFF') cy(`-IR ${k + 1} MODE SEL ....... ${air ? 'ATT' : 'NAV'}`);
      if (k === 0 && D.attHdg !== 'CAPT 3') cy('-ATT HDG SWTG ..... CAPT 3');
      if (k === 1 && D.attHdg !== 'F/O 3') cy('-ATT HDG SWTG ...... F/O 3');
    } else if (/^NAV ADR (\d)/.test(name)) {
      const k = Number(name.match(/\d/)[0]) - 1;
      cy(`-ADR ${k + 1} ................. ON`);
      if (k === 0 && D.airData !== 'CAPT 3') cy('-AIR DATA SWTG .... CAPT 3');
      if (k === 1 && D.airData !== 'F/O 3') cy('-AIR DATA SWTG ..... F/O 3');
    } else if (name === 'ANTI ICE ICE DETECTED') cy('-WING ANTI ICE ......... ON');
    else if (name === 'ANTI ICE ENG ICE') cy('-ENG ANTI ICE .......... ON');
    else if (name === 'ANTI ICE PROBES HEAT') cy('-PROBE/WINDOW HEAT ..... ON');
    else if (name === 'WHEEL TYRES BURST') wh('.BRAKING REDUCED');
    else if (name === 'BRAKES ANTI SKID OFF') { cy('-A/SKID & N/W STRG .... ON'); wh('.MAX BRK PR ...... 1000 PSI'); }
    else if (name === 'F/CTL ALTN LAW') { wh('.PROT LOST'); wh('.MAX SPEED ........ 320 KT'); }
    else if (name === 'OXY CREW SUPPLY OFF') cy('-CREW SUPPLY ........... ON');
  }
  const xfeedOpen = () => !!(S.fuel.xfeed || S.fuel.xfeedE.some((v) => v));
  function memo() {
    if (!S || !S.elec) return [];
    const m = [], X = S.misc, G = S.gpws;
    if (xfeedOpen()) m.push('FUEL X FEED');
    if (S.fuel.tXfr) m.push('T TK XFR');
    if (X.taxiCam && s.onGround) m.push('TAXI CAMERA');
    if (S.elec.rat) m.push('RAT OUT');
    if (S.elec.ext) m.push('EXT PWR');
    if (!G.sys) m.push('GPWS OFF');
    else { if (!G.terr) m.push('GPWS TERR OFF'); if (!G.gs) m.push('G/S MODE OFF'); if (!G.flap) m.push('GPWS FLAP MODE OFF'); }
    if (G.ldg3) m.push('GPWS FLAP 3');
    if (S.air.paxMasks) m.push('PAX OXY');
    if (S.air.mode === 'MAN') m.push('MAN LDG ELEV');
    if (X.rcdr) m.push('RCDR GND CTL');
    if (X.emerExit === 'ON') m.push('EMER EXIT LT ON');
    if (S.ice.probe === 'ON') m.push('PROBE/WINDOW HEAT');
    if (X.evac) m.push('EVAC');
    if (X.tocfg > 0 && toConfigOk()) m.unshift('T.O CONFIG NORMAL');
    return m;
  }
  // The HUD's list: the GPWS's own warnings added, the ones its switches turn off taken out.
  function filter(w) {
    if (!S || !S.gpws) return w;
    const G = S.gpws;
    let out = w.filter(([t]) => {
      if (!G.sys && /^(PULL UP|SINK RATE|TOO LOW)/.test(t)) return false;
      if (!G.flap && /^TOO LOW — FLAPS/.test(t)) return false;
      if (G.ldg3 && /^TOO LOW — FLAPS/.test(t) && s.conf >= s.spec.conf.length - 2) return false;
      return true;
    });
    if (G.terrAhead === 2) out.unshift(['TERRAIN AHEAD — PULL UP', 'red']);
    else if (G.terrAhead === 1) out.unshift(['TERRAIN AHEAD', 'amber']);
    if (G.gsLow) out.push(['GLIDE SLOPE', 'amber']);
    if (S.air.hypoxia > 0.2) out.unshift(['HYPOXIA: CREW OXYGEN SUPPLY ON, DESCEND', 'red']);
    return out;
  }
  // The exterior lights need power: the emergency configuration keeps none but the batteries' own
  function lights(L) {
    if (!S || !S.elec) return L;
    if (S.elec.level === 'dark') return { nav: 0, beacon: 0, strobe: 0, land: 0, wing: 0 };
    if (S.elec.level === 'emer' || S.elec.level === 'bat') return { ...L, land: 0, wing: 0, strobe: 0 };
    return L;
  }
  // engine i gets no fuel (for long enough: the lines empty)
  const starved = (i) => !!(S && S.fuel && S.fuel.starve[i] > 4);

  // ---------- what the screens and the 3D deck ask ----------
  // a screen's power: 'pfd1' 'nd1' 'pfd2' 'nd2' 'ewd' 'sd' 'mcdu1' 'mcdu2' 'isis'
  function screenOn(id) {
    if (!S || !S.elec) return true;
    const L = S.elec.level;
    if (id === 'isis') return L !== 'dark' || S.elec.bat.some((b) => b);
    if (L === 'normal' || L === 'one') return true;
    if (L === 'emer' || L === 'bat') return ['pfd1', 'nd1', 'ewd', 'mcdu1'].includes(id);
    return false;
  }
  // which IR (0..2) and ADR a side's screens show: CAPT 3 / F/O 3 switch the third one in
  const irFor = (side) => (side === 0 ? (S.adirs.attHdg === 'CAPT 3' ? 2 : 0) : (S.adirs.attHdg === 'F/O 3' ? 2 : 1));
  const adrFor = (side) => (side === 0 ? (S.adirs.airData === 'CAPT 3' ? 2 : 0) : (S.adirs.airData === 'F/O 3' ? 2 : 1));
  function side(k) {
    if (!S || !S.adirs) return { att: true, nav: true, air: true };
    const r = S.adirs.ir[irFor(k)];
    return { att: irAtt(r), nav: irNav(r), air: !!S.adirs.adr[adrFor(k)] };
  }
  // the autopilot needs power, normal law and a side with its IR and ADR
  function apOk() {
    if (!S || !S.elec) return true;
    if (!(S.elec.level === 'normal' || S.elec.level === 'one')) return false;
    if (s.altLaw) return false;
    return [0, 1].some((k) => { const x = side(k); return x.nav && x.air; });
  }

  // ---------- the systems display's pages ----------
  const SD_PAGES = ['ENG', 'BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'APU', 'COND', 'DOOR', 'WHEEL', 'F/CTL'];
  // the page now: the one picked on the ECAM control panel, else the one a failure calls up, else by the phase
  function sdPage() {
    if (!S || !S.misc) return 'WHEEL';
    const X = S.misc;
    if (X.ecp === 'ALL') return SD_PAGES[X.all];
    if (X.ecp) return X.ecp;
    const c = SYS.currentCautions().join(' ') + ' ' + warnings().join(' ');
    if (S.eng.some((e) => e.fire || e.start || (!e.run && !s.onGround))) return 'ENG';
    if (/ELEC/.test(c)) return 'ELEC';
    if (/HYD/.test(c)) return 'HYD';
    if (/FUEL/.test(c)) return 'FUEL';
    if (/CAB PR|AIR PACK|BLEED/.test(c)) return /CAB PR/.test(c) ? 'PRESS' : 'BLEED';
    if (/F\/CTL/.test(c)) return 'F/CTL';
    if (S.apu.n > 1 && s.onGround || S.apu.fire) return 'APU';
    if (s.onGround && !S.eng.some((e) => e.run === 1)) return 'DOOR';
    if (!s.onGround && s.gear < 0.01 && A.agl() / FT > 1500) return 'CRUISE';
    return 'WHEEL';
  }
  const COL = { g: '#30d158', a: '#ffb000', r: '#ff3b30', c: '#4fd6ff', w: '#e8eef8', d: '#6d7480', m: '#ff4fd8' };
  function sd(c, W, H, page) {
    if (!S || !S.elec) return false;
    if (!['BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'COND', 'DOOR', 'F/CTL', 'CRUISE', 'STS'].includes(page)) return false;
    c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle'; c.textAlign = 'center';
    const f = (k) => `600 ${Math.round(H * k)}px system-ui, sans-serif`;
    const txt = (t, x, y, col = COL.w, k = 0.042, al = 'center') => { c.font = f(k); c.fillStyle = col; c.textAlign = al; c.fillText(t, x * W, y * H); };
    const line = (x0, y0, x1, y1, col = COL.g, w = 2) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x0 * W, y0 * H); c.lineTo(x1 * W, y1 * H); c.stroke(); };
    const boxT = (t, x, y, col) => { c.font = f(0.04); const tw = c.measureText(t).width + 10; c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(x * W - tw / 2, y * H - H * 0.03, tw, H * 0.06); txt(t, x, y, col, 0.04); };
    txt(page, 0.5, 0.06, COL.w, 0.05);
    line(0.43, 0.095, 0.57, 0.095, COL.w, 1.5);
    const n = S.eng.length, air = !s.onGround;
    if (page === 'ELEC') {
      const E = S.elec;
      [0, 1].forEach((k) => {
        const x = k ? 0.8 : 0.2;
        boxT(`BAT ${k + 1}`, x, 0.2, E.bat[k] ? COL.g : COL.a);
        txt(`${Math.round(24 + 4 * E.batCharge[k])} V`, x, 0.27, E.bat[k] ? COL.g : COL.a, 0.035);
        boxT(`AC ${k + 1}`, x, 0.45, E.ac[k] ? COL.g : COL.a);
      });
      boxT('AC ESS', 0.5, 0.45, E.level !== 'dark' && E.level !== 'bat' ? COL.g : COL.a);
      S.eng.forEach((e, i) => {
        const x = n > 2 ? 0.14 + i * 0.24 : i ? 0.8 : 0.2, on = E.gen[i] && e.run === 1;
        boxT(`GEN ${i + 1}`, x, 0.72, on ? COL.g : COL.a);
        txt(on ? '100 % 115 V 400 HZ' : E.gen[i] ? 'XX' : 'OFF', x, 0.79, on ? COL.g : COL.a, 0.03);
      });
      boxT('APU GEN', 0.5, 0.62, E.apuGen && S.apu.avail ? COL.g : COL.d);
      if (E.ext || (!air && s.V < 1 * KT)) boxT('EXT PWR', 0.5, 0.86, E.ext ? COL.g : COL.w);
      if (E.rat) boxT('EMER GEN', 0.5, 0.3, A.ias() > 100 ? COL.g : COL.a);
      if (!E.busTie) txt('BUS TIE OFF', 0.5, 0.53, COL.a, 0.032);
    } else if (page === 'HYD') {
      const Hy = S.hyd;
      ['G', 'B', 'Y'].forEach((k, j) => {
        const x = 0.2 + j * 0.3, p = Math.round(Hy.p[k] / 50) * 50, ok = Hy.p[k] > 1450;
        txt(k === 'G' ? 'GREEN' : k === 'B' ? 'BLUE' : 'YELLOW', x, 0.18, ok ? COL.w : COL.a, 0.045);
        txt(String(p), x, 0.26, ok ? COL.g : COL.a, 0.05);
        line(x, 0.3, x, 0.62, ok ? COL.g : COL.a);
      });
      for (const k of ['G', 'B', 'Y']) {
        const x = 0.2 + ['G', 'B', 'Y'].indexOf(k) * 0.3, mine = PLAN.edp.filter(([sy]) => sy === k);
        mine.forEach(([sy, i], j) => boxT(`${i + 1}`, x + (j - (mine.length - 1) / 2) * 0.08, 0.7, edpOn(sy, i) && S.eng[i].run === 1 ? COL.g : COL.a));
      }
      if (PLAN.wide) {
        ['G', 'B', 'Y'].forEach((k, j) => boxT('ELEC', 0.2 + j * 0.3, 0.84, Hy.elecP[k] ? COL.g : COL.d));
        if (S.elec.rat) txt('RAT', 0.2, 0.92, COL.g, 0.04);
      } else {
        boxT('ELEC', 0.5, 0.8, Hy.bElec ? COL.g : COL.a);
        boxT('ELEC', 0.8, 0.86, Hy.yElec ? COL.g : COL.d);
        txt(`PTU ${Hy.ptu ? 'AUTO' : 'OFF'}`, 0.5, 0.48, Hy.ptu ? COL.g : COL.a, 0.038);
        if (S.elec.rat) txt('RAT', 0.5, 0.92, COL.g, 0.04);
      }
    } else if (page === 'FUEL') {
      const F = S.fuel, kg = (x) => String(Math.round(x / 10) * 10);
      txt('F.USED', 0.5, 0.16, COL.w, 0.035); txt(`${kg(F.used)} KG`, 0.5, 0.22, COL.g, 0.045);
      [['L', 0.18], ['C', 0.5], ['R', 0.82]].forEach(([t, x]) => {
        boxT(kg(F[t]), x, 0.62, F[t] < (t === 'C' ? 1 : F.wingCap * 0.1) ? COL.a : COL.g);
        txt(t === 'C' ? 'CTR' : t === 'L' ? 'LEFT' : 'RIGHT', x, 0.7, COL.w, 0.032);
      });
      const pm = (k, x, t = k, y = 0.48) => boxT(t, x, y, F.pump[k] ? COL.g : COL.a);
      if (PLAN.wide === 'a340') {
        for (let i = 0; i < n; i++) { const x = [0.09, 0.27, 0.73, 0.91][i]; pm(`E${i}`, x, `${i + 1}`); pm(`E${i}S`, x, 'S', 0.4); }
        pm('CL', 0.44); pm('CR', 0.56);
        txt(`X FEED ${F.xfeedE.map((v, i) => (v ? i + 1 : '·')).join(' ')}`, 0.5, 0.3, xfeedOpen() ? COL.g : COL.w, 0.036);
      } else {
        pm('L1', 0.12); pm('L2', 0.24); pm('CL', 0.44); pm('CR', 0.56); pm('R1', 0.76); pm('R2', 0.88);
        if (PLAN.wide) { pm('LS', 0.18, 'STBY', 0.4); pm('RS', 0.82, 'STBY', 0.4); }
        txt(`X FEED ${F.xfeed ? 'OPEN' : 'SHUT'}`, 0.5, 0.36, F.xfeed ? COL.g : COL.w, 0.038);
      }
      if (PLAN.trim) { boxT(kg(F.T), 0.5, 0.78, COL.g); txt(`TRIM ${F.tXfr ? '→ XFR' : F.trim}`, 0.66, 0.78, F.trim === 'ISOL' ? COL.w : COL.g, 0.03, 'left'); }
      txt(`FOB ${kg(F.L + F.C + F.R + F.T)} KG`, 0.5, PLAN.trim ? 0.87 : 0.84, COL.g, 0.05);
      txt(`MODE ${F.modeSel}`, 0.5, 0.92, F.modeSel === 'AUTO' ? COL.g : COL.a, 0.032);
    } else if (page === 'BLEED' || page === 'COND') {
      const R = S.air;
      S.eng.forEach((e, i) => {
        const x = n > 2 ? 0.14 + i * 0.24 : i ? 0.8 : 0.2, on = R.engBleed[i] && e.run === 1;
        boxT(`ENG ${i + 1}`, x, 0.8, on ? COL.g : COL.a);
        txt(on ? `${Math.round(40 + e.n1 * 0.15)} PSI` : 'XX', x, 0.87, on ? COL.g : COL.a, 0.032);
      });
      boxT('APU', 0.5, 0.86, S.apu.avail && S.apu.bleed ? COL.g : COL.d);
      [0, 1].forEach((k) => boxT(`PACK ${k + 1}`, k ? 0.75 : 0.25, 0.4, R.pack[k] ? COL.g : COL.a));
      if (page === 'COND') {
        ['CKPT', 'FWD', 'AFT'].forEach((z, j) => { txt(z, 0.25 + j * 0.25, 0.22, COL.w, 0.035); txt(`${22 + j} °C`, 0.25 + j * 0.25, 0.28, COL.g, 0.04); });
      } else txt(`${R.pack[0] + R.pack[1] ? 'PACKS' : 'NO PACK'}`, 0.5, 0.25, R.pack[0] + R.pack[1] ? COL.g : COL.a, 0.04);
    } else if (page === 'PRESS' || page === 'CRUISE') {
      const R = S.air;
      if (page === 'CRUISE') {
        txt('ENG', 0.5, 0.15, COL.w, 0.04);
        S.eng.forEach((e, i) => { const x = n > 2 ? 0.14 + i * 0.24 : i ? 0.75 : 0.25; txt(`F.USED ${Math.round(S.fuel.used / n / 10) * 10}`, x, 0.22, COL.g, 0.032); txt(`OIL ${(12 + i * 0.3).toFixed(1)} QT`, x, 0.28, COL.g, 0.032); });
        line(0.05, 0.36, 0.95, 0.36, COL.w, 1);
      }
      const y0 = page === 'CRUISE' ? 0.46 : 0.25;
      txt('CAB ALT', 0.25, y0, COL.w, 0.035); txt(`${Math.round(R.cabAlt / 50) * 50} FT`, 0.25, y0 + 0.07, R.cabAlt > 9550 ? COL.r : COL.g, 0.05);
      txt('CAB V/S', 0.75, y0, COL.w, 0.035); txt(`${Math.round(R.cabVs / 50) * 50} FT/MIN`, 0.75, y0 + 0.07, Math.abs(R.cabVs) > 1800 ? COL.a : COL.g, 0.045);
      const dp = Math.max(0, isaP(R.cabAlt * FT) - isaP(s.h)) / 6895;
      txt('ΔP', 0.25, y0 + 0.18, COL.w, 0.035); txt(`${dp.toFixed(1)} PSI`, 0.25, y0 + 0.25, dp > 8.5 ? COL.a : COL.g, 0.045);
      txt(`MODE ${R.mode}`, 0.75, y0 + 0.21, R.mode === 'AUTO' ? COL.g : COL.a, 0.04);
      if (R.paxMasks) txt('PAX OXY MASKS', 0.5, 0.9, COL.a, 0.04);
    } else if (page === 'DOOR') {
      c.strokeStyle = COL.w; c.lineWidth = 2;
      c.beginPath(); c.ellipse(W / 2, H * 0.55, W * 0.12, H * 0.36, 0, 0, 7); c.stroke();
      ['CABIN', 'CABIN', 'CARGO', 'CARGO'].forEach((t, j) => txt(t, j % 2 ? 0.7 : 0.3, 0.3 + j * 0.15, COL.g, 0.032));
      txt(`OXY ${S.misc.crewOxy ? '1850 PSI' : 'SUPPLY OFF'}`, 0.5, 0.94, S.misc.crewOxy ? COL.g : COL.a, 0.035);
    } else if (page === 'F/CTL') {
      const Hy = S.hyd, hy = (k) => (Hy.p[k] > 1450 ? COL.g : COL.a);
      txt(s.altLaw ? 'ALTN LAW' : 'NORMAL LAW', 0.5, 0.15, s.altLaw ? COL.a : COL.g, 0.04);
      const bar = (x, y, v, label) => { line(x - 0.06, y, x + 0.06, y, COL.w, 1); c.fillStyle = COL.g; c.fillRect((x + v * 0.06) * W - 3, y * H - 8, 6, 16); txt(label, x, y + 0.06, COL.w, 0.03); };
      bar(0.2, 0.35, s.roll || 0, 'L AIL'); bar(0.8, 0.35, -(s.roll || 0), 'R AIL');
      bar(0.3, 0.7, s.stick || 0, 'ELEV'); bar(0.7, 0.7, s.stick || 0, 'ELEV'); bar(0.5, 0.86, s.rud || 0, 'RUD');
      txt('G B Y', 0.5, 0.5, COL.w, 0.035);
      ['G', 'B', 'Y'].forEach((k, j) => txt(k, 0.44 + j * 0.06, 0.56, hy(k), 0.04));
      const spl = Math.max(s.gs || 0, s.sb || 0);
      txt(`SPD BRK ${Math.round(spl * 100)} %`, 0.5, 0.25, spl > 0.05 ? COL.g : COL.w, 0.035);
    } else if (page === 'STS') {
      const lines = sts();
      txt('STATUS', 0.5, 0.06, COL.w, 0.05);
      c.textAlign = 'left';
      lines.forEach(([t, col], j) => { c.font = `600 ${Math.round(H * 0.038)}px ui-monospace, monospace`; c.fillStyle = col; c.fillText(t, W * 0.06, H * (0.18 + j * 0.055)); });
      if (!lines.length) txt('NORMAL', 0.5, 0.5, COL.g, 0.05);
    }
    if (S.ice.wing > 0.05 && S.misc.iceInd) txt('ICE', 0.92, 0.06, COL.a, 0.04);
    // the bottom line: the outside air, the time, the weight
    line(0.02, 0.955, 0.98, 0.955, COL.w, 1);
    txt(`SAT ${Math.round(oatC())} °C`, 0.04, 0.98, COL.g, 0.028, 'left');
    txt(`GW ${Math.round(s.mass / 1000 * 10) / 10} T`, 0.96, 0.98, COL.g, 0.028, 'right');
    return true;
  }
  // the STATUS page: limitations and what's inoperative
  function sts() {
    const out = [], H = S.hyd, E = S.elec;
    if (s.altLaw) out.push(['ALTN LAW: PROT LOST', COL.a], ['MAX SPD ......... 320 KT', COL.c]);
    if (H.p.G < 1450) out.push(['LDG GEAR: GRAVITY EXTN', COL.c]);
    if (H.p.G < 1450 || H.p.Y < 1450) out.push([H.p.G < 1450 && H.p.Y < 1450 ? 'FLAPS STUCK' : 'FLAPS SLOW', COL.c]);
    if (H.p.Y < 1450) out.push(['NW STRG INOP', COL.c]);
    if (E.level !== 'normal') out.push([`ELEC: ${E.level.toUpperCase()}`, COL.a]);
    if (xfeedOpen()) out.push(['FUEL X FEED OPEN', COL.w]);
    if (S.misc.burst) out.push(['TYRES BURST: BRK REDUCED', COL.a]);
    if (!apOk()) out.push(['INOP SYS: AP 1+2', COL.a]);
    return out;
  }

  SYS.plug({ fresh, begin, set, step, warnings, cautions, proc, memo, filter, lights, starved, sd,
    ldgConf3: () => !!(S && S.gpws && S.gpws.ldg3), key: () => false });
  Object.assign(SYS, { screenOn, side, apOk, sdPage, oatC, wx, ffOf: (i) => (S ? ffOf(i) : 0), SD_PAGES, iceConditions });
})();
