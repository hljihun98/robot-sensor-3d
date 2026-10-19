import { app } from '../app.js';
import { DAMAGE_TYPES } from '../core/constants.js';
import { h, clear, reportChip, dateText, dateTimeText, spinner, fill } from '../ui/dom.js';

function table(list, { showReporter }) {
  if (!list.length) return h('div', { class: 'empty' }, '신고가 없습니다.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, '사진'), h('th', {}, '신고 번호'), h('th', {}, '호기 · 센서'), h('th', {}, '유형'), h('th', {}, '발견일'),
      showReporter ? h('th', {}, '신고자') : null, h('th', {}, '상태'), h('th', {}, '최근 변경'))),
    h('tbody', {}, list.map((r) => h('tr', { class: 'click', onclick: () => app.go(`/reports/${r.id}`) },
      h('td', {}, r.thumb ? h('img', { class: 'thumb', src: r.thumb, alt: '' }) : '-'),
      h('td', { class: 'mono' }, r.id),
      h('td', {}, `${r.robot_no ?? '-'}호기 · ${r.slot_label}`),
      h('td', {}, DAMAGE_TYPES[r.type]?.short ?? r.type, r.kind === 'CHANGE' ? h('span', { class: 'chip', style: { marginLeft: '4px' } }, '변화') : null),
      h('td', {}, dateText(r.found_at)),
      showReporter ? h('td', {}, r.reporter_name) : null,
      h('td', {}, reportChip(r.status)),
      h('td', { class: 'muted' }, dateTimeText(r.updated_at)))))));
}

export async function myReportsView(main) {
  const body = h('div', { class: 'card' }, spinner());
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '내 신고'),
    h('div', { class: 'sub' }, '보낸 신고의 처리 상태입니다. "보완요청"이면 눌러서 사진이나 설명을 더해 주세요.'))), body);
  const list = await app.call('listReports', { scope: 'mine' });
  fill(body, table(list, { showReporter: false }));
}

export async function reviewQueueView(main, { query }) {
  let scope = query.scope === 'all' ? 'all' : 'open';
  const body = h('div', { class: 'card' });
  const seg = h('div', { class: 'seg' });
  const load = async () => {
    fill(body, spinner());
    const list = await app.call('listReports', { scope });
    fill(body, table(list, { showReporter: true }));
  };
  [['open', '처리 대기'], ['all', '전체']].forEach(([k, l]) => {
    const b = h('button', { class: k === scope ? 'active' : '', onclick: () => {
      scope = k;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      load();
    } }, l);
    seg.append(b);
  });
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '신고 검토'),
    h('div', { class: 'sub' }, '오래된 신고부터 확인하세요. 승인하면 바로 모든 사용자의 3D에 나타납니다.')), h('span', { class: 'spacer' }), seg), body);
  await load();
}
