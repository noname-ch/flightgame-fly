// Loaded right after the game's js/game.js. On GitHub Pages this site and Flightgame share one origin, so one
// localStorage: the game's save is read here (your airline, its liveries, the plane you take over) but never
// written. Without this the game running behind the cockpit would autosave over your airline.
(function () {
  'use strict';
  FG.game.save = function () { return false; };
})();
