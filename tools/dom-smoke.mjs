/* ===========================================================================
 * dom-smoke.mjs -- UI smoke test: really boot the page in jsdom and click it.
 *
 * NOTICE (why every comment and every test name in this file is plain ASCII):
 *   This file used to have Chinese names/messages. A PowerShell round-trip
 *   (Get-Content -Raw | -replace | Set-Content -Encoding utf8) destroyed every
 *   Chinese byte in it -- irrecoverably, because PowerShell decoded the UTF-8
 *   source as GBK and wrote the result back as UTF-8 with "?" loss.
 *   The assertions below DO check Chinese UI strings (that is the product), but
 *   the test's own labels stay ASCII, so no future edit can lose the test names.
 *   RULE: never rewrite a source file with PowerShell Set-Content / Out-File.
 *   Use the edit/write tools or node's fs.writeFileSync.
 *
 * jsdom lookup order (this box has no global jsdom):
 *   1. require('jsdom')
 *   2. process.env.JSDOM_PATH
 *   3. a copy that ships with another dsh project
 * If none is found we print a note and exit 0 (not an error -- the test is
 * optional on machines without jsdom).
 *
 * jsdom does no layout, so geometry (nav bar fitting) is tested by faking
 * element widths -- see group 10.
 * ===========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);

function loadJsdom() {
  const candidates = [
    'jsdom',
    process.env.JSDOM_PATH,
    'C:/Users/lenovo/dsh/ai-cs-quiz/node_modules/jsdom',
    'C:/Users/lenovo/dsh/word-master/tools/node_modules/jsdom'
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try the next one */ }
  }
  return null;
}

const jsdomLib = loadJsdom();
if (!jsdomLib) {
  console.log('\nskip UI test: jsdom not found (tried require("jsdom"), $JSDOM_PATH, and two local copies).');
  console.log('   to run it: point JSDOM_PATH at a jsdom install, or npm i -D jsdom');
  process.exit(0);
}

/* ------------------------------------------------------------ tiny assert kit */

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else fails.push(name + (extra ? '  -> ' + extra : ''));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function includes(name, haystack, needle) {
  ok(name, String(haystack).indexOf(needle) >= 0, '"' + haystack + '" does not contain "' + needle + '"');
}
function notIncludes(name, haystack, needle) {
  ok(name, String(haystack).indexOf(needle) < 0, '"' + haystack + '" should not contain "' + needle + '"');
}

/* -------------------------------------------------------------- page factory */

const html = fs.readFileSync(path.join(root, '\u5317\u7406\u5de5\u8bfe\u8868.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const srcDir = path.join(root, 'src');
const scripts = ['data.js', 'course-core.js', 'app.js'].map(f => fs.readFileSync(path.join(srcDir, f), 'utf8'));

/** Local-time Date (never Date.parse('YYYY-MM-DD') -- that is UTC and is a day off here) */
function at(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh == null ? 0 : hh, mm == null ? 0 : mm, 0, 0); }

/**
 * Boot the real page in jsdom.
 *   opts.localStorage -- an object installed in place of window.localStorage
 *   opts.now          -- pin "now" through window.__CS.setNow
 */
async function makePage(opts) {
  const o = opts || {};
  const dom = new jsdomLib.JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const doc = window.document;

  if (o.localStorage) {
    try {
      Object.defineProperty(window, 'localStorage', { value: o.localStorage, configurable: true });
    } catch (e) { /* the test that needs this will notice */ }
  }

  for (const s of scripts) window.eval(s);
  await new Promise(res => (doc.readyState === 'complete' ? res() : window.addEventListener('load', res)));

  const $ = sel => doc.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(doc.querySelectorAll(sel));
  const page = { dom, window, doc, $, $$, CS: window.__CS };
  if (o.now) page.CS.setNow(o.now);
  page.listText = () => ($('#list') ? $('#list').textContent : '').replace(/\s+/g, ' ').trim();
  /* Guarded readers: when the app is deliberately broken for a reverse check, the
     node may not exist at all. A bare `.textContent` then throws a TypeError, the
     process dies, and the named failure never prints -- which makes the reverse
     check useless. These always return a string, so the assertion fails by name. */
  page.txt = sel => { const n = $(sel); return n ? n.textContent : '<missing ' + sel + '>'; };
  page.cls = sel => { const n = $(sel); return n ? n.className : '<missing ' + sel + '>'; };
  page.at = (sel, i) => $$(sel)[i] || null;
  page.tk = () => page.txt('#tkText');
  page.wk = () => page.txt('#wkLabel');
  page.rng = () => page.txt('#wkRange');
  page.click = sel => { const n = $(sel); if (!n) throw new Error('click: no such node ' + sel); n.click(); };
  page.chip = (group, key) => {
    const sel = group === 'theme' ? '#themeChips .chip[data-theme="' + key + '"]'
      : group === 'font' ? '#fontChips .chip[data-font="' + key + '"]'
        : '#viewChips .chip[data-view="' + key + '"]';
    page.click(sel);
  };
  page.toggleWeekend = on => {
    page.$('#swWeekend').checked = !!on;
    page.$('#swWeekend').dispatchEvent(new page.window.Event('change'));
  };
  return page;
}

/* ============================================================ 1. does it boot */

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });
  ok('page booted: window.__CS exists', !!p.CS);
  ok('page booted: ScheduleData is on the window', !!p.window.ScheduleData);
  ok('page booted: CourseCore is on the window', !!p.window.CourseCore);
  const D = p.window.ScheduleData;
  /* the page goes on a public GitHub Pages site, so no name / student number */
  eq('header subtitle is just the term', p.$('#hdSub').textContent, D.META.termLabel);
  ok('header subtitle carries no student number', p.$('#hdSub').textContent.indexOf('1120261753') < 0);
  includes('header subtitle carries the term label', p.$('#hdSub').textContent, D.META.termLabel);
  eq('default view is the list (what the user picked)', p.CS.state.view, 'list');
  eq('list view is visible', p.$('#list').hidden, false);
  eq('grid view is hidden on boot', p.$('#board').hidden, true);
  ok('list button is highlighted', p.$('#vtList').classList.contains('is-on'));
  ok('grid button is not highlighted', !p.$('#vtGrid').classList.contains('is-on'));
  eq('storage is fine, so no warning bar', p.$('#storageWarn').hidden, true);
  eq('settings drawer starts closed', p.$('#sheet').hidden, true);
  eq('course detail starts closed', p.$('#detail').hidden, true);
  eq('there are 4 theme chips', p.$$('#themeChips .chip').length, 4);
  eq('there are 3 font chips', p.$$('#fontChips .chip').length, 3);
  eq('there are 2 view chips', p.$$('#viewChips .chip').length, 2);
  eq('font size starts at 100%', p.$('#fsVal').textContent, '100%');
  eq('font size range starts at 100', p.$('#fsRange').value, '100');
  eq('font size range lower bound is 85', p.$('#fsRange').getAttribute('min'), '85');
  eq('font size range upper bound is 140', p.$('#fsRange').getAttribute('max'), '140');
  notIncludes('the placeholder text of the live bar is gone', p.tk(), '\u6b63\u5728\u8bfb\u53d6\u65f6\u95f4');
  ok('the live bar shows something', p.tk().length > 0);
  includes('the footer states the data source', p.$('footer.ft').textContent, 'PDF');
  eq('the now line is hidden while the list view is up', p.$('#nowLine').hidden, true);
  p.dom.window.close();
}

