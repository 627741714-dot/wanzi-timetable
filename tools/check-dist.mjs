/* ===========================================================================
 * check-dist.mjs —— 交付物自检（打包完、交付前跑一遍）
 *
 * 跑法：node tools/check-dist.mjs
 *
 * 它检查的是"这份东西能不能真的交出去"，不是业务逻辑（业务逻辑归 smoke.mjs）：
 *   · 多文件开发版里的相对引用是不是都真实存在
 *   · 单文件版是不是真的 0 外部引用、CSS/JS 有没有内联进去
 *   · 单文件版 / index.html 是不是和"现在重新打包一次"的结果字节一致（防止忘了重新打包）
 *   · 有没有 BOM（源码带 BOM 内联进 <style>/<script> 会把后面第一条规则吃掉）
 *   · iOS 那套 meta、图标内联、必备的 [hidden] 规则在不在
 *   · 启动 .bat 是不是纯 ASCII
 * ===========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingle, externalRefs, SOURCE_HTML, OUT_HTML, PAGES_HTML, SCRIPTS } from './build-single.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else fails.push(name + (extra ? '  →  ' + extra : ''));
}
const rd = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const hasBom = (p) => {
  const b = fs.readFileSync(p);
  return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
};
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* ============================================== 1. 多文件开发版：引用都在不在 */

const srcHtml = rd(SOURCE_HTML);

ok('开发版存在', exists(SOURCE_HTML));
ok('开发版没有 BOM', !hasBom(SOURCE_HTML));
ok('开发版引用了 src/style.css', /<link rel="stylesheet" href="src\/style\.css">/.test(srcHtml));
SCRIPTS.forEach(function (f) {
  ok('开发版引用了 src/' + f, srcHtml.indexOf('<script src="src/' + f + '"></script>') >= 0);
});

/* 把 html 里所有 src/href 指向的文件挨个查一遍，缺一个就直接报出来 */
const refs = [];
srcHtml.replace(/(?:src|href)="([^"]+)"/g, function (_m, u) {
  if (/^(https?:|data:|#|mailto:)/.test(u)) return _m;
  refs.push(u);
  return _m;
});
const missing = refs.filter(function (u) { return !exists(path.join(ROOT, u)); });
ok('开发版里 ' + refs.length + ' 个相对引用指向的文件全都存在', missing.length === 0,
  missing.length ? '缺：' + missing.join('、') : '');

/* 每个源文件都得在磁盘上，不然打包脚本会抛错 */
['src/data.js', 'src/course-core.js', 'src/app.js', 'src/style.css'].forEach(function (f) {
  ok(f + ' 存在', exists(path.join(ROOT, f)));
  if (exists(path.join(ROOT, f))) ok(f + ' 没有 BOM', !hasBom(path.join(ROOT, f)));
});

/* ======================================================== 2. 单文件版：能不能交 */

ok('单文件版存在', exists(OUT_HTML));
ok('index.html（静态托管首页）存在', exists(PAGES_HTML));

