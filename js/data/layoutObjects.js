// layoutObjects.js — 店内レイアウトに配置できるオブジェクトの定義
// footprintは常に1x1（プロトタイプでは簡略化）。walkable=falseのものは障害物になり、
// スタッフ/客はその隣接マスまで経路探索して「使う」演出をする。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.GRID_COLS = 11;
Game.Data.GRID_ROWS = 7;

// 2026-09-22（レイアウト改修）: 入口を左端(0,3)から下辺中央(5,6)へ移動した。
// 理由は課題「入口がわかりにくい」「入口は下にして」への対応。下辺にすることで
// 画面を見た時に「下から人が入ってきて、上の厨房で作った料理が卓へ運ばれる」という
// 動線が直感的にわかるようにした。あわせて、入口の目の前（y=5付近）は什器を置かず
// 開けたままにしてあり、「入口の外で何人待っているか」を示す待機列演出（scene.js）の
// ためのスペースとして確保している。
Game.Data.FIXED_ENTRANCE = { x: 5, y: 6 };

Game.Data.LAYOUT_OBJECTS = [
  { id: "stove", name: "コンロ", icon: "🔥", category: "kitchen", walkable: false, color: "#c65a3a" },
  { id: "prep", name: "仕込み台", icon: "🔪", category: "kitchen", walkable: false, color: "#6b7280" },
  { id: "fridge", name: "冷蔵庫", icon: "🧊", category: "kitchen", walkable: false, color: "#4fb3ff" },
  { id: "register", name: "レジ", icon: "💰", category: "service", walkable: false, color: "#f2a93b" },
  // 2026-09-22（レイアウト改修）新設：調理済み料理をコックが置き、ウェイターがそこから
  // 客のテーブルへ運ぶ「受け渡しカウンター」。従来はscene.js内部でコンロの位置を
  // 代用していたが、ユーザー要望「調理結果の料理を置くテーブルを用意して」に対応し、
  // 独立した什器として配置編集できるようにした。
  { id: "foodcounter", name: "受け渡しカウンター", icon: "🛎️", category: "counter", walkable: false, color: "#b08968" },
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

// 2026-09-22（レイアウト改修）: 初期レイアウトの再設計。
// 「しっかり考えて案を10個くらい出して」との要望を受け、以下の10案を検討した上で
// 最終案（10）を採用した。
//   1. 入口を左のまま・厨房を右上に移すだけの微修正案 → 「入口がわかりにくい」根本解決にならず却下。
//   2. 入口を上辺中央にする案 → 画面上部は厨房・レジの情報が集まりやすく、入口と混同しやすいため却下。
//   3. 入口を右辺にする案 → 一般的な「左から右へ読む」動線に反し不自然なため却下。
//   4. 入口を下辺左寄りにする案 → 厨房(左上)と入口が同じ左側に来て動線が交差するため却下。
//   5. 入口を下辺中央、厨房を上辺全体に横長配置する案 → 什器が横一列に並び単調な見た目になるため簡略化。
//   6. 入口を下辺中央、厨房を右上、レジを左上にする左右反転案 → 5との差は左右対称なだけで実質同案のため不採用（5系に統合）。
//   7. カウンター・レジを1つの什器に統合する案 → 「レジ用テーブルを別に作って」という要望と、
//      「調理結果を置くカウンターを別に用意して」という要望の両方が「レジと兼用でよい」とは
//      読めないため、レジと受け渡しカウンターは別什器として分離する方針に決定し却下。
//   8. テーブルを入口のすぐ手前に密集させる案 → 入口前を待機列表示のスペースとして
//      空けておきたいため、テーブルは中段（y=2〜4）にまとめ、入口手前(y=5)は空ける方針に変更。
//   9. 厨房を中央に配置しテーブルで四方を囲む案 → 動線が複雑になり「わかりやすさ」の要望に反するため却下。
//   10.【採用】入口を下辺中央(5,6)に固定。入口の目の前(y=5)は什器を置かず開放し、
//      待機列の見た目スペースとする。厨房（冷蔵庫・仕込み台・コンロ×2）は左上に集約し、
//      受け渡しカウンターはコンロのすぐ南（コックの動線が最短になる位置）に独立配置。
//      レジは右上に「レジ用テーブル+レジ」として独立配置し、厨房と混同しないよう離す。
//      5卓を中段（y=2〜4）に散らして視認性を確保し、観葉植物を入口の左右に置いて
//      「下から入って正面に店内が広がる」見た目の印象を良くした。
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

  // 受け渡しカウンター（コンロのすぐ南＝コックの最短動線上）
  place(4, 1, "foodcounter");

  // レジ（右上・レジ用テーブルとして独立配置）
  place(8, 1, "register");

  // テーブル（中段に分散。入口手前(y=5)は待機列表示のため空けておく）
  place(2, 2, "table4");
  place(6, 2, "table2");
  place(9, 3, "table4");
  place(2, 4, "table2");
  place(6, 4, "table4");

  // 小物（入口を左右から囲むように配置し、下から見た時の見た目を整える）
  place(1, 5, "plant");
  place(9, 5, "plant");
  place(9, 6, "shelf");

  return { cols: cols, rows: rows, cells: cells };
};
