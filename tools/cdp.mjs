/* 极简 CDP 客户端：用 WebSocket 直接跟 Edge 的调试端口说话。
 *
 * 为什么不用 --window-size 截图：
 *   Windows 上 Edge 无头模式的窗口最小宽度被钳到约 518px，--window-size=390 无效，
 *   套 iframe 也没用（iframe 会被撑到 518）—— 截出来根本不是手机宽度。
 *   唯一靠谱的办法是用 CDP 的 Emulation.setDeviceMetricsOverride 强制视口宽度。
 *
 * Node 22+ 自带 WebSocket，所以这里零依赖。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 60) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastErr = new Error('HTTP ' + res.status);
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  throw new Error('连不上 Edge 调试端口：' + (lastErr && lastErr.message));
}

/** 起一个无头 Edge，返回 { proc, wsUrl, kill } */
export async function launchBrowser(opts = {}) {
  const exe = opts.exe;
  const port = opts.port || 9222;
  const userDataDir = opts.userDataDir;
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--window-size=520,900',
    '--user-data-dir=' + userDataDir,
    'about:blank'
  ];
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });

  const ver = await fetchJson('http://127.0.0.1:' + port + '/json/version');
  const browserCdp = await connect(ver.webSocketDebuggerUrl);
  /* 打开 target 自动上报，否则新建的标签页不会出现在 /json/list 里 */
  try { await browserCdp.send('Target.setDiscoverTargets', { discover: true }); } catch (e) { /* 老版本没有就算了 */ }

  return {
    proc: proc,
    cdp: browserCdp,
    wsUrl: ver.webSocketDebuggerUrl,
    port: port,
    kill: () => {
      try { browserCdp.close(); } catch (e) { /* 忽略 */ }
      try { proc.kill(); } catch (e) { /* 已经死了 */ }
      try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 忽略 */ }
    }
  };
}

/** 在浏览器级连接上创建一个空白标签页 */
export async function createTarget(browserCdp, url = 'about:blank') {
  const { targetId } = await browserCdp.send('Target.createTarget', { url: url });
  return targetId;
}

/** 等某个 targetId 的调试通道就绪，并连上它 */
export async function connectToTarget(port, targetId, tries = 40) {
  let target = null;
  for (let i = 0; i < tries && !target; i++) {
    const list = await fetchJson('http://127.0.0.1:' + port + '/json/list', 1);
    target = list.find((t) => t.id === targetId);
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('没找到 target ' + targetId);
  return await connect(target.webSocketDebuggerUrl);
}

/** 极简 CDP：send(method, params) → Promise<result> */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP 出错'));
      else resolve(msg.result);
    }
  });

  const session = {
    send(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时：' + method)); }
        }, 30000);
      });
    },
    close() { try { ws.close(); } catch (e) { /* 忽略 */ } }
  };
  return session;
}

export { sleep };
