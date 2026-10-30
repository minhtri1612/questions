// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/finish.js');
const D = require('../js/data.js');

const quiz = D.sampleQuiz(); // 4 contestants, 20/30 points, 15/20 s, 5 s steal

/** Start the round and set contestant 0's package (levels: 0 = 20, 1 = 30), star optional. */
function turn(levels, star = null) {
  let st = F.start(F.createState(quiz));
  levels.forEach((l, q) => (st = F.setLevel(st, q, l)));
  if (star != null) st = F.toggleStar(st, star);
  return F.beginTurn(st);
}

/** Show the current question and mark the main contestant. */
const answer = (st, kind) => F.judge(F.show(st), kind);

test('intro → turn: the package needs a value for every question before the turn starts', () => {
  let st = F.start(F.createState(quiz));
  assert.deepEqual([st.phase, st.c], ['turn', 0]);
  st = F.setLevel(F.setLevel(st, 0, 0), 1, 1);
  assert.equal(F.beginTurn(st), st, 'question 3 has no value yet');
  st = F.beginTurn(F.setLevel(st, 2, 1));
  assert.deepEqual([st.phase, st.q], ['ready', 0]);
  assert.deepEqual([0, 1, 2].map((q) => F.points(st, quiz, 0, q)), [20, 30, 30]);
  assert.deepEqual([0, 1].map((l) => F.seconds(quiz, l)), [15, 20]);
});

test('without the star: correct = +value, wrong = 0', () => {
  let st = answer(turn([0, 1, 1]), 'correct');
  assert.equal(st.phase, 'settled');
  assert.deepEqual(F.scores(st, quiz), [20, 0, 0, 0]);
  st = F.noSteal(answer(F.next(st), 'wrong'));
  assert.deepEqual(F.scores(st, quiz), [20, 0, 0, 0]);
});

test('star correct = double, star wrong = minus the value', () => {
  const right = answer(turn([1, 0, 0], 0), 'correct');
  assert.deepEqual(F.scores(right, quiz), [60, 0, 0, 0]);
  const wrong = F.noSteal(answer(turn([1, 0, 0], 0), 'wrong'));
  assert.equal(F.mainPoints(wrong, quiz, 0, 0), -30);
  assert.deepEqual(F.scores(wrong, quiz), [-30, 0, 0, 0], 'scores can go below zero');
});

test('the star goes on one question only, and only before it is shown', () => {
  let st = F.start(F.createState(quiz));
  st = F.toggleStar(st, 2);
  st = F.toggleStar(st, 1);
  assert.equal(st.star[0], 1, 'moved, not added');
  [0, 0, 0].forEach((l, q) => (st = F.setLevel(st, q, l)));
  st = F.beginTurn(st);
  assert.ok(F.canStar(st, 0), 'still free to move onto question 1 while it is not shown');
  assert.ok(!F.canStar(st, 1), 'only the next question');
  st = F.next(answer(st, 'correct'));
  st = F.show(st);
  assert.equal(F.toggleStar(st, 1), st, 'question shown: star locked');
  st = F.next(answer(st, 'correct'));
  assert.equal(st.q, 2);
  assert.ok(!F.canStar(st, 2), 'star was used on question 2');
  assert.deepEqual(F.scores(st, quiz), [60, 0, 0, 0]);
});

test('steal: right = base value (not doubled) for the stealer, the main contestant keeps the minus', () => {
  let st = answer(turn([1, 0, 0], 0), 'wrong');
  assert.equal(st.phase, 'steal');
  assert.equal(F.pickStealer(st, 0), st, 'the main contestant cannot steal');
  st = F.pickStealer(st, 2);
  assert.equal(st.phase, 'stealing');
  st = F.judgeSteal(st, 'correct');
  assert.equal(st.phase, 'settled');
  assert.deepEqual(F.scores(st, quiz), [-30, 0, 30, 0]);
  assert.equal(F.stolenPoints(st, quiz, 2), 30);
});

test('wrong steal = 0, nobody loses points; nobody raising a hand moves on', () => {
  let st = F.judgeSteal(F.pickStealer(answer(turn([1, 1, 1]), 'wrong'), 3), 'wrong');
  assert.deepEqual(F.scores(st, quiz), [0, 0, 0, 0]);
  st = F.noSteal(answer(F.next(st), 'wrong'));
  assert.deepEqual([st.phase, st.results[0][1].stealer], ['settled', null]);
});

test('answer shown before the verdict: a wrong answer has no steal', () => {
  let st = F.reveal(F.show(turn([0, 0, 0])));
  assert.equal(st.results[0][0].revealed, true);
  st = F.judge(st, 'wrong');
  assert.equal(st.phase, 'settled');
});

