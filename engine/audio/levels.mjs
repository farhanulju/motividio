#!/usr/bin/env node
/**
 * Voice-over vs bed, per phrase: re-mixes the project and prints every VO phrase's level over everything
 * else (music + SFX + vocal effects, after ducking). Target: ≥ 6 dB. Also writes audio/levels.json.
 *
 *   node engine/audio/levels.mjs projects/<name> [mix options, e.g. --music 0.3]
 */
import { args, projectDir } from '../lib/common.mjs';
import { mix } from './mix.mjs';

const a = args();
await mix(projectDir(a._[0]), { lufs: a.lufs && +a.lufs, music: a.music, sfx: a.sfx, vo: a.vo, voxfx: a.voxfx, sfxDuck: !a['no-sfx-duck'], report: true });
