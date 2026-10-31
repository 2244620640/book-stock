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

  function readConfig() {
    return fetch('config.json', { cache: 'no-store' })
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
    return fetch(url, { headers: { apikey: cfg.key, Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) { throw new Error('读取库存失败（HTTP ' + res.status + '）'); }
      return res.json();
    }).then(function (rows) {
      return { rows: rows || [], mode: 'cloud' };
    });
  }

  function fetchStatic() {
    return fetch('catalog.json', { cache: 'no-store' }).then(function (res) {
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
      location: String(r.location || '')
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

  function available() {
    return state.rows.filter(function (b) { return b.qty > 0; });
  }

  function visibleRows() {
    var q = state.q.toLowerCase();
    return available().filter(function (b) {
      if (state.cat && b.category !== state.cat) { return false; }
      if (inCart(b.id)) { return false; }          // 已加入选购的，从列表里隐藏
      if (!q) { return true; }
      return [b.title, b.author, b.category, b.isbn, b.publisher].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderStatus() {
    var text = '';
    var dot = '';
    if (state.mode === 'cloud') {
      dot = 'on';
      text = '共 ' + available().length + ' 种在售 · 更新于 ' + fmtTime(state.at);
    } else if (state.mode === 'static') {
      dot = '';
      text = '共 ' + available().length + ' 种在售 · 静态清单 ' + fmtTime(state.at);
    } else if (state.mode === 'cache') {
      dot = 'err';
      text = '离线缓存 · 上次更新 ' + fmtTime(state.at);
    }
    el.shopDot.className = 'dot' + (dot ? ' ' + dot : '');
    el.shopStatus.textContent = text || '正在加载…';
  }

  function renderCats() {
    var counts = {};
    available().forEach(function (b) {
      var c = b.category || '未分类';
      counts[c] = (counts[c] || 0) + 1;
    });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (names.length <= 1) { el.shopCats.innerHTML = ''; return; }
    var html = ['<button class="chip' + (state.cat === '' ? ' active' : '') + '" data-cat="">全部<span class="count">' + available().length + '</span></button>'];
    names.forEach(function (n) {
      html.push('<button class="chip' + (state.cat === n ? ' active' : '') + '" data-cat="' + esc(n) + '">' +
        esc(n) + '<span class="count">' + counts[n] + '</span></button>');
    });
    el.shopCats.innerHTML = html.join('');
  }

  function cardHTML(b) {
    var cover = b.cover
      ? '<img src="' + esc(b.cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    return '<article class="shop-card" data-id="' + esc(b.id) + '">' +
      '<div class="shop-cover">' + cover +
        (cover ? '' : '<div class="ph">暂无图片</div>') +
        '<span class="stock-tag">库存 ' + b.qty + ' ' + esc(b.unit) + '</span>' +
      '</div>' +
      '<div class="shop-info">' +
        '<div class="shop-title">' + esc(b.title) + '</div>' +
        '<div class="shop-meta">' + esc([b.category, b.author].filter(Boolean).join(' · ') || '—') + '</div>' +
        '<div class="shop-price-row">' +
          '<span class="shop-price' + (b.price ? '' : ' free') + '">' + (b.price ? money(b.price) : '价格面议') + '</span>' +
        '</div>' +
        '<button class="btn sm primary" data-add="' + esc(b.id) + '" type="button">加入选购</button>' +
      '</div>' +
    '</article>';
  }

  function render() {
    renderStatus();
    renderCats();
    var list = visibleRows();
    el.shopGrid.innerHTML = list.map(cardHTML).join('');

    var avail = available().length;
    var all = state.rows.length;

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

    el.shopCount.textContent = avail
      ? '共 ' + avail + ' 种在售 · 已选 ' + state.cart.length + ' 种'
      : '';

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
      var add = e.target.closest('[data-add]');
      if (add) { addToCart(add.getAttribute('data-add')); return; }

      var rm = e.target.closest('[data-remove]');
      if (rm) { removeFromCart(rm.getAttribute('data-remove')); return; }

      var cat = e.target.closest('[data-cat]');
      if (cat) { state.cat = cat.getAttribute('data-cat'); render(); return; }
    });

    el.btnCart.addEventListener('click', openDrawer);
    el.cartFab.addEventListener('click', openDrawer);
    el.cartClose.addEventListener('click', closeDrawer);
    el.cartDrawer.addEventListener('click', function (e) {
      if (e.target === el.cartDrawer) { closeDrawer(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.cartDrawer.hidden) { closeDrawer(); }
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
      if (cfg) { return fetchCatalog(cfg); }
      return fetchStatic();
    }).then(function (res) {
      state.rows = (res.rows || []).map(normalize).filter(function (b) { return b.id && b.title; });
      state.mode = res.mode;
      state.at = new Date().toISOString();
      saveCache();
      render();
      if (manual) { toast('库存已刷新'); }
    }).catch(function (err) {
      var cached = loadCache();
      if (cached) {
        state.rows = (cached.rows || []).map(normalize);
        state.at = cached.at;
        state.mode = 'cache';
        render();
        if (manual) { toast('网络不可用，显示的是上次缓存', 'err'); }
      } else {
        state.rows = [];
        state.mode = '';
        render();
        showNotice(
          '<h3>还没有连接库存</h3>' +
          '<p>把站点目录里的 <code>config.json</code> 填上 Supabase 的 <b>Project URL</b> 和 <b>anon public key</b>，' +
          '并确认已经执行过 <code>supabase-schema.sql</code> 里的 <code>catalog</code> 视图，顾客就能看到实时库存了。</p>' +
          '<p style="color:var(--muted);font-size:12px">本机预览时，先在管理页登录一次，这里会自动借用那份配置。</p>'
        );
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
      btnRefresh: $('btnRefresh'),
      btnCart: $('btnCart'),
      cartBadge: $('cartBadge'),
      cartFab: $('cartFab'),
      cartFabText: $('cartFabText'),
      cartDrawer: $('cartDrawer'),
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
    render();
    load(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
