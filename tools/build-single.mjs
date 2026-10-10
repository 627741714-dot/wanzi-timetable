/* 打包成单文件：把 style.css + data.js + course-core.js + app.js 全塞进一个 html
 * 跑法：node tools/build-single.mjs
 *
 * 为什么要打包：
 *   开发时「北理工课表.html」是用相对路径引用 src/ 里的文件的。
 *   只要别人只收到这一个 html（微信发文件、只拷一个到桌面），
 *   CSS 和 JS 全都加载不到 —— 页面变成没有任何样式的丑样子，功能也是死的。
 *   打包成单文件后，一个 html 发给谁都能正常用。
 *
 * 改完 src/ 里的东西记得重新跑一次这个脚本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

export const SOURCE_HTML = path.join(root, '北理工课表.html');
export const OUT_HTML = path.join(root, '北理工课表-单文件版.html');
/** GitHub Pages 的首页必须叫 index.html —— 直接生成好，省得在网页上改名 */
export const PAGES_HTML = path.join(root, 'index.html');

/** 按源码里的顺序内联，顺序不能乱（data → core → app） */
export const SCRIPTS = ['data.js', 'course-core.js', 'app.js'];

/** 内联进 <script> 时要把字符串里的 </script 打散，否则会提前结束脚本 */
function escapeForInlineScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * 去掉 UTF-8 BOM。
 * 外链的 css/js 开头有 BOM，浏览器会自己剥掉，看不出问题；
 * 但内联到 <style>/<script> 中间时它不会被剥，解析器会把 BOM 当成一个选择器/标识符，
 * 把紧随其后的第一条规则整块吃掉。踩过的坑：外链正常、单文件版整个页面崩掉。
 */
function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * 打包成单文件 html 字符串。
 * @param {{write?: boolean}} [opts] write=true（默认）时顺便把两个产物写到磁盘；
 *        check-dist.mjs 用 write:false 只拿字符串来比对，避免自检反而改了文件。
 * @returns {{ html: string, out: string, pages: string, refs: string[] }}
 */
export function buildSingle(opts) {
  const write = !opts || opts.write !== false;
  let html = stripBom(fs.readFileSync(SOURCE_HTML, 'utf8'));

  // ---- CSS ----
  const css = stripBom(fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8'));
  const beforeCss = html;
  html = html.replace(
    /[ \t]*<link rel="stylesheet" href="src\/style\.css">\r?\n/,
    () => '<style>\n' + css.trimEnd() + '\n</style>\n'
  );
  if (html === beforeCss) throw new Error('没找到 <link rel="stylesheet" href="src/style.css">，检查一下 北理工课表.html');

  // ---- 主屏幕图标也内联，否则单文件版发出去又缺一个文件 ----
  const iconPath = path.join(root, 'icon-180.png');
  if (fs.existsSync(iconPath)) {
    const b64 = fs.readFileSync(iconPath).toString('base64');
    const dataUri = 'data:image/png;base64,' + b64;
    for (const rel of ['apple-touch-icon', 'icon']) {
      html = html.replace(
        new RegExp('[ \\t]*<link rel="' + rel + '" href="icon-180\\.png">\\r?\\n'),
        () => '<link rel="' + rel + '" href="' + dataUri + '">\n'
      );
    }
  }

  // ---- JS ----
  for (const f of SCRIPTS) {
    const js = stripBom(fs.readFileSync(path.join(root, 'src', f), 'utf8'));
    const before = html;
    html = html.replace(
      new RegExp('[ \\t]*<script src="src/' + f.replace(/\./g, '\\.') + '"><\\/script>\\r?\\n'),
      // 用函数形式，避免 js 里的 $& / $` / $1 被 replace 当成替换模式
      () => '<script>\n' + escapeForInlineScript(js).trimEnd() + '\n</script>\n'
    );
    if (html === before) throw new Error('没找到要替换的 <script src="src/' + f + '">，检查一下 北理工课表.html');
  }

  html = html.replace(
    '<title>我的课表 · 北理工 2026秋</title>',
    '<title>我的课表 · 北理工 2026秋</title>\n<!-- 单文件版：CSS / JS / 图标都已内联，可以单独发给别人 -->'
  );

  const refs = externalRefs(html);

  // 两个名字，内容一模一样：
  //   北理工课表-单文件版.html —— 发给别人 / 发微信时用，名字一看就懂
  //   index.html              —— 传 GitHub Pages 用（Pages 只认 index.html 当首页）
  if (write) {
    fs.writeFileSync(OUT_HTML, html, 'utf8');
    fs.writeFileSync(PAGES_HTML, html, 'utf8');
  }
  return { html: html, out: OUT_HTML, pages: PAGES_HTML, refs: refs };
}

/** 还剩几个对外部文件的引用？单文件版必须是 0 个 */
export function externalRefs(html) {
  const refs = [];
  const re = /\b(?:src|href)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = m[1];
    if (/^(data:|https?:|#|mailto:)/i.test(v)) continue;
    refs.push(v);
  }
  return refs;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const res = buildSingle();
  const kb = (res.html.length / 1024).toFixed(1);
  console.log(`✓ 已生成 ${path.basename(OUT_HTML)}（${kb} KB）—— 发人用`);
  console.log(`✓ 已生成 ${path.basename(PAGES_HTML)}（${kb} KB）—— 传 GitHub Pages 用，不用改名`);
  console.log(res.refs.length ? `  注意：还剩外部引用 ${res.refs.join(', ')}` : '  外部引用：0 个');
}
