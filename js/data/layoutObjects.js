// layoutObjects.js — 店内レイアウトに配置できるオブジェクトの定義
// footprintは常に1x1（プロトタイプでは簡略化）。walkable=falseのものは障害物になり、
// スタッフ/客はその隣接マスまで経路探索して「使う」演出をする。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.GRID_COLS = 11;
Game.Data.GRID_ROWS = 7;

// 固定オブジェクト（編集不可・常に存在）
Game.Data.FIXED_ENTRANCE = { x: 0, y: 3 };

Game.Data.LAYOUT_OBJECTS = [
  { id: "stove", name: "コンロ", icon: "🔥", category: "kitchen", walkable: false, color: "#c65a3a" },
  { id: "prep", name: "仕込み台", icon: "🔪", category: "kitchen", walkable: false, color: "#6b7280" },
  { id: "fridge", name: "冷蔵庫", icon: "🧊", category: "kitchen", walkable: false, color: "#4fb3ff" },
  { id: "register", name: "レジ", icon: "💰", category: "service", walkable: false, color: "#f2a93b" },
  { id: "table2", name: "テーブル（2人用）", icon: "🍽️", category: "table", walkable: false, seats: 2, color: "#8a6d4b" },
  { id: "table4", name: "テーブル（4人用）", icon: "🍽️", category: "table", walkable: false, seats: 4, color: "#8a6d4b" },
  { id: "plant", name: "観葉植物", icon: "🪴", category: "prop", walkable: false, color: "#3f8f5f" },
  { id: "shelf", name: "棚", icon: "🗄️", category: "prop", walkable: false, color: "#7a5230" },
];

Game.Data.getLayoutObject = function (id) {
  return Game.Data.LAYOUT_OBJECTS.find(function (o) {
    return o.id === id;
  });
};

// デフォルトレイアウト（初回プレイ時にそのまま遊べるように）
Game.Data.createDefaultLayout = function () {
  var cols = Game.Data.GRID_COLS;
  var rows = Game.Data.GRID_ROWS;
  var cells = {};
  function key(x, y) {
    return x + "," + y;
  }
  function place(x, y, objId) {
    cells[key(x, y)] = objId;
  }

  // 厨房エリア（左上）
  place(1, 0, "fridge");
  place(2, 0, "prep");
  place(3, 0, "stove");
  place(4, 0, "stove");

  // レジ（入口そば）
  place(1, 3, "register");

  // テーブル
  place(4, 2, "table4");
  place(7, 1, "table2");
  place(7, 4, "table4");
  place(4, 5, "table2");
  place(9, 2, "table2");

  // 小物
  place(9, 0, "plant");
  place(0, 6, "plant");
  place(9, 6, "shelf");

  return { cols: cols, rows: rows, cells: cells };
};
