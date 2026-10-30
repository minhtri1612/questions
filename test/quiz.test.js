// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/quiz.js');
const D = require('../js/data.js');

const quiz = D.sampleQuiz(); // 4 contestants × 4 questions, 10 points

function play(s, steps) {
  for (const step of steps) {
    if (step === 'adv') s = E.advance(s, quiz).session;
    else s = E.score(s, quiz, step);
  }
  return s;
}

test('starts at contestant 1 intro', () => {
  const s = E.createSession(quiz);
  assert.equal(s.phase, 'intro');
  assert.deepEqual([s.c, s.q], [0, 0]);
  assert.deepEqual(E.scores(s, quiz), [0, 0, 0, 0]);
});

test('advance: intro → question → reveal → blocked until scored → next', () => {
  let s = E.createSession(quiz);
  s = E.advance(s, quiz).session;
  assert.equal(s.phase, 'question');
  assert.equal(s.flipped[0][0], false);
  s = E.advance(s, quiz).session;
  assert.equal(s.flipped[0][0], true);
  const r = E.advance(s, quiz);
  assert.equal(r.blocked, 'needs-score');
  assert.equal(r.session.q, 0);
  s = E.score(s, quiz, 'correct');
  s = E.advance(s, quiz).session;
  assert.deepEqual([s.c, s.q], [0, 1]);
});

test('each contestant answers all their questions in a row, then results', () => {
  let s = E.createSession(quiz);
  for (let c = 0; c < 4; c++) {
    assert.equal(s.phase, 'intro');
    assert.equal(s.c, c);
    s = E.advance(s, quiz).session;
    for (let q = 0; q < 4; q++) {
      assert.deepEqual([s.c, s.q], [c, q]);
      s = play(s, [c === 0 || q < c ? 'correct' : 'wrong', 'adv']);
    }
  }
  assert.equal(s.phase, 'results');
  assert.deepEqual(E.scores(s, quiz), [40, 10, 20, 30]);
  assert.ok(E.isComplete(s));
});

test('scoring before revealing flips the card', () => {
  let s = E.advance(E.createSession(quiz), quiz).session;
  s = E.score(s, quiz, 'wrong');
  assert.equal(s.flipped[0][0], true);
  assert.equal(s.results[0][0], 'wrong');
});

test('skip scores 0, is recorded as skipped and moves on', () => {
  let s = E.advance(E.createSession(quiz), quiz).session;
  s = E.score(s, quiz, 'skipped');
  assert.equal(s.results[0][0], 'skipped');
  assert.deepEqual([s.c, s.q, s.phase], [0, 1, 'question']);
  assert.deepEqual(E.scores(s, quiz), [0, 0, 0, 0]);
});

test('undo reverts the latest score and jumps back to it', () => {
  let s = E.advance(E.createSession(quiz), quiz).session;
  s = play(s, ['correct', 'adv', 'correct', 'adv']);
  assert.deepEqual(E.scores(s, quiz), [20, 0, 0, 0]);
  const r = E.undo(s);
  assert.deepEqual(r.undone, { c: 0, q: 1, result: 'correct' });
  assert.deepEqual([r.session.c, r.session.q], [0, 1]);
  assert.equal(r.session.results[0][1], null);
  assert.equal(r.session.flipped[0][1], true);
  assert.deepEqual(E.scores(r.session, quiz), [10, 0, 0, 0]);
  const r2 = E.undo(r.session);
  assert.deepEqual(E.scores(r2.session, quiz), [0, 0, 0, 0]);
  assert.equal(E.undo(r2.session).undone, null);
});

test('going back and re-scoring replaces the old result (no double counting)', () => {
  let s = E.advance(E.createSession(quiz), quiz).session;
  s = play(s, ['correct', 'adv']);
  s = E.back(s, quiz);
  assert.deepEqual([s.c, s.q], [0, 0]);
  s = E.score(s, quiz, 'wrong');
  s = E.score(s, quiz, 'correct');
  assert.deepEqual(E.scores(s, quiz), [10, 0, 0, 0]);
  assert.deepEqual(s.history, ['0:0']);
});

test('back walks across intro cards and out of results', () => {
  let s = E.createSession(quiz);
  assert.deepEqual(E.back(s, quiz), s, 'nothing before the first intro');
  s = { ...s, phase: 'intro', c: 1, q: 0 };
  s = E.back(s, quiz);
  assert.deepEqual([s.phase, s.c, s.q], ['question', 0, 3]);
  s = E.back({ ...s, phase: 'question', c: 1, q: 0 }, quiz);
  assert.deepEqual([s.phase, s.c], ['intro', 1]);
  s = E.back({ ...s, phase: 'results' }, quiz);
  assert.deepEqual([s.phase, s.c, s.q], ['question', 3, 3]);
});

test('ranking: ties share a rank (1, 1, 3, 4)', () => {
  const s = E.createSession(quiz);
  s.results = [
    ['correct', 'correct', 'wrong', 'wrong'],
    ['correct', 'wrong', 'wrong', 'wrong'],
    ['correct', 'correct', 'wrong', 'skipped'],
    ['wrong', 'wrong', 'wrong', 'wrong'],
  ];
  const r = E.ranking(s, quiz);
  assert.deepEqual(r.map((x) => [x.index, x.score, x.rank]), [[0, 20, 1], [2, 20, 1], [1, 10, 3], [3, 0, 4]]);
});

test('functions never mutate their input', () => {
  const s = E.advance(E.createSession(quiz), quiz).session;
  const before = JSON.stringify(s);
  E.score(s, quiz, 'correct');
  E.flip(s);
  E.undo(E.score(s, quiz, 'correct'));
  assert.equal(JSON.stringify(s), before);
});

test('isCompatible rejects sessions for a different quiz shape', () => {
  const s = E.createSession(quiz);
  assert.ok(E.isCompatible(s, quiz));
  assert.ok(!E.isCompatible(s, { ...quiz, id: 'other' }));
  const smaller = { ...quiz, contestants: quiz.contestants.slice(0, 3) };
  assert.ok(!E.isCompatible(s, smaller));
});
