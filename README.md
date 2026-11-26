# Flightgame · Fly

The "Fly it yourself" mode of [Flightgame](https://github.com/noname-ch/flightgame), in its own repo, with an
A320-style autopilot: the glareshield FCU, flight directors, autothrust, an MCDU with a flight plan, the FMA and a
navigation display. The world is the game's: the same airports, runways, towns and cities, 3D ground, aircraft
models and liveries. Flightgame is a git submodule (`flightgame/`), so the two never drift apart.

In Flightgame, the ✈ Fly button (or P) opens this page with the aircraft, the airport and, when a plane of yours is
flying, that plane to take over. "← Back to Flightgame" returns. On GitHub Pages both share one localStorage: your
airline's save is read here (liveries, the plane you take over) but never written (`src/guard.js`).

## Run it

    git clone --recurse-submodules https://github.com/noname-ch/flightgame-fly.git
    cd flightgame-fly
    python -m http.server 8000        # then open http://localhost:8000/

The page takes `?type=A320&from=ZRH&rw=16&to=GVA&crz=200&mode=runway|final|takeover&plane=<id>&back=<url>&go=1`
(`go=1` skips the start dialog).

Before a push: `node test/smoke.mjs` (headless Chrome: the page loads, an A350 flies, every type starts) and
`python test/run.py` (a whole A320 flight on the autopilot). After updating the submodule
(`git submodule update --remote flightgame`), run `python tools/build_index.py`.

To send the game's ✈ Fly button to a local copy, run this once in the game's page console:
`localStorage.setItem('flightgame.flyUrl', 'http://localhost:8000/')` (`'here'` keeps the old in-game dialog).

## The start screen

It opens by itself, and again when you leave a flight. Pick:

- **Aircraft** from a gallery of all sixteen, pictured in the livery you chose. Filter by Airbus, Boeing, Propellers,
  or Concorde & business, or search. Each card says how many engines it has, whether it is fly-by-wire, whether the
  autopilot works in it, and whether it has a 3D cockpit (the A350s).
- **Airport**: type a code, city or name (suggestions as you type), or click one on the small map. Its runways are
  listed with their length and the wind on them (headwind, tailwind, crosswind); the one into the wind is picked,
  and those too short for the aircraft are marked.
- **Start**: lined up on the runway; on final on the ILS (3 to 20 NM out); or taking over one of your planes in the
  air (it carries on with its timetable when you leave). With a destination and a cruise level, the MCDU has a flight
  plan for the autopilot.
- **Livery**: your airline's, or any built-in or saved one.
- **Time of day**, local at the airport: now, sunrise, midday, sunset, night, or set by the hour. The world moves on
  to then: never back, and never saved.
- **Wind**: the game's weather there, calm, or set by hand (direction and speed, placed round the airport as the
  game's developer tools place one). In the air the plane drifts with the wind, so it crabs into a crosswind and a
  headwind slows it over the ground. The wind comes in over the first 100 ft, and the ND shows GS, TAS and the wind.

The last choices are kept for next time (localStorage `flightgame.fly.pick`). The link from the game
(`?type=&from=&rw=&mode=&plane=`) presets them.

## Flying by hand

Sixteen aircraft, each flying in its own way:
- **A350-900, A350-1000, A320, A330-300, A340-300, A340-600, A380-800, Global 7500**: fly-by-wire with full
  protections (below; the Global's is Bombardier's "normal mode"). The A320 is light and nimble, the A350-1000
  heavy, with a tail that strikes at under 10°. The A340-300's four small CFM56s spool up slowly and climb the
  slowest of all; the 75 m A340-600 strikes its tail past 9°; the 560 t A380 rolls slowly and only its inner engines
  reverse. The Global 7500 is a light business jet with plenty of thrust: quick to roll, Mach 0.90.
- **Boeing 737-800, 747-400, 777-300ER**: conventional controls, as a real aircraft. The stick moves the elevator;
  let go and it springs back to where the aircraft is trimmed. Hold it and the trim follows within a couple of
  seconds (you trim the force away), or trim yourself with Home / End (U / J). Trimmed, the aircraft is speed
  stable: it goes back to its trimmed speed by itself, nose rising and falling in the slow, lightly damped swing
  every aircraft has (the phugoid: about a minute a cycle, a quarter smaller each time), so more thrust makes it
  climb and less makes it sink. No protections on the 737 and the 747: they stall (stick shaker first), and there's
  no g limit: past 1.5 × the limit load (3.75 g) the wings fail; far past the dive speed it breaks up. Stalled,
  the lift breaks away, the airframe shakes, the nose drops even with the stick held back and a wing drops (25°);
  it stays stalled until the stick comes forward; trimmed into the stall it stays there hands off. Far past the
  stall the wing is an air brake: it sinks steeply at a low speed. The bank holds where you leave it. The 747 has
  four slow engines and a lot of mass: slow to pitch, to roll and to speed up. The 777 flies the same way (its
  fly-by-wire feels conventional) with soft protections you can pull through: it won't trim into the stall and lets
  the nose down there unless you hold the stick back, banks past 35° roll back to 30°, it pitches up past VMO.
  Its tail strikes past 8.5°.
- **Concorde**: no flaps: the delta wing lands at about 13-15° nose up and 160 kt, with a lot of drag. It has no
  stall break: past 20° the vortices over the wing go on lifting, less and less, while the drag grows until it sinks
  like a brick (stick shaker at 17°); its high-incidence protection keeps it under 20° (limiter). Reheat at the
  take-off detent (4) for the take-off and through Mach 1, then Mach 2 at 50,000 ft. Hands off after take-off with
  reheat it pitches up and swings, as the real one would: fly the attitude and take the reheat out. No spoilers.
- **Dash 8-400, ATR 72-600**: turboprops. The propellers answer the levers at once (torque, TQ %) and pull hardest
  when slow; reverse is the propellers' beta. No autothrust. The ATR has no spoilers and only 250 kt at most.
- Every type has its weight: the roll and the pitch take a moment to get going and to stop (about a second on the
  A350 and the 747, a third of one on the classics). The wings bend with the real load: up pulling out of a dive or
  in a hard turn, less in a stall or pushing over, and they bounce a little after a sharp pull.
- **DC-3, Ju 52/3m**: classics on cables: no autothrust, no reversers, no spoilers; the wings level by themselves,
  they roll slowly, and in a stall a wing drops. The Ju 52 has three engines and fixed gear, lifts off at about
  60 kt and stops in a few hundred metres.

**Limiter** (L, or 🛡 Limiter in the cockpit's buttons): the protections off. The fly-by-wire types then fly in
direct law (direct mode on the Global): conventional controls as above, no alpha protection, no alpha floor, no bank
or g limit: hold the stick back with the power at idle and they stall and fall like any other, and can be
overstressed. The Global's T-tail can then sink into a deep stall: the wing's wake blankets the tail, the elevator
hardly answers and the nose doesn't drop by itself; it comes down at 10,000 ft/min or more, and only the stick held
full forward (with power) gets it out, slowly. The 777 and Concorde lose their protections; the 737, 747,
turboprops and classics have none to lose. The choice is kept for the next flight.

The dialog says how each one flies and marks the runways too short for it. Thrust detents, flaps, speed limits,
crash limits (sink rate, bank, tyre speed) are each type's own. It flies in real time whatever the game speed and earns nothing: it's for flying. While
you fly, the keyboard is the plane's (the game's keys come back when you leave):
- ↑ ↓ (W S): stick, nose down / up. In an Airbus (normal law) it asks for a pitch rate; let go and it holds the
  flight path (the others: see above). ← → (A D): roll; let go and the bank stays (up to 33°). On the ground they steer, Q E = rudder.
- PgUp / PgDn or + / −: thrust levers (Shift with them: fine steps; Ctrl with + / −: fast); 1 2 3 4 = the IDLE, CL, FLX/MCT and TOGA detents. The engines spool up
  slowly from idle (about 8 s to take-off thrust). On the ground − past idle (or R) is reverse thrust.
- Autothrust (A/THR): in the air with the levers in CL (2) it holds a speed, the magenta mark on the speed tape:
  250 kt below 10,000 ft, then 300 kt / M 0.85, with flaps out a flap speed, on the approach VLS + 5. [ ] pick a
  speed yourself (cyan), \ goes back to the managed one, T switches the autothrust off (the levers set the thrust).
  Take off at TOGA, then at about 1,500 ft "LVR CLB" asks for the levers back to CL; left at TOGA it overspeeds.
- G gear (about 10 s to move), F / Shift+F flaps one notch down / up (0, 1, 1+F, 2, 3, FULL; about 7 s a notch),
  X speed brakes, Shift+X arms the ground spoilers, Space or B wheel brakes, K parking brake.
- C cycles the cameras (chase, cockpit with a head-up display, wing, fly-by), V chase, N wing. P pauses, H lists the
  keys, Esc opens a menu (the flight waits): resume, start this flight again, or leave the cockpit.
- The A350s have a 3D flight deck in the cockpit camera: the six screens show the PFD and navigation display, the engine
  and warning display, the wheel page and the information system; the thrust levers, side-sticks, gear lever, flap and
  speed brake levers move, the sun shines in and the panels light up at night. Drag to look round (double click: ahead
  again); I puts the big PFD and engine display over the view as well.
- Checkpoints: Z (or ⚑ Checkpoint) keeps the flight as it is now; Backspace (or ⟲ Retry, or from the menu or after
  a crash) puts it back there, paused until P, as often as it takes: practise a landing until it works. The
  checkpoint stays when the flight starts again and goes with a new flight.
The physics: lift and drag from the flap setting, gear and spoilers; the thrust falls off with height and speed; the
angle of attack is protected (the wing never stalls; near it A.FLOOR gives TOGA by itself), pitch stays within
30° up / 15° down. The instruments show a PFD (speed tape with the max speed and the alpha-protection band, altitude,
vertical speed, heading, radio height, ILS diamonds for the runway ahead) and the engines, flaps, gear, spoilers and
brakes. Warnings: CONFIG at take-off, OVERSPEED, FLAP/GEAR SPEED, SINK RATE, PULL UP, TOO LOW GEAR/FLAPS, TAIL
STRIKE, OFF THE RUNWAY; with sound on, the radio height callouts and RETARD. Touchdowns are rated by their sink
rate; over 1,100 ft/min, gear up, a wing down or nose first is a crash (Enter tries again).

## The cockpit

**FCU** (top, as on the A320 glareshield, left to right):

- **EFIS:** FD, LS, ARPT, the ND mode (ARC, ROSE NAV, PLAN) and range.
- **SPD/MACH, HDG/TRK, ALT, V/S/FPA windows with their knobs:**
  - The mouse wheel turns a knob (Shift: ×10).
  - Click to **push**: managed, the FMGC flies it (a dot in the window). On V/S, push levels off.
  - Right-click to **pull**: selected, the window's value.
  - The ‹ › PUSH PULL buttons do the same.
- **Buttons:** SPD MACH, LOC, AP1, AP2, A/THR, EXPED, APPR, HDG-V/S / TRK-FPA, the 100/1000 ft switch.
- **AUTO BRK:** LO, MED, MAX.

**FMA** (above the PFD), five columns as on the real one:

- **Thrust:** SPEED / MACH, THR CLB, THR IDLE, MAN TOGA / FLX.
- **Vertical:** SRS, CLB, OP CLB, DES, OP DES, EXP CLB / DES, ALT*, ALT, V/S, FPA, G/S*, G/S.
- **Lateral:** RWY, RWY TRK, HDG, TRK, NAV, LOC*, LOC.
- **Combined:** LAND, FLARE, ROLL OUT.
- **Approach capability:** CAT 1 / CAT 3 SINGLE / DUAL.
- **Engagement:** AP1+2, 1 FD 2, A/THR.

Armed modes are shown in blue, a new mode is boxed for 10 s, and FD bars appear on the PFD.

**MCDU** (Y, or the MCDU button):

- **Pages:** INIT (FROM/TO, flight number, cruise level), F-PLN (insert a waypoint by typing an airport code or a
  town; CLR deletes), DIR (direct to), PROG, PERF (take-off / approach speeds), RAD NAV (the destination ILS).
- **Typing:** click it to type on the keyboard; Esc gives the keys back to the flying.

**Flight plan:**

- **Route:** the departure runway, a fix on the climb-out, then waypoints along the great circle named after the
  towns on the way.
- **Arrival:** a downwind and base when arriving from the far side, then the ILS to the runway the wind favours.
- **Descent:** the FMGC calls T/D and MORE DRAG.

**Keys:** U autopilot on/off (any stick input also disconnects it, with the cavalry charge), J APPR, O FCU panel,
Y MCDU, plus all of the game's flying keys (H lists them).

All aircraft except the DC-3 and Ju 52 have the autopilot. Types without autothrust (Q400, ATR) need the power set
by hand.

## The 3D flight deck and the systems

In the cockpit camera (C) the Airbuses have a 3D flight deck: the A350s and the A380 the A350's, the A320, A330
and A340 the A320 family's (six square screens: FMA + PFD, ND, the E/WD over the SD, ND, PFD; the MCDUs on the
pedestal). Drag to look round; look up and to the right for the overhead panel.

