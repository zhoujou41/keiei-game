// office.js — OFFICE画面（経営・準備画面）のUI
// 注意: onclick文字列に引数を埋め込むと引用符のエスケープでバグりやすいため、
// data-* 属性 + イベント委譲（delegation）方式で統一する。
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  function state() {
    return Game.App.state;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function fmt(n) {
    return Math.round(n).toLocaleString();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ================= 🔮 今週の未来視（週全体のなんとなくの予想。全員デフォルトで無料） =================
  function renderForesightSection() {
    var s = state();
    var foresight = s.currentWeekForesight;
    if (!foresight || !foresight.lines || foresight.lines.length === 0) {
      el("office-foresight").innerHTML = '<div class="muted small">今週の未来視はまだありません。</div>';
      return;
    }
    var lines = foresight.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("");
    el("office-foresight").innerHTML = '<div class="foresight-panel"><ul>' + lines + "</ul></div>";
  }

  // ================= 仕入れ =================
  // 2026-09-22改修: 販売価格・仕入れ量とも「基準価格/基準仕入れ量に対する%」として
  // 0%〜10,000%の範囲で直接入力 or ±ボタンで指定できるようにした。
  // 2026-09-22（訂正）: 一時「仕入れ量レベル制（Lv1〜3）」に置き換えたが、ユーザーから
  // 「レベルは仕入れ量の設定ではなく、その料理の熟練度」と訂正されたため、
  // 仕入れ量は元の0%〜10,000%直接入力＋±ボタンの形に戻した。
  var PRICE_STEP = 5; // ±ボタン1クリックあたりの変化幅（%）
  var PURCHASE_STEP = 10;

  function pricePctOf(p) {
    return p.pricePct != null ? p.pricePct : Math.round((p.currentPrice / p.basePrice) * 100);
  }

  function clampPct(v) {
    v = Math.round(v);
    if (isNaN(v)) v = 0;
    return Game.Core.Random.clamp(v, Game.Data.PRICE_PCT_MIN, Game.Data.PRICE_PCT_MAX);
  }

  function syncCurrentPrice(p) {
    p.currentPrice = Math.round((p.basePrice * p.pricePct) / 100);
  }

  function renderPurchaseSection() {
    var s = state();
    var html = s.products
      .map(function (p) {
        var pricePct = pricePctOf(p);
        var purchasePct = p.purchaseRate;
        var qty = Math.round((p.baseStock * purchasePct) / 100);
        var purchaseCost = qty * p.cost;
        var grossMarginPerItem = p.basePrice - p.cost; // 基準価格での粗利（原価欄に添える参考値）
        var currentGrossMargin = p.currentPrice - p.cost; // 現在の販売価格での粗利
        var marginPct = p.basePrice > 0 ? Math.round((grossMarginPerItem / p.basePrice) * 100) : 0;
        var mastery = Game.Core.Economy.masteryProgress(p.cumulativeSold);
        var ceiling = Game.Core.Economy.priceCeiling(p, mastery.level);
        var masteryHtml =
          '<div class="muted small" style="margin-top:8px;">熟練度 <b>Lv.' + mastery.level + "</b>" +
            (mastery.isMax
              ? "（Max）"
              : "（累計販売 " + mastery.cumulativeSold + " / " + mastery.nextThreshold + " でLv." + (mastery.level + 1) + "へ）") +
          "</div>" +
          '<div class="muted small" style="margin-top:2px;">この熟練度での価格天井：約 ' + fmt(ceiling) +
            "円（これを超える値付けだと客が購入をやめてしまいます）</div>";
        return (
          '<div class="product-card">' +
            '<div class="title">' + p.icon + " " + esc(p.name) + "</div>" +
            '<div class="muted small">基準価格 ' + p.basePrice + "円 / 原価 " + p.cost +
              "円 / 粗利 " + grossMarginPerItem + "円（" + marginPct + "%）</div>" +

            '<div class="muted small" style="margin-top:8px;">販売価格（基準比 %）</div>' +
            '<div class="pct-adjust">' +
              '<button data-action="adjust-price-pct" data-product="' + p.id + '" data-dir="-1">−</button>' +
              '<input type="number" class="pct-input" min="' + Game.Data.PRICE_PCT_MIN + '" max="' + Game.Data.PRICE_PCT_MAX +
                '" step="1" value="' + pricePct + '" data-action="set-price-pct" data-product="' + p.id + '">%' +
              '<button data-action="adjust-price-pct" data-product="' + p.id + '" data-dir="1">＋</button>' +
            "</div>" +
            '<div class="muted small" style="margin-top:2px;">→ 販売価格 <b>' + p.currentPrice + "円</b>（粗利 " +
              currentGrossMargin + "円）</div>" +
            masteryHtml +

            '<div class="muted small" style="margin-top:8px;">仕入れ量（基準比 %）</div>' +
            '<div class="pct-adjust">' +
              '<button data-action="adjust-purchase-pct" data-product="' + p.id + '" data-dir="-1">−</button>' +
              '<input type="number" class="pct-input" min="' + Game.Data.PURCHASE_PCT_MIN + '" max="' + Game.Data.PURCHASE_PCT_MAX +
                '" step="1" value="' + purchasePct + '" data-action="set-purchase-pct" data-product="' + p.id + '">%' +
              '<button data-action="adjust-purchase-pct" data-product="' + p.id + '" data-dir="1">＋</button>' +
            "</div>" +
            '<div class="muted small" style="margin-top:2px;">→ ' + qty + " 食分（仕入れ費用 " + fmt(purchaseCost) + "円）</div>" +
          "</div>"
        );
      })
      .join("");
    el("office-purchase").innerHTML = '<div class="row">' + html + "</div>";
  }

  function setPricePct(productId, value) {
    var p = state().products.find(function (x) { return x.id === productId; });
    p.pricePct = clampPct(value);
    syncCurrentPrice(p);
    renderPurchaseSection();
    Game.App.save();
  }

  function adjustPricePct(productId, dir) {
    var p = state().products.find(function (x) { return x.id === productId; });
    setPricePct(productId, pricePctOf(p) + dir * PRICE_STEP);
  }

  function setPurchasePct(productId, value) {
    var p = state().products.find(function (x) { return x.id === productId; });
    p.purchaseRate = clampPct(value);
    renderPurchaseSection();
    Game.App.save();
  }

  function adjustPurchasePct(productId, dir) {
    var p = state().products.find(function (x) { return x.id === productId; });
    setPurchasePct(productId, p.purchaseRate + dir * PURCHASE_STEP);
  }

  // ================= シフト =================
  // 2026-09-22改修: 「勤務日数」の数値入力をやめ、曜日ごとのチェック表（月〜日）に変更。
  // 配置（役割）は調理／接客／呼込／雑務の4種から選択。名前をクリックするとスタッフ詳細の
  // 子画面（モーダル）が開き、そこでマネジメント方針（業務指導⟷やる気回復）を設定できる。
  var DAY_KEYS = Game.Data.DAY_KEYS || ["月", "火", "水", "木", "金", "土", "日"];

  function bar(value, cls) {
    return (
      '<div class="stat-bar-wrap"><div class="stat-bar-bg"><div class="stat-bar-fill ' + (cls || "") +
      '" style="width:' + Game.Core.Random.clamp(value, 0, 100) + '%"></div></div><span>' + Math.round(value) + "</span></div>"
    );
  }

  function weeklyWage(st) {
    return (
      Math.min(st.workDays, st.baseWorkDays) * st.wagePerDay +
      Math.max(0, st.workDays - st.baseWorkDays) * st.wagePerDay * 1.5
    );
  }

  function ensureWorkDaysMask(st) {
    if (!st.workDaysMask) {
      var filled = st.workDays > 0;
      st.workDaysMask = [filled, filled, filled, filled, filled, filled, filled];
    }
    return st.workDaysMask;
  }

  function renderShiftSection() {
    var s = state();
    var dayHeaders = DAY_KEYS.map(function (d) { return "<th>" + d + "</th>"; }).join("");
    var rows = s.staff
      .map(function (st) {
        var mask = ensureWorkDaysMask(st);
        var dayCells = mask
          .map(function (checked, dayIdx) {
            return (
              '<td><input type="checkbox" data-action="toggle-workday" data-staff="' + st.id +
              '" data-day="' + dayIdx + '" ' + (checked ? "checked" : "") + "></td>"
            );
          })
          .join("");
        var roleOptions = Game.Data.ROLES.map(function (r) {
          var sel = st.role === r.id ? "selected" : "";
          return '<option value="' + r.id + '" ' + sel + ">" + r.name + "</option>";
        }).join("");
        return (
          "<tr>" +
            '<td><button type="button" class="staff-name-link" data-action="open-staff-modal" data-staff="' +
              st.id + '">' + esc(st.name) + "</button></td>" +
            '<td><select data-action="set-role" data-staff="' + st.id + '">' + roleOptions + "</select></td>" +
            dayCells +
            '<td class="muted small">' + fmt(weeklyWage(st)) + "円</td>" +
          "</tr>"
        );
      })
      .join("");
    var html =
      '<div class="shift-table-wrap"><table class="shift-table"><thead><tr>' +
        "<th>名前</th><th>配置</th>" + dayHeaders + "<th>人件費見込み</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<div class="muted small" style="margin-top:6px;">名前をクリックすると詳細・マネジメント方針を設定できます。</div>';
    el("office-shift").innerHTML = html;
  }

  function setStaffRole(staffId, role) {
    var st = state().staff.find(function (x) { return x.id === staffId; });
    st.role = role;
    Game.App.save();
  }

  function toggleWorkDay(staffId, dayIdx) {
    var st = state().staff.find(function (x) { return x.id === staffId; });
    var mask = ensureWorkDaysMask(st);
    mask[dayIdx] = !mask[dayIdx];
    st.workDays = mask.filter(Boolean).length;
    renderShiftSection();
    Game.App.save();
  }

  // ================= スタッフ詳細（子画面）＝マネジメント方針もここで設定 =================
  var openStaffModalId = null;

  function renderStaffModal() {
    var modalEl = el("staff-modal");
    if (!modalEl) return;
    if (!openStaffModalId) {
      modalEl.classList.remove("show");
      modalEl.innerHTML = "";
      return;
    }
    var st = state().staff.find(function (x) { return x.id === openStaffModalId; });
    if (!st) {
      openStaffModalId = null;
      modalEl.classList.remove("show");
      modalEl.innerHTML = "";
      return;
    }
    var focus = st.managementFocus || { guidance: 50, morale: 50 };
    var mask = ensureWorkDaysMask(st);
    var workDaysText = DAY_KEYS.filter(function (_, i) { return mask[i]; }).join("・") || "なし";
    var html =
      '<div class="modal-box">' +
        '<div class="modal-head"><b>' + esc(st.name) + "</b>" +
          '<button type="button" class="btn small" data-action="close-staff-modal">✕</button>' +
        "</div>" +
        '<div class="muted small" style="margin-top:4px;">配置: ' + esc(Game.Data.ROLES.find(function (r) { return r.id === st.role; }).name) +
          " / 勤務曜日: " + esc(workDaysText) + "</div>" +
        '<div class="col" style="margin-top:10px;">' +
          '<div class="small muted">調理適性 ' + bar(st.aptitude.cooking) + "</div>" +
          '<div class="small muted">接客適性 ' + bar(st.aptitude.service) + "</div>" +
          '<div class="small muted">呼込適性 ' + bar(st.aptitude.calling) + "</div>" +
          '<div class="small muted">雑務適性 ' + bar(st.aptitude.chores) + "</div>" +
          '<div class="small muted">能力 ' + bar(st.ability, "") + "</div>" +
          '<div class="small muted">やる気 ' + bar(st.motivation, "motivation") + "</div>" +
        "</div>" +
        '<div class="muted small" style="margin-top:6px;">今週の人件費見込み ' + fmt(weeklyWage(st)) + "円（日給 " +
          fmt(st.wagePerDay) + "円）</div>" +
        '<div style="margin-top:12px;">' +
          '<div class="small">マネジメント方針（重視: 業務指導 ⟷ やる気回復）</div>' +
          '<div class="mgmt-slider-row">' +
            '<span class="small muted">業務指導</span>' +
            '<input type="range" min="0" max="100" value="' + focus.morale + '" data-action="set-staff-mgmt" data-staff="' + st.id + '">' +
            '<span class="small muted">やる気回復</span>' +
          "</div>" +
          '<div class="muted small">業務指導 ' + focus.guidance + "% ・ やる気回復 " + focus.morale + "%</div>" +
        "</div>" +
      "</div>";
    modalEl.innerHTML = html;
    modalEl.classList.add("show");
  }

  function openStaffModal(staffId) {
    openStaffModalId = staffId;
    renderStaffModal();
  }

  function closeStaffModal() {
    openStaffModalId = null;
    renderStaffModal();
  }

  function setStaffManagementFocus(staffId, moraleValue) {
    var st = state().staff.find(function (x) { return x.id === staffId; });
    if (!st) return;
    var morale = Game.Core.Random.clamp(parseInt(moraleValue, 10) || 0, 0, 100);
    st.managementFocus = { guidance: 100 - morale, morale: morale };
    renderStaffModal();
    Game.App.save();
  }

  // ================= スキル =================
  function renderSkillSection() {
    var s = state();
    var html = Game.Data.SKILLS.map(function (skDef) {
      var lvl = s.skills[skDef.id] || 0;
      var maxLvl = Game.Data.MAX_SKILL_LEVEL;
      var dots = "";
      for (var i = 0; i < maxLvl; i++) {
        dots += '<div class="skill-dot ' + (i < lvl ? "filled" : "") + '"></div>';
      }
      var cost = Game.Data.skillUpCost(lvl);
      var canUp = lvl < maxLvl && s.skillPoints >= cost;
      var upBtn =
        lvl >= maxLvl
          ? '<span class="muted small">MAX</span>'
          : '<button class="btn small" data-action="skill-up" data-skill="' + skDef.id + '" ' +
            (canUp ? "" : "disabled") + ">習得 (P" + cost + ")</button>";

      var focusPart = "";
      var hintPart = "";
      if (skDef.type === "active") {
        var checked = s.focusSkill === skDef.id ? "checked" : "";
        var disabled = lvl <= 0 ? "disabled" : "";
        var costInfo = lvl > 0 ? Game.Data.focusCost(lvl) : null;
        focusPart =
          '<label class="small" style="display:block;margin-top:4px;">' +
            '<input type="radio" name="focus-skill" data-action="set-focus" data-skill="' + skDef.id + '" ' +
            checked + " " + disabled + "> 今週これに集中する" +
            (costInfo
              ? '<span class="muted"> （費用 ' + costInfo.money.toLocaleString() + "円 / マネジメント効果-" + costInfo.managementPenaltyPct + "%）</span>"
              : "") +
          "</label>";
        var hint = skDef.id === "foresight" ? Game.Core.Simulation.getForesightHint(s) : Game.Core.Simulation.getHyakuganHint(s);
        hintPart = '<div class="skill-hint">' + esc(hint.text) + "</div>";
      }

      return (
        '<div class="skill-card">' +
          '<div class="head"><span>' + skDef.icon + " " + esc(skDef.name) + "</span>" + upBtn + "</div>" +
          '<div class="skill-level-dots">' + dots + "</div>" +
          '<div class="muted small" style="margin-top:4px;">' + esc(skDef.shortDesc) + "</div>" +
          focusPart + hintPart +
        "</div>"
      );
    }).join("");

    var noneChecked = state().focusSkill ? "" : "checked";
    var noneOption =
      '<label class="small" style="display:block;margin-bottom:8px;">' +
        '<input type="radio" name="focus-skill" data-action="set-focus" data-skill="" ' + noneChecked +
        "> 今週はどのスキルにも集中しない</label>";

    el("office-skills").innerHTML =
      '<div class="muted small" style="margin-bottom:6px;">スキルポイント: <b>' + s.skillPoints + "</b></div>" +
      noneOption + html;
  }

  function spendSkillPoint(skillId) {
    var s = state();
    var lvl = s.skills[skillId] || 0;
    var cost = Game.Data.skillUpCost(lvl);
    if (lvl >= Game.Data.MAX_SKILL_LEVEL || s.skillPoints < cost) return;
    s.skillPoints -= cost;
    s.skills[skillId] = lvl + 1;
    renderSkillSection();
    Game.App.save();
  }

  function setFocusSkill(skillId) {
    state().focusSkill = skillId || null;
    renderSkillSection();
    Game.App.save();
  }

  // ================= 経営目標 =================
  function progressBar(current, target) {
    var pct = target > 0 ? Game.Core.Random.clamp((current / target) * 100, 0, 100) : 100;
    var ok = current >= target;
    return (
      '<div class="stat-bar-wrap"><div class="stat-bar-bg"><div class="stat-bar-fill ' + (ok ? "motivation" : "") +
      '" style="width:' + pct + '%"></div></div><span class="small">' + fmt(current) + " / " + fmt(target) + "</span></div>"
    );
  }

  // 2026-09-22（今週の目標・バッドステータス表示対応）: 「このままのペースだと目標未達に
  // なりそうか」をGame.Core.Goals.evaluatePace()で判定し、該当する場合は赤系の警告バナーを
  // 目標の説明文の上に表示する。まだ1週も消化していない期間の最初は判定できないため
  // 何も表示しない（evaluatePace側でanyBehind=falseになる）。
  function renderGoalSection() {
    var s = state();
    var g = s.currentGoal;
    var acc = s.milestoneAccum;
    var pace = Game.Core.Goals.evaluatePace(s);
    var badStatusHtml = "";
    if (pace.anyBehind) {
      badStatusHtml =
        '<div class="goal-bad-status">⚠️ <b>目標未達の見込み</b><ul style="margin:4px 0 0;padding-left:1.2em;">' +
        pace.messages.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") +
        "</ul></div>";
    }
    var html =
      badStatusHtml +
      '<div class="muted small">' + esc(g.description || "") + "</div>" +
      '<div style="margin-top:8px;font-weight:bold;font-size:1.05em;">' + esc(g.summary || "") + "</div>" +
      '<div class="col" style="margin-top:10px;">' +
        "<div>累積利益 " + progressBar(acc.profit, g.minProfit) + "</div>" +
        "<div>評判 " + progressBar(s.reputation, g.minReputation) + "</div>" +
        (g.minCustomers != null ? "<div>累積客数 " + progressBar(acc.customers, g.minCustomers) + "</div>" : "") +
      "</div>";
    el("office-goal").innerHTML = html;
  }

  // ================= 先週の状況（2026-09-22追加） =================
  // 今週の未来視パネルの下に、直前の週（state.lastWeekResult）の実績をまとめて表示する。
  // まだ一度も営業していない（lastWeekResultが無い）場合は「まだありません」を出す。
  function renderLastWeekSection() {
    var s = state();
    var r = s.lastWeekResult;
    var target = el("office-lastweek");
    if (!target) return;
    if (!r) {
      target.innerHTML = '<div class="muted small" style="margin-top:10px;">先週の状況はまだありません（初回営業前）。</div>';
      return;
    }
    var foresightHtml = "";
    if (r.playedWeekForesight && r.playedWeekForesight.lines && r.playedWeekForesight.lines.length > 0) {
      foresightHtml =
        '<div class="small muted" style="margin-top:6px;">先週の未来視：</div><ul class="small">' +
        r.playedWeekForesight.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") +
        "</ul>";
    }
    // 2026-09-22（先週の状況パネル拡張）: 「仕入れの内容ごとの結果がわかるように」との
    // 指摘に対応し、商品ごとの行に仕入れ費用（円）を明示した（従来は仕入れ数量のみで、
    // 実際にいくら投じてどうなったかが分かりにくかった）。
    var itemRows = (r.itemStats || [])
      .map(function (it) {
        var profitCls = it.profit >= 0 ? "good" : "bad";
        return (
          '<div class="lastweek-item-row">' +
            '<div class="lastweek-item-name">' + esc(it.name) + " <span class=\"muted small\">Lv." + (it.masteryLevel || 1) + "</span></div>" +
            '<div class="small">価格 ' + fmt(it.priceAtSale) + "円 ／ 仕入 " + fmt(it.purchasedQty) +
              "食（仕入れ費用 " + fmt(it.purchaseCost || 0) + "円） ／ 販売 " + fmt(it.soldQty) +
              "食 ／ 余り " + fmt(it.leftoverQty) + "食</div>" +
            '<div class="small ' + profitCls + '">利益 ' + fmt(it.profit) + "円　" +
              (it.avgSatisfaction != null ? "客の評価：" + esc(it.valueLabel) + "（満足度目安 " + it.avgSatisfaction + "）" : "客の評価：販売実績なし") +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    // 2026-09-22（先週の状況パネル拡張）:「満足できず帰った人の数を表示して」に対応し、
    // 売り切れ／待ちきれず／価格が高すぎて、の3理由を内訳付きで表示する。
    var leftDisappointed = r.leftDisappointed || 0;
    var leftWaiting = r.leftWaiting || 0;
    var leftPriceRejected = r.leftPriceRejected || 0;
    var leftTotal = r.leftTotal != null ? r.leftTotal : leftDisappointed + leftWaiting + leftPriceRejected;
    var leftHtml =
      '<div class="small' + (leftTotal > 0 ? " bad" : "") + '" style="margin-top:6px;">' +
        "満足できず帰った人：<b>" + fmt(leftTotal) + "人</b>" +
        (leftTotal > 0
          ? "（売り切れで諦めた " + fmt(leftDisappointed) + "人 ／ 待ちきれず " + fmt(leftWaiting) +
            "人 ／ 値段が高すぎて " + fmt(leftPriceRejected) + "人）"
          : "") +
      "</div>";
    target.innerHTML =
      '<div class="lastweek-panel" style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px;">' +
        '<div style="font-weight:bold;">📊 先週（第' + r.week + "週）の状況</div>" +
        "<div class=\"small\" style=\"margin-top:4px;\">利益 " + fmt(r.profit) + "円 ／ 客数 " + fmt(r.served) +
          "人 ／ 評判 " + r.reputationBefore + " → " + r.reputationAfter + "</div>" +
        leftHtml +
        foresightHtml +
        '<div class="col" style="margin-top:8px;gap:4px;">' + itemRows + "</div>" +
      "</div>";
  }

  // ================= 特殊行動：新規雇用 =================
  function renderHireSection() {
    var s = state();
    var candidates = s.pendingCandidates || [];
    var staffFull = s.staff.length >= 6;
    var listHtml = candidates
      .map(function (c) {
        var lines = Game.Core.Hiring.describeCandidate(s, c).map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("");
        var cost = Game.Core.Hiring.hiringCost(c);
        var canAfford = s.money >= cost;
        return (
          '<div class="candidate-card">' +
            "<b>" + esc(c.name) + "</b>" +
            "<ul>" + lines + "</ul>" +
            '<div class="small muted">採用コスト ' + fmt(cost) + "円</div>" +
            '<button class="btn btn-primary small" data-action="hire" data-candidate="' + c.id + '" ' +
              (canAfford && !staffFull ? "" : "disabled") + ">採用する</button>" +
          "</div>"
        );
      })
      .join("");

    el("office-hire").innerHTML =
      '<div class="row">' +
        '<button class="btn" data-action="search-candidates" ' + (staffFull ? "disabled" : "") + ">採用候補を探す</button>" +
        (staffFull ? '<span class="muted small">これ以上スタッフを増やせません（最大6人）</span>' : "") +
      "</div>" +
      '<div class="row" style="margin-top:8px;">' + listHtml + "</div>";
  }

  function searchCandidates() {
    state().pendingCandidates = Game.Core.Hiring.generateCandidates(state(), 2);
    renderHireSection();
  }

  function hireCandidate(candidateId) {
    var s = state();
    var c = (s.pendingCandidates || []).find(function (x) { return x.id === candidateId; });
    if (!c) return;
    var cost = Game.Core.Hiring.hiringCost(c);
    if (s.money < cost || s.staff.length >= 6) return;
    s.money -= cost;
    var mask = [false, false, false, false, false, false, false];
    for (var di = 0; di < c.baseWorkDays && di < 7; di++) mask[di] = true; // 月曜起点でbaseWorkDays日分をデフォルトON
    s.staff.push({
      id: c.id,
      name: c.name,
      aptitude: c.aptitude,
      ability: c.ability,
      motivation: c.motivation,
      baseWorkDays: c.baseWorkDays,
      wagePerDay: c.wagePerDay,
      role: c.role,
      workDays: mask.filter(Boolean).length,
      workDaysMask: mask,
      managementFocus: { guidance: 50, morale: 50 },
    });
    s.pendingCandidates = (s.pendingCandidates || []).filter(function (x) { return x.id !== candidateId; });
    Game.App.renderAll();
    Game.App.save();
  }

  // ================= イベント委譲 =================
  function handleClick(e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    if (action === "adjust-price-pct") {
      adjustPricePct(t.getAttribute("data-product"), parseInt(t.getAttribute("data-dir"), 10));
    } else if (action === "adjust-purchase-pct") {
      adjustPurchasePct(t.getAttribute("data-product"), parseInt(t.getAttribute("data-dir"), 10));
    } else if (action === "skill-up") {
      spendSkillPoint(t.getAttribute("data-skill"));
    } else if (action === "set-focus") {
      setFocusSkill(t.getAttribute("data-skill"));
    } else if (action === "search-candidates") {
      searchCandidates();
    } else if (action === "hire") {
      hireCandidate(t.getAttribute("data-candidate"));
    } else if (action === "open-staff-modal") {
      openStaffModal(t.getAttribute("data-staff"));
    } else if (action === "close-staff-modal") {
      closeStaffModal();
    }
  }

  function handleChangeOrInput(e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    if (action === "set-role") {
      setStaffRole(t.getAttribute("data-staff"), t.value);
    } else if (action === "toggle-workday") {
      toggleWorkDay(t.getAttribute("data-staff"), parseInt(t.getAttribute("data-day"), 10));
    } else if (action === "set-staff-mgmt") {
      setStaffManagementFocus(t.getAttribute("data-staff"), t.value);
    } else if (action === "set-price-pct") {
      setPricePct(t.getAttribute("data-product"), t.value);
    } else if (action === "set-purchase-pct") {
      setPurchasePct(t.getAttribute("data-product"), t.value);
    }
  }

  function wireEvents() {
    var root = el("screen-office");
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChangeOrInput);
    root.addEventListener("input", function (e) {
      if (e.target.matches('input[type="range"][data-action="set-staff-mgmt"]')) {
        handleChangeOrInput(e);
      }
    });

    // スタッフ詳細の子画面（モーダル）はOFFICE画面の外（document直下）にあるため別途配線する。
    var modalEl = el("staff-modal");
    if (modalEl) {
      modalEl.addEventListener("click", function (e) {
        if (e.target === modalEl) closeStaffModal(); // 背景クリックで閉じる
        else handleClick(e);
      });
      modalEl.addEventListener("change", handleChangeOrInput);
      modalEl.addEventListener("input", function (e) {
        if (e.target.matches('input[type="range"][data-action="set-staff-mgmt"]')) {
          handleChangeOrInput(e);
        }
      });
    }
  }

  // ================= 全体描画 =================
  var wired = false;
  function render() {
    if (!wired) {
      wireEvents();
      wired = true;
    }
    renderGoalSection();
    renderForesightSection();
    renderLastWeekSection();
    renderPurchaseSection();
    renderShiftSection();
    renderSkillSection();
    renderHireSection();
    renderStaffModal();
  }

  Game.UI.Office = {
    render: render,
  };
})();
