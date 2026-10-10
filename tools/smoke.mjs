/* ===========================================================================
 * smoke.mjs —— 纯逻辑冒烟测试（不开浏览器）
 *
 * 跑法：node tools/smoke.mjs
 *
 * 测的是 data.js（数据本身有没有错）+ course-core.js（日期/周次/节次/布局算得对不对）。
 * 这两个文件都不碰 DOM，所以可以直接 require 进 node 跑。
 *
 * 原则：不许写"永远为真"的假断言。每条关键断言都反向验证过一次 —— 临时把对应的
 *       代码改坏确认它会变红，再改回来（见 README 的"测试"一节）。
 * ===========================================================================
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');

/** 把 src 下的文件装进一个干净的沙盒（模拟浏览器里的 window） */
function loadSandbox() {
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(src, 'data.js'), 'utf8'), sb, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(src, 'course-core.js'), 'utf8'), sb, { filename: 'course-core.js' });
  return sb;
}

const SB = loadSandbox();
const D = SB.ScheduleData;
const C = SB.CourseCore;
const META = D.META;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else fails.push(name + (extra ? '  →  ' + extra : ''));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(name, threw, '本该报错却没有');
}
/** 本地时间构造，别用 Date.parse('YYYY-MM-DD')（那是 UTC，东八区会偏一天） */
const day = (y, m, d) => new Date(y, m - 1, d);
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0);
/** 按课程号 + 星期 + 起始小节找一条安排 */
const find = (code, weekday, fp) => D.COURSES.filter(
  (c) => c.code === code && c.weekday === weekday && c.firstPeriod === fp)[0];

/* =========================================================== 1. 数据本身对不对 */

