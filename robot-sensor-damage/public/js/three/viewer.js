// 센서 3D 뷰어 — 회전·확대, 파손 표시, 위치 찍기(신고), 모양 그리기(관리자)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSensorModel } from './models.js';
import { DAMAGE_TYPES } from '../core/constants.js';
import { circleSamples, densify, dist, norm, roundVec } from '../core/geometry.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const A = (v) => [v.x, v.y, v.z];
const ease = (t) => 1 - (1 - t) ** 3;
const ACCENT = 0x1c7ed6;
const REPORT = 0xf59f00;

export class SensorViewer {
  constructor(container, { modelId, onSelect, onPick, onDrawChange } = {}) {
    this.el = container;
    this.modelId = modelId;
    this.onSelect = onSelect;
    this.onPick = onPick;
    this.onDrawChange = onDrawChange;
    this.mode = 'view';
    this.damages = [];
    this.reports = [];
    this.selectedId = null;
    this.highlightReportId = null;
    this.labels = [];
    this.draw = null;
    this.disposed = false;
  }

  async init() {
    const el = this.el;
    el.classList.add('viewer3d');
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'viewer3d-canvas';
    this.overlay = document.createElement('div');
    this.overlay.className = 'viewer3d-overlay';
    el.append(this.canvasWrap, this.overlay);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      el.innerHTML = '<div class="empty">이 기기에서는 3D(WebGL)를 쓸 수 없습니다. 다른 브라우저로 열어 주세요.</div>';
      throw e;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvasWrap.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 6000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(300, 500, 400);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-400, 150, -300);
    this.scene.add(key, fill);

