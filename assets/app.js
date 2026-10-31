/*!
 * 仓储图书库存 · 界面逻辑
 */
(function () {
  'use strict';

  var S = window.Store;
  var C = window.Cloud;

  var el = {};
  var ui = {
    view: 'overview',
    q: '',
    category: '',
    stock: '',
    sort: 'updated',
    logType: '',
    syncing: false
  };

  /* ================= 小工具 ================= */

  function $(id) { return document.getElementById(id); }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function fmtInt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

  function money(n) {
    n = Number(n || 0);
    if (n >= 100000) { return '¥' + (n / 10000).toFixed(1) + '万'; }
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function moneyFull(n) {
    return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function ymd(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (!t || isNaN(t)) { return ''; }
    var diff = Date.now() - t;
    if (diff < 60000) { return '刚刚'; }
    if (diff < 3600000) { return Math.floor(diff / 60000) + ' 分钟前'; }
    if (diff < 86400000) { return Math.floor(diff / 3600000) + ' 小时前'; }
    if (diff < 7 * 86400000) { return Math.floor(diff / 86400000) + ' 天前'; }
    return S.fmtLocal(iso).slice(0, 10);
  }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><polyline points="7.5 10 12 14.5 16.5 10"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14V3"/><polyline points="7.5 7 12 2.5 16.5 7"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M8 8h7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20H2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6.5"/></svg>'
  };

  function typeLabel(t) {
    return ({ in: '入库', out: '出库', adjust: '盘点', create: '新增', delete: '删除', undo: '撤销' })[t] || t;
  }

  /* ================= 提示 ================= */

  function toast(msg, opt) {
    opt = opt || {};
    var wrap = el.toastWrap;
    var box = document.createElement('div');
    box.className = 'toast' + (opt.type === 'err' ? ' err' : '');
    box.innerHTML = '<div class="msg">' + esc(msg) + '</div>' +
      (opt.action ? '<button type="button" data-toast-action>' + esc(opt.action.label) + '</button>' : '');
    if (opt.action) {
      box.querySelector('[data-toast-action]').addEventListener('click', function () {
        opt.action.run();
        remove();
      });
    }
    function remove() {
      box.classList.add('out');
      setTimeout(function () { if (box.parentNode) { box.parentNode.removeChild(box); } }, 200);
    }
    wrap.appendChild(box);
    var timer = setTimeout(remove, opt.duration || (opt.action ? 6000 : 2600));
    box.addEventListener('pointerdown', function () { clearTimeout(timer); });
    while (wrap.children.length > 3) { wrap.removeChild(wrap.firstElementChild); }
  }

  /* ================= 弹层 ================= */

  function openModal(html) {
    el.modal.innerHTML = '<div class="modal-card">' + html + '</div>';
    el.modal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    el.modal.hidden = true;
    el.modal.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function modalHead(title, sub) {
    return '<div class="modal-head"><div><h3>' + esc(title) + '</h3>' +
      (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<button class="modal-close" data-close type="button" aria-label="关闭">×</button></div>';
  }

  function fieldHTML(opt) {
    return '<div class="field"' + (opt.style ? ' style="' + opt.style + '"' : '') + '>' +
      '<label>' + esc(opt.label) + (opt.required ? '<span class="req">*</span>' : '') + '</label>' +
      opt.control +
      (opt.hint ? '<div class="hint">' + opt.hint + '</div>' : '') +
      '</div>';
  }

  function inputHTML(id, opt) {
    opt = opt || {};
    return '<input class="input" id="' + id + '" type="' + (opt.type || 'text') + '"' +
      (opt.inputmode ? ' inputmode="' + opt.inputmode + '"' : '') +
      (opt.value != null ? ' value="' + esc(opt.value) + '"' : '') +
      (opt.placeholder ? ' placeholder="' + esc(opt.placeholder) + '"' : '') +
      (opt.maxlength ? ' maxlength="' + opt.maxlength + '"' : '') +
      (opt.step ? ' step="' + opt.step + '"' : '') +
      (opt.min != null ? ' min="' + opt.min + '"' : '') +
      (opt.list ? ' list="' + opt.list + '"' : '') +
      (opt.autocomplete ? ' autocomplete="' + opt.autocomplete + '"' : '') +
      (opt.required ? ' required' : '') +
      '>';
  }

  /* ================= 视图切换 ================= */

  function setView(name) {
    ui.view = name;
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) {
      views[i].classList.toggle('active', views[i].id === 'view-' + name);
    }
    var tabs = document.querySelectorAll('.tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('active', tabs[j].getAttribute('data-view') === name);
    }
    el.btnAdd.classList.toggle('hidden', name === 'settings' || name === 'logs');
    if (name === 'settings') { fillSettings(); }
    if (history.replaceState) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// 下忽略 */ }
    }
    window.scrollTo(0, 0);
  }

  /* ================= 同步状态 ================= */

  function syncState() {
    if (!C.isConfigured()) {
      return { dot: '', text: '本机模式 · 数据只存这台设备', badge: '未启用', badgeOff: true };
    }
    if (!S.session()) {
      return { dot: 'err', text: '云端已配置 · 未登录', badge: '待登录', badgeOff: true };
    }
    if (ui.syncing) {
      return { dot: 'sync', text: '正在同步…', badge: '同步中', badgeOff: false };
    }
    if (!navigator.onLine) {
      return { dot: 'err', text: '离线 · 改动会在联网后上传', badge: '离线', badgeOff: true };
    }
    var last = S.cloudConfig().lastSyncAt;
    return {
      dot: 'on',
      text: last ? '已同步 · ' + relTime(last) : '已连接 · 点击右上角同步',
      badge: '已开启',
      badgeOff: false
    };
  }

  function renderSyncState() {
    var st = syncState();
    el.syncDot.className = 'dot' + (st.dot ? ' ' + st.dot : '');
    el.syncText.textContent = st.text;
    if (el.cloudBadge) {
      el.cloudBadge.textContent = st.badge;
      el.cloudBadge.className = 'badge' + (st.badgeOff ? ' off' : '');
    }
  }

  /* ================= 概览 ================= */

  function renderOverview() {
    var st = S.stats();
    el.heroQty.textContent = fmtInt(st.qty);
    el.heroValue.textContent = money(st.value);
    el.heroTitles.textContent = fmtInt(st.titles);
    el.heroWarn.textContent = fmtInt(st.warn);

    var today = ymd(new Date());
    var inQty = 0, outQty = 0;
    var logs = S.logs();
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (ymd(new Date(l.createdAt)) !== today) { break; }
      if (l.type === 'in') { inQty += l.qty; }
      else if (l.type === 'out') { outQty += Math.abs(l.qty); }
    }

    el.kpiRow.innerHTML =
      kpi('今日入库', fmtInt(inQty), '册', '') +
      kpi('今日出库', fmtInt(outQty), '册', '') +
      kpi('缺货品种', fmtInt(st.out), '种', st.out ? 'danger' : '') +
      kpi('低于安全库存', fmtInt(st.low), '种', st.low ? 'warn' : '');

    // 分类
    var cats = S.categoryStats().filter(function (c) { return c.qty > 0; }).slice(0, 6);
    if (!cats.length) {
      el.catBars.innerHTML = '<div class="muted" style="font-size:13px;text-align:center;padding:10px 0">还没有库存数据，先添加几本书吧</div>';
    } else {
      var max = cats[0].qty || 1;
      el.catBars.innerHTML = cats.map(function (c) {
        var pct = Math.max(2, Math.round(c.qty / max * 100));
        return '<div class="bar-row">' +
          '<div class="name">' + esc(c.name) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="num">' + fmtInt(c.qty) + '</div>' +
          '</div>';
      }).join('');
    }

    // 预警
    var warn = S.query({ stock: 'warn', sort: 'qtyAsc' }).slice(0, 5);
    if (!warn.length) {
      el.warnList.innerHTML = '<div class="muted" style="font-size:13px;padding:16px;text-align:center">' +
        (st.titles ? '库存充足，没有预警图书' : '暂无数据') + '</div>';
    } else {
      el.warnList.innerHTML = warn.map(function (b) {
        return '<div class="log ' + (S.isOut(b) ? 'out' : 'adjust') + '">' +
          '<div class="ico">' + (S.isOut(b) ? ICON.warn : ICON.book) + '</div>' +
          '<div><div class="t">' + esc(b.title) + '</div>' +
          '<div class="s">' + (S.isOut(b) ? '已缺货' : '低于安全库存 ' + b.minQty) +
          (b.location ? ' · ' + esc(b.location) : '') + '</div></div>' +
          '<div class="r"><button class="mini primary" data-act="in" data-id="' + esc(b.id) + '">补货</button></div>' +
          '</div>';
      }).join('');
    }

    // 动态
    var recent = logs.slice(0, 5);
    if (!recent.length) {
      el.recentLogs.innerHTML = '<div class="muted" style="font-size:13px;padding:16px;text-align:center">还没有操作记录</div>';
    } else {
      el.recentLogs.innerHTML = recent.map(function (l) { return logHTML(l, true); }).join('');
    }
  }

  function kpi(label, value, unit, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + value + '<small>' + esc(unit) + '</small></div></div>';
  }

  /* ================= 图书列表 ================= */

  function renderBooks() {
    renderChips();
    var list = S.query({ q: ui.q, category: ui.category, stock: ui.stock, sort: ui.sort });
    var all = S.books();

    if (!all.length) {
      el.bookList.innerHTML = '';
      el.bookEmpty.innerHTML = '<div class="empty">' +
        '<div class="glyph">' + ICON.book + '</div>' +
        '<h3>仓库里还没有图书</h3>' +
        '<p>手动新增、从 Excel 批量导入，或者恢复一份备份文件</p>' +
        '<div class="btn-row" style="justify-content:center">' +
        '<button class="btn primary" data-act="add">新增图书</button>' +
        '<button class="btn" data-act="importCsv">导入表格</button>' +
        '<button class="btn" data-act="importJson">恢复备份</button>' +
        '</div></div>';
      el.bookCount.textContent = '';
      return;
    }

    el.bookEmpty.innerHTML = '';
    if (!list.length) {
      el.bookList.innerHTML = '';
      el.bookEmpty.innerHTML = '<div class="empty"><div class="glyph">' + ICON.arrow + '</div>' +
        '<h3>没有符合条件的图书</h3><p>换个关键词，或者清除筛选条件</p>' +
        '<div class="btn-row" style="justify-content:center"><button class="btn" data-act="resetFilter">清除筛选</button></div></div>';
      el.bookCount.textContent = '';
      return;
    }

    el.bookList.innerHTML = list.map(bookHTML).join('');
    var totalQty = list.reduce(function (n, b) { return n + b.qty; }, 0);
    el.bookCount.textContent = '共 ' + list.length + ' 种 · ' + fmtInt(totalQty) + ' 册' +
      (list.length !== all.length ? '（筛选自 ' + all.length + ' 种）' : '');
  }

  function renderChips() {
    var all = S.books();
    var out = 0, low = 0;
    for (var i = 0; i < all.length; i++) {
      if (S.isOut(all[i])) { out++; }
      else if (S.isLow(all[i])) { low++; }
    }
    var stockDefs = [
      { v: '', label: '全部', n: all.length },
      { v: 'warn', label: '需补货', n: out + low },
      { v: 'out', label: '缺货', n: out }
    ];
    el.stockChips.innerHTML = stockDefs.map(function (d) {
      return '<button class="chip' + (ui.stock === d.v ? ' active' : '') + '" data-stock="' + d.v + '">' +
        esc(d.label) + '<span class="count">' + d.n + '</span></button>';
    }).join('');

    var counts = {};
    all.forEach(function (b) {
      var c = b.category || '未分类';
      counts[c] = (counts[c] || 0) + 1;
    });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var chips = ['<button class="chip' + (ui.category === '' ? ' active' : '') + '" data-cat="">全部分类</button>'];
    names.forEach(function (n) {
      chips.push('<button class="chip' + (ui.category === n ? ' active' : '') + '" data-cat="' + esc(n) + '">' +
        esc(n) + '<span class="count">' + counts[n] + '</span></button>');
    });
    el.catChips.innerHTML = chips.join('');
  }

  function bookHTML(b) {
    var state = S.isOut(b) ? 'out' : (S.isLow(b) ? 'warn' : '');
    var tags = '';
    if (b.category) { tags += '<span class="tag cat">' + esc(b.category) + '</span>'; }
    if (b.location) { tags += '<span class="tag loc">' + esc(b.location) + '</span>'; }
    if (S.isOut(b)) { tags += '<span class="tag out">缺货</span>'; }
    else if (S.isLow(b)) { tags += '<span class="tag warn">低于安全库存</span>'; }
    var shotCount = S.photoList(b).length;
    if (shotCount) { tags += '<span class="tag photo">照片 ' + shotCount + '</span>'; }
    if (!tags) { tags = '<span class="tag">未分类</span>'; }
    var meta = [b.author, b.publisher, b.isbn].filter(Boolean).join(' · ');

    var cover = b.cover
      ? '<div class="cover" data-act="detail" data-id="' + esc(b.id) + '">' +
        '<img src="' + esc(b.cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'img-broken\')">' +
        '</div>'
      : '';

    return '<article class="book ' + state + (b.cover ? ' has-cover' : '') + '" data-id="' + esc(b.id) + '">' +
      cover +
      '<div class="book-main" data-act="detail" data-id="' + esc(b.id) + '" style="min-width:0;cursor:pointer">' +
        '<div class="title">' + esc(b.title) + '</div>' +
        '<div class="meta">' + esc(meta || '未填写作者 / ISBN') + '</div>' +
        '<div class="tags">' + tags + '</div>' +
      '</div>' +
      '<div class="qtybox ' + state + '">' +
        '<b>' + fmtInt(b.qty) + '</b>' +
        '<span>' + esc(b.unit || '册') + '</span>' +
        (b.price ? '<div class="money">' + money(b.qty * b.price) + '</div>' : '') +
      '</div>' +
      '<div class="actions">' +
        '<button class="mini primary" data-act="in" data-id="' + esc(b.id) + '">' + ICON.in + '入库</button>' +
        '<button class="mini" data-act="out" data-id="' + esc(b.id) + '">' + ICON.out + '出库</button>' +
        '<button class="mini ghost" data-act="edit" data-id="' + esc(b.id) + '" aria-label="编辑">' + ICON.edit + '</button>' +
      '</div>' +
    '</article>';
  }

  /* ================= 流水 ================= */

  function renderLogs() {
    var defs = [
      { v: '', label: '全部' },
      { v: 'in', label: '入库' },
      { v: 'out', label: '出库' },
      { v: 'adjust', label: '盘点' }
    ];
    el.logChips.innerHTML = defs.map(function (d) {
      return '<button class="chip' + (ui.logType === d.v ? ' active' : '') + '" data-log="' + d.v + '">' + esc(d.label) + '</button>';
    }).join('');

    var list = S.logs();
    if (ui.logType) { list = list.filter(function (l) { return l.type === ui.logType; }); }
    list = list.slice(0, 200);

    if (!list.length) {
      el.logList.innerHTML = '';
      el.logEmpty.innerHTML = '<div class="empty"><div class="glyph">' + ICON.arrow + '</div>' +
        '<h3>还没有出入库记录</h3><p>每次入库、出库、盘点都会自动记一笔</p></div>';
      return;
    }
    el.logEmpty.innerHTML = '';
    el.logList.innerHTML = list.map(function (l) { return logHTML(l); }).join('');
  }

  function logHTML(l, compact) {
    var sign = l.qty > 0 ? '+' : '';
    var cls = l.qty > 0 ? 'plus' : 'minus';
    var noteBits = [];
    if (l.beforeQty !== l.afterQty) { noteBits.push(l.beforeQty + ' → ' + l.afterQty); }
    if (l.operator) { noteBits.push(l.operator); }
    if (l.note) { noteBits.push(l.note); }
    var undo = (!compact && (l.type === 'in' || l.type === 'out' || l.type === 'adjust'))
      ? '<button class="undo" data-act="undo" data-id="' + esc(l.id) + '">撤销</button>' : '';
    return '<div class="log ' + esc(l.type) + '">' +
      '<div class="ico">' + (l.type === 'in' ? ICON.in : l.type === 'out' ? ICON.out : l.type === 'delete' ? ICON.trash : ICON.edit) + '</div>' +
      '<div style="min-width:0">' +
        '<div class="t">' + esc(l.title || '（未知图书）') + '</div>' +
        '<div class="s">' + esc(typeLabel(l.type)) + (noteBits.length ? ' · ' + esc(noteBits.join(' · ')) : '') + '</div>' +
      '</div>' +
      '<div class="r">' +
        '<div class="delta ' + cls + '">' + sign + fmtInt(l.qty) + '</div>' +
        '<div class="when">' + esc(relTime(l.createdAt)) + '</div>' +
        undo +
      '</div>' +
    '</div>';
  }

  /* ================= 设置 ================= */

  function fillSettings() {
    el.operatorInput.value = S.settings().operator || '';
    var c = S.cloudConfig();
    el.cloudUrl.value = c.url || '';
    el.cloudKey.value = c.key || '';
    var s = S.session();
    if (s && s.email) { el.authEmail.value = s.email; }
    updateCloudStatus();
    updateShopLink();
  }

  function shopUrl() {
    var href = location.href.split('#')[0].split('?')[0];
    return href.replace(/[^/]*$/, '') + 'shop.html';
  }

  function updateShopLink() {
    if (!el.shopLink) { return; }
    el.shopLink.value = shopUrl();
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

  function updateCloudStatus() {
    var st = syncState();
    renderSyncState();
    if (!el.cloudStatus) { return; }
    if (!C.isConfigured()) {
      el.cloudStatus.innerHTML = '本机模式：数据只保存在当前浏览器，换设备需要导出备份再导入。';
    } else if (!S.session()) {
      el.cloudStatus.innerHTML = '已填写云端地址，<b>请登录</b>后即可多设备共享。';
    } else {
      var last = S.cloudConfig().lastSyncAt;
      el.cloudStatus.innerHTML = '已登录：<b>' + esc(S.session().email || '') + '</b>' +
        (last ? ' · 上次同步 ' + esc(relTime(last)) : ' · 尚未同步');
    }
  }

  /* ================= 各自动作 ================= */

  function openStockModal(id, dir) {
    var b = S.find(id);
    if (!b) { return; }
    var type = dir === 'out' ? 'out' : 'in';
    var operator = S.settings().operator || S.session() && S.session().email || '';

    openModal(
      modalHead(type === 'in' ? '入库登记' : '出库登记',
        esc(b.title) + ' · 当前库存 <b>' + fmtInt(b.qty) + '</b> ' + esc(b.unit || '册')) +
      '<div class="seg" id="seg">' +
        '<button type="button" data-type="in" class="' + (type === 'in' ? 'active' : '') + '">入库 +</button>' +
        '<button type="button" data-type="out" class="' + (type === 'out' ? 'active' : '') + '">出库 −</button>' +
      '</div>' +
      fieldHTML({
        label: '数量',
        control: '<div class="stepper">' +
          '<button type="button" data-step="-1">−</button>' +
          '<input class="input" id="stockQty" type="number" inputmode="numeric" value="1" min="1" step="1">' +
          '<button type="button" data-step="1">+</button></div>' +
          '<div class="quick">' + [1, 5, 10, 50].map(function (n) {
            return '<button type="button" data-quick="' + n + '">' + n + '</button>';
          }).join('') + '</div>'
      }) +
      fieldHTML({ label: '备注', control: inputHTML('stockNote', { placeholder: type === 'in' ? '如：采购到货、退货入库' : '如：门店领用、借出', maxlength: 60 }) }) +
      fieldHTML({ label: '操作员', control: inputHTML('stockOperator', { value: operator, placeholder: '你的名字', maxlength: 20 }) }) +
      '<div class="modal-foot">' +
        '<button class="btn" data-close type="button">取消</button>' +
        '<button class="btn primary" id="stockSubmit" type="button">确认' + (type === 'in' ? '入库' : '出库') + '</button>' +
      '</div>'
    );

    var qtyInput = $('stockQty');
    var submit = $('stockSubmit');

    function setType(t) {
      type = t;
      var seg = $('seg');
      seg.querySelectorAll('button').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-type') === t);
      });
      submit.textContent = '确认' + (t === 'in' ? '入库' : '出库');
    }

    $('seg').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (btn) { setType(btn.getAttribute('data-type')); }
    });

    el.modal.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = parseInt(qtyInput.value, 10) || 0;
        v += parseInt(btn.getAttribute('data-step'), 10);
        qtyInput.value = Math.max(1, v);
      });
    });

    el.modal.querySelectorAll('[data-quick]').forEach(function (btn) {
      btn.addEventListener('click', function () { qtyInput.value = btn.getAttribute('data-quick'); });
    });

    submit.addEventListener('click', function () {
      var qty = Math.max(1, parseInt(qtyInput.value, 10) || 0);
      var note = $('stockNote').value.trim();
      var op = $('stockOperator').value.trim();
      if (op) { S.saveSettings({ operator: op }); }
      var delta = type === 'in' ? qty : -qty;
      try {
        var r = S.moveStock(b.id, delta, { note: note, operator: op });
        closeModal();
        toast((b.title.length > 14 ? b.title.slice(0, 14) + '…' : b.title) + ' ' +
          (r.applied > 0 ? '入库 +' + r.applied : '出库 ' + r.applied) + '，现有 ' + r.book.qty, {
          action: {
            label: '撤销',
            run: function () {
              try { S.undoStock(r.log); afterChange(); toast('已撤销'); } catch (e) { toast(e.message, { type: 'err' }); }
            }
          }
        });
        afterChange();
      } catch (e) {
        toast(e.message, { type: 'err' });
      }
    });

    setTimeout(function () { qtyInput.focus(); qtyInput.select(); }, 60);
  }

  function openBookForm(id) {
    var book = id ? S.find(id) : null;
    var b = book || {};
    var cats = S.categories();
    var title = book ? '编辑图书' : '新增图书';

    openModal(
      modalHead(title, book ? '修改后库存变化会自动记入流水' : '带 * 的为必填项') +
      fieldHTML({
        label: '书名', required: true,
        control: inputHTML('f_title', { value: b.title || '', placeholder: '例如：三体', maxlength: 80, required: true })
      }) +
      '<div class="field-row">' +
        fieldHTML({ label: '作者', control: inputHTML('f_author', { value: b.author || '', placeholder: '刘慈欣', maxlength: 40 }) }) +
        fieldHTML({ label: 'ISBN', control: inputHTML('f_isbn', { value: b.isbn || '', placeholder: '9787...', inputmode: 'numeric', maxlength: 20 }) }) +
      '</div>' +
      '<div class="field-row">' +
        fieldHTML({
          label: '分类',
          control: inputHTML('f_category', { value: b.category || '', placeholder: '文学 / 教材', maxlength: 20, list: 'catList' }) +
            '<datalist id="catList">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>'
        }) +
        fieldHTML({ label: '出版社', control: inputHTML('f_publisher', { value: b.publisher || '', placeholder: '重庆出版社', maxlength: 30 }) }) +
      '</div>' +
      '<div class="field-row">' +
        fieldHTML({ label: '单价（元）', control: inputHTML('f_price', { value: b.price || '', type: 'number', inputmode: 'decimal', step: '0.01', min: 0, placeholder: '0.00' }) }) +
        fieldHTML({ label: '货位', control: inputHTML('f_location', { value: b.location || '', placeholder: 'A-01-03', maxlength: 20 }) }) +
      '</div>' +
      '<div class="field-row-3">' +
        fieldHTML({ label: book ? '当前库存' : '库存数量', control: inputHTML('f_qty', { value: book ? b.qty : 0, type: 'number', inputmode: 'numeric', min: 0, step: '1' }) }) +
        fieldHTML({ label: '安全库存', control: inputHTML('f_minQty', { value: book ? b.minQty : 0, type: 'number', inputmode: 'numeric', min: 0, step: '1' }) }) +
        fieldHTML({ label: '单位', control: inputHTML('f_unit', { value: b.unit || '册', maxlength: 4 }) }) +
      '</div>' +
      fieldHTML({ label: '备注', control: '<textarea class="input" id="f_note" rows="2" maxlength="120" placeholder="可选">' + esc(b.note || '') + '</textarea>' }) +
      imageFieldHTML('cover', '封面照片（正面）', b.cover || '') +
      imageFieldHTML('back', '封底照片（背面）', b.back || '') +
      fieldHTML({
        label: '整套照片（可选）',
        control: '<textarea class="input" id="f_photos" rows="3" spellcheck="false" placeholder="每行一个图片路径或网址，例如 assets/covers/shaonian/001.jpg">' + esc(b.photos || '') + '</textarea>',
        hint: '一行一张，按顺序展示。手机端可以留空，改用上面的「选择图片」'
      }) +
      '<div class="modal-foot">' +
        (book ? '<button class="btn danger" data-act="del" data-id="' + esc(book.id) + '" type="button" style="flex:0 0 auto">删除</button>' : '') +
        '<button class="btn" data-close type="button">取消</button>' +
        '<button class="btn primary" id="bookSubmit" type="button">保存</button>' +
      '</div>'
    );

    wireImagePickers();

    setTimeout(function () {
      var t = $('f_title');
      if (!book && t) { t.focus(); }
    }, 60);

    function pickerValue(key) {
      var box = el.modal.querySelector('.img-picker[data-key="' + key + '"]');
      return box ? (box.getAttribute('data-value') || '') : '';
    }

    $('bookSubmit').addEventListener('click', function () {
      var data = {
        title: $('f_title').value.trim(),
        author: $('f_author').value.trim(),
        isbn: $('f_isbn').value.trim(),
        category: $('f_category').value.trim(),
        publisher: $('f_publisher').value.trim(),
        price: $('f_price').value,
        location: $('f_location').value.trim(),
        qty: $('f_qty').value,
        minQty: $('f_minQty').value,
        unit: $('f_unit').value.trim() || '册',
        note: $('f_note').value.trim(),
        cover: pickerValue('cover'),
        back: pickerValue('back'),
        photos: $('f_photos').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).join('\n')
      };
      if (!data.title) {
        toast('请填写书名', { type: 'err' });
        $('f_title').focus();
        return;
      }
      try {
        if (book) {
          S.updateBook(book.id, data);
          toast('已保存');
        } else {
          S.createBook(data);
          toast('已添加《' + data.title + '》');
        }
        closeModal();
        afterChange();
      } catch (e) {
        toast(e.message, { type: 'err' });
      }
    });
  }

  function openDetail(id) {
    var b = S.find(id);
    if (!b) { return; }
    var rows = [
      ['作者', b.author], ['出版社', b.publisher], ['ISBN', b.isbn],
      ['分类', b.category], ['货位', b.location], ['单价', b.price ? moneyFull(b.price) : ''],
      ['库存', fmtInt(b.qty) + ' ' + (b.unit || '册')], ['安全库存', b.minQty || ''],
      ['库存码洋', moneyFull(b.qty * b.price)], ['备注', b.note],
      ['更新时间', S.fmtLocal(b.updatedAt)]
    ].filter(function (r) { return r[1] !== '' && r[1] != null; });

    var shots = [];
    if (b.cover) { shots.push({ src: b.cover, label: '正面' }); }
    if (b.back) { shots.push({ src: b.back, label: '背面' }); }
    var allPhotos = S.photoList(b);

    openModal(
      modalHead(esc(b.title), esc([b.author, b.publisher].filter(Boolean).join(' · ') || '详细信息')) +
      (shots.length
        ? '<div class="gallery">' + shots.map(function (s) {
          return '<figure class="shot" data-act="zoom" data-src="' + esc(s.src) + '">' +
            '<img src="' + esc(s.src) + '" alt="' + esc(s.label) + '" loading="lazy">' +
            '<figcaption>' + esc(s.label) + '</figcaption></figure>';
        }).join('') + '</div>'
        : '') +
      (allPhotos.length
        ? '<button class="btn block" data-act="gallery" data-id="' + esc(b.id) + '" style="margin-bottom:16px">' +
          '查看整套照片 · 共 ' + allPhotos.length + ' 张</button>'
        : '') +
      '<div class="panel" style="margin-bottom:16px">' +
        rows.map(function (r) {
          return '<div class="log" style="grid-template-columns:80px 1fr;padding:9px 14px">' +
            '<div class="muted" style="font-size:12.5px">' + esc(r[0]) + '</div>' +
            '<div style="font-size:13.5px;word-break:break-word">' + esc(r[1]) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn primary" data-act="in" data-id="' + esc(b.id) + '">' + ICON.in + '入库</button>' +
        '<button class="btn" data-act="out" data-id="' + esc(b.id) + '">' + ICON.out + '出库</button>' +
        '<button class="btn" data-act="edit" data-id="' + esc(b.id) + '">' + ICON.edit + '编辑</button>' +
      '</div>'
    );
  }

  function openImage(src) {
    openModal(
      modalHead('图片预览', '点右侧 × 关闭') +
      '<div class="lightbox"><img src="' + esc(src) + '" alt=""></div>'
    );
  }

  function openGallery(id) {
    var b = S.find(id);
    if (!b) { return; }
    var list = S.photoList(b);
    if (!list.length) { toast('这套还没有照片'); return; }
    openModal(
      modalHead('整套照片', esc(b.title) + ' · 共 ' + list.length + ' 张') +
      '<div class="photo-grid">' + list.map(function (src, i) {
        return '<figure class="pthumb" data-act="zoom" data-src="' + esc(src) + '">' +
          '<img src="' + esc(src) + '" alt="" loading="lazy">' +
          '<figcaption>' + (i + 1) + '</figcaption></figure>';
      }).join('') + '</div>' +
      '<div class="modal-foot"><button class="btn" data-close type="button">关闭</button></div>'
    );
  }

  function fileToDataURL(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('图片处理失败'));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这个文件不是可识别的图片'));
      };
      img.src = url;
    });
  }

  function imageFieldHTML(key, label, value) {
    var has = !!value;
    var isData = has && value.indexOf('data:') === 0;
    return '<div class="field">' +
      '<label>' + esc(label) + '</label>' +
      '<div class="img-picker" data-key="' + key + '" data-value="' + esc(value || '') + '">' +
        '<div class="img-preview' + (has ? '' : ' empty') + '">' +
          (has ? '<img src="' + esc(value) + '" alt="">' : '<span>暂无图片</span>') +
        '</div>' +
        '<div class="img-side">' +
          '<div class="btn-row">' +
            '<button type="button" class="btn sm" data-img-pick>' + (has ? '更换图片' : '选择图片') + '</button>' +
            '<button type="button" class="btn sm ghost' + (has ? '' : ' hidden') + '" data-img-clear>清除</button>' +
          '</div>' +
          '<input class="input img-path" data-img-path type="text" spellcheck="false" ' +
            'placeholder="或粘贴图片网址 / 路径" value="' + esc(isData ? '' : (value || '')) + '">' +
          '<div class="hint">' + (has ? '已有图片' : '拍照或选择文件，自动压缩') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wireImagePickers() {
    ['cover', 'back'].forEach(function (key) {
      var box = el.modal.querySelector('.img-picker[data-key="' + key + '"]');
      if (!box) { return; }
      var preview = box.querySelector('.img-preview');
      var hint = box.querySelector('.hint');
      var clearBtn = box.querySelector('[data-img-clear]');
      var pickBtn = box.querySelector('[data-img-pick]');
      var pathInput = box.querySelector('[data-img-path]');
      var file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.style.display = 'none';
      box.appendChild(file);

      pickBtn.addEventListener('click', function () { file.click(); });

      pathInput.addEventListener('input', function () {
        var v = pathInput.value.trim();
        box.setAttribute('data-value', v);
        if (v) {
          preview.classList.remove('empty');
          preview.innerHTML = '<img src="' + esc(v) + '" alt="">';
          clearBtn.classList.remove('hidden');
          hint.textContent = '使用填写的图片地址';
        } else {
          preview.classList.add('empty');
          preview.innerHTML = '<span>暂无图片</span>';
          clearBtn.classList.add('hidden');
          hint.textContent = '拍照或选择文件，自动压缩';
        }
      });

      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) { return; }
        hint.textContent = '正在压缩…';
        fileToDataURL(f, 1000, 0.72).then(function (dataUrl) {
          box.setAttribute('data-value', dataUrl);
          pathInput.value = '';
          preview.classList.remove('empty');
          preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
          clearBtn.classList.remove('hidden');
          pickBtn.textContent = '更换图片';
          var kb = Math.round(dataUrl.length * 0.75 / 1024);
          hint.textContent = '已添加 · 约 ' + kb + ' KB（已压缩到长边 1000px）';
        }).catch(function (e) {
          hint.textContent = '拍照或选择文件，自动压缩';
          toast(e.message, { type: 'err' });
        });
      });

      clearBtn.addEventListener('click', function () {
        box.setAttribute('data-value', '');
        pathInput.value = '';
        preview.classList.add('empty');
        preview.innerHTML = '<span>暂无图片</span>';
        clearBtn.classList.add('hidden');
        pickBtn.textContent = '选择图片';
        hint.textContent = '拍照或选择文件，自动压缩';
      });
    });
  }

  function confirmModal(title, text, okLabel, onOk) {
    openModal(
      modalHead(title, '') +
      '<p style="font-size:14px;color:var(--ink-2);line-height:1.65">' + text + '</p>' +
      '<div class="modal-foot">' +
        '<button class="btn" data-close type="button">取消</button>' +
        '<button class="btn danger" id="confirmOk" type="button">' + esc(okLabel) + '</button>' +
      '</div>'
    );
    $('confirmOk').addEventListener('click', function () {
      closeModal();
      onOk();
    });
  }

  /* ================= 同步动作 ================= */

  function afterChange() {
    render();
    scheduleSync();
  }

  var syncTimer = null;
  function scheduleSync() {
    if (!C.isConfigured() || !S.session()) { return; }
    if (syncTimer) { clearTimeout(syncTimer); }
    syncTimer = setTimeout(function () { syncTimer = null; doSync(true); }, 2200);
  }

  function doSync(silent) {
    if (!C.isConfigured()) {
      if (!silent) { setView('settings'); toast('请先配置云端地址和密钥', { type: 'err' }); }
      return Promise.resolve();
    }
    if (!S.session()) {
      if (!silent) { setView('settings'); toast('请先登录云端账号', { type: 'err' }); }
      return Promise.resolve();
    }
    if (ui.syncing) { return Promise.resolve(); }
    ui.syncing = true;
    el.btnSync.classList.add('spin');
    renderSyncState();
    updateCloudStatus();
    return C.sync().then(function (r) {
      ui.syncing = false;
      el.btnSync.classList.remove('spin');
      renderSyncState();
      updateCloudStatus();
      render();
      if (!silent) {
        var bits = [];
        if (r.pushedBooks || r.pushedLogs) { bits.push('上传 ' + (r.pushedBooks + r.pushedLogs) + ' 条'); }
        if (r.pulledBooks || r.pulledLogs) { bits.push('下载 ' + (r.pulledBooks + r.pulledLogs) + ' 条'); }
        toast(bits.length ? '同步完成 · ' + bits.join('，') : '同步完成，数据已是最新');
      }
    }).catch(function (e) {
      ui.syncing = false;
      el.btnSync.classList.remove('spin');
      renderSyncState();
      updateCloudStatus();
      if (!silent) { toast(e.message || '同步失败', { type: 'err' }); }
      else { console.warn('自动同步失败：', e); }
    });
  }

  /* ================= 导入导出 ================= */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 800);
  }

  function todayName() {
    return ymd(new Date()).replace(/-/g, '');
  }

  function readFileText(file, allowGbk) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.onload = function () {
        var buf = fr.result;
        if (typeof buf === 'string') { resolve(buf); return; }
        var text = '';
        try { text = new TextDecoder('utf-8', { fatal: false }).decode(buf); } catch (e) { text = ''; }
        if (allowGbk && (!text || text.indexOf('\uFFFD') >= 0)) {
          try { text = new TextDecoder('gbk').decode(buf); } catch (e2) { /* 保持 utf-8 结果 */ }
        }
        resolve(text);
      };
      fr.readAsArrayBuffer(file);
    });
  }

  function doImportCsv(file) {
    readFileText(file, true).then(function (text) {
      var r = S.importCSV(text);
      var msg = '导入完成：新增 ' + r.created + ' 种，更新 ' + r.updated + ' 种';
      if (r.skipped) { msg += '，跳过 ' + r.skipped + ' 行'; }
      toast(msg + (r.errors.length ? '（' + r.errors.length + ' 行有问题）' : ''));
      if (r.errors.length) { console.warn('导入问题行：', r.errors); }
      afterChange();
    }).catch(function (e) {
      toast('导入失败：' + e.message, { type: 'err' });
    });
  }

  function doImportJson(file) {
    readFileText(file, false).then(function (text) {
      var r = S.importJSON(text);
      toast('恢复完成：图书 ' + r.books + ' 条，流水 ' + r.logs + ' 条');
      afterChange();
    }).catch(function (e) {
      toast('恢复失败：' + e.message, { type: 'err' });
    });
  }

  /* ================= 事件绑定 ================= */

  function bind() {
    // 标签切换
    el.tabbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (btn) { setView(btn.getAttribute('data-view')); }
    });

    // 全局按钮代理
    document.addEventListener('click', function (e) {
      var closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { closeModal(); return; }

      var goBtn = e.target.closest('[data-go]');
      if (goBtn) { setView(goBtn.getAttribute('data-go')); return; }

      var stockBtn = e.target.closest('[data-stock]');
      if (stockBtn && !e.target.closest('[data-id]')) {
        ui.stock = stockBtn.getAttribute('data-stock');
        setView('books');
        renderBooks();
        return;
      }

      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        var id = actBtn.getAttribute('data-id');
        if (act === 'add') { openBookForm(null); }
        else if (act === 'in' || act === 'out') { openStockModal(id, act); }
        else if (act === 'edit') { openBookForm(id); }
        else if (act === 'detail') { openDetail(id); }
        else if (act === 'zoom') { openImage(actBtn.getAttribute('data-src')); }
        else if (act === 'gallery') { openGallery(id); }
        else if (act === 'del') {
          var b = S.find(id);
          if (!b) { return; }
          confirmModal('删除《' + b.title + '》', '删除后这本书不再显示在列表里，历史流水仍会保留。确定删除吗？', '确认删除', function () {
            S.deleteBook(id);
            closeModal();
            afterChange();
            toast('已删除');
          });
        } else if (act === 'undo') {
          var log = null;
          S.logs().forEach(function (l) { if (l.id === id) { log = l; } });
          if (!log) { return; }
          confirmModal('撤销这笔记录', '将把《' + log.title + '》的库存调整回 ' + log.beforeQty + '，并记录一笔撤销流水。', '确认撤销', function () {
            try {
              S.undoStock(log);
              afterChange();
              toast('已撤销');
            } catch (err) { toast(err.message, { type: 'err' }); }
          });
        } else if (act === 'resetFilter') {
          ui.q = ''; ui.category = ''; ui.stock = '';
          el.searchInput.value = '';
          el.searchClear.hidden = true;
          renderBooks();
        } else if (act === 'exportCsv') {
          download('图书库存-' + todayName() + '.csv', S.exportCSV(), 'text/csv');
          toast('已导出 CSV');
        } else if (act === 'exportJson') {
          download('图书库存备份-' + todayName() + '.json', S.exportJSON(), 'application/json');
          toast('已导出完整备份');
        } else if (act === 'importCsv') {
          el.fileCsv.value = '';
          el.fileCsv.click();
        } else if (act === 'importJson') {
          el.fileJson.value = '';
          el.fileJson.click();
        } else if (act === 'seed') {
          confirmModal('载入示例数据', '会添加 8 本示例图书，方便先试用。确定吗？', '载入', function () {
            S.seedDemo();
            afterChange();
            toast('已载入示例数据');
            setView('books');
          });
        } else if (act === 'wipe') {
          confirmModal('清空本机数据', '将删除本机保存的全部图书和流水（云端数据不受影响）。<b>此操作无法撤销</b>，建议先导出备份。', '确认清空', function () {
            S.clearAll();
            S.saveSession(null);
            afterChange();
            toast('本机数据已清空');
          });
        }
        return;
      }

      // chips
      var catChip = e.target.closest('[data-cat]');
      if (catChip) { ui.category = catChip.getAttribute('data-cat'); renderBooks(); return; }

      var logChip = e.target.closest('[data-log]');
      if (logChip) { ui.logType = logChip.getAttribute('data-log'); renderLogs(); return; }
    });

    // 搜索
    el.searchInput.addEventListener('input', function () {
      ui.q = el.searchInput.value.trim();
      el.searchClear.hidden = !ui.q;
      renderBooks();
    });
    el.searchClear.addEventListener('click', function () {
      el.searchInput.value = '';
      ui.q = '';
      el.searchClear.hidden = true;
      renderBooks();
      el.searchInput.focus();
    });
    el.sortSelect.addEventListener('change', function () {
      ui.sort = el.sortSelect.value;
      renderBooks();
    });

    el.btnAdd.addEventListener('click', function () { openBookForm(null); });
    el.btnSync.addEventListener('click', function () { doSync(false); });
    el.btnExportLogs.addEventListener('click', function () {
      var list = S.logs();
      if (ui.logType) { list = list.filter(function (l) { return l.type === ui.logType; }); }
      download('出入库流水-' + todayName() + '.csv', S.exportLogsCSV(list), 'text/csv');
      toast('已导出流水');
    });

    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal) { closeModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.modal.hidden) { closeModal(); }
    });

    el.fileCsv.addEventListener('change', function () {
      if (el.fileCsv.files && el.fileCsv.files[0]) { doImportCsv(el.fileCsv.files[0]); }
    });
    el.fileJson.addEventListener('change', function () {
      if (el.fileJson.files && el.fileJson.files[0]) { doImportJson(el.fileJson.files[0]); }
    });

    // 设置
    $('saveOperator').addEventListener('click', function () {
      var name = el.operatorInput.value.trim();
      S.saveSettings({ operator: name });
      toast(name ? '操作员已设为 ' + name : '已清除操作员');
    });

    if ($('btnCopyShop')) {
      $('btnCopyShop').addEventListener('click', function () {
        copyText(shopUrl()).then(function () { toast('顾客页链接已复制'); })
          .catch(function () { toast('复制失败，请手动选中链接', { type: 'err' }); });
      });
      $('btnOpenShop').addEventListener('click', function () { window.open(shopUrl(), '_blank'); });
      $('btnExportCatalog').addEventListener('click', function () {
        var rows = S.books().map(function (b) {
          return {
            id: b.id, title: b.title, author: b.author, isbn: b.isbn, category: b.category,
            publisher: b.publisher, price: b.price, qty: b.qty,
            unit: b.unit, cover: b.cover, back: b.back, updated_at: b.updatedAt
          };
        });
        download('catalog.json', JSON.stringify(rows, null, 2), 'application/json');
        toast('已导出 catalog.json：上传到站点根目录，顾客页就会显示这份快照');
      });
    }

    function readCloudForm() {
      S.saveCloudConfig({
        url: el.cloudUrl.value.trim(),
        key: el.cloudKey.value.trim()
      });
    }

    $('btnTest').addEventListener('click', function () {
      readCloudForm();
      if (!C.isConfigured()) { toast('请先填写项目地址和 anon key', { type: 'err' }); return; }
      toast('正在测试连接…');
      C.testConnection().then(function (r) {
        toast(r.message);
        updateCloudStatus();
      }).catch(function (e) {
        toast(e.message, { type: 'err' });
      });
    });

    $('btnLogin').addEventListener('click', function () {
      readCloudForm();
      var email = el.authEmail.value.trim();
      var pwd = el.authPwd.value;
      if (!C.isConfigured()) { toast('请先填写项目地址和 anon key', { type: 'err' }); return; }
      if (!email || !pwd) { toast('请填写登录邮箱和密码', { type: 'err' }); return; }
      var btn = $('btnLogin');
      btn.disabled = true;
      btn.textContent = '登录中…';
      C.signIn(email, pwd).then(function () {
        el.authPwd.value = '';
        S.saveCloudConfig({ email: email });
        updateCloudStatus();
        toast('登录成功，开始同步…');
        return doSync(false);
      }).catch(function (e) {
        toast(e.message || '登录失败', { type: 'err' });
      }).then(function () {
        btn.disabled = false;
        btn.textContent = '登录并同步';
      });
    });

    $('btnSignup').addEventListener('click', function () {
      readCloudForm();
      var email = el.authEmail.value.trim();
      var pwd = el.authPwd.value;
      if (!email || pwd.length < 6) { toast('请填写邮箱，密码至少 6 位', { type: 'err' }); return; }
      C.signUp(email, pwd).then(function (data) {
        if (data && data.access_token) {
          toast('注册成功，已自动登录');
          return doSync(false);
        }
        toast('注册成功，请到邮箱点确认链接后再登录；或在 Supabase 后台关闭邮箱确认');
      }).catch(function (e) {
        toast(e.message || '注册失败', { type: 'err' });
      });
    });

    $('btnLogout').addEventListener('click', function () {
      C.signOut().then(function () {
        updateCloudStatus();
        toast('已退出登录');
      });
    });

    // 网络状态
    window.addEventListener('online', function () { renderSyncState(); updateCloudStatus(); scheduleSync(); });
    window.addEventListener('offline', function () { renderSyncState(); updateCloudStatus(); });
  }

  /* ================= 渲染主入口 ================= */

  var renderPending = false;
  var renderTimer = 0;
  var renderRaf = 0;

  function render() {
    if (renderPending) { return; }
    renderPending = true;
    var run = function () {
      renderPending = false;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }
      if (renderRaf && window.cancelAnimationFrame) { window.cancelAnimationFrame(renderRaf); renderRaf = 0; }
      renderSyncState();
      renderOverview();
      renderBooks();
      renderLogs();
      updateCloudStatus();
    };
    // 正常情况下跟随浏览器绘制节奏；页面长时间不绘制时也能在 16ms 内完成渲染
    renderTimer = window.setTimeout(run, 16);
    if (window.requestAnimationFrame) { renderRaf = window.requestAnimationFrame(run); }
  }

  /* ================= 启动 ================= */

  function init() {
    el = {
      tabbar: $('tabbar'),
      modal: $('modal'),
      toastWrap: $('toastWrap'),
      syncDot: $('syncDot'),
      syncText: $('syncText'),
      btnSync: $('btnSync'),
      btnAdd: $('btnAdd'),
      heroQty: $('heroQty'),
      heroValue: $('heroValue'),
      heroTitles: $('heroTitles'),
      heroWarn: $('heroWarn'),
      kpiRow: $('kpiRow'),
      catBars: $('catBars'),
      warnList: $('warnList'),
      recentLogs: $('recentLogs'),
      stockChips: $('stockChips'),
      catChips: $('catChips'),
      bookList: $('bookList'),
      bookEmpty: $('bookEmpty'),
      bookCount: $('bookCount'),
      searchInput: $('searchInput'),
      searchClear: $('searchClear'),
      sortSelect: $('sortSelect'),
      logChips: $('logChips'),
      logList: $('logList'),
      logEmpty: $('logEmpty'),
      btnExportLogs: $('btnExportLogs'),
      cloudBadge: $('cloudBadge'),
      cloudStatus: $('cloudStatus'),
      cloudUrl: $('cloudUrl'),
      cloudKey: $('cloudKey'),
      authEmail: $('authEmail'),
      authPwd: $('authPwd'),
      operatorInput: $('operatorInput'),
      shopLink: $('shopLink'),
      fileCsv: $('fileCsv'),
      fileJson: $('fileJson')
    };

    el.sortSelect.value = ui.sort;
    bind();
    S.subscribe(function () { render(); });

    var hashView = (location.hash || '').replace('#', '');
    if (['overview', 'books', 'logs', 'settings'].indexOf(hashView) >= 0) { setView(hashView); }
    window.addEventListener('hashchange', function () {
      var v = (location.hash || '').replace('#', '');
      if (v && v !== ui.view && ['overview', 'books', 'logs', 'settings'].indexOf(v) >= 0) { setView(v); }
    });

    render();
    fillSettings();

    // 本机还没填过云端配置时，自动读取部署在站点里的 config.json（省得手打地址和密钥）
    if (!S.cloudConfig().url) {
      fetch('config.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (c) {
          if (c && c.supabaseUrl && c.supabaseKey && !S.cloudConfig().url) {
            el.cloudUrl.value = c.supabaseUrl;
            el.cloudKey.value = c.supabaseKey;
          }
        })
        .catch(function () { /* file:// 或未配置时忽略 */ });
    }

    var note = $('buildNote');
    if (note) { note.textContent = '版本 1.0 · ' + (navigator.onLine ? '在线' : '离线'); }

    if (S.storageMode() === 'memory') {
      toast('当前浏览器禁用了本地存储，刷新后数据会丢失。请用 https 地址打开，或换一个浏览器。', { type: 'err', duration: 9000 });
    }

    // 关闭/切走页面前立刻落盘，避免防抖窗口内丢改动
    window.addEventListener('pagehide', function () { try { S.saveNow(); } catch (e) { /* ignore */ } });
    window.addEventListener('beforeunload', function () { try { S.saveNow(); } catch (e) { /* ignore */ } });

    // 定时静默同步（页面可见时）
    setInterval(function () {
      if (document.visibilityState !== 'visible') { return; }
      if (!C.isConfigured() || !S.session()) { return; }
      doSync(true);
    }, 45000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        renderSyncState();
        scheduleSync();
      }
    });

    // PWA
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略：本地预览或旧浏览器 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
