// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.XLSX = require('../vendor/xlsx.full.min.js');
const D = require('../js/data.js');

const header = 'Thí sinh,Câu,Câu hỏi,Đáp án,Hình ảnh (tùy chọn)';
function csv(rows) {
  return [header, ...rows].join('\n');
}
function fourEach(names) {
  return names.flatMap((n) => [1, 2, 3, 4].map((i) => `${n},${i},Câu hỏi ${i} của ${n}?,Đáp án ${i},`));
}

test('sample quiz is valid', () => {
  assert.deepEqual(D.validate(D.sampleQuiz()), []);
});

test('parses a well-formed CSV with Vietnamese text', () => {
  const r = D.parseCsvText(csv(fourEach(['Ánh', 'Bảo', 'Cường', 'Dương'])));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.contestants.length, 4);
  assert.equal(r.quiz.contestants[1].name, 'Bảo');
  assert.equal(r.quiz.contestants[1].questions[2].question, 'Câu hỏi 3 của Bảo?');
  assert.deepEqual(r.quiz.settings, D.DEFAULT_SETTINGS);
});

test('header names are matched loosely (no diacritics, any case)', () => {
  const text = ['THI SINH;CAU HOI;DAP AN', 'A;q1;a1', 'A;q2;a2', 'B;q1;a1', 'B;q2;a2'].join('\n');
  const r = D.parseCsvText(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.settings.questionsPerContestant, 2, 'inferred from data when no settings sheet');
});

test('blank contestant cell continues the previous contestant (merged cells)', () => {
  const r = D.parseCsvText(csv(['An,1,q1,a1,', ',2,q2,a2,', 'Bình,1,q1,a1,', ',2,q2,a2,']));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.quiz.contestants.map((c) => c.questions.length), [2, 2]);
});

test('keeps dates and fractions as typed text', () => {
  const r = D.parseCsvText(csv(['An,1,Ngày?,2/9/1945,', 'An,2,Phân số?,1/2,', 'Bình,1,x,007,', 'Bình,2,y,3.143,']));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.contestants[0].questions[0].answer, '2/9/1945');
  assert.equal(r.quiz.contestants[0].questions[1].answer, '1/2');
  assert.equal(r.quiz.contestants[1].questions[0].answer, '007');
});

test('orders questions by the "Câu" column', () => {
  const r = D.parseCsvText(csv(['An,2,second,b,', 'An,1,first,a,', 'Bình,1,x,a,', 'Bình,2,y,b,']));
  assert.equal(r.quiz.contestants[0].questions[0].question, 'first');
});

test('reports helpful errors', () => {
  const r = D.parseCsvText(csv(['An,1,q1,a1,', 'An,2,q2,,', 'An,3,q3,a3,', 'An,4,q4,a4,', 'Bình,1,q1,a1,']));
  assert.ok(r.errors.some((e) => e.includes('Dòng 3') && e.includes('đáp án')), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => e.includes('Bình') && e.includes('1 câu')), r.errors.join('\n'));
  assert.ok(D.parseCsvText('foo,bar\n1,2').errors[0].includes('tiêu đề'));
  assert.ok(D.parseCsvText(csv(fourEach(['A']))).errors.some((e) => e.includes('từ 2 đến 6')));
  assert.ok(D.parseCsvText(csv(fourEach(['A', 'B', 'C', 'D', 'E', 'F', 'G']))).errors.some((e) => e.includes('từ 2 đến 6')));
});

test('decodes UTF-8 with BOM and Excel Vietnamese ANSI (windows-1258)', () => {
  const utf8 = new TextEncoder().encode('﻿Thí sinh');
  assert.equal(D.decodeText(utf8), 'Thí sinh');
  // "Đáp" in windows-1258: Đ=0xD0, á=0xE1, p=0x70
  assert.equal(D.decodeText(new Uint8Array([0xd0, 0xe1, 0x70])).normalize('NFC'), 'Đáp');
});

