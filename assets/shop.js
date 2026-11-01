/*!
 * 顾客页 · 在售图书（只读）+ 选购
 * 数据来源优先级：config.json 里的 Supabase → 本机管理端配置（预览用）→ 静态 catalog.json → 本地缓存
 */
(function () {
  'use strict';

  var CART_KEY = 'bookstock.cart.v1';
  var CACHE_KEY = 'bookstock.catalog.v1';

  var state = { rows: [], q: '', cat: '', cart: [], mode: '', at: '' };
  var el = {};
  var visitInsert = null;

  /* ---------------- 工具 ---------------- */

  function $(id) { return document.getElementById(id); }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function money(n) {
    return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? p(d.getHours()) + ':' + p(d.getMinutes())
      : (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function toast(msg, type) {
    var box = document.createElement('div');
    box.className = 'toast' + (type === 'err' ? ' err' : '');
    box.innerHTML = '<div class="msg">' + esc(msg) + '</div>';
    el.toastWrap.appendChild(box);
    setTimeout(function () {
      box.classList.add('out');
      setTimeout(function () { if (box.parentNode) { box.parentNode.removeChild(box); } }, 200);
    }, 2600);
    while (el.toastWrap.children.length > 3) { el.toastWrap.removeChild(el.toastWrap.firstElementChild); }
  }

  function normalizeUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) { return ''; }
    if (!/^https?:\/\//i.test(u)) { u = 'https://' + u; }
    return u.replace(/\/rest\/v1$/i, '');
  }

  /* ---------------- 购物车（本地保存） ---------------- */

  function loadCart() {
    try {
      var arr = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      state.cart = Array.isArray(arr) ? arr.filter(function (i) { return i && i.id; }) : [];
    } catch (e) {
      state.cart = [];
    }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) { /* 忽略 */ }
  }

  function inCart(id) {
    for (var i = 0; i < state.cart.length; i++) { if (state.cart[i].id === id) { return true; } }
    return false;
  }

  /* ---------------- 数据 ---------------- */

  // 从 UA 里尽量抠出设备型号（访客去重按 IP + 型号）
  function deviceModel() {
    var ua = navigator.userAgent || '';
    var m = '';
    var mm = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i);
    if (mm) { m = mm[1]; }
    if (!m && /iPhone/i.test(ua)) { m = 'iPhone'; }
    if (!m && /iPad/i.test(ua)) { m = 'iPad'; }
    if (!m && /Macintosh/i.test(ua)) { m = 'Mac'; }
    if (!m && /Windows/i.test(ua)) { m = 'Windows'; }
    if (!m && /Android/i.test(ua)) { m = 'Android'; }
    if (!m && /Linux/i.test(ua)) { m = 'Linux'; }
    if (!m) { m = (window.innerWidth < 768) ? '手机' : '电脑'; }
    return String(m).replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  var visit = { id: '', start: 0, engaged: false, cfg: null };

  function finishVisit() {
    var cfg = visit.cfg;
    if (!cfg || !visit.id) { return; }
    var dwell = Math.round((Date.now() - visit.start) / 1000);
    try {
      fetch(cfg.url + '/rest/v1/rpc/visit_finish', {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: cfg.key,
          Authorization: 'Bearer ' + cfg.key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_vid: visit.id, p_dwell: dwell, p_engaged: visit.engaged })
      }).catch(function () { });
    } catch (e) { /* 忽略 */ }
  }

  function bindEngagement() {
    var mark = function () {
      visit.engaged = true;
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('scroll', mark, true);
    };
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('scroll', mark, { capture: true, passive: true });
    window.addEventListener('pagehide', finishVisit);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { finishVisit(); }
    });
    // 一直不走的访客，每 20 秒补一次时长
    setInterval(function () {
      if (visit.id && document.visibilityState === 'visible') { finishVisit(); }
    }, 20000);
  }

  function trackVisit(cfg) {
    try {
      var LAST = 'bookstock.visit.at';
      var last = parseInt(localStorage.getItem(LAST) || '0', 10);
      if (Date.now() - last < 30 * 60 * 1000) { return; }   // 同一浏览器 30 分钟内只记一次
      var vid = localStorage.getItem('bookstock.visitor');
      if (!vid) {
        vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('bookstock.visitor', vid);
      }
      var ref = '';
      try {
        ref = String(document.referrer || '').replace(/^https?:\/\//i, '').split('/')[0].slice(0, 80);
      } catch (e) { }
      visit.cfg = cfg;
      visit.start = Date.now();
      visit.engaged = false;
      return fetch(cfg.url + '/rest/v1/visits', {
        method: 'POST',
        headers: {
          apikey: cfg.key,
          Authorization: 'Bearer ' + cfg.key,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify([{ visitor_id: vid, path: 'shop', referrer: ref, device: deviceModel() }])
      }).then(function (r) {
        if (!r.ok) { return null; }
        localStorage.setItem(LAST, String(Date.now()));
        return r.json();
      }).then(function (rows) {
        if (rows && rows[0] && rows[0].id) { visit.id = rows[0].id; }
      }).catch(function () { /* 统计失败不影响浏览 */ });
    } catch (e) {
      return Promise.resolve();  /* 忽略 */
    }
  }

  function fetchPublicVisits(cfg) {
    return fetch(cfg.url + '/rest/v1/visit_public?select=*', {
      headers: { apikey: cfg.key, Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) { return null; }
      return r.json();
    }).then(function (rows) {
      return (rows && rows[0]) ? rows[0] : null;
    }).catch(function () { return null; });
  }

  var STAT_KEY = 'bookstock.visitstat.v1';

  function savePublicVisits(d) {
    try { localStorage.setItem(STAT_KEY, JSON.stringify({ d: d, at: Date.now() })); } catch (e) { }
  }

  function cachedPublicVisits() {
    try {
      var c = JSON.parse(localStorage.getItem(STAT_KEY) || 'null');
      return c && c.d ? c.d : null;
    } catch (e) { return null; }
  }

  function renderPublicVisits(d) {
    if (!el.shopVisitors) { return; }
    if (!d || !Number(d.visitors)) { return; }   // 没数据时保留上一次显示的，不要清空
    el.shopVisitors.hidden = false;
    el.shopVisitors.innerHTML =
      '<span class="sv-dot"></span>已有 <b>' + Number(d.visitors).toLocaleString('zh-CN') + '</b> 位访客来过' +
      (Number(d.visitors_today) ? '，今天 ' + Number(d.visitors_today) + ' 位' : '');
  }

  var CONTACT_KEY = 'bookstock.contact.v1';

  function fetchContact(cfg) {
    return fetch(cfg.url + '/rest/v1/site_settings?select=value&key=eq.contact', {
      headers: { apikey: cfg.key, Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) { return null; }
      return r.json();
    }).then(function (rows) {
      return (rows && rows[0]) ? String(rows[0].value || '') : null;
    }).catch(function () { return null; });
  }

  function renderContact(text) {
    var box = el.contactBox;
    var tip = el.cartContact;
    var t = String(text || '').trim();
    if (!t) {
      if (box) { box.hidden = true; }
      if (tip) { tip.hidden = true; }
      return;
    }
    if (box) {
      box.hidden = false;
      el.contactText.textContent = t;
    }
    if (tip) {
      tip.hidden = false;
      tip.innerHTML = '<span class="cc-label">发给店主：</span>' + esc(t).replace(/\n/g, '<br>');
    }
  }

  function loadContact(cfg) {
    try {
      var cached = localStorage.getItem(CONTACT_KEY);
      if (cached !== null) { renderContact(cached); }
    } catch (e) { }
    if (!cfg) { return; }
    fetchContact(cfg).then(function (v) {
      if (v === null) { return; }
      try { localStorage.setItem(CONTACT_KEY, v); } catch (e) { }
      renderContact(v);
    });
  }

  function readConfig() {
    return fetch('config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) {
        var url = normalizeUrl(c.supabaseUrl);
        var key = String(c.supabaseKey || '').trim();
        if (url && key) { return { url: url, key: key }; }
        return null;
      })
      .catch(function () { return null; })
      .then(function (cfg) {
        if (cfg) { return cfg; }
        // 本机预览：管理端页面登录过的话，直接借用它的配置
        try {
          var raw = localStorage.getItem('bookstock.v1');
          if (raw) {
            var s = JSON.parse(raw);
            if (s.cloud && s.cloud.url && s.cloud.key) {
              return { url: normalizeUrl(s.cloud.url), key: s.cloud.key };
            }
          }
        } catch (e) { /* 忽略 */ }
        return null;
      });
  }

  function fetchCatalog(cfg) {
    var url = cfg.url + '/rest/v1/catalog?select=*&order=title.asc&limit=2000';
    var ctrl = null;
    var timer = null;
    var init = { headers: { apikey: cfg.key, Accept: 'application/json' } };
    if (typeof AbortController === 'function') {
      ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 6000); // 网络被拦时别干等
    }
    return fetch(url, init).then(function (res) {
      if (timer) { clearTimeout(timer); }
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      return res.json();
    }).then(function (rows) {
      return { rows: rows || [], mode: 'cloud' };
    }, function (e) {
      if (timer) { clearTimeout(timer); }
      throw new Error(e && e.name === 'AbortError' ? '连接超时' : '无法连接数据库');
    });
  }

  function fetchStatic() {
    return fetch('catalog.json?t=' + Date.now(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) { throw new Error('没有 catalog.json'); }
      return res.json();
    }).then(function (data) {
      return { rows: Array.isArray(data) ? data : (data.books || []), mode: 'static' };
    });
  }

  function normalize(r) {
    return {
      id: String(r.id || ''),
      title: String(r.title || ''),
      author: String(r.author || ''),
      category: String(r.category || ''),
      publisher: String(r.publisher || ''),
      isbn: String(r.isbn || ''),
      price: Number(r.price) || 0,
      qty: Number(r.qty) || 0,
      minQty: Number(r.min_qty || r.minQty) || 0,
      unit: String(r.unit || '册'),
      cover: String(r.cover || ''),
      back: String(r.back || ''),
      photos: String(r.photos || ''),
      soldAt: String(r.sold_out_at || ''),
      location: String(r.location || ''),
      tags: String(r.tags || '')
    };
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        at: state.at, rows: state.rows
      }));
    } catch (e) { /* 空间不足就算了 */ }
  }

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Array.isArray(c.rows)) { return c; }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /* ---------------- 渲染 ---------------- */

  function inStock(b) { return b.qty > 0; }

  // 卡片上展示的图片：最多 3 张（cover → back → 其余），至少尽量给 2 张
  function photosAll(b) {
    var list = [];
    if (b.photos) {
      list = String(b.photos).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (!list.length) {
      if (b.cover) { list.push(b.cover); }
      if (b.back) { list.push(b.back); }
    }
    var seen = {};
    var out = [];
    list.forEach(function (s) {
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out;
  }

  function photosOf(b) {
    return photosAll(b).slice(0, 3);
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 有货的排前面（按书名），已售完的统一排到最后
  function sortedRows() {
    return state.rows.slice().sort(function (a, b) {
      var sa = inStock(a) ? 0 : 1;
      var sb = inStock(b) ? 0 : 1;
      if (sa !== sb) { return sa - sb; }
      return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
    });
  }

  function available() {
    return state.rows.filter(inStock);
  }

  function visibleRows() {
    var q = state.q.toLowerCase();
    return sortedRows().filter(function (b) {
      if (state.cat && b.category !== state.cat) { return false; }
      if (inCart(b.id)) { return false; }          // 已加入选购的，从列表里隐藏
      if (!q) { return true; }
      return [b.title, b.author, b.category, b.isbn, b.publisher].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderStatus() {
    var text = '';
    var dot = '';
    var onSale = available().length;
    var soldOut = state.rows.length - onSale;
    var compact = window.innerWidth < 430;
    var suffix = soldOut ? (compact ? ' · 售完 ' + soldOut : ' · 已售完 ' + soldOut + ' 种') : '';
    if (state.mode === 'cloud') {
      dot = 'on';
      text = compact
        ? '在售 ' + onSale + suffix + ' · 实时'
        : '共 ' + onSale + ' 种在售' + suffix + ' · 实时库存';
    } else if (state.mode === 'static') {
      dot = state.degraded ? 'err' : '';
      text = compact
        ? '在售 ' + onSale + suffix + ' · 快照'
        : '共 ' + onSale + ' 种在售' + suffix + ' · 静态快照 ' + fmtTime(state.at);
      if (state.degraded && !compact) { text += ' · ' + state.degraded; }
    } else if (state.mode === 'cache') {
      dot = 'err';
      text = '离线缓存 · ' + fmtTime(state.at);
    }
    el.shopDot.className = 'dot' + (dot ? ' ' + dot : '');
    el.shopStatus.textContent = text || '正在加载…';
  }

  function renderCats() {
    var counts = {};
    state.rows.forEach(function (b) {
      var c = b.category || '未分类';
      counts[c] = (counts[c] || 0) + 1;
    });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (names.length <= 1) { el.shopCats.innerHTML = ''; return; }
    var html = ['<button class="chip' + (state.cat === '' ? ' active' : '') + '" data-cat="">全部<span class="count">' + state.rows.length + '</span></button>'];
    names.forEach(function (n) {
      html.push('<button class="chip' + (state.cat === n ? ' active' : '') + '" data-cat="' + esc(n) + '">' +
        esc(n) + '<span class="count">' + counts[n] + '</span></button>');
    });
    el.shopCats.innerHTML = html.join('');
  }

  function cardHTML(b) {
    var imgs = photosOf(b);
    var soldOut = !inStock(b);
    var noteTags = String(b.tags || '').split(/[,，\s]+/).filter(Boolean).slice(0, 3);

    var coverHTML;
    if (!imgs.length) {
      coverHTML = '<div class="ph">暂无图片</div>';
    } else if (imgs.length === 1) {
      coverHTML = '<div class="cv-one"><img src="' + esc(imgs[0]) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"></div>';
    } else {
      // 2~3 张：左边主图 + 右边一到两张小图
      coverHTML = '<div class="cv-multi">' +
        '<div class="cv-main"><img src="' + esc(imgs[0]) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
        '<div class="cv-side">' +
          imgs.slice(1, 3).map(function (src) {
            return '<div class="cv-sub"><img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.parentNode.style.display=\'none\'"></div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    return '<article class="shop-card' + (soldOut ? ' sold-out' : '') + '" data-id="' + esc(b.id) + '" data-open="' + esc(b.id) + '">' +
      '<div class="shop-cover' + (imgs.length > 1 ? ' multi' : '') + '">' + coverHTML +
        '<span class="stock-tag' + (soldOut ? ' out' : '') + '">' +
          (soldOut ? '已售完' : '库存 ' + b.qty + ' ' + esc(b.unit)) +
        '</span>' +
        (imgs.length > 1
          ? '<span class="photo-count">' + imgs.length + ' 张</span>'
          : '') +
      '</div>' +
      '<div class="shop-info">' +
        '<div class="shop-title">' + esc(b.title) + '</div>' +
        '<div class="shop-meta">' + esc([b.category, b.author].filter(Boolean).join(' · ') || '—') + '</div>' +
        (noteTags.length
          ? '<div class="shop-tags">' + noteTags.map(function (t) {
            return '<span class="shop-tag">' + esc(t) + '</span>';
          }).join('') + '</div>'
          : '') +
        '<div class="shop-price-row">' +
          '<span class="shop-price' + (b.price ? '' : ' free') + '">' + (b.price ? money(b.price) : '价格面议') + '</span>' +
        '</div>' +
        (soldOut
          ? '<button class="btn sm" type="button" disabled>已售完</button>'
          : '<button class="btn sm primary" data-add="' + esc(b.id) + '" type="button">加入选购</button>') +
      '</div>' +
    '</article>';
  }

  function render() {
    renderStatus();
    renderCats();
    var list = visibleRows();
    el.shopGrid.innerHTML = list.map(cardHTML).join('');

    var onSale = available().length;
    var all = state.rows.length;
    var soldOutCount = all - onSale;

    if (all === 0) {
      el.shopEmpty.innerHTML = '<div class="empty"><div class="glyph">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M8 8h7"/></svg>' +
        '</div><h3>暂时没有在售图书</h3><p>过一会儿再来看看吧</p></div>';
    } else if (list.length === 0 && state.cart.length) {
      el.shopEmpty.innerHTML = '<div class="empty"><h3>都放进选购了</h3><p>点下面的「我的选购」查看已选图书</p></div>';
    } else if (list.length === 0) {
      el.shopEmpty.innerHTML = '<div class="empty"><h3>没有匹配的图书</h3><p>换个关键词试试</p></div>';
    } else {
      el.shopEmpty.innerHTML = '';
    }

    el.shopCount.textContent = onSale
      ? '共 ' + onSale + ' 种在售' +
        (soldOutCount ? ' · ' + soldOutCount + ' 种已售完排在最后' : '') +
        ' · 已选 ' + state.cart.length + ' 种'
      : (all ? '全部 ' + all + ' 种都已售完' : '');

    renderCart();
  }

  function renderCart() {
    var n = state.cart.length;
    el.cartBadge.hidden = n === 0;
    el.cartBadge.textContent = n;
    el.cartFab.hidden = n === 0;
    el.cartFabText.textContent = '我的选购 · ' + n;

    el.cartSummary.textContent = n ? '已选 ' + n + ' 种，移出后会重新出现在列表里' : '还没选择图书';

    if (!n) {
      el.cartList.innerHTML = '<div class="cart-empty">还没有选中的图书<br>点书上的「加入选购」就会出现在这里</div>';
      el.cartTotal.textContent = money(0);
      return;
    }

    el.cartList.innerHTML = state.cart.map(function (i) {
      var cover = i.cover
        ? '<img src="' + esc(i.cover) + '" alt="" onerror="this.style.display=\'none\'">'
        : '<div class="ph">无图</div>';
      return '<div class="cart-item">' + cover +
        '<div style="min-width:0">' +
          '<div class="t">' + esc(i.title) + '</div>' +
          '<div class="s">' + esc([i.category, i.price ? money(i.price) : '价格面议'].filter(Boolean).join(' · ')) + '</div>' +
        '</div>' +
        '<button class="rm" data-remove="' + esc(i.id) + '" type="button" aria-label="移出">×</button>' +
      '</div>';
    }).join('');

    var total = state.cart.reduce(function (sum, i) { return sum + (Number(i.price) || 0); }, 0);
    el.cartTotal.textContent = money(total);
  }

  function showNotice(html) {
    el.shopEmpty.innerHTML = '<div class="shop-notice">' + html + '</div>';
    el.shopStatus.textContent = '未连接库存';
    el.shopDot.className = 'dot err';
  }

  /* ---------------- 交互 ---------------- */

  function addToCart(id) {
    var b = null;
    state.rows.forEach(function (r) { if (r.id === id) { b = r; } });
    if (!b) { return; }
    if (!inStock(b)) { toast('这本已经售完了', 'err'); return; }
    if (inCart(id)) { return; }
    state.cart.push({
      id: b.id, title: b.title, price: b.price, unit: b.unit,
      cover: b.cover, category: b.category, qty: b.qty
    });
    saveCart();
    render();
    toast('已加入选购：' + b.title);
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter(function (i) { return i.id !== id; });
    saveCart();
    render();
    toast('已移出，图书重新回到列表');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('复制失败'));
      } catch (e) { reject(e); }
    });
  }

  function copyCart() {
    if (!state.cart.length) { toast('还没有选中图书'); return; }
    var lines = ['【图书选购清单】'];
    state.cart.forEach(function (i, n) {
      lines.push((n + 1) + '. ' + i.title + (i.price ? '　' + money(i.price) : ''));
    });
    lines.push('共 ' + state.cart.length + ' 种');
    copyText(lines.join('\n')).then(function () {
      toast('清单已复制，可以直接发给店家');
    }).catch(function () {
      toast('复制失败，请长按手动选择', 'err');
    });
  }

  function openDetail(id) {
    var b = null;
    state.rows.forEach(function (r) { if (r.id === id) { b = r; } });
    if (!b) { return; }
    var imgs = photosAll(b);
    var soldOut = !inStock(b);
    var tags = String(b.tags || '').split(/[,，\s]+/).filter(Boolean);

    var html = '<div class="modal-head">' +
      '<div style="min-width:0"><h3>' + esc(b.title) + '</h3>' +
      '<p>' + esc([b.category, b.author].filter(Boolean).join(' · ') || '—') + '</p></div>' +
      '<button class="modal-close" data-detail-close type="button" aria-label="关闭">×</button>' +
      '</div>';

    if (imgs.length) {
      html += '<div class="dg-wrap">' +
        '<div class="dg-track" id="dgTrack">' + imgs.map(function (src) {
          return '<div class="dg-slide"><img src="' + esc(src) + '" alt="" loading="lazy"></div>';
        }).join('') + '</div>' +
        (imgs.length > 1 ? '<span class="dg-counter" id="dgCounter">1 / ' + imgs.length + '</span>' : '') +
        '</div>';
    } else {
      html += '<div class="dg-empty">暂无图片</div>';
    }

    html += '<div class="detail-rows">' +
      '<div><span>价格</span><b>' + (b.price ? money(b.price) : '价格面议') + '</b></div>' +
      '<div><span>状态</span><b class="' + (soldOut ? 'st-out' : 'st-ok') + '">' +
      (soldOut ? '已售完' : '有货 · 剩 ' + b.qty + ' ' + esc(b.unit)) + '</b></div>' +
      (soldOut && b.soldAt
        ? '<div><span>售出时间</span><b>' + esc(fmtDateTime(b.soldAt)) + '</b></div>'
        : '') +
      (tags.length
        ? '<div><span>标签</span><b class="detail-tags">' + tags.map(function (t) {
          return '<span class="shop-tag">' + esc(t) + '</span>';
        }).join('') + '</b></div>'
        : '') +
      '</div>';

    html += '<div class="modal-foot">' +
      (soldOut
        ? '<button class="btn" type="button" disabled>已售完，暂时无法选择</button>'
        : '<button class="btn primary" type="button" data-detail-add="' + esc(b.id) + '">加入选购</button>') +
      '<button class="btn" type="button" data-detail-close>关闭</button>' +
      '</div>';

    el.detailBody.innerHTML = html;
    el.detailDrawer.hidden = false;
    document.body.style.overflow = 'hidden';

    // 左右滑动切换图片，右下角显示 1/3
    var track = el.detailBody.querySelector('#dgTrack');
    var counter = el.detailBody.querySelector('#dgCounter');
    if (track && counter) {
      track.addEventListener('scroll', function () {
        var idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + 1;
        counter.textContent = Math.min(idx, imgs.length) + ' / ' + imgs.length;
      }, { passive: true });
    }
  }

  function closeDetail() {
    el.detailDrawer.hidden = true;
    el.detailBody.innerHTML = '';
    if (el.cartDrawer.hidden) { document.body.style.overflow = ''; }
  }

  function openDrawer() {
    el.cartDrawer.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    el.cartDrawer.hidden = true;
    document.body.style.overflow = '';
  }

  function bind() {
    el.shopSearch.addEventListener('input', function () {
      state.q = el.shopSearch.value.trim();
      el.shopClear.hidden = !state.q;
      render();
    });
    el.shopClear.addEventListener('click', function () {
      el.shopSearch.value = '';
      state.q = '';
      el.shopClear.hidden = true;
      render();
      el.shopSearch.focus();
    });

    document.addEventListener('click', function (e) {
      // 详情里点图片 → 全屏看大图
      var gimg = e.target.closest('.dg-slide img');
      if (gimg) {
        e.preventDefault();
        if (!el.imgView.hidden) { el.imgView.hidden = true; return; }
        el.imgViewImg.src = gimg.getAttribute('src');
        el.imgView.hidden = false;
        return;
      }
      if (!el.imgView.hidden && (e.target === el.imgView || e.target === el.imgViewImg)) {
        el.imgView.hidden = true;
        return;
      }

      if (e.target.closest('[data-detail-close]')) { closeDetail(); return; }

      var dAdd = e.target.closest('[data-detail-add]');
      if (dAdd) {
        var did = dAdd.getAttribute('data-detail-add');
        closeDetail();
        addToCart(did);
        return;
      }

      var add = e.target.closest('[data-add]');
      if (add) { addToCart(add.getAttribute('data-add')); return; }

      var open = e.target.closest('[data-open]');
      if (open) { openDetail(open.getAttribute('data-open')); return; }

      var rm = e.target.closest('[data-remove]');
      if (rm) { removeFromCart(rm.getAttribute('data-remove')); return; }

      var cat = e.target.closest('[data-cat]');
      if (cat) { state.cat = cat.getAttribute('data-cat'); render(); return; }
    });

    el.detailDrawer.addEventListener('click', function (e) {
      if (e.target === el.detailDrawer) { closeDetail(); }
    });

    el.btnCart.addEventListener('click', openDrawer);
    el.cartFab.addEventListener('click', openDrawer);
    el.cartClose.addEventListener('click', closeDrawer);
    el.cartDrawer.addEventListener('click', function (e) {
      if (e.target === el.cartDrawer) { closeDrawer(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.imgView.hidden) { el.imgView.hidden = true; }
        else if (!el.detailDrawer.hidden) { closeDetail(); }
        else if (!el.cartDrawer.hidden) { closeDrawer(); }
      }
    });

    el.btnClearCart.addEventListener('click', function () {
      if (!state.cart.length) { return; }
      if (!window.confirm('清空所有已选图书？清空后它们会重新回到列表。')) { return; }
      state.cart = [];
      saveCart();
      render();
      toast('已清空选购');
    });

    el.btnCopy.addEventListener('click', copyCart);
    el.btnRefresh.addEventListener('click', function () {
      el.btnRefresh.classList.add('spin');
      load(true).then(function () { el.btnRefresh.classList.remove('spin'); });
    });
  }

  /* ---------------- 启动 ---------------- */

  function load(manual) {
    el.shopStatus.textContent = '正在加载…';
    el.shopDot.className = 'dot sync';

    return readConfig().then(function (cfg) {
      if (!cfg) { return fetchStatic(); }
      state.cfg = cfg;
      visitInsert = trackVisit(cfg);
      // 优先实时数据；连不上就退回站点里的静态快照（换网络/被墙时也能看到东西）
      return fetchCatalog(cfg).catch(function (e) {
        // 记下真实原因，方便排查（页面上不显示技术细节）
        try {
          document.documentElement.setAttribute('data-cloud-error',
            (e && e.name ? e.name : '?') + ' | ' + (e && e.message ? e.message : '') + ' | ' + cfg.url);
        } catch (err) { /* ignore */ }
        return fetchStatic().then(function (res) {
          res.mode = 'static';
          res.degraded = '云端连不上（' + (e && e.message ? e.message : '网络错误') + '），显示的是静态快照';
          return res;
        });
      });
    }).then(function (res) {
      state.rows = (res.rows || []).map(normalize).filter(function (b) { return b.id && b.title; });
      state.mode = res.mode;
      state.degraded = res.degraded || '';
      state.at = new Date().toISOString();
      saveCache();
      render();

      // 访客数独立拉取：即使数据库连不上，也先显示上次缓存的人数
      renderPublicVisits(cachedPublicVisits());
      loadContact(state.cfg);
      if (state.cfg) {
        // 等本次访问记录写入后再统计，否则可能统计不到自己
        Promise.resolve(visitInsert).then(function () {
          return new Promise(function (r) { setTimeout(r, 600); });
        }).then(function () {
          return fetchPublicVisits(state.cfg);
        }).then(function (d) {
          if (d && Number(d.visitors)) { savePublicVisits(d); }
          renderPublicVisits(d || cachedPublicVisits());
        });
      }
      if (manual) { toast(state.degraded || '库存已刷新', state.degraded ? 'err' : undefined); }
    }).catch(function (err) {
      var cached = loadCache();
      if (cached) {
        state.rows = (cached.rows || []).map(normalize);
        state.at = cached.at;
        state.mode = 'cache';
        state.degraded = '';
        render();
        if (manual) { toast('网络不可用，显示的是上次缓存', 'err'); }
      } else {
        state.rows = [];
        state.mode = '';
        state.degraded = '';
        render();
        showNotice(
          '<h3>连不上库存</h3>' +
          '<p>网络能打开这个页面，但连不上数据库：<code>' +
          esc(String((err && err.message) || err || '未知错误').slice(0, 120)) + '</code></p>' +
          '<p>常见原因：当前网络（尤其手机流量）拦截了 <code>*.supabase.co</code>，或者数据库暂时不可用。' +
          '换个网络（比如 WiFi）再试，多数情况能恢复。</p>' +
          '<p><button class="btn primary sm" id="noticeRetry" type="button">重试</button></p>'
        );
        var rb = $('noticeRetry');
        if (rb) { rb.addEventListener('click', function () { load(true); }); }
      }
    });
  }

  function init() {
    el = {
      shopDot: $('shopDot'),
      shopStatus: $('shopStatus'),
      shopSearch: $('shopSearch'),
      shopClear: $('shopClear'),
      shopCats: $('shopCats'),
      shopGrid: $('shopGrid'),
      shopEmpty: $('shopEmpty'),
      shopCount: $('shopCount'),
      shopVisitors: $('shopVisitors'),
      contactBox: $('contactBox'),
      contactText: $('contactText'),
      cartContact: $('cartContact'),
      btnRefresh: $('btnRefresh'),
      btnCart: $('btnCart'),
      cartBadge: $('cartBadge'),
      cartFab: $('cartFab'),
      cartFabText: $('cartFabText'),
      cartDrawer: $('cartDrawer'),
      detailDrawer: $('detailDrawer'),
      detailBody: $('detailBody'),
      imgView: $('imgView'),
      imgViewImg: $('imgViewImg'),
      cartClose: $('cartClose'),
      cartList: $('cartList'),
      cartSummary: $('cartSummary'),
      cartTotal: $('cartTotal'),
      btnCopy: $('btnCopy'),
      btnClearCart: $('btnClearCart'),
      toastWrap: $('toastWrap')
    };

    loadCart();
    bind();
    bindEngagement();
    render();
    renderPublicVisits(cachedPublicVisits());
    load(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
