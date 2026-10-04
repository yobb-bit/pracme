/* ==========================================================================
   health.js — BATMAN'S HEALTH POOL
   ==========================================================================
   Everything to do with the red bar under Batman: how much health he has,
   how much each button costs him, healing, the daily reset and the undo.

   This file is deliberately boring: pure rules, no buttons, no colours, no
   drawing. Whatever the rules say should happen is announced as an event,
   and battle.js listens for those events and paints the screen.

   EVENTS (fired on window, easy to listen to from the console too):
     health:changed    { hp, max, delta, reason }
     health:healed     { hp, max, amount, reason }
     health:knockedout { revivedAt }
     health:undone     { hp, max, undone }
   ========================================================================== */

/* Where our numbers are kept. The rest of the app has its own key for
   question history, so the two never fight over the same object. */
const HEALTH_KEY = "interview-practice.health.v1";

/* The rules, all in one table so they are easy to read and easy to change.
   `amount` is the health change, so negative numbers hurt Batman.
   "heal" entries are the two ways his health goes back up. */
const RULES = {
  // I don't know the answer        -> the big hit
  giveUp:     { amount: -15, label: "I don't know" },

  // Checked your answer while it was empty or far too short
  empty:      { amount: -10, label: "No answer" },

  // The checker came back and matched none of the key points
  checker:    { amount: -10, label: "Missed every key point" },

  // You checked your answer and then rated yourself
  partly:     { amount: -5,  label: "Partly right" },

  // You rated yourself "Nailed it" — the only thing that heals
  nailedEasy: { amount: 5,   label: "Nailed it", heal: true },
  nailedHard: { amount: 10,  label: "Nailed it (hard)", heal: true },

  // Back from a knockout
  revive:     { amount: 50,  label: "Back in the fight", heal: true },

  // A new day, a fresh fight
  daily:      { amount: 100, label: "New day", heal: true },
};

/* Easy questions are worth more damage, hard ones less, and "Nailed it" on a
   hard question is worth double. Each difficulty has its own row, and a
   missing difficulty falls back to `fallback`. */
const DIFFICULTY_SCALING = {
  easy:    { damage: 1.5, nailBonus: 5 },
  neutral: { damage: 1,   nailBonus: 5 },
  hard:    { damage: 0.75, nailBonus: 10 },
  fallback:{ damage: 1,   nailBonus: 5 },
};

const MAX_HP = 100;      // Batman's health pool
const REVIVE_HP = RULES.revive.amount;   // 50 — health after a knockout


/* ==========================================================================
   1. SAVING AND LOADING
   --------------------------------------------------------------------------
   localStorage only stores strings and can be blocked (Safari private mode
   throws), so every access is wrapped. If saving fails the quiz still works,
   the numbers just reset when the page is reloaded.
   ========================================================================== */
function todayStamp() {
  /* toDateString() gives "Mon Oct 04 2026" in the visitor's own timezone, which
     is exactly what we want: "a new day" means a new day where they are. */
  return new Date().toDateString();
}

function loadHealth() {
  const fresh = { hp: MAX_HP, day: todayStamp() };

  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    if (!raw) return fresh;

    const saved = JSON.parse(raw);
    if (typeof saved.hp !== "number") return fresh;

    return { hp: saved.hp, day: saved.day || todayStamp() };
  } catch (err) {
    console.warn("[health] Could not read saved health:", err);
    return fresh;
  }
}

function saveHealth(state) {
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[health] Could not save health:", err);
  }
}


/* ==========================================================================
   2. THE HEALTH STATE
   --------------------------------------------------------------------------
   `lastHit` remembers the most recent damage, which is what the "That was
   actually right" button puts back. It is deliberately NOT saved: undo only
   ever works on the hit you just took.
   ========================================================================== */
let state = loadHealth();

/* The health of the hit we could take back, or null when there is nothing to
   undo (no hit yet, already used the button, or healed since). */
let lastHit = null;

