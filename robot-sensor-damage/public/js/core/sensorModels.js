// 센서 3D 모델 정의 — 단위 mm, 원점 = 센서 중심, 위쪽 = +Y, 정면 = +Z
// 라이다 정면(+Z)은 커넥터 반대쪽, 카메라 정면(+Z)은 렌즈 방향.
// 실제 CAD(GLB)를 구하면 public/models/<id>.glb 로 넣으면 이 단순 모델 대신 쓰인다(부위 이름은 같게).

export const SENSOR_MODELS = {
  LIDAR_CYL: {
    id: 'LIDAR_CYL',
    kind: 'LIDAR',
    shape: 'CYLINDER',
    name: '원통형 라이다 (벨로다인 계열)',
    note: '치수는 VLP-16급 가정치(Ø103 × 72 mm). 정확한 모델명 확인 후 수정',
    dims: { radius: 51.5, windowRadius: 50.5, yMin: -36, baseTop: -20, windowTop: 18, yMax: 36 },
    parts: {
      cap: '상단 캡',
      window: '옆면 창',
      body: '하단 몸체',
      connector: '커넥터',
      bracket: '브라켓',
    },
    focusPart: 'window',
    unwrap: 'CYLINDER',
  },
  LIDAR_MID360: {
    id: 'LIDAR_MID360',
    kind: 'LIDAR',
    shape: 'DOME',
    name: 'Livox Mid-360 (반구형)',
    note: '외형 65 × 65 × 60 mm (제조사 사양)',
    dims: { half: 32.5, yMin: -30, bodyTop: 0, domeRadius: 30, yMax: 30, corner: 6 },
    parts: {
      window: '상단 창(반구)',
      body: '몸체',
      connector: '커넥터',
      bracket: '브라켓',
    },
    focusPart: 'window',
    unwrap: 'DOME',
  },
  CAM_D405: {
    id: 'CAM_D405',
    kind: 'CAMERA',
    shape: null,
    name: 'Intel RealSense D405',
    note: '외형 42 × 42 × 23 mm (제조사 사양)',
    dims: { w: 42, h: 42, d: 23, lensX: 9, lensY: 4, lensR: 4 },
    parts: {
      lens_left: '왼쪽 렌즈',
      lens_right: '오른쪽 렌즈',
      front_cover: '앞면 커버',
      housing: '하우징',
      rear_connector: '뒷면 커넥터',
      bracket: '브라켓',
    },
    focusPart: 'lens_left',
    unwrap: null,
  },
};

export const getModel = (id) => SENSOR_MODELS[id] ?? SENSOR_MODELS.LIDAR_MID360;
export const partLabel = (modelId, part) => getModel(modelId).parts[part] ?? part ?? '-';

const rad = (d) => (d * Math.PI) / 180;

// ── 시드(예시 데이터)용 표면 좌표 계산 ─────────────────────────────
// θ: 위에서 볼 때 정면(+Z)에서 시계 방향 각도
export function cylinderWindowPoint(thetaDeg, y) {
  const r = SENSOR_MODELS.LIDAR_CYL.dims.windowRadius;
  const t = rad(thetaDeg);
  const x = -r * Math.sin(t);
  const z = r * Math.cos(t);
  return { p: [x, y, z], n: [x / r, 0, z / r] };
}

// φ: 꼭대기에서 내려온 각도(0 = 꼭대기, 90 = 적도)
export function domeWindowPoint(thetaDeg, phiDeg) {
  const R = SENSOR_MODELS.LIDAR_MID360.dims.domeRadius;
  const t = rad(thetaDeg);
  const f = rad(phiDeg);
  const x = -R * Math.sin(f) * Math.sin(t);
  const y = R * Math.cos(f);
  const z = R * Math.sin(f) * Math.cos(t);
  return { p: [x, y, z], n: [x / R, y / R, z / R] };
}

export function cameraFrontPoint(x, y) {
  return { p: [x, y, 12.5], n: [0, 0, 1] };
}
