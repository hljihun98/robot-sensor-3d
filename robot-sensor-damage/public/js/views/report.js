// 신고 1건 — 현장 사용자는 진행 상황·보완, 관리자는 검토(승인/합치기/보완요청/반려)
import { app } from '../app.js';
import { DAMAGE_TYPES, OPEN_REPORT_STATUSES } from '../core/constants.js';
import { getModel, partLabel } from '../core/sensorModels.js';
import { SensorViewer } from '../three/viewer.js';
import { angleText } from '../three/unwrap.js';
import { h, clear, chip, reportChip, typeChip, dateText, dateTimeText, photoGrid, fill } from '../ui/dom.js';
import { openModal, toast } from '../ui/modal.js';
import { photoPicker } from '../ui/photos.js';
import { typePicker, partSelect } from '../ui/forms.js';
import { startDrawTool } from './drawTool.js';

export async function reportView(main, { params }) {
  const admin = app.can('ADMIN');
  if (admin) {
    try {
      await app.call('openReview', { id: params.id });
    } catch {
      /* 이미 처리된 신고 등 */
    }
  }
  const r = await app.call('getReport', { id: params.id });
  const open = OPEN_REPORT_STATUSES.includes(r.status);
  const modelId = r.sensor.model_id;
  const yaw = r.sensor.yaw_deg ?? 0;
  const reload = () => app.go(`/reports/${r.id}`);

  const info = h('div', { class: 'card pad stack' },
    h('div', { class: 'row' }, reportChip(r.status), typeChip(r.type), r.kind === 'CHANGE' ? chip('기존 파손 변화 신고', 'warn') : null),
    h('dl', { class: 'kv' },
      h('dt', {}, '호기 · 센서'), h('dd', {}, h('a', { href: `#/sensor/${r.sensor_id}` }, `${r.robot_no}호기 · ${r.slot_label}`), ' ', h('span', { class: 'mono muted' }, r.sensor.serial)),
      h('dt', {}, '부위'), h('dd', {}, partLabel(modelId, r.part), angleText(modelId, [r.point], yaw) ? ` · ${angleText(modelId, [r.point], yaw)}` : ''),
      h('dt', {}, '발견일'), h('dd', {}, dateText(r.found_at)),
      h('dt', {}, '신고자'), h('dd', {}, r.reporter_name),
      h('dt', {}, '신고 시각'), h('dd', {}, dateTimeText(r.created_at)),
      r.reviewer_name ? h('dt', {}, '검토자') : null, r.reviewer_name ? h('dd', {}, r.reviewer_name) : null,
      r.review_note ? h('dt', {}, '처리 메모') : null, r.review_note ? h('dd', {}, r.review_note) : null),
    r.memo ? h('div', { class: 'notice' }, r.memo) : null,
    photoGrid(r.photos),
    r.thread.length ? h('div', { class: 'stack' }, h('h3', {}, '주고받은 내용'),
      h('ul', { class: 'events' }, r.thread.map((t) => h('li', {}, h('span', { class: 'when' }, dateText(t.at)),
        h('span', {}, h('b', {}, t.kind === 'NEED_INFO' ? '보완요청' : '보완 답변'), ` · ${t.by_name}`, h('div', {}, t.text), t.photos.length ? photoGrid(t.photos) : null))))) : null,
    r.damage_id ? h('a', { class: 'btn', href: `#/sensor/${r.sensor_id}?damage=${r.damage_id}` }, '확정된 파손 보기') : null);

  const viewerHost = h('div');
  const side = h('div', { class: 'stack' });
  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'crumb' }, h('a', { href: admin ? '#/admin/reports' : '#/my-reports' }, admin ? '신고 검토' : '내 신고'), ' › ', r.id),
      h('h1', {}, `신고 ${r.id}`))),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 380px)', gap: '14px' }, class: 'report-grid' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, '3D 위치', h('span', { class: 'muted small' }, '주황 = 신고 위치, 색 = 이미 등록된 파손')), viewerHost),
      h('div', { class: 'stack' }, info, side)));
  if (window.matchMedia('(max-width: 900px)').matches) main.querySelector('.report-grid').style.gridTemplateColumns = '1fr';

  const viewer = new SensorViewer(viewerHost, { modelId });
  await viewer.init();
  const view = await app.call('getSensorView', { id: r.sensor_id });
  const active = view.damages.filter((d) => d.status === 'ACTIVE');
  viewer.setDamages(active);
  viewer.setReports([{ id: r.id, point: r.point, normal: r.normal }], r.id);
  setTimeout(() => viewer.focusPoint(r.point, r.normal), 300);

  // 현장 사용자: 보완 답변
  if (!admin && r.status === 'NEED_INFO') {
    const text = h('textarea', { placeholder: '요청받은 내용을 적어 주세요' });
    const pp = photoPicker({ hint: '추가 사진' });
    side.append(h('div', { class: 'card pad stack' }, h('h3', {}, '보완해서 다시 보내기'), text, pp.el,
      h('button', { class: 'primary', onclick: async () => {
        try {
          await app.call('replyReport', { id: r.id, text: text.value, photos: await pp.value() });
          toast('보완 내용을 보냈습니다.');
          await app.refreshStats();
          reload();
        } catch (e) {
          toast(e.message, 'error');
        }
      } }, '보내기')));
  }

  // 관리자: 검토
  if (admin && open) {
    const tp = typePicker(r.type);
    const note = h('textarea', { placeholder: '처리 메모 (보완요청·반려는 필수)' });
    const part = partSelect(modelId, r.part);
    let drawn = null;
    const drawState = h('div', { class: 'small muted' }, '모양을 그리지 않으면 신고 위치를 "점"으로 확정합니다.');
    const drawBtn = h('button', { onclick: () => {
      startDrawTool(viewer, viewerHost, {
        title: '확정할 모양 그리기',
        shape: DAMAGE_TYPES[tp.value() ?? r.type]?.shape ?? 'POINT',
        onDone: (res) => {
          drawn = res;
          fill(drawState, `그린 모양: ${res.shape === 'POINT' ? '점' : res.shape === 'LINE' ? '선' : res.shape === 'CIRCLE' ? '원' : '영역'} · 부위 ${partLabel(modelId, res.part)}`);
          part.value = res.part;
          viewer.setDamages(active);
          viewer.showTemp([], res.shape, res.geom.path);
        },
      });
    } }, '모양 그리기');
    const geomOf = () => drawn?.geom ?? { points: [r.point], normal: r.normal ?? [0, 1, 0], path: [r.point] };
    const shapeOf = () => drawn?.shape ?? 'POINT';

    const mergeSel = h('select', {}, h('option', { value: '' }, '— 합칠 기존 파손 —'),
      active.map((d, i) => {
        const near = r.candidates.find((c) => c.id === d.id);
        return h('option', { value: d.id, selected: r.kind === 'CHANGE' ? d.id === r.target_damage_id : near && near === r.candidates[0] },
          `${i + 1}번 ${DAMAGE_TYPES[d.type].short} · ${dateText(d.found_at)}${near ? ` · ${near.distance.toFixed(1)}mm 거리` : ''}`);
      }));

    const run = async (fn, msg) => {
      try {
        await fn();
        toast(msg);
        await app.refreshStats();
        reload();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    side.append(h('div', { class: 'card pad stack' },
      h('h3', {}, '검토'),
      r.candidates.length ? h('div', { class: 'notice warn small' }, `가까운 기존 파손 ${r.candidates.length}건이 있습니다. 같은 파손이면 "기존 파손에 합치기"를 쓰세요.`) : null,
      h('div', { class: 'field' }, h('span', { class: 'small muted' }, '유형'), tp.el),
      h('label', { class: 'field' }, '부위', part),
      h('div', { class: 'row' }, drawBtn), drawState,
      h('label', { class: 'field' }, '메모', note),
      h('button', { class: 'primary', onclick: () => run(() => app.call('approveReport', {
        id: r.id, mode: 'NEW', type: tp.value(), part: part.value, shape: shapeOf(), geom: geomOf(), note: note.value,
      }), '새 파손으로 승인했습니다.') }, '새 파손으로 승인'),
      h('div', { class: 'stack', style: { gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '10px' } },
        mergeSel,
        h('button', { onclick: () => run(() => app.call('approveReport', {
          id: r.id, mode: 'MERGE', target_damage_id: mergeSel.value, note: note.value, ...(drawn ? { shape: drawn.shape, geom: drawn.geom } : {}),
        }), '기존 파손에 합쳤습니다.') }, '기존 파손에 합치기'),
        h('div', { class: 'small muted' }, '모양을 새로 그렸다면 그 범위로 기존 파손이 "변화"로 기록됩니다.')),
      h('div', { class: 'row', style: { borderTop: '1px solid var(--line)', paddingTop: '10px' } },
        h('button', { onclick: () => run(() => app.call('requestInfo', { id: r.id, note: note.value }), '보완을 요청했습니다.') }, '보완요청'),
        h('button', { class: 'danger', onclick: () => run(() => app.call('rejectReport', { id: r.id, note: note.value }), '반려했습니다.') }, '반려'))));
  }

  return () => viewer.dispose();
}

export { getModel, openModal };
