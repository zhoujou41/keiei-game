// storeTypes.js — ゲーム開始時に選ぶ「お店の業種」
// core/simulation.js の CATEGORIES（中華・和食・洋食・デザート）と1対1で対応する。
// 業種はあくまで見た目・初期メニューの候補を決めるものであり、difficulty.js側で
// 業種による有利不利は一切作らない（難易度は業種と独立している）。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.STORE_TYPES = [
  {
    id: "ramen",
    name: "ラーメン店",
    icon: "🍜",
    category: "中華",
    flavor: "スープと麺で勝負する、活気ある一杯の専門店。",
  },
  {
    id: "washoku",
    name: "和食店",
    icon: "🍱",
    category: "和食",
    flavor: "ご飯とおかずで満足感を届ける、落ち着いた定食のお店。",
  },
  {
    id: "yoshoku",
    name: "洋食店",
    icon: "🍝",
    category: "洋食",
    flavor: "パスタやハンバーグなど、洋食の温かみで勝負するお店。",
  },
  {
    id: "dessert",
    name: "デザート店",
    icon: "🍰",
    category: "デザート",
    flavor: "甘いもの目当ての客で賑わう、スイーツ専門のお店。",
  },
];

Game.Data.getStoreType = function (id) {
  return (
    Game.Data.STORE_TYPES.find(function (t) {
      return t.id === id;
    }) || Game.Data.STORE_TYPES[0]
  );
};
