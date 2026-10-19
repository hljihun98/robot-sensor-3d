// 360° 펼쳐보기 — 라이다 창을 평면으로 펼쳐 모든 방향의 파손을 한눈에 보여 준다.
// 원통형: 가로 = 각도 0~360°, 세로 = 높이(mm) / 반구형: 위에서 본 원형 지도(가운데 = 꼭대기)
import { DAMAGE_TYPES } from '../core/constants.js';
import { getModel } from '../core/sensorModels.js';
import { unwrapCylinder, unwrapDome } from '../core/geometry.js';

const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

export class UnwrapView {
  constructor(container, { modelId, yaw = 0, onSelect }) {
    this.el = container;
    this.def = getModel(modelId);
    this.kind = this.def.unwrap;
    this.yaw = yaw;
    this.onSelect = onSelect;
    this.damages = [];
    this.reports = [];
    this.selectedId = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'unwrap-canvas';
    this.el.append(this.canvas);
    this.hits = [];
    this.canvas.addEventListener('click', (e) => this.click(e));
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.el);
  }

  dispose() {
    this.ro.disconnect();
  }

  set(damages, reports, selectedId) {
    this.damages = damages;
    this.reports = reports ?? [];
    this.selectedId = selectedId;
    this.render();
  }

  angle(theta) {
    return (theta + this.yaw + 360) % 360;
  }

  // 3D 점 → 캔버스 좌표
  mapper(w, h) {
    if (this.kind === 'CYLINDER') {
      const d = this.def.dims;
      const L = 64;
      const R = 16;
      const T = 18;
      const B = 44;
      const px = (th) => L + (this.angle(th) / 360) * (w - L - R);
      const py = (y) => T + ((d.yMax - y) / (d.yMax - d.yMin)) * (h - T - B);
      return { L, R, T, B, px, py, map: (p) => {
        const u = unwrapCylinder(p);
        return [px(u.theta), py(u.y), this.angle(u.theta)];
      } };
    }
    const cx = w / 2;
    const cy = h / 2 + 4;
    const rMax = Math.min(w, h) / 2 - 30;
    const rr = (phi) => (phi / 130) * rMax;
    return { cx, cy, rMax, rr, map: (p) => {
      const u = unwrapDome(p, this.def.dims.bodyTop - this.def.dims.yMin);
      const a = (this.angle(u.theta) * Math.PI) / 180;
      const r = rr(Math.min(130, u.phi));
      return [cx + r * Math.sin(a), cy - r * Math.cos(a), this.angle(u.theta)];
    } };
  }

  render() {
    const w = this.el.clientWidth || 600;
    const h = this.kind === 'CYLINDER' ? Math.max(220, Math.min(320, w * 0.42)) : Math.max(300, Math.min(520, w * 0.9));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const ink = css('--ink', '#212529');
    const quiet = css('--ink-2', '#6c757d');
    const line = css('--line', '#dee2e6');
    const panel = css('--surface-2', '#f1f3f5');
    const win = css('--window-tint', 'rgba(28,126,214,0.10)');
    g.font = '12px system-ui, sans-serif';
    const m = this.mapper(w, h);
    this.hits = [];

    if (this.kind === 'CYLINDER') {
      const d = this.def.dims;
      const bands = [
        ['상단 캡', d.windowTop, d.yMax, panel],
        ['옆면 창', d.baseTop, d.windowTop, win],
        ['하단 몸체', d.yMin, d.baseTop, panel],
      ];
      bands.forEach(([label, y0, y1, fill]) => {
        g.fillStyle = fill;
        g.fillRect(m.L, m.py(y1), w - m.L - m.R, m.py(y0) - m.py(y1));
        g.fillStyle = quiet;
        g.textAlign = 'right';
        g.fillText(label, m.L - 8, (m.py(y0) + m.py(y1)) / 2 + 4);
      });
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.textAlign = 'center';
      for (let a = 0; a <= 360; a += 45) {
        const x = m.L + (a / 360) * (w - m.L - m.R);
        g.beginPath();
        g.moveTo(x, m.T);
        g.lineTo(x, h - m.B);
        g.stroke();
        g.fillStyle = a % 180 === 0 ? ink : quiet;
        g.textAlign = a === 0 ? 'left' : a === 360 ? 'right' : 'center';
        g.fillText(a === 0 ? '0° 정면' : a === 360 ? '360°' : a === 180 ? '180° 후면' : `${a}°`, a === 0 ? x - 4 : a === 360 ? x + 4 : x, h - m.B + 16);
      }
      g.fillStyle = quiet;
      g.textAlign = 'left';
      g.fillText(this.yaw ? `각도 = 로봇 기준(장착 보정 ${this.yaw}°)` : '각도 = 센서 정면 기준, 위에서 볼 때 시계 방향', m.L, h - 6);
    } else {
      const { cx, cy, rr, rMax } = m;
      g.fillStyle = panel;
      g.beginPath();
      g.arc(cx, cy, rMax, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = win;
      g.beginPath();
      g.arc(cx, cy, rr(90), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = line;
      [30, 60, 90, 130].forEach((phi) => {
        g.lineWidth = phi === 90 ? 1.6 : 1;
        g.beginPath();
        g.arc(cx, cy, rr(phi), 0, Math.PI * 2);
        g.stroke();
      });
      g.lineWidth = 1;
      g.textAlign = 'center';
      for (let a = 0; a < 360; a += 45) {
        const t = (a * Math.PI) / 180;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + rMax * Math.sin(t), cy - rMax * Math.cos(t));
        g.stroke();
        g.fillStyle = a % 180 === 0 ? ink : quiet;
        const lx = cx + (rMax + 16) * Math.sin(t);
        const ly = cy - (rMax + 16) * Math.cos(t) + 4;
        g.fillText(a === 0 ? '0° 정면' : a === 180 ? '180° 후면' : `${a}°`, lx, ly);
      }
      g.fillStyle = quiet;
      g.fillText('꼭대기', cx, cy - 6);
      g.textAlign = 'left';
      g.fillText('창', cx + 6, cy - rr(75));
      g.fillText('몸체 옆면', cx + 6, cy - rr(110));
    }

    // 파손
    this.damages.forEach((d, i) => {
      const t = DAMAGE_TYPES[d.type] ?? DAMAGE_TYPES.ETC;
      const resolved = d.status !== 'ACTIVE';
      const color = resolved ? '#9aa0a6' : t.color;
      const sel = d.id === this.selectedId;
      const pts = d.geom.path.map((p) => m.map(p));
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = sel ? 4 : 2.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.globalAlpha = resolved ? 0.6 : 1;
      if (pts.length === 1) {
        g.beginPath();
        g.arc(pts[0][0], pts[0][1], sel ? 7 : 5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        pts.forEach((p, k) => {
          const prev = pts[k - 1];
          const wrap = this.kind === 'CYLINDER' && prev && Math.abs(p[2] - prev[2]) > 180;
          if (k === 0 || wrap) g.moveTo(p[0], p[1]);
          else g.lineTo(p[0], p[1]);
        });
        g.stroke();
        if ((d.shape === 'AREA' || d.shape === 'CIRCLE') && !pts.some((p, k) => k && Math.abs(p[2] - pts[k - 1][2]) > 180)) {
          g.globalAlpha = 0.18;
          g.fill();
        }
      }
      g.globalAlpha = 1;
      const a = pts[Math.floor(pts.length / 2)];
      g.beginPath();
      g.fillStyle = sel ? ink : color;
      g.arc(a[0] + 10, a[1] - 10, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 11px system-ui, sans-serif';
      g.fillText(String(i + 1), a[0] + 10, a[1] - 6);
      g.font = '12px system-ui, sans-serif';
      this.hits.push({ id: d.id, pts });
    });
    this.reports.forEach((r) => {
      if (!r.point) return;
      const p = m.map(r.point);
      g.strokeStyle = '#f59f00';
      g.lineWidth = 2;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(p[0], p[1], 8, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    });
  }

  click(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null;
    this.hits.forEach((h) => h.pts.forEach((p) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < 14 && (!best || d < best.d)) best = { d, id: h.id };
    }));
    this.onSelect?.(best?.id ?? null);
  }
}

// 파손 하나의 각도 설명(상세 화면용)
export function angleText(modelId, path, yaw = 0) {
  const def = getModel(modelId);
  if (!def.unwrap || !path?.length) return null;
  const p = path[Math.floor(path.length / 2)];
  if (def.unwrap === 'CYLINDER') {
    const u = unwrapCylinder(p);
    return `${Math.round((u.theta + yaw) % 360)}° · 높이 ${u.y.toFixed(0)} mm`;
  }
  const u = unwrapDome(p);
  return `${Math.round((u.theta + yaw) % 360)}° · ${u.phi <= 90 ? `꼭대기에서 ${Math.round(u.phi)}°` : '몸체 옆면'}`;
}
