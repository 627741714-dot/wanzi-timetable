/* ===========================================================================
 * data.js —— 课表原始数据（唯一数据源）
 *
 * 这里的东西全部来自 timeTableForStu12.pdf（2026-2027学年 1学期），
 * "作息时间"来自北京理工大学上课时间表。
 *
 * 注意：这个页面会传到公开的 GitHub Pages，所以【不写姓名学号】。
 * 备份文件里的学期指纹也只按 termLabel / firstMonday / totalWeeks 判断。
 *
 * 想改课表？只改这个文件，然后跑：node tools/build-single.mjs
 * ===========================================================================
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ 元信息 */

  var META = {
    appName: '我的课表',
    school: '北京理工大学',
    termLabel: '2026-2027学年 第一学期',
    // 第 1 周周一。用户确认：10.5–10.11 是第 3 周 → 第 1 周周一 = 2026-09-21
    // 注意：字符串必须是 YYYY-MM-DD，core.js 会按【本地时间】解析，避开 UTC 时区坑
    firstMonday: '2026-09-21',
    totalWeeks: 16,
    // 有早于第 1 周的课（军事技能在第 -3、-2 周），所以时间轴从负周开始
    minWeek: -3,
    maxWeek: 16,
    weekNote: '第1周 = 9/21–9/27，共 16 周（第 16 周 1/4–1/10）'
  };

  /* -------------------------------------------------------------------- 节次 */

  // 每小节一个条目：no=第几小节，from/to=当天 0 点起的分钟数，label=显示用
  var PERIODS = [
    { no: 1, from: 8 * 60 + 0, to: 8 * 60 + 45, label: '08:00–08:45' },
    { no: 2, from: 8 * 60 + 50, to: 9 * 60 + 35, label: '08:50–09:35' },
    { no: 3, from: 9 * 60 + 55, to: 10 * 60 + 40, label: '09:55–10:40' },
    { no: 4, from: 10 * 60 + 45, to: 11 * 60 + 30, label: '10:45–11:30' },
    { no: 5, from: 11 * 60 + 35, to: 12 * 60 + 20, label: '11:35–12:20' },
    { no: 6, from: 13 * 60 + 20, to: 14 * 60 + 5, label: '13:20–14:05' },
    { no: 7, from: 14 * 60 + 10, to: 14 * 60 + 55, label: '14:10–14:55' },
    { no: 8, from: 15 * 60 + 15, to: 16 * 60 + 0, label: '15:15–16:00' },
    { no: 9, from: 16 * 60 + 5, to: 16 * 60 + 50, label: '16:05–16:50' },
    { no: 10, from: 16 * 60 + 55, to: 17 * 60 + 40, label: '16:55–17:40' },
    { no: 11, from: 18 * 60 + 30, to: 19 * 60 + 15, label: '18:30–19:15' },
    { no: 12, from: 19 * 60 + 20, to: 20 * 60 + 5, label: '19:20–20:05' },
    { no: 13, from: 20 * 60 + 10, to: 20 * 60 + 55, label: '20:10–20:55' }
  ];

  // 大节分组（纯粹为了在表头/图例里显示"上午/下午/晚上"）
  var DAY_PARTS = [
    { key: 'morning', name: '上午', short: '上', firstPeriod: 1, lastPeriod: 5 },
    { key: 'afternoon', name: '下午', short: '下', firstPeriod: 6, lastPeriod: 10 },
    { key: 'evening', name: '晚上', short: '晚', firstPeriod: 11, lastPeriod: 13 }
  ];

  /* -------------------------------------------------------------------- 课程 */

  /* 字段说明：
   *   code      课程号（用于配色分组，同一门课永远同色）
   *   name      课名
   *   short     格子里显示的短名（字太多会挤成一团）
   *   weekFrom  起始周 / weekTo 结束周（含两端）
   *   weekday   1=周一 … 7=周日（照 JS 的 getDay 习惯）
   *   slot      第几大节（只用来分组，真正定位看 firstPeriod/lastPeriod）
   *   firstPeriod/lastPeriod  第几小节 ~ 第几小节
   *   room      地点
   *   teacher   老师（PDF 里没给，留空就不显示）
   */
  var COURSES = [
    {
      code: 'CSE10001', name: '人工智能与计算科学A', short: '人工智能与计算科学',
      weekFrom: 1, weekTo: 11, weekday: 1, slot: 'morning',
      firstPeriod: 3, lastPeriod: 5, room: '文萃楼F302', teacher: ''
    },
    {
      code: 'SPOG0005', name: '体育/篮球', short: '体育·篮球',
      weekFrom: 1, weekTo: 16, weekday: 2, slot: 'morning',
      firstPeriod: 3, lastPeriod: 4, room: '南校区篮球场', teacher: ''
    },
    {
      code: 'MAR10003', name: '新时代实践教育I', short: '新时代实践教育I',
      weekFrom: 9, weekTo: 13, weekday: 3, slot: 'morning',
      firstPeriod: 3, lastPeriod: 5, room: '文萃楼F103', teacher: ''
    },
    {
      code: 'MAR10001', name: '习近平新时代中国特色社会主义思想概论', short: '习近平新时代\n中国特色社会主义思想概论',
      weekFrom: 1, weekTo: 16, weekday: 4, slot: 'morning',
      firstPeriod: 3, lastPeriod: 5, room: '文萃楼M125', teacher: ''
    },
    {
      code: 'CSE10007', name: 'C语言程序设计', short: 'C语言程序设计',
      weekFrom: 1, weekTo: 16, weekday: 5, slot: 'morning',
      firstPeriod: 3, lastPeriod: 5, room: '文萃楼I705', teacher: ''
    },
    {
      code: 'RXA10001', name: '电子信息导论', short: '电子信息导论',
      weekFrom: 1, weekTo: 8, weekday: 3, slot: 'afternoon',
      firstPeriod: 6, lastPeriod: 7, room: '综教A405', teacher: ''
    },
    {
      code: 'MHE10001', name: '工程制图C', short: '工程制图C',
      weekFrom: 1, weekTo: 8, weekday: 4, slot: 'afternoon',
      firstPeriod: 6, lastPeriod: 7, room: '综教A102', teacher: ''
    },
    {
      code: 'MTH10003', name: '工科数学分析 I', short: '工科数学分析I',
      weekFrom: 1, weekTo: 16, weekday: 1, slot: 'evening',
      firstPeriod: 8, lastPeriod: 10, room: '文萃楼M135', teacher: ''
    },
    {
      code: 'MHE10001', name: '工程制图C', short: '工程制图C',
      weekFrom: 1, weekTo: 8, weekday: 2, slot: 'evening',
      firstPeriod: 8, lastPeriod: 9, room: '综教A102', teacher: ''
    },
    {
      code: 'MTH10003', name: '工科数学分析 I', short: '工科数学分析I',
      weekFrom: 1, weekTo: 16, weekday: 3, slot: 'evening',
      firstPeriod: 8, lastPeriod: 10, room: '文萃楼M135', teacher: ''
    },
    {
      code: 'PSY10001', name: '大学生心理素质发展', short: '大学生心理素质发展',
      weekFrom: 1, weekTo: 6, weekday: 1, slot: 'evening',
      firstPeriod: 11, lastPeriod: 13, room: '理教楼302', teacher: ''
    },
    /* 国家安全概论：同一门课有三次不同周次的安排，拆成三条 */
    {
      code: 'SAF10601', name: '国家安全概论', short: '国家安全概论',
      weekFrom: 10, weekTo: 10, weekday: 5, slot: 'evening',
      firstPeriod: 8, lastPeriod: 10, room: '理教楼105', teacher: ''
    },
    {
      code: 'SAF10601', name: '国家安全概论', short: '国家安全概论',
      weekFrom: 13, weekTo: 13, weekday: 5, slot: 'evening',
      firstPeriod: 8, lastPeriod: 9, room: '理教楼105', teacher: ''
    },
    {
      code: 'SAF10601', name: '国家安全概论', short: '国家安全概论',
      weekFrom: 14, weekTo: 14, weekday: 5, slot: 'evening',
      firstPeriod: 8, lastPeriod: 9, room: '理教楼105', teacher: ''
    }
  ];

  /* 时间未定的课（用户选择：不在课表里显示，但仍保留数据以便以后打开）
   * pending: true 的条目 app.js 会直接跳过渲染。 */
  var PENDING = [
    { code: '99911001', name: '英语分级考试', weekFrom: null, weekTo: null, note: '时间待定' },
    { code: 'MIL10001', name: '军事理论', weekFrom: 1, weekTo: 1, note: '第1周，时间待定', teacher: '宋春宝,李效璐' },
    { code: 'MIL10002', name: '军事技能', weekFrom: -3, weekTo: -2, note: '第-3、-2周（开学前），时间待定', teacher: '宋春宝,李效璐' }
  ];
  var SHOW_PENDING = false; // 用户要求：不显示

  /* ------------------------------------------------------ 每门课的配色编号 */

  /* 同一门课（同 code）必须拿到同一个颜色号，不然工程制图上午/晚上会变两个色 */
  var COLOR_BY_CODE = {
    CSE10001: 1,
    SPOG0005: 2,
    MAR10003: 3,
    MAR10001: 4,
    CSE10007: 5,
    RXA10001: 6,
    MHE10001: 7,
    MTH10003: 8,
    PSY10001: 9,
    SAF10601: 10
  };

  var API = {
    META: META,
    PERIODS: PERIODS,
    DAY_PARTS: DAY_PARTS,
    COURSES: COURSES,
    PENDING: PENDING,
    SHOW_PENDING: SHOW_PENDING,
    COLOR_BY_CODE: COLOR_BY_CODE,
    colorOf: function (code) {
      return COLOR_BY_CODE[code] || ((String(code).charCodeAt(0) % 10) + 1);
    }
  };

  root.ScheduleData = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
