// layout.js — 店内レイアウトの読み取りヘルパー
// state.layout = { cols, rows, cells: { "x,y": objectId } } を扱う。
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  function key(x, y) {
    return x + "," + y;
  }

  function isEntrance(x, y) {
    return x === Game.Data.FIXED_ENTRANCE.x && y === Game.Data.FIXED_ENTRANCE.y;
  }

  function objectAt(layout, x, y) {
    var id = layout.cells[key(x, y)];
    return id ? Game.Data.getLayoutObject(id) : null;
  }

  function isWalkable(layout, x, y) {
    if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return false;
    if (isEntrance(x, y)) return true;
    var obj = objectAt(layout, x, y);
    if (!obj) return true;
    return obj.walkable !== false;
  }

  function walkableFnFor(layout) {
    return function (x, y) {
      return isWalkable(layout, x, y);
    };
  }

  function allObjectCells(layout) {
    var result = [];
    Object.keys(layout.cells).forEach(function (k) {
      var parts = k.split(",");
      var x = parseInt(parts[0], 10);
      var y = parseInt(parts[1], 10);
      var def = Game.Data.getLayoutObject(layout.cells[k]);
      if (def) result.push({ x: x, y: y, id: layout.cells[k], def: def });
    });
    return result;
  }

  function cellsOfCategory(layout, category) {
    return allObjectCells(layout).filter(function (c) {
      return c.def.category === category;
    });
  }

  function tables(layout) {
    return allObjectCells(layout).filter(function (c) {
      return c.def.category === "table";
    });
  }

  function kitchenStations(layout) {
    return cellsOfCategory(layout, "kitchen");
  }

  function registerCell(layout) {
    var regs = cellsOfCategory(layout, "service");
    if (regs.length > 0) return regs[0];
    return null;
  }

  // 受け渡しカウンター（コック→ウェイターの食事の中継地点）。
  function counterCell(layout) {
    var counters = cellsOfCategory(layout, "counter");
    if (counters.length > 0) return counters[0];
    return null;
  }

  // 指定セル（オブジェクトの位置）に隣接する歩行可能マスを1つ返す（無ければnull）
  function interactionPoint(layout, x, y) {
    var pts = Game.Core.Pathfind.findAdjacentWalkable(x, y, walkableFnFor(layout), layout.cols, layout.rows);
    return pts.length > 0 ? pts[0] : null;
  }

  // テーブルの「席」座標を複数返す（隣接歩行可能マスをそのまま座席の目安にする）
  function seatsForTable(layout, tableCell) {
    var pts = Game.Core.Pathfind.findAdjacentWalkable(
      tableCell.x,
      tableCell.y,
      walkableFnFor(layout),
      layout.cols,
      layout.rows
    );
    var seats = tableCell.def.seats || 2;
    return pts.slice(0, seats);
  }

  Game.Core.Layout = {
    key: key,
    isEntrance: isEntrance,
    objectAt: objectAt,
    isWalkable: isWalkable,
    walkableFnFor: walkableFnFor,
    allObjectCells: allObjectCells,
    cellsOfCategory: cellsOfCategory,
    tables: tables,
    kitchenStations: kitchenStations,
    registerCell: registerCell,
    counterCell: counterCell,
    interactionPoint: interactionPoint,
    seatsForTable: seatsForTable,
  };
})();
