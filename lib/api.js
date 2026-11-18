// Logic API dùng chung cho Vercel (api/index.js) và server chạy ở máy (server.js)
import { all, get, write } from './db.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const DAY = 864e5;

// ---------- Ngày tháng (số ngày kể từ 1970-01-01, không lệch múi giờ) ----------
const toNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const toISO = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const mondayOf = (n) => n - ((new Date(n * DAY).getUTCDay() + 6) % 7);

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const need = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

// ---------- Truy vấn ----------
const q = {
  members: () => all('SELECT id, name, color, position FROM members ORDER BY position, id'),
  tasks: () => all('SELECT id, name, position FROM tasks ORDER BY position, id'),
  setting: async (k) => (await get('SELECT value FROM settings WHERE key = ?', [k]))?.value,
};

async function state() {
  const [members, tasks, settings, assignments, checks, completions, historyDates, count] = await Promise.all([
    q.members(),
    q.tasks(),
    all('SELECT key, value FROM settings'),
    all('SELECT date, member_id, note FROM assignments'),
    all('SELECT date, task_id FROM task_checks'),
    all('SELECT date FROM completions'),
    all('SELECT DISTINCT date FROM history WHERE date IS NOT NULL'),
    get('SELECT COUNT(*) AS n FROM history'),
  ]);
  return {
    members,
    tasks,
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
    assignments,
    checks,
    completions: completions.map((r) => r.date),
    historyDates: historyDates.map((r) => r.date),
    historyCount: Number(count.n),
  };
}

// Chỉ "thêm" thì không cần người sửa; sửa/xoá thì cần người sửa (và lý do nếu ảnh hưởng tới lịch)
async function audit(b, reasonRequired, editorRequired = true) {
  const editor = clean(b.editor, 40);
  const reason = clean(b.reason, 200);
  need(!editorRequired || editor, 'Cần chọn người sửa');
  if (editor) need((await q.members()).some((m) => m.name === editor), 'Người sửa phải là thành viên trong danh sách');
  need(!reasonRequired || reason, 'Cần ghi lý do');
  return { editor, reason };
}
const logStmt = ({ editor, reason }, summary, date = null) =>
  ['INSERT INTO history (at, editor, reason, date, summary) VALUES (?, ?, ?, ?, ?)', [Date.now(), editor, reason, date, summary]];

// So sánh danh sách cũ/mới (thành viên hoặc việc), trả về các dòng mô tả thay đổi
function diffList(oldItems, newItems, { label, withColor }) {
  const lines = [];
  let edits = 0; // số thay đổi không phải "thêm"
  const oldById = new Map(oldItems.map((o) => [o.id, o]));
  const keptIds = new Set(newItems.filter((n) => n.id && oldById.has(n.id)).map((n) => n.id));
  for (const n of newItems) {
    const o = n.id && oldById.get(n.id);
    if (!o) lines.push(`Thêm ${label} "${n.name}"`);
    else {
      if (o.name !== n.name) { lines.push(`Đổi tên "${o.name}" → "${n.name}"`); edits++; }
      if (withColor && o.color.toLowerCase() !== n.color.toLowerCase()) { lines.push(`Đổi màu "${n.name}"`); edits++; }
    }
  }
  for (const o of oldItems) if (!keptIds.has(o.id)) { lines.push(`Xoá ${label} "${o.name}"`); edits++; }
  const oldOrder = oldItems.filter((o) => keptIds.has(o.id)).map((o) => o.id).join();
  const newOrder = newItems.filter((n) => keptIds.has(n.id)).map((n) => n.id).join();
  if (oldOrder !== newOrder) { lines.push(`Đổi thứ tự: ${newItems.map((n) => n.name).join(' → ')}`); edits++; }
  return { lines, edits };
}

async function saveList(b, { label, withColor }) {
  need(Array.isArray(b.items), 'Thiếu danh sách');
  const items = b.items.map((it) => ({
    id: Number(it.id) || null,
    name: clean(it.name, 40),
    color: withColor ? (HEX.test(it.color) ? it.color : '#6c8cff') : undefined,
  }));
  need(items.every((it) => it.name), 'Tên không được để trống');
  const old = withColor ? await q.members() : await q.tasks();
  const { lines, edits } = diffList(old, items, { label, withColor });
  if (!lines.length) return state();
  const who = await audit(b, edits > 0, edits > 0);

  const stmts = [];
  const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
  for (const o of old) {
    if (keep.has(o.id)) continue;
    if (withColor) stmts.push(['DELETE FROM assignments WHERE member_id = ?', [o.id]], ['DELETE FROM members WHERE id = ?', [o.id]]);
    else stmts.push(['DELETE FROM task_checks WHERE task_id = ?', [o.id]], ['DELETE FROM tasks WHERE id = ?', [o.id]]);
  }
  items.forEach((it, pos) => {
    const exists = it.id && old.some((o) => o.id === it.id);
    if (withColor) {
      stmts.push(exists
        ? ['UPDATE members SET name = ?, color = ?, position = ? WHERE id = ?', [it.name, it.color, pos, it.id]]
        : ['INSERT INTO members (name, color, position) VALUES (?, ?, ?)', [it.name, it.color, pos]]);
    } else {
      stmts.push(exists
        ? ['UPDATE tasks SET name = ?, position = ? WHERE id = ?', [it.name, pos, it.id]]
        : ['INSERT INTO tasks (name, position) VALUES (?, ?)', [it.name, pos]]);
    }
  });
  stmts.push(logStmt(who, lines.join('; ')));
  await write(stmts);
  return state();
}

