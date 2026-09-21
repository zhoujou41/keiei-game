// actorSprite.js — LimeZu "Modern Interiors"由来キャラ画像(PNG)の描画エンジン。
// v3で「パーツ合成」から「役割ごとの完成画像を1枚表示」に変更した（assetManifest.js参照）。
// ここは「見た目」だけを担当する。Customer/Staffの状態（core/actorFSM.js）を直接は知らず、
// 呼び出し側（ui/sceneV2.js）から {direction, animKind, phase, idlePhase, holdingIconHref} を
// 受け取って、その通りに絵を組み立てるだけ（=ゲームロジックとレンダリングの分離）。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var CANVAS = 32; // 素材の基準キャンバスサイズ（LimeZu Legacyキャラ、32x32セルで統一済み）
  var ANCHOR_X = 16; // 画像内でのキャラクターの水平中心（32pxキャンバスの中央）
  var ANCHOR_Y = 31; // 画像内でのキャラクターの足元（キャンバス下端。素材は下揃えで配置済み）
  var DISPLAY_SCALE = 1.4; // 32pxキャンバスをゲーム内座標系（CELL=40）にどれだけ拡大して出すか

  var AnimationKind = Game.Data.AnimationKind;

  // 状態カテゴリ（animKind）ごとに、位相（phase / idlePhase）から
  // 「そのフレームでの見た目のブレ」を計算する。パーツ画像は静止画のままなので、
  // 全身を包む<g>への小さな平行移動・回転だけで「歩いている」「食べている」等を表現する。
  function computeAnimOffset(animKind, phase, idlePhase, dt) {
    var ty = 0,
      rot = 0;
    switch (animKind) {
      case AnimationKind.WALK:
      case AnimationKind.WALK_CARRY:
        ty = -Math.abs(Math.sin(phase)) * 3.4; // 二歩で一往復、足取りのバウンド
        rot = Math.sin(phase) * 3.2; // 左右への軽い揺れ
        break;
      case AnimationKind.IDLE:
      case AnimationKind.SIT_IDLE:
        ty = -Math.abs(Math.sin(idlePhase)) * 1.1; // ゆっくりした呼吸
        break;
      case AnimationKind.IDLE_ALERT:
        ty = -Math.abs(Math.sin(idlePhase * 3)) * 1.6; // 少し慌てた感じの速い呼吸
        break;
      case AnimationKind.SIT_TALK:
      case AnimationKind.STAND_TALK:
        rot = Math.sin(phase * 2) * 3; // 向き合って話す時の小さな頷き
        ty = -Math.abs(Math.sin(idlePhase)) * 0.8;
        break;
      case AnimationKind.SIT_EAT:
        rot = Math.sin(phase * 6) * 5.5; // 一口ごとの頷き
        ty = -Math.abs(Math.sin(phase * 6)) * 1.4;
        break;
      case AnimationKind.COOK:
        rot = Math.sin(phase * 4) * 5; // 調理中の小刻みな体の揺れ
        ty = -Math.abs(Math.sin(phase * 4)) * 1.8;
        break;
    }
    return { ty: ty, rot: rot };
  }

  // 「歩いている」状態なのか「その場に留まっている」状態なのかで、使うコマ集合
  // （walk画像6枚 / idle画像2〜4枚）を切り替える。止まっていてもidleコマが順に
  // 切り替わることで、静止画のままにならず生き生きして見えるようにしている。
  function isWalkingAnim(animKind) {
    return animKind === AnimationKind.WALK || animKind === AnimationKind.WALK_CARRY;
  }

  // 位相（ラジアン、0〜2π相当で無限に増え続ける値）から、frames配列の中の
  // 「今表示すべきコマ番号」を求める。2πで全コマを1周する計算にしているので、
  // フレーム枚数が変わってもこの関数は変更不要。
  function frameIndexFromPhase(phase, frameCount) {
    if (frameCount <= 1) return 0;
    var cyclePos = ((phase / (Math.PI * 2)) % 1 + 1) % 1; // 0〜1の範囲に正規化
    return Math.floor(cyclePos * frameCount) % frameCount;
  }

  // look: "customer_adam" 等のroleKey文字列（assetManifest.js の CharacterAssets 参照）
  // opts: {direction, animKind, phase, idlePhase, holdingIconHref, flashIconHref}
  function buildActorGroupHTML(look, opts) {
    var CA = Game.Data.CharacterAssets;
    var direction = opts.direction || "down";
    var anim = computeAnimOffset(opts.animKind, opts.phase || 0, opts.idlePhase || 0);

    var animGroup = isWalkingAnim(opts.animKind) ? "walk" : "idle";
    var phaseForFrame = animGroup === "walk" ? opts.phase || 0 : opts.idlePhase || 0;
    var frames = CA.framePaths(look, direction, animGroup);
    var frameIdx = frameIndexFromPhase(phaseForFrame, frames.length);
    var href = frames[frameIdx];
    var image = '<image href="' + href + '" x="0" y="0" width="' + CANVAS + '" height="' + CANVAS + '"></image>';

    // 32x32キャンバス → ゲーム内スケールへ拡大し、足元(ANCHOR_X, ANCHOR_Y)を原点(0,0)に合わせる。
    var bodyTransform =
      "translate(0," + anim.ty.toFixed(2) + ") rotate(" + anim.rot.toFixed(2) + ") " +
      "scale(" + DISPLAY_SCALE + ") translate(" + -ANCHOR_X + "," + -ANCHOR_Y + ")";

    var html = '<g transform="' + bodyTransform + '">' + image + "</g>";

    if (opts.holdingIconHref) {
      // 手元に持っているもの（料理・お金など）。頭上やや前方に小さく表示。
      var iconSize = 16;
      var ix = direction === "left" ? -12 : direction === "right" ? 12 : 0;
      var iy = -34 + anim.ty * 0.4;
      html +=
        '<image href="' + opts.holdingIconHref + '" x="' + (ix - iconSize / 2) + '" y="' + (iy - iconSize / 2) +
        '" width="' + iconSize + '" height="' + iconSize + '"></image>';
    }

    return html;
  }

  Game.UI.ActorSprite = {
    build: buildActorGroupHTML,
    DISPLAY_SCALE: DISPLAY_SCALE,
  };
})();
