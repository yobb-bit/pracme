// Exercises arena.js's animation maths with a fake THREE, so the poses can be
// checked without a browser or a GPU.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ARENA = join(dirname(fileURLToPath(import.meta.url)), '..', 'arena.js');
const src = readFileSync(ARENA, 'utf8');

// Pull the animation section out of arena.js and run it against stubs.
const start = src.indexOf('function prefersReducedMotion()');
const end = src.indexOf('/* ==========================================================================\n   8. SMALL UI');
const section = src.slice(start, end);
console.log(`animation section: ${section.split('\n').length} lines`);

// --- stubs -------------------------------------------------------------
let now = 0;
globalThis.performance = { now: () => now };
globalThis.window = { matchMedia: () => ({ matches: false }) };

class V3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
}
class Color {
  constructor(c) { this.hex = c; }
  clone() { return new Color(this.hex); }
  copy(c) { this.hex = c.hex; return this; }
  lerp(c, t) { this.hex = (this.hex & 0xffffff) + t * ((c.hex & 0xffffff) - (this.hex & 0xffffff)); return this; }
  set(hex) { this.hex = hex; }
  setHex(h) { this.hex = h; }
}
const THREE = { Color, Vector3: V3, MathUtils: { degToRad: (d) => d * Math.PI / 180 } };
const LOOK = JSON.parse(JSON.stringify({
  motion: {
    bobHeight: 0.03, bobSpeed: 1.7,
    lunge: { distance: 0.5, ms: 300 },
    recoil: { distance: 0.28, ms: 260 },
    flinch: { shake: 0.07, shakeMs: 380, tilt: 0.13, tiltMs: 320 },
    flashMs: 240,
    down: { tilt: 1.35, drop: 0.34, ms: 850 },
    downGrey: 0x6b7280,
  },
  floorY: 0,
}));

