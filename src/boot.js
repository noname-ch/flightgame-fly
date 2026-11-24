// Starts the game's world without its interface (src/guard.js keeps your save untouched), opens the 3D view and
// the "Fly it yourself" dialog, filled from the link the game's ✈ Fly button sent:
//   ?type=A320&from=ZRH&rw=14&to=GVA&crz=340&mode=runway|final|takeover&plane=<id>&back=<the game's URL>&go=1
// go=1 skips the dialog. Leaving the cockpit brings the dialog back.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const code = (v) => (v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || undefined;
  const httpUrl = (u) => {
    if (!u) return null;
    try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; }
  };
  const onPages = /\.github\.io$/.test(location.hostname);
  FG.fly = {
    backUrl: httpUrl(q.get('back')) || (onPages ? `${location.origin}/flightgame/` : new URL('index.html', document.baseURI).href),
  };
  document.body.classList.add('fly');
  document.title = 'Flightgame · Fly';

  const opts = {
    type: q.get('type') || undefined, from: code(q.get('from')), to: code(q.get('to')),
    rw: (q.get('rw') || '').replace(/[^0-9LRC]/gi, '').toUpperCase() || undefined,
    crz: Number(q.get('crz')) || undefined, mode: q.get('mode') || undefined, plane: q.get('plane') || undefined,
  };

  const badge = document.createElement('div');
  badge.id = 'fly-badge';
  badge.innerHTML = '<span>✈ Flightgame · Fly</span><a></a>';
  const a = badge.querySelector('a');
  a.href = FG.fly.backUrl; a.textContent = '← Back to Flightgame';
  document.body.appendChild(badge);

  function when(test, then, every = 150) {
    const t = setInterval(() => { let ok = false; try { ok = test(); } catch (e) { /* not yet */ } if (ok) { clearInterval(t); then(); } }, every);
  }
  // the game's start screen: straight into the world (your saved airline, or the placeholder one)
  function enterWorld() {
    const ss = document.getElementById('start-screen');
    if (!ss || ss.hidden) return;
    const b = document.createElement('button');
    b.dataset.st = 'continue'; b.hidden = true;
    ss.appendChild(b); b.click(); b.remove();
  }
  function planeId() {
    if (!opts.plane) return undefined;
    const p = (FG.game.state.planes || []).find((x) => String(x.id) === opts.plane);
    return p ? p.id : undefined;
  }
  function dialog() {
    if (FG.pilot.active) return;
    FG.pilot.open({ ...opts, plane: planeId() });
  }
  when(() => FG.ui && FG.game.state, () => {
    enterWorld();
    when(() => FG.view3d && FG.view3d.setOn, () => {
      if (!FG.view3d.on) FG.view3d.setOn(true);
      const ap = opts.from && FG.game.airportByCode[opts.from];
      if (ap && FG.ui.showAirport) setTimeout(() => FG.ui.showAirport(opts.from), 300);
      if (q.get('go') === '1' && opts.from) {
        when(() => FG.view3d.map, () => {
          dialog();
          const go = document.querySelector('#pilot-start [data-ps="go"]');
          if (go) go.click();
        });
      } else dialog();
    });
  });
  // back from a flight: the dialog again, with the last flight's airports
  window.addEventListener('fg-pilot-stop', () => setTimeout(() => {
    if (FG.pilot.active) return;
    const last = FG.pilot.state.startOpts || {};
    FG.pilot.open({ type: FG.pilot.type, from: last.end && last.end.code, to: last.to || undefined, crz: last.crz });
  }, 400));
})();
