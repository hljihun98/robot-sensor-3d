// 데모 모드 — 서버 없이 브라우저 안에서 같은 업무 로직(core/service.js)을 실행한다.
// 데이터는 이 브라우저의 IndexedDB 에만 저장된다(GitHub Pages 미리보기용).
import { createMemoryStore } from '../core/memoryStore.js';
import { createService } from '../core/service.js';
import { buildSeed } from '../core/seed.js';

const DB_NAME = 'rsd-demo';
const KEY = 'snapshot-v1';
const SESSION_KEY = 'rsd-demo-user';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
async function idbSet(key, value) {
  try {
    const db = await idb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('데모 데이터를 저장하지 못했습니다', e);
  }
}

// 데모용 간단 해시(실서버는 bcrypt 사용). 브라우저 안 데이터라 보안 목적이 아니다.
function demoHash(pw) {
  let h = 2166136261;
  for (const ch of `rsd:${pw}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `demo$${h.toString(16)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const ss = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      if (v) localStorage.setItem(SESSION_KEY, v);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* 저장 불가 환경 */
    }
  },
};

export async function createLocalApi() {
  let initial = await idbGet(KEY);
  if (!initial) initial = buildSeed({ withSamples: true, hashPassword: demoHash, now: () => new Date().toISOString() });
  let timer = null;
  let pending = null;
  const store = createMemoryStore(initial, {
    onChange(snap) {
      pending = snap;
      clearTimeout(timer);
      timer = setTimeout(() => idbSet(KEY, pending), 250);
    },
  });
  idbSet(KEY, store.snapshot());
  const svc = createService(store, {
    now: () => new Date().toISOString(),
    today: localToday,
    uid,
    hashPassword: demoHash,
    verifyPassword: (pw, hash) => demoHash(pw) === hash,
    savePhoto: ({ full, thumb }) => ({ src: full, thumb }),
  });
  const ctx = () => {
    const id = ss.get();
    const u = id ? store.get('users', id) : null;
    return { user: u && u.active ? u : null };
  };
  const run = (fn) => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  };

  return {
    mode: 'demo',
    call: (name, args = {}) => run(() => {
      if (!svc[name]) throw new Error(`알 수 없는 요청: ${name}`);
      return structuredClone(svc[name](ctx(), args));
    }),
    login: (login, password) => run(() => {
      const u = svc.login({}, { login, password });
      ss.set(u.id);
      return u;
    }),
    logout: () => run(() => ss.set(null)),
    current: () => run(() => (ctx().user ? svc.me(ctx()) : null)),
    async reset() {
      clearTimeout(timer);
      ss.set(null);
      await idbSet(KEY, null);
    },
  };
}
