/*
 * Finish round ("Về đích") state engine — pure functions, no DOM.
 *
 * Contestants play one turn each, in list order. A turn has 3 questions; before the
 * first one the contestant picks the low (20) or high (30) value for each. Once per
 * turn the star of hope can be placed on a question before it is shown: right = 2×,
 * wrong = −1×. A wrong main answer opens a steal: the first other contestant to raise
 * a hand can win the question's base value (never doubled, never negative).
 *
 * Phases: 'intro' → 'turn' → 'ready' → 'question' → ('steal' → 'stealing') → 'settled'
 *         → 'ready' (next question) | 'turn' (next contestant) … → 'results'.
 *   turn     — package picker: a value for each question, optionally the star
 *   ready    — before a question is shown: last chance to place the star on it
 *   question — question shown, clock running; the teacher marks the main contestant
 *   steal    — the main answer was wrong: a short window for the others to raise a hand
 *   stealing — the first hand answers; the teacher marks it
 *   settled  — answer on screen; Space moves on
 *
 * Scores are always derived from levels + results, so undo can't desync them.
 * history holds whole teacher actions, each with what it changed so undo restores it:
 *   { type, c, q, prev: { phase, levels, star, result, timer } }
 *   type: 'level' | 'star' | 'begin' | 'show' | 'reveal' | 'judge' | 'pick' | 'nosteal' | 'steal'
 * Moving on (start, next) is not an action: undo goes back to where the last action happened.
 */