if (exists(OUT_HTML) && exists(PAGES_HTML)) {
  const single = rd(OUT_HTML);
  const pages = rd(PAGES_HTML);

  ok('单文件版没有 BOM', !hasBom(OUT_HTML));
  ok('index.html 没有 BOM', !hasBom(PAGES_HTML));
  ok('单文件版正文里没有 BOM 字符', single.indexOf('\uFEFF') < 0);
  ok('index.html 正文里没有 BOM 字符', pages.indexOf('\uFEFF') < 0);

  const left = externalRefs(single);
  ok('单文件版 0 个外部引用', left.length === 0, left.join('、'));

  ok('单文件版内联了 <style>', /<style>[\s\S]{200,}<\/style>/.test(single));
  SCRIPTS.forEach(function (f) {
    const body = rd(path.join(ROOT, 'src', f));
    /* 抽查源码里一段独有的文字，确认真的被内联进来了（不是只留了个空标签） */
    const probe = body.split('\n').filter((l) => l.trim().length > 30 && l.indexOf('function') >= 0)[0];
    ok('单文件版内联了 ' + f + ' 的内容', !probe || single.indexOf(probe.trim()) >= 0);
  });
  ok('单文件版里没有残留的 <script src=', single.indexOf('<script src=') < 0);
  ok('单文件版里没有残留的 <link rel="stylesheet"', single.indexOf('<link rel="stylesheet"') < 0);

  /* </script> 必须被打散，否则内联的 js 会提前把脚本标签闭合掉 */
  const openTags = (single.match(/<script/g) || []).length;
  const closeTags = (single.match(/<\/script>/g) || []).length;
  ok('<script> 与 </script> 数量相等（各 ' + openTags + ' 个）', openTags === closeTags,
    '开 ' + openTags + ' / 闭 ' + closeTags);

  /* 和"现在重新打包一次"的结果比字节 —— 忘了重新打包会在这里被抓到 */
  const fresh = buildSingle({ write: false }).html;
  ok('单文件版和重新打包的结果字节一致（没有忘记重新打包）', fresh === single,
    '磁盘 ' + single.length + ' 字节 / 重打包 ' + fresh.length + ' 字节');
  ok('index.html 和单文件版字节一致', pages === single,
    'index ' + pages.length + ' 字节 / 单文件 ' + single.length + ' 字节');

  /* --------------------------------------------------------- 3. 手机上要用得到的东西 */

  ok('有 apple-mobile-web-app-capable', single.indexOf('name="apple-mobile-web-app-capable"') >= 0);
  ok('有 apple-mobile-web-app-title', single.indexOf('name="apple-mobile-web-app-title"') >= 0);
  ok('有 apple-mobile-web-app-status-bar-style', single.indexOf('name="apple-mobile-web-app-status-bar-style"') >= 0);
  ok('有 theme-color', single.indexOf('name="theme-color"') >= 0);
  ok('有 viewport', single.indexOf('name="viewport"') >= 0);
  ok('有 apple-touch-icon', single.indexOf('apple-touch-icon') >= 0);
  ok('apple-touch-icon 已内联成 base64（file:// 下也能显示图标）',
    /apple-touch-icon[^>]*href="data:image\/png;base64,/.test(single));
  ok('图标 base64 不是空的', /apple-touch-icon[^>]*href="data:image\/png;base64,[A-Za-z0-9+/=]{500,}/.test(single));
  ok('页面语言是 zh-CN', single.indexOf('<html lang="zh-CN"') >= 0);

  /* 交付规范里点名的那条：.mask{display:flex} 会盖掉浏览器默认的 [hidden] */
  ok('CSS 里有 [hidden]{display:none!important}', /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(single));
  ok('CSS 里有手机优先的 max-width:480px', /max-width:\s*480px/.test(single));
  ok('CSS 里有 iOS 安全区的 safe-area-inset-bottom', /safe-area-inset-bottom/.test(single));
  ok('CSS 里有四套配色（data-theme）', ['paper', 'midnight', 'nord', 'vivid'].every(function (t) {
    return single.indexOf('data-theme="' + t + '"') >= 0;
  }));
  ok('三套字体都在（data-font）', ['system', 'hei', 'serif'].every(function (f) {
    return single.indexOf('data-font="' + f + '"') >= 0;
  }));

  /* 存不下要弹警告，不许静默降级 */
  ok('有 storageWarn 警告条', single.indexOf('id="storageWarn"') >= 0);
  ok('警告条默认是 hidden 的', /id="storageWarn"[^>]*hidden/.test(single));
  ok('代码里会真的去写 localStorage 并读回来比对', /localStorage\.setItem/.test(single) && /localStorage\.getItem/.test(single));

  /* 不该出现的东西 */
  ok('没有外链 http(s) 资源', !/(?:src|href)="https?:\/\//.test(single));
  ok('没有 CDN 上的 js', single.indexOf('cdn.') < 0 && single.indexOf('unpkg') < 0 && single.indexOf('jsdelivr') < 0);
}

/* ====================================================== 4. 启动脚本和本地服务 */

const BAT = path.join(ROOT, '启动手机访问.bat');
ok('启动手机访问.bat 存在', exists(BAT));
if (exists(BAT)) {
  const buf = fs.readFileSync(BAT);
  ok('bat 没有 BOM', !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF));
  /* cmd.exe 用 GBK 读 bat，UTF-8 中文会把命令拆坏 —— 必须是纯 ASCII */
  const nonAscii = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] > 127) nonAscii.push(i);
  ok('bat 是纯 ASCII（' + buf.length + ' 字节里 0 个非 ASCII）', nonAscii.length === 0,
    nonAscii.length ? '第 ' + nonAscii[0] + ' 字节是 ' + buf[nonAscii[0]] : '');
  const bat = buf.toString('utf8');
  ok('bat 里有 chcp 65001', /chcp\s+65001/i.test(bat));
  ok('bat 会调用 tools\\serve.mjs', /serve\.mjs/.test(bat));
  ok('bat 找不到 node 时有提示', /node/i.test(bat) && /pause/i.test(bat));
}

const SERVE = path.join(ROOT, 'tools', 'serve.mjs');
ok('tools/serve.mjs 存在', exists(SERVE));
if (exists(SERVE)) {
  const s = rd(SERVE);
  ok('serve.mjs 首页是 index.html', /INDEX\s*=\s*'index\.html'/.test(s));
  ok('serve.mjs 关掉了缓存（改完立刻能看到）', /no-cache/.test(s));
  ok('serve.mjs 有路径穿越防护', /startsWith\('\.\.'\)|isAbsolute/.test(s));
  ok('serve.mjs 会打印手机访问地址', /lanAddresses|192\.168/.test(s));
}

/* ================================================ 5. 测试/截图脚本别被人误删 */

['smoke.mjs', 'dom-smoke.mjs', 'shots.mjs', 'build-single.mjs', 'make-icon.mjs', 'check-dist.mjs'].forEach(function (f) {
  ok('tools/' + f + ' 存在', exists(path.join(ROOT, 'tools', f)));
});

/* ==================================================================== 结果 */

const total = pass + fails.length;
if (fails.length) {
  console.log(`\n✗ 交付自检 ${fails.length}/${total} 项没通过：\n`);
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log('');
  process.exit(1);
}
console.log(`\n✓ 交付自检全部通过：${pass}/${total}`);
console.log('  · 单文件版 0 外部引用，和 index.html 字节一致');
console.log('  · 相对引用齐全、无 BOM、iOS meta 与图标齐全\n');
