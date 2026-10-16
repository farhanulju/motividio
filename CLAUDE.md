# Motividio — a motion studio made in code

This repo turns a prompt into a finished video: launch films, ads, product walkthroughs, showreels,
explainers. Claude is the **director, animator, sound designer and render engineer**. Opus writes
code; the engine turns code into frames, frames into MP4.

**Route (default):** zero-dependency HTML composition → deterministic `__seek(t)` → headless Chromium
screenshots each frame → ffmpeg → MP4 with a code-synthesized score + Fish Audio voice. Other routes
(HyperFrames / Remotion, generated plates + code composite, cutting supplied footage) only when the brief says so.

## When the user asks for a video
Use the **`make-video`** skill (`.claude/skills/make-video/SKILL.md`). It runs the full pipeline:
intake → brand kit → reference grammar → director's brief → beat grid gate → build → stills →
score → critique loop → render → deliver → learn. Sub-skills: `brand-kit`, `reference-style`,
`voiceover`, `score-to-beat`, `critique-loop`.

Before starting any film, read: `studio/learnings.md` (taste memory), `studio/policy.md` (what the ledger says works) and, if a brand is named,
`brands/<slug>/brand.md` (brand memory). If that brand file exists, reuse it — don't re-research.

## The rules (always in force)
@studio/motion-rules.md

## Where things live
| Path | What |
|---|---|
| `engine/runtime.js` | in-page timeline: `M.comp/scene/on/tw/keys/stagger/ease/split/set/cue/beat/video/rand` |
| `engine/kit.js` | motion primitives: `K.cursor/type/count/draw/check/morph/swap/camera/textIn/textOut/grain/progress/bars` |
| `engine/stage3d.js` | `stage3d()` — deterministic three.js stage: renderer, env light, `load` (blocks frame 0), `clip` (animation pinned to t), `frame`, skip-draw during the cue sweep |
| `engine/cube.js` | `Cube3D` — a real CSS-3D 3×3 Rubik's cube driven by move notation (scramble/invert/jam/pop, lighting) |
| `engine/*.mjs` | CLI tools (below) |
| `engine/audio/` | `score.mjs` (music+SFX+beats), `sfx.mjs` (sampler + legacy synth SFX), `mix.mjs` (ducking, two-pass −14 LUFS, VO level check), `levels.mjs`, `tts-fish.mjs` (Fish Audio REST, s2.1-pro-free) |
| `library/` | recorded sound library: `library.json` (committed index: cue type → recordings, music with mood/bpm/track map, source + license); media files local only |
| `tests/` | `npm test` (unit), `npm run test:smoke` (stills → verify → render on `_demo`); CI runs both |
| `studio/` | motion-rules, playbooks (genres), spec-list (component timings), prompt-library, learnings, ledger.jsonl + policy.md (learning loop) |
| `templates/` | director-brief, shotlist (beat grid), style-guide, brand, critique, project starter |
| `brands/<slug>/` | brand memory: brand.md, screens/, logos/, extracted.json, characters/ |
| `references/<slug>/` | reference videos: source.mp4, frames/, sheet-*.jpg, cuts.json, style-guide.md |
| `projects/<slug>/` | one film: brief.md, shotlist.md, index.html, assets/, audio/, critique-n.md, out/ |

