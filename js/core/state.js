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
        purchaseRate: 100,
        stock: 0,
      });
    });

    var staff = Game.Data.INITIAL_STAFF.map(function (s) {
      return Object.assign({}, s, { aptitude: Object.assign({}, s.aptitude) });
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
      management: { service: 34, cooking: 33, morale: 33 },
      milestoneLength: 4,
      milestoneIndex: 1,
      milestoneAccum: { revenue: 0, profit: 0, customers: 0 },
      currentGoal: null,
      history: [], // 週ごとの結果サマリ
      gameOver: false,
      gameOverReason: null,
      debtWarnings: 0,
      currentWeekConditions: null, // その週の「真の」隠し条件
      currentWeekForesight: null, // その週の「日々の未来視」（月〜日の抽象ヒント。全員デフォルトで無料）
      lastWeekBeats: [], // FIELD画面で再生する「1行=1演出」の統合イベント列（テキスト＋シーン演出）
      lastWeekResult: null,
      layout: Game.Data.createDefaultLayout(),
    };

    state.currentGoal = Game.Core.Goals.generateGoal(state, state.milestoneIndex);
    state.currentWeekConditions = Game.Core.Simulation.generateWeekConditions(state);
    state.currentWeekForesight = Game.Core.Simulation.getDailyForesight(state);

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
      });
    }
    if (!state.currentWeekForesight && state.currentWeekConditions) {
      state.currentWeekForesight = Game.Core.Simulation.getDailyForesight(state);
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