{
  eq('学校', META.school, '北京理工大学');
  eq('学期名', META.termLabel, '2026-2027学年 第一学期');
  ok('页面要传公开网页，元信息里不能有姓名学号', META.student === undefined && META.studentNo === undefined);
  eq('第 1 周周一 = 2026-09-21（用户确认 10.5–10.11 是第 3 周）', META.firstMonday, '2026-09-21');
  eq('一学期 16 周', META.totalWeeks, 16);
  ok('firstMonday 必须是合法 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(META.firstMonday));

  eq('13 个小节', D.PERIODS.length, 13);
  D.PERIODS.forEach(function (p, i) {
    eq('第 ' + (i + 1) + ' 小节的 no 连号', p.no, i + 1);
  });
  /* 每小节必须"下课时间 > 上课时间"，而且不许两小节时间重叠（同一节课不能同时上两门） */
  let orderOk = true, overlapOk = true;
  for (let i = 0; i < D.PERIODS.length; i++) {
    const p = D.PERIODS[i];
    if (!(p.to > p.from)) orderOk = false;
    if (i > 0 && p.from < D.PERIODS[i - 1].to) overlapOk = false;
  }
  ok('每小节都是 to > from', orderOk);
  ok('相邻小节时间不重叠（不会有物理上讲不通的作息）', overlapOk);

  /* 作息必须和"北京理工大学上课时间表"那张图完全一致 */
  const expected = [
    '08:00–08:45', '08:50–09:35', '09:55–10:40', '10:45–11:30', '11:35–12:20',
    '13:20–14:05', '14:10–14:55', '15:15–16:00', '16:05–16:50', '16:55–17:40',
    '18:30–19:15', '19:20–20:05', '20:10–20:55'
  ];
  eq('作息和学校表格逐条一致', D.PERIODS.map((p) => p.label).join('|'), expected.join('|'));

  /* label 必须真的等于 from/to 算出来的时间，防止手抖写错 */
  let labelOk = true;
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  D.PERIODS.forEach(function (p) {
    if (p.label !== hhmm(p.from) + '–' + hhmm(p.to)) labelOk = false;
  });
  ok('每条的 label 和 from/to 自洽', labelOk);

  /* 14 条课程安排：10 门课里，工程制图C / 工科数学分析 I 各排了两次，
   * 国家安全概论拆成三条（同一门课三次不同周次），所以是 14 条而不是 10 条 */
  eq('14 条课程安排', D.COURSES.length, 14);
  eq('10 门不同的课', new Set(D.COURSES.map((c) => c.code)).size, 10);
  eq('3 条"时间待定"的课', D.PENDING.length, 3);
  eq('用户要求：时间待定的课不显示', D.SHOW_PENDING, false);

  /* 每条课程安排都得是合法的 */
  D.COURSES.forEach(function (c, i) {
    const tag = '第 ' + (i + 1) + ' 条（' + c.name + '）';
    ok(tag + ' 有课程号', !!c.code);
    ok(tag + ' 有课名', !!c.name);
    ok(tag + ' weekday 在 1~7', c.weekday >= 1 && c.weekday <= 7);
    ok(tag + ' firstPeriod <= lastPeriod', c.firstPeriod <= c.lastPeriod);
    ok(tag + ' 节次在 1~13 范围内', c.firstPeriod >= 1 && c.lastPeriod <= 13);
    ok(tag + ' 有地点', !!c.room);
    ok(tag + ' weekFrom/weekTo 都是数字', typeof c.weekFrom === 'number' && typeof c.weekTo === 'number');
    ok(tag + ' weekFrom <= weekTo', c.weekFrom <= c.weekTo);
    ok(tag + ' 有 short 短名', !!c.short);
  });

  /* 配色：同一门课必须同色，且不同课不许撞色 */
  const byCode = {};
  D.COURSES.forEach(function (c) { (byCode[c.code] = byCode[c.code] || []).push(c); });
  const colorOfCode = (code) => D.colorOf(code);
  ok('同一门课的所有安排拿到同一个颜色号',
    Object.keys(byCode).every(function (code) {
      return byCode[code].every(function (c) { return colorOfCode(c.code) === colorOfCode(byCode[code][0].code); });
    }));
  eq('工程制图C（周一/周二两条）同色', colorOfCode('MHE10001'), colorOfCode('MHE10001'));
  eq('工科数学分析 I（周一/周三两条）同色', colorOfCode('MTH10003'), colorOfCode('MTH10003'));
  const codes = Object.keys(byCode);
  const nums = codes.map(colorOfCode);
  eq('10 门不同的课', codes.length, 10);
  eq('10 个颜色号互不重复', new Set(nums).size, 10);
  ok('颜色号都在 1~10（4 套配色每套都只有 10 个色）',
    nums.every(function (n) { return n >= 1 && n <= 10; }));
  eq('没登记过的课程号也有兜底色，不会 undefined', typeof D.colorOf('XXX9999'), 'number');

  /* 数据里最要紧的几条，逐字对一遍 PDF（防止改数据时手滑） */
  const ai = find('CSE10001', 1, 3);
  ok('人工智能与计算科学A：周一第3-5节', !!ai && ai.lastPeriod === 5);
  eq('人工智能与计算科学A：1-11周', ai.weekFrom + '-' + ai.weekTo, '1-11');
  eq('人工智能与计算科学A：文萃楼F302', ai.room, '文萃楼F302');

  const psy = find('PSY10001', 1, 11);
  eq('大学生心理素质发展：周一第11-13节', psy.firstPeriod + '-' + psy.lastPeriod, '11-13');
  eq('大学生心理素质发展：1-6周', psy.weekFrom + '-' + psy.weekTo, '1-6');
  eq('大学生心理素质发展：理教楼302', psy.room, '理教楼302');

  const gym = find('SPOG0005', 2, 3);
  eq('体育/篮球：周二第3-4节', gym.firstPeriod + '-' + gym.lastPeriod, '3-4');
  eq('体育/篮球：1-16周', gym.weekFrom + '-' + gym.weekTo, '1-16');
  eq('体育/篮球：南校区篮球场', gym.room, '南校区篮球场');

  /* 国家安全概论是同一门课拆成三条，三条都必须是不同的周 */
  const saf = D.COURSES.filter((c) => c.code === 'SAF10601');
  eq('国家安全概论拆成 3 条', saf.length, 3);
  eq('三条分别在 10/13/14 周', saf.map((c) => c.weekFrom).join(','), '10,13,14');
  ok('三条都在周五', saf.every((c) => c.weekday === 5));
  ok('三条都在理教楼105', saf.every((c) => c.room === '理教楼105'));

  /* 军事技能在第 -3、-2 周，所以 minWeek 必须是负的 */
  eq('minWeek = -3（军事技能在第 -3、-2 周）', META.minWeek, -3);
  eq('maxWeek = 16', META.maxWeek, 16);
  eq('军事技能确实记在 -3 ~ -2 周周',
    D.PENDING.filter((p) => p.code === 'MIL10002')[0].weekFrom + '~' +
    D.PENDING.filter((p) => p.code === 'MIL10002')[0].weekTo, '-3~-2');

  /* 没有课的"空白事实"：周六周日一条都没有 */
  ok('数据里没有任何周六/周日的课', D.COURSES.every((c) => c.weekday <= 5));
}

/* ============================================================ 2. 日期与周次 */

{
  eq('解析 YYYY-MM-DD 得到本地午夜', C.ymd(C.parseYmd('2026-09-21')), '2026-09-21');
  throws('格式不对直接抛错（不静默给个 Invalid Date）', () => C.parseYmd('2026-9-21'));
  throws('空字符串也抛错', () => C.parseYmd(''));

  eq('第 1 周周一', C.ymd(C.mondayOfWeek(META, 1)), '2026-09-21');
  eq('第 3 周周一 = 10/5', C.ymd(C.mondayOfWeek(META, 3)), '2026-10-05');
  eq('第 16 周周一 = 2027-01-04', C.ymd(C.mondayOfWeek(META, 16)), '2027-01-04');
  eq('第 0 周（开学前）周一 = 2026-09-14', C.ymd(C.mondayOfWeek(META, 0)), '2026-09-14');
  eq('第 -3 周周一 = 8/24（比第 1 周早 4 周）', C.ymd(C.mondayOfWeek(META, -3)), '2026-08-24');

  /* 用户确认过：10/5–10/11 是第 3 周 */
  eq('10/5 是第 3 周周一', C.weekOf(META, day(2026, 10, 5)).week, 3);
  eq('10/11 是第 3 周周日', C.weekOf(META, day(2026, 10, 11)).week, 3);
  eq('9/21 是第 1 周周一', C.weekOf(META, day(2026, 9, 21)).week, 1);
  eq('9/27 是第 1 周周日', C.weekOf(META, day(2026, 9, 27)).week, 1);
  eq('9/20 是第 0 周（开学前一天）', C.weekOf(META, day(2026, 9, 20)).week, 0);
  eq('第 16 周最后一天 2027-01-10', C.weekOf(META, day(2027, 1, 10)).week, 16);
  eq('2027-01-11 已经超出 16 周', C.weekOf(META, day(2027, 1, 11)).week, 17);

  eq('开学前 status = before', C.weekOf(META, day(2026, 9, 1)).status, 'before');
  eq('第 1 周 status = in', C.weekOf(META, day(2026, 9, 21)).status, 'in');
  eq('第 16 周 status = in', C.weekOf(META, day(2027, 1, 4)).status, 'in');
  eq('放假后 status = after', C.weekOf(META, day(2027, 1, 11)).status, 'after');

  /* 跨年、跨月、闰年都要对 */
  eq('跨年：12/31 → 1/1 差 1 天', C.daysBetween(day(2026, 12, 31), day(2027, 1, 1)), 1);
  eq('闰年 2028-02-28 → 02-29 差 1 天', C.daysBetween(day(2028, 2, 28), day(2028, 2, 29)), 1);
  eq('平年 2027-02-28 → 03-01 差 1 天', C.daysBetween(day(2027, 2, 28), day(2027, 3, 1)), 1);
  eq('往回算天数是负的', C.daysBetween(day(2026, 10, 11), day(2026, 10, 5)), -6);
  eq('同一天差 0 天', C.daysBetween(day(2026, 10, 5), day(2026, 10, 5)), 0);
  eq('加了 7 天正好是下一周同一天', C.ymd(C.addDays(day(2026, 10, 5), 7)), '2026-10-12');
  eq('减 7 天也能往回走', C.ymd(C.addDays(day(2026, 10, 5), -7)), '2026-09-28');

  /* 周日属于上一周（这是排周次最容易错的地方） */
  eq('周日 10/11 对齐到周一 10/5', C.ymd(C.mondayOf(day(2026, 10, 11))), '2026-10-05');
  eq('周一自己对齐到自己', C.ymd(C.mondayOf(day(2026, 10, 5))), '2026-10-05');
  eq('周六 10/10 对齐到周一 10/5', C.ymd(C.mondayOf(day(2026, 10, 10))), '2026-10-05');
  eq('跨月的周日 11/1 对齐到 10/26', C.ymd(C.mondayOf(day(2026, 11, 1))), '2026-10-26');

  eq('日期显示成 10/5', C.fmtMd(day(2026, 10, 5)), '10/5');
  eq('个位月份不补零（界面上就是这么写的）', C.fmtMd(day(2027, 1, 4)), '1/4');

  /* 时间轴上取百分比：起始是 0%，终点是 100% */
  const R = C.timelineRange(D.PERIODS);
  eq('时间轴从 08:00 开始', R.from, 8 * 60);
  eq('时间轴到 20:55 结束', R.to, 20 * 60 + 55);
  eq('时间轴总长 = 12 小时 55 分', R.total, 12 * 60 + 55);
  eq('起点是 0%', C.pct(R.from, R), 0);
  eq('终点是 100%', C.pct(R.to, R), 100);
  ok('中间点落在 0~100 之间', C.pct(14 * 60, R) > 40 && C.pct(14 * 60, R) < 60);
}

/* ======================================================== 3. 节次与起止时间 */

{
  eq('第 3 小节从 09:55 开始', C.periodAt(D.PERIODS, 3).from, 9 * 60 + 55);
  eq('第 5 小节到 12:20 结束', C.periodAt(D.PERIODS, 5).to, 12 * 60 + 20);
  throws('没有第 14 小节，必须抛错而不是默默给个 undefined', () => C.periodAt(D.PERIODS, 14));
  throws('第 0 小节也不存在', () => C.periodAt(D.PERIODS, 0));

  /* 一节 = 45 分钟；跨小节连排时首尾要对 */
  const one = C.spanOf(D.PERIODS, { firstPeriod: 3, lastPeriod: 3 });
  eq('单节：09:55', one.from, 9 * 60 + 55);
  eq('单节：10:40 下课', one.to, 10 * 60 + 40);
  eq('单节一共 45 分钟', one.to - one.from, 45);
  eq('单节的文字就是它自己的 label', one.text, '09:55–10:40');

  const three = C.spanOf(D.PERIODS, { firstPeriod: 3, lastPeriod: 5 });
  eq('第3-5节：09:55 开始', three.text.split('–')[0], '09:55');
  eq('第3-5节：12:20 结束', three.text.split('–')[1], '12:20');
  eq('第3-5节一共 145 分钟（中间有课间）', three.to - three.from, 145);

  const eve = C.spanOf(D.PERIODS, { firstPeriod: 11, lastPeriod: 13 });
  eq('第11-13节：18:30–20:55', eve.text, '18:30–20:55');
  eq('第11-13节一共 145 分钟', eve.to - eve.from, 145);

  const eight = C.spanOf(D.PERIODS, { firstPeriod: 6, lastPeriod: 7 });
  eq('第6-7节：13:20–14:55', eight.text, '13:20–14:55');
  eq('第6-7节一共 95 分钟', eight.to - eight.from, 95);

  const eightNine = C.spanOf(D.PERIODS, { firstPeriod: 8, lastPeriod: 9 });
  eq('第8-9节：15:15–16:50', eightNine.text, '15:15–16:50');

  eq('节次写法：第3–5节', C.periodText({ firstPeriod: 3, lastPeriod: 5 }), '第3–5节');
  eq('单节写法：第8节', C.periodText({ firstPeriod: 8, lastPeriod: 8 }), '第8节');

  eq('周次写法：第1–11周', C.weekText({ weekFrom: 1, weekTo: 11 }), '第1–11周');
  eq('单周写法：第10周', C.weekText({ weekFrom: 10, weekTo: 10 }), '第10周');
  eq('时间待定就这么写', C.weekText({ weekFrom: null, weekTo: null }), '时间待定');
}

/* ================================================== 4. 某周到底上哪些课（核心） */

{
  const days5 = [1, 2, 3, 4, 5];

  eq('第 1 周周一的课都算上', C.coursesOn(META, D.COURSES, 1, 1).length, 3);
  eq('第 1 周周一第一节是人工智能', C.coursesOn(META, D.COURSES, 1, 1)[0].code, 'CSE10001');
  eq('同一天按节次从早到晚排',
    C.coursesOn(META, D.COURSES, 1, 1).map((c) => c.firstPeriod).join(','), '3,8,11');

  /* 周次边界：第 11 周是人工智能最后一周，第 12 周就没了 */
  eq('第 11 周周一还有人工智能', C.coursesOn(META, D.COURSES, 11, 1).some((c) => c.code === 'CSE10001'), true);
  eq('第 12 周周一没有人工智能了', C.coursesOn(META, D.COURSES, 12, 1).some((c) => c.code === 'CSE10001'), false);
  eq('第 12 周周一还剩工科数学分析', C.coursesOn(META, D.COURSES, 12, 1).length, 1);

  /* 第 6 周是心理课最后一周 */
  eq('第 6 周周一有心理课', C.coursesOn(META, D.COURSES, 6, 1).some((c) => c.code === 'PSY10001'), true);
  eq('第 7 周周一没有心理课', C.coursesOn(META, D.COURSES, 7, 1).some((c) => c.code === 'PSY10001'), false);
  eq('第 7 周周一只剩 2 门（人工智能 + 工科数学）', C.coursesOn(META, D.COURSES, 7, 1).length, 2);

  /* 第 8 周是工程制图/电子信息的最后一周，第 9 周开始新时代实践教育 */
  eq('第 8 周周三有电子信息导论', C.coursesOn(META, D.COURSES, 8, 3).some((c) => c.code === 'RXA10001'), true);
  eq('第 9 周周三没有电子信息导论', C.coursesOn(META, D.COURSES, 9, 3).some((c) => c.code === 'RXA10001'), false);
  eq('第 9 周周三多了新时代实践教育', C.coursesOn(META, D.COURSES, 9, 3).some((c) => c.code === 'MAR10003'), true);
  eq('第 8 周周三还没有新时代实践教育', C.coursesOn(META, D.COURSES, 8, 3).some((c) => c.code === 'MAR10003'), false);

  /* 国家安全概论：只有 10、13、14 周的周五有 */
  const safWeeks = [9, 10, 11, 12, 13, 14, 15].filter(
    (w) => C.coursesOn(META, D.COURSES, w, 5).some((c) => c.code === 'SAF10601'));
  eq('国家安全概论只在 10、13、14 周的周五', safWeeks.join(','), '10,13,14');

  /* 负数周 / 假期周：不许崩，也不许凭空变出课 */
  eq('第 0 周（开学前）一节课都没有', C.countInWeek(META, D.COURSES, 0, days5), 0);
  eq('第 -3 周（军训周）没有正式课', C.countInWeek(META, D.COURSES, -3, days5), 0);
  eq('第 17 周（放假）没有课', C.countInWeek(META, D.COURSES, 17, days5), 0);
  eq('第 16 周还有 5 门课', C.countInWeek(META, D.COURSES, 16, days5), 5);

  eq('weekGrid 给每一天都建了格子', Object.keys(C.weekGrid(META, D.COURSES, 1, days5)).length, 5);
  eq('第 1 周共 10 节', C.countInWeek(META, D.COURSES, 1, days5), 10);
  eq('第 3 周共 10 节', C.countInWeek(META, D.COURSES, 3, days5), 10);
  /* 第 7 周心理素质发展（1-6 周）结束了，周一只剩 2 门 */
  eq('第 7 周共 9 节', C.countInWeek(META, D.COURSES, 7, days5), 9);
  /* 第 12 周：人工智能（1-11）结束、实践教育（9-13）还在 → 周一 1 + 周三 2 + 周四 1 + 周五 2 */
  eq('第 12 周共 6 节', C.countInWeek(META, D.COURSES, 12, days5), 6);
  eq('第 15 周共 5 节（人工智能和实践教育都结束了）', C.countInWeek(META, D.COURSES, 15, days5), 5);

  /* 周六周日打开显示也还是没课 */
  eq('带周末一起数，第 3 周还是 10 节', C.countInWeek(META, D.COURSES, 3, [1, 2, 3, 4, 5, 6, 7]), 10);
  eq('周六没课', C.coursesOn(META, D.COURSES, 3, 6).length, 0);
  eq('周日没课', C.coursesOn(META, D.COURSES, 3, 7).length, 0);

  /* 找下一个有课的周 */
  eq('从第 0 周往后找 → 第 1 周', C.nextWeekWithClass(META, D.COURSES, 0, days5), 1);
  eq('第 12 周自己就有课 → 还是 12', C.nextWeekWithClass(META, D.COURSES, 12, days5), 12);
  eq('第 17 周往后找不到 → null', C.nextWeekWithClass(META, D.COURSES, 17, days5), null);

  eq('activeInWeek：第 5 周人工智能要上', C.activeInWeek(find('CSE10001', 1, 3), 5), true);
  eq('activeInWeek：第 12 周人工智能不上', C.activeInWeek(find('CSE10001', 1, 3), 12), false);
  eq('activeInWeek：时间待定的课永远返回 false',
    C.activeInWeek({ weekFrom: null, weekTo: null }, 3), false);
}

/* ========================================================= 5. 现在正在上什么课 */

{
  /* 周一 10/5，人工智能 09:55–12:20 */
  const inAi = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 10, 20));
  eq('10/5 10:20 在第 3 周', inAi.week, 3);
  eq('10/5 是周一', inAi.weekday, 1);
  eq('正在上人工智能', inAi.current && inAi.current.code, 'CSE10001');
  eq('下一节是工科数学分析（15:15）', inAi.next && inAi.next.code, 'MTH10003');
  ok('进度在 0~1 之间', inAi.progress > 0 && inAi.progress < 1);
  eq('进度算给界面用：10:20 起步 25 分钟 / 共 145 分钟',
    Math.round(inAi.progress * 145), 25);
  eq('今天周一一共 3 门课', inAi.today.length, 3);

  /* 上课前一分钟：还没开始，应该是"下一节" */
  const before = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 9, 54));
  eq('09:54 还没开始上 → current 是 null', before.current, null);
  eq('09:54 下一秒要上的是人工智能', before.next && before.next.code, 'CSE10001');

  /* 刚好开始的那一分钟算"正在上" */
  const exactStart = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 9, 55));
  eq('09:55 整算正在上', exactStart.current && exactStart.current.code, 'CSE10001');
  eq('刚上课进度是 0', exactStart.progress, 0);

  /* 下课那一分钟算"已经下课了"（左闭右开） */
  const exactEnd = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 12, 20));
  eq('12:20 已经下课 → current 是 null', exactEnd.current, null);
  eq('12:20 下一节是下午的工科数学分析', exactEnd.next && exactEnd.next.code, 'MTH10003');

  /* 课间：哪节都不算"正在上" */
  const gap = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 12, 30));
  eq('12:30 是午休 → 没有正在上的课', gap.current, null);
  eq('12:30 下一节是 15:15 的工科数学分析', gap.next && gap.next.code, 'MTH10003');

  /* 一天的课全上完了 */
  const done = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 5, 21, 30));
  eq('21:30 今天上完了 → current 是 null', done.current, null);
  eq('21:30 也没有下一节了', done.next, null);

  /* 周六：整天都没课 */
  const sat = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 10, 15, 10));
  eq('周六 15:10 没有正在上的课', sat.current, null);
  eq('周六也没有下一节', sat.next, null);
  eq('周六属于第 3 周', sat.week, 3);
  eq('周六 weekday 算 6', sat.weekday, 6);
  eq('周六今天的课是空的', sat.today.length, 0);

  /* 周日必须算成 7（JS 的 getDay() 给 0，这里是最容易写错的地方） */
  const sun = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 11, 10, 0));
  eq('周日 weekday 算 7，不是 0', sun.weekday, 7);
  eq('周日属于第 3 周（不是第 4 周）', sun.week, 3);

  /* 开学前 / 放假后 */
  const beforeTerm = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 9, 1, 10, 0));
  eq('开学前 status = before', beforeTerm.status, 'before');
  eq('开学前没有正在上的课', beforeTerm.current, null);
  const afterTerm = C.nowStatus(META, D.PERIODS, D.COURSES, at(2027, 2, 1, 10, 0));
  eq('放假后 status = after', afterTerm.status, 'after');
  eq('放假后没有正在上的课', afterTerm.current, null);

  /* 第 6 周周一的晚课：心理素质 18:30–20:55（1-6 周） */
  const wk6 = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 26, 19, 0));
  eq('10/26 是第 6 周', wk6.week, 6);
  eq('第 6 周周一 19:00 正在上心理素质发展', wk6.current && wk6.current.code, 'PSY10001');
  eq('这时下一节没有了（一天就这三门）', wk6.next, null);
  eq('第 6 周周一 19:00 进度过半', Math.round(wk6.progress * 100), 21);

  /* 下一周同一时刻：心理课结束了，晚上就空着 —— 这是最容易算错的边界 */
  const wk7 = C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 11, 2, 19, 0));
  eq('11/2 是第 7 周', wk7.week, 7);
  eq('第 7 周周一 19:00 已经没课了（心理课只上到第 6 周）', wk7.current, null);
  eq('第 7 周周一 19:00 也没有下一节', wk7.next, null);
  eq('第 7 周周一只剩 2 门课', wk7.today.length, 2);

  /* 星期天晚上的"周次"不该跳周 */
  eq('周日 10/11 仍算第 3 周', C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 11, 23, 59)).week, 3);
  eq('周一 10/12 已经是第 4 周', C.nowStatus(META, D.PERIODS, D.COURSES, at(2026, 10, 12, 0, 1)).week, 4);
}

