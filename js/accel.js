/*
 * Acceleration round ("Tăng tốc") state engine — pure functions, no DOM.
 *
 * Every contestant answers every question at once. While the clock runs the
 * teacher records the order in which answer boards go up; after the reveal the
 * wrong ones are unticked and points go by speed among the correct answers only.
 *
 * Phases: 'intro' → 'question' → 'marking' → 'scored' → 'question' (next) … → 'results'.
 *   question — question shown; clicks build the submission order (once the clock runs)
 *   marking  — answer revealed; ticks say who was right (submitters start ticked)
 *   scored   — points given, answer still on screen; Space moves on
 *
 * Scores are always derived from order + correct, so undo can't desync them.
 * history holds whole teacher actions so undo reverses exactly the last one:
 *   { type: 'order', q, prev, prevCorrect }   the order was changed (with the order and ticks before)
 *   { type: 'reveal', q, timer }    the answer was shown (timer = clock snapshot to restore)
 *   { type: 'mark', q, c }          a tick was flipped
 *   { type: 'confirm', q }          the question was scored
 */
(function (root) {
  'use strict';

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  const count = (quiz) => quiz.accel.questions.length;

  function createState(quiz) {
    const nC = quiz.contestants.length;
    const nQ = count(quiz);
    return {
      phase: 'intro',
      q: 0,
      order: Array.from({ length: nQ }, () => []), // contestant indexes, fastest first
      correct: Array.from({ length: nQ }, () => Array(nC).fill(false)),
      scored: Array(nQ).fill(false),
      history: [],
      timer: null, // { q, remainingMs, started } — owned by the UI, persisted here
    };
  }

  function isCompatible(st, quiz) {
    if (!st || !quiz.accel) return false;
    const nC = quiz.contestants.length;
    const nQ = count(quiz);
    return (
      Array.isArray(st.order) &&
      st.order.length === nQ &&
      Array.isArray(st.scored) &&
      st.scored.length === nQ &&
      Array.isArray(st.correct) &&
      st.correct.every((row) => Array.isArray(row) && row.length === nC)
    );
  }

  /** Seconds for question q: the row's own "Thời gian", else the setting for that position. */
  function seconds(quiz, q) {
    const own = quiz.accel.questions[q] && quiz.accel.questions[q].seconds;
    return own || quiz.settings.accelSeconds[q] || quiz.settings.accelSeconds[quiz.settings.accelSeconds.length - 1];
  }

  /** Points per contestant for question q, by order among the correct answers only. */
  function questionPoints(st, quiz, q) {
    const pts = quiz.settings.accelPoints;
    const out = st.correct[q].map(() => 0);
    st.order[q].filter((c) => st.correct[q][c]).forEach((c, rank) => (out[c] = pts[rank] || 0));
    return out;
  }

  function scores(st, quiz) {
    const out = st.correct[0].map(() => 0);
    st.scored.forEach((done, q) => {
      if (done) questionPoints(st, quiz, q).forEach((p, c) => (out[c] += p));
    });
    return out;
  }

  /** 1-based position of c in the order of question q, or 0 if c didn't submit. */
  function position(st, q, c) {
    return st.order[q].indexOf(c) + 1;
  }

  function start(st) {
    if (st.phase !== 'intro') return st;
    const n = clone(st);
    n.phase = 'question';
    n.q = 0;
    n.timer = null;
    return n;
  }

  /**
   * Add c at the end of the order, or take c out (the others move up).
   * Works while answering and, to fix mistakes, while marking.
   */
  function toggleOrder(st, c) {
    if ((st.phase !== 'question' && st.phase !== 'marking') || !(c >= 0 && c < st.correct[st.q].length)) return st;
    const n = clone(st);
    const order = n.order[st.q];
    n.history.push({ type: 'order', q: st.q, prev: order.slice(), prevCorrect: st.correct[st.q].slice() });
    const i = order.indexOf(c);
    if (i >= 0) order.splice(i, 1);
    else order.push(c);
    // While marking, a newly added contestant starts as correct; a removed one can't be.
    if (st.phase === 'marking') n.correct[st.q][c] = i < 0;
    return n;
  }

  /** Show the answer. Everyone who submitted starts ticked; the teacher unticks the wrong ones. */
  function reveal(st) {
    if (st.phase !== 'question') return st;
    const n = clone(st);
    n.history.push({ type: 'reveal', q: st.q, timer: st.timer });
    n.phase = 'marking';
    n.correct[st.q] = n.correct[st.q].map((_, c) => st.order[st.q].includes(c));
    n.timer = null;
    return n;
  }

  function toggleCorrect(st, c) {
    if (st.phase !== 'marking' || !st.order[st.q].includes(c)) return st;
    const n = clone(st);
    n.correct[st.q][c] = !n.correct[st.q][c];
    n.history.push({ type: 'mark', q: st.q, c });
    return n;
  }

  function confirm(st) {
    if (st.phase !== 'marking') return st;
    const n = clone(st);
    n.scored[st.q] = true;
    n.history.push({ type: 'confirm', q: st.q });
    n.phase = 'scored';
    return n;
  }

  function isLast(st) {
    return st.q >= st.order.length - 1;
  }

  /** From a scored question to the next one, or to the results after the last. */
  function next(st) {
    if (st.phase !== 'scored') return st;
    const n = clone(st);
    if (isLast(st)) n.phase = 'results';
    else {
      n.q = st.q + 1;
      n.phase = 'question';
      n.timer = null;
    }
    return n;
  }

  function back(st) {
    if (st.phase !== 'results') return st;
    const n = clone(st);
    n.phase = 'scored';
    return n;
  }

  function undo(st) {
    if (st.phase === 'results' || st.phase === 'intro' || !st.history.length) return { state: st, undone: null };
    const n = clone(st);
    const a = n.history.pop();
    n.q = a.q;
    if (a.type === 'order') {
      // Order changes are always the latest thing done on the current question,
      // so the phase stays as it is.
      n.order[a.q] = a.prev;
      n.correct[a.q] = a.prevCorrect;
    } else if (a.type === 'reveal') {
      n.phase = 'question';
      n.correct[a.q] = n.correct[a.q].map(() => false);
      n.timer = a.timer;
    } else if (a.type === 'mark') {
      n.correct[a.q][a.c] = !n.correct[a.q][a.c];
      n.phase = 'marking';
    } else if (a.type === 'confirm') {
      n.scored[a.q] = false;
      n.phase = 'marking';
      n.timer = null;
    }
    return { state: n, undone: a };
  }

  const api = {
    createState,
    isCompatible,
    seconds,
    questionPoints,
    scores,
    position,
    start,
    toggleOrder,
    reveal,
    toggleCorrect,
    confirm,
    isLast,
    next,
    back,
    undo,
  };

  root.AccelEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
