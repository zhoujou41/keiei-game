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

    // ---- 「今週の目標」表示用テキスト（2026-09-22追加、2026-09-22「試練」→「目標」に改称） ----
    // description: 目標の位置づけを説明する導入文（先に表示）。
    // summary: 目標の概要を太字で見せるための短い1行まとめ。
    goal.description =
      "第" + milestoneIndex + "期の目標です。" + state.week + "週目から" + goal.untilWeek +
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

  // 2026-09-22（今週の目標・バッドステータス表示対応）: マイルストーン期間の途中経過を見て、
  // 「このままのペースだと期限までに目標未達になりそうか」を判定する。
  // ・累積利益／累積客数：期間内で既に経過した週数の割合（elapsedRatio）に対して、
  //   達成率（現在の累積／目標値）が明らかに下回っていれば「ペースが遅れている」とみなす。
  //   （少しの遅れで毎週表示がちらつかないよう、5%のバッファを設けている）
  // ・評判：累積ではなく「常にその時点の値が目標以上であるべき」指標のため、単純に
  //   現在値が目標を下回っているかどうかで判定する（ペース計算は行わない）。
  // 期間の最初の週（まだ1週も終わっていない＝elapsedWeeks=0）は判定材料が無いため
  // 「遅れている」とは表示しない。
  function evaluatePace(state) {
    var goal = state.currentGoal;
    var acc = state.milestoneAccum;
    var startWeek = goal.untilWeek - state.milestoneLength + 1;
    var elapsedWeeks = Random_clamp0(state.week - startWeek, 0, state.milestoneLength);
    var elapsedRatio = elapsedWeeks / state.milestoneLength;

    var messages = [];
    var profitBehind = false;
    var customersBehind = false;
    var reputationBehind = state.reputation < goal.minReputation;

    if (elapsedWeeks > 0) {
      var profitRatio = goal.minProfit > 0 ? acc.profit / goal.minProfit : 1;
      if (profitRatio < elapsedRatio - 0.05) {
        profitBehind = true;
        messages.push("累積利益が目標ペースを下回っています。");
      }
      if (goal.minCustomers != null) {
        var customerRatio = goal.minCustomers > 0 ? acc.customers / goal.minCustomers : 1;
        if (customerRatio < elapsedRatio - 0.05) {
          customersBehind = true;
          messages.push("累積客数が目標ペースを下回っています。");
        }
      }
    }
    if (reputationBehind) {
      messages.push("評判が目標水準に届いていません。");
    }

    return {
      profitBehind: profitBehind,
      reputationBehind: reputationBehind,
      customersBehind: customersBehind,
      anyBehind: profitBehind || reputationBehind || customersBehind,
      messages: messages,
    };
  }

  // Math.max/minだけで書くと0クランプの意図が読みにくいため、小さな専用ヘルパーにする。
  function Random_clamp0(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  Game.Core.Goals = {
    generateGoal: generateGoal,
    evaluateGoal: evaluateGoal,
    applyFailurePenalty: applyFailurePenalty,
    evaluatePace: evaluatePace,
  };
})();
