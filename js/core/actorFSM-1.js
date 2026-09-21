// actorFSM.js — Customer / Cook / Waiter の「状態」そのものを表す純粋なロジック層。
// ここには画像・DOM・SVGへの参照は一切出てこない（表示側は ui/actorSprite.js が別に担当する）。
// 例：Customer.state が "WAITING_FOR_FOOD" になったら、表示側がそれを読んで
//     「料理待ちのポーズ」を描画するだけであり、このファイル自身は「どう見えるか」を知らない。
//
// v4差し替えメモ（コック/ウェイター2人体制化）:
//   これまでは1人のスタッフが「注文を取る→厨房で作る→運ぶ→会計する」を全部兼務していたが、
//   「キッチン用カウンターからウェイターが受け取る形にして」というご要望を受け、役割を
//   完全に分離した。コック（役割: "cook"）はコンロ(stovePoint)に立ったまま一切テーブルへは
//   出ず、出来上がった料理をカウンター(counterPoint)に置くところまでだけを担当する。
//   ウェイター（役割: "waiter"）は接客・カウンターでの受け取り・配膳・会計を担当し、
//   コンロには一切近づかない。両者は「厨房の注文キュー」「カウンターの受け取り待ちキュー」
//   という2つの共有キュー（ctx側が実装）を介して間接的にやり取りする（＝コックとウェイターは
//   お互いの状態を直接参照しない。疎結合を保つため）。
//
// 状態遷移には2種類ある：
//   1. 時間経過で自動的に次へ進むもの（duration + onTimerDone）
//      例：SITTING（座った直後の一呼吸）、WORKING（調理時間）
//   2. 「移動の完了」または「相手（客⇔スタッフ）からの合図」で進むもの
//      例：WALKING_TO_SEAT（着いたら座る）、WAITING_FOR_ORDER（スタッフが来るまで待つ）
// 後者は onEnter の中で ctx.moveTo(...) や ctx.wait(...) を呼び、コールバックの中で
// 明示的に Game.Core.FSM.setState(...) を呼ぶ形にしている。
//
// ctx（sceneV2.js が実装して渡す「世界」とのやり取り口）が持つべきもの:
//   ctx.moveTo(ent, targetPoint, onArrive)  … ent をtargetPointまで歩かせ、着いたらonArrive()を呼ぶ
//   ctx.holdIcon(ent, iconKeyOrNull)        … 手に持つアイコン（料理・お金など）の表示切り替え
//   ctx.showDish(customerEnt)               … 客のテーブルに料理を置く演出（座席のdishPoint固定）
//   ctx.clearDish(ent)
//   ctx.showPayment(customerEnt)            … レジで会計した金額をレジから飛び出させる演出
//   ctx.despawn(ent)
//   ctx.getEntity(id)                       … idからentity（客/コック/ウェイター）を引く
//   ctx.queueOrder(customerEnt)             … 厨房の注文キューに1件積む（ウェイターが呼ぶ）
//   ctx.hasKitchenOrder() / popKitchenOrder() … 厨房キューの有無取得・1件取り出す（コックが呼ぶ）
//   ctx.hasReadyItem() / popReadyItem()     … カウンターの受け取り待ちの有無取得・1件取り出す
//                                              （ウェイターが呼ぶ。コックのPLACINGが積む）
//   ctx.world … 店全体で共有の固定ポイント
//               { entrancePoint, registerPoint, stovePoint, counterPoint, staffHomePoint }
// 客・スタッフごとに違う地点（席・接客位置など）はentity自身が持つ:
//   customer.lookAroundPoint, customer.seatPoint, customer.tableServePoint（ウェイターが接客に
//   立つ位置）, customer.dishPoint（料理を置くテーブル上の固定位置）
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  var CustomerState = {
    ENTERING: "ENTERING",
    LOOKING_FOR_SEAT: "LOOKING_FOR_SEAT",
    WALKING_TO_SEAT: "WALKING_TO_SEAT",
    SITTING: "SITTING",
    WAITING_FOR_ORDER: "WAITING_FOR_ORDER",
    ORDERING: "ORDERING",
    WAITING_FOR_FOOD: "WAITING_FOR_FOOD",
    EATING: "EATING",
    PAYING: "PAYING",
    LEAVING: "LEAVING",
  };

  // コック（厨房専任。コンロとカウンターの間だけを行き来し、客席には出ない）。
  var CookState = {
    IDLE: "IDLE", // コンロの前で次の注文を待っている
    WORKING: "WORKING", // 調理中
    PLACING: "PLACING", // カウンターへ置きに行って、コンロへ戻るまで
  };

  // ウェイター（接客・カウンターでの受け取り・配膳・会計を担当。コンロには近づかない）。
  var WaiterState = {
    IDLE: "IDLE",
    NOTICE_CUSTOMER: "NOTICE_CUSTOMER",
    WALKING_TO_CUSTOMER: "WALKING_TO_CUSTOMER",
    TAKING_ORDER: "TAKING_ORDER",
    WALKING_TO_COUNTER: "WALKING_TO_COUNTER", // カウンターへ料理を受け取りに向かう
    CARRYING_FOOD: "CARRYING_FOOD", // 受け取ってテーブルへ運んでいる
    SERVING: "SERVING",
    CASHIER: "CASHIER",
    RESTING: "RESTING",
  };

  // 「もっさりしている」というフィードバックを受けて、各状態の待ち時間を一括で調整できるように
  // 倍率化してある。1.0が導入当初の速度、値を小さくするほど全体がきびきび動く。
  var PACE = 0.28;

  // 複数客が同時進行するステージ2向けの「我慢の限界」設定。PACEとは別枠で調整できるようにし、
  // 「スタッフの手が足りない→客が待たされる→諦めて帰る」というボトルネックが実際に見える
  // ようにしてある（数字やログだけでなく、客が本当に帰っていく形で表現する）。
  var SEAT_RETRY_INTERVAL = 420; // 満席の時、これだけ待って再度空席を探す
  var SEAT_MAX_RETRIES = 9; // 約9回（≒3.8秒）探しても座れなければ諦めて帰る
  var ORDER_WAIT_PATIENCE = 6500; // 席についてから注文を取りに来てもらえるまでの我慢の限界
  var FOOD_WAIT_PATIENCE = 8000; // 注文してから料理が来るまでの我慢の限界

  // ================= 汎用FSMランナー =================
  function setState(machine, ent, newState, ctx) {
    ent.state = newState;
    ent.stateTimer = 0;
    var def = machine[newState];
    if (def && def.onEnter) def.onEnter(ent, ctx);
  }

  // 複数客が同時進行するようになったため、スタッフが接客・配膳に向かう途中で
  // その客が痺れを切らして帰ってしまっている可能性がある。その場合はムダな給仕をせず
  // 持ち場に戻れるようにするための判定（担当客がまだ有効かどうか）。
  function isServableCustomer(cust) {
    return !!cust && cust.state !== CustomerState.LEAVING;
  }

  function tick(machine, ent, dtMs, ctx) {
    var def = machine[ent.state];
    if (!def) return;
    ent.stateTimer += dtMs;
    if (def.duration != null && def.onTimerDone && ent.stateTimer >= def.duration) {
      def.onTimerDone(ent, ctx);
    }
  }

  // ================= Customer 状態遷移表 =================
  var customerMachine = {};
  customerMachine[CustomerState.ENTERING] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ent.lookAroundPoint || ctx.world.entrancePoint, function () {
        setState(customerMachine, ent, CustomerState.LOOKING_FOR_SEAT, ctx);
      });
    },
  };
  customerMachine[CustomerState.LOOKING_FOR_SEAT] = {
    // 空席があればすぐ確保してWALKING_TO_SEATへ。満席なら少し待って再挑戦し、
    // それでもダメなら（SEAT_MAX_RETRIES回）諦めて帰る＝ボトルネックが「客が帰る」形で見える。
    onEnter: function (ent, ctx) {
      if (ctx.claimSeat(ent)) {
        setState(customerMachine, ent, CustomerState.WALKING_TO_SEAT, ctx);
      }
    },
    duration: SEAT_RETRY_INTERVAL,
    onTimerDone: function (ent, ctx) {
      ent.seatRetries = (ent.seatRetries || 0) + 1;
      if (ent.seatRetries > SEAT_MAX_RETRIES) {
        setState(customerMachine, ent, CustomerState.LEAVING, ctx);
        return;
      }
      setState(customerMachine, ent, CustomerState.LOOKING_FOR_SEAT, ctx); // 再挑戦
    },
  };
  customerMachine[CustomerState.WALKING_TO_SEAT] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ent.seatPoint, function () {
        setState(customerMachine, ent, CustomerState.SITTING, ctx);
      });
    },
  };
  customerMachine[CustomerState.SITTING] = {
    duration: 350 * PACE, // 座った直後の一呼吸
    onTimerDone: function (ent, ctx) {
      setState(customerMachine, ent, CustomerState.WAITING_FOR_ORDER, ctx);
    },
  };
  customerMachine[CustomerState.WAITING_FOR_ORDER] = {
    // 通常はウェイターがTAKING_ORDERに入ったタイミングで外部（waiterMachine側）から
    // ORDERINGへ遷移させられる。ただし、その前にORDER_WAIT_PATIENCEを超えて待たされた
    // 場合は、ウェイターが来ないまま諦めて帰る（席は解放する）。
    duration: ORDER_WAIT_PATIENCE,
    onTimerDone: function (ent, ctx) {
      ctx.releaseSeat(ent);
      setState(customerMachine, ent, CustomerState.LEAVING, ctx);
    },
  };
  customerMachine[CustomerState.ORDERING] = {
    duration: 700 * PACE, // ウェイターの接客と同じ長さ（向き合う間）
    onTimerDone: function (ent, ctx) {
      setState(customerMachine, ent, CustomerState.WAITING_FOR_FOOD, ctx);
    },
  };
  customerMachine[CustomerState.WAITING_FOR_FOOD] = {
    // 通常はウェイターがSERVINGに入ったタイミングで外部からEATINGへ遷移させられる。
    // FOOD_WAIT_PATIENCEを超えて料理が来ない場合は、注文だけして帰ってしまう
    // （厨房のボトルネックがここでも「客が帰る」形で見える）。
    duration: FOOD_WAIT_PATIENCE,
    onTimerDone: function (ent, ctx) {
      ctx.releaseSeat(ent);
      setState(customerMachine, ent, CustomerState.LEAVING, ctx);
    },
  };
  customerMachine[CustomerState.EATING] = {
    duration: 2200 * PACE, // 数口ぶんの食事アニメーション
    onTimerDone: function (ent, ctx) {
      ctx.clearDish(ent);
      ctx.releaseSeat(ent); // 席を立ってレジへ向かうので、ここで次の客に席を譲る
      setState(customerMachine, ent, CustomerState.PAYING, ctx);
    },
  };
  customerMachine[CustomerState.PAYING] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ctx.world.registerPoint, function () {
        ent.readyToPay = true; // レジで待機。ウェイターのCASHIER完了で外部からLEAVINGへ遷移させられる。
      });
    },
  };
  customerMachine[CustomerState.LEAVING] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ctx.world.entrancePoint, function () {
        ctx.despawn(ent);
      });
    },
  };

  // ================= Cook 状態遷移表（厨房専任。客席には出ない） =================
  var cookMachine = {};
  cookMachine[CookState.IDLE] = {
    // 世界側（sceneV2.js）が毎フレーム「厨房の注文キューに未着手の注文が無いか」を見て、
    // 居ればここから直接 WORKING に遷移させる（駆動はscene側、遷移表はここに集約）。
    // コンロの前に立ったままなので移動は発生しない。
  };
  cookMachine[CookState.WORKING] = {
    duration: 1200 * PACE,
    onTimerDone: function (ent, ctx) {
      setState(cookMachine, ent, CookState.PLACING, ctx);
    },
  };
  cookMachine[CookState.PLACING] = {
    // 出来上がった皿を持ってカウンターまで置きに行き、置いたらコンロへ戻る。
    // 客がまだ有効かどうかはここでは見ない（厨房はキュー経由でしか客を知らず、
    // 「注文された以上は作ってカウンターに置く」までが仕事。受け取る/受け取らないの
    // 判断はカウンター側＝ウェイターのCARRYING_FOODに任せる）。
    onEnter: function (ent, ctx) {
      var order = ent.currentOrder;
      ctx.holdIcon(ent, order ? order.foodKey : null);
      ctx.moveTo(ent, ctx.world.counterPoint, function () {
        ctx.holdIcon(ent, null);
        if (order) ctx.placeReadyItem(order);
        ent.currentOrder = null;
        ctx.moveTo(ent, ctx.world.stovePoint, function () {
          setState(cookMachine, ent, CookState.IDLE, ctx);
        });
      });
    },
  };

  // ================= Waiter 状態遷移表（接客・受け取り・配膳・会計） =================
  var waiterMachine = {};
  waiterMachine[WaiterState.IDLE] = {
    // 世界側が毎フレーム「カウンターに受け取り待ちが無いか／会計待ちの客がいないか／
    // 注文を取っていない客がいないか」を優先順（配膳→会計→注文の順）に見て、
    // 居ればここから直接次の状態へ遷移させる。
  };
  waiterMachine[WaiterState.NOTICE_CUSTOMER] = {
    duration: 300 * PACE, // 「あ、お客さんだ」の一拍
    onTimerDone: function (ent, ctx) {
      setState(waiterMachine, ent, WaiterState.WALKING_TO_CUSTOMER, ctx);
    },
  };
  waiterMachine[WaiterState.WALKING_TO_CUSTOMER] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ent.partner.tableServePoint, function () {
        // 移動している間に、担当客が痺れを切らして帰ってしまっている可能性がある。
        // その場合は空席へ接客に行っても意味がないので、そのまま持ち場へ戻る。
        if (!isServableCustomer(ent.partner)) {
          setState(waiterMachine, ent, WaiterState.RESTING, ctx);
          return;
        }
        setState(waiterMachine, ent, WaiterState.TAKING_ORDER, ctx);
        setState(customerMachine, ent.partner, CustomerState.ORDERING, ctx);
      });
    },
  };
  waiterMachine[WaiterState.TAKING_ORDER] = {
    duration: 700 * PACE,
    onTimerDone: function (ent, ctx) {
      // 自分で作りに行くのではなく、厨房の注文キューに積むだけ。実際に作るのはコック。
      if (isServableCustomer(ent.partner)) ctx.queueOrder(ent.partner);
      ent.partner = null;
      setState(waiterMachine, ent, WaiterState.RESTING, ctx);
    },
  };
  waiterMachine[WaiterState.WALKING_TO_COUNTER] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ctx.world.counterPoint, function () {
        setState(waiterMachine, ent, WaiterState.CARRYING_FOOD, ctx);
      });
    },
  };
  waiterMachine[WaiterState.CARRYING_FOOD] = {
    onEnter: function (ent, ctx) {
      var item = ent.currentDelivery;
      var cust = item ? ctx.getEntity(item.customerId) : null;
      // カウンターに取りに来た時点で、届け先の客がもう帰ってしまっている場合がある。
      // 運ぶ相手がいないので、皿は出さずに持ち場へ戻る（出しっぱなしのゴミ要素を防ぐ）。
      if (!isServableCustomer(cust)) {
        ent.currentDelivery = null;
        setState(waiterMachine, ent, WaiterState.RESTING, ctx);
        return;
      }
      ent.partner = cust;
      ctx.holdIcon(ent, item.foodKey);
      ctx.moveTo(ent, cust.tableServePoint, function () {
        setState(waiterMachine, ent, WaiterState.SERVING, ctx);
      });
    },
  };
  waiterMachine[WaiterState.SERVING] = {
    duration: 400 * PACE,
    onTimerDone: function (ent, ctx) {
      ctx.holdIcon(ent, null);
      // 運んでいる間に客が帰ってしまっていた場合、料理を置く相手がいないので
      // 皿を出さない。
      if (isServableCustomer(ent.partner)) {
        ctx.showDish(ent.partner); // テーブル上の固定位置（dishPoint）に置く
        setState(customerMachine, ent.partner, CustomerState.EATING, ctx);
      }
      ent.currentDelivery = null;
      ent.partner = null;
      setState(waiterMachine, ent, WaiterState.RESTING, ctx);
    },
  };
  waiterMachine[WaiterState.RESTING] = {
    onEnter: function (ent, ctx) {
      ctx.moveTo(ent, ctx.world.staffHomePoint, function () {
        setState(waiterMachine, ent, WaiterState.IDLE, ctx);
      });
    },
  };
  waiterMachine[WaiterState.CASHIER] = {
    // レジまで歩く区間と、レジに着いてからの会計待ち区間の両方をこの1状態でまかなう。
    // ここで重要なのは、dispatch()からこのstateへ入った瞬間にent.stateが"IDLE"では
    // なくなること。以前はdispatch()がsetStateを経由せず直接ctx.moveTo()だけを呼んで
    // いたため、歩いている間ずっとent.state==="IDLE"のままになり、その隙に別の客へ
    // 同じウェイターを二重に割り当ててしまう（＝最初の客が会計されずPAYINGのまま
    // 永久に取り残される）というバグがあった。
    onEnter: function (ent, ctx) {
      ent.cashierArrived = false;
      ctx.moveTo(ent, ctx.world.registerPoint, function () {
        ent.cashierArrived = true;
        ent.stateTimer = 0; // レジに着いてから改めて会計時間の計測を始める
        ctx.holdIcon(ent, "coin");
      });
    },
    duration: 500 * PACE,
    onTimerDone: function (ent, ctx) {
      if (!ent.cashierArrived) return; // まだレジへ移動中。到着してから改めて計測する
      ent.cashierArrived = false;
      ctx.holdIcon(ent, null);
      if (isServableCustomer(ent.partner)) {
        ctx.showPayment(ent.partner); // 会計金額をレジから飛び出させる演出
        setState(customerMachine, ent.partner, CustomerState.LEAVING, ctx);
      }
      if (ent.partner) ent.partner.readyToPay = false;
      ent.partner = null;
      setState(waiterMachine, ent, WaiterState.RESTING, ctx); // 持ち場へ戻ってからIDLEになる
    },
  };

  // 世界側（sceneV2.js）のtickループから毎フレーム呼ばれる「誰が誰を担当するか」の
  // 簡易ディスパッチ。コックとウェイターは役割（ent.role）で完全に別枠として扱う。
  //   コック: 厨房キューに未着手の注文があれば、空いているコックが取って作り始める。
  //   ウェイター: 優先順位「①カウンターの受け取り待ちを配膳 → ②会計待ちの客をレジへ
  //   ③注文を取っていない客のもとへ」で、空いているウェイターに仕事を割り当てる。
  //   優先順位をこの順にしているのは、①は出来上がった料理を放置しない（冷めない）ため、
  //   ②は席を早く回転させるため。
  function dispatch(customers, staffList, ctx) {
    var cooks = staffList.filter(function (s) {
      return s.role === "cook";
    });
    var waiters = staffList.filter(function (s) {
      return s.role === "waiter";
    });

    cooks.forEach(function (cook) {
      if (cook.state === CookState.IDLE && ctx.hasKitchenOrder()) {
        cook.currentOrder = ctx.popKitchenOrder();
        setState(cookMachine, cook, CookState.WORKING, ctx);
      }
    });

    waiters.forEach(function (waiter) {
      if (waiter.state !== WaiterState.IDLE) return;

      if (ctx.hasReadyItem()) {
        waiter.currentDelivery = ctx.popReadyItem();
        setState(waiterMachine, waiter, WaiterState.WALKING_TO_COUNTER, ctx);
        return;
      }

      var payingCust = customers.find(function (c) {
        return c.state === CustomerState.PAYING && c.readyToPay && !c.cashierAssigned;
      });
      if (payingCust) {
        payingCust.cashierAssigned = true;
        waiter.partner = payingCust;
        // 直接ctx.moveTo()を呼ぶのではなく、setState()でCASHIERへ即座に遷移させる
        // （実際の移動開始はCASHIER.onEnter内で行う。理由は上のコメント参照）。
        setState(waiterMachine, waiter, WaiterState.CASHIER, ctx);
        return;
      }

      var waitingCust = customers.find(function (c) {
        return c.state === CustomerState.WAITING_FOR_ORDER && !c.assignedStaff;
      });
      if (waitingCust) {
        waitingCust.assignedStaff = waiter;
        waiter.partner = waitingCust;
        setState(waiterMachine, waiter, WaiterState.NOTICE_CUSTOMER, ctx);
      }
    });
  }

  Game.Core.CustomerState = CustomerState;
  Game.Core.CookState = CookState;
  Game.Core.WaiterState = WaiterState;
  Game.Core.FSM = {
    customerMachine: customerMachine,
    cookMachine: cookMachine,
    waiterMachine: waiterMachine,
    setState: setState,
    tick: tick,
    dispatch: dispatch,
  };
})();
