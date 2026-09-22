// scene.js — FIELD画面の空間シーン（店内でキャラクターが実際に動く演出）
// 数値計算（売上・客数など）は core/simulation.js が既に確定させている。
// このモジュールは「1つのbeat（テキスト1行に対応する演出アクション）」を受け取って
// その場で実行するだけの、受動的な描画エンジンになっている。どの行が再生されているかは
// field.js（ディレクター役）が管理し、beatを渡すタイミング＝そのテキストが表示される
// タイミングなので、テキストと店内の動きは常に対応する。
//
// v5差し替えメモ（2026-09-21、「ゲームに反映して」対応 — asset_test.htmlで検証した
// PNGベースの新描画エンジンを本編に統合）:
//   ユーザーに2点確認した上で実装した：
//   1. 「見た目だけ差し替え（推奨）」を選択 → core/simulation.jsのbeat生成ロジックは
//      一切変更せず、このファイル（描画層）だけを新素材ベースに置き換える。
//      客が実際に何人来て何人帰ったか等の数値的事実はbeatが持つ情報がそのまま真実であり、
//      このシーンは「それをどう見せるか」だけを担当する（v4以前と役割は同じ）。
//   2. 「LAYOUT画面の配置も新エンジンに反映したい」を選択 → asset_test.htmlの新エンジンは
//      3卓固定のハードコードされたレイアウトだったが、本編では逆にLAYOUT画面で自由編集された
//      Game.App.state.layout（グリッド）を都度読み取り、什器・卓・厨房・レジの配置を
//      動的に組み立てる。旧scene.jsが元々グリッド（Game.Core.Layout）とBFS経路探索
//      （Game.Core.Pathfind）の上に作られていたため、この「任意レイアウト対応」という
//      骨格自体はそのまま流用し、以下の点だけを新エンジン相当に差し替えた：
//        - 什器・卓・椅子の描画：SVG図形の直接描画 → LimeZu実素材PNG（Game.Data.FurnitureAssets）
//          を敷く方式に変更。卓の右側にある椅子は左右反転して卓の方を向くようにした
//          （「机の右に配置されている椅子を左右反転して」のfeedbackをここでも反映）。
//        - キャラクター描画：Game.UI.Sprite（パーツ合成の旧SVGキャラ）→
//          Game.UI.ActorSprite（LimeZu完成絵PNGキャラ、多フレーム歩行/待機アニメ付き）に変更。
//        - 厨房のワークフロー：旧scene.jsは「コックが自分で調理して自分でテーブルまで運ぶ」
//          という1人二役だったが、これは元々のフィードバック
//          「キッチン用カウンターからウェイターが受け取る形にして」を満たしていなかった
//          （新エンジンのasset_test.htmlでは満たしていた）。本統合を機に、コックは
//          調理してカウンター地点（厨房什器の隣接マス）に置くだけ、そこから接客担当
//          （waiterPool、レジ/接客ロールのスタッフ）が受け取ってテーブルまで運ぶ、という
//          正しい2段階の受け渡しに直した。人数もGame.App.state.staffの実際の人数
//          （調理ロールの人数だけコック、接客/レジロールの人数だけウェイター）に対応する
//          （固定1人+1人ではない）。
//        - 客の状態の可視化：客が「何もせず突然消える」ように見えないよう、状態に応じた
//          吹き出しアイコン（⏳待機/🍳配膳待ち/🍴食事中/💴会計中/🚫諦め/👋退店中）を、
//          タイマーで自動的に消える一過性のものではなく「状態が変わるまで表示され続ける」
//          方式で表示する（「客が何してるかわかりません」フィードバックへの対応）。
//        - 会計演出：会計時に実際の商品価格（Game.App.state.products）に基づいた金額の
//          数字がレジから飛び出るようにした（従来は💴アイコンのみだった）。
//   なお、来客・待ち・提供・離脱のタイミングと人数そのものは今まで通りbeatが厳密に
//   決めるため、新エンジンのasset_test.html側にあった「一定時間待っても案内/配膳が
//   来なければ客が自発的に諦めて帰る」という自律的なタイムアウト処理はここには一切
//   組み込んでいない（既に確定した数値と食い違う演出が起きてしまうため）。このシーンの
//   客は常に「beatが指示した通りの運命」だけをたどる（サーブされる／待ちきれず帰る、
//   のどちらであっても、それを"どのタイミングで見せるか"はbeat側が決める）。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var CELL = 64; // 1マスあたりの表示ピクセル（歩行可否等のロジック用グリッドとは独立した表示専用の値）
  var WALK_SPEED = 3.6; // マス/秒（配膳・退店など通常の動きはこちらのまま＝「速く動く箇所」）
  // 2026-09-22（客の入店後の動き調整）: 「客が来た後の動きが速すぎる」との指摘を受け、
  // 入店直後（入口→席、または外待ち列→席）の歩行だけを大きく遅くした（＝「ゆっくり
  // 動かす箇所」）。配膳（ウェイターの往復）・退店・怒って帰る動き等、他の動きは
  // これまで通りWALK_SPEED（＋ANGRY_SPEED_MULT）のまま、変更していない。
  var ENTRANCE_WALK_SPEED = WALK_SPEED * 0.45;
  var ANGRY_SPEED_MULT = 1.5; // 怒って帰る時は早歩き
  var ANIM_CAP_ENTER = 4; // 1beatあたり実際にアニメーションさせる客の上限（多すぎると見づらいため）
  var ANIM_CAP_LEAVE = 3;
  var COOK_TIME = 900; // ms（コンロの前での調理時間）
  var LOOK_TIME = 380; // ms（料理が届いてから食べ始めるまでの「見る」間）
  var EAT_TIME = 1500; // ms
  var PAY_TIME = 450; // ms（レジでの会計にかかる時間）
  var WALK_PHASE_RATE = 7.5; // rad/秒（歩行アニメの速さ）
  var IDLE_PHASE_RATE = 1.6; // rad/秒（待機時の呼吸アニメの速さ）
  // 2026-09-21 バグ修正4（「二重になる」バグ）: 複数人が同時入店/離脱する場合、
  // 全員が入口の全く同じ座標から同時刻に歩き出すと、次の分岐点までの経路が重なる間は
  // 複数の客が完全に同じピクセル位置を歩き続けることになり、1人しかいないように（＝誰かが
  // 消えた／2人が1人に重なった）見えてしまっていた。これを防ぐため、歩き出す時刻を
  // 最低でもこの間隔だけ空ける（バグ修正11で、この間隔保証をbeat単位ではなく
  // scheduleEntranceWalk()によるゲーム内時間ベースのグローバルな保証に変更した。
  // 詳しい経緯はscheduleEntranceWalk()直前のコメント参照）。
  var ENTER_STAGGER_MS = 400; // 入口から歩き出す客同士の最低間隔（グローバル）
  // バグ修正19（「二重に表示」のロジック側の原因）: 毎フレーム全キャラの座標を記録する
  // 自動検出で、同じ通路（入口の行など）を歩く客同士が12px未満まで重なったまま
  // 数フレーム以上一緒に歩くケースが1週間で31組見つかった。入口での立ち位置のずれ
  // （entranceJitter）が歩き出しの時間差より大きいため、後から歩き出した客が先の客に
  // 追いついて同じ座標に重なっていた（#56で入店直後の歩行を遅くしたことで時間差が
  // 距離に換算して短くなり、さらに起きやすくなっていた）。
  // 対処：歩いている客は、自分より先に登場した（seqが小さい）「歩いている客」が
  // 進行方向の前方FOLLOW_MIN_SEP以内にいる間は、その場で待つ（追い越さない）。
  // 譲る相手は必ず自分より古い客だけなので、互いに譲り合って止まる（デッドロック）
  // ことは起きない。万一のため、FOLLOW_MAX_WAIT_MS待っても前が空かなければ進む。
  var FOLLOW_MIN_SEP = 34;
  var FOLLOW_MAX_WAIT_MS = 1500;
  // （入口でのjitter半径はバグ修正10でentranceJitter()内の段階的な値に変更したため、
  // ここでの固定半径の定数は廃止した）
  // 2026-09-21 バグ修正5（「椅子に座る位置がずれています」バグ）: 什器（椅子・卓など）は
  // 「マスの下辺」を基準に描画している（drawFurniture: y = セル上端 + CELL - 高さ）のに対し、
  // キャラクターは従来「マスの中心」（cellCenterそのもの）に足元を合わせて描画していたため、
  // 椅子より上（マスの中央）にキャラクターが浮いて見え、座った時に椅子とずれて見えていた。
  // 什器と同じ「マスの下辺」を基準にするため、描画時にだけ縦方向のオフセットを加える
  // （ent.x/ent.y自体は経路探索・距離計算に使う論理座標のままなので、移動ロジックには影響しない）。
  var ENTITY_VISUAL_Y_OFFSET = CELL / 2;

  var AnimationKind = Game.Data.AnimationKind;

  // 商品ID → 新素材の料理アイコンキーのフォールバック表（商品データにfoodKeyが無い場合のみ使う）。
  // 2026-09-21: 業種ごとにメニューを複数持てるようになったため、本来は各商品が自分で
  // foodKeyを持つ（products.js参照）。これは旧セーブ等でfoodKeyが無い場合の保険。
  var PRODUCT_TO_FOODKEY_FALLBACK = { ramen: "ramen", teishoku: "teishoku", pasta: "pasta", dessert: "parfait" };

  // 什器の置物ID（layoutObjects.js） → 素材キー（assetManifest.js FURNITURE_ASSETS）
  var OBJ_TO_ASSET = {
    stove: "stove",
    prep: "counter", // 仕込み台 ≒ 調理台素材で代用
    fridge: "fridge",
    register: "register",
    foodcounter: "counter", // 受け渡しカウンター（2026-09-22新設） ≒ 調理台素材で代用
    plant: "plant",
    shelf: "shelf",
  };
  // 表示サイズ（アンカーは各マスの下辺中央。素材のネイティブ比率に近い値を採用）
  var FURNITURE_SIZE = {
    entrance: { w: 42, h: 54 },
    register: { w: 32, h: 34 },
    fridge: { w: 24, h: 58 },
    stove: { w: 34, h: 58 },
    counter: { w: 34, h: 34 },
    shelf: { w: 40, h: 40 },
    plant: { w: 34, h: 34 },
    table2: { w: 38, h: 66 },
    table4: { w: 46, h: 78 },
    // 2026-09-22（レイアウト改修）: レジ用テーブル（テーブル素材の上にレジ素材を重ねて描く）
    registerTable: { w: 38, h: 48 },
    registerOnTable: { w: 20, h: 22 },
  };

  // 客の状態→吹き出し（announceStateChangesと同じ思想：状態が変わるまで表示され続ける）
  var BUBBLE_BY_PHASE = {
    walking_to_seat: "👀",
    waiting_outside: "⌛", // 2026-09-22新設：満席で入口の外に並んで待っている状態
    awaiting_food: "⏳",
    cooking_wait: "🍳",
    eating: "🍴",
    paying: "💴",
    walking_out: "👋",
    disappointed_loiter: "🚫",
    disappointed_leaving: "🚫",
  };

  var svgEl = null;
  var floorG = null;
  var furnitureG = null;
  var entitiesG = null;
  var bubblesG = null;
  var popupsG = null;
  var fxG = null;

  var layout = null;
  var walkableFn = null;
  var tables = []; // {x,y,defId,seats:[{x,y,occupied}]}
  var kitchenCellForFx = null;
  var stovePoints = []; // 厨房（コンロ）の作業地点。プレイヤーの配置次第で複数/0になりうる
  var counterPoint = null; // コック→ウェイターの受け渡し地点（受け渡しカウンター什器の隣接マス）
  var registerPoint = null;
  var entrance = null;
  var loiterPoint = null;
  var steamEl = null;
  // 2026-09-22（レイアウト改修）新設：満席のため入口の外で待っている客の列。
  // {ent, productId} の配列。座席が空き次第、先頭から順に着席させる（admitFromQueueIfPossible）。
  var outsideQueue = [];
  var outsideOverflowCount = 0; // 待機列の見た目上限を超えた分（スプライトは出さずバッジの人数のみに含める）
  // 入口の外に同時に立たせる客の見た目上限。outsideWaitJitter()の正六角形1周分（6人）に
  // 収め、周囲のテーブルと重ならない範囲に収まるようにしている（7人目以降はバッジの人数のみに含める）。
  var MAX_OUTSIDE_VISIBLE = 6;
  var outsideWaitSpawnSeq = 0; // 待機列の立ち位置をずらすための通し番号（entranceSpawnSeqと同じ考え方）
  var outsideQueueAnchor = null; // 待機列の中心点（setupLayoutで入口位置から算出）
  var queueBadgeEl = null; // 「待ち N人」のバッジ表示
  // スタッフが「待機時に立つ位置」の候補プール（同ロールの人数分、できるだけ別マスに散らす）。
  // 什器が1個しか無い/隣接歩行可能マスが少ないレイアウトでは候補が足りない場合があるため、
  // その際は distinctPositions() 側でピクセル単位のjitterにフォールバックする。
  var cookHomePool = [];
  var waiterHomePool = [];

  var entities = {}; // id -> entity
  var entitySeq = 0;
  var kitchenStaffPool = []; // {staffId, look, busy, entity, home}
  var waiterStaffPool = []; // {staffId, look, busy, entity, home}
  var kitchenJobQueue = []; // {customer, productId}
  var readyQueue = []; // {customer, productId}（カウンターに置かれ、ウェイターの受け取り待ち）
  var moneyPopups = [];

  var speedMult = 1;
  var running = false;
  var rafHandle = null;
  var lastFrameTime = 0;
  // バグ修正11（「二重になる」バグの真因対応。以下のentranceJitter()直前のコメント、
  // およびscheduleEntranceWalk()のコメント参照）: tick()のdt（speedMult反映済み）を
  // 積算した「ゲーム内時間」。ENTER_STAGGER_MSによる歩き出しタイミングの間隔を、
  // 実時間(Date.now())ではなくこのゲーム内時間で測ることで、倍速再生中や
  // 「退店をお待ちください」中の後片付け高速化（CLEANUP_SPEED_MULT）でも
  // 間隔の意味（＝画面上でどれだけ離れて見えるか）が変わらないようにする。
  var simClockMs = 0;

  function elNS(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        e.setAttribute(k, attrs[k]);
      });
    }
    return e;
  }

  function cellCenter(x, y) {
    return { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 };
  }

  function nearestCell(px, py) {
    return {
      x: Game.Core.Random.clamp(Math.round(px / CELL - 0.5), 0, layout.cols - 1),
      y: Game.Core.Random.clamp(Math.round(py / CELL - 0.5), 0, layout.rows - 1),
    };
  }

  // ================= 初期化 / レイアウト描画 =================
  function init(container) {
    container.innerHTML = "";
    svgEl = elNS("svg", { id: "scene-svg" });
    floorG = elNS("g", { id: "scene-floor" });
    furnitureG = elNS("g", { id: "scene-furniture" });
    entitiesG = elNS("g", { id: "scene-entities" });
    fxG = elNS("g", { id: "scene-fx" });
    bubblesG = elNS("g", { id: "scene-bubbles" });
    popupsG = elNS("g", { id: "scene-popups" });
    svgEl.appendChild(floorG);
    svgEl.appendChild(furnitureG);
    svgEl.appendChild(entitiesG);
    svgEl.appendChild(fxG);
    svgEl.appendChild(bubblesG);
    svgEl.appendChild(popupsG);
    container.appendChild(svgEl);

    // 「入口の外で何人待っているか」バッジ（2026-09-22新設）。
    queueBadgeEl = elNS("g", { id: "outside-queue-badge", opacity: 0 });
    var pill = elNS("rect", { x: -26, y: -11, width: 52, height: 20, rx: 10, fill: "#2e2620", opacity: 0.88 });
    var txt = elNS("text", { x: 0, y: 4, "font-size": 11, "text-anchor": "middle", fill: "#ffd27a", "font-weight": "bold" });
    txt.setAttribute("id", "outside-queue-badge-text");
    queueBadgeEl.appendChild(pill);
    queueBadgeEl.appendChild(txt);
    popupsG.appendChild(queueBadgeEl);
  }

  function setupLayout(newLayout) {
    layout = newLayout;
    walkableFn = Game.Core.Layout.walkableFnFor(layout);
    svgEl.setAttribute("viewBox", "0 0 " + layout.cols * CELL + " " + layout.rows * CELL);

    tables = Game.Core.Layout.tables(layout).map(function (t) {
      var seatCells = Game.Core.Layout.seatsForTable(layout, t);
      return {
        x: t.x,
        y: t.y,
        defId: t.id,
        seats: seatCells.map(function (s) {
          return { x: s.x, y: s.y, occupied: false };
        }),
      };
    });

    var kitchenCells = Game.Core.Layout.kitchenStations(layout);
    var stoveCells = kitchenCells.filter(function (c) {
      return c.id === "stove";
    });
    var usable = stoveCells.length > 0 ? stoveCells : kitchenCells;
    kitchenCellForFx = usable.length > 0 ? usable[0] : null;
    stovePoints = usable
      .map(function (c) {
        return Game.Core.Layout.interactionPoint(layout, c.x, c.y);
      })
      .filter(Boolean);

    var regCell = Game.Core.Layout.registerCell(layout);
    registerPoint = regCell ? Game.Core.Layout.interactionPoint(layout, regCell.x, regCell.y) : null;

    entrance = Game.Data.FIXED_ENTRANCE;
    if (stovePoints.length === 0) stovePoints = [entrance];

    // 2026-09-22（レイアウト改修）: 受け渡しカウンター什器（layoutObjects.jsの"foodcounter"）が
    // 配置されていればそこを使う。古いレイアウト（旧セーブや、ユーザーが撤去した場合）には
    // 存在しないことがあるため、その場合は従来通りコンロの地点で代用する（フォールバック）。
    var counterCell = Game.Core.Layout.counterCell(layout);
    counterPoint = counterCell ? Game.Core.Layout.interactionPoint(layout, counterCell.x, counterCell.y) : null;
    if (!counterPoint) counterPoint = stovePoints[0];
    if (!registerPoint) registerPoint = entrance;

    // バグ修正19：売り切れで諦める客は、以前は入口の隣のマス（＝店内の通路そのもの）まで
    // 入って立ち止まっていたため、そこを通る客や、同時に諦めた別の客と重なっていた。
    // 入口に顔を出して🚫を見せ、そのまま引き返す演出にする（入口に人がいる間は
    // doorIsClear()により次の客が入らないので重ならない）。
    loiterPoint = entrance;
    // 入口の外で待つ客の立ち位置の基準点（入口セルより少し店内寄り＝入口のすぐ手前）。
    var ec0 = cellCenter(entrance.x, entrance.y);
    outsideQueueAnchor = { x: ec0.x, y: ec0.y - CELL * 1.15 };
    outsideQueue = [];
    outsideOverflowCount = 0;
    doorQueue = [];
    outsideWaitSpawnSeq = 0;
    if (queueBadgeEl) {
      queueBadgeEl.setAttribute("transform", "translate(" + (ec0.x + CELL * 0.95) + "," + (ec0.y - CELL * 0.55) + ")");
      queueBadgeEl.setAttribute("opacity", 0);
    }

    // 同ロールのスタッフが複数いても重ならないよう、什器の周囲にある歩行可能マスを
    // できるだけ多く候補として集めておく（実際に何人使うかはsetupStaffPools側で決まる）。
    var stoveAdj = [];
    usable.forEach(function (c) {
      Game.Core.Pathfind.findAdjacentWalkable(c.x, c.y, walkableFn, layout.cols, layout.rows).forEach(function (p) {
        stoveAdj.push(p);
      });
    });
    cookHomePool = nearbyDistinctCells(stoveAdj.length > 0 ? stoveAdj : [entrance]);

    var regAdj = regCell ? Game.Core.Pathfind.findAdjacentWalkable(regCell.x, regCell.y, walkableFn, layout.cols, layout.rows) : [];
    waiterHomePool = nearbyDistinctCells(regAdj.length > 0 ? regAdj : [entrance]);

    renderFloor();
    renderFurniture();
  }

  // 種になるマス集合から、重複を除いた歩行可能マスの候補プールを作る。
  // 種だけでは数が足りない場合（什器の隣接マスが1つしか無い等）は、そこからさらに
  // 隣接するマスへ1歩ずつ広げていき、ある程度の人数分の候補が確保できるようにする。
  function nearbyDistinctCells(seedCells) {
    var MIN_POOL = 5; // 現実的なスタッフ人数を十分カバーできる候補数
    var MAX_RINGS = 6; // 無限ループ防止
    var seen = {};
    var pool = [];
    function ckey(c) {
      return c.x + "," + c.y;
    }
    // 2026-09-21 バグ修正4（「二重になる」対応の一環）: レジ什器を入口のすぐ隣に置いた場合など、
    // 「什器に隣接する歩行可能マス」の中に入口セル自体が含まれてしまうことがある。これを
    // そのままスタッフの待機位置プールに入れてしまうと、スタッフが入口のど真ん中に立ち続け、
    // そこへ次々と入店してくる客と常に重なって見える（＝二重になっているように見える）
    // 不具合になっていた。入口セルは常に候補から除外する。
    function isEntranceCell(c) {
      return c.x === entrance.x && c.y === entrance.y;
    }
    function add(c) {
      if (isEntranceCell(c)) return;
      var k = ckey(c);
      if (seen[k]) return;
      seen[k] = true;
      pool.push({ x: c.x, y: c.y });
    }
    seedCells.forEach(add);
    var frontier = pool.slice();
    var ring = 0;
    while (pool.length < MIN_POOL && frontier.length > 0 && ring < MAX_RINGS) {
      ring++;
      var next = [];
      frontier.forEach(function (c) {
        Game.Core.Pathfind.findAdjacentWalkable(c.x, c.y, walkableFn, layout.cols, layout.rows).forEach(function (n) {
          if (!isEntranceCell(n) && !seen[ckey(n)]) next.push(n);
        });
      });
      next.forEach(add);
      frontier = next;
    }
    return pool;
  }

  // count人分の待機位置を候補プールから割り当てる。プールの方が少ない場合は使い回しになるが、
  // その際は完全に同じピクセル位置へ重ならないよう、円状のオフセット（jitter）を付与する。
  function distinctPositions(pool, count) {
    if (!pool || pool.length === 0) pool = [entrance];
    var GOLDEN_ANGLE = 137.5; // 均等に散らすための黄金角
    var out = [];
    for (var i = 0; i < count; i++) {
      var cell = pool[i % pool.length];
      var dupIndex = Math.floor(i / pool.length);
      var jitter = null;
      if (dupIndex > 0) {
        var angle = (dupIndex * GOLDEN_ANGLE + i * 19) * (Math.PI / 180);
        var radius = 8 + dupIndex * 5;
        jitter = { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.6 };
      }
      out.push({ x: cell.x, y: cell.y, jitter: jitter });
    }
    return out;
  }

  // スタッフを「持ち場（home）」のピクセル位置へスナップさせる（jitterがあれば適用）。
  // 移動アニメの終端（setPathの中心座標）はセルの中心ぴったりに揃うため、そこへ
  // 戻ってきた直後にこれを呼んでjitter分だけずらし直すことで、複数人が同じマスを
  // homeにしていても見た目上は重ならないようにする。
  function snapToHome(poolEntry) {
    var ent = poolEntry.entity;
    if (!ent) return;
    var c = cellCenter(poolEntry.home.x, poolEntry.home.y);
    ent.x = c.x + (poolEntry.jitter ? poolEntry.jitter.dx : 0);
    ent.y = c.y + (poolEntry.jitter ? poolEntry.jitter.dy : 0);
    ent.path = [];
    ent.onArrive = null;
    ent.g.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")");
  }

  // ================= 床の描画（シンプルな木目タイル） =================
  function renderFloor() {
    while (floorG.firstChild) floorG.removeChild(floorG.firstChild);
    var w = layout.cols * CELL,
      h = layout.rows * CELL;
    for (var y = 0; y < layout.rows; y++) {
      floorG.appendChild(
        elNS("rect", { x: 0, y: y * CELL, width: w, height: CELL, fill: y % 2 === 0 ? "#8a6a45" : "#7d5f3d" })
      );
      floorG.appendChild(elNS("line", { x1: 0, y1: y * CELL, x2: w, y2: y * CELL, stroke: "#6b4f30", "stroke-width": 1, opacity: 0.5 }));
    }
    floorG.appendChild(elNS("rect", { x: 0, y: 0, width: w, height: CELL * 0.34, fill: "#d8c9a8" }));
    floorG.appendChild(elNS("rect", { x: 0, y: CELL * 0.34 - 2, width: w, height: 3, fill: "#b8a582" }));

    var ec = cellCenter(entrance.x, entrance.y);
    var matEl = elNS("rect", { x: ec.x - 16, y: ec.y + CELL / 2 - 5, width: 32, height: 9, rx: 2, fill: "#3a4050" });
    floorG.appendChild(matEl);
    var openTxt = elNS("text", { x: ec.x, y: ec.y + CELL / 2 + 2, "font-size": 6.5, "text-anchor": "middle", fill: "#f2a93b", "font-weight": "bold" });
    openTxt.textContent = "OPEN";
    floorG.appendChild(openTxt);
  }

  // ================= 什器・卓・椅子の描画（PNG素材） =================
  function resolveFurnitureSpec(idOrKey) {
    if (idOrKey === "entrance") {
      return { assetKey: idOrKey, size: FURNITURE_SIZE[idOrKey] };
    }
    if (idOrKey === "table2" || idOrKey === "table4") {
      return { assetKey: "table", size: FURNITURE_SIZE[idOrKey] };
    }
    var assetKey = OBJ_TO_ASSET[idOrKey] || idOrKey;
    return { assetKey: assetKey, size: FURNITURE_SIZE[assetKey] || { w: 32, h: 32 } };
  }

  function drawFurniture(cellX, cellY, idOrKey, flip) {
    var spec = resolveFurnitureSpec(idOrKey);
    var href = Game.Data.FurnitureAssets[spec.assetKey];
    if (!href) return;
    var cellPxX = cellX * CELL,
      cellPxY = cellY * CELL;
    var w = spec.size.w,
      h = spec.size.h;
    var x = cellPxX + CELL / 2 - w / 2;
    var y = cellPxY + CELL - h;
    var img = elNS("image", { href: href, x: x, y: y, width: w, height: h });
    if (flip) {
      var cx = cellPxX + CELL / 2;
      var g = elNS("g", { transform: "translate(" + 2 * cx + ",0) scale(-1,1)" });
      g.appendChild(img);
      furnitureG.appendChild(g);
    } else {
      furnitureG.appendChild(img);
    }
  }

  // 2026-09-22（レイアウト改修）: レジをテーブル+レジ本体の2枚重ねで描く
  // （「ちゃんとレジ用テーブルを作ってその上にレジを置いて」への対応）。
  function drawRegisterTable(cellX, cellY) {
    var tableHref = Game.Data.FurnitureAssets.table;
    var regHref = Game.Data.FurnitureAssets.register;
    if (!tableHref || !regHref) return;
    var cellPxX = cellX * CELL,
      cellPxY = cellY * CELL;
    var tSize = FURNITURE_SIZE.registerTable;
    var tx = cellPxX + CELL / 2 - tSize.w / 2,
      ty = cellPxY + CELL - tSize.h;
    furnitureG.appendChild(elNS("image", { href: tableHref, x: tx, y: ty, width: tSize.w, height: tSize.h }));

    var rSize = FURNITURE_SIZE.registerOnTable;
    var rx = cellPxX + CELL / 2 - rSize.w / 2,
      ry = ty - rSize.h * 0.32; // テーブルの天面に乗っているように少し重ねる
    furnitureG.appendChild(elNS("image", { href: regHref, x: rx, y: ry, width: rSize.w, height: rSize.h }));
  }

  // 2026-09-22（レイアウト改修）: 椅子不要・着席動作も不要というユーザー要望に対応し、
  // 椅子の描画を廃止した。tables[].seats はここでは見た目に使わず、経路探索・座席の
  // 空き管理（layout.jsのseatsForTable由来）専用の内部データとして引き続き利用する。
  function renderFurniture() {
    while (furnitureG.firstChild) furnitureG.removeChild(furnitureG.firstChild);

    drawFurniture(entrance.x, entrance.y, "entrance", false);

    Game.Core.Layout.allObjectCells(layout).forEach(function (c) {
      if (c.def.category === "table") return; // テーブルは後段でまとめて描く
      if (c.id === "register") {
        drawRegisterTable(c.x, c.y);
        return;
      }
      drawFurniture(c.x, c.y, c.id, false);
    });

    tables.forEach(function (t) {
      drawFurniture(t.x, t.y, t.defId, false);
    });

    if (kitchenCellForFx) {
      var kc = cellCenter(kitchenCellForFx.x, kitchenCellForFx.y);
      steamEl = elNS("g", { id: "steam-fx", opacity: 0 });
      steamEl.innerHTML =
        '<circle cx="' + (kc.x - 4) + '" cy="' + (kc.y - 40) + '" r="3.4" fill="#fff"/>' +
        '<circle cx="' + (kc.x + 5) + '" cy="' + (kc.y - 48) + '" r="2.7" fill="#fff"/>' +
        '<circle cx="' + kc.x + '" cy="' + (kc.y - 55) + '" r="2.2" fill="#fff"/>';
      fxG.appendChild(steamEl);
    } else {
      steamEl = null;
    }
  }

  function updateSteamVisibility() {
    if (!steamEl) return;
    var anyBusy = kitchenStaffPool.some(function (c) {
      return c.busy;
    });
    steamEl.setAttribute("opacity", anyBusy ? 0.85 : 0);
  }

  // ================= エンティティ管理 =================
  function spawnEntity(kind, look, gridStart, role) {
    var seq = entitySeq++;
    var id = "e" + seq;
    var p = cellCenter(gridStart.x, gridStart.y);
    var ent = {
      id: id,
      seq: seq,
      followWaitMs: 0,
      blockedByLeader: false,
      kind: kind,
      look: look,
      role: role || null,
      direction: "down",
      walkPhase: 0,
      idlePhase: Math.random() * 6.28,
      x: p.x,
      y: p.y,
      path: [],
      speed: WALK_SPEED,
      phase: null, // 客の状態（BUBBLE_BY_PHASE参照）
      expression: "neutral",
      holdingIcon: null, // foodKey文字列 または "coin"
      awaitingFood: false,
      pendingProductId: null,
      timer: 0,
      pendingAction: null,
      onArrive: null,
      dishEl: null,
      bubbleEl: null,
      bubbleText: null,
      seatRef: null,
      isFixtureStaff: false,
      g: elNS("g", { id: "ent-" + id, transform: "translate(" + p.x + "," + (p.y + ENTITY_VISUAL_Y_OFFSET) + ")" }),
    };
    entitiesG.appendChild(ent.g);
    entities[id] = ent;
    redrawEntity(ent);
    return ent;
  }

  function despawnEntity(ent) {
    if (!entities[ent.id]) return;
    // バグ修正7（「二重になる」「消える」の根本原因の一つ）: 以前は客が退店を決めた
    // 瞬間（sendToRegisterThenExit/sendToExit呼び出し時）に、まだレジへ/出口へ歩いている
    // 途中であるにもかかわらず、その場で即座に席を空席扱いにしていた。すると、その直後の
    // enter_seat beatで新しい客が同じ座席へ向かわされ、まだ画面上に残っている（歩いて
    // 帰る途中の）元の客と、新しく歩いてくる客が同じ座席で鉢合わせして重なって見えたり、
    // 新しい客の絵が上に重なって描画されることで元の客が急にいなくなったように（＝消えた
    // ように）見えたりしていた。実際に画面から消える（despawnEntity）タイミングまで
    // 席を空けないようにすることで、この重複割り当てそのものを起こらなくする。
    var freedASeat = false;
    if (ent.seatRef) {
      freeSeat(ent.seatRef);
      ent.seatRef = null;
      freedASeat = true;
    }
    // 検証用フック（通常プレイでは無効。自動テストでwindow.__SCENE_DEBUG=trueのときだけ記録）
    if (window.__SCENE_DEBUG) {
      (window.__sceneDespawnLog = window.__sceneDespawnLog || []).push({
        id: ent.id, kind: ent.kind, phase: ent.phase, x: ent.x, y: ent.y,
        moving: !!(ent.path && ent.path.length), fixture: !!ent.isFixtureStaff, t: performance.now(),
      });
    }
    if (ent.g && ent.g.parentNode) ent.g.parentNode.removeChild(ent.g);
    clearDish(ent);
    clearBubble(ent);
    delete entities[ent.id];
    // 2026-09-22（レイアウト改修）新設：席が1つ空いたので、入口の外で待っている客が
    // いれば先頭から順に案内する。
    if (freedASeat) admitFromQueueIfPossible();
  }

  function iconHrefFor(key) {
    if (!key) return null;
    if (key === "coin") return Game.Data.UiAssets.coin;
    return Game.Data.FoodAssets[key] || null;
  }

  function computeAnimKind(ent) {
    var moving = ent.path && ent.path.length > 0 && !ent.blockedByLeader;
    if (ent.kind === "customer") {
      if (moving) return AnimationKind.WALK;
      // 2026-09-22（レイアウト改修）: 椅子・着席動作を廃止したため、客は常に立ったまま
      // 過ごす。食事中はSTAND_TALK（頷くような小さな動き）で「食べている」感を出す。
      if (ent.expression === "eating") return AnimationKind.STAND_TALK;
      if (ent.phase === "paying") return AnimationKind.STAND_TALK;
      if (ent.phase === "disappointed_loiter") return AnimationKind.IDLE_ALERT;
      if (ent.phase === "waiting_outside") return AnimationKind.IDLE_ALERT;
      return AnimationKind.IDLE;
    }
    // staff（cook/waiter/register fixture）
    if (moving) return ent.holdingIcon ? AnimationKind.WALK_CARRY : AnimationKind.WALK;
    if (ent.role === "cook" && ent.busyWorking) return AnimationKind.COOK;
    return AnimationKind.IDLE;
  }

  function redrawEntity(ent) {
    ent.g.innerHTML = Game.UI.ActorSprite.build(ent.look, {
      direction: ent.direction,
      animKind: computeAnimKind(ent),
      phase: ent.walkPhase,
      idlePhase: ent.idlePhase,
      holdingIconHref: iconHrefFor(ent.holdingIcon),
    });
  }

  function setPath(ent, gridPath, onArrive) {
    // バグ修正6（「消えるバグ」対応）: このentityに新しい行き先を与えるということは、
    // それ以前に予約されていた「時間待ち後に何かする」という予定（timer/pendingAction。
    // 入店演出の歩き出し遅延=begin_walk_to_seat 等）はもう無効なはず。ここでクリアせずに
    // 残しておくと、例えば「席へ歩いている途中の客に、退店（sendToExit）の新しい経路が
    // 上書きで設定された」直後に、古い方の待機タイマーが時間切れになって
    // handlePendingAction経由で古い経路（元の席へ向かう経路）へさらに上書きされてしまい、
    // 退店するはずだった客が急に向きを変えて席へ戻ろうとし、本来呼ばれるはずだった
    // 退店時のdespawn（onArriveコールバック）が失われて消えも退店もしない、といった
    // 不整合（＝見た目上は「動きがおかしくなって消える」ように見える）が起きていた。
    ent.timer = 0;
    ent.pendingAction = null;
    ent._beginWalk = null;
    ent.path = (gridPath || []).map(function (c) {
      return cellCenter(c.x, c.y);
    });
    if (ent.path.length > 0) {
      var d0 = Math.hypot(ent.path[0].x - ent.x, ent.path[0].y - ent.y);
      if (d0 < 2) ent.path.shift();
    }
    ent.onArrive = onArrive || null;
    if (ent.path.length === 0 && ent.onArrive) {
      var cb = ent.onArrive;
      ent.onArrive = null;
      cb();
    }
  }

  // 2026-09-23追加（「二重に表示」— 狭い通路での正面衝突）: 自動の日替わりで30倍速の
  // 早送りをやめ、客の出入りを通常速度で見せるようになったことで、「店に入ってくる客」と
  // 「帰る客（レジ・出口へ向かう客）」が1マス幅の通路で向かい合ってすれ違う（＝重なって
  // 見える）場面が目に見えるようになった（以前は早送りで1フレームで通り過ぎていたため
  // 目立たず、自動検出にもかからなかった）。1マス幅の通路では、どちらかが立ち止まっても
  // もう片方がその上を通るしかないため、「歩き出す前に」判定する：これから歩く経路を、
  // 逆向きに歩いてくる客が今まさに通っている場合は、その客が通り過ぎるまで歩き出さない。
  // 待っている客は「歩いている客」として扱われないので、互いに待ち合って固まることはない。
  var HEADON_RETRY_MS = 120;
  var HEADON_MAX_WAIT_MS = 12000; // 安全弁（ゲーム内時間）。入店時はゆっくり歩く（ENTRANCE_WALK_SPEED）ので長めに取る

  function cellKeyOf(c) {
    return c.x + "," + c.y;
  }

  // pathCells（グリッドのマス配列、先頭が現在地）を、逆向きに歩いている他の客がいるか。
  function hasOpposingTraffic(ent, pathCells) {
    if (!pathCells || pathCells.length < 2) return false;
    var myIdx = {};
    pathCells.forEach(function (c, i) {
      myIdx[cellKeyOf(c)] = i;
    });
    for (var id in entities) {
      var o = entities[id];
      if (o === ent || o.kind !== "customer" || o.hiddenAtDoor || !o.path || o.path.length === 0) continue;
      var q = [nearestCell(o.x, o.y)].concat(
        o.path.map(function (p) {
          return nearestCell(p.x, p.y);
        })
      );
      var prev = -1;
      for (var i = 0; i < q.length; i++) {
        var idx = myIdx[cellKeyOf(q[i])];
        if (idx === undefined) continue;
        if (prev !== -1 && idx < prev) return true; // 相手は自分の経路を逆向きにたどっている
        prev = idx;
      }
    }
    return false;
  }

  // 逆向きの客が通り過ぎるのを待ってから、経路を歩き始める（客専用）。
  function walkWhenClear(ent, pathCells, onArrive, waitedMs) {
    waitedMs = waitedMs || 0;
    if (!entities[ent.id]) return;
    if (waitedMs < HEADON_MAX_WAIT_MS && hasOpposingTraffic(ent, pathCells)) {
      ent.timer = HEADON_RETRY_MS;
      ent.pendingAction = "retry_walk";
      ent._retryWalk = function () {
        walkWhenClear(ent, pathCells, onArrive, waitedMs + HEADON_RETRY_MS);
      };
      return;
    }
    ent._retryWalk = null;
    setPath(ent, pathCells, onArrive);
  }

  function directionFromDelta(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "down" : "up";
  }

  // 現在誰かが座っている席のマスかどうか（tables[].seats[].occupied）。
  function isSeatOccupied(x, y) {
    for (var i = 0; i < tables.length; i++) {
      var seats = tables[i].seats;
      for (var j = 0; j < seats.length; j++) {
        if (seats[j].occupied && seats[j].x === x && seats[j].y === y) return true;
      }
    }
    return false;
  }

  // バグ修正13（「二重になる」バグの追加の真因 — 着席中の客の真上を経路が突っ切る）:
  // 経路探索（Game.Core.Pathfind.findPath）はlayout.jsの静的な歩行可否（什器・壁）しか
  // 見ておらず、「今まさに誰かが座っている椅子」という動的な状態を一切考慮していなかった。
  // Layout.seatsForTableは各テーブルに隣接する歩行可能マスをそのまま座席にするため、
  // 同じテーブルの席同士でも必ず別々のマス（中心間で64px以上）に離れて配置される。
  // つまり本来、客同士が数px〜20px程度まで接近することは経路上あり得ないはずだった。
  // 実際にPlaywrightで1週間分プレイしながら客同士の座標を継続的に記録したところ、
  // 最小2px（スプライトの見た目の幅は約45px）まで重なる事象が複数回発生し、その大半が
  // 「片方は着席済み（sitting:true・停止中）、もう片方はその真横〜真上を歩行中」という
  // 組み合わせだった。原因は、ある客が自分の席へ向かう経路や、会計・退店で出口へ向かう
  // 経路が、たまたま「既に別の客が座っている席のマス」を素通りする最短経路になっている場合、
  // その真上をそのまま歩いて通過してしまうこと。バグ修正4・10・11は入口付近の演出だけを
  // 対象にしており、この「経路が着席客の椅子を突っ切る」経路探索側の問題には対応していな
  // かった。
  // 対処：経路探索に使う歩行可否判定に、「現在誰かが座っている席のマスは、目的地で
  // ない限り通行不可」という動的な制約を追加する（目的地の場合はfindPath側の仕様で
  // 自動的に通行可能扱いになるため特別扱いは不要）。混雑等でこの制約下では経路が
  // 見つからない場合（詰んで動けなくなる方が問題が大きいため）は、この制約なしの
  // 経路にフォールバックする。
  function pathBetween(fromCell, toCell) {
    var avoidSeatsFn = function (x, y) {
      return walkableFn(x, y) && !isSeatOccupied(x, y);
    };
    var path = Game.Core.Pathfind.findPath(fromCell.x, fromCell.y, toCell.x, toCell.y, avoidSeatsFn, layout.cols, layout.rows);
    if (!path) {
      path = Game.Core.Pathfind.findPath(fromCell.x, fromCell.y, toCell.x, toCell.y, walkableFn, layout.cols, layout.rows);
    }
    return path || [toCell];
  }

  // ================= スタッフプール（コック／ウェイター、人数は実際の雇用状況に対応） =================
  function setupStaffPools() {
    kitchenStaffPool = [];
    waiterStaffPool = [];
    var s = Game.App.state;

    var cooks = s.staff.filter(function (st) {
      return st.role === "cooking" && st.workDays > 0;
    });
    if (cooks.length === 0) cooks = [{ id: "ghost_cook" }];
    var cookPositions = distinctPositions(cookHomePool, cooks.length);
    cooks.forEach(function (st, idx) {
      var pos = cookPositions[idx];
      var home = { x: pos.x, y: pos.y };
      var look = Game.Data.CharacterAssets.staffLooks.cook;
      var ent = spawnEntity("staff", look, home, "cook");
      ent.isFixtureStaff = true;
      var poolEntry = { staffId: st.id, busy: false, entity: ent, home: home, jitter: pos.jitter };
      snapToHome(poolEntry);
      redrawEntity(ent);
      kitchenStaffPool.push(poolEntry);
    });

    var waiters = s.staff.filter(function (st) {
      return st.role === "service" && st.workDays > 0;
    });
    if (waiters.length === 0) {
      var fallback = s.staff.filter(function (st) {
        return st.workDays > 0;
      })[0];
      waiters = fallback ? [fallback] : [{ id: "ghost_waiter" }];
    }
    var waiterPositions = distinctPositions(waiterHomePool, waiters.length);
    waiters.forEach(function (st, idx) {
      var pos = waiterPositions[idx];
      var home = { x: pos.x, y: pos.y };
      var look = Game.Data.CharacterAssets.staffLooks.waiter;
      var ent = spawnEntity("staff", look, home, "waiter");
      ent.isFixtureStaff = true;
      var poolEntry = { staffId: st.id, busy: false, entity: ent, home: home, jitter: pos.jitter };
      snapToHome(poolEntry);
      redrawEntity(ent);
      waiterStaffPool.push(poolEntry);
    });
  }

  function findFreeCook() {
    return kitchenStaffPool.find(function (c) {
      return !c.busy;
    });
  }
  function findFreeWaiter() {
    return waiterStaffPool.find(function (c) {
      return !c.busy;
    });
  }

  // ================= 席の管理 =================
  function tryFreeSeatsForParty(size) {
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var free = t.seats.filter(function (s) {
        return !s.occupied;
      });
      if (free.length >= size) {
        return { table: t, seats: free.slice(0, size) };
      }
    }
    return null;
  }
  function occupySeats(seats) {
    seats.forEach(function (s) {
      s.occupied = true;
    });
  }
  function freeSeat(seat) {
    if (seat) seat.occupied = false;
  }
  function freeAllSeats() {
    tables.forEach(function (t) {
      t.seats.forEach(function (s) {
        s.occupied = false;
      });
    });
  }

  function pickAnyProduct() {
    var s = Game.App.state;
    return s.products[Math.floor(Math.random() * s.products.length)].id;
  }
  function foodKeyForProduct(productId) {
    var stateProduct = Game.App.state.products.find(function (p) {
      return p.id === productId;
    });
    if (stateProduct && stateProduct.foodKey) return stateProduct.foodKey;
    var def = Game.Data.getProductDef && Game.Data.getProductDef(productId);
    if (def && def.foodKey) return def.foodKey;
    return PRODUCT_TO_FOODKEY_FALLBACK[productId] || "ramen";
  }

  // ================= 吹き出し・皿・会計ポップアップ =================
  function setBubble(ent, text) {
    if (ent.bubbleText === text) return; // 変化が無ければ何もしない（毎フレーム作り直さない）
    clearBubble(ent);
    ent.bubbleText = text;
    if (!text) return;
    var icon = elNS("text", { x: 0, y: -CELL * 0.62, "font-size": 13, "text-anchor": "middle" });
    icon.textContent = text;
    var wrap = elNS("g", { transform: "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")" });
    wrap.appendChild(icon);
    bubblesG.appendChild(wrap);
    ent.bubbleEl = wrap;
  }
  function clearBubble(ent) {
    if (ent.bubbleEl && ent.bubbleEl.parentNode) ent.bubbleEl.parentNode.removeChild(ent.bubbleEl);
    ent.bubbleEl = null;
    ent.bubbleText = null;
  }

  function showDish(customerEnt) {
    clearDish(customerEnt);
    var href = iconHrefFor(foodKeyForProduct(customerEnt.pendingProductId));
    if (!href) return;
    var img = elNS("image", { href: href, x: -10, y: -10, width: 20, height: 20 });
    var wrap = elNS("g", { transform: "translate(" + customerEnt.x + "," + (customerEnt.y + ENTITY_VISUAL_Y_OFFSET - CELL * 0.32) + ")" });
    wrap.appendChild(img);
    bubblesG.appendChild(wrap);
    customerEnt.dishEl = wrap;
  }
  function clearDish(ent) {
    if (ent.dishEl && ent.dishEl.parentNode) ent.dishEl.parentNode.removeChild(ent.dishEl);
    ent.dishEl = null;
  }

  function showPaymentPopup(customerEnt) {
    var s = Game.App.state;
    var product = s.products.find(function (p) {
      return p.id === customerEnt.pendingProductId;
    });
    var price = product ? product.currentPrice : 800;
    var text = "¥" + Math.round(price).toLocaleString("ja-JP");
    var textEl = elNS("text", {
      x: 0, y: 0, "font-size": 15, "font-weight": "bold", "text-anchor": "middle",
      fill: "#2e7d32", stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke",
    });
    textEl.textContent = text;
    var startX = registerPoint.x,
      startY = registerPoint.y - CELL * 0.55;
    var wrap = elNS("g", { transform: "translate(" + startX + "," + startY + ")" });
    wrap.appendChild(textEl);
    popupsG.appendChild(wrap);
    moneyPopups.push({ x: startX, y: startY, wrap: wrap, age: 0, life: 1100 });
  }

  function updateMoneyPopups(dt) {
    for (var i = moneyPopups.length - 1; i >= 0; i--) {
      var p = moneyPopups[i];
      p.age += dt * 1000;
      var t = Math.min(1, p.age / p.life);
      p.wrap.setAttribute("transform", "translate(" + p.x + "," + (p.y - t * 26) + ")");
      p.wrap.setAttribute("opacity", 1 - t);
      if (p.age >= p.life) {
        if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
        moneyPopups.splice(i, 1);
      }
    }
  }

  // ================= 客の退店動線 =================
  // バグ修正14（「二重になる」バグの3つ目の真因 — レジ待ちの客にentranceJitter相当の
  // ずらしが一切無かった）: 入口(entrance)にはentranceJitter()による見た目の位置ずらしが
  // あるが、レジ(registerPoint)で会計を待つ間（PAY_TIME=450ms）の客の位置には、そもそも
  // ずらす仕組み自体が存在せず、常にregisterPointのピクセル座標そのものに固定していた。
  // レジは1マスしかない単一の待ち位置のため、会計のタイミングが重なる2人以上の客が
  // 存在すると、その間は完全に同じピクセル（誤差0px）に重なって表示されてしまっていた
  // （実際にPlaywrightでdist=0pxの重なりを複数回確認した）。entranceJitter()と同じ
  // 黄金角オフセット方式でレジ待ち位置をずらす。
  var registerSpawnSeq = 0;
  function registerJitter() {
    var GOLDEN_ANGLE = 137.5;
    var n = registerSpawnSeq++;
    var angle = n * GOLDEN_ANGLE * (Math.PI / 180);
    var radius = 10 + (n % 3) * 8; // レジ周りは入口より狭いスペースなので半径は控えめ（10/18/26px）
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  }

  function sendToRegisterThenExit(customerEnt) {
    // バグ修正7: 席はまだここで空けない（despawnEntityで実際に画面から消える時に空ける）。
    // レジへ・出口へと歩いている間も「その席はこの客がまだ使用中」として扱うことで、
    // 新しい客が同じ席へ向かい、まだ帰り支度中の客と鉢合わせ／重なって見えるのを防ぐ。
    customerEnt.expression = "happy";
    var startCell = nearestCell(customerEnt.x, customerEnt.y);
    var path = pathBetween(startCell, registerPoint);
    customerEnt.phase = "paying";
    walkWhenClear(customerEnt, path, function () {
      var jitter = registerJitter();
      customerEnt.x = registerPoint.x + jitter.dx;
      customerEnt.y = registerPoint.y + jitter.dy;
      customerEnt.g.setAttribute("transform", "translate(" + customerEnt.x + "," + (customerEnt.y + ENTITY_VISUAL_Y_OFFSET) + ")");
      customerEnt.timer = PAY_TIME;
      customerEnt.pendingAction = "pay_done";
    });
  }

  // バグ修正15（「二重になる」バグの4つ目の真因 — 出口も入口と同じ1マスの
  // ボトルネックなのに、退店側にだけ間隔調整が一切無かった）: entrance（入口）は
  // 来店時にはentranceJitter()＋scheduleEntranceWalk()で位置・タイミング両方を
  // ずらしていたが、Game.Data.FIXED_ENTRANCEは退店時の出口としても同じ1マスを
  // 共有しており、そちらには何のずらしも無かった。EAT_TIME・PAY_TIME等はどの客も
  // 同じ固定値のため、同じbeatでまとめて入店した客同士は食事や会計を終えるタイミングも
  // 揃いやすく、結果として複数人がほぼ同時に同じ1マスの出口へ向かって歩き出し、
  // すれ違いざまに重なって見えていた。入店時と同じ「入口（＝出口）から実際に歩き出す
  // 最後の時刻」をグローバルに管理するscheduleEntranceWalk()を、退店時にも共用する
  // （入店・退店はどちらも同じ1マスを使う以上、同じ間隔予約の対象にするのが妥当）。
  function sendToExit(customerEnt, speedBoost) {
    // バグ修正7: sendToRegisterThenExitと同様、席はここでは空けない
    // （despawnEntityで実際に画面から消える時に空ける）。
    // バグ修正19：まだ入口の外に並んでいて店内に姿を見せていない客は、そのまま帰らせる
    // （中に入れてから引き返させると、入口で他の客と重なる原因になる）。
    if (customerEnt.hiddenAtDoor) {
      removeFromDoorQueue(customerEnt);
      despawnEntity(customerEnt);
      return;
    }
    customerEnt.exitingToDoor = true;
    customerEnt.speed = speedBoost ? WALK_SPEED * ANGRY_SPEED_MULT : WALK_SPEED;
    var startCell = nearestCell(customerEnt.x, customerEnt.y);
    var path = pathBetween(startCell, entrance);
    var beginWalk = function () {
      walkWhenClear(customerEnt, path, function () {
        despawnEntity(customerEnt);
      });
    };
    scheduleEntranceWalk(customerEnt, "begin_walk_to_exit", beginWalk);
  }

  // 入口でのjitter位置を毎回ずらすための通し番号。1つのbeatだけでなく、beatをまたいで
  // 単調増加させる（＝ゲーム内の「入口に現れた客」何人目か、というグローバルな連番）。
  var entranceSpawnSeq = 0;

  // entrance周辺で複数人が重ならないよう、待機中の客ごとに確実に離れた位置を割り当てる。
  function entranceJitter() {
    // バグ修正10（「二重になる」の再修正 — スクリーンショットで実際に入口で2人の客が
    // ほぼ完全に重なって表示されるのを確認した上での対応）: バグ修正6までのentranceJitter
    // は「毎回、完全に独立したランダムな角度・半径（最大でも9px程度）」でオフセットを
    // 決めていた。これには2つの弱点があった。
    // 1. 独立ランダムである以上、たまたま2人以上のオフセットが偶然近い値になる
    //    （＝入口でほぼ真上に重なる）確率がゼロではなく、実際にスクリーンショット上で
    //    複数回確認された。
    // 2. 半径が最大9px程度しかなく、これはキャラクタースプライトの見た目の幅
    //    （ANCHOR/DISPLAY_SCALEから逆算すると約45px）よりずっと小さいため、たとえ
    //    「重ならない」オフセットが選ばれても視覚的にはほぼ重なって見えていた。
    // さらに、staggerIndexはenter_seat beat 1件ごとに0から数え直される値だったため、
    // 倍速時などbeatの間隔（130ms）がENTER_STAGGER_MS（260ms）より短くなる場面では、
    // 「別々のbeat由来の、それぞれのstaggerIndex=0の客」同士がまったく無関係な
    // オフセット計算をしてしまい、たまたま入口の同じあたりに居合わせることがあった。
    // 対処：beatをまたいで単調増加する通し番号（entranceSpawnSeq）を使い、黄金角で
    // 位置を割り振る（同ロールのスタッフ待機位置で使っているdistinctPositionsと同じ
    // 考え方）。これにより「今まさに入口付近で待っている・歩き出したばかりの客」同士は、
    // どのbeat由来であっても必ず異なる角度に割り振られ、半径も見た目の大きさに対して
    // 十分な値（14〜28px、3段階）に拡大した。
    // 実際にPlaywrightでスクリーンショットを撮って確認したところ、半径14〜28px・3段階では
    // まだキャラクターの見た目の幅（約45px）に対して不十分で、ANIM_CAP_ENTER=4（1beatで
    // 同時に表示されうる客の上限）に近い人数が本当に同時に入口で待つ場面（週明け最初の
    // 「一斉来店」等）では、隣り合うオフセット同士がまだ軽く触れ合って見えることがあった。
    // 4段階（ANIM_CAP_ENTERと同数）の半径×黄金角で、隣接する通し番号同士の距離が
    // 常に45px以上（＝スプライト幅以上）になるよう調整した（実測・計算で確認済み）。
    //
    // バグ修正16（「二重になる」バグの5つ目の真因 — 黄金角方式は「隣接」する通し番号
    // 同士の距離しか保証していなかった）: バグ修正11（scheduleEntranceWalkによる
    // 歩き出しタイミングのグローバルな間隔保証）を入れた後も、Playwrightでの1週間分の
    // 自動プレイでなお「walking_to_seat同士の接近」が60件前後、改善せずに残り続けた。
    // 詳しく調べると、そのほとんどは「片方はまだ自分の番のタイマー待ちで静止中
    // （entranceJitter位置に立ったまま）、もう片方がその近くを歩いて通過中」という
    // 組み合わせだった。原因を数値計算で検証したところ、黄金角（137.5°）×4段階半径
    // という方式は、通し番号が1つ違い（隣接）のペアの距離は約39〜45px確保できていたが、
    // それ以外の差（2つ違い・3つ違い…8つ違い等）のペアでは全く距離が保証されておらず、
    // 最悪ケースでは実測で約5.6pxまで接近してしまうことが分かった（黄金角は「無限に
    // 続く列全体をまんべんなく散らす」ことは得意だが、「今まさに近くにいる数人全員が
    // 互いに離れている」ことは保証しない）。バグ修正10のコメントにある「常に45px以上」
    // という認識自体が誤りだった。
    // 対処：正六角形の頂点（60°間隔・半径45px）を通し番号のmod 6で順番に割り当てる
    // 方式に変更する。半径45pxの正六角形は「隣り合う頂点同士の距離」が幾何学的に
    // ちょうど半径と同じ45pxになり、かつ頂点間の角度が開くほど距離は単調に伸びる
    // （最も遠い対角は90px）。そのため、同時に存在しうる6人以内であれば、どの2人の
    // 組み合わせを取っても必ず45px以上離れる。7人目以降が同時に存在する稀なケースの
    // ためには、半径を1段ずつ広げた外側の六角形（6人ごとに+40px、角度も半スロット分
    // ずらして内側と重ならないようにする）に逃がす。実際に計算スクリプトで、直近24件
    // という現実的にあり得る範囲のどの組み合わせでも45px以上を確保できることを確認した
    // （黄金角方式のときの5.6pxから改善）。
    var SLOTS = 6;
    var BASE_RADIUS = 45;
    var RING_STEP = 40;
    var n = entranceSpawnSeq++;
    var ring = Math.floor(n / SLOTS);
    var slot = n % SLOTS;
    var angle = (slot / SLOTS) * 2 * Math.PI + ring * (Math.PI / SLOTS);
    var radius = BASE_RADIUS + ring * RING_STEP;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  }

  // バグ修正11（「二重になる」バグの真因対応 — バグ修正4・10の抜け穴）:
  // これまでのENTER_STAGGER_MSによる歩き出し遅延は、spawnCustomerToSeatBeat/
  // spawnDisappointedの呼び出し元（handleEnterSeat/handleLeaveDisappointed）が
  // 1回のbeat処理の中だけで数える「staggerIndex」（0始まり）を基準にしていた。
  // このため「同じbeat内の2人目以降」は確実に間隔が空く一方、「別々のbeatに由来する
  // 客同士」（例：enter_seat beatの1人目と、950ms/倍速時130ms後の次のenter_seat beatの
  // 1人目。どちらもstaggerIndex=0）は互いに一切ずらされず、まったく同時に入口から
  // 歩き出すことになっていた。
  // さらに、pathBetween(entrance, seat)が返す経路の先頭セル（path[0]）は常に入口セル
  // そのもの（pathfind.jsのfindPathはstartセルを含めて返す）であり、setPath()内の
  // 「既にそこにいるなら先頭セルを読み飛ばす」判定はentranceJitter()による見た目上の
  // オフセット（16〜46px）よりも小さい距離（2px未満）でしか働かないため、常に成立しない。
  // つまり全ての客は、entranceJitter()でどれだけ離れた位置に立っていても、歩き出した
  // 瞬間の最初の目標地点が「入口セルの中心という全く同じ1点」になる。
  // 実際にPlaywrightで1週間分のプレイを自動実行し、歩行中の客同士の座標を継続的に記録
  // したところ、連続して生成された客同士が最小6〜13px（スプライトの見た目の幅は約45px）
  // まで接近して歩き続ける事象が複数回発生し、スクリーンショットでも2人の客がほぼ完全に
  // 重なって表示されることを確認した。これがentranceJitter()の再設計（バグ修正10）だけでは
  // 「2重になる」バグが直らなかった理由である（バグ修正10は静止中の見た目の重なりしか
  // 対応しておらず、歩行中に別々のbeat由来の客同士が収束してしまう経路は未対応だった）。
  //
  // 対処：staggerIndexという「1beatの中だけの相対順序」ではなく、entranceSpawnSeqと
  // 同様に「入口から実際に歩き出した最後の時刻」をbeatをまたいだゲーム内時間
  // （simClockMs）でグローバルに管理し、次に歩き出す客は必ずそこからENTER_STAGGER_MS
  // 以上間隔を空けてから歩き出すよう予約する。どのbeat由来であっても、入口から歩き出す
  // タイミングそのものが確実にずれるため、経路の先頭が同じ1点であっても、そこを
  // 同時に通過することがなくなる。
  var lastEntranceWalkStartMs = -Infinity;

  // バグ修正19（「二重に表示」のロジック側の原因・入口編）: バグ修正10・16で入口の周りに
  // 正六角形状に客を立たせて順番を待たせていたが、毎フレームの座標記録による自動検出で、
  // (1) 六角形の頂点の一部がちょうど入口の通路（入口の行・列）の上にあり、歩き出した客が
  //     そこで待っている客の上を素通りして重なる、
  // (2) 入口中心より奥側に立たされた客は、歩き出すとまず入口中心へ「逆戻り」するため、
  //     先に歩き出した客と正面からすれ違って重なる、
  // という2つが、1週間で30組前後の重なりの大半を占めていることが分かった。
  // 対処：まだ店に入っていない客は、入口の外（画面には出さない）で1列に並ばせ、
  // 「前の客が歩き出してからENTER_STAGGER_MS以上経過」かつ「入口のすぐ内側に他の客が
  // いない（出口へ向かってくる客も近くにいない）」ときにだけ、1人ずつ入口中心に姿を
  // 現して歩き出させる。これで入口付近で客同士が重なる状況そのものが無くなる。
  // （客のentity自体は入店のbeat時点で作るので、配膳・離脱のbeatの対象プールには
  // 今まで通り即座に含まれる＝バグ修正17の前提は崩さない。）
  var doorQueue = []; // {ent, beginWalk}

  function entrancePixel() {
    return cellCenter(entrance.x, entrance.y);
  }

  // pathCells（省略可）: 入口から歩く予定の経路。逆向きに歩いてくる客がいる間は入れない
  // （hasOpposingTraffic参照。2026-09-23追加）。
  function enqueueAtDoor(ent, beginWalk, pathCells) {
    var ep = entrancePixel();
    ent.x = ep.x;
    ent.y = ep.y;
    ent.hiddenAtDoor = true;
    ent.g.setAttribute("visibility", "hidden");
    ent.g.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")");
    doorQueue.push({ ent: ent, beginWalk: beginWalk, path: pathCells || null, blockedSinceMs: null });
  }

  function removeFromDoorQueue(ent) {
    doorQueue = doorQueue.filter(function (q) {
      return q.ent !== ent;
    });
    ent.hiddenAtDoor = false;
  }

  function doorIsClear() {
    var ep = entrancePixel();
    for (var id in entities) {
      var o = entities[id];
      if (o.kind !== "customer" || o.hiddenAtDoor) continue;
      var d = Math.hypot(o.x - ep.x, o.y - ep.y);
      if (d < FOLLOW_MIN_SEP + 8) return false;
      // 出口（＝入口）へ向かって歩いてくる客がすぐ近くにいる間は入れない（入口ですれ違って重なるのを防ぐ）
      if (o.exitingToDoor && o.path && o.path.length > 0 && d < CELL * 2.2) return false;
    }
    return true;
  }

  function processDoorQueue() {
    while (doorQueue.length > 0) {
      var head = doorQueue[0];
      if (!entities[head.ent.id]) {
        doorQueue.shift(); // 入る前に帰ってしまった客（sendToExit参照）
        continue;
      }
      if (simClockMs < lastEntranceWalkStartMs + ENTER_STAGGER_MS) return;
      if (!doorIsClear()) return;
      if (head.path && hasOpposingTraffic(head.ent, head.path)) {
        if (head.blockedSinceMs === null) head.blockedSinceMs = simClockMs;
        if (simClockMs - head.blockedSinceMs < HEADON_MAX_WAIT_MS) return;
      }
      doorQueue.shift();
      lastEntranceWalkStartMs = simClockMs;
      head.ent.hiddenAtDoor = false;
      head.ent.g.removeAttribute("visibility");
      head.beginWalk();
      return; // 1フレームに1人だけ入れる
    }
  }

  function scheduleEntranceWalk(ent, pendingActionName, beginWalk) {
    var earliest = Math.max(simClockMs, lastEntranceWalkStartMs + ENTER_STAGGER_MS);
    var delay = earliest - simClockMs;
    lastEntranceWalkStartMs = earliest;
    if (delay > 0) {
      ent.timer = delay;
      ent.pendingAction = pendingActionName;
      ent._beginWalk = beginWalk;
    } else {
      beginWalk();
    }
  }

  // ================= 客の入店・着席（enter_seat beat） =================
  // 客が実際に席に到着した時に呼ぶ共通処理（新規入店・待機列からの案内の両方で使う）。
  // 2026-09-22（レイアウト改修）: 椅子・着席動作を廃止したため、テーブルの前に立ったまま
  // 過ごす（c.sittingは廃止）。
  function settleAtTable(c, tableCenterCell) {
    var tc = cellCenter(tableCenterCell.x, tableCenterCell.y);
    c.direction = directionFromDelta(tc.x - c.x, tc.y - c.y);
    c.expression = "bored";
    // バグ修正6: 入店演出の遅延（ENTER_STAGGER_MS）待ちの間に、経済シミュレーション側は
    // 既にこの客への配膳(serve_batch)を進めてしまっている場合がある（beatの間隔は
    // 見た目の遅延より短いことがあるため）。その場合c.phaseは既に"cooking_wait"等へ
    // 進んでいるので、ここで無条件に"awaiting_food"へ巻き戻すと、実際には調理が
    // 始まっている（またはもう届いている）のに吹き出しだけ⏳に逆戻りして見えてしまう。
    // まだ誰も進めていない（＝spawn直後のまま）場合にだけ初期状態にする。
    if (c.phase === "walking_to_seat") c.phase = "awaiting_food";
    // 着席後は「ゆっくり動かす箇所」を抜けるので、以後の動き（退店等）は通常速度に戻す。
    c.speed = WALK_SPEED;
    // バグ修正20の安全弁：ウェイターが待ちきれずに料理を置いていった場合、着いた瞬間に食べ始める
    if (c.deliverOnArrive) {
      c.deliverOnArrive = false;
      c.phase = "eating";
      c.timer = LOOK_TIME;
      c.pendingAction = "start_eating";
      showDish(c);
    }
    redrawEntity(c);
  }

  // 入口から歩き出すタイミングの間隔は、呼び出し元のbeat単位ではなく
  // scheduleEntranceWalk()がbeatをまたいでグローバルに保証する（バグ修正11）。
  function spawnCustomerToSeatBeat(seat, tableCenterCell, productId) {
    var look = Game.Data.CharacterAssets.randomLook("cust_" + entitySeq + "_" + Date.now());
    var c = spawnEntity("customer", look, entrance, null);
    c.seatRef = seat;
    c.awaitingFood = true;
    c.pendingProductId = productId || pickAnyProduct();
    c.phase = "walking_to_seat";
    c.speed = ENTRANCE_WALK_SPEED; // 入店直後はゆっくり歩かせる
    var path = pathBetween(entrance, seat);
    var beginWalk = function () {
      setPath(c, path, function () {
        settleAtTable(c, tableCenterCell);
      });
    };
    enqueueAtDoor(c, beginWalk, path); // バグ修正19：入口の外で1列に並び、入口が空いたら1人ずつ入る
  }

  // ================= 満席時の待機列（入口の外で待つ客） =================
  // 2026-09-22新設：「入口の外に何人待っているかわかる状態にして」への対応。
  // 物理的な空席がない場合、これまでは表示上あきらめて何も表示していなかった
  // （数値上の来客数はbeatのテキストが正しく示すため実害はなかったが、見た目に何も
  // 出ないのは要望に反する）。実際に入口付近に客を立たせて待たせ、席が空き次第
  // 先頭から順に案内する。

  // 待機列の立ち位置（正六角形の頂点。entranceJitter()のバグ修正10・16と全く同じ考え方・
  // 半径（45px＝キャラクター見た目の幅）で、隣り合う待機客同士が重ならないようにする）。
  function outsideWaitJitter() {
    var SLOTS = 6;
    var BASE_RADIUS = 45;
    var RING_STEP = 40;
    var n = outsideWaitSpawnSeq++;
    var ring = Math.floor(n / SLOTS);
    var slot = n % SLOTS;
    var angle = (slot / SLOTS) * 2 * Math.PI + ring * (Math.PI / SLOTS);
    var radius = BASE_RADIUS + ring * RING_STEP;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.6 };
  }

  function updateQueueBadge() {
    if (!queueBadgeEl) return;
    var n = outsideQueue.length + outsideOverflowCount;
    queueBadgeEl.setAttribute("opacity", n > 0 ? 1 : 0);
    var txt = queueBadgeEl.querySelector ? queueBadgeEl.querySelector("#outside-queue-badge-text") : null;
    if (txt) txt.textContent = "待ち " + n + "人";
  }

  // バグ修正17（席待ちの客が永久に取り残される不具合）: 経済シミュレーション側
  // （simulation.js）は物理的な座席上限という概念を一切持たず、「enter_seatで入店した
  // 客は全員、いずれserve_batch（提供）かleave_waiting_batch（待ちきれず離脱）の
  // どちらかで必ず1回だけ処理され尽くす」という前提でbeatを生成している。serve_batch/
  // leave_waiting_batchのどちらも、scene.js側では「今awaitingFood===trueな客」の集合
  // （awaitingCustomers()）から先着順に対象を選ぶだけで、経済シミュレーション側の
  // どの客が本来どのbeatに対応するかは一切追跡していない（＝客同士は完全に互換扱い）。
  // 当初の実装では、入口の外で待っている間（phase==="waiting_outside"）はawaitingFood
  // をfalseのままにしていた。しかし実際の座席が空くまでの待ち時間は、経済シミュレーション
  // 側が「この客はもう提供済み／離脱済み」として扱うタイミングとは非同期であるため、
  // 本来この客に対応するはずのserve_batch/leave_waiting_batchが、待っている間に
  // 「その時点でたまたまawaitingFood===trueだった別の客」に先に消費されてしまうことが
  // あった。その結果、1日のうちに発行されるserve_batch/leave_waiting_batchの総数を
  // 使い切った後で入口の外の客がようやく着席しても、もう対応するbeatが1つも残っておらず、
  // その客は「⏳待機中」のまま一生食事にありつけず、画面から消えなくなっていた
  // （＝日をまたぐ際の「客がいなくなるまで待つ」処理が終わらず、次の日へ進めなくなる
  // 重大な不具合。実機のPlaywright検証で、日替わりのたびに約15秒のタイムアウトに
  // 毎回ひっかかっていることを確認した）。
  // 対処：入口の外で待っている間もawaitingFood/pendingProductIdは即座に確定させる
  // （＝経済シミュレーション側の前提を満たす）。まだ着席していない客がserve_batch/
  // leave_waiting_batchの対象に選ばれた場合、ウェイターは現在地（＝待機列の立ち位置）
  // まで届けにいく（dispatchWaiterJob/handleLeaveWaitingBatchは元々
  // job.customer.seatRef===nullなら現在地に届ける実装だったため、そのまま機能する）。
  // 席が空いた時の案内（admitFromQueueIfPossible）は、その客がまだ
  // phase==="waiting_outside"のまま（＝まだ給仕も離脱処理もされていない）の場合にだけ
  // 実際にテーブルへ案内する。既に給仕／離脱の処理が進んでいた場合は、その空席は
  // 使わずキューの次の客に譲る（whileループが続く限り再チャレンジされる）。

  // 見た目の待機列がMAX_OUTSIDE_VISIBLEを超える場合は、それ以上スプライトを増やさず
  // バッジの人数だけに数える（画面が客だらけで見づらくなるのを防ぐため）。
  function enqueueOutside(productId) {
    if (outsideQueue.length >= MAX_OUTSIDE_VISIBLE) {
      outsideOverflowCount++;
      updateQueueBadge();
      return;
    }
    var look = Game.Data.CharacterAssets.randomLook("wait_" + entitySeq + "_" + Date.now());
    var c = spawnEntity("customer", look, entrance, null);
    var jitter = outsideWaitJitter();
    c.x = outsideQueueAnchor.x + jitter.dx;
    c.y = outsideQueueAnchor.y + jitter.dy;
    c.g.setAttribute("transform", "translate(" + c.x + "," + (c.y + ENTITY_VISUAL_Y_OFFSET) + ")");
    c.direction = "down";
    c.phase = "waiting_outside";
    c.pendingProductId = productId || pickAnyProduct();
    c.awaitingFood = true; // バグ修正17参照：席が無くても給仕対象プールには即座に加える
    redrawEntity(c);
    outsideQueue.push({ ent: c, productId: c.pendingProductId });
    updateQueueBadge();
  }

  // 席が空くたびに呼ぶ：待機列の先頭客がいれば、その空席へ案内する。
  // 見た目上限で弾かれていた分（outsideOverflowCount）があれば、空いた列の枠に
  // 新しい客を1人立たせて補充する。
  function admitFromQueueIfPossible() {
    while (outsideQueue.length > 0) {
      var assignment = tryFreeSeatsForParty(1);
      if (!assignment) break;
      var waiting = outsideQueue.shift();
      if (outsideOverflowCount > 0) {
        outsideOverflowCount--;
        enqueueOutside(pickAnyProduct());
      }
      updateQueueBadge();
      var c = waiting.ent;
      // バグ修正17参照：待っている間に給仕／離脱処理が先に進んでいた場合、その客は
      // もう待機列の立ち位置から動き始めているか、既に画面から消えている。無理に
      // テーブルへ歩かせ直すと状態が壊れるため、その場合はこの空席を使わず次の候補へ。
      if (!entities[c.id] || c.phase !== "waiting_outside") continue;
      occupySeats(assignment.seats);
      seatExistingCustomer(c, assignment.seats[0], assignment.table);
    }
  }

  // 既に画面上にいる客（待機列にいた客）を、指定の席まで歩かせて座らせる。
  function seatExistingCustomer(c, seat, tableCenterCell) {
    c.seatRef = seat;
    c.awaitingFood = true;
    c.phase = "walking_to_seat";
    c.speed = ENTRANCE_WALK_SPEED; // 外待ち列からの案内もゆっくり歩かせる
    var startCell = nearestCell(c.x, c.y);
    var path = pathBetween(startCell, seat);
    walkWhenClear(c, path, function () {
      settleAtTable(c, tableCenterCell);
    });
  }

  function spawnDisappointed() {
    var look = Game.Data.CharacterAssets.randomLook("gone_" + entitySeq + "_" + Date.now());
    var c = spawnEntity("customer", look, entrance, null);
    c.expression = "angry";
    c.phase = "walking_to_seat"; // 👀のまま少し歩く演出を流用
    var path = pathBetween(entrance, loiterPoint);
    var beginWalk = function () {
      setPath(c, path, function () {
        c.phase = "disappointed_loiter";
        c.timer = 650;
        c.pendingAction = "leave_from_loiter";
      });
    };
    enqueueAtDoor(c, beginWalk); // バグ修正19：入口が空いてから1人ずつ入る
  }

  // ================= 厨房 → カウンター → ウェイター の2段階受け渡し =================
  function processKitchen() {
    while (kitchenJobQueue.length > 0) {
      var cook = findFreeCook();
      if (!cook) break;
      var job = kitchenJobQueue.shift();
      cook.busy = true;
      var ent = cook.entity;
      ent.busyWorking = true;
      ent.timer = COOK_TIME;
      ent.pendingAction = "cook_done";
      ent._job = job;
      ent._cook = cook;
      redrawEntity(ent);
    }
    updateSteamVisibility();
  }

  function handleCookDone(ent) {
    var job = ent._job,
      cook = ent._cook;
    ent._job = null;
    ent._cook = null;
    ent.busyWorking = false;

    if (!job || !job.customer || !entities[job.customer.id]) {
      cook.busy = false;
      updateSteamVisibility();
      return;
    }

    ent.holdingIcon = foodKeyForProduct(job.productId);
    redrawEntity(ent);
    var startCell = nearestCell(ent.x, ent.y);
    var counterCell = nearestCell(counterPoint.x, counterPoint.y);
    var path = pathBetween(startCell, counterCell);
    setPath(ent, path, function () {
      ent.holdingIcon = null;
      redrawEntity(ent);
      readyQueue.push(job);
      var backPath = pathBetween(counterCell, nearestCell(cook.home.x, cook.home.y));
      setPath(ent, backPath, function () {
        snapToHome(cook);
        cook.busy = false;
        updateSteamVisibility();
      });
    });
  }

  // ループ変数をそのまま非同期コールバックの中で参照すると、同じtick内で複数件を
  // さばいた場合に「あとから来た反復の変数」を「先に作ったコールバック」が参照してしまう
  // （JSのvarはループ内で使い回される）。これを避けるため、1件ごとの処理を独立した
  // 関数呼び出し（＝そのつど新しいスコープ）に切り出す。
  function dispatchWaiterJob(waiter, job) {
    waiter.busy = true;
    var ent = waiter.entity;
    var startCell = nearestCell(ent.x, ent.y);
    var counterCell = nearestCell(counterPoint.x, counterPoint.y);
    var homeCell = nearestCell(waiter.home.x, waiter.home.y);
    var toCounter = pathBetween(startCell, counterCell);
    setPath(ent, toCounter, function () {
      ent.holdingIcon = foodKeyForProduct(job.productId);
      redrawEntity(ent);
      var targetCell = job.customer.seatRef || nearestCell(job.customer.x, job.customer.y);
      var toTable = pathBetween(counterCell, targetCell);
      setPath(ent, toTable, function () {
        // バグ修正20（「消える」「前を向いていない」の原因の一つ）: 料理が先にできて
        // ウェイターが席に着いた時点で、客がまだ席に着いていない（入口で順番待ち中・
        // 歩いている途中）ことがある。従来はその場で客のphaseを"eating"にし、
        // direction="down"に固定し、さらに客のtimer/pendingActionを"start_eating"で
        // 上書きしていた。そのため、入口で歩き出しを待っていた客は歩き出しの予定
        // （begin_walk_to_seat）を消されてその場で食べ始め、歩いている途中の客は
        // 歩きながら食事→途中からレジへ向かう、といった不自然な動き（料理だけが席に
        // 置かれず客と一緒に移動する／客が急に向きを変えて別方向へ行く）になっていた。
        // 対処：客が本当に席（または待機列の立ち位置）に着いて止まるまで、ウェイターは
        // 料理を持ったままその場で待ち、着いてから手渡す。
        waitForCustomerThenDeliver(ent, job, function () {
          // 2026-09-23（「1日の途中で再生速度が高速になる」修正の一環）: 以前は1皿届けるたびに
          // 必ずレジ横の持ち場へ戻ってから次の皿を取りに行っていたため、ウェイター1人あたり
          // 1皿に6〜10秒かかり、店内の動きがログの進行に大きく遅れていた（その遅れを
          // 日の終わりに30倍速で片付けていたのが「途中で急に速くなる」原因）。
          // カウンターに次の料理が既に出来上がっていれば、持ち場に戻らずそのまま取りに行く。
          var nextJob = takeNextReadyJob();
          if (nextJob) {
            dispatchWaiterJob(waiter, nextJob);
            return;
          }
          var backCell = nearestCell(ent.x, ent.y);
          var homePath = pathBetween(backCell, homeCell);
          setPath(ent, homePath, function () {
            snapToHome(waiter);
            waiter.busy = false;
          });
        });
      });
    });
  }

  function customerIsSettled(c) {
    if (c.hiddenAtDoor) return false;
    if (c.path && c.path.length > 0) return false;
    if (c._beginWalk) return false; // 歩き出しの予約待ち
    if (c.pendingAction === "retry_walk") return false; // すれ違い待ちで歩き出す直前
    return true;
  }

  var WAITER_WAIT_POLL_MS = 100;
  var WAITER_WAIT_MAX_MS = 8000; // 万一客が来ない場合の安全弁（ゲーム内時間）
  function waitForCustomerThenDeliver(waiterEnt, job, onDone) {
    var waited = 0;
    function attempt() {
      var c = job.customer;
      if (!entities[c.id]) {
        // 客が既に帰ってしまった（離脱処理など）：料理を持ち帰る
        waiterEnt.holdingIcon = null;
        redrawEntity(waiterEnt);
        onDone();
        return;
      }
      if (!customerIsSettled(c) && waited < WAITER_WAIT_MAX_MS) {
        waited += WAITER_WAIT_POLL_MS;
        waiterEnt.timer = WAITER_WAIT_POLL_MS;
        waiterEnt.pendingAction = "waiter_retry";
        waiterEnt._retry = attempt;
        // 客の方を向いて待つ
        waiterEnt.direction = directionFromDelta(c.x - waiterEnt.x, c.y - waiterEnt.y);
        return;
      }
      waiterEnt.holdingIcon = null;
      redrawEntity(waiterEnt);
      if (customerIsSettled(c)) {
        c.phase = "eating";
        c.timer = LOOK_TIME;
        c.pendingAction = "start_eating";
        showDish(c);
      } else {
        // 安全弁：まだ着いていない客には、着いた瞬間に食べ始めてもらう
        c.deliverOnArrive = true;
        c.phase = "eating";
      }
      onDone();
    }
    attempt();
  }

  // カウンターに置かれている料理のうち、まだ届け先の客がいるものを1つ取り出す（いなければnull）
  function takeNextReadyJob() {
    while (readyQueue.length > 0) {
      var job = readyQueue.shift();
      if (job.customer && entities[job.customer.id]) return job;
    }
    return null;
  }

  function processWaiters() {
    while (readyQueue.length > 0) {
      var waiter = findFreeWaiter();
      if (!waiter) break;
      var job = readyQueue.shift();
      if (!job.customer || !entities[job.customer.id]) continue;
      dispatchWaiterJob(waiter, job);
    }
  }

  // ================= タイマー完了時の分岐処理 =================
  function handlePendingAction(ent) {
    var action = ent.pendingAction;
    ent.pendingAction = null;
    if (action === "cook_done") {
      handleCookDone(ent);
    } else if (action === "start_eating") {
      ent.expression = "eating";
      ent.timer = EAT_TIME;
      ent.pendingAction = "finish_eating";
    } else if (action === "finish_eating") {
      clearDish(ent);
      sendToRegisterThenExit(ent);
    } else if (action === "pay_done") {
      showPaymentPopup(ent);
      ent.phase = "walking_out";
      sendToExit(ent, false);
    } else if (action === "leave_from_loiter") {
      ent.phase = "disappointed_leaving";
      sendToExit(ent, true);
    } else if (action === "retry_walk") {
      if (ent._retryWalk) {
        var rw = ent._retryWalk;
        ent._retryWalk = null;
        rw();
      }
    } else if (action === "waiter_retry") {
      if (ent._retry) {
        var retry = ent._retry;
        ent._retry = null;
        retry();
      }
    } else if (action === "begin_walk_to_seat" || action === "begin_walk_to_loiter" || action === "begin_walk_to_exit") {
      // バグ修正4・15：入店/離脱/退店の見た目をずらすための待機が明けたタイミングで、
      // 実際の経路設定（setPath）を今ここで行う。
      if (ent._beginWalk) {
        var fn = ent._beginWalk;
        ent._beginWalk = null;
        fn();
      }
    }
  }

  // ================= beatごとの演出アクション =================
  // 2026-09-22（レイアウト改修）: 物理的な空席が無い場合、以前は表示上あきらめて
  // 何も表示していなかった（テキストの人数は正しいまま）。「入口の外に何人待っているか
  // わかる状態にして」への対応として、空席が無ければ入口の外の待機列へ回すようにした。
  function handleEnterSeat(action) {
    var animCount = Math.min(action.count, ANIM_CAP_ENTER);
    for (var i = 0; i < animCount; i++) {
      var productId = action.productIds && action.productIds[i % action.productIds.length];
      var assignment = tryFreeSeatsForParty(1);
      if (assignment) {
        occupySeats(assignment.seats);
        spawnCustomerToSeatBeat(assignment.seats[0], assignment.table, productId);
      } else {
        enqueueOutside(productId);
      }
    }
  }

  function handleLeaveDisappointed(action) {
    var animCount = Math.min(action.count, ANIM_CAP_LEAVE);
    for (var i = 0; i < animCount; i++) spawnDisappointed();
  }

  function awaitingCustomers() {
    return Object.keys(entities)
      .map(function (id) {
        return entities[id];
      })
      .filter(function (e) {
        return e.kind === "customer" && e.awaitingFood;
      });
  }

  function handleServeBatch(action) {
    var candidates = awaitingCustomers();
    var n = Math.min(action.count, candidates.length);
    for (var i = 0; i < n; i++) {
      var c = candidates[i];
      c.awaitingFood = false;
      c.phase = "cooking_wait";
      kitchenJobQueue.push({ productId: c.pendingProductId, customer: c });
    }
  }

  function handleLeaveWaitingBatch(action) {
    var candidates = awaitingCustomers();
    var n = Math.min(action.count, candidates.length);
    for (var i = 0; i < n; i++) {
      var c = candidates[i];
      c.awaitingFood = false;
      c.expression = "angry";
      c.phase = "disappointed_leaving";
      sendToExit(c, true);
    }
  }

  function playBeat(action) {
    if (!action) return;
    switch (action.type) {
      case "enter_seat":
        handleEnterSeat(action);
        break;
      case "leave_disappointed":
        handleLeaveDisappointed(action);
        break;
      case "serve_batch":
        handleServeBatch(action);
        break;
      case "leave_waiting_batch":
        handleLeaveWaitingBatch(action);
        break;
    }
  }

  // ================= メインループ（常時稼働。beatの進行とは独立） =================
  // 2026-09-23: 再生速度を最大20倍まで選べるようにしたことで、1フレームあたりの移動量が
  // 70px以上（客同士の最低間隔FOLLOW_MIN_SEP=34pxの2倍以上）になり、「前の客に追いついたら
  // 待つ」判定の間をすり抜けて重なることがあった（x20・2週で1組を検出）。1フレームの
  // ゲーム内時間がこの値を超える場合は、細かく分割して複数回に分けて進める（描画は最後の1回だけ）。
  // 何倍速でも、1倍速と同じ細かさで入店・配膳・追従の判定が行われる。
  var MAX_SUBSTEP_SEC = 0.034;

  function tick(now) {
    if (!running) return;
    var dt = Math.min(0.12, (now - lastFrameTime) / 1000) * speedMult;
    lastFrameTime = now;

    var steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_SEC));
    var sub = dt / steps;
    for (var i = 0; i < steps; i++) {
      var render = i === steps - 1;
      simClockMs += sub * 1000;

      processDoorQueue(); // バグ修正19：入口が空いていれば順番待ちの客を1人入れる
      processKitchen();
      processWaiters();
      updateMoneyPopups(sub);

      Object.keys(entities).forEach(function (id) {
        updateEntity(entities[id], sub, render);
      });
    }

    rafHandle = requestAnimationFrame(tick);
  }

  // バグ修正19参照：進行方向の前方すぐ近くを、自分より先に登場した客が歩いているか。
  function isBlockedByLeader(ent) {
    if (ent.kind !== "customer" || !ent.path || ent.path.length === 0) return false;
    var t = ent.path[0];
    var hx = t.x - ent.x, hy = t.y - ent.y;
    var hl = Math.hypot(hx, hy);
    if (hl < 0.001) return false;
    hx /= hl;
    hy /= hl;
    var dest = ent.path[ent.path.length - 1];
    for (var id in entities) {
      var o = entities[id];
      if (o === ent || o.kind !== "customer" || o.hiddenAtDoor) continue;
      var ox = o.x - ent.x, oy = o.y - ent.y;
      var od = Math.hypot(ox, oy);
      if (od >= FOLLOW_MIN_SEP) continue;
      if (!o.path || o.path.length === 0) {
        // 止まっている相手：自分の行き先（レジ・入口など）にちょうど立っている場合だけ、
        // その手前で待つ（相手は会計等が終われば必ず動くので、待てば空く）。
        // それ以外の止まっている客（席にいる客など）は待っても動かないので対象外。
        if (Math.hypot(o.x - dest.x, o.y - dest.y) < FOLLOW_MIN_SEP && (ox * hx + oy * hy) / Math.max(od, 0.001) > 0.3) return true;
        continue;
      }
      if (od < 0.001) {
        if (o.seq < ent.seq) return true; // 完全に同じ座標：古い方を先に行かせる
        continue;
      }
      if ((ox * hx + oy * hy) / od <= 0.3) continue; // 相手は前方（進行方向±約70°以内）にいない
      // 相手も自分を前方に見ている＝正面衝突の形。この場合だけ古い方（seqが小さい方）を
      // 優先し、新しい方が待つ（両方が待って固まることを防ぐ）。それ以外（前を歩く人の
      // 後ろに付いている形）は、年齢に関係なく後ろ側が待つ。
      var ot = o.path[0];
      var ohx = ot.x - o.x, ohy = ot.y - o.y;
      var ohl = Math.hypot(ohx, ohy);
      var headOn = ohl > 0.001 && ((-ox * ohx + -oy * ohy) / (od * ohl)) > 0.3;
      if (headOn && ent.seq < o.seq) continue;
      return true;
    }
    return false;
  }

  function updateEntity(ent, dt, render) {
    // バグ修正21（「消える」の見た目の原因の一つ・吹き出しの取り残し）: 同じフレーム内で
    // 他の客の処理（席が空いた→待機列から案内、など）によって既に画面から消された
    // entityに対しては何もしない。
    if (!entities[ent.id]) return;
    var moving = false;
    ent.blockedByLeader = false;
    if (ent.path && ent.path.length > 0 && isBlockedByLeader(ent)) {
      ent.followWaitMs += dt * 1000;
      if (ent.followWaitMs < FOLLOW_MAX_WAIT_MS) {
        ent.blockedByLeader = true;
        // 待っている間も「行き先の方向」を向かせておく（前を向いたまま立ち止まる）
        var tgt = ent.path[0];
        if (Math.hypot(tgt.x - ent.x, tgt.y - ent.y) > 0) ent.direction = directionFromDelta(tgt.x - ent.x, tgt.y - ent.y);
      }
    } else {
      ent.followWaitMs = 0;
    }
    if (ent.path && ent.path.length > 0 && !ent.blockedByLeader) {
      moving = true;
      // バグ修正9（「進むときに前を向いたまま進む」対応）: 従来は1フレームにつき
      // 目的地(path[0])までの距離distと、このフレームで進める距離stepを比べ、
      // dist<=step（＝このフレームで目的地にぴったり到達する）の場合はdirectionを
      // 更新せずにその場でスナップしていた。1フレームで進める距離は「見た目の速度倍率
      // （通常1倍・倍速3倍・日付切り替え時の後片付け8倍）× そのフレームの経過時間」で
      // 決まるため、倍率が高いほど、あるいは描画が重くフレーム間隔が空くほど、
      // 「dist<=stepで毎回スナップするだけの分岐ばかりが選ばれ続け、directionが
      // 一度も更新されない」状況が起きやすくなる。この場合、見た目上は「歩いている
      // （マス目を飛び飛びに進んでいる）のに、最初に向いていた方向（正面）のまま
      // 一切振り向かない」という不自然な動きになっていた。
      // 対処：dist<=stepでスナップする場合も含め、必ずこのセグメントの向きをdirectionへ
      // 反映してから移動する。あわせて、1フレームの移動量が複数マス分に及ぶ場合でも
      // 「1フレームにつき1マスだけ進めて残りは次フレーム待ち」にはせず、その場で
      // 複数区間をまとめて消化するようにし、後片付け用の高速倍率時に不自然な
      // 停止・再開を繰り返して見えることも防ぐ（安全のためループ回数に上限を設ける）。
      var remainingStep = ent.speed * CELL * dt;
      var guard = 0;
      while (remainingStep > 0 && ent.path.length > 0 && guard < 32) {
        guard++;
        var target = ent.path[0];
        var dx = target.x - ent.x;
        var dy = target.y - ent.y;
        var dist = Math.hypot(dx, dy);
        if (dist > 0) ent.direction = directionFromDelta(dx, dy);
        if (dist <= remainingStep || dist === 0) {
          ent.x = target.x;
          ent.y = target.y;
          remainingStep -= dist;
          ent.path.shift();
        } else {
          ent.x += (dx / dist) * remainingStep;
          ent.y += (dy / dist) * remainingStep;
          remainingStep = 0;
        }
      }
      if (ent.path.length === 0) {
        moving = false;
        if (ent.onArrive) {
          var cb = ent.onArrive;
          ent.onArrive = null;
          cb();
        }
      }
    }

    if (!entities[ent.id]) return; // バグ修正21：到着時の処理で消えた場合は以降の処理をしない
    if (moving) {
      ent.walkPhase += dt * WALK_PHASE_RATE;
    } else {
      ent.idlePhase += dt * IDLE_PHASE_RATE;
    }

    if (ent.timer != null && ent.timer > 0) {
      ent.timer -= dt * 1000;
      if (ent.timer <= 0) {
        ent.timer = 0;
        if (ent.pendingAction) handlePendingAction(ent);
      }
    }

    // バグ修正21: 出口に着いた（onArrive→despawnEntity）・入る前に帰った等で、この
    // フレームの処理中に客が画面から消された場合、ここで描画や吹き出しの再設定を続けると、
    // despawnEntityで消したはずの吹き出し（👋など）がその場に作り直され、持ち主のいない
    // アイコンだけが入口に残り続けていた（＝人だけが突然消えたように見える）。
    if (!entities[ent.id]) return;
    if (render === false) return; // 1フレームを分割して進めている途中（描画はそのフレームの最後にまとめて行う）
    redrawEntity(ent);
    ent.g.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")");
    if (ent.dishEl) ent.dishEl.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET - CELL * 0.32) + ")");

    if (ent.kind === "customer") {
      setBubble(ent, ent.hiddenAtDoor ? null : BUBBLE_BY_PHASE[ent.phase] || null);
    }
    if (ent.bubbleEl) ent.bubbleEl.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")");
  }

  // ================= 公開API =================
  function stopLoop() {
    running = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
  }

  function ensureLoopRunning() {
    if (running) return;
    running = true;
    lastFrameTime = performance.now();
    rafHandle = requestAnimationFrame(tick);
  }

  // 週の営業開始時に1回だけ呼ぶ：レイアウト・スタッフを配置し直す
  function startWeek(newLayout) {
    stopLoop();
    Object.keys(entities).forEach(function (id) {
      despawnEntity(entities[id]);
    });
    kitchenJobQueue = [];
    readyQueue = [];
    moneyPopups.forEach(function (p) {
      if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
    });
    moneyPopups = [];

    setupLayout(newLayout);
    setupStaffPools();
    updateSteamVisibility();

    speedMult = 1;
    ensureLoopRunning();
  }

  // コック/ウェイターが調理中・配膳中など「作業の途中」で日が切り替わった場合に備えて、
  // プールのbusyフラグだけでなく、エンティティ本体に残っている進行中の状態
  // （移動経路・到着コールバック・タイマー・保留中アクション・調理中ジョブ・手持ちアイコン）
  // も丸ごとリセットする。これをせずにbusyだけ戻すと、古いpath/onArriveが後になって
  // 発火し、新しい日に割り当てられたジョブと衝突して「歩く向きが不自然」「途中で動きが
  // 止まって見える」といった見た目の不具合につながっていた。
  function resetFixtureEntity(ent) {
    if (!ent) return;
    ent.path = [];
    ent.onArrive = null;
    ent.timer = 0;
    ent.pendingAction = null;
    ent._job = null;
    ent._cook = null;
    ent.holdingIcon = null;
    ent.busyWorking = false;
    clearDish(ent);
  }

  // 曜日が切り替わるたびに呼ぶ：客だけをリセットする（スタッフはそのまま）
  function startDay() {
    // 待機列も日をまたいでは持ち越さない（先に空にしておき、これから行うdespawnで
    // 無駄な案内処理が走らないようにする）。
    outsideQueue = [];
    outsideOverflowCount = 0;
    doorQueue = [];
    updateQueueBadge();
    Object.keys(entities).forEach(function (id) {
      if (!entities[id].isFixtureStaff) despawnEntity(entities[id]);
    });
    freeAllSeats();
    kitchenJobQueue = [];
    readyQueue = [];
    kitchenStaffPool.forEach(function (c) {
      c.busy = false;
      resetFixtureEntity(c.entity);
      snapToHome(c);
      redrawEntity(c.entity);
    });
    waiterStaffPool.forEach(function (c) {
      c.busy = false;
      resetFixtureEntity(c.entity);
      snapToHome(c);
      redrawEntity(c.entity);
    });
    updateSteamVisibility();
    ensureLoopRunning();
  }

  function pause() {
    running = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
  }

  function resume() {
    ensureLoopRunning();
  }

  function setSpeed(mult) {
    speedMult = mult;
  }

  function skipToEnd() {
    pause();
    outsideQueue = [];
    outsideOverflowCount = 0;
    doorQueue = [];
    updateQueueBadge();
    Object.keys(entities).forEach(function (id) {
      if (!entities[id].isFixtureStaff) despawnEntity(entities[id]);
    });
    freeAllSeats();
    kitchenJobQueue = [];
    readyQueue = [];
    kitchenStaffPool.forEach(function (c) {
      c.busy = false;
    });
    waiterStaffPool.forEach(function (c) {
      c.busy = false;
    });
    updateSteamVisibility();
  }

  function clear() {
    stopLoop();
    outsideQueue = [];
    outsideOverflowCount = 0;
    doorQueue = [];
    updateQueueBadge();
    Object.keys(entities).forEach(function (id) {
      despawnEntity(entities[id]);
    });
    kitchenJobQueue = [];
    readyQueue = [];
  }

  function renderIdle(container) {
    if (!svgEl) init(container);
    setupLayout(Game.App.state.layout);
  }

  // バグ修正8（「消えるバグ」対応）: その日のログ表示が終わった直後でも、まだ調理中・
  // 食事中・会計中など「サービス継続中」の客がその場に残っていることがある
  // （バグ修正3で、ログの表示ペースと実際のキャラクターの動作時間が異なることが判明済み）。
  // これまでは「次の日へ進む」を押すとstartDay()が問答無用で残っている客を即座に
  // 消していたため、食事中の客が何の前触れもなく一瞬で消える（＝バグに見える）ことが
  // あった。field.js側でこの関数を使い、まだ客が残っている間は次の日へ進めない
  // （客が自然に退店し終えるまで少し待たせる）ようにする。
  function hasActiveCustomers() {
    return Object.keys(entities).some(function (id) {
      return !entities[id].isFixtureStaff;
    });
  }

  // 2026-09-23追加（「1日の途中で再生速度が高速になる」修正）: 店内アニメーションが
  // ログ(beat)の進行にどれだけ遅れているかの目安。「配膳の指示は出たが、まだ料理が
  // 届いていない客（調理待ち・受け渡し待ち）」と「入口の外で入店の順番を待っている客」の
  // 人数の合計。field.jsはこの値が大きい間は次のbeatへ進まずに待つことで、ログの進み方を
  // 店内の実際の動きに合わせる（＝ログだけ先に終わって、残りを早送りで片付ける必要を無くす）。
  function backlog() {
    var n = doorQueue.length;
    for (var id in entities) {
      var e = entities[id];
      if (e.kind === "customer" && e.phase === "cooking_wait") n++;
    }
    return n;
  }

  // 現在のゲーム内時間（tick()のdtを倍速込みで積算した値、ms）。
  // field.jsが「待ちの安全弁」を実時間ではなくゲーム内時間で測るために使う。
  function simClock() {
    return simClockMs;
  }

  Game.UI.Scene = {
    init: init,
    startWeek: startWeek,
    startDay: startDay,
    playBeat: playBeat,
    pause: pause,
    resume: resume,
    setSpeed: setSpeed,
    skipToEnd: skipToEnd,
    clear: clear,
    renderIdle: renderIdle,
    hasActiveCustomers: hasActiveCustomers,
    backlog: backlog,
    simClock: simClock,
    // 検証用（自動テストから現在のエンティティ・出口座標を参照するためだけに使う）
    __debugEntities: function () { return entities; },
    __debugEntrance: function () { return entrance ? cellCenter(entrance.x, entrance.y) : null; },
  };
})();