test('xlsx round trip: template export → import gives the same quiz, including settings', () => {
  const quiz = D.sampleQuiz();
  quiz.settings = {
    title: 'Lớp 7A', seconds: 45, points: 20, questionsPerContestant: 4,
    obstacleSeconds: 20, obstacleRowPoints: 15, keywordPoints: [80, 60, 50, 40, 30],
    accelSeconds: [15, 20, 30, 45], accelPoints: [50, 30, 20, 10],
    finishSeconds: [10, 25], finishPoints: [25, 40], finishStealSeconds: 8,
  };
  quiz.obstacle.rows[3].boxes = 'Thuyền trưởng tàu';
  quiz.finish.turns[1].slots[2].image = 'images/vi-du-dong-ho.svg';
  quiz.accel.questions[3].seconds = 60;
  quiz.accel.questions[0].media = 'videos/cau-1.mp4';
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  const r = D.parseWorkbook(XLSX.read(buf, { type: 'array' }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.quiz.settings, quiz.settings);
  assert.deepEqual(r.quiz.contestants, quiz.contestants);
  assert.deepEqual(r.quiz.obstacle, quiz.obstacle);
  assert.deepEqual(r.quiz.accel, quiz.accel);
  assert.deepEqual(r.quiz.finish, quiz.finish);
});

test('workbook without a "Tăng tốc" sheet has no round 3', () => {
  const quiz = D.sampleQuiz();
  quiz.accel = null;
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  const r = D.parseWorkbook(XLSX.read(buf, { type: 'array' }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.accel, null);
});

test('"Tăng tốc" sheet: loose headers, "Câu" order, per-question time, bad time reported', () => {
  const r = D.parseAccelRows([
    ['STT', 'Nội dung', 'Trả lời', 'Video', 'Thời gian (giây)'],
    [2, 'Câu B', 'b', 'videos/b.mp4', ''],
    [1, 'Câu A', 'a', '', '25'],
    [],
    [4, 'Câu D', 'd', 'images/d.png', 'nhanh'],
    [3, 'Câu C', 'c', '', '999'],
  ]);
  assert.deepEqual(r.accel.questions.map((q) => q.question), ['Câu A', 'Câu B', 'Câu C', 'Câu D']);
  assert.deepEqual(r.accel.questions.map((q) => q.seconds), [25, null, 300, null], 'blank → setting, too big → clamped');
  assert.equal(r.errors.length, 1, 'non-numeric time is reported');
  assert.match(r.errors[0], /Thời gian/);
  assert.equal(r.accel.questions[1].media, 'videos/b.mp4');
});

test('media kind: videos by extension or browser storage, everything else is an image', () => {
  assert.equal(D.mediaKind(''), '');
  assert.equal(D.mediaKind('videos/a.MP4'), 'video');
  assert.equal(D.mediaKind('https://x.org/v.webm?x=1'), 'video');
  assert.equal(D.mediaKind('idb:v123'), 'video');
  assert.equal(D.mediaKind('images/a.png'), 'image');
  assert.equal(D.mediaKind('data:image/png;base64,AA'), 'image');
});

test('round 3 needs exactly 4 complete questions, and its errors block only round 3', () => {
  const quiz = D.sampleQuiz();
  quiz.accel.questions.pop();
  quiz.accel.questions[0].answer = '';
  const errs = D.roundErrors(quiz, 'accel');
  assert.equal(errs.length, 2);
  assert.deepEqual(D.roundErrors(quiz, 'warmup'), []);
  assert.deepEqual(D.roundErrors(quiz, 'obstacle'), []);
  quiz.accel = null;
  assert.equal(D.roundErrors(quiz, 'accel').length, 1, 'no round 3 at all');
});

test('round 3 settings need 4 numbers each', () => {
  const errors = [];
  assert.deepEqual(D.parseNumberList('accelPoints', D.LIMITS.accelPoint, '40; 30, 20 10', errors), [40, 30, 20, 10]);
  assert.deepEqual(D.parseNumberList('accelSeconds', D.LIMITS.accelSecond, '10, 20', errors), [10, 20, 30, 40]);
  assert.equal(errors.length, 1);
});

test('exported Excel leaves out videos and images picked in the editor', () => {
  const quiz = D.sampleQuiz();
  quiz.accel.questions[0].media = 'idb:v1';
  quiz.accel.questions[1].media = 'data:image/png;base64,AA';
  const rows = D.accelRows(quiz.accel);
  assert.equal(rows[1][3], '');
  assert.equal(rows[2][3], '');
});

test('workbook without an obstacle sheet has no round 2', () => {
  const quiz = D.sampleQuiz();
  quiz.obstacle = null;
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  const r = D.parseWorkbook(XLSX.read(buf, { type: 'array' }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.obstacle, null);
});

test('letter boxes: uppercase, no accents, words kept apart', () => {
  assert.deepEqual(D.letterize('Hà Nội'), ['HA', 'NOI']);
  assert.deepEqual(D.letterize('  Đường lên đỉnh – Olympia! '), ['DUONG', 'LEN', 'DINH', 'OLYMPIA']);
  assert.deepEqual(D.letterize('Thuyền trưởng'), ['THUYEN', 'TRUONG']);
  assert.deepEqual(D.letterize('H₂O'), ['HO']);
  assert.deepEqual(D.boxWords({ answer: 'Năm 1954', boxes: '' }), ['NAM', '1954']);
  assert.deepEqual(D.boxWords({ answer: 'Hà Nội (thủ đô)', boxes: 'Hà Nội' }), ['HA', 'NOI']);
  assert.equal(D.letterCount(D.letterize('Hải đăng')), 7);
});

test('obstacle sheet: loose item names, unknown items and missing parts reported', () => {
  const rows = [
    ['MUC', 'cau hoi', 'dap an', 'hinh anh'],
    ['Từ khoá', '', 'Hải đăng', 'images/x.png'],
    ['Hàng ngang 1', 'q1', 'a1'],
    ['hang 2', 'q2', 'a2'],
    ['HÀNG 3', 'q3', ''],
    ['Câu hỏi trung tâm', 'qc', 'ac'],
    ['Gợi ý', 'x', 'y'],
  ];
  const r = D.parseObstacleRows(rows);
  assert.equal(r.obstacle.keyword, 'Hải đăng');
  assert.equal(r.obstacle.image, 'images/x.png');
  assert.equal(r.obstacle.rows[1].question, 'q2');
  assert.equal(r.obstacle.center.answer, 'ac');
  assert.ok(r.errors.some((e) => e.includes('Gợi ý')), r.errors.join('\n'));
  const v = D.validateObstacle(r.obstacle);
  assert.ok(v.some((e) => e.startsWith('Hàng ngang 3: chưa có đáp án')), v.join('\n'));
  assert.ok(v.some((e) => e.startsWith('Hàng ngang 4: chưa có câu hỏi')), v.join('\n'));
  assert.equal(D.parseObstacleRows([['', ''], ['', '']]).obstacle, null, 'empty sheet = no round 2');
});

test('keyword points setting needs exactly 5 numbers (an old 6th value is dropped)', () => {
  const errors = [];
  assert.deepEqual(D.parseKeywordPoints('70; 60 ;50,40, 30', errors), [70, 60, 50, 40, 30]);
  assert.deepEqual(D.parseKeywordPoints('80, 60, 50, 40, 30, 20', errors), [80, 60, 50, 40, 30]);
  assert.deepEqual(errors, []);
  assert.deepEqual(D.parseKeywordPoints('70, 60', errors), D.DEFAULT_SETTINGS.keywordPoints);
  assert.equal(errors.length, 1);
});

test('round errors are separate: a broken round 2 does not block round 1', () => {
  const quiz = D.sampleQuiz();
  quiz.obstacle.keyword = '';
  assert.deepEqual(D.roundErrors(quiz, 'warmup'), []);
  assert.equal(D.roundErrors(quiz, 'obstacle').length, 1);
  quiz.contestants[0].name = '';
  assert.equal(D.roundErrors(quiz, 'warmup').length, 1, 'contestant problems block every round');
});

test('normalizeQuiz upgrades a quiz saved by the previous version', () => {
  const old = { id: 'x', settings: { title: 't', seconds: 30, points: 10, questionsPerContestant: 4 }, contestants: [] };
  const q = D.normalizeQuiz(old);
  assert.equal(q.obstacle, null);
  assert.equal(q.accel, null, 'quizzes saved before round 3 have no round 3');
  assert.deepEqual(q.settings.accelSeconds, [10, 20, 30, 40]);
  assert.deepEqual(q.settings.accelPoints, [40, 30, 20, 10]);
  assert.equal(q.settings.obstacleSeconds, 15);
  assert.deepEqual(q.settings.keywordPoints, [70, 60, 50, 40, 30]);
  const six = D.normalizeQuiz({ id: 'y', settings: { keywordPoints: [90, 60, 50, 40, 30, 20] }, contestants: [] });
  assert.deepEqual(six.settings.keywordPoints, [90, 60, 50, 40, 30], 'saved quizzes with 6 values keep their first 5');
});

test('csv export has a BOM and survives a round trip', () => {
  const quiz = D.sampleQuiz();
  quiz.contestants[0].questions[0].question = 'Có dấu phẩy, và "ngoặc kép"?';
  const text = D.toCsv(D.questionRows(quiz));
  assert.ok(text.startsWith('﻿'));
  const r = D.parseCsvText(D.decodeText(new TextEncoder().encode(text)));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.contestants[0].questions[0].question, 'Có dấu phẩy, và "ngoặc kép"?');
});

test('settings values are clamped to safe ranges', () => {
  const quiz = D.sampleQuiz();
  quiz.settings.seconds = 9999;
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  assert.equal(D.parseWorkbook(XLSX.read(buf, { type: 'array' })).quiz.settings.seconds, 300);
});

test('"Về đích" sheet: rows go to round 1 contestants by name, unknown names reported', () => {
  const names = ['Nguyễn Văn An', 'Trần Thị Bình'];
  const r = D.parseFinishRows([
    ['THI SINH', 'Cau', 'Cau hoi 20', 'Dap an 20', 'Cau hoi 30', 'Dap an 30', 'Hinh anh'],
    ['Trần Thị Bình', 2, 'b2 low', 'B2', 'b2 high', 'B2+', ''],
    ['', 1, 'b1 low', 'B1', 'b1 high', 'B1+', 'images/x.png'],
    ['nguyen van an', 1, 'a1 low', 'A1', 'a1 high', 'A1+', ''],
    ['Lê Văn Cường', 1, 'x', 'x', 'x', 'x', ''],
  ], names);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Lê Văn Cường/);
  assert.deepEqual(r.finish.turns.map((t) => t.slots.length), [1, 2]);
  assert.equal(r.finish.turns[1].slots[0].versions[1].question, 'b1 high', 'sorted by "Câu"; blank name continues');
  assert.equal(r.finish.turns[1].slots[0].image, 'images/x.png');
  assert.equal(r.finish.turns[0].slots[0].versions[0].answer, 'A1', 'names match without accents');
  assert.equal(D.parseFinishRows([[''], ['']], names).finish, null, 'empty sheet = no round 4');
});

test('round 4 needs 3 complete questions per contestant, and its errors block only round 4', () => {
  const quiz = D.sampleQuiz();
  quiz.finish.turns[0].slots.pop();
  quiz.finish.turns[2].slots[1].versions[1].answer = '';
  const errs = D.roundErrors(quiz, 'finish');
  assert.equal(errs.length, 2, errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('2 câu')));
  assert.ok(errs.some((e) => e.includes('câu 2 (30 điểm): chưa có đáp án')));
  for (const round of ['warmup', 'obstacle', 'accel']) assert.deepEqual(D.roundErrors(quiz, round), []);
  quiz.finish = null;
  assert.equal(D.roundErrors(quiz, 'finish').length, 1, 'no round 4 at all');
});

