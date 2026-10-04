/* ==========================================================================
   Interview Practice — app logic
   --------------------------------------------------------------------------
   Everything below is plain JavaScript. No build step, no dependencies, so you
   can open this file in any editor and change it.

   HOW THE APP IS WIRED TOGETHER
   --------------------------------------------------------------------------
   1.  loadQuestions()   reads questions.json
   2.  buildFilters()    one button per category, difficulty and type
   3.  applyFilters()    narrows the pool using all three filters
   4.  buildQueue()      weighted random: weak questions come back more often
   5.  startTimer()      counts up from 00:00 on every new question
   6.  checkAnswer()     reveals the coaching blocks, then you rate yourself
       giveUp()          reveals everything and records a Missed for you
   7.  recordResult()    saves stats per question id into localStorage
   8.  renderReview()    study list of the questions you keep missing

   The variables in the STATE block are the only mutable data in the app —
   every function reads or updates that state.

   BOSS BATTLE (added later)
   --------------------------------------------------------------------------
   This file stays the quiz: loading, filtering, revealing, rating. The fight
   itself lives in three new files, and app.js only tells them when a button
   was pressed:

     health.js     Batman's health: the damage table, healing, the undo
     battle.js     the fight: modes, villains, hits, knockouts, unlocking
     battle-ui.js  draws the panel, bars and floating numbers from their events

   Because those three are modules, app.js is a module too (see the script tag
   in index.html). That is the only change needed to the old code above — no
   global variables were relied on.
   ========================================================================== */

import { Health } from "./health.js";
import { Battle } from "./battle.js";
import "./battle-ui.js";   // imported for its side effect: it wires itself up


/* ==========================================================================
   1. CONSTANTS
   ========================================================================== */

/* Where the questions live. Change this if you rename the file. */
const QUESTIONS_URL = "questions.json";

/* The three self-ratings. `score` is unused for now but handy for sorting. */
const RATINGS = {
  nailed: { label: "Nailed it", score: 1 },
  partly: { label: "Partly",    score: 2 },
  missed: { label: "Missed it", score: 3 },
};

/* Order for the difficulty buttons, easiest first. Anything else found in the
   JSON is added after these. */
const DIFFICULTY_ORDER = ["easy", "neutral", "hard"];

/* Order for the type buttons. */
const TYPE_ORDER = ["knowledge", "situational", "logical"];

/* The filter rows. Each one filters on one field of the question object, and
   the buttons are built from whatever values exist in questions.json — so a
   brand new type or category needs no code change here, only data.
   `capitalize` turns knowledge into Knowledge for the button labels. */
const FILTERS = {
  category:   { order: null },                // alphabetical
  difficulty: { order: DIFFICULTY_ORDER },
  type:       { order: TYPE_ORDER, capitalize: true },
};

/* One localStorage key holds everything: { stats, history }.
   Bump the version ("v1" -> "v2") if you change that shape. */
const STORAGE_KEY = "interview-practice.data.v1";

/* Keep the stored history from growing forever. */
const HISTORY_LIMIT = 200;

/* Seconds before the timer turns red, to nudge you to be concise. */
const SLOW_AFTER_SECONDS = 60;

/* Most often one question may appear inside a single round. Stops one really
   weak question from filling the whole round. */
const MAX_COPIES = 3;

/* Boss Battle: pressing "Check my answer" with less than this many characters
   counts as no answer at all, and costs Batman 10 health. 20 characters is
   roughly one sentence, which is about the shortest useful spoken answer. */
const MIN_ANSWER_CHARS = 20;


/* ==========================================================================
   2. DOM REFERENCES
   --------------------------------------------------------------------------
   document.getElementById() looks an element up by the id in index.html.
   We do it once at the top instead of on every click, because repeated
   lookups are slower and this keeps the rest of the code shorter.
   ========================================================================== */
