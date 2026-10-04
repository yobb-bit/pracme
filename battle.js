/* ==========================================================================
   battle.js — BOSS BATTLE RULES
   ==========================================================================
   Everything about fighting the villains:

     * the two modes (Boss Battle and Free Practice)
     * which villain you are up against and how far through them you are
     * when a "Nailed it" counts as a hit on the villain
     * the knockout lockdown and the rules for clearing it
     * winning, unlocking the next villain, and the rematch after the last one

   Same idea as health.js: pure rules. No colours, no bars, no 3D, not even
   class names. It announces what happened as events, and battle-ui.js decides
   how that looks. Try it in the console:

     Battle.snapshot()
     Battle.setMode("practice")

   EVENTS (fired on window):
     battle:changed       { mode, villainId, villainName, hits, hitsToDefeat,
                            hitsLeft, unlocked, defeated, lockdown }
     battle:hit           { villainName, hits, hitsToDefeat, hitsLeft }
     battle:downgrade     { reason, ratio }
     battle:victory       { villainId, villainName, nextId, nextName, line }
     battle:finale        { villainName, line }
     battle:lockdown      { total, difficulty }
     battle:lockdownStep  { done, total, questionId }
     battle:lockdownClear { revivedAt }
     battle:modechanged   { mode }
   ========================================================================== */

import { CHARACTERS, VILLAINS } from "./characters.js";
import { Health } from "./health.js";

/* When true, a "Nailed it" only damages the villain if a checker.js existed and
   matched at least CHECKER_HIT_THRESHOLD of the key points. With no checker.js
   yet, the self-rating is trusted — see hitCheckOutcome(). */
export const REQUIRE_CHECKER_FOR_HIT = true;

/* Share of key points the checker must have matched. */
const CHECKER_HIT_THRESHOLD = 0.5;

/* Order the lockdown makes you redo questions in: easiest first, so you get
   some wins back before the hard ones. */
const LOCKDOWN_ORDER = ["easy", "neutral", "hard"];


/* ==========================================================================
   1. SAVING AND LOADING
   --------------------------------------------------------------------------
   Its own localStorage key, separate from the quiz history and from health.js,
   so none of the three can overwrite the others. Same try/catch habit: if
   saving is blocked the fight still works, it just starts over next reload.
   ========================================================================== */
const BATTLE_KEY = "interview-practice.battle.v1";

function freshProgress() {
  const progress = {
    mode: "boss",                       // Boss Battle is the whole point
    villainId: VILLAINS[0].id,
    unlocked: [VILLAINS[0].id],         // only the first villain to start with
    hits: {},                           // damage landed on each villain
    defeated: {},                       // have you beaten them at all
  };

  for (const villain of VILLAINS) {
    progress.hits[villain.id] = 0;
    progress.defeated[villain.id] = false;
  }

  return progress;
}

function knownVillain(id) {
  return VILLAINS.some((villain) => villain.id === id);
}

function loadProgress() {
  const fresh = freshProgress();

  try {
    const raw = localStorage.getItem(BATTLE_KEY);
    if (!raw) return fresh;

    const saved = JSON.parse(raw) || {};

    // Fill in anything missing, so an older or half-written save still loads
    if (saved.mode === "practice" || saved.mode === "boss") fresh.mode = saved.mode;
    if (knownVillain(saved.villainId)) fresh.villainId = saved.villainId;

    if (Array.isArray(saved.unlocked)) {
      const ids = saved.unlocked.filter(knownVillain);
      if (ids.includes(VILLAINS[0].id)) fresh.unlocked = [...new Set(ids)];
    }
    if (saved.hits) {
      for (const villain of VILLAINS) {
        const value = saved.hits[villain.id];
        if (typeof value === "number" && value >= 0) fresh.hits[villain.id] = value;
      }
    }
    if (saved.defeated) {
      for (const villain of VILLAINS) {
        fresh.defeated[villain.id] = Boolean(saved.defeated[villain.id]);
      }
    }
  } catch (err) {
    console.warn("[battle] Could not read saved progress:", err);
  }

  return fresh;
}