    this.model = await buildSensorModel(this.modelId);
    this.scene.add(this.model);
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh && !o.userData.inner) this.meshes.push(o);
    });
    const box = new THREE.Box3().setFromObject(this.model);
    this.center = box.getCenter(new THREE.Vector3());
    this.radius = box.getSize(new THREE.Vector3()).length() / 2;
    this.tubeR = Math.min(0.85, Math.max(0.35, this.radius * 0.009));

    // 정면 표시(+Z)
    const arrowY = box.min.y - 0.5;
    const z0 = box.max.z + this.radius * 0.08;
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, arrowY, z0), this.radius * 0.45, 0x868e96, this.radius * 0.14, this.radius * 0.09);
    this.scene.add(arrow);
    this.frontLabel = this.addLabel(new THREE.Vector3(0, arrowY, z0 + this.radius * 0.62), '정면 0°', 'front-label');

    this.markerGroup = new THREE.Group();
    this.markerGroup.renderOrder = 2;
    this.scene.add(this.markerGroup);
    this.tempGroup = new THREE.Group();
    this.scene.add(this.tempGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = this.radius * 0.6;
    this.controls.maxDistance = this.radius * 9;
    this.controls.target.copy(this.center);
    this.setView('reset', false);

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
    return this;
  }

  // ── 기본 동작 ─────────────────────────────
  resize() {
    const w = this.el.clientWidth || 300;
    const h = this.el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.ms);
      const k = ease(t);
      this.camera.position.lerpVectors(this.anim.fromPos, this.anim.toPos, k);
      this.controls.target.lerpVectors(this.anim.fromTarget, this.anim.toTarget, k);
      if (t >= 1) this.anim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose?.());
    });
  }

  flyTo(pos, target = this.center, ms = 480) {
    this.anim = { start: performance.now(), ms, fromPos: this.camera.position.clone(), toPos: pos.clone(), fromTarget: this.controls.target.clone(), toTarget: target.clone() };
  }

  setView(name, animate = true) {
    // 센서가 정면(+Z)을 볼 때 기준 — 우측면 = 시계 방향 90°(−X), 좌측면 = 270°(+X)
    const dirs = {
      front: [0, 0.18, 1], back: [0, 0.18, -1], left: [1, 0.18, 0], right: [-1, 0.18, 0], top: [0, 1, 0.0001], reset: [0.62, 0.45, 1],
    };
    const d = V(dirs[name] ?? dirs.reset).normalize();
    const pos = this.center.clone().add(d.multiplyScalar(this.radius * 3.4));
    if (animate) this.flyTo(pos);
    else {
      this.camera.position.copy(pos);
      this.controls.target.copy(this.center);
    }
  }

  focusPoint(p, n) {
    const point = V(p);
    let dir = point.clone().sub(this.center);
    if (n) dir = dir.normalize().add(V(n).normalize()).normalize();
    else dir.normalize();
    if (Math.abs(dir.y) > 0.92) dir.add(new THREE.Vector3(0, 0, 0.3)).normalize();
    const d = Math.max(this.radius * 2.2, Math.min(this.camera.position.distanceTo(this.controls.target), this.radius * 3.4));
    this.flyTo(this.center.clone().add(dir.multiplyScalar(d)));
  }

  // ── 라벨(HTML) ─────────────────────────────
  addLabel(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = `marker-label ${cls}`;
    el.textContent = text;
    this.overlay.append(el);
    const item = { el, pos: pos.clone() };
    this.labels.push(item);
    return item;
  }

  clearLabels(filter) {
    this.labels = this.labels.filter((l) => {
      if (filter(l)) {
        l.el.remove();
        return false;
      }
      return true;
    });
  }

  updateLabels() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const camPos = this.camera.position;
    this.labels.forEach((l) => {
      const p = l.pos.clone().project(this.camera);
      const x = ((p.x + 1) / 2) * w;
      const y = ((1 - p.y) / 2) * h;
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      l.el.style.visibility = p.z > 1 ? 'hidden' : '';
      if (l.surface) {
        const dir = l.pos.clone().sub(camPos);
        const d = dir.length();
        this.raycaster.set(camPos, dir.normalize());
        const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
        l.el.classList.toggle('hidden-side', !!hit && hit.distance < d - this.tubeR * 4);
      }
    });
  }

  // ── 파손 표시 ─────────────────────────────
  outward(p) {
    const v = p.clone().sub(this.center);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }

  pathMesh(path, { closed = false, color, radius = this.tubeR, opacity = 1, userData = {} }) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, transparent: opacity < 1, opacity });
    const pts = path.map((a) => {
      const v = V(a);
      return v.add(this.outward(v).multiplyScalar(radius * 0.8));
    });
    let mesh;
    if (pts.length === 1) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 2.4, 20, 14), mat);
      mesh.position.copy(pts[0]);
    } else {
      let list = pts;
      if (closed && list.length > 2 && list[0].distanceTo(list[list.length - 1]) < 0.01) list = list.slice(0, -1);
      const curve = new THREE.CatmullRomCurve3(list, closed, 'catmullrom', 0.1);
      const seg = Math.min(600, Math.max(24, list.length * 6));
      mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 10, closed), mat);
    }
    Object.assign(mesh.userData, userData);
    return mesh;
  }

  anchorOf(path) {
    if (path.length === 1) return V(path[0]);
    return V(path[Math.floor(path.length / 2)]);
  }

  setDamages(damages, selectedId = this.selectedId) {
    this.damages = damages;
    this.selectedId = selectedId;
    this.rebuildMarkers();
  }

  setReports(reports, highlightId = null) {
    this.reports = reports;
    this.highlightReportId = highlightId;
    this.rebuildMarkers();
  }

  rebuildMarkers() {
    if (!this.markerGroup) return;
    this.markerGroup.children.slice().forEach((c) => {
      this.markerGroup.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    });
    this.clearLabels((l) => l.kind === 'damage' || l.kind === 'report');
    this.damages.forEach((d, i) => {
      const t = DAMAGE_TYPES[d.type] ?? DAMAGE_TYPES.ETC;
      const resolved = d.status !== 'ACTIVE';
      const sel = d.id === this.selectedId;
      const color = resolved ? 0x9aa0a6 : new THREE.Color(t.color).getHex();
      const closed = d.shape === 'CIRCLE' || d.shape === 'AREA';
      const mesh = this.pathMesh(d.geom.path, { closed, color, radius: this.tubeR * (sel ? 1.7 : 1), opacity: resolved ? 0.55 : 1, userData: { damageId: d.id } });
      this.markerGroup.add(mesh);
      if (sel && d.geom.path.length > 1) {
        const halo = this.pathMesh(d.geom.path, { closed, color: 0xffffff, radius: this.tubeR * 2.6, opacity: 0.35, userData: { damageId: d.id } });
        this.markerGroup.add(halo);
      }
      const lab = this.addLabel(this.anchorOf(d.geom.path).add(this.outward(this.anchorOf(d.geom.path)).multiplyScalar(this.tubeR * 3)), String(i + 1), `dmg ${sel ? 'selected' : ''} ${resolved ? 'resolved' : ''} ${d.is_new ? 'is-new' : ''}`);
      lab.kind = 'damage';
      lab.surface = true;
      lab.el.style.setProperty('--c', resolved ? '#9aa0a6' : t.color);
      lab.el.dataset.id = d.id;
      lab.el.addEventListener('click', () => this.onSelect?.(d.id));
    });
    this.reports.forEach((r) => {
      if (!r.point) return;
      const hl = r.id === this.highlightReportId;
      const m = this.pathMesh([r.point], { color: REPORT, radius: this.tubeR * (hl ? 1.6 : 1.1), opacity: 0.9, userData: { reportId: r.id } });
      this.markerGroup.add(m);
      const lab = this.addLabel(V(r.point).add(this.outward(V(r.point)).multiplyScalar(this.tubeR * 4)), hl ? '신고 위치' : r.mine ? '내 신고' : '신고', `report ${hl ? 'selected' : ''}`);
      lab.kind = 'report';
      lab.surface = true;
    });
  }

  select(id, { fly = true } = {}) {
    this.selectedId = id;
    this.rebuildMarkers();
    const d = this.damages.find((x) => x.id === id);
    if (d && fly) this.focusPoint(A(this.anchorOf(d.geom.path)), d.geom.normal);
  }

  // ── 포인터 ─────────────────────────────
  bindPointer() {
    const c = this.renderer.domElement;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    c.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved < 7 && dt < 700) this.handleClick(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (down || this.mode !== 'view') return;
      const hit = this.hitMarker(e);
      c.style.cursor = hit ? 'pointer' : 'grab';
    });
  }

  ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  hitMarker(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    this.raycaster.params.Line = { threshold: 1 };
    const hit = this.raycaster.intersectObjects(this.markerGroup.children, false)[0];
    if (!hit) return null;
    const modelHit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (modelHit && modelHit.distance < hit.distance - this.tubeR * 3) return null;
    return hit.object.userData;
  }

  hitSurface(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : this.outward(hit.point);
    return { point: roundVec(A(hit.point)), normal: roundVec(A(n), 4), part: hit.object.userData.part ?? 'body' };
  }

  handleClick(e) {
    if (this.mode === 'view') {
      const m = this.hitMarker(e);
      this.onSelect?.(m?.damageId ?? null, m);
      return;
    }
    const s = this.hitSurface(e);
    if (!s) return;
    if (this.mode === 'pick') {
      this.showTemp([{ p: s.point }], 'POINT');
      this.onPick?.(s);
    } else if (this.mode === 'draw') this.addDrawPoint(s);
  }

  setMode(mode) {
    this.mode = mode;
    this.renderer.domElement.style.cursor = mode === 'view' ? 'grab' : 'crosshair';
    if (mode === 'view') this.clearTemp();
  }

  // ── 임시 표시 / 그리기 ─────────────────────────────
  clearTemp() {
    this.tempGroup.children.slice().forEach((c) => {
      this.tempGroup.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    });
  }

  showTemp(ctrl, shape, path) {
    this.clearTemp();
    ctrl.forEach((c) => this.tempGroup.add(this.pathMesh([c.p], { color: ACCENT, radius: this.tubeR * 1.1 })));
    if (path && path.length > 1) this.tempGroup.add(this.pathMesh(path, { closed: shape === 'CIRCLE' || shape === 'AREA', color: ACCENT, radius: this.tubeR }));
  }

  snap(q, n) {
    const nv = V(n).normalize();
    const origin = V(q).add(nv.clone().multiplyScalar(14));
    this.raycaster.set(origin, nv.clone().negate());
    const hits = this.raycaster.intersectObjects(this.meshes, false);
    let best = null;
    hits.forEach((h) => {
      const d = h.point.distanceTo(V(q));
      if (d < 9 && (!best || d < best.d)) best = { d, p: h.point };
    });
    return roundVec(best ? A(best.p) : q);
  }

  snapPath(points, normals) {
    return points.map((p, i) => this.snap(p, normals[Math.min(i, normals.length - 1)]));
  }

  startDraw(shape, preset = []) {
    this.draw = { shape, ctrl: [...preset] };
    this.setMode('draw');
    this.updateDraw();
  }

  addDrawPoint(s) {
    const d = this.draw;
    if (!d) return;
    if (d.shape === 'POINT') d.ctrl = [{ p: s.point, n: s.normal, part: s.part }];
    else if (d.shape === 'CIRCLE' && d.ctrl.length >= 2) d.ctrl = [d.ctrl[0], { p: s.point, n: s.normal, part: s.part }];
    else d.ctrl.push({ p: s.point, n: s.normal, part: s.part });
    this.updateDraw();
  }

  undoDraw() {
    if (!this.draw) return;
    this.draw.ctrl.pop();
    this.updateDraw();
  }

  drawGeom() {
    const d = this.draw;
    if (!d || !d.ctrl.length) return null;
    const c = d.ctrl;
    const normal = norm(c[0].n);
    if (d.shape === 'POINT') return { points: [c[0].p], normal, path: [c[0].p] };
    if (d.shape === 'CIRCLE') {
      if (c.length < 2) return null;
      const radius = Math.max(0.5, dist(c[0].p, c[1].p));
      const raw = circleSamples(c[0].p, normal, radius, 48);
      return { points: [c[0].p], normal, radius: Math.round(radius * 100) / 100, path: this.snapPath(raw, [normal]) };
    }
    const closed = d.shape === 'AREA';
    if (c.length < (closed ? 3 : 2)) return null;
    const pts = c.map((x) => x.p);
    const raw = densify(pts, Math.max(0.6, this.radius * 0.015), closed);
    // 각 점의 바깥 방향: 가장 가까운 기준점의 면 방향
    const normals = raw.map((q) => {
      let best = c[0];
      c.forEach((x) => {
        if (dist(q, x.p) < dist(q, best.p)) best = x;
      });
      return best.n;
    });
    return { points: pts, normal, path: this.snapPath(raw, normals) };
  }

  updateDraw() {
    const d = this.draw;
    const geom = this.drawGeom();
    this.showTemp(d.ctrl, d.shape, geom?.path);
    this.onDrawChange?.({ shape: d.shape, count: d.ctrl.length, ready: !!geom, geom, part: d.ctrl[0]?.part ?? null });
  }

  finishDraw() {
    const geom = this.drawGeom();
    const result = geom ? { shape: this.draw.shape, geom, part: this.draw.ctrl[0].part } : null;
    return result;
  }

  cancelDraw() {
    this.draw = null;
    this.setMode('view');
  }
}