const els = {
  timer:        document.getElementById("timer"),
  loadError:    document.getElementById("load-error"),

  tabPractice:  document.getElementById("tab-practice"),
  tabReview:    document.getElementById("tab-review"),
  reviewCount:  document.getElementById("review-count"),
  screenPractice: document.getElementById("screen-practice"),
  screenReview: document.getElementById("screen-review"),
  reviewHint:   document.getElementById("review-hint"),
  reviewList:   document.getElementById("review-list"),

  categories:   document.getElementById("categories"),
  difficulties: document.getElementById("difficulties"),
  types:        document.getElementById("types"),
  progress:     document.getElementById("progress"),

  category:     document.getElementById("category"),
  difficulty:   document.getElementById("difficulty"),
  type:         document.getElementById("type"),
  question:     document.getElementById("question"),
  codeBlock:    document.getElementById("code-block"),
  codeText:     document.getElementById("code-text"),
  answer:       document.getElementById("answer"),
  checkBtn:     document.getElementById("check-btn"),
  giveupBtn:    document.getElementById("giveup-btn"),
  nextBtn:      document.getElementById("next-btn"),

  reveal:         document.getElementById("reveal"),
  revealAnalogy:  document.getElementById("reveal-analogy"),
  revealClarifying: document.getElementById("reveal-clarifying"),
  revealApproach: document.getElementById("reveal-approach"),
  revealMistakes: document.getElementById("reveal-mistakes"),
  revealModel:    document.getElementById("reveal-model"),
  revealAnswer:   document.getElementById("reveal-answer"),
  revealExample:  document.getElementById("reveal-example"),
  revealFollowup: document.getElementById("reveal-followup"),
  revealKeypoints: document.getElementById("reveal-keypoints"),

  analogy:        document.getElementById("analogy"),
  clarifyingList: document.getElementById("clarifying-list"),
  approachList:   document.getElementById("approach-list"),
  mistakesList:   document.getElementById("mistakes-list"),
  modelAnswer:    document.getElementById("model-answer"),
  finalAnswer:    document.getElementById("final-answer"),
  example:        document.getElementById("example"),
  followup:       document.getElementById("followup"),
  keypointsList:  document.getElementById("keypoints-list"),

  rating:       document.getElementById("rating"),
  missedNote:   document.getElementById("missed-note"),

  statNailed:   document.getElementById("stat-nailed"),
  statPartly:   document.getElementById("stat-partly"),
  statMissed:   document.getElementById("stat-missed"),
  clearBtn:     document.getElementById("clear-btn"),
};

/* The filter rows, keyed by the question field each one controls. */
const filterRows = {
  category: els.categories,
  difficulty: els.difficulties,
  type: els.types,
};


/* ==========================================================================
   3. QUESTION TYPE — WHICH BLOCKS TO REVEAL
   --------------------------------------------------------------------------
   Each reveal block in index.html has an entry in BLOCKS below. This table
   says which blocks to show, and in which order, for each question type and
   each path through the app:

     check  — you answered and pressed "Check my answer"
     giveup — you pressed "I don't know", so you get the whole lesson

   A block only appears if it is listed here AND the question actually has
   content for it. That is why knowledge questions written before this feature
   existed keep working: they have no clarifyingQuestions, so that block is
   simply skipped.

   Note the "check" list is deliberately not everything: after answering you
   want the coaching (questions to ask, how to approach it, what people get
   wrong), while "giveup" is the full lesson, so it adds the background too.
   ========================================================================== */
const REVEAL_ORDER = {
  knowledge: {
    check:  ["keypoints"],
    giveup: ["analogy", "model", "example", "keypoints"],
  },
  situational: {
    check:  ["clarifying", "approach", "mistakes", "model", "followup"],
    giveup: ["analogy", "clarifying", "approach", "mistakes", "model", "example", "followup", "keypoints"],
  },
  logical: {
    check:  ["clarifying", "approach", "mistakes", "model", "answer", "followup"],
    giveup: ["analogy", "clarifying", "approach", "mistakes", "model", "answer", "example", "followup", "keypoints"],
  },
};

/* Every reveal block: which element holds it, and which field of the question
   fills it. `list: true` means build <li> items instead of setting text. */
const BLOCKS = {
  analogy: {
    root: els.revealAnalogy,
    body: els.analogy,
    from: "analogy",
  },
  clarifying: {
    root: els.revealClarifying,
    body: els.clarifyingList,
    from: "clarifyingQuestions",
    list: true,
  },
  approach: {
    root: els.revealApproach,
    body: els.approachList,
    from: "goodApproach",
    list: true,
  },
  mistakes: {
    root: els.revealMistakes,
    body: els.mistakesList,
    from: "commonMistakes",
    list: true,
  },
  model: {
    root: els.revealModel,
    body: els.modelAnswer,
    from: "modelAnswer",
  },
  answer: {
    root: els.revealAnswer,
    body: els.finalAnswer,
    from: "answer",
  },
  example: {
    root: els.revealExample,
    body: els.example,
    from: "example",
  },
  followup: {
    root: els.revealFollowup,
    body: els.followup,
    from: "followUp",
  },
  keypoints: {
    root: els.revealKeypoints,
    body: els.keypointsList,
    from: "keyPoints",
    list: true,
  },
};


