// 실행 관리 홈페이지 화면
// - 로컬 런처(launcher/server.js)에 연결되면: 실행·중지·로그 보기
// - GitHub Pages처럼 런처가 없으면: 온라인 데모 링크와 실행 방법 안내
const REPO = 'https://github.com/hljihun98/robot-sensor-3d';
const POLL_MS = 1500;

const ICONS = {
  dome: '<svg viewBox="0 0 32 32"><path d="M6 20a10 10 0 0 1 20 0"/><rect x="5" y="20" width="22" height="6" rx="2"/><path d="M11 14c2-3 6-4 9-2"/></svg>',
  camera: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3"/><circle cx="11" cy="16" r="3"/><circle cx="21" cy="16" r="3"/><path d="M13 27h6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
};

const CATALOG = [
  {
    id: 'damage',
    title: '센서 파손 3D 이력관리',
    folder: 'robot-sensor-damage',
    icon: 'dome',
    desc: '업무 로직 하나를 브라우저와 서버가 함께 씁니다. 서버 없이도 데모 모드로 바로 열리고, 라이다 창을 360°로 펼쳐 볼 수 있습니다.',
    chips: ['360° 펼쳐보기', '날짜 기준 보기', '데모 모드', 'Node 22.13+'],
    demo: 'damage/',
    noticeTitle: '초기 계정 (첫 실행 때 한 번만 표시)',
    demoNote: '데모 데이터는 보는 사람의 브라우저에만 저장됩니다.\n데모 계정  field / field1234 · admin / admin1234 · sysadmin / sys1234',
    modeNote: {
      server: '실제 운영 방식입니다. 데이터는 이 폴더의 data/ 에 저장됩니다. 첫 실행 때 시스템 관리자 임시 비밀번호가 아래에 나옵니다.',
      demo: '설치 없이 바로 열립니다. 데이터는 브라우저에만 저장됩니다.\n데모 계정  field / field1234 · admin / admin1234 · sysadmin / sys1234',
    },
  },
  {
    id: 'platform',
    title: '센서로그',
    folder: 'robot-sensor-platform',
    icon: 'camera',
    desc: '서버 저장형입니다. 사진을 서버에서 변환하고 사진마다 공개 권한을 검사합니다. 호기 QR 코드와 CSV 시리얼 일괄 등록을 지원합니다.',
    chips: ['QR 코드', 'CSV 일괄 등록', '사진별 권한', 'Node 24+'],
    demo: null,
    noticeTitle: '초기 계정 (data/initial-account.txt)',
    demoNote: '서버(Node.js·SQLite)가 꼭 필요한 프로그램이라 온라인 데모가 없습니다. 아래 "내 PC에서 실행하기"로 실행하세요.',
    modeNote: {
      server: '데이터는 이 폴더의 data/ 에 저장됩니다. 첫 실행 때 초기 계정(admin)과 임시 비밀번호가 아래에 나옵니다.',
    },
  },
];

const STATUS = {
  stopped: ['중지됨', ''],
  installing: ['설치 중', 'busy'],
  starting: ['시작 중', 'busy'],
  running: ['실행 중', 'running'],
  error: ['오류', 'error'],
  external: ['다른 곳에서 실행 중', 'running'],
};

// ── DOM 도우미 (사용자·로그 문자열은 모두 textContent로 넣는다) ─────────────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'icon') el.insertAdjacentHTML('afterbegin', ICONS[v]);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => c != null && c !== false && el.append(c instanceof Node ? c : String(c)));
  return el;
}
const $ = (sel) => document.querySelector(sel);
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 저장할 수 없는 환경 */
    }
  },
};

