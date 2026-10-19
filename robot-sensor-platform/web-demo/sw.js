// 센서로그 웹 데모 — 서비스 워커 안에서 실제 서버 코드(server/app.js)를 그대로 실행한다.
// 화면이 보내는 /api·/files 요청을 가로채 서버 코드로 처리하고, 데이터는 이 브라우저의 IndexedDB에 둔다.
import { createApp } from '../server/app.js';
import { initSqlite, openedDatabase } from './shims/sqlite.js';
import { kvGet, kvSet, flushFiles, readFileAsync, createJar, clearAll } from './shims/storage.js';
import { seedDemo } from './seed.js';

const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const DEMO_VERSION = 1; // 데이터 구조가 바뀌면 올린다(올리면 예시 데이터로 새로 시작)
const STATIC = /^\/(css|js|vendor)\/|^\/sample-sensors\.csv$/;
const jar = createJar('cookies');
let booting = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function boot() {
  if (!booting) {
    booting = (async () => {
      const meta = await kvGet('meta');
      const fresh = meta?.version !== DEMO_VERSION;
      if (fresh) await clearAll();
      const bytes = fresh ? null : await kvGet('db');
      await initSqlite(`${BASE}/sql-wasm.wasm`, bytes);
      process.env.PUBLIC_URL = self.location.origin + BASE;
      const created = createApp({ dataDir: '/data', initialPassword: 'sys1234', secure: true });
      if (!bytes) await seedDemo(created, { base: BASE, origin: self.location.origin });
      await jar.load();
      await persist();
      await kvSet('meta', { version: DEMO_VERSION, createdAt: fresh ? new Date().toISOString() : meta.createdAt });
      return created.app;
    })();
    booting.catch(() => {
      booting = null;
    });
  }
  return booting;
}

async function persist() {
  const db = openedDatabase();
  if (db?.dirty) await kvSet('db', db.takeSnapshot());
  await flushFiles();
  await jar.flush();
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function backend(request, path) {
  let app;
  try {
    app = await boot();
  } catch (e) {
    console.error(e);
    return json({ error: `웹 데모를 시작하지 못했습니다: ${e.message}` }, 500);
  }
  const res = await app.handle(request, { path, jar, readFile: readFileAsync });
  await persist();
  return res;
}

// 화면(index.html)에 웹 데모 표시를 넣어 내려준다 — 화면 코드는 이것을 보고 주소 앞부분과 데모 안내를 맞춘다
async function appPage() {
  boot().catch(() => {});
  const res = await fetch(`${BASE}/app/index.html`);
  const html = (await res.text()).replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="app-base" content="${BASE}"><meta name="app-demo" content="1">`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function reset() {
  booting = null;
  jar.clear();
  await clearAll();
  return json({ ok: true });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const inBase = url.pathname === BASE || url.pathname.startsWith(`${BASE}/`);
  const rel = inBase ? url.pathname.slice(BASE.length) || '/' : url.pathname;
  if (/^\/(api|files)(\/|$)/.test(rel)) event.respondWith(backend(event.request, rel + url.search));
  else if (rel === '/__demo/reset' && event.request.method === 'POST') event.respondWith(reset());
  else if (rel === '/__demo/ready') event.respondWith(boot().then(() => json({ ok: true }), (e) => json({ error: e.message }, 500)));
  else if (STATIC.test(rel)) event.respondWith(fetch(`${BASE}/app${rel}${url.search}`));
  else if (inBase && event.request.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(rel)) event.respondWith(appPage());
});