/* ==========================================================================
   4. STATE
   --------------------------------------------------------------------------
   `data` is the whole of what we save to localStorage:
     data.stats   = { [questionId]: { timesSeen, timesMissed, timesNailed,
                                     lastResult, nailedStreak, lastAt } }
     data.history = [{ id, rating, seconds, at }, ...] newest first

   `timesSeen` counts finished attempts, so it only moves once you have rated
   the question or pressed "I don't know".
   ========================================================================== */
let data = loadState();

let allQuestions = [];   // every question loaded from questions.json
let pool = [];           // questions matching all the filters
let queue = [];          // the current round, ready to be popped one by one
let current = null;      // the question currently on screen

/* The three filters. "All" means no filter on that field. */
const filters = { category: "All", difficulty: "All", type: "All" };

/* Boss Battle: the last verdict a checker.js sent us, or null while there is
   no checker. See readCheckerVerdict() further down. */
let checkerVerdict = null;

let seconds = 0;         // how long you have been on this question
let timerId = null;      // handle for the setInterval timer
let phase = "answering"; // "answering" | "checked" | "gaveup"
let recorded = false;    // true once this question has been saved


/* ==========================================================================
   5. SAVING AND LOADING
   --------------------------------------------------------------------------
   localStorage only stores strings, and it can be unavailable (Safari private
   browsing throws). The try/catch means a blocked save never breaks the quiz,
   you just lose your history.
   ========================================================================== */
function loadState() {
  const empty = { stats: {}, history: [] };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;

    const parsed = JSON.parse(raw);
    return {
      stats: parsed.stats || {},
      history: parsed.history || [],
    };
  } catch (err) {
    console.warn("Could not read saved results:", err);
    return empty;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Could not save results:", err);
  }
}

/* Per-question record. Returns a fresh default for questions never seen, so
   the calling code can read the fields without checking for undefined. */
function statsFor(id) {
  return data.stats[id] || {
    timesSeen: 0,
    timesMissed: 0,
    timesNailed: 0,
    lastResult: null,     // "nailed" | "partly" | "missed"
    nailedStreak: 0,      // how many "Nailed it" in a row
    lastAt: null,
  };
}


/* ==========================================================================
   6. LOADING THE QUESTIONS
   ========================================================================== */
async function loadQuestions() {
  try {
    const response = await fetch(QUESTIONS_URL);

    // fetch() only rejects on network failure, so check the status by hand.
    if (!response.ok) {
      throw new Error(`Server replied ${response.status} ${response.statusText}`);
    }

    const parsed = await response.json();

    // Cheap sanity check: the file must be an array of question objects.
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("questions.json must contain a non-empty array");
    }

    // Fill in sensible defaults, so a half-finished question in the JSON
    // still works instead of breaking the page. Note the type: anything
    // written before types existed is a knowledge question.
    allQuestions = parsed.map((q, index) => ({
      id: q.id || `question-${index + 1}`,
      category: q.category || "General",
      difficulty: q.difficulty || "neutral",
      type: q.type || "knowledge",
      question: q.question || "",
      analogy: q.analogy || "",
      modelAnswer: q.modelAnswer || "",
      answer: q.answer || "",
      code: q.code || "",
      example: q.example || "",
      followUp: q.followUp || "",
      clarifyingQuestions: toArray(q.clarifyingQuestions),
      goodApproach: toArray(q.goodApproach),
      commonMistakes: toArray(q.commonMistakes),
      keyPoints: toArray(q.keyPoints),
    }));

    warnAboutDuplicateIds();

    /* Now that the questions exist, battle.js can look up "everything you ever
       missed at this difficulty" without importing this file (which would be a
       circular import). Safe to call again: it just refreshes its cache. */
    Battle.init({
      getMissedIdsFor: getMissedIdsFor,
      getQuestionsFor: getQuestionsFor,
    });

    buildFilters();
    applyFilters();
  } catch (err) {
    showLoadError(err);
  }
}

/* Missing list fields become empty arrays, so the reveal code never has to
   check for undefined. */
