// 웹 데모 저장소 — 이 브라우저의 IndexedDB 에 DB 파일·사진·쿠키를 둔다.
// 가상 파일은 메모리에 먼저 쓰고, 요청이 끝날 때 flushFiles()로 IndexedDB에 저장한다.
const DB_NAME = 'sensorlog-web-demo';
let dbp = null;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));

// ── 가상 파일 ─────────────
const mem = new Map();
let pending = [];
const toBytes = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length));

export function writeFileNow(path, data) {
  const bytes = toBytes(data).slice();
  mem.set(path, bytes);
  pending.push(run('files', 'readwrite', (s) => s.put(bytes, path)));
}
export async function readFileAsync(path) {
  if (mem.has(path)) return mem.get(path);
  const bytes = await run('files', 'readonly', (s) => s.get(path));
  if (bytes) mem.set(path, bytes);
  return bytes ?? null;
}
export function removeFileNow(path) {
  mem.delete(path);
  pending.push(run('files', 'readwrite', (s) => s.delete(path)));
}
export async function flushFiles() {
  const p = pending;
  pending = [];
  await Promise.all(p);
}
export async function clearAll() {
  await flushFiles().catch(() => {});
  mem.clear();
  await run('kv', 'readwrite', (s) => s.clear());
  await run('files', 'readwrite', (s) => s.clear());
}

// ── 쿠키 상자 ─────────────
// 서비스 워커가 만든 응답의 Set-Cookie는 브라우저가 무시하므로, 로그인 쿠키를 여기서 대신 기억한다.
export function createJar(key) {
  const map = new Map();
  let dirty = false;
  return {
    header() {
      const now = Date.now();
      return [...map].filter(([, c]) => !c.expires || c.expires > now).map(([k, c]) => `${k}=${c.value}`).join('; ');
    },
    set(name, value, opts = {}) {
      map.set(name, { value, expires: opts.maxAge ? Date.now() + opts.maxAge : null });
      dirty = true;
    },
    delete(name) {
      map.delete(name);
      dirty = true;
    },
    clear() {
      map.clear();
      dirty = true;
    },
    async load() {
      if (!key) return;
      ((await kvGet(key)) ?? []).forEach(([k, c]) => map.set(k, c));
    },
    async flush() {
      if (!key || !dirty) return;
      dirty = false;
      await kvSet(key, [...map]);
    },
  };
}
