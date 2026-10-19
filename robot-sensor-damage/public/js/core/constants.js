// 공통 상수 — 브라우저와 서버(Node.js)가 같이 사용한다. 브라우저 전용 API를 쓰지 말 것.

export const ROLES = {
  FIELD: { label: '현장 사용자', level: 1 },
  ADMIN: { label: '관리자', level: 2 },
  SYSADMIN: { label: '시스템 관리자', level: 3 },
};

export const SLOTS = [
  { code: 'LIDAR_1', label: '라이다 #1', kind: 'LIDAR' },
  { code: 'LIDAR_2', label: '라이다 #2', kind: 'LIDAR' },
  { code: 'CAM_1', label: '카메라 #1', kind: 'CAMERA' },
  { code: 'CAM_2', label: '카메라 #2', kind: 'CAMERA' },
];
export const slotLabel = (code) => SLOTS.find((s) => s.code === code)?.label ?? code;

export const LIDAR_SHAPES = {
  CYLINDER: { label: '원통형', model: 'LIDAR_CYL' },
  DOME: { label: '반구형', model: 'LIDAR_MID360' },
};

// 라이다 형상 기본 규칙: 16호기까지 원통형, 17호기부터 반구형 (호기별로 바꿀 수 있음)
export const CYLINDER_LAST_NO = 16;
export const defaultLidarShape = (no) => (Number(no) <= CYLINDER_LAST_NO ? 'CYLINDER' : 'DOME');

export const CAMERA_MODEL = 'CAM_D405';
export const modelForSlot = (slot, lidarShape) =>
  slot.startsWith('LIDAR') ? LIDAR_SHAPES[lidarShape]?.model ?? 'LIDAR_MID360' : CAMERA_MODEL;

// 파손 유형 — 색은 화면 표시용
export const DAMAGE_TYPES = {
  SCRATCH: { label: '기스(긁힘)', short: '기스', shape: 'LINE', color: '#e8590c' },
  DENT: { label: '찍힘', short: '찍힘', shape: 'CIRCLE', color: '#7048e8' },
  CRACK: { label: '크랙', short: '크랙', shape: 'LINE', color: '#e03131' },
  CHIP: { label: '깨짐(결손)', short: '깨짐', shape: 'AREA', color: '#c2255c' },
  COATING: { label: '코팅 손상·오염', short: '코팅', shape: 'AREA', color: '#2f9e44' },
  DEFORM: { label: '변형', short: '변형', shape: 'AREA', color: '#1971c2' },
  ETC: { label: '기타', short: '기타', shape: 'CIRCLE', color: '#868e96' },
};

export const SHAPES = {
  POINT: '점',
  LINE: '선',
  CIRCLE: '원',
  AREA: '영역',
};

export const REPORT_STATUS = {
  SUBMITTED: { label: '제출', tone: 'info' },
  IN_REVIEW: { label: '검토중', tone: 'warn' },
  NEED_INFO: { label: '보완요청', tone: 'warn' },
  APPROVED: { label: '승인', tone: 'good' },
  REJECTED: { label: '반려', tone: 'muted' },
};
export const OPEN_REPORT_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'NEED_INFO'];

export const DAMAGE_STATUS = {
  ACTIVE: { label: '현존', tone: 'warn' },
  REPAIRED: { label: '수리완료', tone: 'good' },
  CLOSED: { label: '종료', tone: 'muted' },
};

export const EVENT_TYPES = {
  CONFIRMED: '파손 확인',
  CHANGED: '변화 확인',
  RECONFIRMED: '재확인',
  CORRECTED: '정정',
  REPAIRED: '수리완료',
  CLOSED: '종료',
  INSPECTION: '점검',
  MOUNTED: '장착',
  UNMOUNTED: '탈착',
};

export const ROBOT_STATUS = {
  ACTIVE: '운영',
  DISPOSED: '폐기',
};

export const SENSOR_STATUS = {
  MOUNTED: '장착',
  SPARE: '예비',
  DISPOSED: '폐기',
};

export const NEW_DAYS = 30; // 이 기간 안에 확인된 파손은 "신규" 표시
export const DUPLICATE_MM = 5; // 기존 파손과 이 거리 안이면 중복 후보
