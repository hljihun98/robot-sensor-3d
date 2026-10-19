// 호기·센서 관리 — 호기 등록(라이다 형상 자동), 전체 호기 표, 예비 센서
import { app } from '../app.js';
import { LIDAR_SHAPES, ROBOT_STATUS, SLOTS, defaultLidarShape } from '../core/constants.js';
import { h, clear, chip, dateText, spinner, fill } from '../ui/dom.js';
import { openModal, toast } from '../ui/modal.js';

export async function adminRobotsView(main) {
  const body = h('div', { class: 'card' }, spinner());
  const spareBody = h('div', { class: 'card' }, spinner());
  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '호기·센서 관리'),
      h('div', { class: 'sub' }, '16호기까지는 원통형 라이다, 17호기부터는 반구형(Mid-360)이 기본값입니다. 카메라는 RealSense D405입니다.')),
    h('span', { class: 'spacer' }), h('button', { class: 'primary', onclick: () => createModal() }, '호기 등록')),
    body,
    h('h2', { style: { margin: '24px 0 10px' } }, '예비 센서'),
    spareBody);

  const [robots, spares] = await Promise.all([app.call('listRobots', { status: 'ALL' }), app.call('listSpareSensors', {})]);
  fill(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ['호기', '라이다', '상태', '사이트', '현존 파손', '검토 대기', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, robots.map((r) => h('tr', { class: 'click', onclick: () => app.go(`/robot/${r.no}`) },
      h('td', {}, h('b', {}, `${r.no}호기`)),
      h('td', {}, LIDAR_SHAPES[r.lidar_shape].label),
      h('td', {}, chip(ROBOT_STATUS[r.status], r.status === 'ACTIVE' ? 'good' : 'bad'), r.status === 'DISPOSED' ? h('span', { class: 'muted small' }, ` ${dateText(r.disposed_at)}`) : null),
      h('td', {}, r.site ?? '-'),
      h('td', {}, r.status === 'ACTIVE' ? r.active : '-'),
      h('td', {}, r.open_reports || '-'),
      h('td', {}, h('a', { href: `#/robot/${r.no}` }, '상세'))))))));
  fill(spareBody, spares.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['시리얼', '모델', '메모', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, spares.map((s) => h('tr', {}, h('td', { class: 'mono' }, s.serial), h('td', {}, s.model_name), h('td', { class: 'muted' }, s.memo ?? ''),
        h('td', {}, h('a', { href: `#/sensor/${s.id}` }, '파손 기록 보기')))))))
    : h('div', { class: 'empty' }, '예비 센서가 없습니다. 호기를 폐기하거나 센서를 교체할 때 "예비로 회수"를 고르면 여기에 나타납니다.'));
}

async function createModal() {
  const next = await app.call('nextRobotNo', {});
  const no = h('input', { type: 'number', min: 1, value: next.no });
  const site = h('input', { placeholder: '예: A사 평택' });
  const shape = h('select', {}, Object.entries(LIDAR_SHAPES).map(([k, v]) => h('option', { value: k, selected: k === next.lidar_shape }, v.label)));
  let touched = false;
  shape.addEventListener('change', () => { touched = true; });
  no.addEventListener('input', () => {
    if (!touched) shape.value = defaultLidarShape(Number(no.value));
  });
  const serials = Object.fromEntries(SLOTS.map((s) => [s.code, h('input', { placeholder: '비우면 임시 번호' })]));
  openModal({
    title: '호기 등록',
    body: h('div', { class: 'stack' },
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, '호기 번호', no), h('label', { class: 'field' }, '사이트', site),
        h('label', { class: 'field' }, '라이다 형상', shape)),
      h('div', { class: 'small muted' }, '센서 시리얼 — 예비 센서의 시리얼을 넣으면 그 센서를 그대로 답니다(파손 이력 유지).'),
      h('div', { class: 'form-grid' }, SLOTS.map((s) => h('label', { class: 'field' }, s.label, serials[s.code])))),
    actions: [{ label: '취소' }, { label: '등록', primary: true, onClick: async () => {
      const res = await app.call('createRobot', { no: Number(no.value), site: site.value, lidar_shape: shape.value,
        serials: Object.fromEntries(Object.entries(serials).map(([k, v]) => [k, v.value])) });
      toast(`${res.no}호기를 등록했습니다.`);
      app.go(`/robot/${res.no}`);
    } }],
  });
}
