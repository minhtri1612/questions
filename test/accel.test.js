// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/accel.js');
const D = require('../js/data.js');

const quiz = D.sampleQuiz(); // 4 contestants, points 40/30/20/10, 10/20/30/40 s

const fresh = () => A.start(A.createState(quiz));

/** Contestants raise boards in `order`; the ones in `wrong` are unticked. Leaves the question scored. */
function play(st, order, wrong = []) {
  for (const c of order) st = A.toggleOrder(st, c);
  st = A.reveal(st);
  for (const c of wrong) st = A.toggleCorrect(st, c);
  return A.confirm(st);
}

test('intro → question 1; seconds come from the settings or the question itself', () => {
  let st = A.createState(quiz);
  assert.equal(st.phase, 'intro');
  st = A.start(st);
  assert.deepEqual([st.phase, st.q], ['question', 0]);
  assert.deepEqual([0, 1, 2, 3].map((q) => A.seconds(quiz, q)), [10, 20, 30, 40]);
  const custom = D.sampleQuiz();
  custom.accel.questions[1].seconds = 25;
  assert.equal(A.seconds(custom, 1), 25);
});

test('the order is kept as clicked; clicking again takes a contestant out', () => {
  let st = fresh();
  for (const c of [2, 0, 3]) st = A.toggleOrder(st, c);
  assert.deepEqual(st.order[0], [2, 0, 3]);
  assert.equal(A.position(st, 0, 0), 2);
  assert.equal(A.position(st, 0, 1), 0, 'contestant 1 did not submit');
  st = A.toggleOrder(st, 0);
  assert.deepEqual(st.order[0], [2, 3], 'the others move up');
});

test('points go by speed among the correct answers only', () => {
  let st = play(fresh(), [2, 0, 3, 1]);
  assert.deepEqual(A.scores(st, quiz), [30, 10, 40, 20]);
  // Next question: the fastest was wrong, so the 2nd becomes the fastest correct.
  st = A.next(st);
  st = play(st, [1, 3, 0], [1]);
  assert.deepEqual(A.questionPoints(st, quiz, 1), [30, 0, 0, 40]);
  assert.deepEqual(A.scores(st, quiz), [60, 10, 40, 60]);
});

test('after the reveal, everyone who submitted starts ticked; non-submitters cannot be ticked', () => {
  let st = A.toggleOrder(fresh(), 1);
  st = A.reveal(st);
  assert.deepEqual(st.correct[0], [false, true, false, false]);
  assert.equal(A.toggleCorrect(st, 0), st);
});

test('the order can be fixed while marking: a late board joins at the end, ticked', () => {
  let st = A.toggleOrder(fresh(), 0);
  st = A.reveal(st);
  st = A.toggleOrder(st, 2);
  assert.deepEqual(st.order[0], [0, 2]);
  assert.equal(st.correct[0][2], true);
  st = A.toggleOrder(st, 0);
  assert.deepEqual(st.order[0], [2]);
  assert.equal(st.correct[0][0], false);
});

test('scored → next question → … → results; back from results', () => {
  let st = fresh();
  for (let q = 0; q < 4; q++) {
    st = play(st, [q]);
    assert.equal(st.phase, 'scored');
    assert.equal(A.isLast(st), q === 3);
    st = A.next(st);
  }
  assert.equal(st.phase, 'results');
  assert.deepEqual(A.scores(st, quiz), [40, 40, 40, 40]);
  st = A.back(st);
  assert.deepEqual([st.phase, st.q], ['scored', 3]);
});

test('undo walks back every action, one at a time', () => {
  let st = fresh();
  st = A.toggleOrder(st, 1);
  st = A.toggleOrder(st, 0);
  st = A.reveal({ ...st, timer: { q: 0, remainingMs: 4200, started: true } });
  st = A.toggleCorrect(st, 1);
  st = A.confirm(st);
  st = A.next(st); // question 2, nothing done yet
  assert.deepEqual(A.scores(st, quiz), [40, 0, 0, 0]);

  let r = A.undo(st);
  assert.equal(r.undone.type, 'confirm');
  assert.deepEqual([r.state.phase, r.state.q], ['marking', 0], 'back to marking question 1');
  assert.deepEqual(A.scores(r.state, quiz), [0, 0, 0, 0]);
  r = A.undo(r.state);
  assert.equal(r.undone.type, 'mark');
  assert.deepEqual(r.state.correct[0], [true, true, false, false]);
  r = A.undo(r.state);
  assert.equal(r.undone.type, 'reveal');
  assert.equal(r.state.phase, 'question');
  assert.deepEqual(r.state.timer, { q: 0, remainingMs: 4200, started: true }, 'clock restored');
  r = A.undo(r.state);
  assert.deepEqual(r.state.order[0], [1]);
  r = A.undo(r.state);
  assert.deepEqual(r.state.order[0], []);
  assert.equal(A.undo(r.state).undone, null);
});

test('undoing an order fix while marking restores the exact ticks', () => {
  let st = A.toggleOrder(A.toggleOrder(fresh(), 0), 1);
  st = A.reveal(st);
  st = A.toggleCorrect(st, 1); // 1 wrong
  st = A.toggleOrder(st, 1); // then taken out of the order
  const r = A.undo(st);
  assert.deepEqual(r.state.order[0], [0, 1]);
  assert.deepEqual(r.state.correct[0], [true, false, false, false], 'still unticked as before');
  assert.equal(r.state.phase, 'marking');
});

test('actions in the wrong phase are ignored', () => {
  const intro = A.createState(quiz);
  assert.equal(A.toggleOrder(intro, 0), intro);
  assert.equal(A.reveal(intro), intro);
  const q = fresh();
  assert.equal(A.confirm(q), q);
  assert.equal(A.next(q), q);
  assert.equal(A.toggleOrder(q, 9), q, 'no such contestant');
});

test('functions never mutate their input', () => {
  const st = A.toggleOrder(fresh(), 0);
  const snap = JSON.stringify(st);
  A.toggleOrder(st, 1);
  A.reveal(st);
  A.undo(st);
  assert.equal(JSON.stringify(st), snap);
});

test('isCompatible checks contestants, question count and that round 3 exists', () => {
  const st = A.createState(quiz);
  assert.ok(A.isCompatible(st, quiz));
  const fewer = { ...quiz, contestants: quiz.contestants.slice(0, 3) };
  assert.ok(!A.isCompatible(st, fewer));
  const shorter = { ...quiz, accel: { questions: quiz.accel.questions.slice(0, 3) } };
  assert.ok(!A.isCompatible(st, shorter));
  assert.ok(!A.isCompatible(st, { ...quiz, accel: null }));
});
