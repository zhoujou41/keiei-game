// FIELD画面の「二重表示」「消える」「進む方向を向いていない」を毎フレーム自動検出する
// 使い方: ゲームをローカルで配信（例: python3 -m http.server 8931）した状態で
//   SPEED_CLICKS=0 WEEKS=1 node tools/detect_field_bugs.js   （x1で1週）
//   SPEED_CLICKS=2 WEEKS=2 node tools/detect_field_bugs.js   （x3で2週）
// 毎フレーム全キャラの座標・表示中のコマ画像を記録し、重なり（二重表示）・出口以外での消滅・
// 進行方向と向きの不一致・持ち主のいない吹き出しを数える。scene.jsのwindow.__SCENE_DEBUGフックを使う。
// playwrightのchromium実行ファイルのパスは環境に合わせて変更すること。
const { chromium } = require('playwright');
const SPEED_CLICKS = parseInt(process.env.SPEED_CLICKS || '0', 10); // 0=x1, 2=x3
const WEEKS = parseInt(process.env.WEEKS || '1', 10);

async function setupGame(page) {
  await page.goto('http://localhost:8931/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(250);
  await page.click('[data-action="pick-difficulty"][data-id="easy"]');
  await page.click('[data-action="setup-next"]');
  await page.waitForTimeout(80);
  await page.click('[data-action="pick-storetype"][data-id="ramen"]');
  await page.click('[data-action="setup-next"]');
  await page.waitForTimeout(80);
  await page.click('[data-action="setup-next"]');
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) {
    const cbs = await page.$$('.setup-menu-card input[type="checkbox"]');
    try { await cbs[i].check({ timeout: 3000 }); } catch (e) {}
    await page.waitForTimeout(50);
  }
  await page.click('[data-action="setup-finish"]');
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.__SCENE_DEBUG = true; });
  await setupGame(page);

  // 毎フレームのサンプラーを仕込む
  await page.evaluate(() => {
    const S = { orphanMax: 0, orphanFrames: 0, frames: 0, dirChecks: 0, dirMismatch: [], overlaps: {}, overlapFrames: 0, prev: {}, emptyImg: 0, maxEnt: 0 };
    window.__S = S;
    function dirOf(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up'); }
    function loop() {
      const ents = Game.UI.Scene.__debugEntities();
      const list = Object.values(ents);
      S.frames++;
      S.maxEnt = Math.max(S.maxEnt, list.length);
      const cust = [];
      for (const e of list) {
        if (e.hiddenAtDoor) { delete S.prev[e.id]; continue; }
        const img = e.g.querySelector('image');
        const href = img ? img.getAttribute('href') : null;
        if (!href) S.emptyImg++;
        const m = href && /_(down|up|left|right)_(walk|idle)_/.exec(href);
        const shownDir = m ? m[1] : null;
        const p = S.prev[e.id];
        let actual = null;
        if (p && href) {
          const dx = e.x - p.x, dy = e.y - p.y;
          const d = Math.hypot(dx, dy);
          // 直線移動（片方の軸だけ動いた）かつ瞬間移動でない場合だけ判定。
          // さらに前回も同じ向きに進んでいた（=角を曲がった瞬間ではない）場合のみ。
          if (d > 1.0 && d < 60 && (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5)) {
            actual = dirOf(dx, dy);
            // 到着したフレーム（テーブルの方を向き直る）と、前の人を待って止まっている状態は除外
            if (p.dir === actual && e.path && e.path.length > 0 && !e.blockedByLeader) {
              S.dirChecks++;
              if (actual !== shownDir) {
                S.dirMismatch.push(S.dirMismatch.length < 30 ? { id: e.id, kind: e.kind, actual, shownDir, dx: +dx.toFixed(1), dy: +dy.toFixed(1), phase: e.phase, entDir: e.direction, role: e.role, pathLen: e.path.length, tgt: [Math.round(e.path[0].x), Math.round(e.path[0].y)], pos: [+e.x.toFixed(1), +e.y.toFixed(1)], pa: e.pendingAction, holding: e.holdingIcon } : null);
              }
            }
          }
        }
        S.prev[e.id] = { x: e.x, y: e.y, dir: actual };
        if (!e.isFixtureStaff) cust.push(e);
      }
      let ov = false;
      for (let i = 0; i < cust.length; i++) for (let j = i + 1; j < cust.length; j++) {
        const a = cust[i], b = cust[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 12) {
          ov = true;
          const k = a.id + '|' + b.id;
          if (!S.overlaps[k]) S.overlaps[k] = { a: a.phase, b: b.phase, x: Math.round(a.x), y: Math.round(a.y), frames: 0,
            aMov: a.path.length > 0, bMov: b.path.length > 0, aDir: a.direction, bDir: b.direction, aSeq: a.seq, bSeq: b.seq,
            aTgt: a.path[0] ? [Math.round(a.path[0].x), Math.round(a.path[0].y)] : null, bTgt: b.path[0] ? [Math.round(b.path[0].x), Math.round(b.path[0].y)] : null,
            bx: Math.round(b.x), by: Math.round(b.y) };
          S.overlaps[k].frames++;
        }
      }
      if (ov) S.overlapFrames++;
      // 持ち主のいない吹き出し・皿（取り残されたアイコン）の数
      const owned = new Set();
      for (const e of list) { if (e.bubbleEl) owned.add(e.bubbleEl); if (e.dishEl) owned.add(e.dishEl); }
      const bub = document.querySelectorAll('#scene-bubbles > g');
      let orphan = 0; bub.forEach(g => { if (!owned.has(g)) orphan++; });
      if (orphan > 0) S.orphanFrames++;
      S.orphanMax = Math.max(S.orphanMax, orphan);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });

  for (let w = 0; w < WEEKS; w++) {
    await page.click('#btn-start-week');
    await page.waitForTimeout(300);
    for (let s = 0; s < SPEED_CLICKS; s++) await page.click('#field-btn-speed');
    let done = false;
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 180000) {
      await page.waitForTimeout(1000);
      done = await page.$eval('#field-result', el => el.classList.contains('show')).catch(() => false);
    }
    console.log(`week ${w + 1} done=${done} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (w < WEEKS - 1) { await page.click('#field-btn-next'); await page.waitForTimeout(300); }
  }

  const r = await page.evaluate(() => {
    const S = window.__S;
    const ent = Game.UI.Scene.__debugEntrance();
    const log = window.__sceneDespawnLog || [];
    const CELL = 64;
    const vanished = log.filter(d => d.kind === 'customer' && Math.hypot(d.x - ent.x, d.y - ent.y) > CELL * 1.2);
    const byPhase = {};
    vanished.forEach(v => { byPhase[v.phase] = (byPhase[v.phase] || 0) + 1; });
    const overlapList = Object.values(S.overlaps).filter(o => o.frames >= 3);
    return {
      orphanMax: S.orphanMax, orphanFrames: S.orphanFrames, frames: S.frames, maxEnt: S.maxEnt, emptyImg: S.emptyImg,
      dirChecks: S.dirChecks, dirMismatchCount: S.dirMismatch.length, dirMismatchSamples: S.dirMismatch.filter(Boolean).slice(0, 10),
      overlapFrames: S.overlapFrames, overlapPairs: overlapList.length, overlapSamples: overlapList.slice(0, 10),
      despawnTotal: log.filter(d => d.kind === 'customer').length,
      vanishedAwayFromExit: vanished.length, vanishedByPhase: byPhase, vanishSamples: vanished.slice(0, 8),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('console errors:', errs.length); errs.slice(0, 10).forEach(e => console.log(' ', e));
  await browser.close();
})();
