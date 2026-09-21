// products.js — 商品データ定義
// 他システム（在庫・需要・スキル）から参照される「商品」の静的定義と初期値。
window.Game = window.Game || {};

Game.Data = Game.Data || {};

// category: 中華 / 和食 / 洋食 / デザート （個別商品力スキルの対象カテゴリと一致させる）
// foodKey: FIELD画面で頭上に表示する料理アイコン（assetManifest.jsのFoodAssets参照）。
//   実際に用意されている料理アート素材は ramen / pasta / parfait / teishoku / hamburger の
//   5種類のみのため、同じカテゴリの商品同士でも見た目（foodKey）を使い回す場合がある
//   （数値データ＝価格・原価・人気度・仕入れ量は商品ごとに独立している）。
//
// 2026-09-21: 「お店を選ぶ（ラーメン/和食/洋食/デザート）」→「最初のメニューを決める」の
// 仕様変更にともない、1業種1品だけだった商品データを業種ごとに3品ずつ（計12品）に拡張した。
// Game.Data.PRODUCT_CATALOG が業種選択画面で使う「業種→商品リスト」のカタログで、
// Game.Data.PRODUCTS はそれを1本のフラット配列にまとめたもの（後方互換・全体参照用）。
Game.Data.PRODUCT_CATALOG = {
  "中華": [
    { id: "ramen", name: "醤油ラーメン", icon: "🍜", category: "中華", basePrice: 800, cost: 300, popularity: 35, baseStock: 70, foodKey: "ramen" },
    { id: "ramen_miso", name: "味噌ラーメン", icon: "🍲", category: "中華", basePrice: 850, cost: 330, popularity: 26, baseStock: 55, foodKey: "ramen" },
    { id: "gyoza", name: "餃子", icon: "🥟", category: "中華", basePrice: 450, cost: 150, popularity: 20, baseStock: 50, foodKey: "pasta" },
  ],
  "和食": [
    { id: "teishoku", name: "焼き魚定食", icon: "🍱", category: "和食", basePrice: 900, cost: 380, popularity: 30, baseStock: 60, foodKey: "teishoku" },
    { id: "donburi", name: "かつ丼", icon: "🍚", category: "和食", basePrice: 780, cost: 300, popularity: 27, baseStock: 58, foodKey: "teishoku" },
    { id: "soba", name: "ざるそば", icon: "🍥", category: "和食", basePrice: 650, cost: 230, popularity: 20, baseStock: 50, foodKey: "ramen" },
  ],
  "洋食": [
    { id: "pasta", name: "トマトパスタ", icon: "🍝", category: "洋食", basePrice: 850, cost: 320, popularity: 28, baseStock: 55, foodKey: "pasta" },
    { id: "hamburger", name: "ハンバーガー", icon: "🍔", category: "洋食", basePrice: 780, cost: 300, popularity: 24, baseStock: 55, foodKey: "hamburger" },
    { id: "omurice", name: "オムライス", icon: "🍳", category: "洋食", basePrice: 780, cost: 290, popularity: 22, baseStock: 50, foodKey: "teishoku" },
  ],
  "デザート": [
    { id: "dessert", name: "パフェ", icon: "🍨", category: "デザート", basePrice: 400, cost: 120, popularity: 28, baseStock: 50, foodKey: "parfait" },
    { id: "cake", name: "ショートケーキ", icon: "🍰", category: "デザート", basePrice: 450, cost: 150, popularity: 24, baseStock: 45, foodKey: "parfait" },
    { id: "pudding", name: "プリン", icon: "🍮", category: "デザート", basePrice: 350, cost: 100, popularity: 20, baseStock: 55, foodKey: "parfait" },
  ],
};

// 全業種の商品をまとめたフラット配列（後方互換・「業種を選ばない」旧セーブの補完等で使用）
Game.Data.PRODUCTS = Object.keys(Game.Data.PRODUCT_CATALOG).reduce(function (acc, cat) {
  return acc.concat(Game.Data.PRODUCT_CATALOG[cat]);
}, []);

Game.Data.getProductDef = function (id) {
  return Game.Data.PRODUCTS.find(function (p) {
    return p.id === id;
  });
};

Game.Data.getProductsByCategory = function (category) {
  return Game.Data.PRODUCT_CATALOG[category] || [];
};

// 仕入れ量の選択肢（%）
Game.Data.PURCHASE_RATES = [80, 100, 110, 130];
