/* ==========================================================================
   battle-ui.js — DRAWING THE FIGHT
   ==========================================================================
   health.js and battle.js decide what happens. This file is the part that
   shows it: the health bars, the segmented villain bar, the villain picker,
   the floating damage numbers, the knockout banner and the victory panel.

   The rule for this project: nothing in here changes a number. It only reads
   snapshots and events, so the rules and the drawing can never disagree.
   ========================================================================== */

import { Health } from "./health.js";
import { Battle } from "./battle.js";

/* How long a floating number stays on screen. Matches the CSS animation. */
const FLOAT_MS = 1100;


/* ==========================================================================
   1. DOM LOOKUP
   ========================================================================== */
const els = {
  panel:      document.getElementById("boss-panel"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  difficultyRow: document.getElementById("difficulties"),

  playerBar:  document.querySelector(".bar--player .bar__fill"),
  playerValue: document.querySelector(".hud--player .hud__value"),

  villainName:  document.getElementById("hud-villain-name"),
  villainBar:   document.querySelector(".bar--villain"),
  villainSegments: document.querySelector(".bar--villain .bar__segments"),
  villainValue: document.querySelector(".hud--villain .hud__value"),

  picker:     document.getElementById("villain-picker"),
  lockdown:   document.getElementById("lockdown"),
  floaters:   document.getElementById("arena-floaters"),
  undoBtn:    document.getElementById("undo-btn"),

  victory:    document.getElementById("victory"),
  victoryTitle: document.getElementById("victory-title"),
  victoryLine:  document.getElementById("victory-line"),
  victoryNext:  document.getElementById("victory-next"),
  victoryRematch: document.getElementById("victory-rematch"),
};

const bossMode = () => Battle.isBossMode();


/* ==========================================================================
   2. BATMAN'S HEALTH BAR
   ========================================================================== */
function paintHealth(event) {
  const hp = event.detail.hp;
  const max = event.detail.max;
  const percent = Math.max(0, Math.min(100, (hp / max) * 100));

  els.playerBar.style.width = percent + "%";

  // Colour by how much is left: green, then amber, then red.
  els.playerBar.dataset.level =
    percent <= 25 ? "critical" : percent <= 55 ? "low" : "ok";

  els.playerValue.textContent = `${hp} / ${max}`;
  els.playerValue.dataset.level = els.playerBar.dataset.level;

  /* The undo button only exists while there is a hit to take back. It carries
     the reason too, so a bar never moves without an explanation next to it. */
  if (els.undoBtn) {
    els.undoBtn.hidden = !event.detail.canUndo;
    if (event.detail.canUndo && event.detail.label) {
      els.undoBtn.textContent =
        `↺ That was actually right — take back ${event.detail.label}`;
    }
  }
}


/* ==========================================================================
   3. THE VILLAIN'S SEGMENTED BAR
   --------------------------------------------------------------------------
   One box per hit, so you can see how close the fight is. A box turns dark
   once you have landed that hit.
   ========================================================================== */
function paintVillain(state) {
  const villain = state.villainId ? state : Battle.snapshot();

  els.villainName.textContent = villain.villainName;

  // Rebuild the segments whenever the villain changes (different hit count),
  // otherwise just repaint the ones already there.
  const wanted = villain.hitsToDefeat;
  if (els.villainSegments.childElementCount !== wanted) {
    els.villainSegments.textContent = "";
    for (let i = 0; i < wanted; i++) {
      const segment = document.createElement("span");
      segment.className = "bar__seg";
      segment.title = `Hit ${i + 1}`;
      els.villainSegments.append(segment);
    }
  }

  for (let i = 0; i < wanted; i++) {
    els.villainSegments.children[i].classList.toggle("is-spent", i < villain.hits);
  }

  els.villainBar.dataset.accent = villain.villainAccent || "";

  const left = villain.hitsLeft;
  els.villainValue.textContent =
    left === 0 ? "defeated" : `${left} hit${left === 1 ? "" : "s"} left`;
  els.villainValue.classList.toggle("is-last", left === 1);
  els.villainValue.classList.toggle("is-out", left === 0);
}


/* ==========================================================================
   4. THE VILLAIN PICKER
   --------------------------------------------------------------------------
   Three cards: name, difficulty, hits needed and locked state. Locked cards
   cannot be clicked, and say who you have to beat first.
   ========================================================================== */
function paintPicker() {
  const cards = Battle.villainCards();

  els.picker.textContent = "";
  for (const card of cards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "villain";
    button.dataset.difficulty = card.difficulty;
    button.dataset.accent = card.accent || "";
    button.disabled = !card.unlocked;

    if (card.fighting) button.classList.add("is-fighting");
    if (card.defeated) button.classList.add("is-defeated");

    const lock = card.unlocked ? "" : "🔒 ";
    button.innerHTML =
      `<span class="villain__name">${lock}${card.name}</span>` +
      `<span class="villain__meta">${card.difficulty} · ${card.hitsToDefeat} hits</span>` +
      `<span class="villain__state">${
        card.fighting ? "fighting now"
        : card.defeated ? "beaten — rematch"
        : card.unlocked ? card.hitsLeft + " hits left"
        : `beat ${card.next} first`}</span>`;

    button.addEventListener("click", () => {
      const result = Battle.selectVillain(card.id);
      if (!result.ok && result.reason === "locked") {
        say(`Locked. Beat ${result.villainName}'s predecessor first.`);
      }
    });

    els.picker.append(button);
  }
}


/* ==========================================================================
   5. FLOATING DAMAGE NUMBERS
   --------------------------------------------------------------------------
   Positioned over whichever fighter it belongs to. Purely decorative, so it
   is appended, animated and thrown away again.
   ========================================================================== */
function float(text, side, kind) {
  if (!els.floaters) return;

  const node = document.createElement("span");
  node.className = `floater floater--${side} floater--${kind}`;
  node.textContent = text;

  els.floaters.append(node);

  // Belt and braces: remove it even if the animation never fires an event.
  const remove = () => node.remove();
  node.addEventListener("animationend", remove, { once: true });
  window.setTimeout(remove, FLOAT_MS);
}

/* Health went up or down. */
function onHealthChanged(event) {
  const detail = event.detail;

  paintHealth(event);

  // No number for "he was set to a value" or the undo button: nothing happened.
  if (!detail.delta || detail.reason === "undo" || detail.reason === "set") return;

  // Taking damage shakes him; healing does not need a reaction.
  if (detail.delta < 0) stage().flinch("player", "#ff5a5a");

  float(
    (detail.delta > 0 ? "+" : "") + detail.delta,
    "player",
    detail.delta > 0 ? "heal" : "hurt",
  );
}

/* A hit landed on the villain. */
function onVillainHit(event) {
  const { villainName, hitsLeft, hits } = event.detail;

  // Batman steps forward, the villain takes it.
  stage().lunge("player");
  stage().flinch("villain", "#ffffff");

  // Break the segment that just went, then repaint the bar underneath it.
  breakSegment(hits - 1);

  float("1 hit", "villain", "hit");
  say(hitsLeft === 1
    ? `${villainName} is one hit from going down!`
    : `${villainName} took a hit — ${hitsLeft} to go.`);
}

/**
 * The 3D stage, if it managed to start. Stage 3 is all decoration, so a
 * missing arena must never be allowed to break the quiz.
 */
function stage() {
  return window.battleArena || {
    lunge() {}, flinch() {}, knockDown() {}, celebrate() {}, revive() {},
  };
}

/**
 * Snap one bar segment off, so a hit on the villain looks like it cost
 * something. The class is added, not left on: paintVillain owns is-spent.
 */
function breakSegment(index) {
  const segment = els.villainSegments.children[index];
  if (!segment || !els.villainSegments.animate) return;

  // With reduced motion the segment just turns spent like all the others,
  // instead of flying off and leaving a hole in the bar.
  if (prefersReducedMotion()) return;

  // Starting at the segment that just went means it falls, not the ones
  // that went before it.
  const offset = els.villainSegments.children.length - 1 - index;

  segment.animate(
    [
      { transform: "translateX(0) rotate(0deg)", opacity: 1 },
      { transform: `translateX(${-4 - offset * 2}px) rotate(-16deg)`, opacity: 1, offset: 0.35 },
      { transform: `translateX(${-10 - offset * 4}px) translateY(26px) rotate(-70deg)`, opacity: 0 },
    ],
    {
      duration: 420,
      easing: "cubic-bezier(.3,.1,.4,1)",
      fill: "forwards",
    }
  );
}

/** Has the visitor asked for less movement? */
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}