function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/* The two helpers battle.js asks for. Both are read-only views of the state
   this file already owns. */

/* Every question id you have ever missed, filtered to one difficulty. Used to
   build a knockout lockdown when nothing was missed in this sitting. */
function getMissedIdsFor(difficulty) {
  return Object.keys(data.stats).filter((id) => {
    const stats = data.stats[id];
    if (stats.timesMissed < 1) return false;
    return getQuestionsFor(difficulty).some((question) => question.id === id);
  });
}

/* Every loaded question at one difficulty. */
function getQuestionsFor(difficulty) {
  return allQuestions.filter((question) => question.difficulty === difficulty);
}

/* Review data is stored per id, so two questions sharing an id would share
   their stats. Worth a warning while you are editing the file. */
function warnAboutDuplicateIds() {
  const seen = new Set();
  for (const q of allQuestions) {
    if (seen.has(q.id)) {
      console.warn(`Duplicate question id "${q.id}" — their review stats will be shared.`);
    }
    seen.add(q.id);
  }
}

function showLoadError(err) {
  console.error(err);

  // The most common cause: opening index.html by double-clicking it. Browsers
  // block fetch() from file:// pages, so questions.json cannot be read.
  els.loadError.innerHTML =
    "Could not load <code>questions.json</code> (" + err.message + "). " +
    "If you opened this file directly, serve the folder over HTTP instead — " +
    "for example run <code>python3 -m http.server 8000</code> in this folder, " +
    "then visit <code>http://localhost:8000</code>. " +
    "It works normally once hosted on GitHub Pages.";

  els.loadError.hidden = false;
  els.question.textContent = "Questions unavailable.";
  els.screenPractice.hidden = true;
}


/* ==========================================================================
   7. FILTER BUTTONS (built from the data)
   --------------------------------------------------------------------------
   One loop over FILTERS builds all three rows, so adding a fourth filter
   later means adding one line to the FILTERS table, one <nav> in the HTML
   and one id here.
   ========================================================================== */
function buildFilters() {
  for (const [field, config] of Object.entries(FILTERS)) {
    const row = filterRows[field];
    row.textContent = "";   // clear anything already there

    // "All" plus every value actually used in the JSON
    const values = ["All", ...new Set(allQuestions.map((q) => q[field]))];

    // Either the fixed order from the config, or plain alphabetical
    const labels = config.order
      ? values.sort((a, b) => rank(a, config.order) - rank(b, config.order))
      : values.sort();

    for (const value of labels) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filters__btn";
      button.textContent = config.capitalize ? capitalize(value) : value;
      button.dataset.filter = value;          // the value we store
      if (config.order) button.dataset.level = value.toLowerCase();

      button.addEventListener("click", () => {
        filters[field] = value;
        applyFilters();
      });

      row.append(button);
    }
  }
}

/* "All" always sorts first; known values follow `order`, anything else last. */
/* The filters that are actually in force. In Free Practice that is just the
   three you picked. In Boss Battle the villain overrules the difficulty. */
function activeFilters() {
  const locked = Battle.getLockedDifficulty();

  if (!locked) return filters;

  return { ...filters, difficulty: locked };
}

