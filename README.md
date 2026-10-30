# Thử thách tri thức — classroom quiz presenter

An Olympia-style quiz for the projector, in three rounds. The interface is in Vietnamese.

- **Vòng 1 · Khởi động (Warm-up):** each contestant answers all their questions in a
  row; correct = +points, wrong = 0.
- **Vòng 2 · Vượt chướng ngại vật (Obstacle):** a hidden keyword and a picture
  covered by 5 pieces. Everyone answers each row on paper; each correct contestant
  gets +10 and a solved row opens its corner. Contestants can buzz to guess the
  keyword at any time until the center question is scored (70 → 30 points the later
  it gets). After that nobody can guess; the teacher just opens the keyword. A wrong
  guess only removes the right to guess again. Scores carry over from round 1.
- **Vòng 3 · Tăng tốc (Acceleration):** 4 questions (10, 20, 30, 40 s), each with
  an optional image or video. Everyone answers on a board at the same time; the
  teacher clicks names in the order the boards go up. After the reveal the wrong
  ones are unticked and the correct answers score by speed: 40, 30, 20, 10.
  Wrong = 0. Scores carry over from rounds 1 and 2.

Rounds 2 and 3 are optional. Without them the app works exactly like a single
Warm-up round. Each round's results show the running total and a button to the
next round; the results after the last round are the final ones.

## Run it

Double-click `index.html` (Chrome, Edge or Firefox). No internet, install or
server needed. If your browser blocks local files, run a simple server instead:

```
python -m http.server 8000      # then open http://localhost:8000
```

## Prepare questions

1. Open `mau-cau-hoi.xlsx` (or download the template from the home screen).
2. Sheet **Câu hỏi**: one row per question —
   `Thí sinh | Câu | Câu hỏi | Đáp án | Hình ảnh (tùy chọn)`.
   - A blank *Thí sinh* cell continues the contestant above (merged cells are fine).
   - *Câu* sets the order; leave it out to use row order.
   - *Hình ảnh*: a path relative to `index.html` (e.g. `images/ban-do.png`) or a URL.
     You can also pick an image from your computer in the editor.
3. Sheet **Cài đặt** (optional): *Tên cuộc thi*, *Số giây mỗi câu* (5–300),
   *Điểm mỗi câu*, *Số câu mỗi thí sinh*. Defaults: 30 s, 10 points, 4 questions.
4. Drag the file onto the home screen, check it in the editor, press **Bắt đầu**.

5. Sheet **Vượt chướng ngại vật** (optional, round 2): columns
   `Mục | Câu hỏi | Đáp án | Hình ảnh | Ô chữ (tùy chọn)` with these rows:
   - `Từ khóa`: the keyword in *Đáp án*, the hidden picture in *Hình ảnh*
   - `Hàng 1` … `Hàng 4`: the row questions and answers
   - `Trung tâm`: the center question (playable after all 4 rows)

   Letter boxes show the answer in capitals without accents, with spaces as gaps
   ("Ánh sáng" → `ANH SANG`). Use *Ô chữ* to show different letters than the
   written answer, e.g. answer "Hà Nội (thủ đô)", boxes "Hà Nội".
   Settings for round 2 (in **Cài đặt**): *Số giây mỗi hàng ngang* (15),
   *Điểm mỗi hàng ngang* (10), *Điểm từ khóa* (`70, 60, 50, 40, 30`: before
   row 1, after 1, 2, 3, 4 rows; a guess during the center question is worth the
   last value). Older files with a 6th value still load; the 6th is ignored.

6. Sheet **Tăng tốc** (optional, round 3): columns
   `Câu | Câu hỏi | Đáp án | Hình ảnh/Video | Thời gian`, one row per question,
   exactly 4 questions.
   - *Hình ảnh/Video*: a path relative to `index.html` or a URL. Paths ending in
     `.mp4`, `.webm`, `.mov`, `.m4v` or `.ogv` are played as video
     (e.g. `videos/cau-2.mp4`); anything else is shown as an image.
     You can also pick an image or video from your computer in the editor.
     Big videos are better as a path next to `index.html` than picked into the browser.
   - *Thời gian*: seconds for this question; leave it blank to use the setting.

   Settings for round 3 (in **Cài đặt**): *Số giây vòng Tăng tốc*
   (`10, 20, 30, 40`, question 1–4) and *Điểm vòng Tăng tốc*
   (`40, 30, 20, 10`, fastest correct answer first).

