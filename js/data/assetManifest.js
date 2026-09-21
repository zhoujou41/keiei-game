// assetManifest.js — 画像素材の一元管理
// コード中に画像パスを直接書かないための定義ファイル。
// 画像を差し替える・種類を増やす場合はこのファイルだけを編集すればよく、
// ゲームロジック（core/*）や描画エンジン（ui/actorSprite.js, ui/sceneV2.js）は変更不要にする。
//
// v3差し替えメモ（2026-09-21、LimeZu "Modern Interiors" 購入に伴う全面差し替え）:
//   - 参照画像レベルの画風を求めてLPC汎用スプライトを検証したが3頭身チビキャラの比率に
//     合わず不採用（proportion_compare.png参照）。代わりにLimeZu社のchibi系有償素材
//     "Modern Interiors" ($1.50〜)を購入し、そこに同梱される旧フォーマット
//     "Single_Characters_Legacy"（Adam/Bob等20体の完成済みキャラ）を採用した。
//   - キャラは「パーツを重ねる」方式（v1/v2）をやめ、Legacy素材が完成絵1枚なので
//     「役割ごとに1枚の完成画像（方向×4）」を選ぶだけの方式に変更した。
//     カスタマイズ性は失うが、実在する素材だけを使う原則を守るため。
//   - 客: 14種類のキャラ（Adam/Bob/Lucy等）をランダム選択して見た目のバリエーションを出す。
//   - 従業員: 専用の制服素材は"Chef_*"（コック帽＋エプロン）と"Bouncer"（フォーマルな
//     黒服）の2種類を採用。"ウェイター服"に該当する素材はこのパックには見当たらなかった
//     （無い物は作らない）。
//
// v3-b差し替えメモ（同日、「コック二重表示」バグ修正・多フレームアニメ化）:
//   - 【バグ修正】Legacyシートの「idle」行は1コマ16px幅、「walk」系の行は1コマ32px幅
//     という、行によってコマ幅が異なる構造だった。抽出スクリプトがidle行にも32px幅の
//     切り出しを使ってしまい、隣のコマと合成された「頭が2つあるコック」画像になっていた
//     （staff_chefのみ発現。customer/staff_serviceは修正済みの抽出だったため無事だった）。
//     行ごとに正しいコマ幅（idle=16px、walk=32px）を使うよう抽出をやり直して解消。
//   - 【上向き素材の再徹底調査】客14種+Bouncer+Chef_Alexの全キャラについて、シート全行の
//     ピクセル単位の対称性スコア（左右反転との重なり率）を計測。「正面向き」は0.7〜0.8、
//     「左向き/右向き」は0.34〜0.49と全キャラ一貫しており、後ろ向き特有の非対称パターンは
//     どのキャラにも見つからなかった（=全キャラ、後ろ向き素材は本当に存在しない）。
//     この結果を踏まえ、上向きの代用先を"left"から"right"に変更した
//     （UP_DIRECTION_FALLBACK参照）。
//   - 【多フレームアニメ化】方向ごとに静止画1枚だけだったのを、「歩行」6コマ・「待機」
//     （down: 4コマの本物の待機モーション、left/right: 歩行コマから2枚抜粋）に変更。
//     ui/actorSprite.jsが経過時間に応じてコマを切り替える。
//   - 【コック二重表示バグの再発・再修正】has_directions=False（方向別素材が無い役職）の
//     left/right待機・歩行コマを別行から誤って切り出しており、同じ「1コマの中に頭が2つ」
//     になるバグがコックのleft/right idleにだけ再発していた。今回は該当ロールの
//     left/right全コマをdown系コマの単純コピーに置き換えて解消（方向別素材が無い以上、
//     どの方向でも正面向きの絵をそのまま使うのが本来の設計方針だったため）。
//   - 【什器差し替え】v1由来のプレースホルダ什器画像を廃止し、LimeZu "Modern Interiors"
//     同梱の1_Interiors/16x16/から実素材を採用（assets/furniture_v3/、詳細は
//     FURNITURE_ASSETSのコメント参照）。ラグ・額縁など装飾用の当たり判定なしアイテムも追加。
//
// v4-b差し替えメモ（「キッチンをもっと細かく・広く」フィードバックへの対応）:
//   - キッチンが冷蔵庫・コンロ・カウンターの3点だけで単調だったため、Kitchen_Singles内から
//     新たに電子レンジ付きキャビネット（microwave）・食洗機（dishwasher）・ガラス扉の
//     パントリー棚（shelf）を切り出して追加。什器点数を増やすのと合わせて、キャンバス幅
//     （VIEW_W）自体も広げてキッチンの占有面積を拡大した（詳細はsceneV2.js側）。
window.Game = window.Game || {};
Game.Data = Game.Data || {};