function rank(value, order) {
  if (value === "All") return -1;
  const index = order.indexOf(value.toLowerCase());
  return index === -1 ? order.length : index;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function applyFilters() {
  // Highlight the active button in each row
  for (const [field, row] of Object.entries(filterRows)) {
    for (const button of row.children) {
      button.classList.toggle("is-active", button.dataset.filter === filters[field]);
    }
  }

  /* Keep only questions matching ALL THREE filters. During a Boss Battle the
     difficulty is not yours to choose: Battle hands us the villain's
     difficulty and it overrides whatever the filter row says. */
  const active = activeFilters();

  /* While Batman is knocked out, the only questions you get are the ones you
     got wrong — that is the whole point of the lockdown. The list comes
     straight from battle.js, so the rules stay in one place. */
  const owed = Battle.getLockdownOwedIds();

  pool = allQuestions.filter((question) => {
    if (owed.length && !owed.includes(question.id)) return false;

    return Object.entries(active).every(([field, value]) =>
      value === "All" || question[field] === value);
  });

  /* Boss Battle: a new round drops any lockdown homework that is no longer
     owed, and repaints the panel for the new villain. */
  Battle.newRound();

  // Start a fresh round, weighted by how well you know each question
  queue = buildQueue();
  nextQuestion();
}


/* ==========================================================================
   8. CHOOSING THE NEXT QUESTION — WEIGHTED RANDOM
   --------------------------------------------------------------------------
   A "round" is one pass over the filtered questions, so you never get the
   same question twice in a row while others are unseen.

   Each question earns a number of tickets for the round:
     * more tickets  -> appears several times, so it comes back more often
     * fewer than 1  -> may be left out of the round entirely
   That is how "Nailed it" twice in a row makes a question almost disappear.
   ========================================================================== */
function ticketsFor(id) {
  const stats = statsFor(id);
  let tickets = 1;                     // a new question: shown once

  if (stats.lastResult === "missed") tickets += 3;
  else if (stats.lastResult === "partly") tickets += 2;

  // the more often you missed it, the more it comes back (up to +2)
  tickets += Math.min(stats.timesMissed, 4) * 0.5;

  if (stats.nailedStreak >= 2) tickets *= 0.2;        // it has stuck: rare
  else if (stats.nailedStreak === 1) tickets *= 0.6;

  return tickets;
}

function buildQueue() {
  const bag = [];

  for (const question of pool) {
    const tickets = ticketsFor(question.id);

    // Under one ticket means this question can be skipped this round
    if (tickets < 1 && Math.random() > tickets) continue;

    // Whole tickets = how many times it appears, capped at MAX_COPIES
    const copies = Math.min(MAX_COPIES, Math.max(1, Math.round(tickets)));
    for (let copy = 0; copy < copies; copy++) bag.push(question);
  }

  // Never leave the student with an empty round
  if (bag.length === 0 && pool.length > 0) bag.push(pickRandom(pool));

  return shuffle(bag);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/* Fisher-Yates: copy the list, then walk backwards swapping each entry with a
   random earlier one. Copying first means we never modify the loaded data. */
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nextQuestion() {
  if (pool.length === 0) {
    // The filters matched nothing (for example JavaScript questions that are
    // all "knowledge"). Say so instead of showing an empty card.
    stopTimer();
    current = null;
    phase = "answering";
    recorded = true;     // nothing on screen to answer
    els.question.textContent = "No questions match these filters.";
    els.category.textContent = "";
    els.difficulty.textContent = "";
    els.type.textContent = "";
    els.progress.textContent = "";
    els.codeBlock.hidden = true;
    els.reveal.hidden = true;
    els.rating.hidden = true;
    els.missedNote.hidden = true;
    els.checkBtn.hidden = true;
    els.giveupBtn.hidden = true;
    els.nextBtn.hidden = true;
    return;
  }

  // Queue empty means this round is finished, so build a new weighted one.
  if (queue.length === 0) queue = buildQueue();

  // Avoid the same question twice in a row (possible now that a question can
  // appear several times per round).
  if (queue.length > 1 && queue[queue.length - 1] === current) {
    const j = Math.floor(Math.random() * (queue.length - 1));
    [queue[queue.length - 1], queue[j]] = [queue[j], queue[queue.length - 1]];
  }

  // pop() takes the question off the end of the shuffled bag
  current = queue.pop();

  phase = "answering";
  recorded = false;
  seconds = 0;

  // --- Paint the card ---
  els.category.textContent = current.category;
  els.difficulty.textContent = current.difficulty;
  els.difficulty.dataset.level = current.difficulty;
  els.type.textContent = current.type;
  els.type.dataset.type = current.type;
  els.question.textContent = current.question;
  els.answer.value = "";
  els.answer.disabled = false;

  // A code snippet is part of the question, so it shows straight away.
  // Only logical questions tend to have one.
  els.codeBlock.hidden = !current.code;
  els.codeText.textContent = current.code;

  // Hide the answer-revealing parts again for the new question
  els.reveal.hidden = true;
  els.rating.hidden = true;
  els.missedNote.hidden = true;
  els.checkBtn.hidden = false;
  els.giveupBtn.hidden = false;
  els.nextBtn.hidden = true;

  // Forget the rating picked last time, so nothing looks pre-selected
  for (const chip of els.rating.querySelectorAll(".chip")) {
    chip.classList.remove("is-selected");
  }

  updateProgress();
  renderTimer();
  startTimer();

  // Move the cursor into the box so you can start typing straight away
  els.answer.focus();
}

function updateProgress() {
  // Only mention the filters that are actually narrowed down
  const labels = Object.entries(activeFilters())
    .filter(([, value]) => value !== "All")
    .map(([field, value]) => (FILTERS[field].capitalize ? capitalize(value) : value));

  const count = `${queue.length} left in this round`;

  // While knocked out, say what is actually being asked for.
  const owed = Battle.getLockdownOwedIds();
  const prefix = owed.length ? "Lockdown · " : "";

  els.progress.textContent =
    labels.length ? `${prefix}${count} · ${labels.join(" · ")}` : `${prefix}${count}`;
}


/* ==========================================================================
   9. TIMER
   --------------------------------------------------------------------------
   setInterval calls our function every 1000 ms. We store the id so we can
   cancel it — otherwise the old timer keeps running over the new question.
   ========================================================================== */
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    seconds += 1;
    renderTimer();
  }, 1000);
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function renderTimer() {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  // padStart(2, "0") turns 7 into "07", so the width never changes
  els.timer.textContent =
    String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");

  // Colour the timer depending on how long you have been thinking
  els.timer.classList.toggle("is-running", seconds > 0 && seconds < SLOW_AFTER_SECONDS);
  els.timer.classList.toggle("is-slow", seconds >= SLOW_AFTER_SECONDS);
}


