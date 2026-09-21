// main.js — アプリ全体の初期化と画面制御
window.Game = window.Game || {};

(function () {
  function el(id) {
    return document.getElementById(id);
  }

  function fmt(n) {
    return Math.round(n).toLocaleString();
  }

  var App = {
    state: null,

    init: function () {
      this.wireTabs();
      this.wireStartButton();
      this.wireFieldControls();
      this.wireRestart();

      var loaded = Game.Core.State.load();
      // 2026-09-21: オープニングのセットアップ（難易度＝最初の未来視／業種／店名／初期メニュー）を
      // 追加。読み込んだセーブが無い、またはセットアップを完了する前のもの（このセットアップ
      // 機能を導入する前の旧セーブはmigrate()でsetupComplete=trueが補完されるため、ここに
      // 来るのは基本的に「本当に一度もプレイしたことがない」初回起動時だけになる）は、
      // まずセットアップ画面を表示する。
      if (loaded && loaded.setupComplete) {
        this.state = loaded;
        this.enterGame();
      } else {
        this.state = Game.Core.State.createPendingState();
        this.enterSetup();
      }
    },

    // ---- セットアップ（開業準備）画面 ----
    enterSetup: function () {
      var self = this;
      el("topbar").style.display = "none";
      el("tabs").style.display = "none";
      el("start-week-bar").style.display = "none";
      ["screen-office", "screen-layout", "screen-field"].forEach(function (id) {
        el(id).classList.remove("active");
      });
      el("screen-setup").classList.add("active");
      Game.UI.Setup.init(function (answers) {
        self.state = Game.Core.State.createInitialState(answers);
        self.save();
        el("screen-setup").classList.remove("active");
        el("topbar").style.display = "";
        el("tabs").style.display = "";
        self.enterGame();
      });
    },

    // ---- セットアップ完了後の通常プレイ ----
    enterGame: function () {
      this.renderAll();
      this.switchTab("office");
      // 以前のセッションで既にゲームオーバーになっていたセーブを読み込んだ場合、
      // 従来はこの画面（GAME OVERオーバーレイ）を再表示する処理が無かったため、
      // 「営業開始」ボタンを押しても（wireStartButton内のgameOverガードにより）
      // 何の反応も無いように見えてしまっていた。読み込み直後に確認して復元する。
      if (this.state.gameOver) {
        this.showGameOver();
      }
    },

    showGameOver: function () {
      el("gameover-title").textContent = "GAME OVER";
      el("gameover-reason").textContent = this.state.gameOverReason || "";
      el("gameover-week").textContent = "第" + this.state.week + "週まで営業しました。";
      el("gameover-overlay").classList.add("show");
    },

    save: function () {
      Game.Core.State.save(this.state);
    },

    renderHud: function () {
      var s = this.state;
      var moneyCls = s.money < 0 ? "hud-item money-negative" : "hud-item";
      el("hud-week").textContent = s.week;
      el("hud-money").textContent = fmt(s.money);
      el("hud-money").parentElement.className = moneyCls;
      el("hud-reputation").textContent = Math.round(s.reputation);
      el("hud-goal").textContent =
        "利益" + fmt(s.milestoneAccum.profit) + "/" + fmt(s.currentGoal.minProfit) +
        "・評判" + Math.round(s.reputation) + "/" + s.currentGoal.minReputation +
        "（" + s.currentGoal.untilWeek + "週目まで）";

      var storeEl = el("hud-store");
      if (storeEl) {
        var typeDef = s.storeType ? Game.Data.getStoreType(s.storeType) : null;
        var diffDef = Game.Data.getDifficulty(s.difficulty || "normal");
        var icon = typeDef ? typeDef.icon : "🏪";
        storeEl.textContent = icon + " " + s.storeName + "（" + diffDef.name + "）";
        storeEl.style.display = "";
      }
    },

    renderAll: function () {
      this.renderHud();
      Game.UI.Office.render();
      Game.UI.LayoutEditor.render();
      Game.UI.Field.renderIdle();
    },

    switchTab: function (tab) {
      var screens = { office: el("screen-office"), layout: el("screen-layout"), field: el("screen-field") };
      var tabs = { office: el("tab-office"), layout: el("tab-layout"), field: el("tab-field") };
      var startBar = el("start-week-bar");
      Object.keys(screens).forEach(function (key) {
        if (key === tab) {
          screens[key].classList.add("active");
          tabs[key].classList.add("active");
        } else {
          screens[key].classList.remove("active");
          tabs[key].classList.remove("active");
        }
      });
      startBar.style.display = tab === "office" ? "flex" : "none";
      if (tab === "layout") {
        Game.UI.LayoutEditor.render();
      }
    },

    wireTabs: function () {
      var self = this;
      el("tab-office").addEventListener("click", function () {
        self.switchTab("office");
      });
      el("tab-layout").addEventListener("click", function () {
        self.switchTab("layout");
      });
      el("tab-field").addEventListener("click", function () {
        self.switchTab("field");
      });
    },

    wireStartButton: function () {
      var self = this;
      el("btn-start-week").addEventListener("click", function () {
        if (self.state.gameOver) return;
        var outcome = Game.Core.Simulation.runWeek(self.state);
        self.save();
        self.renderHud();
        self.switchTab("field");
        Game.UI.Field.start(outcome.beats, outcome.result);
      });
    },

    wireFieldControls: function () {
      el("field-btn-play").addEventListener("click", function () {
        Game.UI.Field.togglePlay();
      });
      el("field-btn-speed").addEventListener("click", function () {
        Game.UI.Field.toggleSpeed();
      });
      el("field-btn-skip").addEventListener("click", function () {
        Game.UI.Field.skipToEnd();
      });
      el("field-btn-prevday").addEventListener("click", function () {
        Game.UI.Field.prevDay();
      });
      el("field-btn-nextday").addEventListener("click", function () {
        Game.UI.Field.nextDay();
      });
    },

    wireRestart: function () {
      var self = this;
      el("btn-restart").addEventListener("click", function () {
        Game.Core.State.clearSave();
        el("gameover-overlay").classList.remove("show");
        // 「最初からやり直す」＝文字通り最初から。難易度・業種・店名・初期メニューも
        // 選び直せるよう、セットアップ画面まで戻す。
        self.state = Game.Core.State.createPendingState();
        self.enterSetup();
      });
    },
  };

  Game.App = App;

  document.addEventListener("DOMContentLoaded", function () {
    App.init();
  });
})();
