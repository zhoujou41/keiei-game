// pathfind.js — グリッド上の単純なBFS経路探索
// 店のレイアウト（歩行可能マスの集合）の上で、start→goal の最短経路を4方向移動で求める。
window.Game = window.Game || {};
Game.Core = Game.Core || {};

(function () {
  function key(x, y) {
    return x + "," + y;
  }

  // walkableFn(x,y) -> boolean を渡す
  function findPath(startX, startY, goalX, goalY, walkableFn, cols, rows) {
    if (startX === goalX && startY === goalY) return [{ x: startX, y: startY }];
    var visited = {};
    var queue = [{ x: startX, y: startY }];
    visited[key(startX, startY)] = null;
    var dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    var found = false;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (cur.x === goalX && cur.y === goalY) {
        found = true;
        break;
      }
      for (var i = 0; i < dirs.length; i++) {
        var nx = cur.x + dirs[i].dx;
        var ny = cur.y + dirs[i].dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var k = key(nx, ny);
        if (visited.hasOwnProperty(k)) continue;
        var isGoal = nx === goalX && ny === goalY;
        if (!isGoal && !walkableFn(nx, ny)) continue;
        visited[k] = key(cur.x, cur.y);
        queue.push({ x: nx, y: ny });
      }
    }

    if (!found) return null;

    // 経路を復元
    var path = [];
    var curKey = key(goalX, goalY);
    while (curKey !== null) {
      var parts = curKey.split(",");
      path.unshift({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
      curKey = visited[curKey];
    }
    return path;
  }

  // 対象オブジェクトの隣接マス（歩行可能なもの）を探す
  function findAdjacentWalkable(x, y, walkableFn, cols, rows) {
    var dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    var result = [];
    dirs.forEach(function (d) {
      var nx = x + d.dx;
      var ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      if (walkableFn(nx, ny)) result.push({ x: nx, y: ny });
    });
    return result;
  }

  Game.Core.Pathfind = {
    findPath: findPath,
    findAdjacentWalkable: findAdjacentWalkable,
  };
})();