**Click the controls in 3D:**

- **Pushbuttons, EFIS, FCU buttons:** click.
- **Knobs:**
  - the mouse wheel turns them (Shift: ×10);
  - a click pushes and a right-click pulls;
  - a click on the knob's left or right edge turns it a step.
- **Switches:** a click on the upper half moves the switch up, a click on the lower half moves it down.
- **Hover:** shows what a control is.
- **Also clickable:** the gear lever, the autobrake, the parking brake, and the MCDU (it opens the MCDU).

**The overhead page** (0, or 🔆 Overhead) has the same switches for any type and camera (`src/systems.js`):

- **Exterior lights:** strobe (OFF / AUTO / ON), beacon, wing, nav & logo, runway turn-off, landing, nose. The 3D
  aircraft shows them.
- **Interior lights:** dome, flood and panel lighting light the deck. ANN LT TEST lights every annunciator.
- **Signs:** seat belts and no smoking, with the cabin chime.
- **APU:** MASTER SW, then START; about a minute to AVAIL. APU BLEED gives air for engine starts.
- **Engines:**
  - ENG MASTER OFF cuts an engine's fuel: it runs down and gives no thrust.
  - To start it again: ENG MODE IGN/START, then the master ON. It needs air from the APU's bleed, another engine,
    or 220 kt of ram air, and takes about 40 s to idle.
