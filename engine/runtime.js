/*
 * Motividio runtime — a deterministic timeline for video made in code. Zero dependencies.
 *
 * Every visual state is a pure function of time `t` (seconds). The renderer calls
 * window.__seek(t) once per frame and screenshots the stage, so nothing may depend on
 * wall-clock time, requestAnimationFrame deltas, or unseeded randomness.
 *
 *   <div id="stage"> ... </div>
 *   <script src="/engine/runtime.js"></script>
 *   <script>
 *     M.comp({ duration: 15, fps: 60, formats: ['16x9', '9x16'] });
 *     M.scene('hook', 0, 2.5, (p, lt, t) => { ... }, '#s-hook');
 *     M.on(t => { ... });              // runs every frame
 *     M.cue(1.2, 'click');             // sound-effect cue -> audio/cues.json
 *   </script>
 *
 * Dev mode (no ?render): plays in real time with a scrubber, beat ticks and audio/mix.wav.
 * Render mode (?render=1): static stage at native size, driven only by __seek.
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render');

  const FORMATS = {
    '16x9': [1920, 1080],
    '9x16': [1080, 1920],
    '1x1': [1080, 1080],
    '4x5': [1080, 1350],
  };

  const M = {
    t: 0, RENDER, FORMATS,
    W: 1920, H: 1080, fps: 60, duration: 10, format: '16x9', portrait: false,
    beats: null,
    _on: [], _scenes: [], _videos: [], _tasks: [], _cues: [],
  };

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  M.clamp = clamp;
  M.lerp = lerp;
  M.map = (v, a, b, c, d, doClamp = true) => {
    let p = (v - a) / (b - a);
    if (doClamp) p = clamp(p);
    return c + (d - c) * p;
  };
  M.mix = (a, b, p) => {
    if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], p));
    if (typeof a === 'string') return M.mixColor(a, b, p);
    if (a && typeof a === 'object') {
      const o = {};
      for (const k in a) o[k] = k in b ? M.mix(a[k], b[k], p) : a[k];
      return o;
    }
    return lerp(a, b, p);
  };

  // ---------- easing ----------
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(u) - x;
        if (Math.abs(e) < 1e-6) return sy(u);
        const d = dx(u);
        if (Math.abs(d) < 1e-6) break;
        u -= e / d;
      }
      let lo = 0, hi = 1;
      u = x;
      while (hi - lo > 1e-6) {
        if (sx(u) < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }

  // bounce 0 = critically damped (no overshoot), 0.3 = tasteful, 0.6+ = cartoony
  function spring(bounce = 0.3) {
    const z = clamp(1 - bounce, 0.05, 1);
    const w = 6.9 / z;
    if (z >= 1) return (p) => (p >= 1 ? 1 : 1 - (1 + w * p) * Math.exp(-w * p));
    const wd = w * Math.sqrt(1 - z * z);
    return (p) => (p >= 1 ? 1 : p <= 0 ? 0 :
      1 - Math.exp(-z * w * p) * (Math.cos(wd * p) + (z * w / wd) * Math.sin(wd * p)));
  }

  const c1 = 1.70158, c3 = c1 + 1;
  M.ease = {
    linear: (p) => p,
    inQuad: (p) => p * p,
    outQuad: (p) => 1 - (1 - p) * (1 - p),
    inOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    inCubic: (p) => p * p * p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outQuart: (p) => 1 - Math.pow(1 - p, 4),
    inOutQuart: (p) => (p < 0.5 ? 8 * p ** 4 : 1 - Math.pow(-2 * p + 2, 4) / 2),
    outQuint: (p) => 1 - Math.pow(1 - p, 5),
    inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutExpo: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5
      ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    outBack: (p) => 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2),
    inBack: (p) => c3 * p * p * p - c1 * p * p,
    outCirc: (p) => Math.sqrt(1 - Math.pow(p - 1, 2)),
    // The house curves. Prefer these over the generic ones.
    snap: bezier(0.2, 0, 0, 1),        // fast out, long settle — UI entrances
    glide: bezier(0.65, 0, 0.35, 1),   // symmetric — camera moves, morphs
    anticip: bezier(0.5, -0.35, 0.25, 1), // small wind-up — playful pops
    bezier,
    spring,
  };
  const E = (e) => (typeof e === 'function' ? e : M.ease[e || 'snap'] || M.ease.snap);

  /** eased 0..1 progress of t across [t0, t1] */
  M.tw = (t, t0, t1, ease) => E(ease)(clamp((t - t0) / (t1 - t0 || 1e-9)));
  /** staggered progress for item i */
  M.stagger = (t, t0, i, each, dur, ease) => M.tw(t, t0 + i * each, t0 + i * each + dur, ease);
  /**
   * keyframes: [[time, value, ease?], ...] — value may be number, array, color, or object.
   * The ease on a keyframe shapes the segment arriving at it.
   */
  M.keys = (t, frames) => {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1, e] = frames[i];
      if (t < t1) {
        const [t0, v0] = frames[i - 1];
        return M.mix(v0, v1, M.tw(t, t0, t1, e));
      }
    }
    return frames[frames.length - 1][1];
  };

  // ---------- randomness (seeded only) ----------
  M.rand = (seed = 1) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash = (n, s) => {
    let x = Math.imul((n | 0) ^ (s * 0x9e3779b1), 0x85ebca6b);
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
  /** smooth 1D value noise in 0..1 */
  M.noise = (x, seed = 0) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i, seed), hash(i + 1, seed), u);
  };

  // ---------- color ----------
  const parseColor = (c) => {
    c = c.trim();
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = [...h].map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    return [0, 0, 0, 1];
  };
  M.mixColor = (a, b, p) => {
    const A = parseColor(a), B = parseColor(b);
    const r = A.map((v, i) => lerp(v, B[i], p));
    return `rgba(${r[0] | 0},${r[1] | 0},${r[2] | 0},${+r[3].toFixed(3)})`;
  };

  // ---------- DOM helpers ----------
  M.$ = (s, root = document) => (typeof s === 'string' ? root.querySelector(s) : s);
  M.$$ = (s, root = document) => [...root.querySelectorAll(s)];
  /**
   * Apply transform/opacity/filter shorthands in one call.
   * M.set(el, { x, y, s, sx, sy, r, o, blur, w, h, radius, bg, color, clip })
   */
  M.set = (el, v) => {
    el = M.$(el);
    if (!el) return;
    const st = el.style;
    if ('x' in v || 'y' in v || 's' in v || 'sx' in v || 'sy' in v || 'r' in v || 'z' in v) {
      const s = v.s ?? 1;
      st.transform =
        `translate(${v.x || 0}px,${v.y || 0}px)` +
        ` rotate(${v.r || 0}deg) scale(${(v.sx ?? 1) * s},${(v.sy ?? 1) * s})`;
    }
    if ('o' in v) st.opacity = v.o;
    if ('blur' in v) st.filter = v.blur > 0.01 ? `blur(${v.blur}px)` : 'none';
    if ('w' in v) st.width = v.w + 'px';
    if ('h' in v) st.height = v.h + 'px';
    if ('radius' in v) st.borderRadius = v.radius + 'px';
    if ('bg' in v) st.background = v.bg;
    if ('color' in v) st.color = v.color;
    if ('clip' in v) st.clipPath = v.clip;
    if ('vis' in v) st.visibility = v.vis ? 'visible' : 'hidden';
  };
  /**
   * split text into spans for per-char / per-word animation. Returns the leaf spans in reading order.
   * Text nodes are split in place, so inline markup (<span class="accent">, <b>, …) survives.
   */
  M.split = (el, mode = 'chars') => {
    el = M.$(el);
    el.setAttribute('aria-label', el.textContent);
    const leaves = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((word) => {
        if (!word) return;
        if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(word)); return; }
        const w = document.createElement('span');
        w.style.display = 'inline-block';
        w.style.whiteSpace = 'nowrap';
        if (mode === 'words') { w.textContent = word; leaves.push(w); }
        else for (const ch of word) {
          const c = document.createElement('span');
          c.style.display = 'inline-block';
          c.textContent = ch;
          w.appendChild(c);
          leaves.push(c);
        }
        frag.appendChild(w);
      });
      node.parentNode.replaceChild(frag, node);
    }
    return leaves;
  };

  // ---------- composition ----------
  let stage;
  M.comp = (opts = {}) => {
    const o = Object.assign({ fps: 60, duration: 10, formats: ['16x9'], bg: '#0b0b0c' }, opts);
    const fmt = qs.get('format') || o.format || o.formats[0];
    const size = (o.size && o.size[fmt]) || FORMATS[fmt] || [o.width || 1920, o.height || 1080];
    M.W = size[0]; M.H = size[1];
    M.fps = +qs.get('fps') || o.fps;
    M.duration = o.duration;
    M.format = fmt;
    M.portrait = M.H > M.W;
    M.bpm = o.bpm || 120;
    stage = document.getElementById('stage');
    if (!stage) { stage = document.createElement('div'); stage.id = 'stage'; document.body.prepend(stage); }
    Object.assign(stage.style, {
      position: 'relative', overflow: 'hidden', width: M.W + 'px', height: M.H + 'px', background: o.bg,
    });
    stage.dataset.format = fmt;
    document.documentElement.dataset.format = fmt;
    document.documentElement.style.setProperty('--W', M.W + 'px');
    document.documentElement.style.setProperty('--H', M.H + 'px');
    window.__comp = { width: M.W, height: M.H, fps: M.fps, duration: M.duration, format: fmt, formats: o.formats };
    return M;
  };
  M.stage = () => stage;

  /** register a scene: fn(p 0..1, localT, t) runs only while active; el is display:none outside it */
  M.scene = (name, start, end, fn, el) => {
    M._scenes.push({ name, start, end, fn: fn || (() => {}), el: el ? M.$(el) : null });
    return M;
  };
  M.on = (fn) => { M._on.push(fn); return M; };
  /** block first frame on async work (asset loads, data fetches) */
  M.wait = (p) => { M._tasks.push(p); return p; };
  /** declare a sound-effect cue; engine writes these to audio/cues.json for the score */
  M.cue = (t, type, opts = {}) => {
    if (!M._cues.some((c) => c.type === type && Math.abs(c.t - t) < 1e-3)) M._cues.push({ t: +t.toFixed(4), type, ...opts });
    return t;
  };

  /** register a <video> to be frame-synced: plays from comp time `start` */
  M.video = (el, start = 0, rate = 1) => {
    el = M.$(el);
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.pause();
    M._videos.push({ el, start, rate });
    M.wait(new Promise((r) => (el.readyState >= 2 ? r() : el.addEventListener('loadeddata', r, { once: true }))));
    return el;
  };

  // ---------- beats ----------
  /** load audio/beats.json written by `npm run score` (falls back to a clean grid at comp bpm) */
  M.loadBeats = (url = 'audio/beats.json') =>
    M.wait(fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((b) => {
      M.beats = b || null;
      return b;
    }));
  /** time of beat n (0-based). Fractions allowed: M.beat(3.5) = the "and" of beat 4. */
  M.beat = (n) => {
    const b = M.beats;
    const bpm = (b && b.bpm) || M.bpm;
    const off = (b && b.offset) || 0;
    return off + (n * 60) / bpm;
  };
  M.bar = (n, beatsPerBar = 4) => M.beat(n * beatsPerBar);

  // ---------- seek ----------
  function apply(t) {
    M.t = t;
    for (const s of M._scenes) {
      const active = t >= s.start && t < s.end;
      // display (not visibility): children that set visibility:visible would leak through a hidden parent
      if (s.el) s.el.style.display = active ? '' : 'none';
      if (active) s.fn(clamp((t - s.start) / (s.end - s.start)), t - s.start, t);
    }
    for (const f of M._on) f(t);
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t * 1000;
    }
  }
  function syncVideo(v, t) {
    const el = v.el;
    const dur = isFinite(el.duration) ? el.duration : 1e9;
    const target = clamp((t - v.start) * v.rate, 0, Math.max(0, dur - 0.001));
    if (Math.abs(el.currentTime - target) < 1e-4) return Promise.resolve();
    return new Promise((r) => {
      el.addEventListener('seeked', r, { once: true });
      el.currentTime = target;
    });
  }
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  M.seek = async (t) => {
    apply(t);
    if (M._videos.length) await Promise.all(M._videos.map((v) => syncVideo(v, t)));
    await raf();
  };
  window.__seek = M.seek;
  // sweep the whole timeline (no paint) so every scene gets to register its cues
  window.__cues = () => {
    const keep = M.t;
    for (let f = 0, n = Math.ceil(M.duration * M.fps); f < n; f++) apply(f / M.fps);
    apply(keep);
    return M._cues.slice().sort((a, b) => a.t - b.t);
  };
  window.__scenes = () => M._scenes.map(({ name, start, end }) => ({ name, start, end }));

  window.__ready = new Promise((resolve) => {
    const boot = async () => {
      if (!window.__comp) M.comp({});
      await Promise.all(M._tasks);
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((img) =>
          img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })));
      await M.seek(0);
      resolve(window.__comp);
      if (!RENDER) dev();
    };
    if (document.readyState === 'complete') setTimeout(boot, 0);
    else window.addEventListener('load', boot);
  });

  // ---------- render-mode page chrome ----------
  const css = document.createElement('style');
  css.textContent = RENDER
    ? 'html,body{margin:0;padding:0;overflow:hidden;background:#000}#stage{position:absolute!important;left:0;top:0}'
    : `html,body{margin:0;height:100%;background:#141416;overflow:hidden;font:12px/1.2 ui-monospace,Menlo,Consolas,monospace}
       #__wrap{position:absolute;left:50%;top:calc(50% - 26px);transform-origin:0 0;box-shadow:0 30px 80px rgba(0,0,0,.5)}
       #__bar{position:fixed;left:0;right:0;bottom:0;height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;
         background:#0d0d0f;color:#cfcfd4;border-top:1px solid #26262b;z-index:9;user-select:none}
       #__bar button{background:#222228;color:#eee;border:1px solid #33333a;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit}
       #__track{position:relative;flex:1;height:22px;cursor:pointer}
       #__track .rail{position:absolute;left:0;right:0;top:10px;height:3px;background:#2b2b31;border-radius:2px}
       #__track .fill{position:absolute;left:0;top:10px;height:3px;background:#e8e8ec;border-radius:2px}
       #__track .tick{position:absolute;top:6px;width:1px;height:11px;background:#46464f}
       #__track .tick.db{background:#8a8a96;height:15px;top:4px}
       #__track .sc{position:absolute;top:0;height:4px;border-radius:2px;opacity:.55}
       #__fmt a{color:#9a9aa6;margin-right:8px;text-decoration:none}#__fmt a.on{color:#fff}`;
  document.head.appendChild(css);

  // ---------- dev player ----------
  function dev() {
    const wrap = document.createElement('div');
    wrap.id = '__wrap';
    stage.parentNode.insertBefore(wrap, stage);
    wrap.appendChild(stage);
    const fit = () => {
      const s = Math.min((innerWidth - 48) / M.W, (innerHeight - 52 - 48) / M.H);
      wrap.style.transform = `scale(${s}) translate(-50%,-50%)`;
    };
    fit();
    addEventListener('resize', fit);

    const bar = document.createElement('div');
    bar.id = '__bar';
    const fmts = (window.__comp.formats || []).map((f) => {
      const u = new URL(location.href); u.searchParams.set('format', f);
      return `<a href="${u}" class="${f === M.format ? 'on' : ''}">${f}</a>`;
    }).join('');
    bar.innerHTML = `<button id="__play">▶</button><span id="__time">0.00s</span>
      <div id="__track"><div class="rail"></div><div class="fill"></div></div>
      <span id="__scene"></span><span id="__fmt">${fmts}</span>`;
    document.body.appendChild(bar);
    const track = bar.querySelector('#__track'), fill = bar.querySelector('.fill');
    const timeEl = bar.querySelector('#__time'), sceneEl = bar.querySelector('#__scene');
    const playBtn = bar.querySelector('#__play');

    // beat ticks + scene spans on the scrubber
    const D = M.duration;
    if (M.beats && M.beats.beats) {
      const down = new Set((M.beats.downbeats || []).map((x) => x.toFixed(3)));
      for (const b of M.beats.beats) {
        if (b > D) break;
        const k = document.createElement('div');
        k.className = 'tick' + (down.has(b.toFixed(3)) ? ' db' : '');
        k.style.left = (b / D) * 100 + '%';
        track.appendChild(k);
      }
    }
    M._scenes.forEach((s, i) => {
      const k = document.createElement('div');
      k.className = 'sc';
      k.title = s.name;
      k.style.left = (s.start / D) * 100 + '%';
      k.style.width = ((s.end - s.start) / D) * 100 + '%';
      k.style.background = `hsl(${(i * 67) % 360} 70% 60%)`;
      track.appendChild(k);
    });

    const audio = new Audio('audio/mix.wav');
    let hasAudio = false;
    audio.addEventListener('canplay', () => (hasAudio = true), { once: true });
    audio.addEventListener('error', () => (hasAudio = false));

    let t = 0, playing = false, last = 0;
    const show = () => {
      apply(t);
      for (const v of M._videos) syncVideo(v, t);
      fill.style.width = (t / D) * 100 + '%';
      timeEl.textContent = `${t.toFixed(2)}s  f${Math.round(t * M.fps)}`;
      const s = M._scenes.find((x) => t >= x.start && t < x.end);
      sceneEl.textContent = s ? s.name : '';
    };
    const play = (on) => {
      playing = on;
      playBtn.textContent = on ? '❚❚' : '▶';
      last = performance.now();
      if (hasAudio) { audio.currentTime = t; on ? audio.play().catch(() => {}) : audio.pause(); }
    };
    const loop = (now) => {
      if (playing) {
        t += (now - last) / 1000;
        last = now;
        if (t >= D) { t = 0; if (hasAudio) audio.currentTime = 0; }
        if (hasAudio && Math.abs(audio.currentTime - t) > 0.08) t = audio.currentTime;
        show();
      }
      requestAnimationFrame(loop);
    };
    const scrub = (e) => {
      const r = track.getBoundingClientRect();
      t = clamp((e.clientX - r.left) / r.width) * D;
      if (hasAudio) audio.currentTime = t;
      show();
    };
    track.addEventListener('pointerdown', (e) => {
      scrub(e);
      const mv = (ev) => scrub(ev);
      addEventListener('pointermove', mv);
      addEventListener('pointerup', () => removeEventListener('pointermove', mv), { once: true });
    });
    playBtn.onclick = () => play(!playing);
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); play(!playing); }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const step = e.shiftKey ? 1 : 1 / M.fps;
        t = clamp(t + (e.code === 'ArrowRight' ? step : -step), 0, D - 1 / M.fps);
        if (hasAudio) audio.currentTime = t;
        show();
      }
      if (e.code === 'Home') { t = 0; show(); }
    });
    const start = +qs.get('t');
    if (start) { t = start; show(); }
    requestAnimationFrame(loop);
    if (qs.has('autoplay')) play(true);
  }

  window.M = M;
})();
