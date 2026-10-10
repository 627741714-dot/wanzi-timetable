/* ===========================================================================
 * serve.mjs —— 零依赖的本地小服务，专门给手机看课表用
 *
 * 用法：node tools/serve.mjs [端口]
 *   · 首页固定给 index.html（GitHub Pages 也是认这个名字，保持一致）
 *   · 一律 Cache-Control: no-cache —— 手机上改完立刻能看到新版
 *   · 只认 192.168 / 10. / 172.16-31 三个私有网段，虚拟网卡的地址单独标出来提醒
 *
 * 踩过的坑：手机必须用 http:// 打开（file:// 下 Safari 不让存 localStorage）。
 * ===========================================================================
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf'
};

/** 只认真正能让手机连上的私有网段 */
function isPrivateLan(ip) {
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (a) {
      if (a.family !== 'IPv4' || a.internal) return;
      out.push({ name: name, ip: a.address, ok: isPrivateLan(a.address) });
    });
  });
  return out;
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache'
  });
  res.end(body);
}

export function createServer() {
  return http.createServer(function (req, res) {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch (e) {
      return send(res, 400, '网址看不懂');
    }
    if (urlPath === '/' || urlPath === '') urlPath = '/' + INDEX;

    const target = path.join(ROOT, urlPath);
    const rel = path.relative(ROOT, target);
    /* 路径穿越防护：解析完必须还在 ROOT 里面 */
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return send(res, 403, '不许往外跑');
    }

    fs.stat(target, function (err, st) {
      if (err || !st.isFile()) {
        return send(res, 404, '没有这个文件：' + urlPath + '\n（首页是 ' + INDEX + '）');
      }
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      });
      fs.createReadStream(target).pipe(res);
    });
  });
}

/** 端口被占就往后试，最多 12 个 */
export function listen(server, port, onReady) {
  let tries = 0;
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE' && tries < 12) {
      tries++;
      server.listen(port + tries);
      return;
    }
    throw e;
  });
  server.on('listening', function () {
    onReady(server.address().port);
  });
  server.listen(port);
}

/* 直接被 node 跑的时候才打印这些（被 require 做测试时不吵） */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2]) || 5177;
  const server = createServer();
  listen(server, port, function (realPort) {
    const addrs = lanAddresses();
    console.log('');
    console.log('  我的课表 —— 本地服务已启动');
    console.log('');
    console.log('  电脑上看：   http://127.0.0.1:' + realPort + '/');
    if (addrs.length) {
      console.log('');
      console.log('  手机上打开（必须在同一个 WiFi 下）：');
      addrs.forEach(function (a) {
        if (a.ok) console.log('    http://' + a.ip + ':' + realPort + '/  ← ' + a.name);
        else console.log('    http://' + a.ip + ':' + realPort + '/  ← ' + a.name + '（虚拟网卡，手机一般连不上）');
      });
    } else {
      console.log('');
      console.log('  没找到局域网地址 —— 检查一下 WiFi 连上了没。');
    }
    console.log('');
    console.log('  手机上这样加到主屏幕：Safari 打开上面的网址 → 分享 → 添加到主屏幕');
    console.log('  关掉这个窗口（或按 Ctrl+C）服务就停了。');
    console.log('');
  });
}
