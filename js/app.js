/*
 * UI controller: screens (home → editor → Warm-up → results → Obstacle → final results),
 * keyboard shortcuts, the Warm-up countdown and persistence wiring.
 * Quiz rules live in quiz.js / obstacle.js; the Obstacle screen lives in obstacle-ui.js.
 *
 * One session object covers the whole game: the Warm-up fields (quiz.js) plus
 * `round` ('warmup' | 'obstacle') and `obstacle` (obstacle.js state).
 */
(function () {
  'use strict';

  const E = window.QuizEngine;
  const O = window.ObstacleEngine;
  const D = window.QuizData;
  const S = window.Sound;
  const Store = window.Store;
  const $ = (id) => document.getElementById(id);

  const app = {
    screen: null,
    quiz: null,
    session: null,
    prefs: Store.loadPrefs(),
  };
  S.setMuted(app.prefs.muted);
  let OB = null; // Obstacle round UI, created at init

  /* =========================================================
     Helpers
     ========================================================= */

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }

  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  function download(data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadWorkbook(wb, name) {
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download(buf, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function slug(text) {
    return (
      String(text)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'cau-hoi'
    );
  }

  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
    app.screen = name;
    if (name !== 'present') stopTimerLoop();
    if (name !== 'obstacle' && OB) OB.leave();
    if (name !== 'results') {
      clearReveal();
      Confetti.stop();
    }
    window.scrollTo(0, 0);
  }

  function renderErrors(box, errors, title) {
    box.hidden = !errors.length;
    if (!errors.length) return;
    box.replaceChildren(el('h4', { text: title }), el('ul', {}, errors.map((e) => el('li', { text: e }))));
  }

  function settings() {
    return app.quiz.settings;
  }

  function hasProgress(s) {
    return !!s && (s.round === 'obstacle' || s.history.length > 0 || s.phase !== 'intro' || s.c > 0);
  }

  function isCompatible(s) {
    return E.isCompatible(s, app.quiz) && (s.round !== 'obstacle' || O.isCompatible(s.obstacle, app.quiz));
  }

  function savedSession() {
    const s = Store.loadSession();
    return app.quiz && s && isCompatible(s) ? s : null;
  }

  function isFinished(s) {
    return s.round === 'obstacle' ? s.obstacle.phase === 'results' : s.phase === 'results' && !app.quiz.obstacle;
  }

  function progressText(s) {
    if (s.round === 'obstacle') return s.obstacle.phase === 'results' ? 'đã có kết quả' : 'vòng 2 · Vượt chướng ngại vật';
    if (s.phase === 'results') return app.quiz.obstacle ? 'đã xong vòng 1' : 'đã có kết quả';
    const name = app.quiz.contestants[s.c].name;
    return s.phase === 'intro' ? `lượt ${name}` : `${name} · câu ${s.q + 1}`;
  }

  /** Warm-up + Obstacle points per contestant. */
  function totalScores(s) {
    const warm = E.scores(s, app.quiz);
    if (s.round !== 'obstacle' || !s.obstacle) return warm;
    const ob = O.scores(s.obstacle, app.quiz);
    return warm.map((w, i) => w + ob[i]);
  }

  /** Session for round 2, keeping whatever Warm-up results `base` has. */
  function enterObstacle(base) {
    const s = { ...(base || E.createSession(app.quiz)), round: 'obstacle' };
    if (!s.obstacle || !O.isCompatible(s.obstacle, app.quiz)) s.obstacle = O.createState(app.quiz);
    return s;
  }

  const ICONS = {
    pause: '<rect class="solid" x="6" y="5" width="4" height="14" rx="1"/><rect class="solid" x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path class="solid" d="M7 4.5v15l12.5-7.5z"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v5h5"/>',
    sound: '<path class="solid" d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    muted: '<path class="solid" d="M3 9h4l5-4v14l-5-4H3z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    bell: '<path class="solid" d="M12 2.5a1.5 1.5 0 0 0-1.5 1.5v.7A6 6 0 0 0 6 10.5V15l-2 2.5V19h16v-1.5L18 15v-4.5a6 6 0 0 0-4.5-5.8V4A1.5 1.5 0 0 0 12 2.5zM9.5 20a2.5 2.5 0 0 0 5 0z"/>',
  };
  function setIcon(btn, name) {
    if (btn && btn.dataset.icon !== name) {
      btn.dataset.icon = name;
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
    }
  }

  function toggleFullscreen(force) {
    const on = !!document.fullscreenElement;
    if (on && force !== true) document.exitFullscreen().catch(() => {});
    else if (!on && force !== false && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function toggleMute() {
    app.prefs.muted = !app.prefs.muted;
    S.setMuted(app.prefs.muted);
    Store.savePrefs(app.prefs);
    updateMuteButtons();
    toast(app.prefs.muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh', 1400);
  }

  function updateMuteButtons() {
    for (const b of document.querySelectorAll('[data-mute-btn]')) setIcon(b, app.prefs.muted ? 'muted' : 'sound');
  }

  function toggleHelp(show) {
    const h = $('help');
    h.hidden = show == null ? !h.hidden : !show;
    $('help-warmup').hidden = app.screen === 'obstacle';
    $('help-obstacle').hidden = app.screen !== 'obstacle';
  }

  /* ---------------- scoreboard tiles (shared by both rounds) ---------------- */

  function buildTiles(container, onBuzz) {
    container.replaceChildren(
      ...app.quiz.contestants.map((c, i) =>
        el(
          'div',
          { class: 'tile' + (onBuzz ? ' has-buzz' : '') },
          onBuzz &&
            el(
              'button',
              { class: 'tile-buzz', type: 'button', 'aria-label': `${c.name} bấm chuông`, onclick: () => onBuzz(i) },
              el('span', { class: 'tile-buzz-icon' }),
              el('span', { class: 'k', text: '⇧' + (i + 1) })
            ),
          el('div', { class: 'tile-name', text: c.name, title: c.name }),
          el('div', { class: 'tile-score', text: '0' })
        )
      )
    );
    container.querySelectorAll('.tile-buzz-icon').forEach((icon) => {
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.bell + '</svg>';
    });
  }

  function updateTiles(container, scores, active, deltas) {
    [...container.children].forEach((tile, i) => {
      tile.classList.toggle('active', i === active);
      tile.querySelector('.tile-score').textContent = scores[i];
      const d = deltas && deltas[i];
      if (d) {
        tile.classList.remove('bump');
        void tile.offsetWidth;
        tile.classList.add('bump');
        tile.append(el('div', { class: 'tile-delta' + (d < 0 ? ' neg' : ''), text: (d > 0 ? '+' : '') + d, onanimationend: (e) => e.target.remove() }));
      }
    });
  }

  /* =========================================================
     HOME
     ========================================================= */

  async function renderHome() {
    showScreen('home');
    if (!app.quiz) app.quiz = D.normalizeQuiz(await Store.loadQuiz());
    const box = $('home-resume');
    if (!app.quiz) {
      box.hidden = true;
      return;
    }
    const st = settings();
    const hasOb = !!app.quiz.obstacle;
    box.hidden = false;
    $('home-resume-title').textContent = st.title;
    $('home-resume-meta').textContent =
      `${app.quiz.contestants.length} thí sinh · Khởi động: ${st.questionsPerContestant} câu mỗi thí sinh, ${st.seconds} giây/câu` +
      (hasOb ? ` · Vượt chướng ngại vật: từ khóa ${D.letterCount(D.letterize(app.quiz.obstacle.keyword))} chữ cái` : '');

    const s = savedSession();
    const progress = hasProgress(s);
    const resume = $('btn-resume');
    resume.hidden = !progress;
    if (progress) {
      resume.textContent = isFinished(s) ? 'Xem kết quả ▶' : `Tiếp tục ▶ (${progressText(s)})`;
      resume.onclick = () => startRound(null, s);
    }
    const r1 = $('btn-round1');
    r1.className = 'btn btn-lg ' + (progress ? 'btn-ghost' : 'btn-primary');
    r1.textContent = progress ? 'Bắt đầu lại từ vòng 1' : hasOb ? 'Vòng 1 · Khởi động ▶' : 'Bắt đầu trình chiếu ▶';
    r1.onclick = () => {
      if (progress && !confirm('Bắt đầu lại từ đầu? Cuộc thi đang lưu sẽ bị xoá.')) return;
      startRound('warmup', null);
    };
    const r2 = $('btn-round2');
    r2.hidden = !hasOb;
    r2.textContent = 'Vòng 2 · Vượt chướng ngại vật ▶';
    r2.onclick = startObstacleFlow;
  }

  /**
   * Start (or restart) round 2. Warm-up points carry over from the saved game,
   * whether the Warm-up was finished, half-played or never played.
   */
  function startObstacleFlow() {
    const s = savedSession();
    if (s && s.round === 'obstacle') {
      if (!confirm('Chơi lại vòng 2 từ đầu? Điểm vòng 2 sẽ bị xoá, điểm vòng 1 được giữ nguyên.')) return false;
      startRound(null, { ...s, obstacle: O.createState(app.quiz) });
    } else if (s && hasProgress(s) && !E.isComplete(s)) {
      if (!confirm('Vòng Khởi động chưa xong. Sang vòng 2 và giữ điểm vòng 1 hiện tại?')) return false;
      startRound(null, enterObstacle(s));
    } else {
      startRound(null, enterObstacle(s));
    }
    return true;
  }

  async function adoptQuiz(quiz) {
    const s = savedSession();
    if (s && hasProgress(s) && s.phase !== 'results') {
      const ok = confirm('Mở bộ câu hỏi mới sẽ thay thế bộ đang lưu và xoá cuộc thi đang dở. Tiếp tục?');
      if (!ok) return false;
    }
    app.quiz = D.normalizeQuiz(quiz);
    app.session = null;
    Store.clearSession();
    if (!(await Store.saveQuiz(quiz))) toast('Trình duyệt không cho lưu dữ liệu — hãy giữ nguyên tab này khi thi.', 4000);
    return true;
  }

  async function loadFile(file) {
    $('home-errors').hidden = true;
    let r;
    try {
      r = await D.parseFile(file);
    } catch (e) {
      renderErrors($('home-errors'), ['Không đọc được tệp: ' + (e.message || e)], 'Không mở được tệp');
      return;
    }
    if (!r.quiz) {
      renderErrors($('home-errors'), r.errors, 'Không mở được tệp');
      return;
    }
    if (!r.quiz.settings.title || r.quiz.settings.title === D.DEFAULT_SETTINGS.title) {
      r.quiz.settings.title = file.name.replace(/\.[^.]+$/, '') || D.DEFAULT_SETTINGS.title;
    }
    if (await adoptQuiz(r.quiz)) {
      openEditor();
      toast(r.errors.length ? `Đã mở tệp — có ${r.errors.length} lỗi cần sửa (xem phía trên).` : 'Đã mở tệp. Kiểm tra lại câu hỏi rồi bấm “Bắt đầu”.', 3500);
    }
  }

  function bindHome() {
    const input = $('file-input');
    input.addEventListener('change', () => {
      if (input.files[0]) loadFile(input.files[0]);
      input.value = '';
    });
    const dz = $('dropzone');
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach((t) =>
      dz.addEventListener(t, (e) => {
        e.preventDefault();
        dz.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    // Dropping a file anywhere else must not navigate away from the app.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    $('btn-sample').onclick = async () => {
      if (await adoptQuiz(D.sampleQuiz())) openEditor();
    };
    $('btn-template-xlsx').onclick = () => downloadWorkbook(D.buildWorkbook(D.sampleQuiz()), 'mau-cau-hoi.xlsx');
    $('btn-template-csv').onclick = () =>
      download(D.toCsv(D.questionRows(D.sampleQuiz())), 'mau-cau-hoi.csv', 'text/csv;charset=utf-8');
    $('btn-edit-saved').onclick = () => openEditor();
  }

  /* =========================================================
     EDITOR
     ========================================================= */

  let saveTimer = 0;
  let edTab = 'warmup';

  function openEditor(tab) {
    if (tab) edTab = tab;
    showScreen('editor');
    const st = settings();
    $('set-title').value = st.title;
    $('set-seconds').value = st.seconds;
    $('set-points').value = st.points;
    $('set-perc').value = st.questionsPerContestant;
    $('ed-saved').textContent = '';
    renderContestants();
    setTab(edTab);
  }

  function setTab(tab) {
    edTab = tab;
    for (const t of document.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === tab);
      t.setAttribute('aria-selected', t.dataset.tab === tab);
    }
    $('ed-pane-warmup').hidden = tab !== 'warmup';
    $('ed-pane-obstacle').hidden = tab !== 'obstacle';
    if (tab === 'obstacle') OB.renderEditorPane($('ed-pane-obstacle'));
    $('ed-start').textContent =
      tab === 'obstacle' ? 'Bắt đầu vòng 2 ▶' : app.quiz.obstacle ? 'Bắt đầu vòng 1 ▶' : 'Bắt đầu trình chiếu ▶';
    $('ed-start').disabled = tab === 'obstacle' && !app.quiz.obstacle;
    validateEditor();
  }

  /** Called after every edit. Structural edits invalidate any in-progress session. */
  function edited(structural) {
    if (structural) app.quiz.id = D.newId();
    validateEditor();
    $('ed-saved').textContent = 'Đang lưu…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    const ok = await Store.saveQuiz(app.quiz);
    $('ed-saved').textContent = ok ? '✓ Đã lưu' : 'Không lưu được';
  }

  /** Errors for the open tab (contestant problems show on both). Badges count each tab. */
  function validateEditor() {
    const p = D.validateParts(app.quiz);
    const errors = p.common.concat(p[edTab]);
    const round = edTab === 'obstacle' ? 'vòng 2' : 'vòng 1';
    renderErrors($('ed-errors'), errors, `Cần sửa ${errors.length} lỗi trước khi bắt đầu ${round}`);
    const badge = (id, n) => {
      const b = document.querySelector(`#${id} .tab-badge`);
      b.hidden = !n;
      b.textContent = n;
    };
    badge('tab-warmup', p.common.length + p.warmup.length);
    badge('tab-obstacle', app.quiz.obstacle ? p.obstacle.length : 0);
    return errors;
  }

  function renderContestants() {
    const q = app.quiz;
    const [min, max] = D.LIMITS.contestants;
    $('ed-contestants').replaceChildren(...q.contestants.map((c, i) => contestantCard(c, i, min)));
    $('ed-add').disabled = q.contestants.length >= max;
    validateEditor();
  }

  function contestantCard(c, i, min) {
    const hasContent = () => c.questions.some((q) => q.question || q.answer || q.image);
    return el(
      'div',
      { class: 'panel ed-contestant' },
      el(
        'div',
        { class: 'ed-head' },
        el('div', { class: 'ed-badge', text: i + 1 }),
        el('input', {
          class: 'ed-name',
          type: 'text',
          value: c.name,
          placeholder: `Tên thí sinh ${i + 1}`,
          maxlength: 40,
          'aria-label': `Tên thí sinh ${i + 1}`,
          oninput: (e) => {
            c.name = e.target.value;
            edited(false);
          },
        }),
        el('button', {
          class: 'btn btn-danger',
          type: 'button',
          text: 'Xoá',
          title: 'Xoá thí sinh này',
          disabled: app.quiz.contestants.length <= min,
          onclick: () => {
            if (hasContent() && !confirm(`Xoá thí sinh "${c.name || i + 1}" cùng các câu hỏi?`)) return;
            app.quiz.contestants.splice(i, 1);
            renderContestants();
            edited(true);
          },
        })
      ),
      el(
        'div',
        { class: 'ed-qs' },
        el('div', { class: 'ed-q ed-q-headrow' },
          el('div'),
          el('div', { class: 'ed-q-head', text: 'Câu hỏi' }),
          el('div', { class: 'ed-q-head', text: 'Đáp án' }),
          el('div', { class: 'ed-q-head', text: 'Hình ảnh' })
        ),
        c.questions.map((q, j) => questionRow(q, j))
      )
    );
  }

  function questionRow(q, j) {
    const area = (field, placeholder) =>
      el('textarea', {
        rows: 2,
        value: q[field],
        placeholder,
        'aria-label': placeholder,
        oninput: (e) => {
          q[field] = e.target.value;
          edited(false);
        },
      });
    return el(
      'div',
      { class: 'ed-q' },
      el('div', { class: 'ed-q-num', text: j + 1 }),
      area('question', `Câu hỏi ${j + 1}`),
      area('answer', 'Đáp án'),
      imageCell(q)
    );
  }

  function imageCell(q) {
    const box = el('div', { class: 'ed-img' });
    function draw() {
      const parts = [];
      if (q.image) {
        const img = el('img', { class: 'ed-img-thumb', src: q.image, alt: '' });
        img.onerror = () => img.replaceWith(el('div', { class: 'ed-img-broken', text: 'Không tải được ảnh: ' + q.image }));
        parts.push(img);
      }
      parts.push(
        el(
          'div',
          { class: 'row' },
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: q.image ? 'Đổi ảnh' : '+ Ảnh',
            onclick: () => pickImage(q, draw),
          }),
          q.image &&
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: '✕',
              title: 'Bỏ ảnh',
              onclick: () => {
                q.image = '';
                draw();
                edited(false);
              },
            })
        )
      );
      box.replaceChildren(...parts);
    }
    draw();
    return box;
  }

  function pickImage(q, done) {
    const input = $('ed-image-input');
    input.value = '';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        q.image = await imageToDataUrl(f);
        done();
        edited(false);
      } catch (e) {
        toast('Không đọc được ảnh này.');
      }
    };
    input.click();
  }

  /** Store picked images inside the quiz, downscaled so big photos don't bloat storage. */
  function imageToDataUrl(file) {
    const readRaw = () =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
    if (file.type === 'image/svg+xml' || file.type === 'image/gif' || file.size < 400 * 1024) return readRaw();
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = el('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        // PNGs may be diagrams with transparency → WebP keeps alpha; photos → JPEG.
        resolve(file.type === 'image/png' ? cv.toDataURL('image/webp', 0.9) : cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  function setQuestionsPerContestant(n) {
    const q = app.quiz;
    const losing = q.contestants.some((c) => c.questions.slice(n).some((x) => x.question || x.answer || x.image));
    if (losing && !confirm(`Giảm xuống ${n} câu sẽ xoá các câu từ số ${n + 1} trở đi. Tiếp tục?`)) {
      $('set-perc').value = q.settings.questionsPerContestant;
      return;
    }
    q.settings.questionsPerContestant = n;
    for (const c of q.contestants) {
      c.questions = c.questions.slice(0, n);
      while (c.questions.length < n) c.questions.push(D.emptyQuestion());
    }
    renderContestants();
    edited(true);
  }

  function bindEditor() {
    $('ed-home').onclick = async () => {
      await flushSave();
      renderHome();
    };
    $('set-title').oninput = (e) => {
      settings().title = e.target.value;
      edited(false);
    };
    const num = (id, field) => {
      $(id).onchange = (e) => {
        const v = D.clampInt(e.target.value, D.LIMITS[field], settings()[field]);
        e.target.value = v;
        if (field === 'questionsPerContestant') {
          if (v !== settings().questionsPerContestant) setQuestionsPerContestant(v);
        } else {
          settings()[field] = v;
          edited(false);
        }
      };
    };
    num('set-seconds', 'seconds');
    num('set-points', 'points');
    num('set-perc', 'questionsPerContestant');

    $('ed-add').onclick = () => {
      const q = app.quiz;
      q.contestants.push({
        name: '',
        questions: Array.from({ length: q.settings.questionsPerContestant }, D.emptyQuestion),
      });
      renderContestants();
      edited(true);
      const inputs = document.querySelectorAll('.ed-name');
      inputs[inputs.length - 1].focus();
    };

    $('ed-export').onclick = () => {
      downloadWorkbook(D.buildWorkbook(app.quiz), slug(settings().title) + '.xlsx');
      const q = app.quiz;
      const pasted = (img) => !!img && img.startsWith('data:');
      if (q.contestants.some((c) => c.questions.some((x) => pasted(x.image))) || (q.obstacle && pasted(q.obstacle.image))) {
        toast('Lưu ý: ảnh chọn từ máy chỉ lưu trong trình duyệt, không được ghi vào tệp Excel.', 4500);
      }
    };

    for (const t of document.querySelectorAll('.tab')) t.onclick = () => setTab(t.dataset.tab);

    $('ed-start').onclick = async () => {
      const errors = validateEditor();
      if (errors.length) {
        toast(`Còn ${errors.length} lỗi cần sửa trước khi bắt đầu.`);
        $('ed-errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      toggleFullscreen(true); // while still inside the click gesture
      await flushSave();
      if (edTab === 'obstacle') {
        if (!startObstacleFlow()) toggleFullscreen(false);
        return;
      }
      const s = savedSession();
      if (s && hasProgress(s) && !isFinished(s) && !confirm('Bắt đầu lại từ đầu? Cuộc thi đang dở sẽ bị xoá.')) {
        toggleFullscreen(false);
        return;
      }
      startRound('warmup', null);
    };
  }

  /* =========================================================
     PRESENTATION
     ========================================================= */

  /** Start a new game at `round`, or continue `session` (its own round). */
  function startRound(round, session) {
    const target = session ? (session.round === 'obstacle' ? 'obstacle' : 'warmup') : round;
    const errors = D.roundErrors(app.quiz, target);
    if (errors.length) {
      toggleFullscreen(false);
      openEditor(target);
      toast(`${target === 'obstacle' ? 'Vòng 2' : 'Vòng 1'} còn lỗi — hãy sửa trước khi trình chiếu.`);
      return;
    }
    S.unlock();
    toggleFullscreen(true);
    if (!session) session = round === 'obstacle' ? enterObstacle(null) : E.createSession(app.quiz);
    app.session = session;
    if (app.session.timer) app.session.timer.running = false; // resume paused after a refresh
    timer.key = null;
    OB.reset();
    Store.saveSession(app.session);
    route();
  }

  /** Show whatever screen the session is on. */
  function route(opts = {}) {
    const s = app.session;
    if (s.round === 'obstacle') {
      if (s.obstacle.phase === 'results') showResults('final');
      else if (app.screen !== 'obstacle') OB.show();
      else OB.render(opts);
    } else if (s.phase === 'results') {
      showResults('warmup');
    } else if (app.screen !== 'present') {
      showPresent();
    } else {
      renderPresent(opts);
    }
  }

  let lastCardKey = null;
  let lastIntroC = null;

  function showPresent() {
    showScreen('present');
    lastCardKey = null;
    lastIntroC = null;
    buildTiles($('pr-tiles'), null);
    renderPresent();
  }

  function commit(next, opts = {}) {
    app.session = next;
    persistSession();
    route(opts);
  }

  function persistSession() {
    const s = app.session;
    if (!s) return;
    if (s.round === 'obstacle') {
      OB.persistTimer(s);
    } else {
      s.timer = timer.key && s.phase === 'question' && timer.key === s.c + ':' + s.q
        ? { c: s.c, q: s.q, remainingMs: remainingMs(), running: timer.running, idle: timer.idle }
        : null;
    }
    Store.saveSession(s);
  }

  function renderPresent(opts = {}) {
    const s = app.session;
    $('pr-title').textContent = settings().title;
    renderTiles(opts.deltas);
    const intro = s.phase === 'intro';
    $('pr-intro').hidden = !intro;
    $('pr-card-wrap').hidden = intro;
    if (intro) renderIntro();
    else renderCard();
    syncTimer();
    renderDots();
    renderControls();
  }

  function renderTiles(deltas) {
    const s = app.session;
    updateTiles($('pr-tiles'), E.scores(s, app.quiz), s.c, deltas);
  }

  function renderIntro() {
    const s = app.session;
    const st = settings();
    const n = app.quiz.contestants.length;
    $('pr-intro-eyebrow').textContent = `Thí sinh ${s.c + 1} / ${n}`;
    $('pr-intro-name').textContent = app.quiz.contestants[s.c].name;
    $('pr-intro-meta').textContent = `${st.questionsPerContestant} câu hỏi · ${st.seconds} giây mỗi câu · ${st.points} điểm mỗi câu`;
    if (lastIntroC !== s.c) {
      const box = $('pr-intro');
      box.style.animation = 'none';
      void box.offsetWidth;
      box.style.animation = '';
      lastIntroC = s.c;
    }
    lastCardKey = null;
  }

  const STAMPS = {
    correct: () => `ĐÚNG +${settings().points}`,
    wrong: () => 'SAI · 0',
    skipped: () => 'BỎ QUA',
  };

  function renderCard() {
    const s = app.session;
    const { c, q } = s;
    const nQ = settings().questionsPerContestant;
    const item = app.quiz.contestants[c].questions[q];
    const flipped = s.flipped[c][q];
    const card = $('pr-card');
    const key = c + ':' + q;
    lastIntroC = null;

    if (key !== lastCardKey) {
      // New question: fill both faces and set the side without animating the flip.
      card.classList.add('no-anim');
      card.classList.toggle('flipped', flipped);
      $('pr-front-label').textContent = `Câu hỏi ${q + 1} / ${nQ}`;
      setFitText($('pr-front-text'), item.question);
      setFitText($('pr-back-text'), item.answer);
      $('pr-back-question').textContent = item.question;
      const img = $('pr-front-img');
      if (item.image) {
        img.hidden = false;
        img.onload = img.onerror = () => {
          if (!img.naturalWidth) img.hidden = true;
          fitCard();
        };
        img.src = item.image;
      } else {
        img.hidden = true;
        img.removeAttribute('src');
      }
      $('pr-stamp').dataset.kind = '';
      $('pr-stamp').hidden = true;
      void card.offsetWidth;
      card.classList.remove('no-anim');
      const wrap = $('pr-card-wrap');
      wrap.classList.remove('enter');
      void wrap.offsetWidth;
      wrap.classList.add('enter');
      lastCardKey = key;
      requestAnimationFrame(fitCard);
    } else {
      card.classList.toggle('flipped', flipped);
    }

    const result = s.results[c][q];
    const stamp = $('pr-stamp');
    if ((result || '') !== stamp.dataset.kind) {
      stamp.dataset.kind = result || '';
      stamp.hidden = !result;
      if (result) {
        stamp.className = 'stamp ' + result;
        stamp.textContent = STAMPS[result]();
      }
    }
  }

  function setFitText(box, text) {
    box.replaceChildren(el('span', { text }));
  }

  /** Shrink text until it fits its box — long questions stay readable without scrolling. */
  function fitText(box, maxPx, minPx) {
    const span = box.firstElementChild;
    if (!span || !box.clientHeight) return;
    let lo = minPx;
    let hi = maxPx;
    box.style.fontSize = hi + 'px';
    if (span.offsetHeight <= box.clientHeight && span.scrollWidth <= box.clientWidth) return;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      box.style.fontSize = mid + 'px';
      if (span.offsetHeight <= box.clientHeight && span.scrollWidth <= box.clientWidth) lo = mid;
      else hi = mid;
    }
    box.style.fontSize = lo + 'px';
  }

  function fitCard() {
    if (app.screen !== 'present' || $('pr-card-wrap').hidden) return;
    const h = innerHeight;
    fitText($('pr-front-text'), h * 0.085, h * 0.026);
    fitText($('pr-back-text'), h * 0.13, h * 0.03);
  }

  function renderDots() {
    const s = app.session;
    const row = s.results[s.c];
    $('pr-dots').replaceChildren(
      ...row.map((r, j) =>
        el('div', {
          class: 'dot' + (r ? ' ' + r : '') + (s.phase === 'question' && j === s.q ? ' current' : ''),
          text: j + 1,
        })
      )
    );
    const n = app.quiz.contestants.length;
    $('pr-status').textContent = `Lượt thí sinh ${s.c + 1}/${n}`;
  }

  function renderControls() {
    const s = app.session;
    const inQ = s.phase === 'question';
    const result = inQ ? s.results[s.c][s.q] : null;
    const nQ = settings().questionsPerContestant;
    const last = s.c === app.quiz.contestants.length - 1 && s.q === nQ - 1;
    const set = (act, disabled, text) => {
      const b = document.querySelector(`#screen-present [data-act="${act}"]`);
      b.disabled = disabled;
      if (text) b.textContent = text;
    };
    set('back', s.phase === 'intro' && s.c === 0);
    set('flip', !inQ);
    set('correct', !inQ);
    set('wrong', !inQ);
    set('skip', !inQ || result != null);
    set('undo', !s.history.length);
    set('next', inQ && result == null, s.phase === 'intro' ? 'Bắt đầu ›' : last ? 'Xem kết quả ›' : 'Tiếp ›');
    const canTime = inQ && !s.flipped[s.c][s.q] && result == null;
    set('pause', !canTime);
    set('reset', !inQ || result != null);
  }

  /* ---------------- countdown timer ---------------- */

  // Lives outside the (immutable) session; a snapshot is persisted on every save.
  const timer = { key: null, totalMs: 0, remainingMs: 0, deadline: 0, running: false, idle: false, lastWhole: 0, handle: 0 };

  function remainingMs() {
    return timer.running ? Math.max(0, timer.deadline - performance.now()) : timer.remainingMs;
  }

  function syncTimer() {
    const s = app.session;
    if (s.phase !== 'question') {
      stopTimerLoop();
      timer.key = null;
      renderTimer();
      return;
    }
    const key = s.c + ':' + s.q;
    const fresh = !s.flipped[s.c][s.q] && s.results[s.c][s.q] == null;
    if (timer.key !== key) {
      stopTimerLoop();
      timer.key = key;
      timer.totalMs = settings().seconds * 1000;
      const snap = s.timer && s.timer.c === s.c && s.timer.q === s.q ? s.timer : null;
      if (snap) {
        // restored after a refresh — paused, teacher presses T to continue
        timer.remainingMs = snap.remainingMs;
        timer.idle = !!snap.idle;
        timer.running = false;
      } else {
        timer.remainingMs = fresh ? timer.totalMs : 0;
        timer.idle = !fresh; // revisiting an already revealed question
        timer.running = fresh;
      }
      timer.lastWhole = Math.ceil(timer.remainingMs / 1000);
      if (timer.running) startTimerLoop();
    }
    if (!fresh && timer.running) pauseTimer(); // answer revealed → clock stops
    renderTimer();
  }

  function startTimerLoop() {
    timer.running = true;
    timer.deadline = performance.now() + timer.remainingMs;
    clearInterval(timer.handle);
    timer.handle = setInterval(onTimerTick, 100);
  }

  function stopTimerLoop() {
    clearInterval(timer.handle);
    timer.handle = 0;
    if (timer.running) timer.remainingMs = remainingMs();
    timer.running = false;
  }

  function pauseTimer() {
    stopTimerLoop();
    persistSession();
  }

  function onTimerTick() {
    const rem = remainingMs();
    if (rem <= 0) {
      stopTimerLoop();
      timer.remainingMs = 0;
      S.buzzer();
      toast('Hết giờ!', 1800);
      commit(E.markTimedOut(app.session));
      return;
    }
    const whole = Math.ceil(rem / 1000);
    if (whole !== timer.lastWhole) {
      timer.lastWhole = whole;
      S.tick(whole <= 5);
      persistSession();
    }
    renderTimer();
  }

  const RING = 2 * Math.PI * 52;

  function renderTimer() {
    const box = $('pr-timer');
    const s = app.session;
    const inQ = s && s.phase === 'question';
    const rem = remainingMs();
    const timedOut = inQ && s.timedOut[s.c][s.q];
    const revealed = inQ && (s.flipped[s.c][s.q] || s.results[s.c][s.q] != null);
    const idle = !inQ || timer.idle;
    let label = 'giây';
    if (idle) label = s && s.phase === 'intro' ? 'Sẵn sàng' : '';
    else if (timedOut) label = 'Hết giờ';
    else if (revealed) label = 'Đã dừng';
    else if (!timer.running) label = 'Tạm dừng';

    $('pr-timer-num').textContent = !inQ ? settings().seconds : idle ? '–' : Math.ceil(rem / 1000);
    $('pr-timer-label').textContent = label;
    const frac = !inQ ? 1 : idle ? 0 : rem / timer.totalMs;
    $('pr-timer-ring').style.strokeDashoffset = RING * (1 - frac);
    $('pr-timer-ring').style.opacity = frac > 0 ? 1 : 0; // round cap would leave a dot at 0
    box.className = 'timer';
    if (!inQ || idle) box.classList.add('idle');
    else if (timedOut) box.classList.add('timeout');
    else if (!timer.running) box.classList.add('paused');
    else if (rem <= 5000) box.classList.add('urgent');
    setIcon($('pr-btn-pause'), timer.running ? 'pause' : 'play');
  }

  /* ---------------- actions ---------------- */

  function scoreDeltas(before, after) {
    return before.map((b, i) => after[i] - b);
  }

  function attention() {
    const row = document.querySelector('.score-btns');
    row.classList.remove('attention');
    void row.offsetWidth;
    row.classList.add('attention');
  }

  const actions = {
    advance() {
      const s = app.session;
      if (s.phase === 'question' && !s.flipped[s.c][s.q]) {
        S.flip();
        commit(E.setFlipped(s, true));
        return;
      }
      const r = E.advance(s, app.quiz);
      if (r.blocked === 'needs-score') {
        toast('Hãy chấm Đúng (C) hoặc Sai (X) trước khi sang câu mới.');
        attention();
        return;
      }
      commit(r.session);
    },
    next() {
      actions.advance();
    },
    flip() {
      const s = app.session;
      if (s.phase !== 'question') return;
      S.flip();
      commit(E.flip(s));
    },
    back() {
      const s = app.session;
      if (s.phase === 'intro' && s.c === 0) return;
      commit(E.back(s, app.quiz));
    },
    correct() {
      score('correct');
    },
    wrong() {
      score('wrong');
    },
    skip() {
      const s = app.session;
      if (s.phase !== 'question' || s.results[s.c][s.q] != null) return;
      S.reveal();
      toast(`Đã bỏ qua câu ${s.q + 1} (0 điểm). Nhấn U để hoàn tác.`);
      commit(E.score(s, app.quiz, 'skipped'));
    },
    undo() {
      const s = app.session;
      const before = E.scores(s, app.quiz);
      const r = E.undo(s);
      if (!r.undone) {
        toast('Không có gì để hoàn tác.', 1500);
        return;
      }
      const name = app.quiz.contestants[r.undone.c].name;
      toast(`Đã hoàn tác: ${name} – câu ${r.undone.q + 1}. Hãy chấm lại.`);
      commit(r.session, { deltas: scoreDeltas(before, E.scores(r.session, app.quiz)) });
    },
    pause() {
      const s = app.session;
      if (s.phase !== 'question' || s.flipped[s.c][s.q] || s.results[s.c][s.q] != null || timer.idle) {
        toast('Đồng hồ chỉ chạy khi thẻ đang hiện câu hỏi.', 1800);
        return;
      }
      if (timer.running) pauseTimer();
      else if (remainingMs() > 0) {
        startTimerLoop();
        persistSession();
      }
      renderTimer();
      renderControls();
    },
    reset() {
      let s = app.session;
      if (s.phase !== 'question') return;
      if (s.results[s.c][s.q] != null) {
        toast('Câu này đã được chấm — nhấn U để hoàn tác trước.', 2200);
        return;
      }
      if (s.flipped[s.c][s.q]) {
        s = E.setFlipped(s, false); // back to the question side
        s.timedOut[s.c][s.q] = false;
      }
      stopTimerLoop();
      timer.key = null; // syncTimer will start a fresh full countdown
      s.timer = null;
      toast('Đã đặt lại đồng hồ.', 1400);
      commit(s);
    },
    mute: toggleMute,
    fullscreen: () => toggleFullscreen(),
    help: () => toggleHelp(),
    exit() {
      persistSession();
      toggleFullscreen(false);
      renderHome();
    },
  };

  function score(kind) {
    const s = app.session;
    if (s.phase !== 'question') return;
    const before = E.scores(s, app.quiz);
    const next = E.score(s, app.quiz, kind);
    if (kind === 'correct') S.correct();
    else S.wrong();
    stopTimerLoop();
    commit(next, { deltas: scoreDeltas(before, E.scores(next, app.quiz)) });
  }

  function bindPresent() {
    document.querySelectorAll('#screen-present [data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur(); // so a later Space/Enter doesn't re-press this button
        actions[b.dataset.act]();
      })
    );
    $('pr-card').addEventListener('click', () => actions.flip());

    // Hide the cursor and dim the control bar when the mouse is idle.
    let idleTimer = 0;
    const present = $('screen-present');
    present.addEventListener('mousemove', () => {
      present.classList.remove('idle-cursor');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => present.classList.add('idle-cursor'), 3000);
    });
  }

  /* =========================================================
     RESULTS
     ========================================================= */

  let revealTimers = [];
  let revealDone = null;
  let resultsKind = 'warmup'; // 'warmup' (after round 1) | 'final' (after round 2)

  function clearReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
  }

  function hasNextRound() {
    return resultsKind === 'warmup' && !!app.quiz.obstacle;
  }

  function goToObstacle() {
    if (D.roundErrors(app.quiz, 'obstacle').length) {
      toggleFullscreen(false);
      openEditor('obstacle');
      toast('Vòng 2 còn lỗi — hãy sửa trước khi trình chiếu.');
      return;
    }
    commit(enterObstacle(app.session));
  }

  function showResults(kind) {
    resultsKind = kind;
    showScreen('results');
    const s = app.session;
    const quiz = app.quiz;
    const st = settings();
    const final = kind === 'final' || !quiz.obstacle;
    const scores = kind === 'final' ? totalScores(s) : E.scores(s, quiz);
    const max = kind === 'final' ? Math.max(1, ...scores) : st.questionsPerContestant * st.points;
    const ranking = E.rankScores(quiz.contestants.map((c) => c.name), scores);
    const top = ranking[0].score;
    const winners = ranking.filter((r) => r.rank === 1 && r.score > 0);

    $('rs-title').textContent = st.title;
    $('rs-heading').textContent = final ? 'Kết quả chung cuộc' : 'Kết quả vòng Khởi động';
    $('rs-back').textContent = kind === 'final' ? '‹ Quay lại vòng 2' : '‹ Xem lại câu cuối';
    $('rs-next').hidden = !hasNextRound();
    $('rs-home').className = 'btn ' + (hasNextRound() ? 'btn-ghost' : 'btn-primary');
    $('rs-actions').hidden = true;
    $('rs-table-wrap').hidden = true;
    $('rs-hint').hidden = false;

    const rows = ranking.map((r) => {
      const isWinner = r.rank === 1 && r.score > 0;
      const lead = final ? ['Quán quân', 'Đồng quán quân'] : ['Dẫn đầu', 'Đồng dẫn đầu'];
      const sub = isWinner ? lead[winners.length > 1 ? 1 : 0] : `Hạng ${r.rank}`;
      const li = el(
        'li',
        { class: 'rank-row' + (isWinner ? ' winner' : '') },
        el('div', { class: 'rank-badge', text: isWinner ? '★' : r.rank }),
        el('div', { style: 'min-width:0' }, el('div', { class: 'rank-sub', text: sub }), el('div', { class: 'rank-name', text: r.name, title: r.name })),
        el('div', { class: 'rank-bar' }, el('span')),
        el('div', { class: 'rank-score', text: r.score })
      );
      li._width = max ? (r.score / max) * 100 : 0;
      li._rank = r.rank;
      return li;
    });
    $('rs-list').replaceChildren(...rows);

    const show = (li) => {
      li.classList.remove('pending');
      li.classList.add('shown');
      li.querySelector('.rank-bar > span').style.width = li._width + '%';
    };

    // Reveal from last place up; the top group gets a drum-roll pause.
    const ranks = [...new Set(ranking.map((r) => r.rank))].sort((a, b) => b - a);
    const topRows = rows.filter((li) => li._rank === 1);
    let t = 700;
    ranks.slice(0, -1).forEach((rank) => {
      revealTimers.push(
        setTimeout(() => {
          S.reveal();
          rows.filter((li) => li._rank === rank).forEach(show);
        }, t)
      );
      t += 1500;
    });
    revealTimers.push(setTimeout(() => topRows.forEach((li) => li.classList.add('pending')), t));
    t += ranks.length > 1 ? 2200 : 1200;

    revealDone = () => {
      clearReveal();
      revealDone = null;
      rows.forEach(show);
      if (top > 0) {
        S.fanfare();
        Confetti.burst();
        revealTimers.push(setTimeout(() => Confetti.burst(160), 900));
      } else {
        S.reveal();
      }
      $('rs-actions').hidden = false;
      $('rs-hint').hidden = true;
    };
    revealTimers.push(setTimeout(() => revealDone && revealDone(), t));
  }

  /** Per-slot result of the Obstacle round for contestant c: 'correct' | 'wrong' | null (not played). */
  function obstacleMarks(ob, c) {
    return ob.rows.map((r) => (r.status === 'closed' ? null : r.correct.includes(c) ? 'correct' : 'wrong'));
  }

  const SLOT_HEADS = ['Hàng 1', 'Hàng 2', 'Hàng 3', 'Hàng 4', 'Trung tâm'];

  function finalRanking() {
    return E.rankScores(app.quiz.contestants.map((c) => c.name), resultsKind === 'final' ? totalScores(app.session) : E.scores(app.session, app.quiz));
  }

  function resultsTable() {
    const s = app.session;
    const nQ = settings().questionsPerContestant;
    const marks = { correct: ['✓', 'mark-correct', 'Đúng'], wrong: ['✗', 'mark-wrong', 'Sai'], skipped: ['–', 'mark-skipped', 'Bỏ qua'] };
    const markCell = (res) => {
      const [sym, cls, title] = marks[res] || ['', '', ''];
      return el('td', { class: cls, text: sym, title });
    };
    if (resultsKind === 'final') {
      const warm = E.scores(s, app.quiz);
      const ob = s.obstacle;
      const head = el('tr', {}, el('th', { text: 'Hạng' }), el('th', { text: 'Thí sinh' }), el('th', { text: 'Khởi động' }),
        SLOT_HEADS.map((h) => el('th', { text: h })), el('th', { text: 'Từ khóa' }), el('th', { text: 'Tổng' }));
      const body = finalRanking().map((r) =>
        el('tr', {}, el('td', { text: r.rank }), el('td', { text: r.name }), el('td', { text: warm[r.index] }),
          obstacleMarks(ob, r.index).map(markCell),
          el('td', ob.winner === r.index ? { class: 'mark-correct', text: '+' + ob.keywordPoints } : ob.eliminated[r.index] ? { class: 'mark-wrong', text: '✗', title: 'Trả lời sai' } : { text: '' }),
          el('td', { text: r.score, style: 'font-weight:800' }))
      );
      return el('table', { class: 'rs-table' }, el('thead', {}, head), el('tbody', {}, body));
    }
    const head = el('tr', {}, el('th', { text: 'Hạng' }), el('th', { text: 'Thí sinh' }),
      Array.from({ length: nQ }, (_, j) => el('th', { text: `Câu ${j + 1}` })), el('th', { text: 'Tổng' }));
    const body = finalRanking().map((r) =>
      el('tr', {}, el('td', { text: r.rank }), el('td', { text: r.name }),
        s.results[r.index].map(markCell),
        el('td', { text: r.score, style: 'font-weight:800' }))
    );
    return el('table', { class: 'rs-table' }, el('thead', {}, head), el('tbody', {}, body));
  }

  function exportResultsCsv() {
    const s = app.session;
    const nQ = settings().questionsPerContestant;
    const label = { correct: 'Đúng', wrong: 'Sai', skipped: 'Bỏ qua' };
    const warmHeads = Array.from({ length: nQ }, (_, j) => `Câu ${j + 1}`);
    let rows;
    if (resultsKind === 'final') {
      const warm = E.scores(s, app.quiz);
      const obScores = O.scores(s.obstacle, app.quiz);
      const ob = s.obstacle;
      rows = [['Hạng', 'Thí sinh', 'Tổng', 'Khởi động', 'Vượt chướng ngại vật', ...warmHeads, ...SLOT_HEADS, 'Từ khóa']];
      for (const r of finalRanking()) {
        const kw = ob.winner === r.index ? `Đúng (+${ob.keywordPoints})` : ob.eliminated[r.index] ? 'Sai' : '';
        rows.push([r.rank, r.name, r.score, warm[r.index], obScores[r.index],
          ...s.results[r.index].map((x) => label[x] || ''), ...obstacleMarks(ob, r.index).map((x) => label[x] || ''), kw]);
      }
    } else {
      rows = [['Hạng', 'Thí sinh', 'Điểm', ...warmHeads]];
      for (const r of finalRanking()) rows.push([r.rank, r.name, r.score, ...s.results[r.index].map((x) => label[x] || '')]);
    }
    const date = new Date().toISOString().slice(0, 10);
    const suffix = resultsKind !== 'final' && app.quiz.obstacle ? '-vong-1' : '';
    download(D.toCsv(rows), `ket-qua-${slug(settings().title)}${suffix}-${date}.csv`, 'text/csv;charset=utf-8');
  }

  function resultsBack() {
    const s = app.session;
    if (resultsKind === 'final') commit({ ...s, obstacle: O.back(s.obstacle) });
    else commit(E.back(s, app.quiz));
  }

  function bindResults() {
    $('rs-back').onclick = resultsBack;
    $('rs-next').onclick = goToObstacle;
    $('rs-table').onclick = () => {
      const w = $('rs-table-wrap');
      w.hidden = !w.hidden;
      if (!w.hidden) {
        w.replaceChildren(resultsTable());
        w.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    $('rs-export').onclick = exportResultsCsv;
    $('rs-replay').onclick = () => {
      if (!confirm('Thi lại từ đầu với cùng bộ câu hỏi? Kết quả hiện tại sẽ bị xoá.')) return;
      startRound(D.roundErrors(app.quiz, 'warmup').length && app.quiz.obstacle ? 'obstacle' : 'warmup', null);
    };
    $('rs-home').onclick = () => {
      toggleFullscreen(false);
      renderHome();
    };
    document.querySelectorAll('#screen-results [data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur();
        actions[b.dataset.act]();
      })
    );
  }

  /* =========================================================
     Keyboard
     ========================================================= */

  const PRESENT_KEYS = {
    Space: 'advance', ArrowRight: 'advance', PageDown: 'advance', Enter: 'advance', NumpadEnter: 'advance',
    ArrowLeft: 'back', PageUp: 'back', Backspace: 'back',
    KeyC: 'correct', KeyX: 'wrong', KeyS: 'skip', KeyU: 'undo',
    KeyT: 'pause', KeyR: 'reset', KeyF: 'fullscreen', KeyM: 'mute', KeyH: 'help', Slash: 'help',
  };
  const RESULTS_KEYS = {
    Space: 'reveal', ArrowRight: 'reveal', PageDown: 'reveal', Enter: 'reveal',
    ArrowLeft: 'back', PageUp: 'back', KeyF: 'fullscreen', KeyM: 'mute',
  };
  // Holding a key down must not race through several questions.
  const NO_REPEAT = new Set(['advance', 'back', 'correct', 'wrong', 'skip', 'undo', 'reset', 'pause', 'reveal']);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (!$('help').hidden) {
      if (['Escape', 'Slash', 'KeyH', 'Enter', 'Space'].includes(e.code)) {
        e.preventDefault();
        toggleHelp(false);
      }
      return;
    }
    if (app.screen === 'obstacle') {
      if (OB.handleKey(e)) e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ' && app.screen === 'present') {
        e.preventDefault();
        actions.undo();
      }
      return;
    }
    if (e.altKey) return;
    let name = null;
    if (app.screen === 'present') name = PRESENT_KEYS[e.code];
    else if (app.screen === 'results') name = RESULTS_KEYS[e.code];
    if (!name) return;
    e.preventDefault();
    if (e.repeat && NO_REPEAT.has(name)) return;
    if (name === 'reveal') {
      if (revealDone) revealDone();
      else if (hasNextRound() && e.code !== 'Enter') goToObstacle();
    } else if (app.screen === 'results' && name === 'back') {
      resultsBack();
    } else {
      actions[name]();
    }
  });

  /* =========================================================
     Init
     ========================================================= */

  // During the show, a clicked button must not keep focus, or Space would press it again.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && ['present', 'results', 'obstacle'].includes(app.screen)) b.blur();
  });

  $('help-close').onclick = () => toggleHelp(false);
  $('help').addEventListener('click', (e) => {
    if (e.target.id === 'help') toggleHelp(false);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitCard();
      OB.onResize();
    }, 120);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistSession();
  });
  window.addEventListener('pagehide', persistSession);

  OB = window.ObstacleUI({
    app,
    $,
    el,
    toast,
    setIcon,
    updateMuteButtons,
    buildTiles,
    updateTiles,
    totalScores,
    scoreDeltas,
    setFitText,
    fitText,
    imageCell,
    edited,
    commit,
    showScreen,
    persist: persistSession,
    refreshEditor: () => setTab(edTab),
    actions: {
      mute: toggleMute,
      fullscreen: () => toggleFullscreen(),
      help: () => toggleHelp(),
      exit: () => actions.exit(),
    },
  });

  bindHome();
  bindEditor();
  bindPresent();
  bindResults();
  document.querySelectorAll('[data-act="reset"]').forEach((b) => setIcon(b, 'reset'));
  document.querySelectorAll('[data-act="fullscreen"]').forEach((b) => setIcon(b, 'fullscreen'));
  updateMuteButtons();
  renderHome();
})();
