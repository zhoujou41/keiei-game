// setup.js — ゲーム開始前のオンボーディング画面（難易度／業種／店名／初期メニュー選択）
// 2026-09-21 新規追加。ここで集めた回答（answers）を最後にGame.Core.State.createInitialState()
// へ渡すことで、初めて本当のゲーム状態（Game.App.state）が作られる。
// 注意: onclick文字列に引数を埋め込むと引用符のエスケープでバグりやすいため、
// office.js等と同様にdata-*属性 + イベント委譲方式で統一する。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var STEP_COUNT = 4;
  var STEP_LABELS = ["① 難易度", "② 業種", "③ 店名", "④ 初期メニュー"];

  var step = 1;
  var answers = {
    difficulty: null,
    storeType: null,
    storeName: "",
    productIds: [],
  };
  var onComplete = null;
  var wired = false;

  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function reset() {
    step = 1;
    answers = { difficulty: null, storeType: null, storeName: "", productIds: [] };
  }

  // ================= ステップ表示 =================
  function renderStepper() {
    var html = STEP_LABELS.map(function (label, idx) {
      var n = idx + 1;
      var cls = "setup-step" + (n === step ? " active" : "") + (n < step ? " done" : "");
      return '<div class="' + cls + '">' + label + "</div>";
    }).join("");
    el("setup-stepper").innerHTML = html;
  }

  // ---- ①難易度（＝最初の未来視）----
  function renderStepDifficulty() {
    var html = Game.Data.DIFFICULTIES.map(function (d) {
      var active = answers.difficulty === d.id ? "active" : "";
      var bullets = d.bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("");
      return (
        '<div class="setup-card ' + active + '" data-action="pick-difficulty" data-id="' + d.id + '">' +
          '<div class="setup-card-title">' + esc(d.name) + "</div>" +
          '<div class="setup-card-flavor">🔮 「' + esc(d.flavor) + '」</div>' +
          "<ul>" + bullets + "</ul>" +
        "</div>"
      );
    }).join("");
    return (
      '<h3>最初の未来視：この業界の先行きは？</h3>' +
      '<div class="muted small" style="margin-bottom:10px;">ここで選ぶのはゲーム全体の難易度です。業界全体の需要・景気の見通しを表します（どの業種を選んでも有利不利はありません）。</div>' +
      '<div class="setup-card-grid">' + html + "</div>"
    );
  }

  // ---- ②業種 ----
  function renderStepStoreType() {
    var html = Game.Data.STORE_TYPES.map(function (t) {
      var active = answers.storeType === t.id ? "active" : "";
      return (
        '<div class="setup-card ' + active + '" data-action="pick-storetype" data-id="' + t.id + '">' +
          '<div class="setup-card-title">' + t.icon + " " + esc(t.name) + "</div>" +
          '<div class="setup-card-flavor">' + esc(t.flavor) + "</div>" +
        "</div>"
      );
    }).join("");
    return (
      "<h3>お店を選ぶ</h3>" +
      '<div class="muted small" style="margin-bottom:10px;">どの業種を選ぶかは好み・プレイスタイルの問題です。難易度には影響しません。</div>' +
      '<div class="setup-card-grid">' + html + "</div>"
    );
  }

  // ---- ③店名 ----
  function renderStepName() {
    var t = answers.storeType ? Game.Data.getStoreType(answers.storeType) : null;
    var placeholder = t ? t.name.replace("店", "") + "○○" : "お店の名前";
    return (
      "<h3>お店の名前を決める</h3>" +
      '<div class="muted small" style="margin-bottom:10px;">あとから変更はできません（プロトタイプ版）。空欄のままでも開業できます。</div>' +
      '<input type="text" id="setup-store-name" class="setup-name-input" maxlength="20" placeholder="' +
        esc(placeholder) + '" value="' + esc(answers.storeName) + '">'
    );
  }

  // ---- ④初期メニュー ----
  function renderStepMenu() {
    var t = answers.storeType ? Game.Data.getStoreType(answers.storeType) : null;
    if (!t) return "<h3>初期メニューを決める</h3><div class='muted small'>先に業種を選んでください。</div>";
    var catalog = Game.Data.getProductsByCategory(t.category);
    var html = catalog.map(function (p) {
      var isChecked = answers.productIds.indexOf(p.id) !== -1;
      var checked = isChecked ? "checked" : "";
      return (
        '<label class="setup-menu-card' + (isChecked ? " checked" : "") + '">' +
          '<input type="checkbox" data-action="toggle-product" data-id="' + p.id + '" ' + checked + ">" +
          '<div class="setup-card-title">' + p.icon + " " + esc(p.name) + "</div>" +
          '<div class="muted small">価格 ' + p.basePrice + "円 / 原価 " + p.cost + "円</div>" +
        "</label>"
      );
    }).join("");
    return (
      "<h3>最初のメニューを決める</h3>" +
      '<div class="muted small" style="margin-bottom:10px;">' + esc(t.name) + "の中から、開業時に出す商品を選んでください（1つ以上）。後から増やせるようになる予定です。</div>" +
      '<div class="setup-menu-grid">' + html + "</div>"
    );
  }

  function canProceed() {
    if (step === 1) return !!answers.difficulty;
    if (step === 2) return !!answers.storeType;
    if (step === 3) return true; // 店名は空欄可（デフォルト名で補完）
    if (step === 4) return answers.productIds.length > 0;
    return false;
  }

  function renderNav() {
    var backBtn = step > 1 ? '<button class="btn" data-action="setup-back">◀ 戻る</button>' : "<span></span>";
    var nextLabel = step < STEP_COUNT ? "次へ ▶" : "この内容で開業する ▶";
    var nextAction = step < STEP_COUNT ? "setup-next" : "setup-finish";
    var disabled = canProceed() ? "" : "disabled";
    return (
      '<div class="row" style="justify-content:space-between;margin-top:14px;">' +
        backBtn +
        '<button class="btn btn-primary" data-action="' + nextAction + '" ' + disabled + ">" + nextLabel + "</button>" +
      "</div>"
    );
  }

  function render() {
    renderStepper();
    var body = "";
    if (step === 1) body = renderStepDifficulty();
    else if (step === 2) body = renderStepStoreType();
    else if (step === 3) body = renderStepName();
    else if (step === 4) body = renderStepMenu();
    el("setup-body").innerHTML = body + renderNav();
    if (step === 3) {
      var input = el("setup-store-name");
      if (input) {
        input.focus();
        var v = input.value;
        input.value = "";
        input.value = v; // カーソルを末尾に
      }
    }
  }

  // ================= イベント =================
  function pickDifficulty(id) {
    answers.difficulty = id;
    render();
  }

  function pickStoreType(id) {
    if (answers.storeType !== id) {
      answers.storeType = id;
      answers.productIds = []; // 業種が変わったらメニュー選択はリセット
    }
    render();
  }

  function toggleProduct(id) {
    var idx = answers.productIds.indexOf(id);
    if (idx === -1) answers.productIds.push(id);
    else answers.productIds.splice(idx, 1);
    render();
  }

  function goNext() {
    if (!canProceed()) return;
    if (step === 3) {
      var input = el("setup-store-name");
      answers.storeName = input ? input.value.trim() : "";
    }
    if (step < STEP_COUNT) {
      step++;
      render();
    }
  }

  function goBack() {
    if (step === 3) {
      var input = el("setup-store-name");
      answers.storeName = input ? input.value.trim() : "";
    }
    if (step > 1) {
      step--;
      render();
    }
  }

  function finish() {
    if (!canProceed()) return;
    var input = el("setup-store-name");
    if (input) answers.storeName = input.value.trim();
    if (onComplete) onComplete(Object.assign({}, answers));
  }

  function handleClick(e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    if (action === "pick-difficulty") pickDifficulty(t.getAttribute("data-id"));
    else if (action === "pick-storetype") pickStoreType(t.getAttribute("data-id"));
    else if (action === "setup-next") goNext();
    else if (action === "setup-back") goBack();
    else if (action === "setup-finish") finish();
  }

  function handleChange(e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    if (t.getAttribute("data-action") === "toggle-product") {
      toggleProduct(t.getAttribute("data-id"));
    }
  }

  function wireEvents() {
    var root = el("screen-setup");
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
  }

  // callback: 完了時に呼ばれる。answersオブジェクト（difficulty/storeType/storeName/productIds）を渡す
  function init(callback) {
    onComplete = callback;
    reset();
    if (!wired) {
      wireEvents();
      wired = true;
    }
    render();
  }

  Game.UI.Setup = {
    init: init,
  };
})();
