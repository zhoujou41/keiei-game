// random.js — 乱数まわりの小さなユーティリティ
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  function rand() {
    return Math.random();
  }

  function randRange(min, max) {
    return min + rand() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(randRange(min, max + 1));
  }

  function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
  }

  // 重み付き抽選: items = [{...,weight}]
  function weightedPick(items, weightKey) {
    weightKey = weightKey || "weight";
    var total = items.reduce(function (s, it) {
      return s + (it[weightKey] || 1);
    }, 0);
    var r = rand() * total;
    for (var i = 0; i < items.length; i++) {
      r -= items[i][weightKey] || 1;
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  // 複数の重み付き抽選から重複なしでn個選ぶ
  function weightedPickN(items, n, weightKey) {
    var pool = items.slice();
    var result = [];
    for (var i = 0; i < n && pool.length > 0; i++) {
      var chosen = weightedPick(pool, weightKey);
      result.push(chosen);
      pool = pool.filter(function (x) {
        return x !== chosen;
      });
    }
    return result;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  Game.Core.Random = {
    rand: rand,
    randRange: randRange,
    randInt: randInt,
    pick: pick,
    weightedPick: weightedPick,
    weightedPickN: weightedPickN,
    clamp: clamp,
  };
})();
