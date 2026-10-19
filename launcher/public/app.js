// 실행 관리 홈페이지 화면
// - 로컬 런처(launcher/server.js)에 연결되면: 실행·중지·진행률·계정·로그
// - GitHub Pages처럼 런처가 없으면: 온라인 데모 링크와 실행 방법 안내
const REPO = 'https://github.com/hljihun98/robot-sensor-3d';
const PAGES = 'https://hljihun98.github.io/robot-sensor-3d/';
const LAUNCHER = 'http://127.0.0.1:8080/';
const ZIP = `${REPO}/archive/refs/heads/main.zip`;
const DEMO_ACCOUNTS = '데모 계정  field / field1234 · admin / admin1234 · sysadmin / sys1234';
const POLL_MS = 1500;
const BASE_TITLE = document.title;

const ICONS = {
  dome: '<svg viewBox="0 0 32 32"><path d="M6 20a10 10 0 0 1 20 0"/><rect x="5" y="20" width="22" height="6" rx="2"/><path d="M11 14c2-3 6-4 9-2"/></svg>',
  camera: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3"/><circle cx="11" cy="16" r="3"/><circle cx="21" cy="16" r="3"/><path d="M13 27h6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

const CATALOG = [
  {
    id: 'damage',
    title: '센서 파손 3D 이력관리',
    folder: 'robot-sensor-damage',
    icon: 'dome',
    desc: '업무 로직 하나를 브라우저와 서버가 함께 씁니다. 서버 없이도 데모 모드로 바로 열리고, 라이다 창을 360°로 펼쳐 볼 수 있습니다.',
    chips: ['360° 펼쳐보기', '날짜 기준 보기', '데모 모드', 'Node 22.13+'],
    short: '센서 파손 3D',
    demo: 'damage/',
    webNote: '설치 없이 이 브라우저에서 바로 열립니다. 데이터는 이 브라우저에만 저장됩니다.',
    accountTitle: '첫 로그인 계정',
    accountHint: '이 비밀번호는 처음 실행할 때 한 번만 나옵니다. 로그인하면 새 비밀번호로 바꾸게 됩니다.',
    modeHint: {
      server: '실제 운영 방식 · 데이터는 data/ 폴더에 저장',
      demo: '설치 없이 바로 · 데이터는 브라우저에만 저장',
    },
    modeNote: {
      demo: '데모 계정  field / field1234 · admin / admin1234 · sysadmin / sys1234',
    },
  },
  {
    id: 'platform',
    title: '센서로그',
    folder: 'robot-sensor-platform',
    icon: 'camera',
    desc: '서버 저장형입니다. 사진을 서버에서 변환하고 사진마다 공개 권한을 검사합니다. 호기 QR 코드와 CSV 시리얼 일괄 등록을 지원합니다.',
    chips: ['QR 코드', 'CSV 일괄 등록', '사진별 권한', 'Node 24+'],
    short: '센서로그',
    demo: 'platform/',
    webNote: '센서로그 서버를 이 브라우저 안에서 그대로 실행합니다. 데이터는 이 브라우저에만 저장됩니다.',
    accountTitle: '첫 로그인 계정',
    accountHint: '로그인하면 12자 이상 새 비밀번호로 바꾸게 됩니다. 바꾼 뒤에는 data/initial-account.txt 파일을 지우세요.',
    modeHint: { server: '데이터는 data/ 폴더에 저장' },
    modeNote: {},
  },
];

const STATUS = {
  stopped: ['중지됨', ''],
  installing: ['설치 중', 'busy'],
  starting: ['시작 중', 'busy'],
  running: ['실행 중', 'running'],
  error: ['문제 발생', 'error'],
  external: ['다른 창에서 실행 중', 'running'],
};
const ACTIVE = ['installing', 'starting', 'running'];

// ── 도우미 (사용자·로그 문자열은 모두 textContent로 넣는다) ─────────────
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
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};
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

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const since = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '방금 시작';
  if (m < 60) return `${m}분째`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분째`;
};

async function getJson(url, timeout = 2000) {
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
function wireCopy(btn, getText) {
  const label = btn.textContent;
  btn.addEventListener('click', async () => {
    const ok = await copyText(getText());
    btn.textContent = ok ? '복사됨' : '복사 실패';
    btn.classList.toggle('done', ok);
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('done');
    }, 1600);
  });
  return btn;
}
const copyButton = (text, what) => wireCopy(h('button', { type: 'button', class: 'copy', 'aria-label': `${what} 복사` }, '복사'), () => text);

function toast(message, { action, href, onClick, tone } = {}) {
  const box = $('#toasts');
  const close = () => el.remove();
  const el = h('div', { class: `toast ${tone ?? ''}` }, h('span', {}, message),
    action && (href ? h('a', { href, target: '_blank', rel: 'noopener', onclick: close }, action)
      : h('button', { type: 'button', onclick: () => { onClick?.(); close(); } }, action)),
    h('button', { type: 'button', class: 'x', 'aria-label': '알림 닫기', onclick: close }, '✕'));
  box.append(el);
  while (box.childElementCount > 3) box.firstElementChild.remove();
  setTimeout(close, 8000);
}

// 다른 탭을 보고 있을 때 준비되면 탭 제목으로 알린다
let titleFlag = '';
const flagTitle = (text) => {
  if (!document.hidden) return;
  titleFlag = text;
  document.title = `${text} · ${BASE_TITLE}`;
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && titleFlag) {
    titleFlag = '';
    document.title = BASE_TITLE;
  }
});

const card = (meta, ...body) => h('article', { class: 'card', id: `app-${meta.id}` },
  h('div', { class: 'card-head' },
    h('span', { class: 'card-icon', 'aria-hidden': 'true', icon: meta.icon }),
    h('div', { class: 'card-title' }, h('h2', {}, meta.title), h('span', { class: 'folder' }, meta.folder))),
  h('p', {}, meta.desc),
  h('ul', { class: 'chips', 'aria-label': '특징' }, meta.chips.map((c) => h('li', {}, c))),
  ...body);

// ── 운영체제 탭(실행 방법) ─────────────
function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';
  if (!/win/i.test(platform) && tabs[1]) select(tabs[1]);
  document.querySelectorAll('.copy[data-copy]').forEach((b) => wireCopy(b, () => b.dataset.copy));
}

// ── 온라인 모드(GitHub Pages) ─────────────
function renderOnline() {
  setText($('#conn'), '온라인 데모');
  $('#conn').className = 'conn online';
  const sw = $('#switch-link');
  Object.assign(sw, { href: LAUNCHER, textContent: '내 PC 런처 열기', title: '런처(START.cmd)를 켠 뒤에 누르세요', hidden: false });
  setText($('#hero-text'), '같은 기획안으로 만든 두 프로그램입니다. 둘 다 설치 없이 웹에서 바로 실행하거나, 내려받아 내 PC에서 실제 운영처럼 쓸 수 있습니다.');
  $('#hero-actions').replaceChildren(
    ...CATALOG.map((m) => h('a', { class: 'btn primary big', href: m.demo, icon: 'play' }, `${m.short} 데모`)),
    h('a', { class: 'btn big', href: '#howto', icon: 'down' }, '내려받아 실행하기'));
  const way = (n, title, text, ...actions) => h('div', { class: 'way' },
    h('h3', {}, h('span', { class: 'way-n', 'aria-hidden': 'true' }, n), title), h('p', {}, text), h('div', { class: 'actions' }, ...actions));
  $('#apps').replaceChildren(...CATALOG.map((meta) => card(meta,
    h('div', { class: 'control' },
      h('div', { class: 'ways' },
        way('1', '웹에서 바로 실행', meta.webNote, h('a', { class: 'btn primary', href: meta.demo, icon: 'play' }, '데모 바로 실행')),
        way('2', '내려받아 실행', '내 PC에서 실제 운영처럼 씁니다. 데이터는 PC의 data/ 폴더에 저장됩니다.',
          h('a', { class: 'btn', href: ZIP, icon: 'down' }, 'ZIP 내려받기'), h('a', { class: 'btn ghost', href: '#howto' }, '실행 방법'))),
      h('div', { class: 'note' }, DEMO_ACCOUNTS),
      h('a', { class: 'small', href: `${REPO}/tree/main/${meta.folder}` }, '코드 보기 →')))));
}

// ── 로컬 모드(런처 연결) ─────────────
const views = {};
const state = { node: '' };

function buildLocalCard(meta, app) {
  const v = { meta, id: meta.id, since: 0, busy: false, actionError: null, sig: {}, prev: app.status };
  const saved = store.get(`launcher-mode-${meta.id}`);
  v.mode = app.mode ?? (app.modes.some((m) => m.id === saved) ? saved : app.modes[0].id);

  v.pill = h('span', { class: 'pill' });
  v.modes = app.modes.length > 1
    ? h('div', { class: 'modes', role: 'group', 'aria-label': '실행 방식' }, app.modes.map((m) => h('button', {
      type: 'button', 'data-mode': m.id, onclick: () => {
        v.mode = m.id;
        store.set(`launcher-mode-${meta.id}`, m.id);
        update(v, v.last);
      },
    }, m.label)))
    : h('b', { class: 'small' }, app.modes[0].label);
  v.modeHint = h('span', { class: 'mode-hint' });

  v.stepper = h('ol', { class: 'stepper', 'aria-label': '진행 단계' });
  v.bar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': '설치 진행률' }, h('span'));
  v.progressText = h('div', { class: 'progress-text' });
  v.progressHint = h('div', { class: 'mode-hint' });
  v.progress = h('div', { class: 'progress', hidden: true }, v.stepper, v.bar, h('div', {}, v.progressText, v.progressHint));

  v.facts = h('dl', { class: 'facts' });
  v.notes = h('div', { class: 'stack' });
  v.account = h('div', { class: 'account', hidden: true });

  v.runBtn = h('button', { type: 'button', class: 'btn primary', icon: 'play', onclick: () => act(v, 'start') }, h('span', {}, '실행'));
  v.openBtn = h('a', { class: 'btn primary', target: '_blank', rel: 'noopener', icon: 'open' }, '열기');
  v.stopBtn = h('button', { type: 'button', class: 'btn danger', icon: 'stop', onclick: () => act(v, 'stop') }, h('span', {}, '중지'));

  v.log = h('pre', { class: 'log', tabindex: '0', 'aria-label': `${meta.title} 실행 로그` });
  v.logCount = h('span', { class: 'muted' });
  v.logBox = h('details', { class: 'logs', ontoggle: () => v.logBox.open && pullLogs(v) },
    h('summary', {}, '실행 로그 ', v.logCount),
    h('div', { class: 'log-tools' },
      wireCopy(h('button', { type: 'button', class: 'copy' }, '로그 복사'), () => v.log.innerText),
      h('button', { type: 'button', class: 'copy', onclick: () => { v.log.scrollTop = v.log.scrollHeight; } }, '맨 아래로')),
    v.log);
  if (store.get(`launcher-logs-${meta.id}`) === '1') v.logBox.open = true;
  v.logBox.addEventListener('toggle', () => store.set(`launcher-logs-${meta.id}`, v.logBox.open ? '1' : '0'));

  v.el = card(meta, h('div', { class: 'control' },
    h('div', { class: 'mode-row' }, v.modes, v.modeHint),
    v.progress, v.facts, v.account, v.notes,
    h('div', { class: 'actions' }, v.runBtn, v.openBtn, v.stopBtn), v.logBox));
  v.el.querySelector('.card-head').append(v.pill);
  return v;
}

const fact = (label, ...value) => [h('dt', {}, label), h('dd', {}, ...value)];

function update(v, app) {
  v.last = app;
  const active = ACTIVE.includes(app.status);
  if (active) v.mode = app.mode;
  const mode = app.modes.find((m) => m.id === v.mode) ?? app.modes[0];
  const external = !active && mode.inUse;
  const status = external ? 'external' : app.status;
  const [label, tone] = STATUS[status] ?? STATUS.stopped;

  // 상태 표시(경과 시간 포함)
  const extra = status === 'installing' || status === 'starting' ? ` · ${clock(app.elapsedMs)}`
    : status === 'running' ? ` · ${since(app.elapsedMs)}` : '';
  setText(v.pill, label + extra);
  v.pill.className = `pill ${tone}`;
  v.el.classList.toggle('is-running', status === 'running' || external);

  v.modes.querySelectorAll?.('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === v.mode));
    b.disabled = active;
  });
  setText(v.modeHint, v.meta.modeHint[mode.id] ?? '');

  // 진행 단계: 설치 → 시작 → 열기
  const showProgress = status === 'installing' || status === 'starting';
  v.progress.hidden = !showProgress;
  if (showProgress) {
    const steps = [...(mode.install ? [['설치', 'installing']] : []), ['시작', 'starting'], ['열기', 'running']];
    const at = steps.findIndex((s) => s[1] === status);
    const sig = `${steps.length}:${at}`;
    if (v.sig.steps !== sig) {
      v.sig.steps = sig;
      v.stepper.replaceChildren(...steps.map(([name], i) => h('li', { 'data-n': i + 1, class: i < at ? 'done' : i === at ? 'now' : '' }, name)));
    }
    const p = app.progress;
    const pct = p?.total ? Math.min(99, Math.round((p.done / p.total) * 100)) : null;
    v.bar.classList.toggle('indeterminate', pct == null || status === 'starting');
    v.bar.firstChild.style.width = pct == null || status === 'starting' ? '' : `${pct}%`;
    if (pct == null || status === 'starting') v.bar.removeAttribute('aria-valuenow');
    else v.bar.setAttribute('aria-valuenow', String(pct));
    setText(v.progressText, status === 'installing'
      ? `필요한 패키지를 받는 중${p?.total ? ` · ${Math.min(p.done, p.total)} / ${p.total}개 (${pct}%)` : ''}`
      : '프로그램을 켜는 중');
    setText(v.progressHint, status === 'installing'
      ? '처음 한 번만 설치합니다. 인터넷 속도에 따라 몇 분 걸릴 수 있습니다.'
      : '처음 실행할 때는 기본 데이터를 만드느라 10초쯤 걸립니다.');
  }

  // 정보(바뀔 때만 다시 그림 — 복사 버튼 포커스 유지)
  const installText = app.installed ? '설치됨' : status === 'installing' ? '설치하는 중…' : '아직 안 됨 · 처음 실행할 때 자동으로 설치';
  const factSig = [mode.id, mode.nodeOk, installText, state.node].join('|');
  if (v.sig.facts !== factSig) {
    v.sig.facts = factSig;
    v.facts.replaceChildren(
      ...fact('주소', h('code', {}, mode.url), copyButton(mode.url, '주소')),
      ...fact('필요 환경', `Node.js ${mode.node}+ `, mode.nodeOk ? h('span', { class: 'ok' }, '✓ 충족') : h('span', { class: 'no' }, `✗ 지금 ${state.node}`)),
      ...(mode.install ? fact('설치', installText) : []),
      ...(mode.id === 'server' ? fact('데이터', h('code', { title: app.dataDir }, `${app.dir}/data/`)) : []));
  }

  // 첫 로그인 계정
  const acc = mode.id === 'server' ? app.account : null;
  const accSig = acc ? `${acc.id}|${acc.password}` : '';
  if (v.sig.account !== accSig) {
    v.sig.account = accSig;
    v.account.hidden = !acc;
    if (acc) {
      v.account.replaceChildren(
        h('h3', {}, v.meta.accountTitle),
        h('div', { class: 'row' }, h('span', {}, '아이디'), h('code', {}, acc.id), copyButton(acc.id, '아이디')),
        h('div', { class: 'row' }, h('span', {}, '임시 비밀번호'), h('code', {}, acc.password), copyButton(acc.password, '임시 비밀번호')),
        h('p', {}, v.meta.accountHint));
    }
  }

  // 안내·오류
  const notes = [];
  if (!mode.nodeOk) notes.push(['error', `이 방식은 Node.js ${mode.node} 이상이 필요합니다(지금 ${state.node}). nodejs.org에서 LTS를 설치한 뒤 런처를 다시 켜세요.`]);
  if (v.actionError) notes.push(['error', v.actionError]);
  if (app.error && !active) notes.push(['error', app.error]);
  if (external) notes.push(['warn', `포트 ${mode.port}을 다른 창에서 이미 쓰고 있습니다. "열기"로 그대로 쓰거나, 그 창을 닫으면 여기서 실행할 수 있습니다.`]);
  if (!acc && v.meta.modeNote[mode.id] && !external) notes.push(['', v.meta.modeNote[mode.id]]);
  const noteSig = JSON.stringify(notes);
  if (v.sig.notes !== noteSig) {
    v.sig.notes = noteSig;
    v.notes.replaceChildren(...notes.map(([t, text]) => h('div', { class: `note ${t}` }, t === 'error' ? h('b', {}, '확인 필요  ') : null, text)));
  }

  // 버튼: 상태마다 다음에 할 일을 주 버튼으로
  const busyNow = status === 'installing' || status === 'starting';
  v.runBtn.hidden = active || external;
  v.runBtn.disabled = v.busy || !mode.nodeOk;
  setText(v.runBtn.lastChild, app.status === 'error' ? '다시 실행' : app.installed || !mode.install ? '실행' : '설치하고 실행');
  v.openBtn.hidden = !(status === 'running' || external);
  v.openBtn.href = mode.url;
  v.stopBtn.hidden = !active;
  v.stopBtn.disabled = v.busy;
  setText(v.stopBtn.lastChild, busyNow ? '취소' : '중지');

  // 상태가 바뀌는 순간 알림
  if (v.prev !== app.status) {
    if (app.status === 'running' && ['installing', 'starting'].includes(v.prev)) {
      v.openBtn.classList.add('ready');
      setTimeout(() => v.openBtn.classList.remove('ready'), 5000);
      toast(`${v.meta.title} 준비됐습니다.`, { action: '열기', href: mode.url });
      flagTitle('✓ 준비됨');
    }
    if (app.status === 'error') {
      v.logBox.open = true;
      toast(`${v.meta.title}에 문제가 생겼습니다. 카드의 안내와 로그를 확인하세요.`, { tone: 'error' });
      flagTitle('⚠ 확인 필요');
    }
    v.prev = app.status;
  }

  setText(v.logCount, app.lastSeq ? `(${Math.min(app.lastSeq, 400)}줄)` : '');
  if (v.logBox.open && app.lastSeq > v.since) pullLogs(v);
}

async function act(v, action) {
  v.busy = true;
  v.actionError = null;
  update(v, v.last);
  try {
    await post(`api/apps/${v.id}/${action}${action === 'start' ? `?mode=${v.mode}` : ''}`);
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
    const r = await getJson(`api/apps/${v.id}/logs?since=${v.since}`);
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

function updateSummary(apps) {
  const running = apps.filter((a) => ACTIVE.includes(a.status));
  setText($('#summary-count'), running.length ? `${running.length}개 실행 중` : '실행 중인 프로그램 없음');
  $('#stop-all').hidden = running.length === 0;
}

async function stopAll() {
  const ids = Object.values(views).filter((v) => ACTIVE.includes(v.last?.status)).map((v) => v.id);
  await Promise.allSettled(ids.map((id) => post(`api/apps/${id}/stop`)));
  toast('실행 중인 프로그램을 모두 중지했습니다.');
  poll();
}

let lost = false;
async function poll() {
  const data = await getJson('api/apps');
  if (!data) {
    if (!lost) {
      lost = true;
      setText($('#conn'), '런처 연결 끊김');
      $('#conn').className = 'conn lost';
      $('#lost-banner').hidden = false;
      document.querySelectorAll('#apps button').forEach((b) => { b.disabled = true; });
    }
    return;
  }
  if (lost) {
    lost = false;
    $('#lost-banner').hidden = true;
    document.querySelectorAll('#apps button').forEach((b) => { b.disabled = false; });
    Object.values(views).forEach((v) => { v.sig = {}; });
    toast('런처에 다시 연결됐습니다.');
  }
  state.node = data.node;
  setText($('#conn'), `런처 연결됨 · Node ${data.node}`);
  $('#conn').className = 'conn local';
  data.apps.forEach((app) => views[app.id] && update(views[app.id], app));
  updateSummary(data.apps);
}

function renderLocal(data) {
  state.node = data.node;
  setText($('#hero-text'), '이 PC에서 두 프로그램을 실행하고 관리합니다. 실행을 누르면 필요한 패키지를 설치한 뒤 프로그램을 켜고, 준비되면 열기로 바로 접속합니다.');
  $('#howto').hidden = true;
  const sw = $('#switch-link');
  Object.assign(sw, { href: PAGES, textContent: '온라인 데모', target: '_blank', rel: 'noopener', hidden: false });
  $('#hero-actions').replaceChildren(
    h('span', { class: 'summary' }, h('b', { id: 'summary-count' }, '')),
    h('button', { type: 'button', id: 'stop-all', class: 'btn small danger', icon: 'stop', onclick: stopAll, hidden: true }, '모두 중지'));
  const apps = $('#apps');
  apps.replaceChildren();
  CATALOG.forEach((meta) => {
    const app = data.apps.find((a) => a.id === meta.id);
    if (!app) return;
    views[meta.id] = buildLocalCard(meta, app);
    apps.append(views[meta.id].el);
    update(views[meta.id], app);
  });
  setText($('#conn'), `런처 연결됨 · Node ${data.node}`);
  $('#conn').className = 'conn local';
  updateSummary(data.apps);
  // 다른 탭을 보는 동안에도 천천히 확인해야 "준비됨"을 탭 제목으로 알릴 수 있다
  const loop = async () => {
    await poll();
    setTimeout(loop, document.hidden ? 4000 : POLL_MS);
  };
  setTimeout(loop, POLL_MS);
  document.addEventListener('visibilitychange', () => !document.hidden && poll());
}

(async () => {
  setupTabs();
  const data = await getJson('api/apps');
  if (data?.apps) renderLocal(data);
  else renderOnline();
})();
