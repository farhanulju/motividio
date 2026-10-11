# Genre playbooks

A genre sets known rules. Pick one in the brief and follow its skeleton unless the user asks otherwise.

---

## Product launch film (10–30s)
**Goal:** "this exists, it's beautiful, here's why it matters, go try it."
- Skeleton: hook (bold claim or striking visual, 0–2s) → product reveal (real UI, 2–4s) → 2–3 features as proof, one per beat-phrase → payoff line → logo + URL.
- Real product screenshots or faithful HTML rebuilds of the UI. Animate the UI itself (states, cursor, data) — not decorations around it.
- 16x9 master + 9x16 cut. Text carries the story for sound-off.
- Prompt multipliers that work: "go all out", "show, don't explain", "use actual product screenshots and logo assets".

## Ad (6s bumper / 15s / 30s)
**Goal:** one message, one CTA, stop the scroll.
- 6s: hook (1s) → single benefit (3s) → logo/CTA (2s). No VO needed.
- 15s: hook → problem (2s) → product solves it (6s) → proof (3s) → CTA (2s).
- 30s: hook → problem → product → 3 proofs → social proof/number → CTA.
- First frame must already be interesting (it's the thumbnail). Brand visible by 3s. CTA on screen ≥ 2s.
- Default formats: 9x16 + 1x1 + 4x5 for paid social; 16x9 for YouTube.

## Product walkthrough / feature demo (30–90s)
**Goal:** a viewer understands how to do X in the product.
- One continuous UI canvas; camera (`K.camera`) moves to each area instead of hard cuts. Cursor (`K.cursor`) drives every action with clicks cued.
- Each step: zoom to region (1.2s glide) → action (cursor + state change) → result highlighted (ring/spotlight, 0.8s) → caption chip with step number.
- VO-led: write the VO script first, generate with Fish Audio, then time picture to measured line durations (`audio/vo.json`).
- Keep UI legible: never zoom beyond ~1.6×, text ≥ 28px at 1080p after zoom.

## One-container UI film ("product film UI motion")
**Goal:** a premium Apple-style UI story.
- One container never cuts. Every state is the same element changing size, radius and fill while its content swaps behind a short blur (`K.morph` + `K.swap`).
- Write the **state list** in shotlist.md first; show the beat grid before code.
- Gotchas: keep the container's center of mass smooth between states; content must not reflow during the morph (swap at the morph's midpoint); radius should scale with size.

## Showreel / brand sizzle (15s)
**Goal:** show range of technique — the subject is the motion itself.
- 6–8 shots, each a different technique (kinetic type, 3D-ish depth, masks, morphs, data viz, particles done tastefully), unified by palette and music.
- Accelerating shot lengths into a final logo/name slam.

## Explainer / story film (30–120s)
**Goal:** tell a narrative (founder story, how-it-works, history).
- Director's brief all 12 points, character bible if characters exist, beat sheet first.
- Scenes as chapters with a recurring visual motif. VO + music, SFX sparing.
- Long renders: work scene by scene (`--from/--to`) and stitch with ffmpeg.

## Repurpose existing footage (route 4)
**Goal:** cut supplied video, add captions, B-roll, motion overlays.
- Put source in `projects/<p>/assets/`. Transcribe with Fish Audio MCP (transcription tool) for captions + timing.
- Edit with ffmpeg (trim/concat), or composite in a comp with `M.video(el, start)` and overlay animated captions/graphics in HTML.

## Mixed pipeline (route 3)
**Goal:** photoreal or illustrated shots that code can't draw.
- Generate image/video plates (Fish Audio MCP image/video tools — they quote credits first; confirm with the user), then composite typography/UI/graphics on top in the comp.