/* ============================================ 2. list view writes everything */

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });   // week 3, Saturday
  const txt = p.listText();
  eq('week 3 draws 5 weekday headers', p.$$('#list .lp-day').length, 5);
  eq('week 3 has 10 course rows', p.$$('#list .lp').length, 10);
  includes('Monday header carries the date and a count', txt, '10/5 \u00b7 3 \u8282');
  includes('has the AI course', txt, '\u4eba\u5de5\u667a\u80fd\u4e0e\u8ba1\u7b97\u79d1\u5b66A');
  includes('has physical education', txt, '\u4f53\u80b2/\u7bee\u7403');
  includes('has the Xi Jinping thought course', txt, '\u4e60\u8fd1\u5e73\u65b0\u65f6\u4ee3\u4e2d\u56fd\u7279\u8272\u793e\u4f1a\u4e3b\u4e49\u601d\u60f3\u6982\u8bba');
  includes('has C programming', txt, 'C\u8bed\u8a00\u7a0b\u5e8f\u8bbe\u8ba1');
  includes('has the electronics intro', txt, '\u7535\u5b50\u4fe1\u606f\u5bfc\u8bba');
  includes('has engineering drawing', txt, '\u5de5\u7a0b\u5236\u56feC');
  includes('has engineering math analysis', txt, '\u5de5\u79d1\u6570\u5b66\u5206\u6790 I');
  includes('has the psychology course', txt, '\u5927\u5b66\u751f\u5fc3\u7406\u7d20\u8d28\u53d1\u5c55');
  includes('period text is the compact form', txt, '\u7b2c3\u20135\u8282');
  includes('start time of the first big block shows', txt, '09:55');
  includes('end time of the first big block shows', txt, '12:20');
  includes('evening start time shows', txt, '18:30');
  includes('evening end time shows', txt, '20:55');
  includes('room of the AI course shows', txt, '\u6587\u8403\u697cF302');
  includes('room of the basketball court shows', txt, '\u5357\u6821\u533a\u7bee\u7403\u573a');
  includes('room of the engineering drawing shows', txt, '\u7efc\u6559A102');
  includes('room of the psychology course shows', txt, '\u7406\u6559\u697c302');
  notIncludes('the "N per week" line is gone (user asked)', txt, '\u6bcf\u5468');
  notIncludes('no military theory (time undecided)', txt, '\u519b\u4e8b\u7406\u8bba');
  notIncludes('no military skills (time undecided)', txt, '\u519b\u4e8b\u6280\u80fd');
  notIncludes('no English placement test (time undecided)', txt, '\u82f1\u8bed\u5206\u7ea7\u8003\u8bd5');
  notIncludes('no pending-time wording', txt, '\u65f6\u95f4\u5f85\u5b9a');
  notIncludes('no national security course in week 3', txt, '\u56fd\u5bb6\u5b89\u5168\u6982\u8bba');
  /* week 12: the AI course (weeks 1-11) is over, the practice course (9-13) is on */
  p.CS.gotoWeek(12);
  const w12 = p.listText();
  notIncludes('week 12 drops the AI course', w12, '\u4eba\u5de5\u667a\u80fd\u4e0e\u8ba1\u7b97\u79d1\u5b66A');
  includes('week 12 has the new-era practice course', w12, '\u65b0\u65f6\u4ee3\u5b9e\u8df5\u6559\u80b2I');
  p.CS.gotoWeek(9);
  eq('week 9 has 7 rows', p.$$('#list .lp').length, 7);
  p.CS.gotoWeek(1);
  eq('week 1 has 10 rows', p.$$('#list .lp').length, 10);
  p.CS.gotoWeek(0);
  eq('week 0 has no rows', p.$$('#list .lp').length, 0);
  includes('week 0 explains it is the pre-term military week', p.listText(), '\u5f00\u5b66\u524d');
  p.CS.gotoWeek(17);
  eq('week 17 is clamped back to 16 (the last week of term)', p.CS.displayWeek(), 16);
  p.CS.gotoWeek(-9);
  eq('week -9 is clamped to -3 (minWeek)', p.CS.displayWeek(), -3);
  p.dom.window.close();
}

