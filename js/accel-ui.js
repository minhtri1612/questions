/*
 * Acceleration round UI ("Tăng tốc"): presentation screen, question clock,
 * video playback, submission order, mode-aware keyboard and the editor tab.
 * Rules live in accel.js; shared helpers (tiles, commit, sound, editor
 * plumbing) come from app.js through `ctx`.
 */
(function (root) {
  'use strict';

  root.AccelUI = function (ctx) {
    const A = root.AccelEngine;
    const D = root.QuizData;
    const S = root.Sound;
    const { $, el, toast } = ctx;
    const app = ctx.app;

    const st = () => app.session.accel;
    const quiz = () => app.quiz;
    const settings = () => app.quiz.settings;
    const item = (q) => quiz().accel.questions[q];
    const nameOf = (c) => quiz().contestants[c].name;
    const isVideo = (q) => D.mediaKind(item(q).media) === 'video';
    const ON_CARD = ['question', 'marking', 'scored'];

    let built = false;
    let cardQ = null; // question currently drawn on the card
    let fixing = false; // marking sub-mode: number keys edit the order instead of the ticks
    let justAdded = null; // contestant whose order badge should pop
    let mediaToken = 0; // ignores media that finishes loading after the card moved on
    let videoWanted = false; // play as soon as the source is ready

    /* =========================================================
       Commit helpers
       ========================================================= */

    function commit(next, withDeltas) {
      const before = ctx.totalScores(app.session);
      const session = { ...app.session, accel: next };
      const opts = withDeltas ? { deltas: ctx.scoreDeltas(before, ctx.totalScores(session)) } : {};
      ctx.commit(session, opts);
    }

    /** Copy the live clock into the state before an action that may need to restore it (undo). */
    function withTimer(state) {
      const s = { ...state };
      if (s.phase === 'question' && tm.q === s.q) s.timer = { q: s.q, remainingMs: remaining(), started: tm.started };
      return s;
    }

    /* =========================================================
       Build (once per show)
       ========================================================= */

    function build() {
      const stg = settings();
      $('ac-title').textContent = `${stg.title} · Tăng tốc`;
      const tiles = $('ac-tiles');
      ctx.buildTiles(tiles, null);
      tiles.onclick = (e) => {
        const tile = e.target.closest('.tile');
        if (tile) clickContestant([...tiles.children].indexOf(tile));
      };
      const n = quiz().accel.questions.length;
      const secs = Array.from({ length: n }, (_, q) => A.seconds(quiz(), q));
      $('ac-intro-meta').textContent =
        `${n} câu hỏi · ${secs.join(' / ')} giây · cả lớp trả lời cùng lúc · ` +
        `đúng nhanh nhất ${stg.accelPoints.join(', ')} điểm`;
      ctx.setIcon(document.querySelector('#screen-accel [data-ac="reset"]'), 'reset');
      ctx.setIcon(document.querySelector('#screen-accel [data-ac="fullscreen"]'), 'fullscreen');
      ctx.setIcon(document.querySelector('#screen-accel [data-ac="replay"]'), 'replay');
      ctx.updateMuteButtons();
      built = true;
    }

    function fitQuestion() {
      const box = $('ac-q');
      const span = box.firstElementChild;
      if ($('ac-card').hidden || !span) return;
      span.style.webkitLineClamp = '';
      ctx.fitText(box, innerHeight * 0.075, innerHeight * 0.024);
      if (span.offsetHeight > box.clientHeight) {
        // Even the smallest size doesn't fit next to the media/answer: cut with … at the lines that fit.
        const line = parseFloat(getComputedStyle(span).lineHeight) || 1;
        span.style.webkitLineClamp = Math.max(1, Math.floor(box.clientHeight / line));
      }
    }

    function sizeLayout() {
      if (app.screen !== 'accel') return;
      fitQuestion();
      fitOrderNames();
    }

    /* =========================================================
       Render
       ========================================================= */

    function show() {
      ctx.showScreen('accel');
      build();
      cardQ = null;
      fixing = false;
      tm.q = undefined; // force the clock to resync from the saved snapshot
      render();
      requestAnimationFrame(sizeLayout);
    }

    function render(opts = {}) {
      if (!built) build();
      const s = st();
      if (s.phase !== 'marking') fixing = false;
      $('ac-intro').hidden = s.phase !== 'intro';
      renderCard(); // before the clock: a fresh video question asks the card to play
      syncTimer();
      renderTiles(opts.deltas);
      renderOrder();
      renderDots();
      renderMode();
      renderControls();
      justAdded = null;
    }

    function renderTiles(deltas) {
      const s = st();
      const tiles = $('ac-tiles');
      ctx.updateTiles(tiles, ctx.totalScores(app.session), -1, deltas);
      const onCard = ON_CARD.includes(s.phase);
      const revealed = s.phase === 'marking' || s.phase === 'scored';
      [...tiles.children].forEach((tile, c) => {
        const pos = onCard ? A.position(s, s.q, c) : 0;
        let badge = tile.querySelector('.tile-order');
        if (!pos) {
          if (badge) badge.remove();
        } else {
          if (!badge || justAdded === c) {
            if (badge) badge.remove();
            badge = el('span', { class: 'tile-order' });
            tile.append(badge);
          }
          badge.textContent = pos;
        }
        tile.classList.toggle('ac-ok', revealed && pos > 0 && s.correct[s.q][c]);
        tile.classList.toggle('ac-no', revealed && pos > 0 && !s.correct[s.q][c]);
        tile.title = `${nameOf(c)} — phím ${c + 1}`;
      });
    }

    function renderMode() {
      const s = st();
      const m = $('ac-mode');
      const n = quiz().contestants.length;
      let cls = '';
      let name = '';
      let hint = '';
      if (s.phase === 'question' && !tm.started) {
        cls = 'mode-question';
        name = isVideo(s.q) ? 'Đang chiếu video' : 'Chưa tính giờ';
        hint = 'Space hoặc T: bắt đầu tính giờ' + (isVideo(s.q) ? ' · V: xem lại video' : '');
      } else if (s.phase === 'question') {
        cls = 'mode-board';
        name = 'Nhận bảng';
        hint = `Phím 1–${n} hoặc bấm tên theo thứ tự giơ bảng · Space: hiện đáp án`;
      } else if (s.phase === 'marking' && fixing) {
        cls = 'mode-board';
        name = 'Sửa thứ tự';
        hint = `Phím 1–${n}: bỏ ra / thêm vào cuối hàng · O: xong`;
      } else if (s.phase === 'marking') {
        cls = 'mode-mark';
        name = 'Chấm điểm';
        hint = `Phím 1–${n}: bỏ chọn người trả lời sai · O: sửa thứ tự · Enter: xác nhận`;
      } else if (s.phase === 'scored') {
        cls = 'mode-final';
        name = 'Đã chấm';
        hint = A.isLast(s) ? 'Space: xem kết quả' : 'Space: câu tiếp theo';
      }
      m.hidden = !cls;
      m.className = 'mode-badge ' + cls;
      m.replaceChildren(el('span', { class: 'mode-name', text: name }), el('span', { class: 'mode-hint', text: hint }));
    }

    function renderCard() {
      const s = st();
      const card = $('ac-card');
      const showing = ON_CARD.includes(s.phase);
      card.hidden = !showing;
      if (!showing) {
        if (cardQ !== null) setMedia('');
        cardQ = null;
        return;
      }
      const q = s.q;
      const it = item(q);
      const n = quiz().accel.questions.length;
      if (cardQ !== q) {
        cardQ = q;
        $('ac-card-label').textContent = `Câu ${q + 1} / ${n}`;
        $('ac-card-meta').textContent = `${A.seconds(quiz(), q)} giây · đúng nhanh nhất ${settings().accelPoints.join(' / ')} điểm`;
        ctx.setFitText($('ac-q'), it.question);
        setMedia(it.media);
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('enter');
      }
      const revealed = s.phase !== 'question';
      card.classList.toggle('revealed', revealed);
      $('ac-answer').hidden = !revealed;
      $('ac-answer').textContent = it.answer;
      if (revealed) stopVideo();
      requestAnimationFrame(fitQuestion);
    }

    function renderOrder() {
      const s = st();
      const list = $('ac-order');
      const onCard = ON_CARD.includes(s.phase);
      $('ac-order-title').hidden = !onCard;
      list.hidden = !onCard;
      if (!onCard) return;
      const q = s.q;
      const revealed = s.phase === 'marking' || s.phase === 'scored';
      const pts = revealed ? A.questionPoints(s, quiz(), q) : null;
      const order = s.order[q];
      const rest = quiz().contestants.map((_, c) => c).filter((c) => !order.includes(c));
      const names = [];
      list.classList.toggle('fixing', fixing);
      list.replaceChildren(
        ...order.concat(rest).map((c) => {
          const pos = A.position(s, q, c);
          const right = revealed && pos > 0 && s.correct[q][c];
          const wrong = revealed && pos > 0 && !s.correct[q][c];
          const name = el('span', { class: 'ac-name', text: nameOf(c), title: nameOf(c) });
          names[c] = name;
          let tail = '';
          if (right) tail = pts[c] ? `+${pts[c]}` : '✓ 0';
          else if (wrong) tail = '✗';
          return el(
            'li',
            {
              class: 'ac-row' + (pos ? ' in' : ' out') + (right ? ' right' : '') + (wrong ? ' wrong' : '') + (justAdded === c ? ' just' : ''),
              onclick: () => clickContestant(c),
            },
            el('span', { class: 'ac-pos', text: pos || '–' }),
            el('kbd', { text: c + 1 }),
            name,
            el('span', { class: 'ac-pts', text: tail })
          );
        })
      );
      list._names = names;
      fitOrderNames();
    }

    function fitOrderNames() {
      const names = $('ac-order')._names;
      if (names && !$('ac-order').hidden) ctx.fitNames(names);
    }

    function renderDots() {
      const s = st();
      const n = quiz().accel.questions.length;
      $('ac-dots').replaceChildren(
        ...Array.from({ length: n }, (_, q) =>
          el('div', {
            class: 'dot' + (s.scored[q] ? ' done' : '') + (ON_CARD.includes(s.phase) && q === s.q ? ' current' : ''),
            text: q + 1,
          })
        )
      );
    }

    function renderControls() {
      const s = st();
      const vis = (name, show, disabled = false) => {
        const b = document.querySelector(`#screen-accel [data-ac="${name}"]`);
        b.hidden = !show;
        b.disabled = disabled;
        return b;
      };
      const inQ = s.phase === 'question';
      vis('back', s.phase === 'intro' && !!ctx.previousRound());
      vis('start', s.phase === 'intro');
      vis('clock', inQ && !tm.started);
      vis('reveal', inQ && tm.started);
      const fix = vis('fix', s.phase === 'marking');
      fix.replaceChildren(fixing ? 'Xong sửa thứ tự ' : 'Sửa thứ tự ', el('kbd', { text: 'O' }));
      vis('confirm', s.phase === 'marking');
      const next = vis('next', s.phase === 'scored');
      next.replaceChildren(A.isLast(s) ? 'Xem kết quả › ' : 'Câu tiếp › ', el('kbd', { text: 'Space' }));
      vis('undo', true, !s.history.length || s.phase === 'intro');
      vis('replay', ON_CARD.includes(s.phase) && isVideo(s.q), !(inQ && !tm.started));
      vis('pause', true, !(inQ && tm.started));
      vis('reset', true, !(inQ && tm.started));
      ctx.setIcon($('ac-btn-pause'), tm.running ? 'pause' : 'play');
    }

    /* =========================================================
       Media (image or video)
       ========================================================= */

    function setMedia(src) {
      const kind = D.mediaKind(src);
      const box = $('ac-media');
      const img = $('ac-img');
      const video = $('ac-video');
      const token = ++mediaToken;
      box.hidden = !kind;
      img.hidden = kind !== 'image';
      video.hidden = kind !== 'video';
      $('ac-media-msg').hidden = true;
      stopVideo();
      video.removeAttribute('src');
      video.load();
      img.removeAttribute('src');
      if (!kind) return;
      ctx.mediaUrl(src).then((url) => {
        if (token !== mediaToken) return;
        if (!url) {
          mediaError(kind === 'video' ? 'Không tìm thấy video đã chọn trong trình duyệt này — nhấn Space để bắt đầu tính giờ.' : 'Không tải được ảnh.');
          return;
        }
        if (kind === 'image') {
          img.onload = fitQuestion;
          img.onerror = () => mediaError('Không tải được ảnh: ' + src);
          img.src = url;
        } else {
          video.muted = !!app.prefs.muted;
          video.src = url;
          if (videoWanted) playVideo();
        }
      });
    }

    function mediaError(msg) {
      const box = $('ac-media-msg');
      box.textContent = msg;
      box.hidden = false;
      $('ac-img').hidden = true;
      $('ac-video').hidden = true;
      requestAnimationFrame(fitQuestion);
    }

    /** Play the question video from the start (it starts the clock when it ends). */
    function playVideo() {
      videoWanted = true;
      const video = $('ac-video');
      if (!video.getAttribute('src')) return; // setMedia plays it once the source is ready
      video.currentTime = 0;
      video.muted = !!app.prefs.muted;
      const p = video.play();
      if (p && p.catch) {
        p.catch((e) => {
          if (e && e.name === 'NotAllowedError') {
            $('ac-media-msg').textContent = 'Trình duyệt chặn tự phát — nhấn V để phát video.';
            $('ac-media-msg').hidden = false;
          }
        });
      }
    }

    function stopVideo() {
      videoWanted = false;
      const video = $('ac-video');
      if (!video.paused) video.pause();
    }

    function onVideoEnded() {
      const s = st();
      if (app.screen !== 'accel' || s.phase !== 'question' || tm.started || tm.q !== s.q) return;
      startClock();
    }

    /* =========================================================
       Question clock
       ========================================================= */

    // started = answering time has begun (after the video, or right away without one).
    const tm = { q: null, totalMs: 0, remainingMs: 0, deadline: 0, running: false, started: false, handle: 0, lastWhole: 0 };

    function remaining() {
      return tm.running ? Math.max(0, tm.deadline - performance.now()) : tm.remainingMs;
    }

    function syncTimer() {
      const s = st();
      if (s.phase !== 'question') {
        stopLoop();
        tm.q = null;
        tm.started = false;
        renderTimer();
        return;
      }
      if (tm.q !== s.q) {
        stopLoop();
        tm.q = s.q;
        tm.totalMs = A.seconds(quiz(), s.q) * 1000;
        const snap = s.timer && s.timer.q === s.q && s.timer.started ? s.timer : null;
        if (snap) {
          // Restored (refresh / undo of the reveal) → paused at the saved time; teacher presses T.
          tm.started = true;
          tm.remainingMs = snap.remainingMs;
        } else if (isVideo(s.q)) {
          tm.started = false;
          tm.remainingMs = tm.totalMs;
          playVideo();
        } else {
          tm.started = true;
          tm.remainingMs = tm.totalMs;
          startLoop();
        }
        tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
      }
      renderTimer();
    }

    /** Answering time begins: after the video, or when the teacher starts it. */
    function startClock() {
      stopVideo();
      tm.started = true;
      tm.remainingMs = tm.totalMs;
      tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
      startLoop();
      S.reveal();
      ctx.persist();
      render();
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
        toast('Hết giờ! Bỏ chọn người trả lời sai rồi nhấn Enter.', 2600);
        commit(A.reveal(withTimer(st())));
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
      const inQ = s.phase === 'question' && tm.q === s.q;
      const idle = !inQ || !tm.started;
      const rem = inQ ? remaining() : 0;
      const frac = idle ? (inQ ? 1 : 0) : rem / tm.totalMs;
      const box = $('ac-timer');
      const secs = ON_CARD.includes(s.phase) ? A.seconds(quiz(), s.q) : A.seconds(quiz(), 0);
      $('ac-timer-num').textContent = inQ && tm.started ? Math.ceil(rem / 1000) : s.phase === 'question' || s.phase === 'intro' ? secs : '–';
      let label = 'giây';
      if (s.phase === 'question' && !tm.started) label = isVideo(s.q) ? 'Sau video' : 'Sẵn sàng';
      else if (inQ && rem <= 0) label = 'Hết giờ';
      else if (inQ && !tm.running) label = 'Tạm dừng';
      else if (!inQ) label = s.phase === 'intro' ? 'Sẵn sàng' : 'Đã dừng';
      $('ac-timer-label').textContent = label;
      $('ac-timer-ring').style.strokeDashoffset = RING * (1 - frac);
      $('ac-timer-ring').style.opacity = frac > 0 ? 1 : 0;
      box.className = 'timer';
      if (idle) box.classList.add('idle');
      else if (rem <= 0) box.classList.add('timeout');
      else if (!tm.running) box.classList.add('paused');
      else if (rem <= 5000) box.classList.add('urgent');
      ctx.setIcon($('ac-btn-pause'), tm.running ? 'pause' : 'play');
    }

    /** Called by app.persistSession() so a refresh resumes the clock where it was. */
    function persistTimer(session) {
      const s = session.accel;
      if (!s) return;
      if (s.phase === 'question' && tm.q === s.q) s.timer = { q: s.q, remainingMs: remaining(), started: tm.started };
      else if (s.phase !== 'question') s.timer = null;
    }

    /* =========================================================
       Actions
       ========================================================= */

    /** A name was clicked or its number key pressed: what it means depends on the phase. */
    function clickContestant(c) {
      const s = st();
      if (!(c >= 0 && c < quiz().contestants.length)) return;
      if (s.phase === 'question') {
        if (!tm.started) {
          toast('Chưa bắt đầu tính giờ — nhấn Space để bắt đầu.', 2000);
          return;
        }
        changeOrder(c);
      } else if (s.phase === 'marking') {
        if (fixing) changeOrder(c);
        else if (!A.position(s, s.q, c)) toast(`${nameOf(c)} chưa giơ bảng — nhấn O để sửa thứ tự.`, 2400);
        else {
          S.tick(false);
          commit(A.toggleCorrect(s, c));
        }
      } else if (s.phase === 'scored') {
        toast('Câu này đã chấm — nhấn U để hoàn tác nếu cần sửa.', 2200);
      }
    }

    function changeOrder(c) {
      const s = st();
      const adding = !A.position(s, s.q, c);
      if (adding) {
        justAdded = c;
        S.pop();
      } else S.tick(false);
      commit(A.toggleOrder(s, c));
    }

    function reveal() {
      const s = st();
      if (s.phase !== 'question') return;
      S.flip();
      stopVideo();
      const snap = withTimer(s);
      stopLoop();
      commit(A.reveal(snap));
    }

    function confirmQuestion() {
      const s = st();
      if (s.phase !== 'marking') return;
      const next = A.confirm(s);
      const pts = A.questionPoints(next, quiz(), s.q);
      const winners = next.order[s.q].filter((c) => pts[c] > 0);
      if (winners.length) S.correct();
      else S.wrong();
      commit(next, true);
      toast(
        winners.length
          ? `Câu ${s.q + 1}: ` + winners.map((c) => `${nameOf(c)} +${pts[c]}`).join(' · ')
          : `Câu ${s.q + 1}: không ai được điểm.`,
        3200
      );
    }

    const actions = {
      advance() {
        const s = st();
        if (s.phase === 'intro') commit(A.start(s));
        else if (s.phase === 'question') {
          if (!tm.started) startClock();
          else reveal();
        } else if (s.phase === 'marking') toast('Bỏ chọn người trả lời sai rồi nhấn Enter để xác nhận.', 2200);
        else if (s.phase === 'scored') {
          S.flip();
          commit(A.next(s));
        }
      },
      start: () => actions.advance(),
      clock: () => actions.advance(),
      reveal: () => actions.advance(),
      next: () => actions.advance(),
      confirm: confirmQuestion,
      fix() {
        if (st().phase !== 'marking') return;
        fixing = !fixing;
        if (fixing) toast('Sửa thứ tự: bấm tên để bỏ ra hoặc thêm vào cuối hàng.', 2600);
        render();
      },
      back() {
        const s = st();
        if (s.phase === 'intro') ctx.backToPreviousResults();
        else if (s.phase === 'marking' && fixing) actions.fix();
      },
      undo() {
        const s = st();
        if (s.phase === 'intro' || s.phase === 'results') return;
        const r = A.undo(withTimer(s));
        if (!r.undone) {
          toast('Không có gì để hoàn tác.', 1500);
          return;
        }
        const a = r.undone;
        const msg = {
          order: () => `Đã hoàn tác thứ tự giơ bảng câu ${a.q + 1}.`,
          reveal: () => `Đã đóng đáp án câu ${a.q + 1} — đồng hồ đang tạm dừng (T để tiếp tục).`,
          mark: () => `Đã hoàn tác chấm ${nameOf(a.c)}.`,
          confirm: () => `Đã hoàn tác chấm câu ${a.q + 1} — hãy chấm lại.`,
        }[a.type]();
        if (a.type !== 'order') {
          // The question changes state: let the clock resync from the restored snapshot.
          stopLoop();
          tm.q = undefined;
        }
        commit(r.state, true);
        toast(msg, 2600);
      },
      pause() {
        const s = st();
        if (s.phase !== 'question') return;
        if (!tm.started) {
          startClock();
          return;
        }
        if (tm.running) stopLoop();
        else if (remaining() > 0) startLoop();
        ctx.persist();
        render();
      },
      reset() {
        const s = st();
        if (s.phase !== 'question' || !tm.started) return;
        stopLoop();
        tm.remainingMs = tm.totalMs;
        tm.lastWhole = Math.ceil(tm.remainingMs / 1000);
        startLoop();
        ctx.persist();
        render();
        toast('Đã đặt lại đồng hồ.', 1400);
      },
      replay() {
        const s = st();
        if (s.phase !== 'question' || !isVideo(s.q)) return;
        if (tm.started) {
          toast('Đã bắt đầu tính giờ — không xem lại video được nữa.', 2200);
          return;
        }
        $('ac-media-msg').hidden = true;
        playVideo();
      },
      mute() {
        ctx.actions.mute();
        $('ac-video').muted = !!app.prefs.muted;
      },
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
      KeyO: 'fix', KeyU: 'undo', KeyT: 'pause', KeyR: 'reset', KeyV: 'replay',
      KeyF: 'fullscreen', KeyM: 'mute', KeyH: 'help', Slash: 'help',
    };
    const REPEATABLE = new Set(['fullscreen', 'mute', 'help']);

    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        actions.undo();
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const code = e.code;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        if (!e.repeat && !e.shiftKey) clickContestant(+digit[1] - 1);
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        if (!e.repeat) {
          if (st().phase === 'marking') confirmQuestion();
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
      if (!q.accel) {
        pane.replaceChildren(
          el(
            'div',
            { class: 'panel ob-ed-empty' },
            el('h3', { text: 'Bộ câu hỏi này chưa có vòng Tăng tốc' }),
            el('p', {
              class: 'muted',
              text: 'Vòng 3 gồm 4 câu hỏi, cả lớp trả lời cùng lúc. Ai đúng nhanh nhất được nhiều điểm nhất. Mỗi câu có thể kèm ảnh hoặc video. Điểm các vòng trước được cộng dồn.',
            }),
            el(
              'div',
              { class: 'row center' },
              el('button', { class: 'btn btn-primary', type: 'button', text: '+ Tạo vòng 3', onclick: () => setAccel(D.emptyAccel()) }),
              el('button', { class: 'btn btn-ghost', type: 'button', text: 'Dùng ví dụ mẫu', onclick: () => setAccel(D.sampleAccel()) })
            )
          )
        );
        return;
      }
      const acc = q.accel;
      const stg = q.settings;

      const numInput = (value, limits, onSet, opts = {}) =>
        el('input', {
          class: 'ed-input',
          type: 'number',
          min: limits[0],
          max: limits[1],
          value: value == null ? '' : value,
          placeholder: opts.placeholder,
          title: opts.title,
          'aria-label': opts.label,
          onchange: (e) => {
            if (opts.optional && e.target.value.trim() === '') {
              onSet(null);
            } else {
              const v = D.clampInt(e.target.value, limits, value == null ? limits[0] : value);
              e.target.value = v;
              onSet(v);
            }
            ctx.edited(false);
          },
        });

      const listField = (label, labels, values, limits) =>
        el(
          'div',
          { class: 'field field-wide' },
          el('span', { text: label }),
          el(
            'div',
            { class: 'kp-grid ac-kp-grid' },
            labels.map((l, i) => el('label', { class: 'kp' }, el('span', { text: l }), numInput(values[i], limits, (v) => (values[i] = v))))
          )
        );

      const settingsPanel = el(
        'div',
        { class: 'panel ob-ed-settings' },
        listField('Số giây mỗi câu (khi cột "Thời gian" để trống)', ['Câu 1', 'Câu 2', 'Câu 3', 'Câu 4'], stg.accelSeconds, D.LIMITS.accelSecond),
        listField('Điểm theo thứ tự trả lời đúng', ['Nhanh nhất', 'Thứ 2', 'Thứ 3', 'Thứ 4'], stg.accelPoints, D.LIMITS.accelPoint),
        el(
          'div',
          { class: 'row ob-ed-remove' },
          el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Xoá vòng 3',
            onclick: () => {
              if (confirm('Xoá toàn bộ vòng Tăng tốc?')) setAccel(null);
            },
          })
        )
      );

      const rowsPanel = el(
        'div',
        { class: 'panel ob-ed-rows' },
        el(
          'div',
          { class: 'ac-ed-row ob-ed-head' },
          el('div'),
          el('div', { class: 'ed-q-head', text: 'Câu hỏi' }),
          el('div', { class: 'ed-q-head', text: 'Đáp án' }),
          el('div', { class: 'ed-q-head', text: 'Hình ảnh / Video' }),
          el('div', { class: 'ed-q-head', text: 'Thời gian (giây)' })
        ),
        acc.questions.map((it, i) =>
          el(
            'div',
            { class: 'ac-ed-row' },
            el(
              'div',
              { class: 'ob-ed-label' },
              `Câu ${i + 1}`,
              acc.questions.length > D.ACCEL_QUESTIONS &&
                el('button', {
                  class: 'btn btn-danger ac-ed-del',
                  type: 'button',
                  text: 'Xoá',
                  onclick: () => {
                    acc.questions.splice(i, 1);
                    ctx.edited(false);
                    ctx.refreshEditor();
                  },
                })
            ),
            el('textarea', {
              rows: 3,
              value: it.question,
              placeholder: 'Câu hỏi',
              'aria-label': `Tăng tốc câu ${i + 1} — câu hỏi`,
              oninput: (e) => {
                it.question = e.target.value;
                ctx.edited(false);
              },
            }),
            el('input', {
              class: 'ed-input',
              type: 'text',
              value: it.answer,
              placeholder: 'Đáp án',
              'aria-label': `Tăng tốc câu ${i + 1} — đáp án`,
              oninput: (e) => {
                it.answer = e.target.value;
                ctx.edited(false);
              },
            }),
            mediaCell(it),
            numInput(it.seconds, D.LIMITS.accelSecond, (v) => (it.seconds = v), {
              optional: true,
              placeholder: String(stg.accelSeconds[i] || stg.accelSeconds[stg.accelSeconds.length - 1]),
              title: 'Để trống để dùng số giây trong phần cài đặt phía trên',
              label: `Tăng tốc câu ${i + 1} — số giây`,
            })
          )
        ),
        acc.questions.length < D.ACCEL_QUESTIONS &&
          el(
            'div',
            { class: 'row center' },
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: '+ Thêm câu',
              onclick: () => {
                acc.questions.push(D.emptyAccelQuestion());
                ctx.edited(false);
                ctx.refreshEditor();
              },
            })
          )
      );

      pane.replaceChildren(settingsPanel, rowsPanel);
    }

    /** Image or video for one question: preview, pick from this computer, or type a path. */
    function mediaCell(it) {
      const box = el('div', { class: 'ed-img ac-ed-media' });
      function draw() {
        const kind = D.mediaKind(it.media);
        const parts = [];
        if (kind === 'image') {
          const img = el('img', { class: 'ed-img-thumb', alt: '' });
          img.onerror = () => img.replaceWith(el('div', { class: 'ed-img-broken', text: 'Không tải được ảnh: ' + it.media }));
          ctx.mediaUrl(it.media).then((u) => (img.src = u));
          parts.push(img);
        } else if (kind === 'video') {
          const v = el('video', { class: 'ed-img-thumb', muted: true, preload: 'metadata', controls: true });
          v.onerror = () => v.replaceWith(el('div', { class: 'ed-img-broken', text: 'Không phát được video: ' + it.media }));
          ctx.mediaUrl(it.media).then((u) => {
            if (u) v.src = u;
            else v.replaceWith(el('div', { class: 'ed-img-broken', text: 'Không còn video này trong trình duyệt — hãy chọn lại.' }));
          });
          parts.push(v);
        }
        const local = it.media.startsWith('data:') || it.media.startsWith('idb:');
        parts.push(
          el('input', {
            class: 'ed-input ed-optional',
            type: 'text',
            value: local ? '' : it.media,
            placeholder: local ? (kind === 'video' ? 'Video chọn từ máy' : 'Ảnh chọn từ máy') : 'Đường dẫn, vd. videos/cau1.mp4',
            'aria-label': 'Đường dẫn ảnh hoặc video',
            onchange: (e) => {
              it.media = e.target.value.trim();
              ctx.edited(false);
              draw();
            },
          }),
          el(
            'div',
            { class: 'row' },
            el('button', { class: 'btn btn-ghost', type: 'button', text: '+ Ảnh', onclick: () => ctx.pickImage(it, draw, 'media') }),
            el('button', { class: 'btn btn-ghost', type: 'button', text: '+ Video', onclick: () => pickVideo(it, draw) }),
            it.media &&
              el('button', {
                class: 'btn btn-ghost',
                type: 'button',
                text: '✕',
                title: 'Bỏ ảnh / video',
                onclick: () => {
                  it.media = '';
                  draw();
                  ctx.edited(false);
                },
              })
          )
        );
        box.replaceChildren(...parts);
      }
      draw();
      return box;
    }

    const BIG_VIDEO = 300 * 1024 * 1024;

    function pickVideo(it, done) {
      const input = $('ed-video-input');
      input.value = '';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        if (
          f.size > BIG_VIDEO &&
          !confirm(`Video này nặng ${Math.round(f.size / 1048576)} MB và sẽ được lưu trong trình duyệt. Nên đặt video cạnh index.html và nhập đường dẫn thay vì chọn tệp. Vẫn tiếp tục?`)
        ) {
          return;
        }
        const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        if (!(await root.Store.saveMedia(id, f))) {
          toast('Trình duyệt không cho lưu video này — hãy dùng đường dẫn tới tệp.', 4000);
          return;
        }
        it.media = 'idb:' + id;
        done();
        ctx.edited(false);
      };
      input.click();
    }

    function setAccel(acc) {
      quiz().accel = acc;
      ctx.edited(false);
      ctx.refreshEditor();
    }

    /* ========================================================= */

    function leave() {
      stopLoop();
      stopVideo();
      fixing = false;
      built = false;
      cardQ = null;
    }

    function bind() {
      document.querySelectorAll('#screen-accel [data-ac]').forEach((b) =>
        b.addEventListener('click', () => {
          b.blur();
          actions[b.dataset.ac]();
        })
      );
      $('ac-video').addEventListener('ended', onVideoEnded);
      $('ac-video').addEventListener('error', () => {
        if ($('ac-video').getAttribute('src')) mediaError('Không phát được video này — nhấn Space để bắt đầu tính giờ.');
      });
      let idleTimer = 0;
      const screen = $('screen-accel');
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
        tm.q = undefined;
        stopLoop();
      },
    };
  };
})(window);
