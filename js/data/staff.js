// staff.js — スタッフデータ定義
window.Game = window.Game || {};
Game.Data = Game.Data || {};

// role: cooking(調理) / service(接客) / register(レジ) / other(その他)
Game.Data.ROLES = [
  { id: "cooking", name: "調理" },
  { id: "service", name: "接客" },
  { id: "register", name: "レジ" },
  { id: "other", name: "その他" },
];

Game.Data.INITIAL_STAFF = [
  {
    id: "tanaka",
    name: "田中",
    aptitude: { cooking: 70, service: 40, register: 30, other: 30 },
    ability: 55,
    motivation: 70,
    baseWorkDays: 5,
    wagePerDay: 4500,
    role: "cooking",
    workDays: 5,
  },
  {
    id: "suzuki",
    name: "鈴木",
    aptitude: { cooking: 40, service: 75, register: 50, other: 30 },
    ability: 50,
    motivation: 75,
    baseWorkDays: 5,
    wagePerDay: 4200,
    role: "service",
    workDays: 5,
  },
  {
    id: "sato",
    name: "佐藤",
    aptitude: { cooking: 55, service: 55, register: 65, other: 40 },
    ability: 45,
    motivation: 65,
    baseWorkDays: 4,
    wagePerDay: 3900,
    role: "register",
    workDays: 4,
  },
  {
    id: "takahashi",
    name: "高橋",
    aptitude: { cooking: 30, service: 50, register: 40, other: 70 },
    ability: 40,
    motivation: 80,
    baseWorkDays: 4,
    wagePerDay: 3600,
    role: "cooking",
    workDays: 4,
  },
];

// 新規雇用候補の生成プール（名字と特性の傾向）
Game.Data.CANDIDATE_POOL_NAMES = ["伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田", "斎藤", "松本"];