/* ================================= 3. "today" marker and the live highlight */

{
  const p = await makePage({ now: at(2026, 10, 5, 10, 20) });   // week 3, Monday 10:20
  const nowRows = p.$$('#list .lp.is-now');
  eq('at Monday 10:20 exactly one row is live', nowRows.length, 1);
  includes('the live row is the AI course', nowRows[0].textContent, '\u4eba\u5de5\u667a\u80fd\u4e0e\u8ba1\u7b97\u79d1\u5b66A');
  includes('the live row wears the "in class" badge', nowRows[0].textContent, '\u6b63\u5728\u4e0a');
  eq('exactly one day header is marked today', p.$$('#list .lp-day.is-today').length, 1);
  includes('the today header is Monday', p.txt('#list .lp-day.is-today'), '\u5468\u4e00');
  includes('the today header carries the tag', p.txt('#list .lp-day.is-today'), '\u4eca\u5929');

  p.CS.setNow(at(2026, 10, 6, 10, 20));   // Tuesday
  eq('the today marker follows to Tuesday', p.txt('#list .lp-day.is-today').indexOf('\u5468\u4e8c') >= 0, true);
  eq('Tuesday also has exactly one today header', p.$$('#list .lp-day.is-today').length, 1);

  p.CS.setNow(at(2026, 10, 10, 15, 10));   // Saturday, weekends off
  eq('Saturday has no today header while weekends are off', p.$$('#list .lp-day.is-today').length, 0);

  p.toggleWeekend(true);
  eq('with weekends on there are 7 day headers', p.$$('#list .lp-day').length, 7);
  eq('with weekends on Saturday becomes today', p.$$('#list .lp-day.is-today').length, 1);
  includes('the today header is Saturday', p.txt('#list .lp-day.is-today'), '\u5468\u516d');
  eq('Saturday has no classes, so the calm note is shown', p.$$('#list .lp-free').length, 1);
  includes('the calm note says there is nothing today', p.txt('#list .lp-free'), '\u4e00\u8282\u8bfe\u90fd\u6ca1\u6709');
  eq('Sunday is drawn too but is not today', !!(p.at('#list .lp-day', 6) && p.at('#list .lp-day', 6).classList.contains('is-today')), false);
  p.toggleWeekend(false);

  p.CS.gotoWeek(5);
  eq('looking at another week shows no today marker', p.$$('#list .lp-day.is-today').length, 0);
  p.dom.window.close();
}

/* ================================================ 4. the live status banner */

