# Studio learnings — taste memory

Append after every film (newest first). Short, specific, reusable. This is how the studio gets better
over time: read it at the start of every new film.

Format: `- YYYY-MM-DD · <project> · <what worked / what failed> → <rule for next time>`

## Rules distilled
<!-- Promote recurring learnings here, then into studio/motion-rules.md when they're universal. -->
- VO-led films: generate VO first, then cut on measured phrase onsets (`vo.json → phrases`). Script ~2.3 words/s for an energetic announcer; 7 lines ≈ 26s of speech fills a 30s film.
- Never toggle a child's `visibility` to `visible` inside a scene expecting the parent to hide it — the runtime now uses `display:none` for inactive scenes for exactly this reason.
- Product walkthrough showreels: give every shot a different technique (slam, grid wipe, cube turn, match cut, zoom-through, whip pan, color flood, split screen, 3D exploded layers, implode-to-logo) but keep one motif (here the 3x3 sticker grid) to tie them together.

## Log
- 2026-10-11 · arena-showreel · 30s Arena walkthrough-showreel, Fish VO "Energetic Male". Worked: wordmark → app-header match cut; timer states as the palette; stream kit as exploded 3D layers labelled with real overlay names. Failed first pass: scene leak (fixed in runtime), stream-kit layers flew past camera at 125px/layer → 85px/layer with −420px pull-back. → Rebuild non-public UI from the product's React source (classes + copy), not from guesses.
- 2026-10-11 · tooling · Git Bash rewrites a leading "/" CLI arg into "C:/Program Files/Git/" → capture.mjs now un-mangles; in general pass page paths without the leading slash or set MSYS_NO_PATHCONV=1.
- 2026-10-11 · _demo · Pipeline smoke test (runtime → stills → score → render). → Always run `npm run stills -- <p> --scenes` before the first full render; it catches font-loading and layout issues in seconds.
