// state.js — ゲーム状態の初期化と保存/読込
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  var SAVE_KEY = "keiei_game_save_v1";
  var DEFAULT_STORE_NAME = "無名食堂";

  // setupAnswers = { difficulty: 'easy'|'normal'|'hard', storeType: 業種id（storeTypes.js）,
  //                  storeName: string, productIds: [選んだ商品idの配列] }
  // 2026-09-21: オープニングのセットアップ（難易度＝最初の未来視／業種／店名／初期メニュー）を
  // 追加したことに伴い、createInitialState()がその回答を受け取れるようにした。
  // 呼び出し側（main.js）は、セットアップ未完了のセーブが無い場合はこの関数をまだ呼ばず、
  // まずセットアップ画面を表示し、そこでの回答を引数にして初めて本当のゲーム状態を作る。
  // 引数を省略した場合（想定外の呼び出し等への保険）は、difficulty=normal・業種指定なし
  // （全業種の商品をそのまま使う旧来の挙動）にフォールバックする。
  function createInitialState(setupAnswers) {
    var answers = setupAnswers || {};
    var difficulty = Game.Data.getDifficulty(answers.difficulty || "normal");

    var sourceProducts;
    if (answers.storeType) {
      var storeType = Game.Data.getStoreType(answers.storeType);
      var catalog = Game.Data.getProductsByCategory(storeType.category);
      var chosenIds = answers.productIds && answers.productIds.length ? answers.productIds : null;
      sourceProducts = chosenIds
        ? catalog.filter(function (p) {
            return chosenIds.indexOf(p.id) !== -1;
          })
        : catalog;
      if (sourceProducts.length === 0) sourceProducts = catalog; // 何も選ばれていなければカテゴリ全品
    } else {
      sourceProducts = Game.Data.PRODUCTS; // 業種未指定（フォールバック）は全業種そのまま
    }

    var products = sourceProducts.map(function (p) {
      return Object.assign({}, p, {
        currentPrice: p.basePrice,
        pricePct: 100, // 基準価格に対する% (0〜10000で直接指定可能。office.js参照)
        purchaseRate: 100, // 基準仕入れ量に対する% (2026-09-22〜: purchaseLevelから自動計算される)
        purchaseLevel: 3, // 仕入れ量レベル（1〜3、3=Max。2026-09-22追加）
        stock: 0,
      });
    });

    var staff = Game.Data.INITIAL_STAFF.map(function (s) {
      // aptitude/workDaysMask/managementFocusは参照型なので、他のセーブ/次回作成と
      // 共有されないよう必ずディープコピーする（配列・オブジェクトの浅いコピー事故防止）。
      return Object.assign({}, s, {
        aptitude: Object.assign({}, s.aptitude),
        workDaysMask: (s.workDaysMask || []).slice(),
        managementFocus: Object.assign({ guidance: 50, morale: 50 }, s.managementFocus),
      });
    });

    var skills = {};
    Game.Data.SKILLS.forEach(function (s) {
      skills[s.id] = 0;
    });

    var state = {
      setupComplete: true,
      difficulty: difficulty.id,
      storeType: answers.storeType || null,
      storeName: (answers.storeName && String(answers.storeName).trim()) || DEFAULT_STORE_NAME,
      week: 1,
      money: Math.round(400000 * difficulty.multipliers.startMoneyMult),
      reputation: 50,
      products: products,
      staff: staff,
      skills: skills,
      skillPoints: 2, // 初期ポイント（チュートリアル的に少し使える）
      focusSkill: null,
      milestoneLength: 4,
      milestoneIndex: 1,
      milestoneAccum: { revenue: 0, profit: 0, customers: 0 },
      currentGoal: null,
      history: [], // 週ごとの結果サマリ
      gameOver: false,
      gameOverReason: null,
      debtWarnings: 0,
      currentWeekConditions: null, // その週の「真の」隠し条件
      currentWeekForesight: null, // その週の「今週の未来視」（週全体のなんとなくの抽象ヒント。全員デフォルトで無料）
      lastWeekBeats: [], // FIELD画面で再生する「1行=1演出」の統合イベント列（テキスト＋シーン演出）
      lastWeekResult: null,
      layout: Game.Data.createDefaultLayout(),
    };

    state.currentGoal = Game.Core.Goals.generateGoal(state, state.milestoneIndex);
    state.currentWeekConditions = Game.Core.Simulation.generateWeekConditions(state);
    state.currentWeekForesight = Game.Core.Simulation.getWeekForesight(state);

    return state;
  }

  // 古いセーブデータ（レイアウト機能追加前など）に不足しているフィールドを補完する
  function migrate(state) {
    if (!state.layout) {
      state.layout = Game.Data.createDefaultLayout();
    }
    if (!state.lastWeekBeats) {
      // 旧セーブ（log/scenes形式）からの移行：古い形式のデータは破棄し空にする
      state.lastWeekBeats = [];
    }
    if ("lastWeekLog" in state) delete state.lastWeekLog;
    if ("lastWeekScenes" in state) delete state.lastWeekScenes;
    if (!state.pendingCandidates) {
      state.pendingCandidates = [];
    }
    // 2026-09-21: オープニングのセットアップ（難易度／業種／店名／初期メニュー）追加に伴う移行。
    // このセットアップ機能より前に作られたセーブは、実質「セットアップ済み」として扱い、
    // 難易度NORMAL・業種指定なし（今まで通り全業種の商品）・仮の店名を補完する。
    // これにより既存のセーブは一切壊れず、そのまま続きから遊べる。
    if (!state.setupComplete) {
      state.setupComplete = true;
    }
    if (!state.difficulty) {
      state.difficulty = "normal";
    }
    if (state.storeType === undefined) {
      state.storeType = null;
    }
    if (!state.storeName) {
      state.storeName = DEFAULT_STORE_NAME;
    }
    if (state.products) {
      state.products.forEach(function (p) {
        if (!p.foodKey) {
          var def = Game.Data.getProductDef(p.id);
          if (def && def.foodKey) p.foodKey = def.foodKey;
        }
        // 2026-09-22（仕入れUI改修）: 旧セーブにはpricePctが無いため、
        // 現在のcurrentPrice/basePriceから逆算して補完する（表示上の連続性を保つ）。
        if (p.pricePct == null) {
          p.pricePct = p.basePrice > 0 ? Math.round((p.currentPrice / p.basePrice) * 100) : 100;
        }
        if (p.purchaseRate == null) {
          p.purchaseRate = 100;
        }
        // 2026-09-22（仕入れレベル制対応）: 旧セーブにはpurchaseLevelが無いため、
        // 現在のpurchaseRate（%）から最も近いレベル（1〜3、3=Max=100%）を逆算して補完する
        // （表示上の連続性を保つ。以後はレベル選択でpurchaseRateが上書きされる）。
        if (p.purchaseLevel == null) {
          var levelPct = { 1: 34, 2: 67, 3: 100 };
          var bestLevel = 3, bestDiff = Infinity;
          Object.keys(levelPct).forEach(function (lv) {
            var diff = Math.abs(p.purchaseRate - levelPct[lv]);
            if (diff < bestDiff) { bestDiff = diff; bestLevel = parseInt(lv, 10); }
          });
          p.purchaseLevel = bestLevel;
        }
      });
    }
    // 2026-09-22（シフト改修）: 役割register/otherを廃止しservice/choresへ統合、
    // 呼込(calling)を新設。曜日ごとのシフト（workDaysMask）とマネジメント方針
    // （managementFocus）が無い旧セーブには補完する。
    if (state.staff) {
      state.staff.forEach(function (st) {
        if (st.role === "register") st.role = "service";
        if (st.role === "other") st.role = "chores";
        if (st.aptitude) {
          if (st.aptitude.calling == null) {
            st.aptitude.calling = Math.round((st.aptitude.cooking + st.aptitude.service) / 2 * 0.6);
          }
          if (st.aptitude.chores == null) {
            st.aptitude.chores = st.aptitude.other != null ? st.aptitude.other : 30;
          }
          delete st.aptitude.register;
          delete st.aptitude.other;
        }
        if (!st.workDaysMask) {
          var mask = [false, false, false, false, false, false, false];
          // workDays（人数）ぶんだけ月曜起点でONにする（大まかな後方互換の近似）
          for (var di = 0; di < st.workDays && di < 7; di++) mask[di] = true;
          st.workDaysMask = mask;
        }
        if (!st.managementFocus) {
          st.managementFocus = { guidance: 50, morale: 50 };
        }
      });
    }
    // 2026-09-22: 「今週の未来視」を曜日別(days)から週全体の要約(lines)に変更。
    // 旧形式のセーブ（daysを持つ／linesを持たない）は破棄して再生成する。
    if (state.currentWeekForesight && !state.currentWeekForesight.lines) {
      state.currentWeekForesight = null;
    }
    if (!state.currentWeekForesight && state.currentWeekConditions) {
      state.currentWeekForesight = Game.Core.Simulation.getWeekForesight(state);
    }
    // 2026-09-22: 経営目標「今週の試練」表示に説明文(description)・太字概要(summary)を追加。
    // 旧セーブのcurrentGoalには存在しないため補完する。
    if (state.currentGoal && (!state.currentGoal.description || !state.currentGoal.summary)) {
      var g = state.currentGoal;
      if (!g.description) {
        g.description =
          "第" + g.milestoneIndex + "期の目標です。" + g.untilWeek +
          "週目までの間に、以下の数値を達成することが求められています。未達成でも即ゲームオーバーにはなりませんが、" +
          "評判低下や追加コストなど経営が苦しくなる影響があります。";
      }
      if (!g.summary) {
        var parts = ["累積利益 " + g.minProfit.toLocaleString() + "円以上", "評判 " + g.minReputation + "以上"];
        if (g.minCustomers != null) parts.push("累積客数 " + g.minCustomers + "人以上");
        g.summary = parts.join(" ・ ");
      }
    }
    return state;
  }

  // まだセットアップ（難易度／業種／店名／初期メニュー選択）を終えていない、
  // ゲーム開始前の「仮の」プレイヤー状態。main.jsはこの状態の間、セットアップ画面を表示する。
  function createPendingState() {
    return { setupComplete: false };
  }

  function save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn("save failed", e);
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (e) {
      console.warn("load failed", e);
      return null;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {}
  }

  Game.Core.State = {
    createInitialState: createInitialState,
    createPendingState: createPendingState,
    save: save,
    load: load,
    clearSave: clearSave,
  };
})();
