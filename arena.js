/* ==========================================================================
   arena.js — the 3D stage for Boss Battle (Batman vs the villain)
   --------------------------------------------------------------------------
   This file is the ONLY file that talks to Three.js. It does graphics only:
   no health, no question logic. Those live in health.js / battle.js later.

   How it works, top to bottom:
     1. grab the <canvas> and the labels around it
     2. check the browser can do 3D at all (if not -> emoji fallback)
     3. build an empty scene: camera, lights, floor shadow
     4. load Batman + the chosen villain, fix up size/position/facing
     5. render in a loop, but stop while the tab is hidden

   Loaded as an ES module, so `import` works in a plain <script type="module">.
   The "three" name itself is mapped to a CDN in the import map in index.html.
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTERS, LOOK, getVillain } from './characters.js';


/* ==========================================================================
   1. THE HTML PIECES WE NEED
   ========================================================================== */

// getElementById shortcut
const $ = (id) => document.getElementById(id);

const dom = {
  stage: $('arena-stage'),
  canvas: $('arena-canvas'),
  loading: $('arena-loading'),
  fallback: $('arena-fallback'),
  playerName: $('arena-player-name'),
  villainName: $('arena-villain-name'),
};

// NOTE: we do NOT start the 3D yet — that happens in section 8 at the very
// bottom of this file, once every function and variable below is defined.


/* ==========================================================================
   2. START
   ========================================================================== */

/** Everything the 3D side needs, kept in one place. */
const view = {
  renderer: null,
  scene: null,
  camera: null,
  loader: null,                       // one GLTFLoader reused for every model
  actors: { player: null, villain: null }, // filled in as each model finishes
  villainId: CHARACTERS.villains[0].id,    // Stage 1 shows the easy villain
  stillLoading: 0,                    // how many models are being fetched
  loadId: { player: 0, villain: 0 },  // stops a slow, cancelled load winning
};

function start() {
  if (!supportsWebGL()) {
    showEmojiFallback();
    return;
  }

  buildScene();
  loadPlayer();
  setVillain(view.villainId);
  watchForResize();
  watchForTabHidden();
  watchForThemeChange();
}

/**
 * Does this browser support WebGL?
 * We test by asking for a context on a throwaway canvas, inside try/catch
 * because some browsers throw instead of returning null.
 */
function supportsWebGL() {
  try {
    const test = document.createElement('canvas');
    const ok = Boolean(test.getContext('webgl2') || test.getContext('webgl'));
    if (!ok) console.warn('[arena] WebGL is not available on this device.');
    return ok;
  } catch (error) {
    console.warn('[arena] WebGL check threw:', error);
    return false;
  }
}

/**
 * Plan B for phones/browsers with no 3D: hide the canvas and show big emoji.
 * Everything else in the app keeps working exactly the same.
 */
function showEmojiFallback() {
  dom.canvas.hidden = true;
  dom.loading.hidden = true;
  dom.fallback.hidden = false;
  dom.fallback.innerHTML =
    '<span class="arena__emoji" aria-hidden="true">🦇</span>' +
    '<span class="arena__emoji" aria-hidden="true">⚔️</span>' +
    '<span class="arena__emoji" aria-hidden="true">👾</span>' +
    '<p class="arena__fallback-note">This browser cannot show 3D, so here are the emoji fighters instead.</p>';
}


/* ==========================================================================
   3. THE SCENE
   ========================================================================== */

function buildScene() {
  // --- renderer: the thing that actually draws ---
  view.renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true });

  // Cap the pixel ratio at 2. On a 3x phone screen, drawing 9 pixels for every
  // 1 CSS pixel costs a lot of battery for no visible gain.
  view.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  // --- scene: the empty "world" ---
  view.scene = new THREE.Scene();
  view.scene.background = new THREE.Color(themeBackground());

  // --- camera: what we look at it through ---
  view.camera = new THREE.PerspectiveCamera(LOOK.camera.fov, 1, 0.1, 100);
  view.camera.position.set(0, LOOK.camera.y, LOOK.camera.z);
  view.camera.lookAt(0, LOOK.camera.lookAtY, 0);

  addLights();
  view.loader = new GLTFLoader();

  resize(); // do it once now so the very first frame is already correct

  // setAnimationLoop is the recommended way to run 3D, and it gives us one
  // obvious place to pause when the tab is hidden (section 6).
  view.renderer.setAnimationLoop(draw);
}

