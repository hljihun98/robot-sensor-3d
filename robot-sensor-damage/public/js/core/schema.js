// 테이블 정의 — 서버는 이 정의로 SQLite 테이블을 만든다(브라우저 데모는 같은 구조를 메모리에 둔다).
// 타입: text | int | real | json(JSON 문자열로 저장)

export const SCHEMA = {
  users: {
    id: 'text', login: 'text', name: 'text', team: 'text', role: 'text', password_hash: 'text',
    active: 'int', must_change_pw: 'int', created_at: 'text',
  },
  sessions: { id: 'text', user_id: 'text', expires_at: 'text', created_at: 'text' },
  robots: {
    id: 'text', no: 'int', site: 'text', lidar_shape: 'text', status: 'text',
    disposed_at: 'text', dispose_reason: 'text', memo: 'text', created_at: 'text',
  },
  sensors: { id: 'text', serial: 'text', model_id: 'text', status: 'text', memo: 'text', created_at: 'text' },
  mounts: {
    id: 'text', robot_id: 'text', sensor_id: 'text', slot: 'text', yaw_deg: 'real',
    mounted_at: 'text', unmounted_at: 'text',
  },
  reports: {
    id: 'text', sensor_id: 'text', robot_id: 'text', slot: 'text', reporter_id: 'text', kind: 'text',
    target_damage_id: 'text', point: 'json', normal: 'json', part: 'text', type: 'text', found_at: 'text',
    memo: 'text', status: 'text', reviewer_id: 'text', reviewed_at: 'text', review_note: 'text',
    damage_id: 'text', thread: 'json', created_at: 'text', updated_at: 'text',
  },
  damages: {
    id: 'text', sensor_id: 'text', type: 'text', part: 'text', shape: 'text', geom: 'json', size_mm: 'real',
    found_at: 'text', occurred_from: 'text', confirmed_at: 'text', confirmed_by: 'text', status: 'text',
    resolved_at: 'text', severity: 'text', memo: 'text', origin_report_id: 'text', created_at: 'text',
  },
  damage_events: {
    id: 'text', damage_id: 'text', sensor_id: 'text', type: 'text', at: 'text', by: 'text',
    before: 'json', after: 'json', note: 'text', photo_ids: 'json', created_at: 'text',
  },
  inspections: {
    id: 'text', sensor_id: 'text', robot_id: 'text', date: 'text', by: 'text', result: 'text', note: 'text',
    created_at: 'text',
  },
  photos: { id: 'text', owner_type: 'text', owner_id: 'text', src: 'text', thumb: 'text', by: 'text', created_at: 'text' },
  audit_log: { id: 'text', at: 'text', user_id: 'text', action: 'text', target: 'text', detail: 'json' },
};

export const TABLES = Object.keys(SCHEMA);
