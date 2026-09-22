// simulation.js — 1ターン（1週間）の営業シミュレーション
// ここが「でじこミュニケーション的な店の動き」を生み出す中心部分。
// 数値をいきなり出すのではなく、時系列のイベントログを生成し、
// FIELD画面でそれを再生することで「なぜこうなったか」を見せる。
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  var Random = Game.Core.Random;
  var Economy = Game.Core.Economy;

  var TICKS = 20;
  var DAY_NAMES = ["月", "火", "水", "木", "金", "土", "日"];
  var CATEGORIES = ["中華", "和食", "洋食", "デザート"];
  // スタッフの「能力×適性×やる気」の合計値を、1ティックあたりの処理能力に変換する係数。
  // バランス調整用の定数（数値を変えるだけで難易度全体を調整できる）。
  // 2026-09-22（仕入れUI改修）: products.jsのbaseStock再計算（「100%/100%で完売なら
  // 週+20万円程度」を狙った値）に合わせて、CAPACITY_MULTとBASE_WEEKLY_TRAFFICも
  // 拡大した（旧値: 15 / 190）。
  // 2026-09-22（シフト改修）: 初期スタッフを4名→2名に減らしたことで処理能力が大きく
  // 下がったため、CAPACITY_MULTを90→180に再調整。実際にrunWeek()を各業種300回試行して
  // 検証済み（初期スタッフ2名・100%/100%設定）: 中華・和食・洋食は平均17〜18万円の黒字、
  // ピークで20万円前後まで到達。デザートも平均16万円・ピーク22万円程度で、
  // 4業種とも「+20万円程度」の目標にほぼ揃った。ボトルネックは処理能力ではなく
  // 在庫切れ（仕入れ量100%では週内に売り切れることが多い）が中心になっている。
  var CAPACITY_MULT = 180;
  var BASE_WEEKLY_TRAFFIC = 950;

  function skillLevel(state, id) {
    return (state.skills && state.skills[id]) || 0;
  }

  function specialtyBonus(state, category) {
    var map = {
      "中華": "specialty_chuka",
      "和食": "specialty_washoku",
      "洋食": "specialty_yoshoku",
      "デザート": "specialty_dessert",
    };
    var skillId = map[category];
    if (!skillId) return 1;
    return 1 + skillLevel(state, skillId) * 0.05;
  }

  // ---- その週の「真の」隠し条件を生成する ----
  function generateWeekConditions(state) {
    var events = Random.weightedPickN(Game.Data.EVENT_POOL, Random.randInt(1, 2), "weight");
    var conditions = {
      trafficMult: 1,
      categoryMult: {},
      patienceMult: 1,
      ingredientCostMult: 1,
      priceSensitivity: 1,
      events: events,
    };
    CATEGORIES.forEach(function (c) {
      conditions.categoryMult[c] = 1;
    });

    events.forEach(function (ev) {
      var eff = ev.effect || {};
      if (eff.trafficMult) conditions.trafficMult *= eff.trafficMult;
      if (eff.patienceMult) conditions.patienceMult *= eff.patienceMult;
      if (eff.ingredientCostMult) conditions.ingredientCostMult *= eff.ingredientCostMult;
      if (eff.priceSensitivity) conditions.priceSensitivity *= eff.priceSensitivity;
      if (eff.categoryMult) {
        Object.keys(eff.categoryMult).forEach(function (c) {
          conditions.categoryMult[c] = (conditions.categoryMult[c] || 1) * eff.categoryMult[c];
        });
      }
      if (eff.randomCategoryBoost) {
        var c = Random.pick(CATEGORIES);
        conditions.categoryMult[c] = (conditions.categoryMult[c] || 1) * eff.randomCategoryBoost;
      }
    });

    // ---- 難易度（＝ゲーム開始時に選んだ「最初の未来視」）による業界全体の倍率 ----
    // 重要: 業種（ラーメン/和食/洋食/デザート）による有利不利は一切作らない。
    // ここで参照するのはstate.difficulty（プレイヤーが選んだ業界全体の景気見通し）だけで、
    // state.storeTypeは一切参照しない。カテゴリ別の需要（categoryMult）はイベントだけで決まる。
    var difficulty = Game.Data.getDifficulty(state.difficulty);
    var dm = difficulty.multipliers;
    conditions.trafficMult *= dm.trafficMult;
    conditions.patienceMult *= dm.patienceMult;
    conditions.ingredientCostMult *= dm.ingredientCostMult;
    conditions.priceSensitivity *= dm.priceSensitivity;

    // 商品ごとの「真の需要倍率」（多少のノイズを加える。これがスキルで覗ける対象）
    conditions.productDemandMult = {};
    Game.Data.PRODUCTS.forEach(function (p) {
      var catMult = conditions.categoryMult[p.category] || 1;
      var noise = Random.randRange(0.85, 1.15);
      conditions.productDemandMult[p.id] = Math.round(catMult * noise * 1000) / 1000;
    });

    // 疑似・競合店情報（百眼スキルの対象）
    var activityLevels = ["閑散としている", "普段通り", "かなり活気がある"];
    conditions.competitor = {
      activity: Random.pick(activityLevels),
      focusCategory: Random.pick(CATEGORIES),
      priceOffset: Random.randInt(-15, 15), // 自店平均価格に対する％差の目安
    };

    // 曜日ごとの客足の強さのばらつき（「日々の未来視」＝全員デフォルトで無料の基本情報の元ネタ）。
    // 月=0〜日=6。週の合計来客数（totalCustomers）自体は変えず、週内でどの曜日に
    // 客が寄りやすいかだけをここで決めておく（runWeek側で来客の曜日別配分に反映する）。
    conditions.dayTraffic = DAY_NAMES.map(function (_, idx) {
      var weekendBoost = idx === 5 || idx === 6 ? Random.randRange(1.05, 1.25) : 1; // 土日はやや強めに出やすい
      return Math.round(Random.randRange(0.8, 1.2) * weekendBoost * 100) / 100;
    });

    return conditions;
  }

  var DAY_TRAFFIC_WORDS = [
    { max: 0.88, text: "客足はかなり少なめになりそうです" },
    { max: 0.97, text: "客足はやや少なめになりそうです" },
    { max: 1.03, text: "客足はいつも通りになりそうです" },
    { max: 1.12, text: "客足はやや強くなりそうです" },
    { max: Infinity, text: "客足はかなり強くなりそうです" },
  ];
  function trafficWord(mult) {
    for (var i = 0; i < DAY_TRAFFIC_WORDS.length; i++) {
      if (mult <= DAY_TRAFFIC_WORDS[i].max) return DAY_TRAFFIC_WORDS[i].text;
    }
    return DAY_TRAFFIC_WORDS[DAY_TRAFFIC_WORDS.length - 1].text;
  }

  function ingredientWord(mult) {
    if (mult >= 1.08) return "食材価格がやや高くなる気配があります";
    if (mult <= 0.93) return "食材価格が落ち着く（安くなる）気配があります";
    return "食材価格は大きく動かなさそうです";
  }

  // 商品の需要を「高そう/普段通り/苦戦しそう」程度の言葉に丸める（具体的な数値は出さない）
  function demandWord(productName, mult) {
    if (mult >= 1.12) return "「" + productName + "」の人気がかなり高まりそうです";
    if (mult >= 1.03) return "「" + productName + "」の人気が高まる気配があります";
    if (mult <= 0.9) return "「" + productName + "」はやや苦戦しそうな気配があります";
    return "「" + productName + "」は普段通りの人気になりそうです";
  }

  var ATMOSPHERE_HINTS = [
    "夕方から客が増える気配があります",
    "家族連れの姿が増えそうです",
    "若い客が増える気配があります",
    "常連さんの顔がよく見える日になりそうです",
    "お昼どきに人の流れが集中しそうです",
    "ゆったりと過ごしたい客が多そうです",
    "近くで催しがあり、人通りが増えるかもしれません",
    "天気の影響で、外を歩く人はやや少なめかもしれません",
  ];

  // ---- 「今週の未来視」：週全体をまとめた、なんとなくの抽象的な予兆・傾向 ----
  // （2026-09-22改修: 曜日ごとの個別予想は廃止し、週全体でざっくり1つの予想にまとめた。
  //  EASY/NORMAL/HARDとは別のシステム。具体的な数値・正解は一切出さず、
  //  「何が起こりそうか」だけを示す（「何をすればいいか」は教えない）。）
  function getWeekForesight(state) {
    var cond = state.currentWeekConditions;
    if (!cond) return { lines: [] };
    var lines = [];
    lines.push(trafficWord(cond.trafficMult));

    if (state.products && state.products.length > 0) {
      var candidates = state.products.map(function (p) {
        var mult = (cond.productDemandMult && cond.productDemandMult[p.id]) || 1;
        return { name: p.name, mult: mult, weight: Math.max(0.05, mult) };
      });
      var featured = Random.weightedPick(candidates, "weight");
      lines.push(demandWord(featured.name, featured.mult));
    }

    lines.push(ingredientWord(cond.ingredientCostMult));
    lines.push(Random.pick(ATMOSPHERE_HINTS));

    return { lines: lines };
  }

  // ---- スキルによる事前情報（ヒント）テキスト生成 ----
  function getForesightHint(state) {
    var lvl = skillLevel(state, "foresight");
    if (lvl <= 0) return { available: false, text: "「未来見通し」を習得していない。" };
    if (state.focusSkill !== "foresight") {
      return { available: false, text: "今週「未来見通し」に集中していないため、詳しくは分からない。" };
    }
    var cond = state.currentWeekConditions;
    var best = null;
    Game.Data.PRODUCTS.forEach(function (p) {
      var mult = cond.productDemandMult[p.id];
      if (!best || mult > best.mult) best = { p: p, mult: mult };
    });
    var pct = Math.round((best.mult - 1) * 100);
    if (lvl <= 2) {
      return { available: true, text: "来週は「" + best.p.name + "」の需要が高そうだ。" };
    } else if (lvl <= 4) {
      var word = pct >= 25 ? "かなり高くなりそう" : pct >= 10 ? "やや高くなりそう" : "そこまで変わらなそう";
      return { available: true, text: "来週の「" + best.p.name + "」需要は、通常より" + word + "。" };
    } else {
      var lo = Math.max(0, pct - 5);
      var hi = pct + 5;
      return {
        available: true,
        text: "来週の「" + best.p.name + "」需要は、通常より" + lo + "～" + hi + "%程度増加する見込み。",
      };
    }
  }

  function getHyakuganHint(state) {
    var lvl = skillLevel(state, "hyakugan");
    if (lvl <= 0) return { available: false, text: "「百眼」を習得していない。" };
    if (state.focusSkill !== "hyakugan") {
      return { available: false, text: "今週「百眼」に集中していないため、詳しくは分からない。" };
    }
    var comp = state.currentWeekConditions.competitor;
    if (lvl <= 2) {
      return { available: true, text: "近隣の競合店を覗いてみた。店内は" + comp.activity + "ようだ。" };
    } else if (lvl <= 4) {
      return {
        available: true,
        text: "競合店は" + comp.activity + "。どうやら「" + comp.focusCategory + "」系のメニューに力を入れているようだ。",
      };
    } else {
      var diff = comp.priceOffset >= 0 ? "高めの" : "安めの";
      return {
        available: true,
        text:
          "競合店は" + comp.activity + "。「" + comp.focusCategory + "」系に注力し、価格は自店より" +
          Math.abs(comp.priceOffset) + "%ほど" + diff + "設定のようだ。客層や仕入れ状況まで概ね把握できた。",
      };
    }
  }

  // ---- 1週間分のシミュレーションを実行する ----
  // FIELD画面の再生は「テキストログ」と「空間シーン」を別々に持つのではなく、
  // ひとつの時系列beat列（テキスト＋演出アクション＋曜日タグ）として作る。
  // これにより、表示されているテキストと店内の動きが必ず対応し、曜日ごとの
  // 再生も自然にできるようになる（数値計算のロジック自体は一切変更していない）。
  function runWeek(state) {
    var beats = [];
    var conditions = state.currentWeekConditions;
    // この週を実際にプレイする直前の「今週の未来視」をスナップショットしておく。
    // 関数末尾で次週分のcurrentWeekForesightに上書きしてしまうため、それより前に
    // 確保しておかないと、FIELD画面のリプレイ時に「次の週」の予想が出てしまう
    // （OFFICE画面で見たものと必ず一致させるための対応）。
    var playedWeekForesight = state.currentWeekForesight;
    // 曜日インデックス: 0=準備（営業開始前）, 1〜7=月〜日, 8=結果
    var currentDay = 0;

    function pushLog(icon, text, kind) {
      beats.push({ icon: icon, text: text, kind: kind || "info", day: currentDay, action: null });
    }
    // テキストと同時に、FIELD画面の空間シーンで実行すべき演出アクションを紐付けて記録する。
    // 数値計算には一切影響しない「追記のみ」の演出用データ。
    function pushLogAction(icon, text, kind, action) {
      beats.push({ icon: icon, text: text, kind: kind || "info", day: currentDay, action: action });
    }

    // イベントの一部を営業開始時に開示（プレイヤーが後から結果と結びつけられるように）
    conditions.events.forEach(function (ev) {
      pushLog(ev.icon, "【今週の空気】" + ev.flavor, "event");
    });

    // ---- 借金の利息（前週から所持金がマイナスの場合） ----
    if (state.money < 0) {
      var interest = Math.round(Math.abs(state.money) * 0.05);
      state.money -= interest;
      pushLog("💳", "借金状態が続いている。利息として " + interest.toLocaleString() + "円が追加で引かれた。", "bad");
    }

    // ---- 集中スキルの代償を適用 ----
    var managementPenaltyPct = 0;
    if (state.focusSkill) {
      var lvl = skillLevel(state, state.focusSkill);
      var cost = Game.Data.focusCost(lvl);
      state.money -= cost.money;
      managementPenaltyPct = cost.managementPenaltyPct;
      var skillDef = Game.Data.SKILLS.find(function (s) {
        return s.id === state.focusSkill;
      });
      pushLog("🧠", "「" + skillDef.name + "」に集中した（費用 " + cost.money.toLocaleString() + "円）。他のことに割ける意識が少し減る。", "skill");
    }
    var managementEffMult = Random.clamp(1 - managementPenaltyPct / 100, 0.5, 1);

    // ---- 仕入れ ----
    var purchase = Economy.computePurchase(state);
    state.products.forEach(function (p) {
      p.stock = purchase.quantities[p.id];
    });
    pushLog(
      "📦",
      "仕入れを行った（総額 " + purchase.totalCost.toLocaleString() + "円）：" +
        state.products.map(function (p) { return p.name + " " + p.stock + "食"; }).join(" / "),
      "purchase"
    );

    // ---- スタッフの稼働準備 ----
    // 2026-09-22（シフト改修）: 勤務日は曜日ごとのチェック（workDaysMask、0=月…6=日）で
    // 指定されるようになった。reliability（信頼度）自体はやる気ベースで曜日に依存しないが、
    // 実際にその曜日に働くかどうかはworksOnDay()で曜日ごとに判定する。
    function worksOnDay(s, dayIdx) {
      if (s.workDaysMask) return !!s.workDaysMask[dayIdx];
      return s.workDays > 0; // 後方互換（旧セーブ・マスク未設定分）
    }

    var reliability = {};
    state.staff.forEach(function (s) {
      if (!s.workDays || s.workDays <= 0) {
        reliability[s.id] = 0;
        return;
      }
      var base = Random.clamp(s.motivation / 100, 0.3, 1.05);
      reliability[s.id] = base;
    });

    var slackLogged = {};
    function staffCapacity(role, dayIdx) {
      var total = 0;
      state.staff.forEach(function (s) {
        if (s.role !== role || !worksOnDay(s, dayIdx)) return;
        var rel = reliability[s.id];
        // やる気が低いとサボる確率
        if (s.motivation < 40 && Random.rand() < 0.35 && !slackLogged[s.id]) {
          slackLogged[s.id] = true;
          pushLog("😮‍💨", s.name + "はやる気が上がらず、少しサボり気味になっている…", "staff");
          rel *= 0.5;
        }
        total += (s.aptitude[role] / 100) * (s.ability / 100) * rel;
      });
      return total;
    }

    // 調理・接客・雑務の処理能力は曜日ごとに変わるため、日が変わるたびにrefreshDayCapacities()
    // で再計算する（下のティックループ内、曜日境界で呼び出す）。不足時の警告は週1回のみ。
    var kitchenCapPerTick = 0, serviceCapPerTick = 0, choresCapPerTick = 0;
    var kitchenWarnLogged = false, serviceWarnLogged = false;
    function refreshDayCapacities(dayIdx) {
      kitchenCapPerTick = staffCapacity("cooking", dayIdx) * CAPACITY_MULT;
      serviceCapPerTick = staffCapacity("service", dayIdx) * CAPACITY_MULT;
      choresCapPerTick = staffCapacity("chores", dayIdx) * CAPACITY_MULT;
      if (kitchenCapPerTick < 2.5 && !kitchenWarnLogged) {
        kitchenWarnLogged = true;
        pushLog("⚠️", "調理担当の手が足りていない。注文をさばき切れなそうだ…", "warn");
      }
      if (serviceCapPerTick < 2.5 && !serviceWarnLogged) {
        serviceWarnLogged = true;
        pushLog("⚠️", "接客担当の手が足りていない。案内が遅れそうだ…", "warn");
      }
    }
    refreshDayCapacities(0); // 月曜分（週の代表値として、後述の来客数・我慢強さ計算にも使う）

    // ---- 来客数の決定 ----
    var reputationFactor = Random.clamp(state.reputation / 50, 0.4, 1.8);
    var totalCustomers = Math.round(BASE_WEEKLY_TRAFFIC * reputationFactor * conditions.trafficMult * Random.randRange(0.9, 1.1));
    // 「呼込」担当がいると、その週の客足がわずかに増える（曜日ごとの稼働量の合計を反映）
    var callingWeeklyCap = 0;
    for (var callDay = 0; callDay < 7; callDay++) {
      callingWeeklyCap += staffCapacity("calling", callDay);
    }
    var callingBoost = 1 + Random.clamp(callingWeeklyCap, 0, 20) * 0.01; // 最大+20%程度
    totalCustomers = Math.round(totalCustomers * callingBoost);
    totalCustomers = Math.max(10, totalCustomers);

    // 客の「我慢強さ」平均耐性（ティック単位）。サービス能力が高いと体感待ち時間が減る。
    var patienceBase = 3.2 * conditions.patienceMult * (1 + Random.clamp(serviceCapPerTick, 0, 10) * 0.03);

    // ---- ティックシミュレーション ----
    var queue = []; // {productId, wait, patience}
    var stockLeft = {};
    state.products.forEach(function (p) {
      stockLeft[p.id] = p.stock;
    });

    var stats = {
      served: 0,
      leftDisappointed: 0, // 売り切れで代替もなく帰った
      leftWaiting: 0, // 待ちきれず帰った
      leftPriceRejected: 0, // 2026-09-22追加: 全商品が価格天井を超えていて何も買えず帰った
      revenue: 0,
      satisfactionSum: 0,
      satisfactionCount: 0,
      stockoutProducts: {},
      byProduct: {}, // 2026-09-22（先週の状況パネル対応）: 商品ごとの販売数・売上・満足度を集計
    };

    var soldOutLogged = {};
    var queueWarnLogged = false;
    var kitchenCapCarry = 0;

    var dayBoundaries = DAY_NAMES.map(function (_, d) {
      return Math.floor((d * TICKS) / DAY_NAMES.length);
    });
    // 各ティックがどの曜日（0=月…6=日）に属するかを先に求めておく
    // （「日々の未来視」のconditions.dayTrafficを、来客の曜日別配分に反映させるため）。
    var tickDayIdx = [];
    var curDayForTick = 0;
    for (var td = 0; td < TICKS; td++) {
      var b = dayBoundaries.indexOf(td);
      if (b !== -1) curDayForTick = b;
      tickDayIdx.push(curDayForTick);
    }

    // 週の来客数をティックに分配（ばらつきを持たせる）。週の合計人数（totalCustomers）自体は
    // 変えず、conditions.dayTrafficで曜日ごとの寄りやすさだけを反映する
    // （＝「日々の未来視」で示した客足の傾向が、実際の結果と対応するようにする）。
    var arrivalsPerTick = [];
    var remaining = totalCustomers;
    for (var t = 0; t < TICKS; t++) {
      var dayMult = (conditions.dayTraffic && conditions.dayTraffic[tickDayIdx[t]]) || 1;
      var share = (totalCustomers / TICKS) * dayMult;
      var a = Math.round(share * Random.randRange(0.4, 1.6));
      a = Math.min(a, remaining);
      arrivalsPerTick.push(a);
      remaining -= a;
    }
    if (remaining > 0) arrivalsPerTick[TICKS - 1] += remaining;

    for (var tick = 0; tick < TICKS; tick++) {
      var dayBoundaryIdx = dayBoundaries.indexOf(tick);
      if (dayBoundaryIdx !== -1) {
        currentDay = 1 + dayBoundaryIdx; // 月=1 … 日=7
        pushLog("📅", "―― " + DAY_NAMES[dayBoundaryIdx] + "曜日 ――", "day");
        refreshDayCapacities(dayBoundaryIdx); // その曜日のシフト（workDaysMask）に応じて処理能力を再計算
      }

      var arrivals = arrivalsPerTick[tick];
      var enteredThisTick = 0;
      var enteredProductsThisTick = [];
      var disappointedThisTick = 0;
      var priceRejectedThisTick = 0;
      for (var i = 0; i < arrivals; i++) {
        // 商品選択（人気度 × 需要倍率 × 専門スキル × 価格弾力性）。
        // 2026-09-22（価格天井対応）: 熟練度レベルごとの価格天井（Economy.priceCeiling）を
        // 超える値付けの商品はpriceDemandFactorが0を返すため、候補から完全に除外する
        // （＝いくら人気があっても、価格天井を超えた商品が選ばれることは無くなる）。
        var candidates = state.products
          .map(function (p) {
            var priceFactor = Economy.priceDemandFactor(p, conditions, p.masteryLevel || 1);
            var weight =
              p.popularity * conditions.productDemandMult[p.id] * specialtyBonus(state, p.category) * priceFactor;
            return { p: p, weight: weight, priceOk: priceFactor > 0 };
          })
          .filter(function (c) {
            return c.priceOk;
          });

        if (candidates.length === 0) {
          // 全商品が価格天井を超えていて、誰も何も買えない（極端な高値設定時のみ起こりうる）。
          stats.leftPriceRejected++;
          priceRejectedThisTick++;
          continue;
        }

        var wanted = Random.weightedPick(candidates, "weight").p;

        var chosen = wanted;
        if (stockLeft[wanted.id] <= 0) {
          if (!soldOutLogged[wanted.id]) {
            soldOutLogged[wanted.id] = true;
            pushLog("🚫", "「" + wanted.name + "」が売り切れました！", "stockout");
            stats.stockoutProducts[wanted.id] = true;
          }
          var alt = candidates.filter(function (c) {
            return stockLeft[c.p.id] > 0;
          });
          if (alt.length === 0) {
            stats.leftDisappointed++;
            disappointedThisTick++;
            continue;
          }
          chosen = Random.weightedPick(alt, "weight").p;
        }

        stockLeft[chosen.id]--;
        queue.push({ productId: chosen.id, wait: 0, patience: Math.max(1, Random.randRange(patienceBase * 0.5, patienceBase * 1.5)) });
        enteredThisTick++;
        enteredProductsThisTick.push(chosen.id);
      }

      // このティックで実際に起きた「入店」「入店できず離脱」をそれぞれ1つのbeatにまとめる。
      // テキストと店内アニメーションが同じ人数・同じタイミングで対応するようにするため。
      if (priceRejectedThisTick > 0) {
        pushLogAction(
          "💸",
          priceRejectedThisTick + "名が来店したが、値段を見て購入意欲をなくし、何も注文せず帰ってしまった。",
          "leave",
          { type: "leave_disappointed", count: priceRejectedThisTick }
        );
      }
      if (disappointedThisTick > 0) {
        pushLogAction(
          "🚫",
          disappointedThisTick + "名が来店したが、目当ての商品が売り切れで諦めて帰ってしまった。",
          "leave",
          { type: "leave_disappointed", count: disappointedThisTick }
        );
      }
      if (enteredThisTick > 0) {
        pushLogAction(
          "🚶",
          enteredThisTick + "名が来店し、テーブルに着いた。",
          "enter",
          { type: "enter_seat", count: enteredThisTick, productIds: enteredProductsThisTick }
        );
      }

      if (queue.length > 7 && !queueWarnLogged) {
        queueWarnLogged = true;
        pushLog("⏳", "注文が溜まり、店内に行列ができ始めた…", "warn");
      }

      // 厨房の処理能力で注文をさばく
      var capacity = kitchenCapPerTick + kitchenCapCarry;
      var canComplete = Math.floor(capacity);
      kitchenCapCarry = capacity - canComplete;

      var completedThisTick = 0;
      var newQueue = [];
      var servedProductsThisTick = [];
      var leftWaitingThisTick = 0;
      for (var qi = 0; qi < queue.length; qi++) {
        var order = queue[qi];
        if (completedThisTick < canComplete) {
          completedThisTick++;
          var product = state.products.find(function (p) { return p.id === order.productId; });
          stats.served++;
          stats.revenue += product.currentPrice;
          var satisfaction = order.wait <= 1 ? 90 : order.wait <= 3 ? 65 : 40;
          stats.satisfactionSum += satisfaction;
          stats.satisfactionCount++;
          if (!stats.byProduct[order.productId]) {
            stats.byProduct[order.productId] = { sold: 0, revenue: 0, satisfactionSum: 0, satisfactionCount: 0 };
          }
          var pbEntry = stats.byProduct[order.productId];
          pbEntry.sold++;
          pbEntry.revenue += product.currentPrice;
          pbEntry.satisfactionSum += satisfaction;
          pbEntry.satisfactionCount++;
          servedProductsThisTick.push(order.productId);
        } else {
          order.wait++;
          if (order.wait > order.patience) {
            stats.leftWaiting++;
            leftWaitingThisTick++;
          } else {
            newQueue.push(order);
          }
        }
      }
      queue = newQueue;

      // このティックで完了した「配膳」「待ちきれず離脱」もそれぞれ1つのbeatにまとめる。
      if (servedProductsThisTick.length > 0) {
        pushLogAction(
          "🍽️",
          servedProductsThisTick.length + "名の料理が運ばれた。",
          "sale",
          { type: "serve_batch", count: servedProductsThisTick.length, productIds: servedProductsThisTick }
        );
      }
      if (leftWaitingThisTick > 0) {
        pushLogAction(
          "🚶",
          leftWaitingThisTick + "名が待ちきれず、帰ってしまった…",
          "leave",
          { type: "leave_waiting_batch", count: leftWaitingThisTick }
        );
      }

      // スタッフの疲労／回復ドリフト（軽微）。「雑務」担当がいるとフォローに入り疲労が和らぐ。
      if (tick % 5 === 4) {
        var burnoutRelief = Random.clamp(choresCapPerTick * 0.15, 0, 1);
        state.staff.forEach(function (s) {
          if (s.workDays <= 0) return;
          if (queue.length > 6) {
            s.motivation = Random.clamp(s.motivation - (1.5 - burnoutRelief), 0, 100);
          }
        });
      }
    }

    currentDay = 8; // 結果（営業終了後のまとめ）

    // 週末時点でまだ並んでいた客も離脱扱い
    if (queue.length > 0) {
      stats.leftWaiting += queue.length;
      pushLogAction(
        "🚶",
        queue.length + "名が営業終了までに料理を受け取れず、帰ってしまった。",
        "leave",
        { type: "leave_waiting_batch", count: queue.length }
      );
    }

    // 廃棄（売れ残り在庫）
    var wasteText = [];
    state.products.forEach(function (p) {
      if (stockLeft[p.id] > 0) {
        wasteText.push(p.name + " " + stockLeft[p.id] + "食");
      }
    });
    if (wasteText.length > 0) {
      pushLog("🗑️", "営業終了。売れ残った食材が廃棄された：" + wasteText.join(" / "), "waste");
    } else {
      pushLog("✨", "営業終了。ちょうど良い在庫配分だった（廃棄なし）。", "good");
    }

    // ---- 収支計算 ----
    var wages = Economy.computeWages(state);
    var focusMoneyCost = state.focusSkill ? Game.Data.focusCost(skillLevel(state, state.focusSkill)).money : 0;
    var profit = stats.revenue - purchase.totalCost - wages.total - focusMoneyCost;
    // focus費用は冒頭で既に引いている。ここでは売上・人件費・仕入費用を反映する。
    state.money += stats.revenue - wages.total - purchase.totalCost;

    pushLog(
      "💴",
      "今週の収支：売上 " + stats.revenue.toLocaleString() + "円 / 人件費 " + wages.total.toLocaleString() +
        "円 / 仕入 " + purchase.totalCost.toLocaleString() + "円 → 利益 " + profit.toLocaleString() + "円",
      "result"
    );

    // ---- 評判の変化 ----
    var avgSatisfaction = stats.satisfactionCount > 0 ? stats.satisfactionSum / stats.satisfactionCount : 50;
    var stockoutCount = Object.keys(stats.stockoutProducts).length;
    var repDelta = (avgSatisfaction - 55) * 0.15 - stockoutCount * 0.8 - stats.leftWaiting * 0.05 - stats.leftPriceRejected * 0.05;
    repDelta = Random.clamp(repDelta, -12, 12);
    state.reputation = Random.clamp(state.reputation + repDelta, 0, 100);
    if (repDelta >= 2) {
      pushLog("⭐", "お客さんの満足度が高く、評判が少し上がった。", "good");
    } else if (repDelta <= -2) {
      pushLog("📉", "対応しきれなかった客が多く、評判が下がってしまった。", "bad");
    }

    // ---- スタッフの成長／モチベーション回復（個人ごとのマネジメント方針） ----
    // 2026-09-22（シフト改修）: 全体共通の3項目スライダー（state.management）を廃止し、
    // スタッフ1人ごとに「重視：業務指導 ⟷ やる気回復」の2軸（managementFocus）を
    // 設定できるようにした（子画面＝スタッフ詳細モーダルで設定）。
    var mgmtLvl = skillLevel(state, "management");
    var mgmtSkillMult = (1 + mgmtLvl * 0.1) * managementEffMult;
    state.staff.forEach(function (s) {
      if (s.workDays <= 0) return;
      var focus = s.managementFocus || { guidance: 50, morale: 50 };
      var moraleGain = (focus.morale / 100) * 6 * mgmtSkillMult;
      s.motivation = Random.clamp(s.motivation + moraleGain - 2, 0, 100);

      var growth = (focus.guidance / 100) * 1.2 * mgmtSkillMult;
      s.ability = Random.clamp(s.ability + growth, 0, 100);
    });

    // ---- 週給・累積 ----
    state.milestoneAccum.revenue += stats.revenue;
    state.milestoneAccum.profit += profit;
    state.milestoneAccum.customers += stats.served;

    // 2026-09-22（先週の状況パネル対応）: 商品ごとの「先週の価格・仕入れ数・売れた数・
    // 余った数・利益・値段に対する客の評価」を、OFFICE画面の「先週の状況」パネルで
    // 使えるようにまとめておく。値段への評価（valueLabel）は、既存の価格弾力性モデル
    // （Economy.priceDemandFactor＝基準価格からの乖離に応じて需要が増減する仕組み）を
    // そのまま再利用し、「基準価格よりお得な価格設定だったか／割高だったか」として表現する
    // （＝味そのものを表す独立した数値データは無いため、価格の妥当性という形で代用する）。
    // ---- 熟練度（累積販売数）の更新 ----（2026-09-22追加）
    // 「レベルはその料理の熟練度。一定量さばくことでレベルを上げる」という指定に対応し、
    // 週末（この時点で今週の販売数が確定している）に商品ごとの累積販売数へ加算し、
    // 必要ならレベルアップの判定・ログを行う。次週の仕入れ・価格判定は既にこの週の
    // runWeek()内で完了しているため、レベルアップの効果は「次に営業する週」から反映される。
    state.products.forEach(function (p) {
      var pb = stats.byProduct[p.id];
      if (!pb || pb.sold <= 0) return;
      p.cumulativeSold = (p.cumulativeSold || 0) + pb.sold;
      var newLevel = Economy.masteryLevelForCumulative(p.cumulativeSold);
      var oldLevel = p.masteryLevel || 1;
      if (newLevel > oldLevel) {
        p.masteryLevel = newLevel;
        pushLog("📈", "「" + p.name + "」の熟練度がLv." + newLevel + "に上がった。値上げしても客が離れにくくなる。", "good");
      }
    });

    var itemStats = state.products.map(function (p) {
      var pb = stats.byProduct[p.id] || { sold: 0, revenue: 0, satisfactionSum: 0, satisfactionCount: 0 };
      var purchasedQty = purchase.quantities[p.id] || 0;
      var purchaseCostYen = Math.round(purchasedQty * p.cost * purchase.costMult);
      var leftoverQty = Math.max(0, stockLeft[p.id] || 0);
      var itemProfit = pb.revenue - purchasedQty * p.cost * purchase.costMult;
      var avgSatisfaction = pb.satisfactionCount > 0 ? Math.round(pb.satisfactionSum / pb.satisfactionCount) : null;
      var valueFactor = Economy.priceDemandFactor(p, conditions, p.masteryLevel || 1);
      var valueLabel =
        valueFactor <= 0 ? "高すぎて敬遠されている" : valueFactor >= 1.15 ? "お得感あり" : valueFactor <= 0.85 ? "割高感あり" : "妥当な価格感";
      return {
        productId: p.id,
        name: p.name,
        priceAtSale: p.currentPrice,
        cost: p.cost,
        purchasedQty: purchasedQty,
        purchaseCost: purchaseCostYen,
        soldQty: pb.sold,
        leftoverQty: leftoverQty,
        profit: Math.round(itemProfit),
        avgSatisfaction: avgSatisfaction,
        valueLabel: valueLabel,
        masteryLevel: p.masteryLevel || 1,
      };
    });

    var result = {
      week: state.week,
      playedWeekForesight: playedWeekForesight,
      revenue: stats.revenue,
      profit: profit,
      served: stats.served,
      leftDisappointed: stats.leftDisappointed,
      leftWaiting: stats.leftWaiting,
      leftPriceRejected: stats.leftPriceRejected,
      leftTotal: stats.leftDisappointed + stats.leftWaiting + stats.leftPriceRejected,
      reputationBefore: Math.round((state.reputation - repDelta) * 10) / 10,
      reputationAfter: Math.round(state.reputation * 10) / 10,
      repDelta: Math.round(repDelta * 10) / 10,
      money: state.money,
      stockoutProducts: Object.keys(stats.stockoutProducts),
      itemStats: itemStats,
      goalCheck: null,
    };

    // ---- 目標判定（マイルストーン） ----
    var milestoneAdvanced = false;
    if (state.week === state.currentGoal.untilWeek) {
      var evalResult = Game.Core.Goals.evaluateGoal(state);
      if (evalResult.success) {
        state.money += 20000;
        pushLog("🏆", "経営目標を達成した！臨時収入として20,000円を得た。", "good");
      } else {
        var msgs = Game.Core.Goals.applyFailurePenalty(state, evalResult);
        msgs.forEach(function (m) {
          pushLog("💥", m, "bad");
        });
      }
      result.goalCheck = { success: evalResult.success, goal: state.currentGoal };
      state.milestoneIndex += 1;
      state.milestoneAccum = { revenue: 0, profit: 0, customers: 0 };
      milestoneAdvanced = true;
    }

    // ---- ゲームオーバー判定 ----
    // マイナスになってもすぐには終わらない（＝借金状態。翌週以降に利息が発生する）。
    // 一定額（-100,000円）を下回ると、経営を続けられなくなる。
    var BANKRUPTCY_LINE = -100000;
    if (state.money < 0 && state.money >= BANKRUPTCY_LINE) {
      pushLog("⚠️", "所持金がマイナスになり、借金状態に入った。このままでは危険だ…", "bad");
    }
    if (state.money < BANKRUPTCY_LINE) {
      state.gameOver = true;
      state.gameOverReason = "借金が膨らみすぎて、店を続けられなくなった。";
      pushLog("☠️", "借金が限界を超えた。もう店を続けられない…", "bad");
    }

    state.history.push(result);
    state.lastWeekBeats = beats;
    state.lastWeekResult = result;

    // ---- 次週の準備 ----
    if (!state.gameOver) {
      state.week += 1;
      state.skillPoints += 1;
      state.focusSkill = null;
      // 週を進めた後に次のマイルストーン目標を作る（untilWeekのズレを防ぐため）
      if (milestoneAdvanced) {
        state.currentGoal = Game.Core.Goals.generateGoal(state, state.milestoneIndex);
      }
      state.currentWeekConditions = generateWeekConditions(state);
      state.currentWeekForesight = getWeekForesight(state);
    }

    return { beats: beats, result: result };
  }

  Game.Core.Simulation = {
    generateWeekConditions: generateWeekConditions,
    getForesightHint: getForesightHint,
    getHyakuganHint: getHyakuganHint,
    getWeekForesight: getWeekForesight,
    runWeek: runWeek,
  };
})();
