# Motividio

A motion studio made in code. Describe a video and Claude handles the rest: it researches the brand,
writes a director's brief and a beat grid, builds an HTML composition, reviews its own stills,
scores music and SFX to the beat, adds a Fish Audio voice-over, critiques and fixes, then renders the MP4s.

```
prompt ─► brief.md ─► shotlist.md (beat grid) ─► index.html ─► stills ─► score ─► critique loop ─► out/*.mp4
             ▲                                        ▲
   brands/<slug>/brand.md                 references/<slug>/style-guide.md      (long-lived memory)
```

## Use it
Open this folder in Claude Code (desktop Code tab or `claude` in a terminal), pick Opus at high effort,
and ask for a film. Examples (more in [studio/prompt-library.md](studio/prompt-library.md)):

- *Make a 15-second launch video for Acme (https://acme.com): their new AI canvas ships today. Use real screenshots and the real logo. 16x9 and 9x16. Go all out.*
- *Here's a reference: https://x.com/…/status/… — extract its style, then make a 15s Acme film in that grammar.*
- *Make a 45-second walkthrough of creating a project in Acme, with a Fish Audio voice-over.*
- *Make a 6s, 15s and 30s ad set for Acme for Instagram.*

Claude follows the `make-video` skill and stops at two gates (brief, beat grid) unless you say **"just go"**.

## Try the demo
```bash
npm run render -- projects/_demo --format all
```
Output goes to `projects/_demo/out/`. To get the live player, run `npm run preview` and open the URL it prints in your browser.

## Voice: Fish Audio
The Fish Audio MCP is registered for this project in [.mcp.json](.mcp.json) (`https://api.fish.audio/mcp`, OAuth).
1. Create an account at https://fish.audio.
2. Connect it in one of two ways:
   - **Claude Code (this project):** start a session here, approve the `fish-audio` server, and sign in when prompted. In a terminal, run `claude` here, then `/mcp` → fish-audio → Authenticate.
   - **Every Claude app:** go to claude.ai → Settings → Connectors → Add custom connector, use the name `Fish Audio` and the URL `https://api.fish.audio/mcp`. Then set its tool permissions to "Always allow" if you like.
3. Optional REST fallback: copy `.env.example` to `.env` and paste your Fish Audio API key. Then `npm run tts -- projects/<p>` works with no MCP.

TTS uses your Fish Audio plan. Image and video generation through the MCP is quoted first, and Claude asks you before spending credits.

## Optional connectors
- **HyperFrames by HeyGen** (in the Claude connector directory) and **Remotion** are alternative render routes. The default zero-dependency route doesn't need either.

## Toolchain
Node 20+, ffmpeg/ffprobe, Playwright Chromium (`npm install && npx playwright install chromium`), and yt-dlp for downloading references. To check everything: `npm run doctor`. Tests: `npm test` (unit) and `npm run test:smoke` (renders the demo); CI runs both on every push.

## Sound library
Scores use recorded sound. `library/library.json` indexes the studio's recordings (cue type → files, music with mood and bpm, source and license); the media files stay local because their licenses don't allow redistribution. `npm run library -- list` shows what's there and what's missing on this machine; `npm run library -- add <file> --type whoosh` adds one.

## Layout
See [CLAUDE.md](CLAUDE.md). The parts:
- `engine/`: runtime, kit, stage3d, render, stills, verify, qa, score, mix, levels, library, tts, ref, capture, learn
- `studio/`: rules, playbooks, specs, prompts, learnings
- `templates/`: brief, beat grid, style guide, brand kit, critique
- `brands/`, `references/`, `projects/`: memory and work
