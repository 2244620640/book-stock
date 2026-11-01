/*!
 * 仓储图书库存 · 云端同步（Supabase REST / Auth）
 * 不引入任何第三方 SDK，只用 fetch，方便静态托管与离线预览。
 */
(function (global) {
  'use strict';

  var Store = global.Store;
  var CLOUD = {
    lastError: '',
    busy: false
  };

  /* ---------------- 地址与请求 ---------------- */

  function normalizeUrl(url) {
    var u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) { return ''; }
    if (!/^https?:\/\//i.test(u)) { u = 'https://' + u; }
    u = u.replace(/\/rest\/v1$/i, '').replace(/\/auth\/v1$/i, '');
    return u;
  }

  function config() {
    var c = Store.cloudConfig() || {};
    return { url: normalizeUrl(c.url), key: String(c.key || '').trim() };
  }

  function isConfigured() {
    var c = config();
    return !!(c.url && c.key);
  }

  function apiKeyHeaders() {
    var c = config();
    return { apikey: c.key };
  }

  function withAuth(headers) {
    var s = Store.session();
    var h = Object.assign({}, apiKeyHeaders(), headers || {});
    if (s && s.access_token) { h.Authorization = 'Bearer ' + s.access_token; }
    return h;
  }

  function rawRequest(path, opt) {
    opt = opt || {};
    var c = config();
    if (!c.url) { throw new Error('未配置云端地址'); }
    var url = c.url + path;
    var init = {
      method: opt.method || 'GET',
      headers: Object.assign({}, apiKeyHeaders(), opt.headers || {}),
      body: opt.body
    };
    var ctrl = null;
    var timer = null;
    if (typeof global.AbortController === 'function') {
      ctrl = new global.AbortController();
      init.signal = ctrl.signal;
      timer = global.setTimeout(function () { ctrl.abort(); }, opt.timeout || 15000);
    }
    return global.fetch(url, init).then(function (res) {
      if (timer) { global.clearTimeout(timer); }
      return res.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = text; }
        }
        if (!res.ok) {
          var msg = '';
          if (data && typeof data === 'object') {
            msg = data.message || data.error_description || data.msg || data.error || data.hint || '';
          } else if (typeof data === 'string') {
            msg = data;
          }
          var err = new Error(msg || ('请求失败（' + res.status + '）'));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function (e) {
      if (timer) { global.clearTimeout(timer); }
      var err = new Error(e && e.name === 'AbortError' ? '网络超时，请检查网络或云端地址' : '网络连接失败，请检查网络或云端地址');
      err.network = true;
      throw err;
    });
  }

  /* ---------------- 登录状态 ---------------- */

  function saveAuth(data, email) {
    if (!data || !data.access_token) { throw new Error('登录失败：未取得访问令牌'); }
    Store.saveSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
      email: email || (data.user && data.user.email) || '',
      user_id: (data.user && data.user.id) || '',
      since: Store.nowISO()
    });
  }

  function signInOnce(email, password) {
    return rawRequest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      body: JSON.stringify({ email: email, password: password })
    }).then(function (data) {
      saveAuth(data, email);
      return Store.session();
    }, function (err) {
      if (err.network) { throw new Error('NETWORK'); }
      if (err.status === 400) { throw new Error('邮箱或密码不正确'); }
      if (err.status === 422) { throw new Error('邮箱格式不对，或账号不存在'); }
      if (err.status === 429) { throw new Error('尝试太频繁，等 1~2 分钟再试'); }
      throw err;
    });
  }

  function signIn(email, password) {
    if (!isConfigured()) { return Promise.reject(new Error('请先填写云端地址与 anon key')); }
    var attempt = 0;
    function run() {
      return signInOnce(email, password).catch(function (err) {
        if (err.message === 'NETWORK' && attempt < 2) {
          attempt++;
          return new Promise(function (resolve) {
            global.setTimeout(resolve, 1200 + attempt * 1300);
          }).then(run);
        }
        if (err.message === 'NETWORK') {
          throw new Error('连不上登录服务：可能是网络抖动或被临时限制，等 1~2 分钟再试');
        }
        throw err;
      });
    }
    return run();
  }

  function signUp(email, password) {
    if (!isConfigured()) { return Promise.reject(new Error('请先填写云端地址与 anon key')); }
    return rawRequest('/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (data) {
      if (data && data.access_token) { saveAuth(data, email); }
      return data;
    });
  }

  function refresh() {
    var s = Store.session();
    if (!s || !s.refresh_token) { return Promise.reject(new Error('登录已过期，请重新登录')); }
    return rawRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (data) {
      saveAuth(data, s.email);
      return Store.session();
    }, function (err) {
      Store.saveSession(null);
      throw new Error('登录已过期，请重新登录');
    });
  }

  function ensureSession() {
    var s = Store.session();
    if (!s || !s.access_token) { return Promise.reject(new Error('请先登录云端账号')); }
    if (s.expires_at && Date.now() > s.expires_at) { return refresh(); }
    return Promise.resolve(s);
  }

  function signOut() {
    var s = Store.session();
    Store.saveSession(null);
    if (!s || !isConfigured()) { return Promise.resolve(); }
    return rawRequest('/auth/v1/logout', {
      method: 'POST',
      headers: withAuth({ 'Content-Type': 'application/json' })
    }).catch(function () { /* 退出失败也不阻塞本地 */ });
  }

  /* ---------------- 数据行映射 ---------------- */

  function bookToRow(b) {
    return {
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      category: b.category,
      publisher: b.publisher,
      price: b.price,
      location: b.location,
      qty: b.qty,
      min_qty: b.minQty,
      unit: b.unit,
      note: b.note,
      tags: b.tags || '',
      sold_out_at: b.soldOutAt || null,
      cover: b.cover || '',
      back: b.back || '',
      photos: b.photos || '',
      deleted: !!b.deleted,
      updated_by: b.updatedBy || '',
      created_at: b.createdAt,
      updated_at: b.updatedAt
    };
  }

  function logToRow(l) {
    return {
      id: l.id,
      book_id: l.bookId || null,
      title: l.title,
      type: l.type,
      qty: l.qty,
      before_qty: l.beforeQty,
      after_qty: l.afterQty,
      note: l.note,
      operator: l.operator,
      created_at: l.createdAt
    };
  }

  /* ---------------- 拉取（分页） ---------------- */

  function pullAll(table, sinceField, sinceISO, limit) {
    var pageSize = limit || 500;
    var out = [];
    var offset = 0;
    function step() {
      var qs = '/rest/v1/' + table + '?select=*&order=' + sinceField + '.asc&limit=' + pageSize + '&offset=' + offset;
      if (sinceISO) { qs += '&' + sinceField + '=gte.' + encodeURIComponent(sinceISO); }
      return rawRequest(qs, { headers: withAuth({ Accept: 'application/json' }) }).then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) { return out; }
        out = out.concat(rows);
        if (rows.length < pageSize) { return out; }
        offset += pageSize;
        if (offset > 20000) { return out; }
        return step();
      });
    }
    return step();
  }

  function pushRows(table, rows, conflict) {
    if (!rows.length) { return Promise.resolve(0); }
    var chunks = [];
    for (var i = 0; i < rows.length; i += 200) { chunks.push(rows.slice(i, i + 200)); }
    var sent = 0;
    function next() {
      var chunk = chunks.shift();
      if (!chunk) { return Promise.resolve(sent); }
      var prefer = 'resolution=merge-duplicates,return=minimal';
      var qs = '/rest/v1/' + table + (conflict ? '?on_conflict=' + conflict : '');
      return rawRequest(qs, {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json', Prefer: prefer }),
        body: JSON.stringify(chunk)
      }).then(function () {
        sent += chunk.length;
        return next();
      });
    }
    return next();
  }

  /* ---------------- 同步主流程 ---------------- */

  /**
   * 双向同步：先推本地改动，再拉云端更新，按 updated_at 取新。
   * @returns {Promise<{pushedBooks:number,pushedLogs:number,pulledBooks:number,pulledLogs:number,at:string}>}
   */
  function sync() {
    if (CLOUD.busy) { return Promise.reject(new Error('正在同步中，请稍候')); }
    if (!isConfigured()) { return Promise.reject(new Error('云端未配置')); }
    CLOUD.busy = true;
    CLOUD.lastError = '';
    var stamp = Store.nowISO();
    var result = { pushedBooks: 0, pushedLogs: 0, pulledBooks: 0, pulledLogs: 0, at: stamp };

    return ensureSession()
      .then(function () {
        var dirtyBooks = Store.booksForPush();
        var dirtyLogs = Store.logsForPush();
        return pushRows('books', dirtyBooks.map(bookToRow), 'id').then(function (n) {
          result.pushedBooks = n;
          Store.markBooksClean(dirtyBooks.map(function (b) { return b.id; }));
          return pushRows('logs', dirtyLogs.map(logToRow), 'id');
        }).then(function (n) {
          result.pushedLogs = n;
          Store.markLogsClean(dirtyLogs.map(function (l) { return l.id; }));
        });
      })
      .then(function () {
        var since = Store.cloudConfig().lastSyncAt;
        var sinceSafe = since ? new Date(new Date(since).getTime() - 120000).toISOString() : '';
        return pullAll('books', 'updated_at', sinceSafe).then(function (rows) {
          result.pulledBooks = Store.mergeRemoteBooks(rows);
          return pullAll('logs', 'created_at', sinceSafe);
        }).then(function (rows) {
          result.pulledLogs = Store.mergeRemoteLogs(rows);
        });
      })
      .then(function () {
        Store.setLastSync(stamp);
        CLOUD.busy = false;
        return result;
      }, function (err) {
        CLOUD.busy = false;
        CLOUD.lastError = err.message;
        var msg = String(err.message || '');
        if (/cover|back/i.test(msg) && /column|schema|cache|PGRST204/i.test(msg)) {
          throw new Error('数据库缺少「封面 / 背面」字段：请到 Supabase 的 SQL Editor 重新执行一遍 supabase-schema.sql（脚本可重复执行，不会丢数据）');
        }
        throw err;
      });
  }

  /* ---------------- 诊断 ---------------- */

  function testConnection() {
    if (!isConfigured()) { return Promise.reject(new Error('请先填写云端地址与 anon key')); }
    return rawRequest('/rest/v1/books?select=id&limit=1', { headers: withAuth({ Accept: 'application/json' }) })
      .then(function () { return { ok: true, message: '连接成功，数据表可访问' }; })
      .catch(function (err) {
        if (err.status === 404) {
          throw new Error('数据表不存在：请先在 Supabase 的 SQL Editor 里执行建表脚本');
        }
        if (err.status === 401 || err.status === 403) {
          throw new Error(Store.session() ? '没有访问权限：请检查 RLS 策略是否已创建' : '需要登录后才能访问数据表');
        }
        throw err;
      });
  }

  /* ---------------- 访客统计（管理端） ---------------- */

  function loadVisits() {
    return ensureSession().then(function () {
      var h = withAuth({ Accept: 'application/json' });
      return rawRequest('/rest/v1/visit_stats?select=*', { headers: h }).then(function (stats) {
        return rawRequest('/rest/v1/visit_daily?select=day,visits,visitors&order=day.desc&limit=30', { headers: h })
          .then(function (daily) {
            return rawRequest('/rest/v1/visits?select=created_at,device,referrer,ip,dwell_sec,engaged&order=created_at.desc&limit=300', { headers: h })
              .then(function (recent) {
                return {
                  stats: (stats && stats[0]) || null,
                  daily: daily || [],
                  recent: recent || []
                };
              });
          });
      });
    });
  }

  /* ---------------- 店铺设置（联系方式等） ---------------- */

  function getSetting(key) {
    var c = config();
    if (!c.url) { return Promise.resolve(''); }
    return fetch(c.url + '/rest/v1/site_settings?select=value&key=eq.' + encodeURIComponent(key), {
      headers: { apikey: c.key, Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    }).then(function (rows) {
      return (rows && rows[0] && rows[0].value) || '';
    });
  }

  function saveSetting(key, value) {
    var c = config();
    return ensureSession().then(function () {
      return rawRequest('/rest/v1/site_settings?on_conflict=key', {
        method: 'POST',
        headers: withAuth({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify([{ key: key, value: value, updated_at: new Date().toISOString() }])
      });
    });
  }

  global.Cloud = {
    config: config,
    isConfigured: isConfigured,
    normalizeUrl: normalizeUrl,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    refresh: refresh,
    ensureSession: ensureSession,
    sync: sync,
    loadVisits: loadVisits,
    getSetting: getSetting,
    saveSetting: saveSetting,
    testConnection: testConnection,
    busy: function () { return CLOUD.busy; },
    lastError: function () { return CLOUD.lastError; }
  };
})(window);
