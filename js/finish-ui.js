/*
 * Finish round UI ("Về đích"): package picker, question card, question and steal
 * clocks, steal dialog, mode-aware keyboard and the editor tab.
 * Rules live in finish.js; shared helpers (tiles, commit, sound, editor
 * plumbing) come from app.js through `ctx`.
 */
(function (root) {
  'use strict';

  root.FinishUI = function (ctx) {
    const F = root.FinishEngine;
    const D = root.QuizData;
    const S = root.Sound;
    const { $, el, toast } = ctx;
    const app = ctx.app;

    const st = () => app.session.finish;
    const quiz = () => app.quiz;
    const settings = () => app.quiz.settings;
    const nameOf = (c) => quiz().contestants[c].name;
    const slotOf = (c, q) => quiz().finish.turns[c].slots[q];
    const nC = () => quiz().contestants.length;
    const ON_CARD = ['ready', 'question', 'steal', 'stealing', 'settled'];
    const kbd = (text) => el('kbd', { text });

    let built = false;
    let cardKey = null; // question currently drawn on the card

    /* =========================================================
       Commit helpers
       ========================================================= */

    function commit(next, withDeltas) {
      const before = ctx.totalScores(app.session);
      const session = { ...app.session, finish: next };
      const opts = withDeltas ? { deltas: ctx.scoreDeltas(before, ctx.totalScores(session)) } : {};
      ctx.commit(session, opts);
    }

    /** Which clock the phase runs: the question's, the steal window's, or none. */
    function timerKey(s) {
      if (s.phase === 'question') return `q:${s.c}:${s.q}`;
      if (s.phase === 'steal') return `s:${s.c}:${s.q}`;
      return null;
    }

    /** Copy the live clock into the state before an action that may need to restore it (undo). */
    function withTimer(state) {
      const s = { ...state };
      const key = timerKey(s);
      if (key && tm.key === key) s.timer = { key, remainingMs: remaining() };
      return s;
    }

    /* =========================================================
       Build (once per show)
       ========================================================= */

    function build() {
      const stg = settings();
      const [p0, p1] = stg.finishPoints;
      $('fi-title').textContent = `${stg.title} · Về đích`;
      const tiles = $('fi-tiles');
      ctx.buildTiles(tiles, null);
      tiles.onclick = (e) => {
        const tile = e.target.closest('.tile');
        if (tile && st().phase === 'steal') pick([...tiles.children].indexOf(tile));
      };
      $('fi-intro-meta').textContent =
        `Mỗi thí sinh 3 câu, chọn ${p0} hoặc ${p1} điểm (${stg.finishSeconds[0]} / ${stg.finishSeconds[1]} giây) · ` +
        `Ngôi sao hy vọng: đúng ×2, sai bị trừ · trả lời sai thì các bạn khác có ${stg.finishStealSeconds} giây để cướp điểm`;
      ctx.setIcon(document.querySelector('#screen-finish [data-fi="reset"]'), 'reset');
      ctx.setIcon(document.querySelector('#screen-finish [data-fi="fullscreen"]'), 'fullscreen');
      ctx.updateMuteButtons();
      built = true;
    }

    function fitQuestion() {
      const box = $('fi-q');
      const span = box.firstElementChild;
      if ($('fi-card').hidden || box.hidden || !span) return;
      span.style.webkitLineClamp = '';
      ctx.fitText(box, innerHeight * 0.075, innerHeight * 0.024);
      if (span.offsetHeight > box.clientHeight) {
        // Even the smallest size doesn't fit next to the answer and the steal panel: cut with … at the lines that fit.
        const line = parseFloat(getComputedStyle(span).lineHeight) || 1;
        span.style.webkitLineClamp = Math.max(1, Math.floor(box.clientHeight / line));
      }
    }

    function sizeLayout() {
      if (app.screen !== 'finish') return;
      fitQuestion();
      const names = [...document.querySelectorAll('#fi-steal .mark-name')];
      if (names.length) ctx.fitNames(names);
    }

    /* =========================================================
       Render
       ========================================================= */

    function show() {
      ctx.showScreen('finish');
      build();
      cardKey = null;
      tm.key = undefined; // force the clock to resync from the saved snapshot
      render();
      requestAnimationFrame(sizeLayout);
    }

    function render(opts = {}) {
      if (!built) build();
      const s = st();
      $('fi-intro').hidden = s.phase !== 'intro';
      renderTurn();
      renderCard();
      syncTimer();
      renderTiles(opts.deltas);
      renderSlots();
      renderMode();
      renderControls();
      renderStealDialog();
    }

    function renderTiles(deltas) {
      const s = st();
      const playing = s.phase !== 'intro' && s.phase !== 'results';
      const tiles = $('fi-tiles');
      ctx.updateTiles(tiles, ctx.totalScores(app.session), playing ? s.c : -1, deltas);
      const stealing = s.phase === 'steal';
      [...tiles.children].forEach((tile, c) => {
        tile.classList.toggle('fi-can-steal', stealing && c !== s.c);
        tile.title = stealing && c !== s.c ? `${nameOf(c)} cướp điểm — phím ${c + 1}` : nameOf(c);
      });
    }

    function renderMode() {
      const s = st();
      const m = $('fi-mode');
      const r = ON_CARD.includes(s.phase) ? s.results[s.c][s.q] : null;
      let cls = '';
      let name = '';
      let hint = '';
      if (s.phase === 'turn') {
        cls = 'mode-board';
        name = 'Chọn gói câu hỏi';
        hint = 'Phím 1–3: đổi 20/30 · Shift+số: ngôi sao · Space: bắt đầu';
      } else if (s.phase === 'ready') {
        cls = 'mode-question';
        name = `Chuẩn bị câu ${s.q + 1}`;
        hint = 'S: Ngôi sao hy vọng · Space: hiện câu hỏi';
      } else if (s.phase === 'question') {
        cls = 'mode-mark';
        name = r.revealed ? 'Đã hiện đáp án' : 'Đang trả lời';
        hint = r.revealed ? 'C đúng · X sai (không còn cướp điểm)' : 'C đúng · X sai · Space: hiện đáp án';
      } else if (s.phase === 'steal') {
        cls = 'mode-buzz';
        name = 'Cướp điểm';
        hint = `Phím 1–${nC()} hoặc bấm tên người giơ tay đầu tiên · Space: không ai`;
      } else if (s.phase === 'stealing') {
        cls = 'mode-buzz';
        name = `Cướp điểm · ${nameOf(r.stealer)}`;
        hint = 'C đúng · X sai · ← huỷ';
      } else if (s.phase === 'settled') {
        cls = 'mode-final';
        name = 'Đã chấm';
        hint = `Space: ${nextLabel(s).toLowerCase()}`;
      }
      m.hidden = !cls;
      m.className = 'mode-badge ' + cls;
      m.replaceChildren(el('span', { class: 'mode-name', text: name }), el('span', { class: 'mode-hint', text: hint }));
    }

    function nextLabel(s) {
      if (F.isLast(s)) return 'Xem kết quả';
      return s.q < F.SLOTS - 1 ? 'Câu tiếp' : 'Thí sinh tiếp theo';
    }

    /** Turn intro: contestant name and the package picker. */
    function renderTurn() {
      const s = st();
      const box = $('fi-turn');
      box.hidden = s.phase !== 'turn';
      if (box.hidden) return;
      const c = s.c;
      const pts = settings().finishPoints;
      const levels = s.levels[c];
      const chosen = levels.every((l) => l != null);
      box.replaceChildren(
        el('div', { class: 'intro-eyebrow', text: `Thí sinh ${c + 1} / ${nC()}` }),
        el('div', { class: 'fi-turn-name', text: nameOf(c), title: nameOf(c) }),
        el(
          'div',
          { class: 'fi-pick' },
          Array.from({ length: F.SLOTS }, (_, q) =>
            el(
              'div',
              { class: 'fi-pick-slot' + (s.star[c] === q ? ' starred' : '') },
              el('div', { class: 'fi-pick-label' }, kbd(q + 1), ` Câu ${q + 1}`),
              el(
                'div',
                { class: 'fi-pick-levels' },
                pts.map((p, l) =>
                  el('button', { class: 'fi-level' + (levels[q] === l ? ' on' : ''), type: 'button', text: p, onclick: () => setLevel(q, l) })
                )
              ),
              el(
                'button',
                { class: 'fi-star-btn' + (s.star[c] === q ? ' on' : ''), type: 'button', title: `Ngôi sao hy vọng cho câu ${q + 1} (Shift+${q + 1})`, onclick: () => starAt(q) },
                el('span', { class: 'fi-star-icon', text: '★' }),
                s.star[c] === q ? 'Ngôi sao hy vọng' : 'Đặt ngôi sao'
              )
            )
          )
        ),
        el(
          'div',
          { class: 'fi-pick-sum' },
          chosen ? `Gói ${levels.map((l) => pts[l]).join(' – ')} điểm` : 'Chọn số điểm cho cả 3 câu',
          s.star[c] != null ? ` · ★ ở câu ${s.star[c] + 1}` : ' · có thể đặt ngôi sao trước mỗi câu'
        ),
        el('div', { class: 'intro-hint' }, 'Nhấn ', kbd('Space'), ' để bắt đầu lượt thi')
      );
    }

    function renderCard() {
      const s = st();
      const card = $('fi-card');
      const showing = ON_CARD.includes(s.phase);
      card.hidden = !showing;
      if (!showing) {
        cardKey = null;
        return;
      }
      const { c, q } = s;
      const level = s.levels[c][q];
      const slot = slotOf(c, q);
      const ver = slot.versions[level];
      const v = F.value(quiz(), level);
      const star = s.star[c] === q;
      const r = s.results[c][q];
      const ready = s.phase === 'ready';
      const key = `${c}:${q}:${level}`;
      if (cardKey !== key) {
        cardKey = key;
        ctx.setFitText($('fi-q'), ver.question);
        const img = $('fi-img');
        img.dataset.src = slot.image;
        if (slot.image) {
          img.onload = fitQuestion;
          img.onerror = () => {
            img.hidden = true;
            toast('Không tải được ảnh: ' + slot.image, 3000);
          };
          img.src = slot.image;
        } else img.removeAttribute('src');
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('enter');
      }
      $('fi-card-label').textContent = `${nameOf(c)} · Câu ${q + 1} / ${F.SLOTS}`;
      $('fi-card-meta').textContent = `${v} điểm · ${F.seconds(quiz(), level)} giây`;
      $('fi-value').replaceChildren(
        el('span', { class: 'fi-value-star', text: '★', hidden: !star }),
        el('span', { class: 'fi-value-num', text: v }),
        el('span', { class: 'fi-value-unit', text: star ? 'điểm × 2' : 'điểm' })
      );
      card.classList.toggle('starred', star);
      card.classList.toggle('ready', ready);
      const answerShown = r.revealed || s.phase === 'settled';
      card.classList.toggle('revealed', answerShown);

      const readyBox = $('fi-ready');
      readyBox.hidden = !ready;
      if (ready) {
        const can = F.canStar(s, q);
        readyBox.replaceChildren(
          el('div', { class: 'fi-ready-value' }, el('b', { text: v }), ' điểm'),
          star
            ? el('div', { class: 'fi-ready-star on' }, '★ Ngôi sao hy vọng: đúng ', el('b', { text: `+${2 * v}` }), ' · sai ', el('b', { text: `−${v}` }))
            : el('div', { class: 'fi-ready-star' }, can ? ['Nhấn ', kbd('S'), ' để đặt Ngôi sao hy vọng'] : 'Đã dùng Ngôi sao hy vọng'),
          el('div', { class: 'intro-hint' }, 'Nhấn ', kbd('Space'), ' để hiện câu hỏi')
        );
      }
      $('fi-q').hidden = ready;
      $('fi-img').hidden = ready || !slot.image || !$('fi-img').getAttribute('src');
      $('fi-answer').hidden = !answerShown;
      $('fi-answer').textContent = ver.answer;
      renderSteal(s);
      renderVerdict(s);
      requestAnimationFrame(fitQuestion);
    }

    function renderSteal(s) {
      const box = $('fi-steal');
      box.hidden = s.phase !== 'steal';
      if (box.hidden) return;
      const v = F.points(s, quiz(), s.c, s.q);
      box.replaceChildren(
        el('div', { class: 'fi-steal-title' }, 'Cướp điểm! ', el('span', { text: `Ai giơ tay trước? Đúng được +${v} điểm, sai không bị trừ.` })),
        el(
          'div',
          { class: 'fi-steal-btns' },
          quiz().contestants.map((ct, i) =>
            el(
              'button',
              { class: 'mark-btn', type: 'button', disabled: i === s.c, title: i === s.c ? 'Người đang thi không được cướp điểm' : null, onclick: () => pick(i) },
              kbd(i + 1),
              el('span', { class: 'mark-name', text: ct.name, title: ct.name })
            )
          ),
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: noSteal }, 'Không ai ', kbd('Space'))
        )
      );
      ctx.fitNames([...box.querySelectorAll('.mark-name')]);
    }

    function renderVerdict(s) {
      const box = $('fi-verdict');
      const r = s.results[s.c][s.q];
      box.hidden = r.main == null;
      if (box.hidden) return;
      const v = F.points(s, quiz(), s.c, s.q);
      const star = s.star[s.c] === s.q;
      const parts = [];
      if (r.main === 'correct') {
        parts.push(el('span', { class: 'ok' }, `✓ ${nameOf(s.c)} trả lời đúng `, el('b', { text: `+${F.mainPoints(s, quiz(), s.c, s.q)}` }), star ? ' (ngôi sao ×2)' : ''));
      } else {
        parts.push(el('span', { class: 'no' }, `✗ ${nameOf(s.c)} trả lời sai · `, el('b', { text: star ? `−${v}` : '0' }), star ? ' điểm (ngôi sao)' : ' điểm'));
        if (r.steal === 'correct') parts.push(el('span', { class: 'ok' }, ` · ${nameOf(r.stealer)} cướp điểm thành công `, el('b', { text: `+${v}` })));
        else if (r.steal === 'wrong') parts.push(el('span', { class: 'no' }, ` · ${nameOf(r.stealer)} cướp điểm sai · 0`));
        else if (s.phase === 'stealing') parts.push(` · ${nameOf(r.stealer)} đang trả lời`);
        else if (s.phase === 'settled') parts.push(r.revealed ? ' · đã hiện đáp án nên không cướp điểm' : ' · không ai cướp điểm');
      }
      box.replaceChildren(...parts);
    }

    /** Right column: the current contestant's 3 questions. */
    function renderSlots() {
      const s = st();
      const playing = s.phase !== 'intro' && s.phase !== 'results';
      $('fi-slots-title').hidden = !playing;
      $('fi-slots').hidden = !playing;
      $('fi-status').textContent = playing ? `Lượt thí sinh ${s.c + 1}/${nC()}` : '';
      if (!playing) return;
      const c = s.c;
      $('fi-slots-title').textContent = `Gói của ${nameOf(c)}`;
      $('fi-slots').replaceChildren(
        ...Array.from({ length: F.SLOTS }, (_, q) => {
          const r = s.results[c][q];
          const level = s.levels[c][q];
          const pts = F.mainPoints(s, quiz(), c, q);
          const current = s.phase !== 'turn' && q === s.q;
          let res = '';
          let cls = '';
          if (r.main === 'correct') {
            res = `+${pts}`;
            cls = ' correct';
          } else if (r.main === 'wrong') {
            res = pts < 0 ? `−${-pts}` : '✗';
            cls = ' wrong';
          }
          return el(
            'div',
            { class: 'fi-chip' + cls + (current ? ' current' : '') + (s.star[c] === q ? ' starred' : '') },
            el('span', { class: 'fi-chip-n', text: q + 1 }),
            el('span', { class: 'fi-chip-v', text: level == null ? '–' : F.value(quiz(), level) }),
            el('span', { class: 'fi-chip-star', text: s.star[c] === q ? '★' : '' }),
            el('span', { class: 'fi-chip-r', text: res, title: r.steal === 'correct' ? `${nameOf(r.stealer)} cướp điểm` : null })
          );
        })
      );
    }

    function renderControls() {
      const s = st();
      const vis = (name, show, disabled = false) => {
        const b = document.querySelector(`#screen-finish [data-fi="${name}"]`);
        b.hidden = !show;
        b.disabled = disabled;
        return b;
      };
      const r = ON_CARD.includes(s.phase) ? s.results[s.c][s.q] : null;
      const live = timerKey(s) != null;
      vis('back', s.phase === 'intro' && !!ctx.previousRound());
      vis('start', s.phase === 'intro');
      vis('begin', s.phase === 'turn', !F.packageReady(s));
      vis('star', s.phase === 'ready', !F.canStar(s, s.q));
      vis('show', s.phase === 'ready');
      vis('correct', s.phase === 'question');
      vis('wrong', s.phase === 'question');
      vis('reveal', s.phase === 'question' && !r.revealed);
      vis('nosteal', s.phase === 'steal');
      const next = vis('next', s.phase === 'settled');
      next.replaceChildren(nextLabel(s) + ' › ', kbd('Space'));
      vis('undo', true, !s.history.length || s.phase === 'intro');
      vis('pause', true, !live);
      vis('reset', true, !live);
      ctx.setIcon($('fi-btn-pause'), tm.running ? 'pause' : 'play');
    }

    function renderStealDialog() {
      const s = st();
      const open = app.screen === 'finish' && s.phase === 'stealing';
      $('fi-steal-dialog').hidden = !open;
      if (!open) return;
      const r = s.results[s.c][s.q];
      $('fi-steal-name').textContent = nameOf(r.stealer);
      $('fi-steal-value').textContent = `Nếu đúng: +${F.points(s, quiz(), s.c, s.q)} điểm · Nếu sai: 0 điểm (không bị trừ)`;
    }

    /* =========================================================
       Clocks (question time, then the steal window)
       ========================================================= */

    const tm = { key: null, totalMs: 0, remainingMs: 0, deadline: 0, running: false, handle: 0, lastWhole: 0 };

    function remaining() {
      return tm.running ? Math.max(0, tm.deadline - performance.now()) : tm.remainingMs;
    }

    function syncTimer() {
      const s = st();
      const key = timerKey(s);
      if (!key) {
        stopLoop();
        tm.key = null;
        renderTimer();
        return;
      }
      if (tm.key !== key) {
        stopLoop();
        tm.key = key;
        const secs = s.phase === 'steal' ? settings().finishStealSeconds : F.seconds(quiz(), s.levels[s.c][s.q]);
        tm.totalMs = secs * 1000;
        const snap = s.timer && s.timer.key === key ? s.timer : null;
        // Restored (refresh / undo) → paused at the saved time; teacher presses T.
        tm.remainingMs = snap ? snap.remainingMs : tm.totalMs;
        tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
        if (!snap) startLoop();
      }
      // The answer is on screen: the clock stops.
      if (s.phase === 'question' && s.results[s.c][s.q].revealed && tm.running) stopLoop();
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
        if (st().phase === 'steal') {
          toast('Hết giờ cướp điểm — không ai giơ tay.', 2400);
          noSteal();
          return;
        }
        S.buzzer();
        toast('Hết giờ! Chấm Đúng (C) hoặc Sai (X).', 2600);
        ctx.persist();
        renderTimer();
        renderControls();
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
      const key = timerKey(s);
      const live = !!key && tm.key === key;
      const rem = live ? remaining() : 0;
      const box = $('fi-timer');
      let num = '–';
      let label = '';
      if (live) {
        num = Math.ceil(rem / 1000);
        const revealed = s.phase === 'question' && s.results[s.c][s.q].revealed;
        if (rem <= 0) label = 'Hết giờ';
        else if (revealed) label = 'Đã dừng';
        else if (!tm.running) label = 'Tạm dừng';
        else label = s.phase === 'steal' ? 'Cướp điểm' : 'giây';
      } else if (s.phase === 'ready') {
        num = F.seconds(quiz(), s.levels[s.c][s.q]);
        label = 'Sẵn sàng';
      } else if (s.phase === 'intro' || s.phase === 'turn') {
        num = settings().finishSeconds.join('/');
        label = 'giây';
      } else if (s.phase === 'stealing') label = 'Đang trả lời';
      $('fi-timer-num').textContent = num;
      $('fi-timer-label').textContent = label;
      const frac = live ? rem / tm.totalMs : s.phase === 'ready' ? 1 : 0;
      $('fi-timer-ring').style.strokeDashoffset = RING * (1 - frac);
      $('fi-timer-ring').style.opacity = frac > 0 ? 1 : 0;
      box.className = 'timer';
      if (!live) box.classList.add('idle');
      else if (s.phase === 'steal') box.classList.add('steal');
      if (live && rem <= 0) box.classList.add('timeout');
      else if (live && !tm.running) box.classList.add('paused');
      else if (live && rem <= 5000) box.classList.add('urgent');
      $('fi-timer-num').classList.toggle('small', String(num).length > 3);
      ctx.setIcon($('fi-btn-pause'), tm.running ? 'pause' : 'play');
    }

    /** Called by app.persistSession() so a refresh resumes the clock where it was. */
    function persistTimer(session) {
      const s = session.finish;
      if (!s) return;
      const key = timerKey(s);
      if (key && tm.key === key) s.timer = { key, remainingMs: remaining() };
      else if (!key && s.phase !== 'stealing') s.timer = null; // stealing keeps the window's clock for a cancel
    }

    /* =========================================================
       Actions
       ========================================================= */

    function setLevel(q, level) {
      const s = st();
      if (s.phase !== 'turn') return;
      S.tick(false);
      commit(F.setLevel(s, q, level));
    }

    /** Number key in the picker: unset → low value, then flip between the two. */
    function flipLevel(q) {
      const cur = st().levels[st().c][q];
      setLevel(q, cur == null ? 0 : 1 - cur);
    }

    function starAt(q) {
      const s = st();
      if (!F.canStar(s, q)) {
        if (s.phase === 'ready') toast('Ngôi sao hy vọng đã dùng ở câu trước.', 2200);
        else toast('Chỉ đặt Ngôi sao hy vọng trước khi hiện câu hỏi.', 2200);
        return;
      }
      const placing = s.star[s.c] !== q;
      if (placing) S.star();
      else S.tick(false);
      commit(F.toggleStar(s, q));
    }

    function reveal() {
      const s = st();
      S.flip();
      const snap = withTimer(s);
      stopLoop();
      commit(F.reveal(snap));
      toast('Đã hiện đáp án — nếu trả lời sai sẽ không có cướp điểm.', 2600);
    }

    function judge(kind) {
      const s = st();
      if (s.phase === 'stealing') {
        judgeSteal(kind);
        return;
      }
      if (s.phase !== 'question') return;
      if (kind === 'correct') S.correct();
      else S.wrong();
      const snap = withTimer(s);
      stopLoop();
      const next = F.judge(snap, kind);
      commit(next, true);
      if (next.phase === 'steal') {
        S.bell();
        toast(`Cướp điểm! Các bạn khác có ${settings().finishStealSeconds} giây để giơ tay.`, 2600);
      }
    }

    function pick(c) {
      const s = st();
      if (s.phase !== 'steal' || !(c >= 0 && c < nC())) return;
      if (c === s.c) {
        toast(`${nameOf(c)} là người đang thi — không được cướp điểm.`, 2200);
        return;
      }
      S.bell();
      const snap = withTimer(s);
      stopLoop();
      commit(F.pickStealer(snap, c));
    }

    function cancelSteal() {
      const s = st();
      if (s.phase !== 'stealing') return;
      stopLoop();
      tm.key = undefined; // resume from the window's saved clock
      commit(F.cancelSteal(s));
      if (st().phase === 'steal' && remaining() > 0) {
        startLoop();
        ctx.persist();
        renderTimer();
      }
      toast('Đã huỷ — ai giơ tay trước?', 1600);
    }

    function noSteal() {
      const s = st();
      if (s.phase !== 'steal') return;
      stopLoop();
      S.reveal();
      commit(F.noSteal(s));
    }

    function judgeSteal(kind) {
      const s = st();
      if (s.phase !== 'stealing') return;
      if (kind === 'correct') S.correct();
      else S.wrong();
      commit(F.judgeSteal(s, kind), true);
    }

    const actions = {
      advance() {
        const s = st();
        if (s.phase === 'intro') commit(F.start(s));
        else if (s.phase === 'turn') {
          if (!F.packageReady(s)) {
            toast('Chọn 20 hoặc 30 điểm cho cả 3 câu (phím 1–3 hoặc bấm).', 2400);
            return;
          }
          S.reveal();
          commit(F.beginTurn(s));
        } else if (s.phase === 'ready') {
          S.flip();
          commit(F.show(s));
        } else if (s.phase === 'question') {
          if (!s.results[s.c][s.q].revealed) reveal();
          else toast('Chấm Đúng (C) hoặc Sai (X).', 1800);
        } else if (s.phase === 'steal') noSteal();
        else if (s.phase === 'stealing') toast('Chấm phần cướp điểm: C đúng · X sai · ← huỷ.', 2200);
        else if (s.phase === 'settled') {
          S.flip();
          commit(F.next(s));
        }
      },
      start: () => actions.advance(),
      begin: () => actions.advance(),
      show: () => actions.advance(),
      reveal: () => actions.advance(),
      next: () => actions.advance(),
      nosteal: noSteal,
      correct: () => judge('correct'),
      wrong: () => judge('wrong'),
      star() {
        const s = st();
        if (s.phase === 'turn') toast('Bấm ★ ở câu muốn đặt ngôi sao (hoặc Shift+1–3).', 2200);
        else if (s.phase === 'ready') starAt(s.q);
        else if (ON_CARD.includes(s.phase)) toast('Chỉ đặt Ngôi sao hy vọng trước khi hiện câu hỏi.', 2200);
      },
      back() {
        const s = st();
        if (s.phase === 'intro') ctx.backToPreviousResults();
        else if (s.phase === 'stealing') cancelSteal();
      },
      undo() {
        const s = st();
        if (s.phase === 'intro' || s.phase === 'results') return;
        const r = F.undo(withTimer(s));
        if (!r.undone) {
          toast('Không có gì để hoàn tác.', 1500);
          return;
        }
        const a = r.undone;
        const who = nameOf(a.c);
        const msg = {
          level: () => `Đã hoàn tác chọn gói của ${who}.`,
          star: () => `Đã hoàn tác Ngôi sao hy vọng của ${who}.`,
          begin: () => `Quay lại chọn gói của ${who}.`,
          show: () => `Đã ẩn câu ${a.q + 1} của ${who}.`,
          reveal: () => `Đã ẩn đáp án câu ${a.q + 1} — đồng hồ đang tạm dừng (T để tiếp tục).`,
          judge: () => `Đã hoàn tác chấm ${who} – câu ${a.q + 1}. Hãy chấm lại.`,
          pick: () => 'Đã huỷ người cướp điểm.',
          nosteal: () => 'Mở lại lượt cướp điểm — đồng hồ đang tạm dừng (T để tiếp tục).',
          steal: () => 'Đã hoàn tác chấm cướp điểm — hãy chấm lại.',
        }[a.type]();
        stopLoop();
        tm.key = undefined; // resync from the restored snapshot
        commit(r.state, true);
        toast(msg, 2600);
      },
      pause() {
        const s = st();
        if (!timerKey(s)) return;
        if (s.phase === 'question' && s.results[s.c][s.q].revealed) {
          toast('Đã hiện đáp án — đồng hồ đã dừng.', 1800);
          return;
        }
        if (tm.running) stopLoop();
        else if (remaining() > 0) startLoop();
        ctx.persist();
        renderTimer();
      },
      reset() {
        const s = st();
        if (!timerKey(s)) return;
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
       shown in the mode badge.
       ========================================================= */

    const KEYS = {
      Space: 'advance', ArrowRight: 'advance', PageDown: 'advance',
      ArrowLeft: 'back', PageUp: 'back', Backspace: 'back', Escape: 'back',
      KeyC: 'correct', KeyX: 'wrong', KeyS: 'star', KeyU: 'undo', KeyT: 'pause', KeyR: 'reset',
      KeyF: 'fullscreen', KeyM: 'mute', KeyH: 'help', Slash: 'help',
    };
    const REPEATABLE = new Set(['fullscreen', 'mute', 'help']);

    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        if (!e.repeat) actions.undo();
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const code = e.code;
      const s = st();
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        if (e.repeat) return true;
        const n = +digit[1] - 1;
        if (s.phase === 'turn') {
          if (n >= F.SLOTS) toast('Mỗi lượt có 3 câu: phím 1–3.', 1800);
          else if (e.shiftKey) starAt(n);
          else flipLevel(n);
        } else if (s.phase === 'steal') pick(n);
        else if (s.phase === 'question') toast('Người đang thi trả lời — chấm C đúng hoặc X sai.', 2000);
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        if (!e.repeat) actions.advance();
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
      if (!q.finish) {
        pane.replaceChildren(
          el(
            'div',
            { class: 'panel ob-ed-empty' },
            el('h3', { text: 'Chưa có câu hỏi vòng 4' }),
            el('p', {
              class: 'muted',
              text:
                'Vòng 4 · Về đích: mỗi thí sinh một lượt 3 câu, tự chọn câu 20 hoặc 30 điểm, có thể đặt Ngôi sao hy vọng (đúng ×2, sai bị trừ). ' +
                'Trả lời sai thì các bạn khác được cướp điểm. Mỗi câu cần soạn sẵn cả bản 20 và 30 điểm. Điểm các vòng trước được cộng dồn.',
            }),
            el(
              'div',
              { class: 'row center' },
              // Start from filled-in sample questions (editable); a blank form is the second choice.
              el('button', { class: 'btn btn-primary', type: 'button', text: '+ Thêm câu hỏi vòng 4 (có sẵn câu mẫu)', onclick: () => setFinish(D.sampleFinish(q.contestants.length)) }),
              el('button', { class: 'btn btn-ghost', type: 'button', text: 'Soạn từ trang trống', onclick: () => setFinish(D.emptyFinish(q.contestants.length)) })
            )
          )
        );
        return;
      }
      const fin = q.finish;
      const stg = q.settings;
      const [p0, p1] = stg.finishPoints;

      const numInput = (value, limits, onSet, after) =>
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
            if (after) after();
          },
        });

      const listField = (label, labels, values, limits, after) =>
        el(
          'div',
          { class: 'field' },
          el('span', { text: label }),
          el(
            'div',
            { class: 'kp-grid fi-kp-grid' },
            labels.map((l, i) => el('label', { class: 'kp' }, el('span', { text: l }), numInput(values[i], limits, (v) => (values[i] = v), after)))
          )
        );

      const settingsPanel = el(
        'div',
        { class: 'panel ob-ed-settings fi-ed-settings' },
        // Labels show the point values, so redraw when they change.
        listField('Điểm mỗi câu', ['Gói thấp', 'Gói cao'], stg.finishPoints, D.LIMITS.finishPoint, ctx.refreshEditor),
        listField('Số giây mỗi câu', [`Câu ${p0} điểm`, `Câu ${p1} điểm`], stg.finishSeconds, D.LIMITS.finishSecond),
        el(
          'div',
          { class: 'field' },
          el('span', { text: 'Cướp điểm' }),
          el(
            'div',
            { class: 'kp-grid fi-kp-grid' },
            el('label', { class: 'kp' }, el('span', { text: 'Số giây giơ tay' }), numInput(stg.finishStealSeconds, D.LIMITS.finishStealSeconds, (v) => (stg.finishStealSeconds = v)))
          )
        ),
        el(
          'div',
          { class: 'row ob-ed-remove' },
          // Still nothing typed: the sample can fill it in.
          fin.turns.every((t) => t.slots.every((s) => s.versions.every((v) => !v.question.trim() && !v.answer.trim())))
            ? el('button', { class: 'btn btn-primary', type: 'button', text: 'Điền câu hỏi mẫu', onclick: () => setFinish(D.sampleFinish(q.contestants.length)) })
            : null,
          el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Xoá vòng 4',
            onclick: () => {
              if (confirm('Xoá toàn bộ câu hỏi vòng Về đích?')) setFinish(null);
            },
          })
        )
      );

      const versionCell = (slot, k, label) => {
        const v = slot.versions[k];
        return el(
          'div',
          { class: 'fi-ed-version' },
          el('textarea', {
            rows: 2,
            value: v.question,
            placeholder: `Câu hỏi ${stg.finishPoints[k]} điểm`,
            'aria-label': `${label} — câu hỏi ${stg.finishPoints[k]} điểm`,
            oninput: (e) => {
              v.question = e.target.value;
              ctx.edited(false);
            },
          }),
          el('input', {
            class: 'ed-input',
            type: 'text',
            value: v.answer,
            placeholder: `Đáp án ${stg.finishPoints[k]} điểm`,
            'aria-label': `${label} — đáp án ${stg.finishPoints[k]} điểm`,
            oninput: (e) => {
              v.answer = e.target.value;
              ctx.edited(false);
            },
          })
        );
      };

      const turnPanels = q.contestants.map((ct, i) => {
        const turn = fin.turns[i];
        const who = ct.name.trim() || `Thí sinh ${i + 1}`;
        return el(
          'div',
          { class: 'panel ob-ed-rows' },
          el('div', { class: 'ed-head' }, el('div', { class: 'ed-badge', text: i + 1 }), el('h3', { class: 'fi-ed-name', text: who })),
          el(
            'div',
            { class: 'fi-ed-row ob-ed-head' },
            el('div'),
            el('div', { class: 'ed-q-head', text: `Gói ${p0} điểm` }),
            el('div', { class: 'ed-q-head', text: `Gói ${p1} điểm` }),
            el('div', { class: 'ed-q-head', text: 'Hình ảnh' })
          ),
          turn.slots.map((slot, j) =>
            el(
              'div',
              { class: 'fi-ed-row' },
              el(
                'div',
                { class: 'ob-ed-label' },
                `Câu ${j + 1}`,
                turn.slots.length > F.SLOTS &&
                  el('button', {
                    class: 'btn btn-danger ac-ed-del',
                    type: 'button',
                    text: 'Xoá',
                    onclick: () => {
                      turn.slots.splice(j, 1);
                      ctx.edited(false);
                      ctx.refreshEditor();
                    },
                  })
              ),
              versionCell(slot, 0, `${who}, câu ${j + 1}`),
              versionCell(slot, 1, `${who}, câu ${j + 1}`),
              ctx.imageCell(slot)
            )
          )
        );
      });

      pane.replaceChildren(
        settingsPanel,
        el('p', { class: 'muted small', text: 'Mỗi thí sinh soạn sẵn 3 câu, mỗi câu có bản gói thấp và gói cao. Ảnh (nếu có) hiện cùng bản thí sinh chọn.' }),
        ...turnPanels
      );
    }

    function setFinish(fin) {
      quiz().finish = fin;
      ctx.edited(false);
      ctx.refreshEditor();
    }

    /* ========================================================= */

    function leave() {
      stopLoop();
      built = false;
      cardKey = null;
      $('fi-steal-dialog').hidden = true;
    }

    function bind() {
      document.querySelectorAll('#screen-finish [data-fi]').forEach((b) =>
        b.addEventListener('click', () => {
          b.blur();
          actions[b.dataset.fi]();
        })
      );
      $('fi-steal-correct').onclick = () => judgeSteal('correct');
      $('fi-steal-wrong').onclick = () => judgeSteal('wrong');
      $('fi-steal-cancel').onclick = cancelSteal;
      let idleTimer = 0;
      const screen = $('screen-finish');
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
        tm.key = undefined;
        stopLoop();
      },
    };
  };
})(window);
