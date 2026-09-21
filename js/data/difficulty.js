// difficulty.js — ゲーム開始時に選ぶ「最初の未来視」＝業界全体の需要・景気の見通し（難易度）
// 重要: 店タイプ（ラーメン/和食/洋食/デザート）によって有利不利を作らない。
// ここで定義する倍率は、どの業種を選んでも同じように適用される「業界全体の空気」であり、
// プレイヤーがどの店を選ぶかはあくまで好み・プレイスタイルの問題とする。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.DIFFICULTIES = [
  {
    id: "easy",
    name: "EASY",
    flavor: "この業界は、これからすごいブームになりそうです",
    bullets: [
      "業界全体の需要が高い",
      "客足が強くなりやすい",
      "売上を作りやすい",
      "資金繰りにも比較的余裕が出やすい",
    ],
    // 週次シミュレーションに乗算で効かせる倍率（core/simulation.jsのgenerateWeekConditionsで合成）
    multipliers: {
      trafficMult: 1.25,      // 客足の強さ
      priceSensitivity: 0.8,  // 値上げしても客が離れにくい＝売上を作りやすい
      ingredientCostMult: 0.9, // 仕入れコストが割安になりがち
      patienceMult: 1.15,     // 客が少し待ってくれる
      startMoneyMult: 1.15,   // 開業資金にも余裕
    },
  },
  {
    id: "normal",
    name: "NORMAL",
    flavor: "この業界は、これからそこそこ売れそうです",
    bullets: ["標準的な需要", "標準的な客足", "標準的な資金繰り"],
    multipliers: {
      trafficMult: 1,
      priceSensitivity: 1,
      ingredientCostMult: 1,
      patienceMult: 1,
      startMoneyMult: 1,
    },
  },
  {
    id: "hard",
    name: "HARD",
    flavor: "この業界は、これから厳しい見通しです",
    bullets: [
      "業界全体の需要が弱い",
      "客足が少なくなりやすい",
      "売上を作る難易度が高い",
      "仕入れや人件費など、使うお金の判断が重要になる",
    ],
    multipliers: {
      trafficMult: 0.8,
      priceSensitivity: 1.25,
      ingredientCostMult: 1.15,
      patienceMult: 0.85,
      startMoneyMult: 0.9,
    },
  },
];

Game.Data.getDifficulty = function (id) {
  return (
    Game.Data.DIFFICULTIES.find(function (d) {
      return d.id === id;
    }) || Game.Data.DIFFICULTIES[1] // 不明な場合はNORMAL扱い
  );
};
