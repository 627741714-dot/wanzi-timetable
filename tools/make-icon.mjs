/* 生成 iPhone「添加到主屏幕」用的图标 icon-180.png
 * 跑法：node tools/make-icon.mjs
 *
 * 为什么自己画：不想给项目塞二进制素材，也不想引依赖。
 * 用 Node 自带的 zlib 手写 PNG，3 倍超采样再降采样，边缘平滑。
 * 图案 = 一张课表：左边一条时间轴，右边几条不同颜色、不同长度的课。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'icon-180.png');

const OUT_SIZE = 180;
const SS = 3;                         // 超采样倍数
const SIZE = OUT_SIZE * SS;           // 先画 540×540，最后 3×3 平均成 180

/* 配色（和 style.css 的 vivid 主题一路） */
const BG_TOP = [0x4f, 0x52, 0xd8];
const BG_BOT = [0x3b, 0x3f, 0xb8];
const CARD = [0xff, 0xff, 0xff];
const RAIL = [0xdf, 0xe4, 0xf2];
const BARS = [
  [0x7b, 0x93, 0xff],   // 蓝
  [0x4f, 0xbf, 0x85],   // 绿
  [0xf0, 0xb4, 0x29],   // 黄
  [0xff, 0x7d, 0x8c],   // 红
  [0x8b, 0x7c, 0xf6]    // 紫
];

/* --------------------------------------------------------------- 图形描述 */

const R = 40;                          // 图标圆角（iOS 还会自己再裁一次，稍小一点更稳）
const CARD_X0 = 34, CARD_Y0 = 34, CARD_X1 = SIZE - 34, CARD_Y1 = SIZE - 34;
const CARD_R = 26;
const RAIL_X0 = CARD_X0, RAIL_X1 = CARD_X0 + 26;
const BAR_X0 = RAIL_X1 + 16, BAR_X1 = CARD_X1 - 18;

/** 圆角矩形：点 (x,y) 在不在里面 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* 这几条"课"：y 从哪到哪 + 用哪个颜色 + 占几列宽（0~1） */
const CLASSES = [
  { y0: 84, y1: 152, len: 1.00, c: 0 },
  { y0: 168, y1: 222, len: 0.62, c: 1 },
  { y0: 238, y1: 292, len: 1.00, c: 4 },
  { y0: 308, y1: 362, len: 0.78, c: 2 },
  { y0: 378, y1: 432, len: 0.90, c: 3 }
];

/** 返回该点的颜色（含 alpha 混合的结果，底色是不透明的） */
function sample(x, y) {
  // 背景：竖直渐变
  const t = y / SIZE;
  let r = Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t);
  let g = Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t);
  let b = Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t);

  // 白色卡片
  if (inRoundRect(x, y, CARD_X0, CARD_Y0, CARD_X1, CARD_Y1, CARD_R)) {
    r = CARD[0]; g = CARD[1]; b = CARD[2];
    // 左边那条时间轴
    if (x < RAIL_X1) { r = RAIL[0]; g = RAIL[1]; b = RAIL[2]; }
    // 每节课
    for (const k of CLASSES) {
      if (y >= k.y0 && y <= k.y1) {
        const x1 = BAR_X0 + (BAR_X1 - BAR_X0) * k.len;
        if (inRoundRect(x, y, BAR_X0, k.y0, x1, k.y1, 12)) {
          const col = BARS[k.c];
          r = col[0]; g = col[1]; b = col[2];
        }
      }
    }
  }
  return [r, g, b];
}

/* ---------------------------------------------------------------- PNG 编码 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng() {
  const raw = Buffer.alloc(OUT_SIZE * (OUT_SIZE * 4 + 1));
  let p = 0;
  for (let oy = 0; oy < OUT_SIZE; oy++) {
    raw[p++] = 0;                      // filter = 0
    for (let ox = 0; ox < OUT_SIZE; ox++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(ox * SS + sx + 0.5, oy * SS + sy + 0.5);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      raw[p++] = Math.round(r / n);
      raw[p++] = Math.round(g / n);
      raw[p++] = Math.round(b / n);
      raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(OUT_SIZE, 0);
  ihdr.writeUInt32BE(OUT_SIZE, 4);
  ihdr[8] = 8;    // 位深
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const png = makePng();
fs.writeFileSync(OUT, png);
console.log(`✓ 已生成 ${path.basename(OUT)}（${OUT_SIZE}×${OUT_SIZE}，${(png.length / 1024).toFixed(1)} KB）`);