function fire(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

/* Synced once at the start, then health:changed does the rest. */
fire("health:changed", { hp: state.hp, max: MAX_HP, delta: 0, reason: "init" });


/* ==========================================================================
   3. DAILY RESET
   --------------------------------------------------------------------------
   Full health once per calendar day. The day is remembered by name, so no
   timers or date maths are needed.
   ========================================================================== */
function checkDailyReset() {
  const today = todayStamp();
  if (state.day === today) return;

  state = { hp: MAX_HP, day: today };
  saveHealth(state);

  // A new day clears the undo too: yesterday's mistake is not today's problem.
  lastHit = null;

  fire("health:healed", { hp: MAX_HP, max: MAX_HP, amount: MAX_HP, reason: "daily" });
  fire("health:changed", { hp: MAX_HP, max: MAX_HP, delta: MAX_HP, reason: "daily" });
}


/* ==========================================================================
   4. WORKING OUT HOW MUCH A HIT COSTS
   --------------------------------------------------------------------------
   @param {string} reason  a key from RULES, e.g. "partly"
   @param {string} difficulty  "easy" | "neutral" | "hard"
   @returns {number} how much health to add (usually negative)
   ========================================================================== */
function amountFor(reason, difficulty) {
  const rule = RULES[reason];
  if (!rule) return 0;

  const scale = DIFFICULTY_SCALING[difficulty] || DIFFICULTY_SCALING.fallback;

  /* "Nailed it" heals, and a hard question heals more. Damage is the other
     way round: easy questions hurt 1.5x as much, hard ones only 0.75x. */
  if (rule.heal) return scale.nailBonus;

  /* Rounded to a whole number, because half a heart is pointless. Note that
     Math.round rounds halves upwards, so -5 x 0.75 becomes -4 (not -3). */
  return Math.round(rule.amount * scale.damage);
}

/* A short sentence for the floating damage numbers, e.g. "-15 I don't know". */
function describeHit(reason, difficulty, amount) {
  const label = RULES[reason] ? RULES[reason].label : reason;
  const sign = amount > 0 ? "+" : "";      // so healing reads "+10"
  return `${sign}${amount} ${label}`;
}


/* ==========================================================================
   5. TAKING A HIT
   --------------------------------------------------------------------------
   This is the one function the rest of the app calls when something goes
   wrong or right. It clamps health to 0..MAX_HP, saves, remembers the hit for
   undo, and fires the events battle.js listens to.

   @returns {{ hp:number, delta:number, amount:number, knockedOut:boolean, canUndo:boolean }}
   ========================================================================== */
function applyHit(reason, difficulty, context = {}) {
  const amount = amountFor(reason, difficulty);

  // An unknown reason is a programming mistake, so say so instead of failing quietly.
  if (amount === 0 && !RULES[reason]) {
    console.warn(`[health] Unknown health rule "${reason}"`);
    return { hp: state.hp, delta: 0, amount: 0, knockedOut: false, canUndo: false };
  }

  const before = state.hp;
  const hp = Math.max(0, Math.min(MAX_HP, before + amount));
  const delta = hp - before;               // what really happened after clamping
  const knockedOut = hp === 0 && before > 0;

  state.hp = hp;
  saveHealth(state);

  /* Only damage can be taken back. Healing cannot: otherwise you could undo
     your way to full health without answering anything. */
  lastHit = amount < 0
    ? { reason, difficulty, amount: delta, hpBefore: before, context }
    : null;

  const detail = {
    hp,
    max: MAX_HP,
    delta,
    amount,
    reason,
    difficulty,
    label: describeHit(reason, difficulty, amount),
    knockedOut,
    canUndo: lastHit !== null,
  };

  fire("health:changed", detail);
  if (knockedOut) fire("health:knockedout", { revivedAt: REVIVE_HP });

  return detail;
}


/* ==========================================================================
   6. UNDOING A HIT
   --------------------------------------------------------------------------
   The "That was actually right" button. Puts the health back exactly as it was
   before the last hit, and only works once per hit.

   @returns {boolean} true when something was actually undone
   ========================================================================== */
function undoLastHit() {
  if (!lastHit) return false;

  const { reason, difficulty, amount, hpBefore, context } = lastHit;
  lastHit = null;   // one undo per hit, so it cannot be pressed twice

  state.hp = Math.max(0, Math.min(MAX_HP, hpBefore));
  saveHealth(state);

  fire("health:changed", {
    hp: state.hp,
    max: MAX_HP,
    delta: 0,           // visually nothing changes: the hit is being taken back
    reason: "undo",
    difficulty,
    label: "That was actually right — hit undone",
    canUndo: false,
  });

  fire("health:undone", { hp: state.hp, max: MAX_HP, undone: { reason, difficulty, amount, ...context } });
  return true;
}


/* ==========================================================================
   7. DIRECT SETTERS
   --------------------------------------------------------------------------
   Used by the knockout in battle.js (revive) and by the victory screen
   (full heal). Neither needs the undo button.
   ========================================================================== */
function healTo(amount, reason = "revive") {
  return applyHit(reason, "neutral");
}

/* Free Practice ignores health completely, so this is how the battle code
   parks Batman's health while the student is just practising. */
function setHpSilently(hp) {
  state.hp = Math.max(0, Math.min(MAX_HP, hp));
  saveHealth(state);
  fire("health:changed", { hp: state.hp, max: MAX_HP, delta: 0, reason: "set" });
}

/* Lets the Reset button in the header wipe battle progress and health. */
function resetHealth() {
  state = { hp: MAX_HP, day: todayStamp() };
  saveHealth(state);
  lastHit = null;
  fire("health:changed", { hp: state.hp, max: MAX_HP, delta: 0, reason: "reset" });
}

function hasUndo() {
  return lastHit !== null;
}


/* ==========================================================================
   8. EXPORTED API
   --------------------------------------------------------------------------
   Everything battle.js and the console need, and nothing else. Modules hide
   their private functions from other files, so this is the whole surface.
   ========================================================================== */
export const Health = {
  RULES,
  MAX_HP,
  REVIVE_HP,
  DIFFICULTY_SCALING,

  getHp()          { return state.hp; },
  getMax()         { return MAX_HP; },
  getDay()         { return state.day; },
  hasUndo,
  checkDailyReset,
  amountFor,
  describeHit,
  applyHit,
  undoLastHit,
  healTo,
  setHpSilently,
  resetHealth,
};