/* ==========================================================================
   10. REVEALING THE ANSWER
   --------------------------------------------------------------------------
   "Check my answer" shows the coaching blocks listed in REVEAL_ORDER.check.
   "I don't know" shows everything in REVEAL_ORDER.giveup.
   Both work the same way for every question type — only the block list differs.
   ========================================================================== */
function checkAnswer() {
  if (!current || phase !== "answering") return;

  phase = "checked";
  stopTimer();            // stop counting once you have answered

  /* Boss Battle: checking nothing costs 10 health. battle-ui.js explains why in
     the undo button, so the bars never move without a reason on screen. */
  if (els.answer.value.trim().length < MIN_ANSWER_CHARS) {
    Battle.onEmptyAnswer(context());
  }

  fillReveal("check");
  els.rating.hidden = false;
  els.missedNote.hidden = true;

  lockCard();
}

function giveUp() {
  if (!current || phase !== "answering") return;

  phase = "gaveup";
  stopTimer();

  fillReveal("giveup");
  els.rating.hidden = true;       // no self-rating needed, we know the result
  els.missedNote.hidden = false;

  lockCard();

  // Recorded for you, which is what feeds the weighting and the review screen
  recordResult("missed");

  // Boss Battle: this is the big one, -15 health scaled by difficulty.
  Battle.onGiveUp(context("giveup"));
}

/* Fills every reveal block from the current question.
   `mode` is "check" or "giveup" — see REVEAL_ORDER. */
function fillReveal(mode) {
  // Unknown types fall back to knowledge, so a typo in the JSON cannot break it
  const wanted = REVEAL_ORDER[current.type][mode];

  for (const [name, block] of Object.entries(BLOCKS)) {
    const content = current[block.from];

    // A block needs to be wanted for this mode AND have content to show.
    const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content);
    block.root.hidden = !(wanted.includes(name) && hasContent);

    block.body.textContent = "";
    if (!hasContent) continue;

    if (block.list) {
      for (const line of content) {
        const item = document.createElement("li");
        item.textContent = line;
        block.body.append(item);
      }
    } else {
      block.body.textContent = content;
    }
  }

  els.reveal.hidden = false;
}

/* After either button: the answer stays readable but locked, and Next appears */
function lockCard() {
  els.answer.disabled = true;
  els.checkBtn.hidden = true;
  els.giveupBtn.hidden = true;
  els.nextBtn.hidden = false;
}


/* ==========================================================================
   11. SELF-RATING + SAVING
   ========================================================================== */
function rate(value) {
  if (!current || phase !== "checked") return;

  // Mark the chosen chip so you can see what you picked
  for (const chip of els.rating.querySelectorAll(".chip")) {
    chip.classList.toggle("is-selected", chip.dataset.rating === value);
  }

  recordResult(value);

  /* Boss Battle: "Nailed it" is the only rating that hurts the villain, and
     "Partly" is the only rating besides it that costs Batman health. */
  Battle.onRating(value, context("check"));
}

/* Everything the fight needs to know about the question on screen. battle.js
   deliberately does not import the question list, so we hand it over here. */
function context(path) {
  return {
    questionId: current ? current.id : null,
    difficulty: current ? current.difficulty : "neutral",
    phase: path,
    checker: readCheckerVerdict(),   // null until a checker.js exists
  };
}

