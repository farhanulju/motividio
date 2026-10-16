/*
 * Motividio stage3d — a deterministic three.js stage for comps (ES module, load after runtime.js).
 * Everything the 3D films kept rebuilding: renderer setup, environment lighting, frame-pinned animation,
 * loaders that block frame 0, and skipping GPU work during the cue sweep.
 *
 *   <script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js",
 *                             "three/addons/":"/node_modules/three/examples/jsm/"}}</script>
 *   <script type="module">
 *     import { THREE, stage3d } from '/engine/stage3d.js';
 *     const s = stage3d({ fov: 35, exposure: 1.05 });
 *     const model = await s.load(new GLTFLoader(), 'assets/thing.glb');   // blocks frame 0 via M.wait
 *     s.scene.add(model.scene);
 *     const walk = s.clip(model.scene, model.animations[0]);               // pinned to comp time
 *     s.frame((t) => {                                                     // runs every frame, sweep included
 *       walk(t - 1.0);                                                     // clip time = comp time − start
 *       s.camera.position.set(...);                                       // pose everything from t
 *     });
 *   </script>
 *
 * Rules it enforces: pixel ratio 1 at comp size, preserveDrawingBuffer (screenshots see the frame),
 * no clocks (mixers are set to absolute times), and the draw is skipped while M.sweeping.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export { THREE };

/**
 * @param {object} o
 *   parent    element to hold the canvas (default the stage; prepended, so DOM overlays sit on top)
 *   fov, near, far   camera
 *   exposure  ACES tone-mapping exposure
 *   shadows   soft shadow maps (default true)
 *   env       'room' (PMREM RoomEnvironment) | a THREE.Scene to bake | null
 *   envIntensity, bg (CSS color or null for transparent)
 */
export function stage3d({ parent, fov = 35, near = 0.05, far = 500, exposure = 1, shadows = true, env = 'room', envIntensity = 1, bg = null } = {}) {
  const M = window.M;
  const W = M.W, H = M.H;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`;
  (parent || M.stage()).prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: bg === null, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  // a lost GPU context must stop the render loudly, never ship black frames
  canvas.addEventListener('webglcontextlost', () => console.error('WebGL context lost (GPU crash) — frames after this would be black'));

  const scene = new THREE.Scene();
  if (bg) scene.background = new THREE.Color(bg);
  if (env) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env === 'room' ? new RoomEnvironment() : env, 0.04).texture;
    scene.environmentIntensity = envIntensity;
    pm.dispose();
  }
  const camera = new THREE.PerspectiveCamera(fov, W / H, near, far);

  let composer = null;
  const frames = [];
  M.on((t) => {
    for (const fn of frames) fn(t);
    if (M.sweeping) return; // the cue sweep visits every frame; posing is cheap, drawing isn't
    if (composer) composer.render(); else renderer.render(scene, camera);
  });

  return {
    THREE, renderer, scene, camera, canvas,
    /** fn(t) poses the scene for comp time t; runs every frame (also during the cue sweep, for M.cue) */
    frame(fn) { frames.push(fn); return this; },
    /** draw through an EffectComposer instead (bloom, bokeh, …); add an OutputPass last */
    useComposer(c) { composer = c; return this; },
    /** load with any three loader; frame 0 waits for it and a failure is reported as a load problem */
    load(loader, url) {
      return M.wait(loader.loadAsync(url).catch((e) => { throw new Error(`3D asset failed to load: ${url} — ${e?.message || e}`); }));
    },
    /** pin an AnimationClip to comp time: returns (clipTime, weight = 1) => void. Loops unless loop: false */
    clip(root, clip, { loop = true } = {}) {
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(clip);
      action.play();
      return (time, weight = 1) => {
        const d = clip.duration || 1;
        action.enabled = weight > 0;
        action.setEffectiveWeight(weight);
        action.time = loop ? ((time % d) + d) % d : Math.min(Math.max(0, time), d);
        mixer.update(0);
      };
    },
    /** standard key/rim/fill rig; returns the lights so scenes can move them */
    lights({ key = 0xffe3c8, keyI = 2.6, rim = 0x9cc0ff, rimI = 1.6, fill = 0.35, size = 4 } = {}) {
      const k = new THREE.DirectionalLight(key, keyI);
      k.position.set(2.2, 3.6, 2.8);
      if (shadows) {
        k.castShadow = true;
        k.shadow.mapSize.set(2048, 2048);
        Object.assign(k.shadow.camera, { left: -size, right: size, top: size, bottom: -size });
        k.shadow.bias = -0.0004; k.shadow.normalBias = 0.02; k.shadow.radius = 6;
      }
      const r = new THREE.DirectionalLight(rim, rimI);
      r.position.set(-2.8, 2.6, -2.4);
      const h = new THREE.HemisphereLight(0xfff2e2, 0x2a2f48, fill);
      scene.add(k, k.target, r, h);
      return { key: k, rim: r, fill: h };
    },
  };
}
