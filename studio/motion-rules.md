# Motion Studio Rules

These rules are the harness. The prompt is 10% of the outcome; this file is the other 90%.
They apply to every film unless the brief explicitly overrides a rule (and says why).

## 1. Render contract — every frame is a pure function of time
- One composition = `projects/<slug>/index.html` using `/engine/runtime.js` (+ `/engine/kit.js`). Zero other dependencies unless the brief chooses another route.
- `M.comp({ duration, fps, formats })` is called once, first. Default **60fps**, H.264, yuv420p.
- All motion is driven by `t` through `M.scene` / `M.on` / `M.tw` / `M.keys` / `K.*`. **Banned:** `Date.now`, `performance.now`, `setTimeout`/`setInterval` for animation, rAF deltas, `Math.random()` (use `M.rand(seed)`), CSS transitions. CSS `@keyframes`/WAAPI are allowed only because the runtime pins `currentTime` to `t` — prefer JS.
- **Stateless frames:** frames are seeked in any order (parallel workers, scrubbing, the cue sweep). Every property a function animates must be set on every frame it runs — never rely on a value left behind by an earlier/later frame. If `textOut` sets blur, `textIn` must set `blur: 0`.
- Assets load before frame 0: images in the DOM, `M.wait(promise)` for anything async, fonts with `display=block`. A frame must never render with a fallback font or a missing image.
- `<video>` inside a comp goes through `M.video(el, start)` so it is frame-seeked, never played.
- Layout in units of `--u` (1px at 1080p) so formats scale; check every format in `formats` before delivery.
- Never ship without looking: `npm run stills` before `npm run render`, and read the contact sheet.
- Renders go to `projects/<slug>/out/`. Never overwrite a delivered file — version it (`-v2`).

## 2. The look — ban the generic
Every film needs a designed point of view. These are the tells of sloppy AI video; each is banned unless the brief asks for it on purpose:
- ✖ Centered white title on a purple/blue gradient. ✖ Gradient-mesh blobs as "background design".
- ✖ System/default fonts, Inter-everything, or more than 2 families. ✖ Emoji as icons.
- ✖ Linear tweens. ✖ Everything fading in at the same speed. ✖ Fade-in-fade-out as the only transition.
- ✖ Glassmorphism cards floating in a void. ✖ Generic "AI sparkle" particles. ✖ Lorem ipsum / fake UI with placeholder copy.
- ✖ Dead holds: nothing on screen moving for > 0.8s (except the final logo hold). ✖ Text on screen shorter than 0.4s/word.
- ✖ Stock "tech" palette when the brand has its own. ✖ Inventing a logo when the real one is available.

Do instead:
- ✔ Pick a palette of max 3 colors + neutrals from the brand or reference; use color-blocking and flips between shots.
- ✔ Type as image: big, tight tracking (−0.03 to −0.05em), cropped by the frame, scale contrast ≥ 4:1 between display and text sizes.
- ✔ House eases: `snap` for entrances, `glide` for camera/morphs, `spring(0.3–0.45)` for pops, `outExpo` for slams. Overshoot on purpose.
- ✔ Stagger everything (20–40ms per char, 60–90ms per item). Lead with the hero element, let secondaries follow through.
- ✔ Real product UI (captured screens or faithful HTML rebuilds in the brand's tokens), real copy, real numbers.
- ✔ Depth: foreground/midground/background, scale contrast, soft shadows, a camera that moves with intent.
- ✔ Texture where it fits the brand: subtle grain (`K.grain`, 4–7%), vignette, light leaks — never on UI-precise films.
- ✔ Shot rhythm varies: e.g. 2s – 1s – 1s – 0.5s – 0.5s – 3s hold. Accelerate into the payoff.
- ✔ One idea per moment. If the viewer must read, give them time; if they must feel, cut on the beat.

## 3. Sound — picture and sound are one timeline
- Default: 120 BPM (beat = 0.5s, bar = 2s). Cuts, morphs and text slams land on beats; big hits on downbeats.
- Workflow: `audio/score.json` → `npm run score -- <p> --beats-only` → time the animation with `M.loadBeats()` + `M.beat(n)`/`M.bar(n)` → declare sounds with `M.cue(t, type)` (kit components cue themselves) → `npm run score -- <p>` → mix.wav.
- SFX vocabulary is consistent within a film: `click` cursor press · `key` typing · `pop` appear · `tick` counters/list · `whoosh`/`swoosh` morphs & camera · `chime` success · `ding` toast · `toggle` switches · `glitch` errors · `riser`→`impact` reveals · `thump` logo land · `shimmer` magic moments.
- Not every motion gets a sound. Score the important 30–50%; silence makes hits land.
- Voice-over: Fish Audio (MCP `fish-audio`, or `npm run tts`). Write VO first for VO-led films and time the picture to the measured line durations. Music ducks under VO automatically. Master at −14 LUFS.
- The film must still read with sound off (social autoplay): text carries the story, sound adds weight.

## 4. Feedback loop — look, score, fix, repeat
1. **Gate 1 — brief**: `brief.md` (12 points) filled; unknowns defaulted and stated. Show the user the film-in-one-line + beat sheet.
2. **Gate 2 — beat grid**: `shotlist.md` table approved **before writing animation code** (unless the user said "just go").
3. **Style frames**: build the comp, `npm run stills -- <p> --scenes`, Read the contact sheet + key stills. Fix anything generic before animating further.
4. **Draft**: `npm run stills -- <p> --every 0.25` around transitions to check motion; then `npm run render -- <p> --fast`.
5. **Critique**: score with `templates/critique.md` (save as `projects/<p>/critique-<n>.md`). Fix the lowest axis first. Repeat until every axis ≥ 8 or 4 rounds, then final render (no `--fast`) for every format.
6. **Learn**: append what worked / what failed to `studio/learnings.md` so the next film starts smarter.
