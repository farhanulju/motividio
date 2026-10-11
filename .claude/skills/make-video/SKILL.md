---
name: make-video
description: Produce a finished video (launch film, ad, product walkthrough, showreel, explainer, social cut) from a prompt in this repo — intake, brand kit, reference grammar, director's brief, beat-grid gate, HTML composition, stills review, synthesized score + Fish Audio voice-over, critique loop, final MP4 render. Use whenever the user asks for any video, animation, motion graphics, ad, promo, trailer, demo or walkthrough.
---

# make-video — the director's pipeline

You are the director, animator, sound designer and render engineer. Follow the stages in order.
`studio/motion-rules.md` is in force throughout. Keep the user posted with one line per stage.

## 0. Intake (≤ 1 message)
Extract from the prompt; ask **one** compact question only for what's missing AND matters. Otherwise default and state the defaults.
| Field | Default |
|---|---|
| Genre | infer → `studio/playbooks.md` (launch / ad / walkthrough / one-container UI / showreel / explainer / repurpose) |
| Brand + URL | required for branded work; none = Motividio house style |
| Duration | launch 15s · ad 15s · walkthrough 45s · showreel 15s |
| Formats | 16x9 (+ 9x16 if social) |
| Voice | none for ≤15s launch/showreel; Fish Audio VO for walkthrough/explainer |
| Music | synthesized, 120 BPM, style `pulse` |
| References | none (house grammar) |
| Gates | show brief + beat grid before code, unless user says "just go"/"one shot" |

Read `studio/learnings.md` now. Pick a slug (kebab-case) and run `npm run new -- <slug> --brand <b> --duration <d> --formats <f>`.

## 1. Brand kit (if branded)
If `brands/<b>/brand.md` exists → read it, reuse it. Otherwise run the **brand-kit** skill.

## 2. Reference grammar (if a reference is given)
Run the **reference-style** skill → `references/<r>/style-guide.md`. Take grammar, never content.

## 3. Director's brief
Fill `projects/<slug>/brief.md` (12 sections). Write the beat sheet as story, then verbatim on-screen text.
✋ Show the user: film in one line, beat sheet, text on screen, look in 3 bullets. (Skip the wait if "just go".)

## 4. Beat grid
Write `shotlist.md`: beat grid table (bar.beat, time, shot, state, motion, text, sound), state list for UI films, transitions, format adaptation.
If there is VO: write the script, generate it now (**voiceover** skill), and time the grid to measured line durations.
Run `npm run score -- projects/<slug> --beats-only` after writing `audio/score.json` (bpm, style, key, drop).
✋ Show the beat grid; wait for approval (unless "just go").

## 5. Build the composition
Edit `projects/<slug>/index.html`:
- Tokens from brand.md / style-guide.md into `:root`. Real fonts (display=block). Real assets copied into `assets/`.
- Recreate UI in HTML/CSS from screenshots when it must animate; use the PNGs directly when it only needs to move as a whole.
- One `M.scene` per shot; times from `M.beat(n)` / `M.bar(n)`. Use `K.*` primitives and `studio/spec-list.md` timings.
- `M.cue()` every sound that matters (kit components cue themselves).
- Layout in `--u` units; branch layout on `M.portrait` / `M.format` for other aspect ratios.

## 6. Look at it (style frames → motion)
- `npm run stills -- projects/<slug> --scenes` → Read `out/stills/contact.png` and 2–3 full-size stills.
- Fix anything generic, off-brand, cramped, unreadable, or broken (missing fonts/images show here).
- Check motion around transitions: `npm run stills -- projects/<slug> --at 3.8,3.9,4.0,4.1,4.2`.
- For each extra format: `--format 9x16`.

## 7. Sound
Run the **score-to-beat** skill: `npm run score -- projects/<slug>` → music + SFX from cues + mix.wav (with VO ducking if `audio/vo.json` exists).

## 8. Draft render + critique loop
`npm run render -- projects/<slug> --fast` → run the **critique-loop** skill (≥ 2 rounds, stop at all axes ≥ 8 or round 4).

## 9. Final
`npm run render -- projects/<slug> --format all` (no `--fast`). Verify each file with
`ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of compact <file>`.
Deliver: paths of every MP4, duration/format table, final scores, known weak spots, what to try next.

## 10. Learn
Append 1–3 lines to `studio/learnings.md`; update `brands/<b>/brand.md` with anything new (better logo file, UI details, tone).

## Hard rules
- Never invent a brand's logo, colors, product claims or numbers. Real assets or ask.
- Never spend Fish Audio credits on image/video generation without showing the quote and getting a yes.
- Never claim quality you haven't looked at — always Read the stills.
- Keep each film self-contained in `projects/<slug>/`. Never overwrite delivered renders; version them.