/* ============================================================ 6. 重叠课排版 */

{
  /* 两门时间完全重叠 → 各占一列 */
  const two = C.layoutDay(D.PERIODS, [
    { code: 'A', firstPeriod: 3, lastPeriod: 5 },
    { code: 'B', firstPeriod: 4, lastPeriod: 5 }
  ]);
  eq('重叠的两门各占一列', two.map((x) => x.col).join(','), '0,1');
  eq('两门都被告知一共有 2 列', two.map((x) => x.cols).join(','), '2,2');
  eq('先开始的排在第一列', two[0].course.code, 'A');

  /* 上一节下课后可以复用同一列 */
  const three = C.layoutDay(D.PERIODS, [
    { code: 'A', firstPeriod: 3, lastPeriod: 3 },
    { code: 'B', firstPeriod: 4, lastPeriod: 5 },
    { code: 'C', firstPeriod: 6, lastPeriod: 7 }
  ]);
  eq('接得上的课全部复用第 1 列', three.map((x) => x.col).join(','), '0,0,0');
  eq('这时候只需要 1 列', three.map((x) => x.cols).join(','), '1,1,1');

  /* 纯顺序的课不该被拆成两列 */
  const seq = C.layoutDay(D.PERIODS, [
    { code: 'A', firstPeriod: 1, lastPeriod: 2 },
    { code: 'B', firstPeriod: 3, lastPeriod: 5 },
    { code: 'C', firstPeriod: 6, lastPeriod: 7 },
    { code: 'D', firstPeriod: 8, lastPeriod: 10 },
    { code: 'E', firstPeriod: 11, lastPeriod: 13 }
  ]);
  eq('一天五门不重叠的课，全都一列', seq.map((x) => x.cols).join(','), '1,1,1,1,1');

  /* 三门两两重叠 → 3 列 */
  const triple = C.layoutDay(D.PERIODS, [
    { code: 'A', firstPeriod: 3, lastPeriod: 5 },
    { code: 'B', firstPeriod: 3, lastPeriod: 5 },
    { code: 'C', firstPeriod: 3, lastPeriod: 5 }
  ]);
  eq('三门同时上 → 3 列', triple[0].cols, 3);

  /* 空的一天：不许崩，也不许返回奇怪的东西 */
  eq('一天没课 → 返回空数组', C.layoutDay(D.PERIODS, []).length, 0);

  /* 每门课都拿到了真实的起止分钟 */
  const withMin = C.layoutDay(D.PERIODS, [{ code: 'A', firstPeriod: 8, lastPeriod: 10 }]);
  eq('第8-10节 15:15 开始', withMin[0].startMin, 15 * 60 + 15);
  eq('第8-10节 17:40 结束', withMin[0].endMin, 17 * 60 + 40);
}

