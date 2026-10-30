/*
 * Obstacle round UI ("Vượt chướng ngại vật"): presentation screen, row timer,
 * buzz dialog, mode-aware keyboard and the editor tab.
 * Rules live in obstacle.js; shared helpers (tiles, commit, sound, editor
 * plumbing) come from app.js through `ctx`.
 */
(function (root) {
  'use strict';

  root.ObstacleUI = function (ctx) {
    const O = root.ObstacleEngine;
    const D = root.QuizData;
    const S = root.Sound;
    const { $, el, toast } = ctx;
    const app = ctx.app;

    const st = () => app.session.obstacle;
    const quiz = () => app.quiz;
    const settings = () => app.quiz.settings;
    const names = () => app.quiz.contestants.map((c) => c.name);
    const slotItem = (i) => (i < O.ROWS ? quiz().obstacle.rows[i] : quiz().obstacle.center);
    const slotLabel = (i) => (i < O.ROWS ? `Hàng ngang ${i + 1}` : 'Câu hỏi trung tâm');
    const PLAYING = ['board', 'question', 'marking'];

    let built = false;
    let prevPhase = null; // phase at the previous render (null = first render after show)
    let cardSlot = null;
    let buzzing = null; // contestant index while the buzz dialog is open
    let resumeAfterBuzz = false;
    let finalTimers = [];

    /* =========================================================
       Commit helpers
       ========================================================= */

    function commit(next, withDeltas) {
      const before = ctx.totalScores(app.session);
      const session = { ...app.session, obstacle: next };
      const opts = withDeltas ? { deltas: ctx.scoreDeltas(before, ctx.totalScores(session)) } : {};
      ctx.commit(session, opts);
    }

    /** Copy the live timer into the state before an action that may need to restore it (undo). */
    function withTimer(state) {
      const s = { ...state };
      s.timer = s.phase === 'question' && tm.slot === s.active ? { slot: s.active, remainingMs: remaining() } : s.timer;
      return s;
    }

    /* =========================================================
       Build (once per show)
       ========================================================= */

    function boxRow(words, container) {
      const kids = [];
      let i = 0;
      words.forEach((w, wi) => {
        if (wi) kids.push(el('span', { class: 'box-gap' }));
        for (const ch of w) kids.push(el('span', { class: 'box', style: `--i:${i++}` }, el('span', { class: 'ch', text: ch })));
      });
      container.replaceChildren(...kids);
      return container;
    }

    function build() {
      const q = quiz();
      const ob = q.obstacle;
      $('ob-title').textContent = `${settings().title} · Vượt chướng ngại vật`;
      ctx.buildTiles($('ob-tiles'), openBuzz);

      const rows = [];
      for (let i = 0; i < O.SLOTS; i++) {
        const words = D.boxWords(slotItem(i));
        rows.push(
          el(
            'div',
            { class: 'ob-row' + (i === O.CENTER ? ' center-row' : ''), 'data-slot': i, onclick: () => pick(i) },
            el('div', { class: 'ob-row-num', text: i < O.ROWS ? i + 1 : '★' }),
            el('div', { class: 'ob-row-main' }, boxRow(words, el('div', { class: 'boxes' })), el('div', { class: 'ob-row-answer' })),
            el('div', { class: 'ob-row-state' })
          )
        );
      }
      $('ob-board').replaceChildren(...rows);

      const img = $('ob-img');
      img.src = ob.image;
      img.onerror = () => toast('Không tải được ảnh chướng ngại vật: ' + ob.image, 4000);

      const kw = D.letterize(ob.keyword);
      boxRow(kw, $('ob-kw-boxes'));
      $('ob-kw-label').textContent = `Chướng ngại vật · ${D.letterCount(kw)} chữ cái`;
      const st0 = settings();
      $('ob-intro-meta').textContent =
        `Từ khóa gồm ${D.letterCount(kw)} chữ cái · 4 hàng ngang + câu hỏi trung tâm · ${st0.obstacleSeconds} giây mỗi hàng · ` +
        `${st0.obstacleRowPoints} điểm mỗi hàng · giải từ khóa sớm được tới ${st0.keywordPoints[0]} điểm`;

      document.querySelectorAll('#screen-obstacle [data-ob="reset"]').forEach((b) => ctx.setIcon(b, 'reset'));
      document.querySelectorAll('#screen-obstacle [data-ob="fullscreen"]').forEach((b) => ctx.setIcon(b, 'fullscreen'));
      ctx.updateMuteButtons();
      built = true;
    }

    /** Box sizes depend on the longest answer and on the screen, so compute them in px. */
    function sizeLayout() {
      if (app.screen !== 'obstacle') return;
      const ob = quiz().obstacle;
      const slots = (words) => words.reduce((n, w) => n + w.length * 1.12, 0) + Math.max(0, words.length - 1) * 0.5;
      const main = document.querySelector('#ob-board .ob-row-main');
      if (main) {
        const widest = Math.max(...Array.from({ length: O.SLOTS }, (_, i) => slots(D.boxWords(slotItem(i)))));
        const bx = Math.min(innerHeight * 0.062, main.clientWidth / widest);
        document.querySelector('.ob-left').style.setProperty('--bx', Math.floor(bx) + 'px');
      }
      // Image keeps 4:3 inside whatever space the right column has.
      const right = document.querySelector('.ob-right');
      const kwBox = document.querySelector('.ob-keyword');
      const availH = right.clientHeight - kwBox.offsetHeight - parseFloat(getComputedStyle(right).rowGap || 0);
      const w = Math.max(100, Math.min(right.clientWidth, availH * (4 / 3)));
      const image = $('ob-image');
      image.style.width = w + 'px';
      image.style.height = w * 0.75 + 'px';
      const kbx = Math.min(innerHeight * 0.075, right.clientWidth / slots(D.letterize(ob.keyword)));
      $('ob-kw-boxes').style.setProperty('--bx', Math.floor(kbx) + 'px');
      fitQuestion();
    }

    function fitQuestion() {
      const box = $('ob-q');
      if (!$('ob-card').hidden) ctx.fitText(box, innerHeight * 0.07, innerHeight * 0.026);
    }

    /* =========================================================
       Render
       ========================================================= */

    function show() {
      ctx.showScreen('obstacle');
      build();
      prevPhase = null;
      cardSlot = null;
      tm.slot = undefined; // force the timer to resync from the saved snapshot
      render();
      requestAnimationFrame(sizeLayout);
    }

    function render(opts = {}) {
      if (!built) build();
      const s = st();
      if (s.phase !== 'final') clearFinalTimers();
      $('screen-obstacle').classList.toggle('mode-is-board', s.phase === 'board' && buzzing == null);
      ctx.updateTiles($('ob-tiles'), ctx.totalScores(app.session), -1, opts.deltas);
      [...$('ob-tiles').children].forEach((tile, c) => {
        const b = tile.querySelector('.tile-buzz');
        tile.classList.toggle('no-buzz', s.eliminated[c]);
        b.disabled = !O.canBuzz(s, c);
        b.title = s.eliminated[c] ? 'Đã mất quyền trả lời chướng ngại vật' : `Bấm chuông trả lời chướng ngại vật (Shift+${c + 1})`;
      });
      $('ob-intro').hidden = s.phase !== 'intro';
      renderMode();
      renderBoard();
      renderCard();
      renderImageAndKeyword();
      renderControls();
      syncTimer();
      prevPhase = s.phase;
    }

    function renderMode() {
      const s = st();
      const m = $('ob-mode');
      const n = quiz().contestants.length;
      let cls = '';
      let name = '';
      let hint = '';
      if (buzzing != null) {
        cls = 'mode-buzz';
        name = `Chuông · ${quiz().contestants[buzzing].name}`;
        hint = 'trả lời chướng ngại vật · C đúng · X sai · ← huỷ';
      } else if (s.phase === 'board') {
        cls = 'mode-board';
        name = 'Chọn hàng ngang';
        if (s.rows[O.CENTER].status !== 'closed') {
          name = 'Hết câu hỏi';
          hint = 'Chờ thí sinh bấm chuông · K: mở chướng ngại vật';
        }
        else if (s.rows[O.CENTER].status === 'closed' && O.centerUnlocked(s)) hint = 'Phím 5: câu hỏi trung tâm';
        else hint = 'Phím 1–4 chọn hàng ngang';
      } else if (s.phase === 'question') {
        cls = 'mode-question';
        name = 'Đang trả lời';
        hint = 'Space: hiện đáp án · ←: về bảng';
      } else if (s.phase === 'marking') {
        cls = 'mode-mark';
        name = 'Chấm điểm';
        hint = `Phím 1–${n}: đánh dấu thí sinh trả lời đúng · Enter: xác nhận`;
      } else if (s.phase === 'final') {
        cls = 'mode-final';
        name = 'Đã mở chướng ngại vật';
        hint = 'Space: xem kết quả';
      }
      m.hidden = !cls;
      m.className = 'mode-badge ' + cls;
      m.replaceChildren(el('span', { class: 'mode-name', text: name }), el('span', { class: 'mode-hint', text: hint }));
    }

    /**
     * Fill a box row. Rows already filled when the screen is first drawn (resume,
     * back from results) appear at once instead of replaying the flip-in.
     */
    function setFilled(boxes, filled) {
      if (filled && prevPhase === null) boxes.classList.add('static');
      if (!filled) boxes.classList.remove('static');
      boxes.classList.toggle('filled', filled);
    }

    function renderBoard() {
      const s = st();
      const ended = s.phase === 'final' || s.phase === 'results';
      [...$('ob-board').children].forEach((row, i) => {
        const r = s.rows[i];
        const active = s.active === i && (s.phase === 'question' || s.phase === 'marking');
        const filled = r.status !== 'closed' || (active && s.phase === 'marking') || ended;
        const locked = i === O.CENTER && r.status === 'closed' && !O.centerUnlocked(s) && !ended;
        row.classList.toggle('solved', r.status === 'solved');
        row.classList.toggle('failed', r.status === 'failed');
        row.classList.toggle('unplayed', ended && r.status === 'closed');
        row.classList.toggle('active', active);
        row.classList.toggle('locked', locked);
        row.classList.toggle('pickable', O.canPick(s, i));
        setFilled(row.querySelector('.boxes'), filled);
        row.querySelector('.ob-row-answer').textContent = filled ? slotItem(i).answer : '';
        const words = D.boxWords(slotItem(i));
        let state = `${D.letterCount(words)} chữ`;
        if (r.status === 'solved') state = `✓ ${r.correct.length} đúng`;
        else if (r.status === 'failed') state = '✗ Không ai đúng';
        else if (locked) state = 'Mở sau 4 hàng';
        else if (active) state = s.phase === 'marking' ? 'Đang chấm' : 'Đang trả lời';
        row.querySelector('.ob-row-state').textContent = state;
      });
    }

    function renderCard() {
      const s = st();
      const card = $('ob-card');
      const showing = s.phase === 'question' || s.phase === 'marking';
      card.hidden = !showing;
      if (!showing) {
        cardSlot = null;
        return;
      }
      const i = s.active;
      const item = slotItem(i);
      const words = D.boxWords(item);
      if (cardSlot !== i) {
        cardSlot = i;
        $('ob-card-label').textContent = slotLabel(i);
        $('ob-card-meta').textContent = `${D.letterCount(words)} chữ cái · ${settings().obstacleRowPoints} điểm cho mỗi thí sinh trả lời đúng`;
        ctx.setFitText($('ob-q'), item.question);
        boxRow(words, $('ob-card-boxes'));
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('enter');
      }
      const marking = s.phase === 'marking';
      card.classList.toggle('marking', marking);
      $('ob-card-boxes').classList.toggle('filled', marking);
      $('ob-answer').hidden = !marking;
      $('ob-answer').textContent = item.answer;
      $('ob-timer').hidden = marking;
      const marks = $('ob-marks');
      marks.hidden = !marking;
      if (marking) {
        marks.replaceChildren(
          ...quiz().contestants.map((c, ci) =>
            el(
              'button',
              { class: 'mark-btn' + (s.marks[ci] ? ' on' : ''), type: 'button', onclick: () => toggle(ci) },
              el('kbd', { text: ci + 1 }),
              el('span', { class: 'mark-name', text: c.name }),
              el('span', { class: 'mk', 'aria-hidden': 'true' })
            )
          )
        );
      }
      requestAnimationFrame(fitQuestion);
    }

    function clearFinalTimers() {
      finalTimers.forEach(clearTimeout);
      finalTimers = [];
    }

    function renderImageAndKeyword() {
      const s = st();
      const first = prevPhase === null;
      const enteringFinal = !first && prevPhase !== 'final' && s.phase === 'final';
      const image = $('ob-image');
      if (first) image.classList.add('instant');

      // Pieces: corners/center open as rows are solved; everything opens at the end.
      let k = 0;
      document.querySelectorAll('#ob-image .ob-piece').forEach((p) => {
        const i = +p.dataset.piece;
        const open = O.pieceOpen(s, i);
        const failed = s.rows[i].status === 'failed';
        const wasOpen = p.classList.contains('open');
        p.style.transitionDelay = enteringFinal && open && !wasOpen ? k++ * 350 + 'ms' : '0ms';
        if (!first && open && !wasOpen && !enteringFinal) S.open();
        p.classList.toggle('open', open);
        p.classList.toggle('failed', failed && !open);
        p.querySelector('span').textContent = failed ? '✗' : i < O.ROWS ? i + 1 : '★';
      });
      if (first) {
        void image.offsetWidth;
        image.classList.remove('instant');
      }

      // Keyword letters fill in after the pieces have opened.
      const ended = s.phase === 'final' || s.phase === 'results';
      const kwBoxes = $('ob-kw-boxes');
      const base = enteringFinal ? k * 350 + 500 : 0;
      kwBoxes.style.setProperty('--base', base + 'ms');
      kwBoxes.style.setProperty('--step', enteringFinal ? '110ms' : '0ms');
      setFilled(kwBoxes, ended);
      const result = $('ob-kw-result');
      result.hidden = !ended;
      if (ended) {
        const ob = quiz().obstacle;
        const letters = D.letterCount(D.letterize(ob.keyword));
        const doneAt = base + (enteringFinal ? letters * 110 + 300 : 0);
        result.style.setProperty('--base', doneAt + 'ms');
        result.replaceChildren(
          s.winner != null
            ? el('span', {}, '★ ', el('b', { text: quiz().contestants[s.winner].name }), ` giải được chướng ngại vật `, el('span', { class: 'kw-word', text: ob.keyword }), el('span', { class: 'kw-pts', text: ` +${s.keywordPoints}` }))
            : el('span', {}, 'Chướng ngại vật là ', el('span', { class: 'kw-word', text: ob.keyword }), ' — không ai giải được')
        );
        if (enteringFinal) {
          for (let i = 0; i < letters; i++) finalTimers.push(setTimeout(() => S.pop(), base + i * 110));
          finalTimers.push(
            setTimeout(() => {
              if (s.winner != null) {
                S.fanfare();
                root.Confetti.burst();
              } else S.reveal();
            }, doneAt)
          );
        }
      }
    }

    function renderControls() {
      const s = st();
      const vis = (name, show, disabled = false) => {
        const b = document.querySelector(`#screen-obstacle [data-ob="${name}"]`);
        b.hidden = !show;
        b.disabled = disabled;
      };
      vis('cancel', s.phase === 'question');
      vis('start', s.phase === 'intro');
      vis('reveal', s.phase === 'question');
      vis('confirm', s.phase === 'marking');
      vis('keyword', PLAYING.includes(s.phase));
      vis('finish', s.phase === 'final');
      vis('undo', true, !s.history.length || s.phase === 'intro');
      vis('pause', true, s.phase !== 'question');
      vis('reset', true, s.phase !== 'question');
    }

    /* =========================================================
       Row timer
       ========================================================= */

    const tm = { slot: null, totalMs: 0, remainingMs: 0, deadline: 0, running: false, handle: 0, lastWhole: 0 };

    function remaining() {
      return tm.running ? Math.max(0, tm.deadline - performance.now()) : tm.remainingMs;
    }

    function syncTimer() {
      const s = st();
      if (s.phase !== 'question') {
        stopLoop();
        tm.slot = null;
        renderTimer();
        return;
      }
      if (tm.slot !== s.active) {
        stopLoop();
        tm.slot = s.active;
        tm.totalMs = settings().obstacleSeconds * 1000;
        const snap = s.timer && s.timer.slot === s.active ? s.timer : null;
        // Restored (refresh / undo) → paused at the saved time; teacher presses T.
        tm.remainingMs = snap ? snap.remainingMs : tm.totalMs;
        tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
        if (!snap) startLoop();
      }
      renderTimer();
    }

    function startLoop() {
      tm.running = true;
      tm.deadline = performance.now() + tm.remainingMs;
      clearInterval(tm.handle);
      tm.handle = setInterval(onTick, 100);
    }

    function stopLoop() {
      clearInterval(tm.handle);
      tm.handle = 0;
      if (tm.running) tm.remainingMs = remaining();
      tm.running = false;
    }

    function onTick() {
      const rem = remaining();
      if (rem <= 0) {
        stopLoop();
        tm.remainingMs = 0;
        S.buzzer();
        toast('Hết giờ! Nhấn Space để hiện đáp án.', 2600);
        ctx.persist();
        renderTimer();
        return;
      }
      const whole = Math.ceil(rem / 1000);
      if (whole !== tm.lastWhole) {
        tm.lastWhole = whole;
        S.tick(whole <= 5);
        ctx.persist();
      }
      renderTimer();
    }

    const RING = 2 * Math.PI * 52;

    function renderTimer() {
      const s = st();
      const inQ = s.phase === 'question' && tm.slot === s.active;
      const rem = inQ ? remaining() : 0;
      const frac = inQ ? rem / tm.totalMs : 0;
      const box = $('ob-timer');
      $('ob-timer-num').textContent = inQ ? Math.ceil(rem / 1000) : settings().obstacleSeconds;
      let label = 'giây';
      if (inQ && rem <= 0) label = 'Hết giờ';
      else if (inQ && !tm.running) label = 'Tạm dừng';
      $('ob-timer-label').textContent = label;
      $('ob-timer-ring').style.strokeDashoffset = RING * (1 - frac);
      $('ob-timer-ring').style.opacity = frac > 0 ? 1 : 0;
      box.className = 'timer timer-sm';
      if (inQ && rem <= 0) box.classList.add('timeout');
      else if (inQ && !tm.running) box.classList.add('paused');
      else if (inQ && rem <= 5000) box.classList.add('urgent');
      ctx.setIcon($('ob-btn-pause'), tm.running ? 'pause' : 'play');
    }

    /** Called by app.persistSession() so a refresh resumes the row timer where it was. */
    function persistTimer(session) {
      const s = session.obstacle;
      if (!s) return;
      if (s.phase === 'question' && tm.slot === s.active) s.timer = { slot: s.active, remainingMs: remaining() };
      else if (s.phase !== 'question') s.timer = null;
    }

    /* =========================================================
       Buzz (keyword guess)
       ========================================================= */

    function openBuzz(c) {
      const s = st();
      const ct = quiz().contestants[c];
      if (!ct) return;
      if (!O.canBuzz(s, c)) {
        if (s.eliminated[c]) toast(`${ct.name} đã mất quyền trả lời chướng ngại vật.`);
        else if (s.phase === 'intro') toast('Hãy bắt đầu vòng thi trước (Space).');
        return;
      }
      buzzing = c;
      resumeAfterBuzz = tm.running;
      if (tm.running) {
        stopLoop();
        renderTimer();
      }
      S.bell();
      $('buzz-name').textContent = ct.name;
      $('buzz-value').textContent = `Nếu đúng: +${O.keywordValue(s, quiz())} điểm · Nếu sai: mất quyền trả lời chướng ngại vật (không bị trừ điểm)`;
      $('buzz').hidden = false;
      render();
    }

    function closeBuzz(resume) {
      $('buzz').hidden = true;
      buzzing = null;
      if (resume && resumeAfterBuzz && st().phase === 'question' && remaining() > 0) startLoop();
      resumeAfterBuzz = false;
    }

    function buzzCorrect() {
      const c = buzzing;
      const s = withTimer(st());
      closeBuzz(false);
      stopLoop();
      S.correct();
      commit(O.buzzCorrect(s, quiz(), c), true);
    }

    function buzzWrong() {
      const c = buzzing;
      closeBuzz(true);
      S.wrong();
      const next = O.buzzWrong(st(), c);
      commit(next);
      const left = next.eliminated.filter((x) => !x).length;
      toast(
        left
          ? `${quiz().contestants[c].name} trả lời sai — mất quyền trả lời chướng ngại vật.`
          : 'Tất cả thí sinh đã mất quyền trả lời — nhấn K để mở chướng ngại vật.',
        3200
      );
    }

    /* =========================================================
       Actions
       ========================================================= */

    function pick(i) {
      const s = st();
      if (s.phase !== 'board') return;
      if (i >= O.SLOTS) return;
      if (!O.canPick(s, i)) {
        if (i === O.CENTER && !O.centerUnlocked(s)) toast('Câu hỏi trung tâm mở sau khi chơi xong 4 hàng ngang.');
        else toast(`${slotLabel(i)} đã chơi xong.`);
        return;
      }
      S.reveal();
      commit(O.pickRow(s, i));
    }

    function toggle(c) {
      const s = st();
      if (s.phase !== 'marking' || c >= quiz().contestants.length) return;
      S.tick(false);
      commit(O.toggleMark(s, c));
    }

    function confirmRow() {
      const s = st();
      if (s.phase !== 'marking') return;
      const i = s.active;
      const next = O.confirmRow(s);
      const k = next.rows[i].correct.length;
      if (k) S.correct();
      else S.wrong();
      commit(next, true);
      const piece = i < O.ROWS ? `góc ảnh số ${i + 1}` : 'ô trung tâm';
      toast(k ? `${slotLabel(i)}: ${k} thí sinh trả lời đúng — mở ${piece}.` : `${slotLabel(i)}: không ai trả lời đúng.`, 2800);
    }

    const actions = {
      advance() {
        const s = st();
        if (s.phase === 'intro') commit(O.start(s));
        else if (s.phase === 'board') toast(O.centerUnlocked(s) && s.rows[O.CENTER].status === 'closed' ? 'Nhấn 5 để chơi câu hỏi trung tâm.' : 'Chọn hàng ngang bằng phím 1–4 hoặc bấm vào hàng.');
        else if (s.phase === 'question') {
          S.flip();
          stopLoop();
          commit(O.reveal(s));
        } else if (s.phase === 'marking') toast('Đánh dấu thí sinh trả lời đúng rồi nhấn Enter để xác nhận.');
        else if (s.phase === 'final') commit(O.finish(s));
      },
      start() {
        actions.advance();
      },
      reveal() {
        actions.advance();
      },
      finish() {
        actions.advance();
      },
      confirm: confirmRow,
      cancel() {
        const s = st();
        if (s.phase === 'question') {
          stopLoop();
          commit(O.cancelRow(s));
          toast('Đã về bảng hàng ngang.', 1400);
        } else if (s.phase === 'intro' && app.session.phase === 'results') {
          // Back to the Warm-up results if round 2 hasn't started yet.
          ctx.commit({ ...app.session, round: 'warmup' });
        }
      },
      keyword() {
        const s = st();
        if (!PLAYING.includes(s.phase)) return;
        if (s.rows[O.CENTER].status === 'closed' && !confirm('Chưa chơi hết các câu hỏi. Mở chướng ngại vật ngay (không ai được điểm từ khóa)?')) return;
        stopLoop();
        commit(O.revealKeyword(withTimer(s)));
      },
      undo() {
        const s = st();
        if (s.phase === 'intro' || s.phase === 'results') return;
        const r = O.undo(withTimer(s));
        if (!r.undone) {
          toast('Không có gì để hoàn tác.', 1500);
          return;
        }
        const a = r.undone;
        const msg = {
          row: () => `Đã hoàn tác chấm ${slotLabel(a.index).toLowerCase()} — hãy chấm lại.`,
          eliminate: () => `${quiz().contestants[a.c].name} được trả lại quyền trả lời chướng ngại vật.`,
          keyword: () => (a.winner != null ? `Đã hoàn tác: ${quiz().contestants[a.winner].name} chưa giải chướng ngại vật.` : 'Đã đóng lại chướng ngại vật.'),
        }[a.type]();
        stopLoop();
        tm.slot = undefined; // resume from the restored snapshot
        commit(r.state, true);
        toast(msg, 2600);
      },
      pause() {
        const s = st();
        if (s.phase !== 'question') return;
        if (tm.running) stopLoop();
        else if (remaining() > 0) startLoop();
        ctx.persist();
        renderTimer();
      },
      reset() {
        const s = st();
        if (s.phase !== 'question') return;
        stopLoop();
        tm.remainingMs = tm.totalMs;
        tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
        startLoop();
        ctx.persist();
        renderTimer();
        toast('Đã đặt lại đồng hồ.', 1400);
      },
      mute: () => ctx.actions.mute(),
      fullscreen: () => ctx.actions.fullscreen(),
      help: () => ctx.actions.help(),
      exit: () => ctx.actions.exit(),
    };

    /* =========================================================
       Keyboard — number keys mean different things by mode,
       and only one thing at a time (shown in the mode badge).
       ========================================================= */

    const KEYS = {
      Space: 'advance', ArrowRight: 'advance', PageDown: 'advance',
      ArrowLeft: 'cancel', PageUp: 'cancel', Backspace: 'cancel', Escape: 'cancel',
      KeyK: 'keyword', KeyU: 'undo', KeyT: 'pause', KeyR: 'reset',
      KeyF: 'fullscreen', KeyM: 'mute', KeyH: 'help', Slash: 'help',
    };
    const REPEATABLE = new Set(['fullscreen', 'mute', 'help']);

    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        if (buzzing == null) actions.undo();
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const code = e.code;

      if (buzzing != null) {
        // While a contestant is answering the keyword only the verdict keys work.
        if (e.repeat) return true;
        if (code === 'KeyC') buzzCorrect();
        else if (code === 'KeyX') buzzWrong();
        else if (code === 'Escape' || code === 'ArrowLeft' || code === 'Backspace') {
          // ← is the documented key: in fullscreen the browser keeps Esc for itself.
          closeBuzz(true);
          render();
        } else if (code === 'KeyF' || code === 'KeyM') actions[KEYS[code]]();
        return true;
      }

      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        if (e.repeat) return true;
        const n = +digit[1] - 1;
        const s = st();
        if (e.shiftKey) openBuzz(n);
        else if (s.phase === 'board') pick(n);
        else if (s.phase === 'marking') toggle(n);
        else if (s.phase === 'question') toast('Đang trả lời — nhấn Space để hiện đáp án trước khi chấm.', 2000);
        return true;
      }

      if (code === 'Enter' || code === 'NumpadEnter') {
        if (!e.repeat) {
          if (st().phase === 'marking') confirmRow();
          else actions.advance();
        }
        return true;
      }

      const name = KEYS[code];
      if (!name) return false;
      if (e.repeat && !REPEATABLE.has(name)) return true;
      actions[name]();
      return true;
    }

    /* =========================================================
       Editor tab
       ========================================================= */

    function renderEditorPane(pane) {
      const q = quiz();
      if (!q.obstacle) {
        pane.replaceChildren(
          el(
            'div',
            { class: 'panel ob-ed-empty' },
            el('h3', { text: 'Bộ câu hỏi này chưa có vòng Vượt chướng ngại vật' }),
            el('p', { class: 'muted', text: 'Vòng 2 gồm một từ khóa bí mật, một ảnh được che bởi 5 mảnh, 4 hàng ngang và 1 câu hỏi trung tâm. Điểm vòng 1 được cộng dồn sang vòng 2.' }),
            el(
              'div',
              { class: 'row center' },
              el('button', { class: 'btn btn-primary', type: 'button', text: '+ Tạo vòng 2', onclick: () => setObstacle(D.emptyObstacle()) }),
              el('button', { class: 'btn btn-ghost', type: 'button', text: 'Dùng ví dụ mẫu (Hải đăng)', onclick: () => setObstacle(D.sampleObstacle()) })
            )
          )
        );
        return;
      }
      const ob = q.obstacle;
      const stg = q.settings;

      const numInput = (value, limits, onSet) =>
        el('input', {
          class: 'ed-input',
          type: 'number',
          min: limits[0],
          max: limits[1],
          value,
          onchange: (e) => {
            const v = D.clampInt(e.target.value, limits, value);
            e.target.value = v;
            onSet(v);
            ctx.edited(false);
          },
        });

      const preview = (getItem) => {
        const boxes = el('div', { class: 'boxes mini filled' });
        const count = el('span', { class: 'muted small' });
        const update = () => {
          const words = D.boxWords(getItem());
          boxRow(words, boxes);
          count.textContent = words.length ? `${D.letterCount(words)} chữ cái` : 'chưa có chữ cái';
        };
        update();
        return { node: el('div', { class: 'ob-ed-preview' }, boxes, count), update };
      };

      const settingsPanel = el(
        'div',
        { class: 'panel ob-ed-settings' },
        el('label', { class: 'field' }, el('span', { text: 'Số giây mỗi hàng ngang' }), numInput(stg.obstacleSeconds, D.LIMITS.obstacleSeconds, (v) => (stg.obstacleSeconds = v))),
        el('label', { class: 'field' }, el('span', { text: 'Điểm mỗi hàng ngang (mỗi thí sinh đúng)' }), numInput(stg.obstacleRowPoints, D.LIMITS.obstacleRowPoints, (v) => (stg.obstacleRowPoints = v))),
        el(
          'div',
          { class: 'field field-wide' },
          el('span', { text: 'Điểm khi giải được chướng ngại vật' }),
          el(
            'div',
            { class: 'kp-grid' },
            D.KEYWORD_STAGES.map((label, i) =>
              el('label', { class: 'kp' }, el('span', { text: label }), numInput(stg.keywordPoints[i], D.LIMITS.keywordPoint, (v) => (stg.keywordPoints[i] = v)))
            )
          )
        ),
        el(
          'div',
          { class: 'row ob-ed-remove' },
          el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Xoá vòng 2',
            onclick: () => {
              if (confirm('Xoá toàn bộ vòng Vượt chướng ngại vật?')) setObstacle(null);
            },
          })
        )
      );

      const kwPreview = preview(() => ({ answer: ob.keyword }));
      const keywordPanel = el(
        'div',
        { class: 'panel ob-ed-keyword' },
        el(
          'div',
          { class: 'ob-ed-kw-main' },
          el(
            'label',
            { class: 'field' },
            el('span', { text: 'Từ khóa (chướng ngại vật)' }),
            el('input', {
              class: 'ed-input ob-ed-kw-input',
              type: 'text',
              value: ob.keyword,
              placeholder: 'Ví dụ: Hải đăng',
              maxlength: 40,
              oninput: (e) => {
                ob.keyword = e.target.value;
                kwPreview.update();
                ctx.edited(false);
              },
            })
          ),
          kwPreview.node,
          el('p', { class: 'muted small', text: 'Ô chữ hiện chữ in hoa không dấu, không tính khoảng trắng.' })
        ),
        el('div', { class: 'ob-ed-image' }, el('div', { class: 'field' }, el('span', { text: 'Ảnh bị che (4 góc + ô giữa)' })), ctx.imageCell(ob))
      );

      const rowsPanel = el(
        'div',
        { class: 'panel ob-ed-rows' },
        el('div', { class: 'ob-ed-row ob-ed-head' }, el('div'), el('div', { class: 'ed-q-head', text: 'Câu hỏi' }), el('div', { class: 'ed-q-head', text: 'Đáp án' }), el('div', { class: 'ed-q-head', text: 'Ô chữ (tùy chọn)' })),
        Array.from({ length: O.SLOTS }, (_, i) => {
          const item = i < O.ROWS ? ob.rows[i] : ob.center;
          const pv = preview(() => item);
          const field = (key, tag, placeholder) =>
            el(tag, {
              class: tag === 'input' ? 'ed-input' : null,
              type: tag === 'input' ? 'text' : null,
              rows: tag === 'textarea' ? 2 : null,
              value: item[key],
              placeholder,
              'aria-label': `${slotLabel(i)} — ${placeholder}`,
              oninput: (e) => {
                item[key] = e.target.value;
                pv.update();
                ctx.edited(false);
              },
            });
          return el(
            'div',
            { class: 'ob-ed-row' },
            el('div', { class: 'ob-ed-label', text: i < O.ROWS ? `Hàng ${i + 1}` : 'Trung tâm' }),
            field('question', 'textarea', 'Câu hỏi'),
            field('answer', 'input', 'Đáp án'),
            el('input', {
              class: 'ed-input ed-optional',
              type: 'text',
              value: item.boxes,
              placeholder: 'Mặc định theo đáp án',
              'aria-label': `${slotLabel(i)} — ô chữ hiển thị`,
              oninput: (e) => {
                item.boxes = e.target.value;
                pv.update();
                ctx.edited(false);
              },
            }),
            pv.node
          );
        })
      );

      pane.replaceChildren(settingsPanel, keywordPanel, rowsPanel);
    }

    function setObstacle(ob) {
      quiz().obstacle = ob;
      ctx.edited(false);
      ctx.refreshEditor();
    }

    /* ========================================================= */

    function leave() {
      stopLoop();
      clearFinalTimers();
      if (buzzing != null) closeBuzz(false);
      built = false;
    }

    function bind() {
      document.querySelectorAll('#screen-obstacle [data-ob]').forEach((b) =>
        b.addEventListener('click', () => {
          b.blur();
          actions[b.dataset.ob]();
        })
      );
      $('buzz-correct').onclick = buzzCorrect;
      $('buzz-wrong').onclick = buzzWrong;
      $('buzz-cancel').onclick = () => {
        closeBuzz(true);
        render();
      };
      let idleTimer = 0;
      const screen = $('screen-obstacle');
      screen.addEventListener('mousemove', () => {
        screen.classList.remove('idle-cursor');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => screen.classList.add('idle-cursor'), 3000);
      });
    }
    bind();

    return {
      show,
      render,
      leave,
      handleKey,
      persistTimer,
      renderEditorPane,
      onResize: sizeLayout,
      reset() {
        tm.slot = undefined;
        stopLoop();
      },
    };
  };
})(window);
