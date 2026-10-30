/*
 * Question data: defaults, sample quiz, Excel/CSV parsing, validation and
 * template export. Uses the global SheetJS `XLSX` (vendor/xlsx.full.min.js).
 *
 * Quiz shape:
 *   { id, settings: { title, seconds, points, questionsPerContestant,
 *                     obstacleSeconds, obstacleRowPoints, keywordPoints[5],
 *                     accelSeconds[4], accelPoints[4],
 *                     finishSeconds[2], finishPoints[2], finishStealSeconds },
 *     contestants: [ { name, questions: [ { question, answer, image } ] } ],
 *     obstacle: null | { keyword, image, rows: [4 × { question, answer, boxes }],
 *                        center: { question, answer, boxes } },
 *     accel: null | { questions: [4 × { question, answer, media, seconds }] },
 *     finish: null | { turns: [one per contestant × { slots: [3 × { versions: [low, high], image }] }] } }
 * Each Finish `versions` entry is { question, answer }: [0] for the low value (20), [1] for the high (30).
 * `image` is '' | a path relative to index.html | a URL | a data: URL.
 * `media` is an image like `image`, or a video: a path / URL to .mp4/.webm, or
 * 'idb:<id>' for a video picked in the editor (stored apart in IndexedDB, see storage.js).
 * `seconds` (null = use settings.accelSeconds) overrides one question's time.
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
    accelSecond: [5, 300],
    accelPoint: [0, 1000],
    finishSecond: [5, 300],
    finishPoint: [1, 1000],
    finishStealSeconds: [2, 60],
  };

  const OBSTACLE_ROWS = 4;
  // Keyword value by how far the round has gone: before row 1, after 1–4 rows. Once the center
  // question is scored nobody can guess any more; the teacher just opens the keyword.
  const KEYWORD_STAGES = ['Trước hàng 1', 'Sau 1 hàng', 'Sau 2 hàng', 'Sau 3 hàng', 'Sau 4 hàng'];
  const ACCEL_QUESTIONS = 4;
  const FINISH_SLOTS = 3;

  const DEFAULT_SETTINGS = {
    title: 'Thử thách tri thức',
    seconds: 30,
    points: 10,
    questionsPerContestant: 4,
    obstacleSeconds: 15,
    obstacleRowPoints: 10,
    keywordPoints: [70, 60, 50, 40, 30],
    accelSeconds: [10, 20, 30, 40], // question 1–4
    accelPoints: [40, 30, 20, 10], // fastest correct, 2nd, 3rd, 4th
    finishSeconds: [15, 20], // low-value question, high-value question
    finishPoints: [20, 30],
    finishStealSeconds: 5,
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
    accelSeconds: 'Số giây vòng Tăng tốc',
    accelPoints: 'Điểm vòng Tăng tốc',
    finishSeconds: 'Số giây Về đích',
    finishPoints: 'Điểm Về đích',
    finishStealSeconds: 'Số giây cướp điểm',
  };
  const OBSTACLE_SHEET = 'Vượt chướng ngại vật';
  const OBSTACLE_HEADERS = ['Mục', 'Câu hỏi', 'Đáp án', 'Hình ảnh', 'Ô chữ (tùy chọn)'];
  const ACCEL_SHEET = 'Tăng tốc';
  const ACCEL_HEADERS = ['Câu', 'Câu hỏi', 'Đáp án', 'Hình ảnh/Video', 'Thời gian'];
  const FINISH_SHEET = 'Về đích';
  const FINISH_HEADERS = ['Thí sinh', 'Câu', 'Câu hỏi 20', 'Đáp án 20', 'Câu hỏi 30', 'Đáp án 30', 'Hình ảnh (tùy chọn)'];

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
    accelSeconds: ['sogiayvongtangtoc', 'sogiaytangtoc', 'thoigiantangtoc', 'thoigianvongtangtoc'],
    accelPoints: ['diemvongtangtoc', 'diemtangtoc'],
    finishSeconds: ['sogiayvedich', 'sogiayvongvedich', 'thoigianvedich', 'thoigianvongvedich'],
    finishPoints: ['diemvedich', 'diemvongvedich'],
    finishStealSeconds: ['sogiaycuopdiem', 'thoigiancuopdiem', 'sogiaygianhquyen'],
  };
  const OBSTACLE_COLUMNS = {
    item: ['muc', 'loai', 'phan', 'vitri', 'item'],
    question: COLUMN_ALIASES.question,
    answer: COLUMN_ALIASES.answer,
    image: COLUMN_ALIASES.image,
    boxes: ['ochu', 'ochutuychon', 'ochuhienthi', 'hienthi', 'boxes'],
  };
  const ACCEL_COLUMNS = {
    num: COLUMN_ALIASES.num,
    question: COLUMN_ALIASES.question,
    answer: COLUMN_ALIASES.answer,
    media: COLUMN_ALIASES.image.concat(['hinhanhvideo', 'hinhanhhoacvideo', 'anhvideo', 'video', 'media', 'tep']),
    seconds: ['thoigian', 'thoigiangiay', 'sogiay', 'giay', 'time', 'seconds'],
  };
  const FINISH_COLUMNS = {
    name: COLUMN_ALIASES.name,
    num: COLUMN_ALIASES.num,
    q0: ['cauhoi20', 'cauhoi20diem', 'cauhoigoi20', 'question20'],
    a0: ['dapan20', 'dapan20diem', 'answer20'],
    q1: ['cauhoi30', 'cauhoi30diem', 'cauhoigoi30', 'question30'],
    a1: ['dapan30', 'dapan30diem', 'answer30'],
    image: COLUMN_ALIASES.image,
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
    accel: [
      ['Số nguyên tố chẵn duy nhất là số nào?', 'Số 2'],
      ['Đồng hồ trong hình đang chỉ mấy giờ?', '3 giờ', 'images/vi-du-dong-ho.svg'],
      ['Sắp xếp các hành tinh sau theo thứ tự từ gần đến xa Mặt Trời: Sao Hỏa, Sao Kim, Trái Đất, Sao Thủy.', 'Sao Thủy, Sao Kim, Trái Đất, Sao Hỏa'],
      ['Tìm số tiếp theo của dãy số: 1, 1, 2, 3, 5, 8, 13, …', '21'],
    ],
    // One turn per sample contestant: 3 × [20-point question, answer, 30-point question, answer, image?]
    finish: [
      [
        ['Con vật nào được mệnh danh là "chúa sơn lâm"?', 'Con hổ', 'Loài chim nào không biết bay nhưng chạy nhanh nhất thế giới?', 'Đà điểu'],
        ['Một tuần có bao nhiêu ngày?', '7 ngày', 'Một giờ có bao nhiêu giây?', '3.600 giây'],
        ['Thủ đô của Nhật Bản là thành phố nào?', 'Tokyo', 'Thủ đô của Úc là thành phố nào?', 'Canberra'],
      ],
      [
        ['Kim loại nào ở thể lỏng ở nhiệt độ phòng?', 'Thủy ngân', 'Kí hiệu hóa học của vàng là gì?', 'Au'],
        ['Tam giác có ba cạnh bằng nhau gọi là tam giác gì?', 'Tam giác đều', 'Tổng ba góc trong một tam giác bằng bao nhiêu độ?', '180 độ'],
        ['Ai là tác giả bài thơ "Bánh trôi nước"?', 'Hồ Xuân Hương', 'Tác phẩm "Dế Mèn phiêu lưu ký" là của nhà văn nào?', 'Tô Hoài'],
      ],
      [
        ['Hành tinh nào lớn nhất trong Hệ Mặt Trời?', 'Sao Mộc', 'Hành tinh nào được gọi là "hành tinh đỏ"?', 'Sao Hỏa'],
        ['Hình bên có bao nhiêu đỉnh?', '6 đỉnh', 'Hình bên có bao nhiêu đường chéo?', '9 đường chéo', 'images/vi-du-luc-giac.svg'],
        ['Châu lục nào có diện tích lớn nhất?', 'Châu Á', 'Sa mạc Sahara nằm ở châu lục nào?', 'Châu Phi'],
      ],
      [
        ['Bộ phận nào của cây hút nước và muối khoáng từ đất?', 'Rễ cây', 'Quá trình cây xanh dùng ánh sáng để tạo ra chất hữu cơ gọi là gì?', 'Quang hợp'],
        ['Ngôi sao trên Quốc kỳ Việt Nam có màu gì?', 'Màu vàng', 'Bài hát "Tiến quân ca" là của nhạc sĩ nào?', 'Văn Cao'],
        ['Ở áp suất tiêu chuẩn, nước đóng băng ở bao nhiêu độ C?', '0 °C', 'Đơn vị đo cường độ dòng điện là gì?', 'Ampe (A)'],
      ],
    ],
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

  function sampleAccel() {
    return { questions: SAMPLE.accel.map(([question, answer, media]) => ({ question, answer, media: media || '', seconds: null })) };
  }

  /** Sample Finish turns for n contestants (the 4 sample turns, repeated if there are more). */
  function sampleFinish(n = SAMPLE.finish.length) {
    const slot = ([q0, a0, q1, a1, image]) => ({ versions: [{ question: q0, answer: a0 }, { question: q1, answer: a1 }], image: image || '' });
    return { turns: Array.from({ length: n }, (_, i) => ({ slots: SAMPLE.finish[i % SAMPLE.finish.length].map(slot) })) };
  }

  const LIST_SETTINGS = ['keywordPoints', 'accelSeconds', 'accelPoints', 'finishSeconds', 'finishPoints'];

  function copySettings(st) {
    const out = { ...st };
    for (const field of LIST_SETTINGS) out[field] = st[field].slice();
    return out;
  }

  function sampleQuiz() {
    return {
      id: newId(),
      settings: copySettings(SAMPLE.settings),
      contestants: SAMPLE.contestants.map((c) => ({
        name: c.name,
        questions: c.questions.map(([question, answer, image]) => ({ question, answer, image: image || '' })),
      })),
      obstacle: sampleObstacle(),
      accel: sampleAccel(),
      finish: sampleFinish(SAMPLE.contestants.length),
    };
  }

  function emptyQuestion() {
    return { question: '', answer: '', image: '' };
  }

  function emptyObstacle() {
    const item = () => ({ question: '', answer: '', boxes: '' });
    return { keyword: '', image: '', rows: Array.from({ length: OBSTACLE_ROWS }, item), center: item() };
  }

  function emptyAccelQuestion() {
    return { question: '', answer: '', media: '', seconds: null };
  }

  function emptyAccel() {
    return { questions: Array.from({ length: ACCEL_QUESTIONS }, emptyAccelQuestion) };
  }

  function emptyFinishSlot() {
    return { versions: [{ question: '', answer: '' }, { question: '', answer: '' }], image: '' };
  }

  function emptyFinishTurn() {
    return { slots: Array.from({ length: FINISH_SLOTS }, emptyFinishSlot) };
  }

  function emptyFinish(nContestants) {
    return { turns: Array.from({ length: nContestants }, emptyFinishTurn) };
  }

  /** 'video' | 'image' | '' — decided by the source, since a path doesn't say more. */
  function mediaKind(src) {
    if (!src) return '';
    if (src.startsWith('idb:') || src.startsWith('data:video/')) return 'video';
    return /\.(mp4|m4v|webm|ogv|mov)([?#]|$)/i.test(src) ? 'video' : 'image';
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

  /** "70, 60; 50" → [70, 60, 50]: exactly as many numbers as the default has, each clamped. */
  function parseNumberList(field, limits, value, errors, extraAllowed = 0) {
    const def = DEFAULT_SETTINGS[field];
    if (Array.isArray(value)) value = value.join(',');
    let nums = String(value).split(/[^\d]+/).filter(Boolean).map(Number);
    if (nums.length > def.length && nums.length <= def.length + extraAllowed) nums = nums.slice(0, def.length);
    if (nums.length !== def.length) {
      errors.push(`"${SETTINGS_LABELS[field]}" cần đúng ${def.length} số, ví dụ "${def.join(', ')}".`);
      return def.slice();
    }
    return nums.map((n) => Math.min(limits[1], Math.max(limits[0], n)));
  }

  function parseKeywordPoints(value, errors) {
    // Older files had a 6th value ("after the center question"); it no longer applies.
    return parseNumberList('keywordPoints', LIMITS.keywordPoint, value, errors, 1);
  }

  /** Fill in anything an older saved quiz is missing. */
  function normalizeQuiz(quiz) {
    if (!quiz) return quiz;
    const st = { ...DEFAULT_SETTINGS, ...quiz.settings };
    if (Array.isArray(st.keywordPoints) && st.keywordPoints.length === KEYWORD_STAGES.length + 1) {
      st.keywordPoints = st.keywordPoints.slice(0, KEYWORD_STAGES.length); // drop the old "after the center question" value
    }
    for (const field of LIST_SETTINGS) {
      if (!Array.isArray(st[field]) || st[field].length !== DEFAULT_SETTINGS[field].length) st[field] = DEFAULT_SETTINGS[field].slice();
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
    quiz.accel =
      quiz.accel && Array.isArray(quiz.accel.questions)
        ? {
            questions: quiz.accel.questions.map((x) => ({
              question: (x && x.question) || '',
              answer: (x && x.answer) || '',
              media: (x && x.media) || '',
              seconds: (x && x.seconds) || null,
            })),
          }
        : null;
    quiz.finish = quiz.finish && Array.isArray(quiz.finish.turns) ? normalizeFinish(quiz.finish, (quiz.contestants || []).length) : null;
    return quiz;
  }

  /** One turn per contestant, at least 3 slots each, every field present. */
  function normalizeFinish(fin, nContestants) {
    const text = (x) => ({ question: (x && x.question) || '', answer: (x && x.answer) || '' });
    const slot = (x) => ({ versions: [0, 1].map((v) => text(x && x.versions && x.versions[v])), image: (x && x.image) || '' });
    return {
      turns: Array.from({ length: nContestants }, (_, i) => {
        const slots = ((fin.turns[i] && fin.turns[i].slots) || []).map(slot);
        while (slots.length < FINISH_SLOTS) slots.push(emptyFinishSlot());
        return { slots };
      }),
    };
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
        accelSeconds: s.accelSeconds != null ? parseNumberList('accelSeconds', LIMITS.accelSecond, s.accelSeconds, errors) : DEFAULT_SETTINGS.accelSeconds.slice(),
        accelPoints: s.accelPoints != null ? parseNumberList('accelPoints', LIMITS.accelPoint, s.accelPoints, errors) : DEFAULT_SETTINGS.accelPoints.slice(),
        finishSeconds: s.finishSeconds != null ? parseNumberList('finishSeconds', LIMITS.finishSecond, s.finishSeconds, errors) : DEFAULT_SETTINGS.finishSeconds.slice(),
        finishPoints: s.finishPoints != null ? parseNumberList('finishPoints', LIMITS.finishPoint, s.finishPoints, errors) : DEFAULT_SETTINGS.finishPoints.slice(),
        finishStealSeconds: setting('finishStealSeconds'),
      },
      contestants,
      obstacle: null,
      accel: null,
      finish: null,
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

  /** The "Tăng tốc" sheet → { accel | null, errors }. */
  function parseAccelRows(rows) {
    const errors = [];
    let headerRow = -1;
    const cols = {};
    for (let r = 0; r < Math.min(rows.length, 15) && headerRow < 0; r++) {
      const found = {};
      rows[r].forEach((v, i) => {
        const n = norm(v);
        for (const [field, aliases] of Object.entries(ACCEL_COLUMNS)) {
          if (found[field] == null && aliases.includes(n)) found[field] = i;
        }
      });
      if (found.question != null && found.answer != null) {
        headerRow = r;
        Object.assign(cols, found);
      }
    }
    if (headerRow < 0) {
      const empty = rows.every((row) => row.every((v) => cell(v) === ''));
      return { accel: null, errors: empty ? [] : [`Trang "${ACCEL_SHEET}" cần các cột "Câu hỏi" và "Đáp án" (xem tệp mẫu).`] };
    }
    const qs = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const get = (f) => (cols[f] == null ? '' : cell(rows[r][cols[f]]));
      const item = { question: get('question'), answer: get('answer'), media: get('media'), seconds: null };
      const rawSeconds = get('seconds');
      if (!item.question && !item.answer && !item.media && !rawSeconds) continue;
      if (rawSeconds) {
        item.seconds = clampInt(rawSeconds, LIMITS.accelSecond, null);
        if (item.seconds == null) errors.push(`Trang "${ACCEL_SHEET}", dòng ${r + 1}: "Thời gian" phải là số giây, ví dụ 20.`);
      }
      qs.push({ ...item, num: parseFloat(get('num')) });
    }
    if (!qs.length) return { accel: null, errors };
    // Respect the "Câu" column if every row has a number; otherwise keep row order.
    const ordered = qs.every((q) => Number.isFinite(q.num)) ? qs.slice().sort((a, b) => a.num - b.num) : qs;
    return { accel: { questions: ordered.map(({ num, ...q }) => q) }, errors };
  }

  /**
   * The "Về đích" sheet → { finish | null, errors }. Rows belong to round 1's contestants by
   * name; turns are stored in contestant order so renaming in the editor keeps them.
   */
  function parseFinishRows(rows, names) {
    const errors = [];
    const where = (line) => `Trang "${FINISH_SHEET}", dòng ${line}`;
    let headerRow = -1;
    const cols = {};
    for (let r = 0; r < Math.min(rows.length, 15) && headerRow < 0; r++) {
      const found = {};
      rows[r].forEach((v, i) => {
        const n = norm(v);
        for (const [field, aliases] of Object.entries(FINISH_COLUMNS)) {
          if (found[field] == null && aliases.includes(n)) found[field] = i;
        }
      });
      if (found.name != null && found.q0 != null && found.a0 != null) {
        headerRow = r;
        Object.assign(cols, found);
      }
    }
    if (headerRow < 0) {
      const empty = rows.every((row) => row.every((v) => cell(v) === ''));
      return {
        finish: null,
        errors: empty ? [] : [`Trang "${FINISH_SHEET}" cần các cột "Thí sinh", "Câu hỏi 20", "Đáp án 20", "Câu hỏi 30", "Đáp án 30" (xem tệp mẫu).`],
      };
    }

    const byContestant = names.map(() => []);
    const indexOf = (name) => {
      const exact = names.findIndex((n) => n.trim() === name);
      return exact >= 0 ? exact : names.findIndex((n) => norm(n) === norm(name));
    };
    let any = false;
    let lastName = '';
    for (let r = headerRow + 1; r < rows.length; r++) {
      const get = (f) => (cols[f] == null ? '' : cell(rows[r][cols[f]]));
      const fields = ['q0', 'a0', 'q1', 'a1', 'image'].map(get);
      const rawName = get('name');
      if (!rawName && fields.every((x) => !x)) continue; // blank row
      any = true;
      // A blank name means "same contestant as the row above" (handy with merged cells).
      const name = rawName || lastName;
      if (!name) {
        errors.push(`${where(r + 1)}: chưa có tên thí sinh.`);
        continue;
      }
      lastName = name;
      const c = indexOf(name);
      if (c < 0) {
        errors.push(`${where(r + 1)}: không có thí sinh "${name}" ở vòng Khởi động.`);
        continue;
      }
      const [q0, a0, q1, a1, image] = fields;
      byContestant[c].push({
        num: parseFloat(get('num')),
        slot: { versions: [{ question: q0, answer: a0 }, { question: q1, answer: a1 }], image },
      });
    }
    if (!any) return { finish: null, errors };
    const turns = byContestant.map((list) => {
      // Respect the "Câu" column if every row has a number; otherwise keep row order.
      const ordered = list.every((x) => Number.isFinite(x.num)) ? list.slice().sort((a, b) => a.num - b.num) : list;
      return { slots: ordered.map((x) => x.slot) };
    });
    return { finish: { turns }, errors };
  }

  /**
   * Checks split by where they matter: `common` (contestants) blocks every round,
   * `warmup` / `obstacle` / `accel` / `finish` only block starting that round.
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
    return {
      common,
      warmup,
      obstacle: quiz.obstacle ? validateObstacle(quiz.obstacle) : [],
      accel: quiz.accel ? validateAccel(quiz.accel) : [],
      finish: quiz.finish ? validateFinish(quiz.finish, contestants, settings) : [],
    };
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

  function validateAccel(acc) {
    const errors = [];
    if (acc.questions.length !== ACCEL_QUESTIONS) {
      errors.push(`Vòng Tăng tốc cần đúng ${ACCEL_QUESTIONS} câu (hiện có ${acc.questions.length}).`);
    }
    acc.questions.forEach((q, i) => {
      if (!q.question.trim()) errors.push(`Tăng tốc, câu ${i + 1}: chưa có câu hỏi.`);
      if (!q.answer.trim()) errors.push(`Tăng tốc, câu ${i + 1}: chưa có đáp án.`);
    });
    return errors;
  }

  const blankVersion = (v) => !v.question.trim() && !v.answer.trim();

  function validateFinish(fin, contestants, settings) {
    const errors = [];
    const pts = settings.finishPoints;
    contestants.forEach((c, i) => {
      const label = c.name.trim() ? `Về đích, thí sinh "${c.name}"` : `Về đích, thí sinh ${i + 1}`;
      const turn = fin.turns[i];
      if (!turn) {
        errors.push(`${label}: chưa có câu hỏi.`);
        return;
      }
      // A blank turn or version is one error, not one per empty box.
      if (turn.slots.every((slot) => slot.versions.every(blankVersion))) {
        errors.push(`${label}: chưa soạn câu nào (cần ${FINISH_SLOTS} câu, mỗi câu có bản ${pts[0]} và ${pts[1]} điểm).`);
        return;
      }
      if (turn.slots.length !== FINISH_SLOTS) errors.push(`${label}: có ${turn.slots.length} câu, cần đúng ${FINISH_SLOTS} câu.`);
      turn.slots.forEach((slot, j) => {
        slot.versions.forEach((v, k) => {
          const where = `${label}, câu ${j + 1} (${pts[k]} điểm)`;
          if (blankVersion(v)) errors.push(`${where}: chưa có câu hỏi và đáp án.`);
          else if (!v.question.trim()) errors.push(`${where}: chưa có câu hỏi.`);
          else if (!v.answer.trim()) errors.push(`${where}: chưa có đáp án.`);
        });
      });
    });
    return errors;
  }

  const ROUND_MISSING = {
    obstacle: 'Bộ câu hỏi chưa có vòng Vượt chướng ngại vật.',
    accel: 'Bộ câu hỏi chưa có vòng Tăng tốc.',
    finish: 'Bộ câu hỏi chưa có vòng Về đích.',
  };

  /** Errors that block starting `round` ('warmup' | 'obstacle' | 'accel' | 'finish'). */
  function roundErrors(quiz, round) {
    const p = validateParts(quiz);
    if (round !== 'warmup' && !quiz[round]) return p.common.concat([ROUND_MISSING[round]]);
    return p.common.concat(p[round]);
  }

  /** All errors (every round present in the quiz). */
  function validate(quiz, opts = {}) {
    const p = validateParts(quiz, opts);
    return p.common.concat(p.warmup, p.obstacle, p.accel, p.finish);
  }

  function sheetRows(ws) {
    return root.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
  }

  function parseWorkbook(wb) {
    const names = wb.SheetNames;
    const settingsName = names.find((n) => ['caidat', 'settings'].includes(norm(n)));
    const obstacleName = names.find((n) => ['vuotchuongngaivat', 'vcnv', 'obstacle', 'chuongngaivat'].includes(norm(n)));
    const accelName = names.find((n) => ['tangtoc', 'vongtangtoc', 'accel', 'acceleration'].includes(norm(n)));
    const finishName = names.find((n) => ['vedich', 'vongvedich', 'finish'].includes(norm(n)));
    const skip = (n) => n === settingsName || n === obstacleName || n === accelName || n === finishName;
    const questionName = names.find((n) => !skip(n) && findColumns(sheetRows(wb.Sheets[n]))) || names.find((n) => !skip(n)) || names[0];
    const settingsRows = settingsName ? sheetRows(wb.Sheets[settingsName]) : [];
    const result = parseRows(sheetRows(wb.Sheets[questionName]), settingsRows);
    if (result.quiz && obstacleName) {
      const ob = parseObstacleRows(sheetRows(wb.Sheets[obstacleName]));
      result.quiz.obstacle = ob.obstacle;
      result.errors = result.errors.concat(ob.errors, ob.obstacle ? validateObstacle(ob.obstacle) : []);
    }
    if (result.quiz && accelName) {
      const ac = parseAccelRows(sheetRows(wb.Sheets[accelName]));
      result.quiz.accel = ac.accel;
      result.errors = result.errors.concat(ac.errors, ac.accel ? validateAccel(ac.accel) : []);
    }
    if (result.quiz && finishName) {
      const q = result.quiz;
      const fi = parseFinishRows(sheetRows(wb.Sheets[finishName]), q.contestants.map((c) => c.name));
      q.finish = fi.finish;
      result.errors = result.errors.concat(fi.errors, fi.finish ? validateFinish(fi.finish, q.contestants, q.settings) : []);
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

  // Images and videos picked in the editor live only in this browser.
  const exportImage = (image) => (image && !image.startsWith('data:') && !image.startsWith('idb:') ? image : '');

  function obstacleRows(ob) {
    const rows = [OBSTACLE_HEADERS, ['Từ khóa', '', ob.keyword, exportImage(ob.image), '']];
    ob.rows.forEach((r, i) => rows.push([`Hàng ${i + 1}`, r.question, r.answer, '', r.boxes]));
    rows.push(['Trung tâm', ob.center.question, ob.center.answer, '', ob.center.boxes]);
    return rows;
  }

  function accelRows(acc) {
    return [ACCEL_HEADERS].concat(acc.questions.map((q, i) => [i + 1, q.question, q.answer, exportImage(q.media), q.seconds || '']));
  }

  function finishRows(fin, contestants) {
    const rows = [FINISH_HEADERS];
    contestants.forEach((c, i) =>
      fin.turns[i].slots.forEach((s, j) => {
        const [low, high] = s.versions;
        rows.push([c.name, j + 1, low.question, low.answer, high.question, high.answer, exportImage(s.image)]);
      })
    );
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
    if (quiz.accel) {
      const ac = X.utils.aoa_to_sheet(accelRows(quiz.accel));
      ac['!cols'] = [{ wch: 6 }, { wch: 60 }, { wch: 30 }, { wch: 28 }, { wch: 10 }];
      X.utils.book_append_sheet(wb, ac, ACCEL_SHEET);
    }
    if (quiz.finish) {
      const fi = X.utils.aoa_to_sheet(finishRows(quiz.finish, quiz.contestants));
      fi['!cols'] = [{ wch: 22 }, { wch: 6 }, { wch: 50 }, { wch: 24 }, { wch: 50 }, { wch: 24 }, { wch: 28 }];
      X.utils.book_append_sheet(wb, fi, FINISH_SHEET);
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
      [SETTINGS_LABELS.accelSeconds, st.accelSeconds.join(', '), 'Vòng Tăng tốc · câu 1, 2, 3, 4 (cột "Thời gian" của từng câu được ưu tiên)'],
      [SETTINGS_LABELS.accelPoints, st.accelPoints.join(', '), 'Vòng Tăng tốc · người đúng nhanh nhất, nhì, ba, tư'],
      [SETTINGS_LABELS.finishSeconds, st.finishSeconds.join(', '), 'Vòng Về đích · câu gói thấp, câu gói cao'],
      [SETTINGS_LABELS.finishPoints, st.finishPoints.join(', '), 'Vòng Về đích · gói thấp, gói cao (cột "Câu hỏi 20" / "Câu hỏi 30")'],
      [SETTINGS_LABELS.finishStealSeconds, st.finishStealSeconds, 'Vòng Về đích · thời gian giơ tay cướp điểm'],
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
    ACCEL_QUESTIONS,
    FINISH_SLOTS,
    newId,
    sampleQuiz,
    sampleObstacle,
    sampleAccel,
    sampleFinish,
    emptyQuestion,
    emptyObstacle,
    emptyAccel,
    emptyAccelQuestion,
    emptyFinish,
    emptyFinishTurn,
    emptyFinishSlot,
    mediaKind,
    normalizeQuiz,
    letterize,
    boxWords,
    letterCount,
    parseKeywordPoints,
    parseNumberList,
    clampInt,
    parseRows,
    parseObstacleRows,
    parseAccelRows,
    parseFinishRows,
    parseWorkbook,
    parseCsvText,
    parseFile,
    decodeText,
    validate,
    validateParts,
    validateObstacle,
    validateAccel,
    validateFinish,
    roundErrors,
    questionRows,
    obstacleRows,
    accelRows,
    finishRows,
    buildWorkbook,
    toCsv,
  };

  root.QuizData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
