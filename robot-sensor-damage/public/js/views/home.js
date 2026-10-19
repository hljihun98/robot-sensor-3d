import { app, setQuery } from '../app.js';
import { LIDAR_SHAPES } from '../core/constants.js';
import { h, clear, chip, dateText, spinner, fill } from '../ui/dom.js';
import { ICONS } from '../ui/icons.js';

export async function homeView(main, { query }) {
  let status = query.status ?? 'ACTIVE';
  const input = h('input', { type: 'search', inputmode: 'numeric', placeholder: '호기 번호 (예: 18)', value: query.q ?? '', 'aria-label': '호기 번호' });
  const grid = h('div', { class: 'robot-grid' });
  const countEl = h('span', { class: 'muted' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '상태' });
  const statuses = [['ACTIVE', '운영'], ['DISPOSED', '폐기'], ['ALL', '전체']];

  const load = async () => {
    setQuery({ q: input.value, status });
    fill(grid, spinner());
    const list = await app.call('listRobots', { status, q: input.value });
    clear(grid);
    countEl.textContent = `${list.length}대`;
    if (!list.length) grid.append(h('div', { class: 'empty' }, '조건에 맞는 호기가 없습니다.'));
    list.forEach((r) => {
      const modelIcon = r.lidar_shape === 'CYLINDER' ? ICONS.LIDAR_CYL : ICONS.LIDAR_MID360;
      grid.append(h('a', { class: `card robot-card ${r.status === 'DISPOSED' ? 'disposed' : ''}`, href: `#/robot/${r.no}` },
        h('div', { class: 'row' }, h('span', { class: 'no' }, `${r.no}호기`), h('span', { class: 'spacer' }),
          h('span', { html: modelIcon, style: { width: '26px', height: '26px', color: 'var(--ink-2)', display: 'inline-block' }, 'aria-hidden': 'true' })),
        h('div', { class: 'row' }, chip(`라이다 ${LIDAR_SHAPES[r.lidar_shape]?.label ?? '-'}`),
          r.status === 'DISPOSED' ? chip(`폐기 ${dateText(r.disposed_at)}`, 'bad') : chip(r.site ?? '미지정')),
        r.status === 'ACTIVE'
          ? h('div', { class: 'stat-line' }, h('span', {}, '현존 파손 ', h('b', {}, r.active)),
            r.new ? h('span', { class: 'chip bad' }, `신규 ${r.new}`) : null,
            r.open_reports ? h('span', { class: 'chip warn' }, `검토 대기 ${r.open_reports}`) : null)
          : h('div', { class: 'stat-line' }, r.dispose_reason ?? '')));
    });
    const exact = list.find((r) => String(r.no) === input.value.trim());
    return exact;
  };

  statuses.forEach(([k, label]) => {
    const b = h('button', { class: k === status ? 'active' : '', onclick: () => {
      status = k;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      load();
    } }, label);
    seg.append(b);
  });

  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(load, 200);
  });
  const form = h('form', { class: 'search', onsubmit: async (e) => {
    e.preventDefault();
    const exact = await load();
    if (exact) app.go(`/robot/${exact.no}`);
  } }, input, h('button', { class: 'primary', type: 'submit' }, '열기'));

  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '호기 검색'),
      h('div', { class: 'sub' }, '호기 번호를 입력하면 라이다 2개·카메라 2개의 파손 기록을 볼 수 있습니다. 로봇에 붙인 QR로도 바로 열립니다.'))),
    h('div', { class: 'toolbar' }, form, seg, countEl),
    grid);
  await load();
  input.focus();
}
