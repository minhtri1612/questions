// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/obstacle.js');
const D = require('../js/data.js');

const quiz = D.sampleQuiz(); // 4 contestants, rows +10, keyword 70/60/50/40/30/20

/** Play slot `i` and tick contestants `who`. */
function play(st, i, who) {
  st = O.pickRow(st, i);
  st = O.reveal(st);
  for (const c of who) st = O.toggleMark(st, c);
  return O.confirmRow(st);
}

function board() {
  return O.start(O.createState(quiz));
}

test('intro → board; rows can be played in any order', () => {
  let st = O.createState(quiz);
  assert.equal(st.phase, 'intro');
  st = O.start(st);
  assert.equal(st.phase, 'board');
  st = O.pickRow(st, 2);
  assert.deepEqual([st.phase, st.active], ['question', 2]);
});

test('center question is locked until all 4 rows are done (solved or failed)', () => {
  let st = board();
  assert.equal(O.pickRow(st, O.CENTER), st, 'locked at start');
  st = play(st, 0, [0]);
  st = play(st, 1, []);
  st = play(st, 2, [1]);
  assert.ok(!O.centerUnlocked(st));
  st = play(st, 3, []);
  assert.ok(O.centerUnlocked(st));
  assert.equal(O.pickRow(st, O.CENTER).active, O.CENTER);
});

test('a finished row cannot be picked again', () => {
  const st = play(board(), 1, [0]);
  assert.equal(O.pickRow(st, 1), st);
});

test('scoring a row: +10 for each ticked contestant; nobody → failed', () => {
  let st = play(board(), 0, [0, 2]);
  assert.deepEqual(st.rows[0], { status: 'solved', correct: [0, 2] });
  assert.deepEqual(O.scores(st, quiz), [10, 0, 10, 0]);
  assert.ok(O.pieceOpen(st, 0));
  st = play(st, 1, []);
  assert.equal(st.rows[1].status, 'failed');
  assert.ok(!O.pieceOpen(st, 1), 'failed corner stays closed');
  assert.equal(st.phase, 'board');
});

test('ticking twice un-ticks', () => {
  let st = O.reveal(O.pickRow(board(), 0));
  st = O.toggleMark(O.toggleMark(st, 1), 1);
  assert.deepEqual(O.confirmRow(st).rows[0].status, 'failed');
});

test('cancelling a question returns the row to the board untouched', () => {
  let st = O.pickRow(board(), 3);
  st = O.cancelRow(st);
  assert.deepEqual([st.phase, st.active, st.rows[3].status], ['board', null, 'closed']);
  assert.equal(O.cancelRow(O.reveal(O.pickRow(st, 3))).phase, 'marking', 'no cancel once the answer is shown');
});

test('keyword value follows the schedule 70/60/50/40/30/20', () => {
  let st = board();
  const values = [O.keywordValue(st, quiz)];
  for (let i = 0; i < 4; i++) {
    st = play(st, i, i % 2 ? [] : [0]); // failed rows count as finished too
    values.push(O.keywordValue(st, quiz));
  }
  st = play(st, O.CENTER, [1]);
  values.push(O.keywordValue(st, quiz));
  assert.deepEqual(values, [70, 60, 50, 40, 30, 20]);
});

test('a row still in progress does not count toward the keyword value', () => {
  const st = O.reveal(O.pickRow(play(board(), 0, [0]), 1));
  assert.equal(O.keywordValue(st, quiz), 60);
});

test('correct keyword guess ends the round and awards points by stage', () => {
  let st = play(play(board(), 0, [1]), 1, [1]);
  st = O.buzzCorrect(st, quiz, 2);
  assert.equal(st.phase, 'final');
  assert.equal(st.winner, 2);
  assert.deepEqual(O.scores(st, quiz), [0, 20, 50, 0]);
  for (let i = 0; i < 5; i++) assert.ok(O.pieceOpen(st, i), 'everything opens at the end');
  assert.equal(O.buzzCorrect(st, quiz, 3), st, 'no more buzzing once the keyword is solved');
});

