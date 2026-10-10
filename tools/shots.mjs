/* 真截图：用 Edge 无头模式 + CDP 设备模拟，把页面按 iPhone 宽度打开，自己"看"图
 * 跑法：node tools/shots.mjs          截图写进 预览/
 *       node tools/shots.mjs --check  只自检（能不能渲染、有没有报错），不写图
 *
 * 两个必须绕开的坑：
 *  1) --screenshot 会丢掉 URL 的 query string，没法用 ?demo= 传参。
 *     做法：把一小段「驱动脚本」注入到 </body> 之前（一定晚于应用脚本），
 *     让它读 location.search、假装"现在是几点"、把测量结果写进 window.__SHOT。
 *  2) Windows 上 Edge 无头窗口最小宽度被钳到约 518px，--window-size=390 无效，
 *     套 390px 的 iframe 也没用（iframe 一样被撑到 518）。
 *     做法：用 CDP 的 Emulation.setDeviceMetricsOverride 强制 390×844，这是唯一靠谱的。
 *
 * 截的是【打包后的单文件版】，不是源码 html：
 *  ① 截出来的就是真正交付的那个文件；
 *  ② 单文件版没有任何相对引用，临时 html 放到哪都能跑。
 *     （踩过的坑：把源码 html 拷到 .shots/ 下截，<script src="src/app.js"> 会去
 *      .shots/src/ 找，找不到就静默不执行 —— 页面空白，还查不出原因。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingle } from './build-single.mjs';
import { launchBrowser, connectToTarget, createTarget, sleep } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SHOT_DIR = path.join(root, '预览');
const TMP_DIR = path.join(root, '.shots');
const PHONE_W = 390;                    // iPhone 14/15/16 的逻辑宽度
const PHONE_H = 844;
const DEBUG_PORT = 9333;
const CHECK_ONLY = process.argv.includes('--check');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/** 本机绝对路径 → file:/// URL */
function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
}

/* ------------------------------------------------------------------ 驱动脚本 */

