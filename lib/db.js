// Kết nối database qua libSQL:
//  - Trên Vercel: Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
//  - Chạy ở máy: file SQLite trong thư mục database/
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  if (process.env.VERCEL) {
    throw new Error('Chưa cấu hình TURSO_DATABASE_URL / TURSO_AUTH_TOKEN trong Environment Variables của Vercel');
  }
  const file = process.env.DB_PATH || join(ROOT, 'database', 'truc-nhat.sqlite');
  mkdirSync(dirname(file), { recursive: true });
  return createClient({ url: pathToFileURL(file).href });
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS members (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    color    TEXT NOT NULL DEFAULT '#6c8cff',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- Ai trực ngày nào (phân công tay)
  CREATE TABLE IF NOT EXISTS assignments (
    date      TEXT PRIMARY KEY,               -- YYYY-MM-DD
    member_id INTEGER NOT NULL,
    note      TEXT NOT NULL DEFAULT ''
  );
  -- Việc đã tick trong ngày
  CREATE TABLE IF NOT EXISTS task_checks (
    date    TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    PRIMARY KEY (date, task_id)
  );
  -- "Đã trực xong" khi chưa có danh sách việc
  CREATE TABLE IF NOT EXISTS completions (
    date TEXT PRIMARY KEY
  );
  -- Lịch sử chỉnh sửa
  CREATE TABLE IF NOT EXISTS history (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,                 -- epoch ms
    editor  TEXT NOT NULL,
    reason  TEXT NOT NULL DEFAULT '',
    date    TEXT,                             -- ngày trong lịch bị sửa (nếu có)
    summary TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS history_date ON history(date);
`;

let client;
let ready;
// Tạo bảng một lần cho mỗi lần khởi động (cold start trên Vercel)
function db() {
  client ??= makeClient();
  ready ??= client.executeMultiple(SCHEMA).catch((e) => { ready = null; throw e; });
  return ready.then(() => client);
}

const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

export async function all(sql, args = []) {
  return toObjects(await (await db()).execute({ sql, args }));
}
export async function get(sql, args = []) {
  return (await all(sql, args))[0];
}
// Ghi nhiều câu lệnh trong một transaction
export async function write(stmts) {
  if (!stmts.length) return;
  await (await db()).batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
}
