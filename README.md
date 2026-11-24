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

To send the game's ✈ Fly button to a local copy, run this once in the game's page console:
`localStorage.setItem('flightgame.flyUrl', 'http://localhost:8000/')` (`'here'` keeps the old in-game dialog).

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

## Files

| File | What it is |
|---|---|
| `index.html` | Generated from `flightgame/index.html` by `tools/build_index.py`: run it after every submodule update. |
| `src/pilot.js` | The flying (physics, PFD, ECAM), copied from the game's `js/pilot.js` with the FMGC hooks. |
| `src/fmgc.js` | Autopilot, flight directors, autothrust modes, flight plan, autoland, autobrake; draws the FMA, FD bars and ND. |
| `src/fcu.js` | The glareshield panel. |
| `src/mcdu.js` | The MCDU. |
| `src/boot.js` | Starts the game's world without its interface, reads the link and opens the dialog. |
| `src/guard.js` | Keeps the game from writing its save from here. |
| `css/fly.css` | Styles for the panels; hides the game's interface. |

## Testing

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