/** 注入到页面最后：控制"假装现在几点"，并把测量结果写成 window.__SHOT */
function driverScript() {
  return `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  window.__err = 'none';
  window.addEventListener('error', function (e) { window.__err = (e.message || '') + ' @' + (e.lineno || 0); });
  window.__SHOT = { ok: false, err: 'none' };

  function apply() {
    var CS = window.__CS;
    var t = q.get('t');
    if (t) {
      var m = /^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})$/.exec(t);
      /* 用本地时间构造，别走 Date.parse('...T...') 的 UTC 解析 */
      if (m) CS.setNow(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    }
    if (q.get('theme')) document.documentElement.setAttribute('data-theme', q.get('theme'));
    if (q.get('font')) document.documentElement.setAttribute('data-font', q.get('font'));
    /* 配色/字体走"点 chip"的路子，别直接改 data-theme ——
       直接改属性只动了 DOM，state.theme 还是默认值，抽屉里亮着的 chip
       就会和页面实际配色对不上（截图会拍出这种自相矛盾的状态）。
       顺序要紧：theme 的点击处理器会 paintChips() 重建所有 chip，
       把先前查到的 font 按钮变成脱离文档的元素，点它就白点了 —— 所以字体先点。 */
    if (q.get('pickFont')) {
      var fc = Array.prototype.slice.call(document.querySelectorAll('#fontChips .chip'))
        .filter(function (c) { return c.dataset.font === q.get('pickFont'); })[0];
      if (fc) fc.click();
    }
    if (q.get('pickTheme')) {
      var tc = document.querySelector('#themeChips .chip[data-theme="' + q.get('pickTheme') + '"]');
      if (tc) tc.click();
    }
    if (q.get('view')) CS.setView(q.get('view'));
    if (q.get('weekend')) {
      var sw = document.getElementById('swWeekend');
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
    }
    if (q.get('week')) CS.gotoWeek(+q.get('week'));
    if (q.get('sheet')) {
      document.getElementById('sheetMask').hidden = false;
      document.getElementById('sheet').hidden = false;
    }
    if (q.get('sheetBottom')) {              /* 抽屉滚到底（看下面的"备份设置"那一块） */
      var sh = document.getElementById('sheet');
      sh.scrollTop = sh.scrollHeight;
    }
    if (q.get('now')) {                      /* 点开"正在上"那节课的详情 */
      var now = document.querySelector('.blk.is-now') || document.querySelector('.lp.is-now');
      if (now) now.click();
    }
  }

  var tries = 0;
  (function wait() {
    if (window.__CS && window.__CS.state) {
      apply();
      var ph = document.querySelector('.phone');
      var bd = document.querySelector('.board');
      var ls = document.querySelector('.list');
      var gridView = window.__CS.state.view === 'grid';
      var pane = gridView ? bd : ls;
      var cs = getComputedStyle(document.querySelector('.board-inner'));
      var hourH = parseFloat(cs.getPropertyValue('--hourH')) || 64;
      /* 内容那一块的真实高度：整页截图要按它算（.phone 是 100dvh，不撑就被截断）。
         格子里量 .board-inner；列表里量 .list 的内容高（scrollHeight 不受自身裁剪影响）。 */
      var boardH = gridView
        ? document.querySelector('.board-inner').getBoundingClientRect().height
        : ls.scrollHeight;
      var chromeH = ph ? ph.getBoundingClientRect().height - (pane ? pane.getBoundingClientRect().height : 0) : 0;

      /* 导航条会不会折行：折行时 .wk-now 里的 strong 与 span 的 client rect 会差一行高。
         注意：日期被藏起来时（.no-date）它的 rect 是 (0,0)，差值会是个大负数，那不是折行 ——
         所以先确认两个盒子都真的排出来了（宽高都不为 0）再比。 */
      var wkNow = document.querySelector('.wk-now');
      var wkStrong = document.querySelector('.wk-now strong');
      var wkDate = document.querySelector('.wk-now span');
      var rs = wkStrong ? wkStrong.getBoundingClientRect() : null;
      var rd = wkDate ? wkDate.getBoundingClientRect() : null;
      var bothLaid = !!(rs && rd && rs.height > 0 && rd.height > 0 && rd.width > 0);
      var lineDelta = bothLaid ? Math.round(rd.top - rs.top) : 0;
      var navH = document.querySelector('.wk') ? Math.round(document.querySelector('.wk').getBoundingClientRect().height) : 0;

      window.__SHOT = {
        ok: true,
        err: String(window.__err),
        view: window.__CS.state.view,
        font: window.__CS.state.font,
        fs: window.__CS.state.fs,
        blocks: document.querySelectorAll('.blk').length,
        rows: document.querySelectorAll('.lp').length,
        h: document.documentElement.scrollHeight,
        vw: window.innerWidth,
        phoneW: ph ? Math.round(ph.getBoundingClientRect().width) : 0,
        boardH: Math.round(boardH),
        hourH: hourH,
        fullH: Math.round(boardH + chromeH + 8),
        navH: navH,
        navLineDelta: lineDelta,
        navWrapped: bothLaid && Math.abs(lineDelta) > 6,
        navDateHidden: !!(rd && rd.width === 0),
        navClipped: !!(wkStrong && wkStrong.scrollWidth > wkStrong.clientWidth + 1),
        navText: wkNow ? wkNow.textContent.replace(/\\s+/g, '') : '',
        /* 打开详情/抽屉时，要看整个页面而不是只看课表 */
        overlay: document.querySelectorAll('.detail:not([hidden]), .sheet:not([hidden])').length > 0,
        week: ((document.getElementById('wkLabel') || {}).textContent || ''),
        ticker: ((document.getElementById('tkText') || {}).textContent || '')
      };
      document.title = 'READY ' + window.__SHOT.week;
      return;
    }
    if (++tries > 80) {
      document.title = 'DRIVER-FAIL ' + String(window.__err) + ' readyState=' + document.readyState;
      window.__SHOT = { ok: false, err: String(window.__err) };
      return;
    }
    setTimeout(wait, 50);
  })();
})();
<\/script>
`;
}

/* ------------------------------------------------------------------ 截一张 */

