---
name: voiceover
description: Write and generate a voice-over with Fish Audio (REST API with model s2.1-pro-free by default; MCP for voice search/cloning), including voice selection or cloning and delivery tags, then place each line on the film's timeline (audio/vo.json) with music ducking. Use when a video needs narration, an avatar/presenter voice, or the user mentions Fish Audio, voice, VO or narration.
---

# voiceover — Fish Audio

## Write
- Script lines short (≤ 12 words), one idea each, aligned to the beat sheet. ~2.6 words/sec for natural pace.
- Delivery tags in brackets are performed, not spoken: `[excited]`, `[calm]`, `[confident]`, `[whispering]`, `[laughing]`. Use sparingly.
- Save the script to `projects/<p>/audio/vo-script.json`: `{ "voice": "<id?>", "model": "s2.1-pro-free", "lines": [{ "id": "01", "t": 0.4, "text": "…" }] }`.

## Generate — REST route (default, configured)
`npm run tts -- projects/<p>` — key + model (`s2.1-pro-free`) come from `.env`. Writes `audio/vo/*.mp3` + `audio/vo.json` and warns on overlaps. One-off line: `npm run tts -- --text "[excited] …" --out projects/<p>/audio/vo/01.mp3 [--voice <reference_id>]`.

## Generate — MCP route (voice search / cloning / transcription)
1. Check for Fish Audio MCP tools (ToolSearch "fish"). If absent, use the REST route; for voice search/cloning tell the user the MCP needs connecting (README → Voice).
2. Pick a voice: search the library for the tone (e.g. "warm confident English male narrator"); or, if the user wants their own voice, use the MCP voice-cloning flow with their sample recording (they must own the voice / have consent).
3. Generate each line. Download the returned URL: `curl -L -o projects/<p>/audio/vo/<id>.mp3 "<url>"`.
4. Measure: `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>`; write `audio/vo.json` `[{ "id","file":"vo/01.mp3","t":0.4,"dur":2.31,"text":"…" }]`.

## Place
- `vo.json` lines carry `phrases: [[start,end],…]` (speech segments within each file). Absolute phrase onset = `line.t + phrase[0]` — cut and slam text on these, they're far more accurate than guessing from the script.
- Picture follows voice: retime scenes so each line's visual lands 0.1–0.2s **before** the line. Leave ≥ 0.25s between lines.
- `npm run mix -- projects/<p>` (or re-run `score`) → music ducks under VO, master −14 LUFS.
- Listen-check by rendering a `--fast` draft; fix mispronunciations with spelling hints or rephrasing.

Usage notes: TTS uses the free s2.1-pro-free developer model; image/video generation must be quoted and approved first.
