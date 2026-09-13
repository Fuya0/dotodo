/*
 * 生成托盘图标资源：assets/tray.png（16×16）与 assets/tray@2x.png（32×32）。
 *
 * 为什么要自己写：Electron 的 Tray 只接受位图（PNG/ICO），不能直接用 build/icon.svg。
 * 与其手工维护二进制文件，不如把「图标长什么样」写成可复现的脚本——
 * 想改颜色或粗细时重跑一次即可：
 *
 *   node tools/make-tray-icon.js
 *
 * 这个脚本也顺带讲清楚 PNG 的结构：8 字节签名 + 若干数据块，每个块是
 * 「长度(4) + 类型(4) + 数据 + CRC32(4)」。像素数据先按行加过滤字节，
 * 再用 zlib 压缩后放进 IDAT。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIRECTORY = path.join(__dirname, '..', 'assets');

const GRADIENT_TOP = [56, 189, 248];
const GRADIENT_BOTTOM = [37, 99, 235];
const CHECK_COLOR = [6, 18, 31];

function renderIcon(size) {
  const scale = size / 32;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pointX = x + 0.5;
      const pointY = y + 0.5;

      const body = coverage(roundedRectDistance(pointX, pointY, scale));
      if (body <= 0) continue;

      const gradient = y / Math.max(1, size - 1);
      const fill = mix(GRADIENT_TOP, GRADIENT_BOTTOM, gradient);
      const check = coverage(checkDistance(pointX, pointY, scale)) * body;

      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(fill[0] * (1 - check) + CHECK_COLOR[0] * check);
      pixels[offset + 1] = Math.round(fill[1] * (1 - check) + CHECK_COLOR[1] * check);
      pixels[offset + 2] = Math.round(fill[2] * (1 - check) + CHECK_COLOR[2] * check);
      pixels[offset + 3] = Math.round(body * 255);
    }
  }

  return pixels;
}

/** 圆角矩形：标准的有符号距离场，负值在内部。 */
function roundedRectDistance(pointX, pointY, scale) {
  const center = 16 * scale;
  const half = 14 * scale;
  const radius = 8 * scale;
  const dx = Math.abs(pointX - center) - (half - radius);
  const dy = Math.abs(pointY - center) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function checkDistance(pointX, pointY, scale) {
  const stroke = 1.6 * scale;
  const points = [[9.5, 16.5], [14, 21], [22.5, 10.5]].map(([x, y]) => [x * scale, y * scale]);
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    shortest = Math.min(shortest, segmentDistance(pointX, pointY, points[i], points[i + 1]));
  }
  return shortest - stroke;
}

function segmentDistance(pointX, pointY, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = pointX - ax;
  const wy = pointY - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : clamp((wx * vx + wy * vy) / lengthSquared, 0, 1);
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** 用 0.5 像素的过渡带做抗锯齿。 */
function coverage(distance) {
  return clamp(0.5 - distance, 0, 1);
}

function mix(from, to, ratio) {
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // 过滤方式 0：不过滤
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 每通道 8 位
  header[9] = 6; // 真彩色带 alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeIcon(fileName, size) {
  const filePath = path.join(OUTPUT_DIRECTORY, fileName);
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  fs.writeFileSync(filePath, encodePng(size, renderIcon(size)));
  return filePath;
}

const written = [writeIcon('tray.png', 16), writeIcon('tray@2x.png', 32)];
for (const filePath of written) {
  console.log(`${path.relative(path.join(__dirname, '..'), filePath)} ${fs.statSync(filePath).size} 字节`);
}
