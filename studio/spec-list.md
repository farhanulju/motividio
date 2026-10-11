# Component spec list — motion specs for recurring UI elements

Reusable timings so films feel consistent. Kit implementations in `engine/kit.js` are noted.
Times assume 120 BPM; durations in seconds.

| Element | Enter | Exit | Detail | Sound | Kit |
|---|---|---|---|---|---|
| Cursor | fade 0.3 before first point | fade 0.2 | travel 0.55 `glide`, press scale 0.82, ripple 0.5 | `click` +0.02 after arrival | `K.cursor` |
| Button press | — | — | scale 0.96 for 0.12, fill darkens 8%, label stays | `click` | manual |
| Typing | caret appears 0.3 early | caret blinks 2.2Hz after | 18–28 chars/s, slight random rhythm not needed | `key` every 2 chars | `K.type` |
| Text card (display) | per-char rise 40px, 0.5, stagger 0.025, `snap` | per-char up −30px + blur, 0.3, `inCubic` | ≤ 6 words, ≥ 0.4s/word | `swoosh` on slams only | `K.textIn/Out` |
| Container morph | — | — | size/radius/fill interpolate `glide` 0.6–0.9; content swaps behind 0.28 blur | `whoosh` mid-move | `K.morph` + `K.swap` |
| Card / panel appear | scale 0.94→1 `spring(0.35)` + y 24→0, opacity 0.15 | opacity + y −12, 0.25 | shadow grows with scale | `pop` (soft) | manual |
| List items | stagger 0.07, y 18→0, `snap` 0.45 | reverse, stagger 0.04 | | `tick` each (gain 0.12) | `M.stagger` |
| Toast / notification | y −40→0 + scale 0.9→1 `spring(0.4)` 0.5 | y −20 + fade 0.3 after 1.5 hold | | `ding` | manual |
| Loader / progress | fill `inOutCubic` 0.8–1.5 | snaps to check | never linear | `tick` at end | `K.progress` |
| Checkmark | circle draw 0.35 then tick 0.28 `snap`, scale spring 0.45 | — | green from brand, not default | `chime` | `K.check` |
| Number counter | `outExpo` 0.8–1.4 | — | tabular-nums, thousands separators | `tick` at end | `K.count` |
| Chart bars | stagger 0.06, scaleY `snap` 0.6 | — | value labels count up with bars | `tick` per bar (soft) | `K.bars` |
| Toggle | knob x `spring(0.4)` 0.3, track color 0.2 | — | | `toggle` | manual |
| Camera push | `glide` 1.2–2.0 | — | z 1→1.15 max for UI (keep legible) | `whoosh` (long, soft) | `K.camera` |
| Whip pan | 0.25 `inOutExpo` + motion blur 20px at mid | — | cut hidden at blur peak | `swoosh` | manual |
| Logo land | scale 0.6→1 `spring(0.35)` 0.8, or draw-on | holds ≥ 1.0s | final frame clean, centered or brand rule | `thump` (+`riser` before) | manual |
| Glitch | 3–5 frames offset slices + RGB split | — | max 0.25s, once per film | `glitch` | manual |
