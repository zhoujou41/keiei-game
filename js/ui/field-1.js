// field.js — FIELD画面（店舗の現場）のUI・「ディレクター」役
// 数値計算（売上・客数など）は core/simulation.jsが既に確定させている。
// このモジュールは「1つのbeat（テキスト1行に対応する演出アクション）」を受け取って
// その場で実行するだけの、受動的な描画エンジンになっている。どの行が再生されているかは
// field.js（ディレクター役）が管理し、beatを渡すタイミング＝そのテキストが表示される
// タイミングなので、テキストと店内の動きは常に対応する。
//
// 2026-09-22（フィールド全面改修）: ユーザー要望「携帯で1画面に収まるようにしてほしい／
// 月〜日を1回の開始で連続再生してほしい／伸びる進捗インジケータでどこかわかるように
// してほしい（クリックでその時点に戻れる）／停止・開始・倍速を指定できるように／
// 1日8秒程度で終わるように／客がいない時間帯は表示不要／商品ごとの販売・仕入・利益を
// リアルタイムで見えるように」に対応した全面改修。
//   - 日タブ・週全体の未来視パネル・複数行ログ・提供/離脱/売切チップは廃止し、
//     「伸びる進捗バー（クリックでその日へジャンプ）」「商品ごとの販売/仕入・利益」
//     「直近1行だけのログ」に集約してモバイル1画面に収めた。
//   - これまでは日が終わるたびに再生が止まり、「▶ 次の日へ進む」を都度手動で押す
//     必要があったが、これを「日が終われば自動的に次の日へ進む」方式に変えた
//     （＝営業開始を1回押せば月〜日→結果まで自動的に流れる。一時停止ボタンで
//     いつでも止められる）。
//   - 「客がいない時間帯の表示は不要」について：もともとsimulation.jsのbeat生成は
//     「何か起きたティックだけ」beatを作る設計（何も起きないティックはbeat自体が
//     存在しない）だったため、これは元から満たされていた。今回は「1日が長すぎたり
//     短すぎたりしても常に約8秒で終わる」よう、beatごとの表示間隔をその日のbeat数に
//     応じて動的に配分する方式に変更した（＝結果的に「間延びした無音区間」が生じない）。
//   - 「客の会計が終わったら品目ごとの販売/仕入・利益を増やして分かるようにして」に
//     ついて：経済シミュレーション上、売上・数量が確定するのはserve_batch beat
//     （厨房処理能力で注文が完了した瞬間）であり、レジでの会計演出（scene.js側の
//     見た目の遅延演出）に対応するbeat/イベントはデータ上存在しない。売上・個数の
//     「事実」はserve_batch beatの時点で既に確定しているため、これをそのまま
//     「商品ごとの販売数・利益」のリアルタイム更新のトリガーとして使った
//     （体感としては会計演出とほぼ同じタイミングで増える）。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var RESULT_DAY = 8;

  // 倍速指定（停止・開始・倍速を指定できるように）。ボタンを押すたびに巡回する。
  var SPEEDS = [1, 2, 3, 5];
  var speedIndex = 0;
  function currentSpeed() {
    return SPEEDS[speedIndex];
  }

  // 1日の目安再生時間（1倍速のとき）。実際の速度はcurrentSpeed()で割って短縮する。
  var DAY_TARGET_MS = 8000;
  var MIN_BEAT_MS = 55;
  var MAX_BEAT_MS = 850;

  var sceneInited = false;
  var allBeats = [];
  var beatsByDay = {};
  var currentResult = null;

  var currentDay = -1; // -1 = まだ営業開始前（start()からの最初のjumpToDay(0)を必ず実行させるための番兵値）
  var dayBeats = [];
  var dayBeatDelays = []; // dayBeatsと同じ長さ。各beatの表示間隔(ms、1倍速基準)
  var playIndexInDay = 0;
  var currentLine = null; // 直近1行だけを表示（モバイル1画面対応のため複数行ログは廃止）

  // 商品ごとの「販売/仕入・利益」をリアルタイム表示するための状態。
  // 仕入(stock)は週の開始時点で確定済みの固定値なので、週の頭で1回だけ読み取ればよいが、
  // 販売数・利益は日をまたいで累積し、日付ジャンプ時にも正しい値に巻き戻す必要がある。
  // そのため「各日の開始時点での累積値」をstart()時点で全beat分を先読みして事前計算し
  // （dayStartItemStats）、実際の再生ではその日の開始値から1beatずつ増分するだけにする
  // （＝日付を行き来しても二重加算・値のズレが起きない）。
  var dayStartItemStats = {}; // day -> { productId: { sold, profit } }
  var liveItemStats = {}; // 現在表示中の日について、再生が進むごとに更新される値

  var playing = false;
  var playTimer = null;

  // バグ修正8（「消えるバグ」対応）: その日のログを全て表示し終えても、まだ調理中・
  // 食事中などサービス継続中の客がその場に残っていることがある（バグ修正3参照）。
  // 「次の日へ進む」操作（自動遷移・手動ボタンのどちらも）で問答無用にその客たちを
  // 即座に消してしまうと、食事中の客が前触れなく一瞬で消えたように見えてしまう。
  // 残っている客が自然にいなくなるまで、次の日への進行を少し待たせるための状態。
  var waitingToAdvance = false;
  var waitClearTimer = null;
  var pendingAfterWait = null; // 待機完了後に実行する関数（日付ジャンプ／週スキップ等、呼び出し元で内容が変わる）
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
      var playBtn = el("field-btn-play");
      if (playBtn) playBtn.disabled = false;
      var barEl = el("field-progress-bar");
      if (barEl) barEl.style.pointerEvents = "";
      Game.UI.Scene.setSpeed(currentSpeed());
    }
    waitingToAdvance = false;
    pendingAfterWait = null;
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

  function clampDay(d) {
    return Game.Core.Random.clamp(d, 0, RESULT_DAY);
  }

  function ensureScene() {
    if (!sceneInited) {
      Game.UI.Scene.init(el("scene-container"));
      sceneInited = true;
    }
    ensureProgressBarWired();
  }

  var progressBarWired = false;
  function ensureProgressBarWired() {
    if (progressBarWired) return;
    progressBarWired = true;
    el("field-progress-bar").addEventListener("click", function (e) {
      var seg = e.target && e.target.closest ? e.target.closest(".progress-seg") : null;
      if (!seg) return;
      requestJumpToDay(parseInt(seg.getAttribute("data-day"), 10));
    });
  }

  // ================= 曜日ごとのグループ化 & 商品別累計の事前計算 =================
  function groupBeatsByDay() {
    beatsByDay = {};
    for (var d = 0; d <= RESULT_DAY; d++) beatsByDay[d] = [];
    allBeats.forEach(function (b) {
      if (!beatsByDay[b.day]) beatsByDay[b.day] = [];
      beatsByDay[b.day].push(b);
    });
  }

  // 「各日が始まる時点での商品ごとの累計販売数・利益」を、全beatを1回だけ順に
  // なぞって事前計算する（週全体のbeatは営業開始時点で既に確定済みのため、この
  // 事前計算はプレイヤーが見る前から行って問題ない＝結果に影響しない）。
  function precomputeItemStats() {
    dayStartItemStats = {};
    var running = {};
    Game.App.state.products.forEach(function (p) {
      running[p.id] = { sold: 0, profit: 0 };
    });
    var snapshotFor = function () {
      var copy = {};
      Object.keys(running).forEach(function (id) {
        copy[id] = { sold: running[id].sold, profit: running[id].profit };
      });
      return copy;
    };
    for (var d = 0; d <= RESULT_DAY; d++) {
      dayStartItemStats[d] = snapshotFor();
      (beatsByDay[d] || []).forEach(function (b) {
        applyServeBatchToRunning(b, running);
      });
    }
  }

  function applyServeBatchToRunning(beat, running) {
    if (!beat.action || beat.action.type !== "serve_batch" || !beat.action.productIds) return;
    beat.action.productIds.forEach(function (pid) {
      if (!running[pid]) running[pid] = { sold: 0, profit: 0 };
      var product = Game.App.state.products.find(function (p) {
        return p.id === pid;
      });
      var margin = product ? product.currentPrice - product.cost : 0;
      running[pid].sold += 1;
      running[pid].profit += margin;
    });
  }

  // ================= 描画 =================
  // 伸びる進捗バー（月〜日の7区画。完了した日は満タン、再生中の日はbeatの再生割合に
  // 応じて連続的に伸びる、未到達の日は空のまま）。クリックでその日へジャンプできる。
  var DAY_LABELS_SHORT = { 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土", 7: "日" };

  function renderProgressBar() {
    var html = "";
    for (var d = 1; d <= 7; d++) {
      html +=
        '<div class="progress-seg" data-day="' + d + '">' +
          '<div class="progress-fill" id="progress-fill-' + d + '"></div>' +
          '<span class="progress-label">' + DAY_LABELS_SHORT[d] + "</span>" +
        "</div>";
    }
    el("field-progress-bar").innerHTML = html;
    updateProgressFill();
  }

  function updateProgressFill() {
    for (var d = 1; d <= 7; d++) {
      var fillEl = el("progress-fill-" + d);
      if (!fillEl) continue;
      var seg = fillEl.parentNode;
      var pct;
      if (currentDay > d || currentDay === RESULT_DAY) {
        pct = 100;
      } else if (currentDay === d) {
        pct = dayBeats.length > 0 ? Math.min(100, (playIndexInDay / dayBeats.length) * 100) : 100;
      } else {
        pct = 0;
      }
      fillEl.style.width = pct + "%";
      seg.classList.toggle("active", currentDay === d);
      seg.classList.toggle("done", pct >= 100 && currentDay !== d);
    }
  }

  function renderItemStats() {
    var wrapEl = el("field-item-stats");
    var products = Game.App.state.products || [];
    if (products.length === 0) {
      wrapEl.innerHTML = "";
      return;
    }
    wrapEl.innerHTML = products
      .map(function (p) {
        var st = liveItemStats[p.id] || { sold: 0, profit: 0 };
        return (
          '<div class="item-stat-row">' +
            '<span class="item-stat-name">' + esc(p.icon || "🍽️") + " " + esc(p.name) + "</span>" +
            '<span class="item-stat-num">販売/仕入 <b>' + st.sold + "</b>/" + fmt(p.stock || 0) + "</span>" +
            '<span class="item-stat-num">利益 <b class="' + (st.profit >= 0 ? "good" : "bad") + '">' + fmt(st.profit) + "円</b></span>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderLogLine() {
    var logEl = el("field-log-mini");
    if (!currentLine) {
      logEl.innerHTML = '<div class="log-line-mini muted-line">' + (dayBeats.length === 0 ? "この日は特に大きな動きはなかった。" : "・・・") + "</div>";
      return;
    }
    logEl.innerHTML = '<div class="log-line-mini ' + currentLine.kind + '"><span class="icon">' + currentLine.icon + "</span>" + esc(currentLine.text) + "</div>";
  }

  function updatePlayButtonLabel() {
    var btn = el("field-btn-play");
    if (waitingToAdvance) return; // 待機表示中は他の描画処理でラベルを上書きしない
    btn.textContent = playing ? "⏸ 一時停止" : "▶ 再生";
    btn.classList.toggle("btn-primary", !playing);
  }

  function updateSpeedButtonLabel() {
    el("field-btn-speed").textContent = "⏩ x" + currentSpeed();
  }

  // ================= 再生ロジック =================
  function pushLine(beat) {
    currentLine = beat;
    if (beat.action && beat.action.type === "serve_batch") {
      applyServeBatchToRunning(beat, liveItemStats);
    }
    renderLogLine();
    renderItemStats();
    updateProgressFill();
  }

  function step() {
    var beat = dayBeats[playIndexInDay];
    pushLine(beat);
    if (beat.action) Game.UI.Scene.playBeat(beat.action);
    playIndexInDay++;
  }

  // その日のbeat数に応じて、1beatあたりの表示間隔（1倍速基準）を動的に配分する。
  // 「動きが伴うbeat」は少し長め、「曜日切り替え」はやや長め、それ以外の単なる
  // テキスト情報は短め、という重み付けで合計がおおよそDAY_TARGET_MSに収まるようにする
  // （客が少なくbeat数が少ない日は1beatあたりが伸び、逆に多い日は縮む＝どちらも
  // 「約8秒」に揃う）。
  function computeBeatDelays(beats) {
    if (beats.length === 0) return [];
    var weights = beats.map(function (b) {
      if (b.action) return 2.2;
      if (b.kind === "day") return 1.6;
      return 1;
    });
    var total = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    return weights.map(function (w) {
      return Game.Core.Random.clamp((DAY_TARGET_MS * w) / total, MIN_BEAT_MS, MAX_BEAT_MS);
    });
  }

  function scheduleStep() {
    if (!playing) return;
    if (playIndexInDay >= dayBeats.length) {
      dayFinished();
      return;
    }
    var delay = (dayBeatDelays[playIndexInDay] || 480) / currentSpeed();
    playTimer = setTimeout(function () {
      step();
      scheduleStep();
    }, delay);
  }

  function play() {
    if (playing) return;
    if (waitingToAdvance) return; // 既に次の日への待機中
    if (playIndexInDay >= dayBeats.length) {
      // この日は最後まで再生済み → 次の日へ（通常は自動進行で既にここへは来ないが、
      // 手動で「▶ 再生」を押した場合の保険として維持）。
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
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    Game.UI.Scene.setSpeed(currentSpeed());
    updateSpeedButtonLabel();
    if (playing) {
      // 次のstepから新しい間隔を反映させるため、いったん再スケジュール
      if (playTimer) {
        clearTimeout(playTimer);
        playTimer = null;
      }
      scheduleStep();
    }
  }

  // 2026-09-22（フィールド全面改修）: 日が終わっても止めず、自動的に次の日へ進む
  // （＝「月〜日を1回の開始で継続して流れるように」への対応）。一時停止ボタンが
  // 押されていた場合はplaying===falseのままscheduleStepの連鎖が止まっているため、
  // ここへは到達しない（＝一時停止中は自動進行しない）。
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
    updatePlayButtonLabel();
    if (currentDay === RESULT_DAY) {
      showResult();
    } else {
      nextDay();
    }
  }

  // ================= 曜日ナビゲーション =================
  function jumpToDay(day) {
    day = clampDay(day);
    pause();
    currentDay = day;
    dayBeats = beatsByDay[day] || [];
    dayBeatDelays = computeBeatDelays(dayBeats);
    playIndexInDay = 0;
    currentLine = null;
    liveItemStats = dayStartItemStats[day] ? JSON.parse(JSON.stringify(dayStartItemStats[day])) : {};
    el("field-result").classList.remove("show");
    var panelEl = document.querySelector(".field-panel");
    if (panelEl) panelEl.classList.remove("result-active");

    renderProgressBar();
    renderLogLine();
    renderItemStats();
    updatePlayButtonLabel();

    Game.UI.Scene.startDay();

    if (dayBeats.length === 0) {
      // この日は何も起きなかった（主に準備日=day0）。表示を止めずそのまま次の日へ
      // 進める（「月〜日を1回の開始で継続して流れるように」を、準備日でも崩さないため）。
      if (day !== RESULT_DAY) {
        nextDay();
      } else {
        updatePlayButtonLabel();
      }
      return;
    }
    play();
  }

  // バグ修正9（「消えるバグ」の再修正 — バグ修正8の抜け穴）: バグ修正8では
  // 「▶ 次の日へ進む」ボタン（nextDay経由）だけを、客が残っている間は待たせるように
  // していた。しかし曜日タブを直接クリックする操作（現在は進捗バーのクリック）・
  // 「◀ 前の日」ボタンも、内部的には同じjumpToDay()（＝Game.UI.Scene.startDay()で
  // 客を問答無用に即座に消す処理）を直接呼んでおり、無防備なままだった。日付・曜日を
  // 切り替えるすべての入り口を、この共通のrequestJumpToDay()を経由させることで
  // 統一的に保護する。
  //
  // バグ修正12（「消えるバグ」の再修正 — バグ修正9のさらなる抜け穴）: 「⏭ 結果へ
  // スキップ」ボタン（skipToEnd）も同じ保護が必要だったため、waitForCustomersThenRun()を
  // 「待機完了後に呼ぶ処理」を引数に取る汎用的な形にし、曜日ナビゲーションと週スキップの
  // 両方から共通して使うようにした。
  function requestJumpToDay(day) {
    day = clampDay(day);
    if (day === currentDay) return; // 今表示している日と同じなら何もしない（無意味な再生成・消失を防ぐ）
    if (waitingToAdvance) return; // 既に別の切り替えを待機中（二重起動防止）
    // バグ修正9・補足: 手動ナビゲーションは、その日のbeatがまだ再生中でも押せてしまう。
    // ここでbeatの予約（field.js側のsetTimeoutループ）を止めずに客がいなくなるのを
    // 待ち始めると、待っている間も裏でその日の残りのbeatが引き続き送り込まれ続け、
    // 新しい客がどんどん入店してきて「いつまでも客がいなくならない」状態になっていた。
    // 実際の店内アニメーション（Scene側）は止めずに、field.js側の「次のbeatを予約する」
    // 処理だけを止めておく（Scene.pause()は呼ばない＝pause()とは異なり残っている客の
    // 退店アニメーションはそのまま進む）。
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (Game.UI.Scene.hasActiveCustomers()) {
      waitForCustomersThenRun(function () {
        jumpToDay(day);
      });
    } else {
      jumpToDay(day);
    }
  }

  function nextDay() {
    requestJumpToDay(currentDay + 1);
  }

  // 2026-09-22（フィールド全面改修）: 「1日約8秒」を実現するためbeatの表示間隔を大幅に
  // 詰めた結果、厨房（コック1名・COOK_TIME固定）の処理能力を大きく上回るペースでbeatが
  // 送り込まれ、日替わりのたびに残った客が捌け切るまでの待ち時間が非常に長くなる
  // （最悪、安全弁のWAIT_CLEAR_TIMEOUT_MSに毎回引っかかる）現象が生じた。この待ち時間は
  // 通常のbeat再生ペース（DAY_TARGET_MS）とは独立した「後片付け専用の早送り」なので、
  // 大きく引き上げても「1日8秒」の体感には影響しない。
  var CLEANUP_SPEED_MULT = 30; // 残っている客の後片付け中だけ使う早送り倍率

  // 客が画面からいなくなるまで（またはタイムアウトするまで）待ってから afterFn() を
  // 実行する。日付ジャンプ・週スキップなど「今いる客を問答無用に消す」処理の手前に
  // 挟むことで、食事中・移動中の客が前触れなく一瞬で消えて見えることを防ぐ（共通化）。
  function waitForCustomersThenRun(afterFn) {
    waitingToAdvance = true;
    pendingAfterWait = afterFn;
    var waitStart = Date.now();
    var playBtn = el("field-btn-play");
    if (playBtn) {
      playBtn.disabled = true;
      playBtn.textContent = "⏳ 退店をお待ちください…";
      playBtn.classList.remove("btn-primary");
    }
    var barEl = el("field-progress-bar");
    if (barEl) barEl.style.pointerEvents = "none"; // 待機中は進捗バーでの二重切り替えも防ぐ
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
        var run = pendingAfterWait;
        waitingToAdvance = false;
        pendingAfterWait = null;
        waitClearTimer = null;
        if (playBtn) playBtn.disabled = false;
        if (barEl) barEl.style.pointerEvents = "";
        Game.UI.Scene.setSpeed(currentSpeed()); // 通常の速度設定に戻す
        if (run) run();
        return;
      }
      waitClearTimer = setTimeout(poll, WAIT_CLEAR_POLL_MS);
    }
    waitClearTimer = setTimeout(poll, WAIT_CLEAR_POLL_MS);
  }

  // 「⏭ 結果」も、曜日ナビゲーションと同じく客が画面からいなくなるまで待ってから
  // 実行する（requestJumpToDayと対になるガード付きの入り口）。
  function requestSkipToEnd() {
    if (waitingToAdvance) return; // 既に別の切り替えを待機中（二重起動防止）
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (Game.UI.Scene.hasActiveCustomers()) {
      waitForCustomersThenRun(performSkipToEnd);
    } else {
      performSkipToEnd();
    }
  }

  function performSkipToEnd() {
    pause();
    currentDay = RESULT_DAY;
    dayBeats = beatsByDay[RESULT_DAY] || [];
    playIndexInDay = dayBeats.length;
    currentLine = dayBeats.length > 0 ? dayBeats[dayBeats.length - 1] : null;
    liveItemStats = dayStartItemStats[RESULT_DAY] ? JSON.parse(JSON.stringify(dayStartItemStats[RESULT_DAY])) : {};
    Game.UI.Scene.skipToEnd();

    renderProgressBar();
    renderLogLine();
    renderItemStats();
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
    var panelEl = document.querySelector(".field-panel");
    if (panelEl) panelEl.classList.add("result-active"); // シーン表示を縮めて結果パネル分のスペースを確保

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
    speedIndex = 0;
    updateSpeedButtonLabel();
    Game.UI.Scene.setSpeed(currentSpeed());
    groupBeatsByDay();
    precomputeItemStats();
    Game.UI.Scene.startWeek(Game.App.state.layout);
    jumpToDay(0);
  }

  function renderIdle() {
    ensureScene();
    Game.UI.Scene.renderIdle(el("scene-container"));
    updateSpeedButtonLabel();
    if (el("field-progress-bar")) el("field-progress-bar").innerHTML = "";
    if (el("field-item-stats")) el("field-item-stats").innerHTML = "";
    if (allBeats.length === 0 && el("field-log-mini")) {
      el("field-log-mini").innerHTML = '<div class="log-line-mini muted-line">まだ今週の営業を開始していません。OFFICE画面で設定して「営業開始」を押してください。</div>';
    }
  }

  Game.UI.Field = {
    start: start,
    togglePlay: togglePlay,
    toggleSpeed: toggleSpeed,
    skipToEnd: requestSkipToEnd,
    nextTurn: nextTurn,
    renderIdle: renderIdle,
  };
})();