{
  const p = await makePage({ now: at(2026, 10, 5, 10, 20) });
  includes('banner says which class is running', p.tk(), '\u6b63\u5728\u4e0a');
  includes('banner names the course', p.tk(), '\u4eba\u5de5\u667a\u80fd\u4e0e\u8ba1\u7b97\u79d1\u5b66A');
  includes('banner names the room', p.tk(), '\u6587\u8403\u697cF302');
  includes('banner counts the minutes left', p.tk(), '120 \u5206\u949f');
  eq('progress bar is visible while a class runs', p.$('#tkProg').hidden, false);
  eq('progress bar has a width', p.$('#tkProgBar').style.width.length > 0, true);

  p.CS.setNow(at(2026, 10, 5, 13, 0));   // Monday lunch break: next is the 15:15 math class (weeks 1-16)
  includes('lunch break announces the next class', p.tk(), '\u4e0b\u4e00\u8282');
  includes('the next class is engineering math analysis', p.tk(), '\u5de5\u79d1\u6570\u5b66\u5206\u6790 I');
  includes('the next class is 2 hours 15 minutes away', p.tk(), '2 \u5c0f\u65f6 15 \u5206\u949f');
  includes('the next class period is spelled out', p.tk(), '\u7b2c8\u201310\u8282');
  eq('progress bar is hidden between classes', p.$('#tkProg').hidden, true);

  /* in weeks 1-8 there is also a Tuesday-evening drawing class, so at 14:30 on
     Tuesday the next class is only 45 minutes away (the short countdown branch) */
  p.CS.setNow(at(2026, 10, 6, 14, 30));
  includes('a short gap counts in plain minutes', p.tk(), '45 \u5206\u949f\u540e\u5f00\u59cb');
  p.CS.setNow(at(2026, 10, 5, 13, 0));

  p.CS.setNow(at(2026, 10, 10, 15, 10));   // Saturday
  includes('Saturday says there is no class today', p.tk(), '\u4eca\u5929');
  includes('Saturday banner names the weekday', p.tk(), '\u5468\u516d');

  p.CS.setNow(at(2027, 1, 20, 10, 0));   // after week 16
  includes('after the term the banner says it is over', p.tk(), '\u5b66\u671f\u7ed3\u675f');

  p.CS.setNow(at(2026, 8, 1, 10, 0));   // before week 1
  includes('before the term the banner counts down to week 1', p.tk(), '\u8fd8\u6ca1\u5f00\u5b66');
  p.dom.window.close();
}

/* ================================================ 5. walking between weeks */

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });   // week 3
  eq('label starts as the current week', p.wk(), '\u7b2c 3 \u5468 \u00b7 \u672c\u5468');
  eq('the back-to-now button is hidden on the current week', p.$('#wkBack').hidden, true);
  includes('the date range starts on Monday', p.rng(), '10/5');
  includes('the date range ends on Sunday', p.rng(), '10/11');

  p.click('#wkNext');
  eq('next goes to week 4', p.CS.displayWeek(), 4);
  eq('week 4 is not labelled as the current week', p.wk(), '\u7b2c 4 \u5468');
  eq('the back-to-now button appears', p.$('#wkBack').hidden, false);
  includes('week 4 range starts 10/12', p.rng(), '10/12');
  includes('week 4 range ends 10/18', p.rng(), '10/18');

  p.click('#wkPrev');
  p.click('#wkPrev');
  eq('two steps back is week 2', p.CS.displayWeek(), 2);
  p.click('#wkBack');
  eq('back-to-now returns to week 3', p.CS.displayWeek(), 3);
  eq('and the label says this week again', p.wk(), '\u7b2c 3 \u5468 \u00b7 \u672c\u5468');
  eq('and the back button hides again', p.$('#wkBack').hidden, true);

  p.CS.gotoWeek(1);
  eq('week 1 can still go back (the military weeks are before it)', p.$('#wkPrev').disabled, false);
  p.CS.gotoWeek(-3);
  eq('at minWeek the prev button is disabled', p.$('#wkPrev').disabled, true);
  p.CS.gotoWeek(16);
  eq('at the last week the next button is disabled', p.$('#wkNext').disabled, true);
  includes('the last week range is in January', p.rng(), '1/');
  p.dom.window.close();
}

/* ================================================= 6. list <-> grid switching */

{
  const p = await makePage({ now: at(2026, 10, 5, 10, 20) });
  p.click('#vtGrid');
  eq('switching to grid updates the state', p.CS.state.view, 'grid');
  eq('grid is visible', p.$('#board').hidden, false);
  eq('list is hidden', p.$('#list').hidden, true);
  ok('grid button is highlighted', p.$('#vtGrid').classList.contains('is-on'));
  ok('list button is no longer highlighted', !p.$('#vtList').classList.contains('is-on'));
  eq('week 3 draws 5 day columns', p.$$('#grid .gcol').length, 5);
  eq('and 5 day headers', p.$$('#dayHead .dh').length, 5);
  eq('and 10 course blocks', p.$$('#boardInner .blk').length, 10);
  ok('the hour rail has at least 12 ticks', p.$$('#rail .rt').length >= 12);
  eq('the now line is visible while looking at the current week', p.$('#nowLine').hidden, false);
  eq('exactly one block is live', p.$$('#boardInner .blk.is-now').length, 1);
  includes('the live block wears the badge', p.$('#boardInner .blk.is-now').textContent, '\u6b63\u5728\u4e0a');
  includes('blocks show the period text', p.$('#boardInner').textContent, '\u7b2c3\u20135\u8282');
  includes('blocks show the time span', p.$('#boardInner').textContent, '09:55\u201312:20');
  includes('blocks show the room', p.$('#boardInner').textContent, '\u6587\u8403\u697cF302');

  p.toggleWeekend(true);
  eq('with weekends on the grid has 7 columns', p.$$('#grid .gcol').length, 7);
  eq('and 7 day headers', p.$$('#dayHead .dh').length, 7);
  eq('two columns are weekend columns', p.$$('#grid .gcol.is-weekend').length, 2);
  eq('no weekend column has a course block', p.$$('#grid .gcol.is-weekend .blk').length, 0);

  p.click('#vtList');
  eq('switching back to list updates the state', p.CS.state.view, 'list');
  eq('list is visible again', p.$('#list').hidden, false);
  eq('grid is hidden again', p.$('#board').hidden, true);
  p.dom.window.close();
}