/* ============================== 7. 用真实数据把"某一周"整周走一遍（端到端） */

{
  const days5 = [1, 2, 3, 4, 5];

  /* 第 3 周（用户当前所在的周）：10 节课，每门都得能算出起止时间和地点 */
  const wk3 = [];
  days5.forEach(function (wd) {
    C.coursesOn(META, D.COURSES, 3, wd).forEach(function (c) {
      const sp = C.spanOf(D.PERIODS, c);
      wk3.push({ wd: wd, c: c, sp: sp });
    });
  });
  eq('第 3 周一共 10 节', wk3.length, 10);
  ok('第 3 周每一节都有合法的起止分钟', wk3.every((x) => x.sp.from > 0 && x.sp.to > x.sp.from));
  ok('第 3 周每一节都有地点', wk3.every((x) => !!x.c.room));
  ok('第 3 周每一节都能写出"第几节"', wk3.every((x) => /^第\d+(–\d+)?节$/.test(C.periodText(x.c))));
  ok('第 3 周每一节都能写出"第几周"', wk3.every((x) => /^第\d+(–\d+)?周$/.test(C.weekText(x.c))));
  ok('第 3 周每一节的起止时间都是 08:00 之后、21:00 之前',
    wk3.every((x) => x.sp.from >= 8 * 60 && x.sp.to <= 21 * 60));

  /* 周一这一天三门课的先后必须对得上 */
  eq('第 3 周周一是人工智能 → 工科数学 → 心理素质',
    wk3.filter((x) => x.wd === 1).map((x) => x.c.code).join(','), 'CSE10001,MTH10003,PSY10001');

  /* 把整学期 16 周全扫一遍：每周的数字都要和手算的一致
   * （逐周核对过：1-6 周 10 节；第 7 周心理课结束 → 9；第 9 周电子信息/工程制图结束
   *   但实践教育开始 → 7；第 12 周人工智能结束 → 6；第 15 周实践教育结束 → 5） */
  const expectedPerWeek = { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10, 7: 9, 8: 9, 9: 7, 10: 8, 11: 7, 12: 6, 13: 7, 14: 6, 15: 5, 16: 5 };
  let mismatch = [];
  for (let w = 1; w <= 16; w++) {
    const n = C.countInWeek(META, D.COURSES, w, days5);
    if (n !== expectedPerWeek[w]) mismatch.push('第' + w + '周=' + n + '(期望' + expectedPerWeek[w] + ')');
  }
  eq('16 周的课程数全部对得上', mismatch.join(' '), '');

  /* 整个学期的总小节数（界面底部那句"全学期约 N 小时"就是它算的）
   * 注意：是"节次×周数"的累加，同一门课排两处（工程制图C）要算两次 */
  let totalSections = 0;
  D.COURSES.forEach(function (c) {
    totalSections += (c.lastPeriod - c.firstPeriod + 1) * (c.weekTo - c.weekFrom + 1);
  });
  eq('全学期共 345 个小节', totalSections, 345);
  eq('折合 259 小时（345 × 45 分钟，四舍五入）', Math.round(totalSections * 45 / 60), 259);
  eq('1-16 周一共排了 129 节课', 10 * 6 + 9 + 9 + 7 + 8 + 7 + 6 + 7 + 6 + 5 + 5, 129);

  /* 时间轴 100% 高时，课块不能超出上下界 */
  const R = C.timelineRange(D.PERIODS);
  let inRange = true;
  for (let w = 1; w <= 16; w++) {
    days5.forEach(function (wd) {
      C.coursesOn(META, D.COURSES, w, wd).forEach(function (c) {
        const sp = C.spanOf(D.PERIODS, c);
        if (sp.from < R.from || sp.to > R.to) inRange = false;
      });
    });
  }
  ok('任何一周的课都落在时间轴范围内（不会画到格子外面）', inRange);
}

/* =================================================================== 结果输出 */

const total = pass + fails.length;
if (fails.length) {
  console.log(`\n✗ ${fails.length}/${total} 项没通过：\n`);
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log('');
  process.exit(1);
}
console.log(`\n✓ 逻辑冒烟测试全部通过：${pass}/${total}\n`);