function saveProgress() {
  try {
    localStorage.setItem(BATTLE_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn("[battle] Could not save progress:", err);
  }
}


/* ==========================================================================
   2. STATE
   --------------------------------------------------------------------------
   Saved between visits: mode, villain, how far you got.
   Not saved (deliberately): the lockdown and the miss lists. Those are about
   this sitting — walk away and Batman is still hurt, but the re-answering
   homework starts fresh.
   ========================================================================== */
let progress = loadProgress();
let mode = progress.mode;      // "boss" | "practice"

/* The knockout lockdown: { ids, index }. null when nothing to clear. */
let lockdown = null;

/* Questions still owed a "Nailed it" because of a knockout. */
let mustFix = new Set();

/* Questions you got wrong during this sitting. A knockout builds its lockdown
   out of these (filtered to the villain's difficulty), so you re-answer exactly
   what just beat you. */
let missedIds = new Set();

/* Filled in by app.js so this file never imports the question list itself,
   which would be a circular import. Call init() again after questions load. */
let hooks = { getMissedIdsFor: () => [], getQuestionsFor: () => [] };

/* Cache of "which ids exist at which difficulty" so the helpers below do not
   walk the question list once per id. */
let difficultyIds = new Map();


/* ==========================================================================
   3. SMALL HELPERS
   ========================================================================== */
function fire(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function villainById(id) {
  return VILLAINS.find((villain) => villain.id === id) || VILLAINS[0];
}

function villainIndex(id) {
  return VILLAINS.findIndex((villain) => villain.id === id);
}

function isUnlocked(id) {
  return progress.unlocked.includes(id);
}

function hitsLeftFor(id) {
  const villain = villainById(id);
  return Math.max(0, villain.hitsToDefeat - progress.hits[id]);
}

function idsAtDifficulty(difficulty) {
  if (!difficultyIds.has(difficulty)) {
    const questions = hooks.getQuestionsFor(difficulty) || [];
    difficultyIds.set(difficulty, new Set(questions.map((question) => question.id)));
  }
  return difficultyIds.get(difficulty);
}

function matchesDifficulty(id, difficulty) {
  return idsAtDifficulty(difficulty).has(id);
}

function snapshot() {
  const villain = villainById(progress.villainId);

  return {
    mode,
    villainId: villain.id,
    villainName: villain.name,
    villainAccent: villain.accent,
    hits: progress.hits[villain.id],
    hitsToDefeat: villain.hitsToDefeat,
    hitsLeft: hitsLeftFor(villain.id),
    unlocked: [...progress.unlocked],
    defeated: { ...progress.defeated },
    isUnlocked: isUnlocked(villain.id),
    lockdown: lockdownStatus(),
    missedIds: [...missedIds],
    mustFixIds: [...mustFix],
  };
}

/* The single "something changed" announcement. */
function announce() {
  fire("battle:changed", snapshot());
}

function persist() {
  progress.mode = mode;
  saveProgress();
  announce();
}


/* ==========================================================================
   4. MODES
   --------------------------------------------------------------------------
   Boss Battle   - questions match the villain, health and villain damage count
   Free Practice - exactly the old behaviour: every filter works, no health
                   bar, no villain damage
   ========================================================================== */
function getMode() {
  return mode;
}

function isBossMode() {
  return mode === "boss";
}

function setMode(next) {
  if (next !== "boss" && next !== "practice") return false;
  if (next === mode) return true;

  mode = next;

  if (next === "practice") {
    /* Practising is not part of the fight, so it must never be blocked by a
       knockout. Walking away from a fight drops the lockdown; your health and
       the villain's damage stay exactly as they were. */
    lockdown = null;
    mustFix.clear();
    if (Health.getHp() === 0) Health.setHpSilently(Health.getMax());
  }

  fire("battle:modechanged", { mode });
  persist();
  return true;
}


/* ==========================================================================
   5. WHICH QUESTIONS YOU GET
   --------------------------------------------------------------------------
   In Boss Battle the difficulty filter is not yours to pick: it is locked to
   the villain you are fighting, so every question is a real test. Category and
   type filters keep working as before.
   ========================================================================== */
function getLockedDifficulty() {
  return isBossMode() ? villainById(progress.villainId).difficulty : null;
}

/* True when the villain is one hit from going down. */
function isFinalStretch() {
  if (!isBossMode()) return false;
  const villain = villainById(progress.villainId);
  return progress.hits[villain.id] === villain.hitsToDefeat - 1;
}


/* ==========================================================================
   6. CHOOSING A VILLAIN
   --------------------------------------------------------------------------
   The order comes from VILLAINS in characters.js. You fight them in that
   order, and each victory unlocks the next. Locked villains are shown with a
   padlock and refuse to be clicked.
   ========================================================================== */
function getVillainId() {
  return progress.villainId;
}

function getVillain() {
  return villainById(progress.villainId);
}

function selectVillain(id) {
  const villain = villainById(id);

  if (!isUnlocked(villain.id)) {
    fire("battle:downgrade", { reason: "locked", villainId: villain.id });
    return { ok: false, reason: "locked", villainName: villain.name };
  }

  // Same villain: nothing to do, just refresh the panel.
  if (progress.villainId === villain.id) {
    announce();
    return { ok: true, alreadyFighting: true, villainName: villain.name };
  }

  progress.villainId = villain.id;
  persist();

  return { ok: true, villainName: villain.name };
}

/* The three cards for the villain picker. */
function villainCards() {
  return VILLAINS.map((villain) => ({
    id: villain.id,
    name: villain.name,
    difficulty: villain.difficulty,
    accent: villain.accent,
    hitsToDefeat: villain.hitsToDefeat,
    hits: progress.hits[villain.id],
    hitsLeft: hitsLeftFor(villain.id),
    unlocked: isUnlocked(villain.id),
    fighting: progress.villainId === villain.id,
    defeated: Boolean(progress.defeated[villain.id]),
    next: villain.next || null,
  }));
}


/* ==========================================================================
   7. DOES "Nailed it" COUNT AS A HIT?
   --------------------------------------------------------------------------
   In Boss Battle only "Nailed it" damages the villain. "Partly" and
   "Missed it" always deal 0 — you have to actually know the thing.

   The checker rule: if a checker.js exists and graded this answer, we do not
   just take your word for it. It has to have matched at least half the key
   points, or the "Nailed it" is quietly downgraded to "Partly" and does no
   damage. With no checker.js, or a question with no key points to check, the
   self-rating is trusted.

   @param {{checker?:{covered:number,total:number}, result:string}} context
   @returns {{hit:boolean, downgraded:boolean, reason:string}}
   ========================================================================== */
function hitCheckOutcome(context = {}) {
  if (!isBossMode()) return { hit: false, downgraded: false, reason: "practice" };
  if (context.result !== "nailed") return { hit: false, downgraded: false, reason: "not-nailed" };

  if (!REQUIRE_CHECKER_FOR_HIT) return { hit: true, downgraded: false, reason: "checker-off" };

  const checker = context.checker;
  if (!checker || typeof checker.total !== "number" || checker.total <= 0) {
    return { hit: true, downgraded: false, reason: "no-checker" };
  }

  const ratio = (checker.covered || 0) / checker.total;
  if (ratio >= CHECKER_HIT_THRESHOLD) {
    return { hit: true, downgraded: false, reason: "checker-pass", ratio };
  }

  return { hit: false, downgraded: true, reason: "checker-fail", ratio };
}


/* ==========================================================================
   8. THE KNOCKOUT LOCKDOWN
   --------------------------------------------------------------------------
   Batman hits 0 health, so he is down. Before carrying on he has to prove he
   knows the things he just got wrong: re-answer the missed questions and rate
   every one "Nailed it". Clear them all and he comes back on 50 health. The
   villain keeps whatever damage it has already taken.
   ========================================================================== */
function buildLockdown(difficulty) {
  // First choice: what you missed in this sitting at that difficulty.
  const fromThisSitting = [...missedIds].filter((id) => matchesDifficulty(id, difficulty));

  // If that is somehow empty, fall back to everything you have ever missed at
  // that difficulty, so a lockdown can never be impossible to clear.
  const fallback = hooks.getMissedIdsFor(difficulty) || [];
  const chosen = fromThisSitting.length ? fromThisSitting : fallback;

  return { ids: [...new Set(chosen)], index: 0 };
}

function startLockdown() {
  const difficulty = villainById(progress.villainId).difficulty;
  lockdown = buildLockdown(difficulty);

  // Nothing to re-answer: not a real knockout, just get him back up.
  if (lockdown.ids.length === 0) {
    lockdown = null;
    Health.setHpSilently(Health.REVIVE_HP);
    return;
  }

  // Health stays on 0 until the list is cleared.
  mustFix = new Set(lockdown.ids);

  fire("battle:lockdown", { total: lockdown.ids.length, difficulty });
  fire("battle:lockdownStep", lockdownStatus());
  announce();
}

function lockdownStatus() {
  if (!lockdown) return null;

  return {
    active: true,
    total: lockdown.ids.length,
    done: lockdown.index,
    currentId: lockdown.ids[lockdown.index],
    cleared: lockdown.index >= lockdown.ids.length,
  };
}

/* The app asks: is this question part of the current lockdown? Those questions
   cost no health, and rating them "Nailed it" is what clears them. */
function isFixQuestion(id) {
  return mustFix.has(id);
}

/* What still has to be done, easiest difficulty first, so the student gets
   some wins back before the nasty ones. */
function getLockdownPriority() {
  return LOCKDOWN_ORDER
    .map((difficulty) => ({
      difficulty,
      ids: [...mustFix].filter((id) => matchesDifficulty(id, difficulty)),
    }))
    .filter((group) => group.ids.length > 0);
}

/* The owed questions as one flat list, easiest difficulty first. app.js uses
   this to serve only these questions until the lockdown is cleared. */
function getLockdownOwedIds() {
  return LOCKDOWN_ORDER.flatMap((difficulty) =>
    [...mustFix].filter((id) => matchesDifficulty(id, difficulty)));
}

/* Done? Back on his feet with half health. */
function clearLockdown() {
  if (!lockdown) return false;

  lockdown = null;
  mustFix = new Set();
  Health.setHpSilently(Health.REVIVE_HP);

  fire("battle:lockdownClear", { revivedAt: Health.REVIVE_HP });
  persist();
  return true;
}


/* ==========================================================================
   9. FIGHTING: WHAT A BUTTON DID
   --------------------------------------------------------------------------
   Three entry points, one per button, plus undo. Each returns the health
   result so the UI can show a floating number, and updates the villain and the
   lockdown as a side effect.

   `context` carries what the app knows and this file does not:
     questionId, difficulty, phase ("check" | "giveup"), checker
   ========================================================================== */

/* Damage only happens in Boss Battle, never during a knockout, and never for
   the "I don't know" question twice. */
function skipsDamage(context) {
  if (!isBossMode()) return true;      // Free Practice: no health at all
  if (lockdown) return true;           // already down, nothing to lose
  if (isFixQuestion(context.questionId)) return true;   // re-answering the homework

  // "I don't know" already cost 15 health when the button was pressed, so
  // rating it "Missed it" afterwards is the same event and must not be
  // charged a second time.
  if (context.phase === "giveup") return true;

  return false;
}

/* Pressed "I don't know": hurts Batman, does no villain damage. */
function onGiveUp(context = {}) {
  if (context.questionId) missedIds.add(context.questionId);

  if (lockdown) {
    if (context.questionId) mustFix.add(context.questionId);
    announce();
    return null;
  }

  if (!isBossMode()) return null;

  const result = Health.applyHit("giveUp", context.difficulty, { questionId: context.questionId });
  if (result.knockedOut) startLockdown();
  announce();
  return result;
}

/* Pressed "Check my answer" with an empty or very short answer. */
function onEmptyAnswer(context = {}) {
  if (skipsDamage(context)) return null;

  const result = Health.applyHit("empty", context.difficulty, { questionId: context.questionId });
  if (result.knockedOut) startLockdown();
  announce();
  return result;
}

/**
 * Rated yourself after checking your answer.
 * @param {"nailed"|"partly"|"missed"} result
 * @returns {{health:object|null, villainHit:boolean}}
 */
function onRating(result, context = {}) {
  const questionId = context.questionId;
  const wasFixing = isFixQuestion(questionId);

  if (result === "missed" && questionId) missedIds.add(questionId);

  let villainHit = false;

  /* --- villain damage ------------------------------------------------ */
  // While Batman is down, the questions are homework, not attacks: you cannot
  // hit the villain until you have earned your way back up. Without this, a run
  // of "Nailed it" answers on the owed questions could beat a villain from the
  // floor — which healed him up and skipped the whole knockout.
  if (isBossMode() && !lockdown) {
    const outcome = hitCheckOutcome({ ...context, result });
    if (outcome.downgraded) fire("battle:downgrade", { reason: "checker-fail", ratio: outcome.ratio });

    if (outcome.hit) {
      const villain = villainById(progress.villainId);
      progress.hits[villain.id] = Math.min(villain.hitsToDefeat, progress.hits[villain.id] + 1);
      villainHit = true;

      const left = hitsLeftFor(villain.id);
      fire("battle:hit", { villainName: villain.name, hits: progress.hits[villain.id], hitsLeft: left });

      if (left === 0) {
        progress.defeated[villain.id] = true;
        winFight(villain);
      } else {
        saveProgress();
        announce();
      }
    }
  }

  /* --- Batman's health ----------------------------------------------- */
  let healthResult = null;

  if (!wasFixing && !skipsDamage(context)) {
    if (result === "partly") {
      healthResult = Health.applyHit("partly", context.difficulty, { questionId });
    } else if (result === "nailed") {
      // A hard question heals double.
      const rule = context.difficulty === "hard" ? "nailedHard" : "nailedEasy";
      healthResult = Health.applyHit(rule, context.difficulty, { questionId });
    }
  }

  if (healthResult && healthResult.knockedOut) startLockdown();

  /* --- clearing the lockdown ----------------------------------------- */
  // Only "Nailed it" counts. Anything less and the question stays owed, so it
  // is served again next round instead of quietly dropping off the list.
  if (wasFixing) {
    if (result === "nailed") {
      mustFix.delete(questionId);

      if (lockdown) {
        // One step forward for the "X of Y" counter.
        lockdown.index = Math.min(lockdown.index + 1, lockdown.ids.length);
        fire("battle:lockdownStep", lockdownStatus());

        // Every owed question answered properly: Batman gets back up on 50.
        if (mustFix.size === 0) clearLockdown();
        else announce();
      }
    } else {
      fire("battle:lockdownStep", lockdownStatus());
      announce();
    }
  }

  if (!villainHit) announce();
  return { health: healthResult, villainHit };
}

/* Pressed "That was actually right": hand the damage back. */
function onUndo() {
  // Remember which hit we are taking back, because it changes what the
  // question counts as: a question you gave up on but then said you actually
  // knew is no longer a miss, so it must not come back in the next lockdown.
  let undoneQuestion = null;
  const onUndone = (event) => { undoneQuestion = event.detail.undone.questionId || null; };
  window.addEventListener("health:undone", onUndone, { once: true });

  const ok = Health.undoLastHit();

  window.removeEventListener("health:undone", onUndone);
  if (ok && undoneQuestion) missedIds.delete(undoneQuestion);

  announce();
  return ok;
}

/* The app calls this when a fresh round starts.

   It deliberately does NOT clear the lockdown list: a question you owe stays
   owed until you answer it properly, no matter how many rounds pass. Only
   clearLockdown() ends the homework. */
function newRound() {
  announce();
}


/* ==========================================================================
   10. WINNING
   --------------------------------------------------------------------------
   Health back to full, the next villain unlocks and you move on to it. After
   the last villain there is a proper finale, and a rematch is always possible.
   ========================================================================== */
function winFight(villain) {
  // Full heal on victory. Nothing to heal in Free Practice.
  if (isBossMode()) Health.setHpSilently(Health.getMax());

  const next = VILLAINS[villainIndex(villain.id) + 1] || null;

  if (next && !isUnlocked(next.id)) {
    progress.unlocked.push(next.id);
    progress.villainId = next.id;    // walk straight over to the new villain
  }

  saveProgress();

  if (next) {
    fire("battle:victory", {
      villainId: villain.id,
      villainName: villain.name,
      nextId: next.id,
      nextName: next.name,
      line: villain.victoryLine,
    });
  } else {
    fire("battle:finale", { villainName: villain.name, line: villain.victoryLine });
  }

  announce();
}

/* Short status line for the panel: "Easy Villain · 3 hits left". */
function statusLine() {
  const left = hitsLeftFor(progress.villainId);
  return `${villainById(progress.villainId).name} · ${left} hit${left === 1 ? "" : "s"} left`;
}

/* Start the same villain again from full health, which is what the rematch
   button on the final victory screen does. */
function rematch(id) {
  const villain = villainById(id);

  if (!isUnlocked(villain.id)) return { ok: false, reason: "locked" };

  progress.hits[villain.id] = 0;
  progress.villainId = villain.id;

  lockdown = null;
  mustFix = new Set();

  if (isBossMode()) Health.setHpSilently(Health.getMax());

  persist();
  return { ok: true, villainName: villain.name };
}


/* ==========================================================================
   11. HOOKS FROM THE APP
   ========================================================================== */

/**
 * Called by app.js with two small helpers, so this file never has to import the
 * question list (that would be a circular import):
 *   getMissedIdsFor(difficulty) -> [id, ...] from saved history
 *   getQuestionsFor(difficulty) -> [question]    from questions.json
 * Safe to call again after the questions have loaded — the cache is rebuilt.
 */
function init(appHooks = {}) {
  hooks = { ...hooks, ...appHooks };
  difficultyIds = new Map();
}

/* Wipes battle progress AND health. Wired to the Reset button in the header. */
function resetProgress() {
  progress = freshProgress();
  mode = "boss";
  lockdown = null;
  mustFix = new Set();
  missedIds = new Set();

  saveProgress();
  Health.resetHealth();
  fire("battle:modechanged", { mode });
  announce();
}

/* characters.js and battle.js have to agree about the villains, otherwise the
   3D stage and the rules would be fighting different characters. */
function checkConfig() {
  const problems = [];
  if (!CHARACTERS || !CHARACTERS.player || !CHARACTERS.player.name) {
    problems.push("CHARACTERS.player.name is missing");
  }
  if (!Array.isArray(VILLAINS) || VILLAINS.length === 0) problems.push("VILLAINS is empty");

  VILLAINS.forEach((villain, index) => {
    if (!villain.id) problems.push(`villain ${index} has no id`);
    if (!villain.next && index < VILLAINS.length - 1) {
      problems.push(`${villain.id} does not say what comes next`);
    }
  });

  if (problems.length) console.warn("[battle] Config problem:", problems.join("; "));
  return problems.length === 0;
}


/* ==========================================================================
   12. EXPORTED API
   ========================================================================== */
export const Battle = {
  REQUIRE_CHECKER_FOR_HIT,
  CHECKER_HIT_THRESHOLD,

  init,
  checkConfig,
  snapshot,
  statusLine,

  // modes
  getMode,
  isBossMode,
  setMode,

  // villains
  villainCards,
  getVillain,
  getVillainId,
  selectVillain,
  getLockedDifficulty,
  isFinalStretch,

  // fighting
  onGiveUp,
  onEmptyAnswer,
  onRating,
  onUndo,
  hitCheckOutcome,

  // knockout lockdown
  lockdownStatus,
  getLockdownPriority,
  getLockdownOwedIds,
  isFixQuestion,
  clearLockdown,

  // housekeeping
  newRound,
  rematch,
  resetProgress,
};

checkConfig();
announce();