/* ===========================================================================
 * app.js —— 渲染课表、翻周、切主题、按真实时间高亮
 *
 * 依赖：data.js（数据）、course-core.js（纯逻辑）
 *
 * 设计取舍：
 *   · 格子位置用百分比（--top / --h），换字号、换时间轴高度都不会错位；
 *   · 同一门课永远同一个颜色（按 data.js 里的 COLOR_BY_CODE）；
 *   · 没有倒计时（用户明确不要），只有"正在上"高亮 + 进度条 + 现在这条线；
 *   · 外观（配色/字体/字号/是否显示周末）存在 localStorage，存不下会弹顶部警告。
 * ===========================================================================
 */
(function () {
  'use strict';

  var D = window.ScheduleData;
  var C = window.CourseCore;
  var META = D.META;

  /* ============================ 4 套配色 · 每套 10 个课程色 ============================ */

  /* [背景色, 边框色, 文字色]，浅底配深字、深底配浅字，保证对比度 */
  var PALETTES = {
    paper: {
      ink: '#33261e',
      colors: [
        ['#f6ddd2', '#cf9078', '#5a2a1c'], ['#e4ecf7', '#8fa9c9', '#1e3a5f'],
        ['#e6f0dd', '#96b184', '#2c4623'], ['#faecd0', '#d0ab68', '#5c3f13'],
        ['#e8e2f6', '#a99bd0', '#3c2f63'], ['#fbe4e9', '#d19aab', '#5f2537'],
        ['#ddeef2', '#84b3bf', '#1b3f49'], ['#f6e3f8', '#c295c9', '#4d2153'],
        ['#ece9e2', '#b0a893', '#403a2e'], ['#fcecd9', '#d5ac7c', '#5a3616']
      ]
    },
    midnight: {
      ink: '#eef2ff',
      colors: [
        ['#26314c', '#4a6396', '#e3ecff'], ['#233a34', '#4f8377', '#dcf5ec'],
        ['#3b2a31', '#8c5a6b', '#ffe4ea'], ['#2d2b47', '#6862a8', '#e9e7ff'],
        ['#24384a', '#4a7ba6', '#dff0ff'], ['#2f3524', '#6d8a4a', '#eefad9'],
        ['#3a2c46', '#7f5ba6', '#f4e6ff'], ['#3d3122', '#a07f45', '#ffeed2'],
        ['#1f333a', '#3f7c8a', '#d9f6ff'], ['#3a2634', '#96607e', '#ffe3f2']
      ]
    },
    nord: {
      ink: '#183040',
      colors: [
        ['#dbe8f2', '#7fa3bd', '#173347'], ['#ddeadf', '#82a886', '#1c3a22'],
        ['#f3e5dc', '#c29b83', '#4a2716'], ['#e2e2f2', '#9295c4', '#232a5c'],
        ['#f6e3e3', '#c58b8b', '#4c1f1f'], ['#e0efee', '#79b0ad', '#153c3a'],
        ['#f2ecd6', '#bda76a', '#403714'], ['#efe3ee', '#b494b3', '#452a44'],
        ['#e4ebee', '#9aacb5', '#2a3d46'], ['#f7e7dc', '#cfa184', '#4a2c17']
      ]
    },
    vivid: {
      ink: '#0b1220',
      colors: [
        ['#dbe4ff', '#7b93ff', '#1f2a63'], ['#d5f5e3', '#4fbf85', '#0d4527'],
        ['#ffe0e3', '#ff7d8c', '#66141f'], ['#fff2cf', '#f0b429', '#573a00'],
        ['#e6e0ff', '#8b7cf6', '#2b2166'], ['#d9f3f8', '#35b6d3', '#0a3a48'],
        ['#ffe3f3', '#f472b6', '#661039'], ['#e2f7d9', '#7cc84a', '#21460f'],
        ['#ffe8d6', '#fb923c', '#5c2a05'], ['#e2e8f0', '#94a3b8', '#1e293b']
      ]
    }
  };

  var THEMES = [
    { key: 'paper', name: '纸感', dot: '#f6ddd2', metaColor: '#f3ece1' },
    { key: 'midnight', name: '午夜', dot: '#26314c', metaColor: '#101320' },
    { key: 'nord', name: '北欧', dot: '#dbe8f2', metaColor: '#eef2f6' },
    { key: 'vivid', name: '活力', dot: '#dbe4ff', metaColor: '#f5f7fc' }
  ];

  var FONTS = [
    { key: 'system', name: '系统' },
    { key: 'hei', name: '黑体' },
    { key: 'serif', name: '宋体' }
  ];

  var DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

  var RANGE = C.timelineRange(D.PERIODS);

  /* ================================== 状态 ================================== */

  var LS_KEY = 'classSchedule.v1';

  var state = {
    theme: 'vivid',
    font: 'system',
    fs: 100,            // 字号百分比
    view: 'list',       // 'list' 明细列表（手机默认） / 'grid' 整周时间轴
    weekend: false,
    viewWeek: null,     // 用户正在看第几周；null = 跟着今天走
    nowOverride: null,  // 调试用：把"现在"钉死在某个时刻
    storageOk: true,
    storageMsg: ''
  };

  /** 两种视图：列表看得全，格子看得广 */
  var VIEWS = [
    { key: 'list', name: '列表', note: '一门课一行，信息写得全' },
    { key: 'grid', name: '格子', note: '整周时间轴，一眼看哪天满' }
  ];

  /** 存不进 localStorage 会返回 false（iOS 的"无痕浏览"就是这种情况），绝不静默 */
  function saveSettings() {
    var payload = JSON.stringify({
      theme: state.theme, font: state.font, fs: state.fs, view: state.view, weekend: state.weekend
    });
    try {
      window.localStorage.setItem(LS_KEY, payload);
      var back = window.localStorage.getItem(LS_KEY);
      if (back !== payload) throw new Error('写进去读回来不一样');
      return true;
    } catch (e) {
      state.storageOk = false;
      state.storageMsg = '这台设备存不住设置（' + (e && e.message ? e.message : 'unknown') +
        '）。页面能正常用，但换主题/字号后关掉就忘了 —— iPhone 上请用网址打开，别用"无痕浏览"。';
      return false;
    }
  }

  function loadSettings() {
    var raw = null;
    try { raw = window.localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return; }
    if (!o || typeof o !== 'object') return;
    if (o.theme && PALETTES[o.theme]) state.theme = o.theme;
    if (o.font && FONTS.some(function (f) { return f.key === o.font; })) state.font = o.font;
    if (typeof o.fs === 'number' && o.fs >= 85 && o.fs <= 140) state.fs = o.fs;
    if (VIEWS.some(function (v) { return v.key === o.view; })) state.view = o.view;
    if (typeof o.weekend === 'boolean') state.weekend = o.weekend;
  }

  /* ============================ 备份 / 恢复设置 ============================
     这个 App 的用户数据就只有"外观设置"这几项（课表本身是写死在 data.js 里的）。
     所以备份的就是这几项 —— 换手机、清过 Safari 数据之后能弄回来。
     备份包里另外塞了课表指纹（学期 + 学生 + 第 1 周），恢复时能提醒"这份备份是不是
     别的学期的"，免得把不相干的设置糊上来。
  ========================================================================= */

  var BK_KIND = 'class-schedule-settings';
  var BK_VERSION = 1;

  /** 当前设置的快照 —— 只挑会持久化的那几项 */
  function settingsSnapshot() {
    return {
      theme: state.theme, font: state.font, fs: state.fs,
      view: state.view, weekend: state.weekend
    };
  }

  function courseFingerprint() {
    /* 只留"是哪个学期"，不带姓名学号 —— 页面是公开的。 */
    return {
      termLabel: D.META.termLabel || '',
      firstMonday: D.META.firstMonday || '',
      totalWeeks: D.META.totalWeeks || 0
    };
  }

  function makeBackup() {
    return {
      kind: BK_KIND,
      version: BK_VERSION,
      exportedAt: new Date().toISOString(),
      app: D.META.appName || '我的课表',
      course: courseFingerprint(),
      settings: settingsSnapshot()
    };
  }

  function bkSay(msg, bad) {
    if (!el.bkMsg) return;
    el.bkMsg.hidden = false;
    el.bkMsg.textContent = msg;
    el.bkMsg.className = 'bk-msg' + (bad ? ' is-bad' : ' is-good');
  }

  function bkClear() {
    if (!el.bkMsg) return;
    el.bkMsg.hidden = true;
    el.bkMsg.textContent = '';
  }

  /** 把一段文本解析成设置对象；任何不对的地方都返回人能看懂的原因 */
  function parseBackup(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, error: '还没有内容 —— 先选一个备份文件，或者把备份内容粘贴进来。' };
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, error: '这段内容不是合法的 JSON，看看是不是复制漏了。' }; }
    if (!obj || typeof obj !== 'object') return { ok: false, error: '备份内容的格式不对。' };
    if (obj.kind !== BK_KIND) {
      return { ok: false, error: '这看起来不是「我的课表」的设置备份。' };
    }
    var s = obj.settings;
    if (!s || typeof s !== 'object') return { ok: false, error: '备份里没有设置内容。' };
    /* 逐项校验：坏的那项丢掉，好的那项留下 —— 手改坏的备份也不该把页面搞崩 */
    var out = {};
    var dropped = [];
    if (s.theme && PALETTES[s.theme]) out.theme = s.theme; else if (s.theme !== undefined) dropped.push('配色');
    if (s.font && FONTS.some(function (f) { return f.key === s.font; })) out.font = s.font; else if (s.font !== undefined) dropped.push('字体');
    if (typeof s.fs === 'number' && s.fs >= 85 && s.fs <= 140) out.fs = s.fs; else if (s.fs !== undefined) dropped.push('字号');
    if (VIEWS.some(function (v) { return v.key === s.view; })) out.view = s.view; else if (s.view !== undefined) dropped.push('默认视图');
    if (typeof s.weekend === 'boolean') out.weekend = s.weekend; else if (s.weekend !== undefined) dropped.push('周末开关');
    if (!Object.keys(out).length) return { ok: false, error: '备份里的设置一项都不认识，没动你的东西。' };

    var note = '';
    var fp = obj.course;
    if (fp && typeof fp === 'object' && fp.firstMonday && fp.firstMonday !== D.META.firstMonday) {
      note = '注意：这份备份来自另一个学期，设置已经合进来了。';
    }
    return {
      ok: true, settings: out, dropped: dropped, note: note,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : ''
    };
  }

  /** 把解析出来的设置应用到界面上 */
  function applySettings(s) {
    if (s.theme) state.theme = s.theme;
    if (s.font) state.font = s.font;
    if (typeof s.fs === 'number') state.fs = s.fs;
    if (s.view) state.view = s.view;
    if (typeof s.weekend === 'boolean') state.weekend = s.weekend;
    applyTheme();
    paintViewToggle();
    paintChips();
    render();
  }

  function bkExport() {
    var text = JSON.stringify(makeBackup(), null, 2) + '\n';
    if (el.bkText) el.bkText.value = text;
    var ok = true;
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var d = nowDate();
      a.download = '我的课表-设置备份-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      ok = false;
    }
    bkSay(ok
      ? '备份文件开始下载了，找个地方收好；内容也留在下面的框里，可以直接复制走。'
      : '这台设备不让下载文件，那就用「复制到剪贴板」把内容存到备忘录里。', !ok);
  }

  function bkCopy() {
    var text = JSON.stringify(makeBackup(), null, 2) + '\n';
    if (el.bkText) el.bkText.value = text;
    function fallback() {
      if (el.bkText) { el.bkText.focus(); el.bkText.select(); }
      bkSay('不能自动复制，内容已经填在下面的框里了 —— 长按选中复制一下。', false);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        bkSay('备份内容已复制，粘到备忘录或者"文件传输助手"里存着。', false);
      }, fallback);
    } else {
      fallback();
    }
  }

  function bkRestore(mode) {
    var parsed = parseBackup(el.bkText ? el.bkText.value : '');
    if (!parsed.ok) { bkSay(parsed.error, true); return; }
    if (mode === 'replace' &&
        !window.confirm('完全替换？\n\n现在的外观设置会被备份里的内容整个盖掉。\n（课表本身不受影响，随时能改回来）')) {
      return;
    }
    applySettings(parsed.settings);
    saveSettings();
    var names = Object.keys(parsed.settings).map(function (k) {
      return ({ theme: '配色', font: '字体', fs: '字号', view: '默认视图', weekend: '周末开关' })[k] || k;
    });
    var msg = (mode === 'replace' ? '已用备份替换：' : '已合并：') + names.join(' / ') + '。';
    if (parsed.dropped && parsed.dropped.length) msg += ' 备份里这几项不认识，丢掉了：' + parsed.dropped.join('、') + '。';
    if (parsed.note) msg += ' ' + parsed.note;
    bkSay(msg, false);
  }

  function bkReadFile(file) {
    if (!file) return;
    if (file.size > 256 * 1024) { bkSay('这个文件太大了，设置的备份应该只有几百字节。', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      if (el.bkText) el.bkText.value = String(reader.result || '');
      var parsed = parseBackup(el.bkText ? el.bkText.value : '');
      if (!parsed.ok) { bkSay('文件读出来了，但' + parsed.error, true); return; }
      bkSay('文件读出来了，点「合并恢复」或「完全替换」应用它。', false);
    };
    reader.onerror = function () {
      bkSay('这个文件读不出来。换个办法：把备份内容粘贴到下面的框里。', true);
    };
    reader.readAsText(file);
  }

  /** 现在几点（调试时可能被钉死） */
  function nowDate() {
    return state.nowOverride ? new Date(state.nowOverride.getTime()) : new Date();
  }

  /* ================================ DOM 引用 ================================ */

  var el = {};
  ['storageWarn', 'hdSub', 'btnTheme', 'ticker', 'tkDot', 'tkText', 'tkProg', 'tkProgBar',
   'wkPrev', 'wkNext', 'wkLabel', 'wkRange', 'wkBack', 'vtList', 'vtGrid',
   'list', 'board', 'boardInner', 'dayHead', 'rail', 'grid', 'nowLine',
   'hint', 'sheetMask', 'sheet', 'themeChips', 'fontChips', 'fsVal', 'fsMinus', 'fsPlus',
   'fsRange', 'swWeekend', 'viewChips', 'keyRow', 'sheetDone',
   'bkExport', 'bkCopy', 'bkPick', 'bkMerge', 'bkReplace', 'bkFile', 'bkMsg', 'bkText',
   'detailMask', 'detail'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /* ============================== 主题 / 字体 ============================== */

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.setAttribute('data-font', state.font);
    document.documentElement.style.setProperty('--fs', String(state.fs / 100));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var t = THEMES.filter(function (x) { return x.key === state.theme; })[0];
      meta.setAttribute('content', t ? t.metaColor : '#ffffff');
    }
    /* 换了字体，导航条得重新量一遍 —— 宋体/黑体比系统字体宽一大截，
       不重量的话"第 3 周 · 本周"会被悄悄裁掉（真机截图抓到过）。 */
    fitWeekDate();
  }

  function paintChips() {
    el.themeChips.innerHTML = '';
    THEMES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.theme === t.key ? ' is-on' : '');
      b.dataset.theme = t.key;
      b.innerHTML = '<i class="swatch" style="background:' + t.dot + '"></i>' + t.name;
      b.addEventListener('click', function () {
        state.theme = t.key;
        applyTheme(); paintChips(); saveSettings(); showStorageWarn();
      });
      el.themeChips.appendChild(b);
    });

    el.fontChips.innerHTML = '';
    FONTS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.font === f.key ? ' is-on' : '');
      b.dataset.font = f.key;
      b.textContent = f.name;
      b.style.fontFamily = f.key === 'serif'
        ? '"Songti SC","SimSun",serif'
        : (f.key === 'hei' ? '"PingFang SC","Microsoft YaHei",sans-serif' : '');
      b.addEventListener('click', function () {
        state.font = f.key;
        applyTheme(); paintChips(); saveSettings();
      });
      el.fontChips.appendChild(b);
    });

    el.fsVal.textContent = state.fs + '%';
    el.fsRange.value = String(state.fs);
    el.swWeekend.checked = state.weekend;

    el.viewChips.innerHTML = '';
    VIEWS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.view === v.key ? ' is-on' : '');
      b.dataset.view = v.key;
      b.textContent = v.name;
      b.addEventListener('click', function () { setView(v.key); });
      el.viewChips.appendChild(b);
    });

    paintViewToggle();

    el.keyRow.innerHTML = '';
    Object.keys(D.COLOR_BY_CODE).forEach(function (code) {
      var course = D.COURSES.filter(function (c) { return c.code === code; })[0];
      if (!course) return;
      var c = blockColors(code);
      var item = document.createElement('span');
      item.className = 'key-item';
      item.innerHTML = '<i style="background:' + c.bg + ';border:1px solid ' + c.line + '"></i>' + course.name;
      el.keyRow.appendChild(item);
    });
  }

  function showStorageWarn() {
    if (state.storageOk) { el.storageWarn.hidden = true; el.storageWarn.textContent = ''; return; }
    el.storageWarn.textContent = state.storageMsg;
    el.storageWarn.hidden = false;
  }

  function blockColors(code) {
    var idx = (D.colorOf(code) - 1) % 10;
    if (idx < 0) idx += 10;
    var pal = PALETTES[state.theme] || PALETTES.paper;
    var c = pal.colors[idx] || pal.colors[0];
    return { bg: c[0], line: c[1], ink: c[2] };
  }

  /* ================================ 渲染课表 ================================ */

  function activeDays() {
    return state.weekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
  }

  /** 当前该显示第几周：用户翻了就听用户的，否则听今天的 */
  function displayWeek() {
    if (state.viewWeek != null) return state.viewWeek;
    var w = C.weekOf(META, nowDate()).week;
    return Math.min(Math.max(w, META.minWeek), META.maxWeek);
  }

  function isViewingNow() {
    return displayWeek() === C.weekOf(META, nowDate()).week;
  }

  function render() {
    var week = displayWeek();
    var today = C.weekOf(META, nowDate());
    var days = activeDays();
    var grid = C.weekGrid(META, D.COURSES, week, days);
    var weekendOn = days.length > 5;

    el.boardInner.classList.toggle('show-weekend', weekendOn);
    el.boardInner.style.setProperty('--dayCount', String(days.length));
    paintViewToggle();

    /* ---- 视图一：明细列表（手机上看得全的那个） ---- */
    renderList(week, today, days);

    /* ---- 星期表头 ---- */
    var mon = C.mondayOfWeek(META, week);
    el.dayHead.innerHTML = '';
    days.forEach(function (wd) {
      var d = C.addDays(mon, wd - 1);
      var isToday = isViewingNow() && today.weekday === wd && today.status !== 'outside';
      var div = document.createElement('div');
      div.className = 'dh' + (isToday ? ' is-today' : '') + (wd >= 6 ? ' is-weekend' : '');
      div.dataset.weekday = String(wd);
      div.innerHTML = '<b>' + (isToday ? '今天' : DAY_NAMES[wd].replace('周', '')) + '</b>' +
        '<small>' + C.fmtMd(d) + '</small>';
      el.dayHead.appendChild(div);
    });

    /* ---- 时间轴：整点刻度 + 半小时虚线 ---- */
    el.rail.innerHTML = '';
    for (var m = RANGE.from; m <= RANGE.to; m += 60) {
      var t = document.createElement('span');
      t.className = 'rt';
      t.style.top = C.pct(m, RANGE) + '%';
      t.textContent = pad(Math.floor(m / 60)) + ':' + pad(m % 60);
      el.rail.appendChild(t);
    }
    /* ---- 网格列 + 每小时的虚线 ---- */
    el.grid.innerHTML = '';
    days.forEach(function (wd) {
      var col = document.createElement('div');
      col.className = 'gcol' + (wd >= 6 ? ' is-weekend' : '');
      col.dataset.weekday = String(wd);
      for (var mm = RANGE.from + 60; mm <= RANGE.to - 5; mm += 60) {
        var ln = document.createElement('div');
        ln.className = 'gline';
        ln.style.top = C.pct(mm, RANGE) + '%';
        col.appendChild(ln);
      }
      (grid[wd] || []).forEach(function (course) {
        if (course.weekFrom == null && !D.SHOW_PENDING) return;
        if (D.PENDING.some(function (p) { return p.code === course.code; }) && !D.SHOW_PENDING) return;
        var item = layoutItem(course, grid[wd]);
        col.appendChild(buildBlock(course, item, week));
      });
      el.grid.appendChild(col);
    });

    /* ---- 这一周没课 ---- */
    if (C.countInWeek(META, D.COURSES, week, days) === 0) {
      var tip = document.createElement('div');
      tip.className = 'empty';
      var msg = '第 ' + week + ' 周没有课';
      if (week < 1) msg = '第 ' + week + ' 周是开学前（军训周），还没有正式课程';
      else if (week > META.totalWeeks) msg = '第 ' + week + ' 周已经放假啦（学期共 ' + META.totalWeeks + ' 周）';
      else {
        var nw = C.nextWeekWithClass(META, D.COURSES, week, days);
        if (nw != null && nw !== week) msg += '，最近有课的是第 ' + nw + ' 周';
      }
      tip.textContent = msg;
      el.grid.appendChild(tip);
    }

    renderNowLine();
    renderTicker();
    renderNav();
    renderHint(week);
  }

  /* ======================== 视图一：明细列表 ========================
   * 用户要的信息一条不落：课名 / 第几周上 / 第几节 / 几点到几点 / 在哪。
   * 格子视图在 390px 宽下每列只有 70px，课名和地点必然被截，所以手机默认看这个。
   */

  /** 这门课在当前显示的这周上不上（时间待定的课一律不显示，用户要求） */
  function shownCourses(week, days) {
    var out = [];
    D.COURSES.forEach(function (c) {
      if (c.weekFrom == null || c.weekTo == null) return;
      if (D.PENDING.some(function (p) { return p.code === c.code; })) return;
      if (!C.activeInWeek(c, week)) return;
      if (days.indexOf(c.weekday) < 0) return;
      out.push(c);
    });
    return out;
  }

  function renderList(week, today, days) {
    var box = el.list;
    box.innerHTML = '';

    var all = shownCourses(week, days);
    if (!all.length) {
      var tip = document.createElement('div');
      tip.className = 'empty';
      var msg = '第 ' + week + ' 周没有课';
      if (week < 1) msg = '第 ' + week + ' 周是开学前（军训周），还没有正式课程';
      else if (week > META.totalWeeks) msg = '第 ' + week + ' 周已经放假啦（学期共 ' + META.totalWeeks + ' 周）';
      else {
        var nw = C.nextWeekWithClass(META, D.COURSES, week, days);
        if (nw != null && nw !== week) msg += '，最近有课的是第 ' + nw + ' 周';
      }
      tip.textContent = msg;
      box.appendChild(tip);
      return;
    }

    /* status 是 nowStatus，带 weekday（weekOf 只给周次，没有 weekday —— 别拿错对象） */
    var status = C.nowStatus(META, D.PERIODS, D.COURSES, nowDate());
    var viewingNow = isViewingNow();
    var mon = C.mondayOfWeek(META, week);

    days.forEach(function (wd) {
      var list = all.filter(function (c) { return c.weekday === wd; });
      list.sort(function (a, b) { return a.firstPeriod - b.firstPeriod; });

      var d = C.addDays(mon, wd - 1);
      var isToday = viewingNow && status.weekday === wd && status.status === 'in';

      /* 没课的那天照画表头（开着周末才能看见周六周日这两天确实是空的）；
         如果是"今天"，还要写一句话 —— 不然周六打开页面一片空白，看不出是没课还是坏了。 */
      var head = document.createElement('div');
      head.className = 'lp-day' + (isToday ? ' is-today' : '');
      head.innerHTML = '<span>' + DAY_NAMES[wd] + '</span>' +
        '<span class="lp-date">' + C.fmtMd(d) + ' · ' + (list.length ? list.length + ' 节' : '没课') + '</span>' +
        (isToday ? '<span class="lp-tag">今天</span>' : '');
      box.appendChild(head);

      if (!list.length) {
        if (!isToday) return;
        var rest = document.createElement('div');
        rest.className = 'lp-free';
        rest.textContent = '今天一节课都没有，好好休息 ☕';
        box.appendChild(rest);
        return;
      }

      list.forEach(function (c) {
        box.appendChild(buildRow(c, status));
      });
    });
  }

  function buildRow(course, status) {
    var sp = C.spanOf(D.PERIODS, course);
    var pal = blockColors(course.code);
    var live = status && status.status === 'in' && status.weekday === course.weekday &&
      status.current && status.current.code === course.code;

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lp' + (live ? ' is-now' : '');
    /* 用主题自己的课程底色 + 配套的深色/浅色字（比纯白卡片更贴主题，午夜主题下也不会看不见） */
    b.style.setProperty('--blk-bg', pal.bg);
    b.style.setProperty('--blk-ink', pal.ink);
    b.style.setProperty('--blk-edge', pal.line);
    b.setAttribute('role', 'listitem');

    var from = pad(Math.floor(sp.from / 60)) + ':' + pad(sp.from % 60);
    var to = pad(Math.floor(sp.to / 60)) + ':' + pad(sp.to % 60);
    var sub = '<div class="lp-sub">' +
      '<span class="lp-room">' + esc(course.room) + '</span>' +
      (course.teacher ? '<span class="lp-teach">' + esc(course.teacher) + '</span>' : '') +
      '</div>';

    b.innerHTML =
      '<span class="lp-when">' +
        '<span class="lp-sec">' + C.periodText(course) + '</span>' +
        '<span class="lp-hm">' + from + '</span>' +
        '<span class="lp-hm">' + to + '</span>' +
      '</span>' +
      '<span class="lp-main">' +
        '<span class="lp-name">' + esc(course.name) + '</span>' +
        sub +
      '</span>' +
      (live ? '<span class="lp-live">正在上</span>' : '');

    b.addEventListener('click', function () { openDetail(course, sp); });
    return b;
  }

  /** 用 core 的 layoutDay 找到这门课在重叠组里的列号 */
  function layoutItem(course, dayCourses) {
    var laid = C.layoutDay(D.PERIODS, dayCourses);
    for (var i = 0; i < laid.length; i++) if (laid[i].course === course) return laid[i];
    var sp = C.spanOf(D.PERIODS, course);
    return { course: course, startMin: sp.from, endMin: sp.to, col: 0, cols: 1 };
  }

  function buildBlock(course, item, week) {
    var sp = C.spanOf(D.PERIODS, course);
    var pal = blockColors(course.code);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'blk';
    var dur = sp.to - sp.from;
    if (dur <= 60) b.classList.add('is-tight');
    if (dur <= 35) b.classList.add('is-tiny');
    b.style.setProperty('--top', String(C.pct(sp.from, RANGE)));
    b.style.setProperty('--h', String((sp.to - sp.from) / RANGE.total * 100));
    b.style.setProperty('--col', String(item.col));
    b.style.setProperty('--cols', String(item.cols));
    b.style.setProperty('--blk-bg', pal.bg);
    b.style.setProperty('--blk-line', pal.line);
    b.style.setProperty('--blk-edge', pal.line);
    b.style.setProperty('--blk-ink', pal.ink);
    b.dataset.code = course.code;
    b.dataset.week = String(week);

    var name = document.createElement('span');
    name.className = 'blk-name';
    name.textContent = course.short || course.name;
    b.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'blk-meta';
    meta.textContent = C.periodText(course) + ' · ' + sp.text;
    b.appendChild(meta);

    var room = document.createElement('span');
    room.className = 'blk-room';
    room.textContent = course.room + (course.teacher ? ' · ' + course.teacher : '');
    b.appendChild(room);

    /* 正在上 / 已上完 的状态 */
    var ns = C.nowStatus(META, D.PERIODS, D.COURSES, nowDate());
    if (week === ns.week && course.weekday === ns.weekday) {
      if (ns.current === course) {
        b.classList.add('is-now');
        var badge = document.createElement('span');
        badge.className = 'blk-badge';
        badge.textContent = '正在上';
        b.appendChild(badge);
      } else if (sp.to <= ns.minutes) {
        b.classList.add('is-past');
      }
    }

    b.addEventListener('click', function () { openDetail(course, sp); });
    return b;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ============================== 现在这条线 ============================== */

  function renderNowLine() {
    var ns = C.nowStatus(META, D.PERIODS, D.COURSES, nowDate());
    if (!isViewingNow() || ns.status !== 'in' || ns.weekday > (state.weekend ? 7 : 5)) {
      el.nowLine.hidden = true;
      return;
    }
    el.nowLine.hidden = false;
    /* .board-inner 是 position:relative，它的内容盒从表头下面开始算，
       但绝对定位元素的百分比是相对【padding box】（含 46px 表头）的，
       所以这里要自己把表头那 46px 加回去。 */
    el.nowLine.style.top = 'calc(46px + ' + C.pct(ns.minutes, RANGE) + '%)';
    el.nowLine.querySelector('.nowline-tag').textContent =
      pad(Math.floor(ns.minutes / 60)) + ':' + pad(ns.minutes % 60);
  }

  /* =============================== 实时状态条 =============================== */

  function renderTicker() {
    var ns = C.nowStatus(META, D.PERIODS, D.COURSES, nowDate());
    var wkStatus = C.weekOf(META, nowDate());
    var text = '';
    el.ticker.classList.remove('is-live');
    el.tkProg.hidden = true;

    if (wkStatus.status === 'before') {
      var days = C.daysBetween(C.startOfDay(nowDate()), C.mondayOfWeek(META, 1));
      text = days > 0
        ? ('还没开学：距第 1 周还有 ' + days + ' 天（' + META.firstMonday + ' 起）')
        : '开学前的军训周，暂无课程安排';
    } else if (wkStatus.status === 'after') {
      text = '学期结束啦（共 ' + META.totalWeeks + ' 周）';
    } else if (ns.current) {
      el.ticker.classList.add('is-live');
      var left = spanEnd(ns.current) - ns.minutes;
      text = '正在上：' + ns.current.name + ' · ' + ns.current.room + ' · 还有 ' + left + ' 分钟下课';
      el.tkProg.hidden = false;
      el.tkProgBar.style.width = Math.round(ns.progress * 100) + '%';
    } else if (ns.next) {
      var mins = spanStart(ns.next) - ns.minutes;
      text = '下一节：' + ns.next.name + ' · ' + ns.next.room + ' · ' +
        (mins >= 60 ? (Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分钟后') : (mins + ' 分钟后')) +
        '开始（' + C.periodText(ns.next) + '）';
    } else if (ns.today.length) {
      text = '今天的课都上完了 ✓';
    } else {
      text = '今天（' + DAY_NAMES[ns.weekday] + '）没有课';
    }

    el.tkText.textContent = text;
  }

  function spanStart(course) { return C.spanOf(D.PERIODS, course).from; }
  function spanEnd(course) { return C.spanOf(D.PERIODS, course).to; }

  /* ================================ 周次导航 ================================ */

  function renderNav() {
    var week = displayWeek();
    var mon = C.mondayOfWeek(META, week);
    var sun = C.addDays(mon, 6);
    el.wkLabel.textContent = '第 ' + week + ' 周' + (isViewingNow() ? ' · 本周' : '');
    el.wkRange.textContent = C.fmtMd(mon) + ' – ' + C.fmtMd(sun);
    el.wkBack.hidden = isViewingNow();
    el.wkPrev.disabled = week <= META.minWeek;
    el.wkNext.disabled = week >= META.maxWeek;
    fitWeekDate();
  }

  function gotoWeek(w) {
    var clamped = Math.min(Math.max(w, META.minWeek), META.maxWeek);
    var cur = C.weekOf(META, nowDate()).week;
    state.viewWeek = (clamped === cur) ? null : clamped;
    render();
    scrollToSensible();
  }

  /**
   * 导航条够不够同时放"第 3 周 · 本周"和"10/5 – 10/11"？
   *
   * 为什么不用 CSS 媒体查询猜：黑体/宋体比系统字体宽一大截（同样 390px 下，
   * "第 3 周 · 本周"系统字体 98px、宋体 132px），猜不准。
   *
   * 为什么不用 scrollWidth > clientWidth 判"周次被裁"：那是**先破坏再测量** ——
   * .no-date 一去掉，日期回来把周次挤窄 3px，而 clientWidth 是取整的，
   * 于是 100 > 97 就被当成"裁了"，结果是自己把自己判成放不下。
   *
   * 改成量**需要多少**：拿一个隐藏的探针（同样的字号字体）量出周次多宽，
   * 加上间距和日期宽度，跟可用宽度比。纯读操作，不依赖当前是收着还是放着。
   * 另留一条 scrollWidth 兜底：剩下的空间不到 1px 时，CSS 真会把周次裁掉。
   */
  function textWidthOf(cssText, text) {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;' +
      'white-space:nowrap;pointer-events:none;' + cssText;
    probe.textContent = text;
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    return w;
  }

  function fitWeekDate() {
    var wk = el.wkLabel && el.wkLabel.closest ? el.wkLabel.closest('.wk') : null;
    var mid = el.wkLabel && el.wkLabel.closest ? el.wkLabel.closest('.wk-mid') : null;
    var range = el.wkRange;
    if (!wk || !mid || !el.wkLabel || !range) return;
    var cs = window.getComputedStyle(el.wkLabel);
    var midCS = window.getComputedStyle(mid);
    var nowCS = el.wkLabel.parentNode ? window.getComputedStyle(el.wkLabel.parentNode) : null;
    var need = textWidthOf('font-weight:' + cs.fontWeight + ';font-size:' + cs.fontSize +
      ';font-family:' + cs.fontFamily, el.wkLabel.textContent);
    if (range.offsetWidth > 0) {
      var rs = window.getComputedStyle(range);
      need += (parseFloat(rs.marginLeft) || 0) + (parseFloat(rs.marginRight) || 0) +
        (nowCS ? (parseFloat(nowCS.columnGap) || 0) : 0) +
        textWidthOf('font-size:' + rs.fontSize + ';font-family:' + rs.fontFamily, range.textContent);
    }
    /* 可用宽度按 content-box 算；留 6px 余量（缩放/取整都不骗人） */
    var avail = mid.clientWidth -
      (parseFloat(midCS.paddingLeft) || 0) - (parseFloat(midCS.paddingRight) || 0) - 6 -
      (parseFloat(cs.marginLeft) || 0) - (parseFloat(cs.marginRight) || 0);
    if (need > avail) { wk.classList.add('no-date'); return; }
    /* 兜底：真要只剩不到 1px，CSS 还是会把周次裁掉一两个像素 */
    wk.classList.remove('no-date');
    if (mid.clientWidth > 0 && el.wkLabel.scrollWidth > el.wkLabel.clientWidth + 1) {
      wk.classList.add('no-date');
    }
  }

  function scrollToSensible() {
    var ns = C.nowStatus(META, D.PERIODS, D.COURSES, nowDate());
    var week = displayWeek();
    /* 看当前周时：以"今天"为准；翻到别的周：以那一周的周一为准 */
    var focusDay = isViewingNow() ? ns.weekday : 1;
    var focus = C.coursesOn(META, D.COURSES, week, focusDay);
    var targetMin = 9 * 60 + 30;                       // 默认落在上午第一节附近
    var first = firstBlockTop(focus);
    if (isViewingNow() && ns.status === 'in' && ns.weekday <= 5 && ns.current) {
      targetMin = spanStart(ns.current) - 12;
    } else if (isViewingNow() && ns.status === 'in' && ns.weekday <= 5 && ns.next) {
      targetMin = spanStart(ns.next) - 40;
    } else if (first != null) {
      targetMin = first;
    } else if (isViewingNow() && ns.status === 'in') {
      targetMin = ns.minutes - 120;
    }
    var ratio = (targetMin - RANGE.from) / RANGE.total;
    var px = ratio * gridHeightPx();
    el.board.scrollTop = Math.max(0, px - 42);
  }

  function firstBlockTop(todayCourses) {
    if (!todayCourses || !todayCourses.length) return null;
    var min = Infinity;
    todayCourses.forEach(function (c) { min = Math.min(min, spanStart(c)); });
    return min - 12;
  }

  /** 时间轴的真实像素高度：直接量 .rail（它就是时间轴那一行），量不到再用 --hourH 推算 */
  function gridHeightPx() {
    var h = el.rail.getBoundingClientRect().height;
    if (!isFinite(h) || h < 60) {
      var hh = parseFloat(window.getComputedStyle(el.boardInner).getPropertyValue('--hourH')) || 64;
      h = hh * 12.9167;
    }
    return h;
  }

  /* ================================ 课程详情 ================================ */

  function openDetail(course, sp) {
    var pal = blockColors(course.code);
    var week = displayWeek();
    var perWeek = perWeekHours(course);
    var html = '';
    html += '<h3 class="dt-name">' + esc(course.name) + '</h3>';
    html += '<div class="dt-code">课程号 ' + esc(course.code) + '</div>';
    html += '<div class="dt-rows">';
    html += row('时间', DAY_NAMES[course.weekday] + ' ' + C.periodText(course) + ' <small>' + sp.text + '</small>');
    html += row('周次', C.weekText(course) + ' <small>（' + perWeek + ' 节/周）</small>');
    html += row('地点', esc(course.room));
    if (course.teacher) html += row('教师', esc(course.teacher));
    html += row('当前', '正在看第 ' + week + ' 周 · ' + (C.activeInWeek(course, week) ? '这周要上' : '这周不上'));
    html += '</div>';
    html += '<button class="dt-close" type="button" id="dtClose">知道了</button>';

    el.detail.innerHTML = html;
    el.detail.style.setProperty('--blk-edge', pal.line);
    el.detail.hidden = false;
    el.detailMask.hidden = false;
    document.getElementById('dtClose').addEventListener('click', closeDetail);
  }

  function perWeekHours(course) {
    return (course.lastPeriod - course.firstPeriod + 1);
  }

  function row(k, v) {
    return '<div class="dt-row"><span class="dt-k">' + k + '</span><span class="dt-v">' + v + '</span></div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function closeDetail() {
    el.detail.hidden = true;
    el.detailMask.hidden = true;
  }

  /* ============================== 视图切换 ============================== */

  /** 列表 / 格子：只留一个在页面上，另一个 hidden（CSS 里 [hidden] 带 !important） */
  function paintViewToggle() {
    var isList = state.view !== 'grid';
    el.list.hidden = !isList;
    el.board.hidden = isList;
    if (el.vtList) el.vtList.classList.toggle('is-on', isList);
    if (el.vtGrid) el.vtGrid.classList.toggle('is-on', !isList);
  }

  function setView(v) {
    if (!VIEWS.some(function (x) { return x.key === v; })) return;
    var changed = state.view !== v;
    state.view = v;
    saveSettings();
    paintViewToggle();
    paintChips();
    if (changed && state.view === 'grid') {
      /* 从列表切到格子：格子刚显示出来才有高度，这时候再滚到该看的位置 */
      renderNowLine();
      scrollToSensible();
    }
  }

  /* ================================== 抽屉 ================================== */

  function openSheet() {
    el.sheet.hidden = false;
    el.sheetMask.hidden = false;
    paintChips();
  }
  function closeSheet() {
    el.sheet.hidden = true;
    el.sheetMask.hidden = true;
  }

  /* ================================== 提示 ================================== */

  function renderHint(week) {
    var n = C.countInWeek(META, D.COURSES, week, activeDays());
    var total = 0;
    D.COURSES.forEach(function (c) {
      if (activeInWeekTotal(c)) total += (c.lastPeriod - c.firstPeriod + 1) * (c.weekTo - c.weekFrom + 1);
    });
    var hrs = Math.round(total * 45 / 60);
    el.hint.textContent = '第 ' + week + ' 周共 ' + n + ' 节课 · 全学期约 ' + hrs +
      ' 小时（按每小节 45 分钟算） · ' + META.weekNote;
  }

  function activeInWeekTotal(c) {
    return c.weekFrom != null && c.weekTo != null;
  }

  /* ================================== 事件 ================================== */

  function bind() {
    el.wkPrev.addEventListener('click', function () { gotoWeek(displayWeek() - 1); });
    el.wkNext.addEventListener('click', function () { gotoWeek(displayWeek() + 1); });
    el.wkBack.addEventListener('click', function () { gotoWeek(C.weekOf(META, nowDate()).week); });
    el.vtList.addEventListener('click', function () { setView('list'); });
    el.vtGrid.addEventListener('click', function () { setView('grid'); });
    el.btnTheme.addEventListener('click', openSheet);
    el.sheetMask.addEventListener('click', closeSheet);
    el.sheetDone.addEventListener('click', closeSheet);
    el.detailMask.addEventListener('click', closeDetail);

    el.fsMinus.addEventListener('click', function () { setFs(state.fs - 5); });
    el.fsPlus.addEventListener('click', function () { setFs(state.fs + 5); });
    el.fsRange.addEventListener('input', function () { setFs(Number(el.fsRange.value)); });
    el.swWeekend.addEventListener('change', function () {
      state.weekend = !!el.swWeekend.checked;
      saveSettings(); render(); showStorageWarn();
    });

    /* 备份 / 恢复 */
    el.bkExport.addEventListener('click', bkExport);
    el.bkCopy.addEventListener('click', bkCopy);
    el.bkPick.addEventListener('click', function () {
      bkClear();
      el.bkFile.value = '';   /* 清掉上次选的，不然选同一个文件不触发 change */
      el.bkFile.click();
    });
    el.bkFile.addEventListener('change', function () {
      bkReadFile(el.bkFile.files && el.bkFile.files[0]);
    });
    el.bkMerge.addEventListener('click', function () { bkRestore('merge'); });
    el.bkReplace.addEventListener('click', function () { bkRestore('replace'); });

    /* 左右滑动翻周（在课表区域上） */
    var sx = 0, sy = 0, tracking = false;
    el.board.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    el.board.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        gotoWeek(displayWeek() + (dx < 0 ? 1 : -1));
      }
    }, { passive: true });

    /* 键盘（电脑上看的时候方便） */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') gotoWeek(displayWeek() - 1);
      else if (e.key === 'ArrowRight') gotoWeek(displayWeek() + 1);
      else if (e.key === 'Escape') { closeSheet(); closeDetail(); }
    });

    /* 回到前台/切标签页时先重算一次（iOS 上定时器会被冻住） */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
    window.addEventListener('resize', function () { renderNowLine(); });
    window.addEventListener('orientationchange', function () { setTimeout(renderNowLine, 260); });
  }

  function setFs(v) {
    state.fs = Math.min(140, Math.max(85, v));
    applyTheme();
    el.fsVal.textContent = state.fs + '%';
    el.fsRange.value = String(state.fs);
    saveSettings();
  }

  /* ================================== 心跳 ================================== */

  var lastTickKey = '';

  function tick() {
    var d = nowDate();
    var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '-' + d.getHours() + '-' + d.getMinutes();
    renderTicker();
    if (key === lastTickKey) return;
    lastTickKey = key;
    /* 跨天（比如到了第二天早上）要整块重画：星期几、今天、进度、高亮全变了 */
    render();
  }

  /* ================================== 启动 ================================== */

  function boot() {
    loadSettings();
    applyTheme();
    showStorageWarn();
    try { window.localStorage.setItem('classSchedule.probe', '1'); } catch (e) {
      state.storageOk = false;
      state.storageMsg = '这台设备存不住设置（Safari 无痕模式或 file:// 打开时常见）：页面能用，但换的配色/字号关掉就忘了。';
      showStorageWarn();
    }
    /* 副标题只写学期 —— 页面要传到公开的 GitHub Pages，不出现姓名学号 */
    el.hdSub.textContent = META.termLabel;
    bind();
    render();
    scrollToSensible();
    paintChips();
    lastTickKey = nowDate().getFullYear() + '-' + nowDate().getMonth() + '-' + nowDate().getDate() +
      '-' + nowDate().getHours() + '-' + nowDate().getMinutes();
    window.setInterval(tick, 20000);
    /* 字体加载完再量一次导航条：量得太早拿到的是后备字体的宽度，
       等真字体（黑体/宋体）上来之后可能就放不下了 —— 会漏判成"第 3 周 · 本"。
       这个只在支持 FontFaceSet 的浏览器上跑，量一次就够。 */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fitWeekDate(); }, function () { /* 不支持的就算了 */ });
    }
    /* 窗口尺寸变了（横竖屏、桌面拉伸）也要重新量 */
    window.addEventListener('resize', function () { fitWeekDate(); });
    /* 暴露给测试/截图脚本用（正常用户不会碰） */
    window.__CS = {
      state: state, render: render, tick: tick, gotoWeek: gotoWeek,
      renderTicker: renderTicker, renderNowLine: renderNowLine, data: D, core: C,
      isReady: function () { return true; },
      setNow: function (d) { state.nowOverride = d ? new Date(d) : null; render(); },
      setView: setView, renderList: renderList,
      isViewingNow: isViewingNow, displayWeek: displayWeek,
      makeBackup: makeBackup, parseBackup: parseBackup, bkRestore: bkRestore,
      fitWeekDate: fitWeekDate
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
