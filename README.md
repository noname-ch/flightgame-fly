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

- **Aircraft** from a gallery of all twenty-one, pictured in the livery you chose. Filter by Airbus, Boeing, Propellers,
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
- **Scenery → 🗺 Prepare an area…**: click two corners on a map (or 20, 40 or 80 km round the airport), pick the
  detail (good, sharp or very sharp; airports in it always get the sharpest pictures) and Prepare. Its satellite
  pictures and heights are kept in the browser (the game's `js/scenery.js`), so that ground is sharp and there at
  once when you fly over it, even offline. Prepared areas are listed there, with Show and delete.

The last choices are kept for next time (localStorage `flightgame.fly.pick`). The link from the game
(`?type=&from=&rw=&mode=&plane=`) presets them.

## On a phone or tablet

On a touch screen the flight gets touch controls by themselves (src/touch.js); turn the phone sideways.

- **Thrust lever** on the left edge: drag it; it clicks into IDLE, CL, FLX/MCT and TOGA. **REV** beside it on the
  ground (types with reversers).
- **Stick** on the right: put a thumb down anywhere there and move it (down = nose up, as a real stick; let go and
  it centres). Or **📱 Tilt**: steer by turning the phone like a wheel and tipping its top edge towards you (nose up)
  or away; **⊙** makes the way you hold it now the middle.
- **GEAR, FLAPS ▼ / ▲, SPD BRK, BRAKES** (hold) beside the lever, each showing where it is.
- Top: **PFD** (which instruments: PFD · PFD + ND · all · none), ⏸ pause, 🎥 camera, **AP** (autopilot), ⚑ checkpoint,
  ⟲ retry, **⋯** more (autothrust, speed ± and managed, trim, APPR, FCU, MCDU, overhead, limiter, parking brake, arm
  spoilers, which way the stick pitches, full screen, touch controls off) and ☰ the menu.
- One finger on the rest of the screen turns the camera round the plane (in a cockpit: the head). Outside the
  cockpit the plane sits higher on the screen, above the instruments.
- The menu's **📱 Touch controls** turns them on or off (kept in localStorage `flightgame.fly.touch`); a touch
  screen on a desktop gets them at its first touch.

## Flying by hand

Twenty-one aircraft, each flying in its own way:
- **A350-900, A350-1000, A320, A330-200, A330-300, A330-900neo, A340-300, A340-600, A380-800, Global 7500**: fly-by-wire with full
  protections (below; the Global's is Bombardier's "normal mode"). The A320 is light and nimble, the A350-1000
  heavy, with a tail that strikes at under 10°. The short A330-200 climbs better than the -300 and clears its tail
  to 12°; the A330-900neo's longer wing lands slower. The A340-300's four small CFM56s spool up slowly and climb the
  slowest of all; the 75 m A340-600 strikes its tail past 9°; the 560 t A380 rolls slowly and only its inner engines
  reverse. The Global 7500 is a light business jet with plenty of thrust: quick to roll, Mach 0.90.
- **Boeing 737-800, 747-400, 777-300ER, 787-8, 787-9, 787-10**: conventional controls, as a real aircraft. The stick moves the elevator;
  let go and it springs back to where the aircraft is trimmed. Hold it and the trim follows within a couple of
  seconds (you trim the force away), or trim yourself with Home / End (U / J). Trimmed, the aircraft is speed
  stable: it goes back to its trimmed speed by itself, nose rising and falling in the slow, lightly damped swing
  every aircraft has (the phugoid: about a minute a cycle, a quarter smaller each time), so more thrust makes it
  climb and less makes it sink. No protections on the 737 and the 747: they stall (stick shaker first), and there's
  no g limit: past 1.5 × the limit load (3.75 g) the wings fail; far past the dive speed it breaks up. The stall
  is physics, not a script: past the critical angle of attack each wing's flow breaks away on its own, the airframe
  shakes, and the lift that is left can't carry the weight. The path bends down while the nose stays where the
  elevator holds it, so the angle of attack grows on: with the stick held back it falls out of the sky, stalled,
  at 10,000 ft/min or more, the nose sinking through the horizon. The wing that stalls first (each airframe's wings
  differ a little) drops: it rolls, and the rolling keeps that wing stalled and unstalls the other, so it goes on
  rolling until both are stalled or you stop it (rudder; aileron hardly answers on a stalled wing, and pushes that
  wing deeper into the stall). Holding the stick back trims the force away only up to the stick shaker, so let go
  (or push) and the tail brings the nose and the angle of attack down: once 2° under the stall the flow comes back,
  and the speed you gained pulls it out of the dive. Trimmed into the stall with the switches it stays there hands
  off. Far past the stall the wing is an air brake: it sinks steeply at a low speed. The bank holds where you leave it. The 747 has
  four slow engines and a lot of mass: slow to pitch, to roll and to speed up. The 777 flies the same way (its
  fly-by-wire feels conventional) with soft protections you can pull through: it won't trim into the stall and lets
  the nose down there unless you hold the stick back, banks past 35° roll back to 30°, it pitches up past VMO.
  Its tail strikes past 8.5°. The 787 Dreamliners fly as the 777 (the same soft protections) on a long, slippery
  carbon wing: they slow down reluctantly, so plan the descent early. The -8 is the lightest and quickest to roll;
  the -9 strikes its tail past 10°, the 68 m -10 past 8.5°.
- **Concorde**: no flaps: the delta wing lands at about 13-15° nose up and 160 kt, with a lot of drag. It has no
  stall break: past 20° the vortices over the wing go on lifting, less and less, while the drag grows until it sinks
  like a brick (stick shaker at 17°); its high-incidence protection keeps it under 20° (limiter). Reheat at the
  take-off detent (4) for the take-off and through Mach 1, then Mach 2 at 50,000 ft. Hands off after take-off with
  reheat it pitches up and swings, as the real one would: fly the attitude and take the reheat out. No spoilers.
  Each engine running at full thrust with the reheat lit shows its flame out of the nozzle, shock diamonds and all.
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
overstressed. The Global's T-tail can then sink into a deep stall: past about 8° beyond the stall the wing's wake
blankets the tail, the elevator hardly answers and the wing and fuselage pitch it further up, so it locks in about
20° past the stall, nose near level; it comes down at 10,000 ft/min or more, and only the stick held full forward
(with power) gets it out, slowly. The 777 and Concorde lose their protections; the 737, 747,
turboprops and classics have none to lose. The choice is kept for the next flight.

The dialog says how each one flies and marks the runways too short for it. Thrust detents, flaps, speed limits,
crash limits (sink rate, bank, tyre speed) are each type's own. It flies in real time whatever the game speed and earns nothing: it's for flying. While
you fly, the keyboard is the plane's (the game's keys come back when you leave):
- ↑ ↓ (W S): stick, nose down / up. In an Airbus (normal law) it asks for a pitch rate; let go and it holds the
  flight path (the others: see above). ← → (A D): roll; let go and the bank stays where it is. There is no bank limit: it rolls all the way round if you roll it, and a steep turn costs g (holding the height takes 1/cos(bank) g: 2 g at 60°, 2.5 g at 66°). The Airbuses hold up to 2.5 g and sink steeper than that; with the limiter off (L) and on the conventional types you can pull past the wings' strength. On the ground they steer, Q E = rudder.
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
  speed brake levers move, the sun shines in and the panels light up at night. Its FCU, EFIS panels and MCDUs are the
  A320's real 3D ones (below), and the information systems beside each pilot have a MAP page with its own settings.
  Drag to look round (double click: ahead again); I puts the big PFD and engine display over the view as well.
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

