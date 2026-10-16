---
name: score-to-beat
description: Score a film to the beat — recorded music edited onto the timeline and recorded sound effects mapped from the picture's cues (synth only where the user accepts it), write beats.json (bpm, beats, downbeats, hits), and retime the animation to it. Use when adding music/SFX to a video, syncing motion to sound, or when the user asks for audio, music, sound design or "to the beat".
---

# score-to-beat — picture and sound are one timeline

Recorded first. The user dislikes synthesized music and SFX; synth stays only for cube turns (`turn`, `cube`).
The studio's recorded library is indexed in `library/library.json` (media local in `library/`, Mixkit licenses).
`npm run library -- list` shows every cue type with recordings and every music track (mood, bpm, track map).

1. **Plan** `projects/<p>/audio/score.json` (new projects start with this):
   ```json
   { "sound": "recorded", "duration": 30, "offset": 0,
     "music": { "file": "library:music/motivating-mornings.mp3",
                "segments": [{ "t": 0, "from": 8.0, "dur": 23.3, "fadeIn": 0.6, "fadeOut": 0.3 },
                             { "t": 23.27, "from": 88.95, "dur": 7.0, "fadeIn": 0.05, "fadeOut": 1.0 }] },
     "sounds": { "chaching": { "file": "sfx/register.mp3", "peak": 0.40, "gain": 0.6 } },
     "gain": { "music": 0.5, "sfx": 1 }, "sfx": [] }
   ```
   - **Music**: pick by mood from the library. Edit it, don't just lay it under: place segments so the track's
     entry/hit points (the `notes` track map, or listen) land on the film's cuts and logo. One segment with
     `{ file, from }` is fine for simple films. `bpm` comes from the library entry when it has one.
   - **Sounds**: every `M.cue(t, type)` plays a recorded variant of that type, aligned so the file's peak lands on
     `t`. `sounds` overrides or adds types for this film (files relative to `audio/`, or `library:…`).
     Types without a recording are dropped and listed — add one (`npm run library -- add <file> --type <t>`,
     note source + license) or map it in `sounds`. Don't fall back to synth.
   - Legacy synth scoring still exists (`"style": "pulse"` without `"sound"`), for old projects only.
2. `npm run score -- projects/<p> --beats-only` → `audio/beats.json` (bpm, beats, downbeats, hits).
3. **Retime the picture**: `M.loadBeats()` in the comp; place cuts on `M.beat(n)`, big moments on `M.bar(n)`
   (downbeats). Move morph midpoints onto beats, not their starts.
4. **Declare sounds** with `M.cue(t, type, { gain })` — vocabulary: click, typing, pop, tick, whoosh, swoosh, thump,
   impact, chime, paper, page, writing, shutter, applause, cheer, laugh, crowd, heartbeat (+ foley types in the
   library). Kit components (`K.cursor`, `K.check`, `K.morph`, `K.endCard`, `K.count` with `ticks`/`cue`) cue themselves.
5. `npm run stills -- projects/<p> --scenes` (refreshes `audio/cues.json`), then `npm run score -- projects/<p>`
   → `music.wav`, `sfx.wav`, `mix.wav`. The mix ducks music hard and SFX lightly under the VO, normalizes in two
   passes to −14 LUFS, and checks every VO phrase against the bed.
6. **Levels**: `npm run levels -- projects/<p>` prints every VO phrase's dB over the bed (target ≥ 6 dB). Fix the
   culprit per phrase — music gain, a long SFX tail, or VO gain — and re-run. The render manifest repeats the worst.
7. Render `--fast` and watch with sound. Typical fixes: too many SFX (cut to the important 30–50%), whoosh peaking
   late (move the cue to the motion's fastest point), a hit on the first syllable after a cut (move it).

Not every motion gets a sound. Silence before the logo thump makes it land.