/** One frame. The idle bob and any running animations are stepped here. */
function draw() {
  if (!view.renderer) return;

  stepAnimations();
  view.renderer.render(view.scene, view.camera);
}

/**
 * Lights on purpose:
 *  - a hemisphere light, so nothing is ever pure black (dark suits stay readable)
 *  - a directional "sun" for shape and highlights, plus a weak fill from behind
 */
function addLights() {
  const {
    sky, ground, skyIntensity,
    sunIntensity, sunPosition,
    fillIntensity, fillPosition,
  } = LOOK.lights;

  view.scene.add(new THREE.HemisphereLight(sky, ground, skyIntensity));

  const sun = new THREE.DirectionalLight(0xffffff, sunIntensity);
  sun.position.set(...sunPosition);
  view.scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffffff, fillIntensity);
  fill.position.set(...fillPosition);
  view.scene.add(fill);
}

/**
 * A soft round shadow for a fighter.
 * We fake it with a circle + a radial-gradient picture, because a real shadow
 * map is far more code than this game needs.
 */
function makeShadow() {
  // Draw the gradient into a tiny canvas, then use that canvas as a texture.
  const size = 128;
  const paint = document.createElement('canvas');
  paint.width = paint.height = size;
  const pen = paint.getContext('2d');
  const gradient = pen.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  pen.fillStyle = gradient;
  pen.fillRect(0, 0, size, size);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(LOOK.shadow.radius * 2, LOOK.shadow.radius * 2),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(paint),
      transparent: true,
      opacity: LOOK.shadow.opacity,
      depthWrite: false,
    })
  );

  // A plane starts standing up; lay it flat on the floor, just above y = 0.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = LOOK.floorY + 0.002;
  return mesh;
}


/* ==========================================================================
   4. FIXING UP THE AI-GENERATED MODELS
   --------------------------------------------------------------------------
   These models came from an AI image-to-3D site, so each one has a random
   size, a random spot for its "feet" (its pivot) and a random direction it
   looks in. normaliseModel() fixes all three so the two fighters match up.
   ========================================================================== */

/**
 * Scale to LOOK.targetHeight, stand on the floor, centre it, then turn it.
 *
 * @param {THREE.Object3D} root   the loaded model
 * @param {object} character       the entry from characters.js (for yawOffset)
 * @param {boolean} faceRight      true = look towards +X (the villain's side)
 */
function normaliseModel(root, character, faceRight) {
  // Measure first, before we move anything.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  // 1. Scale so the model is exactly targetHeight tall.
  //    (|| means "if size.y is 0, treat it as 1" so we never divide by zero.)
  const scale = LOOK.targetHeight / (size.y || 1);
  root.scale.setScalar(scale);

  // 2. Move it so it stands ON the floor (y) and is centred (x and z).
  //    Multiplying the centre by the scale cancels out the size we just added.
  root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

  // 3. Turn it to face the other fighter.
  //    A model normally faces +Z. Rotating +90 degrees about Y points it at
  //    +X (right); -90 degrees points it at -X (left).
  const spin = THREE.MathUtils.degToRad(character.yawOffset || 0);
  root.rotation.y = (faceRight ? Math.PI / 2 : -Math.PI / 2) + spin;
}

/**
 * How bright is this texture on average? Answer is 0 (black) to 255 (white).
 * Some AI models come out almost black, so we measure the picture instead of
 * guessing, and only brighten the ones that really need it.
 */