test('buzzing is allowed mid-question and wins with the current stage value', () => {
  let st = O.pickRow(play(board(), 0, []), 1); // 1 row done, row 2 in progress
  st = O.buzzCorrect(st, quiz, 0);
  assert.equal(st.keywordPoints, 60);
});

test('wrong guess eliminates from guessing only; rows still score', () => {
  let st = O.buzzWrong(board(), 1);
  assert.deepEqual(st.eliminated, [false, true, false, false]);
  assert.equal(O.buzzWrong(st, 1), st, 'cannot buzz again');
  assert.equal(O.buzzCorrect(st, quiz, 1), st);
  st = play(st, 0, [1]);
  assert.deepEqual(O.scores(st, quiz), [0, 10, 0, 0], 'eliminated contestant still earns row points');
});

test('teacher opens the keyword when nobody solves it: no keyword points', () => {
  let st = board();
  for (let i = 0; i < 4; i++) st = play(st, i, [0]);
  st = play(st, O.CENTER, []);
  st = O.revealKeyword(st);
  assert.deepEqual([st.phase, st.winner, st.keywordPoints], ['final', null, 0]);
  assert.deepEqual(O.scores(st, quiz), [40, 0, 0, 0]);
  st = O.finish(st);
  assert.equal(st.phase, 'results');
  assert.equal(O.back(st).phase, 'final');
});

test('undo a scored row → back to ticking it with the old ticks, corner closes', () => {
  let st = play(board(), 2, [0, 3]);
  const r = O.undo(st);
  assert.deepEqual(r.undone, { type: 'row', index: 2 });
  st = r.state;
  assert.deepEqual([st.phase, st.active], ['marking', 2]);
  assert.deepEqual(st.marks, [true, false, false, true]);
  assert.equal(st.rows[2].status, 'closed');
  assert.ok(!O.pieceOpen(st, 2));
  assert.deepEqual(O.scores(st, quiz), [0, 0, 0, 0]);
});

test('undo a wrong guess brings the contestant back', () => {
  const st = O.undo(O.buzzWrong(board(), 2)).state;
  assert.deepEqual(st.eliminated, [false, false, false, false]);
});

test('undo a keyword win restores where the round was (even mid-question)', () => {
  let st = O.pickRow(play(board(), 0, [1]), 3);
  st = { ...st, timer: { slot: 3, remainingMs: 8000 } };
  const won = O.buzzCorrect(st, quiz, 1);
  const back = O.undo(won).state;
  assert.deepEqual([back.phase, back.active, back.winner, back.keywordPoints], ['question', 3, null, 0]);
  assert.deepEqual(back.timer, { slot: 3, remainingMs: 8000 });
  assert.deepEqual(O.scores(back, quiz), [0, 10, 0, 0]);
});

test('undo walks the whole stack in reverse order', () => {
  let st = play(board(), 0, [0]);
  st = O.buzzWrong(st, 3);
  st = O.revealKeyword(st);
  const kinds = [];
  for (let r = O.undo(st); r.undone; r = O.undo(r.state)) {
    kinds.push(r.undone.type);
    st = r.state;
  }
  assert.deepEqual(kinds, ['keyword', 'eliminate', 'row']);
});

test('functions never mutate their input', () => {
  const st = O.reveal(O.pickRow(board(), 0));
  const before = JSON.stringify(st);
  O.toggleMark(st, 0);
  O.confirmRow(st);
  O.buzzCorrect(st, quiz, 0);
  O.buzzWrong(st, 0);
  O.undo(O.confirmRow(st));
  assert.equal(JSON.stringify(st), before);
});

test('isCompatible checks contestant count and that the quiz has an obstacle', () => {
  const st = O.createState(quiz);
  assert.ok(O.isCompatible(st, quiz));
  assert.ok(!O.isCompatible(st, { ...quiz, obstacle: null }));
  assert.ok(!O.isCompatible(st, { ...quiz, contestants: quiz.contestants.slice(0, 3) }));
});