function mat() {
  return {
    uuid: Math.random().toString(36).slice(2),
    color: new Color(0xffffff),
    emissive: new Color(0x000000),
    emissiveIntensity: 0.5,
    emissiveMap: { texture: true },
    transparent: false, opacity: 1, depthWrite: true,
    needsUpdate: false,
  };
}
function actor(x) {
  const materials = [mat(), mat()];
  return {
    group: { position: new V3(x, 0, 0) },
    root: { rotation: { x: 0, y: 1.5708, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, position: new V3(0.1, -0.02, 0.3) },
    materials,
    shadow: { material: (() => { const m = mat(); m.transparent = true; m.opacity = 0.38; return m; })() },
    restYaw: 1.5708,
    restPosition: new V3(0.1, -0.02, 0.3),
    base: { x, y: 0, z: 0 },
    motions: [],
    isDown: false,
  };
}

const view = { actors: { player: actor(-1.7), villain: actor(1.7) } };

// --- run the real code, with window/LOOK/view injected ------------------
const factory = new Function('THREE', 'LOOK', 'view', 'window', 'performance', section + `
  return { stepAnimations, settle, prefersReducedMotion, lunge, flinch, knockDown, celebrate, revive, greyOut, flash };
`);
const A = factory(THREE, LOOK, view, globalThis.window, globalThis.performance);

const frame = (ms) => { now = ms; A.stepAnimations(); };
const round = (n) => Math.round(n * 1000) / 1000;
let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

// 1. idle bob -----------------------------------------------------------
const ys = [];
for (let t = 0; t <= 1200; t += 100) { frame(t); ys.push(view.actors.player.group.position.y); }
check('idle bob moves', new Set(ys.map(round)).size > 3, `y range ${round(Math.min(...ys))}..${round(Math.max(...ys))}`);
check('bob stays small', Math.max(...ys.map(Math.abs)) <= LOOK.motion.bobHeight, `max |y| ${round(Math.max(...ys.map(Math.abs)))}`);
// a continuous sine: never exactly 0 again, but it must stay in range and swing both ways
let lo = Infinity, hi = -Infinity;
for (let t = 0; t <= 2000; t += 20) { frame(t); const y = view.actors.player.group.position.y; lo = Math.min(lo, y); hi = Math.max(hi, y); }
check('bob swings both ways', lo < -0.005 && hi > 0.005, `range ${round(lo)}..${round(hi)}`);

// 2. lunge --------------------------------------------------------------
A.lunge('player');
let peak = 0;
for (let t = 1300; t <= 1600; t += 20) { frame(t); peak = Math.min(peak, view.actors.player.group.position.z); }
check('player lunges forward (-z)', peak < -0.3, `min z ${round(peak)}`);
frame(2000);
check('lunge returns home', round(view.actors.player.group.position.z) === 0, `z=${round(view.actors.player.group.position.z)}`);

// 3. flinch: recoil + shake + flash -------------------------------------
A.flinch('villain', 0xffffff);
frame(2100);
check('flash clears the texture', view.actors.villain.materials.every(m => m.emissiveMap === null));
check('flash colour set', view.actors.villain.materials.every(m => m.emissive.hex === 0xffffff));
let maxShakeX = 0;
let maxTilt = 0;
for (let t = 2200; t <= 2500; t += 20) {
  frame(t);
  maxShakeX = Math.max(maxShakeX, Math.abs(view.actors.villain.group.position.x - view.actors.villain.base.x));
  maxTilt = Math.max(maxTilt, Math.abs(view.actors.villain.root.rotation.x));
}
check('villain shakes sideways', maxShakeX > 0.02, `max dx ${round(maxShakeX)}`);
check('shake damps out', round(view.actors.villain.group.position.x) === round(view.actors.villain.base.x), `x=${round(view.actors.villain.group.position.x)}`);
check('villain leans back', maxTilt > 0.05, `max tilt ${round(maxTilt)}`);
frame(2600);
check('lean resets', round(view.actors.villain.root.rotation.x) === 0);
check('texture restored', view.actors.villain.materials.every(m => m.emissiveMap && m.emissiveMap.texture));
check('emissive restored', view.actors.villain.materials.every(m => m.emissive.hex === 0x000000 && m.emissiveIntensity === 0.5));
check('flash re-armed', view.actors.villain.flashing === false);

// 4. knock-down ---------------------------------------------------------
A.knockDown('player');
frame(2700);
check('marked as down', view.actors.player.isDown === true);
check('grey applied', view.actors.player.materials.every(m => m.color.hex !== 0xffffff));
for (let t = 2800; t <= 3700; t += 25) frame(t);
const p = view.actors.player;
check('tipped over backwards', round(p.root.rotation.x) === round(-LOOK.motion.down.tilt), `rotX=${round(p.root.rotation.x)}`);
check('dropped by drop amount', round(p.root.position.y) === round(p.restPosition.y - LOOK.motion.down.drop), `y=${round(p.root.position.y)} rest=${round(p.restPosition.y)}`);
check('stays down after fall', p.isDown === true);
const bobOff = [];
for (let t = 3800; t <= 4200; t += 100) { frame(t); bobOff.push(round(p.group.position.y)); }
check('bob stops when down', new Set(bobOff).size === 1, `y=${bobOff[0]}`);

// 5. revive -------------------------------------------------------------
A.revive('player');
frame(4300);
check('upright again', round(p.root.rotation.x) === 0 && round(p.root.rotation.z) === 0);
check('rest position restored', round(p.root.position.y) === round(p.restPosition.y) && round(p.root.position.x) === round(p.restPosition.x));
check('rest yaw restored', round(p.root.rotation.y) === round(p.restYaw));
check('colour restored', p.materials.every(m => m.color.hex === 0xffffff), `hexes ${p.materials.map(m => m.color.hex)}`);
check('no longer down', p.isDown === false);
check('motions cleared', p.motions.length === 0);

// 6. defeat + fade ------------------------------------------------------
A.celebrate('villain');
const v = view.actors.villain;
const shadowOpacity = v.shadow.material.opacity;
for (let t = 4400; t <= 5300; t += 25) frame(t);
check('tips forwards at your feet', round(v.root.rotation.x) === round(LOOK.motion.down.tilt), `rotX=${round(v.root.rotation.x)}`);
check('model faded out', v.materials.every(m => round(m.opacity) === 0));
check('materials transparent', v.materials.every(m => m.transparent === true));
check('depthWrite off', v.materials.every(m => m.depthWrite === false));
check('shadow faded too', round(v.shadow.material.opacity) === 0, `was ${shadowOpacity}`);

// 7. rematch brings him back -------------------------------------------
A.revive('villain');
frame(5400);
check('visible again', v.materials.every(m => m.transparent === false && m.opacity === 1 && m.depthWrite === true));
check('shadow opacity restored', round(v.shadow.material.opacity) === round(shadowOpacity), `${round(v.shadow.material.opacity)} vs ${shadowOpacity}`);
check('upright', round(v.root.rotation.x) === 0 && round(v.root.rotation.z) === 0);
check('back on his mark', round(v.group.position.x) === round(v.base.x));

// 8. reduced motion ----------------------------------------------------
globalThis.window.matchMedia = () => ({ matches: true });
check('reduced motion detected', A.prefersReducedMotion() === true);
const r = actor(-1.7);
view.actors.player = r;
A.lunge('player');
A.flinch('player', 0xff0000);
A.knockDown('player');
frame(5500);
check('no lunge movement', round(r.group.position.z) === 0 && round(r.group.position.x) === round(r.base.x));
check('no bob', round(r.group.position.y) === 0);
check('no tilt', round(r.root.rotation.x) === 0 && round(r.root.rotation.z) === 0);
check('no flash', r.materials.every(m => m.emissiveMap && m.emissiveMap.texture), 'texture still on');
check('still greyed out', r.materials.every(m => m.color.hex !== 0xffffff));

const d = actor(1.7);
view.actors.villain = d;
A.celebrate('villain');
check('defeat: no tipping', round(d.root.rotation.x) === 0 && round(d.root.rotation.z) === 0);
check('defeat: faint, not gone', d.materials.every(m => m.opacity > 0 && m.opacity < 1), `op ${round(d.materials[0].opacity)}`);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
