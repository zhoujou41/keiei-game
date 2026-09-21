// hiring.js — 新規雇用（特殊行動）のロジック
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  var Random = Game.Core.Random;

  function bestRole(aptitude) {
    var roles = Object.keys(aptitude);
    var best = roles[0];
    roles.forEach(function (r) {
      if (aptitude[r] > aptitude[best]) best = r;
    });
    return best;
  }

  function generateCandidates(state, n) {
    n = n || 2;
    var usedNames = state.staff.map(function (s) { return s.name; });
    var pool = Game.Data.CANDIDATE_POOL_NAMES.filter(function (nm) {
      return usedNames.indexOf(nm) === -1;
    });
    var candidates = [];
    for (var i = 0; i < n && i < pool.length; i++) {
      var name = pool[Random.randInt(0, pool.length - 1)];
      pool = pool.filter(function (x) { return x !== name; });
      var aptitude = {
        cooking: Random.randInt(20, 90),
        service: Random.randInt(20, 90),
        register: Random.randInt(20, 90),
        other: Random.randInt(20, 90),
      };
      candidates.push({
        id: "cand_" + Date.now() + "_" + i,
        name: name,
        aptitude: aptitude,
        ability: Random.randInt(25, 55),
        motivation: Random.randInt(50, 90),
        wagePerDay: Random.randInt(3200, 5200),
        baseWorkDays: Random.pick([4, 5]),
        role: bestRole(aptitude),
      });
    }
    return candidates;
  }

  function hiringCost(candidate) {
    var avgApt =
      (candidate.aptitude.cooking + candidate.aptitude.service + candidate.aptitude.register + candidate.aptitude.other) / 4;
    return Math.round(candidate.ability * 700 + avgApt * 250);
  }

  function statLabel(value) {
    if (value >= 75) return "◎ 高い";
    if (value >= 50) return "○ 普通";
    if (value >= 30) return "△ やや低い";
    return "× 低い";
  }

  // 人を見る目スキルのレベルに応じて候補の情報開示度を変える
  function describeCandidate(state, candidate) {
    var lvl = (state.skills && state.skills["hitomeru"]) || 0;
    var roles = Game.Data.ROLES;
    var lines = [];
    if (lvl <= 0) {
      lines.push("全体的な印象：" + statLabel(candidate.ability));
      lines.push("最も向いていそうな仕事：" + roles.find(function (r) { return r.id === candidate.role; }).name);
    } else if (lvl <= 2) {
      roles.forEach(function (r) {
        lines.push(r.name + "適性：" + statLabel(candidate.aptitude[r.id]));
      });
    } else if (lvl <= 4) {
      roles.forEach(function (r) {
        lines.push(r.name + "適性：" + candidate.aptitude[r.id]);
      });
      lines.push("基礎能力：" + statLabel(candidate.ability));
    } else {
      roles.forEach(function (r) {
        lines.push(r.name + "適性：" + candidate.aptitude[r.id]);
      });
      lines.push("基礎能力：" + candidate.ability + " / やる気：" + candidate.motivation + " / 日給：" + candidate.wagePerDay.toLocaleString() + "円");
    }
    return lines;
  }

  Game.Core.Hiring = {
    generateCandidates: generateCandidates,
    hiringCost: hiringCost,
    describeCandidate: describeCandidate,
    statLabel: statLabel,
  };
})();
