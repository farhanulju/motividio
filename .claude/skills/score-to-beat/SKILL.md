---
name: score-to-beat
description: Score a film to the beat — synthesize an original music track and UI sound effects in code on the same timeline as the picture, write beats.json (bpm, beats, downbeats, hits), and retime the animation to it. Use when adding music/SFX to a video, syncing motion to sound, or when the user asks for audio, music, sound design or "to the beat".
---

# score-to-beat — picture and sound are one timeline

1. **Plan** `projects/<p>/audio/score.json`:
   ```json
   { "bpm": 120, "duration": 15, "key": "A", "scale": "minor", "progression": [1,6,3,7],
     "style": "pulse", "drop": 4.0, "offset": 0, "gain": { "music": 0.75, "sfx": 1 }, "sfx": [] }
   ```
   Styles: `pulse` (tech launch) · `house` (energetic) · `minimal` · `halftime` (heavy/trailer) · `ambient` (calm/explainer) · `none` (SFX only).
   Keys/scales: minor = tension/premium, major/lydian = bright/friendly, dorian = cool.
   Optional `sections: [{ from, to, layers: ['kick','clap','hat','hat16','ohat','bass','sub','pad','arp','stab','ring'] }]` for full control.
2. `npm run score -- projects/<p> --beats-only` → `audio/beats.json`.
3. **Retime the picture**: `M.loadBeats()` in the comp; place cuts on `M.beat(n)`, big moments on `M.bar(n)` (downbeats), the drop on `score.drop`. Move morph midpoints onto beats, not their starts.
4. **Declare sounds** with `M.cue(t, type, { gain, pitch, dur, dir })` — types: click, key, tick, pop, whoosh, swoosh, thump, impact, chime, shimmer, riser, glitch, ding, toggle, suck. Kit components (`K.cursor`, `K.type`, `K.check`, `K.morph`) cue themselves. Static extra cues can go in `score.json → sfx`.
5. `npm run stills -- projects/<p> --scenes` (refreshes `audio/cues.json`), then `npm run score -- projects/<p>` → `music.wav`, `sfx.wav`, `mix.wav`.
6. Render `--fast` and watch with sound. Typical fixes: too many SFX (cut to the important 30–50%), whoosh peaking late (move cue to the motion's fastest point), music masking VO (lower `gain.music`).

Not every motion gets a sound. Silence before the logo thump makes it land.