test('cancelling a picked stealer reopens the window with the clock it had', () => {
  let st = answer(turn([0, 0, 0]), 'wrong');
  st = { ...st, timer: { key: 's:0:0', remainingMs: 3100 } };
  const picked = F.pickStealer(st, 1);
  const back = F.cancelSteal(picked);
  assert.equal(back.phase, 'steal');
  assert.equal(back.results[0][0].stealer, null);
  assert.deepEqual(back.timer, { key: 's:0:0', remainingMs: 3100 });
  assert.equal(back.history.length, st.history.length, 'the pick is gone from the history');
});

test('turn order: 3 questions each, then the next contestant, then results; back from results', () => {
  let st = F.start(F.createState(quiz));
  for (let c = 0; c < 4; c++) {
    assert.deepEqual([st.phase, st.c], ['turn', c]);
    [0, 0, 0].forEach((l, q) => (st = F.setLevel(st, q, l)));
    st = F.beginTurn(st);
    for (let q = 0; q < 3; q++) {
      st = answer(st, 'correct');
      assert.equal(F.isLast(st), c === 3 && q === 2);
      st = F.next(st);
    }
  }
  assert.equal(st.phase, 'results');
  assert.deepEqual(F.scores(st, quiz), [60, 60, 60, 60]);
  st = F.back(st);
  assert.deepEqual([st.phase, st.c, st.q], ['settled', 3, 2]);
});

test('undo walks back every action, across questions and turns', () => {
  let st = answer(turn([1, 0, 0], 0), 'wrong'); // star wrong: −30
  st = F.judgeSteal(F.pickStealer({ ...st, timer: { key: 's:0:0', remainingMs: 2000 } }, 1), 'correct');
  st = F.next(st); // question 2, nothing done yet
  assert.deepEqual(F.scores(st, quiz), [-30, 30, 0, 0]);

  let r = F.undo(st);
  assert.equal(r.undone.type, 'steal');
  assert.deepEqual([r.state.phase, r.state.q], ['stealing', 0]);
  assert.deepEqual(F.scores(r.state, quiz), [-30, 0, 0, 0]);
  r = F.undo(r.state);
  assert.equal(r.undone.type, 'pick');
  assert.equal(r.state.phase, 'steal');
  assert.deepEqual(r.state.timer, { key: 's:0:0', remainingMs: 2000 }, 'steal clock restored');
  r = F.undo(r.state);
  assert.equal(r.undone.type, 'judge');
  assert.equal(r.state.phase, 'question');
  assert.deepEqual(F.scores(r.state, quiz), [0, 0, 0, 0]);
  r = F.undo(F.undo(r.state).state); // show, begin
  assert.equal(r.undone.type, 'begin');
  assert.equal(r.state.phase, 'turn');
  r = F.undo(r.state);
  assert.equal(r.undone.type, 'star');
  assert.equal(r.state.star[0], null);
  for (let i = 0; i < 3; i++) r = F.undo(r.state);
  assert.deepEqual(r.state.levels[0], [null, null, null]);
  assert.equal(F.undo(r.state).undone, null);
});

test('undo from the next turn goes back to the last action of the previous one', () => {
  let st = turn([0, 0, 0]);
  for (let q = 0; q < 3; q++) st = F.next(answer(st, 'correct'));
  assert.deepEqual([st.phase, st.c], ['turn', 1]);
  const r = F.undo(st);
  assert.deepEqual([r.state.phase, r.state.c, r.state.q], ['question', 0, 2]);
  assert.deepEqual(F.scores(r.state, quiz), [40, 0, 0, 0]);
});

test('actions in the wrong phase are ignored', () => {
  const intro = F.createState(quiz);
  assert.equal(F.setLevel(intro, 0, 0), intro);
  assert.equal(F.show(intro), intro);
  assert.equal(F.undo(intro).undone, null);
  const ready = turn([0, 0, 0]);
  assert.equal(F.judge(ready, 'correct'), ready);
  assert.equal(F.next(ready), ready);
  assert.equal(F.noSteal(ready), ready);
  const q = F.show(ready);
  assert.equal(F.judge(q, 'maybe'), q);
  assert.equal(F.pickStealer(q, 1), q, 'no steal while the main contestant is answering');
});

test('functions never mutate their input', () => {
  const st = F.show(turn([0, 1, 0], 1));
  const snap = JSON.stringify(st);
  F.judge(st, 'wrong');
  F.reveal(st);
  F.undo(st);
  F.next(st);
  assert.equal(JSON.stringify(st), snap);
});

test('isCompatible checks contestants and that round 4 exists', () => {
  const st = F.createState(quiz);
  assert.ok(F.isCompatible(st, quiz));
  assert.ok(!F.isCompatible(st, { ...quiz, contestants: quiz.contestants.slice(0, 3) }));
  assert.ok(!F.isCompatible(st, { ...quiz, finish: null }));
  assert.ok(!F.isCompatible(null, quiz));
});