function averageTextureBrightness(texture) {
  const image = texture && texture.image;
  if (!image) return null;

  const size = 32; // a tiny copy is enough for an average
  const paint = document.createElement('canvas');
  paint.width = paint.height = size;
  const pen = paint.getContext('2d');

  try {
    pen.drawImage(image, 0, 0, size, size);
  } catch (error) {
    // Some browsers will not let us draw an ImageBitmap. Not a problem:
    // we just fall back to adding no self-light.
    return null;
  }

  const pixels = pen.getImageData(0, 0, size, size).data;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    total += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  return total / (pixels.length / 4);
}

/**
 * How much self-light should this texture get?
 *   texture darker than selfLightFloor  -> the full LOOK.selfLight
 *   texture brighter than selfLightCutoff -> none at all
 *   anything in between -> a smooth blend of the two
 * Set LOOK.selfLight to 0 to turn self-light off completely.
 */
function selfLightFor(texture) {
  const brightness = averageTextureBrightness(texture);
  if (brightness === null) return 0;

  const span = (LOOK.selfLightCutoff - LOOK.selfLightFloor) || 1;
  const blend = (LOOK.selfLightCutoff - brightness) / span;
  return LOOK.selfLight * THREE.MathUtils.clamp(blend, 0, 1);
}

/**
 * Your "_shaded" .glb files store their picture as an *emissiveMap* and set the
 * base colour to black. Used untouched, the fighters would be flat black
 * cut-outs and the lights would do nothing at all. So we reuse that same
 * picture as the normal colour map, which lets the lights actually shade it.
 *
 * Careful: in the glTF file the field is called "emissiveTexture", but in
 * Three.js the property is called `emissiveMap`. Easy trap.
 *
 * @returns {THREE.Material[]} the new materials, so Stage 3 can tint them for
 *                            the hit flashes.
 */
function colouriseMaterials(root) {
  const result = [];

  root.traverse((thing) => {
    if (!thing.isMesh) return;

    const before = thing.material;
    const list = Array.isArray(before) ? before : [before];

    const after = list.map((material) => {
      if (!material) return null;

      // A baked "shaded" picture saved as emissive -> use it as the colour map.
      if (LOOK.useTextureAsColour && material.emissiveMap && !material.map) {
        material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshStandardMaterial({
          map: material.emissiveMap,
          color: 0xffffff,
          roughness: 0.85,
          metalness: 0,
          side: material.side,   // these files were exported double-sided
          emissive: 0xffffff,
          emissiveMap: material.emissiveMap,
          emissiveIntensity: selfLightFor(material.emissiveMap),
        });
      }

      // A normal PBR texture: just make sure the colours are decoded correctly.
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.roughness = 0.8;
        // Three.js multiplies emissive x emissiveMap, so BOTH have to be set or
        // the self-light does nothing at all.
        material.emissive.setHex(0xffffff);
        material.emissiveMap = material.map;
        material.emissiveIntensity = selfLightFor(material.map);
        material.needsUpdate = true; // we added a new slot, so recompile
        return material;
      }

      // No picture at all: plain matte grey, so the shape is still visible.
      return new THREE.MeshStandardMaterial({
        color: 0x9aa3ad,
        roughness: 0.9,
        side: material.side,
      });
    }).filter(Boolean);

    thing.material = Array.isArray(before) ? after : after[0];
    result.push(...after);
  });

  return result;
}

/**
 * Stand-in for a model that failed to load: a coloured capsule.
 * Better than an empty stage — you can still see who is who.
 */
function makePlaceholder(colour) {
  const group = new THREE.Group();

  // A capsule is centred on its own middle, so lift it by half its height.
  const height = 1.2 + 0.35 * 2;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.2, 8, 16),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 })
  );
  body.position.y = height / 2;

  group.add(body);
  const shadow = makeShadow();
  group.add(shadow);

  return { group, root: body, shadow, materials: [body.material], isPlaceholder: true };
}


