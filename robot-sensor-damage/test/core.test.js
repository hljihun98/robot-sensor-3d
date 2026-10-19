// 업무 로직 테스트 — `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../public/js/core/memoryStore.js';
import { createService } from '../public/js/core/service.js';
import { buildSeed } from '../public/js/core/seed.js';
import { defaultLidarShape } from '../public/js/core/constants.js';

function setup(today = '2026-10-20') {
  let n = 0;
  const deps = {
    now: () => `${today}T09:00:00.000Z`, today: () => today, uid: (p) => `${p}${(n += 1)}`,
    hashPassword: (p) => `h:${p}`, verifyPassword: (p, h) => h === `h:${p}`, savePhoto: ({ full, thumb }) => ({ src: full, thumb }),
  };
  const store = createMemoryStore(buildSeed({ withSamples: true, hashPassword: deps.hashPassword, now: deps.now }));
  const svc = createService(store, deps);
  const as = (login, pw) => ({ user: svc.login({}, { login, password: pw }) });
  return { svc, store, field: as('field', 'field1234'), admin: as('admin', 'admin1234'), sys: as('sysadmin', 'sys1234') };
}
const photo = [{ full: 'data:image/jpeg;base64,AA==', thumb: 'data:image/jpeg;base64,AA==' }];

test('라이다 형상 규칙: 16호기까지 원통형, 17호기부터 반구형', () => {
  assert.equal(defaultLidarShape(16), 'CYLINDER');
  assert.equal(defaultLidarShape(17), 'DOME');
  const { svc, field } = setup();
  assert.equal(svc.getRobot(field, { no: 16 }).robot.lidar_shape, 'CYLINDER');
  assert.equal(svc.getRobot(field, { no: 17 }).slots[0].sensor.model_id, 'LIDAR_MID360');
  assert.equal(svc.getRobot(field, { no: 6 }).slots[2].sensor.model_id, 'CAM_D405');
});

test('운영 25대, 폐기 5대(1~5호기)', () => {
  const { svc, field } = setup();
  assert.equal(svc.listRobots(field, { status: 'ACTIVE' }).length, 25);
  assert.deepEqual(svc.listRobots(field, { status: 'DISPOSED' }).map((r) => r.no), [1, 2, 3, 4, 5]);
});

test('신고 → 승인 → 모두에게 공개, 발생 기간은 마지막 점검일부터', () => {
  const { svc, field, admin } = setup();
  const sid = svc.getRobot(field, { no: 18 }).slots[0].sensor.id;
  const { id } = svc.createReport(field, { sensor_id: sid, point: [0, 29, 5], part: 'window', type: 'DENT', found_at: '2026-10-20', photos: photo });
  assert.equal(svc.getSensorView(field, { id: sid }).reports.length, 1, '신고자는 자기 신고를 본다');
  const before = svc.getSensorView(admin, { id: sid }).damages.length;
  const r = svc.approveReport(admin, { id, mode: 'NEW', shape: 'POINT', geom: { points: [[0, 29, 5]], normal: [0, 1, 0], path: [[0, 29, 5]] } });
  const d = svc.getDamage(field, { id: r.damage_id });
  assert.equal(d.occurred_from, '2026-10-02');
  assert.equal(svc.getSensorView(field, { id: sid }).damages.length, before + 1);
});

test('현장 사용자는 승인·호기 관리를 할 수 없다', () => {
  const { svc, field } = setup();
  assert.throws(() => svc.approveReport(field, { id: 'RP-2026-0001' }), /관리자 권한/);
  assert.throws(() => svc.disposeRobot(field, { no: 6, date: '2026-10-20', reason: 'x' }), /관리자 권한/);
});

test('날짜 기준 보기: 그때 있던 파손과 그때 크기', () => {
  const { svc, field } = setup();
  const sid = svc.getRobot(field, { no: 18 }).slots[0].sensor.id;
  const july = svc.getSensorView(field, { id: sid, at: '2026-07-01' }).damages;
  assert.equal(july.length, 1);
  const now = svc.getSensorView(field, { id: sid }).damages.find((x) => x.id === july[0].id);
  assert.ok(now.size_mm > july[0].size_mm, '9월에 범위가 커진 기록이 반영된다');
});

test('폐기: 기록은 남고, 회수한 센서는 이력을 가지고 다른 호기로 간다', () => {
  const { svc, admin } = setup();
  const s8 = svc.getRobot(admin, { no: 8 }).slots[0].sensor.id;
  svc.disposeRobot(admin, { no: 8, date: '2026-10-20', reason: '테스트', sensorActions: { LIDAR_1: 'SPARE' } });
  assert.equal(svc.getRobot(admin, { no: 8 }).robot.status, 'DISPOSED');
  svc.replaceSensor(admin, { no: 9, slot: 'LIDAR_1', new_sensor_id: s8, old_action: 'SPARE', date: '2026-10-20' });
  const v = svc.getSensorView(admin, { id: s8 });
  assert.equal(v.sensor.robot_no, 9);
  assert.equal(v.damages.filter((d) => d.status === 'ACTIVE').length, 2);
  assert.throws(() => svc.createRobot(admin, { no: 8 }), /다시 쓰지 않습니다/);
});

