// 업무 로직 — 브라우저(데모 모드)와 서버(Node.js)가 같은 코드를 쓴다.
// store: 동기 저장소 { all, get, insert, update, remove, tx }
// deps : { now(), today(), uid(prefix), hashPassword(pw), verifyPassword(pw, hash), savePhoto({id, full, thumb}) }

import {
  ROLES, SLOTS, DAMAGE_TYPES, SHAPES, OPEN_REPORT_STATUSES, NEW_DAYS, DUPLICATE_MM, LIDAR_SHAPES,
  modelForSlot, defaultLidarShape, slotLabel,
} from './constants.js';
import { getModel } from './sensorModels.js';
import { distanceToPath, measure } from './geometry.js';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, msg) => {
  throw new AppError(status, msg);
};

const pad = (n, w) => String(n).padStart(w, '0');
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const byDateDesc = (k) => (a, b) => (a[k] < b[k] ? 1 : a[k] > b[k] ? -1 : 0);
const SNAP_KEYS = ['type', 'part', 'shape', 'geom', 'size_mm'];
const pickSnap = (d) => Object.fromEntries(SNAP_KEYS.map((k) => [k, d[k]]));
const isRole = (r) => typeof r === 'string' && Object.hasOwn(ROLES, r);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const SLOT_SHORT = { LIDAR_1: 'L1', LIDAR_2: 'L2', CAM_1: 'C1', CAM_2: 'C2' };
const dateKey = (v) => (isDate(v) ? v : '');