/* ==========================================================================
   5. LOADING THE FIGHTERS
   --------------------------------------------------------------------------
   GLTFLoader.load() is callback-based, so loadFighter() wraps it in a Promise.
   That keeps the code below readable: `await`-style .then() chains.
   ========================================================================== */

/**
 * Load one model, fix it up, and add it to the scene at `x`.
 * Only two models are ever in the scene: Batman and the chosen villain.
 *
 * @returns {Promise<object>} the actor ({ group, root, materials, character })
 */
function loadFighter(character, { x, faceRight, placeholderColour }) {
  view.stillLoading += 1;
  setLoadingVisible(true);

  return new Promise((resolve) => {
    const finish = (actor) => {
      view.stillLoading -= 1;
      if (view.stillLoading <= 0) setLoadingVisible(false);
      resolve(actor);
    };

    view.loader.load(
      character.modelPath,

      // --- success ---
      (gltf) => {
        const root = gltf.scene;
        const materials = colouriseMaterials(root);
        normaliseModel(root, character, faceRight);

        // The model goes inside its own group. The group owns the position on
        // the floor, so Stage 3 can slide or tip a fighter over without
        // disturbing the careful maths inside normaliseModel().
        const group = new THREE.Group();
        group.position.set(x, LOOK.floorY, 0);
        group.add(root);

        // Kept so it can fade away with the fighter, instead of leaving a
        // shadow lying on the floor with nobody casting it.
        const shadow = makeShadow();
        group.add(shadow);

        view.scene.add(group);

        finish({
          group,
          root,
          shadow,
          materials,
          character,
          restYaw: root.rotation.y,   // normaliseModel() turned it; keep the value
          // normaliseModel() also shifted the model inside the group to put it
          // on the floor. Animations have to start from that, not from zero.
          restPosition: root.position.clone(),
          motions: [],                // filled in by the animation helpers
          isDown: false,
          isPlaceholder: false,
        });
      },

      // --- progress (unused, but GLTFLoader wants this slot) ---
      undefined,

      // --- failure: name the file and the reason, then use a capsule ---
      (error) => {
        console.error(
          `[arena] Failed to load "${character.modelPath}" for ${character.name}. ` +
          'Check that the file exists and that it is a valid .glb.',
          error
        );

        const placeholder = makePlaceholder(placeholderColour);
        placeholder.group.position.set(x, LOOK.floorY, 0);
        view.scene.add(placeholder.group);

        finish({
          ...placeholder,
          character,
          restYaw: 0,
          restPosition: placeholder.root.position.clone(),
          motions: [],
          isDown: false,
        });
      }
    );
  });
}

/**
 * Remember which load is current for a slot. If you pick a new villain while
 * the old one is still downloading, the old load is thrown away when it
 * arrives instead of overwriting the new villain.
 */
function trackLoad(slot, promise) {
  const myId = ++view.loadId[slot];
  promise.then((actor) => {
    if (view.loadId[slot] !== myId) {   // a newer load already won
      removeGroup(actor.group);
      return;
    }
    view.actors[slot] = actor;
  });
}

function loadPlayer() {
  dom.playerName.textContent = CHARACTERS.player.name;

  trackLoad('player', loadFighter(CHARACTERS.player, {
    x: LOOK.playerX,
    faceRight: true, // Batman looks right, towards the villain
    placeholderColour: LOOK.placeholderColour.player,
  }));
}

/** Show a different villain. Batman stays exactly where he is. */
function setVillain(villainId) {
  const villain = getVillain(villainId);
  if (!villain) {
    console.warn('[arena] Unknown villain id:', villainId);
    return;
  }

  dom.villainName.textContent = villain.name;
  removeActor('villain'); // free the old villain before loading the new one

  trackLoad('villain', loadFighter(villain, {
    x: LOOK.villainX,
    faceRight: false, // the villain looks left, towards Batman
    placeholderColour: LOOK.placeholderColour.villain,
  }));

  view.villainId = villainId;
  // Stage 2 listens for this to refresh its health bar.
  document.dispatchEvent(new CustomEvent('arena:villain-changed', { detail: { villainId } }));
}