- **EFIS** (the captain's on the left, the first officer's on the right, each for its own ND): FD, LS, CSTR, WPT,
  VOR.D, NDB, ARPT, the ND mode (ARC, ROSE NAV, PLAN) and range; − past 10 NM goes to ZOOM, the airport map.
- **SPD/MACH, HDG/TRK, ALT, V/S/FPA windows with their knobs:**
  - The mouse wheel turns a knob (Shift: ×10).
  - Click to **push**: managed, the FMGC flies it (a dot in the window). On V/S, push levels off.
  - Right-click to **pull**: selected, the window's value.
  - The ‹ › PUSH PULL buttons do the same.
  - In the 3D flight deck the FCU's own windows show the numbers too (the A320s, A330s and A340s: in seven-segment
    digits where FlightGear puts its text; dashes and the managed dots as the real FCU has them; dark without power,
    8s for ANN LT TEST, dimmed by the FCU's display brightness knob).
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

In the cockpit camera (C) the Airbuses have a 3D flight deck: the A350s and the A380 the A350's, built here; the
A320s, A330s and A340s FlightGear's real A320-family flight deck (`cockpits/A320-family.fgck`, GPLv2, see
`cockpits/README.md`; the same pack the Rust app uses), read and played by `src/fgdeck.js`: its switches, knobs,
guards, levers and lights move as the aircraft's systems have them, and a click on one works the systems (a click
that does nothing on a control goes on to the one behind it: a guarded pushbutton's guard). The game's instruments
are drawn on its six screens and its standby instrument. Until the pack has come (7 MB), or with `?built` in the
address, they fly with the deck built here from the panel modules (six square screens: FMA + PFD, ND, the E/WD over
the SD, ND, PFD; the MCDUs on the pedestal). Drag to look round; look up and to the right for the overhead panel.

