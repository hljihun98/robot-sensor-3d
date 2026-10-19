// 계정 관리·변경 기록 — 시스템 관리자
import { app } from '../app.js';
import { ROLES } from '../core/constants.js';
import { h, clear, chip, roleText, dateTimeText, spinner, fill } from '../ui/dom.js';
import { openModal, toast } from '../ui/modal.js';

const roleSelect = (v) => h('select', {}, Object.entries(ROLES).map(([k, r]) => h('option', { value: k, selected: k === v }, r.label)));

export async function adminUsersView(main) {
  const body = h('div', { class: 'card' }, spinner());
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '계정'),
    h('div', { class: 'sub' }, '현장 인원마다 개인 계정을 만들어 주세요. 신고·확정 이력에 이름이 남습니다. 공용 계정은 쓰지 않습니다.')),
  h('span', { class: 'spacer' }), h('button', { class: 'primary', onclick: () => createModal() }, '계정 만들기')), body);
  const users = await app.call('listUsers', {});
  fill(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ['아이디', '이름', '소속', '역할', '상태', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, users.map((u) => h('tr', {},
      h('td', { class: 'mono' }, u.login), h('td', {}, u.name), h('td', {}, u.team ?? ''), h('td', {}, roleText(u.role)),
      h('td', {}, u.active ? chip('사용', 'good') : chip('중지', 'bad'), u.must_change_pw ? chip('비밀번호 변경 대기', 'warn') : null),
      h('td', {}, h('button', { class: 'small', onclick: () => editModal(u) }, '수정'))))))));
}

function createModal() {
  const login = h('input', { autocomplete: 'off' });
  const name = h('input');
  const team = h('input');
  const role = roleSelect('FIELD');
  const pw = h('input', { type: 'text', value: Math.random().toString(36).slice(2, 10) });
  openModal({
    title: '계정 만들기',
    body: h('div', { class: 'form-grid' }, h('label', { class: 'field' }, '아이디(영문·숫자)', login), h('label', { class: 'field' }, '이름', name),
      h('label', { class: 'field' }, '소속', team), h('label', { class: 'field' }, '역할', role), h('label', { class: 'field' }, '임시 비밀번호', pw)),
    actions: [{ label: '취소' }, { label: '만들기', primary: true, onClick: async () => {
      await app.call('createUser', { login: login.value, name: name.value, team: team.value, role: role.value, password: pw.value });
      toast(`계정을 만들었습니다. 임시 비밀번호: ${pw.value}`);
      app.go('/admin/users');
    } }],
  });
}

function editModal(u) {
  const name = h('input', { value: u.name });
  const team = h('input', { value: u.team ?? '' });
  const role = roleSelect(u.role);
  const active = h('select', {}, h('option', { value: '1', selected: !!u.active }, '사용'), h('option', { value: '0', selected: !u.active }, '사용 중지'));
  const pw = h('input', { type: 'text', placeholder: '바꿀 때만 입력' });
  openModal({
    title: `${u.login} 수정`,
    body: h('div', { class: 'form-grid' }, h('label', { class: 'field' }, '이름', name), h('label', { class: 'field' }, '소속', team),
      h('label', { class: 'field' }, '역할', role), h('label', { class: 'field' }, '상태', active), h('label', { class: 'field' }, '비밀번호 초기화', pw)),
    actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
      await app.call('updateUser', { id: u.id, name: name.value, team: team.value, role: role.value, active: active.value === '1', password: pw.value || undefined });
      toast('저장했습니다.');
      app.go('/admin/users');
    } }],
  });
}

const ACTION_LABEL = {
  LOGIN: '로그인', CHANGE_PASSWORD: '비밀번호 변경', CREATE_ROBOT: '호기 등록', UPDATE_ROBOT: '호기 수정', DISPOSE_ROBOT: '호기 폐기',
  DELETE_ROBOT: '호기 영구 삭제', UPDATE_SENSOR: '센서 수정', SET_YAW: '장착 각도', REPLACE_SENSOR: '센서 교체', INSPECTION: '점검',
  CREATE_DAMAGE: '파손 직접 등록', DAMAGE_REPAIR: '수리완료', DAMAGE_CLOSE: '종료', DAMAGE_CHANGE: '변화 등록', DAMAGE_CORRECT: '정정',
  DAMAGE_REOPEN: '되돌리기', CREATE_REPORT: '신고', REPLY_REPORT: '보완 답변', REQUEST_INFO: '보완요청', REJECT_REPORT: '반려',
  APPROVE_REPORT: '승인', CREATE_USER: '계정 생성', UPDATE_USER: '계정 수정',
};

export async function auditView(main) {
  const body = h('div', { class: 'card' }, spinner());
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '변경 기록'), h('div', { class: 'sub' }, '누가 언제 무엇을 바꿨는지 최근 300건을 보여 줍니다.'))), body);
  const list = await app.call('listAudit', { limit: 300 });
  fill(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ['시각', '사용자', '행위', '대상', '내용'].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((a) => h('tr', {}, h('td', { class: 'muted nowrap' }, dateTimeText(a.at)), h('td', { class: 'nowrap' }, a.user_name), h('td', { class: 'nowrap' }, ACTION_LABEL[a.action] ?? a.action),
      h('td', { class: 'mono' }, a.target ?? ''), h('td', { class: 'small muted' }, a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail) : '')))))));
}
