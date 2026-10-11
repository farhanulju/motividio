# Director's brief — {{SLUG}}

> You are the director, animator, sound designer and render engineer for this film, made in code.
> Fill every section before writing code. Unknowns get a sensible default, stated in **bold**, not a blank.
> Created {{DATE}}.

## 1. Film in one line
<!-- genre + subject + feeling + payoff. e.g. "A 15s launch film where Magic Path's canvas assembles itself, agents build five screens at once, and it all lands on the logo — confident, playful, fast." -->

## 2. Audience, goal, platform
- Who watches: 
- What they must remember (one thing): 
- Action after watching (CTA): 
- Where it plays: (X feed / YouTube pre-roll / landing hero / LinkedIn / TikTok/Reels / sales deck) → sound-off safe? 

## 3. References (grammar, never content)
| Reference | What to take | What NOT to take |
|---|---|---|
| references/<slug>/style-guide.md | palette logic, shot length, transition types | logos, characters, copy |

## 4. Tools & keys
- Render route: **zero-dependency HTML + runtime.js → engine/render.mjs** (default) | HyperFrames | Remotion | mixed (gen-video + code composite)
- Voice: Fish Audio MCP (`fish-audio`) | REST fallback `npm run tts` | none
- Music/SFX: `npm run score` (synth in code) | supplied track in audio/
- Assets: brands/{{BRAND}}/ (screens, logos, brand.md)

## 5. Brand / character bible
- Brand kit: `brands/{{BRAND}}/brand.md` — palette (hex), type (families/weights/tracking), logo rules, UI kit, voice & tone.
- Characters / mascots (if any): turnarounds, proportions, expressions, do/don't — one file each in brands/{{BRAND}}/characters/.

## 6. Art direction — the look
- Palette (max 3 + neutrals): 
- Type: display / text / mono; sizes on a scale; tracking: 
- Texture: grain / glow / none: 
- Camera language: (locked-off / slow push / whip pans / one continuous container) 
- Motion personality: eases (snap / glide / spring bounce 0.x), speed, overshoot: 
- Banned for this film: (see studio/motion-rules.md "The look") + film-specific bans

## 7. Beat sheet
<!-- Story in beats, not shots: hook → tension/problem → reveal → proof (2–3 features) → payoff → CTA/logo. -->
1. Hook (0–2s): 
2. 
3. 
4. Payoff: 
5. Logo / CTA: 

## 8. Text on screen
<!-- Every word, verbatim, in order. ≤ 6 words per card; ≥ 0.4s per word on screen. -->
| # | Text | In | Out | Style |
|---|---|---|---|---|

## 9. Sound plan
- Music: style (pulse/house/minimal/halftime/ambient), BPM **120**, key, drop at bar __ 
- SFX vocabulary: click (cursor), whoosh (morph/camera), pop (appear), tick (counters), chime (success), thump (logo)
- VO: script lines + timing + voice + delivery tags ([excited], [calm]) — or none
- Mix: music ducks under VO; −14 LUFS

## 10. Workflow gates (stop and show the user at each ✋)
1. ✋ Brief (this file) approved
2. ✋ Shot list / beat grid (`shotlist.md`) approved — **before any animation code**
3. Style frames: `npm run stills -- <project> --scenes` → contact sheet reviewed
4. Full draft render → critique loop (≥ 2 rounds)
5. ✋ Final cut delivered

## 11. Critique loop
Score every round with `templates/critique.md` (9 axes, 1–10). Fix the lowest first. Stop when every axis ≥ 8 or after 4 rounds; report remaining weaknesses honestly.

## 12. Deliverables
- Formats: {{FORMATS}} — 16x9 1920×1080 · 9x16 1080×1920 · 1x1 1080×1080 · 4x5 1080×1350
- Duration: {{DURATION}}s @ 60fps, H.264 MP4, AAC 48k
- Extras: silent version? captions burned in? thumbnail still? GIF?
- Output: `projects/{{SLUG}}/out/`