- **Fire:**
  - **Warning:** an engine or APU fire lights the master warning and the FIRE pushbutton, sounds the chime, and puts
    the procedure on the E/WD.
  - **Fighting it:** push the FIRE pushbutton (fuel cut, squibs armed), then AGENT 1. If it is still burning after
    30 s, AGENT 2. A bottle works best on an engine that is shut down.
  - **Left alone:** an engine left running in a fire seizes after 40 s.
- **Anti-ice, wipers and the fire TEST button.**
- **FAILURES:** start a fire or an engine failure yourself, or switch on RANDOM (off by default) for one now and
  then.

**The E/WD** shows the warnings and cautions with the actions still to do in cyan, the T.O memo on the ground, the
LDG memo under 2000 ft, and the green memos. The SD shows the ENG page when an engine is out or starting, the APU
page while the APU runs, and the WHEEL page otherwise.

## Damage and crashes

Parts break off the way they do on real aircraft, and the game's 3D view draws the aircraft without them and the
parts falling away, tumbling and lying where they land (the game's `js/livery.js` PARTS cut each model into wing tips,
outer wings, elevators and rudder, and its fuselage into the nose, the middle and the tail):

- **Overstress:** past 1.3 × the type's limit load (or −1.3 g) a wing tip tears off, past 1.5 × (its ultimate load) a
  wing breaks, past 1.9 × both. The wing going up in a rolling pull carries more and breaks first.
