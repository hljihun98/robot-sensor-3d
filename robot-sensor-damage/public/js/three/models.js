// 센서 3D 모델 — 실제 치수(mm)로 만든 단순 모델. 부위마다 mesh.userData.part 를 붙인다.
// config.js 의 glbModels 에 모델 id가 있으면 public/models/<id>.glb 를 대신 불러온다
// (GLB 안의 메시 이름을 부위 이름(window, body ...)으로 시작하게 만들면 부위가 자동 인식된다).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel } from '../core/sensorModels.js';

const MAT = {
  metal: () => new THREE.MeshStandardMaterial({ color: 0xa7b0b8, metalness: 0.55, roughness: 0.42 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.35, roughness: 0.55 }),
  window: () => new THREE.MeshStandardMaterial({ color: 0x1d2b36, metalness: 0.2, roughness: 0.12, transparent: true, opacity: 0.94 }),
  glass: () => new THREE.MeshStandardMaterial({ color: 0x14202c, metalness: 0.4, roughness: 0.08 }),
  bracket: () => new THREE.MeshStandardMaterial({ color: 0x6c757d, metalness: 0.4, roughness: 0.6 }),
  connector: () => new THREE.MeshStandardMaterial({ color: 0x202326, metalness: 0.2, roughness: 0.7 }),
};

function part(geometry, material, name, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  m.name = name;
  m.userData.part = name;
  return m;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function buildCylinderLidar(d) {
  const g = new THREE.Group();
  const bodyH = d.baseTop - d.yMin;
  const winH = d.windowTop - d.baseTop;
  const capH = d.yMax - d.windowTop;
  g.add(part(new THREE.CylinderGeometry(d.radius, d.radius, bodyH, 96), MAT.metal(), 'body', [0, d.yMin + bodyH / 2, 0]));
  g.add(part(new THREE.CylinderGeometry(d.windowRadius, d.windowRadius, winH, 128, 1, true), MAT.window(), 'window', [0, d.baseTop + winH / 2, 0]));
  g.add(part(new THREE.CylinderGeometry(d.radius, d.radius, capH, 96), MAT.metal(), 'cap', [0, d.windowTop + capH / 2, 0]));
  // 안쪽 심(창 너머가 비어 보이지 않게)
  const core = new THREE.Mesh(new THREE.CylinderGeometry(d.windowRadius - 6, d.windowRadius - 6, winH, 48), MAT.dark());
  core.position.y = d.baseTop + winH / 2;
  core.userData.part = 'window';
  core.userData.inner = true;
  g.add(core);
  g.add(part(new THREE.BoxGeometry(16, 9, 8), MAT.connector(), 'connector', [0, d.yMin + 8, -d.radius - 3]));
  g.add(part(new THREE.BoxGeometry(118, 6, 118), MAT.bracket(), 'bracket', [0, d.yMin - 3, 0]));
  return g;
}

function buildDomeLidar(d) {
  const g = new THREE.Group();
  const bodyH = d.bodyTop - d.yMin;
  const bodyGeo = new THREE.ExtrudeGeometry(roundedRect(d.half * 2, d.half * 2, d.corner), { depth: bodyH, bevelEnabled: false, curveSegments: 10 });
  bodyGeo.rotateX(-Math.PI / 2);
  bodyGeo.translate(0, d.yMin, 0);
  g.add(part(bodyGeo, MAT.dark(), 'body'));
  g.add(part(new THREE.SphereGeometry(d.domeRadius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), MAT.window(), 'window', [0, d.bodyTop, 0]));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(d.domeRadius + 1.5, d.domeRadius + 1.5, 1.2, 96), MAT.metal());
  ring.position.y = d.bodyTop + 0.6;
  ring.userData.part = 'body';
  g.add(ring);
  g.add(part(new THREE.BoxGeometry(16, 8, 5), MAT.connector(), 'connector', [0, d.yMin + 10, -d.half - 2.5]));
  g.add(part(new THREE.BoxGeometry(82, 6, 82), MAT.bracket(), 'bracket', [0, d.yMin - 3, 0]));
  return g;
}

function buildD405(d) {
  const g = new THREE.Group();
  const housing = new THREE.ExtrudeGeometry(roundedRect(d.w, d.h, 5), { depth: d.d, bevelEnabled: false, curveSegments: 10 });
  housing.translate(0, 0, -d.d / 2);
  g.add(part(housing, MAT.metal(), 'housing'));
  g.add(part(new THREE.BoxGeometry(d.w - 4, d.h - 4, 1), MAT.dark(), 'front_cover', [0, 0, d.d / 2 + 0.5]));
  const lens = () => {
    const geo = new THREE.CylinderGeometry(d.lensR, d.lensR, 1, 48);
    geo.rotateX(Math.PI / 2);
    return geo;
  };
  g.add(part(lens(), MAT.glass(), 'lens_left', [-d.lensX, d.lensY, d.d / 2 + 1.5]));
  g.add(part(lens(), MAT.glass(), 'lens_right', [d.lensX, d.lensY, d.d / 2 + 1.5]));
  g.add(part(new THREE.BoxGeometry(10, 4, 2), MAT.connector(), 'rear_connector', [0, -8, -d.d / 2 - 1]));
  g.add(part(new THREE.BoxGeometry(30, 4, 20), MAT.bracket(), 'bracket', [0, -d.h / 2 - 2, 0]));
  return g;
}

async function loadGlb(id) {
  const gltf = await new GLTFLoader().loadAsync(`models/${id}.glb`);
  const parts = Object.keys(getModel(id).parts);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.name || '').toLowerCase();
    o.userData.part = parts.find((p) => name.startsWith(p)) ?? 'body';
  });
  return gltf.scene;
}

export async function buildSensorModel(modelId) {
  const def = getModel(modelId);
  const glbList = globalThis.RSD_CONFIG?.glbModels ?? [];
  if (glbList.includes(modelId)) {
    try {
      return await loadGlb(modelId);
    } catch (e) {
      console.warn('GLB 모델을 불러오지 못해 기본 모델을 씁니다', e);
    }
  }
  if (def.id === 'LIDAR_CYL') return buildCylinderLidar(def.dims);
  if (def.id === 'CAM_D405') return buildD405(def.dims);
  return buildDomeLidar(def.dims);
}