async function shoot(browser, cfg) {
  const tmpHtml = path.join(TMP_DIR, 'shot-' + cfg.name + '.html');

  let html = buildSingle({ write: false }).html;
  if (html.indexOf('</body>') < 0) return { name: cfg.name, error: '源码里没有 </body>，注入不了驱动脚本' };
  html = html.replace('</body>', driverScript() + '</body>');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  /* 每张图开一个新标签页，互不干扰（localStorage 也不会串） */
  const targetId = await createTarget(browser.cdp);
  const page = await connectToTarget(DEBUG_PORT, targetId);

  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    /* 关键一步：强制手机视口，否则 Edge 会钳到 518px */
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: PHONE_W, height: PHONE_H, deviceScaleFactor: 1, mobile: true
    });
    await page.send('Page.navigate', { url: fileUrl(tmpHtml) + (cfg.query ? '?' + cfg.query : '') });

    /* 轮询驱动脚本的完成标记 */
    let shot = null;
    for (let i = 0; i < 120; i++) {
      const r = await page.send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__SHOT || null)', returnByValue: true
      });
      const v = r && r.result && r.result.value;
      if (v) {
        const parsed = JSON.parse(v);
        if (parsed && parsed.ok) { shot = parsed; break; }
        if (parsed && parsed.ok === false && parsed.err && parsed.err !== 'none') {
          return { name: cfg.name, error: '页面报错：' + parsed.err };
        }
      }
      await sleep(100);
    }
    if (!shot) {
      const t = await page.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      return { name: cfg.name, error: '驱动脚本没跑完（title=' + (t.result && t.result.value) + '）' };
    }

    const problems = [];
    if (!shot.blocks && !shot.rows && !cfg.allowEmpty) problems.push('页面里既没有课块 .blk 也没有列表行 .lp');
    if (shot.h < 200) problems.push('整页高度只有 ' + shot.h + 'px，明显没渲染出来');
    if (shot.err && shot.err !== 'none') problems.push('页面报错：' + shot.err);
    if (shot.vw !== PHONE_W) problems.push('视口宽度是 ' + shot.vw + '，不是 ' + PHONE_W);
    /* 导航条折行：宋体比系统字体宽，很容易把"第 3 周 · 本周 10/5 – 10/11"挤成两行 */
    if (shot.navWrapped) {
      problems.push('导航条折行了（' + shot.navText + '，两行文字差了 ' + shot.navLineDelta + 'px）');
    }
    /* 或者周次被裁成半截（"第 3 周 · 本"这种）——
       这是真实发生过的：宋体下 fitWeekDate 判定"放得下"，实际差 10px */
    if (shot.navClipped) {
      problems.push('周次被裁掉了尾巴（' + shot.navText + '，日期' +
        (shot.navDateHidden ? '已收掉' : '还留着') + '）');
    }
    if (problems.length) {
      return { name: cfg.name, error: problems.join('；') + `（课块 ${shot.blocks}，列表行 ${shot.rows}）` };
    }

    const info = shot.view === 'grid'
      ? `${shot.blocks} 个课块，课表 ${shot.boardH}px，整页 ${shot.fullH}px，视口 ${shot.vw}px，导航 ${shot.navH}px`
      : `${shot.rows} 行课程，列表 ${shot.boardH}px，整页 ${shot.fullH}px，视口 ${shot.vw}px，导航 ${shot.navH}px`;
    if (CHECK_ONLY) return { name: cfg.name, ok: true, note: info };

    /* 整页截图：先把手机视口撑到整页高（.phone 是 100dvh，不撑就会被截断），
       再用 captureBeyondViewport + clip 取整页 */
    const capH = Math.min(Math.max(shot.fullH, PHONE_H), 2600);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: PHONE_W, height: capH, deviceScaleFactor: 1, mobile: true
    });
    await sleep(120);
    const cap = await page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: PHONE_W, height: capH, scale: 1 }
    });
    const png = path.join(SHOT_DIR, cfg.name + '.png');
    fs.writeFileSync(png, Buffer.from(cap.data, 'base64'));
    const kb = (fs.statSync(png).size / 1024).toFixed(0);
    return { name: cfg.name, ok: true, kb: kb, file: png, note: info + '；' + shot.ticker };
  } finally {
    try { await browser.cdp.send('Target.closeTarget', { targetId: targetId }); } catch (e) { /* 忽略 */ }
    page.close();
  }
}

/* ------------------------------------------------------------------ 截哪些 */

