// sceneV2.js — chibi_restaurant_assets.zip のPNGを実際に読み込んで表示する、新しいFIELD描画
// エンジンの土台。ステージ2として、テーブル3卓・スタッフ複数人で客を同時進行させ、
// 「スタッフの手が足りない」ボトルネックが実際の混雑（待つ客・諦めて帰る客）として
// 目に見えるようにしてある。
//
// v4差し替えメモ（コック/ウェイター2人体制化・4人がけテーブル化）:
//   - テーブルを縦に長い実素材（table.png, 48x90）へ差し替え、1卓あたり椅子を左右2脚ずつ
//     （計4脚）配置。SEATSを3席→12席（3卓×4席）へ拡張し、実際に1卓最大4人まで同時着席
//     できるようにした（見た目だけの変更ではない）。
//   - スタッフを「コック」（コンロの前に立ったまま、客席には一切出ない）と「ウェイター」
//     （接客・カウンターでの受け取り・配膳・会計を担当）の2人体制に分離した
//     （役割分担の詳細は core/actorFSM.js 冒頭コメント参照）。両者は本ファイルが持つ
//     「厨房の注文キュー」「カウンターの受け取り待ちキュー」を介して間接的に協調する。
//   - 料理はもう客に付いて回らず、席ごとに固定された卓上の1点（dishPoint）に置かれる
//     （claimSeatでentに割り当てる）。
//   - レジを入口の近くに配置し、会計完了時にレジの位置から金額のポップアップが飛び出す
//     演出（moneyPopups）を追加した。
//
// v4-b差し替えメモ（「椅子の向き・キッチンの作り込み・客の状態が分かりにくい・所持金/日時表示・
// 会計連動」フィードバックへの対応）:
//   - 卓の右側の椅子は`renderFurniture`で左右反転（`flip`フラグ）して描画し、両側とも
//     テーブルの方を向いて見えるようにした。
//   - キッチンをより細かく・広く見せるため、キャンバス幅（VIEW_W）自体を拡張した上で、
//     電子レンジ・食洗機・パントリー棚を追加（什器点数を3→6に増加）。
//   - 客の状態（席を探している／注文待ち／料理待ち／食事中／会計中／退店中）ごとに
//     頭上の吹き出しアイコンを常時表示するようにし、「急に消えたように見える」問題に
//     対応した（announceStateChangesのbubbleルックアップテーブル参照）。
//   - ゲーム内の日付・時刻・本日/週間の入店数・所持金を管理する簡易な「ゲーム内クロック」
//     を新設し、外部（asset_test.html）から`getHudState()`で読み取れるようにした。
//     会計ポップアップの金額は、表示と同時に所持金にもそのまま加算される（連動）。
//
// 役割分担（11. ゲームロジックと画像表示を分離、変更なし）:
//   - 「何をしているか」（状態そのもの）は core/actorFSM.js が持つ。
//   - 「どう動かすか」（歩行の座標計算・誰が誰を担当するかの割り当て・席の空き状況）は
//     本ファイルが持つ（＝盤面の物理・スケジューリングであり、見た目の話ではない）。
//   - 「どう見えるか」（PNGレイヤー合成・アニメーションのブレ）は ui/actorSprite.js が持つ。
//
// 現段階は意図的にBFS経路探索（core/pathfind.js）を使わず、地点間を軸移動のみの直線移動
// （planAxisPath）で繋いでいる。検証専用の固定配置のため複雑な障害物回避は不要なことと、
// まず表示とFSMの結線・複数客の同時進行を確実に動かすことを優先したための簡略化。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var VIEW_W = 760; // キッチンをより広く取るため640→760に拡張
  var VIEW_H = 380;
  var WALK_SPEED = 300; // px/秒
  var WALK_PHASE_RATE = 18;
  var IDLE_PHASE_RATE = 2.8;
  var MAX_CONCURRENT_CUSTOMERS = 14; // 席12+待ち2程度で「混雑」が見えるようにする上限
  var SPAWN_INTERVAL_MIN = 700; // 客の入店間隔（ランダム。客の状態が見やすいよう少し落ち着かせた）
  var SPAWN_INTERVAL_MAX = 1400;
  var GAME_MINUTES_PER_SEC = 6; // ゲーム内クロックの進み方（実1秒＝ゲーム内6分）
  var OPEN_HOUR = 10; // 開店時刻
  var CLOSE_HOUR = 22; // 閉店時刻（これを超えたら翌日10:00へ）

  var FSM = Game.Core.FSM;
  var CustomerState = Game.Core.CustomerState;
  var CookState = Game.Core.CookState;
  var WaiterState = Game.Core.WaiterState;

  // ================= 固定の店内配置 =================
  // stovePoint: コックがコンロの前で作業する位置（客席へは一切出ない）。
  // counterPoint: コックが完成した料理を置き、ウェイターがそれを受け取る「受け渡し地点」。
  var WORLD = {
    entrancePoint: { x: 150, y: 340 },
    registerPoint: { x: 90, y: 330 },
    stovePoint: { x: 75, y: 90 },
    counterPoint: { x: 125, y: 140 },
    staffHomePoint: { x: 280, y: 110 },
  };

  // テーブル3卓×4席=12席。各卓は縦長のtable.png（48x90）を中心に、左右2脚ずつ椅子を配置する
  // （上下には椅子を置かない＝「椅子は左右にのみ並ぶ」要望への対応）。
  // dishPointは卓上（テーブル画像の横幅の内側）にある固定点で、seatPoint（客が座る＝椅子の位置、
  // テーブルの外側）とは別に持つ。ウェイターはservePoint（=seatPointと同じ）まで来て給仕する。
  function makeTableSeats(tableId, tx) {
    var footY = 225; // 卓の足元（テーブル画像の下端）
    var upperY = 160;
    var lowerY = 193;
    var chairOffset = 34; // 卓中心から椅子(seatPoint)までの距離
    var dishOffset = 12; // 卓中心から皿(dishPoint)までの距離（卓の内側＝天面の上）
    function seat(sub, sx, sy, dx) {
      return {
        id: tableId + sub,
        tableCenter: { x: tx, y: footY - 45 },
        seatPoint: { x: sx, y: sy },
        servePoint: { x: sx, y: sy }, // ウェイターは客の真横まで来て給仕する
        dishPoint: { x: tx + dx, y: sy },
        occupied: false,
        occupantId: null,
      };
    }
    return [
      seat("-LU", tx - chairOffset, upperY, -dishOffset),
      seat("-LL", tx - chairOffset, lowerY, -dishOffset),
      seat("-RU", tx + chairOffset, upperY, dishOffset),
      seat("-RL", tx + chairOffset, lowerY, dishOffset),
    ];
  }
  var TABLE_XS = [380, 520, 660];
  var SEATS = TABLE_XS.reduce(function (acc, tx, i) {
    return acc.concat(makeTableSeats(String.fromCharCode(65 + i), tx)); // A/B/C
  }, []);

  // 什器（LimeZu実素材、assetManifest.js の FURNITURE_ASSETS 参照）。
  // x,yは「什器の足元中央」を指す（キャラのアンカーと同じ考え方）ので、renderFurnitureは
  // (x - w/2, y - h) を左上として描画する。table/chairの位置はSEATS（席の管理）と
  // 対応させてあり、卓の当たり判定（planAxisPath内のBAND/CORRIDOR_XS）もこの座標が前提。
  // `flip: true`を付けた項目は左右反転して描画する（卓の右側の椅子が左側と向き合うように
  // するため）。
  var FURNITURE_LAYOUT = [
    { key: "entrance", x: 150, y: 340, w: 42, h: 54 },
    { key: "register", x: 90, y: 300, w: 32, h: 32 },
    // キッチンの奥壁沿いに5点の什器を並べ、より作り込まれた厨房に見せている
    // （以前は冷蔵庫・コンロ・カウンターの3点のみだった）。
    { key: "fridge", x: 25, y: 60, w: 22, h: 60 },
    { key: "stove", x: 75, y: 60, w: 32, h: 60 },
    { key: "microwave", x: 122, y: 60, w: 26, h: 52 },
    { key: "dishwasher", x: 163, y: 60, w: 28, h: 28 },
    { key: "shelf", x: 208, y: 60, w: 44, h: 44 },
    // コックが料理を置く・ウェイターが受け取るための横長の受け渡しカウンター（奥壁の什器列とは
    // 別の手前の列に配置し、奥行きのある厨房に見せている）。
    { key: "counter", x: 125, y: 124, w: 210, h: 36 },
  ]
    .concat(
      TABLE_XS.reduce(function (acc, tx) {
        acc.push({ key: "table", x: tx, y: 225, w: 48, h: 90 });
        [
          { cx: tx - 34, flip: false },
          { cx: tx + 34, flip: true },
        ].forEach(function (side) {
          [160, 193].forEach(function (cy) {
            acc.push({ key: "chair", x: side.cx, y: cy, w: 26, h: 50, flip: side.flip });
          });
        });
        return acc;
      }, [])
    )
    .concat([
      { key: "plant", x: 725, y: 345, w: 36, h: 36 },
      // 装飾（当たり判定なし。什器と違い経路計画には一切関与しない）。
      { key: "rug", x: 520, y: 330, w: 380, h: 60 },
      { key: "picture", x: 380, y: 27, w: 42, h: 26 },
      { key: "picture", x: 660, y: 27, w: 42, h: 26 },
    ]);

  var LOOK_BASE_POINT = { x: 150, y: 290 }; // 入店直後・待機中に立つ基準位置（複数人いる時は少しずらす）

  var svgEl, floorG, furnitureG, entitiesG, bubblesG, popupsG;
  var entities = {};
  var entitySeq = 0;
  var running = false;
  var rafHandle = null;
  var lastFrameTime = 0;
  var spawnTimer = null;

  // 厨房の注文キュー（ウェイターが積み、コックが取り出す）／カウンターの受け取り待ちキュー
  // （コックが積み、ウェイターが取り出す）。要素は { customerId, foodKey }。
  var kitchenQueue = [];
  var readyQueue = [];
  var moneyPopups = [];

  // ゲーム内クロック（日付・時刻）と、日次/週次の入店数・所持金。まだ経済シミュレーション
  // 本体（simulation.js）とは接続していない簡易な表示用カウンタで、外部からは
  // getHudState()で読み取る。所持金の初期値はPROGRESS.md記載の初期資金（40万円）に合わせた。
  var INITIAL_MONEY = 400000;
  var gameDay = 1;
  var gameHour = OPEN_HOUR;
  var gameMinute = 0;
  var todayCount = 0;
  var weekCount = 0;
  var totalMoney = INITIAL_MONEY;

  function updateGameClock(dt) {
    gameMinute += dt * GAME_MINUTES_PER_SEC;
    while (gameMinute >= 60) {
      gameMinute -= 60;
      gameHour++;
    }
    if (gameHour >= CLOSE_HOUR) {
      gameDay++;
      gameHour = OPEN_HOUR;
      gameMinute = 0;
      todayCount = 0;
      if ((gameDay - 1) % 7 === 0) weekCount = 0; // 7日ごとに週間カウントもリセット
    }
  }

  function getHudState() {
    return {
      day: gameDay,
      hour: Math.floor(gameHour),
      minute: Math.floor(gameMinute),
      todayCount: todayCount,
      weekCount: weekCount,
      totalMoney: totalMoney,
    };
  }

  // 会計金額の表示用の価格表。商品データ（js/data/products.js）のbasePriceをそのまま使う。
  // "parfait"はproducts.js側では"dessert"というidなので、その価格を流用する
  // （料理アイコン自体は既存のFOOD_ASSETSのキー名に合わせてある）。
  function buildPriceLookup() {
    var byId = {};
    (Game.Data.PRODUCTS || []).forEach(function (p) {
      byId[p.id] = p.basePrice;
    });
    return {
      ramen: byId.ramen || 800,
      teishoku: byId.teishoku || 900,
      pasta: byId.pasta || 850,
      parfait: byId.dessert || 400,
      hamburger: byId.hamburger || 750,
    };
  }
  var PRICE_BY_FOOD_KEY = buildPriceLookup();

  function elNS(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        e.setAttribute(k, attrs[k]);
      });
    }
    return e;
  }

  // ================= 初期化・床 / 什器描画 =================
  function init(container) {
    container.innerHTML = "";
    svgEl = elNS("svg", { id: "scene2-svg", viewBox: "0 0 " + VIEW_W + " " + VIEW_H });
    floorG = elNS("g", { id: "scene2-floor" });
    furnitureG = elNS("g", { id: "scene2-furniture" });
    entitiesG = elNS("g", { id: "scene2-entities" });
    bubblesG = elNS("g", { id: "scene2-bubbles" });
    popupsG = elNS("g", { id: "scene2-popups" });
    svgEl.appendChild(floorG);
    svgEl.appendChild(furnitureG);
    svgEl.appendChild(entitiesG);
    svgEl.appendChild(bubblesG);
    svgEl.appendChild(popupsG);
    container.appendChild(svgEl);
    renderFloor();
    renderFurniture();
  }

  function renderFloor() {
    while (floorG.firstChild) floorG.removeChild(floorG.firstChild);
    floorG.appendChild(elNS("rect", { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: "#8a6a45" }));
    floorG.appendChild(elNS("rect", { x: 0, y: 0, width: VIEW_W, height: 30, fill: "#d8c9a8" }));
    floorG.appendChild(elNS("rect", { x: 0, y: 28, width: VIEW_W, height: 3, fill: "#b8a582" }));
    // 床に軽い板目を付けて完全な単色・グリッド無しの箱庭に見せる
    for (var y = 30; y < VIEW_H; y += 34) {
      floorG.appendChild(elNS("line", { x1: 0, y1: y, x2: VIEW_W, y2: y, stroke: "#6b4f30", "stroke-width": 1, opacity: 0.2 }));
    }
  }

  function renderFurniture() {
    while (furnitureG.firstChild) furnitureG.removeChild(furnitureG.firstChild);
    FURNITURE_LAYOUT.forEach(function (item) {
      var href = Game.Data.FurnitureAssets[item.key];
      if (!href) return;
      var img = elNS("image", {
        href: href,
        x: item.x - item.w / 2,
        y: item.y - item.h,
        width: item.w,
        height: item.h,
      });
      if (item.flip) {
        // item.x（自身の中心x）を軸に左右反転する。normal位置のまま描いたimageを
        // 包む<g>に"translate(2*cx,0) scale(-1,1)"を掛けると、その場で鏡像になる。
        var g = elNS("g", { transform: "translate(" + 2 * item.x + ",0) scale(-1,1)" });
        g.appendChild(img);
        furnitureG.appendChild(g);
      } else {
        furnitureG.appendChild(img);
      }
    });
  }

  // ================= エンティティ =================
  function spawnCustomer() {
    var id = "c" + entitySeq++;
    var foodKeys = ["ramen", "pasta", "parfait", "teishoku"];
    var ent = {
      id: id,
      kind: "customer",
      look: Game.Data.CharacterAssets.randomLook("customer_" + id + "_" + Date.now()),
      x: WORLD.entrancePoint.x,
      y: WORLD.entrancePoint.y,
      direction: "up",
      state: null,
      stateTimer: 0,
      walkPhase: 0,
      idlePhase: Math.random() * 6.28,
      holdingIcon: null,
      moveTarget: null,
      pathQueue: [],
      onArrive: null,
      orderIcon: foodKeys[Math.floor(Math.random() * foodKeys.length)],
      assignedStaff: null,
      cashierAssigned: false,
      readyToPay: false,
      seatRef: null,
      seatPoint: null,
      tableServePoint: null,
      dishPoint: null,
      // 複数人が同時に待っていても重なりすぎないよう、待機位置に個体差（ジッター）を持たせる
      // （「客が何をしているか分かりにくい」フィードバックを受け、以前よりゆとりを持たせて
      // 重なりにくくしてある）。
      lookAroundPoint: {
        x: LOOK_BASE_POINT.x + (Math.random() * 140 - 70),
        y: LOOK_BASE_POINT.y + (Math.random() * 50 - 25),
      },
      dishEl: null,
      bubbleEl: null,
      g: elNS("g", {}),
    };
    entitiesG.appendChild(ent.g);
    entities[id] = ent;
    todayCount++;
    weekCount++;
    FSM.setState(FSM.customerMachine, ent, CustomerState.ENTERING, ctx);
    return ent;
  }

  // コック：コンロの前に立ったまま、カウンターへの受け渡し以外は客席側へ一切出ない。
  function spawnCook() {
    var id = "k" + entitySeq++;
    var ent = {
      id: id,
      kind: "cook",
      role: "cook",
      look: Game.Data.CharacterAssets.staffLooks.cook,
      x: WORLD.stovePoint.x,
      y: WORLD.stovePoint.y,
      direction: "down",
      state: null,
      stateTimer: 0,
      walkPhase: 0,
      idlePhase: Math.random() * 6.28,
      holdingIcon: null,
      moveTarget: null,
      pathQueue: [],
      onArrive: null,
      currentOrder: null,
      g: elNS("g", {}),
    };
    entitiesG.appendChild(ent.g);
    entities[id] = ent;
    FSM.setState(FSM.cookMachine, ent, CookState.IDLE, ctx);
    return ent;
  }

  // ウェイター：接客・カウンターでの受け取り・配膳・会計を担当。見た目は黒服の"staff_service"。
  function spawnWaiter() {
    var id = "w" + entitySeq++;
    var ent = {
      id: id,
      kind: "waiter",
      role: "waiter",
      look: Game.Data.CharacterAssets.staffLooks.waiter,
      x: WORLD.staffHomePoint.x,
      y: WORLD.staffHomePoint.y,
      direction: "down",
      state: null,
      stateTimer: 0,
      walkPhase: 0,
      idlePhase: Math.random() * 6.28,
      holdingIcon: null,
      moveTarget: null,
      pathQueue: [],
      onArrive: null,
      partner: null,
      currentDelivery: null,
      g: elNS("g", {}),
    };
    entitiesG.appendChild(ent.g);
    entities[id] = ent;
    FSM.setState(FSM.waiterMachine, ent, WaiterState.IDLE, ctx);
    return ent;
  }

  function despawn(ent) {
    if (!entities[ent.id]) return;
    releaseSeat(ent); // 席を持ったまま退店処理に入るケース（諦めて帰る等）への保険
    if (ent.g && ent.g.parentNode) ent.g.parentNode.removeChild(ent.g);
    clearBubble(ent);
    clearDish(ent);
    delete entities[ent.id];
  }

  // ================= 席の管理（複数テーブル・複数客対応、1卓4席） =================
  function claimSeat(ent) {
    var seat = SEATS.find(function (s) {
      return !s.occupied;
    });
    if (!seat) return false;
    seat.occupied = true;
    seat.occupantId = ent.id;
    ent.seatRef = seat;
    ent.seatPoint = seat.seatPoint;
    ent.tableServePoint = seat.servePoint;
    ent.dishPoint = seat.dishPoint;
    return true;
  }
  function releaseSeat(ent) {
    if (ent.seatRef) {
      ent.seatRef.occupied = false;
      ent.seatRef.occupantId = null;
      ent.seatRef = null;
    }
    ent.dishPoint = null;
  }

  function customerCount() {
    return Object.keys(entities).filter(function (id) {
      return entities[id].kind === "customer";
    }).length;
  }

  // ================= 客の到着（ランダム間隔で自律的に発生させる） =================
  function scheduleNextArrival() {
    if (spawnTimer) clearTimeout(spawnTimer);
    var delay = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    spawnTimer = setTimeout(function () {
      if (!running) return;
      if (customerCount() < MAX_CONCURRENT_CUSTOMERS) spawnCustomer();
      scheduleNextArrival();
    }, delay);
  }

  function showBubble(ent, text) {
    clearBubble(ent);
    var t = elNS("text", { x: 0, y: -46, "font-size": 13, "text-anchor": "middle" });
    t.textContent = text;
    var wrap = elNS("g", { transform: "translate(" + ent.x + "," + ent.y + ")" });
    wrap.appendChild(t);
    bubblesG.appendChild(wrap);
    ent.bubbleEl = wrap;
  }
  function clearBubble(ent) {
    if (ent.bubbleEl && ent.bubbleEl.parentNode) ent.bubbleEl.parentNode.removeChild(ent.bubbleEl);
    ent.bubbleEl = null;
  }

  // 料理は客について回るのではなく、席ごとに固定された卓上の1点（dishPoint）に置く。
  // 一度置いたら（食べ終わってclearDishされるまで）位置は動かさない。
  function showDish(customerEnt) {
    clearDish(customerEnt);
    var href = Game.Data.FoodAssets[customerEnt.orderIcon];
    if (!href || !customerEnt.dishPoint) return;
    var img = elNS("image", { href: href, x: -11, y: -11, width: 22, height: 22 });
    var wrap = elNS("g", { transform: "translate(" + customerEnt.dishPoint.x + "," + customerEnt.dishPoint.y + ")" });
    wrap.appendChild(img);
    bubblesG.appendChild(wrap);
    customerEnt.dishEl = wrap;
  }
  function clearDish(ent) {
    if (ent.dishEl && ent.dishEl.parentNode) ent.dishEl.parentNode.removeChild(ent.dishEl);
    ent.dishEl = null;
  }

  // 会計金額をレジの位置から飛び出させる演出。特定のentityに紐付かない独立したポップアップ
  // として管理する（客はこの直後LEAVINGへ向かって歩き出してしまうため、客に追従させない）。
  function showPayment(customerEnt) {
    var price = PRICE_BY_FOOD_KEY[customerEnt.orderIcon] || 800;
    totalMoney += price; // レジのポップアップ金額と所持金を同じ瞬間に連動させる
    var text = "¥" + price.toLocaleString("ja-JP");
    var el = elNS("text", {
      x: 0,
      y: 0,
      "font-size": 16,
      "font-weight": "bold",
      "text-anchor": "middle",
      fill: "#2e7d32",
      stroke: "#ffffff",
      "stroke-width": 3,
      "paint-order": "stroke",
    });
    el.textContent = text;
    var startX = WORLD.registerPoint.x;
    var startY = WORLD.registerPoint.y - 26;
    var wrap = elNS("g", { transform: "translate(" + startX + "," + startY + ")" });
    wrap.appendChild(el);
    popupsG.appendChild(wrap);
    moneyPopups.push({ x: startX, y: startY, wrap: wrap, age: 0, life: 1100 });
  }

  function updateMoneyPopups(dtMs) {
    for (var i = moneyPopups.length - 1; i >= 0; i--) {
      var p = moneyPopups[i];
      p.age += dtMs;
      var t = Math.min(1, p.age / p.life);
      var y = p.y - 34 * t; // 上へふわっと飛び出す
      p.wrap.setAttribute("transform", "translate(" + p.x.toFixed(1) + "," + y.toFixed(1) + ")");
      p.wrap.setAttribute("opacity", (1 - t).toFixed(2));
      if (p.age >= p.life) {
        if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
        moneyPopups.splice(i, 1);
      }
    }
  }

  // 移動する方向は必ずdx==0またはdy==0（軸移動のみ）になる前提の関数。
  // 斜め移動をやめたことで「大きい方の軸を採用する」曖昧な判定が不要になり、
  // 実際に動いている軸をそのまま向きにできる（動いていなければ直前の向きを保つ）。
  function directionFromDelta(dx, dy, fallback) {
    if (dx > 0) return "right";
    if (dx < 0) return "left";
    if (dy > 0) return "down";
    if (dy < 0) return "up";
    return fallback || "down";
  }

  // ================= 卓を避ける経路計画（斜め移動禁止・軸移動のみ） =================
  // テーブルは3卓とも同じ帯（y方向の範囲）に収まっているので、「横移動はこの帯の外でしか
  // 行わない」「帯を縦に横切る時は必ず卓と卓の隙間(通路)のxを通る」という2つのルールだけで、
  // 最短距離ではないが必ずどの卓にも重ならない経路を組み立てられる。
  // （唯一の例外は「目的地自身の列（x）」への最後の直進で、これは配膳・着席・カウンターでの
  // 受け渡しという演出上意図した進入なので許可している。SEATSのseatPointは全てどの卓の
  // 横幅からも外れた列になるよう設計してあるので、この直進が実際に卓と重なることは無い。）
  var TABLE_BAND_TOP = 100; // これより上（小さい値）は全卓・全椅子の天面より上＝安全
  var TABLE_BAND_BOTTOM = 236; // これより下（大きい値）は全卓・全椅子の脚元より下＝安全
  var TABLE_BAND_MID = (TABLE_BAND_TOP + TABLE_BAND_BOTTOM) / 2;
  // 卓と卓の間、および卓列の両端の「安全に縦移動できるx」。TABLE_XS（380/520/660）と
  // 卓の半幅(24)から見て、確実に卓の外側になる値を選んでいる。
  var CORRIDOR_XS = [280, 450, 590, 720];

  function inTableBand(y) {
    return y > TABLE_BAND_TOP && y < TABLE_BAND_BOTTOM;
  }

  function nearestCorridorX(x) {
    var best = CORRIDOR_XS[0];
    for (var i = 1; i < CORRIDOR_XS.length; i++) {
      if (Math.abs(x - CORRIDOR_XS[i]) < Math.abs(x - best)) best = CORRIDOR_XS[i];
    }
    return best;
  }

  // from→to を「軸移動だけを繋いだ通過点の配列」に変換する。戻り値は
  // [{x,y}, {x,y}, ...]（fromは含まない、toで必ず終わる）。
  function planAxisPath(from, to) {
    var pts = [];
    var cur = { x: from.x, y: from.y };

    function moveH(x) {
      if (x !== cur.x) {
        pts.push({ x: x, y: cur.y });
        cur = { x: x, y: cur.y };
      }
    }
    function moveV(y) {
      if (y !== cur.y) {
        pts.push({ x: cur.x, y: y });
        cur = { x: cur.x, y: y };
      }
    }

    // (1) 出発点が卓の帯の中（配膳位置・着席位置・カウンター等）にある場合は、
    //     まず同じxのまま帯の外（近い方）へ抜けてから経路計画を始める。
    if (inTableBand(cur.y)) {
      moveV(cur.y < TABLE_BAND_MID ? TABLE_BAND_TOP - 24 : TABLE_BAND_BOTTOM + 24);
    }

    var destInBand = inTableBand(to.y);
    // 目的地が帯の中なら、帯の外側の「手前の高さ」を経由してから最後に直進で入る。
    // 帯の外ならそのままtoのyが目的の高さ。
    var approachY = destInBand ? (to.y < TABLE_BAND_MID ? TABLE_BAND_TOP - 24 : TABLE_BAND_BOTTOM + 24) : to.y;
    var curSide = cur.y <= TABLE_BAND_TOP ? "upper" : "lower";
    var destSide = approachY <= TABLE_BAND_TOP ? "upper" : "lower";

    if (curSide === destSide) {
      // 帯を跨がない: 今の高さのまま目的のxへ横移動 → 目的の高さへ縦移動。
      // 縦移動の区間は「目的地自身のx」上だけを通るので、その卓自身への進入としてOK。
      moveH(to.x);
      moveV(approachY);
    } else {
      // 帯の反対側へ移動する: 卓と卓の隙間(通路)のxまで横移動 → そのxのまま縦移動で
      // 帯を通過 → 目的のxまで横移動、という3区間で他の卓を避ける。
      var cx = nearestCorridorX(to.x);
      moveH(cx);
      moveV(approachY);
      moveH(to.x);
    }

    // (2) 目的地自体が帯の中なら、最後に同じxのまま真っ直ぐ入る。
    if (destInBand) {
      moveV(to.y);
    }

    return pts;
  }

  // ================= ctx（FSMから呼ばれる「世界」との接続口） =================
  var ctx = {
    world: WORLD,
    moveTo: function (ent, target, onArrive) {
      ent.onArrive = onArrive || null;
      // 斜め移動をしないため、目的地までを軸移動だけの経路（通過点の配列）に
      // 分解しておく。卓を避ける計画もここでまとめて行う（=毎フレームの計算ではなく
      // 移動開始時に1回だけなので、通過点が増えても性能への影響はない）。
      var path = planAxisPath({ x: ent.x, y: ent.y }, target);
      if (path.length === 0) {
        ent.moveTarget = null;
        ent.pathQueue = [];
        if (onArrive) onArrive();
        return;
      }
      ent.moveTarget = path[0];
      ent.pathQueue = path.slice(1);
      ent.direction = directionFromDelta(ent.moveTarget.x - ent.x, ent.moveTarget.y - ent.y, ent.direction);
    },
    holdIcon: function (ent, iconKey) {
      if (!iconKey) {
        ent.holdingIcon = null;
        return;
      }
      ent.holdingIcon = Game.Data.FoodAssets[iconKey] ? { type: "food", key: iconKey } : { type: "ui", key: iconKey };
    },
    showDish: showDish,
    clearDish: clearDish,
    showPayment: showPayment,
    despawn: despawn,
    claimSeat: claimSeat,
    releaseSeat: releaseSeat,
    getEntity: function (id) {
      return entities[id] || null;
    },
    queueOrder: function (customerEnt) {
      kitchenQueue.push({ customerId: customerEnt.id, foodKey: customerEnt.orderIcon });
    },
    hasKitchenOrder: function () {
      return kitchenQueue.length > 0;
    },
    popKitchenOrder: function () {
      return kitchenQueue.shift();
    },
    placeReadyItem: function (order) {
      readyQueue.push(order);
    },
    hasReadyItem: function () {
      return readyQueue.length > 0;
    },
    popReadyItem: function () {
      return readyQueue.shift();
    },
  };

  // 客が「今何をしているか」を常に頭上のアイコンで分かるようにする（「客が何をしているか
  // 分からない、急に消えたように見える」というフィードバックへの対応）。状態が変わる
  // たびに対応するアイコンへ即座に切り替え、次に状態が変わるまで表示し続ける。
  var CUSTOMER_STATE_BUBBLES = {};
  CUSTOMER_STATE_BUBBLES[CustomerState.LOOKING_FOR_SEAT] = "👀"; // 席を探している
  CUSTOMER_STATE_BUBBLES[CustomerState.WAITING_FOR_ORDER] = "⏳"; // 注文を取りに来てもらうのを待っている
  CUSTOMER_STATE_BUBBLES[CustomerState.ORDERING] = "📝"; // 注文中
  CUSTOMER_STATE_BUBBLES[CustomerState.WAITING_FOR_FOOD] = "🍳"; // 料理を待っている
  CUSTOMER_STATE_BUBBLES[CustomerState.EATING] = "🍴"; // 食事中
  CUSTOMER_STATE_BUBBLES[CustomerState.PAYING] = "💴"; // 会計中
  CUSTOMER_STATE_BUBBLES[CustomerState.LEAVING] = "👋"; // 退店中（消えたのではなく歩いて帰っている）

  var WAITER_STATE_BUBBLES = {};
  WAITER_STATE_BUBBLES[WaiterState.NOTICE_CUSTOMER] = "❕";
  WAITER_STATE_BUBBLES[WaiterState.CASHIER] = "💴";

  var lastAnnouncedState = {};
  function announceStateChanges() {
    Object.keys(entities).forEach(function (id) {
      var ent = entities[id];
      if (lastAnnouncedState[id] === ent.state) return;
      lastAnnouncedState[id] = ent.state;
      var bubble = null;
      if (ent.kind === "customer") bubble = CUSTOMER_STATE_BUBBLES[ent.state] || null;
      else if (ent.kind === "waiter") bubble = WAITER_STATE_BUBBLES[ent.state] || null;
      if (bubble) showBubble(ent, bubble);
      else clearBubble(ent);
    });
  }

  // ================= メインループ =================
  function tick(now) {
    if (!running) return;
    var dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    var dtMs = dt * 1000;

    var customers = [],
      staffList = [];
    Object.keys(entities).forEach(function (id) {
      var ent = entities[id];
      if (ent.kind === "customer") customers.push(ent);
      else staffList.push(ent); // cook・waiterの両方。役割ごとの振り分けはFSM.dispatch内で行う
    });

    FSM.dispatch(customers, staffList, ctx);

    Object.keys(entities).forEach(function (id) {
      var ent = entities[id];
      var machine = ent.kind === "customer" ? FSM.customerMachine : ent.kind === "cook" ? FSM.cookMachine : FSM.waiterMachine;
      updateMovement(ent, dt);
      FSM.tick(machine, ent, dtMs, ctx);
    });

    announceStateChanges();
    updateMoneyPopups(dtMs);
    updateGameClock(dt);

    Object.keys(entities).forEach(function (id) {
      redrawEntity(entities[id], dt);
    });

    rafHandle = requestAnimationFrame(tick);
  }

  // 1回の呼び出しでは「今向かっている1区間（ent.moveTarget）」だけを軸移動で進める。
  // 区間の終わりに着いたら、まだ経路が残っていれば次の区間（ent.pathQueue）に進み、
  // 無ければ最終目的地に到着したものとしてonArriveを呼ぶ。区間同士は必ずdx==0か
  // dy==0（planAxisPathが保証）なので、この関数は斜めには一切動かない。
  function updateMovement(ent, dt) {
    if (!ent.moveTarget) {
      ent.idlePhase += dt * IDLE_PHASE_RATE;
      return;
    }
    var dx = ent.moveTarget.x - ent.x,
      dy = ent.moveTarget.y - ent.y;
    var dist = Math.abs(dx) + Math.abs(dy); // 軸移動のみなのでマンハッタン距離でよい
    var step = WALK_SPEED * dt;
    if (dist <= step || dist === 0) {
      ent.x = ent.moveTarget.x;
      ent.y = ent.moveTarget.y;
      if (ent.pathQueue && ent.pathQueue.length > 0) {
        ent.moveTarget = ent.pathQueue.shift();
        ent.direction = directionFromDelta(ent.moveTarget.x - ent.x, ent.moveTarget.y - ent.y, ent.direction);
      } else {
        ent.moveTarget = null;
        ent.walkPhase = 0;
        var cb = ent.onArrive;
        ent.onArrive = null;
        if (cb) cb();
      }
    } else {
      // dx,dyのどちらか一方は必ず0（軸移動）なので、そのまま加算するだけで斜めにならない。
      if (dx !== 0) ent.x += Math.sign(dx) * Math.min(step, Math.abs(dx));
      else ent.y += Math.sign(dy) * Math.min(step, Math.abs(dy));
      ent.walkPhase += dt * WALK_PHASE_RATE;
    }
  }

  function animKindFor(ent) {
    var defs = Game.Data.AnimationDefinitions[ent.kind];
    var def = defs && defs[ent.state];
    return def ? def.anim : Game.Data.AnimationKind.IDLE;
  }

  function holdingIconHref(ent) {
    if (!ent.holdingIcon) return null;
    if (ent.holdingIcon.type === "food") return Game.Data.FoodAssets[ent.holdingIcon.key];
    return Game.Data.UiAssets[ent.holdingIcon.key];
  }

  function redrawEntity(ent) {
    var html = Game.UI.ActorSprite.build(ent.look, {
      direction: ent.direction,
      animKind: animKindFor(ent),
      phase: ent.walkPhase,
      idlePhase: ent.idlePhase,
      holdingIconHref: holdingIconHref(ent),
    });
    ent.g.innerHTML = html;
    ent.g.setAttribute("transform", "translate(" + ent.x.toFixed(1) + "," + ent.y.toFixed(1) + ")");
    if (ent.bubbleEl) ent.bubbleEl.setAttribute("transform", "translate(" + ent.x.toFixed(1) + "," + ent.y.toFixed(1) + ")");
    // dishElは席に固定（dishPoint）なので、customerが動いてもここで追従させる必要はない。
  }

  // ================= 公開API =================
  function start(container) {
    init(container);
    Object.keys(entities).forEach(function (id) {
      despawn(entities[id]);
    });
    SEATS.forEach(function (s) {
      s.occupied = false;
      s.occupantId = null;
    });
    kitchenQueue = [];
    readyQueue = [];
    moneyPopups = [];
    lastAnnouncedState = {};
    gameDay = 1;
    gameHour = OPEN_HOUR;
    gameMinute = 0;
    todayCount = 0;
    weekCount = 0;
    totalMoney = INITIAL_MONEY;
    running = true;
    spawnCook();
    spawnWaiter();
    spawnCustomer(); // 最初の1人はすぐ入店させ、以降はscheduleNextArrivalに任せる
    scheduleNextArrival();
    lastFrameTime = performance.now();
    rafHandle = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
    if (spawnTimer) clearTimeout(spawnTimer);
  }

  // Playwright等からの検証用: 現在の各エンティティの状態を読み取れるようにする（表示には無関係）。
  function getDebugState() {
    var out = { customers: [], staff: [] };
    Object.keys(entities).forEach(function (id) {
      var ent = entities[id];
      var row = { id: ent.id, role: ent.role || null, state: ent.state, x: Math.round(ent.x), y: Math.round(ent.y) };
      if (ent.kind === "customer") out.customers.push(row);
      else out.staff.push(row);
    });
    return out;
  }

  Game.UI.SceneV2 = {
    init: init,
    start: start,
    stop: stop,
    getDebugState: getDebugState,
    getHudState: getHudState,
  };
})();
