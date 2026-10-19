// 초기 데이터 — 1~30호기, 1~5호기 폐기, 16호기까지 원통형·17호기부터 반구형, 카메라 D405 2개
// withSamples=true 이면 화면 확인용 예시 파손·신고·계정이 함께 들어간다(데모 모드 기본).

import { SLOTS, defaultLidarShape, modelForSlot } from './constants.js';
import { cylinderWindowPoint, domeWindowPoint } from './sensorModels.js';
import { circleSamples, measure, roundVec } from './geometry.js';

const pad = (n, w = 3) => String(n).padStart(w, '0');
export const robotId = (no) => `R${pad(no)}`;
const slotShort = { LIDAR_1: 'L1', LIDAR_2: 'L2', CAM_1: 'C1', CAM_2: 'C2' };

export const DEMO_ACCOUNTS = [
  { login: 'field', password: 'field1234', name: '현장 사용자(예시)', team: '현장 운영', role: 'FIELD' },
  { login: 'admin', password: 'admin1234', name: '관리자(예시)', team: '품질', role: 'ADMIN' },
  { login: 'sysadmin', password: 'sys1234', name: '시스템 관리자(예시)', team: '플랫폼', role: 'SYSADMIN' },
];

function placeholderPhoto(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#dee2e6"/><circle cx="320" cy="230" r="120" fill="#adb5bd"/><path d="M250 210 L390 260" stroke="${color}" stroke-width="10" stroke-linecap="round"/><text x="320" y="420" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#495057">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const lerp = (a, b, t) => a + (b - a) * t;

function domeLine(t0, f0, t1, f1, n = 12) {
  const path = [];
  for (let i = 0; i <= n; i++) path.push(domeWindowPoint(lerp(t0, t1, i / n), lerp(f0, f1, i / n)).p);
  return path;
}
function domePolygon(corners, n = 8) {
  const path = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let k = 0; k < n; k++) path.push(domeWindowPoint(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)).p);
  }
  path.push(path[0]);
  return path;
}
function cylLine(t0, y0, t1, y1, n = 14) {
  const path = [];
  for (let i = 0; i <= n; i++) path.push(cylinderWindowPoint(lerp(t0, t1, i / n), lerp(y0, y1, i / n)).p);
  return path;
}

function geomOf(shape, path, extra = {}) {
  const r = { points: [path[0], path[path.length - 1]], normal: extra.normal ?? [0, 0, 1], path: path.map((p) => roundVec(p)) };
  if (extra.radius) r.radius = extra.radius;
  if (extra.points) r.points = extra.points;
  return r;
}

