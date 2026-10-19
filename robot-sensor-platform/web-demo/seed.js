// 웹 데모 예시 데이터 — 실제 API(신고 → 승인 → 변화·수리)를 그대로 불러 만든다.
// 날짜는 만든 날 기준 며칠 전으로 맞추고, 3D 좌표는 센서로그의 단순 모델 표면 위에 둔다.
import bcrypt from 'bcryptjs';
import { createJar, readFileAsync } from './shims/storage.js';

const DAY = 864e5;
const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
const daysAgo = (n) => kst.format(new Date(Date.now() - n * DAY));
const at = (date, hour = 10) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString();
const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const rad = (deg) => (deg * Math.PI) / 180;

// 센서로그 단순 모델 치수(public/js/viewer3d.js)와 같게
const dome = (theta, phi) => {
  const d = [-Math.sin(rad(phi)) * Math.sin(rad(theta)), Math.cos(rad(phi)), Math.sin(rad(phi)) * Math.cos(rad(theta))];
  return { p: [r(d[0] * 31), r(d[1] * 31 - 1), r(d[2] * 31)], n: d.map((v) => r(v, 4)) };
};
const cylinder = (theta, y) => {
  const d = [-Math.sin(rad(theta)), 0, Math.cos(rad(theta))];
  return { p: [r(d[0] * 38), r(y), r(d[2] * 38)], n: d.map((v) => r(v, 4)) };
};
const along = (fn, [a0, a1], [b0, b1], steps) => Array.from({ length: steps + 1 }, (_, i) => fn(a0 + ((b0 - a0) * i) / steps, a1 + ((b1 - a1) * i) / steps));
const ring = (fn, corners) => corners.map(([a, b]) => fn(a, b));
const flat = (pts, normal) => pts.map((p) => ({ p, n: normal }));

const COLORS = { SCRATCH: '#e4a12c', DENT: '#438bca', CRACK: '#dc5860', COATING: '#3d9c88' };

async function photo(label, color) {
  const c = new OffscreenCanvas(800, 600);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 600);
  bg.addColorStop(0, '#d9dfdc');
  bg.addColorStop(1, '#b7c2bd');
  g.fillStyle = bg;
  g.fillRect(0, 0, 800, 600);
  g.fillStyle = '#2f3d38';
  g.beginPath();
  g.arc(400, 280, 170, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(320, 230);
  g.lineTo(470, 320);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(0, 520, 800, 80);
  g.fillStyle = '#243b33';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 400, 572);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}

