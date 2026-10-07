/* ==========================================================================
   characters.js — the ONE config file for the Boss Battle feature
   --------------------------------------------------------------------------
   Everything else (the 3D stage, the health bars, the battle rules) reads its
   names, model files and numbers from here. So if you want to rename a
   villain or make it harder, you only ever edit THIS file.

   It is an ES module (it has import/export), so the browser loads it with
   <script type="module">. No build step, no bundler.
   ========================================================================== */


/* --------------------------------------------------------------------------
   1. THE FIGHTERS
   --------------------------------------------------------------------------
   player  = you. He is on the left in every single fight, easy or hard.
   villains = the three opponents, fought in the order listed here:
              easy -> normal -> hard.

   ⚠️  MODEL GUESSES — PLEASE CHECK THESE
   The files you downloaded all had the same generic name ("model"), so I could
   not tell them apart from the names. I picked them by looking at the actual
   textures and shapes:

     4877d6d0…  all dark blue-grey, no bright colour at all  -> Batman  (player)
     80429bfd…  red head/hands + blue body                  -> easy
     aae5629a…  tan / khaki, wide stance                    -> normal
     4dd77de6…  red + dark green + skin tones              -> hard

   If you picked wrong, just swap the two modelPath strings below. Nothing
   else in the app needs to change.

   🛠️  IF A MODEL FACES THE WRONG WAY
   Every AI model has a random rotation baked in, so "facing right" is a guess.
   If a fighter looks like it is facing the camera, or has its back to you,
   add 180 to its yawOffset (in degrees). Example: yawOffset: 180.
   -------------------------------------------------------------------------- */
/* The villains, in the order you fight them. battle.js imports this list
   directly, so the rules and the 3D stage can never disagree about who is who.
   `next` says which villain unlocks when this one is beaten (null = last one),
   and `hitsToDefeat` is how many "Nailed it" answers it takes. */
export const VILLAINS = [
    {
      id: 'easy',
      name: 'Easy Villain',            // ← rename me
      difficulty: 'easy',             // ← matches the "easy" questions
      hitsToDefeat: 5,                // ← change the numbers if you want
      purpose: 'Warm-up boss: the basics every interviewer asks.',
      portrait: '👹',
      modelPath: 'assets/80429bfd-85da-43b9-8334-218acb7455b5/base.glb',
      yawOffset: 0,
      next: 'normal',                  // unlocks when this one is beaten
      victoryLine: 'Easy Villain drops to one knee. Batman barely broke a sweat.',
    },
    {
      id: 'normal',
      name: 'Normal Villain',          // ← rename me
      difficulty: 'neutral',           // ← matches the "neutral" questions
      hitsToDefeat: 7,                // ← change the numbers if you want
      purpose: 'Builds on the fundamentals with questions that need clearer examples.',
      portrait: '👺',
      modelPath: 'assets/aae5629a-40dd-48d5-aa79-578661a517f0/base_basic_shaded.glb',
      yawOffset: 0,
      next: 'hard',
      victoryLine: 'Normal Villain wipes the dust off and admits you were ready for this one.',
    },
    {
      id: 'hard',
      name: 'Hard Villain',            // ← rename me
      difficulty: 'hard',              // ← matches the "hard" questions
      hitsToDefeat: 10,               // ← change the numbers if you want
      purpose: 'Tests deeper judgment and detailed answers under pressure.',
      portrait: '😈',
      modelPath: 'assets/4dd77de6-b5b5-49d9-8649-4c46d6e6a7aa/base_basic_shaded.glb',
      yawOffset: 0,
      next: null,                      // last one, so nothing comes after
      victoryLine: 'Hard Villain is down. Every villain in the league is beaten.',
    },
];

export const CHARACTERS = {
  player: {
    id: 'batman',
    name: 'Batman',
    modelPath: 'assets/4877d6d0-5176-495f-bbe7-cf4e9a46dd06/base_basic_shaded.glb',
    yawOffset: 0, // extra spin in degrees, to correct the model's own facing
  },

  villains: VILLAINS,
};


/* --------------------------------------------------------------------------
   2. HOW THE STAGE LOOKS
   Shared numbers for the 3D panel. Change these to tweak the scene without
   touching any logic.
   -------------------------------------------------------------------------- */
