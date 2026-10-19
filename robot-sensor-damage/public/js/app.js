// 앱 상태와 공통 동작 — 화면(views)들이 이 객체를 통해 API와 라우팅을 쓴다.
import { call } from './api/index.js';
import { ROLES } from './core/constants.js';

export const app = {
  user: null,
  mode: null,
  stats: { open_reports: 0, my_need_info: 0 },
  call,
  go(path) {
    if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = path;
  },
  can(role) {
    return !!app.user && ROLES[app.user.role].level >= ROLES[role].level;
  },
  async refreshStats() {
    try {
      app.stats = await call('stats');
    } catch {
      /* 무시 */
    }
    app.onStats?.();
  },
};

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function setQuery(patch) {
  const { path, query } = parseHash();
  const q = new URLSearchParams({ ...query, ...patch });
  [...q.keys()].forEach((k) => {
    if (q.get(k) === '' || q.get(k) === 'null' || q.get(k) === 'undefined') q.delete(k);
  });
  const s = q.toString();
  history.replaceState(null, '', `#${path}${s ? `?${s}` : ''}`);
}