/** Delete a group from the scene and free the memory it was using. */
function removeGroup(group) {
  if (!group) return;
  view.scene.remove(group);
  group.traverse((thing) => {
    if (!thing.isMesh) return;
    thing.geometry.dispose(); // free the shape data
    const mats = Array.isArray(thing.material) ? thing.material : [thing.material];
    mats.forEach((material) => {
      if (material.map) material.map.dispose(); // free the picture data
      material.dispose();
    });
  });
}

/** Remove one fighter (Batman or the villain) from the scene. */
function removeActor(slot) {
  if (!view.actors[slot]) return;
  removeGroup(view.actors[slot].group);
  view.actors[slot] = null;
}


/* ==========================================================================
   6. WINDOW RESIZE, HIDDEN TAB, THEME
   ========================================================================== */

function watchForResize() {
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
}

function resize() {
  if (!view.renderer) return;

  // The CSS decides how big the canvas looks; we read that back and match it.
  const width = dom.canvas.clientWidth || 640;
  const height = dom.canvas.clientHeight || 360;

  view.renderer.setSize(width, height, false); // false = do not touch the CSS
  view.camera.aspect = width / height;

  // On a narrow, tall screen, pull the camera back so both fighters still fit.
  view.camera.position.z = view.camera.aspect < 1 ? LOOK.camera.narrowZ : LOOK.camera.z;
  view.camera.updateProjectionMatrix();

  draw(); // redraw now instead of waiting for the next frame
}

function watchForTabHidden() {
  document.addEventListener('visibilitychange', () => {
    if (!view.renderer) return;

    if (document.hidden) {
      // A background tab does not need 60 frames a second.
      view.renderer.setAnimationLoop(null);
      console.log('[arena] Tab hidden, rendering paused.');
    } else {
      view.renderer.setAnimationLoop(draw);
      resize(); // the canvas may have changed size while we were away
    }
  });
}

function watchForThemeChange() {
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  if (!scheme.addEventListener) return;
  scheme.addEventListener('change', () => {
    if (view.scene) view.scene.background = new THREE.Color(themeBackground());
    draw();
  });
}

/** The 3D background colour for the current light/dark theme. */
function themeBackground() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? LOOK.background.dark : LOOK.background.light;
}


/* ==========================================================================
   7. ANIMATIONS (Stage 3)
   --------------------------------------------------------------------------
   No rigging, no skeletons, no animation files. Every movement here is just a
   number changing over time, which is why they are all in one small table in
   LOOK.motion and all in one function below.

   HOW A FIGHTER IS PUT TOGETHER
     group  — the outer wrapper. This owns the spot on the floor, so bobbing,
              lunging and shaking move the whole fighter around.
     root   — the model inside it. This is what tips over when someone is
              knocked down, because rotating the wrapper would swing the
              fighter through the floor.
   ========================================================================== */

