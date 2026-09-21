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
  var WALK_SPEED = 3.6; // マス/秒
  var ANGRY_SPEED_MULT = 1.5; // 怒って帰る時は早歩き
  var ANIM_CAP_ENTER = 4; // 1beatあたり実際にアニメーションさせる客の上限（多すぎると見づらいため）
  var ANIM_CAP_LEAVE = 3;
  var COOK_TIME = 900; // ms（コンロの前での調理時間）
  var LOOK_TIME = 380; // ms（料理が届いてから食べ始めるまでの「見る」間）
  var EAT_TIME = 1500; // ms
  var PAY_TIME = 450; // ms（レジでの会計にかかる時間）
  var WALK_PHASE_RATE = 7.5; // rad/秒（歩行アニメの速さ）
  var IDLE_PHASE_RATE = 1.6; // rad/秒（待機時の呼吸アニメの速さ）
  // 2026-09-21 バグ修正4（「二重になる」バグ）: 同じbeatで複数人が同時入店/離脱する場合、
  // 全員が入口の全く同じ座標から同時刻に歩き出すと、次の分岐点までの経路が重なる間は
  // 複数の客が完全に同じピクセル位置を歩き続けることになり、1人しかいないように（＝誰かが
  // 消えた／2人が1人に重なった）見えてしまっていた。これを防ぐため、同じbeat内の2人目以降は
  // 少しだけ歩き出す位置と時刻をずらす。
  var ENTER_STAGGER_MS = 260; // 同一beat内で2人目以降が歩き出すまでの遅延（1人あたり）
  // （入口でのjitter半径はバグ修正10でentranceJitter()内の段階的な値に変更したため、
  // ここでの固定定数は廃止した）
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
    chair: { w: 24, h: 46 },
    table2: { w: 38, h: 66 },
    table4: { w: 46, h: 78 },
  };

  // 客の状態→吹き出し（announceStateChangesと同じ思想：状態が変わるまで表示され続ける）
  var BUBBLE_BY_PHASE = {
    walking_to_seat: "👀",
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
  var counterPoint = null; // コック→ウェイターの受け渡し地点（先頭のコンロ地点を流用）
  var registerPoint = null;
  var entrance = null;
  var loiterPoint = null;
  var steamEl = null;
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
    counterPoint = stovePoints[0];
    if (!registerPoint) registerPoint = entrance;

    var deeper = Game.Core.Pathfind.findAdjacentWalkable(entrance.x, entrance.y, walkableFn, layout.cols, layout.rows);
    loiterPoint = deeper.length > 0 ? deeper[0] : entrance;

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
    if (idOrKey === "entrance" || idOrKey === "chair") {
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

  function renderFurniture() {
    while (furnitureG.firstChild) furnitureG.removeChild(furnitureG.firstChild);

    drawFurniture(entrance.x, entrance.y, "entrance", false);

    Game.Core.Layout.allObjectCells(layout).forEach(function (c) {
      if (c.def.category === "table") return; // テーブルは椅子とまとめて後段で描く
      drawFurniture(c.x, c.y, c.id, false);
    });

    tables.forEach(function (t) {
      t.seats.forEach(function (s) {
        var flip = s.x > t.x; // 卓の右側にある椅子は反転して卓の方を向かせる
        drawFurniture(s.x, s.y, "chair", flip);
      });
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
    var id = "e" + entitySeq++;
    var p = cellCenter(gridStart.x, gridStart.y);
    var ent = {
      id: id,
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
      sitting: false,
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
    if (ent.seatRef) {
      freeSeat(ent.seatRef);
      ent.seatRef = null;
    }
    if (ent.g && ent.g.parentNode) ent.g.parentNode.removeChild(ent.g);
    clearDish(ent);
    clearBubble(ent);
    delete entities[ent.id];
  }

  function iconHrefFor(key) {
    if (!key) return null;
    if (key === "coin") return Game.Data.UiAssets.coin;
    return Game.Data.FoodAssets[key] || null;
  }

  function computeAnimKind(ent) {
    var moving = ent.path && ent.path.length > 0;
    if (ent.kind === "customer") {
      if (moving) return AnimationKind.WALK;
      if (ent.sitting) return ent.expression === "eating" ? AnimationKind.SIT_EAT : AnimationKind.SIT_IDLE;
      if (ent.phase === "paying") return AnimationKind.STAND_TALK;
      if (ent.phase === "disappointed_loiter") return AnimationKind.IDLE_ALERT;
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

  function directionFromDelta(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "down" : "up";
  }

  function pathBetween(fromCell, toCell) {
    return Game.Core.Pathfind.findPath(fromCell.x, fromCell.y, toCell.x, toCell.y, walkableFn, layout.cols, layout.rows) || [toCell];
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
      return (st.role === "service" || st.role === "register") && st.workDays > 0;
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
  function sendToRegisterThenExit(customerEnt) {
    // バグ修正7: 席はまだここで空けない（despawnEntityで実際に画面から消える時に空ける）。
    // レジへ・出口へと歩いている間も「その席はこの客がまだ使用中」として扱うことで、
    // 新しい客が同じ席へ向かい、まだ帰り支度中の客と鉢合わせ／重なって見えるのを防ぐ。
    customerEnt.sitting = false;
    customerEnt.expression = "happy";
    var startCell = nearestCell(customerEnt.x, customerEnt.y);
    var path = pathBetween(startCell, registerPoint);
    customerEnt.phase = "paying";
    setPath(customerEnt, path, function () {
      customerEnt.timer = PAY_TIME;
      customerEnt.pendingAction = "pay_done";
    });
  }

  function sendToExit(customerEnt, speedBoost) {
    // バグ修正7: sendToRegisterThenExitと同様、席はここでは空けない
    // （despawnEntityで実際に画面から消える時に空ける）。
    customerEnt.sitting = false;
    var startCell = nearestCell(customerEnt.x, customerEnt.y);
    var path = pathBetween(startCell, entrance);
    if (speedBoost) customerEnt.speed = WALK_SPEED * ANGRY_SPEED_MULT;
    setPath(customerEnt, path, function () {
      despawnEntity(customerEnt);
    });
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
    var GOLDEN_ANGLE = 137.5;
    var n = entranceSpawnSeq++;
    var angle = n * GOLDEN_ANGLE * (Math.PI / 180);
    var radius = 16 + (n % 4) * 10;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  }

  // ================= 客の入店・着席（enter_seat beat） =================
  // staggerIndex: 同じbeat内で何番目に入店する客か（0始まり）。0以外は、見た目上
  // 少しずらした位置で少し待ってから歩き出させることで、入口で複数人が完全に同じ
  // 座標・同じ経路を辿って「重なって見える／1人しかいないように見える」ことを防ぐ
  // （バグ修正4：「二重になる」対応）。
  function spawnCustomerToSeatBeat(seat, tableCenterCell, productId, staggerIndex) {
    var look = Game.Data.CharacterAssets.randomLook("cust_" + entitySeq + "_" + Date.now());
    var c = spawnEntity("customer", look, entrance, null);
    var jitter = entranceJitter();
    c.x += jitter.dx;
    c.y += jitter.dy;
    c.g.setAttribute("transform", "translate(" + c.x + "," + (c.y + ENTITY_VISUAL_Y_OFFSET) + ")");
    c.seatRef = seat;
    c.awaitingFood = true;
    c.pendingProductId = productId || pickAnyProduct();
    c.phase = "walking_to_seat";
    var path = pathBetween(entrance, seat);
    var tc = cellCenter(tableCenterCell.x, tableCenterCell.y);
    var beginWalk = function () {
      setPath(c, path, function () {
        c.sitting = true;
        c.direction = directionFromDelta(tc.x - c.x, tc.y - c.y);
        c.expression = "bored";
        // バグ修正6: 入店演出の遅延（ENTER_STAGGER_MS）待ちの間に、経済シミュレーション側は
        // 既にこの客への配膳(serve_batch)を進めてしまっている場合がある（beatの間隔は
        // 見た目の遅延より短いことがあるため）。その場合c.phaseは既に"cooking_wait"等へ
        // 進んでいるので、ここで無条件に"awaiting_food"へ巻き戻すと、実際には調理が
        // 始まっている（またはもう届いている）のに吹き出しだけ⏳に逆戻りして見えてしまう。
        // まだ誰も進めていない（＝spawn直後のまま）場合にだけ初期状態にする。
        if (c.phase === "walking_to_seat") c.phase = "awaiting_food";
        redrawEntity(c);
      });
    };
    var delay = (staggerIndex || 0) * ENTER_STAGGER_MS;
    if (delay > 0) {
      c.timer = delay;
      c.pendingAction = "begin_walk_to_seat";
      c._beginWalk = beginWalk;
    } else {
      beginWalk();
    }
  }

  function spawnDisappointed(staggerIndex) {
    var look = Game.Data.CharacterAssets.randomLook("gone_" + entitySeq + "_" + Date.now());
    var c = spawnEntity("customer", look, entrance, null);
    var jitter = entranceJitter();
    c.x += jitter.dx;
    c.y += jitter.dy;
    c.g.setAttribute("transform", "translate(" + c.x + "," + (c.y + ENTITY_VISUAL_Y_OFFSET) + ")");
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
    var delay = (staggerIndex || 0) * ENTER_STAGGER_MS;
    if (delay > 0) {
      c.timer = delay;
      c.pendingAction = "begin_walk_to_loiter";
      c._beginWalk = beginWalk;
    } else {
      beginWalk();
    }
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
        ent.holdingIcon = null;
        redrawEntity(ent);
        if (entities[job.customer.id]) {
          job.customer.phase = "eating";
          job.customer.direction = "down";
          job.customer.timer = LOOK_TIME;
          job.customer.pendingAction = "start_eating";
          showDish(job.customer);
        }
        var backCell = nearestCell(ent.x, ent.y);
        var homePath = pathBetween(backCell, homeCell);
        setPath(ent, homePath, function () {
          snapToHome(waiter);
          waiter.busy = false;
        });
      });
    });
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
    } else if (action === "begin_walk_to_seat" || action === "begin_walk_to_loiter") {
      // バグ修正4：入店/離脱の見た目をずらすための待機が明けたタイミングで、
      // 実際の経路設定（setPath）を今ここで行う。
      if (ent._beginWalk) {
        var fn = ent._beginWalk;
        ent._beginWalk = null;
        fn();
      }
    }
  }

  // ================= beatごとの演出アクション =================
  function handleEnterSeat(action) {
    var animCount = Math.min(action.count, ANIM_CAP_ENTER);
    for (var i = 0; i < animCount; i++) {
      var assignment = tryFreeSeatsForParty(1);
      if (!assignment) break; // 物理的な空席が無ければそれ以上は表示上あきらめる（テキストの人数は正しいまま）
      occupySeats(assignment.seats);
      var productId = action.productIds && action.productIds[i % action.productIds.length];
      spawnCustomerToSeatBeat(assignment.seats[0], assignment.table, productId, i);
    }
  }

  function handleLeaveDisappointed(action) {
    var animCount = Math.min(action.count, ANIM_CAP_LEAVE);
    for (var i = 0; i < animCount; i++) spawnDisappointed(i);
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
  function tick(now) {
    if (!running) return;
    var dt = Math.min(0.12, (now - lastFrameTime) / 1000) * speedMult;
    lastFrameTime = now;

    processKitchen();
    processWaiters();
    updateMoneyPopups(dt);

    Object.keys(entities).forEach(function (id) {
      updateEntity(entities[id], dt);
    });

    rafHandle = requestAnimationFrame(tick);
  }

  function updateEntity(ent, dt) {
    var moving = false;
    if (ent.path && ent.path.length > 0) {
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

    redrawEntity(ent);
    ent.g.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET) + ")");
    if (ent.dishEl) ent.dishEl.setAttribute("transform", "translate(" + ent.x + "," + (ent.y + ENTITY_VISUAL_Y_OFFSET - CELL * 0.32) + ")");

    if (ent.kind === "customer") {
      setBubble(ent, BUBBLE_BY_PHASE[ent.phase] || null);
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
  };
})();
