// ---------- Ngày tháng: dùng "số ngày kể từ 1970-01-01" (UTC) để không bị lệch múi giờ ----------
const DAY = 864e5;
const toNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const toISO = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const parts = (n) => { const d = new Date(n * DAY); return { d: d.getUTCDate(), m: d.getUTCMonth() + 1, y: d.getUTCFullYear(), w: d.getUTCDay() }; };
const mondayOf = (n) => n - ((parts(n).w + 6) % 7);
const todayNum = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY; };

const DOW = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DOW_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dm = (n) => { const p = parts(n); return `${p.d}/${p.m}`; };
const range = (mon) => `${dm(mon)} – ${dm(mon + 6)}`;
const dayLabel = (n) => `${DOW[parts(n).w]}, ${dm(n)}`;
const timeFmt = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

// ---------- State ----------
let S = { members: [], tasks: [], settings: {}, assignments: [], checks: [], completions: [], historyDates: [], historyCount: 0 };
let assignMap = new Map();
let checksByDate = new Map();
let doneSet = new Set();
let historyDates = new Set();
let offset = 0; // số tuần lệch so với tuần hiện tại đang xem

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const { style, dataset, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  if (style) e.setAttribute('style', style);
  if (dataset) Object.assign(e.dataset, dataset);
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
};
const memberById = (id) => S.members.find((m) => m.id === id);

function dayInfo(n) {
  const iso = toISO(n);
  const a = assignMap.get(iso);
  const who = (a && memberById(a.member_id)) || null;
  const checked = checksByDate.get(iso) ?? new Set();
  const total = S.tasks.length;
  const doneCount = S.tasks.filter((t) => checked.has(t.id)).length;
  const done = total ? doneCount === total : doneSet.has(iso);
  return { iso, who, note: a?.note || '', checked, total, doneCount, done };
}

