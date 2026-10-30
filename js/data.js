/*
 * Question data: defaults, sample quiz, Excel/CSV parsing, validation and
 * template export. Uses the global SheetJS `XLSX` (vendor/xlsx.full.min.js).
 *
 * Quiz shape:
 *   { id, settings: { title, seconds, points, questionsPerContestant,
 *                     obstacleSeconds, obstacleRowPoints, keywordPoints[5] },
 *     contestants: [ { name, questions: [ { question, answer, image } ] } ],
 *     obstacle: null | { keyword, image, rows: [4 × { question, answer, boxes }],
 *                        center: { question, answer, boxes } } }
 * `image` is '' | a path relative to index.html | a URL | a data: URL.
 * `boxes` optionally overrides which letters the board shows for an answer.
 */
(function (root) {
  'use strict';

  const LIMITS = {
    contestants: [2, 6],
    questionsPerContestant: [1, 20],
    seconds: [5, 300],
    points: [1, 1000],
    obstacleSeconds: [5, 300],
    obstacleRowPoints: [1, 1000],
    keywordPoint: [0, 1000],
  };

  const OBSTACLE_ROWS = 4;
  // Keyword value by how far the round has gone: before row 1, after 1–4 rows. Once the center
  // question is scored nobody can guess any more; the teacher just opens the keyword.
  const KEYWORD_STAGES = ['Trước hàng 1', 'Sau 1 hàng', 'Sau 2 hàng', 'Sau 3 hàng', 'Sau 4 hàng'];

  const DEFAULT_SETTINGS = {
    title: 'Thử thách tri thức',
    seconds: 30,
    points: 10,
    questionsPerContestant: 4,
    obstacleSeconds: 15,
    obstacleRowPoints: 10,
    keywordPoints: [70, 60, 50, 40, 30],
  };

  const HEADERS = ['Thí sinh', 'Câu', 'Câu hỏi', 'Đáp án', 'Hình ảnh (tùy chọn)'];
  const SETTINGS_SHEET = 'Cài đặt';
  const SETTINGS_LABELS = {
    title: 'Tên cuộc thi',
    seconds: 'Số giây mỗi câu',
    points: 'Điểm mỗi câu',
    questionsPerContestant: 'Số câu mỗi thí sinh',
    obstacleSeconds: 'Số giây mỗi hàng ngang',
    obstacleRowPoints: 'Điểm mỗi hàng ngang',
    keywordPoints: 'Điểm từ khóa',
  };
  const OBSTACLE_SHEET = 'Vượt chướng ngại vật';
  const OBSTACLE_HEADERS = ['Mục', 'Câu hỏi', 'Đáp án', 'Hình ảnh', 'Ô chữ (tùy chọn)'];

  // Header / setting names are matched after stripping diacritics, case and
  // punctuation, so "Đáp án", "dap an" and "ĐÁP ÁN" all work.
  const COLUMN_ALIASES = {
    name: ['thisinh', 'tenthisinh', 'ten', 'hoten', 'contestant', 'name', 'player'],
    num: ['cau', 'stt', 'socau', 'causo', 'thutu', 'no', 'number'],
    question: ['cauhoi', 'noidung', 'noidungcauhoi', 'question'],
    answer: ['dapan', 'traloi', 'cautraloi', 'answer'],
    image: ['hinhanh', 'hinhanhtuychon', 'anh', 'hinh', 'image', 'img'],
  };
  const SETTING_ALIASES = {
    title: ['tencuocthi', 'tieude', 'title'],
    seconds: ['sogiaymoicau', 'sogiay', 'thoigian', 'thoigianmoicau', 'seconds', 'time'],
    points: ['diemmoicau', 'diem', 'sodiem', 'points'],
    questionsPerContestant: ['socaumoithisinh', 'socau', 'questions', 'questionspercontestant'],
    obstacleSeconds: ['sogiaymoihangngang', 'sogiayhangngang', 'thoigianhangngang', 'thoigianmoihangngang'],
    obstacleRowPoints: ['diemmoihangngang', 'diemhangngang'],
    keywordPoints: ['diemtukhoa', 'diemchuongngaivat', 'diemtukhoatheoluot'],
  };
  const OBSTACLE_COLUMNS = {
    item: ['muc', 'loai', 'phan', 'vitri', 'item'],
    question: COLUMN_ALIASES.question,
    answer: COLUMN_ALIASES.answer,
    image: COLUMN_ALIASES.image,
    boxes: ['ochu', 'ochutuychon', 'ochuhienthi', 'hienthi', 'boxes'],
  };

  const SAMPLE = {
    settings: { ...DEFAULT_SETTINGS },
    contestants: [
      {
        name: 'Nguyễn Văn An',
        questions: [
          ['Thủ đô của Việt Nam là thành phố nào?', 'Hà Nội'],
          ['Hành tinh nào ở gần Mặt Trời nhất?', 'Sao Thủy'],
          ['Ở áp suất tiêu chuẩn, nước sôi ở bao nhiêu độ C?', '100 °C'],
          ['Ai là tác giả của "Truyện Kiều"?', 'Nguyễn Du'],
        ],
      },
      {
        name: 'Trần Thị Bình',
        questions: [
          ['Đỉnh núi cao nhất Việt Nam tên là gì?', 'Fansipan (3.143 m)'],
          ['Công thức hóa học của nước là gì?', 'H₂O'],
          ['Một năm nhuận có bao nhiêu ngày?', '366 ngày'],
          ['Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập vào ngày tháng năm nào?', 'Ngày 2/9/1945'],
        ],
      },
      {
        name: 'Lê Minh Chi',
        questions: [
          ['Đại dương nào lớn nhất thế giới?', 'Thái Bình Dương'],
          ['Con vật nào tượng trưng cho năm Thìn?', 'Con rồng'],
          ['12 × 12 bằng bao nhiêu?', '144'],
          ['Vịnh Hạ Long thuộc tỉnh nào?', 'Quảng Ninh'],
        ],
      },
      {
        name: 'Phạm Quốc Dũng',
        questions: [
          ['Chất khí nào chiếm tỉ lệ lớn nhất trong không khí?', 'Khí nitơ (khoảng 78%)'],
          ['Ai là người đầu tiên đặt chân lên Mặt Trăng?', 'Neil Armstrong (năm 1969)'],
          ['Hình bên có bao nhiêu cạnh?', '6 cạnh (hình lục giác)', 'images/vi-du-luc-giac.svg'],
          ['Chiến thắng Điện Biên Phủ diễn ra vào năm nào?', 'Năm 1954'],
        ],
      },
    ],
    obstacle: {
      keyword: 'Hải đăng',
      image: 'images/vi-du-hai-dang.svg',
      rows: [
        ['Vùng nước mặn rộng lớn, nhỏ hơn đại dương, thường nằm ven các lục địa, gọi là gì?', 'Biển'],
        ['Thứ gì truyền đi với tốc độ khoảng 300.000 km/s và giúp mắt ta nhìn thấy mọi vật?', 'Ánh sáng'],
        ['Dụng cụ có kim nam châm luôn chỉ hướng Bắc – Nam, giúp người đi biển xác định phương hướng?', 'La bàn'],
        ['Người đứng đầu và chỉ huy một con tàu trên biển được gọi là gì?', 'Thuyền trưởng'],
      ],
      center: ['Vào ban đêm, người đi biển xưa thường nhìn vào thứ gì trên bầu trời (như sao Bắc Cực) để định hướng?', 'Ngôi sao'],
    },
  };

  function newId() {
    return 'quiz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function norm(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function cell(value) {
    return String(value == null ? '' : value).normalize('NFC').trim();
  }

  function sampleObstacle() {
    const o = SAMPLE.obstacle;
    const item = ([question, answer]) => ({ question, answer, boxes: '' });
    return { keyword: o.keyword, image: o.image, rows: o.rows.map(item), center: item(o.center) };
  }

  function sampleQuiz() {
    return {
      id: newId(),
      settings: { ...SAMPLE.settings, keywordPoints: SAMPLE.settings.keywordPoints.slice() },
      contestants: SAMPLE.contestants.map((c) => ({
        name: c.name,
        questions: c.questions.map(([question, answer, image]) => ({ question, answer, image: image || '' })),
      })),
      obstacle: sampleObstacle(),
    };
  }

  function emptyQuestion() {
    return { question: '', answer: '', image: '' };
  }

  function emptyObstacle() {
    const item = () => ({ question: '', answer: '', boxes: '' });
    return { keyword: '', image: '', rows: Array.from({ length: OBSTACLE_ROWS }, item), center: item() };
  }

  /**
   * Letters shown in the board boxes, TV-style: uppercase, no accents, words kept
   * apart so the UI can leave a gap. "Hà Nội" → ['HA', 'NOI'].
   */
  function letterize(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'D')
      .toUpperCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
  }

  /** Board words for a row: the optional "Ô chữ" override, else the answer. */
  function boxWords(item) {
    return letterize(item.boxes && item.boxes.trim() ? item.boxes : item.answer);
  }

  function letterCount(words) {
    return words.reduce((n, w) => n + w.length, 0);
  }

  function parseKeywordPoints(value, errors) {
    if (Array.isArray(value)) value = value.join(',');
    let nums = String(value).split(/[^\d]+/).filter(Boolean).map(Number);
    // Older files had a 6th value ("after the center question"); it no longer applies.
    if (nums.length === KEYWORD_STAGES.length + 1) nums = nums.slice(0, KEYWORD_STAGES.length);
    if (nums.length !== KEYWORD_STAGES.length) {
      errors.push(`"${SETTINGS_LABELS.keywordPoints}" cần đúng ${KEYWORD_STAGES.length} số, ví dụ "70, 60, 50, 40, 30".`);
      return DEFAULT_SETTINGS.keywordPoints.slice();
    }
    return nums.map((n) => Math.min(LIMITS.keywordPoint[1], Math.max(LIMITS.keywordPoint[0], n)));
  }

  /** Fill in anything an older saved quiz is missing. */
  function normalizeQuiz(quiz) {
    if (!quiz) return quiz;
    const st = { ...DEFAULT_SETTINGS, ...quiz.settings };
    if (Array.isArray(st.keywordPoints) && st.keywordPoints.length === KEYWORD_STAGES.length + 1) {
      st.keywordPoints = st.keywordPoints.slice(0, KEYWORD_STAGES.length); // drop the old "after the center question" value
    }
    if (!Array.isArray(st.keywordPoints) || st.keywordPoints.length !== KEYWORD_STAGES.length) {
      st.keywordPoints = DEFAULT_SETTINGS.keywordPoints.slice();
    }
    quiz.settings = st;
    if (quiz.obstacle) {
      const base = emptyObstacle();
      const o = quiz.obstacle;
      const item = (x) => ({ question: (x && x.question) || '', answer: (x && x.answer) || '', boxes: (x && x.boxes) || '' });
      quiz.obstacle = {
        keyword: o.keyword || '',
        image: o.image || '',
        rows: base.rows.map((_, i) => item(o.rows && o.rows[i])),
        center: item(o.center),
      };
    } else {
      quiz.obstacle = null;
    }
    return quiz;
  }

  function clampInt(value, [min, max], fallback) {
    const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /* ---------------- parsing ---------------- */

  function findColumns(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const cols = {};
      rows[r].forEach((v, i) => {
        const n = norm(v);
        for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
          if (cols[field] == null && aliases.includes(n)) cols[field] = i;
        }
      });
      if (cols.question != null && cols.answer != null) return { headerRow: r, cols };
    }
    return null;
  }

  function parseSettingsRows(rows) {
    const out = {};
    for (const row of rows) {
      const k = norm(row[0]);
      for (const [field, aliases] of Object.entries(SETTING_ALIASES)) {
        if (aliases.includes(k) && cell(row[1]) !== '') out[field] = cell(row[1]);
      }
    }
    return out;
  }

  /**
   * rows: array of arrays of cell values (the question sheet)
   * settingsRows: optional array of [key, value] rows
   * → { quiz, errors: [string], warnings: [string] }
   */
  function parseRows(rows, settingsRows) {
    const errors = [];
    const warnings = [];
    const found = findColumns(rows);
    if (!found) {
      return {
        quiz: null,
        errors: ['Không tìm thấy dòng tiêu đề. Bảng cần có ít nhất các cột "Thí sinh", "Câu hỏi" và "Đáp án" (xem tệp mẫu).'],
        warnings,
      };
    }
    const { headerRow, cols } = found;
    if (cols.name == null) {
      errors.push('Thiếu cột "Thí sinh" — cần biết câu hỏi nào thuộc về thí sinh nào.');
      return { quiz: null, errors, warnings };
    }

    const byName = new Map();
    let lastName = '';
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (f) => (cols[f] == null ? '' : cell(row[cols[f]]));
      const question = get('question');
      const answer = get('answer');
      const image = get('image');
      const rawName = get('name');
      if (!question && !answer && !image && !rawName) continue; // blank row
      // A blank name means "same contestant as the row above" (handy with merged cells).
      const name = rawName || lastName;
      const line = r + 1;
      if (!name) {
        errors.push(`Dòng ${line}: chưa có tên thí sinh.`);
        continue;
      }
      lastName = name;
      if (!question) errors.push(`Dòng ${line}: câu hỏi đang để trống.`);
      if (!answer) errors.push(`Dòng ${line}: đáp án đang để trống.`);
      const num = cols.num == null ? NaN : parseFloat(get('num'));
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ question, answer, image, num, line });
    }

    const s = parseSettingsRows(settingsRows || []);
    const contestants = [...byName.entries()].map(([name, qs]) => {
      // Respect the "Câu" column if every row has a number; otherwise keep row order.
      if (qs.every((q) => Number.isFinite(q.num))) qs = qs.slice().sort((a, b) => a.num - b.num);
      return { name, questions: qs.map(({ question, answer, image }) => ({ question, answer, image })) };
    });

    let perContestant;
    if (s.questionsPerContestant != null) {
      perContestant = clampInt(s.questionsPerContestant, LIMITS.questionsPerContestant, DEFAULT_SETTINGS.questionsPerContestant);
    } else {
      const counts = new Set(contestants.map((c) => c.questions.length));
      perContestant = counts.size === 1 ? [...counts][0] : DEFAULT_SETTINGS.questionsPerContestant;
    }

    const setting = (field) => clampInt(s[field] ?? DEFAULT_SETTINGS[field], LIMITS[field], DEFAULT_SETTINGS[field]);
    const quiz = {
      id: newId(),
      settings: {
        title: s.title || DEFAULT_SETTINGS.title,
        seconds: setting('seconds'),
        points: setting('points'),
        questionsPerContestant: perContestant,
        obstacleSeconds: setting('obstacleSeconds'),
        obstacleRowPoints: setting('obstacleRowPoints'),
        keywordPoints: s.keywordPoints != null ? parseKeywordPoints(s.keywordPoints, errors) : DEFAULT_SETTINGS.keywordPoints.slice(),
      },
      contestants,
      obstacle: null,
    };
    const parts = validateParts(quiz, { skipEmptyText: true });
    return { quiz, errors: errors.concat(parts.common, parts.warmup), warnings };
  }

  /** The "Vượt chướng ngại vật" sheet → { obstacle | null, errors }. */
  function parseObstacleRows(rows) {
    const errors = [];
    const where = (line) => `Trang "${OBSTACLE_SHEET}", dòng ${line}`;
    let headerRow = -1;
    const cols = {};
    for (let r = 0; r < Math.min(rows.length, 15) && headerRow < 0; r++) {
      const found = {};
      rows[r].forEach((v, i) => {
        const n = norm(v);
        for (const [field, aliases] of Object.entries(OBSTACLE_COLUMNS)) {
          if (found[field] == null && aliases.includes(n)) found[field] = i;
        }
      });
      if (found.item != null && found.answer != null) {
        headerRow = r;
        Object.assign(cols, found);
      }
    }
    if (headerRow < 0) {
      const empty = rows.every((row) => row.every((v) => cell(v) === ''));
      return { obstacle: null, errors: empty ? [] : [`Trang "${OBSTACLE_SHEET}" cần các cột "Mục" và "Đáp án" (xem tệp mẫu).`] };
    }

    const ob = emptyObstacle();
    let any = false;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const get = (f) => (cols[f] == null ? '' : cell(rows[r][cols[f]]));
      const item = get('item');
      const fields = { question: get('question'), answer: get('answer'), boxes: get('boxes') };
      const image = get('image');
      if (!item && !fields.question && !fields.answer && !image) continue;
      any = true;
      const n = norm(item);
      const rowMatch = n.match(/^(?:hangngang|hang|row)(\d+)$/);
      if (['tukhoa', 'chuongngaivat', 'cnv', 'keyword', 'tukhoachuongngaivat'].includes(n)) {
        ob.keyword = fields.answer;
        if (image) ob.image = image;
      } else if (['hinhanh', 'anh', 'image'].includes(n)) {
        ob.image = image || fields.answer;
      } else if (rowMatch && +rowMatch[1] >= 1 && +rowMatch[1] <= OBSTACLE_ROWS) {
        ob.rows[+rowMatch[1] - 1] = fields;
      } else if (['trungtam', 'cauhoitrungtam', 'hangtrungtam', 'otrungtam', 'center', 'tt'].includes(n)) {
        ob.center = fields;
      } else {
        errors.push(`${where(r + 1)}: không hiểu mục "${item}". Dùng: Từ khóa, Hàng 1–4, Trung tâm.`);
      }
    }
    return { obstacle: any ? ob : null, errors };
  }

  /**
   * Checks split by where they matter: `common` (contestants) blocks every round,
   * `warmup` / `obstacle` only block starting that round.
   */
  function validateParts(quiz, opts = {}) {
    const common = [];
    const warmup = [];
    const { contestants, settings } = quiz;
    const [minC, maxC] = LIMITS.contestants;
    if (contestants.length < minC || contestants.length > maxC) {
      common.push(`Cần từ ${minC} đến ${maxC} thí sinh (hiện có ${contestants.length}).`);
    }
    const seen = new Set();
    contestants.forEach((c, i) => {
      const label = c.name ? `Thí sinh "${c.name}"` : `Thí sinh ${i + 1}`;
      if (!c.name.trim()) common.push(`Thí sinh ${i + 1} chưa có tên.`);
      else if (seen.has(c.name.trim())) common.push(`Tên thí sinh "${c.name}" bị trùng.`);
      seen.add(c.name.trim());
      if (c.questions.length !== settings.questionsPerContestant) {
        warmup.push(`${label} có ${c.questions.length} câu, cần đúng ${settings.questionsPerContestant} câu.`);
      }
      if (!opts.skipEmptyText) {
        c.questions.forEach((q, j) => {
          if (!q.question.trim()) warmup.push(`${label}, câu ${j + 1}: chưa có nội dung câu hỏi.`);
          if (!q.answer.trim()) warmup.push(`${label}, câu ${j + 1}: chưa có đáp án.`);
        });
      }
    });
    return { common, warmup, obstacle: quiz.obstacle ? validateObstacle(quiz.obstacle) : [] };
  }

  function validateObstacle(ob) {
    const errors = [];
    if (!letterize(ob.keyword).length) errors.push('Chưa có từ khóa (chướng ngại vật).');
    if (!ob.image) errors.push('Chưa có ảnh cho chướng ngại vật.');
    const items = ob.rows.map((r, i) => [r, `Hàng ngang ${i + 1}`]).concat([[ob.center, 'Câu hỏi trung tâm']]);
    for (const [item, label] of items) {
      if (!item.question.trim()) errors.push(`${label}: chưa có câu hỏi.`);
      if (!item.answer.trim()) errors.push(`${label}: chưa có đáp án.`);
      else if (!boxWords(item).length) errors.push(`${label}: đáp án không có chữ cái nào để hiện thành ô chữ.`);
    }
    return errors;
  }

  /** Errors that block starting `round` ('warmup' | 'obstacle'). */
  function roundErrors(quiz, round) {
    const p = validateParts(quiz);
    if (round === 'obstacle' && !quiz.obstacle) return p.common.concat(['Bộ câu hỏi chưa có vòng Vượt chướng ngại vật.']);
    return p.common.concat(p[round]);
  }

  /** All errors (every round present in the quiz). */
  function validate(quiz, opts = {}) {
    const p = validateParts(quiz, opts);
    return p.common.concat(p.warmup, p.obstacle);
  }

  function sheetRows(ws) {
    return root.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
  }

  function parseWorkbook(wb) {
    const names = wb.SheetNames;
    const settingsName = names.find((n) => ['caidat', 'settings'].includes(norm(n)));
    const obstacleName = names.find((n) => ['vuotchuongngaivat', 'vcnv', 'obstacle', 'chuongngaivat'].includes(norm(n)));
    const skip = (n) => n === settingsName || n === obstacleName;
    const questionName = names.find((n) => !skip(n) && findColumns(sheetRows(wb.Sheets[n]))) || names.find((n) => !skip(n)) || names[0];
    const settingsRows = settingsName ? sheetRows(wb.Sheets[settingsName]) : [];
    const result = parseRows(sheetRows(wb.Sheets[questionName]), settingsRows);
    if (result.quiz && obstacleName) {
      const ob = parseObstacleRows(sheetRows(wb.Sheets[obstacleName]));
      result.quiz.obstacle = ob.obstacle;
      result.errors = result.errors.concat(ob.errors, ob.obstacle ? validateObstacle(ob.obstacle) : []);
    }
    return result;
  }

  /** Decode CSV bytes: UTF-8 (with/without BOM) first, then Excel's Vietnamese ANSI code page. */
  function decodeText(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
    } catch (_) {
      return new TextDecoder('windows-1258').decode(buffer);
    }
  }

  function parseCsvText(text) {
    // raw: keep "1/2" or "2/9/1945" as text instead of turning them into dates.
    const wb = root.XLSX.read(text.normalize('NFC'), { type: 'string', raw: true });
    return parseWorkbook(wb);
  }

  async function parseFile(file) {
    const buffer = await file.arrayBuffer();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return parseCsvText(decodeText(buffer));
    if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
      return parseWorkbook(root.XLSX.read(buffer, { type: 'array' }));
    }
    return { quiz: null, errors: [`Không hỗ trợ định dạng ".${ext}". Hãy dùng tệp .xlsx hoặc .csv.`], warnings: [] };
  }

  /* ---------------- export ---------------- */

  function questionRows(quiz) {
    const rows = [HEADERS];
    quiz.contestants.forEach((c) =>
      c.questions.forEach((q, j) => {
        // Pasted-in images live only in this browser; they can't be written to a cell.
        rows.push([c.name, j + 1, q.question, q.answer, exportImage(q.image)]);
      })
    );
    return rows;
  }

  const exportImage = (image) => (image && !image.startsWith('data:') ? image : '');

  function obstacleRows(ob) {
    const rows = [OBSTACLE_HEADERS, ['Từ khóa', '', ob.keyword, exportImage(ob.image), '']];
    ob.rows.forEach((r, i) => rows.push([`Hàng ${i + 1}`, r.question, r.answer, '', r.boxes]));
    rows.push(['Trung tâm', ob.center.question, ob.center.answer, '', ob.center.boxes]);
    return rows;
  }

  function buildWorkbook(quiz) {
    const X = root.XLSX;
    const wb = X.utils.book_new();
    const ws = X.utils.aoa_to_sheet(questionRows(quiz));
    ws['!cols'] = [{ wch: 22 }, { wch: 6 }, { wch: 60 }, { wch: 30 }, { wch: 28 }];
    X.utils.book_append_sheet(wb, ws, 'Câu hỏi');
    if (quiz.obstacle) {
      const ob = X.utils.aoa_to_sheet(obstacleRows(quiz.obstacle));
      ob['!cols'] = [{ wch: 12 }, { wch: 60 }, { wch: 24 }, { wch: 28 }, { wch: 18 }];
      X.utils.book_append_sheet(wb, ob, OBSTACLE_SHEET);
    }
    const st = quiz.settings;
    const settings = X.utils.aoa_to_sheet([
      ['Cài đặt', 'Giá trị', 'Ghi chú'],
      [SETTINGS_LABELS.title, st.title, 'Hiện trên màn hình trình chiếu'],
      [SETTINGS_LABELS.seconds, st.seconds, `Vòng Khởi động · từ ${LIMITS.seconds[0]} đến ${LIMITS.seconds[1]}`],
      [SETTINGS_LABELS.points, st.points, 'Vòng Khởi động · đúng được cộng, sai 0 điểm'],
      [SETTINGS_LABELS.questionsPerContestant, st.questionsPerContestant, 'Vòng Khởi động · mỗi thí sinh phải có đúng số câu này'],
      [SETTINGS_LABELS.obstacleSeconds, st.obstacleSeconds, 'Vòng Vượt chướng ngại vật'],
      [SETTINGS_LABELS.obstacleRowPoints, st.obstacleRowPoints, 'Mỗi thí sinh trả lời đúng một hàng ngang được cộng'],
      [SETTINGS_LABELS.keywordPoints, st.keywordPoints.join(', '), 'Lần lượt: ' + KEYWORD_STAGES.join(', ').toLowerCase()],
    ]);
    settings['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 70 }];
    X.utils.book_append_sheet(wb, settings, SETTINGS_SHEET);
    return wb;
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    // BOM so Excel opens Vietnamese text as UTF-8.
    return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  }

  const api = {
    LIMITS,
    DEFAULT_SETTINGS,
    HEADERS,
    KEYWORD_STAGES,
    newId,
    sampleQuiz,
    sampleObstacle,
    emptyQuestion,
    emptyObstacle,
    normalizeQuiz,
    letterize,
    boxWords,
    letterCount,
    parseKeywordPoints,
    clampInt,
    parseRows,
    parseObstacleRows,
    parseWorkbook,
    parseCsvText,
    parseFile,
    decodeText,
    validate,
    validateParts,
    validateObstacle,
    roundErrors,
    questionRows,
    obstacleRows,
    buildWorkbook,
    toCsv,
  };

  root.QuizData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