The A350s and the A380 keep their own deck, with the A320's real 3D modules from that pack in it (`graft` in
`src/cockpit3d.js`): the FCU in the middle of the glareshield (its knobs, buttons and number windows), an EFIS panel
before each pilot (the ND's MODE, RANGE, CSTR · WPT · VOR.D · NDB · ARPT, LS, FD, the VOR/ADF needles), and the
two MCDUs on the front of the pedestal, where the A350 has its keyboards: their screens show the MCDU's pages and
their keys type into it (a click on the screen opens the big MCDU, Y, to type on the keyboard). MASTER WARN and CAUT
stay the A350's. The information system (OIS) beside each pilot has tabs along its bottom: MAP is the A320's
navigation map (the airport map under 10 NM) with its own settings beside it, apart from the pilot's ND (RANGE − / +,
ARC · ROSE · PLAN, AIRPORT, CSTR · WPT · VOR.D · NDB · ARPT, TERR, and = ND to take the ND's); T.O PERF, LDG PERF and
CHECKLIST are the flight's papers. Until the pack has come, or with `?built`, the A350's painted FCU, EFIS and
keyboards stand in.

Each version keeps its own on the screens and on the overhead (0) and pedestal (9) pages (`src/panels.js` LAYOUTS;
the built deck has them in 3D too):

| Deck | Types | What it has of its own |
|---|---|---|
| `a330` | A330-200, A330-300 | The enhanced A330: LCD screens and the ISIS. |
| `a330neo` | A330-900neo | Its EIS2: the trackball (CURSOR CTL) on the pedestal (9) with OANS, the airport map on both NDs whatever their RANGE knobs say (0.5 to 5 NM; the map ZOOM shows). |
| `a340` | A340-300 | CRT screens and the three round standby instruments (horizon, airspeed, altimeter). |
| `a346` | A340-600 | LCDs, the ISIS and the TAXI CAMERA button on the pedestal (9): the fin camera's and the nose-gear camera's picture on the SD on the ground, with the main gear's and the nose wheel's guides over the taxiway (75 m long: the main gear runs 33 m behind you). |

Their overhead HYD and FUEL panels are their own:

- **HYD (no PTU):** an engine-driven pump per system and engine, and an electric pump and the RAT on green.
  - A330: green and blue on engine 1, green and yellow on engine 2.
  - A340: green on engines 1 and 4, blue on 2, yellow on 3.
- **FUEL:** a trim tank in the tail, whose fuel goes forward in the cruise (T TK FEED: AUTO, or ISOL to keep it).
  - A330: a standby pump in each wing.
  - A340: a feed tank per engine, with a main and a standby pump and its own X FEED valve. Open two valves and one
    engine's pumps feed the other.

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
LDG memo under 2000 ft, and the green memos.

**The SD** picks its page by itself (ENG when an engine is out or starting, APU while it runs, the system a failure
is in, DOOR before the start, CRUISE in the cruise, WHEEL otherwise). The ECAM control panel on the pedestal picks
one by hand: ENG, BLEED, PRESS, ELEC, HYD, FUEL, APU, COND, DOOR, WHEEL, F/CTL, CRUISE, ALL (each in turn), STS
(limitations, what's inoperative). CLR clears the cautions shown, RCL brings them back, EMER CANC silences, T.O
CONFIG tests the take-off configuration.

**The rest of the overhead** (`src/aircraft.js`):

- **ELEC:** batteries, a generator per engine, APU GEN, EXT PWR (parked), BUS TIE, GALY & CAB; EMER ELEC GEN 1 LINE
  and RAT MAN ON. No generator at all: the RAT drops (over 100 kt), only the captain's PFD and ND, the E/WD and MCDU 1
  stay alive, the autopilot is lost, ALTN LAW. On the batteries alone about 30 minutes.
- **HYD:** an engine pump per engine (green, blue, yellow), the blue electric pump, the PTU, the yellow electric pump.
  Green raises the gear (it falls down by gravity without), green and yellow move the flaps (half speed on one,
  stuck on none), yellow steers the nose wheel, the brakes go from normal to alternate to the accumulator. Two
  systems lost: ALTN LAW.
- **FUEL:** two pumps in each wing and in the centre (MODE SEL AUTO), X FEED. Loaded for the trip and 45 minutes.
  Above FL150 a wing with its pumps off can't feed its engines (gravity only lower down): they flame out. The weight
  comes off as it burns; an imbalance and a low level are cautions. A torn wing tank empties.
- **AIR COND · CAB PRESS:** ENG BLEED, APU BLEED, PACK 1 and 2, MODE SEL (MAN with the MAN V/S switch), DITCHING.
  No packs or no bleed air: the cabin climbs; CAB PR EXCESS CAB ALT over 9550 ft, the masks drop at 14,000 ft.
  OXYGEN CREW SUPPLY off up there: the crew gets hypoxic (the picture darkens). MASK MAN ON drops the masks.
- **ANTI ICE:** in cloud between +2 and −30 °C ice grows on a wing without WING ANTI ICE (drag, an earlier stall)
  and on engines without ENG ANTI ICE (less thrust). PROBE/WINDOW HEAT; ICE IND shows ICE on the SD.
- **ADIRS:** IR 1-3 OFF / NAV / ATT and the ADR pushbuttons. An IR off is lost: its pilot's PFD shows ATT, the ND
  MAP NOT AVAIL. On the ground NAV aligns it again (two minutes here); in flight only ATT works. The ATT HDG and AIR
  DATA switches on the pedestal give a pilot the third IR or ADR. Two lost: ALTN LAW, no autopilot.
- **GPWS:** SYS, TERR (the ground along the flight path a minute ahead: TERRAIN AHEAD, PULL UP), G/S MODE (GLIDE
  SLOPE), FLAP MODE, LDG FLAP 3.
- **EVAC** (the horn), **CALLS** MECH and ALL, **RCDR GND CTL**, **EMER EXIT LT**, **ICE IND & STBY COMPASS**.

**The pedestal** (also as a page: 9):

- **RMP 1 and 2:** VHF 1, 2 or 3; the knob tunes the standby frequency (the wheel 25 kHz, Shift 1 MHz), ⇄ swaps it
  in. On an airport's real ATIS frequency (OurAirports) the ATIS is read out with the game's weather there: runway in
  use, wind, visibility, cloud, temperature, QNH, the letter changing each hour. On its TOWER you're cleared for
  take-off and to land; on APPROACH or DEPARTURE you get your climb or the ILS. Spoken with the sound on (M), always
  written at the top. Each flight starts on the tower and the ATIS.
- **ATC / TCAS:** the squawk (click a digit, or the wheel on it; 7500, 7600, 7700), STBY / AUTO / ON, IDENT, ALT;
  TCAS STBY / TA / TA/RA and the traffic shown (THRT, ALL, ABV, BLW). TCAS sees the game's own aircraft in the air
  round you: TRAFFIC on the ND, "traffic, traffic", and with TA/RA a CLIMB or DESCEND.
- **ECAM control panel, the ATT HDG and AIR DATA switching, the displays' brightness** (UPPER and LOWER DISPLAY), the
  ENG masters and MODE, the MCDUs (the A350's keyboards open them too), PARK BRK.

**The main panel:** each pilot's PFD and ND brightness and TERR ON ND (the terrain on that pilot's ND: red over
2000 ft above, amber up to 500 ft below, green to 2000 ft below; never on PLAN or the airport map; the captain's is on
at the start, the first officer's off), the CLOCK with UTC and its CHR chronometer, the A/SKID & N/W STRG
switch (off: no nose wheel steering and no anti-skid; braking hard at speed bursts the tyres), AUTO BRK.

**The EFIS panels:** one before each pilot, each setting that pilot's own ND, as in the real aircraft. FD and LS; one
of CSTR (the flight plan's altitudes), WPT (the towns the MCDU knows), VOR.D, NDB (the beacons) or ARPT (the airports
round about) on the ND; the ADF / VOR needles 1 and 2 (VORs tuned by themselves, or on RAD NAV); MODE with its five
positions (ROSE LS, ROSE VOR, ROSE NAV, ARC, PLAN; the ND draws ROSE LS and ROSE VOR as ROSE NAV) and RANGE. On
FlightGear's A320-family deck (the A320s, A330s and A340s) each side's EFIS knobs, VOR/ADF switches and option buttons
do the same, and their lights follow.

**The airport map (ZOOM):** RANGE turned left past 10 NM goes to ZOOM, and the ND becomes the airport map (as
Airbus's OANS) at 5, 2, 1, 0.5 or 0.2 NM (the knob keeps turning; back right past 5 NM is 10 NM again, and ZOOM next
time opens at the range it had last). It draws the airport you are at or near (within 8 km) from its real layout on
black: aprons and taxiways in greys with yellow centre lines, runways dark with white edges, threshold bars, piano
keys and dashed centre lines and their names boxed at the ends, terminals blue with a light outline, hangars and other
buildings darker; at 1 NM and less the stands' yellow lead-in lines and stop bars, at 0.5 NM and less their names;
you in yellow, at your real size close in. Heading up in ARC and ROSE, north up in PLAN (src/oans.js; the same as the
Rust app's).

**The MCDU** also has DATA (position and IRS monitors, A/C status, look up a waypoint or navaid), FUEL PRED (fuel at
the destination, extra), SEC F-PLN (copy, activate, delete), ATC COMM (an airport's ATIS by datalink), MCDU MENU
(AIDS engine report, CFDS fault list), PERF to fill in (V1, VR and V2 with their callouts, FLEX temperature for less
take-off thrust, QNH, BARO and RADIO minimums with "minimum", LDG CONF 3) and RAD NAV (VOR and ADF by ident).

### Modules: putting panels into other aircraft

Every panel is a module in `src/panels.js` (`MODULES`): its picture and its controls, drawn from its own corner. A
deck's `LAYOUTS` say where its modules sit on each surface:

    LAYOUTS.a320.pedestal = [['mcdu', 10, 22, { i: 0 }], ['rmp', 8, 410, { i: 0 }], ['xpdr', 14, 880], ...]

To give a deck another module add a line; to move it change its x and y (pixels of that surface: the glareshield
2560 × 128, the main panel 1024 × 256, the pedestal 512 × 1024 with the front at the top, the overhead 1024 × 1004
with aft at the top). `deckOf(type)` says which deck a type flies with. A module works wherever it is put.

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
- **Fuel fires:** a wing that breaks off tears its tanks open (nearly always; a wing tip, which holds little fuel,
  sometimes): the fuel streams out of the stump and burns, a trail of fire and black smoke behind the aircraft for a
  minute or two, and the part that came off burns as it falls and where it lands. A wing dragged along the ground at
  speed can wear through into its tank the same way. A fire in a wing that is still on burns through it in half a
  minute to a minute and it breaks off.
- **The crash** is worked out each time from what happened: the sink rate against what the gear takes, the speed
  along the ground (the more it was sinking, the more the belly and engines dig in), runway, grass or a hillside,
  nose down, a wing down or dug in. That gives how hard it hit, and each part fails at its own strength with some
  chance in it, so no two crashes end the same: the fuselage behind the wing, then ahead of it; the wing tips, the
  outer wings (the low one first), the elevators, the rudder; at the hardest it all comes apart in a fireball and only
  the tail and fragments are left. A gentle gear-up landing slides on whole.
  - Every part keeps the aircraft's momentum less what the impact took (about the sink rate again), is thrown up and
    aside and spins the harder it hit, then flies, bounces and skids to a stop on its own; off the runway the ground
    grips twice as hard. Fast crashes leave a long trail of wreckage, slow ones a short one.
  - The impact throws out a shower of fragments, from a few to hundreds, in the livery's colours, bare metal and soot,
    each with its own momentum (the game's `js/view3d.js` updateDebris).
  - The fuel goes up in a fireball as big as the fuel and the impact, rising as it burns, and goes on burning with
    black smoke where the wreck stops; the wreck chars. The fireball keeps a little of the speed along the ground: it
    rolls on the way the aircraft was going, the faster, the further.
  - Sliding on its belly, the tanks under the wing roots tear open (the harder it hit, the likelier; always with a wing
    torn off): the wreck drags a trail of burning fuel behind it until it stops. After a crash the view goes to the chase camera.

To practise, the Esc menu has **Failures**: a wing tip (left or right), the elevator jamming, the elevators or the
rudder breaking off, the left wing breaking. Checkpoints (Z) keep the damage too.

## Sounds

With the game's sound on (M), the flight deck sounds as each aircraft's does (`src/cocksnd.js`):

- **The GPWS** (as Honeywell's EGPWS): mode 1 sinking too fast for the height (SINK RATE, then PULL UP), mode 2 the
  ground coming up too fast (TERRAIN TERRAIN, then PULL UP), mode 3 height lost after take-off (DON'T SINK), mode 4 too
  low not set up to land (TOO LOW GEAR / FLAPS, TOO LOW TERRAIN when fast), mode 5 GLIDE SLOPE, mode 6 BANK ANGLE past
  35°, the terrain ahead (TERRAIN AHEAD, PULL UP). PULL UP, TERRAIN, BANK ANGLE, SINK RATE, TOO LOW GEAR / FLAPS /
  TERRAIN and STALL are **real recordings** of warning computers (a Twin Otter's from its intercom, and others); a
  Boeing, a turboprop and Concorde whoop twice before PULL UP. The DC-3 and the Ju 52 have no warning computer.
- **Each family's own callouts:** the radio heights, V1 / rotate, minimum(s), retard, in its own voice and words
  (Airbus "twenty five hundred", "retard, retard"; Boeing "two thousand five hundred", "minimums"; the turboprops and
  the Global; Concorde through an older speaker): `sounds/voice/<family>/` from `tools/build_voices.py`.
- **The warning tones:** Airbus: the continuous repetitive chime, the stall cricket, the cavalry charge, its real cabin
  chime. Boeing, turboprops, Concorde: the fire bell, the overspeed clacker, the stick shaker, the autopilot wailer,
  the take-off config horn, the master warning beeper (Concorde a gong).
- **Inside the aircraft, recorded in real ones:** idle, take-off power and cruise in an A320, an A330, an A350, a 737,
  a 747, a 777 and a Dash 8's cockpit (the ATR too), radial engines for the DC-3 and the Ju 52, mixed by the engines'
  power and the speed; the A350's flaps running and gear coming down, a small aircraft's flaps and gear, a 737's
  touchdown, the APU on the ground.
- **Damage:** real metal creaking when overstressed, girders and aluminium tearing as a wing, a tip, the elevators or
  the rudder come off, metal scraping along the ground, the fire burning; the impact and the fireball (made up for now).
- Made up as it plays: the air rushing past outside, the flaps' and gear's air, buffet, the runway under the wheels.

The real recordings are CC0 or CC BY from Freesound and Wikimedia Commons, cut by `tools/build_real_sounds.py` into
`sounds/real/` where nobody talks; `sounds/real/CREDITS.md` names every one.

## Files

| File | What it is |
|---|---|
| `index.html` | Generated from `flightgame/index.html` by `tools/build_index.py`: run it after every submodule update. |
| `src/pilot.js` | The flying: physics (with the wind), PFD, ECAM, the A350's screens, checkpoints. It came from the game's old `js/pilot.js` and now lives only here. |
| `src/cocksnd.js` | The flight deck's sounds (`FG.cocksnd`): the GPWS and each family's callouts and tones, the recorded insides, motors, breaking parts, crashes. |
| `src/select.js` | The start screen (`FG.flySelect`): gallery, airport search and map, start, livery, time, wind. |
| `src/cockpit3d.js` | The 3D flight decks: the A350's built here, FlightGear's for the A320 family (`FG.cockpit3d`, drawn by the game's view3d.js in the cockpit camera); their controls are clicked in 3D. |
| `src/fgdeck.js` | FlightGear's A320-family flight deck (`cockpits/A320-family.fgck`): the pack read, its rules, animations and controls played. |
| `src/systems.js` | Lights, signs, APU, engine masters, fire and extinguishers, the E/WD's memo (`FG.systems`); other systems plug in. |
| `src/aircraft.js` | Electrics, hydraulics, fuel, air and pressure, ice, ADIRS, GPWS, the small panels, the SD's pages. |
| `src/radio.js` | Radios (RMP), ATIS and ATC calls, VOR/ADF receivers, transponder and TCAS (`FG.radio`). |
| `src/panels.js` | The panels as modules and the decks' layouts (`FG.panels`); the 2D pages 0 and 9. |
| `src/data/navdata.js` | VORs, DMEs, NDBs and airport frequencies from OurAirports (public domain): `tools/build_navdata.py`. |
| `src/fmgc.js` | Autopilot, flight directors, autothrust modes, flight plan, autoland, autobrake; draws the FMA, FD bars and ND. |
| `src/fcu.js` | The glareshield panel. |
| `src/mcdu.js` | The MCDU. |
| `src/boot.js` | Starts the game's world without its interface, reads the link and opens the start screen. |
| `src/guard.js` | Keeps the game from writing its save from here. |
| `css/fly.css` | Styles for the panels; hides the game's interface. |

## Testing

    node test/smoke.mjs                        # the page, the start screen, the wind, every type (about 3 min)
    node test/systems.mjs                      # the A320's FlightGear deck: real clicks, an engine fire fought, a relight (SHOTS=dir: screenshots)
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
