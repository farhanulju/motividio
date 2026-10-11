---
name: critique-loop
description: Self-critique a rendered or in-progress video — grab stills, score it on 9 axes (hook, art direction, brand fidelity, motion, rhythm, depth, clarity, sound, ending), fix the lowest scores, re-render, and repeat until every axis is 8+. Use after a draft render, or when the user asks to improve, polish, review or critique a video.
---

# critique-loop — look, score, fix, repeat

Each round:
1. **Look**
   - `npm run stills -- projects/<p> --every 0.5` → Read `out/stills/contact.png` (whole film at a glance).
   - `npm run stills -- projects/<p> --scenes` → Read 3–5 full-size stills of the key moments.
   - Around each transition: `--at t-0.1,t,t+0.1,t+0.2` to see motion mid-flight (blur, overshoot, overlaps).
   - Check every delivery format (`--format 9x16`) for cropping and safe areas.
2. **Score** with `templates/critique.md` → save `projects/<p>/critique-<n>.md`. Evidence must cite timestamps and what is visible. Be harsh: 8 = a good studio would ship it.
3. **Fix** the lowest 2–3 axes first, concretely (e.g. "hook: replace fade-in title with per-char slam at 0.2s + thump on 1.1"). Don't touch what scores 9+.
4. **Re-render** `--fast` (or stills only, if the fix was visual) and go again.

Stop when all axes ≥ 8, or after 4 rounds (report what's still < 8 and why). Show the user the score table per round as a compact before → after line, e.g. `Rhythm 6→8, Depth 6→8, Hook 7→9`.

Common fixes:
| Symptom | Fix |
|---|---|
| Feels generic | real brand UI, bolder type scale, palette flips per shot, kill gradients |
| Floaty / slow | shorter entrances (0.35–0.5s), `snap`/`outExpo`, more stagger, fewer holds |
| Chaotic | one hero per moment, align to grid, reduce simultaneous motions to ≤ 2 |
| Flat | foreground/background layers, scale contrast, shadow, camera push |
| Hard to read | ≥ 0.4s/word, larger text, higher contrast, fewer words |
| Weak ending | silence 0.3s before logo, thump on downbeat, hold ≥ 1s, URL/CTA |