test('중복 후보: 5mm 안의 기존 파손', () => {
  const { svc, field } = setup();
  const sid = svc.getRobot(field, { no: 18 }).slots[0].sensor.id;
  const d = svc.getSensorView(field, { id: sid }).damages.find((x) => x.type === 'DENT');
  const p = d.geom.path[0];
  assert.equal(svc.duplicateCandidates(field, { sensor_id: sid, point: [p[0] + 1, p[1], p[2]] })[0].id, d.id);
  assert.equal(svc.duplicateCandidates(field, { sensor_id: sid, point: [p[0] + 40, p[1], p[2]] }).length, 0);
});

test('트랜잭션: 실패하면 아무것도 바뀌지 않는다', () => {
  const { svc, admin } = setup();
  assert.throws(() => svc.createRobot(admin, { no: 40, serials: { LIDAR_1: 'TMP-018-L1' } }));
  assert.equal(svc.listRobots(admin, { status: 'ALL' }).some((r) => r.no === 40), false);
});

test('정정은 과거 모습의 크기를 바꾸지 않고, 늦게 입력한 과거 날짜 변화가 최신 변화를 덮지 않는다', () => {
  const { svc, field, admin } = setup();
  const sid = svc.getRobot(field, { no: 18 }).slots[0].sensor.id;
  const coating = svc.getSensorView(field, { id: sid, at: '2026-07-01' }).damages[0];
  svc.updateDamage(admin, { id: coating.id, action: 'CORRECT', note: '유형 정정', patch: { type: 'CHIP' } });
  const july = svc.getSensorView(field, { id: sid, at: '2026-07-01' }).damages[0];
  assert.equal(july.size_mm, coating.size_mm);
  assert.equal(july.type, 'CHIP');
  // 8호기 기스: 10-15 변화(길게) 입력 후 10-01 변화(짧게)를 나중에 입력
  const s8 = svc.getRobot(admin, { no: 8 }).slots[0].sensor.id;
  const d = svc.getSensorView(admin, { id: s8 }).damages.find((x) => x.type === 'SCRATCH');
  const long = { points: [[0, 0, 50.5], [-30, 0, 41]], normal: [0, 0, 1], path: [[0, 0, 50.5], [-15, 0, 48], [-30, 0, 41]] };
  const short = { points: [[0, 0, 50.5], [-5, 0, 50]], normal: [0, 0, 1], path: [[0, 0, 50.5], [-5, 0, 50]] };
  svc.updateDamage(admin, { id: d.id, action: 'CHANGE', date: '2026-10-15', patch: { shape: 'LINE', geom: long } });
  svc.updateDamage(admin, { id: d.id, action: 'CHANGE', date: '2026-10-01', patch: { shape: 'LINE', geom: short } });
  const cur = svc.getDamage(admin, { id: d.id });
  assert.ok(cur.size_mm > 30, `현재 크기는 10-15 변화 기준이어야 함 (${cur.size_mm})`);
  const oct5 = svc.getSensorView(admin, { id: s8, at: '2026-10-05' }).damages.find((x) => x.id === d.id);
  assert.ok(oct5.size_mm < 6);
});

test('다른 호기에 달린 센서는 호기 삭제 때 예비로 바뀌지 않는다', () => {
  const { svc, admin, sys } = setup();
  const s8 = svc.getRobot(admin, { no: 8 }).slots[0].sensor.id;
  svc.disposeRobot(admin, { no: 8, date: '2026-10-20', reason: 'x', sensorActions: { LIDAR_1: 'SPARE' } });
  svc.replaceSensor(admin, { no: 9, slot: 'LIDAR_1', new_sensor_id: s8, old_action: 'SPARE', date: '2026-10-20' });
  svc.deleteRobot(sys, { no: 8 });
  assert.equal(svc.getSensor(admin, { id: s8 }).status, 'MOUNTED');
  assert.equal(svc.listSpareSensors(admin, {}).some((s) => s.id === s8), false);
});

test('검증: 수리완료 파손에 합치기 금지, 이상한 역할·면 방향 거부, 카메라 슬롯에 라이다 금지', () => {
  const { svc, field, admin, sys } = setup();
  const sid = svc.getRobot(field, { no: 18 }).slots[0].sensor.id;
  const dent = svc.getSensorView(field, { id: sid }).damages.find((x) => x.type === 'DENT');
  const { id } = svc.createReport(field, { sensor_id: sid, kind: 'CHANGE', target_damage_id: dent.id, point: dent.geom.path[0], type: 'DENT', found_at: '2026-10-20', photos: photo });
  svc.updateDamage(admin, { id: dent.id, action: 'REPAIR', date: '2026-10-20' });
  assert.throws(() => svc.approveReport(admin, { id, mode: 'MERGE', target_damage_id: dent.id }), /합칠 수 없습니다/);
  assert.throws(() => svc.createUser(sys, { login: 'xx1', name: 'x', role: 'constructor', password: 'abcdef' }), /역할/);
  assert.throws(() => svc.createReport(field, { sensor_id: sid, point: [0, 29, 5], normal: 'x', type: 'DENT', found_at: '2026-10-20', photos: photo }), /면 방향/);
  const spare = svc.getRobot(admin, { no: 6 }).slots[0].sensor;
  svc.disposeRobot(admin, { no: 6, date: '2026-10-20', reason: 'x', sensorActions: { LIDAR_1: 'SPARE' } });
  assert.throws(() => svc.createRobot(admin, { no: 31, serials: { CAM_1: spare.serial } }), /달 수 없는 종류/);
  assert.throws(() => svc.updateDamage(admin, { id: dent.id, action: 'REOPEN' }), /사유/);
});