(function () {
  var ASSET_BASE = "assets/";
  var CHAR_BASE = ASSET_BASE + "characters_v3/";
  var FURNITURE_BASE = ASSET_BASE + "furniture_v3/";

  // ================= キャラクター（役割ベース、v3） =================
  var DIRECTIONS = ["down", "up", "left", "right"];
  // 素材に「上向き」が存在しないため（全キャラ確認済み）、暫定的に別方向のコマを流用する。
  // ユーザー指示により"right"を代用先とする（本物の後ろ向き素材が手に入り次第ここを外す）。
  var UP_DIRECTION_FALLBACK = "right";
  // 各方向・各アニメ種別（walk/idle）のコマ数。抽出スクリプト（scratchpad側）の出力と一致させること。
  var FRAME_COUNTS = {
    down: { walk: 6, idle: 4 },
    left: { walk: 6, idle: 2 },
    right: { walk: 6, idle: 2 },
  };

  // 客として使うキャラのバリエーション一覧（LimeZu Single_Characters_Legacy由来）。
  var CUSTOMER_LOOKS = [
    "customer_adam", "customer_bob", "customer_lucy", "customer_molly",
    "customer_alex", "customer_amelia", "customer_ash", "customer_bruce",
    "customer_dan", "customer_edward", "customer_pier", "customer_rob",
    "customer_roki", "customer_samuel",
  ];

  // 従業員の見た目（役割固定）。コックはコック帽＋エプロンの"staff_chef"、ウェイターは
  // 「黒い服の人」＝フォーマルな黒服の"staff_service"（Bouncer）をそのまま流用する
  // （ウェイター専用の制服素材はパック内に見当たらないため、既存の黒服素材で代用。
  // 元々left/right両方向の実素材を持つキャラなので、接客時の向き替えも自然に表現できる）。
  var STAFF_LOOKS = {
    cook: "staff_chef",
    waiter: "staff_service",
  };
  var DEFAULT_STAFF_LOOK = STAFF_LOOKS.cook;

  // direction("down"/"up"/"left"/"right") + animGroup("walk"/"idle") から
  // そのコマ数ぶんの画像パス配列を返す（実際に何枚あるかはFRAME_COUNTSに従う。
  // "up"は素材が無いためFRAME_COUNTS上も"right"のコマ数を使う）。
  function characterFramePaths(lookKey, direction, animGroup) {
    var dir = direction === "up" ? UP_DIRECTION_FALLBACK : direction;
    var n = FRAME_COUNTS[dir][animGroup];
    var paths = [];
    for (var i = 0; i < n; i++) {
      paths.push(CHAR_BASE + lookKey + "_" + dir + "_" + animGroup + "_" + i + ".png");
    }
    return paths;
  }

  // 文字列から安定した疑似ランダム値を作る（同じ人物なら毎回同じ見た目になる）。
  function hashSeed(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  // 客の見た目を1つ決める（roleKeyの文字列を返すだけ。パーツ合成は行わない）。
  // seedStrを渡すと、既存のGame.Data.hashSeedと同じ決定論的パターンで「同じ人物なら毎回同じ見た目」にできる。
  function randomCharacterLook(seedStr) {
    var seed = seedStr ? hashSeed(seedStr) : Math.floor(Math.random() * 1e9);
    return CUSTOMER_LOOKS[seed % CUSTOMER_LOOKS.length];
  }

  function defaultCharacterLook() {
    return DEFAULT_STAFF_LOOK;
  }

  // ================= 什器（furniture、v3でLimeZu実素材に差し替え） =================
  // "Modern Interiors" 同梱の 1_Interiors/16x16/ から、そのまま使える単体切り出し済み
  // 画像（Theme_Sorter_Singles）と、切り出し済みが無いテーマのみ1_Generic_16x16.png
  // から矩形クロップして採用。実在する素材のみを使う原則を什器にも適用している。
  //   table     : Kitchen_Singles_275.png（木目の小テーブル）
  //   chair     : 1_Generic_16x16.png からクロップ（背もたれ付き木椅子）
  //   stove     : Kitchen_Singles_153.png（4口コンロ）
  //   fridge    : Kitchen_Singles_168.png（縦長の業務用冷蔵庫）
  //   counter   : Kitchen_Singles_91.png（調理台）
  //   microwave : Kitchen_Singles_124.png（電子レンジ付きキャビネット）【v4-b追加】
  //   dishwasher: Kitchen_Singles_187.png（食洗機）【v4-b追加】
  //   shelf     : Kitchen_Singles_193.png（ガラス扉のパントリー棚）【v4-b追加】
  //   register  : Kitchen_Singles_134.png（レジ機）
  //   plant     : Living_Room_Singles_14.png（観葉植物）
  //   entrance  : 1_Generic_16x16.png からクロップ（入口ドア）
  //   rug       : 1_Generic_16x16.png からクロップ（装飾ラグ、当たり判定なし）
  //   picture   : 1_Generic_16x16.png からクロップ（壁の額縁、当たり判定なし）
  var FURNITURE_ASSETS = {
    entrance: FURNITURE_BASE + "entrance.png",
    table: FURNITURE_BASE + "table.png",
    chair: FURNITURE_BASE + "chair.png",
    stove: FURNITURE_BASE + "stove.png",
    fridge: FURNITURE_BASE + "fridge.png",
    counter: FURNITURE_BASE + "counter.png",
    microwave: FURNITURE_BASE + "microwave.png",
    dishwasher: FURNITURE_BASE + "dishwasher.png",
    shelf: FURNITURE_BASE + "shelf.png",
    register: FURNITURE_BASE + "register.png",
    plant: FURNITURE_BASE + "plant.png",
    rug: FURNITURE_BASE + "rug.png",
    picture: FURNITURE_BASE + "picture.png",
  };

  // ================= 料理 =================
  // 既存の商品データ（js/data/products.js）のカテゴリに対応付け。
  var FOOD_ASSETS = {
    ramen: ASSET_BASE + "food/ramen.png",
    pasta: ASSET_BASE + "food/pasta.png",
    parfait: ASSET_BASE + "food/parfait.png",
    teishoku: ASSET_BASE + "food/curry_rice.png", // 「定食」に割り当て（丼物として近いイメージ）
    hamburger: ASSET_BASE + "food/hamburger.png", // 現状未使用（予備）
  };

  // ================= UI / 食材（現状は一部のみ使用、将来拡張用） =================
  var UI_ASSETS = {
    coin: ASSET_BASE + "ui/coin.png",
    heart: ASSET_BASE + "ui/heart.png",
  };
  var INGREDIENT_ASSETS = {
    egg: ASSET_BASE + "ingredients/egg.png",
    lettuce: ASSET_BASE + "ingredients/lettuce.png",
    meat: ASSET_BASE + "ingredients/meat.png",
    noodle: ASSET_BASE + "ingredients/noodle.png",
    tomato: ASSET_BASE + "ingredients/tomato.png",
  };

  // ================= アニメーション定義 =================
  // 「状態→どのアニメ種別を再生するか」の対応表のみを持つ。実際の見た目（画像）には関知しない。
  // ui/actorSprite.js がこれを読んで、位相アニメ（歩行バウンド等）のパラメータを決める。
  var ANIMATION_KIND = {
    WALK: "walk",
    IDLE: "idle",
    IDLE_ALERT: "idle_alert",
    SIT_IDLE: "sit_idle",
    SIT_TALK: "sit_talk",
    SIT_EAT: "sit_eat",
    STAND_TALK: "stand_talk",
    WALK_CARRY: "walk_carry",
    COOK: "cook",
  };

  var ANIMATION_DEFINITIONS = {
    customer: {
      ENTERING: { anim: ANIMATION_KIND.WALK },
      LOOKING_FOR_SEAT: { anim: ANIMATION_KIND.WALK },
      WALKING_TO_SEAT: { anim: ANIMATION_KIND.WALK },
      SITTING: { anim: ANIMATION_KIND.SIT_IDLE },
      WAITING_FOR_ORDER: { anim: ANIMATION_KIND.SIT_IDLE },
      ORDERING: { anim: ANIMATION_KIND.SIT_TALK },
      WAITING_FOR_FOOD: { anim: ANIMATION_KIND.SIT_IDLE },
      EATING: { anim: ANIMATION_KIND.SIT_EAT },
      PAYING: { anim: ANIMATION_KIND.STAND_TALK },
      LEAVING: { anim: ANIMATION_KIND.WALK },
    },
    // コック：コンロの前（IDLE/WORKING）とカウンターへの受け渡し（PLACING）のみ。客席には出ない。
    cook: {
      IDLE: { anim: ANIMATION_KIND.IDLE },
      WORKING: { anim: ANIMATION_KIND.COOK },
      PLACING: { anim: ANIMATION_KIND.WALK_CARRY },
    },
    // ウェイター：接客・カウンターでの受け取り・配膳・会計を担当。
    waiter: {
      IDLE: { anim: ANIMATION_KIND.IDLE },
      NOTICE_CUSTOMER: { anim: ANIMATION_KIND.IDLE_ALERT },
      WALKING_TO_CUSTOMER: { anim: ANIMATION_KIND.WALK },
      TAKING_ORDER: { anim: ANIMATION_KIND.STAND_TALK },
      WALKING_TO_COUNTER: { anim: ANIMATION_KIND.WALK },
      CARRYING_FOOD: { anim: ANIMATION_KIND.WALK_CARRY },
      SERVING: { anim: ANIMATION_KIND.STAND_TALK },
      CASHIER: { anim: ANIMATION_KIND.STAND_TALK },
      RESTING: { anim: ANIMATION_KIND.IDLE },
    },
  };

  Game.Data.CharacterAssets = {
    base: CHAR_BASE,
    directions: DIRECTIONS,
    customerLooks: CUSTOMER_LOOKS,
    staffLooks: STAFF_LOOKS,
    framePaths: characterFramePaths,
    randomLook: randomCharacterLook,
    defaultLook: defaultCharacterLook,
  };
  Game.Data.FurnitureAssets = FURNITURE_ASSETS;
  Game.Data.FoodAssets = FOOD_ASSETS;
  Game.Data.UiAssets = UI_ASSETS;
  Game.Data.IngredientAssets = INGREDIENT_ASSETS;
  Game.Data.AnimationKind = ANIMATION_KIND;
  Game.Data.AnimationDefinitions = ANIMATION_DEFINITIONS;
})();