/* ==========================================================================
   6. THE KNOCKOUT BANNER
   ========================================================================== */
function onLockdown(event) {
  const { total, difficulty } = event.detail;

  // He goes down: tip over and go grey until the missed ones are cleared.
  stage().knockDown("player");

  els.lockdown.hidden = false;
  els.lockdown.innerHTML =
    `<strong>Batman is down.</strong> Re-answer the ${total} ` +
    `${difficulty} question${total === 1 ? "" : "s"} you just got wrong, ` +
    `then rate each one <em>Nailed it</em> to get back up on ${Health.REVIVE_HP} health. ` +
    `<span class="lockdown__count" id="lockdown-count"></span>`;
}

function onLockdownStep(event) {
  const count = document.getElementById("lockdown-count");
  if (!count) return;

  const { done, total } = event.detail;
  count.textContent = `${done} of ${total} cleared.`;
}

function onLockdownClear() {
  // Back on his feet, in full colour, and the villain keeps its damage.
  stage().revive("player");

  els.lockdown.hidden = true;
  els.lockdown.textContent = "";
  float(`+${Health.REVIVE_HP}`, "player", "heal");
  say(`Back on your feet with ${Health.REVIVE_HP} health. The villain kept its damage.`);
}

/* Rebuild the banner from a snapshot. Used on every repaint, so a page reload
   in the middle of a knockout still shows what is owed. */
