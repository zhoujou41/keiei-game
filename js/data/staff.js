// staff.js — スタッフデータ定義
window.Game = window.Game || {};
Game.Data = Game.Data || {};

// role: cooking(調理) / service(接客) / calling(呼込) / chores(雑務)
// 2026-09-22（シフト改修）: register(レジ)はservice(接客)に統合し、代わりに
// calling(呼込＝新規：その週の客足をわずかに押し上げる)を追加した。
Game.Data.ROLES = [
  { id: "cooking", name: "調理" },
  { id: "service", name: "接客" },
  { id: "calling", name: "呼込" },
  { id: "chores", name: "雑務" },
];

// DAY_KEYS: シフト表の曜日順（0=月…6=日）。workDaysMaskはこの順のbooleanTrue/False配列。
Game.Data.DAY_KEYS = ["月", "火", "水", "木", "金", "土", "日"];

// 2026-09-22（シフト改修）: 初期スタッフは2名（ユーザー指定の例：田中=調理、鈴木=接客、
// どちらも週7日全チェック）に変更。baseWorkDaysも7とし、デフォルト状態では割増（残業代）が
// 発生しないようにしている。managementFocus（業務指導⟷やる気回復の2軸、guidance+morale=100）は
// スタッフ詳細の子画面から設定できる。
Game.Data.INITIAL_STAFF = [
  {
    id: "tanaka",
    name: "田中",
    aptitude: { cooking: 70, service: 40, calling: 35, chores: 30 },
    ability: 55,
    motivation: 70,
    baseWorkDays: 7,
    wagePerDay: 4500,
    role: "cooking",
    workDays: 7,
    workDaysMask: [true, true, true, true, true, true, true],
    managementFocus: { guidance: 50, morale: 50 },
  },
  {
    id: "suzuki",
    name: "鈴木",
    aptitude: { cooking: 40, service: 75, calling: 55, chores: 30 },
    ability: 50,
    motivation: 75,
    baseWorkDays: 7,
    wagePerDay: 4200,
    role: "service",
    workDays: 7,
    workDaysMask: [true, true, true, true, true, true, true],
    managementFocus: { guidance: 50, morale: 50 },
  },
];

// 新規雇用候補の生成プール（名字と特性の傾向）
Game.Data.CANDIDATE_POOL_NAMES = ["伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田", "斎藤", "松本"];