export async function seedDemo({ app, store }, { base, origin }) {
  const { run } = store;

  // 계정: 기본 관리자(admin)를 sysadmin으로 바꾸고 예시 계정 두 개를 더한다
  run("UPDATE users SET username='sysadmin', name='시스템 관리자(예시)', department='플랫폼', must_change=0 WHERE username='admin'");
  const addUser = (u, name, dept, role, pw) => run('INSERT INTO users(username,name,department,role,password_hash,must_change) VALUES(?,?,?,?,?,0)', u, name, dept, role, bcrypt.hashSync(pw, 12));
  addUser('admin', '관리자(예시)', '품질', 'ADMIN', 'admin1234');
  addUser('field', '현장 사용자(예시)', '현장 운영', 'FIELD', 'field1234');

  const client = async (username, password) => {
    const jar = createJar();
    let csrf = '';
    const call = async (method, path, body) => {
      const init = { method, headers: { 'x-csrf-token': csrf } };
      if (body instanceof FormData) init.body = body;
      else if (body) {
        init.body = JSON.stringify(body);
        init.headers['content-type'] = 'application/json';
      }
      const res = await app.handle(new Request(`${origin}${base}${path}`, init), { path, jar, readFile: readFileAsync });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error ?? ''}`);
      return data;
    };
    csrf = (await call('POST', '/api/auth/login', { username, password })).csrf;
    return call;
  };
  const admin = await client('admin', 'admin1234');
  const field = await client('field', 'field1234');

  const sensor = async (no, slot) => (await admin('GET', `/api/robots/${no}`)).sensors.find((s) => s.slot === slot).id;
  const form = async (fields, photos, color) => {
    const f = new FormData();
    Object.entries(fields).forEach(([k, v]) => f.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
    for (const [i, label] of photos.entries()) f.append('photos', await photo(label, color), `photo-${i + 1}.jpg`);
    return f;
  };
  const payload = (type, part, shape, pts, found, note, size) => ({
    type, part, shape, points_mm: pts.map((x) => x.p), normal: pts[0].n, found_at: found, note, ...(size ? { size_mm: size } : {}),
  });
  const inspect = async (sid, daysBack, note) => {
    await field('POST', `/api/sensors/${sid}/inspections`, { note });
    run('UPDATE inspections SET at=? WHERE id=(SELECT max(id) FROM inspections)', at(daysAgo(daysBack), 9));
  };
  // 신고(현장) → 승인(관리자), 날짜를 발견일 무렵으로 맞춤
  const reportAndApprove = async (sid, p) => {
    const { id } = await field('POST', '/api/reports', await form({ sensor_id: String(sid), payload: p }, ['전체(예시)', '근접(예시)'], COLORS[p.type]));
    run('UPDATE reports SET created_at=?, updated_at=? WHERE id=?', at(p.found_at, 9), at(p.found_at, 9), id);
    const damageId = (await admin('POST', `/api/reports/${id}/approve`, {})).id;
    const t = at(p.found_at, 14);
    run("UPDATE damage_events SET at=? WHERE damage_id=? AND kind='CONFIRMED'", t, damageId);
    run("UPDATE damage_events SET after_json=json_set(after_json,'$.confirmed_at',?) WHERE damage_id=?", t, damageId);
    run("UPDATE damages SET snapshot=json_set(snapshot,'$.confirmed_at',?) WHERE id=?", t, damageId);
    run('UPDATE reports SET updated_at=? WHERE id=?', t, id);
    return damageId;
  };
  const change = async (damageId, action, daysBack, reason, extra = {}, color = '#3d9c88') => {
    await admin('PATCH', `/api/damages/${damageId}`, await form({ action, reason, ...extra }, [action === 'REPAIRED' ? '수리 후(예시)' : '변화(예시)'], color));
    const t = at(daysAgo(daysBack), 15);
    run('UPDATE damage_events SET at=? WHERE id=(SELECT max(id) FROM damage_events WHERE damage_id=?)', t, damageId);
    if (action === 'REPAIRED') {
      run("UPDATE damages SET snapshot=json_set(snapshot,'$.closed_at',?) WHERE id=?", t, damageId);
      run("UPDATE damage_events SET after_json=json_set(after_json,'$.closed_at',?) WHERE id=(SELECT max(id) FROM damage_events WHERE damage_id=?)", t, damageId);
    }
  };

  // 18호기 — 반구형 라이다(Mid-360) 4건, 실물 시리얼 확인된 호기
  run("UPDATE robots SET site='예시 사이트 A' WHERE no IN (18,19,20)");
  run("UPDATE robots SET site='예시 사이트 B' WHERE no IN (6,7,8)");
  const s18 = await sensor(18, 'LIDAR_1');
  [['LIDAR_1', 'MID360-DEMO-0181', '전방 상단'], ['LIDAR_2', 'MID360-DEMO-0182', '후방 상단'], ['CAM_1', 'D405-DEMO-0183', '전방 좌측'], ['CAM_2', 'D405-DEMO-0184', '전방 우측']]
    .forEach(([slot, serial, position]) => {
      run('UPDATE sensors SET serial=?, verified=1 WHERE id=(SELECT sensor_id FROM mounts WHERE robot_no=18 AND slot=? AND unmounted_at IS NULL)', serial, slot);
      run('UPDATE mounts SET position=? WHERE robot_no=18 AND slot=? AND unmounted_at IS NULL', position, slot);
    });
  await inspect(s18, 130, '정기 점검(예시)');
  const repaired = await reportAndApprove(s18, payload('SCRATCH', 'window', 'LINE', along(dome, [150, 58], [165, 64], 4), daysAgo(115), '창 아래쪽 가는 긁힘(예시)'));
  await change(repaired, 'REPAIRED', 85, '창 연마 후 정상(예시)', {}, COLORS.SCRATCH);
  const coating = await reportAndApprove(s18, payload('COATING', 'window', 'AREA', ring(dome, [[300, 24], [318, 24], [318, 34], [300, 34]]), daysAgo(100), '창 일부 코팅 오염(예시)'));
  await change(coating, 'CHANGED', 32, '오염 범위가 넓어짐(예시)', {
    payload: payload('COATING', 'window', 'AREA', ring(dome, [[294, 20], [326, 20], [326, 38], [294, 38]]), daysAgo(100), '창 일부 코팅 오염 · 범위 커짐(예시)'),
  });
  await reportAndApprove(s18, payload('DENT', 'body', 'CIRCLE', flat([[-12, -15, 32.5]], [0, 0, 1]), daysAgo(60), '몸체 앞면 찍힘(예시)', 6));
  await inspect(s18, 45, '정기 점검(예시)');
  await reportAndApprove(s18, payload('SCRATCH', 'window', 'LINE', along(dome, [35, 40], [55, 52], 4), daysAgo(12), '창 정면 오른쪽 긁힘(예시)'));

  // 8호기 — 원통형 라이다 2건
  const s8 = await sensor(8, 'LIDAR_1');
  await reportAndApprove(s8, payload('SCRATCH', 'window', 'LINE', along(cylinder, [200, 4], [232, 12], 5), daysAgo(36), '뒤쪽 창 긁힘(예시)'));
  await reportAndApprove(s8, payload('CRACK', 'window', 'LINE', along(cylinder, [12, -4], [16, 16], 4), daysAgo(8), '정면 오른쪽 세로 크랙(예시)'));

  // 20호기 — 카메라(D405) 왼쪽 렌즈 1건
  const s20 = await sensor(20, 'CAM_1');
  await reportAndApprove(s20, payload('SCRATCH', 'lens_left', 'LINE', flat([[-13, 1, 15], [-11, 2.5, 15], [-9, 4, 15]], [0, 0, 1]), daysAgo(15), '왼쪽 렌즈 긁힘(예시)'));

  // 검토 대기 신고와 보완 요청 신고 — 관리자·현장 화면에서 흐름을 볼 수 있게
  const s18b = await sensor(18, 'LIDAR_2');
  const waiting = await field('POST', '/api/reports', await form({ sensor_id: String(s18b), payload: payload('SCRATCH', 'window', 'POINT', [dome(90, 55)], daysAgo(1), '오른쪽 창에 가는 긁힘(예시 신고)') }, ['전체(예시)', '근접(예시)'], COLORS.SCRATCH));
  run('UPDATE reports SET created_at=?, updated_at=? WHERE id=?', at(daysAgo(1), 16), at(daysAgo(1), 16), waiting.id);
  const s20b = await sensor(20, 'CAM_2');
  const info = await field('POST', '/api/reports', await form({ sensor_id: String(s20b), payload: payload('COATING', 'cover', 'POINT', flat([[6, -8, 12.5]], [0, 0, 1]), daysAgo(4), '앞면 커버 얼룩(예시 신고)') }, ['전체(예시)', '근접(예시)'], COLORS.COATING));
  await admin('POST', `/api/reports/${info.id}/request-info`, { reason: '얼룩인지 긁힘인지 구분되도록 가까이에서 한 장 더 찍어 주세요.(예시)' });
}
