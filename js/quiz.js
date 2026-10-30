/*
 * Quiz state engine — pure functions, no DOM.
 *
 * A session stores *where* we are (c, q, phase) and *what happened*
 * (results / flipped per question). Scores are always derived from
 * results, so undo/re-score can never leave the scoreboard out of sync.
 *
 * Phases: 'intro' (contestant title card) → 'question' → … → 'results'.
 * Every function returns a new session object; inputs are never mutated.
 */
(function (root) {
  'use strict';

  const RESULT_KINDS = ['correct', 'wrong', 'skipped'];

  function grid(nC, nQ, value) {
    return Array.from({ length: nC }, () => Array(nQ).fill(value));
  }

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function dims(quiz) {
    return { nC: quiz.contestants.length, nQ: quiz.settings.questionsPerContestant };
  }

  function key(c, q) {
    return c + ':' + q;
  }

  function createSession(quiz) {
    const { nC, nQ } = dims(quiz);
    return {
      version: 1,
      quizId: quiz.id,
      c: 0,
      q: 0,
      phase: 'intro',
      results: grid(nC, nQ, null),
      flipped: grid(nC, nQ, false),
      timedOut: grid(nC, nQ, false),
      history: [], // keys "c:q" in the order they were scored (for undo)
      timer: null, // { c, q, remainingMs, running } — owned by the UI, persisted here
      round: 'warmup', // 'warmup' | 'obstacle'
      obstacle: null, // Obstacle round state (obstacle.js) once round 2 starts
    };
  }

  /** True if the session's grid shape matches the quiz (safe to resume). */
  function isCompatible(session, quiz) {
    if (!session || session.version !== 1 || session.quizId !== quiz.id) return false;
    const { nC, nQ } = dims(quiz);
    return (
      Array.isArray(session.results) &&
      session.results.length === nC &&
      session.results.every((row) => Array.isArray(row) && row.length === nQ)
    );
  }

  function current(s) {
    if (s.phase !== 'question') return null;
    return { c: s.c, q: s.q, result: s.results[s.c][s.q], flipped: s.flipped[s.c][s.q] };
  }

  function next(s, quiz) {
    const { nC, nQ } = dims(quiz);
    const n = clone(s);
    if (s.phase === 'intro') {
      n.phase = 'question';
      n.q = 0;
    } else if (s.phase === 'question') {
      if (s.q < nQ - 1) {
        n.q = s.q + 1;
      } else if (s.c < nC - 1) {
        n.c = s.c + 1;
        n.q = 0;
        n.phase = 'intro';
      } else {
        n.phase = 'results';
      }
    }
    return n;
  }

  function back(s, quiz) {
    const { nC, nQ } = dims(quiz);
    const n = clone(s);
    if (s.phase === 'results') {
      n.phase = 'question';
      n.c = nC - 1;
      n.q = nQ - 1;
    } else if (s.phase === 'question') {
      if (s.q > 0) n.q = s.q - 1;
      else n.phase = 'intro';
    } else if (s.phase === 'intro' && s.c > 0) {
      n.phase = 'question';
      n.c = s.c - 1;
      n.q = nQ - 1;
    }
    return n;
  }

  function setFlipped(s, value) {
    if (s.phase !== 'question') return s;
    const n = clone(s);
    n.flipped[s.c][s.q] = value;
    return n;
  }

  function flip(s) {
    if (s.phase !== 'question') return s;
    return setFlipped(s, !s.flipped[s.c][s.q]);
  }

  function markTimedOut(s) {
    if (s.phase !== 'question') return s;
    const n = setFlipped(s, true);
    n.timedOut[s.c][s.q] = true;
    return n;
  }

  /** Record a result for the current question. Skipping also moves on. */
  function score(s, quiz, kind) {
    if (s.phase !== 'question' || !RESULT_KINDS.includes(kind)) return s;
    const n = clone(s);
    const k = key(s.c, s.q);
    n.results[s.c][s.q] = kind;
    n.flipped[s.c][s.q] = true;
    n.history = n.history.filter((h) => h !== k).concat(k);
    return kind === 'skipped' ? next(n, quiz) : n;
  }

  /**
   * "Advance" — what Space / → / a presenter clicker does:
   * intro → question, unrevealed → reveal, scored → next question.
   * Returns { session, blocked } where blocked = 'needs-score' if the
   * answer is revealed but the teacher hasn't scored it yet.
   */
  function advance(s, quiz) {
    if (s.phase === 'intro') return { session: next(s, quiz), blocked: null };
    if (s.phase !== 'question') return { session: s, blocked: null };
    if (!s.flipped[s.c][s.q]) return { session: setFlipped(s, true), blocked: null };
    if (s.results[s.c][s.q] == null) return { session: s, blocked: 'needs-score' };
    return { session: next(s, quiz), blocked: null };
  }

  /** Undo the most recent scoring action and jump to that question. */
  function undo(s) {
    if (!s.history.length) return { session: s, undone: null };
    const n = clone(s);
    const k = n.history.pop();
    const [c, q] = k.split(':').map(Number);
    const previous = n.results[c][q];
    n.results[c][q] = null;
    n.flipped[c][q] = true; // answer was already seen
    n.c = c;
    n.q = q;
    n.phase = 'question';
    n.timer = null;
    return { session: n, undone: { c, q, result: previous } };
  }

  function scores(s, quiz) {
    const pts = quiz.settings.points;
    return s.results.map((row) => row.filter((r) => r === 'correct').length * pts);
  }

  /** Standard competition ranking: ties share a rank (1, 1, 3). */
  function rankScores(names, sc) {
    return names
      .map((name, i) => ({ index: i, name, score: sc[i] }))
      .map((row, _, all) => ({ ...row, rank: 1 + all.filter((o) => o.score > row.score).length }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  function ranking(s, quiz) {
    return rankScores(quiz.contestants.map((c) => c.name), scores(s, quiz));
  }

  function isComplete(s) {
    return s.results.every((row) => row.every((r) => r != null));
  }

  const api = {
    RESULT_KINDS,
    createSession,
    isCompatible,
    current,
    next,
    back,
    flip,
    setFlipped,
    markTimedOut,
    score,
    advance,
    undo,
    scores,
    rankScores,
    ranking,
    isComplete,
  };

  root.QuizEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
