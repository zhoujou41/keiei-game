// economy.js — お金まわりの計算ヘルパー
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  var Random = Game.Core.Random;

  function skillLevel(state, skillId) {
    return (state.skills && state.skills[skillId]) || 0;
  }

  // 商売スキルによる仕入れコスト割引率
  function purchaseCostMultiplier(state) {
    var lvl = skillLevel(state, "shobai");
    var discount = lvl * 0.03; // -3%/lvl
    return Random.clamp(1 - discount, 0.7, 1);
  }

  // その週の仕入れ総コストと各商品の仕入れ数量を計算
  function computePurchase(state) {
    var costMult = purchaseCostMultiplier(state) * (state.currentWeekConditions.ingredientCostMult || 1);
    var totalCost = 0;
    var quantities = {};
    state.products.forEach(function (p) {
      var qty = Math.round((p.baseStock * p.purchaseRate) / 100);
      quantities[p.id] = qty;
      totalCost += qty * p.cost * costMult;
    });
    return { totalCost: Math.round(totalCost), quantities: quantities, costMult: costMult };
  }

  // 人件費計算（基本勤務日数を超えると割増）
  function computeWages(state) {
    var total = 0;
    var detail = [];
    state.staff.forEach(function (s) {
      var base = Math.min(s.workDays, s.baseWorkDays);
      var over = Math.max(0, s.workDays - s.baseWorkDays);
      var wage = base * s.wagePerDay + over * s.wagePerDay * 1.5;
      total += wage;
      detail.push({ id: s.id, name: s.name, wage: Math.round(wage), overDays: over });
    });
    return { total: Math.round(total), detail: detail };
  }

  // ============= 熟練度レベル（2026-09-22追加） =============
  // 「レベル」は仕入れ量の設定項目ではなく、その商品をどれだけ売りさばいてきたか
  // （累積販売数）から自動的に決まる「熟練度」。プレイヤーが直接いじることはできない。
  // レベルが上がるほど、基準価格より高く売っても客が離れにくくなる（許容度が上がる）が、
  // レベルごとに必ず「これ以上の値段は誰も買わない」という価格天井（priceCeiling）が
  // 存在し、Maxレベルでも青天井にはしない（ユーザー指摘：「価格を上げまくっても全然
  // 売れてしまう」「レベルMaxでも一定以上の値段以上は売れなくして」への対応）。
  var MASTERY_LEVELS = [
    { level: 1, threshold: 0 },
    { level: 2, threshold: 150 },
    { level: 3, threshold: 400 },
    { level: 4, threshold: 900 },
    { level: 5, threshold: 1800 },
  ];
  var MASTERY_MAX_LEVEL = MASTERY_LEVELS[MASTERY_LEVELS.length - 1].level;

  // レベルごとの「価格天井」倍率（基準価格の何倍まで値付けしても客が検討してくれるか）。
  // これを超える価格を付けた商品は、その週の客に一切選ばれなくなる（候補から除外）。
  var CEILING_MULT_BY_LEVEL = { 1: 1.4, 2: 1.7, 3: 2.0, 4: 2.4, 5: 2.8 };
  // レベルごとの「値上げへの敏感さ」係数（小さいほど、天井に近づくまで需要が落ちにくい）。
  var SENSITIVITY_MULT_BY_LEVEL = { 1: 1.0, 2: 0.85, 3: 0.7, 4: 0.58, 5: 0.48 };

  function masteryLevelForCumulative(cum) {
    var lvl = 1;
    MASTERY_LEVELS.forEach(function (m) {
      if (cum >= m.threshold) lvl = m.level;
    });
    return lvl;
  }

  // OFFICE画面表示用：現在のレベル・次のレベルまでに必要な累積販売数などをまとめて返す
  function masteryProgress(cumulativeSold) {
    var cum = cumulativeSold || 0;
    var lvl = masteryLevelForCumulative(cum);
    var next = MASTERY_LEVELS.find(function (m) {
      return m.level === lvl + 1;
    });
    return {
      level: lvl,
      maxLevel: MASTERY_MAX_LEVEL,
      cumulativeSold: cum,
      nextThreshold: next ? next.threshold : null,
      isMax: !next,
    };
  }

  function priceCeiling(product, level) {
    var mult = CEILING_MULT_BY_LEVEL[level] || CEILING_MULT_BY_LEVEL[1];
    return product.basePrice * mult;
  }

  // 価格変更による需要弾力性（基準価格からのズレ％に応じて需要が増減）。
  // 2026-09-22改修: 熟練度レベル（level）を考慮するようにした。
  // ・値下げ側（diffPct<=0）は従来通り（お得感で需要が伸びる、下限0.3・上限1.8）。
  // ・値上げ側は「基準価格〜レベルごとの価格天井」の間をproximity（0〜1）として扱い、
  //   天井に達する（proximity>=1）と需要係数は必ず0になる＝誰にも選ばれなくなる。
  //   レベルが上がるとSENSITIVITY_MULT_BY_LEVELが小さくなり、天井の手前までは
  //   需要が落ちにくくなる（＝「レベルが上がると値上げしても客がついてくる」）が、
  //   天井そのものは常に存在する（＝Maxレベルでも青天井にはしない）。
  function priceDemandFactor(product, conditions, level) {
    level = level || 1;
    var diffPct = (product.currentPrice - product.basePrice) / product.basePrice;
    if (diffPct <= 0) {
      var downFactor = 1 - diffPct * 1.3 * (conditions.priceSensitivity || 1);
      return Random.clamp(downFactor, 0.3, 1.8);
    }
    var ceiling = priceCeiling(product, level);
    var toleranceRange = ceiling - product.basePrice;
    var proximity = toleranceRange > 0 ? (product.currentPrice - product.basePrice) / toleranceRange : 1;
    var sensitivity = (SENSITIVITY_MULT_BY_LEVEL[level] || 1) * (conditions.priceSensitivity || 1);
    var upFactor = 1 - proximity * proximity * (1.35 + 0.9 * sensitivity);
    return Random.clamp(upFactor, 0, 1.8);
  }

  Game.Core.Economy = {
    skillLevel: skillLevel,
    purchaseCostMultiplier: purchaseCostMultiplier,
    computePurchase: computePurchase,
    computeWages: computeWages,
    priceDemandFactor: priceDemandFactor,
    masteryLevelForCumulative: masteryLevelForCumulative,
    masteryProgress: masteryProgress,
    priceCeiling: priceCeiling,
    MASTERY_MAX_LEVEL: MASTERY_MAX_LEVEL,
  };
})();