// ---------- API ----------
async function call(method, path, data) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: data ? { 'content-type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`);
  return json;
}
function apply(next) {
  S = next;
  assignMap = new Map(S.assignments.map((o) => [o.date, o]));
  checksByDate = new Map();
  for (const c of S.checks) {
    if (!checksByDate.has(c.date)) checksByDate.set(c.date, new Set());
    checksByDate.get(c.date).add(c.task_id);
  }
  doneSet = new Set(S.completions);
  historyDates = new Set(S.historyDates);
  render();
}
async function refresh() {
  try { apply(await call('GET', 'state')); } catch (e) { toast(`⚠️ ${e.message}`); }
}
// Gửi thay đổi; lỗi thì ném ra để dialog giữ nguyên dữ liệu người dùng đã nhập
async function save(method, path, data, msg) {
  apply(await call(method, path, data));
  if (msg) toast(msg);
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- Nhớ "người sửa" trên máy này (tiện lợi, không bắt buộc) ----------
const rememberEditor = (v) => { try { localStorage.setItem('editor', v); } catch {} };
const lastEditor = () => { try { return localStorage.getItem('editor') || ''; } catch { return ''; } };

// ---------- Render ----------
const chip = (m) => (m
  ? el('span', { className: 'chip', style: `--c:${m.color}` }, m.name)
  : el('span', { className: 'chip empty' }, 'Chưa phân công'));

function render() {
  const title = S.settings.title || 'Lịch trực nhật';
  $('#title').textContent = title;
  document.title = title;

  const today = todayNum();
  const p = parts(today);
  $('#today-label').textContent = `Hôm nay: ${DOW[p.w]}, ${p.d}/${p.m}/${p.y}`;

  renderHero(today);

  // Hai tuần: tuần đang xem + tuần kế
  const base = mondayOf(today) + offset * 7;
  const label = (k) => {
    const o = offset + k;
    return o === 0 ? 'Tuần này' : o === 1 ? 'Tuần sau' : o === -1 ? 'Tuần trước' : o > 0 ? `${o} tuần nữa` : `${-o} tuần trước`;
  };
  $('#weeks').replaceChildren(...[0, 1].map((k) => {
    const mon = base + k * 7;
    const assigned = Array.from({ length: 7 }, (_, i) => assignMap.has(toISO(mon + i))).filter(Boolean).length;
    return el('section', { className: 'card week' },
      el('header', { className: 'week-head' },
        el('h2', {}, label(k), ' ', el('span', { className: 'range' }, range(mon))),
        el('span', { className: 'week-count' }, `${assigned}/7 ngày đã phân công`),
      ),
      el('ol', { className: 'days' }, ...Array.from({ length: 7 }, (_, i) => dayRow(mon + i, today))),
    );
  }));

  $('#open-history').textContent = `🕘 Lịch sử${S.historyCount ? ` (${S.historyCount})` : ''}`;
}

function renderHero(today) {
  const hero = $('#hero');
  if (!S.members.length) {
    hero.style.removeProperty('--c');
    const btn = el('button', { type: 'button', className: 'btn primary' }, '👥 Thêm thành viên');
    btn.addEventListener('click', () => openMembers(true));
    hero.replaceChildren(
      el('span', { className: 'eyebrow' }, 'Bắt đầu'),
      el('span', { className: 'who' }, 'Chưa có ai trong lịch'),
      el('span', { className: 'sub' }, 'Thêm thành viên và danh sách việc cần làm, sau đó bấm vào từng ngày để phân công người trực.'),
      el('div', { className: 'row' }, btn),
    );
    return;
  }
  const t = dayInfo(today);
  hero.style.setProperty('--c', t.who?.color ?? 'var(--brand)');
  const update = el('button', { type: 'button', className: 'btn' }, t.who ? '✏️ Cập nhật hôm nay' : '➕ Phân công hôm nay');
  update.addEventListener('click', () => openDay(today));
  hero.replaceChildren(...[
    el('span', { className: 'eyebrow' }, 'Hôm nay ai trực?'),
    el('span', { className: 'who' }, t.who?.name ?? 'Chưa phân công'),
    t.note ? el('span', { className: 'sub' }, t.note) : null,
    // Đã phân công → tick việc ngay tại đây, tự lưu
    t.who ? todoList(today, t) : null,
    el('div', { className: 'row' },
      t.who ? el('span', { className: `badge ${t.done ? '' : 'pending'}` },
        t.done ? '✓ Đã trực xong' : t.total ? `Đã làm ${t.doneCount}/${t.total} việc` : 'Chưa trực') : null,
      update),
  ].filter(Boolean));
}

function todoList(n, t) {
  const item = (key, label, checked, payload) => {
    const box = el('input', { type: 'checkbox', checked, dataset: { todo: key } });
    box.addEventListener('change', () => toggleCheck(n, payload(box.checked), box));
    return el('li', {}, el('label', { className: 'todo-item' }, box, el('span', {}, label)));
  };
  return el('ul', { className: 'todo', ariaLabel: 'Việc cần làm hôm nay' }, ...(S.tasks.length
    ? S.tasks.map((task) => item(`t${task.id}`, task.name, t.checked.has(task.id), (done) => ({ task_id: task.id, done })))
    : [item('done', 'Đã trực xong', t.done, (done) => ({ done }))]));
}
async function toggleCheck(n, payload, box) {
  const key = box.dataset.todo;
  box.disabled = true;
  try {
    await save('PUT', `days/${toISO(n)}/check`, payload, payload.done ? 'Đã tick ✓' : 'Đã bỏ tick');
  } catch (e) {
    box.checked = !payload.done;
    toast(`⚠️ ${e.message}`);
  } finally {
    box.disabled = false;
  }
  // Giữ focus trên ô vừa tick sau khi vẽ lại (người dùng bàn phím)
  document.querySelector(`[data-todo="${key}"]`)?.focus();
}

function dayRow(n, today) {
  const d = dayInfo(n);
  const status = d.done ? '✓' : d.total && d.doneCount ? `${d.doneCount}/${d.total}` : '';
  const btn = el('button', {
    type: 'button',
    className: `day${n === today ? ' today' : ''}${n < today ? ' past' : ''}`,
    style: `--c:${d.who?.color ?? 'var(--brand)'}`,
    ariaLabel: `${dayLabel(n)}: ${d.who?.name ?? 'chưa có người trực'}${d.done ? ', đã xong' : status ? `, đã làm ${status} việc` : ''}. Bấm để sửa`,
  },
    el('span', { className: 'date' },
      el('span', { className: 'dow' }, DOW_SHORT[parts(n).w]),
      el('span', { className: 'dm' }, dm(n)),
    ),
    el('span', {},
      chip(d.who),
      n === today ? el('span', { className: 'tag-today' }, 'Hôm nay') : null,
      d.note ? el('span', { className: 'note' }, d.note) : null,
    ),
    el('span', { className: `status${d.done ? ' done' : ''}`, ariaHidden: 'true' }, status),
  );
  btn.addEventListener('click', () => openDay(n));
  let hist = null;
  if (historyDates.has(d.iso)) {
    hist = el('button', { type: 'button', className: 'btn icon hist', ariaLabel: `Xem lịch sử sửa ${dayLabel(n)}`, title: 'Lịch sử sửa ngày này' }, '🕘');
    hist.addEventListener('click', () => openHistory(n));
  }
  return el('li', { className: 'day-row' }, btn, hist);
}

// ---------- Khối "Người sửa / Lý do" ----------
// Chỉ bắt buộc khi thực sự có thay đổi, để bấm Lưu mà không đổi gì thì chỉ đóng dialog.
// Chỉ "thêm" thì ẩn khung này; sửa/xoá mới hiện và bắt buộc.
function setAudit(form, { editorRequired, reasonRequired }) {
  form.editor.required = editorRequired;
  form.reason.required = reasonRequired;
  $('.audit', form).hidden = !editorRequired;
}
// "Người sửa" chỉ chọn trong danh sách thành viên (không tự gõ)
function prepAudit(form) {
  form.editor.replaceChildren(
    el('option', { value: '' }, S.members.length ? '— Chọn người sửa —' : 'Chưa có thành viên'),
    ...S.members.map((m) => el('option', { value: m.name }, m.name)));
  form.editor.value = S.members.some((m) => m.name === lastEditor()) ? lastEditor() : '';
  form.reason.value = '';
  for (const f of [form.editor, form.reason]) { f.setAttribute('aria-invalid', 'false'); linkError(f, false); }
}
const auditData = (form) => ($('.audit', form).hidden
  ? {} // chỉ thêm: không ghi người sửa
  : { editor: form.editor.value.trim(), reason: form.reason.value.trim() });

// Gửi form: chặn đóng dialog cho tới khi server lưu xong; lỗi thì giữ dialog mở.
function handleSubmit(form, dialog, run) {
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const changed = await run();
      if (changed !== false && !$('.audit', form).hidden && form.editor?.value.trim()) rememberEditor(form.editor.value.trim());
      dialog.close();
    } catch (err) {
      toast(`⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Dialog: một ngày ----------
const dayDialog = $('#day-dialog');
const dayForm = $('#day-form');
let editing = null; // { n, original }

function dayFormValue() {
  const who = new FormData(dayForm).get('who');
  return {
    member_id: who ? Number(who) : null,
    note: dayForm.note.value.trim(),
    whole_week: dayForm.whole_week.checked && who != null && who !== '',
  };
}
function refreshDayAudit() {
  if (!editing) return;
  const now = dayFormValue();
  // Ngày chưa có ai → phân công là "thêm". Đổi/bỏ người đã phân công → "sửa" (cần người sửa + lý do).
  const mon = mondayOf(editing.n);
  const dates = now.whole_week ? Array.from({ length: 7 }, (_, i) => mon + i) : [editing.n];
  let assignChanged = false;
  let noteChanged = false;
  for (const n of dates) {
    const old = assignMap.get(toISO(n));
    if (!old) continue;
    if (old.member_id !== now.member_id) assignChanged = true;
    else if (now.member_id != null && old.note !== now.note) noteChanged = true;
  }
  const isEdit = assignChanged || noteChanged;
  setAudit(dayForm, { editorRequired: isEdit, reasonRequired: assignChanged });
  $('#day-reason-req').textContent = assignChanged ? '*' : '(bắt buộc khi đổi/bỏ người trực)';
  $('#day-note-field').hidden = now.member_id == null;
  $('#day-week-field').hidden = now.member_id == null;
}

function openDay(n) {
  dayForm.reset(); // xoá trạng thái lỗi (:user-invalid) còn lại từ lần mở trước
  const d = dayInfo(n);
  $('#day-title').textContent = dayLabel(n);
  const current = assignMap.get(d.iso)?.member_id ?? '';
  const opt = (value, m, hint) => el('label', { style: `--c:${m?.color ?? 'gray'}` },
    el('input', { type: 'radio', name: 'who', value: String(value), checked: String(current) === String(value) }),
    el('span', { className: 'dot' }), m?.name ?? 'Chưa phân công', hint ? el('small', {}, hint) : null);
  $('#day-choices').replaceChildren(...(S.members.length
    ? [opt('', null, ''), ...S.members.map((m) => opt(m.id, m))]
    : [el('p', { className: 'muted small' }, 'Chưa có thành viên. Thêm ở nút “👥 Thành viên”.')]));
  dayForm.note.value = d.note;
  dayForm.whole_week.checked = false;
  $('#day-week-label').textContent = `Áp dụng cho cả tuần ${range(mondayOf(n))}`;

  prepAudit(dayForm);
  editing = { n, original: null };
  editing.original = dayFormValue();
  refreshDayAudit();
  dayDialog.showModal();
}
dayForm.addEventListener('input', refreshDayAudit);
dayForm.addEventListener('change', refreshDayAudit);
handleSubmit(dayForm, dayDialog, async () => {
  const now = dayFormValue();
  const o = editing.original;
  if (!now.whole_week && JSON.stringify(now) === JSON.stringify(o)) return false;
  await save('PUT', `days/${toISO(editing.n)}`, { ...now, ...auditData(dayForm) }, 'Đã lưu');
});

// ---------- Dialog: danh sách (thành viên / việc) ----------
function listEditor({ dialog, form, listEl, withColor, source, endpoint, emptyText, defaultColors }) {
  let draft = [];
  let original = '';
  const snapshot = () => JSON.stringify(draft.map(({ id, name, color }) => ({ id, name: name.trim(), color })));
  let originalItems = [];
  // Có sửa/xoá/sắp xếp lại mục cũ không? (chỉ thêm mục mới thì không tính)
  const hasEdits = () => {
    const kept = draft.filter((d) => d.id != null);
    if (kept.length !== originalItems.length) return true; // có mục bị xoá
    return kept.some((d, i) => {
      const o = originalItems[i];
      return d.id !== o.id || d.name.trim() !== o.name || (withColor && d.color.toLowerCase() !== o.color.toLowerCase());
    });
  };
  const refreshAudit = () => {
    const edit = hasEdits();
    setAudit(form, { editorRequired: edit, reasonRequired: edit });
  };

  function renderList() {
    if (!draft.length) { listEl.replaceChildren(el('li', { className: 'empty' }, emptyText)); refreshAudit(); return; }
    listEl.replaceChildren(...draft.map((item, i) => {
      const name = el('input', { name: 'item_name', value: item.name, maxLength: 40, required: true, ariaLabel: `Tên ${i + 1}` });
      name.addEventListener('input', () => { item.name = name.value; refreshAudit(); });
      const kids = [];
      if (withColor) {
        const color = el('input', { type: 'color', value: item.color, ariaLabel: `Màu của ${item.name}` });
        color.addEventListener('input', () => { item.color = color.value; refreshAudit(); });
        kids.push(color);
      }
      const move = (dir) => { [draft[i], draft[i + dir]] = [draft[i + dir], draft[i]]; renderList(); };
      const up = el('button', { type: 'button', className: 'btn icon', ariaLabel: `Đưa ${item.name} lên`, disabled: i === 0 }, '↑');
      const down = el('button', { type: 'button', className: 'btn icon', ariaLabel: `Đưa ${item.name} xuống`, disabled: i === draft.length - 1 }, '↓');
      const del = el('button', { type: 'button', className: 'btn icon danger', ariaLabel: `Xoá ${item.name}` }, '🗑');
      up.addEventListener('click', () => move(-1));
      down.addEventListener('click', () => move(1));
      del.addEventListener('click', () => { draft.splice(i, 1); renderList(); });
      return el('li', {}, ...kids, name, up, down, del);
    }));
    refreshAudit();
  }

  function add() {
    const name = form.new_name.value.trim();
    if (!name) { form.new_name.focus(); return; }
    draft.push({ id: null, name, color: withColor ? form.new_color.value : undefined });
    form.new_name.value = '';
    if (withColor) form.new_color.value = defaultColors[draft.length % defaultColors.length];
    renderList();
    form.new_name.focus();
  }
  $('[data-add]', form).addEventListener('click', add);
  form.new_name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); }
  });

  handleSubmit(form, dialog, async () => {
    if (snapshot() === original) return false;
    await save('PUT', endpoint, { items: draft.map(({ id, name, color }) => ({ id, name: name.trim(), color })), ...auditData(form) }, 'Đã lưu');
  });

  return function open(show = false) {
    form.reset();
    draft = source().map((x) => ({ ...x }));
    originalItems = source().map((x) => ({ ...x }));
    original = snapshot();
    form.new_name.value = '';
    if (withColor) form.new_color.value = defaultColors[draft.length % defaultColors.length];
    prepAudit(form);
    renderList();
    if (show) dialog.showModal();
  };
}

const PALETTE = ['#7c9cff', '#4fbf7f', '#46b3e6', '#f08a6c', '#c084fc', '#f5b84b', '#ec6fa5', '#5cc8b8'];
const openMembers = listEditor({
  dialog: $('#members-dialog'), form: $('#members-form'), listEl: $('#member-list'),
  withColor: true, source: () => S.members, endpoint: 'members',
  emptyText: 'Chưa có thành viên nào.', defaultColors: PALETTE,
});
const openTasks = listEditor({
  dialog: $('#tasks-dialog'), form: $('#tasks-form'), listEl: $('#task-list'),
  withColor: false, source: () => S.tasks, endpoint: 'tasks',
  emptyText: 'Chưa có việc nào.', defaultColors: PALETTE,
});
// Click chạy trước hành động command="show-modal", nên điền form ở đây
$('#open-members').addEventListener('click', () => openMembers());
$('#open-tasks').addEventListener('click', () => openTasks());

// ---------- Dialog: cài đặt ----------
const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');
let settingsOriginal = '';
const settingsValue = () => settingsForm.elements.title.value.trim();
const refreshSettingsAudit = () => {
  const changed = settingsValue() !== settingsOriginal;
  setAudit(settingsForm, { editorRequired: changed, reasonRequired: changed });
};
$('#open-settings').addEventListener('click', () => {
  settingsForm.reset();
  settingsForm.elements.title.value = S.settings.title || 'Lịch trực nhật';
  prepAudit(settingsForm);
  settingsOriginal = settingsValue();
  refreshSettingsAudit();
});
settingsForm.addEventListener('input', refreshSettingsAudit);
handleSubmit(settingsForm, settingsDialog, async () => {
  if (settingsValue() === settingsOriginal) return false;
  await save('PUT', 'settings', { title: settingsValue(), ...auditData(settingsForm) }, 'Đã lưu cài đặt');
});

// ---------- Dialog: lịch sử ----------
const historyDialog = $('#history-dialog');
async function openHistory(n = null) {
  $('#history-title').textContent = n == null ? 'Lịch sử chỉnh sửa' : `Lịch sử sửa · ${dayLabel(n)}`;
  const body = $('#history-body');
  body.replaceChildren(el('tr', {}, el('td', { className: 'empty', colSpan: 4 }, 'Đang tải…')));
  historyDialog.showModal();
  try {
    const rows = await call('GET', n == null ? 'history' : `history?date=${toISO(n)}`);
    body.replaceChildren(...(rows.length ? rows.map((r) => el('tr', {},
      el('th', { scope: 'row' }, timeFmt.format(new Date(r.at))),
      el('td', {}, r.editor || '—'),
      el('td', {},
        r.date && n == null ? el('span', { className: 'when-date' }, `${DOW_SHORT[parts(toNum(r.date)).w]} ${dm(toNum(r.date))}:`) : null,
        r.summary),
      el('td', {}, r.reason),
    )) : [el('tr', {}, el('td', { className: 'empty', colSpan: 4 }, 'Chưa có chỉnh sửa nào.'))]));
  } catch (e) {
    body.replaceChildren(el('tr', {}, el('td', { className: 'empty', colSpan: 4 }, `⚠️ ${e.message}`)));
  }
}
$('#open-history').addEventListener('click', () => openHistory());

// ---------- Điều hướng tuần ----------
$('#prev').addEventListener('click', () => { offset--; render(); });
$('#next').addEventListener('click', () => { offset++; render(); });
$('#go-today').addEventListener('click', () => { offset = 0; render(); });

// Nút Huỷ: type="button" để Enter trong ô nhập không bấm nhầm Huỷ
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close(''); });

// ---------- Báo lỗi ô bắt buộc cho trình đọc màn hình (đồng bộ aria-invalid với :user-invalid) ----------
function linkError(f, shown) {
  const id = f.dataset.error;
  if (!id) return;
  const ids = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== id);
  if (shown) ids.push(id);
  if (ids.length) f.setAttribute('aria-describedby', ids.join(' '));
  else f.removeAttribute('aria-describedby');
}
const announcer = el('div', { className: 'visually-hidden' });
announcer.setAttribute('aria-live', 'polite');
document.body.append(announcer);
const hasUserInvalid = CSS.supports('selector(:user-invalid)');
const isUserInvalid = (f) => (hasUserInvalid ? f.matches(':user-invalid') : f.classList.contains('user-invalid-fallback'));
const announced = new WeakSet();
function syncAria(f, announce = false) {
  if (!f.matches?.('input, select, textarea') || !f.dataset.error) return;
  const invalid = isUserInvalid(f);
  f.setAttribute('aria-invalid', String(invalid));
  linkError(f, invalid);
  if (invalid && announce && !announced.has(f)) {
    announced.add(f);
    const msg = document.getElementById(f.dataset.error)?.textContent.replace(/\s+/g, ' ').trim();
    setTimeout(() => { announcer.textContent = msg ?? ''; }, 500);
  }
  if (!invalid) announced.delete(f);
}
const touched = new WeakSet();
const fallbackMark = (f) => { if (!hasUserInvalid && f.dataset?.error) f.classList.toggle('user-invalid-fallback', !f.validity.valid); };
document.addEventListener('blur', (e) => { if (touched.has(e.target)) fallbackMark(e.target); syncAria(e.target, true); }, true);
document.addEventListener('input', (e) => { touched.add(e.target); if (e.target.classList?.contains('user-invalid-fallback')) fallbackMark(e.target); syncAria(e.target); });
document.addEventListener('invalid', (e) => { announced.add(e.target); fallbackMark(e.target); syncAria(e.target); }, true);
// Bỏ yêu cầu bắt buộc (không còn thay đổi) thì xoá trạng thái lỗi
for (const form of document.querySelectorAll('form')) {
  form.addEventListener('input', () => setTimeout(() => form.querySelectorAll('[data-error]').forEach((f) => { if (f.validity.valid) { f.classList.remove('user-invalid-fallback'); syncAria(f); } })));
}

// ---------- Fallback cho trình duyệt chưa hỗ trợ ----------
// Invoker Commands (command="show-modal")
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[command="show-modal"][commandfor]');
    if (b) document.getElementById(b.getAttribute('commandfor'))?.showModal();
  });
}
// closedby="any" (bấm ra ngoài để đóng) – Safari chưa hỗ trợ
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, d) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  for (const d of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    d.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, d); });
    d.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, d)) d.close(); });
  }
}

// ---------- Đồng bộ: ai cũng sửa được, nên tự tải lại khi quay lại tab / mỗi phút ----------
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(); });
setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(); }, 60_000);

refresh();
