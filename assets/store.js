/*!
 * 仓储图书库存 · 数据层（本地存储 + 数据模型 + 导入导出）
 * 无依赖，可直接以 file:// 打开，也可部署到任意静态托管。
 */
(function (global) {
  'use strict';

  var KEY = 'bookstock.v1';
  var SCHEMA = 1;
  var listeners = [];
  var state = null;

  /* ============ 基础工具 ============ */

  function nowISO() { return new Date().toISOString(); }

  function uuid() {
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* 非安全上下文时回退 */ }
    }
    if (c && typeof c.getRandomValues === 'function') {
      var b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var hex = [];
      for (var i = 0; i < 16; i++) { hex.push((b[i] + 0x100).toString(16).slice(1)); }
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function toISO(v) {
    if (!v) { return ''; }
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function str(v) { return v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim(); }

  function num(v, dft) {
    if (v === '' || v == null) { return dft === undefined ? 0 : dft; }
    var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : (dft === undefined ? 0 : dft);
  }

  function int(v, dft) {
    var n = num(v, dft === undefined ? 0 : dft);
    return Math.round(n);
  }

  function nonNegInt(v, dft) {
    var n = int(v, dft || 0);
    return n < 0 ? 0 : n;
  }

  /* ============ 数据模型 ============ */

  function normalizeBook(raw) {
    raw = raw || {};
    return {
      id: str(raw.id) || uuid(),
      title: str(raw.title),
      author: str(raw.author),
      isbn: str(raw.isbn),
      category: str(raw.category),
      publisher: str(raw.publisher),
      price: num(raw.price, 0),
      location: str(raw.location),
      qty: nonNegInt(raw.qty, 0),
      minQty: nonNegInt(raw.minQty != null ? raw.minQty : raw.min_qty, 0),
      unit: str(raw.unit) || '册',
      note: str(raw.note),
      tags: str(raw.tags),
      cover: str(raw.cover || raw.cover_url),
      back: str(raw.back || raw.back_url),
      photos: str(raw.photos || raw.gallery),
      soldOutAt: toISO(raw.soldOutAt || raw.sold_out_at) || '',
      deleted: !!raw.deleted,
      updatedBy: str(raw.updatedBy || raw.updated_by),
      createdAt: toISO(raw.createdAt || raw.created_at) || nowISO(),
      updatedAt: toISO(raw.updatedAt || raw.updated_at) || nowISO(),
      dirty: !!raw.dirty
    };
  }

  function normalizeLog(raw) {
    raw = raw || {};
    return {
      id: str(raw.id) || uuid(),
      bookId: str(raw.bookId || raw.book_id),
      title: str(raw.title),
      type: str(raw.type) || 'in',
      qty: int(raw.qty, 0),
      beforeQty: int(raw.beforeQty != null ? raw.beforeQty : raw.before_qty, 0),
      afterQty: int(raw.afterQty != null ? raw.afterQty : raw.after_qty, 0),
      note: str(raw.note),
      operator: str(raw.operator),
      createdAt: toISO(raw.createdAt || raw.created_at) || nowISO(),
      dirty: !!raw.dirty
    };
  }

  function emptyState() {
    return {
      v: SCHEMA,
      books: [],
      logs: [],
      settings: { operator: '', view: 'overview', seeded: false },
      cloud: { url: '', key: '', email: '', lastSyncAt: '' },
      session: null
    };
  }

  function migrate(raw) {
    var base = emptyState();
    if (!raw || typeof raw !== 'object') { return base; }
    base.settings = Object.assign(base.settings, raw.settings || {});
    base.cloud = Object.assign(base.cloud, raw.cloud || {});
    base.session = raw.session && raw.session.access_token ? raw.session : null;
    base.books = (Array.isArray(raw.books) ? raw.books : []).map(normalizeBook);
    base.logs = (Array.isArray(raw.logs) ? raw.logs : []).map(normalizeLog);
    base.logs.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return base;
  }

  /* ============ 持久化 ============ */

  var saveTimer = null;
  var memStore = {};
  var memMode = false;

  function storageReady() {
    try {
      var probe = '__bookstock_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  memMode = !storageReady();

  function readRaw() {
    if (!memMode) {
      try { return global.localStorage.getItem(KEY); } catch (e) { memMode = true; }
    }
    return Object.prototype.hasOwnProperty.call(memStore, KEY) ? memStore[KEY] : null;
  }

  function saveNow() {
    var raw = JSON.stringify(state);
    if (memMode) {
      memStore[KEY] = raw;
      return true;
    }
    try {
      global.localStorage.setItem(KEY, raw);
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        if (typeof global.alert === 'function') {
          global.alert('本地存储空间已满：请到「设置 → 数据备份」导出 CSV 或备份，再清理不用的数据。');
        }
        return false;
      }
      // 浏览器禁用了本地存储（如部分隐私模式 / file:// 限制），退回内存模式
      memMode = true;
      memStore[KEY] = raw;
      return true;
    }
  }

  function save() {
    if (saveTimer) { global.clearTimeout(saveTimer); }
    saveTimer = global.setTimeout(function () { saveTimer = null; saveNow(); }, 120);
  }

  function load() {
    try {
      var raw = readRaw();
      state = raw ? migrate(JSON.parse(raw)) : emptyState();
    } catch (e) {
      state = emptyState();
    }
    return state;
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* 单个订阅者异常不影响其它 */ }
    }
  }

  function commit() {
    save();
    emit();
  }

  /* ============ 查询 ============ */

  function books(includeDeleted) {
    return state.books.filter(function (b) { return includeDeleted || !b.deleted; });
  }

  function findBook(id) {
    for (var i = 0; i < state.books.length; i++) {
      if (state.books[i].id === id) { return state.books[i]; }
    }
    return null;
  }

  function isOut(b) { return b.qty <= 0; }  function isLow(b) { return b.qty > 0 && b.minQty > 0 && b.qty <= b.minQty; }
  function isWarn(b) { return !b.deleted && (isOut(b) || isLow(b)); }

  // 「整套照片」：每行一个图片路径/网址（只在换行处切分，图片网址里本身可能带逗号）
  function photoList(b) {
    if (!b || !b.photos) { return []; }
    return String(b.photos).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /**
   * 把一批照片分组成「一本一本」。
   * @param {Array} list 已按时间排序的文件数组（需有 lastModified、name）
   * @param {string} mode 'gap' 按拍摄间隔 | 'pair' 每 2 张 | 'each' 每张 | 'all' 全部
   * @param {number} gapSec 间隔秒数（mode=gap 时生效）
   */
  function groupPhotos(list, mode, gapSec) {
    if (!list || !list.length) { return []; }
    if (mode === 'all' || mode === 'allset') { return [list]; }
    if (mode === 'each') { return list.map(function (f) { return [f]; }); }
    if (mode === 'pair') {
      var pairs = [];
      for (var i = 0; i < list.length; i += 2) { pairs.push(list.slice(i, i + 2)); }
      return pairs;
    }
    var gap = Math.max(1, Number(gapSec) || 30) * 1000;
    var groups = [];
    var cur = [list[0]];
    for (var j = 1; j < list.length; j++) {
      var prev = Number(list[j - 1].lastModified) || 0;
      var now = Number(list[j].lastModified) || 0;
      if (now - prev > gap) { groups.push(cur); cur = []; }
      cur.push(list[j]);
    }
    if (cur.length) { groups.push(cur); }
    return groups;
  }

  function stats() {
    var list = books();
    var out = { titles: list.length, qty: 0, value: 0, warn: 0, out: 0, low: 0, categories: 0 };
    var cats = {};
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      out.qty += b.qty;
      out.value += b.qty * (b.price || 0);
      if (isOut(b)) { out.out++; }
      else if (isLow(b)) { out.low++; }
      if (b.category) { cats[b.category] = 1; }
    }
    out.warn = out.out + out.low;
    out.categories = Object.keys(cats).length;
    return out;
  }

  function categoryStats() {
    var map = {};
    var list = books();
    for (var i = 0; i < list.length; i++) {
      var c = list[i].category || '未分类';
      if (!map[c]) { map[c] = { name: c, titles: 0, qty: 0, value: 0 }; }
      map[c].titles++;
      map[c].qty += list[i].qty;
      map[c].value += list[i].qty * (list[i].price || 0);
    }
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.qty - a.qty || a.name.localeCompare(b.name, 'zh-Hans-CN'); });
  }

  function categories() {
    var seen = {};
    var out = [];
    var list = books();
    for (var i = 0; i < list.length; i++) {
      var c = list[i].category;
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    }
    return out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); });
  }

  function matchText(b, q) {
    if (!q) { return true; }
    var hay = [b.title, b.author, b.isbn, b.location, b.category, b.publisher, b.note, b.tags].join(' ').toLowerCase();
    var parts = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (hay.indexOf(parts[i]) < 0) { return false; }
    }
    return true;
  }

  function query(opt) {
    opt = opt || {};
    var q = str(opt.q);
    var cat = str(opt.category);
    var stock = str(opt.stock);
    var sort = str(opt.sort) || 'updated';
    var list = books().filter(function (b) {
      if (cat && b.category !== cat) { return false; }
      if (stock === 'low' && !isLow(b)) { return false; }
      if (stock === 'out' && !isOut(b)) { return false; }
      if (stock === 'warn' && !isWarn(b)) { return false; }
      return matchText(b, q);
    });
    var by = {
      updated: function (a, b) { return a.updatedAt < b.updatedAt ? 1 : (a.updatedAt > b.updatedAt ? -1 : 0); },
      title: function (a, b) { return a.title.localeCompare(b.title, 'zh-Hans-CN'); },
      qtyDesc: function (a, b) { return b.qty - a.qty; },
      qtyAsc: function (a, b) { return a.qty - b.qty; },
      valueDesc: function (a, b) { return b.qty * b.price - a.qty * a.price; },
      category: function (a, b) { return (a.category || '未分类').localeCompare(b.category || '未分类', 'zh-Hans-CN'); }
    };
    list.sort(by[sort] || by.updated);
    return list;
  }

  function logs(limit) {
    var list = state.logs.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return limit ? list.slice(0, limit) : list;
  }

  /* ============ 写操作 ============ */

  function touch(b) {
    b.updatedAt = nowISO();
    b.dirty = true;
  }

  // 库存归零时记下"售出时间"，补货后清掉
  function syncSoldOut(b, beforeQty) {
    if (b.qty > 0) { b.soldOutAt = ''; return; }
    if (beforeQty > 0 && b.qty === 0) { b.soldOutAt = nowISO(); }
  }

  function addLog(entry) {
    var log = normalizeLog(entry);
    log.createdAt = toISO(entry.createdAt) || nowISO();
    log.dirty = true;
    state.logs.push(log);
    if (state.logs.length > 5000) { state.logs = state.logs.slice(-4000); }
    return log;
  }

  function requireTitle(input) {
    var title = str(input.title);
    if (!title) { throw new Error('书名不能为空'); }
    return title;
  }

  function createBook(input, opt) {
    opt = opt || {};
    var t = nowISO();
    var b = normalizeBook({
      id: uuid(),
      title: requireTitle(input),
      author: input.author, isbn: input.isbn, category: input.category,
      publisher: input.publisher, price: input.price, location: input.location,
      qty: input.qty, minQty: input.minQty, unit: input.unit, note: input.note,
      tags: input.tags,
      cover: input.cover, back: input.back, photos: input.photos,
      updatedBy: opt.operator || state.settings.operator,
      createdAt: t, updatedAt: t, dirty: true
    });
    state.books.push(b);
    addLog({
      bookId: b.id, title: b.title, type: 'create', qty: b.qty, beforeQty: 0, afterQty: b.qty,
      note: opt.note || '新建图书', operator: opt.operator || state.settings.operator
    });
    commit();
    return b;
  }

  var EDITABLE = ['title', 'author', 'isbn', 'category', 'publisher', 'price', 'location', 'qty', 'minQty', 'unit', 'note', 'tags', 'cover', 'back', 'photos'];

  function updateBook(id, patch, opt) {
    opt = opt || {};
    var b = findBook(id);
    if (!b) { throw new Error('图书不存在'); }
    var before = { qty: b.qty, title: b.title };
    for (var i = 0; i < EDITABLE.length; i++) {
      var k = EDITABLE[i];
      if (!Object.prototype.hasOwnProperty.call(patch, k)) { continue; }
      if (k === 'qty' || k === 'minQty') { b[k] = nonNegInt(patch[k], 0); }
      else if (k === 'price') { b[k] = num(patch[k], 0); }
      else { b[k] = str(patch[k]); }
    }
    if (!b.title) { b.title = before.title; }
    b.updatedBy = opt.operator || state.settings.operator;
    syncSoldOut(b, before.qty);
    touch(b);
    if (before.qty !== b.qty) {
      addLog({
        bookId: b.id, title: b.title, type: 'adjust', qty: b.qty - before.qty,
        beforeQty: before.qty, afterQty: b.qty,
        note: opt.note || '编辑时修改库存', operator: b.updatedBy
      });
    }
    commit();
    return b;
  }

  function deleteBook(id, opt) {
    opt = opt || {};
    var b = findBook(id);
    if (!b) { throw new Error('图书不存在'); }
    b.deleted = true;
    b.updatedBy = opt.operator || state.settings.operator;
    touch(b);
    addLog({
      bookId: b.id, title: b.title, type: 'delete', qty: -b.qty,
      beforeQty: b.qty, afterQty: 0,
      note: opt.note || '删除图书', operator: b.updatedBy
    });
    commit();
    return b;
  }

  function restoreBook(id) {
    var b = findBook(id);
    if (!b) { throw new Error('图书不存在'); }
    b.deleted = false;
    touch(b);
    commit();
    return b;
  }

  /**
   * 出入库
   * @param {string} id 图书 id
   * @param {number} delta 正数入库、负数出库
   */
  function moveStock(id, delta, opt) {
    opt = opt || {};
    var b = findBook(id);
    if (!b) { throw new Error('图书不存在'); }
    var d = int(delta, 0);
    if (!d) { throw new Error('数量不能为 0'); }
    var next = b.qty + d;
    if (next < 0) { next = 0; }
    var real = next - b.qty;
    if (!real) { throw new Error('库存已是 0，无法再出库'); }
    var before = b.qty;
    b.qty = next;
    b.updatedBy = opt.operator || state.settings.operator;
    syncSoldOut(b, before);
    touch(b);
    var log = addLog({
      bookId: b.id, title: b.title, type: real > 0 ? 'in' : 'out', qty: real,
      beforeQty: before, afterQty: next,
      note: opt.note || '', operator: b.updatedBy
    });
    commit();
    return { book: b, log: log, applied: real };
  }

  function setQty(id, qty, opt) {
    opt = opt || {};
    var b = findBook(id);
    if (!b) { throw new Error('图书不存在'); }
    var next = nonNegInt(qty, 0);
    var before = b.qty;
    if (next === before) { return { book: b, applied: 0 }; }
    b.qty = next;
    b.updatedBy = opt.operator || state.settings.operator;
    syncSoldOut(b, before);
    touch(b);
    addLog({
      bookId: b.id, title: b.title, type: 'adjust', qty: next - before,
      beforeQty: before, afterQty: next,
      note: opt.note || '盘点修正', operator: b.updatedBy
    });
    commit();
    return { book: b, applied: next - before };
  }

  function undoLog(logId, operator) {
    var log = null;
    for (var i = 0; i < state.logs.length; i++) {
      if (state.logs[i].id === logId) { log = state.logs[i]; break; }
    }
    if (!log) { throw new Error('记录不存在'); }
    var b = findBook(log.bookId);
    if (!b) { throw new Error('图书已被删除，无法撤销'); }
    if (log.type === 'delete') { return restoreBook(b.id); }
    var back = -log.qty;
    var next = b.qty + back;
    if (next < 0) { next = 0; }
    var before = b.qty;
    b.qty = next;
    b.updatedBy = operator || state.settings.operator;
    touch(b);
    addLog({
      bookId: b.id, title: b.title, type: 'undo', qty: next - before,
      beforeQty: before, afterQty: next,
      note: '撤销：' + (log.type === 'in' ? '入库' : log.type === 'out' ? '出库' : '调整') + ' ' + Math.abs(log.qty), operator: b.updatedBy
    });
    commit();
    return b;
  }

  function undoStock(log) {
    if (!log) { throw new Error('记录不存在'); }
    return moveStock(log.bookId, -log.qty, { note: '撤销操作', operator: log.operator });
  }

  /* ============ 设置 / 云端配置 ============ */

  function settings() { return state.settings; }

  function saveSettings(patch) {
    Object.assign(state.settings, patch || {});
    saveNow();
    emit();
  }

  function cloudConfig() { return state.cloud; }

  function saveCloudConfig(patch) {
    Object.assign(state.cloud, patch || {});
    saveNow();
  }

  function session() { return state.session; }

  function saveSession(s) {
    state.session = s || null;
    saveNow();
  }

  /* ============ 云同步所需的原子操作 ============ */

  function booksForPush() {
    return state.books.filter(function (b) { return b.dirty; });
  }

  function logsForPush() {
    return state.logs.filter(function (l) { return l.dirty; });
  }

  function markBooksClean(ids) {
    var set = {};
    (ids || []).forEach(function (id) { set[id] = 1; });
    state.books.forEach(function (b) { if (set[b.id]) { b.dirty = false; } });
    save();
  }

  function markLogsClean(ids) {
    var set = {};
    (ids || []).forEach(function (id) { set[id] = 1; });
    state.logs.forEach(function (l) { if (set[l.id]) { l.dirty = false; } });
    save();
  }

  function mergeRemoteBooks(rows) {
    var changed = 0;
    (rows || []).forEach(function (raw) {
      var r = normalizeBook(raw);
      var local = findBook(r.id);
      if (!local) {
        r.dirty = false;
        state.books.push(r);
        changed++;
        return;
      }
      if (local.dirty && toISO(local.updatedAt) >= toISO(r.updatedAt)) { return; }
      if (toISO(r.updatedAt) > toISO(local.updatedAt)) {
        r.dirty = false;
        Object.assign(local, r);
        changed++;
      }
    });
    if (changed) { commit(); }
    return changed;
  }

  function mergeRemoteLogs(rows) {
    var seen = {};
    state.logs.forEach(function (l) { seen[l.id] = 1; });
    var changed = 0;
    (rows || []).forEach(function (raw) {
      var r = normalizeLog(raw);
      if (seen[r.id]) { return; }
      r.dirty = false;
      state.logs.push(r);
      seen[r.id] = 1;
      changed++;
    });
    if (changed) {
      state.logs.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      commit();
    }
    return changed;
  }

  function setLastSync(iso) {
    state.cloud.lastSyncAt = toISO(iso) || nowISO();
    saveNow();
  }

  /* ============ CSV ============ */

  function detectDelimiter(text) {
    var head = text.split(/\r?\n/)[0] || '';
    var tabs = (head.match(/\t/g) || []).length;
    var commas = (head.match(/,/g) || []).length;
    return tabs > commas ? '\t' : ',';
  }

  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var delim = detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    while (i < text.length) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (x) { return String(x).trim() !== ''; });
    });
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n\t]/.test(s)) { return '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  var CSV_COLUMNS = [
    ['title', '书名'], ['author', '作者'], ['isbn', 'ISBN'], ['category', '分类'],
    ['publisher', '出版社'], ['price', '单价'], ['location', '货位'],
    ['qty', '库存'], ['minQty', '安全库存'], ['unit', '单位'], ['note', '备注'], ['tags', '标签'], ['cover', '封面']
  ];

  function csvValue(col, value) {
    // 内嵌图片（data: 开头）太大，不写进 CSV；只导出图片路径/网址
    if (col === 'cover' && typeof value === 'string' && value.indexOf('data:') === 0) { return ''; }
    return value;
  }

  function exportCSV(list) {
    var rows = [CSV_COLUMNS.map(function (c) { return c[1]; })];
    (list || books()).forEach(function (b) {
      rows.push(CSV_COLUMNS.map(function (c) { return csvValue(c[0], b[c[0]]); }));
    });
    return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function exportLogsCSV(list) {
    var rows = [['时间', '类型', '书名', '变化', '操作前', '操作后', '操作员', '备注']];
    (list || logs()).forEach(function (l) {
      rows.push([
        fmtLocal(l.createdAt), typeLabel(l.type), l.title, l.qty, l.beforeQty, l.afterQty,
        l.operator, l.note
      ]);
    });
    return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function fmtLocal(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function typeLabel(t) {
    return ({ in: '入库', out: '出库', adjust: '盘点', create: '新增', delete: '删除', undo: '撤销' })[t] || t;
  }

  var HEADER_MAP = {
    '书名': 'title', '图书名称': 'title', '名称': 'title', '图书': 'title', 'title': 'title', 'name': 'title',
    '作者': 'author', 'author': 'author',
    'isbn': 'isbn', '条码': 'isbn', '条形码': 'isbn', '书号': 'isbn',
    '分类': 'category', '类别': 'category', 'category': 'category', 'type': 'category',
    '出版社': 'publisher', 'publisher': 'publisher',
    '定价': 'price', '单价': 'price', '价格': 'price', 'price': 'price',
    '货位': 'location', '库位': 'location', '位置': 'location', '货架': 'location', 'location': 'location',
    '库存': 'qty', '数量': 'qty', '库存数量': 'qty', '现有库存': 'qty', 'qty': 'qty', 'stock': 'qty',
    '安全库存': 'minQty', '最低库存': 'minQty', '预警值': 'minQty', 'minqty': 'minQty', 'min_qty': 'minQty',
    '单位': 'unit', 'unit': 'unit',
    '封面': 'cover', '封面图': 'cover', '封面图片': 'cover', 'cover': 'cover',
    '备注': 'note', '说明': 'note', 'note': 'note',
    '标签': 'tags', '标签栏': 'tags', 'tags': 'tags'
  };

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[\s()（）\[\]【】:：*]/g, '');
  }

  function mapHeaders(headerRow) {
    var map = [];
    for (var i = 0; i < headerRow.length; i++) {
      var key = HEADER_MAP[normHeader(headerRow[i])];
      map.push(key || null);
    }
    return map;
  }

  /**
   * 导入 CSV 文本
   * @returns {{created:number, updated:number, skipped:number, errors:string[]}}
   */
  function importCSV(text, opt) {
    opt = opt || {};
    var rows = parseCSV(text);
    if (rows.length < 1) { throw new Error('文件为空'); }
    var map = mapHeaders(rows[0]);
    var hasTitle = map.indexOf('title') >= 0;
    var start = 0;
    if (!hasTitle) {
      // 没有表头时按固定顺序解析，并当作首行就是数据
      map = ['title', 'author', 'isbn', 'category', 'publisher', 'price', 'location', 'qty', 'minQty', 'unit', 'note'];
      start = 0;
    } else {
      start = 1;
    }
    var result = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (var r = start; r < rows.length; r++) {
      var cells = rows[r];
      var item = {};
      for (var c = 0; c < map.length; c++) {
        if (!map[c]) { continue; }
        item[map[c]] = str(cells[c]);
      }
      if (!item.title) { result.skipped++; continue; }
      var exist = null;
      if (item.isbn) {
        exist = books().filter(function (b) { return b.isbn && b.isbn === item.isbn; })[0] || null;
      }
      if (!exist && opt.matchByTitle) {
        exist = books().filter(function (b) { return b.title === item.title && b.author === (item.author || ''); })[0] || null;
      }
      try {
        if (exist) {
          updateBook(exist.id, item, { note: '批量导入覆盖' });
          result.updated++;
        } else {
          createBook(item, { note: '批量导入' });
          result.created++;
        }
      } catch (e) {
        result.errors.push('第 ' + (r + 1) + ' 行：' + e.message);
      }
    }
    return result;
  }

  /* ============ JSON 备份 ============ */

  function exportJSON() {
    return JSON.stringify({
      app: 'bookstock', version: SCHEMA, exportedAt: nowISO(),
      books: state.books, logs: state.logs, settings: state.settings
    }, null, 2);
  }

  function importJSON(text, opt) {
    opt = opt || {};
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    var result = { books: 0, logs: 0 };
    var seenBook = {};
    state.books.forEach(function (b) { seenBook[b.id] = 1; });
    (data.books || []).forEach(function (raw) {
      var b = normalizeBook(raw);
      var local = findBook(b.id);
      if (local) {
        Object.assign(local, b);
        local.dirty = true;
      } else {
        b.dirty = true;
        state.books.push(b);
      }
      result.books++;
    });
    var seenLog = {};
    state.logs.forEach(function (l) { seenLog[l.id] = 1; });
    (data.logs || []).forEach(function (raw) {
      var l = normalizeLog(raw);
      if (seenLog[l.id]) { return; }
      l.dirty = true;
      state.logs.push(l);
      result.logs++;
    });
    if (opt.replace) {
      state.books = state.books.filter(function (b) { return b.deleted; });
    }
    state.logs.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    commit();
    return result;
  }

  function clearAll() {
    state.books = [];
    state.logs = [];
    saveNow();
    emit();
  }

  /* ============ 示例数据 ============ */

  var DEMO = [
    ['三体', '刘慈欣', '9787536692930', '科幻小说', '重庆出版社', 23, 'A-01-03', 42, 10],
    ['活着', '余华', '9787506365437', '当代文学', '作家出版社', 20, 'A-02-01', 6, 10],
    ['人类简史', '尤瓦尔·赫拉利', '9787508647357', '社科历史', '中信出版社', 68, 'B-01-02', 18, 5],
    ['小王子', '圣埃克苏佩里', '9787020042494', '外国文学', '人民文学出版社', 22, 'A-03-04', 0, 8],
    ['乡土中国', '费孝通', '9787301103004', '社科历史', '北京大学出版社', 28, 'B-02-03', 25, 6],
    ['明朝那些事儿', '当年明月', '9787514363579', '历史', '现代出版社', 358, 'C-01-01', 9, 4],
    ['解忧杂货店', '东野圭吾', '9787544270878', '外国文学', '南海出版公司', 39.5, 'A-03-01', 33, 12],
    ['经济学原理', '曼昆', '9787301256908', '教材教辅', '北京大学出版社', 88, 'D-01-01', 14, 5]
  ];

  function seedDemo() {
    DEMO.forEach(function (row) {
      createBook({
        title: row[0], author: row[1], isbn: row[2], category: row[3], publisher: row[4],
        price: row[5], location: row[6], qty: row[7], minQty: row[8], unit: '册', note: ''
      }, { note: '示例数据' });
    });
    state.settings.seeded = true;
    saveNow();
    emit();
  }

  /* ============ 对外接口 ============ */

  load();

  var Store = {
    KEY: KEY,
    storageMode: function () { return memMode ? 'memory' : 'local'; },
    init: function () { load(); emit(); return state; },
    getState: function () { return state; },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    emit: emit,
    uuid: uuid,
    nowISO: nowISO,
    toISO: toISO,

    books: books,
    find: findBook,
    query: query,
    stats: stats,
    categoryStats: categoryStats,
    categories: categories,
    logs: logs,
    isLow: isLow,
    isOut: isOut,
    isWarn: isWarn,
    photoList: photoList,
    groupPhotos: groupPhotos,

    createBook: createBook,
    updateBook: updateBook,
    deleteBook: deleteBook,
    restoreBook: restoreBook,
    moveStock: moveStock,
    setQty: setQty,
    undoLog: undoLog,
    undoStock: undoStock,

    settings: settings,
    saveSettings: saveSettings,
    cloudConfig: cloudConfig,
    saveCloudConfig: saveCloudConfig,
    session: session,
    saveSession: saveSession,

    booksForPush: booksForPush,
    logsForPush: logsForPush,
    markBooksClean: markBooksClean,
    markLogsClean: markLogsClean,
    mergeRemoteBooks: mergeRemoteBooks,
    mergeRemoteLogs: mergeRemoteLogs,
    setLastSync: setLastSync,

    exportCSV: exportCSV,
    exportLogsCSV: exportLogsCSV,
    parseCSV: parseCSV,
    importCSV: importCSV,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
    seedDemo: seedDemo,
    fmtLocal: fmtLocal,
    typeLabel: typeLabel,
    saveNow: saveNow
  };

  global.Store = Store;
})(window);
