/*
 * Obstacle round ("Vượt chướng ngại vật") state engine — pure functions, no DOM.
 *
 * Slots 0–3 are the horizontal rows, slot 4 is the center question.
 * Phases: 'intro' → 'board' ⇄ 'question' → 'marking' → 'board' … → 'final' → 'results'.
 *   board    — teacher picks a slot (number keys choose rows)
 *   question — question shown, timer running
 *   marking  — answer revealed, teacher ticks who was right (number keys tick contestants)
 *   final    — keyword revealed (won by a buzz, or opened by the teacher)
 *
 * history holds whole teacher actions so undo reverses exactly the last one:
 *   { type: 'row', index }                       a row was scored
 *   { type: 'eliminate', c }                     a wrong keyword guess
 *   { type: 'keyword', winner, prev }            keyword won (winner = c) or opened (winner = null)
 */
(function (root) {
  'use strict';

  const ROWS = 4;
  const CENTER = 4;
  const SLOTS = 5;
  const PLAYING = ['board', 'question', 'marking'];

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function createState(quiz) {
    const nC = quiz.contestants.length;
    return {
      phase: 'intro',
      active: null, // slot being played in 'question' / 'marking'
      rows: Array.from({ length: SLOTS }, () => ({ status: 'closed', correct: [] })), // closed | solved | failed
      marks: Array(nC).fill(false), // ticks while marking
      eliminated: Array(nC).fill(false), // lost the right to guess the keyword
      winner: null,
      keywordPoints: 0,
      history: [],
      timer: null, // { slot, remainingMs } — owned by the UI, persisted here
    };
  }

  function isCompatible(st, quiz) {
    const nC = quiz.contestants.length;
    return (
      !!st &&
      !!quiz.obstacle &&
      Array.isArray(st.rows) &&
      st.rows.length === SLOTS &&
      Array.isArray(st.eliminated) &&
      st.eliminated.length === nC &&
      Array.isArray(st.marks) &&
      st.marks.length === nC
    );
  }

  const isDone = (row) => row.status === 'solved' || row.status === 'failed';

  function centerUnlocked(st) {
    return st.rows.slice(0, ROWS).every(isDone);
  }

  /** Every question has been played: nothing left but opening the keyword. */
  function allPlayed(st) {
    return isDone(st.rows[CENTER]);
  }

  /** 0–4 = rows finished so far. Indexes keywordPoints (the center question is the last chance at stage 4). */
  function stage(st) {
    return st.rows.slice(0, ROWS).filter(isDone).length;
  }

  function keywordValue(st, quiz) {
    const pts = quiz.settings.keywordPoints;
    return pts[Math.min(stage(st), pts.length - 1)] || 0;
  }

  function canPick(st, slot) {
    return (
      st.phase === 'board' &&
      Number.isInteger(slot) &&
      slot >= 0 &&
      slot < SLOTS &&
      st.rows[slot].status === 'closed' &&
      (slot < ROWS || centerUnlocked(st))
    );
  }

  function start(st) {
    if (st.phase !== 'intro') return st;
    const n = clone(st);
    n.phase = 'board';
    return n;
  }

  function pickRow(st, slot) {
    if (!canPick(st, slot)) return st;
    const n = clone(st);
    n.phase = 'question';
    n.active = slot;
    n.marks = n.marks.map(() => false);
    n.timer = null;
    return n;
  }

  /** Back out of a question before its answer is shown (picked the wrong row). */
  function cancelRow(st) {
    if (st.phase !== 'question') return st;
    const n = clone(st);
    n.phase = 'board';
    n.active = null;
    n.timer = null;
    return n;
  }

  function reveal(st) {
    if (st.phase !== 'question') return st;
    const n = clone(st);
    n.phase = 'marking';
    n.timer = null;
    return n;
  }

  function toggleMark(st, c) {
    if (st.phase !== 'marking' || !(c >= 0 && c < st.marks.length)) return st;
    const n = clone(st);
    n.marks[c] = !n.marks[c];
    return n;
  }

  /** Score the revealed row: +points for each ticked contestant; nobody → failed. */
  function confirmRow(st) {
    if (st.phase !== 'marking') return st;
    const n = clone(st);
    const correct = n.marks.map((m, c) => (m ? c : -1)).filter((c) => c >= 0);
    n.rows[st.active] = { status: correct.length ? 'solved' : 'failed', correct };
    n.history.push({ type: 'row', index: st.active });
    n.phase = 'board';
    n.active = null;
    n.marks = n.marks.map(() => false);
    return n;
  }

  /** Bells close once the center question is scored; after that the teacher opens the keyword. */
  function canBuzz(st, c) {
    return (
      PLAYING.includes(st.phase) && st.winner == null && !allPlayed(st) && c >= 0 && c < st.eliminated.length && !st.eliminated[c]
    );
  }

  function snapshot(st) {
    return { phase: st.phase, active: st.active, marks: st.marks.slice(), timer: st.timer };
  }

  function buzzCorrect(st, quiz, c) {
    if (!canBuzz(st, c)) return st;
    const n = clone(st);
    n.history.push({ type: 'keyword', winner: c, prev: snapshot(st) });
    n.winner = c;
    n.keywordPoints = keywordValue(st, quiz);
    n.phase = 'final';
    n.active = null;
    n.timer = null;
    return n;
  }

  /** Wrong keyword guess: no more guessing this round (rows still count). No points lost. */
  function buzzWrong(st, c) {
    if (!canBuzz(st, c)) return st;
    const n = clone(st);
    n.eliminated[c] = true;
    n.history.push({ type: 'eliminate', c });
    return n;
  }

  /** Teacher opens the keyword because nobody solved it. */
  function revealKeyword(st) {
    if (!PLAYING.includes(st.phase)) return st;
    const n = clone(st);
    n.history.push({ type: 'keyword', winner: null, prev: snapshot(st) });
    n.winner = null;
    n.keywordPoints = 0;
    n.phase = 'final';
    n.active = null;
    n.timer = null;
    return n;
  }

  function finish(st) {
    if (st.phase !== 'final') return st;
    const n = clone(st);
    n.phase = 'results';
    return n;
  }

  function back(st) {
    if (st.phase === 'results') {
      const n = clone(st);
      n.phase = 'final';
      return n;
    }
    return cancelRow(st);
  }

  function undo(st) {
    if (st.phase === 'results' || !st.history.length) return { state: st, undone: null };
    const n = clone(st);
    const action = n.history.pop();
    if (action.type === 'row') {
      // Back to ticking that row, with the previous ticks restored.
      const row = n.rows[action.index];
      n.marks = n.marks.map((_, c) => row.correct.includes(c));
      n.rows[action.index] = { status: 'closed', correct: [] };
      n.phase = 'marking';
      n.active = action.index;
      n.timer = null;
    } else if (action.type === 'eliminate') {
      n.eliminated[action.c] = false;
    } else if (action.type === 'keyword') {
      n.winner = null;
      n.keywordPoints = 0;
      Object.assign(n, action.prev);
    }
    return { state: n, undone: action };
  }

  function scores(st, quiz) {
    const pts = quiz.settings.obstacleRowPoints;
    const out = st.eliminated.map(() => 0);
    for (const row of st.rows) {
      if (row.status === 'solved') row.correct.forEach((c) => (out[c] += pts));
    }
    if (st.winner != null) out[st.winner] += st.keywordPoints;
    return out;
  }

  /** Image piece i (0–3 corners, 4 center) is uncovered. */
  function pieceOpen(st, i) {
    return st.phase === 'final' || st.phase === 'results' || st.rows[i].status === 'solved';
  }

  const api = {
    ROWS,
    CENTER,
    SLOTS,
    createState,
    isCompatible,
    centerUnlocked,
    allPlayed,
    stage,
    keywordValue,
    canPick,
    canBuzz,
    start,
    pickRow,
    cancelRow,
    reveal,
    toggleMark,
    confirmRow,
    buzzCorrect,
    buzzWrong,
    revealKeyword,
    finish,
    back,
    undo,
    scores,
    pieceOpen,
  };

  root.ObstacleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
