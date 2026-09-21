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

  // ================= 🔮 今週の未来視（日々の未来視。全員デフォルトで無料） =================
  function renderForesightSection() {
    var s = state();
    var foresight = s.currentWeekForesight;
    if (!foresight || !foresight.days || foresight.days.length === 0) {
      el("office-foresight").innerHTML = '<div class="muted small">今週の未来視はまだありません。</div>';
      return;
    }
    var html = foresight.days
      .map(function (d) {
        var lines = d.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("");
        return (
          '<div class="foresight-day-card">' +
            '<div class="day-label">' + d.label + "曜日</div>" +
            "<ul>" + lines + "</ul>" +
          "</div>"
        );
      })
      .join("");
    el("office-foresight").innerHTML = '<div class="foresight-week-grid">' + html + "</div>";
  }

  // ================= 仕入れ =================
  function renderPurchaseSection() {
    var s = state();
    var html = s.products
      .map(function (p) {
        var qty = Math.round((p.baseStock * p.purchaseRate) / 100);
        var rateBtns = Game.Data.PURCHASE_RATES.map(function (r) {
          var active = p.purchaseRate === r ? "active" : "";
          return (
            '<button class="rate-btn ' + active + '" data-action="set-rate" data-product="' +
            p.id + '" data-rate="' + r + '">' + r + "%</button>"
          );
        }).join("");
        var priceDiffPct = Math.round(((p.currentPrice - p.basePrice) / p.basePrice) * 100);
        var diffSpan =
          priceDiffPct !== 0
            ? ' <span class="muted small">(' + (priceDiffPct > 0 ? "+" : "") + priceDiffPct + "%)</span>"
            : "";
        return (
          '<div class="product-card">' +
            '<div class="title">' + p.icon + " " + esc(p.name) + "</div>" +
            '<div class="muted small">基準価格 ' + p.basePrice + "円 / 原価 " + p.cost + "円</div>" +
            '<div class="price-adjust">' +
              '<button data-action="adjust-price" data-product="' + p.id + '" data-dir="-1">−</button>' +
              "<span>販売価格 <b>" + p.currentPrice + "円</b>" + diffSpan + "</span>" +
              '<button data-action="adjust-price" data-product="' + p.id + '" data-dir="1">＋</button>' +
            "</div>" +
            '<div class="muted small" style="margin-top:6px;">今週の仕入れ量</div>' +
            '<div class="rate-btns">' + rateBtns + "</div>" +
            '<div class="muted small" style="margin-top:4px;">→ ' + qty + " 食分</div>" +
          "</div>"
        );
      })
      .join("");
    el("office-purchase").innerHTML = '<div class="row">' + html + "</div>";
  }

  function setPurchaseRate(productId, rate) {
    var p = state().products.find(function (x) { return x.id === productId; });
    p.purchaseRate = rate;
    renderPurchaseSection();
    Game.App.save();
  }

  function adjustPrice(productId, dir) {
    var p = state().products.find(function (x) { return x.id === productId; });
    var step = Math.round(p.basePrice * 0.05);
    var next = p.currentPrice + dir * step;
    var min = Math.round(p.basePrice * 0.7);
    var max = Math.round(p.basePrice * 1.3);
    p.currentPrice = Game.Core.Random.clamp(next, min, max);
    renderPurchaseSection();
    Game.App.save();
  }

  // ================= シフト =================
  function bar(value, cls) {
    return (
      '<div class="stat-bar-wrap"><div class="stat-bar-bg"><div class="stat-bar-fill ' + (cls || "") +
      '" style="width:' + Game.Core.Random.clamp(value, 0, 100) + '%"></div></div><span>' + Math.round(value) + "</span></div>"
    );
  }

  function renderShiftSection() {
    var s = state();
    var html = s.staff
      .map(function (st) {
        var roleOptions = Game.Data.ROLES.map(function (r) {
          var sel = st.role === r.id ? "selected" : "";
          return '<option value="' + r.id + '" ' + sel + ">" + r.name + "</option>";
        }).join("");
        var overNote =
          st.workDays > st.baseWorkDays
            ? '<span class="muted small">(基本' + st.baseWorkDays + "日 + 割増" + (st.workDays - st.baseWorkDays) + "日)</span>"
            : "";
        var weekWage =
          Math.min(st.workDays, st.baseWorkDays) * st.wagePerDay +
          Math.max(0, st.workDays - st.baseWorkDays) * st.wagePerDay * 1.5;
        return (
          '<div class="staff-card">' +
            '<div class="name-row"><span>' + esc(st.name) + "</span><span class=\"muted small\">今週の人件費 見込み " + fmt(weekWage) + "円</span></div>" +
            '<div class="row" style="margin-top:6px;">' +
              '<label class="small">配置: <select data-action="set-role" data-staff="' + st.id + '">' + roleOptions + "</select></label>" +
              '<label class="small">勤務日数: <input type="number" min="0" max="7" value="' + st.workDays +
                '" style="width:52px" data-action="set-workdays" data-staff="' + st.id + '"></label>' +
              overNote +
            "</div>" +
            '<div class="col" style="margin-top:6px;">' +
              '<div class="small muted">調理適性 ' + bar(st.aptitude.cooking) + "</div>" +
              '<div class="small muted">接客適性 ' + bar(st.aptitude.service) + "</div>" +
              '<div class="small muted">レジ適性 ' + bar(st.aptitude.register) + "</div>" +
              '<div class="small muted">能力 ' + bar(st.ability, "") + "</div>" +
              '<div class="small muted">やる気 ' + bar(st.motivation, "motivation") + "</div>" +
            "</div>" +
          "</div>"
        );
      })
      .join("");
    el("office-shift").innerHTML = html;
  }

  function setStaffRole(staffId, role) {
    var st = state().staff.find(function (x) { return x.id === staffId; });
    st.role = role;
    Game.App.save();
  }

  function setStaffWorkDays(staffId, value) {
    var st = state().staff.find(function (x) { return x.id === staffId; });
    var v = parseInt(value, 10);
    if (isNaN(v)) v = 0;
    st.workDays = Game.Core.Random.clamp(v, 0, 7);
    renderShiftSection();
    Game.App.save();
  }

  // ================= マネジメント =================
  function renderManagementSection() {
    var m = state().management;
    function row(key, label) {
      return (
        '<div class="mgmt-slider-row">' +
          "<label>" + label + "</label>" +
          '<input type="range" min="0" max="100" value="' + m[key] + '" data-action="set-mgmt" data-key="' + key + '">' +
          '<span class="mgmt-value">' + m[key] + "</span>" +
        "</div>"
      );
    }
    el("office-management").innerHTML =
      row("service", "接客重視") + row("cooking", "調理重視") + row("morale", "やる気回復") +
      '<div class="muted small">3項目の合計が100になるよう自動調整されます。</div>';
  }

  function setManagement(key, value) {
    var m = state().management;
    var v = Game.Core.Random.clamp(parseInt(value, 10) || 0, 0, 100);
    var others = ["service", "cooking", "morale"].filter(function (k) { return k !== key; });
    var remain = 100 - v;
    var otherSum = m[others[0]] + m[others[1]];
    if (otherSum <= 0) {
      m[others[0]] = Math.round(remain / 2);
      m[others[1]] = remain - m[others[0]];
    } else {
      m[others[0]] = Math.round((m[others[0]] / otherSum) * remain);
      m[others[1]] = remain - m[others[0]];
    }
    m[key] = v;
    renderManagementSection();
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

  function renderGoalSection() {
    var s = state();
    var g = s.currentGoal;
    var acc = s.milestoneAccum;
    var html =
      '<div class="muted small">第' + g.milestoneIndex + "期目標（" + s.week + "週目 〜 " + g.untilWeek + "週目）</div>" +
      '<div class="col" style="margin-top:6px;">' +
        "<div>累積利益 " + progressBar(acc.profit, g.minProfit) + "</div>" +
        "<div>評判 " + progressBar(s.reputation, g.minReputation) + "</div>" +
        (g.minCustomers != null ? "<div>累積客数 " + progressBar(acc.customers, g.minCustomers) + "</div>" : "") +
      "</div>" +
      '<div class="muted small" style="margin-top:6px;">未達成でも即ゲームオーバーにはなりませんが、評判低下や追加コストなど経営が苦しくなる影響があります。</div>';
    el("office-goal").innerHTML = html;
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
    s.staff.push({
      id: c.id,
      name: c.name,
      aptitude: c.aptitude,
      ability: c.ability,
      motivation: c.motivation,
      baseWorkDays: c.baseWorkDays,
      wagePerDay: c.wagePerDay,
      role: c.role,
      workDays: c.baseWorkDays,
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
    if (action === "set-rate") {
      setPurchaseRate(t.getAttribute("data-product"), parseInt(t.getAttribute("data-rate"), 10));
    } else if (action === "adjust-price") {
      adjustPrice(t.getAttribute("data-product"), parseInt(t.getAttribute("data-dir"), 10));
    } else if (action === "skill-up") {
      spendSkillPoint(t.getAttribute("data-skill"));
    } else if (action === "set-focus") {
      setFocusSkill(t.getAttribute("data-skill"));
    } else if (action === "search-candidates") {
      searchCandidates();
    } else if (action === "hire") {
      hireCandidate(t.getAttribute("data-candidate"));
    }
  }

  function handleChangeOrInput(e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    if (action === "set-role") {
      setStaffRole(t.getAttribute("data-staff"), t.value);
    } else if (action === "set-workdays") {
      setStaffWorkDays(t.getAttribute("data-staff"), t.value);
    } else if (action === "set-mgmt") {
      setManagement(t.getAttribute("data-key"), t.value);
    }
  }

  function wireEvents() {
    var root = el("screen-office");
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChangeOrInput);
    root.addEventListener("input", function (e) {
      if (e.target.matches('input[type="range"][data-action="set-mgmt"]')) {
        handleChangeOrInput(e);
      }
    });
  }

  // ================= 全体描画 =================
  var wired = false;
  function render() {
    if (!wired) {
      wireEvents();
      wired = true;
    }
    renderForesightSection();
    renderPurchaseSection();
    renderShiftSection();
    renderManagementSection();
    renderSkillSection();
    renderGoalSection();
    renderHireSection();
  }

  Game.UI.Office = {
    render: render,
  };
})();
