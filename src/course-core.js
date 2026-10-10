/* ===========================================================================
 * course-core.js —— 纯逻辑：日期换算 / 周次 / 今天上什么课 / 格子布局
 *
 * 这个文件【不碰 DOM】，所以可以用 node 直接跑单元测试（tools/smoke.mjs）。
 * 所有日期一律按【本地时间】构造（new Date(y, m-1, d)），绝不用 new Date('YYYY-MM-DD')，
 * 后者会被当成 UTC 午夜，在东八区会整体偏一天 —— 周次全错，而且很难查。
 * ===========================================================================
 */
(function (root) {
  'use strict';

  var MINUTE = 60000;

  /* ------------------------------------------------------------ 日期小工具 */

  /** 'YYYY-MM-DD' 或 Date → 当天 00:00 的本地 Date（丢掉时分秒） */
  function startOfDay(d) {
    var dt = (typeof d === 'string') ? parseYmd(d) : new Date(d.getTime());
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  /** 严格解析 'YYYY-MM-DD' 为【本地】午夜。格式不对直接抛错，不静默返回 Invalid Date */
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) throw new Error('日期格式必须是 YYYY-MM-DD，收到：' + s);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }

  function ymd(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function addDays(d, n) {
    var x = startOfDay(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  /** 一天的 0 点算第 0 天，整天差 = 两个日期相减再按本地午夜取整，避开夏令时误差 */
  function daysBetween(a, b) {
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
  }

  /** 把任意日期对齐到它所在周的周一 */
  function mondayOf(d) {
    var x = startOfDay(d);
    var wd = x.getDay();                 // 0=周日
    var back = (wd === 0) ? 6 : wd - 1;  // 周日属于上一周
    return addDays(x, -back);
  }

  function fmtMd(d) {
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* ---------------------------------------------------------------- 周次 */

  /**
   * 我在第几周？
   * 返回 { week, status }
   *   status: 'before'  还没开学（week 是负的，比如开学前军训周）
   *           'in'      学期中
   *           'after'   学期结束
   */
  function weekOf(meta, date) {
    var first = parseYmd(meta.firstMonday);
    var days = daysBetween(first, date);
    var week = Math.floor(days / 7) + 1;   // 第 1 周 = 第 1 周的周一
    var status = 'in';
    if (week < 1) status = 'before';
    else if (week > meta.totalWeeks) status = 'after';
    return { week: week, status: status };
  }

  /** 第 n 周的周一 */
  function mondayOfWeek(meta, week) {
    return addDays(parseYmd(meta.firstMonday), (week - 1) * 7);
  }

  /* -------------------------------------------------------------- 节次时间 */

  /** 第 no 小节 → { from, to, label }；找不到抛错，别静默出怪格子 */
  function periodAt(periods, no) {
    for (var i = 0; i < periods.length; i++) if (periods[i].no === no) return periods[i];
    throw new Error('没有第 ' + no + ' 小节');
  }

  /** 一节课的起止分钟数（从当天 0 点算） */
  function spanOf(periods, course) {
    var a = periodAt(periods, course.firstPeriod);
    var b = periodAt(periods, course.lastPeriod);
    // 只有一节时直接用它自己的完整时段；跨小节时拼成 "09:55–12:20"
    var text = (a.no === b.no) ? a.label : (a.label.split('–')[0] + '–' + b.label.split('–')[1]);
    return { from: a.from, to: b.to, text: text };
  }

  /** "第3-5节" / "第8节" 这种紧凑写法 */
  function periodText(course) {
    var a = course.firstPeriod, b = course.lastPeriod;
    return a === b ? ('第' + a + '节') : ('第' + a + '–' + b + '节');
  }

  /** "第1-11周" / "第10周" */
  function weekText(course) {
    if (course.weekFrom == null) return '时间待定';
    return course.weekFrom === course.weekTo
      ? ('第' + course.weekFrom + '周')
      : ('第' + course.weekFrom + '–' + course.weekTo + '周');
  }

  /** 这门课在第 week 周上不上 */
  function activeInWeek(course, week) {
    if (course.weekFrom == null || course.weekTo == null) return false;
    return week >= course.weekFrom && week <= course.weekTo;
  }

  /* ------------------------------------------------------- 某天/某周有哪些课 */

  /** 指定周、指定星期几（1=周一…7=周日）的课，按开始时间排序 */
  function coursesOn(meta, courses, week, weekday) {
    var out = [];
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (c.weekday === weekday && activeInWeek(c, week)) out.push(c);
    }
    out.sort(function (a, b) {
      if (a.firstPeriod !== b.firstPeriod) return a.firstPeriod - b.firstPeriod;
      return String(a.code).localeCompare(String(b.code));
    });
    return out;
  }

  /** 这一周所有课，按天分组：{ 1: [...], 2: [...] ... } */
  function weekGrid(meta, courses, week, days) {
    var grid = {};
    (days || [1, 2, 3, 4, 5]).forEach(function (wd) {
      grid[wd] = coursesOn(meta, courses, week, wd);
    });
    return grid;
  }

  /** 这一周一共有几节课 */
  function countInWeek(meta, courses, week, days) {
    var n = 0;
    (days || [1, 2, 3, 4, 5]).forEach(function (wd) { n += coursesOn(meta, courses, week, wd).length; });
    return n;
  }

  /** 从 fromWeek 开始往后找第一个有课的周（找不到返回 null），用于"跳过去"按钮 */
  function nextWeekWithClass(meta, courses, fromWeek, days) {
    for (var w = fromWeek; w <= meta.maxWeek; w++) {
      if (countInWeek(meta, courses, w, days) > 0) return w;
    }
    return null;
  }

  /* ------------------------------------------------- 现在正在上 / 下一节什么课 */

  /**
   * 传入"现在"的时刻，和当前所在周，算出：
   *   current: 正在上的课（可能 null）
   *   next:    今天接下来最近的一节（可能 null）
   *   progress: 正在上的课的进度 0~1
   */
  function nowStatus(meta, periods, courses, now) {
    var wk = weekOf(meta, now);
    var weekday = now.getDay() === 0 ? 7 : now.getDay();   // 周日算 7
    var minutes = now.getHours() * 60 + now.getMinutes();
    var today = coursesOn(meta, courses, wk.week, weekday);

    var current = null, next = null, progress = 0;
    for (var i = 0; i < today.length; i++) {
      var c = today[i];
      var sp = spanOf(periods, c);
      if (minutes >= sp.from && minutes < sp.to) {
        current = c;
        progress = (minutes - sp.from) / (sp.to - sp.from);
      } else if (sp.from > minutes && !next) {
        next = c;
      }
    }
    return {
      week: wk.week, status: wk.status, weekday: weekday, minutes: minutes,
      current: current, next: next, progress: progress, today: today
    };
  }

  /* --------------------------------------------------------- 重叠课的排版 */

  /**
   * 同一天里两门课时间重叠时，横向并排。
   * 输入：当天课程数组（已排序）；返回：每门课附加 { startMin, endMin, col, cols }
   * 算法：按开始时间扫，能塞进已有列就塞，塞不进就新开一列；最后用"这一坨里最多用了几列"。
   */
  function layoutDay(periods, courses) {
    var list = courses.map(function (c) {
      var sp = spanOf(periods, c);
      return { course: c, startMin: sp.from, endMin: sp.to };
    }).sort(function (a, b) {
      return (a.startMin - b.startMin) || (a.endMin - b.endMin);
    });

    var columns = [];   // columns[i] = 该列最后一节的结束分钟
    list.forEach(function (item) {
      var placed = false;
      for (var i = 0; i < columns.length; i++) {
        if (columns[i] <= item.startMin) {   // 上一节已经下课，可以共用这一列
          columns[i] = item.endMin;
          item.col = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = columns.length;
        columns.push(item.endMin);
      }
    });

    var cols = Math.max(1, columns.length);
    list.forEach(function (item) { item.cols = cols; });
    return list;
  }

  /* -------------------------------------------------------------- 时间轴范围 */

  /** 时间轴上下界（分钟）：默认按第一节最早、最后一节最晚 */
  function timelineRange(periods) {
    var from = Infinity, to = -Infinity;
    periods.forEach(function (p) {
      if (p.from < from) from = p.from;
      if (p.to > to) to = p.to;
    });
    return { from: from, to: to, total: to - from };
  }

  /** 把分钟换算成时间轴上的百分比（给绝对定位用，这样字号改了也不会错位） */
  function pct(minute, range) {
    return (minute - range.from) / range.total * 100;
  }

  /* ------------------------------------------------------------------ 导出 */

  var API = {
    startOfDay: startOfDay, parseYmd: parseYmd, ymd: ymd, addDays: addDays,
    daysBetween: daysBetween, mondayOf: mondayOf, fmtMd: fmtMd,
    weekOf: weekOf, mondayOfWeek: mondayOfWeek,
    periodAt: periodAt, spanOf: spanOf, periodText: periodText, weekText: weekText,
    activeInWeek: activeInWeek, coursesOn: coursesOn, weekGrid: weekGrid,
    countInWeek: countInWeek, nextWeekWithClass: nextWeekWithClass,
    nowStatus: nowStatus, layoutDay: layoutDay,
    timelineRange: timelineRange, pct: pct
  };

  root.CourseCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