/* ==========================================================================
   11b. THE CHECKER HOOK (optional, only works if you add checker.js)
   --------------------------------------------------------------------------
   There is no checker.js in this project yet, so this always returns null and
   Battle.trusts your self-rating.

   If you write one, all it has to do is dispatch this event before you rate:

     window.dispatchEvent(new CustomEvent("checker:result", {
       detail: { questionId, covered: 3, total: 5 },
     }));

   `covered` is how many key points your answer actually hit and `total` how
   many the question has. With REQUIRE_CHECKER_FOR_HIT switched on in
   battle.js, "Nailed it" only counts as a hit on the villain when covered is at
   least half of total. Nothing else in the app has to change.
   ========================================================================== */
function readCheckerVerdict() {
  return checkerVerdict;
}

/* One place that saves an attempt, whichever button led to it. */
function recordResult(rating) {
  if (!current || recorded) return;   // guards against a double click
  recorded = true;

  // Work on a copy so a failed save cannot leave half-written stats behind
  const stats = { ...statsFor(current.id) };

  stats.timesSeen += 1;
  if (rating === "missed") stats.timesMissed += 1;
  if (rating === "nailed") stats.timesNailed += 1;

  // A streak only survives consecutive "Nailed it" answers
  stats.nailedStreak = rating === "nailed" ? stats.nailedStreak + 1 : 0;
  stats.lastResult = rating;
  stats.lastAt = new Date().toISOString();

  data.stats[current.id] = stats;
  data.history.unshift({ id: current.id, rating, seconds, at: stats.lastAt });
  data.history = data.history.slice(0, HISTORY_LIMIT);

  saveState();
  renderSummary();
  renderReview();
}


/* ==========================================================================
   12. SESSION SUMMARY
   ========================================================================== */
function renderSummary() {
  const counts = { nailed: 0, partly: 0, missed: 0 };

  for (const attempt of data.history) {
    if (counts[attempt.rating] !== undefined) counts[attempt.rating] += 1;
  }

  els.statNailed.textContent = counts.nailed;
  els.statPartly.textContent = counts.partly;
  els.statMissed.textContent = counts.missed;
}


/* ==========================================================================
   13. REVIEW SCREEN
   --------------------------------------------------------------------------
   Study list, no quiz. Anything you missed, or only partly answered, is listed
   worst first with its analogy and model answer.
   ========================================================================== */
function reviewableQuestions() {
  return allQuestions
    .map((question) => ({ question, stats: statsFor(question.id) }))

    // Nothing to review unless it went badly at least once
    .filter((item) => item.stats.timesMissed > 0 || item.stats.lastResult === "partly")

    // Most missed first, then most attempts, then alphabetical for stability
    .sort((a, b) =>
      b.stats.timesMissed - a.stats.timesMissed ||
      b.stats.timesSeen - a.stats.timesSeen ||
      a.question.question.localeCompare(b.question.question));
}

function renderReview() {
  const items = reviewableQuestions();

  // Badge on the Review tab
  els.reviewCount.textContent = items.length;
  els.reviewCount.classList.toggle("is-empty", items.length === 0);

  els.reviewHint.textContent = items.length === 0
    ? "Nothing here yet. Questions you miss or only partly answer show up in this list."
    : "No timer, no questions — just read these until they stick.";

  els.reviewList.textContent = "";

  if (items.length === 0) return;

  for (const { question, stats } of items) {
    els.reviewList.append(buildReviewItem(question, stats));
  }
}

function buildReviewItem(question, stats) {
  const item = document.createElement("li");
  item.className = "review__item";

  // --- tags: category, difficulty and type ---
  const tags = document.createElement("p");
  tags.className = "tags";
  tags.append(
    makeBadge(question.category),
    makeBadge(question.difficulty, "difficulty"),
    makeBadge(question.type, "type"));

  // --- the question ---
  const heading = document.createElement("p");
  heading.className = "review__q";
  heading.textContent = question.question;

  // --- seen / missed / last result ---
  const meta = document.createElement("div");
  meta.className = "review__stats";
  meta.append(
    makeStat(`Seen ${stats.timesSeen}×`),
    makeStat(`Missed ${stats.timesMissed}×`),
    makeLastResult(stats),
  );

  item.append(tags, heading, meta,
    makeReviewSection("Analogy", question.analogy, "analogy"),
    makeReviewSection("Model answer", question.modelAnswer, "model"));

  return item;
}

