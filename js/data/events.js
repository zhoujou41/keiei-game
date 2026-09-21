// events.js — ランダムイベントの定義プール
// 各イベントは「その週の隠れた条件」に影響を与える。プレイヤーは基本的に
// 結果からしか推測できないが、スキル（未来見通し・百眼）で事前情報を得られる。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

// effect でその週の conditions に加算/乗算する内容を表す。
// trafficMult: 来客数全体への倍率
// categoryMult: { カテゴリ名: 倍率 } 特定カテゴリの需要倍率
// patienceMult: 客の我慢強さ倍率（大きいほど待ってくれる）
// ingredientCostMult: 仕入れコスト倍率
Game.Data.EVENT_POOL = [
  {
    id: "rain",
    name: "雨の日",
    icon: "🌧️",
    flavor: "朝から雨が降っている。",
    weight: 3,
    effect: { trafficMult: 0.85, categoryMult: { "和食": 1.15, "中華": 1.1 }, patienceMult: 0.9 },
  },
  {
    id: "heatwave",
    name: "猛暑",
    icon: "🌞",
    flavor: "うだるような暑さが続いている。",
    weight: 2,
    effect: { trafficMult: 0.95, categoryMult: { "デザート": 1.4 }, patienceMult: 0.85 },
  },
  {
    id: "fine",
    name: "好天",
    icon: "☀️",
    flavor: "気持ちの良い晴天が続いている。",
    weight: 3,
    effect: { trafficMult: 1.1, patienceMult: 1.05 },
  },
  {
    id: "sns_trend",
    name: "SNSで話題",
    icon: "📱",
    flavor: "SNSで近隣の飲食店が話題になっているようだ。",
    weight: 2,
    effect: { trafficMult: 1.2, randomCategoryBoost: 1.3 },
  },
  {
    id: "competitor_open",
    name: "競合店オープン",
    icon: "🏮",
    flavor: "近くに新しい飲食店ができたらしい。",
    weight: 2,
    effect: { trafficMult: 0.8 },
  },
  {
    id: "competitor_close",
    name: "競合店閉店",
    icon: "🚪",
    flavor: "近隣の競合店が閉店したという噂がある。",
    weight: 1,
    effect: { trafficMult: 1.15 },
  },
  {
    id: "local_festival",
    name: "地域イベント",
    icon: "🎏",
    flavor: "近くで祭りかイベントがあるようだ。",
    weight: 1,
    effect: { trafficMult: 1.4, patienceMult: 1.1 },
  },
  {
    id: "ingredient_spike",
    name: "仕入れ価格高騰",
    icon: "📈",
    flavor: "市場で食材価格が上がっているらしい。",
    weight: 2,
    effect: { ingredientCostMult: 1.25 },
  },
  {
    id: "ingredient_drop",
    name: "仕入れ価格下落",
    icon: "📉",
    flavor: "食材価格が落ち着いているようだ。",
    weight: 2,
    effect: { ingredientCostMult: 0.85 },
  },
  {
    id: "recession",
    name: "不景気",
    icon: "💴",
    flavor: "景気があまり良くないというニュースを見た。",
    weight: 1,
    effect: { trafficMult: 0.9, priceSensitivity: 1.2 },
  },
  {
    id: "boom",
    name: "好景気",
    icon: "💹",
    flavor: "景気が良いというニュースを見た。",
    weight: 1,
    effect: { trafficMult: 1.1, priceSensitivity: 0.85 },
  },
  {
    id: "quiet",
    name: "特に変化なし",
    icon: "🍃",
    flavor: "特に変わったことはなさそうだ。",
    weight: 4,
    effect: {},
  },
];
