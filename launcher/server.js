// 실행 관리 홈페이지 — 저장소 최상위에서 `npm start` (Windows는 START.cmd) → http://127.0.0.1:8080
// 두 프로그램을 내 PC에서 실행·중지하고 로그를 본다. 처음 실행할 때 필요한 패키지를 자동으로 설치한다.
// 외부 의존성 없이 Node.js 기본 모듈만 쓴다. 이 PC 안(127.0.0.1)에서만 접속할 수 있다.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'launcher', 'public');
const PORT = Number(process.env.LAUNCHER_PORT ?? 8080);
const HOST = '127.0.0.1';
const MAX_LOG = 400;

// 실행할 프로그램 — 포트는 각 프로그램의 기본값
const APPS = {
  damage: {
    dir: 'robot-sensor-damage',
    modes: {
      server: { label: '서버 모드', port: 3000, args: ['--disable-warning=ExperimentalWarning', 'server/app.js'], install: true, node: '22.13' },
      demo: { label: '데모 모드', port: 5173, args: ['server/static-preview.js'], install: false, node: '18.0' },
    },
    // 첫 실행 때 화면에 찍는 시스템 관리자 임시 비밀번호를 알림으로 보여 준다
    notice: (line) => {
      const m = /아이디:\s*(\S+)\s+임시 비밀번호:\s*(\S+)/.exec(line);
      return m ? `첫 로그인 계정  ${m[1]} / ${m[2]}  (로그인 후 비밀번호를 바꾸세요)` : null;
    },
  },
  platform: {
    dir: 'robot-sensor-platform',
    modes: {
      server: { label: '서버 모드', port: 3210, args: ['server/app.js'], install: true, node: '24.0' },
    },
    // 첫 실행 때 data/initial-account.txt 에 초기 계정을 남긴다
    noticeFile: path.join('data', 'initial-account.txt'),
  },
};

const state = Object.fromEntries(Object.keys(APPS).map((id) => [id, {
  status: 'stopped', mode: null, child: null, startedAt: null, error: null, notice: null, stopping: false, logs: [], seq: 0,
}]));

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
function log(id, text, kind = 'out') {
  const s = state[id];
  String(text).replace(ANSI, '').split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    s.seq += 1;
    s.logs.push({ seq: s.seq, at: new Date().toISOString(), kind, line });
    const n = APPS[id].notice?.(line);
    if (n) s.notice = n;
  });
  if (s.logs.length > MAX_LOG) s.logs.splice(0, s.logs.length - MAX_LOG);
}
function pipe(id, child) {
  child.stdout?.on('data', (b) => log(id, b.toString('utf8')));
  child.stderr?.on('data', (b) => log(id, b.toString('utf8'), 'err'));
}