/* ======================================================= 7. course details */

{
  const p = await makePage({ now: at(2026, 10, 5, 10, 20) });
  p.click('#list .lp');
  eq('clicking a row opens the detail sheet', p.$('#detail').hidden, false);
  eq('the mask is up too', p.$('#detailMask').hidden, false);
  const dt = p.$('#detail').textContent.replace(/\s+/g, ' ');
  includes('detail has the course name', dt, '\u4eba\u5de5\u667a\u80fd\u4e0e\u8ba1\u7b97\u79d1\u5b66A');
  includes('detail has the course code', dt, 'CSE10001');
  includes('detail has the weekday and period', dt, '\u5468\u4e00 \u7b2c3\u20135\u8282');
  includes('detail has the exact times', dt, '09:55\u201312:20');
  includes('detail keeps the week range (it only left the list)', dt, '\u7b2c1\u201311\u5468');
  includes('detail has the room', dt, '\u6587\u8403\u697cF302');
  includes('detail says the course runs this week', dt, '\u8fd9\u5468\u8981\u4e0a');
  includes('detail says which week is being viewed', dt, '\u7b2c 3 \u5468');
  p.click('#dtClose');
  eq('the close button closes the detail sheet', p.$('#detail').hidden, true);
  eq('and the mask goes away', p.$('#detailMask').hidden, true);
  p.click('#list .lp');
  eq('reopening works', p.$('#detail').hidden, false);
  p.click('#detailMask');
  eq('clicking the mask closes it too', p.$('#detail').hidden, true);
  p.dom.window.close();
}

/* ================================================== 8. the appearance drawer */

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });
  p.click('#btnTheme');
  eq('the drawer opens', p.$('#sheet').hidden, false);
  eq('the mask is up', p.$('#sheetMask').hidden, false);
  eq('the legend lists one entry per colour number', p.$$('#keyRow .key-item').length, 10);
  eq('the vivid chip is the one lit at start', p.$('#themeChips .chip.is-on').getAttribute('data-theme'), 'vivid');
  eq('the system font chip is lit at start', p.$('#fontChips .chip.is-on').getAttribute('data-font'), 'system');
  eq('the list view chip is lit at start', p.$('#viewChips .chip.is-on').getAttribute('data-view'), 'list');

  p.chip('theme', 'midnight');
  eq('picking a theme re-renders the chips', p.$('#themeChips .chip.is-on').getAttribute('data-theme'), 'midnight');
  eq('picking a theme sets the html attribute', p.doc.documentElement.getAttribute('data-theme'), 'midnight');
  eq('only one theme chip stays lit', p.$$('#themeChips .chip.is-on').length, 1);

  p.chip('font', 'serif');
  eq('picking a font sets the html attribute', p.doc.documentElement.getAttribute('data-font'), 'serif');
  eq('only one font chip stays lit', p.$$('#fontChips .chip.is-on').length, 1);

  p.click('#fsPlus');
  eq('the plus button adds 5 percent', p.$('#fsVal').textContent, '105%');
  eq('and updates the range input', p.$('#fsRange').value, '105');
  p.click('#fsMinus');
  p.click('#fsMinus');
  eq('the minus button subtracts 5 percent twice', p.$('#fsVal').textContent, '95%');
  for (let i = 0; i < 20; i++) p.click('#fsPlus');
  eq('the font size is capped at 140', p.$('#fsVal').textContent, '140%');
  for (let i = 0; i < 30; i++) p.click('#fsMinus');
  eq('and floored at 85', p.$('#fsVal').textContent, '85%');
  for (let i = 0; i < 3; i++) p.click('#fsPlus');
  eq('back to 100 percent', p.$('#fsVal').textContent, '100%');

  p.chip('view', 'grid');
  eq('picking grid in the drawer switches the view', p.CS.state.view, 'grid');
  eq('and the board becomes visible', p.$('#board').hidden, false);
  p.chip('view', 'list');
  eq('picking list switches back', p.CS.state.view, 'list');

  p.toggleWeekend(true);
  eq('the weekend switch reaches the state', p.CS.state.weekend, true);

  p.click('#sheetDone');
  eq('the done button closes the drawer', p.$('#sheet').hidden, true);
  eq('and the mask goes with it', p.$('#sheetMask').hidden, true);
  p.dom.window.close();
}

/* ====================================== 9. backup and restore of the settings */

const BK_SETTINGS = { theme: 'nord', font: 'serif', fs: 120, view: 'grid', weekend: true };

function seedDefaults(p) {
  p.chip('theme', 'vivid');
  p.chip('font', 'system');
  p.chip('view', 'list');
  p.toggleWeekend(false);
  for (let i = 0; i < 10; i++) p.click('#fsMinus');
  eq('seeded settings are back at the defaults (size)', p.CS.state.fs, 85);
}

