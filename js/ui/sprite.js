// sprite.js — レイヤー式キャラクターSVGの組み立て（3等身デフォルメ仕様）
// ローカル座標系: 原点(0,0)=足元中心。頭は上方向(y座標はマイナス)。
// direction: "down"(正面) / "up"(背面) / "right"(右向き) / "left"(右向きを反転)
//
// 頭身比率の目安: 頭の直径がだいたい全身の45%前後になるよう調整してあり、
// 「頭がやや大きく・身体が小さい3等身程度」の見た目を狙っている。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var P = function () {
    return Game.Data.CharacterParts;
  };

  // ---- 骨格の基本寸法（頭サイズは各キャラのheadShapeに乗算するスケール） ----
  var HEAD_SCALE = 1.28;
  var LEG_H_STAND = 8;
  var LEG_H_SIT = 3.2;
  var TORSO_H = 9.5;
  var NECK_H = 1;

  function shade(hex, amt) {
    var c = hex.replace("#", "");
    if (c.length === 3) {
      c = c
        .split("")
        .map(function (x) {
          return x + x;
        })
        .join("");
    }
    var num = parseInt(c, 16);
    if (isNaN(num)) return hex;
    var r = Math.min(255, Math.max(0, (num >> 16) + amt));
    var g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
    var b = Math.min(255, Math.max(0, (num & 0xff) + amt));
    return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  // ================= 目・口・鼻（look個性ベース／通常表情） =================
  function eyeMark(style, cx, cy) {
    switch (style) {
      case "dot":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="0.62" fill="#1a1a1a"/>';
      case "line":
        return '<line x1="' + (cx - 0.75) + '" y1="' + cy + '" x2="' + (cx + 0.75) + '" y2="' + cy + '" stroke="#1a1a1a" stroke-width="0.55" stroke-linecap="round"/>';
      case "oval":
        return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="0.62" ry="0.9" fill="#1a1a1a"/><circle cx="' + (cx + 0.2) + '" cy="' + (cy - 0.3) + '" r="0.2" fill="#fff"/>';
      case "sleepy":
        return '<path d="M ' + (cx - 0.85) + ' ' + cy + ' Q ' + cx + ' ' + (cy + 0.95) + ' ' + (cx + 0.85) + ' ' + cy + '" stroke="#1a1a1a" stroke-width="0.5" fill="none" stroke-linecap="round"/>';
      case "wide":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="0.9" fill="#1a1a1a"/><circle cx="' + (cx + 0.28) + '" cy="' + (cy - 0.28) + '" r="0.24" fill="#fff"/>';
      case "star":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="0.55" fill="#1a1a1a"/><circle cx="' + cx + '" cy="' + cy + '" r="0.95" fill="none" stroke="#1a1a1a" stroke-width="0.16" opacity="0.4"/>';
      default:
        return "";
    }
  }

  function mouthMark(style, cx, cy) {
    switch (style) {
      case "smile":
        return '<path d="M ' + (cx - 1.05) + ' ' + cy + ' Q ' + cx + ' ' + (cy + 1.15) + ' ' + (cx + 1.05) + ' ' + cy + '" stroke="#7a3b2e" stroke-width="0.48" fill="none" stroke-linecap="round"/>';
      case "flat":
        return '<line x1="' + (cx - 0.85) + '" y1="' + cy + '" x2="' + (cx + 0.85) + '" y2="' + cy + '" stroke="#7a3b2e" stroke-width="0.42" stroke-linecap="round"/>';
      case "open":
        return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="0.75" ry="0.95" fill="#7a3b2e"/>';
      case "small-o":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="0.42" fill="#7a3b2e"/>';
      case "smirk":
        return '<path d="M ' + (cx - 0.85) + ' ' + (cy + 0.2) + ' Q ' + cx + ' ' + (cy - 0.4) + ' ' + (cx + 0.95) + ' ' + cy + '" stroke="#7a3b2e" stroke-width="0.42" fill="none" stroke-linecap="round"/>';
      case "grin":
        return '<path d="M ' + (cx - 1.15) + ' ' + cy + ' Q ' + cx + ' ' + (cy + 1.4) + ' ' + (cx + 1.15) + ' ' + cy + ' Z" fill="#7a3b2e"/>';
      default:
        return "";
    }
  }

  function noseMark(style, cx, cy) {
    switch (style) {
      case "dot":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="0.3" fill="#c98a5e"/>';
      case "line":
        return '<line x1="' + cx + '" y1="' + (cy - 0.5) + '" x2="' + cx + '" y2="' + (cy + 0.5) + '" stroke="#c98a5e" stroke-width="0.35" stroke-linecap="round"/>';
      case "triangle":
        return '<path d="M ' + (cx - 0.35) + ' ' + (cy + 0.4) + ' L ' + (cx + 0.35) + ' ' + (cy + 0.4) + ' L ' + cx + ' ' + (cy - 0.4) + ' Z" fill="#c98a5e"/>';
      default:
        return "";
    }
  }

  // ================= 表情オーバーライド（状態ベース。個性より状態を優先） =================
  function exprEye(kind, cx, cy) {
    switch (kind) {
      case "happyArc":
        return '<path d="M ' + (cx - 0.95) + ' ' + (cy + 0.4) + ' Q ' + cx + ' ' + (cy - 1.0) + ' ' + (cx + 0.95) + ' ' + (cy + 0.4) + '" stroke="#1a1a1a" stroke-width="0.55" fill="none" stroke-linecap="round"/>';
      case "angry":
        return '<line x1="' + (cx - 0.75) + '" y1="' + (cy + 0.15) + '" x2="' + (cx + 0.75) + '" y2="' + (cy - 0.15) + '" stroke="#1a1a1a" stroke-width="0.55" stroke-linecap="round"/>';
      case "surprised":
        return '<circle cx="' + cx + '" cy="' + cy + '" r="1.0" fill="#1a1a1a"/><circle cx="' + (cx + 0.3) + '" cy="' + (cy - 0.3) + '" r="0.28" fill="#fff"/>';
      case "bored":
        return '<path d="M ' + (cx - 0.85) + ' ' + cy + ' Q ' + cx + ' ' + (cy + 0.5) + ' ' + (cx + 0.85) + ' ' + cy + '" stroke="#1a1a1a" stroke-width="0.5" fill="none" stroke-linecap="round"/>';
      default:
        return "";
    }
  }

  function exprMouth(kind, cx, cy) {
    switch (kind) {
      case "grin":
        return '<path d="M ' + (cx - 1.2) + ' ' + cy + ' Q ' + cx + ' ' + (cy + 1.5) + ' ' + (cx + 1.2) + ' ' + cy + ' Z" fill="#7a3b2e"/>';
      case "frown":
        return '<path d="M ' + (cx - 1.0) + ' ' + (cy + 0.7) + ' Q ' + cx + ' ' + (cy - 0.5) + ' ' + (cx + 1.0) + ' ' + (cy + 0.7) + '" stroke="#7a3b2e" stroke-width="0.48" fill="none" stroke-linecap="round"/>';
      case "flat":
        return '<line x1="' + (cx - 0.85) + '" y1="' + cy + '" x2="' + (cx + 0.85) + '" y2="' + cy + '" stroke="#7a3b2e" stroke-width="0.42" stroke-linecap="round"/>';
      case "o":
        return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="0.55" ry="0.7" fill="#7a3b2e"/>';
      default:
        return "";
    }
  }

  // 食事アニメ: eatingPhase(0..1)に応じて口の開閉を作る
  function eatingMouth(cx, cy, phaseFrac) {
    var openAmt = Math.max(0.15, Math.abs(Math.sin(phaseFrac * Math.PI * 2)));
    return '<ellipse cx="' + cx + '" cy="' + (cy + openAmt * 0.3) + '" rx="0.75" ry="' + (0.35 + openAmt * 0.75) + '" fill="#7a3b2e"/>';
  }

  // メインの組み立て関数
  // opts: {
  //   direction, sitting(bool), holdingIcon(絵文字|null),
  //   phase(歩行位相rad, 継続値), moving(bool), idlePhase(待機の呼吸位相),
  //   role('cook'|'register'|null), expression('neutral'|'bored'|'happy'|'angry'|'eating'),
  //   eatingPhase(0..1)
  // }
  function buildCharacterGroup(look, opts) {
    opts = opts || {};
    var direction = opts.direction || "down";
    var sitting = !!opts.sitting;
    var moving = !!opts.moving;
    var phase = opts.phase || 0;
    var idlePhase = opts.idlePhase || 0;
    var expression = opts.expression || "neutral";
    var Parts = P();

    var skin = Parts.skinTones[look.skinTone];
    var skinShadow = shade(skin, -28);
    var headShape = Parts.headShapes[look.headShape];
    var head = { rx: headShape.rx * HEAD_SCALE, ry: headShape.ry * HEAD_SCALE };
    var hairColor = Parts.hairColors[look.hairColor];
    var hairShadow = shade(hairColor, -25);
    var hairPath = Parts.hairStylesFront[look.hairStyle];
    var outfit = Parts.outfitColors[look.outfitColor];
    var outfitShadow = shade(outfit, -30);
    var pants = Parts.pantsColors[look.pantsColor];
    var shoe = Parts.shoeColors[look.shoeColor];
    var earR = 1.15 * Parts.earSizes[look.earSize];

    // --- 歩行/呼吸アニメーションの量を算出 ---
    var bounce, legSwing, armSwing;
    if (moving) {
      bounce = Math.abs(Math.sin(phase)) * 1.5;
      legSwing = Math.sin(phase) * 2.4;
      armSwing = Math.sin(phase) * 14; // deg
    } else {
      bounce = Math.sin(idlePhase) * 0.35;
      legSwing = 0;
      armSwing = 0;
    }

    var legH = sitting ? LEG_H_SIT : LEG_H_STAND;
    var legTopY = -legH;
    var torsoTop = legTopY - TORSO_H;
    var neckTopY = torsoTop - NECK_H;
    var headCY = neckTopY - head.ry;

    var legOffsetL = sitting ? -1.6 : legSwing;
    var legOffsetR = sitting ? 1.6 : -legSwing;

    var svg = "";

    // --- 影（足元） ---
    svg += '<ellipse cx="0" cy="0.6" rx="6.4" ry="1.6" fill="#000" opacity="0.16"/>';

    // 全身を上下にバウンドさせるラッパー
    svg += '<g transform="translate(0,' + -bounce + ')">';

    // --- 脚・靴 ---
    if (sitting) {
      svg +=
        '<rect x="-3.4" y="' + legTopY + '" width="2.6" height="' + legH + '" rx="1.1" fill="' + pants + '" transform="rotate(-8 -3.4 ' + legTopY + ') translate(' + legOffsetL + ',0)"/>' +
        '<rect x="0.8" y="' + legTopY + '" width="2.6" height="' + legH + '" rx="1.1" fill="' + pants + '" transform="rotate(8 0.8 ' + legTopY + ') translate(' + legOffsetR + ',0)"/>' +
        '<ellipse cx="-2.1" cy="0.2" rx="1.9" ry="1.05" fill="' + shoe + '" transform="translate(' + legOffsetL + ',0)"/>' +
        '<ellipse cx="2.1" cy="0.2" rx="1.9" ry="1.05" fill="' + shoe + '" transform="translate(' + legOffsetR + ',0)"/>';
    } else {
      svg +=
        '<rect x="-3.3" y="' + legTopY + '" width="2.5" height="' + legH + '" rx="1.15" fill="' + pants + '" transform="translate(' + legOffsetL + ',0)"/>' +
        '<rect x="0.8" y="' + legTopY + '" width="2.5" height="' + legH + '" rx="1.15" fill="' + pants + '" transform="translate(' + legOffsetR + ',0)"/>' +
        '<ellipse cx="-2.05" cy="-0.3" rx="1.8" ry="1.05" fill="' + shoe + '" transform="translate(' + legOffsetL + ',0)"/>' +
        '<ellipse cx="2.05" cy="-0.3" rx="1.8" ry="1.05" fill="' + shoe + '" transform="translate(' + legOffsetR + ',0)"/>';
    }

    // --- 腕 ---
    var torsoBottom = legTopY + 1.2;
    var shoulderY = torsoTop + 1.6;
    var handY = torsoBottom + 1;
    var eating = expression === "eating";
    var eatingArmAngle = eating ? -Math.max(0, Math.sin((opts.eatingPhase || 0) * Math.PI * 2)) * 55 : 0;

    if (opts.holdingIcon) {
      // トレイを両手で運ぶ動作（軽く揺れる）
      var traySway = moving ? Math.sin(phase) * 1.2 : Math.sin(idlePhase) * 0.4;
      var trayY = torsoTop + 1.2;
      svg +=
        '<rect x="-5.7" y="' + trayY + '" width="1.9" height="6.4" rx="0.9" fill="' + outfit + '" transform="rotate(-28 -5.7 ' + trayY + ')"/>' +
        '<rect x="3.8" y="' + trayY + '" width="1.9" height="6.4" rx="0.9" fill="' + outfit + '" transform="rotate(28 3.8 ' + trayY + ')"/>' +
        '<g transform="translate(0,' + traySway * 0.3 + ')">' +
          '<rect x="-4.9" y="' + (torsoTop - 3) + '" width="9.8" height="1.8" rx="0.7" fill="#e4dccb" stroke="#a89a82" stroke-width="0.22"/>' +
          '<circle cx="0" cy="' + (torsoTop - 2.1) + '" r="1.6" fill="#fff" stroke="#c9bfae" stroke-width="0.2"/>' +
          '<text x="0" y="' + (torsoTop - 1.5) + '" font-size="2.6" text-anchor="middle">' + opts.holdingIcon + "</text>" +
        "</g>";
    } else if (sitting && eating) {
      // 食べる動作: 片腕が口元まで往復する
      svg +=
        '<rect x="3.9" y="' + shoulderY + '" width="1.8" height="7" rx="0.85" fill="' + outfit + '" transform="rotate(' + eatingArmAngle + ' 4.8 ' + shoulderY + ')"/>' +
        '<circle cx="4.8" cy="' + (shoulderY + 7) + '" r="1.05" fill="' + skin + '" transform="rotate(' + eatingArmAngle + ' 4.8 ' + shoulderY + ')"/>' +
        '<rect x="-5.7" y="' + shoulderY + '" width="1.8" height="7" rx="0.85" fill="' + outfit + '"/>' +
        '<circle cx="-4.8" cy="' + handY + '" r="1.05" fill="' + skin + '"/>';
    } else {
      var armRot = moving ? armSwing : 0;
      svg +=
        '<rect x="-5.7" y="' + shoulderY + '" width="1.8" height="7.4" rx="0.85" fill="' + outfit + '" transform="rotate(' + armRot + ' -4.8 ' + shoulderY + ')"/>' +
        '<rect x="3.9" y="' + shoulderY + '" width="1.8" height="7.4" rx="0.85" fill="' + outfit + '" transform="rotate(' + -armRot + ' 4.8 ' + shoulderY + ')"/>' +
        '<circle cx="-4.8" cy="' + (shoulderY + 7.4) + '" r="1.05" fill="' + skin + '" transform="rotate(' + armRot + ' -4.8 ' + shoulderY + ')"/>' +
        '<circle cx="4.8" cy="' + (shoulderY + 7.4) + '" r="1.05" fill="' + skin + '" transform="rotate(' + -armRot + ' 4.8 ' + shoulderY + ')"/>';
    }

    // --- 胴体（服・丸みのある樽型） ---
    // すべての座標を先に数値変数として計算してから文字列に埋め込む
    // （数値式を文字列連結の途中に書くと "+" が文字列結合として解釈され、
    //   意図せず "-4.61.1" のような壊れた値になるバグを避けるため）
    var torsoW = 9.2;
    var halfW = torsoW / 2;
    var shoulderTopY = torsoTop + 2.2;
    var midY = torsoTop + (torsoBottom - torsoTop) / 2;
    var leftOutX = -halfW;
    var leftInX = -halfW + 1.1;
    var rightOutX = halfW;
    var rightInX = halfW - 1.1;

    svg +=
      '<path d="M ' + leftOutX + ' ' + shoulderTopY +
      ' Q ' + (leftOutX - 0.6) + ' ' + midY + ' ' + leftInX + ' ' + torsoBottom +
      ' Q 0 ' + (torsoBottom + 1.1) + ' ' + rightInX + ' ' + torsoBottom +
      ' Q ' + (rightOutX + 0.6) + ' ' + midY + ' ' + rightOutX + ' ' + shoulderTopY +
      ' Q 0 ' + (torsoTop - 1) + ' ' + leftOutX + ' ' + shoulderTopY + ' Z" fill="' + outfit + '"/>';
    // 下腹部の淡い陰影
    var shadowTopY = torsoBottom - 3;
    svg +=
      '<path d="M ' + leftInX + ' ' + shadowTopY +
      ' Q 0 ' + (torsoBottom + 1.1) + ' ' + rightInX + ' ' + shadowTopY +
      ' L ' + rightInX + ' ' + torsoBottom +
      ' Q 0 ' + (torsoBottom + 1.1) + ' ' + leftInX + ' ' + torsoBottom + ' Z" fill="' + outfitShadow + '" opacity="0.55"/>';

    // --- エプロン（スタッフのみ） ---
    if (opts.role === "cook" || opts.role === "register") {
      var apronColor = "#fbf6ea";
      svg +=
        '<path d="M -2.6 ' + (torsoTop + 2.6) + ' L 2.6 ' + (torsoTop + 2.6) + ' L 3.3 ' + torsoBottom + ' L -3.3 ' + torsoBottom + ' Z" fill="' + apronColor + '" opacity="0.92" stroke="#d8cfb8" stroke-width="0.18"/>';
    }

    // --- トレイを持たない時、首元のリボン/ボタン（アクセント） ---
    if (!opts.holdingIcon) {
      svg += '<circle cx="0" cy="' + (torsoTop + 3) + '" r="0.55" fill="#fff" opacity="0.65"/>';
    }

    // --- 首 ---
    svg += '<rect x="-1.3" y="' + (headCY + head.ry - 1.2) + '" width="2.6" height="' + (NECK_H + 1.5) + '" fill="' + skin + '"/>';

    var showFace = direction === "down" || direction === "right";
    var isBack = direction === "up";

    // --- 耳（髪の下） ---
    if (!isBack) {
      svg += '<circle cx="' + (-head.rx - 0.35) + '" cy="' + headCY + '" r="' + earR + '" fill="' + skin + '"/>';
      svg += '<circle cx="' + (head.rx + 0.35) + '" cy="' + headCY + '" r="' + earR + '" fill="' + skin + '"/>';
    }

    // --- 頭（丸くふっくら／下側にうっすら陰影） ---
    svg += '<ellipse cx="0" cy="' + headCY + '" rx="' + head.rx + '" ry="' + head.ry + '" fill="' + skin + '"/>';
    svg += '<path d="M ' + -head.rx + ' ' + headCY + ' A ' + head.rx + ' ' + head.ry + ' 0 0 0 ' + head.rx + ' ' + headCY + ' A ' + head.rx + ' ' + head.ry * 0.55 + ' 0 0 1 ' + -head.rx + ' ' + headCY + ' Z" fill="' + skinShadow + '" opacity="0.3"/>';

    // --- 顔パーツ ---
    if (showFace) {
      var eyeDX = direction === "right" ? head.rx * 0.36 : head.rx * 0.44;
      var eyeCY = headCY - head.ry * 0.02;
      var noseCY = headCY + head.ry * 0.3;
      var mouthCY = headCY + head.ry * 0.62;
      var browCY = eyeCY - head.ry * 0.42;

      // 頬の赤み（怒り以外）
      if (expression !== "angry") {
        var blushOpac = expression === "happy" || expression === "eating" ? 0.55 : 0.32;
        if (direction === "down") {
          svg += '<ellipse cx="' + -eyeDX * 1.15 + '" cy="' + (mouthCY - head.ry * 0.15) + '" rx="0.85" ry="0.5" fill="#ff9e9e" opacity="' + blushOpac + '"/>';
          svg += '<ellipse cx="' + eyeDX * 1.15 + '" cy="' + (mouthCY - head.ry * 0.15) + '" rx="0.85" ry="0.5" fill="#ff9e9e" opacity="' + blushOpac + '"/>';
        } else {
          svg += '<ellipse cx="' + head.rx * 0.75 + '" cy="' + (mouthCY - head.ry * 0.1) + '" rx="0.8" ry="0.45" fill="#ff9e9e" opacity="' + blushOpac + '"/>';
        }
      }

      if (direction === "down") {
        // --- 目 ---
        if (expression === "neutral") {
          svg += eyeMark(Parts.eyeStyles[look.eyeStyle], -eyeDX, eyeCY);
          svg += eyeMark(Parts.eyeStyles[look.eyeStyle], eyeDX, eyeCY);
        } else if (expression === "eating") {
          svg += exprEye("bored", -eyeDX, eyeCY);
          svg += exprEye("bored", eyeDX, eyeCY);
        } else {
          var eKind = expression === "happy" ? "happyArc" : expression === "angry" ? "angry" : "bored";
          svg += exprEye(eKind, -eyeDX, eyeCY);
          svg += exprEye(eKind, eyeDX, eyeCY);
        }
        // --- 眉（怒り時のみ「へ」の字に） ---
        if (expression === "angry") {
          svg += '<line x1="' + (-eyeDX - 0.9) + '" y1="' + (browCY - 0.55) + '" x2="' + (-eyeDX + 0.9) + '" y2="' + (browCY + 0.55) + '" stroke="#3a2a1a" stroke-width="0.45" stroke-linecap="round" opacity="0.75"/>';
          svg += '<line x1="' + (eyeDX + 0.9) + '" y1="' + (browCY - 0.55) + '" x2="' + (eyeDX - 0.9) + '" y2="' + (browCY + 0.55) + '" stroke="#3a2a1a" stroke-width="0.45" stroke-linecap="round" opacity="0.75"/>';
        }
        // --- 鼻・口 ---
        svg += noseMark(Parts.noseStyles[look.noseStyle], 0, noseCY);
        if (expression === "eating") {
          svg += eatingMouth(0, mouthCY, opts.eatingPhase || 0);
        } else if (expression === "neutral") {
          svg += mouthMark(Parts.mouthStyles[look.mouthStyle], 0, mouthCY);
        } else {
          var mKind = expression === "happy" ? "grin" : expression === "angry" ? "frown" : "flat";
          svg += exprMouth(mKind, 0, mouthCY);
        }
      } else {
        // 横向き: 片目・鼻先・口を顔の向いている側に寄せる
        var sideX = head.rx * 0.58;
        if (expression === "neutral") {
          svg += eyeMark(Parts.eyeStyles[look.eyeStyle], sideX, eyeCY);
        } else if (expression === "eating") {
          svg += exprEye("bored", sideX, eyeCY);
        } else {
          var eKind2 = expression === "happy" ? "happyArc" : expression === "angry" ? "angry" : "bored";
          svg += exprEye(eKind2, sideX, eyeCY);
        }
        svg += noseMark(Parts.noseStyles[look.noseStyle], head.rx * 0.92, noseCY);
        if (expression === "eating") {
          svg += eatingMouth(head.rx * 0.62, mouthCY, opts.eatingPhase || 0);
        } else if (expression === "neutral") {
          svg += mouthMark(Parts.mouthStyles[look.mouthStyle], head.rx * 0.62, mouthCY);
        } else {
          var mKind2 = expression === "happy" ? "grin" : expression === "angry" ? "frown" : "flat";
          svg += exprMouth(mKind2, head.rx * 0.62, mouthCY);
        }
      }
    }

    // --- 髪 ---
    if (isBack) {
      svg += '<ellipse cx="0" cy="' + headCY + '" rx="' + (head.rx + 0.6) + '" ry="' + (head.ry + 0.6) + '" fill="' + hairColor + '"/>';
      svg += '<ellipse cx="0" cy="' + (headCY + head.ry * 0.4) + '" rx="' + (head.rx + 0.4) + '" ry="' + (head.ry * 0.5) + '" fill="' + hairShadow + '" opacity="0.4"/>';
    } else {
      var hairScale = head.rx / (Parts.headShapes[look.headShape].rx || 6.2);
      svg += '<g transform="translate(0,' + headCY + ') scale(' + hairScale + ')"><path d="' + hairPath + '" fill="' + hairColor + '"/></g>';
    }

    // --- 帽子（役割別） ---
    if (opts.role === "cook") {
      var hatCY = headCY - head.ry * 0.92;
      svg +=
        '<rect x="' + -head.rx * 0.68 + '" y="' + (hatCY - 0.6) + '" width="' + head.rx * 1.36 + '" height="2.2" rx="1" fill="#fff" stroke="#d9d2c4" stroke-width="0.2"/>' +
        '<ellipse cx="0" cy="' + (hatCY - 2.6) + '" rx="' + head.rx * 0.78 + '" ry="2.6" fill="#fff" stroke="#d9d2c4" stroke-width="0.2"/>' +
        '<ellipse cx="0" cy="' + (hatCY - 4.4) + '" rx="' + head.rx * 0.5 + '" ry="1.6" fill="#fff" stroke="#d9d2c4" stroke-width="0.15"/>';
    } else if (opts.role === "register") {
      var bandCY = headCY - head.ry * 0.55;
      svg += '<path d="M ' + -head.rx + ' ' + bandCY + ' Q 0 ' + (bandCY - head.ry * 0.55) + ' ' + head.rx + ' ' + bandCY + '" stroke="#e74c3c" stroke-width="1.1" fill="none" stroke-linecap="round"/>';
    }

    svg += "</g>"; // バウンドラッパー閉じ

    var group = '<g class="char-sprite">' + svg + "</g>";
    if (direction === "left") {
      group = '<g transform="scale(-1,1)">' + group + "</g>";
    }
    return group;
  }

  Game.UI.Sprite = {
    buildCharacterGroup: buildCharacterGroup,
  };
})();
