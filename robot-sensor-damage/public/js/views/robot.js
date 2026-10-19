import { app } from '../app.js';
import { LIDAR_SHAPES, ROBOT_STATUS, SENSOR_STATUS, slotLabel } from '../core/constants.js';
import { getModel } from '../core/sensorModels.js';
import { h, clear, chip, dateText, todayStr } from '../ui/dom.js';
import { ICONS } from '../ui/icons.js';
import { openModal, toast, confirmModal } from '../ui/modal.js';

export async function robotView(main, { params }) {
  const data = await app.call('getRobot', { no: params.no });
  const r = data.robot;
  const admin = app.can('ADMIN');
  const reload = () => app.go(`/robot/${r.no}`);

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'crumb' }, h('a', { href: '#/' }, '호기 검색'), ' › ', `${r.no}호기`),
      h('h1', {}, `${r.no}호기`),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        chip(`라이다 ${LIDAR_SHAPES[r.lidar_shape].label}`, 'info'),
        chip(ROBOT_STATUS[r.status], r.status === 'ACTIVE' ? 'good' : 'bad'),
        chip(`사이트 ${r.site ?? '미지정'}`),
        r.status === 'DISPOSED' ? h('span', { class: 'muted small' }, `폐기일 ${dateText(r.disposed_at)} · ${r.dispose_reason ?? ''}`) : null,
        r.memo ? h('span', { class: 'muted small' }, r.memo) : null)),
    h('span', { class: 'spacer' }),
    admin ? h('div', { class: 'row' },
      h('button', { onclick: () => editRobotModal(r, reload) }, '정보 수정'),
      r.status === 'ACTIVE' ? h('button', { class: 'danger', onclick: () => disposeModal(r, data.slots, reload) }, '폐기 처리') : null,
      app.can('SYSADMIN') ? h('button', { class: 'danger', onclick: () => deleteRobot(r) }, '영구 삭제') : null) : null);

  const grid = h('div', { class: 'sensor-grid' });
  data.slots.forEach((s) => {
    const sensor = s.sensor;
    const c = s.counts;
    const model = sensor ? getModel(sensor.model_id) : null;
    grid.append(h('div', { class: 'card sensor-card' },
      h('div', { class: 'icon', html: ICONS[sensor?.model_id] ?? ICONS.CAM_D405, style: { color: 'var(--ink-2)' }, 'aria-hidden': 'true' }),
      h('div', { class: 'stack', style: { gap: '8px' } },
        h('div', { class: 'row' }, h('span', { class: 'title' }, s.label), h('span', { class: 'spacer' }),
          c?.new ? chip(`신규 ${c.new}`, 'bad') : null, c?.open_reports ? chip(`검토 대기 ${c.open_reports}`, 'warn') : null),
        sensor
          ? h('dl', { class: 'kv' },
            h('dt', {}, '모델'), h('dd', {}, model.name),
            h('dt', {}, '시리얼'), h('dd', { class: 'mono' }, sensor.serial),
            h('dt', {}, '현존 파손'), h('dd', {}, h('b', {}, c.active), '건'),
            h('dt', {}, '마지막 변경'), h('dd', {}, dateText(c.last_change)),
            h('dt', {}, '장착일'), h('dd', {}, dateText(s.mount?.mounted_at)))
          : h('div', { class: 'muted' }, '장착된 센서 없음'),
        h('div', { class: 'row' },
          sensor ? h('a', { class: 'btn primary', href: `#/robot/${r.no}/${s.slot}` }, '3D로 보기') : null,
          admin && r.status === 'ACTIVE' ? h('button', { onclick: () => replaceModal(r, s, reload) }, '센서 교체') : null,
          admin && sensor ? h('button', { class: 'ghost', onclick: () => sensorEditModal(r, s, reload) }, '시리얼·각도') : null))));
  });

  const past = data.past_mounts.length
    ? h('details', { class: 'card pad', style: { marginTop: '16px' } }, h('summary', {}, `이전에 달렸던 센서 ${data.past_mounts.length}개`),
      h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, '슬롯'), h('th', {}, '시리얼'), h('th', {}, '장착'), h('th', {}, '탈착'), h('th', {}, ''))),
        h('tbody', {}, data.past_mounts.map((m) => h('tr', {}, h('td', {}, slotLabel(m.slot)), h('td', { class: 'mono' }, m.serial),
          h('td', {}, dateText(m.mounted_at)), h('td', {}, dateText(m.unmounted_at)), h('td', {}, h('a', { href: `#/sensor/${m.sensor_id}` }, '기록 보기'))))))))
    : null;

  main.append(...[head, grid, past].filter(Boolean));
}

function editRobotModal(r, done) {
  const site = h('input', { value: r.site ?? '' });
  const shape = h('select', {}, Object.entries(LIDAR_SHAPES).map(([k, v]) => h('option', { value: k, selected: k === r.lidar_shape }, v.label)));
  const memo = h('input', { value: r.memo ?? '' });
  openModal({
    title: `${r.no}호기 정보 수정`,
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, '사이트', site),
      h('label', { class: 'field' }, '라이다 형상', shape),
      h('div', { class: 'small muted' }, '형상을 바꾸면 이후 새로 등록하는 라이다에 적용됩니다. 이미 달린 라이다를 바꾸려면 "센서 교체"를 쓰세요.'),
      h('label', { class: 'field' }, '메모', memo)),
    actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
      await app.call('updateRobot', { no: r.no, site: site.value, lidar_shape: shape.value, memo: memo.value });
      toast('저장했습니다.');
      done();
    } }],
  });
}