export const LOOK = {
  targetHeight: 2.0,   // every model is scaled so it is this tall (3D units)
  floorY: 0,           // models stand on y = 0

  playerX: -1.7,       // Batman stands 1.7 units to the left of centre
  villainX: 1.7,       // the villain stands 1.7 units to the right

  camera: {
    fov: 32,
    y: 1.5,
    z: 7.2,
    lookAtY: 1.0,
    narrowZ: 8.8,      // camera distance used when the screen is tall/narrow
  },

  lights: {
    sky: 0xdfe8ff,      // hemisphere: colour from above
    ground: 0x5a6472,   // hemisphere: colour bouncing up from below
    skyIntensity: 1.8,
    sunIntensity: 2.4,
    sunPosition: [2.6, 4.5, 3.2],
    fillIntensity: 0.6, // a weak light from behind, so backs are not pure black
    fillPosition: [-2.4, 2.2, -2.6],
  },

  // Some AI textures are so dark that no amount of lighting makes the details
  // readable (Batman measured almost black: 44% of his pixels were crushed).
  // So for those, and only those, arena.js adds a dim self-lit copy of the
  // same texture. It measures each picture first, then decides:
  //   average brightness below selfLightFloor  -> full selfLight
  //   average brightness above selfLightCutoff -> none at all
  //   in between                                -> a smooth blend
  // Set selfLight to 0 to switch the whole thing off.
  selfLight: 0.5,
  selfLightFloor: 60,   // 0-255: darker than this gets the full self-light
  selfLightCutoff: 130, // 0-255: brighter than this gets none

  // Every animation in the app, as plain numbers. There is no rigging and no
  // animation file anywhere: arena.js just moves these values over time.
  // Distances are in 3D units (a fighter is 2.0 tall), times in milliseconds.
  motion: {
    // The idle sway both fighters share, so a still fighter looks alive
    bobHeight: 0.03,     // how far up and down: 0.03 of 2.0 is about 1.5%
    bobSpeed: 1.7,       // cycles per second

    // Stepping forward to attack
    lunge: { distance: 0.5, ms: 300 },

    // Getting hit: pushed back, then a quick shake
    recoil:   { distance: 0.28, ms: 260 },
    flinch:   { shake: 0.07, shakeMs: 380, tilt: 0.13, tiltMs: 320 },

    // The colour flash, so you can see who was hit in a dark room
    flashMs: 240,

    // Falling over, for both a knock-down and a defeat.
    // The tilt is about X, not Z: that lays the fighter backwards along the
    // depth of the stage instead of sideways across it, so he cannot slide out
    // of frame on a narrow window. drop is roughly how far the body drops as it
    // goes over, which lands him flat on the floor line beside his shadow.
    down: { tilt: 1.35, drop: 0.34, ms: 850 },   // tilt is in radians, about 77

    // How grey a knocked-out Batman goes
    downGrey: 0x6b7280,
  },

  shadow: {
    radius: 0.85,       // size of the soft blob under each fighter
    opacity: 0.38,
  },

  // Fallback capsule colours, used only if a model file fails to load.
  placeholderColour: {
    player: 0x4a5568,
    villain: 0xc2413b,
  },

  // Background colour per theme, so the 3D panel matches the page.
  background: { light: 0xe7ebf2, dark: 0x1c2330 },

  // The "shaded" .glb files store their picture as an emissiveTexture and set
  // the base colour to black. Turn this ON to reuse that picture as the normal
  // colour map, which is what lets the lights above actually shade the model.
  // Turn it OFF to use the files exactly as they are (flat, unlit look).
  useTextureAsColour: true,
};


/* --------------------------------------------------------------------------
   3. SMALL HELPERS
   -------------------------------------------------------------------------- */

/** Find a villain by its id ('easy' | 'normal' | 'hard'). */
export function getVillain(id) {
  return CHARACTERS.villains.find((v) => v.id === id) || null;
}

/** The villain that comes after this one (null after the last one). */
export function getNextVillain(id) {
  const i = CHARACTERS.villains.findIndex((v) => v.id === id);
  return i >= 0 ? CHARACTERS.villains[i + 1] || null : null;
}
/* --------------------------------------------------------------------------
   4. HEROES (for onboarding + future pages)
   -------------------------------------------------------------------------- */
export const HEROES = [
  {
    id: 'batman',
    defaultName: 'Batman',
    model: 'assets/4877d6d0-5176-495f-bbe7-cf4e9a46dd06/base_basic_shaded.glb',
    modelPath: 'assets/4877d6d0-5176-495f-bbe7-cf4e9a46dd06/base_basic_shaded.glb',
    thumbnail: '',
    trait: 'Steady under pressure.',
    skill: 'Focus: reduces distraction.',
    unlock: { type: 'default' },
  },
];
