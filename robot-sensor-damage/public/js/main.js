// 진입점 — API 모드 결정, 로그인 확인, 해시 라우팅
import { initApi, currentUser, logout, resetDemo } from './api/index.js';
import { app, parseHash } from './app.js';
import { h, clear, roleText, fill } from './ui/dom.js';
import { openModal, toast, confirmModal } from './ui/modal.js';
import { loginView, changePasswordModal } from './views/login.js';
import { homeView } from './views/home.js';
import { robotView } from './views/robot.js';
import { sensorView } from './views/sensor.js';
import { myReportsView, reviewQueueView } from './views/reports.js';
import { reportView } from './views/report.js';
import { adminRobotsView } from './views/adminRobots.js';
import { adminUsersView, auditView } from './views/adminUsers.js';

const ROUTES = [
  [/^\/$/, homeView],
  [/^\/robot\/(\d+)$/, robotView, ['no']],
  [/^\/robot\/(\d+)\/(LIDAR_1|LIDAR_2|CAM_1|CAM_2)$/, sensorView, ['no', 'slot']],
  [/^\/sensor\/([\w-]+)$/, sensorView, ['sensorId']],
  [/^\/my-reports$/, myReportsView],
  [/^\/reports\/([\w-]+)$/, reportView, ['id']],
  [/^\/admin\/reports$/, reviewQueueView, [], 'ADMIN'],
  [/^\/admin\/robots$/, adminRobotsView, [], 'ADMIN'],
  [/^\/admin\/users$/, adminUsersView, [], 'SYSADMIN'],
  [/^\/admin\/audit$/, auditView, [], 'SYSADMIN'],
];

const root = document.getElementById('app');
let cleanup = null;
let shell = null;

function navLink(path, label, countKey) {
  const a = h('a', { href: `#${path}`, 'data-path': path }, label);
  if (countKey) a.dataset.count = countKey;
  return a;
}

function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': '주 메뉴' },
    navLink('/', '호기 검색'),
    navLink('/my-reports', '내 신고', 'my_need_info'),
    app.can('ADMIN') && navLink('/admin/reports', '신고 검토', 'open_reports'),
    app.can('ADMIN') && navLink('/admin/robots', '호기·센서 관리'),
    app.can('SYSADMIN') && navLink('/admin/users', '계정'),
    app.can('SYSADMIN') && navLink('/admin/audit', '변경 기록'));
  const userBox = h('div', { class: 'user-box' },
    h('span', {}, app.user.name, ' ', h('span', { class: 'chip' }, roleText(app.user.role))),
    h('button', { class: 'small', onclick: () => changePasswordModal() }, '비밀번호'),
    h('button', { class: 'small', onclick: async () => { await logout(); app.user = null; app.go('/login'); } }, '로그아웃'));
  const banner = app.mode === 'demo'
    ? h('div', { class: 'demo-banner' }, h('b', {}, '데모 모드'), '서버 없이 동작 중입니다. 데이터는 이 브라우저에만 저장됩니다.',
      h('button', { onclick: async () => {
        if (await confirmModal('데모 초기화', '이 브라우저에 저장된 데모 데이터를 지우고 처음 상태로 되돌립니다.', '초기화', true)) {
          await resetDemo();
          location.hash = '/login';
          location.reload();
        }
      } }, '데모 초기화'))
    : null;
  const main = h('main', { id: 'main' });
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, '3D'), h('span', {}, '센서 파손 ', h('span', { class: 'full' }, '이력 관리'))),
    nav, h('span', { class: 'spacer' }), userBox);
  fill(root, ...[banner, top, main].filter(Boolean));
  shell = { nav, main };
  app.onStats = updateBadges;
  updateBadges();
}

function updateBadges() {
  if (!shell) return;
  const { path } = parseHash();
  shell.nav.querySelectorAll('a').forEach((a) => {
    const p = a.dataset.path;
    a.classList.toggle('active', p === '/' ? path === '/' || path.startsWith('/robot') || path.startsWith('/sensor') : path.startsWith(p));
    a.querySelector('.count')?.remove();
    const n = a.dataset.count ? app.stats[a.dataset.count] : 0;
    if (n) a.append(h('span', { class: 'count' }, n));
  });
}

async function render() {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* 무시 */
    }
    cleanup = null;
  }
  const { path, query } = parseHash();
  if (!app.user) {
    shell = null;
    if (path !== '/login') {
      location.hash = '/login';
      return;
    }
    cleanup = await loginView(root, { onLogin: start });
    return;
  }
  if (path === '/login') {
    app.go('/');
    return;
  }
  if (!shell) buildShell();
  updateBadges();
  const main = clear(shell.main);
  const match = ROUTES.map(([re, view, keys = [], role]) => ({ m: path.match(re), view, keys, role })).find((r) => r.m);
  if (!match) {
    main.append(h('div', { class: 'empty' }, '페이지를 찾을 수 없습니다. ', h('a', { href: '#/' }, '처음으로')));
    return;
  }
  if (match.role && !app.can(match.role)) {
    main.append(h('div', { class: 'empty' }, '이 화면을 볼 권한이 없습니다.'));
    return;
  }
  if (app.user.must_change_pw) {
    main.append(h('div', { class: 'empty' }, '비밀번호를 바꾼 뒤 이용할 수 있습니다.'));
    return;
  }
  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
  window.scrollTo(0, 0);
  try {
    cleanup = (await match.view(main, { params, query })) ?? null;
  } catch (e) {
    console.error(e);
    fill(main, h('div', { class: 'error-box' }, e.message ?? String(e)));
    if (e.status === 401) {
      app.user = null;
      app.go('/login');
    }
  }
}

async function start() {
  app.user = await currentUser();
  shell = null;
  if (app.user) {
    await app.refreshStats();
    if (app.user.must_change_pw) setTimeout(() => changePasswordModal(true), 300);
    if (parseHash().path === '/login') {
      location.hash = '/';
      return;
    }
  }
  render();
}

window.addEventListener('hashchange', render);
(async () => {
  root.append(h('div', { class: 'empty' }, '불러오는 중…'));
  try {
    app.mode = await initApi();
  } catch (e) {
    fill(root, h('div', { class: 'error-box' }, `시작하지 못했습니다: ${e.message}`));
    return;
  }
  await start();
})();

export { openModal, toast };
