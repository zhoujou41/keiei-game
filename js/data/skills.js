// skills.js — スキルデータ定義
// 「強いスキルほど大きな代償」の原則に基づき、アクティブスキルは毎週コストを払って
// 「集中」しないと効果が出ない。パッシブスキルはスキルポイントという有限資源を
// 消費すること自体がトレードオフになる。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.MAX_SKILL_LEVEL = 5;

Game.Data.SKILLS = [
  {
    id: "foresight",
    name: "未来見通し",
    type: "active",
    icon: "🔮",
    shortDesc: "来週の需要を垣間見る。集中するほど正確になるが代償も大きい。",
  },
  {
    id: "hyakugan",
    name: "百眼",
    type: "active",
    icon: "👁️",
    shortDesc: "他店の様子を観察する。集中するほど詳しく分かるが代償も大きい。",
  },
  {
    id: "shobai",
    name: "商売",
    type: "passive",
    icon: "💰",
    shortDesc: "仕入れ値と経営効率が上がる基礎スキル。",
  },
  {
    id: "management",
    name: "マネージメント",
    type: "passive",
    icon: "🧑‍💼",
    shortDesc: "スタッフの成長ややる気回復が効率的になる。",
  },
  {
    id: "hitomeru",
    name: "人を見る目",
    type: "passive",
    icon: "👀",
    shortDesc: "採用候補の能力・適性を見抜けるようになる。",
  },
  {
    id: "shohin_kaihatsu",
    name: "商品開発",
    type: "passive",
    icon: "🧪",
    shortDesc: "オリジナル商品を開発できるようになる（今後実装拡張予定）。",
  },
  {
    id: "specialty_chuka",
    name: "個別商品力：中華",
    type: "passive",
    icon: "🥢",
    category: "中華",
    shortDesc: "中華カテゴリの商品力が上がる。",
  },
  {
    id: "specialty_washoku",
    name: "個別商品力：和食",
    type: "passive",
    icon: "🍚",
    category: "和食",
    shortDesc: "和食カテゴリの商品力が上がる。",
  },
  {
    id: "specialty_yoshoku",
    name: "個別商品力：洋食",
    type: "passive",
    icon: "🍽️",
    category: "洋食",
    shortDesc: "洋食カテゴリの商品力が上がる。",
  },
  {
    id: "specialty_dessert",
    name: "個別商品力：デザート",
    type: "passive",
    icon: "🍮",
    category: "デザート",
    shortDesc: "デザートカテゴリの商品力が上がる。",
  },
];

// スキルポイント：レベルn→n+1に必要なポイント数（累積コスト方式）
Game.Data.skillUpCost = function (currentLevel) {
  return currentLevel + 1;
};

// アクティブスキルの集中コスト（今週このスキルに集中する場合）
// レベルが高いほど精度が上がる代わりに費用とマネジメント効率低下が大きくなる。
Game.Data.focusCost = function (level) {
  return {
    money: level * 1200,
    managementPenaltyPct: level * 3, // 今週のマネジメント効果が-3%×lvl
  };
};