/** Drive the real controls until the state equals the wanted settings. */
function applyWanted(p, w) {
  p.chip('theme', w.theme);
  p.chip('font', w.font);
  p.chip('view', w.view);
  p.toggleWeekend(w.weekend);
  while (p.CS.state.fs < w.fs) p.click('#fsPlus');
  while (p.CS.state.fs > w.fs) p.click('#fsMinus');
}

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });
  p.click('#btnTheme');
  /* put the page into the wanted state first, then export that as the backup */
  applyWanted(p, BK_SETTINGS);
  const bk = p.CS.makeBackup();
  eq('a backup carries the right kind tag', bk.kind, 'class-schedule-settings');
  eq('a backup has a version', bk.version, 1);
  ok('a backup has an export time', typeof bk.exportedAt === 'string' && bk.exportedAt.length > 10);
  eq('a backup names the app', bk.app, '\u6211\u7684\u8bfe\u8868');
  /* the fingerprint must not carry any personal data -- the site is public */
  ok('the fingerprint carries no student number', bk.course.studentNo === undefined);
  eq('a backup carries the term label as a fingerprint', bk.course.termLabel, p.window.ScheduleData.META.termLabel);
  eq('a backup carries the first Monday', bk.course.firstMonday, '2026-09-21');
  eq('a backup carries the week count', bk.course.totalWeeks, 16);
  eq('the backup snapshot matches the state (theme)', bk.settings.theme, p.CS.state.theme);
  eq('the backup snapshot matches the state (font)', bk.settings.font, p.CS.state.font);
  eq('the backup snapshot matches the state (size)', bk.settings.fs, p.CS.state.fs);
  eq('the backup snapshot matches the state (view)', bk.settings.view, p.CS.state.view);
  eq('the backup snapshot matches the state (weekend)', bk.settings.weekend, p.CS.state.weekend);
  eq('the wanted settings really landed (theme)', bk.settings.theme, BK_SETTINGS.theme);
  eq('the wanted settings really landed (view)', bk.settings.view, BK_SETTINGS.view);

  /* the export button drops parseable JSON into the textarea */
  p.click('#bkExport');
  const boxed = p.$('#bkText').value;
  ok('the export button fills the textarea', boxed.length > 50);
  eq('the textarea content parses as the same kind', JSON.parse(boxed).kind, 'class-schedule-settings');

  /* the copy button, with a working clipboard */
  let copied = null;
  Object.defineProperty(p.window.navigator, 'clipboard', {
    value: { writeText: t => { copied = t; return Promise.resolve(); } }, configurable: true
  });
  p.click('#bkCopy');
  await new Promise(r => setTimeout(r, 20));
  ok('the copy button handed the backup to the clipboard', copied !== null);
  eq('the clipboard content is a real backup', JSON.parse(copied).kind, 'class-schedule-settings');

  /* scramble, then merge back */
  seedDefaults(p);
  ok('settings really changed before restoring',
    p.CS.state.theme !== bk.settings.theme || p.CS.state.view !== bk.settings.view);
  /* the real button path: paste into the textarea, then press the button */
  p.$('#bkText').value = JSON.stringify(bk);
  p.click('#bkMerge');
  const mergeMsg = p.txt('#bkMsg');
  eq('the merge reports itself in the message box', p.$('#bkMsg').hidden, false);
  includes('the merge message says it merged', mergeMsg, '\u5df2\u5408\u5e76');
  eq('merge brought the theme back', p.CS.state.theme, 'nord');
  eq('merge brought the font back', p.CS.state.font, 'serif');
  eq('merge brought the size back', p.CS.state.fs, 120);
  eq('merge brought the view back', p.CS.state.view, 'grid');
  eq('merge brought the weekend flag back', p.CS.state.weekend, true);
  eq('the restored view is what the page shows', p.$('#board').hidden, false);

  /* a restore must land in localStorage, not just in memory */
  const raw = p.window.localStorage.getItem('classSchedule.v1');
  ok('restoring wrote to localStorage', !!raw);
  eq('the stored theme is the restored one', JSON.parse(raw).theme, 'nord');
  eq('the stored view is the restored one', JSON.parse(raw).view, 'grid');
  eq('the stored size is the restored one', JSON.parse(raw).fs, 120);
  eq('the stored weekend flag is the restored one', JSON.parse(raw).weekend, true);

  /* bad backups must complain and must not touch anything */
  const before = JSON.stringify(p.CS.makeBackup().settings);
  const bad = [
    ['empty text', '', '\u8fd8\u6ca1\u6709\u5185\u5bb9'],
    ['broken json', '{oops', 'JSON'],
    ['wrong kind', JSON.stringify({ kind: 'someone-elses-app', settings: BK_SETTINGS }), '\u770b\u8d77\u6765\u4e0d\u662f'],
    ['no settings', JSON.stringify({ kind: 'class-schedule-settings', version: 1 }), '\u6ca1\u6709\u8bbe\u7f6e']
  ];
  for (const [label, text, needle] of bad) {
    const r = p.CS.parseBackup(text);
    eq('bad backup (' + label + ') is rejected', r.ok, false);
    includes('bad backup (' + label + ') explains why', r.error, needle);
  }
  eq('bad backups did not touch the settings', JSON.stringify(p.CS.makeBackup().settings), before);

  /* half-good backup: known keys applied, silly size dropped and reported */
  const halfText = JSON.stringify({
    kind: 'class-schedule-settings', version: 1,
    settings: { theme: 'midnight', view: 'list', fs: 999, nonsense: 1 }
  });
  const half = p.CS.parseBackup(halfText);
  eq('half-good backup is accepted', half.ok, true);
  eq('half-good backup keeps the theme', half.settings.theme, 'midnight');
  eq('half-good backup keeps the view', half.settings.view, 'list');
  eq('half-good backup drops the silly font size', half.settings.fs, undefined);
  ok('half-good backup reports the dropped size', half.dropped.indexOf('\u5b57\u53f7') >= 0);
  ok('half-good backup does not claim the theme was dropped', half.dropped.indexOf('\u914d\u8272') < 0);
  ok('half-good backup ignores the unknown key silently', half.dropped.indexOf('nonsense') < 0);
  const sizeBefore = p.CS.state.fs;
  p.$('#bkText').value = halfText;
  p.click('#bkMerge');
  eq('half-good restore applied the theme', p.CS.state.theme, 'midnight');
  eq('half-good restore applied the view', p.CS.state.view, 'list');
  eq('half-good restore ignored the silly font size', p.CS.state.fs, sizeBefore);
  includes('the merge message lists the dropped key', p.$('#bkMsg').textContent, '\u4e0d\u8ba4\u8bc6');

  /* a backup from another term: usable, but it says so */
  const other = p.CS.parseBackup(JSON.stringify({
    kind: 'class-schedule-settings', version: 1, app: '\u6211\u7684\u8bfe\u8868',
    course: { termLabel: '\u0032\u0030\u0032\u0035-\u0032\u0030\u0032\u0036\u5b66\u5e74 \u7b2c\u4e00\u5b66\u671f', firstMonday: '2025-09-01', totalWeeks: 16 },
    settings: { theme: 'nord', font: 'hei', fs: 110, view: 'list', weekend: true }
  }));
  eq('a backup from another term still parses', other.ok, true);
  ok('and it warns that the term looks different', !!other.note && other.note.length > 0);
  eq('a backup with no fingerprint at all is fine too', p.CS.parseBackup(JSON.stringify({
    kind: 'class-schedule-settings', version: 1, settings: { theme: 'nord' }
  })).ok, true);

  /* replace asks first */
  p.$('#bkText').value = JSON.stringify(bk);
  let asked = null;
  p.window.confirm = msg => { asked = msg; return false; };
  const themeBefore = p.CS.state.theme;
  p.click('#bkReplace');
  ok('replace asks for confirmation', asked !== null && asked.length > 0);
  eq('cancelling replace changes nothing', p.CS.state.theme, themeBefore);
  p.window.confirm = () => true;
  p.click('#bkReplace');
  eq('confirming replace succeeds', p.$('#bkMsg').hidden, false);
  includes('replace says it replaced', p.$('#bkMsg').textContent, '\u5df2\u7528\u5907\u4efd\u66ff\u6362');
  eq('replace applied the backup theme', p.CS.state.theme, 'nord');
  eq('replace applied the backup weekend flag', p.CS.state.weekend, true);
  p.dom.window.close();
}

