// Flies a whole A320 flight with the autopilot, as fast as the CPU allows (no 3D view, flat ground), and writes
// what happened into <pre id="out">. Run by test/run.py. A pilot's hands only for the take-off, the flaps and the
// gear; everything else is the FCU: AP1, NAV, managed climb, T/D, DES, APPR, autoland, autobrake.
(function () {
  'use strict';
  const out = [];
  const log = (t) => out.push(t);
  const fail = [];
  function finish() {
    const pre = document.createElement('pre'); pre.id = 'out';
    pre.textContent = out.join('\n') + `\nRESULT: ${fail.length ? 'FAIL ' + fail.join('; ') : 'PASS'}`;
    document.body.appendChild(pre);
  }
  window.addEventListener('error', (e) => { fail.push(`script error: ${e.message} ${e.filename}:${e.lineno}`); });
  function run() {
    try { flight(); } catch (e) { fail.push(`threw: ${e.stack || e}`); }
    finish();
  }
  function flight() {
    const P = FG.pilot, M = FG.fmgc, F = M.F, s = P.state, G = FG.game;
    const FROM = new URLSearchParams(location.search).get('from') || 'ZRH';
    const TO = new URLSearchParams(location.search).get('to') || 'GVA';
    const ends = P.runwayEnds(FROM);
    const end = P.bestEnd(ends, FROM);
    const TYPE = new URLSearchParams(location.search).get('type') || 'A320';
    const tune = new URLSearchParams(location.search).get('tune'); if (tune) Object.assign(M.tune, JSON.parse(tune));
    P.start({ type: TYPE, mode: 'runway', end, to: TO, crz: 200 });
    log(`${TYPE}: ${s.spec.name}`);
    s.loading = false;
    const hud = document.getElementById('pilot-hud'); if (hud) hud.hidden = true; // (drawing every simulated frame is slow)
    if (!F.plan) { fail.push('no flight plan'); return; }
    F.plan.arrEnd.h = 0;
    log(`plan: ${F.plan.wps.map((w) => w.id).join(' ')} (${Math.round(F.plan.total)} NM)`);
    const DT = 1 / 30;
    let legIdx = -1, legAt = 0, maxAt = "", firstTouch = null, touchLogged = false, t = 0, phase = 'roll', lastLog = -999, maxBank = 0, maxXtk = 0, minIas = 999;
    const ias = () => P.api.ias(), agl = () => P.api.agl();
    s.lever = 1; // TOGA
    const keys = s.keys;
    const cap = Math.max(4320, (F.plan.total / 240) * 3600 + 2400); // (about 240 kt over the ground, and half an hour)
    while (t < cap) {
      // the pilot
      if (phase === 'roll' && ias() > s.spec.vr) { keys.add('ArrowDown'); phase = 'rotate'; }
      if (phase === 'rotate' && !s.onGround && agl() > 35) { keys.delete('ArrowDown'); phase = 'initial'; }
      if (phase === 'initial' && agl() > 50) { s.gearDown = false; }
      if (phase === 'initial' && agl() > 150) { M.engage(1); if (!F.ap1) fail.push('AP1 did not engage at 150 ft'); phase = 'ap'; }
      if (phase === 'ap' && agl() > 1600) { s.lever = 0.86; phase = 'clb'; if (!s.spec.athr) s.lever = 0.86; }
      if (s.conf > 0 && (phase === 'clb' || phase === 'ap') && agl() > 1600 && ias() > P.api.vls(s.conf - 1)) s.conf = Math.max(0, s.conf - 1);
      if (phase === 'clb' && F.vert === 'ALT' && Math.abs(s.h / 0.3048 - F.fcu.alt) < 100) { phase = 'crz'; log(`t=${t.toFixed(0)} level at ${F.fcu.alt}`); }
      if (phase === 'crz' && M.dtg() < (F.plan.crz * 100) / 318 + 4) { F.fcu.alt = 3000; M.push('alt'); M.press('APPR'); M.press('BRK MED'); phase = 'des'; log(`t=${t.toFixed(0)} DES pushed, dtg ${M.dtg().toFixed(1)}, vert ${F.vert}`); }
      if ((phase === 'des' || phase === 'app') && !s.onGround) {
        // (distance to go along the plan while in NAV; on the localizer, straight to the threshold)
        const d = F.lat === 'NAV' ? M.dtg() : M.geo.gcDist({ lat: s.lat, lon: s.lon }, F.plan.arrEnd);
        // high on the glide slope with the localizer in: a lower FCU altitude and V/S -1500 to meet it from above;
        // once it is captured, the missed approach altitude
        const l = F.ilsNow;
        if (F.vertArm === 'G/S' && ['LOC', 'LOC*'].includes(F.lat) && l && l.gs > 0.25 && F.fcu.alt > 1000) { F.fcu.alt = 1000; M.turn('vs', -15); }
        if (F.vert === 'G/S' && F.fcu.alt < 5000) F.fcu.alt = 5000;
        // flaps one notch at a time below each one's placard speed (VFE), the gear by 10 NM; speed brakes when fast
        const conf = P.api.conf();
        const next = conf[s.conf + 1];
        const want = d < 6 ? conf.length - 1 : d < 8 ? 3 : d < 11 ? 2 : d < 16 ? 1 : 0;
        if (next && s.conf < want && ias() < next.vfe + 3) s.conf++; // (VFE + 3: a crew would select a few knots less)
        if (d < 10 || (F.vert === 'V/S' && F.fcu.vs < 0 && F.lat !== 'NAV')) s.gearDown = true;
        if (d < 20) phase = 'app';
        if (s.spec.speedBrake) s.sb = F.moreDrag || (phase === 'app' && agl() > 1000 && ias() > P.api.spdTarget().kt + 10) ? 1 : 0; // (MORE DRAG, or fast on the approach)
      }
      // no autothrust (Q400, ATR): the pilot flies the power: climb power in the climbs, idle in the descents,
      // the speed by hand otherwise, idle in the flare
      if (!s.spec.athr && !s.onGround && phase !== 'roll' && phase !== 'rotate' && phase !== 'initial') {
        const v = F.vert;
        if (['CLB', 'OP CLB', 'EXP CLB', 'SRS'].includes(v)) s.lever = 0.86;
        else if (['DES', 'OP DES', 'EXP DES'].includes(v) && !F.desSpeed) s.lever = 0.05;
        else if (v === 'FLARE' && agl() < 20) s.lever = 0;
        else s.lever = Math.max(0.02, Math.min(0.93, s.lever + (P.api.spdTarget().kt - ias()) * 0.01 * DT));
      }
      // after touchdown: full reverse down to 70 kt, then idle (the autobrake does the rest)
      if (s.onGround && s.landed) s.lever = ias() > 70 ? -1 : 0;
      if (s.touch && !touchLogged) {
        touchLogged = true; firstTouch = s.touch;
        const thr = F.plan.arrEnd, x = M.geo.xtrack(thr, { lat: thr.far[0], lon: thr.far[1] }, { lat: s.lat, lon: s.lon });
        log(`touchdown ${Math.round(x.along * 1852)} m past the threshold, ${(x.xtk * 1852).toFixed(1)} m off the centre line, ${s.touch.fpm} fpm, ${s.touch.kt} kt`);
      }
      P.step(DT);
      if (new URLSearchParams(location.search).get('flare') && (F.vert === 'FLARE' || (F.vert === 'LAND' && agl() < 150) || (new URLSearchParams(location.search).get('flare') === 'all' && phase === 'app')) && Math.floor(t * 2) !== Math.floor((t - DT) * 2))
        log(`  ${F.vert} agl ${agl().toFixed(0)} vs ${P.api.vsFpm().toFixed(0)} cmd ${F.cmd.gamma == null ? '-' : F.cmd.gamma.toFixed(2)} g ${(s.gamma * 57.3).toFixed(2)} a ${s.alpha.toFixed(1)} aStall ${(s.aStall || 0).toFixed(1)} stall ${s.stalled} stick ${s.stick.toFixed(2)} ias ${ias().toFixed(0)} n1 ${s.n1[0].toFixed(0)} lev ${s.lever}`);
      t += DT;
      if (s.crashed) { fail.push(`crashed: ${s.crashed} at t=${t.toFixed(0)}`); break; }
      if (!s.onGround && F.ap1) {
        maxBank = Math.max(maxBank, Math.abs(s.phi));
        if (F.lat === 'NAV') {
          const leg = F.plan.wps[F.plan.active - 1] && { a: F.plan.legFrom || F.plan.wps[F.plan.active - 1], b: F.plan.wps[F.plan.active] };
          if (F.plan.active !== legIdx) { legIdx = F.plan.active; legAt = t; }
          if (leg && t > 200 && t - legAt > 90) { const xx = Math.abs(M.geo.xtrack(leg.a, leg.b, { lat: s.lat, lon: s.lon }).xtk); if (xx > maxXtk) { maxXtk = xx; maxAt = `t=${t.toFixed(0)} to ${leg.b.id} from ${F.plan.legFrom ? "PPOS" : F.plan.wps[F.plan.active - 1].id} hdg ${s.psi.toFixed(0)} bank ${s.phi.toFixed(0)} ias ${ias().toFixed(0)}`; } }
        }
        if (phase !== 'app') minIas = Math.min(minIas, ias());
      }
      if (t - lastLog > (phase === 'app' ? 10 : 60) || (s.onGround && s.landed && lastLog < t - 5 && phase !== 'done')) {
        lastLog = t;
        log(`t=${t.toFixed(0).padStart(4)} ${phase.padEnd(7)} alt ${Math.round(s.h / 0.3048).toString().padStart(5)} ias ${ias().toFixed(0).padStart(3)} vs ${Math.round(P.api.vsFpm()).toString().padStart(5)} hdg ${s.psi.toFixed(0).padStart(3)} bank ${s.phi.toFixed(1).padStart(5)} ` +
          `| ${(F.vert || '-').padEnd(7)} ${(F.lat || '-').padEnd(8)} arm ${F.vertArm || '-'}/${F.latArm || '-'} athr ${s.athrMode} | wp ${F.plan.wps[F.plan.active] ? F.plan.wps[F.plan.active].id : '-'} dtg ${(M.dtg() || 0).toFixed(1)} conf ${s.conf} AP ${F.ap1 ? 1 : 0} brk ${s.brake.toFixed(2)} gs ${s.gs.toFixed(2)} ab ${F.abrk}/${F.abrkOn} lev ${s.lever} rev ${s.rev.toFixed(2)} ils ${F.ilsNow ? `${F.ilsNow.e.code}${F.ilsNow.e.name} ${(F.ilsNow.d / 1852).toFixed(1)}/${F.ilsNow.loc.toFixed(2)}/${F.ilsNow.gs == null ? 'null' : F.ilsNow.gs.toFixed(2)}` : '-'}`);
      }
      if (s.onGround && s.landed && s.V < 2) { phase = 'done'; break; }
    }
    log(`touch: ${JSON.stringify(s.touch)} maxBank ${maxBank.toFixed(1)} maxXtk(NAV) ${maxXtk.toFixed(2)} NM minIas ${minIas.toFixed(0)} (max xtk at ${maxAt})`);
    const thr = F.plan.arrEnd;
    const dThr = M.geo.gcDist({ lat: s.lat, lon: s.lon }, thr) * 1852;
    const x = M.geo.xtrack(thr, { lat: thr.far[0], lon: thr.far[1] }, { lat: s.lat, lon: s.lon });
    log(`stopped ${dThr.toFixed(0)} m from the threshold, ${(x.xtk * 1852).toFixed(1)} m off the centre line, final vert ${F.vert}`);
    if (phase !== 'done') fail.push(`did not land (phase ${phase})`);
    if (!firstTouch || firstTouch.fpm < -400) fail.push(`hard or no touchdown ${firstTouch && firstTouch.fpm}`);
    if (firstTouch && firstTouch.fpm < -300) fail.push(`firm touchdown ${firstTouch.fpm} fpm`);
    if (x.along * 1852 > thr.len) fail.push(`ran off the end of the runway (${Math.round(x.along * 1852)} m of ${Math.round(thr.len)} m)`);
    if (s.touch !== firstTouch) fail.push('bounced');
    if (Math.abs(x.xtk * 1852) > 20) fail.push('off the centre line');
    if (maxBank > 31) fail.push(`bank ${maxBank.toFixed(0)}`);
    if (maxXtk > 3) fail.push(`NAV cross track ${maxXtk.toFixed(1)} NM`);
  }
  // the game starts up first (its world, the airports)
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (FG.ui && FG.game.state && FG.pilot && FG.fmgc) { clearInterval(wait); run(); }
    else if (Date.now() - t0 > 20000) { clearInterval(wait); fail.push('game did not start'); finish(); }
  }, 100);
})();