export function createService(store, deps) {
  const { now, today, uid, hashPassword, verifyPassword, savePhoto } = deps;

  // ── 공통 도우미 ─────────────────────────────
  const publicUser = (u) =>
    u && { id: u.id, login: u.login, name: u.name, team: u.team, role: u.role, active: u.active, must_change_pw: u.must_change_pw };
  const need = (ctx, role = 'FIELD') => {
    if (!ctx?.user) fail(401, '로그인이 필요합니다.');
    if (!isRole(ctx.user.role) || ROLES[ctx.user.role].level < ROLES[role].level) fail(403, `${ROLES[role].label} 권한이 필요합니다.`);
    return ctx.user;
  };
  const isAdmin = (ctx) => !!ctx?.user && isRole(ctx.user.role) && ROLES[ctx.user.role].level >= ROLES.ADMIN.level;
  const userName = (id) => store.get('users', id)?.name ?? '-';
  const robotByNo = (no) => store.all('robots').find((r) => r.no === Number(no)) ?? fail(404, `${no}호기를 찾을 수 없습니다.`);
  const sensorById = (id) => store.get('sensors', id) ?? fail(404, '센서를 찾을 수 없습니다.');
  const currentMounts = (robotId) => store.all('mounts').filter((m) => m.robot_id === robotId && !m.unmounted_at);
  const mountOfSensor = (sensorId) => store.all('mounts').find((m) => m.sensor_id === sensorId && !m.unmounted_at) ?? null;
  const robotOfMount = (m) => (m ? store.get('robots', m.robot_id) : null);
  const audit = (ctx, action, target, detail = {}) =>
    store.insert('audit_log', { id: uid('A'), at: now(), user_id: ctx?.user?.id ?? null, action, target, detail });
  const nextSeqId = (table, prefix) => {
    const year = today().slice(0, 4);
    const head = `${prefix}-${year}-`;
    const max = store.all(table).reduce((m, r) => (r.id.startsWith(head) ? Math.max(m, Number(r.id.slice(head.length)) || 0) : m), 0);
    return `${head}${pad(max + 1, 4)}`;
  };
  const photosByIds = (ids = []) => ids.map((id) => store.get('photos', id)).filter(Boolean).map(({ id, src, thumb }) => ({ id, src, thumb }));
  const photosOf = (type, id) =>
    store.all('photos').filter((p) => p.owner_type === type && p.owner_id === id).map(({ id: pid, src, thumb }) => ({ id: pid, src, thumb }));
  const storePhotos = (ctx, ownerType, ownerId, photos = []) =>
    photos.slice(0, 8).map((p) => {
      if (!p?.full) fail(400, '사진 데이터가 비어 있습니다.');
      const id = uid('P');
      const saved = savePhoto({ id, full: p.full, thumb: p.thumb ?? p.full });
      store.insert('photos', { id, owner_type: ownerType, owner_id: ownerId, src: saved.src, thumb: saved.thumb, by: ctx.user.id, created_at: now() });
      return id;
    });
  const checkGeom = (shape, geom) => {
    if (!SHAPES[shape]) fail(400, '파손 모양이 올바르지 않습니다.');
    if (!geom || !Array.isArray(geom.path) || !geom.path.length) fail(400, '3D 위치가 없습니다.');
    if (!geom.path.every(isVec3)) fail(400, '3D 좌표가 올바르지 않습니다.');
    if (geom.normal != null && !isVec3(geom.normal)) fail(400, '면 방향 값이 올바르지 않습니다.');
    if (shape === 'CIRCLE' && !(geom.radius > 0)) fail(400, '원의 반지름이 없습니다.');
  };
  const checkType = (type) => DAMAGE_TYPES[type] ?? fail(400, '파손 유형을 골라 주세요.');
  const checkDate = (d, label = '날짜') => {
    if (!isDate(d)) fail(400, `${label}를 YYYY-MM-DD 형식으로 입력해 주세요.`);
    if (d > today()) fail(400, `${label}는 오늘 이후일 수 없습니다.`);
    return d;
  };

  // ── 파손 상태 계산 ─────────────────────────────
  const eventsOf = (damageId) =>
    store.all('damage_events').filter((e) => e.damage_id === damageId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const visibleAt = (d, at) => d.found_at <= at && (!d.resolved_at || d.resolved_at > at);
  // 이벤트를 날짜순으로 다시 적용해 모습을 만든다. CHANGED(변화)는 그 날짜 이후에만, CORRECTED(정정)는 과거에도 적용.
  const replay = (d, at) => {
    const evs = eventsOf(d.id).sort((a, b) => (a.at === b.at ? (a.created_at < b.created_at ? -1 : 1) : a.at < b.at ? -1 : 1));
    let snap = { ...(evs.find((e) => e.type === 'CONFIRMED')?.after ?? pickSnap(d)) };
    evs.forEach((e) => {
      if (!e.after || e.type === 'CONFIRMED') return;
      if (e.type === 'CORRECTED' || !at || e.at <= at) snap = { ...snap, ...e.after };
    });
    return snap;
  };
  const snapshotAt = (d, at) => (!at || at >= today() ? pickSnap(d) : replay(d, at));
  const diff = (a, b) => Object.fromEntries(SNAP_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, b[k]]));
  const geomPart = (s) => ({ shape: s.shape, geom: s.geom, size_mm: s.size_mm });
  const occurredFrom = (sensorId, foundAt) => {
    const insp = store.all('inspections')
      .filter((i) => i.sensor_id === sensorId && i.result === 'NO_NEW' && i.date < foundAt)
      .map((i) => i.date);
    const mounts = store.all('mounts')
      .filter((m) => m.sensor_id === sensorId && isDate(m.mounted_at) && m.mounted_at <= foundAt && (!m.unmounted_at || m.unmounted_at >= foundAt))
      .map((m) => m.mounted_at);
    const all = [...insp, ...mounts].sort();
    return all.length ? all[all.length - 1] : null;
  };
  const isNewAt = (d, ref) => daysBetween(d.found_at, ref) <= NEW_DAYS && d.found_at <= ref;
  const damageSummary = (d, at) => {
    const ref = at ?? today();
    const snap = snapshotAt(d, at);
    const firstEv = eventsOf(d.id).find((e) => e.type === 'CONFIRMED');
    const thumbs = firstEv ? photosByIds(firstEv.photo_ids) : [];
    return {
      id: d.id, sensor_id: d.sensor_id, ...snap, found_at: d.found_at, occurred_from: d.occurred_from,
      status: at && at < today() ? (visibleAt(d, at) ? 'ACTIVE' : d.status) : d.status,
      resolved_at: d.resolved_at, is_new: isNewAt(d, ref) && (!d.resolved_at || d.resolved_at > ref), thumb: thumbs[0]?.thumb ?? null,
    };
  };
  const openReportsOfSensor = (sensorId) => store.all('reports').filter((r) => r.sensor_id === sensorId && OPEN_REPORT_STATUSES.includes(r.status));
  const sensorCounts = (sensorId) => {
    const ds = store.all('damages').filter((d) => d.sensor_id === sensorId);
    const active = ds.filter((d) => d.status === 'ACTIVE');
    const t = today();
    return {
      active: active.length,
      new: active.filter((d) => isNewAt(d, t)).length,
      open_reports: openReportsOfSensor(sensorId).length,
      last_change: [...ds.map((d) => d.found_at), ...ds.map((d) => d.resolved_at).filter(Boolean)].sort().pop() ?? null,
    };
  };

  // 내부: 파손 생성 + CONFIRMED 이벤트
  const createDamageInternal = (ctx, { sensor_id, type, part, shape, geom, found_at, memo, origin_report_id, photo_ids = [], photos }) => {
    const id = nextSeqId('damages', 'D');
    const snap = { type, part, shape, geom, size_mm: measure(shape, geom) };
    store.insert('damages', {
      id, sensor_id, ...snap, found_at, occurred_from: occurredFrom(sensor_id, found_at), confirmed_at: now(), confirmed_by: ctx.user.id,
      status: 'ACTIVE', resolved_at: null, severity: null, memo: memo ?? null, origin_report_id: origin_report_id ?? null, created_at: now(),
    });
    const evId = uid('E');
    const extra = photos ? storePhotos(ctx, 'event', evId, photos) : [];
    store.insert('damage_events', {
      id: evId, damage_id: id, sensor_id, type: 'CONFIRMED', at: found_at, by: ctx.user.id, before: null, after: snap,
      note: memo ?? '', photo_ids: [...photo_ids, ...extra], created_at: now(),
    });
    return id;
  };

  const closeDamagesOfSensor = (ctx, sensorId, date, note) => {
    store.all('damages').filter((d) => d.sensor_id === sensorId && d.status === 'ACTIVE').forEach((d) => {
      const when = date < d.found_at ? d.found_at : date;
      store.update('damages', d.id, { status: 'CLOSED', resolved_at: when });
      store.insert('damage_events', {
        id: uid('E'), damage_id: d.id, sensor_id: sensorId, type: 'CLOSED', at: when, by: ctx.user.id, before: null, after: null,
        note, photo_ids: [], created_at: now(),
      });
    });
  };
  const closeOpenReports = (ctx, sensorId, note) => {
    openReportsOfSensor(sensorId).forEach((r) =>
      store.update('reports', r.id, { status: 'REJECTED', review_note: note, reviewer_id: ctx.user.id, reviewed_at: now(), updated_at: now() }));
  };

  const sensorBrief = (s) => {
    const m = mountOfSensor(s.id);
    const r = robotOfMount(m);
    return { id: s.id, serial: s.serial, model_id: s.model_id, model_name: getModel(s.model_id).name, status: s.status, memo: s.memo,
      robot_no: r?.no ?? null, slot: m?.slot ?? null, yaw_deg: m?.yaw_deg ?? 0 };
  };

  // ── 서비스 메서드 ─────────────────────────────
  const api = {
    // 인증
    login(_ctx, { login, password }) {
      const u = store.all('users').find((x) => x.login === String(login ?? '').trim());
      if (!u || !verifyPassword(String(password ?? ''), u.password_hash)) fail(401, '아이디 또는 비밀번호가 맞지 않습니다.');
      if (!u.active) fail(403, '사용이 중지된 계정입니다.');
      audit({ user: u }, 'LOGIN', u.id);
      return publicUser(u);
    },
    me(ctx) {
      need(ctx);
      return publicUser(store.get('users', ctx.user.id));
    },
    changePassword(ctx, { current, next }) {
      need(ctx);
      const u = store.get('users', ctx.user.id);
      if (!verifyPassword(String(current ?? ''), u.password_hash)) fail(400, '현재 비밀번호가 맞지 않습니다.');
      if (String(next ?? '').length < 6) fail(400, '새 비밀번호는 6자 이상이어야 합니다.');
      store.update('users', u.id, { password_hash: hashPassword(String(next)), must_change_pw: 0 });
      audit(ctx, 'CHANGE_PASSWORD', u.id);
      return { ok: true };
    },
    stats(ctx) {
      need(ctx);
      const reports = store.all('reports');
      return {
        open_reports: isAdmin(ctx) ? reports.filter((r) => ['SUBMITTED', 'IN_REVIEW'].includes(r.status)).length : 0,
        my_need_info: reports.filter((r) => r.reporter_id === ctx.user.id && r.status === 'NEED_INFO').length,
      };
    },

    // 호기
    listRobots(ctx, { status = 'ACTIVE', q = '' } = {}) {
      need(ctx);
      const query = String(q).replace(/[^0-9]/g, '');
      return store.all('robots')
        .filter((r) => status === 'ALL' || r.status === status)
        .filter((r) => !query || String(r.no).includes(query))
        .sort((a, b) => a.no - b.no)
        .map((r) => {
          const ms = currentMounts(r.id);
          const counts = ms.map((m) => sensorCounts(m.sensor_id));
          const sum = (k) => counts.reduce((s, c) => s + c[k], 0);
          return { ...r, sensors: ms.length, active: sum('active'), new: sum('new'), open_reports: sum('open_reports') };
        });
    },
    nextRobotNo(ctx) {
      need(ctx, 'ADMIN');
      const no = store.all('robots').reduce((m, r) => Math.max(m, r.no), 0) + 1;
      return { no, lidar_shape: defaultLidarShape(no) };
    },
    getRobot(ctx, { no }) {
      need(ctx);
      const r = robotByNo(no);
      const ms = currentMounts(r.id);
      const slots = SLOTS.map((s) => {
        const m = ms.find((x) => x.slot === s.code);
        const sensor = m ? store.get('sensors', m.sensor_id) : null;
        return { slot: s.code, label: s.label, kind: s.kind, mount: m ?? null, sensor: sensor ? sensorBrief(sensor) : null,
          counts: sensor ? sensorCounts(sensor.id) : null };
      });
      const past = store.all('mounts').filter((m) => m.robot_id === r.id && m.unmounted_at)
        .map((m) => ({ ...m, serial: store.get('sensors', m.sensor_id)?.serial ?? '-' }));
      return { robot: r, slots, past_mounts: past };
    },
    createRobot(ctx, { no, site, lidar_shape, serials = {} }) {
      need(ctx, 'ADMIN');
      const n = Number(no);
      if (!Number.isInteger(n) || n < 1) fail(400, '호기 번호를 확인해 주세요.');
      if (store.all('robots').some((r) => r.no === n)) fail(409, `${n}호기는 이미 있습니다. 폐기된 호기 번호도 다시 쓰지 않습니다.`);
      const shape = LIDAR_SHAPES[lidar_shape] ? lidar_shape : defaultLidarShape(n);
      const id = `R${pad(n, 3)}`;
      return store.tx(() => {
        store.insert('robots', { id, no: n, site: site || '미지정', lidar_shape: shape, status: 'ACTIVE', disposed_at: null, dispose_reason: null, memo: null, created_at: now() });
        SLOTS.forEach((s) => {
          const serial = String(serials[s.code] ?? '').trim() || `TMP-${pad(n, 3)}-${SLOT_SHORT[s.code]}`;
          let sensor = store.all('sensors').find((x) => x.serial === serial);
          if (sensor && sensor.status !== 'SPARE') fail(409, `시리얼 ${serial} 센서는 이미 다른 곳에 있습니다.`);
          if (sensor && getModel(sensor.model_id).kind !== s.kind) fail(400, `시리얼 ${serial} 센서는 ${s.label}에 달 수 없는 종류입니다.`);
          if (!sensor) {
            sensor = { id: uid('S'), serial, model_id: modelForSlot(s.code, shape), status: 'MOUNTED', memo: null, created_at: now() };
            store.insert('sensors', sensor);
          } else store.update('sensors', sensor.id, { status: 'MOUNTED' });
          store.insert('mounts', { id: uid('M'), robot_id: id, sensor_id: sensor.id, slot: s.code, yaw_deg: 0, mounted_at: today(), unmounted_at: null });
        });
        audit(ctx, 'CREATE_ROBOT', id, { no: n, lidar_shape: shape });
        return { no: n };
      });
    },
    updateRobot(ctx, { no, site, lidar_shape, memo }) {
      need(ctx, 'ADMIN');
      const r = robotByNo(no);
      const patch = {};
      if (site !== undefined) patch.site = site || '미지정';
      if (memo !== undefined) patch.memo = memo || null;
      if (lidar_shape !== undefined) {
        if (!LIDAR_SHAPES[lidar_shape]) fail(400, '라이다 형상이 올바르지 않습니다.');
        patch.lidar_shape = lidar_shape;
      }
      store.update('robots', r.id, patch);
      audit(ctx, 'UPDATE_ROBOT', r.id, patch);
      return { ok: true };
    },
    disposeRobot(ctx, { no, date, reason, sensorActions = {} }) {
      need(ctx, 'ADMIN');
      const r = robotByNo(no);
      if (r.status === 'DISPOSED') fail(400, '이미 폐기된 호기입니다.');
      checkDate(date, '폐기일');
      if (!String(reason ?? '').trim()) fail(400, '폐기 사유를 입력해 주세요.');
      return store.tx(() => {
        currentMounts(r.id).forEach((m) => {
          if (isDate(m.mounted_at) && date < m.mounted_at) fail(400, `폐기일이 ${slotLabel(m.slot)} 장착일(${m.mounted_at})보다 빠릅니다.`);
          const action = sensorActions[m.slot] === 'SPARE' ? 'SPARE' : 'DISPOSED';
          store.update('mounts', m.id, { unmounted_at: date });
          store.update('sensors', m.sensor_id, { status: action });
          if (action === 'DISPOSED') closeDamagesOfSensor(ctx, m.sensor_id, date, `${r.no}호기 폐기로 센서 폐기`);
          closeOpenReports(ctx, m.sensor_id, `${r.no}호기 폐기로 자동 종료`);
        });
        store.update('robots', r.id, { status: 'DISPOSED', disposed_at: date, dispose_reason: reason });
        audit(ctx, 'DISPOSE_ROBOT', r.id, { date, reason, sensorActions });
        return { ok: true };
      });
    },
    deleteRobot(ctx, { no }) {
      need(ctx, 'SYSADMIN');
      const r = robotByNo(no);
      return store.tx(() => {
        const ms = store.all('mounts').filter((m) => m.robot_id === r.id);
        ms.forEach((m) => {
          store.remove('mounts', m.id);
          const s = store.get('sensors', m.sensor_id);
          if (!s) return;
          const used = store.all('damages').some((d) => d.sensor_id === s.id) || store.all('reports').some((x) => x.sensor_id === s.id)
            || store.all('mounts').some((x) => x.sensor_id === s.id);
          if (!used) store.remove('sensors', s.id);
          else if (s.status === 'MOUNTED' && !mountOfSensor(s.id)) store.update('sensors', s.id, { status: 'SPARE' });
        });
        store.remove('robots', r.id);
        audit(ctx, 'DELETE_ROBOT', r.id, { no: r.no });
        return { ok: true };
      });
    },

    // 센서
    getSensor(ctx, { id }) {
      need(ctx);
      const s = sensorById(id);
      const mounts = store.all('mounts').filter((m) => m.sensor_id === s.id)
        .map((m) => ({ ...m, robot_no: store.get('robots', m.robot_id)?.no ?? null }));
      return { ...sensorBrief(s), mounts };
    },
    listSpareSensors(ctx, { kind } = {}) {
      need(ctx, 'ADMIN');
      return store.all('sensors').filter((s) => s.status === 'SPARE' && (!kind || getModel(s.model_id).kind === kind)).map(sensorBrief);
    },
    updateSensor(ctx, { id, serial, memo }) {
      need(ctx, 'ADMIN');
      const s = sensorById(id);
      const patch = {};
      if (serial !== undefined) {
        const v = String(serial).trim();
        if (!v) fail(400, '시리얼을 입력해 주세요.');
        if (store.all('sensors').some((x) => x.serial === v && x.id !== s.id)) fail(409, '같은 시리얼의 센서가 이미 있습니다.');
        patch.serial = v;
      }
      if (memo !== undefined) patch.memo = memo || null;
      store.update('sensors', s.id, patch);
      audit(ctx, 'UPDATE_SENSOR', s.id, patch);
      return { ok: true };
    },
    setMountYaw(ctx, { no, slot, yaw_deg }) {
      need(ctx, 'ADMIN');
      const r = robotByNo(no);
      const m = currentMounts(r.id).find((x) => x.slot === slot) ?? fail(404, '장착된 센서가 없습니다.');
      const y = ((Number(yaw_deg) % 360) + 360) % 360;
      if (!Number.isFinite(y)) fail(400, '각도를 확인해 주세요.');
      store.update('mounts', m.id, { yaw_deg: y });
      audit(ctx, 'SET_YAW', m.id, { yaw_deg: y });
      return { ok: true };
    },
    replaceSensor(ctx, { no, slot, new_sensor_id, new_serial, old_action = 'SPARE', date }) {
      need(ctx, 'ADMIN');
      const r = robotByNo(no);
      if (r.status !== 'ACTIVE') fail(400, '운영 중인 호기만 센서를 교체할 수 있습니다.');
      const slotDef = SLOTS.find((s) => s.code === slot) ?? fail(400, '슬롯이 올바르지 않습니다.');
      checkDate(date, '교체일');
      return store.tx(() => {
        const old = currentMounts(r.id).find((m) => m.slot === slot);
        if (old && isDate(old.mounted_at) && date < old.mounted_at) fail(400, `교체일이 지금 센서 장착일(${old.mounted_at})보다 빠릅니다.`);
        let sensor;
        if (new_sensor_id) {
          sensor = sensorById(new_sensor_id);
          if (sensor.status !== 'SPARE') fail(400, '예비 상태인 센서만 장착할 수 있습니다.');
          if (getModel(sensor.model_id).kind !== slotDef.kind) fail(400, '센서 종류가 슬롯과 맞지 않습니다.');
          store.update('sensors', sensor.id, { status: 'MOUNTED' });
        } else {
          const serial = String(new_serial ?? '').trim();
          if (!serial) fail(400, '새 센서 시리얼을 입력하거나 예비 센서를 골라 주세요.');
          if (store.all('sensors').some((x) => x.serial === serial)) fail(409, '같은 시리얼의 센서가 이미 있습니다. 예비 센서 목록에서 골라 주세요.');
          sensor = { id: uid('S'), serial, model_id: modelForSlot(slot, r.lidar_shape), status: 'MOUNTED', memo: null, created_at: now() };
          store.insert('sensors', sensor);
        }
        if (old) {
          store.update('mounts', old.id, { unmounted_at: date });
          const action = old_action === 'DISPOSED' ? 'DISPOSED' : 'SPARE';
          store.update('sensors', old.sensor_id, { status: action });
          if (action === 'DISPOSED') closeDamagesOfSensor(ctx, old.sensor_id, date, '센서 교체로 폐기');
          closeOpenReports(ctx, old.sensor_id, '센서 교체로 자동 종료');
        }
        store.insert('mounts', { id: uid('M'), robot_id: r.id, sensor_id: sensor.id, slot, yaw_deg: old?.yaw_deg ?? 0, mounted_at: date, unmounted_at: null });
        audit(ctx, 'REPLACE_SENSOR', r.id, { slot, old: old?.sensor_id ?? null, new: sensor.id, old_action });
        return { sensor_id: sensor.id };
      });
    },

    // 3D 뷰어 한 화면에 필요한 데이터
    getSensorView(ctx, { id, at }) {
      need(ctx);
      const s = sensorById(id);
      const date = at && isDate(at) ? at : null;
      const all = store.all('damages').filter((d) => d.sensor_id === s.id);
      const shown = date ? all.filter((d) => visibleAt(d, date)) : all;
      const damages = shown.map((d) => damageSummary(d, date)).sort((a, b) => (a.found_at < b.found_at ? -1 : 1));
      const timeline = [
        ...store.all('damage_events').filter((e) => e.sensor_id === s.id).map((e) => ({ at: e.at, type: e.type, damage_id: e.damage_id, damage_type: store.get('damages', e.damage_id)?.type ?? null })),
        ...store.all('inspections').filter((i) => i.sensor_id === s.id).map((i) => ({ at: i.date, type: 'INSPECTION', result: i.result })),
      ].sort((a, b) => (a.at < b.at ? -1 : 1));
      const reports = openReportsOfSensor(s.id)
        .filter((r) => isAdmin(ctx) || r.reporter_id === ctx.user.id)
        .map((r) => ({ id: r.id, point: r.point, normal: r.normal, type: r.type, status: r.status, found_at: r.found_at, mine: r.reporter_id === ctx.user.id }));
      return { sensor: sensorBrief(s), at: date, damages, timeline, reports };
    },
    getSensorHistory(ctx, { id }) {
      need(ctx);
      const s = sensorById(id);
      const items = [];
      store.all('damage_events').filter((e) => e.sensor_id === s.id).forEach((e) => {
        const d = store.get('damages', e.damage_id);
        items.push({ at: e.at, type: e.type, damage_id: e.damage_id, damage_type: d?.type, note: e.note, by: userName(e.by), created_at: e.created_at });
      });
      store.all('inspections').filter((i) => i.sensor_id === s.id).forEach((i) =>
        items.push({ at: i.date, type: 'INSPECTION', note: i.note || (i.result === 'NO_NEW' ? '신규 파손 없음' : '신규 파손 발견'), by: userName(i.by), created_at: i.created_at }));
      store.all('mounts').filter((m) => m.sensor_id === s.id).forEach((m) => {
        const no = store.get('robots', m.robot_id)?.no;
        items.push({ at: m.mounted_at, type: 'MOUNTED', note: `${no}호기 ${slotLabel(m.slot)}`, by: '-', created_at: '' });
        if (m.unmounted_at) items.push({ at: m.unmounted_at, type: 'UNMOUNTED', note: `${no}호기 ${slotLabel(m.slot)}`, by: '-', created_at: '' });
      });
      return items.sort((a, b) => {
        const ka = dateKey(a.at);
        const kb = dateKey(b.at);
        if (ka !== kb) return ka < kb ? 1 : -1;
        return a.created_at < b.created_at ? 1 : -1;
      });
    },
    addInspection(ctx, { sensor_id, date, result = 'NO_NEW', note }) {
      need(ctx);
      const s = sensorById(sensor_id);
      checkDate(date, '점검일');
      const m = mountOfSensor(s.id);
      const row = { id: uid('I'), sensor_id: s.id, robot_id: m?.robot_id ?? null, date, by: ctx.user.id, result: result === 'NEW_FOUND' ? 'NEW_FOUND' : 'NO_NEW', note: note || '', created_at: now() };
      store.insert('inspections', row);
      audit(ctx, 'INSPECTION', s.id, { date, result: row.result });
      return { id: row.id };
    },

    // 파손
    getDamage(ctx, { id }) {
      need(ctx);
      const d = store.get('damages', id) ?? fail(404, '파손 기록을 찾을 수 없습니다.');
      const events = eventsOf(d.id).map((e) => ({ ...e, by_name: userName(e.by), photos: photosByIds(e.photo_ids) })).reverse();
      const report = d.origin_report_id ? store.get('reports', d.origin_report_id) : null;
      return {
        ...d, confirmed_by_name: userName(d.confirmed_by), events,
        reporter_name: report ? userName(report.reporter_id) : null, sensor: sensorBrief(sensorById(d.sensor_id)),
      };
    },
    createDamage(ctx, { sensor_id, type, part, shape, geom, found_at, memo, photos = [] }) {
      need(ctx, 'ADMIN');
      sensorById(sensor_id);
      checkType(type);
      checkGeom(shape, geom);
      checkDate(found_at, '발견일');
      return store.tx(() => {
        const id = createDamageInternal(ctx, { sensor_id, type, part, shape, geom, found_at, memo, photos });
        audit(ctx, 'CREATE_DAMAGE', id);
        return { id };
      });
    },
    updateDamage(ctx, { id, action, date, note, patch = {}, photos = [] }) {
      need(ctx, 'ADMIN');
      const d = store.get('damages', id) ?? fail(404, '파손 기록을 찾을 수 없습니다.');
      const t = date ? checkDate(date) : today();
      if (t < d.found_at && action !== 'CORRECT') fail(400, `날짜가 최초 확인일(${d.found_at})보다 빠릅니다.`);
      return store.tx(() => {
        const evId = uid('E');
        const ev = { id: evId, damage_id: d.id, sensor_id: d.sensor_id, at: t, by: ctx.user.id, before: null, after: null, note: note ?? '', photo_ids: [], created_at: now() };
        if (action === 'REPAIR' || action === 'CLOSE') {
          if (d.status !== 'ACTIVE') fail(400, '현존 상태인 파손만 처리할 수 있습니다.');
          if (action === 'CLOSE' && !note) fail(400, '종료 사유를 입력해 주세요.');
          store.update('damages', d.id, { status: action === 'REPAIR' ? 'REPAIRED' : 'CLOSED', resolved_at: t });
          ev.type = action === 'REPAIR' ? 'REPAIRED' : 'CLOSED';
        } else if (action === 'CHANGE' || action === 'CORRECT') {
          if (action === 'CORRECT' && !note) fail(400, '정정 사유를 입력해 주세요.');
          const next = { ...pickSnap(d) };
          if (patch.type) next.type = checkType(patch.type) && patch.type;
          if (patch.part) next.part = patch.part;
          if (patch.geom) {
            checkGeom(patch.shape ?? d.shape, patch.geom);
            next.shape = patch.shape ?? d.shape;
            next.geom = patch.geom;
          }
          next.size_mm = measure(next.shape, next.geom);
          if (action === 'CHANGE' && !patch.geom) fail(400, '변화된 범위를 그려 주세요.');
          ev.before = pickSnap(d);
          ev.after = action === 'CHANGE' ? geomPart(next) : diff(pickSnap(d), next);
          ev.type = action === 'CHANGE' ? 'CHANGED' : 'CORRECTED';
          if (patch.memo !== undefined) store.update('damages', d.id, { memo: patch.memo });
        } else if (action === 'REOPEN') {
          if (d.status === 'ACTIVE') fail(400, '이미 현존 상태입니다.');
          if (!note) fail(400, '되돌리는 사유를 입력해 주세요.');
          store.update('damages', d.id, { status: 'ACTIVE', resolved_at: null });
          ev.type = 'CORRECTED';
        } else fail(400, '처리 종류가 올바르지 않습니다.');
        ev.photo_ids = storePhotos(ctx, 'event', evId, photos);
        store.insert('damage_events', ev);
        if (ev.after) store.update('damages', d.id, replay(store.get('damages', d.id), null));
        audit(ctx, `DAMAGE_${action}`, d.id, { note });
        return { ok: true };
      });
    },

    // 신고
    createReport(ctx, { sensor_id, kind = 'NEW', target_damage_id, point, normal, part, type, found_at, memo, photos = [] }) {
      need(ctx);
      const s = sensorById(sensor_id);
      const m = mountOfSensor(s.id) ?? fail(400, '호기에 장착된 센서만 신고할 수 있습니다.');
      checkType(type);
      checkDate(found_at, '발견일');
      if (!isVec3(point)) fail(400, '3D에서 파손 위치를 눌러 주세요.');
      if (normal != null && !isVec3(normal)) fail(400, '면 방향 값이 올바르지 않습니다.');
      if (!photos.length) fail(400, '사진을 1장 이상 첨부해 주세요.');
      if (kind === 'CHANGE') {
        const t = store.get('damages', target_damage_id);
        if (!t || t.sensor_id !== s.id) fail(400, '연결할 기존 파손을 찾을 수 없습니다.');
      }
      return store.tx(() => {
        const id = nextSeqId('reports', 'RP');
        store.insert('reports', {
          id, sensor_id: s.id, robot_id: m.robot_id, slot: m.slot, reporter_id: ctx.user.id, kind: kind === 'CHANGE' ? 'CHANGE' : 'NEW',
          target_damage_id: kind === 'CHANGE' ? target_damage_id : null, point, normal: normal ?? null, part: part ?? null, type,
          found_at, memo: memo ?? '', status: 'SUBMITTED', reviewer_id: null, reviewed_at: null, review_note: null, damage_id: null,
          thread: [], created_at: now(), updated_at: now(),
        });
        storePhotos(ctx, 'report', id, photos);
        audit(ctx, 'CREATE_REPORT', id, { sensor_id: s.id });
        return { id };
      });
    },
    duplicateCandidates(ctx, { sensor_id, point }) {
      need(ctx);
      if (!Array.isArray(point)) return [];
      return store.all('damages').filter((d) => d.sensor_id === sensor_id && d.status === 'ACTIVE')
        .map((d) => ({ id: d.id, type: d.type, part: d.part, found_at: d.found_at, distance: distanceToPath(point, d.geom.path) }))
        .filter((c) => c.distance <= DUPLICATE_MM).sort((a, b) => a.distance - b.distance);
    },
    listReports(ctx, { scope = 'mine' } = {}) {
      need(ctx);
      if (scope !== 'mine') need(ctx, 'ADMIN');
      return store.all('reports')
        .filter((r) => (scope === 'mine' ? r.reporter_id === ctx.user.id : scope === 'open' ? OPEN_REPORT_STATUSES.includes(r.status) : true))
        .sort(byDateDesc('created_at'))
        .map((r) => {
          const robot = store.get('robots', r.robot_id);
          const ph = photosOf('report', r.id);
          return { ...r, robot_no: robot?.no ?? null, slot_label: slotLabel(r.slot), reporter_name: userName(r.reporter_id),
            serial: store.get('sensors', r.sensor_id)?.serial ?? '-', thumb: ph[0]?.thumb ?? null, photo_count: ph.length };
        });
    },
    getReport(ctx, { id }) {
      need(ctx);
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (!isAdmin(ctx) && r.reporter_id !== ctx.user.id) fail(403, '본인 신고만 볼 수 있습니다.');
      const robot = store.get('robots', r.robot_id);
      const thread = (r.thread ?? []).map((t) => ({ ...t, by_name: userName(t.by), photos: photosByIds(t.photo_ids) }));
      return {
        ...r, robot_no: robot?.no ?? null, slot_label: slotLabel(r.slot), reporter_name: userName(r.reporter_id),
        reviewer_name: r.reviewer_id ? userName(r.reviewer_id) : null, photos: photosOf('report', r.id), thread,
        sensor: sensorBrief(sensorById(r.sensor_id)),
        candidates: isAdmin(ctx) ? api.duplicateCandidates(ctx, { sensor_id: r.sensor_id, point: r.point }) : [],
      };
    },
    openReview(ctx, { id }) {
      need(ctx, 'ADMIN');
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (r.status === 'SUBMITTED') store.update('reports', r.id, { status: 'IN_REVIEW', reviewer_id: ctx.user.id, updated_at: now() });
      return { ok: true };
    },
    replyReport(ctx, { id, text, photos = [] }) {
      need(ctx);
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (r.reporter_id !== ctx.user.id && !isAdmin(ctx)) fail(403, '본인 신고만 보완할 수 있습니다.');
      if (r.status !== 'NEED_INFO') fail(400, '보완요청 상태인 신고만 답할 수 있습니다.');
      if (!String(text ?? '').trim() && !photos.length) fail(400, '내용이나 사진을 넣어 주세요.');
      return store.tx(() => {
        const ids = storePhotos(ctx, 'report', r.id, photos);
        const thread = [...(r.thread ?? []), { at: now(), by: ctx.user.id, kind: 'REPLY', text: text ?? '', photo_ids: ids }];
        store.update('reports', r.id, { thread, status: 'IN_REVIEW', updated_at: now() });
        audit(ctx, 'REPLY_REPORT', r.id);
        return { ok: true };
      });
    },
    requestInfo(ctx, { id, note }) {
      need(ctx, 'ADMIN');
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (!OPEN_REPORT_STATUSES.includes(r.status)) fail(400, '이미 처리된 신고입니다.');
      if (!String(note ?? '').trim()) fail(400, '보완이 필요한 내용을 적어 주세요.');
      const thread = [...(r.thread ?? []), { at: now(), by: ctx.user.id, kind: 'NEED_INFO', text: note, photo_ids: [] }];
      store.update('reports', r.id, { thread, status: 'NEED_INFO', reviewer_id: ctx.user.id, updated_at: now() });
      audit(ctx, 'REQUEST_INFO', r.id, { note });
      return { ok: true };
    },
    rejectReport(ctx, { id, note }) {
      need(ctx, 'ADMIN');
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (!OPEN_REPORT_STATUSES.includes(r.status)) fail(400, '이미 처리된 신고입니다.');
      if (!String(note ?? '').trim()) fail(400, '반려 사유를 적어 주세요.');
      store.update('reports', r.id, { status: 'REJECTED', review_note: note, reviewer_id: ctx.user.id, reviewed_at: now(), updated_at: now() });
      audit(ctx, 'REJECT_REPORT', r.id, { note });
      return { ok: true };
    },
    approveReport(ctx, { id, mode = 'NEW', shape, geom, type, part, target_damage_id, note }) {
      need(ctx, 'ADMIN');
      const r = store.get('reports', id) ?? fail(404, '신고를 찾을 수 없습니다.');
      if (!OPEN_REPORT_STATUSES.includes(r.status)) fail(400, '이미 처리된 신고입니다.');
      const photoIds = [...photosOf('report', r.id).map((p) => p.id)];
      return store.tx(() => {
        let damageId;
        if (mode === 'MERGE') {
          const d = store.get('damages', target_damage_id);
          if (!d || d.sensor_id !== r.sensor_id) fail(400, '합칠 기존 파손을 골라 주세요.');
          if (d.status !== 'ACTIVE') fail(400, '수리완료·종료된 파손에는 합칠 수 없습니다. 먼저 현존으로 되돌리거나 새 파손으로 승인하세요.');
          const ev = { id: uid('E'), damage_id: d.id, sensor_id: d.sensor_id, at: r.found_at, by: ctx.user.id, before: null, after: null,
            note: note || `신고 ${r.id} 합침`, photo_ids: photoIds, created_at: now(), type: 'RECONFIRMED' };
          if (geom) {
            checkGeom(shape ?? d.shape, geom);
            const next = { ...pickSnap(d), shape: shape ?? d.shape, geom };
            next.size_mm = measure(next.shape, geom);
            ev.before = pickSnap(d);
            ev.after = geomPart(next);
            ev.type = 'CHANGED';
          }
          store.insert('damage_events', ev);
          if (ev.after) store.update('damages', d.id, replay(store.get('damages', d.id), null));
          damageId = d.id;
        } else {
          const t = type ?? r.type;
          checkType(t);
          checkGeom(shape, geom);
          damageId = createDamageInternal(ctx, {
            sensor_id: r.sensor_id, type: t, part: part ?? r.part, shape, geom, found_at: r.found_at, memo: note || r.memo,
            origin_report_id: r.id, photo_ids: photoIds,
          });
        }
        store.update('reports', r.id, { status: 'APPROVED', damage_id: damageId, reviewer_id: ctx.user.id, reviewed_at: now(), review_note: note ?? null, updated_at: now() });
        audit(ctx, 'APPROVE_REPORT', r.id, { mode, damage_id: damageId });
        return { damage_id: damageId };
      });
    },

    // 계정
    listUsers(ctx) {
      need(ctx, 'SYSADMIN');
      return store.all('users').map(publicUser).sort((a, b) => (a.login < b.login ? -1 : 1));
    },
    createUser(ctx, { login, name, team, role, password }) {
      need(ctx, 'SYSADMIN');
      const l = String(login ?? '').trim();
      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(l)) fail(400, '아이디는 영문·숫자 3~30자로 입력해 주세요.');
      if (store.all('users').some((u) => u.login === l)) fail(409, '이미 있는 아이디입니다.');
      if (!isRole(role)) fail(400, '역할을 골라 주세요.');
      if (String(password ?? '').length < 6) fail(400, '임시 비밀번호는 6자 이상이어야 합니다.');
      if (!String(name ?? '').trim()) fail(400, '이름을 입력해 주세요.');
      const id = uid('U');
      store.insert('users', { id, login: l, name, team: team ?? '', role, password_hash: hashPassword(String(password)), active: 1, must_change_pw: 1, created_at: now() });
      audit(ctx, 'CREATE_USER', id, { login: l, role });
      return { id };
    },
    updateUser(ctx, { id, name, team, role, active, password }) {
      need(ctx, 'SYSADMIN');
      const u = store.get('users', id) ?? fail(404, '계정을 찾을 수 없습니다.');
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (team !== undefined) patch.team = team;
      if (role !== undefined) {
        if (!isRole(role)) fail(400, '역할이 올바르지 않습니다.');
        patch.role = role;
      }
      if (active !== undefined) patch.active = active ? 1 : 0;
      if (password) {
        if (String(password).length < 6) fail(400, '비밀번호는 6자 이상이어야 합니다.');
        patch.password_hash = hashPassword(String(password));
        patch.must_change_pw = 1;
      }
      const nextRole = patch.role ?? u.role;
      const nextActive = patch.active ?? u.active;
      if (u.role === 'SYSADMIN' && (nextRole !== 'SYSADMIN' || !nextActive)) {
        const others = store.all('users').filter((x) => x.id !== u.id && x.role === 'SYSADMIN' && x.active);
        if (!others.length) fail(400, '마지막 시스템 관리자는 바꿀 수 없습니다.');
      }
      store.update('users', u.id, patch);
      audit(ctx, 'UPDATE_USER', u.id, { ...patch, password_hash: patch.password_hash ? '(변경)' : undefined });
      return { ok: true };
    },
    listAudit(ctx, { limit = 200 } = {}) {
      need(ctx, 'SYSADMIN');
      return store.all('audit_log').sort(byDateDesc('at')).slice(0, Number(limit) || 200)
        .map((a) => ({ ...a, user_name: a.user_id ? userName(a.user_id) : '-' }));
    },
  };
  return api;
}