/* the clipboard-denied path */
{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });
  p.click('#btnTheme');
  Object.defineProperty(p.window.navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true
  });
  p.click('#bkCopy');
  await new Promise(r => setTimeout(r, 20));
  eq('a denied clipboard still says something', p.$('#bkMsg').hidden, false);
  includes('the fallback message mentions copying by hand', p.$('#bkMsg').textContent, '\u590d\u5236');
  p.dom.window.close();
}

/* ============================================ 10. the nav bar fitting probe */

{
  const p = await makePage({ now: at(2026, 10, 10, 15, 10) });
  const label = p.$('#wkLabel');
  const wk = label.closest('.wk');
  const mid = label.closest('.wk-mid');
  const range = p.$('#wkRange');

  /* jsdom lays nothing out, so answer every probe from a text -> width table */
  const WIDTH_BY_TEXT = new Map([[label.textContent, 98], [range.textContent, 60]]);
  p.window.Element.prototype.getBoundingClientRect = function () {
    const w = WIDTH_BY_TEXT.has(this.textContent) ? WIDTH_BY_TEXT.get(this.textContent) : 0;
    return { width: w, height: w ? 20 : 0, top: 0, left: 0, right: w, bottom: 20 };
  };
  Object.defineProperty(range, 'offsetWidth', { value: 60, configurable: true });
  const setAvail = n => Object.defineProperty(mid, 'clientWidth', { value: n, configurable: true });
  const setLabelBox = (scroll, client) => {
    Object.defineProperty(label, 'scrollWidth', { value: scroll, configurable: true });
    Object.defineProperty(label, 'clientWidth', { value: client, configurable: true });
  };

  setAvail(120);            /* 120 - 6 = 114 < 98 + 60 + gaps */
  setLabelBox(98, 98);
  p.CS.fitWeekDate();
  eq('narrow bar: the date is folded away', wk.classList.contains('no-date'), true);

  setAvail(300);            /* plenty of room */
  setLabelBox(98, 98);
  p.CS.fitWeekDate();
  eq('wide bar: the date comes back', wk.classList.contains('no-date'), false);

  setAvail(300);
  setLabelBox(200, 98);     /* the text really is clipped */
  p.CS.fitWeekDate();
  eq('clipped label: the date is folded away', wk.classList.contains('no-date'), true);

  setAvail(60);
  setLabelBox(98, 98);
  p.CS.fitWeekDate();
  eq('very narrow bar: the date is folded away', wk.classList.contains('no-date'), true);

  includes('the CSS keeps the fold rule', css, '.wk.no-date .wk-now span');
  p.dom.window.close();
}