// Tick / bỏ tick việc: tự lưu, không cần người sửa. Chỉ cho ngày đã phân công.
async function saveCheck(date, b) {
  need(await get('SELECT 1 AS x FROM assignments WHERE date = ?', [date]), 'Ngày này chưa phân công người trực');
  const done = !!b.done;
  const nobody = { editor: '', reason: '' };
  if (b.task_id != null) {
    const task = (await q.tasks()).find((t) => t.id === Number(b.task_id));
    need(task, 'Việc không tồn tại');
    const had = !!(await get('SELECT 1 AS x FROM task_checks WHERE date = ? AND task_id = ?', [date, task.id]));
    if (had === done) return state();
    await write([
      done
        ? ['INSERT INTO task_checks (date, task_id) VALUES (?, ?)', [date, task.id]]
        : ['DELETE FROM task_checks WHERE date = ? AND task_id = ?', [date, task.id]],
      logStmt(nobody, `${done ? 'Đã làm' : 'Bỏ tick'}: ${task.name}`, date),
    ]);
  } else {
    const had = !!(await get('SELECT 1 AS x FROM completions WHERE date = ?', [date]));
    if (had === done) return state();
    await write([
      done ? ['INSERT INTO completions (date) VALUES (?)', [date]] : ['DELETE FROM completions WHERE date = ?', [date]],
      logStmt(nobody, done ? 'Đánh dấu đã trực xong' : 'Bỏ đánh dấu đã trực xong', date),
    ]);
  }
  return state();
}

// Phân công người trực: ngày này, hoặc cả tuần nếu người dùng chọn "áp dụng cả tuần"
async function saveDay(date, b) {
  const members = await q.members();
  const byId = (id) => members.find((x) => x.id === id);
  const lines = new Map(); // date -> [mô tả]
  const add = (d, line) => { if (!lines.has(d)) lines.set(d, []); lines.get(d).push(line); };
  let isEdit = false;       // đổi/bỏ người, sửa ghi chú (không chỉ thêm) → cần người sửa
  let assignEdited = false; // đổi/bỏ người trực → cần lý do

  const newId = b.member_id == null ? null : Number(b.member_id);
  if (newId != null) need(byId(newId), 'Thành viên không tồn tại');
  const note = newId == null ? '' : clean(b.note, 120);
  const mon = mondayOf(toNum(date));
  const dates = b.whole_week ? Array.from({ length: 7 }, (_, i) => toISO(mon + i)) : [date];
  const existing = new Map((await all(
    `SELECT date, member_id, note FROM assignments WHERE date IN (${dates.map(() => '?').join(',')})`, dates,
  )).map((r) => [r.date, r]));

  const stmts = [];
  for (const d of dates) {
    const old = existing.get(d);
    const oldId = old?.member_id ?? null;
    if (oldId === newId && (newId == null || old.note === note)) continue;
    if (oldId == null) add(d, `Phân công: ${byId(newId).name}${note ? ` (ghi chú: "${note}")` : ''}`);
    else if (newId == null) { add(d, `Bỏ phân công: ${byId(oldId)?.name ?? '—'}`); isEdit = assignEdited = true; }
    else if (oldId !== newId) { add(d, `Đổi người trực: ${byId(oldId)?.name ?? '—'} → ${byId(newId).name}${note ? ` (ghi chú: "${note}")` : ''}`); isEdit = assignEdited = true; }
    else { add(d, `Sửa ghi chú: "${note}"`); isEdit = true; }
    stmts.push(newId == null
      ? ['DELETE FROM assignments WHERE date = ?', [d]]
      : [`INSERT INTO assignments (date, member_id, note) VALUES (?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET member_id = excluded.member_id, note = excluded.note`, [d, newId, note]]);
  }
  if (!lines.size) return state();
  const who = await audit(b, assignEdited, isEdit);
  for (const [d, ls] of lines) stmts.push(logStmt(who, ls.join('; '), d));
  await write(stmts);
  return state();
}

async function saveSettings(b) {
  const oldTitle = (await q.setting('title')) || 'Lịch trực nhật';
  const title = clean(b.title, 60) || 'Lịch trực nhật';
  if (title === oldTitle) return state();
  const who = await audit(b, true);
  await write([
    ['INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['title', title]],
    logStmt(who, `Đổi tiêu đề: "${oldTitle}" → "${title}"`),
  ]);
  return state();
}

/**
 * @param {{ method: string, parts: string[], query: URLSearchParams, body: object }} req
 *   parts: đường dẫn sau /api/, vd. ['days', '2026-11-18', 'check']
 */
export async function handleApi({ method, parts, query, body = {} }) {
  const [a, b, c] = parts;
  if (method === 'GET' && a === 'state') return state();
  if (method === 'GET' && a === 'history') {
    const date = query.get('date');
    if (date) {
      need(ISO_DATE.test(date), 'Ngày không hợp lệ');
      return all('SELECT * FROM history WHERE date = ? ORDER BY at DESC', [date]);
    }
    return all('SELECT * FROM history ORDER BY at DESC LIMIT 300');
  }
  if (method === 'PUT' && a === 'members') return saveList(body, { label: 'thành viên', withColor: true });
  if (method === 'PUT' && a === 'tasks') return saveList(body, { label: 'việc', withColor: false });
  if (method === 'PUT' && a === 'days' && ISO_DATE.test(b ?? '')) {
    if (c === 'check' && parts.length === 3) return saveCheck(b, body);
    if (parts.length === 2) return saveDay(b, body);
  }
  if (method === 'PUT' && a === 'settings') return saveSettings(body);
  throw new HttpError(404, 'Không tìm thấy');
}

// Chuyển lỗi thành { status, body } để trả về client
export function errorResponse(e) {
  const status = e.status || 500;
  if (status === 500) console.error(e);
  return { status, body: { error: e.status ? e.message : (e.message?.includes('TURSO') ? e.message : 'Lỗi server') } };
}
