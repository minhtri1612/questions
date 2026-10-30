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
    obstacleSeconds: 20, obstacleRowPoints: 15, keywordPoints: [80, 60, 50, 40, 30, 10],
  };
  quiz.obstacle.rows[3].boxes = 'Thuyền trưởng tàu';
  const buf = XLSX.write(D.buildWorkbook(quiz), { type: 'array', bookType: 'xlsx' });
  const r = D.parseWorkbook(XLSX.read(buf, { type: 'array' }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.quiz.settings, quiz.settings);
  assert.deepEqual(r.quiz.contestants, quiz.contestants);
  assert.deepEqual(r.quiz.obstacle, quiz.obstacle);
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

test('keyword points setting needs exactly 6 numbers', () => {
  const errors = [];
  assert.deepEqual(D.parseKeywordPoints('70; 60 ;50,40, 30 ,20', errors), [70, 60, 50, 40, 30, 20]);
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
  assert.equal(q.settings.obstacleSeconds, 15);
  assert.deepEqual(q.settings.keywordPoints, [70, 60, 50, 40, 30, 20]);
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
