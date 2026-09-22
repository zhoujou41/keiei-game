// layoutEditor.js — 店内レイアウト編集画面（LAYOUTタブ）
window.Game = window.Game || {};
Game.UI = Game.UI || {};

(function () {
  var selectedTool = null; // オブジェクトid、または "erase"
  var CELL_PX = 34;

  function state() {
    return Game.App.state;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function key(x, y) {
    return x + "," + y;
  }

  function renderPalette() {
    var objs = Game.Data.LAYOUT_OBJECTS;
    var byCategory = {};
    objs.forEach(function (o) {
      byCategory[o.category] = byCategory[o.category] || [];
      byCategory[o.category].push(o);
    });
    var catLabels = { kitchen: "🍳 厨房設備", counter: "🛎️ 受け渡し", service: "💰 サービス", table: "🍽️ テーブル", prop: "🪴 小物" };

    var html = "";
    Object.keys(catLabels).forEach(function (cat) {
      if (!byCategory[cat]) return;
      html += '<div class="muted small" style="margin-top:6px;">' + catLabels[cat] + "</div>";
      html += '<div class="row" style="margin-bottom:4px;">';
      byCategory[cat].forEach(function (o) {
        var active = selectedTool === o.id ? "active" : "";
        html +=
          '<button class="tool-btn ' + active + '" data-tool="' + o.id + '">' +
            '<span class="tool-icon">' + o.icon + "</span><span class=\"small\">" + o.name + "</span>" +
          "</button>";
      });
      html += "</div>";
    });
    html +=
      '<div class="row" style="margin-top:6px;">' +
        '<button class="tool-btn erase ' + (selectedTool === "erase" ? "active" : "") + '" data-tool="erase">' +
          '<span class="tool-icon">🧹</span><span class="small">消す</span>' +
        "</button>" +
      "</div>";
    el("layout-palette").innerHTML = html;
  }

  function renderGrid() {
    var s = state();
    var layout = s.layout;
    var html = '<div class="layout-grid" style="grid-template-columns: repeat(' + layout.cols + ', ' + CELL_PX + 'px); grid-template-rows: repeat(' + layout.rows + ', ' + CELL_PX + 'px);">';
    for (var y = 0; y < layout.rows; y++) {
      for (var x = 0; x < layout.cols; x++) {
        var isEntrance = Game.Core.Layout.isEntrance(x, y);
        var objId = layout.cells[key(x, y)];
        var obj = objId ? Game.Data.getLayoutObject(objId) : null;
        var cls = "layout-cell";
        var content = "";
        var style = "";
        if (isEntrance) {
          cls += " entrance";
          content = "🚪";
        } else if (obj) {
          cls += " has-object";
          content = obj.icon;
          style = 'style="background:' + obj.color + '22;border-color:' + obj.color + ';"';
        }
        html +=
          '<div class="' + cls + '" ' + style + ' data-x="' + x + '" data-y="' + y + '" title="' + (obj ? obj.name : "") + '">' +
            content +
          "</div>";
      }
    }
    html += "</div>";
    el("layout-grid-wrap").innerHTML = html;
  }

  function handlePaletteClick(e) {
    var btn = e.target.closest("[data-tool]");
    if (!btn) return;
    var tool = btn.getAttribute("data-tool");
    selectedTool = selectedTool === tool ? null : tool;
    renderPalette();
  }

  function handleGridClick(e) {
    var cell = e.target.closest("[data-x]");
    if (!cell || !selectedTool) return;
    var x = parseInt(cell.getAttribute("data-x"), 10);
    var y = parseInt(cell.getAttribute("data-y"), 10);
    if (Game.Core.Layout.isEntrance(x, y)) return; // 入口は編集不可
    var s = state();
    if (selectedTool === "erase") {
      delete s.layout.cells[key(x, y)];
    } else {
      s.layout.cells[key(x, y)] = selectedTool;
    }
    renderGrid();
    Game.App.save();
  }

  var wired = false;
  function wireEvents() {
    el("layout-palette").addEventListener("click", handlePaletteClick);
    el("layout-grid-wrap").addEventListener("click", handleGridClick);
    el("btn-layout-reset").addEventListener("click", function () {
      state().layout = Game.Data.createDefaultLayout();
      renderGrid();
      Game.App.save();
    });
  }

  function render() {
    if (!wired) {
      wireEvents();
      wired = true;
    }
    renderPalette();
    renderGrid();
  }

  Game.UI.LayoutEditor = {
    render: render,
  };
})();
