/*
 * Motividio Cube3D — a real 3×3 Rubik's cube in CSS 3D (27 cubies), driven by move notation.
 * Stateless: every frame recomputes the cube from solved by replaying moves up to a progress k,
 * so it is safe for parallel, out-of-order frame rendering. Load after runtime.js.
 *
 *   const c = Cube3D.create({ parent: '#slot', size: 360, style: 'stickered' | 'stickerless' });
 *   const moves = Cube3D.parse("R U R' U' F2");
 *   M.on(t => {
 *     c.pose({ rx: -28, ry: -38 });                 // whole-cube orientation (deg), x/y offset, s scale
 *     c.play(moves, k);                             // k = moves done (float; 2.5 = halfway through the 3rd)
 *   });
 *   // a real solve of a scramble: Cube3D.invert(scramble) — play scramble fully then the inverse.
 *   c.play([...scramble, ...Cube3D.invert(scramble)], scramble.length + k)
 *
 * Extras: c.jam(layerMove, amount) wobbles a stuck layer; c.cubie(i) returns a cubie element (to pop it out).
 */
(function () {
  'use strict';
  const M = window.M;
  const COLORS = { U: '#f6f4ee', D: '#ffd23f', F: '#18b85a', B: '#1f5fe0', R: '#e5322d', L: '#ff8a1f' };
  // math coords: x right, y up, z toward viewer (right-handed)
  const MOVES = {
    R: ['x', 1, -1], L: ['x', -1, 1], U: ['y', 1, -1], D: ['y', -1, 1], F: ['z', 1, -1], B: ['z', -1, 1],
    M: ['x', 0, 1], E: ['y', 0, 1], S: ['z', 0, -1],
  };
  const rot = (axis, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
    if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  };
  const mul = (A, B) => {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return o;
  };
  const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const snap = (A) => A.map((v) => Math.round(v));

  /** "R U2 F' x" → [{face:'R', turns:1}, ...] (outer face moves + slices) */
  function parse(str) {
    return str.trim().split(/\s+/).filter(Boolean).map((tok) => {
      const face = tok[0];
      const turns = tok.includes('2') ? 2 : tok.includes("'") ? -1 : 1;
      return { face, turns, tok };
    });
  }
  const invert = (moves) => moves.slice().reverse().map((m) => ({ ...m, turns: m.turns === 2 ? 2 : -m.turns, tok: m.face + (m.turns === 2 ? '2' : m.turns === 1 ? "'" : '') }));
  /** deterministic random scramble of n moves (no same-axis repeats) */
  function scramble(n = 20, seed = 1) {
    const r = M.rand(seed), faces = 'RLUDFB', axis = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
    const out = []; let last = -1, lastFace = '';
    while (out.length < n) {
      const f = faces[Math.floor(r() * 6)];
      if (f === lastFace || (axis[f] === last && r() < 0.7)) continue;
      const k = r(); out.push({ face: f, turns: k < 0.4 ? 1 : k < 0.8 ? -1 : 2 });
      last = axis[f]; lastFace = f;
    }
    out.forEach((m) => (m.tok = m.face + (m.turns === 2 ? '2' : m.turns === -1 ? "'" : '')));
    return out;
  }

  const FACES = [ // name, css transform, home normal (math)
    ['F', 'translateZ(H)', [0, 0, 1]], ['B', 'rotateY(180deg) translateZ(H)', [0, 0, -1]],
    ['R', 'rotateY(90deg) translateZ(H)', [1, 0, 0]], ['L', 'rotateY(-90deg) translateZ(H)', [-1, 0, 0]],
    ['U', 'rotateX(90deg) translateZ(H)', [0, 1, 0]], ['D', 'rotateX(-90deg) translateZ(H)', [0, -1, 0]],
  ];

  function create({ parent, size = 360, gap = 0.035, style = 'stickered', colors = {}, perspective = 2400, plastic, light = [-0.35, 0.75, 0.6] } = {}) {
    const C = Object.assign({}, COLORS, colors);
    const pitch = size / 3, cs = pitch * (1 - gap), H = cs / 2;
    const base = plastic || (style === 'stickerless' ? '#1b1d22' : '#0f1013');
    const outer = document.createElement('div');
    outer.className = 'cube3d';
    outer.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;perspective:${perspective}px;perspective-origin:0 0;`;
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;';
    outer.appendChild(root);
    const cubies = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${-cs / 2}px;top:${-cs / 2}px;width:${cs}px;height:${cs}px;transform-style:preserve-3d;`;
      const faces = [];
      for (const [name, tf, n] of FACES) {
        const f = document.createElement('div');
        const isOuter = (n[0] && n[0] === x) || (n[1] && n[1] === y) || (n[2] && n[2] === z);
        const rad = cs * 0.14;
        f.style.cssText = `position:absolute;inset:0;transform:${tf.replace('H', H + 'px')};backface-visibility:hidden;border-radius:${rad}px;`;
        if (isOuter) {
          if (style === 'stickerless') {
            f.style.background = C[name];
            f.style.boxShadow = `inset 0 0 0 ${cs * 0.03}px rgba(0,0,0,.18), inset ${cs * 0.05}px ${cs * 0.06}px ${cs * 0.12}px rgba(255,255,255,.18)`;
          } else {
            f.style.background = base;
            const s = document.createElement('div');
            s.style.cssText = `position:absolute;inset:${cs * 0.07}px;border-radius:${cs * 0.12}px;background:${C[name]};box-shadow:inset ${cs * 0.04}px ${cs * 0.05}px ${cs * 0.1}px rgba(255,255,255,.22)`;
            f.appendChild(s);
          }
        } else f.style.background = base;
        d.appendChild(f);
        faces.push({ el: f, n, outer: isOuter });
      }
      root.appendChild(d);
      cubies.push({ el: d, home: [x, y, z], faces });
    }
    (parent ? M.$(parent) : M.stage()).appendChild(outer);

    let world = ID, poseV = {};
    const L = (() => { const l = Math.hypot(...light); return light.map((v) => v / l); })();
    const api = {
      el: outer, root, cubies, size,
      /** whole-cube placement: x,y = center in parent px; rx, ry, rz in deg; s scale; o opacity */
      pose({ x = 0, y = 0, rx = -28, ry = -40, rz = 0, s = 1, o = 1 } = {}) {
        poseV = { x, y, rx, ry, rz, s };
        outer.style.transform = `translate(${x}px,${y}px)`; // perspective vanishes at the cube's own center
        root.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale3d(${s},${s},${s})`;
        outer.style.opacity = o;
        // world rotation in math coords for lighting (css y is down → negate x/z angles)
        const r = Math.PI / 180;
        world = mul(mul(rot('x', -rx * r), rot('y', ry * r)), rot('z', -rz * r));
        return api;
      },
      /**
       * play moves up to progress k. opts: { ease, jam: {move, amount}, explode: 0..1, popped: {index, x,y,z,rx,ry} }
       */
      play(moves, k = 0, opts = {}) {
        const ease = M.ease[opts.ease || 'inOutQuad'] || opts.ease;
        const state = cubies.map((c) => ({ p: c.home.slice(), R: ID }));
        const nFull = Math.max(0, Math.min(moves.length, Math.floor(k)));
        const apply = (m, frac) => {
          const def = MOVES[m.face]; if (!def) return;
          const [axis, layer, dir] = def;
          const ai = { x: 0, y: 1, z: 2 }[axis];
          const Rm = rot(axis, dir * m.turns * (Math.PI / 2) * frac);
          for (const s of state) {
            if (Math.round(s.p[ai]) !== layer) continue;
            s.p = mv(Rm, s.p); s.R = mul(Rm, s.R);
            if (frac === 1) { s.p = s.p.map(Math.round); s.R = snap(s.R); }
          }
        };
        for (let i = 0; i < nFull; i++) apply(moves[i], 1);
        if (nFull < moves.length && k > nFull) apply(moves[nFull], ease(k - nFull));
        if (opts.jam) apply(opts.jam.move, opts.jam.amount); // partial wobble of a stuck layer
        state.forEach((s, i) => {
          const c = cubies[i];
          let p = s.p, R = s.R, extra = '';
          if (opts.explode) p = p.map((v) => v * (1 + opts.explode));
          if (opts.popped && opts.popped.index === i) {
            const q = opts.popped;
            extra = ` translate3d(${q.x || 0}px,${-(q.y || 0)}px,${q.z || 0}px) rotateX(${q.rx || 0}deg) rotateY(${q.ry || 0}deg)`;
          }
          // css matrix: flip y (F R F), translation (x, -y, z)
          const a = R;
          const m = [a[0], -a[3], a[6], 0, -a[1], a[4], -a[7], 0, a[2], -a[5], a[8], 0, p[0] * pitch, -p[1] * pitch, p[2] * pitch, 1];
          c.el.style.transform = (extra ? extra + ' ' : '') + `matrix3d(${m.map((v) => +v.toFixed(5)).join(',')})`;
          // lighting per outer face
          const WR = mul(world, R);
          for (const f of c.faces) {
            const n = mv(WR, f.n);
            const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
            f.el.style.filter = `brightness(${(0.62 + 0.5 * Math.max(0, d)).toFixed(3)})`;
          }
        });
        return api;
      },
      /** which cubie index sits at home position [x,y,z] */
      index(x, y, z) { return cubies.findIndex((c) => c.home[0] === x && c.home[1] === y && c.home[2] === z); },
    };
    api.pose({});
    api.play([], 0);
    return api;
  }

  window.Cube3D = { create, parse, invert, scramble, COLORS };
})();
