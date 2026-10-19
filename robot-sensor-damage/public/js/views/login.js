import { app } from '../app.js';
import { login, logout } from '../api/index.js';
import { DEMO_ACCOUNTS } from '../core/seed.js';
import { h, clear, roleText, fill } from '../ui/dom.js';
import { openModal, toast } from '../ui/modal.js';

export async function loginView(root, { onLogin }) {
  const err = h('div', { class: 'error-box hidden' });
  const id = h('input', { name: 'login', autocomplete: 'username', placeholder: '아이디', required: true });
  const pw = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', placeholder: '비밀번호', required: true });
  const submit = async (l, p) => {
    err.classList.add('hidden');
    try {
      await login(l, p);
      await onLogin();
    } catch (e) {
      fill(err, e.message);
      err.classList.remove('hidden');
    }
  };
  const form = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); submit(id.value, pw.value); } },
    h('label', { class: 'field' }, '아이디', id),
    h('label', { class: 'field' }, '비밀번호', pw),
    h('button', { class: 'primary', type: 'submit' }, '로그인'));
  const demo = app.mode === 'demo'
    ? h('div', { class: 'stack' },
      h('div', { class: 'notice warn' }, '데모 모드입니다. 아래 예시 계정으로 바로 들어가 볼 수 있습니다. 데이터는 이 브라우저에만 저장됩니다.'),
      h('div', { class: 'demo-accounts' }, DEMO_ACCOUNTS.map((a) => h('button', { type: 'button', onclick: () => submit(a.login, a.password) },
        h('span', {}, roleText(a.role)), h('span', { class: 'muted mono' }, `${a.login} / ${a.password}`)))))
    : null;
  fill(root, h('div', { class: 'login-wrap' }, h('div', { class: 'card login-card' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '3D'), '센서 파손 이력 관리'),
    h('div', { class: 'muted' }, '로봇 호기별 라이다·카메라 파손을 3D로 확인하고 기록합니다.'),
    err, form, demo)));
  id.focus();
  return null;
}

export function changePasswordModal(forced = false) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const again = h('input', { type: 'password', autocomplete: 'new-password' });
  openModal({
    title: forced ? '비밀번호를 바꿔 주세요' : '비밀번호 변경',
    body: h('div', { class: 'stack' },
      forced ? h('div', { class: 'notice warn' }, '처음 로그인했거나 비밀번호가 초기화되었습니다. 새 비밀번호를 정해 주세요.') : null,
      h('label', { class: 'field' }, '현재 비밀번호', cur),
      h('label', { class: 'field' }, '새 비밀번호 (6자 이상)', next),
      h('label', { class: 'field' }, '새 비밀번호 확인', again)),
    locked: forced,
    actions: [
      forced ? { label: '로그아웃', onClick: async () => { await logout(); app.user = null; app.go('/login'); } } : { label: '취소' },
      { label: '변경', primary: true, onClick: async () => {
        if (next.value !== again.value) throw new Error('새 비밀번호가 서로 다릅니다.');
        await app.call('changePassword', { current: cur.value, next: next.value });
        app.user.must_change_pw = 0;
        toast('비밀번호를 바꿨습니다.');
        if (forced) app.go(location.hash.replace(/^#/, '') || '/');
      } },
    ],
  });
}