(function (root) {
  'use strict';

  const SLOTS = 3;
  const VERDICTS = ['correct', 'wrong'];

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  // revealed = the answer was shown before the main contestant was marked (no steal then).
  const emptyResult = () => ({ main: null, revealed: false, stealer: null, steal: null });

  function createState(quiz) {
    const nC = quiz.contestants.length;
    return {
      phase: 'intro',
      c: 0, // contestant whose turn it is
      q: 0, // question of the turn
      levels: Array.from({ length: nC }, () => Array(SLOTS).fill(null)), // 0 = low value, 1 = high
      star: Array(nC).fill(null), // question index the star is on
      results: Array.from({ length: nC }, () => Array.from({ length: SLOTS }, emptyResult)),
      history: [],
      timer: null, // { key, remainingMs } — owned by the UI, persisted here
    };
  }

  function isCompatible(st, quiz) {
    if (!st || !quiz.finish) return false;
    const nC = quiz.contestants.length;
    const grid = (a) => Array.isArray(a) && a.length === nC && a.every((row) => Array.isArray(row) && row.length === SLOTS);
    return grid(st.levels) && grid(st.results) && Array.isArray(st.star) && st.star.length === nC;
  }

  const value = (quiz, level) => quiz.settings.finishPoints[level] || 0;
  const seconds = (quiz, level) => quiz.settings.finishSeconds[level] || quiz.settings.finishSeconds[0];

  /** Base value of contestant c's question q (0 while not chosen). */
  function points(st, quiz, c, q) {
    const level = st.levels[c][q];
    return level == null ? 0 : value(quiz, level);
  }

  /** What the main contestant gets for question q: ±, doubled by the star. */
  function mainPoints(st, quiz, c, q) {
    const r = st.results[c][q];
    const v = points(st, quiz, c, q);
    const star = st.star[c] === q;
    if (r.main === 'correct') return star ? 2 * v : v;
    if (r.main === 'wrong') return star ? -v : 0;
    return 0;
  }

  function scores(st, quiz) {
    const out = st.star.map(() => 0);
    st.results.forEach((row, c) =>
      row.forEach((r, q) => {
        out[c] += mainPoints(st, quiz, c, q);
        if (r.steal === 'correct') out[r.stealer] += points(st, quiz, c, q);
      })
    );
    return out;
  }

  /** Points contestant c won by stealing in other turns. */
  function stolenPoints(st, quiz, c) {
    let sum = 0;
    st.results.forEach((row, owner) =>
      row.forEach((r, q) => {
        if (r.stealer === c && r.steal === 'correct') sum += points(st, quiz, owner, q);
      })
    );
    return sum;
  }

  const packageReady = (st) => st.levels[st.c].every((l) => l != null);

  /** The star can go on question `slot`: anywhere before the turn starts, then only on the next question. */
  function canStar(st, slot) {
    if (!(Number.isInteger(slot) && slot >= 0 && slot < SLOTS)) return false;
    if (st.phase === 'turn') return true;
    const placed = st.star[st.c];
    return st.phase === 'ready' && slot === st.q && (placed == null || placed >= st.q);
  }

  const isLast = (st) => st.c === st.levels.length - 1 && st.q === SLOTS - 1;

  /** Record a teacher action: remember what it may change, then apply it. */
  function act(st, type, change) {
    const n = clone(st);
    n.history.push({
      type,
      c: st.c,
      q: st.q,
      prev: { phase: st.phase, levels: st.levels[st.c].slice(), star: st.star[st.c], result: { ...st.results[st.c][st.q] }, timer: st.timer },
    });
    change(n, n.results[n.c][n.q]);
    return n;
  }

  function start(st) {
    if (st.phase !== 'intro') return st;
    const n = clone(st);
    n.phase = 'turn';
    n.c = 0;
    n.q = 0;
    n.timer = null;
    return n;
  }

  function setLevel(st, slot, level) {
    if (st.phase !== 'turn' || !(slot >= 0 && slot < SLOTS) || (level !== 0 && level !== 1)) return st;
    if (st.levels[st.c][slot] === level) return st;
    return act(st, 'level', (n) => (n.levels[n.c][slot] = level));
  }

  /** Put the star on question `slot`, or take it off if it is there already. */
  function toggleStar(st, slot) {
    if (!canStar(st, slot)) return st;
    return act(st, 'star', (n) => (n.star[n.c] = n.star[n.c] === slot ? null : slot));
  }

  function beginTurn(st) {
    if (st.phase !== 'turn' || !packageReady(st)) return st;
    return act(st, 'begin', (n) => {
      n.phase = 'ready';
      n.q = 0;
    });
  }

  function show(st) {
    if (st.phase !== 'ready') return st;
    return act(st, 'show', (n) => {
      n.phase = 'question';
      n.timer = null;
    });
  }

  /** Answer shown before the verdict: a wrong answer then has no steal. */
  function reveal(st) {
    const r = st.phase === 'question' && st.results[st.c][st.q];
    if (!r || r.revealed) return st;
    return act(st, 'reveal', (n, res) => (res.revealed = true));
  }

  /** Mark the main contestant. Wrong (answer still hidden) opens the steal. */
  function judge(st, kind) {
    if (st.phase !== 'question' || !VERDICTS.includes(kind)) return st;
    return act(st, 'judge', (n, r) => {
      r.main = kind;
      n.phase = kind === 'wrong' && !r.revealed ? 'steal' : 'settled';
      n.timer = null;
    });
  }

  /** The first hand up: contestant c answers the steal. The window's clock is kept for a cancel. */
  function pickStealer(st, c) {
    if (st.phase !== 'steal' || !(c >= 0 && c < st.star.length) || c === st.c) return st;
    return act(st, 'pick', (n, r) => {
      r.stealer = c;
      n.phase = 'stealing';
    });
  }

  /** Wrong hand picked: back to the open window. */
  function cancelSteal(st) {
    if (st.phase !== 'stealing') return st;
    return undo(st).state;
  }

  function noSteal(st) {
    if (st.phase !== 'steal') return st;
    return act(st, 'nosteal', (n) => {
      n.phase = 'settled';
      n.timer = null;
    });
  }

  function judgeSteal(st, kind) {
    if (st.phase !== 'stealing' || !VERDICTS.includes(kind)) return st;
    return act(st, 'steal', (n, r) => {
      r.steal = kind;
      n.phase = 'settled';
      n.timer = null;
    });
  }

  /** From a settled question to the next one, the next contestant's turn, or the results. */
  function next(st) {
    if (st.phase !== 'settled') return st;
    const n = clone(st);
    n.timer = null;
    if (st.q < SLOTS - 1) {
      n.q = st.q + 1;
      n.phase = 'ready';
    } else if (st.c < st.levels.length - 1) {
      n.c = st.c + 1;
      n.q = 0;
      n.phase = 'turn';
    } else {
      n.phase = 'results';
    }
    return n;
  }

  function back(st) {
    if (st.phase !== 'results') return st;
    const n = clone(st);
    n.phase = 'settled';
    n.c = st.levels.length - 1;
    n.q = SLOTS - 1;
    return n;
  }

  function undo(st) {
    if (st.phase === 'intro' || st.phase === 'results' || !st.history.length) return { state: st, undone: null };
    const n = clone(st);
    const a = n.history.pop();
    n.c = a.c;
    n.q = a.q;
    n.phase = a.prev.phase;
    n.levels[a.c] = a.prev.levels;
    n.star[a.c] = a.prev.star;
    n.results[a.c][a.q] = a.prev.result;
    n.timer = a.prev.timer;
    return { state: n, undone: a };
  }

  const api = {
    SLOTS,
    createState,
    isCompatible,
    value,
    seconds,
    points,
    mainPoints,
    stolenPoints,
    scores,
    packageReady,
    canStar,
    isLast,
    start,
    setLevel,
    toggleStar,
    beginTurn,
    show,
    reveal,
    judge,
    pickStealer,
    cancelSteal,
    noSteal,
    judgeSteal,
    next,
    back,
    undo,
  };

  root.FinishEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