const nodeOk = (min) => {
  const [a, b] = process.versions.node.split('.').map(Number);
  const [x, y] = min.split('.').map(Number);
  return a > x || (a === x && b >= y);
};
const installed = (id) => fs.existsSync(path.join(root, APPS[id].dir, 'node_modules', '.package-lock.json'));

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: HOST });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(300, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
async function waitForPort(port, ms, alive) {
  const end = Date.now() + ms;
  while (Date.now() < end && alive()) {
    if (await portInUse(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// Windows는 npm(cmd.exe)이 자식 프로세스를 남기므로 프로세스 트리째 끈다
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function runInstall(id) {
  return new Promise((resolve) => {
    const s = state[id];
    log(id, '필요한 패키지를 설치합니다 (npm ci, 처음 한 번 · 인터넷 필요)…', 'sys');
    // Windows의 npm은 npm.cmd 라서 셸로 실행한다(고정된 명령 문자열만 쓴다)
    const child = spawn('npm ci --omit=dev --no-audit --no-fund', { cwd: path.join(root, APPS[id].dir), shell: true, windowsHide: true });
    s.child = child;
    pipe(id, child);
    child.once('error', (e) => log(id, `설치를 시작하지 못했습니다: ${e.message}`, 'err'));
    child.once('close', (code) => {
      s.child = null;
      resolve(code === 0);
    });
  });
}

async function start(id, modeId) {
  const app = APPS[id];
  const s = state[id];
  const mode = app.modes[modeId];
  if (!mode) throw httpError(400, '실행 방식이 올바르지 않습니다.');
  if (['installing', 'starting', 'running'].includes(s.status)) throw httpError(409, '이미 실행 중입니다.');
  if (!nodeOk(mode.node)) throw httpError(400, `Node.js ${mode.node} 이상이 필요합니다 (지금 ${process.versions.node}).`);
  if (await portInUse(mode.port)) throw httpError(409, `포트 ${mode.port}을 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄고 다시 시도하세요.`);

  Object.assign(s, { mode: modeId, error: null, stopping: false, startedAt: null });
  (async () => {
    if (mode.install && !installed(id)) {
      s.status = 'installing';
      const ok = await runInstall(id);
      if (s.stopping) return finish(id, null);
      if (!ok) return finish(id, '패키지 설치에 실패했습니다. 로그를 확인하세요.');
    }
    s.status = 'starting';
    log(id, `${mode.label}로 시작합니다 → http://${HOST}:${mode.port}`, 'sys');
    const child = spawn(process.execPath, mode.args, {
      cwd: path.join(root, app.dir), windowsHide: true,
      env: { ...process.env, HOST, PORT: String(mode.port), FORCE_COLOR: '0' },
    });
    s.child = child;
    pipe(id, child);
    child.once('error', (e) => log(id, `실행하지 못했습니다: ${e.message}`, 'err'));
    child.once('close', (code) => {
      s.child = null;
      log(id, `프로그램이 끝났습니다 (종료 코드 ${code ?? '-'})`, 'sys');
      finish(id, s.stopping || code === 0 ? null : `프로그램이 멈췄습니다 (종료 코드 ${code}). 로그를 확인하세요.`);
    });
    if (await waitForPort(mode.port, 60000, () => s.child === child)) {
      s.status = 'running';
      s.startedAt = new Date().toISOString();
      log(id, '실행 중입니다.', 'sys');
    } else if (s.child === child) {
      log(id, '60초 안에 응답이 없어 중지합니다.', 'err');
      s.stopping = true;
      killTree(child);
      s.error = '시작 시간이 너무 오래 걸립니다. 로그를 확인하세요.';
    }
  })().catch((e) => finish(id, e.message));
}

function finish(id, error) {
  const s = state[id];
  s.status = error ? 'error' : 'stopped';
  s.error = error ?? s.error;
  s.startedAt = null;
  s.stopping = false;
}

function stop(id) {
  const s = state[id];
  if (!s.child) throw httpError(409, '실행 중이 아닙니다.');
  s.stopping = true;
  s.error = null;
  log(id, '중지합니다…', 'sys');
  killTree(s.child);
}

function readNotice(id) {
  const s = state[id];
  const file = APPS[id].noticeFile;
  if (!file) return s.notice;
  try {
    return fs.readFileSync(path.join(root, APPS[id].dir, file), 'utf8').trim();
  } catch {
    return null;
  }
}

async function snapshot() {
  const apps = [];
  for (const [id, app] of Object.entries(APPS)) {
    const s = state[id];
    const modes = [];
    for (const [mid, m] of Object.entries(app.modes)) {
      modes.push({ id: mid, label: m.label, port: m.port, url: `http://${HOST}:${m.port}/`, node: m.node, nodeOk: nodeOk(m.node),
        install: m.install, inUse: s.mode === mid && s.child ? true : await portInUse(m.port) });
    }
    apps.push({ id, dir: app.dir, status: s.status, mode: s.mode, startedAt: s.startedAt, error: s.error,
      notice: readNotice(id), installed: installed(id), dataDir: path.join(root, app.dir, 'data'), lastSeq: s.seq, modes });
  }
  return { node: process.versions.node, platform: process.platform, root, apps };
}

// ── HTTP ─────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  try {
    // 다른 사이트가 이 런처를 조작하지 못하게: 주소 이름(DNS 리바인딩)·출처·전용 헤더 확인
    if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: '허용되지 않은 주소입니다.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (req.headers['x-launcher'] !== '1' || (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '')))) {
          return send(res, 403, { error: '허용되지 않은 요청입니다.' });
        }
      }
      const m = /^\/api\/apps(?:\/([a-z]+)(?:\/(start|stop|logs))?)?$/.exec(url.pathname);
      if (!m) return send(res, 404, { error: '없는 API입니다.' });
      const [, id, action] = m;
      if (!id && req.method === 'GET') return send(res, 200, await snapshot());
      if (!APPS[id]) return send(res, 404, { error: '없는 프로그램입니다.' });
      if (action === 'logs' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0);
        return send(res, 200, { lines: state[id].logs.filter((l) => l.seq > since) });
      }
      if (action === 'start' && req.method === 'POST') {
        await start(id, url.searchParams.get('mode') ?? 'server');
        return send(res, 202, { ok: true });
      }
      if (action === 'stop' && req.method === 'POST') {
        stop(id);
        return send(res, 202, { ok: true });
      }
      return send(res, 405, { error: '지원하지 않는 요청입니다.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '지원하지 않는 요청입니다.' });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('없는 페이지입니다.');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status ?? 500, { error: e.status ? e.message : '런처 오류가 났습니다.' });
    if (!e.status) console.error(e);
  }
});

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

function shutdown() {
  Object.values(state).forEach((s) => {
    s.stopping = true;
    killTree(s.child);
  });
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.once('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`포트 ${PORT}을 이미 쓰고 있습니다. 런처가 이미 켜져 있으면 http://${HOST}:${PORT} 을 여세요. 다른 포트: LAUNCHER_PORT=8081 npm start`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`실행 관리 홈페이지: ${url}  (끄려면 Ctrl+C — 실행 중인 프로그램도 함께 꺼집니다)`);
  if (process.argv.includes('--open')) openBrowser(url);
});