function paintLockdown(state) {
  const info = state && state.lockdown;

  if (!info) {
    els.lockdown.hidden = true;
    els.lockdown.textContent = "";
    return;
  }

  els.lockdown.hidden = false;
  els.lockdown.innerHTML =
    `<strong>Batman is down.</strong> Re-answer the ${info.total} question` +
    `${info.total === 1 ? "" : "s"} you just got wrong, then rate each one ` +
    `<em>Nailed it</em> to get back up on ${Health.REVIVE_HP} health. ` +
    `<span class="lockdown__count">${info.done} of ${info.total} cleared.</span>`;
}


/* ==========================================================================
   7. THE VICTORY PANEL
   ========================================================================== */
function showVictory(event) {
  const { nextName, villainName, line } = event.detail;
  const finale = !nextName;

  // The villain tips over and fades away. Next one loads on top of that.
  stage().celebrate("villain");

  els.victoryTitle.textContent = finale
    ? "Every villain beaten"
    : `${villainName} defeated`;
  els.victoryLine.textContent = line || "";

  els.victoryNext.hidden = finale;
  els.victoryNext.textContent = nextName ? `Fight ${nextName}` : "";
  els.victoryRematch.hidden = !finale;
  els.victoryRematch.textContent = `Rematch ${villainName}`;

  els.victory.hidden = false;
}

function hideVictory() {
  els.victory.hidden = true;
}


/* ==========================================================================
   8. THE MODE SWITCH
   --------------------------------------------------------------------------
   In Free Practice the fight UI is hidden entirely, so it is obvious there is
   no health and no villain involved.
   ========================================================================== */
function paintMode(state) {
  const on = state.mode === "boss";

  els.panel.dataset.mode = state.mode;
  els.panel.hidden = !on;

  for (const button of els.modeButtons) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  // The difficulty filter is the villain's choice in a fight, so that row is
  // hidden to make it obvious. Category and type keep working as usual, and
  // the difficulty badge on the card still tells you what you are being asked.
  if (els.difficultyRow) els.difficultyRow.hidden = on;
}


/* ==========================================================================
   9. A SMALL LIVE REGION FOR THINGS WORTH SAYING
   --------------------------------------------------------------------------
   Screen readers announce this, and it is handy for everyone else too.
   ========================================================================== */
let sayTimer = null;

function say(message) {
  let live = document.getElementById("battle-live");
  if (!live) {
    live = document.createElement("p");
    live.id = "battle-live";
    live.className = "sr-only";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    document.body.append(live);
  }

  live.textContent = message;

  // Clear it after a while so a screen reader is not left with stale text.
  window.clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => { live.textContent = ""; }, 6000);
}


