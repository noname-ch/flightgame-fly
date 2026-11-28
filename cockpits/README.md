# The A320 family's flight deck

`A320-family.fgck` is the real 3D flight deck of FlightGear's Airbus A320 family
([legoboyvdlp/A320-family](https://github.com/legoboyvdlp/A320-family), commit 26555de), packed by the Rust app's
`--pack-cockpits` step ([lianhirter-arch/flightgame-rust](https://github.com/lianhirter-arch/flightgame-rust),
`src/fgcockpit.rs`, `src/fgdeck.rs`; the same file as its `cockpits/A320-family.fgck`). It holds the flight deck's
geometry within 6 m of the captain's eye, its textures, and its moving parts and controls (the flight deck XML's
animations and picks, the JSBSim rules that move its levers and light its buttons).

It stays under its own licence, the GNU General Public License version 2. Its authors: Josh Davidson, Jonathan
Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran (see the repository for all of them and the
licence's full text).

`src/fgdeck.js` reads it and plays its controls; `src/cockpit3d.js` draws it for the A320s, A330s and A340s.

# The A350's walls, roof, floor, seats and consoles

`A350-shell.bin` is based on "Airbus Cockpit Interior"
(https://sketchfab.com/3d-models/airbus-cockpit-interior-06ca045e131b4cfdac76ddbd55ed3b4a) by davidolaleye1
(https://sketchfab.com/davidolaleye1), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
Changed: only its walls, window frames, floor, roof, seats (the first officer's is the captain's, mirrored), side
consoles and door are kept, scaled and placed in the A350 deck's frame and painted in plain colours (none of its
textures); its window glass, glareshield plate, buttons, screens, pedestal, side-sticks and roof switches are left out.
`tools/build_a350_shell.py` makes it from the model's glTF download; `src/cockpit3d.js` draws it for the A350s and the
A380.