async function getJson(url, timeout = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function post(url) {
  const res = await fetch(url, { method: 'POST', headers: { 'X-Launcher': '1' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `요청 실패 (${res.status})`);
  return body;
}

const card = (meta, ...body) => h('article', { class: 'card', id: `app-${meta.id}` },
  h('div', { class: 'card-head' },
    h('span', { class: 'card-icon', 'aria-hidden': 'true', icon: meta.icon }),
    h('div', { class: 'card-title' }, h('h2', {}, meta.title), h('span', { class: 'folder' }, meta.folder))),
  h('p', {}, meta.desc),
  h('ul', { class: 'chips', 'aria-label': '특징' }, meta.chips.map((c) => h('li', {}, c))),
  ...body);

// ── 온라인 모드(GitHub Pages) ─────────────
function renderOnline() {
  $('#conn').textContent = '온라인 데모';
  $('#conn').className = 'conn online';
  const apps = $('#apps');
  apps.replaceChildren(...CATALOG.map((meta) => card(meta,
    h('div', { class: 'control' },
      h('div', { class: meta.demo ? 'note' : 'note warn' }, meta.demoNote),
      h('div', { class: 'actions' },
        meta.demo ? h('a', { class: 'btn primary', href: meta.demo, icon: 'play' }, '데모 바로 실행')
          : h('a', { class: 'btn primary', href: '#howto' }, '실행 방법 보기'),
        h('a', { class: 'btn', href: `${REPO}/tree/main/${meta.folder}`, icon: 'code' }, '코드 보기'))))));
}

// ── 로컬 모드(런처 연결) ─────────────
const views = {};

function buildLocalCard(meta, app) {
  const v = { meta, mode: null, since: 0, busy: false, actionError: null };
  const saved = store.get(`launcher-mode-${meta.id}`);
  v.mode = app.mode ?? (app.modes.some((m) => m.id === saved) ? saved : app.modes[0].id);
  v.pill = h('span', { class: 'pill' });
  v.modes = app.modes.length > 1
    ? h('div', { class: 'modes', role: 'group', 'aria-label': '실행 방식' }, app.modes.map((m) => h('button', { type: 'button', 'data-mode': m.id, onclick: () => {
      v.mode = m.id;
      store.set(`launcher-mode-${meta.id}`, m.id);
      update(v, v.last);
    } }, m.label)))
    : null;
  v.facts = h('dl', { class: 'facts' });
  v.notes = h('div', { class: 'stack' });
  v.startBtn = h('button', { type: 'button', class: 'btn primary', icon: 'play', onclick: () => act(v, 'start') }, '실행');
  v.stopBtn = h('button', { type: 'button', class: 'btn danger', icon: 'stop', onclick: () => act(v, 'stop') }, '중지');
  v.openBtn = h('a', { class: 'btn', target: '_blank', rel: 'noopener', icon: 'open' }, '열기');
  v.log = h('pre', { class: 'log', 'aria-live': 'off' });
  v.logBox = h('details', { class: 'logs', ontoggle: () => v.logBox.open && pullLogs(v) }, h('summary', {}, '실행 로그'), v.log);
  v.el = card(meta, h('div', { class: 'control' },
    v.modes ?? h('span', { class: 'muted small' }, app.modes[0].label),
    v.facts, v.notes, h('div', { class: 'actions' }, v.startBtn, v.stopBtn, v.openBtn), v.logBox));
  v.el.querySelector('.card-head').append(v.pill); // 상태는 카드 제목 옆에
  return v;
}

function fact(dl, label, value) {
  dl.append(h('dt', {}, label), h('dd', {}, value));
}

function update(v, app) {
  v.last = app;
  const active = ['installing', 'starting', 'running'].includes(app.status);
  if (active) v.mode = app.mode;
  const mode = app.modes.find((m) => m.id === v.mode) ?? app.modes[0];
  const external = !active && mode.inUse;
  const status = external ? 'external' : app.status;
  const [label, tone] = STATUS[status] ?? STATUS.stopped;
  v.pill.textContent = label;
  v.pill.className = `pill ${tone}`;

  v.modes?.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === v.mode));
    b.disabled = active;
  });

  v.facts.replaceChildren();
  fact(v.facts, '주소', h('code', {}, mode.url));
  fact(v.facts, '필요 환경', `Node.js ${mode.node}+ ${mode.nodeOk ? '✓' : `✗ (지금 ${state.node})`}`);
  if (mode.install) fact(v.facts, '설치', app.installed ? '설치됨' : '첫 실행 때 자동 설치 (인터넷 필요)');
  if (mode.id === 'server') fact(v.facts, '데이터', h('code', { title: app.dataDir }, `${app.dir}/data/`));

  const notes = [];
  if (!mode.nodeOk) notes.push(h('div', { class: 'note error' }, `이 방식은 Node.js ${mode.node} 이상이 필요합니다. 지금 버전은 ${state.node}입니다. nodejs.org에서 LTS를 설치하세요.`));
  if (v.actionError) notes.push(h('div', { class: 'note error' }, v.actionError));
  if (app.error && !active) notes.push(h('div', { class: 'note error' }, app.error));
  if (app.status === 'installing') notes.push(h('div', { class: 'note warn' }, '필요한 패키지를 설치하고 있습니다. 인터넷 속도에 따라 몇 분 걸릴 수 있고, 끝날 때까지 로그가 조용할 수 있습니다.'));
  if (external) notes.push(h('div', { class: 'note warn' }, `포트 ${mode.port}을 이미 다른 창에서 쓰고 있습니다. 그 프로그램을 쓰려면 "열기", 여기서 실행하려면 그 창을 먼저 닫으세요.`));
  if (app.notice && mode.id === 'server') notes.push(h('div', { class: 'note' }, h('b', {}, `${v.meta.noticeTitle}\n`), app.notice));
  else notes.push(h('div', { class: 'note' }, v.meta.modeNote[mode.id] ?? ''));
  v.notes.replaceChildren(...notes);

  v.startBtn.hidden = active;
  v.startBtn.disabled = v.busy || !mode.nodeOk || external;
  v.startBtn.lastChild.textContent = app.installed || !mode.install ? '실행' : '설치하고 실행';
  v.stopBtn.hidden = !active;
  v.stopBtn.disabled = v.busy;
  v.openBtn.hidden = !(app.status === 'running' || external);
  v.openBtn.href = mode.url;

  if (v.logBox.open && app.lastSeq > v.since) pullLogs(v);
}