test('normalizeQuiz: older quizzes get no round 4 and its default settings; turns follow the contestants', () => {
  const old = D.normalizeQuiz({ id: 'x', settings: { title: 't' }, contestants: [] });
  assert.equal(old.finish, null);
  assert.deepEqual(old.settings.finishSeconds, [15, 20]);
  assert.deepEqual(old.settings.finishPoints, [20, 30]);
  assert.equal(old.settings.finishStealSeconds, 5);
  const quiz = D.sampleQuiz();
  quiz.contestants.push({ name: 'E', questions: [] });
  quiz.finish.turns[0].slots.length = 1;
  const q = D.normalizeQuiz(quiz);
  assert.equal(q.finish.turns.length, 5, 'a turn for the new contestant');
  assert.equal(q.finish.turns[4].slots.length, 3);
  assert.equal(q.finish.turns[0].slots.length, 3, 'short turns padded to 3 questions');
});

test('workbook without a "Về đích" sheet has no round 4', () => {
  const quiz = D.sampleQuiz();
  quiz.finish = null;
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  const r = D.parseWorkbook(XLSX.read(buf, { type: 'array' }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.quiz.finish, null);
});

test('a blank round 4 gives one error per contestant, not one per empty box', () => {
  const quiz = D.sampleQuiz();
  quiz.finish = D.emptyFinish(quiz.contestants.length);
  const errs = D.roundErrors(quiz, 'finish');
  assert.equal(errs.length, quiz.contestants.length, errs.join('\n'));
  assert.ok(errs[0].includes('chưa soạn câu nào'));
  quiz.finish.turns[0].slots[0].versions[0].question = 'Q';
  const one = D.roundErrors(quiz, 'finish').filter((e) => e.includes(quiz.contestants[0].name));
  assert.equal(one.length, 6, one.join('\n'));
  assert.ok(one.some((e) => e.includes('câu 1 (20 điểm): chưa có đáp án.')));
  assert.ok(one.some((e) => e.includes('câu 1 (30 điểm): chưa có câu hỏi và đáp án.')));
});
