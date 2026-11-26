# Notes for Claude sessions

Flightgame · Fly: fly it yourself, the game as the flightgame/ submodule. See README.md for the layout and
tests. After changing src/, rerun tools/build_index.py so index.html gets new ?v= tags.

## Status page (flightgame-hub)

https://noname-ch.github.io/flightgame-hub/ lists which app (web game, Fly, Rust app) has which feature, and every
aircraft by category. Its data is `board.json` in noname-ch/flightgame-hub (clone it next to this repo as
`flightgame-hub`). Read its CLAUDE.md once. In short:
- At the start of a session, check what people asked for on the page: `../flightgame-hub/tools/board.py requests`
  (GitHub issues labelled `request`; each names a feature and an app). Take the ones for this repo when the user
  agrees, and close them when done.
- When you start a feature here, set its cell to `doing`; when it is pushed, `done`
  (`tools/board.py set "<row>" <web|fly|rust> <state>`, then commit and push the hub). Add a row if there is none.
- The page is public: plain feature names only, no hashes, paths or private details.
