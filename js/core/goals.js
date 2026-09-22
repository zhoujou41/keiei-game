// goals.js — 経営目標（マイルストーン）システム
// 数ターンごとに必須目標を課す。未達成でも即ゲームオーバーにはせず、
// 経営を圧迫するペナルティを与える。資金が尽きたときのみゲームオーバー。
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  function generateGoal(state, milestoneIndex) {
    // マイルストーンが進むほど目標が厳しくなる
    var difficulty = 1 + (milestoneIndex - 1) * 0.22;
    var minProfit = Math.round(15000 * difficulty * state.milestoneLength);
    var minReputation = Math.min(90, Math.round(45 + milestoneIndex * 3));

    var goal = {
      milestoneIndex: milestoneIndex,
      untilWeek: state.week + state.milestoneLength - 1,
      minProfit: minProfit,
      minReputation: minReputation,
    };

    // 終盤（目安: milestoneIndex >= 4）は複数目標を同時達成させる
    if (milestoneIndex >= 4) {
      goal.minCustomers = Math.round(180 * difficulty);
    }

    // ---- 「今週の試練」表示用テキスト（2026-09-22追加） ----
    // description: 目標の位置づけを説明する導入文（先に表示）。
    // summary: 目標の概要を太字で見せるための短い1行まとめ。
    goal.description =
      "第" + milestoneIndex + "期の試練です。" + state.week + "週目から" + goal.untilWeek +
      "週目までの間に、以下の数値を達成することが求められています。未達成でも即ゲームオーバーにはなりませんが、" +
      "評判低下や追加コストなど経営が苦しくなる影響があります。";
    var summaryParts = [
      "累積利益 " + minProfit.toLocaleString() + "円以上",
      "評判 " + minReputation + "以上",
    ];
    if (goal.minCustomers != null) {
      summaryParts.push("累積客数 " + goal.minCustomers + "人以上");
    }
    goal.summary = summaryParts.join(" ・ ");

    return goal;
  }

  function evaluateGoal(state) {
    var acc = state.milestoneAccum;
    var goal = state.currentGoal;
    var results = {
      profitOk: acc.profit >= goal.minProfit,
      reputationOk: state.reputation >= goal.minReputation,
    };
    if (goal.minCustomers != null) {
      results.customersOk = acc.customers >= goal.minCustomers;
    }
    var allOk = Object.keys(results).every(function (k) {
      return results[k];
    });
    return { results: results, success: allOk };
  }

  // 目標未達の際のペナルティを適用する
  function applyFailurePenalty(state, evalResult) {
    var messages = [];
    if (!evalResult.results.profitOk) {
      // 資金繰り悪化 → 借金（利息のように扱う軽いマイナス）と仕入れ条件悪化
      var penalty = Math.round(Math.abs(state.currentGoal.minProfit) * 0.3);
      state.money -= penalty;
      state.debtWarnings += 1;
      messages.push("利益目標未達により、取引先からの信用が落ち、追加コストが発生した（-" + penalty.toLocaleString() + "円）。");
    }
    if (!evalResult.results.reputationOk) {
      state.reputation = Math.max(0, state.reputation - 8);
      messages.push("評判目標未達により、評判がさらに下落した。");
    }
    if (evalResult.results.customersOk === false) {
      messages.push("客数目標未達により、常連客の一部が離れてしまったようだ。");
      state.reputation = Math.max(0, state.reputation - 4);
    }
    return messages;
  }

  Game.Core.Goals = {
    generateGoal: generateGoal,
    evaluateGoal: evaluateGoal,
    applyFailurePenalty: applyFailurePenalty,
  };
})();