## Commands (`npm run <x> -- <args>`)
| Command | Does |
|---|---|
| `new <slug> [--brand b --duration 15 --formats 16x9,9x16]` | scaffold a project |
| `preview [projects/<slug>]` | live player at http://127.0.0.1:4321/projects/<slug>/ (space, ←/→, scrub, `?format=9x16`) — for the user's own browser |
| `stills projects/<slug> [--every 0.5 \| --at 1,2.5 \| --scenes] [--format 9x16]` | PNG stills + `contact.png`; also refreshes `audio/cues.json`. **Read these images to review.** |
| `render projects/<slug> [--format all] [--fast] [--from a --to b] [--workers 4] [--fresh] [--overwrite]` | final MP4(s) in `out/`, never overwritten (next free `-v2`, `-v3`…) + a `.json` manifest (input hashes, settings, versions, ffprobe, loudness); `--fast` or a range → `out/draft/`. Muxes `audio/mix.wav`. Chunked: an interrupted/crashed render resumes when re-run |
| `verify projects/<slug> [--format 9x16] [--samples 30]` | stateless check: frames must match whether seeked in order or shuffled with random jumps; A/B/diff PNGs in `out/verify/` on failure |
| `score projects/<slug> [--beats-only]` | `beats.json`, `music.wav`, `sfx.wav`, `mix.wav` |
| `mix projects/<slug>` | re-mix after VO changes |
| `tts projects/<slug>` | Fish Audio REST from `audio/vo-script.json` (needs `FISH_API_KEY` in .env) |
| `vox projects/<slug>` | human vocal effects (gasps, laughs, crowd) from `audio/vox-script.json` → `audio/vox/`; place with `M.cue(t, 'sample', {file})` (own ducked stem) |
| `ref <url\|file> --name <slug>` | download + frames + contact sheets + cut detection for a reference |
| `capture <url> --brand <slug> [--pages /,/pricing] [--mobile]` | brand screenshots, logos, colors, fonts |
| `levels projects/<slug>` | every VO phrase's dB over the bed (target ≥ 6) → `audio/levels.json` |
| `library list \| scan \| add <file> --type <t>` | the recorded sound library (cue types, music tracks, peaks, licenses) |
| `qa projects/<slug>` | delivery QA on the final renders: format/fps/duration/codec/audio (errors), loudness, dead holds, black gaps, VO levels, staleness, safe areas (warnings) |
| `learn record projects/<slug>` | end-of-project episode: `learn.json` + critiques → `studio/ledger.jsonl` (reward), learnings log line, rebuilds `studio/policy.md` |
| `learn stats` / `learn distill` | print the ledger summary / rebuild the policy |
| `doctor` | toolchain check |

## Voice — Fish Audio
- Alternative: the **Fish Audio MCP** (`fish-audio`, registered in `.mcp.json`, OAuth). Tools search voices, generate speech, clone voices, transcribe. It returns audio URLs — download them with `curl -L -o projects/<p>/audio/vo/<id>.mp3 <url>` and write `audio/vo.json`.
- **REST route is configured and verified**: `npm run tts -- projects/<p>` reads `FISH_API_KEY` + `FISH_MODEL` from `.env`. Always use model **`s2.1-pro-free`** (free dev tier — the user's choice). Use this whenever the MCP tools aren't live.
- Delivery tags in brackets are performed, not spoken: `[excited] [calm] [whispering] [laughing]`.
- Image/video generation via Fish MCP costs credits: always show the user the quote and get a yes first.
- Never type API keys or passwords anywhere; the user puts keys in `.env` themselves.

## Working agreements
- Show the user the brief summary and the beat grid before animation code, unless they say "just go" / "one shot it".
- Always review with your own eyes (Read the contact sheet PNGs) before claiming a render is good.
- Sound is recorded by default (`score.json → "sound": "recorded"`): cues map to `library/` recordings, music is an edit of a library track. Synth only for cube turns.
- Before delivery: `npm run qa -- projects/<slug>` passes; its warnings are fixed or reported.
- Long jobs: render with `--fast` while iterating; `npm run verify` must pass before the final render (no `--fast`).
- `stills`/`render`/`verify` refuse a comp with missing images, fonts, stylesheets or page errors. Fix the cause; for a load problem the film accepts on purpose, list it in `M.comp({ ignore: ['substring'] })` rather than using `--allow-errors`.
- Every time a project ends (delivered, accepted, rejected or abandoned), run the make-video **Learn** step: fill `learn.json`, `npm run learn -- record projects/<slug>`, fix generic mistakes at their source in the repo, and update `brands/<slug>/brand.md`.
- Self-tuning: after 100 recorded episodes `studio/policy.md` turns ACTIVE and its prefer/avoid/explore lists steer every new film (a reward-driven bandit over the studio's own rules — no model training).
- `projects/` and `brands/` stay local (gitignored, the repo is public). Commit engine, skills, templates and `studio/` only.
- Report honestly: final scores, known weak spots, and file paths of every deliverable.
