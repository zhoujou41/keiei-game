// field.js — FIELD画面（店舗の現場）のUI・「ディレクター」役
// core/simulation.jsが確定させた1本の beats 配列（1行のテキスト＝1つの演出アクション）を、
// 曜日ごとにグループ化して受け取り、1行ずつ「テキスト表示」と「Game.UI.Scene.playBeat()呼び出し」を
// 同じタイミングでセットで進める。これにより、表示されているテキストと店内の動きが必ず対応する。
// また曜日タブ／前後の日ボタンで、任意の曜日だけを選んで見返すこともできる
// （各日の見た目はGame.UI.Scene.startDay()でリセットされるため、日をまたいだ動線の引き継ぎはない）。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var RESULT_DAY = 8;
  var DAY_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  var DAY_LABELS = { 0: "準備", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土", 7: "日", 8: "結果" };

  var FAST_DELAY = 130;
  function delayForBeat(beat) {
    if (beat.action) return 950; // 客の入退店・配膳など、動きが伴うものは見えるだけの間を置く
    if (beat.kind === "day") return 650; // 曜日の切り替わり
    return 480; // ただのテキスト情報
  }

  var sceneInited = false;
  var allBeats = [];
  var beatsByDay = {};
  var currentResult = null;

  var currentDay = -1; // -1 = まだ営業開始前（start()からの最初のjumpToDay(0)を必ず実行させるための番兵値）
  var dayBeats = [];
  var playIndexInDay = 0;
  var lastLines = []; // 直近3行のみ保持（表示用ローリングバッファ）
  var dayLiveCounts = { served: 0, left: 0, stockout: 0 };

  var playing = false;
  var playTimer = null;
  var fastMode = false;

  // バグ修正8（「消えるバグ」対応）: その日のログを全て表示し終えても、まだ調理中・
  // 食事中などサービス継続中の客がその場に残っていることがある（バグ修正3参照）。
  // 「次の日へ進む」操作（自動遷移・手動ボタンのどちらも）で問答無用にその客たちを
  // 即座に消してしまうと、食事中の客が前触れなく一瞬で消えたように見えてしまう。
  // 残っている客が自然にいなくなるまで、次の日への進行を少し待たせるための状態。
  var waitingToAdvance = false;
  var waitClearTimer = null;
  var pendingJumpDay = null;
  var WAIT_CLEAR_POLL_MS = 180;
  var WAIT_CLEAR_TIMEOUT_MS = 15000; // 安全弁：万一いつまでも客が残り続ける不具合が
  // 起きても、次の日へ進めなくなって完全に詰んでしまうことが無いようにする上限。

  function clearWaitToAdvance() {
    if (waitClearTimer) {
      clearTimeout(waitClearTimer);
      waitClearTimer = null;
    }
    if (waitingToAdvance) {
      // 待機中に一時停止／結果スキップ等で中断された場合、ボタンの無効化状態や
      // 後片付け用の早送り速度が残ったままにならないよう明示的に戻す（見た目の
      // ラベルはこの後の各処理のupdateNavButtons()/updatePlayButtonLabel()が
      // 正しい状態に上書きする）。
      var nextBtn = el("field-btn-nextday");
      if (nextBtn) nextBtn.disabled = currentDay >= RESULT_DAY;
      var prevBtn = el("field-btn-prevday");
      if (prevBtn) prevBtn.disabled = currentDay <= 0;
      var playBtn = el("field-btn-play");
      if (playBtn) playBtn.disabled = false;
      var tabsEl = el("field-day-tabs");
      if (tabsEl) tabsEl.style.pointerEvents = "";
      Game.UI.Scene.setSpeed(fastMode ? 3 : 1);
    }
    waitingToAdvance = false;
    pendingJumpDay = null;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function fmt(n) {
    return Math.round(n).toLocaleString();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // その曜日の「日々の未来視」（週の始めに生成済みのstate.currentWeekForesightを再掲するだけ。
  // ここで新しく生成し直したりはしない＝OFFICE画面で見たものと必ず一致する）。
  function renderForesightPanel() {
    var panelEl = el("field-foresight");
    if (!panelEl) return;
    var foresight = Game.App.state.currentWeekForesight;
    var dayData = foresight && foresight.days ? foresight.days.find(function (d) { return d.day === currentDay; }) : null;
    if (!dayData || currentDay === 0 || currentDay === RESULT_DAY) {
      panelEl.innerHTML = "";
      return;
    }
    var lines = dayData.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("");
    panelEl.innerHTML =
      '<div class="foresight-panel"><div class="foresight-title">🔮 ' + dayData.label + "曜日の未来視</div><ul>" + lines + "</ul></div>";
  }

  function clampDay(d) {
    return Game.Core.Random.clamp(d, 0, RESULT_DAY);
  }

  function ensureScene() {
    if (!sceneInited) {
      Game.UI.Scene.init(el("scene-container"));
      sceneInited = true;
    }
    ensureDayTabsWired();
  }

  var dayTabsWired = false;
  function ensureDayTabsWired() {
    if (dayTabsWired) return;
    dayTabsWired = true;
    el("field-day-tabs").addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".day-tab") : null;
      if (!btn) return;
      requestJumpToDay(parseInt(btn.getAttribute("data-day"), 10));
    });
  }

  // ================= 曜日ごとのグループ化 =================
  function groupBeatsByDay() {
    beatsByDay = {};
    DAY_KEYS.forEach(function (d) {
      beatsByDay[d] = [];
    });
    allBeats.forEach(function (b) {
      if (!beatsByDay[b.day]) beatsByDay[b.day] = [];
      beatsByDay[b.day].push(b);
    });
  }

  function countStats(list) {
    var c = { served: 0, left: 0, stockout: 0 };
    list.forEach(function (entry) {
      if (entry.kind === "sale") c.served++;
      if (entry.kind === "leave") c.left++;
      if (entry.kind === "stockout") c.stockout++;
    });
    return c;
  }

  // ================= 描画 =================
  function renderDayTabs() {
    el("field-day-tabs").innerHTML = DAY_KEYS.map(function (d) {
      var cls = "day-tab" + (d === currentDay ? " active" : "");
      return '<button type="button" class="' + cls + '" data-day="' + d + '">' + DAY_LABELS[d] + "</button>";
    }).join("");
  }

  function renderStatusRow() {
    el("field-status-row").innerHTML =
      '<div class="status-chip">🧍 提供 <b id="stat-served">' + dayLiveCounts.served + "</b></div>" +
      '<div class="status-chip">🚶 離脱 <b id="stat-left">' + dayLiveCounts.left + "</b></div>" +
      '<div class="status-chip">🚫 売切商品 <b id="stat-stockout">' + dayLiveCounts.stockout + "</b></div>";
  }

  function renderLogLines() {
    var logEl = el("field-log");
    if (lastLines.length === 0) {
      logEl.innerHTML = '<div class="log-line muted-line">' + (dayBeats.length === 0 ? "この日は特に大きな動きはなかった。" : "・・・") + "</div>";
      return;
    }
    logEl.innerHTML = lastLines
      .map(function (entry, idx) {
        var cls = "log-line " + entry.kind + (idx === lastLines.length - 1 ? " current" : " past");
        return '<div class="' + cls + '"><span class="icon">' + entry.icon + "</span>" + entry.text + "</div>";
      })
      .join("");
  }

  function updatePlayButtonLabel() {
    var btn = el("field-btn-play");
    if (waitingToAdvance) return; // 待機表示中は他の描画処理でラベルを上書きしない
    if (playing) {
      btn.textContent = "⏸ 一時停止";
      btn.classList.remove("btn-primary");
    } else if (playIndexInDay >= dayBeats.length && dayBeats.length > 0 && currentDay !== RESULT_DAY) {
      btn.textContent = "▶ 次の日へ進む";
      btn.classList.add("btn-primary");
    } else {
      btn.textContent = "▶ 再生";
      btn.classList.remove("btn-primary");
    }
  }

  function updateNavButtons() {
    el("field-btn-prevday").disabled = currentDay <= 0;
    el("field-btn-nextday").disabled = currentDay >= RESULT_DAY;
  }

  // ================= 再生ロジック =================
  function pushLine(beat) {
    lastLines.push(beat);
    if (lastLines.length > 3) lastLines.shift();
    if (beat.kind === "sale") dayLiveCounts.served++;
    if (beat.kind === "leave") dayLiveCounts.left++;
    if (beat.kind === "stockout") dayLiveCounts.stockout++;
    renderLogLines();
    renderStatusRow();
  }

  function step() {
    var beat = dayBeats[playIndexInDay];
    pushLine(beat);
    if (beat.action) Game.UI.Scene.playBeat(beat.action);
    playIndexInDay++;
  }

  function scheduleStep() {
    if (!playing) return;
    if (playIndexInDay >= dayBeats.length) {
      dayFinished();
      return;
    }
    var delay = fastMode ? FAST_DELAY : delayForBeat(dayBeats[playIndexInDay]);
    playTimer = setTimeout(function () {
      step();
      scheduleStep();
    }, delay);
  }

  function play() {
    if (playing) return;
    if (waitingToAdvance) return; // 既に次の日への待機中
    if (playIndexInDay >= dayBeats.length) {
      // この日は最後まで再生済み → 「次の日へ進む」ボタンとして機能させる
      if (currentDay !== RESULT_DAY) nextDay();
      return;
    }
    playing = true;
    Game.UI.Scene.resume();
    updatePlayButtonLabel();
    scheduleStep();
  }

  function pause() {
    clearWaitToAdvance();
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    Game.UI.Scene.pause();
    updatePlayButtonLabel();
  }

  function togglePlay() {
    if (playing) {
      pause();
    } else {
      play();
    }
  }

  function toggleSpeed() {
    fastMode = !fastMode;
    Game.UI.Scene.setSpeed(fastMode ? 3 : 1);
    el("field-btn-speed").classList.toggle("active", fastMode);
    el("field-btn-speed").textContent = fastMode ? "⏩ 倍速中" : "⏩ 倍速";
    if (playing) {
      // 次のstepから新しい間隔を反映させるため、いったん再スケジュール
      if (playTimer) {
        clearTimeout(playTimer);
        playTimer = null;
      }
      scheduleStep();
    }
  }

  function dayFinished() {
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    // 注意: ここでGame.UI.Scene.pause()を呼んではいけない。
    // その日のbeat（ログ行）を全て表示し終えた時点では、実際の店内アニメーション
    // （客が席へ歩く・調理・配膳・食事・会計・退店など）はbeatの表示間隔（約0.5〜1秒）より
    // ずっと長い時間がかかるため、まだ動いている途中のキャラクターが何人も残っている。
    // ここでScene側のアニメーションループ（requestAnimationFrame）まで止めてしまうと、
    // 「毎日ある程度まで進んだところで動きが固まって見える」不具合になっていた
    // （2026-09-21 バグ修正3）。ここで止めるのはfield.js側の「次のbeatの予約」だけにし、
    // Scene側は途中の客が自然にアニメーションを終えるまで動き続けさせる。
    // 明示的に一時停止ボタンが押された場合（pause()）やスキップ（skipToEnd()）の場合は
    // 従来通りScene側も止める。
    updatePlayButtonLabel();
    if (currentDay === RESULT_DAY) {
      showResult();
    }
  }

  // ================= 曜日ナビゲーション =================
  function jumpToDay(day) {
    day = clampDay(day);
    pause();
    currentDay = day;
    dayBeats = beatsByDay[day] || [];
    playIndexInDay = 0;
    lastLines = [];
    dayLiveCounts = day === RESULT_DAY ? countStats(allBeats) : { served: 0, left: 0, stockout: 0 };
    el("field-result").classList.remove("show");

    renderDayTabs();
    renderLogLines();
    renderStatusRow();
    renderForesightPanel();
    updateNavButtons();
    updatePlayButtonLabel();

    Game.UI.Scene.startDay();

    if (dayBeats.length === 0) {
      updatePlayButtonLabel();
      return;
    }
    play();
  }

  function prevDay() {
    requestJumpToDay(currentDay - 1);
  }

  // バグ修正9（「消えるバグ」の再修正 — バグ修正8の抜け穴）: バグ修正8では
  // 「▶ 次の日へ進む」ボタン（nextDay経由）だけを、客が残っている間は待たせるように
  // していた。しかし曜日タブを直接クリックする操作・「◀ 前の日」ボタンも、内部的には
  // 同じjumpToDay()（＝Game.UI.Scene.startDay()で客を問答無用に即座に消す処理）を
  // 直接呼んでおり、無防備なままだった。曜日タブのクリックはごく普通の操作であり、
  // 「しょっちゅう消える」という再報告の主因はこちらだったと判断した。日付・曜日を
  // 切り替えるすべての入り口（曜日タブ・前の日・次の日）を、この共通の
  // requestJumpToDay()を経由させることで統一的に保護する。
  function requestJumpToDay(day) {
    day = clampDay(day);
    if (day === currentDay) return; // 今表示している日と同じなら何もしない（無意味な再生成・消失を防ぐ）
    if (waitingToAdvance) return; // 既に別の日への切り替えを待機中（二重起動防止）
    // バグ修正9・補足: 「◀ 前の日／次の日 ▶」の手動ナビゲーションボタンは、その日の
    // beatがまだ再生中（playing===true、テキストが1行ずつ表示され続けている最中）でも
    // 押せてしまう。ここでbeatの予約（field.js側のsetTimeoutループ）を止めずに客が
    // いなくなるのを待ち始めると、待っている間も裏でその日の残りのbeatが引き続き
    // 送り込まれ続け、新しい客がどんどん入店してきて「いつまでも客がいなくならない」
    // 「後片付け用の高速倍率中に次々入店してきて再び重なる」といった状態になっていた。
    // 実際の店内アニメーション（Scene側）は止めずに、field.js側の「次のbeatを予約する」
    // 処理だけを止めておく（Scene.pause()は呼ばない＝pause()とは異なり残っている客の
    // 退店アニメーションはそのまま進む）。
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (Game.UI.Scene.hasActiveCustomers()) {
      beginWaitThenJump(day);
    } else {
      jumpToDay(day);
    }
  }

  function nextDay() {
    requestJumpToDay(currentDay + 1);
  }

  var CLEANUP_SPEED_MULT = 8; // 残っている客の後片付け中だけ使う早送り倍率

  function beginWaitThenJump(day) {
    waitingToAdvance = true;
    pendingJumpDay = day;
    var waitStart = Date.now();
    var playBtn = el("field-btn-play");
    var nextBtn = el("field-btn-nextday");
    var prevBtn = el("field-btn-prevday");
    if (playBtn) {
      playBtn.disabled = true;
      playBtn.textContent = "⏳ 退店をお待ちください…";
      playBtn.classList.remove("btn-primary");
    }
    if (nextBtn) nextBtn.disabled = true;
    if (prevBtn) prevBtn.disabled = true;
    var tabsEl = el("field-day-tabs");
    if (tabsEl) tabsEl.style.pointerEvents = "none"; // 待機中は曜日タブでの二重切り替えも防ぐ
    // タイマー/アニメーションループが止まっていると客がいつまでも退店し終わらないため、
    // 明示的に一時停止中だった場合でも動かしておく。加えて、この「後片付け」区間だけは
    // プレイヤーの体感速度を損なわないよう、大きく早送りして一気に片付ける
    // （経済シミュレーション側の結果には一切影響しない。見た目の演出速度だけの変更）。
    Game.UI.Scene.resume();
    Game.UI.Scene.setSpeed(CLEANUP_SPEED_MULT);

    function poll() {
      if (!waitingToAdvance) return; // pause()等で途中キャンセルされた
      var cleared = !Game.UI.Scene.hasActiveCustomers();
      var timedOut = Date.now() - waitStart > WAIT_CLEAR_TIMEOUT_MS;
      if (cleared || timedOut) {
        var target = pendingJumpDay;
        waitingToAdvance = false;
        pendingJumpDay = null;
        waitClearTimer = null;
        if (playBtn) playBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (prevBtn) prevBtn.disabled = false;
        if (tabsEl) tabsEl.style.pointerEvents = "";
        Game.UI.Scene.setSpeed(fastMode ? 3 : 1); // 通常の速度設定に戻す
        jumpToDay(target);
        return;
      }
      waitClearTimer = setTimeout(poll, WAIT_CLEAR_POLL_MS);
    }
    waitClearTimer = setTimeout(poll, WAIT_CLEAR_POLL_MS);
  }

  function skipToEnd() {
    pause();
    currentDay = RESULT_DAY;
    dayBeats = beatsByDay[RESULT_DAY] || [];
    playIndexInDay = dayBeats.length;
    lastLines = dayBeats.slice(-3);
    dayLiveCounts = countStats(allBeats);
    Game.UI.Scene.skipToEnd();

    renderDayTabs();
    renderLogLines();
    renderStatusRow();
    renderForesightPanel();
    updateNavButtons();
    showResult();
  }

  // ================= 週の結果表示 =================
  function showResult() {
    var s = Game.App.state;
    var r = currentResult;
    var goalHtml = "";
    if (r.goalCheck) {
      goalHtml =
        '<div class="goal-banner ' + (r.goalCheck.success ? "success" : "fail") + '">' +
          (r.goalCheck.success ? "🏆 経営目標を達成しました！" : "⚠️ 経営目標を達成できませんでした。経営に悪影響が出ています。") +
        "</div>";
    }
    el("field-result").innerHTML =
      goalHtml +
      '<div class="result-grid">' +
        '<div class="result-item"><div class="label">売上</div><div class="value">' + fmt(r.revenue) + "円</div></div>" +
        '<div class="result-item"><div class="label">利益</div><div class="value ' + (r.profit >= 0 ? "good" : "bad") + '">' + fmt(r.profit) + "円</div></div>" +
        '<div class="result-item"><div class="label">来店・提供数</div><div class="value">' + r.served + "人</div></div>" +
        '<div class="result-item"><div class="label">離脱数</div><div class="value ' + (r.leftWaiting + r.leftDisappointed > 5 ? "bad" : "") + '">' + (r.leftWaiting + r.leftDisappointed) + "人</div></div>" +
        '<div class="result-item"><div class="label">評判変化</div><div class="value ' + (r.repDelta >= 0 ? "good" : "bad") + '">' + (r.repDelta >= 0 ? "+" : "") + r.repDelta + "</div></div>" +
        '<div class="result-item"><div class="label">所持金</div><div class="value ' + (r.money < 0 ? "bad" : "") + '">' + fmt(r.money) + "円</div></div>" +
      "</div>" +
      '<div class="row" style="justify-content:center;margin-top:10px;">' +
        '<button class="btn btn-primary" id="field-btn-next">次の週の準備へ ▶</button>' +
      "</div>";
    var nextBtn = el("field-btn-next");
    if (nextBtn) nextBtn.addEventListener("click", nextTurn);
    el("field-result").classList.add("show");

    if (s.gameOver) {
      el("gameover-title").textContent = "GAME OVER";
      el("gameover-reason").textContent = s.gameOverReason || "";
      el("gameover-week").textContent = "第" + s.week + "週まで営業しました。";
      el("gameover-overlay").classList.add("show");
    }
  }

  function nextTurn() {
    el("field-result").classList.remove("show");
    Game.UI.Scene.clear();
    Game.App.switchTab("office");
    Game.App.renderAll();
  }

  // ---- エントリポイント：営業開始直後に呼ばれる ----
  function start(beats, result) {
    ensureScene();
    allBeats = beats || [];
    currentResult = result;
    groupBeatsByDay();
    Game.UI.Scene.startWeek(Game.App.state.layout);
    jumpToDay(0);
  }

  function renderIdle() {
    ensureScene();
    Game.UI.Scene.renderIdle(el("scene-container"));
    el("field-day-tabs").innerHTML = "";
    if (el("field-foresight")) el("field-foresight").innerHTML = "";
    renderStatusRow();
    if (allBeats.length === 0) {
      el("field-log").innerHTML = '<div class="log-line muted-line">まだ今週の営業を開始していません。OFFICE画面で設定して「営業開始」を押してください。</div>';
    }
  }

  Game.UI.Field = {
    start: start,
    togglePlay: togglePlay,
    toggleSpeed: toggleSpeed,
    skipToEnd: skipToEnd,
    prevDay: prevDay,
    nextDay: nextDay,
    nextTurn: nextTurn,
    renderIdle: renderIdle,
  };
})();
