// 좌표 계산 — 단위 mm. 브라우저·서버 공용.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
export const roundVec = (a, d = 2) => a.map((v) => round(v, d));

// 위에서 볼 때 정면(+Z)에서 시계 방향 각도(0~360)
export function azimuthDeg(p) {
  const a = (Math.atan2(-p[0], p[2]) * 180) / Math.PI;
  return (a + 360) % 360;
}

export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(path[i - 1], path[i]);
  return s;
}

function distPointSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, scale(ab, t)));
}

export function distanceToPath(p, path) {
  if (!path?.length) return Infinity;
  if (path.length === 1) return dist(p, path[0]);
  let m = Infinity;
  for (let i = 1; i < path.length; i++) m = Math.min(m, distPointSegment(p, path[i - 1], path[i]));
  return m;
}

export function centroid(path) {
  const c = [0, 0, 0];
  path.forEach((p) => {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  });
  return scale(c, 1 / (path.length || 1));
}

// 파손 크기(mm): 선 = 길이, 원 = 지름, 영역 = 가장 먼 두 점 거리, 점 = 0
export function measure(shape, geom) {
  const path = geom?.path ?? [];
  if (shape === 'LINE') return round(pathLength(path), 1);
  if (shape === 'CIRCLE') return round((geom.radius ?? 0) * 2, 1);
  if (shape === 'AREA') {
    let m = 0;
    for (let i = 0; i < path.length; i++) for (let j = i + 1; j < path.length; j++) m = Math.max(m, dist(path[i], path[j]));
    return round(m, 1);
  }
  return 0;
}

// 원을 표면 접평면 위에서 샘플링(표면에 붙이기는 3D 뷰어가 담당)
export function circleSamples(center, normal, radius, n = 32) {
  const nn = norm(normal);
  const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(nn, ref));
  const v = cross(nn, u);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push(add(center, add(scale(u, Math.cos(t) * radius), scale(v, Math.sin(t) * radius))));
  }
  return pts;
}

// 두 점 사이를 촘촘히 나눔(표면에 붙이기 전 단계)
export function densify(points, stepMm = 1.5, closed = false) {
  const src = closed ? [...points, points[0]] : points;
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / stepMm));
    for (let k = 0; k < n; k++) out.push(add(a, scale(sub(b, a), k / n)));
  }
  out.push(src[src.length - 1]);
  return out;
}

// ── 360° 펼쳐보기 좌표 ─────────────────────────────
// 원통형: { theta, y }  /  반구형: { theta, phi } (phi 0=꼭대기, 90=창 아래 끝, 90 이상=몸체)
export function unwrapCylinder(p) {
  return { theta: azimuthDeg(p), y: p[1] };
}

export function unwrapDome(p, bodyHeight = 30) {
  const rxy = Math.hypot(p[0], p[2]);
  let phi;
  if (p[1] >= 0) phi = (Math.atan2(rxy, p[1]) * 180) / Math.PI;
  else phi = 90 + Math.min(1, -p[1] / bodyHeight) * 40;
  return { theta: azimuthDeg(p), phi };
}