/* ==========================================================================
   10. TELLING THE 3D STAGE WHICH VILLAIN TO SHOW
   --------------------------------------------------------------------------
   battle.js knows the rules, arena.js draws the model. This is the only bridge
   between them, and it goes through the small public API the stage exposes.
   ========================================================================== */
/**
 * Hold a villain swap until the fighter currently on the floor has finished
 * what he is doing. Without this, defeating a villain would pull the model out
 * of the scene on the same frame, and there would be nobody left to fall over.
 */
let swapTimer = null;

function swapVillainWhenReady(villainId) {
  const arena = window.battleArena;
  if (!arena || swapTimer) return;

  const wait = () => {
    const current = arena.view.actors.villain;
    const busy = current && current.motions && current.motions.length > 0;

    if (!busy) {
      swapTimer = null;
      arena.setVillain(villainId);
      return;
    }

    swapTimer = window.setTimeout(wait, 60);
  };

  swapTimer = window.setTimeout(wait, 60);
}

function syncArena(state) {
  const arena = window.battleArena;
  if (!arena) return;                     // no WebGL, or the stage is not up yet

  if (arena.view.villainId === state.villainId) {
    // Same opponent, but on a rematch he is still lying there from the last
    // fight. A fight that starts at zero hits has to put him back on his feet.
    if (state.hits === 0) arena.revive("villain");
    return;
  }

  const current = arena.view.actors.villain;
  if (current && current.isDown) {
    swapVillainWhenReady(state.villainId);
    return;
  }

  arena.setVillain(state.villainId);
}


/* ==========================================================================
   11. REPAINT EVERYTHING
   ========================================================================== */
function renderAll(state = Battle.snapshot()) {
  paintMode(state);
  paintHealth({ detail: { hp: Health.getHp(), max: Health.getMax(), canUndo: Health.hasUndo() } });
  paintVillain(state);
  paintPicker();
  paintLockdown(state);
  syncArena(state);

  // After a reload in the middle of a knockout, the banner is up but the stage
  // has just started fresh. knockDown() does nothing if he is already down.
  if (state.lockdown) stage().knockDown("player");
}


/* ==========================================================================
   12. WIRING IT ALL UP
   --------------------------------------------------------------------------
   battle-ui.js talks to the rules files purely through events, so this is the
   only place that knows both exist.
   ========================================================================== */
for (const button of els.modeButtons) {
  button.addEventListener("click", () => {
    Battle.setMode(button.dataset.mode);
  });
}

if (els.undoBtn) {
  els.undoBtn.addEventListener("click", () => {
    if (Battle.onUndo()) say("Hit taken back. Damage undone.");
  });
}

if (els.victoryNext) {
  els.victoryNext.addEventListener("click", hideVictory);
}

if (els.victoryRematch) {
  els.victoryRematch.addEventListener("click", () => {
    Battle.rematch(Battle.getVillainId());
    hideVictory();
    say("Same villain, fresh fight. Full health.");
  });
}

// --- rules -> screen ---
window.addEventListener("battle:changed", (event) => renderAll(event.detail));
window.addEventListener("battle:modechanged", () => renderAll());
window.addEventListener("battle:hit", onVillainHit);
window.addEventListener("battle:victory", showVictory);
window.addEventListener("battle:finale", showVictory);
window.addEventListener("battle:lockdown", onLockdown);
window.addEventListener("battle:lockdownStep", onLockdownStep);
window.addEventListener("battle:lockdownClear", onLockdownClear);

// --- health -> screen ---
window.addEventListener("health:changed", onHealthChanged);
window.addEventListener("health:healed", (event) => {
  paintHealth(event);
  float(`+${event.detail.amount}`, "player", "heal");
});

// First paint, straight from the saved state.
Health.checkDailyReset();
renderAll();

/* Handy for poking at from the console, exactly like window.battleArena for
   the 3D stage. These are the same objects the rest of the app uses, so this is
   a window onto the live rules rather than a copy:

     Health.getHp()                 current health
     Battle.snapshot()              mode, villain, hits, lockdown
     Battle.setMode("practice")     switch modes
     Battle.onRating("nailed", { questionId: "js-closures-1", difficulty: "easy" })
   */
window.battleUI = { renderAll, say, float };
window.Health = Health;
window.Battle = Battle;