async function act(v, action) {
  v.busy = true;
  v.actionError = null;
  update(v, v.last);
  try {
    await post(`api/apps/${v.meta.id}/${action}${action === 'start' ? `?mode=${v.mode}` : ''}`);
    if (action === 'start') v.logBox.open = true;
  } catch (e) {
    v.actionError = e.message;
  } finally {
    v.busy = false;
    await poll();
  }
}

const time = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false });
async function pullLogs(v) {
  if (v.pulling) return;
  v.pulling = true;
  try {
    const r = await getJson(`api/apps/${v.meta.id}/logs?since=${v.since}`);
    if (!r?.lines?.length) return;
    const stick = v.log.scrollTop + v.log.clientHeight >= v.log.scrollHeight - 8;
    r.lines.forEach((l) => v.log.append(h('div', { class: l.kind }, h('span', { class: 't' }, time(l.at)), l.line)));
    while (v.log.childElementCount > 400) v.log.firstElementChild.remove();
    v.since = r.lines.at(-1).seq;
    if (stick) v.log.scrollTop = v.log.scrollHeight;
  } finally {
    v.pulling = false;
  }
}

const state = { node: '' };
let lost = false;
async function poll() {
  const data = await getJson('api/apps');
  if (!data) {
    lost = true;
    $('#conn').textContent = '런처 연결 끊김 · 다시 연결 중';
    $('#conn').className = 'conn';
    return;
  }
  state.node = data.node;
  if (lost) lost = false;
  $('#conn').textContent = `로컬 런처 연결됨 · Node ${data.node}`;
  $('#conn').className = 'conn local';
  data.apps.forEach((app) => views[app.id] && update(views[app.id], app));
}

function renderLocal(data) {
  state.node = data.node;
  $('#hero-text').textContent = '이 PC에서 두 프로그램을 실행하고 관리합니다. 실행을 누르면 필요한 패키지를 설치한 뒤 프로그램을 켜고, 열기로 바로 접속할 수 있습니다.';
  $('#howto').hidden = true;
  const apps = $('#apps');
  apps.replaceChildren();
  CATALOG.forEach((meta) => {
    const app = data.apps.find((a) => a.id === meta.id);
    if (!app) return;
    views[meta.id] = buildLocalCard(meta, app);
    apps.append(views[meta.id].el);
    update(views[meta.id], app);
  });
  $('#conn').textContent = `로컬 런처 연결됨 · Node ${data.node}`;
  $('#conn').className = 'conn local';
  setInterval(() => !document.hidden && poll(), POLL_MS);
}

(async () => {
  const data = await getJson('api/apps');
  if (data?.apps) renderLocal(data);
  else renderOnline();
})();