- **Overspeed:** past the dive speed (about VMO + 50 kt or MMO + 0.07) the airframe shakes, then flutter takes the
  elevators, then an aileron and its wing tip, and far past it the wing.
- **A wing tip lost:** the wing lifts less on that side (its share of an elliptical spread of lift) and the ailerons
  that went with it don't roll it any more: by hand it rolls towards the broken side and takes the stick held over,
  more as it slows (the lift moves outboard); fly-by-wire holds it by itself as long as its ailerons can.
- **A wing lost:** more roll than the ailerons can hold: it rolls over and goes out of control (OUT OF CONTROL), a
  corkscrewing dive the controls can't stop; a four-engined type loses that wing's outer engine.
- **Elevator jammed:** the stick does nothing to the pitch; the stabiliser trim (Home / End) still does, slowly, and
  so does thrust (the engines under the wing push the nose up as they spool up). An Airbus drops to direct law.
- **Elevators broken off:** no pitch control at all except thrust, and the nose wanders: as the crews of United 232
  and DHL's A300 over Baghdad flew theirs.
- **Rudder broken off:** the rudder pedals do nothing in the air.
- **Wing strike:** a wing that touches the ground, in the air or landing, breaks with the same failures: past the
  bank its tip clears (about 10° for an A320) the tip tears off; a few degrees more and the engine pod under that wing
  strikes, which fails the engine and often sets it on fire (the overhead's FIRE drill: `src/systems.js`); deeper the
  outer wing breaks off and its tank catches fire; dug in up to its middle it cartwheels. The ground drags the wing
  back (it yaws towards it and slows) and pushes it up (the bank comes off), so a light strike can be flown away.
- **The crash,** by how hard it hits:
  - a belly landing, a gear collapse or a slow one: the gear folds and the wreck slides on its belly and slews
    round; it burns only if a wing (its fuel) was torn open.
  - hit hard (over about 1,400 ft/min) or slid off fast: the fuselage breaks ahead of the wing and/or behind it. The
    nose slides on furthest, the tail stops behind and turns across, the middle with the wings in between; a
    fireball where it hit, then the fuel burns round the middle where it stops, black smoke rising, and it chars.
  - flown into the ground fast or steep (over about 6,000 ft/min, or 155 kt into a hillside): it goes up in a
    fireball as big as its fuel, rising as it burns; the charred tail, nose and wings are thrown on along its
    track (only small bits at cruise speeds), and a fire burns there for minutes.

To practise, the Esc menu has **Failures**: a wing tip (left or right), the elevator jamming, the elevators or the
rudder breaking off, the left wing breaking. Checkpoints (Z) keep the damage too.

## Files

| File | What it is |
|---|---|
| `index.html` | Generated from `flightgame/index.html` by `tools/build_index.py`: run it after every submodule update. |
| `src/pilot.js` | The flying: physics (with the wind), PFD, ECAM, the A350's screens, checkpoints. It came from the game's old `js/pilot.js` and now lives only here. |
| `src/select.js` | The start screen (`FG.flySelect`): gallery, airport search and map, start, livery, time, wind. |
| `src/cockpit3d.js` | The 3D flight decks, A350 and A320 family (`FG.cockpit3d`, drawn by the game's view3d.js in the cockpit camera); its panels are clicked in 3D. |
| `src/systems.js` | Lights, signs, APU, engine masters, fire and extinguishers, the E/WD's memo, the overhead page (`FG.systems`). |
| `src/fmgc.js` | Autopilot, flight directors, autothrust modes, flight plan, autoland, autobrake; draws the FMA, FD bars and ND. |
| `src/fcu.js` | The glareshield panel. |
| `src/mcdu.js` | The MCDU. |
| `src/boot.js` | Starts the game's world without its interface, reads the link and opens the start screen. |
| `src/guard.js` | Keeps the game from writing its save from here. |
| `css/fly.css` | Styles for the panels; hides the game's interface. |

## Testing

    node test/smoke.mjs                        # the page, the start screen, the wind, every type (about 3 min)
    node test/systems.mjs                      # the A320 deck: real clicks, an engine fire fought, a relight (SHOTS=dir: screenshots)
    python test/run.py [FROM TO [TYPE]]        # e.g. python test/run.py LHR DUB B747-400

This flies a whole flight headless in Chrome (no 3D, flat ground) as fast as the CPU allows:

- **Take-off:** the test's pilot flies the take-off, flaps and gear.
- **Climb and cruise:** AP1 from 150 ft, NAV, managed climb, level-off.
- **Descent and approach:** DES, APPR, G/S from below or above, LAND, FLARE.
- **Landing:** RETARD, ROLL OUT and the autobrake.

It fails on a crash, a firm touchdown (< −300 ft/min), a bounce, leaving the runway, more than 3 NM off the route
or bank over 31°. A flight takes a few seconds (JFK–LAX about 20 s).

Last run: A320 on ZRH–GVA, GVA–ZRH, FRA–MUC, CDG–LHR, LHR–DUB, MAD–BCN and JFK–LAX, and the A350-900/-1000,
737-800, 747-400, Concorde, Q400 and ATR 72 on ZRH–GVA. Every flight passed, touching down at −125 to −238 ft/min
within 11 m of the centre line.

`FG.fmgc.tune` holds the conventional-law pitch gains; set `TUNE='{"flareKp":0.7}'` and `FLARE=1` to tune and log
the flare.
