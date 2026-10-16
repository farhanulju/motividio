// The in-page runtime, loaded into a bare VM context: math, eases, keyframes, color, seeded randomness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../engine/runtime.js', import.meta.url), 'utf8');
function loadRuntime() {
  // just enough DOM for the runtime to load; boot never runs ('load' never fires here)
  const el = () => ({
    style: { setProperty() {} }, dataset: {}, children: [], appendChild() {}, prepend() {}, append() {},
    setAttribute() {}, addEventListener() {}, querySelector: () => null, classList: { add() {}, remove() {} },
  });
  const ctx = {
    console, URLSearchParams, setTimeout, Math, Promise,
    location: { search: '?render=1' },
    document: {
      readyState: 'loading', addEventListener() {}, getAnimations: () => [], createElement: el, getElementById: () => null,
      head: el(), body: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [],
    },
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.M;
}
const M = loadRuntime();
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('every named ease starts at 0 and ends at 1', () => {
  for (const [name, fn] of Object.entries(M.ease)) {
    if (name === 'spring' || name === 'bezier') continue;
    close(fn(0), 0, 1e-4);
    close(fn(1), 1, 1e-4);
  }
});

test('M.tw clamps and eases', () => {
  assert.equal(M.tw(-1, 0, 1, 'linear'), 0);
  assert.equal(M.tw(5, 0, 1, 'linear'), 1);
  close(M.tw(0.5, 0, 1, 'linear'), 0.5);
  assert.ok(M.tw(0.5, 0, 1, 'outExpo') > 0.9);
});

test('unknown ease names throw instead of silently becoming snap', () => {
  assert.throws(() => M.tw(0.5, 0, 1, 'snapp'), /unknown "snapp"/);
});

test('passing a factory as an ease throws with a hint', () => {
  assert.throws(() => M.tw(0.5, 0, 1, M.ease.spring), /factory/);
  assert.throws(() => M.tw(0.5, 0, 1, M.ease.bezier), /factory/);
});

test("'spring(b)' and 'bezier(...)' strings resolve, springs overshoot", () => {
  const s = M.easeFn('spring(0.5)');
  let peak = 0;
  for (let p = 0; p <= 1; p += 0.01) peak = Math.max(peak, s(p));
  assert.ok(peak > 1.01, 'a bouncy spring overshoots');
  close(s(1), 1);
  close(M.easeFn('bezier(0.2,0,0,1)')(1), 1);
  close(M.easeFn('spring')(1), 1);
});

test('M.keys interpolates numbers, arrays and colors with per-segment eases', () => {
  const k = [[0, 0], [1, 10, 'linear'], [2, 10]];
  assert.equal(M.keys(-1, k), 0);
  close(M.keys(0.5, k), 5);
  assert.equal(M.keys(3, k), 10);
  assert.deepEqual(M.keys(0.5, [[0, [0, 0]], [1, [2, 4], 'linear']]), [1, 2]);
  assert.equal(M.keys(0.5, [[0, '#000000'], [1, '#ffffff', 'linear']]), 'rgba(127,127,127,1)');
});

test('M.stagger offsets each item', () => {
  assert.equal(M.stagger(0.1, 0, 2, 0.1, 0.5, 'linear'), 0);
  close(M.stagger(0.45, 0, 2, 0.1, 0.5, 'linear'), 0.5);
});

test('M.rand is deterministic per seed', () => {
  const a = M.rand(42), b = M.rand(42), c = M.rand(7);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
});

test('M.noise is smooth and seeded', () => {
  close(M.noise(3), M.noise(3));
  assert.ok(Math.abs(M.noise(3.001) - M.noise(3)) < 0.01);
});