/**
 * Does this visitor want less movement? Checked every time an animation is
 * asked for, not once at startup, so changing the system setting takes effect
 * straight away. When it is on we skip every shake and every flash, and the
 * knockdowns simply happen instantly instead of tipping.
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Easing curves. `t` always arrives as a number from 0 to 1. */
const EASE = {
  /** Speeds up at the start: good for stepping forward. */
  out: (t) => 1 - Math.pow(1 - t, 3),
  /** Slow start, fast middle, slow finish: good for a knock-out fall. */
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/**
 * Schedule a movement.
 *
 * @param {object} actor    the fighter returned by loadFighter()
 * @param {number} ms       how long it lasts
 * @param {function} apply  called every frame with (easedProgress, rawProgress)
 * @param {function} done   optional, called once at the end
 */
function tween(actor, ms, apply, done) {
  if (!actor) return;

  actor.motions = actor.motions || [];
  actor.motions.push({ start: performance.now(), ms, apply, done });
}

/** Run every scheduled movement and add the idle bob on top. */
function stepAnimations() {
  const now = performance.now();
  const quiet = prefersReducedMotion();

  for (const slot of ['player', 'villain']) {
    const actor = view.actors[slot];
    if (!actor) continue;

    // Where the fighter belongs when nothing is happening to it
    if (!actor.base) {
      actor.base = {
        x: actor.group.position.x,
        y: actor.group.position.y,
        z: actor.group.position.z,
      };
    }

    // --- the idle bob ---------------------------------------------------
    // A small up-and-down sway so a still fighter looks like it is breathing.
    // Turned off completely when the visitor asked for reduced motion.
    if (!quiet && !actor.isDown) {
      actor.group.position.y = actor.base.y + Math.sin(now / 1000 * LOOK.motion.bobSpeed)
        * LOOK.motion.bobHeight;
    }

    // --- whatever is currently playing ---------------------------------
    if (!actor.motions || actor.motions.length === 0) continue;

    const stillPlaying = [];

    for (const motion of actor.motions) {
      const raw = Math.min(1, (now - motion.start) / motion.ms);
      motion.apply(EASE.inOut(raw), raw);

      if (raw < 1) {
        stillPlaying.push(motion);
      } else if (motion.done) {
        motion.done();
      }
    }

    // Only settle once the last movement has finished. Doing it inside the loop
    // would fight the movements still running, and put him back mid-shake.
    actor.motions = stillPlaying;
    if (stillPlaying.length === 0) settle(actor);
  }
}

/**
 * Put a fighter back on their mark, one last time, once everything has
 * finished. Without this a shake would leave them a centimetre off centre.
 */
function settle(actor) {
  if (!actor.base || (actor.motions && actor.motions.length > 0)) return;

  actor.group.position.set(actor.base.x, actor.base.y, actor.base.z);

  // Someone who is down stays down. Straightening the model back up here
  // would snap the tip-over into a jump-cut the moment the fall finished.
  if (!actor.isDown) actor.root.rotation.set(0, actor.restYaw || 0, 0);
}

/* --- movement helpers ---------------------------------------------------- */

/**
 * Step forward towards the other fighter and back again. This is the "attack".
 *
 * @param {string} slot  "player" or "villain"
 */
function lunge(slot) {
  const actor = view.actors[slot];
  if (!actor || !actor.base) return;

  // Facing the other fighter means "forward" is minus or plus z.
  const toward = slot === 'player' ? -1 : 1;
  const { distance, ms } = LOOK.motion.lunge;

  if (prefersReducedMotion()) return;   // no movement at all

  tween(actor, ms, (t) => {
    // sin() gives 0 -> 1 -> 0, so it goes out and comes straight back
    const step = Math.sin(t * Math.PI) * distance;
    actor.group.position.z = actor.base.z + toward * step;
  });
}

/**
 * React to being hit: a short sideways shake, a small backwards lean, and a
 * colour flash so it is obvious who was hit even in a dark room.
 *
 * @param {string} slot    "player" or "villain"
 * @param {string} tint    flash colour, e.g. "#ffffff" for a villain hit
 */
function flinch(slot, tint) {
  const actor = view.actors[slot];
  if (!actor || !actor.base || actor.isDown) return;

  const away = slot === 'player' ? -1 : 1;
  const { shake, shakeMs, tilt, tiltMs } = LOOK.motion.flinch;

  // Reduced motion means nothing moves in 3D at all. The floating damage
  // number, the bar and the colour of the bar still say what happened.
  if (prefersReducedMotion()) return;

  // Step back a little: getting hit should push you away from the punch
  tween(actor, LOOK.motion.recoil.ms, (t) => {
    const back = Math.sin(t * Math.PI) * LOOK.motion.recoil.distance;
    actor.group.position.z = actor.base.z - away * back;
  });

  tween(actor, shakeMs, (t) => {
    // Wobble that damps out instead of stopping dead, so it feels like a hit
    const strength = (1 - t) * shake;
    actor.group.position.x = actor.base.x + Math.sin(t * 34) * strength;
  });

  tween(actor, tiltMs, (t) => {
    actor.root.rotation.x = Math.sin(t * Math.PI) * tilt * -away;
  });

  flash(actor, tint || '#ffffff');
}

/**
 * Light the fighter up in one flat colour, then fade it back to normal.
 *
 * The trick: throw away the picture (emissiveMap) for the length of the flash
 * so the fighter becomes a flat coloured shape. That needs one tiny shader
 * recompile, which is fine for a one-off event.
 */
function flash(actor, hex) {
  // Two flashes in a row would capture each other's half-finished state, so
  // the second one is skipped rather than allowed to corrupt the material.
  if (actor.flashing) return;
  actor.flashing = true;

  const patches = [];

  for (const material of actor.materials || []) {
    if (!material || !material.emissive) continue;

    patches.push({
      material,
      emissiveMap: material.emissiveMap,
      emissive: material.emissive.clone(),
      intensity: material.emissiveIntensity,
    });

    material.emissiveMap = null;
    material.emissive.set(hex);
    material.emissiveIntensity = 1;
    material.needsUpdate = true;
  }

  if (patches.length === 0) {
    actor.flashing = false;
    return;
  }

  tween(actor, LOOK.motion.flashMs, (t) => {
    for (const patch of patches) {
      patch.material.emissiveIntensity = 1 - t;
    }
  }, () => {
    // Put the original material back exactly as it was
    for (const patch of patches) {
      patch.material.emissiveMap = patch.emissiveMap;
      patch.material.emissive.copy(patch.emissive);
      patch.material.emissiveIntensity = patch.intensity;
      patch.material.needsUpdate = true;
    }

    actor.flashing = false;
  });
}

/**
 * Grey a fighter out, so they look out of the fight.
 * The original colour is saved first (once per material) so revive() can put
 * it back — otherwise a second knock-down would keep greying the grey.
 */
function greyOut(actor, grey) {
  const target = new THREE.Color(grey);

  for (const material of actor.materials || []) {
    if (!material || !material.color) continue;

    if (!actor.greyness) actor.greyness = {};

    if (!actor.greyness[material.uuid]) {
      actor.greyness[material.uuid] = {
        color: material.color.clone(),
        intensity: material.emissiveIntensity,
      };
    }

    const saved = actor.greyness[material.uuid];
    material.color.copy(saved.color).lerp(target, 0.75);
    material.emissiveIntensity = saved.intensity * 0.4;
  }
}

/* --- the two knock-downs ------------------------------------------------- */

/**
 * Batman is out: tip him over towards the camera and drain the colour out of
 * him, so it is obvious the fight is paused until the questions are re-answered.
 */
function knockDown(slot) {
  const actor = view.actors[slot];
  if (!actor || !actor.base || actor.isDown) return;

  actor.isDown = true;
  greyOut(actor, LOOK.motion.downGrey);

  // With reduced motion he does not fall: he just goes grey and stays put.
  if (prefersReducedMotion()) return;

  const { tilt, drop, ms } = LOOK.motion.down;
  const rest = actor.restPosition || actor.root.position;

  tween(actor, ms, (t) => {
    // Negative X tilt lays him backwards, away from the camera: he has been
    // knocked back. Dropping him by the same amount as he falls puts his body
    // flat on the floor line instead of sinking through it.
    actor.root.rotation.x = -t * tilt;
    actor.root.position.y = rest.y - t * drop;
    actor.group.position.y = actor.base.y;
  });
}

/**
 * Everything that has to fade with a defeated villain, each one noted down as
 * it looked beforehand so revive() can put every number back exactly.
 * The shadow comes along too, otherwise it would be left on the floor.
 */
function fadeTargets(actor) {
  const materials = (actor.materials || []).filter(Boolean);
  if (actor.shadow && actor.shadow.material) materials.push(actor.shadow.material);

  return materials.map((material) => ({
    material,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
  }));
}

/**
 * The villain is beaten: tip them over backwards and fade them away.
 *
 * Turning transparency on is a one-off recompile at the start. After that only
 * opacity changes, which costs nothing.
 */
function celebrate(slot) {
  const actor = view.actors[slot];
  if (!actor || !actor.base || actor.isDown) return;

  actor.isDown = true;

  const targets = (actor.faded = fadeTargets(actor));
  const { tilt, drop, ms } = LOOK.motion.down;

  if (prefersReducedMotion()) {
    // No falling over and no fade: just make him very faint, instantly.
    for (const target of targets) target.material.opacity = target.opacity * 0.15;
    return;
  }

  const rest = actor.restPosition || actor.root.position;

  tween(actor, ms, (t) => {
    // Positive X tilt drops him forwards, towards the camera, so a beaten
    // villain slumps at your feet instead of sinking through the floor
    actor.root.rotation.x = t * tilt;
    actor.root.position.y = rest.y - t * drop;
    actor.group.position.y = actor.base.y;

    for (const target of targets) {
      const material = target.material;

      // Switch transparency on once, then only change the number
      if (!material.transparent) {
        material.transparent = true;
        material.depthWrite = false;   // so the two halves do not fight
        material.needsUpdate = true;
      }

      material.opacity = target.opacity * (1 - t);
    }
  });
}

/**
 * Stand back up. Used when a knockout is cleared, and whenever a new villain
 * is loaded, so a stale pose can never survive into the next fight.
 */
function revive(slot) {
  const actor = view.actors[slot];
  if (!actor) return;

  actor.isDown = false;
  actor.motions = [];

  // Undo the grey-out
  for (const material of actor.materials || []) {
    if (!material) continue;

    const saved = actor.greyness && actor.greyness[material.uuid];
    if (saved) {
      material.color.copy(saved.color);
      material.emissiveIntensity = saved.intensity;
    }
  }

  // Undo the fade. Only touch what celebrate() actually changed, so a shadow
  // that was already transparent keeps its own low opacity.
  for (const target of actor.faded || []) {
    const material = target.material;

    if (material.transparent !== target.transparent) {
      material.transparent = target.transparent;
      material.depthWrite = target.depthWrite;
      material.needsUpdate = true;
    }

    material.opacity = target.opacity;
  }

  actor.faded = null;
  actor.flashing = false;

  if (actor.base) {
    actor.group.position.set(actor.base.x, actor.base.y, actor.base.z);
  }

  actor.root.rotation.set(0, actor.restYaw || 0, 0);
  if (actor.restPosition) actor.root.position.copy(actor.restPosition);
}

/* ==========================================================================
   8. SMALL UI HELPERS + THE PUBLIC API
   ========================================================================== */

function setLoadingVisible(show) {
  dom.loading.hidden = !show;
  dom.loading.textContent = show ? 'Loading fighters…' : '';
}


/*
 * Stage 2 (health + battle rules) drives the fight from the outside, so we
 * leave a small API on window for it to use.
 */
window.battleArena = {
  characters: CHARACTERS,
  look: LOOK,
  view,                          // scene, camera, actors, loader…
  setVillain,                    // switch opponent
  removeActor,
  normaliseModel,
  supportsWebGL,
  showEmojiFallback,

  // --- Stage 3: the animations the fight triggers ---
  lunge,                         // step forward, like throwing a punch
  flinch,                        // react to being hit
  knockDown,                     // tip over and go grey (Batman is down)
  celebrate,                     // tip over and fade (the villain is beaten)
  revive,                        // stand back up and look normal again
  prefersReducedMotion,
};


/* ==========================================================================
   9. GO
   --------------------------------------------------------------------------
   This block runs last, on purpose. With `const`, JavaScript knows the names
   before this point but cannot use them until this line, so calling start()
   any earlier would throw "Cannot access 'view' before initialization".
   ========================================================================== */

if (!dom.canvas) {
  console.warn('[arena] No #arena-canvas found, so the 3D stage was skipped.');
} else {
  start();
}