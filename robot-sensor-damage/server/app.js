// API 서버 + 화면 파일 제공 — `npm start`
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { config, photoDir } from './config.js';
import { openApp, isEmpty, seedDatabase, uid, now } from './runtime.js';
import { ROUTES } from '../public/js/core/routes.js';

const { store, service } = openApp();
if (isEmpty(store)) {
  const pw = seedDatabase(store, { withSamples: false });
  console.log('────────────────────────────────────────────');
  console.log(' 처음 실행: 1~30호기 기본 데이터를 만들었습니다.');
  console.log(` 시스템 관리자 계정  아이디: sysadmin  임시 비밀번호: ${pw}`);
  console.log(' 첫 로그인 후 비밀번호를 바꾸고, 계정 화면에서 사용자 계정을 만드세요.');
  console.log('────────────────────────────────────────────');
}

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

// 보안 헤더 — index.html 의 importmap(인라인)만 해시로 허용
const indexHtml = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';
const importMapHash = crypto.createHash('sha256').update(importMap).digest('base64');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'sha256-${importMapHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`);
  next();
});

// ── 세션 ─────────────────────────────
const COOKIE = 'rsd_sid';
function parseCookies(h = '') {
  const out = {};
  h.split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i < 1) return;
    try {
      out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
    } catch {
      /* 깨진 쿠키는 무시 */
    }
  });
  return out;
}
const dropSessions = (userId, keepSid = null) =>
  store.all('sessions').filter((x) => x.user_id === userId && x.id !== keepSid).forEach((x) => store.remove('sessions', x.id));
function sessionUser(req) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (!sid) return null;
  const s = store.get('sessions', sid);
  if (!s || s.expires_at < now()) return null;
  const u = store.get('users', s.user_id);
  return u && u.active ? u : null;
}
function setCookie(req, res, value, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
const cleanSessions = () => store.all('sessions').filter((s) => s.expires_at < now()).forEach((s) => store.remove('sessions', s.id));
setInterval(cleanSessions, 6 * 3600 * 1000).unref();

// 로그인 실패 제한(아이피당 10분에 10회)
const fails = new Map();
const tooMany = (ip) => {
  const f = fails.get(ip);
  return f && f.count >= 10 && Date.now() - f.first < 10 * 60 * 1000;
};
const noteFail = (ip) => {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > 10 * 60 * 1000) fails.set(ip, { count: 1, first: Date.now() });
  else f.count += 1;
};

app.use('/api', express.json({ limit: '40mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  // 다른 사이트에서 보낸 쓰기 요청 차단(CSRF)
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* 잘못된 Origin */
    }
    if (host !== req.headers.host) return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
  }
  req.ctx = { user: sessionUser(req) };
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'server', time: now() }));

app.post('/api/auth/login', (req, res, next) => {
  try {
    if (tooMany(req.ip)) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요.' });
    let user;
    try {
      user = service.login({}, req.body ?? {});
    } catch (e) {
      noteFail(req.ip);
      throw e;
    }
    fails.delete(req.ip);
    const sid = crypto.randomBytes(32).toString('hex');
    const exp = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
    store.insert('sessions', { id: sid, user_id: user.id, expires_at: exp, created_at: now() });
    setCookie(req, res, sid, config.sessionDays * 86400);
    res.json(user);
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/logout', (req, res) => {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) store.remove('sessions', sid);
  setCookie(req, res, '', 0);
  res.json({ ok: true });
});

// ── 업무 API (경로표 공유) ─────────────────────────────
const ALLOWED_BEFORE_PW_CHANGE = new Set(['me', 'changePassword', 'stats']);
Object.entries(ROUTES).forEach(([name, [method, route]]) => {
  if (name === 'login') return;
  app[method.toLowerCase()](route, (req, res, next) => {
    try {
      // 임시 비밀번호 상태에서는 비밀번호 변경만 허용
      if (req.ctx.user?.must_change_pw && !ALLOWED_BEFORE_PW_CHANGE.has(name)) {
        return res.status(403).json({ error: '먼저 비밀번호를 바꿔 주세요.' });
      }
      const args = { ...req.query, ...(method === 'GET' ? {} : req.body ?? {}), ...req.params };
      const result = service[name](req.ctx, args);
      // 비밀번호·권한이 바뀌면 다른 기기의 로그인을 끊는다
      if (name === 'changePassword') dropSessions(req.ctx.user.id, parseCookies(req.headers.cookie)[COOKIE]);
      if (name === 'updateUser' && (args.password || args.active === false || args.role !== undefined)) {
        dropSessions(args.id, args.id === req.ctx.user.id ? parseCookies(req.headers.cookie)[COOKIE] : null);
      }
      res.json(result ?? { ok: true });
    } catch (e) {
      next(e);
    }
  });
});
app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다.' }));

// 사진 — 로그인한 사람만
app.use('/files/photos', (req, res, next) => {
  if (!sessionUser(req)) return res.status(401).end();
  next();
}, express.static(photoDir(), { maxAge: '30d', immutable: true, fallthrough: false }));

// 서버로 실행할 때는 항상 서버 모드(데모로 빠지지 않게)
const serverConfig = fs.readFileSync(path.join(config.publicDir, 'config.js'), 'utf8').replace(/mode:\s*'[a-z]+'/, "mode: 'server'");
app.get('/config.js', (req, res) => {
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(serverConfig);
});

// 화면 파일
app.use(express.static(config.publicDir, {
  setHeaders(res, file) {
    if (file.endsWith('.html') || file.endsWith('config.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// 오류 처리
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  res.status(status).json({ error: status >= 500 ? '서버 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.' : err.message });
});

app.listen(config.port, config.host, () => {
  console.log(`센서 파손 이력 서버: http://localhost:${config.port}  (데이터: ${config.dataDir})`);
});

export { uid };