export function buildSeed({ withSamples = true, hashPassword, now, sysadminPassword = 'sys1234' }) {
  const ts = now();
  const db = {
    users: [], sessions: [], robots: [], sensors: [], mounts: [], reports: [], damages: [],
    damage_events: [], inspections: [], photos: [], audit_log: [],
  };

  const accounts = withSamples
    ? DEMO_ACCOUNTS
    : [{ login: 'sysadmin', password: sysadminPassword, name: '시스템 관리자', team: '', role: 'SYSADMIN' }];
  accounts.forEach((a, i) => {
    db.users.push({
      id: `U${pad(i + 1, 4)}`, login: a.login, name: a.name, team: a.team, role: a.role,
      password_hash: hashPassword(a.password), active: 1, must_change_pw: withSamples ? 0 : 1, created_at: ts,
    });
  });

  let sensorSeq = 0;
  for (let no = 1; no <= 30; no++) {
    const disposed = no <= 5;
    const shape = defaultLidarShape(no);
    db.robots.push({
      id: robotId(no), no, site: '미지정', lidar_shape: shape, status: disposed ? 'DISPOSED' : 'ACTIVE',
      disposed_at: disposed ? 'unknown' : null, dispose_reason: disposed ? '분해 후 폐기' : null, memo: null, created_at: ts,
    });
    SLOTS.forEach((s) => {
      sensorSeq += 1;
      const sid = `S${pad(sensorSeq, 4)}`;
      db.sensors.push({
        id: sid, serial: `TMP-${pad(no)}-${slotShort[s.code]}`, model_id: modelForSlot(s.code, shape),
        status: disposed ? 'DISPOSED' : 'MOUNTED', memo: '시리얼 확인 필요(임시 번호)', created_at: ts,
      });
      db.mounts.push({
        id: `M${pad(sensorSeq, 5)}`, robot_id: robotId(no), sensor_id: sid, slot: s.code, yaw_deg: 0,
        mounted_at: 'unknown', unmounted_at: disposed ? 'unknown' : null,
      });
    });
  }

  if (!withSamples) return db;

  // ── 예시 데이터 (데모 확인용) ─────────────────────────────
  const sensorOf = (no, slot) => db.mounts.find((m) => m.robot_id === robotId(no) && m.slot === slot && !m.unmounted_at).sensor_id;
  const admin = db.users.find((u) => u.role === 'ADMIN').id;
  const field = db.users.find((u) => u.role === 'FIELD').id;
  let dseq = 0;
  let eseq = 0;
  let pseq = 0;
  const photo = (ownerType, ownerId, label, color) => {
    pseq += 1;
    const src = placeholderPhoto(label, color);
    const id = `P${pad(pseq, 5)}`;
    db.photos.push({ id, owner_type: ownerType, owner_id: ownerId, src, thumb: src, by: admin, created_at: ts });
    return id;
  };
  const addDamage = ({ sensor, type, part, shape, path, extra, found, from, events = [], status = 'ACTIVE', resolved }) => {
    dseq += 1;
    const id = `D-2026-${pad(dseq, 4)}`;
    const geom = geomOf(shape, path, extra);
    const snap = { type, part, shape, geom, size_mm: measure(shape, geom) };
    db.damages.push({
      id, sensor_id: sensor, ...snap, found_at: found, occurred_from: from ?? null, confirmed_at: `${found}T09:00:00`,
      confirmed_by: admin, status, resolved_at: resolved ?? null, severity: null, memo: '예시 데이터', origin_report_id: null,
      created_at: ts,
    });
    eseq += 1;
    const evId = `E${pad(eseq, 5)}`;
    db.damage_events.push({
      id: evId, damage_id: id, sensor_id: sensor, type: 'CONFIRMED', at: found, by: admin, before: null, after: snap,
      note: '예시 데이터', photo_ids: [], created_at: `${found}T09:00:00`,
    });
    db.damage_events.at(-1).photo_ids = [photo('event', evId, '원거리(예시)', '#e8590c'), photo('event', evId, '근접(예시)', '#e8590c')];
    events.forEach((e) => {
      eseq += 1;
      const g = e.path ? geomOf(shape, e.path, e.extra) : null;
      const after = g ? { ...snap, geom: g, size_mm: measure(shape, g) } : null;
      db.damage_events.push({
        id: `E${pad(eseq, 5)}`, damage_id: id, sensor_id: sensor, type: e.type, at: e.at, by: admin, before: e.path ? snap : null,
        after, note: e.note ?? '', photo_ids: [], created_at: `${e.at}T10:00:00`,
      });
      if (after) Object.assign(db.damages.find((d) => d.id === id), { geom: after.geom, size_mm: after.size_mm });
    });
    return id;
  };

  // 18호기 라이다 #1 (Mid-360)
  const s18 = sensorOf(18, 'LIDAR_1');
  addDamage({ sensor: s18, type: 'SCRATCH', part: 'window', shape: 'LINE', path: domeLine(135, 40, 152, 52), found: '2026-10-15', from: '2026-10-02' });
  const body = circleSamples([-10, -12, 32.5], [0, 0, 1], 3, 28);
  addDamage({ sensor: s18, type: 'DENT', part: 'body', shape: 'CIRCLE', path: body, extra: { radius: 3, normal: [0, 0, 1], points: [[-10, -12, 32.5]] }, found: '2026-08-02', from: '2026-07-20' });
  addDamage({
    sensor: s18, type: 'COATING', part: 'window', shape: 'AREA', path: domePolygon([[300, 22], [318, 22], [318, 32], [300, 32]]), found: '2026-06-11',
    events: [{ type: 'CHANGED', at: '2026-09-05', note: '오염 범위가 넓어짐', path: domePolygon([[296, 18], [330, 18], [330, 36], [296, 36]]) }],
  });
  addDamage({
    sensor: s18, type: 'SCRATCH', part: 'window', shape: 'LINE', path: domeLine(55, 58, 70, 62), found: '2026-05-03', status: 'REPAIRED', resolved: '2026-06-20',
    events: [{ type: 'REPAIRED', at: '2026-06-20', note: '창 연마 후 정상' }],
  });
  [['2026-07-20', 'NO_NEW'], ['2026-10-02', 'NO_NEW']].forEach(([date, result], i) => {
    db.inspections.push({ id: `I${pad(i + 1, 5)}`, sensor_id: s18, robot_id: robotId(18), date, by: field, result, note: '정기 점검(예시)', created_at: `${date}T08:00:00` });
  });

  // 8호기 라이다 #1 (원통형)
  const s8 = sensorOf(8, 'LIDAR_1');
  addDamage({ sensor: s8, type: 'SCRATCH', part: 'window', shape: 'LINE', path: cylLine(200, 2, 232, 6), found: '2026-09-21' });
  addDamage({ sensor: s8, type: 'CRACK', part: 'window', shape: 'LINE', path: cylLine(12, -8, 16, 10, 10), found: '2026-10-10' });

  // 20호기 카메라 #1 (D405)
  const s20 = sensorOf(20, 'CAM_1');
  const lens = [];
  for (let i = 0; i <= 8; i++) lens.push([-11 + i * 0.5, 2 + i * 0.4, 13.5]);
  addDamage({ sensor: s20, type: 'SCRATCH', part: 'lens_left', shape: 'LINE', path: lens, found: '2026-09-30' });

  // 검토 대기 신고 1건 (18호기 라이다 #2)
  const s18b = sensorOf(18, 'LIDAR_2');
  const pt = domeWindowPoint(90, 55);
  db.reports.push({
    id: 'RP-2026-0001', sensor_id: s18b, robot_id: robotId(18), slot: 'LIDAR_2', reporter_id: field, kind: 'NEW',
    target_damage_id: null, point: roundVec(pt.p), normal: roundVec(pt.n, 4), part: 'window', type: 'SCRATCH',
    found_at: '2026-10-18', memo: '오른쪽 창에 가는 긁힘 (예시 신고)', status: 'SUBMITTED', reviewer_id: null, reviewed_at: null,
    review_note: null, damage_id: null, thread: [], created_at: '2026-10-18T14:20:00', updated_at: '2026-10-18T14:20:00',
  });
  photo('report', 'RP-2026-0001', '원거리(예시)', '#e8590c');
  photo('report', 'RP-2026-0001', '근접(예시)', '#e8590c');

  return db;
}