/* ============================================ 11. settings survive a reload */

{
  const p1 = await makePage({ now: at(2026, 10, 10, 15, 10) });
  p1.click('#btnTheme');
  p1.chip('theme', 'nord');
  p1.chip('font', 'hei');
  p1.chip('view', 'grid');
  for (let i = 0; i < 3; i++) p1.click('#fsPlus');
  p1.toggleWeekend(true);

  const dumped = {};
  for (let i = 0; i < p1.window.localStorage.length; i++) {
    const k = p1.window.localStorage.key(i);
    dumped[k] = p1.window.localStorage.getItem(k);
  }
  const stored = JSON.parse(dumped['classSchedule.v1'] || '{}');
  eq('theme was stored', stored.theme, 'nord');
  eq('font was stored', stored.font, 'hei');
  eq('view was stored', stored.view, 'grid');
  eq('size was stored', stored.fs, 115);
  eq('weekend flag was stored', stored.weekend, true);

  /* a second page sharing the same storage must read all of it back */
  const shared = {
    getItem: k => (k in dumped ? dumped[k] : null),
    setItem: (k, v) => { dumped[k] = String(v); },
    removeItem: k => { delete dumped[k]; },
    key: i => Object.keys(dumped)[i] || null,
    get length() { return Object.keys(dumped).length; }
  };
  const p2 = await makePage({ now: at(2026, 10, 10, 15, 10), localStorage: shared });
  eq('reload keeps the theme', p2.doc.documentElement.getAttribute('data-theme'), 'nord');
  eq('reload keeps the font', p2.doc.documentElement.getAttribute('data-font'), 'hei');
  eq('reload keeps the view', p2.CS.state.view, 'grid');
  eq('reload keeps the weekend flag', p2.CS.state.weekend, true);
  eq('reload keeps the font size', p2.CS.state.fs, 115);
  eq('reload shows the grid, not the list', p2.$('#board').hidden, false);
  eq('reload hides the list', p2.$('#list').hidden, true);
  eq('reload shows no storage warning', p2.$('#storageWarn').hidden, true);

  /* junk in storage falls back to the defaults without exploding */
  const junkStore = {
    getItem: () => JSON.stringify({ theme: 'not-a-theme', fs: 'big', view: 42, weekend: 'yes' }),
    setItem: () => {},
    removeItem: () => {}
  };
  const p3 = await makePage({ now: at(2026, 10, 10, 15, 10), localStorage: junkStore });
  eq('junk settings fall back to the default theme (vivid)', p3.CS.state.theme, 'vivid');
  eq('junk settings fall back to the default font', p3.CS.state.font, 'system');
  eq('junk settings fall back to the default size', p3.CS.state.fs, 100);
  eq('junk settings fall back to the default view', p3.CS.state.view, 'list');
  eq('junk settings fall back to the default weekend flag', p3.CS.state.weekend, false);
  p1.dom.window.close();
  p2.dom.window.close();
  p3.dom.window.close();
}

/* ================================================= 12. storage that refuses */

{
  const dead = {
    getItem() { return null; },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() {}
  };
  const p = await makePage({ now: at(2026, 10, 10, 15, 10), localStorage: dead });
  eq('a dead localStorage still renders the page', p.$$('#list .lp').length, 10);
  eq('and raises the warning bar (never silently)', p.$('#storageWarn').hidden, false);
  const warn = p.$('#storageWarn').textContent;
  ok('the warning bar says something readable', warn.length > 10);
  includes('the warning bar promises the page still works', warn, '\u9875\u9762\u80fd\u7528');
  eq('the app knows storage is broken', p.CS.state.storageOk, false);
  p.dom.window.close();
}

/* ==================================================================== report */

const total = pass + fails.length;
if (fails.length) {
  console.log('');
  console.log('UI smoke test FAILED: ' + pass + '/' + total);
  fails.forEach(f => console.log('  x ' + f));
  process.exit(1);
}
console.log('UI smoke test passed: ' + pass + '/' + total);
process.exit(0);