CSV works too (UTF-8 or Excel's default Vietnamese encoding, comma or semicolon),
but holds only the Warm-up questions. Add rounds 2 and 3 and settings in the
editor (tabs *Vòng 2*, *Vòng 3*). Allowed contestants: 2–6.

Everything (questions, images, progress) is saved in the browser, so a refresh or
accidentally closed tab can be resumed from the home screen. Images and videos
picked in the editor live only in this browser. They are not written to the
exported Excel file.

## Shortcuts: round 1 (Khởi động)

| Key | Action |
| --- | --- |
| `Space` `→` `PgDn` | Reveal answer / next question (works with presenter clickers) |
| `←` `PgUp` | Previous question (re-score it with C/X) |
| `C` / `X` | Correct (+points) / Wrong (0) |
| `S` | Skip (0 points, shown as "bỏ qua") |
| `U` or `Ctrl+Z` | Undo the latest score |
| `T` / `R` | Pause-resume / reset the timer (reset also flips an unscored card back) |
| `F` / `M` / `?` | Fullscreen / mute / shortcut help |

When the timer hits 0 a buzzer plays and the card flips. The teacher still scores.

## Shortcuts: round 2 (Vượt chướng ngại vật)

Number keys do one thing at a time. The badge above the board always shows the
current mode (cyan **Chọn hàng ngang** = choosing a row, gold **Chấm điểm** = ticking).

| Key | Action |
| --- | --- |
| `1`–`4`, `5` | *Choosing:* play row 1–4 / the center question |
| `1`–`6` | *Ticking:* mark a contestant correct (press again to unmark) |
| `Enter` | Confirm the ticks: +points, opens the corner if anyone was right |
| `Space` `→` | Start round / reveal answer / open the keyword once every question is played / go to the final results |
| `←` | Back to the board (before the answer is shown) |
| `Shift`+`1`–`6` or the bell on a name | Contestant buzzes for the keyword → `C` correct / `X` wrong / `←` cancel |
| `K` | Open the keyword (nobody solved it, no keyword points; asks first if questions are left) |
| `U` or `Ctrl+Z` | Undo the last action (scored row, wrong guess, keyword) |
| `T` / `R` | Pause-resume / reset the row timer (it also pauses during a buzz) |

## Shortcuts: round 3 (Tăng tốc)

The badge above the card shows what number keys do right now.

| Key | Action |
| --- | --- |
| `Space` `→` | Start round / start the clock (skips the rest of a video) / reveal answer / next question / results |
| `1`–`6` or click a name | *Clock running:* board goes up, in order (press again to take it out) |
| `1`–`6` | *Marking:* untick a wrong answer (press again to tick) |
| `O` | *Marking:* fix the order — number keys take a board out or add it at the end |
| `Enter` | Confirm the marking: points by speed among the correct answers |
| `V` | Replay the video (before the clock starts) |
| `U` or `Ctrl+Z` | Undo the last action (a board, a tick, the reveal, a confirmed question) |
| `T` / `R` | Pause-resume (or start) / reset the clock |
| `←` | On the round 3 title screen: back to the previous results |

A question with a video plays it first; the clock starts when the video ends (or
on `Space`/`T`). At 0 the buzzer sounds and the answer is shown automatically.
Video plays with sound; `M` mutes it together with the app sounds. The test
browser used for automated checks cannot play `.mp4` (H.264); Chrome and Edge can.

## Project layout

```
index.html          screens markup
css/style.css       theme (sizes in vh so text scales with the projector)
js/quiz.js          Warm-up state engine — pure functions, unit-tested
js/obstacle.js      Obstacle round engine — pure functions, unit-tested
js/obstacle-ui.js   Obstacle screen, row timer, buzz dialog, editor tab
js/accel.js         Acceleration round engine — pure functions, unit-tested
js/accel-ui.js      Acceleration screen, clock, video, answer order, editor tab
js/data.js          Excel/CSV parsing, validation, template + export
js/app.js           UI: screens, timer, keyboard, persistence wiring
js/storage.js       IndexedDB (quiz, picked videos) + localStorage (progress)
js/sound.js         original Web Audio sound effects
js/confetti.js      results confetti
vendor/             SheetJS 0.20.3 (offline copy)
fonts/              Be Vietnam Pro (SIL OFL), full Vietnamese support
```

Tests: `node --test` (Node 18+).
