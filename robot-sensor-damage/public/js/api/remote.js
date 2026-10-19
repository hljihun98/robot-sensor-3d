// 서버 모드 — 같은 서버의 /api 로 요청을 보낸다(쿠키 세션).
import { ROUTES, pathParams } from '../core/routes.js';

const base = () => new URL('./', document.baseURI);

async function request(method, path, args = {}) {
  const rest = { ...args };
  let p = path;
  pathParams(path).forEach((k) => {
    p = p.replace(`:${k}`, encodeURIComponent(rest[k]));
    delete rest[k];
  });
  const url = new URL(p.replace(/^\//, ''), base());
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (method === 'GET') {
    Object.entries(rest).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
    });
  } else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(rest);
  }
  const res = await fetch(url, init);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(body?.error ?? `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function probe() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(new URL('api/health', base()), { signal: ctrl.signal, credentials: 'same-origin' });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json();
    return j?.ok === true;
  } catch {
    return false;
  }
}

export function createRemoteApi() {
  return {
    mode: 'server',
    call(name, args) {
      const r = ROUTES[name];
      if (!r) throw new Error(`알 수 없는 요청: ${name}`);
      return request(r[0], r[1], args);
    },
    async login(login, password) {
      return request('POST', '/api/auth/login', { login, password });
    },
    async logout() {
      await request('POST', '/api/auth/logout', {});
    },
    async current() {
      try {
        return await request('GET', '/api/auth/me');
      } catch (e) {
        if (e.status === 401) return null;
        throw e;
      }
    },
  };
}