/* One of the small pill labels. `variant` is "difficulty" or "type" so the
   colour rules in style.css can pick it up. */
function makeBadge(text, variant = "") {
  const badge = document.createElement("span");
  badge.className = "badge" + (variant ? ` badge--${variant}` : "");
  badge.textContent = variant === "type" ? capitalize(text) : text;
  if (variant === "difficulty") badge.dataset.level = text.toLowerCase();
  if (variant === "type") badge.dataset.type = text.toLowerCase();
  return badge;
}

function makeStat(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function makeLastResult(stats) {
  const span = document.createElement("span");
  span.className = `review__last review__last--${stats.lastResult}`;
  span.textContent = `Last: ${RATINGS[stats.lastResult].label}`;
  return span;
}

function makeReviewSection(heading, text, variant) {
  const section = document.createElement("section");
  section.className = `review__section review__section--${variant}`;

  const title = document.createElement("h4");
  title.textContent = heading;

  const body = document.createElement("p");
  body.textContent = text;

  section.append(title, body);
  return section;
}


/* ==========================================================================
   14. SWITCHING SCREENS
   ========================================================================== */
function showScreen(name) {
  const onReview = name === "review";

  els.screenPractice.hidden = onReview;
  els.screenReview.hidden = !onReview;
  els.tabPractice.classList.toggle("is-active", !onReview);
  els.tabReview.classList.toggle("is-active", onReview);
  els.timer.hidden = onReview;   // no clock while you are just reading

  // Freeze the clock while studying, and pick it up when you come back
  if (onReview) {
    stopTimer();
  } else if (phase === "answering" && !recorded) {
    startTimer();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}


/* ==========================================================================
   15. WIRING UP THE BUTTONS
   ========================================================================== */
els.checkBtn.addEventListener("click", checkAnswer);
els.giveupBtn.addEventListener("click", giveUp);
els.nextBtn.addEventListener("click", nextQuestion);

els.tabPractice.addEventListener("click", () => showScreen("practice"));
els.tabReview.addEventListener("click", () => showScreen("review"));

for (const chip of els.rating.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => rate(chip.dataset.rating));
}

// Keyboard shortcut: Enter in the answer box checks it
els.answer.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();

  // Enter checks the answer, then Enter again moves on
  if (phase === "answering") checkAnswer();
  else if (!els.nextBtn.hidden) nextQuestion();
});

/* Changing villain or mode changes which questions you get, so the pool has to
   be rebuilt. This listener is the only place that does it, which means the
   question on screen is never swapped out from under you: applyFilters() only
   runs when you are between questions. */
let shownVillainId = Battle.getVillainId();
let shownMode = Battle.getMode();

window.addEventListener("battle:changed", (event) => {
  const state = event.detail;

  const villainChanged = state.villainId !== shownVillainId;
  const modeChanged = state.mode !== shownMode;

  if (!villainChanged && !modeChanged) return;

  shownVillainId = state.villainId;
  shownMode = state.mode;

  // Free Practice puts the real difficulty filter back, Boss Battle locks it
  if (modeChanged && els.difficulties) buildFilters();

  applyFilters();
});

/* A "checker:result" event is the whole contract for an optional checker.js.
   Nothing listens today except the value we hand to Battle. */
window.addEventListener("checker:result", (event) => {
  checkerVerdict = event.detail || null;
});

/* The daily health reset, checked when the tab comes back to the front as well
   as on load, so leaving the app open overnight still gives a fresh day. */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) Health.checkDailyReset();
});

/* A knockout changes which questions you are allowed, so the pool is rebuilt
   then. Both of these land between questions, never mid-answer. */
window.addEventListener("battle:lockdown", () => applyFilters());
window.addEventListener("battle:lockdownClear", () => applyFilters());

els.clearBtn.addEventListener("click", () => {
  if (!confirm("Delete all saved results, review history and Boss Battle progress?")) return;

  data = { stats: {}, history: [] };
  saveState();
  renderSummary();
  renderReview();

  // Boss Battle progress and Batman's health go too
  Battle.resetProgress();
});


/* ==========================================================================
   16. START
   ========================================================================== */
renderSummary();   // paint whatever was already saved
renderReview();    // same for the review list and its badge
loadQuestions();  // then fetch the questions and show the first one