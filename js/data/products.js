// products.js — 商品データ定義
// 他システム（在庫・需要・スキル）から参照される「商品」の静的定義と初期値。
window.Game = window.Game || {};

Game.Data = Game.Data || {};

// category: 中華 / 和食 / 洋食 / デザート （個別商品力スキルの対象カテゴリと一致させる）
// foodKey: FIELD画面で頭上に表示する料理アイコン（assetManifest.jsのFoodAssets参照）。
//   実際に用意されている料理アート素材は ramen / pasta / parfait / teishoku / hamburger の
//   5種類のみのため、同じカテゴリの商品同士でも見た目（foodKey）を使い回す場合がある
//   （数値データ＝価格・原価・人気度・仕入れ量は商品ごとに独立している）。
// tint: { h: 色相回転(deg), s: 彩度倍率, b: 明度倍率 } を指定すると、同じfoodKey画像でも
//   CSSのfilter（hue-rotate/saturate/brightness）で色味を変えて見た目のバリエーションを
//   増やす（実素材が5種類しか無い制約の中で「それっぽい画像」を業種ごとに20種類まで
//   広げるための仕組み。2026-09-22 メニュー20種化対応で導入）。tint省略＝無加工の元画像。
//
// 2026-09-21: 「お店を選ぶ（ラーメン/和食/洋食/デザート）」→「最初のメニューを決める」の
// 仕様変更にともない、1業種1品だけだった商品データを業種ごとに3品ずつ（計12品）に拡張した。
// 2026-09-22: 「メニューは各業種20種類用意し、その中から3つ選ぶ」仕様変更にともない、
// 業種ごとに20品（計80品）まで拡張した。既存3品（ID）は後方互換のため変更せず、
// 新規17品を追加する形にした（IDが変わらないので旧セーブのproducts/foodKey補完は壊れない）。
// 2026-09-22（仕入れUI改修）: baseStockは全80品を「基準価格100%・仕入れ量100%で完売した
// 場合、3品の週間利益が+20万円程度になる」ように再計算した（baseStock ≒ 129182 / basePrice）。
// 価格・原価（＝表示される粗利）自体は一切変更していない。
Game.Data.PRODUCT_CATALOG = {
  "中華": [
    { id: "ramen", name: "醤油ラーメン", icon: "🍜", category: "中華", basePrice: 800, cost: 300, popularity: 35, baseStock: 161, foodKey: "ramen" },
    { id: "ramen_miso", name: "味噌ラーメン", icon: "🍲", category: "中華", basePrice: 850, cost: 330, popularity: 26, baseStock: 152, foodKey: "ramen", tint: { h: 18, s: 1.2, b: 0.95 } },
    { id: "gyoza", name: "餃子", icon: "🥟", category: "中華", basePrice: 450, cost: 150, popularity: 20, baseStock: 287, foodKey: "pasta" },
    { id: "ramen_shio", name: "塩ラーメン", icon: "🍜", category: "中華", basePrice: 780, cost: 290, popularity: 24, baseStock: 166, foodKey: "ramen", tint: { h: -12, s: 0.55, b: 1.18 } },
    { id: "ramen_tonkotsu", name: "豚骨ラーメン", icon: "🍜", category: "中華", basePrice: 880, cost: 360, popularity: 27, baseStock: 147, foodKey: "ramen", tint: { h: 8, s: 0.8, b: 1.12 } },
    { id: "ramen_tantan", name: "担々麺", icon: "🌶️", category: "中華", basePrice: 900, cost: 350, popularity: 23, baseStock: 144, foodKey: "ramen", tint: { h: -28, s: 1.6, b: 0.9 } },
    { id: "ramen_kara_miso", name: "辛味噌ラーメン", icon: "🔥", category: "中華", basePrice: 920, cost: 360, popularity: 19, baseStock: 140, foodKey: "ramen", tint: { h: -20, s: 1.7, b: 0.85 } },
    { id: "hiyashi_chuka", name: "冷やし中華", icon: "🥗", category: "中華", basePrice: 750, cost: 280, popularity: 18, baseStock: 172, foodKey: "ramen", tint: { h: 55, s: 1.1, b: 1.15 } },
    { id: "gyoza_yaki", name: "焼き餃子", icon: "🥟", category: "中華", basePrice: 480, cost: 160, popularity: 22, baseStock: 269, foodKey: "pasta", tint: { h: 22, s: 1.15, b: 0.92 } },
    { id: "gyoza_sui", name: "水餃子", icon: "🥟", category: "中華", basePrice: 470, cost: 165, popularity: 16, baseStock: 275, foodKey: "pasta", tint: { h: -10, s: 0.5, b: 1.2 } },
    { id: "shoronpo", name: "小籠包", icon: "🥟", category: "中華", basePrice: 520, cost: 190, popularity: 18, baseStock: 248, foodKey: "pasta", tint: { h: -6, s: 0.4, b: 1.22 } },
    { id: "harumaki", name: "春巻き", icon: "🥢", category: "中華", basePrice: 430, cost: 140, popularity: 14, baseStock: 300, foodKey: "pasta", tint: { h: 30, s: 1.3, b: 0.88 } },
    { id: "回鍋肉定食", name: "回鍋肉定食", icon: "🍱", category: "中華", basePrice: 920, cost: 380, popularity: 21, baseStock: 140, foodKey: "teishoku", tint: { h: -18, s: 1.3, b: 0.92 } },
    { id: "mabodofu_teishoku", name: "麻婆豆腐定食", icon: "🍱", category: "中華", basePrice: 900, cost: 360, popularity: 25, baseStock: 144, foodKey: "teishoku", tint: { h: -25, s: 1.5, b: 0.85 } },
    { id: "seichinniku_teishoku", name: "青椒肉絲定食", icon: "🍱", category: "中華", basePrice: 880, cost: 350, popularity: 15, baseStock: 147, foodKey: "teishoku", tint: { h: 90, s: 1.2, b: 0.95 } },
    { id: "ebichiri_teishoku", name: "エビチリ定食", icon: "🍱", category: "中華", basePrice: 980, cost: 420, popularity: 22, baseStock: 132, foodKey: "teishoku", tint: { h: -35, s: 1.4, b: 1.0 } },
    { id: "subuta_teishoku", name: "酢豚定食", icon: "🍱", category: "中華", basePrice: 940, cost: 390, popularity: 20, baseStock: 137, foodKey: "teishoku", tint: { h: -32, s: 1.35, b: 1.05 } },
    { id: "chahan", name: "チャーハン", icon: "🍚", category: "中華", basePrice: 700, cost: 260, popularity: 24, baseStock: 185, foodKey: "teishoku", tint: { h: 25, s: 1.1, b: 1.1 } },
    { id: "chukadon", name: "中華丼", icon: "🍚", category: "中華", basePrice: 780, cost: 300, popularity: 17, baseStock: 166, foodKey: "teishoku", tint: { h: 40, s: 0.9, b: 0.9 } },
    { id: "annindofu", name: "杏仁豆腐", icon: "🍮", category: "中華", basePrice: 380, cost: 110, popularity: 16, baseStock: 340, foodKey: "parfait", tint: { h: -8, s: 0.35, b: 1.25 } },
  ],
  "和食": [
    { id: "teishoku", name: "焼き魚定食", icon: "🍱", category: "和食", basePrice: 900, cost: 380, popularity: 30, baseStock: 144, foodKey: "teishoku" },
    { id: "donburi", name: "かつ丼", icon: "🍚", category: "和食", basePrice: 780, cost: 300, popularity: 27, baseStock: 166, foodKey: "teishoku", tint: { h: 15, s: 1.15, b: 0.95 } },
    { id: "soba", name: "ざるそば", icon: "🍥", category: "和食", basePrice: 650, cost: 230, popularity: 20, baseStock: 199, foodKey: "ramen", tint: { h: -15, s: 0.4, b: 1.2 } },
    { id: "shogayaki_teishoku", name: "生姜焼き定食", icon: "🍱", category: "和食", basePrice: 850, cost: 340, popularity: 24, baseStock: 152, foodKey: "teishoku", tint: { h: 20, s: 1.2, b: 0.9 } },
    { id: "karaage_teishoku", name: "唐揚げ定食", icon: "🍱", category: "和食", basePrice: 870, cost: 340, popularity: 28, baseStock: 148, foodKey: "teishoku", tint: { h: 28, s: 1.1, b: 1.05 } },
    { id: "nizakana_teishoku", name: "煮魚定食", icon: "🍱", category: "和食", basePrice: 920, cost: 390, popularity: 18, baseStock: 140, foodKey: "teishoku", tint: { h: -30, s: 0.9, b: 0.75 } },
    { id: "sukiyaki_teishoku", name: "すき焼き定食", icon: "🍱", category: "和食", basePrice: 1100, cost: 480, popularity: 20, baseStock: 117, foodKey: "teishoku", tint: { h: -22, s: 1.3, b: 0.82 } },
    { id: "tenpura_teishoku", name: "天ぷら定食", icon: "🍱", category: "和食", basePrice: 980, cost: 400, popularity: 22, baseStock: 132, foodKey: "teishoku", tint: { h: 32, s: 0.85, b: 1.15 } },
    { id: "tonkatsu_teishoku", name: "とんかつ定食", icon: "🍱", category: "和食", basePrice: 920, cost: 370, popularity: 26, baseStock: 140, foodKey: "teishoku", tint: { h: 12, s: 1.05, b: 1.0 } },
    { id: "oyakodon", name: "親子丼", icon: "🍚", category: "和食", basePrice: 720, cost: 270, popularity: 23, baseStock: 179, foodKey: "teishoku", tint: { h: 38, s: 0.9, b: 1.12 } },
    { id: "gyudon", name: "牛丼", icon: "🍚", category: "和食", basePrice: 650, cost: 250, popularity: 25, baseStock: 199, foodKey: "teishoku", tint: { h: -28, s: 0.95, b: 0.78 } },
    { id: "kaisendon", name: "海鮮丼", icon: "🍚", category: "和食", basePrice: 1050, cost: 470, popularity: 19, baseStock: 123, foodKey: "teishoku", tint: { h: -42, s: 1.3, b: 1.08 } },
    { id: "unadon", name: "うな丼", icon: "🍚", category: "和食", basePrice: 1400, cost: 650, popularity: 12, baseStock: 92, foodKey: "teishoku", tint: { h: -38, s: 1.15, b: 0.7 } },
    { id: "udon_kake", name: "かけうどん", icon: "🍥", category: "和食", basePrice: 550, cost: 190, popularity: 21, baseStock: 235, foodKey: "ramen", tint: { h: 6, s: 0.35, b: 1.28 } },
    { id: "nabeyaki_udon", name: "鍋焼きうどん", icon: "🍥", category: "和食", basePrice: 850, cost: 330, popularity: 15, baseStock: 152, foodKey: "ramen", tint: { h: 14, s: 0.7, b: 0.98 } },
    { id: "tenzaru_soba", name: "天ざるそば", icon: "🍥", category: "和食", basePrice: 950, cost: 380, popularity: 16, baseStock: 136, foodKey: "ramen", tint: { h: -20, s: 0.5, b: 1.15 } },
    { id: "misonikomi_udon", name: "味噌煮込みうどん", icon: "🍥", category: "和食", basePrice: 880, cost: 340, popularity: 14, baseStock: 147, foodKey: "ramen", tint: { h: 22, s: 1.4, b: 0.8 } },
    { id: "onigiri_set", name: "おにぎりセット", icon: "🍙", category: "和食", basePrice: 480, cost: 160, popularity: 18, baseStock: 269, foodKey: "teishoku", tint: { h: -6, s: 0.3, b: 1.3 } },
    { id: "ochazuke", name: "お茶漬け", icon: "🍵", category: "和食", basePrice: 420, cost: 130, popularity: 13, baseStock: 308, foodKey: "teishoku", tint: { h: 65, s: 0.6, b: 1.1 } },
    { id: "dashimaki_teishoku", name: "だし巻き卵定食", icon: "🍳", category: "和食", basePrice: 760, cost: 280, popularity: 17, baseStock: 170, foodKey: "teishoku", tint: { h: 45, s: 1.0, b: 1.2 } },
  ],
  "洋食": [
    { id: "pasta", name: "トマトパスタ", icon: "🍝", category: "洋食", basePrice: 850, cost: 320, popularity: 28, baseStock: 152, foodKey: "pasta" },
    { id: "hamburger", name: "ハンバーガー", icon: "🍔", category: "洋食", basePrice: 780, cost: 300, popularity: 24, baseStock: 166, foodKey: "hamburger" },
    { id: "omurice", name: "オムライス", icon: "🍳", category: "洋食", basePrice: 780, cost: 290, popularity: 22, baseStock: 166, foodKey: "teishoku", tint: { h: 42, s: 0.95, b: 1.15 } },
    { id: "carbonara", name: "カルボナーラ", icon: "🍝", category: "洋食", basePrice: 920, cost: 370, popularity: 25, baseStock: 140, foodKey: "pasta", tint: { h: -35, s: 0.3, b: 1.25 } },
    { id: "peperoncino", name: "ペペロンチーノ", icon: "🍝", category: "洋食", basePrice: 800, cost: 300, popularity: 18, baseStock: 161, foodKey: "pasta", tint: { h: 30, s: 0.4, b: 1.2 } },
    { id: "napolitan", name: "ナポリタン", icon: "🍝", category: "洋食", basePrice: 780, cost: 290, popularity: 21, baseStock: 166, foodKey: "pasta", tint: { h: 10, s: 1.15, b: 0.95 } },
    { id: "genovese", name: "ジェノベーゼ", icon: "🍝", category: "洋食", basePrice: 900, cost: 360, popularity: 14, baseStock: 144, foodKey: "pasta", tint: { h: 95, s: 1.3, b: 0.85 } },
    { id: "cream_pasta", name: "クリームパスタ", icon: "🍝", category: "洋食", basePrice: 880, cost: 350, popularity: 19, baseStock: 147, foodKey: "pasta", tint: { h: -20, s: 0.25, b: 1.3 } },
    { id: "meatsauce_pasta", name: "ミートソースパスタ", icon: "🍝", category: "洋食", basePrice: 860, cost: 340, popularity: 23, baseStock: 150, foodKey: "pasta", tint: { h: -8, s: 1.3, b: 0.8 } },
    { id: "cheese_burger", name: "チーズバーガー", icon: "🍔", category: "洋食", basePrice: 850, cost: 330, popularity: 26, baseStock: 152, foodKey: "hamburger", tint: { h: 22, s: 1.2, b: 1.05 } },
    { id: "teriyaki_burger", name: "テリヤキバーガー", icon: "🍔", category: "洋食", basePrice: 830, cost: 320, popularity: 20, baseStock: 156, foodKey: "hamburger", tint: { h: 18, s: 1.1, b: 0.85 } },
    { id: "fish_burger", name: "フィッシュバーガー", icon: "🍔", category: "洋食", basePrice: 790, cost: 300, popularity: 15, baseStock: 164, foodKey: "hamburger", tint: { h: -18, s: 0.5, b: 1.15 } },
    { id: "hayashi_rice", name: "ハヤシライス", icon: "🍛", category: "洋食", basePrice: 800, cost: 310, popularity: 19, baseStock: 161, foodKey: "teishoku", tint: { h: -30, s: 1.2, b: 0.8 } },
    { id: "curry_rice", name: "カレーライス", icon: "🍛", category: "洋食", basePrice: 750, cost: 270, popularity: 30, baseStock: 172, foodKey: "teishoku" },
    { id: "doria", name: "ドリアグラタン", icon: "🧀", category: "洋食", basePrice: 900, cost: 360, popularity: 17, baseStock: 144, foodKey: "teishoku", tint: { h: -10, s: 0.3, b: 1.3 } },
    { id: "hamburg_teishoku", name: "ハンバーグ定食", icon: "🍽️", category: "洋食", basePrice: 950, cost: 390, popularity: 27, baseStock: 136, foodKey: "teishoku", tint: { h: -20, s: 1.15, b: 0.78 } },
    { id: "ebifry_teishoku", name: "エビフライ定食", icon: "🦐", category: "洋食", basePrice: 980, cost: 410, popularity: 21, baseStock: 132, foodKey: "teishoku", tint: { h: 35, s: 1.0, b: 1.1 } },
    { id: "beef_stew", name: "ビーフシチュー", icon: "🍲", category: "洋食", basePrice: 1050, cost: 460, popularity: 16, baseStock: 123, foodKey: "teishoku", tint: { h: -28, s: 1.1, b: 0.65 } },
    { id: "pizza_toast", name: "ピザトースト", icon: "🍕", category: "洋食", basePrice: 620, cost: 220, popularity: 18, baseStock: 208, foodKey: "pasta", tint: { h: -2, s: 1.25, b: 1.0 } },
    { id: "corn_soup_set", name: "コーンスープセット", icon: "🥣", category: "洋食", basePrice: 480, cost: 160, popularity: 14, baseStock: 269, foodKey: "teishoku", tint: { h: 48, s: 0.7, b: 1.25 } },
  ],
  "デザート": [
    { id: "dessert", name: "パフェ", icon: "🍨", category: "デザート", basePrice: 400, cost: 120, popularity: 28, baseStock: 323, foodKey: "parfait" },
    { id: "cake", name: "ショートケーキ", icon: "🍰", category: "デザート", basePrice: 450, cost: 150, popularity: 24, baseStock: 287, foodKey: "parfait", tint: { h: -18, s: 1.25, b: 1.05 } },
    { id: "pudding", name: "プリン", icon: "🍮", category: "デザート", basePrice: 350, cost: 100, popularity: 20, baseStock: 369, foodKey: "parfait", tint: { h: 22, s: 0.9, b: 1.05 } },
    { id: "matcha_parfait", name: "抹茶パフェ", icon: "🍵", category: "デザート", basePrice: 480, cost: 160, popularity: 18, baseStock: 269, foodKey: "parfait", tint: { h: 85, s: 1.2, b: 0.9 } },
    { id: "choco_parfait", name: "チョコレートパフェ", icon: "🍫", category: "デザート", basePrice: 500, cost: 170, popularity: 22, baseStock: 258, foodKey: "parfait", tint: { h: 30, s: 1.1, b: 0.6 } },
    { id: "mango_parfait", name: "マンゴーパフェ", icon: "🥭", category: "デザート", basePrice: 520, cost: 190, popularity: 17, baseStock: 248, foodKey: "parfait", tint: { h: 40, s: 1.3, b: 1.1 } },
    { id: "ichigo_parfait", name: "いちごパフェ", icon: "🍓", category: "デザート", basePrice: 490, cost: 175, popularity: 21, baseStock: 264, foodKey: "parfait", tint: { h: -30, s: 1.4, b: 1.05 } },
    { id: "blueberry_parfait", name: "ブルーベリーパフェ", icon: "🫐", category: "デザート", basePrice: 500, cost: 180, popularity: 13, baseStock: 258, foodKey: "parfait", tint: { h: 160, s: 1.2, b: 0.85 } },
    { id: "caramel_parfait", name: "キャラメルパフェ", icon: "🍯", category: "デザート", basePrice: 470, cost: 165, popularity: 16, baseStock: 275, foodKey: "parfait", tint: { h: 26, s: 1.15, b: 0.8 } },
    { id: "vanilla_ice", name: "バニラアイス", icon: "🍦", category: "デザート", basePrice: 320, cost: 90, popularity: 19, baseStock: 404, foodKey: "parfait", tint: { h: 0, s: 0.15, b: 1.3 } },
    { id: "montblanc", name: "モンブラン", icon: "🌰", category: "デザート", basePrice: 460, cost: 160, popularity: 15, baseStock: 281, foodKey: "parfait", tint: { h: 24, s: 1.0, b: 0.65 } },
    { id: "tiramisu", name: "ティラミス", icon: "☕", category: "デザート", basePrice: 470, cost: 165, popularity: 18, baseStock: 275, foodKey: "parfait", tint: { h: 18, s: 0.8, b: 0.55 } },
    { id: "cheesecake", name: "チーズケーキ", icon: "🍰", category: "デザート", basePrice: 430, cost: 145, popularity: 20, baseStock: 300, foodKey: "parfait", tint: { h: 44, s: 0.5, b: 1.18 } },
    { id: "creme_brulee", name: "クレームブリュレ", icon: "🍮", category: "デザート", basePrice: 460, cost: 155, popularity: 14, baseStock: 281, foodKey: "parfait", tint: { h: 30, s: 1.0, b: 0.92 } },
    { id: "macaron_set", name: "マカロン盛り合わせ", icon: "🍬", category: "デザート", basePrice: 550, cost: 200, popularity: 12, baseStock: 235, foodKey: "parfait", tint: { h: -60, s: 1.1, b: 1.1 } },
    { id: "fruit_tart", name: "フルーツタルト", icon: "🍓", category: "デザート", basePrice: 490, cost: 175, popularity: 16, baseStock: 264, foodKey: "parfait", tint: { h: -14, s: 1.2, b: 1.0 } },
    { id: "roll_cake", name: "ロールケーキ", icon: "🍰", category: "デザート", basePrice: 420, cost: 140, popularity: 17, baseStock: 308, foodKey: "parfait", tint: { h: 10, s: 0.4, b: 1.22 } },
    { id: "matcha_ice", name: "抹茶アイス", icon: "🍵", category: "デザート", basePrice: 380, cost: 120, popularity: 15, baseStock: 340, foodKey: "parfait", tint: { h: 100, s: 1.3, b: 0.7 } },
    { id: "anmitsu", name: "あんみつ", icon: "🍡", category: "デザート", basePrice: 400, cost: 130, popularity: 13, baseStock: 323, foodKey: "parfait", tint: { h: 20, s: 0.9, b: 0.5 } },
    { id: "warabimochi", name: "わらび餅", icon: "🍡", category: "デザート", basePrice: 380, cost: 115, popularity: 14, baseStock: 340, foodKey: "parfait", tint: { h: 32, s: 0.35, b: 1.15 } },
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

// tint指定から、そのままimg/svg imageのstyle属性に使えるCSS filter文字列を作る。
// tint省略時は空文字（＝無加工の元画像）。
Game.Data.foodTintFilter = function (tint) {
  if (!tint) return "";
  var parts = [];
  if (tint.h) parts.push("hue-rotate(" + tint.h + "deg)");
  if (tint.s != null && tint.s !== 1) parts.push("saturate(" + tint.s + ")");
  if (tint.b != null && tint.b !== 1) parts.push("brightness(" + tint.b + ")");
  return parts.join(" ");
};

// 仕入れ量の選択肢（%）— 旧UI（4段階ボタン）の名残。現在の仕入れUIは0〜10000%の
// 直接指定に対応したため参照されていないが、後方互換のためデータ自体は残す。
Game.Data.PURCHASE_RATES = [80, 100, 110, 130];

// 仕入れ量・販売価格（%）の指定可能範囲。2026-09-22: 0%〜10000%まで直接入力できるように
// 拡張（従来は仕入れ量4段階ボタン・価格は基準価格の70〜130%のみだった）。
Game.Data.PURCHASE_PCT_MIN = 0;
Game.Data.PURCHASE_PCT_MAX = 10000;
Game.Data.PRICE_PCT_MIN = 0;
Game.Data.PRICE_PCT_MAX = 10000;
