// 센서 3D 뷰어 화면 — 파손 목록, 3D / 360° 펼쳐보기, 상세·이력, 날짜 기준 보기, 신고·점검·관리자 처리
import { app, setQuery } from '../app.js';
import { DAMAGE_TYPES, EVENT_TYPES, slotLabel, DAMAGE_STATUS, REPORT_STATUS } from '../core/constants.js';
import { getModel, partLabel } from '../core/sensorModels.js';
import { SensorViewer } from '../three/viewer.js';
import { UnwrapView, angleText } from '../three/unwrap.js';
import { h, clear, chip, typeChip, damageChip, dateText, photoGrid, todayStr, spinner, fill } from '../ui/dom.js';
import { openModal, toast, toastError } from '../ui/modal.js';
import { photoPicker } from '../ui/photos.js';
import { typePicker, partSelect, dateInput } from '../ui/forms.js';
import { startDrawTool } from './drawTool.js';

const circled = (i) => String(i + 1);

export async function sensorView(main, { params, query }) {
  let sensorId = params.sensorId;
  if (!sensorId) {
    const r = await app.call('getRobot', { no: params.no });
    const s = r.slots.find((x) => x.slot === params.slot);
    if (!s?.sensor) throw new Error(`${params.no}호기 ${slotLabel(params.slot)}에 장착된 센서가 없습니다.`);
    sensorId = s.sensor.id;
  }
  const info = await app.call('getSensor', { id: sensorId });
  const model = getModel(info.model_id);
  const admin = app.can('ADMIN');
  const mounted = info.status === 'MOUNTED';
  const yaw = info.yaw_deg ?? 0;

  const st = {
    at: query.at || null,
    selected: query.damage || null,
    type: '',
    showResolved: query.all === '1',
    tab: query.tab === 'unwrap' && model.unwrap ? 'unwrap' : '3d',
    view: null,
    busy: false,
  };

  // ── 레이아웃 ─────────────────────────────
  const typeSel = h('select', { 'aria-label': '유형 필터' }, h('option', { value: '' }, '모든 유형'),
    Object.entries(DAMAGE_TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
  const resolvedChk = h('input', { type: 'checkbox', checked: st.showResolved });
  const listBody = h('div', { class: 'panel-body' });
  const listHead = h('div', { class: 'panel-head' });
  const detailBody = h('div', { class: 'panel-body' });
  const detailHead = h('div', { class: 'panel-head' });
  const viewerHost = h('div');
  const unwrapHost = h('div', { class: 'unwrap-wrap hidden' });
  const hint = h('div', { class: 'viewer-hint hidden' });
  const viewBtns = h('div', { class: 'view-buttons' },
    [['front', '정면'], ['side', '측면'], ['top', '상단'], ['back', '후면'], ['reset', '처음']].map(([k, l]) => h('button', { onclick: () => viewer.setView(k) }, l)));
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const tabBtn = (k, label) => h('button', { role: 'tab', class: st.tab === k ? 'active' : '', onclick: () => setTab(k) }, label);
  tabs.append(tabBtn('3d', '3D 보기'));
  if (model.unwrap) tabs.append(tabBtn('unwrap', '360° 펼쳐보기'));
  tabs.append(h('span', { class: 'spacer' }), h('span', { class: 'small muted hint-text', style: { alignSelf: 'center', paddingRight: '8px' } }, '드래그: 회전 · 휠/두 손가락: 확대'));

  const dateIn = h('input', { type: 'date', max: todayStr(), value: st.at ?? todayStr(), 'aria-label': '기준 날짜' });
  const todayBtn = h('button', { class: 'small', onclick: () => setAt(null) }, '오늘');
  const strip = h('div', { class: 'tl-strip' });
  const atNote = h('div', { class: 'small muted' });

  const reportBtn = mounted ? h('button', { class: 'primary', onclick: () => startReport() }, '파손 신고') : null;
  const inspectBtn = mounted ? h('button', { onclick: () => inspectionModal() }, '점검 완료') : null;
  const registerBtn = admin ? h('button', { onclick: () => startRegister() }, '직접 등록') : null;
  const robotLink = info.robot_no ? h('a', { href: `#/robot/${info.robot_no}` }, `${info.robot_no}호기`) : '장착 안 됨';

  const page = h('div', { class: 'viewer-page' },
    h('div', { class: 'viewer-head' },
      h('div', {}, h('div', { class: 'crumb' }, h('a', { href: '#/' }, '호기 검색'), ' › ', robotLink, info.slot ? ` › ${slotLabel(info.slot)}` : ''),
        h('div', { class: 'row' }, h('h1', {}, info.robot_no ? `${info.robot_no}호기 · ${slotLabel(info.slot)}` : `센서 ${info.serial}`),
          chip(model.name, 'info'), h('span', { class: 'mono muted' }, info.serial), !mounted ? chip(info.status === 'SPARE' ? '예비 센서' : '폐기 센서', 'bad') : null)),
      h('span', { class: 'spacer' }),
      h('div', { class: 'row' }, typeSel, h('label', { class: 'row small' }, resolvedChk, '수리완료·종료 포함'), inspectBtn, registerBtn, reportBtn)),
    h('section', { class: 'panel list-panel' }, listHead, listBody),
    h('section', { class: 'panel viewer-center' }, tabs, viewerHost, unwrapHost),
    h('section', { class: 'panel detail-panel' }, detailHead, detailBody),
    h('section', { class: 'panel timeline' },
      h('div', { class: 'stack', style: { gap: '6px' } }, h('b', {}, '날짜 기준 보기'), h('div', { class: 'row' }, dateIn, todayBtn), atNote),
      strip));
  main.append(page);

  // ── 3D / 펼쳐보기 ─────────────────────────────
  const viewer = new SensorViewer(viewerHost, { modelId: info.model_id, onSelect: (id, hit) => {
    if (hit?.reportId) {
      app.go(`/reports/${hit.reportId}`);
      return;
    }
    select(id, false);
  } });
  await viewer.init();
  viewerHost.append(viewBtns, hint);
  let unwrap = null;
  if (model.unwrap) unwrap = new UnwrapView(unwrapHost, { modelId: info.model_id, yaw, onSelect: (id) => select(id, true) });

  function setTab(k) {
    st.tab = k;
    tabs.querySelectorAll('button[role=tab]').forEach((b, i) => b.classList.toggle('active', (i === 0 && k === '3d') || (i === 1 && k === 'unwrap')));
    viewerHost.classList.toggle('hidden', k !== '3d');
    unwrapHost.classList.toggle('hidden', k !== 'unwrap');
    setQuery({ tab: k === 'unwrap' ? 'unwrap' : '' });
    if (k === '3d') viewer.resize();
    else unwrap?.render();
  }

  const filtered = () => (st.view?.damages ?? [])
    .filter((d) => !st.type || d.type === st.type)
    .filter((d) => st.at || st.showResolved || d.status === 'ACTIVE');

  async function load() {
    st.view = await app.call('getSensorView', { id: sensorId, at: st.at ?? undefined });
    const list = filtered();
    if (st.selected && !list.some((d) => d.id === st.selected)) st.selected = null;
    viewer.setDamages(list, st.selected);
    viewer.setReports(st.view.reports);
    unwrap?.set(list, st.view.reports, st.selected);
    renderList(list);
    renderTimeline();
    renderDetail();
  }

  function select(id, fly = true) {
    st.selected = id;
    setQuery({ damage: id ?? '' });
    viewer.select(id, { fly: fly || st.tab !== '3d' });
    unwrap?.set(filtered(), st.view.reports, id);
    listBody.querySelectorAll('.damage-item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
    renderDetail();
  }

  function setAt(at) {
    st.at = at && at < todayStr() ? at : null;
    dateIn.value = st.at ?? todayStr();
    setQuery({ at: st.at ?? '' });
    load().catch(toastError);
  }
  dateIn.addEventListener('change', () => setAt(dateIn.value));
  typeSel.addEventListener('change', () => {
    st.type = typeSel.value;
    load();
  });
  resolvedChk.addEventListener('change', () => {
    st.showResolved = resolvedChk.checked;
    setQuery({ all: st.showResolved ? '1' : '' });
    load();
  });

  // ── 목록 ─────────────────────────────
  function renderList(list) {
    const active = list.filter((d) => d.status === 'ACTIVE').length;
    fill(listHead, `파손 목록`, h('span', { class: 'muted small' }, st.at ? `${st.at} 기준 ${list.length}건` : `현존 ${active}건`));
    clear(listBody);
    if (!list.length) listBody.append(h('div', { class: 'empty' }, st.at ? '이 날짜에 있던 파손이 없습니다.' : '기록된 파손이 없습니다.'));
    list.forEach((d, i) => {
      const t = DAMAGE_TYPES[d.type] ?? DAMAGE_TYPES.ETC;
      const resolved = d.status !== 'ACTIVE';
      listBody.append(h('div', { class: `damage-item ${d.id === st.selected ? 'selected' : ''} ${resolved ? 'resolved' : ''}`, 'data-id': d.id, role: 'button', tabindex: '0',
        onclick: () => {
          select(d.id);
          if (window.matchMedia('(max-width: 760px)').matches) page.querySelector('.detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        onkeydown: (e) => e.key === 'Enter' && select(d.id) },
        h('span', { class: 'num', style: { background: resolved ? '#9aa0a6' : t.color } }, circled(i)),
        h('div', { class: 'stack', style: { gap: '2px', flex: 1, minWidth: 0 } },
          h('div', { class: 'row', style: { gap: '6px' } }, h('b', {}, t.short), h('span', { class: 'muted small' }, partLabel(info.model_id, d.part)),
            d.is_new ? chip('신규', 'bad') : null, resolved ? damageChip(d.status) : null),
          h('div', { class: 'small muted' }, `${dateText(d.found_at)} 확인${d.size_mm ? ` · ${d.size_mm} mm` : ''}`))));
    });
    const reps = st.view.reports;
    if (reps.length) {
      listBody.append(h('div', { class: 'small muted', style: { margin: '14px 4px 6px' } }, admin ? '검토 대기 신고' : '내 신고 (검토 대기)'),
        ...reps.map((r) => h('a', { class: 'damage-item', href: `#/reports/${r.id}` },
          h('span', { class: 'num', style: { background: '#f59f00' } }, '!'),
          h('div', { class: 'stack', style: { gap: '2px' } }, h('b', {}, DAMAGE_TYPES[r.type]?.short ?? r.type),
            h('span', { class: 'small muted' }, `${dateText(r.found_at)} · ${REPORT_STATUS[r.status].label}`)))));
    }
  }

  // ── 상세 ─────────────────────────────
  let detailSeq = 0;
  async function renderDetail() {
    const seq = ++detailSeq;
    if (!st.selected) {
      fill(detailHead, '센서 정보');
      fill(detailBody, spinner());
      const hist = await app.call('getSensorHistory', { id: sensorId });
      if (seq !== detailSeq) return;
      fill(detailBody, 
        h('dl', { class: 'kv' },
          h('dt', {}, '모델'), h('dd', {}, model.name),
          h('dt', {}, '시리얼'), h('dd', { class: 'mono' }, info.serial),
          h('dt', {}, '현재 위치'), h('dd', {}, info.robot_no ? `${info.robot_no}호기 ${slotLabel(info.slot)}` : '장착 안 됨'),
          model.unwrap ? h('dt', {}, '각도 보정') : null, model.unwrap ? h('dd', {}, `${yaw}°`) : null),
        h('div', { class: 'small muted', style: { margin: '8px 0' } }, model.note),
        h('div', { class: 'small muted' }, '파손을 누르면 사진과 이력이 나옵니다.'),
        h('h3', { style: { margin: '16px 0 8px' } }, '센서 이력'),
        hist.length ? h('ul', { class: 'events' }, hist.slice(0, 60).map((e) => h('li', {},
          h('span', { class: 'when' }, dateText(e.at)),
          h('span', {}, h('b', {}, EVENT_TYPES[e.type] ?? e.type), e.damage_type ? ` · ${DAMAGE_TYPES[e.damage_type]?.short}` : '',
            e.note ? h('div', { class: 'small muted' }, e.note) : null,
            e.damage_id ? h('a', { class: 'small', href: '#', onclick: (ev) => { ev.preventDefault(); revealDamage(e.damage_id); } }, '보기') : null))))
          : h('div', { class: 'muted small' }, '이력이 없습니다.'));
      return;
    }
    const list = filtered();
    const idx = list.findIndex((d) => d.id === st.selected);
    const sum = list[idx];
    fill(detailHead, h('span', { class: 'num', style: { width: '22px', height: '22px', borderRadius: '11px', display: 'inline-grid', placeItems: 'center', color: '#fff', fontSize: '11px', background: sum?.status === 'ACTIVE' ? DAMAGE_TYPES[sum.type].color : '#9aa0a6' } }, idx >= 0 ? circled(idx) : '–'),
      DAMAGE_TYPES[sum?.type]?.label ?? '파손', h('span', { class: 'spacer' }), h('button', { class: 'ghost small', 'aria-label': '선택 해제', onclick: () => select(null, false) }, '✕'));
    fill(detailBody, spinner());
    const d = await app.call('getDamage', { id: st.selected });
    if (seq !== detailSeq) return;
    const photos = d.events.flatMap((e) => e.photos);
    const ang = angleText(info.model_id, (sum ?? d).geom.path, yaw);
    const range = d.occurred_from ? `${dateText(d.occurred_from)} ~ ${dateText(d.found_at)}` : '알 수 없음 (이전 점검 기록 없음)';
    fill(detailBody, 
      h('div', { class: 'row', style: { marginBottom: '8px' } }, damageChip(st.at ? sum.status : d.status), d.id && h('span', { class: 'mono muted small' }, d.id),
        sum?.is_new ? chip('신규', 'bad') : null),
      st.at ? h('div', { class: 'notice small', style: { marginBottom: '8px' } }, `${st.at} 기준 모습입니다.`) : null,
      photoGrid(photos),
      h('dl', { class: 'kv', style: { marginTop: '10px' } },
        h('dt', {}, '부위'), h('dd', {}, partLabel(info.model_id, (sum ?? d).part)),
        ang ? h('dt', {}, '방향') : null, ang ? h('dd', {}, ang) : null,
        h('dt', {}, '크기'), h('dd', {}, (sum ?? d).size_mm ? `${(sum ?? d).size_mm} mm` : '점 표시'),
        h('dt', {}, '최초 확인'), h('dd', {}, dateText(d.found_at)),
        h('dt', {}, '발생 기간'), h('dd', {}, range),
        d.resolved_at ? h('dt', {}, '처리일') : null, d.resolved_at ? h('dd', {}, dateText(d.resolved_at)) : null,
        h('dt', {}, '신고자'), h('dd', {}, d.reporter_name ?? '관리자 직접 등록'),
        h('dt', {}, '확정자'), h('dd', {}, d.confirmed_by_name),
        d.memo ? h('dt', {}, '메모') : null, d.memo ? h('dd', {}, d.memo) : null),
      admin ? damageActions(d) : null,
      h('h3', { style: { margin: '16px 0 8px' } }, '이 파손의 이력'),
      h('ul', { class: 'events' }, d.events.map((e) => h('li', {}, h('span', { class: 'when' }, dateText(e.at)),
        h('span', {}, h('b', {}, EVENT_TYPES[e.type] ?? e.type), ` · ${e.by_name}`,
          e.note ? h('div', { class: 'small muted' }, e.note) : null,
          e.after?.size_mm && e.type !== 'CONFIRMED' ? h('div', { class: 'small muted' }, `크기 ${e.before?.size_mm ?? '-'} → ${e.after.size_mm} mm`) : null,
          e.photos.length && e.type !== 'CONFIRMED' ? photoGrid(e.photos) : null)))));
  }

  async function revealDamage(id) {
    if (!filtered().some((d) => d.id === id)) {
      st.showResolved = true;
      resolvedChk.checked = true;
      st.type = '';
      typeSel.value = '';
      if (st.at) setAt(null);
      await load();
    }
    select(id);
  }

  // ── 날짜 기준 보기 막대 ─────────────────────────────
  function renderTimeline() {
    clear(strip);
    const today = todayStr();
    const evs = st.view.timeline.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.at));
    const first = evs[0]?.at;
    const minD = first && first < shiftDays(today, -90) ? first : shiftDays(today, -90);
    const lo = Date.parse(minD);
    const hi = Date.parse(today);
    const pos = (d) => `${((Date.parse(d) - lo) / (hi - lo || 1)) * 100}%`;
    strip.append(h('div', { class: 'axis' }));
    const months = new Set();
    for (let t = lo; t <= hi; t += 864e5 * 7) {
      const m = new Date(t).toISOString().slice(0, 7);
      if (!months.has(m)) {
        months.add(m);
        const d = `${m}-01`;
        if (Date.parse(d) >= lo) strip.append(h('span', { class: 'tl-tick', style: { left: pos(d) } }, `${Number(m.slice(5))}월`));
      }
    }
    const color = (e) => {
      if (e.type === 'INSPECTION') return null;
      if (e.type === 'REPAIRED') return 'var(--good)';
      if (e.type === 'CLOSED') return '#9aa0a6';
      return DAMAGE_TYPES[e.damage_type]?.color ?? 'var(--accent)';
    };
    evs.forEach((e) => {
      const c = color(e);
      const label = `${e.at} · ${EVENT_TYPES[e.type] ?? e.type}`;
      strip.append(h('button', { class: `tl-dot ${c ? '' : 'insp'}`, style: { left: pos(e.at), ...(c ? { background: c } : {}) }, title: label, 'aria-label': label,
        onclick: (ev) => { ev.stopPropagation(); setAt(e.at); } }));
    });
    strip.append(h('div', { class: 'tl-cursor', style: { left: pos(st.at ?? today) } }));
    strip.onclick = (ev) => {
      const r = strip.getBoundingClientRect();
      const t = lo + ((ev.clientX - r.left) / r.width) * (hi - lo);
      setAt(new Date(Math.min(hi, Math.max(lo, t))).toISOString().slice(0, 10));
    };
    fill(atNote, st.at ? `${st.at}에 있던 파손만 보여 줍니다.` : '오늘 기준. 점을 누르거나 날짜를 고르면 그때 모습을 봅니다. ○ = 점검');
  }

  // ── 신고(현장) ─────────────────────────────
  function showHint(text) {
    fill(hint, text, ' ', h('button', { class: 'small', onclick: () => stopPick() }, '취소'));
    hint.classList.remove('hidden');
  }
  function stopPick() {
    hint.classList.add('hidden');
    viewer.onPick = null;
    viewer.setMode('view');
  }
  function startReport() {
    setTab('3d');
    if (st.at) setAt(null);
    viewer.setMode('pick');
    showHint('3D에서 파손 위치를 누르세요.');
    viewer.onPick = (pick) => {
      hint.classList.add('hidden');
      reportModal(pick);
    };
  }

  async function reportModal(pick) {
    const cands = await app.call('duplicateCandidates', { sensor_id: sensorId, point: pick.point });
    const list = filtered();
    let kind = 'NEW';
    let target = null;
    const tp = typePicker(null);
    const photos = photoPicker();
    const found = dateInput();
    const memo = h('textarea', { placeholder: '예: 오른쪽 창 아래쪽에 가는 긁힘, 손톱에 걸림' });
    const candBox = cands.length
      ? h('div', { class: 'notice warn stack', style: { gap: '6px' } },
        h('b', {}, '이 근처에 이미 등록된 파손이 있습니다. 같은 파손인가요?'),
        h('label', { class: 'row' }, h('input', { type: 'radio', name: 'kind', checked: true, onchange: () => { kind = 'NEW'; target = null; } }), '아니요, 새 파손입니다'),
        ...cands.map((c) => {
          const n = list.findIndex((d) => d.id === c.id);
          return h('label', { class: 'row' }, h('input', { type: 'radio', name: 'kind', onchange: () => { kind = 'CHANGE'; target = c.id; } }),
            `네, ${n >= 0 ? `${n + 1}번 ` : ''}${DAMAGE_TYPES[c.type].short}(${dateText(c.found_at)} 확인)이 커졌거나 변했습니다`);
        }))
      : null;
    openModal({
      title: '파손 신고',
      body: h('div', { class: 'stack' },
        h('div', { class: 'small' }, '위치: ', h('b', {}, partLabel(info.model_id, pick.part)), angleText(info.model_id, [pick.point], yaw) ? ` · ${angleText(info.model_id, [pick.point], yaw)}` : ''),
        candBox,
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, '파손 유형'), tp.el),
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, '사진 (1장 이상)'), photos.el),
        h('label', { class: 'field' }, '발견일', found),
        h('label', { class: 'field' }, '메모', memo),
        h('div', { class: 'small muted' }, '관리자가 확인한 뒤 모두에게 공개됩니다.')),
      wide: true,
      actions: [{ label: '취소' }, { label: '신고하기', primary: true, onClick: async () => {
        if (!tp.value()) throw new Error('파손 유형을 골라 주세요.');
        const ph = await photos.value();
        if (!ph.length) throw new Error('사진을 1장 이상 넣어 주세요.');
        await app.call('createReport', { sensor_id: sensorId, kind, target_damage_id: target, point: pick.point, normal: pick.normal, part: pick.part,
          type: tp.value(), found_at: found.value, memo: memo.value, photos: ph });
        toast('신고했습니다. 관리자 확인 후 공개됩니다.');
        await app.refreshStats();
        await load();
      } }],
      onClose: () => stopPick(),
    });
  }

  function inspectionModal() {
    const date = dateInput();
    const res = h('select', {}, h('option', { value: 'NO_NEW' }, '신규 파손 없음'), h('option', { value: 'NEW_FOUND' }, '신규 파손 있음 (따로 신고)'));
    const note = h('input', { placeholder: '예: 정기 점검' });
    openModal({
      title: '점검 완료 기록',
      body: h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, '"신규 파손 없음"으로 기록하면, 다음에 발견되는 파손의 발생 기간이 이 날짜부터로 좁혀집니다.'),
        h('label', { class: 'field' }, '점검일', date), h('label', { class: 'field' }, '결과', res), h('label', { class: 'field' }, '메모', note)),
      actions: [{ label: '취소' }, { label: '기록', primary: true, onClick: async () => {
        await app.call('addInspection', { sensor_id: sensorId, date: date.value, result: res.value, note: note.value });
        toast('점검을 기록했습니다.');
        await load();
        if (res.value === 'NEW_FOUND') startReport();
      } }],
    });
  }

  // ── 관리자 ─────────────────────────────
  function startRegister() {
    setTab('3d');
    if (st.at) setAt(null);
    startDrawTool(viewer, viewerHost, {
      title: '직접 등록',
      shape: 'LINE',
      onDone: (r) => registerModal(r),
    });
  }

  function registerModal(r) {
    const tp = typePicker(Object.keys(DAMAGE_TYPES).find((k) => DAMAGE_TYPES[k].shape === r.shape) ?? 'SCRATCH');
    const part = partSelect(info.model_id, r.part);
    const found = dateInput();
    const memo = h('textarea', { placeholder: '메모' });
    const photos = photoPicker({ hint: '사진(선택)' });
    openModal({
      title: '파손 직접 등록',
      wide: true,
      body: h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, '유형'), tp.el),
        h('div', { class: 'form-grid' }, h('label', { class: 'field' }, '부위', part), h('label', { class: 'field' }, '발견일', found)),
        h('label', { class: 'field' }, '메모', memo), photos.el),
      actions: [{ label: '취소' }, { label: '등록', primary: true, onClick: async () => {
        const res = await app.call('createDamage', { sensor_id: sensorId, type: tp.value(), part: part.value, shape: r.shape, geom: r.geom, found_at: found.value, memo: memo.value, photos: await photos.value() });
        toast('등록했습니다.');
        st.selected = res.id;
        await load();
        select(res.id);
      } }],
    });
  }

  function damageActions(d) {
    const act = (action, title, { needNote, notePh, photos: withPhotos, geom, shape } = {}) => {
      const date = dateInput();
      const note = h('textarea', { placeholder: notePh ?? '메모' });
      const pp = withPhotos ? photoPicker({ hint: '사진(선택)' }) : null;
      openModal({
        title,
        body: h('div', { class: 'stack' }, h('label', { class: 'field' }, '날짜', date), h('label', { class: 'field' }, needNote ? '사유 (필수)' : '메모', note), pp?.el),
        actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
          await app.call('updateDamage', { id: d.id, action, date: date.value, note: note.value, patch: geom ? { geom, shape } : {}, photos: pp ? await pp.value() : [] });
          toast('저장했습니다.');
          if ((action === 'REPAIR' || action === 'CLOSE') && !st.showResolved) {
            st.showResolved = true;
            resolvedChk.checked = true;
            setQuery({ all: '1' });
          }
          await load();
          select(d.id, false);
        } }],
      });
    };
    const redraw = (action, title) => startDrawTool(viewer, viewerHost, {
      title, shape: d.shape,
      onDone: (r) => act(action, title, { needNote: action === 'CORRECT', photos: action === 'CHANGE', geom: r.geom, shape: r.shape,
        notePh: action === 'CHANGE' ? '예: 길이가 늘어남' : '예: 위치를 잘못 찍어 바로잡음' }),
    });
    const editInfo = () => {
      const tp = typePicker(d.type);
      const part = partSelect(info.model_id, d.part);
      const note = h('textarea', { placeholder: '정정 사유 (필수)' });
      openModal({
        title: '내용 정정',
        body: h('div', { class: 'stack' }, tp.el, h('label', { class: 'field' }, '부위', part), h('label', { class: 'field' }, '사유', note)),
        actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: async () => {
          await app.call('updateDamage', { id: d.id, action: 'CORRECT', note: note.value, patch: { type: tp.value(), part: part.value } });
          toast('정정했습니다.');
          await load();
          select(d.id, false);
        } }],
      });
    };
    if (d.status !== 'ACTIVE') {
      return h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'small', onclick: () => act('REOPEN', '현존으로 되돌리기', { needNote: true }) }, '현존으로 되돌리기'));
    }
    return h('div', { class: 'stack', style: { marginTop: '12px', gap: '6px' } },
      h('div', { class: 'small muted' }, '관리자 처리'),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: () => act('REPAIR', '수리완료 처리', { photos: true, notePh: '예: 창 연마 후 정상' }) }, '수리완료'),
        h('button', { class: 'small', onclick: () => redraw('CHANGE', '변화 등록 — 새 범위를 그리세요') }, '변화 등록'),
        h('button', { class: 'small', onclick: editInfo }, '내용 정정'),
        h('button', { class: 'small', onclick: () => redraw('CORRECT', '위치 정정 — 다시 그리세요') }, '위치 정정'),
        h('button', { class: 'small danger', onclick: () => act('CLOSE', '종료 처리', { needNote: true, notePh: '예: 오염이 닦여 없어짐' }) }, '종료')));
  }

  // 시작
  setTab(st.tab);
  await load();
  if (st.selected) select(st.selected);
  return () => {
    viewer.dispose();
    unwrap?.dispose();
  };
}

function shiftDays(d, n) {
  return new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
}

export { DAMAGE_STATUS };