/* 用了 pickTheme / pickFont 而不是直接改 data-theme：见上面 apply() 里的说明 */
const SHOTS = [
  { name: '01-列表-活力-本周', query: 'view=list&t=2026-10-10T15:10&pickTheme=vivid' },
  { name: '02-列表-正在上课', query: 'view=list&t=2026-10-05T10:20&pickTheme=paper' },
  { name: '03-列表-午夜', query: 'view=list&t=2026-10-05T10:20&pickTheme=midnight' },
  { name: '04-列表-北欧', query: 'view=list&t=2026-10-06T14:30&pickTheme=nord' },
  { name: '05-列表-活力', query: 'view=list&t=2026-10-07T09:00&pickTheme=vivid' },
  { name: '06-列表-黑体', query: 'view=list&t=2026-10-10T15:10&pickTheme=paper&pickFont=hei' },
  { name: '07-列表-宋体', query: 'view=list&t=2026-10-10T15:10&pickTheme=paper&pickFont=serif' },
  { name: '08-列表-第一周', query: 'view=list&t=2026-10-10T15:10&week=1&pickTheme=paper' },
  { name: '09-列表-晚上', query: 'view=list&t=2026-10-05T19:00&pickTheme=midnight' },
  { name: '10-外观设置', query: 'view=list&t=2026-10-10T15:10&pickTheme=vivid&sheet=1&sheetBottom=1' },
  { name: '11-课程详情', query: 'view=list&t=2026-10-05T10:20&pickTheme=paper&now=1' },
  { name: '12-列表-期末周', query: 'view=list&t=2026-01-06T10:00&week=16&pickTheme=nord' },
  { name: '13-列表-放假日', query: 'view=list&t=2026-10-10T15:10&week=17&pickTheme=paper' },

  { name: '20-格子-纸感-本周', query: 'view=grid&t=2026-10-10T15:10&pickTheme=paper' },
  { name: '21-格子-正在上课', query: 'view=grid&t=2026-10-05T10:20&pickTheme=paper' },
  { name: '22-格子-午夜', query: 'view=grid&t=2026-10-05T10:20&pickTheme=midnight' },
  { name: '23-格子-活力', query: 'view=grid&t=2026-10-07T09:00&pickTheme=vivid' },
  { name: '24-格子-带周末', query: 'view=grid&t=2026-10-10T15:10&theme=paper&weekend=1' },
  { name: '25-格子-放假日', query: 'view=grid&t=2026-10-10T15:10&week=17&theme=paper', allowEmpty: true }
];

/* -------------------------------------------------------------------- 主流程 */

const browserExe = findBrowser();
if (!browserExe) {
  console.log('✗ 没找到 Edge，跳过截图（不影响交付，只是没有预览图）');
  process.exit(0);
}

fs.mkdirSync(TMP_DIR, { recursive: true });
if (!CHECK_ONLY) fs.mkdirSync(SHOT_DIR, { recursive: true });

console.log('浏览器：' + browserExe);
console.log(CHECK_ONLY ? '模式：只自检\n' : '模式：截图 → 预览/\n');

const browser = await launchBrowser({
  exe: browserExe,
  port: DEBUG_PORT,
  userDataDir: path.join(TMP_DIR, 'edge-profile')
});

let bad = 0;
try {
  for (const cfg of SHOTS) {
    let r;
    try { r = await shoot(browser, cfg); }
    catch (e) { r = { name: cfg.name, error: (e && e.message) || String(e) }; }
    if (r.error) { bad++; console.log('  ✗ ' + r.name + ' —— ' + r.error); }
    else if (CHECK_ONLY) console.log('  ✓ ' + r.name + ' —— ' + r.note);
    else console.log('  ✓ ' + r.name + '.png（' + r.kb + ' KB）—— ' + r.note);
  }
} finally {
  browser.kill();
  for (const f of fs.readdirSync(TMP_DIR)) {
    if (/^shot-.*\.html$/.test(f)) fs.unlinkSync(path.join(TMP_DIR, f));
  }
}

console.log('');
if (bad) { console.log('✗ ' + bad + ' 张有问题'); process.exit(1); }
console.log(CHECK_ONLY ? '✓ 全部自检通过' : '✓ ' + SHOTS.length + ' 张截图已写入 预览/');