function disposeModal(r, slots, done) {
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  const reason = h('input', { placeholder: '예: 분해 후 폐기' });
  const choices = {};
  const rows = slots.filter((s) => s.sensor).map((s) => {
    const sel = h('select', {}, h('option', { value: 'DISPOSED' }, '함께 폐기'), h('option', { value: 'SPARE' }, '예비로 회수'));
    choices[s.slot] = sel;
    return h('label', { class: 'field' }, `${s.label} · ${s.sensor.serial}`, sel);
  });
  openModal({
    title: `${r.no}호기 폐기 처리`,
    body: h('div', { class: 'stack' },
      h('div', { class: 'notice warn' }, '폐기해도 기록은 지워지지 않습니다. 호기는 검색 기본 목록에서 빠지고 "폐기" 필터로 볼 수 있습니다.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, '폐기일', date), h('label', { class: 'field' }, '사유', reason)),
      h('div', { class: 'small muted' }, '센서 처리 — 예비로 회수한 센서는 다른 호기에 달아도 파손 이력을 그대로 가지고 갑니다.'),
      h('div', { class: 'form-grid' }, rows)),
    actions: [{ label: '취소' }, { label: '폐기 처리', danger: true, onClick: async () => {
      await app.call('disposeRobot', { no: r.no, date: date.value, reason: reason.value, sensorActions: Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.value])) });
      toast(`${r.no}호기를 폐기 처리했습니다.`);
      done();
    } }],
  });
}

async function deleteRobot(r) {
  if (!(await confirmModal('호기 영구 삭제', `${r.no}호기를 완전히 지웁니다. 잘못 등록한 호기에만 쓰세요. 파손 기록이 있는 센서는 예비 센서로 남습니다.`, '영구 삭제', true))) return;
  try {
    await app.call('deleteRobot', { no: r.no });
    toast('삭제했습니다.');
    app.go('/');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function replaceModal(r, s, done) {
  const spares = await app.call('listSpareSensors', { kind: s.kind });
  const pick = h('select', {}, h('option', { value: '' }, '— 새 센서 등록 —'), spares.map((x) => h('option', { value: x.id }, `${x.serial} · ${x.model_name}`)));
  const serial = h('input', { placeholder: '새 센서 시리얼' });
  const oldAct = h('select', {}, h('option', { value: 'SPARE' }, '예비로 회수'), h('option', { value: 'DISPOSED' }, '폐기'));
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  pick.addEventListener('change', () => serial.classList.toggle('hidden', !!pick.value));
  openModal({
    title: `${r.no}호기 ${s.label} 센서 교체`,
    body: h('div', { class: 'stack' },
      s.sensor ? h('div', { class: 'small' }, '지금 달린 센서: ', h('span', { class: 'mono' }, s.sensor.serial)) : null,
      h('label', { class: 'field' }, '새로 달 센서', pick), serial,
      s.sensor ? h('label', { class: 'field' }, '떼어낸 센서는', oldAct) : null,
      h('label', { class: 'field' }, '교체일', date),
      h('div', { class: 'small muted' }, '폐기하면 그 센서의 현존 파손은 "종료"로 바뀝니다. 새 센서는 파손 0건에서 시작합니다.')),
    actions: [{ label: '취소' }, { label: '교체', primary: true, onClick: async () => {
      await app.call('replaceSensor', { no: r.no, slot: s.slot, new_sensor_id: pick.value || undefined, new_serial: serial.value, old_action: oldAct.value, date: date.value });
      toast('센서를 교체했습니다.');
      done();
    } }],
  });
}

function sensorEditModal(r, s, done) {
  const serial = h('input', { value: s.sensor.serial });
  const memo = h('input', { value: s.sensor.memo ?? '' });
  const yaw = h('input', { type: 'number', min: 0, max: 359, step: 1, value: s.mount?.yaw_deg ?? 0 });
  openModal({
    title: `${r.no}호기 ${s.label}`,
    body: h('div', { class: 'stack' },
      h('label', { class: 'field' }, '시리얼', serial),
      h('label', { class: 'field' }, '메모', memo),
      s.kind === 'LIDAR' ? h('label', { class: 'field' }, '장착 각도 보정(°) — 센서 정면이 로봇 정면에서 시계 방향으로 몇 도 돌아가 있는지', yaw) : null,
      h('div', { class: 'small muted' }, `상태: ${SENSOR_STATUS[s.sensor.status]}`)),
    actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
      await app.call('updateSensor', { id: s.sensor.id, serial: serial.value, memo: memo.value });
      if (s.kind === 'LIDAR') await app.call('setMountYaw', { no: r.no, slot: s.slot, yaw_deg: Number(yaw.value) || 0 });
      toast('저장했습니다.');
      done();
    } }],
  });
}

export { clear };
