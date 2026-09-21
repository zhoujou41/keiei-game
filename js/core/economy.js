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

  // 価格変更による需要弾力性（基準価格からのズレ％に応じて需要が増減）
  function priceDemandFactor(product, conditions) {
    var diffPct = (product.currentPrice - product.basePrice) / product.basePrice;
    var sensitivity = 1.3 * (conditions.priceSensitivity || 1);
    var factor = 1 - diffPct * sensitivity;
    return Random.clamp(factor, 0.3, 1.8);
  }

  Game.Core.Economy = {
    skillLevel: skillLevel,
    purchaseCostMultiplier: purchaseCostMultiplier,
    computePurchase: computePurchase,
    computeWages: computeWages,
    priceDemandFactor: priceDemandFactor,
  };
})();
