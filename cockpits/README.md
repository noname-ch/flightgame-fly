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
