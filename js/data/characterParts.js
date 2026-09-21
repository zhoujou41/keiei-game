// characterParts.js — キャラクター見た目のパーツ定義
// 「頭・髪・目・耳・口・鼻・服・ズボン・靴」の9カテゴリを、形状バリエーション×カラー
// バリエーションの組み合わせで表現する（形状は手作りSVGパスで6〜8種、色は各カテゴリ
// 6〜20色）。組み合わせ数としては数千通りになり、「多くのパーツから見た目が決まる」
// というプロトタイプの狙いを、実際に720枚の画像を用意せずに満たしている。
// 座標系: 幅24×高さ36のローカル単位（原点は左上、足元がy=36）。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

Game.Data.CharacterParts = {
  skinTones: ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffe0bd", "#f5cba7", "#d9a066"],

  // 頭の形（rxとryの比率違いで表現）
  headShapes: [
    { rx: 6.2, ry: 6.2 }, // まる
    { rx: 5.6, ry: 7.0 }, // たまご型（縦長）
    { rx: 6.8, ry: 5.8 }, // ふっくら（横長）
    { rx: 6.0, ry: 6.6 }, // やや面長
  ],

  hairColors: ["#2b2b2b", "#4a3222", "#6b4423", "#8b5a2b", "#c99a4a", "#d9c08a", "#7a2e2e", "#3a3a5c", "#9c9c9c", "#e8b4d8"],

  // 前髪のシルエット（頭中心を(0,0)、半径6基準の相対パス）
  // 頭の上から横（耳のあたり）までしっかり覆う「フルヘア」シルエットにして、
  // 3等身デフォルメでも「髪型」だとひと目で分かるようにしてある。
  hairStylesFront: [
    'M -6.5 1 Q -7 -8.3 0 -8.3 Q 7 -8.3 6.5 1 Q 6.5 -1.3 3.5 -2.4 Q 0 -3.1 -3.5 -2.4 Q -6.5 -1.3 -6.5 1 Z', // ショート
    'M -7 2 Q -7.5 -8.5 0 -8.5 Q 7.5 -8.5 7 2 L 6.5 5 Q 7 -2.8 0 -3.4 Q -7 -2.8 -6.5 5 Z', // ボブ
    'M -6.5 1 Q -6.5 -8 0 -8 Q 6.5 -8 6.5 1 L 6.5 -1.8 L -6.5 -1.8 Z', // ぱっつん（水平バング）
    'M -7 0 Q -7.5 -9 0 -9 Q 7.5 -9 7 0 Q 5 -3 2.5 -1 Q 0 -3 -2.5 -1 Q -5 -3 -7 0 Z', // ふわふわ
    'M -6.5 1.5 Q -7 -8.5 0 -8.5 Q 7 -8.5 6.5 1.5 Q 6.8 -3 2 -4.5 Q -1 -1 -4 -4 Q -6.8 -3 -6.5 1.5 Z', // 七三
    'M -6.8 1 Q -7 -8.8 0 -8.8 Q 7 -8.8 6.8 1 Q 6.5 3 5 0 Q 2.5 -3.5 0 0.5 Q -2.5 -3.5 -5 0 Q -6.5 3 -6.8 1 Z', // ロング前髪
    'M -5.8 -0.5 Q -6 -8.5 0 -8.5 Q 6 -8.5 5.8 -0.5 Q 5.5 -2.8 0 -3.4 Q -5.5 -2.8 -5.8 -0.5 Z', // ショートカット
    'M -6.8 0 Q -7 -8.5 0 -8.5 Q 7 -8.5 6.8 0 Q 6 -3 4.3 -0.5 Q 2.3 -3.8 0 -0.8 Q -2.3 -3.8 -4.3 -0.5 Q -6 -3 -6.8 0 Z', // ギザギザ
  ],

  eyeStyles: [
    "dot", "line", "oval", "sleepy", "wide", "star",
  ],

  mouthStyles: [
    "smile", "flat", "open", "small-o", "smirk", "grin",
  ],

  earSizes: [1.0, 1.15, 0.85, 1.3],

  noseStyles: ["dot", "line", "triangle", "none"],

  outfitColors: [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c",
    "#e67e22", "#34495e", "#f1c40f", "#16a085", "#d35400", "#7f8c8d",
  ],

  pantsColors: ["#2c3e50", "#34495e", "#5d4037", "#455a64", "#37474f", "#263238", "#6d4c41", "#546e7a", "#3e2723", "#212121"],

  shoeColors: ["#1a1a1a", "#5d3a1a", "#ffffff", "#8b0000", "#1a1a2e", "#4a4a4a"],
};

// 文字列(id)から安定した疑似ランダム値を作る（同じスタッフは毎回同じ見た目になる）
Game.Data.hashSeed = function (str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
};

// idから決定論的な「見た目」を生成する
Game.Data.generateLook = function (seedStr) {
  var seed = Game.Data.hashSeed(seedStr);
  function pick(n, salt) {
    return (seed + salt * 977) % n;
  }
  var P = Game.Data.CharacterParts;
  return {
    skinTone: pick(P.skinTones.length, 1),
    headShape: pick(P.headShapes.length, 2),
    hairStyle: pick(P.hairStylesFront.length, 3),
    hairColor: pick(P.hairColors.length, 4),
    eyeStyle: pick(P.eyeStyles.length, 5),
    mouthStyle: pick(P.mouthStyles.length, 6),
    earSize: pick(P.earSizes.length, 7),
    noseStyle: pick(P.noseStyles.length, 8),
    outfitColor: pick(P.outfitColors.length, 9),
    pantsColor: pick(P.pantsColors.length, 10),
    shoeColor: pick(P.shoeColors.length, 11),
  };
};

// 客用：毎回ランダムな見た目
Game.Data.randomLook = function () {
  return Game.Data.generateLook("cust_" + Math.random().toString(36).slice(2) + Date.now());
};
