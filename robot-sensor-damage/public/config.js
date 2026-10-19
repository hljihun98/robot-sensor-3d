// 실행 설정 — 서버 없이 올리면(GitHub Pages) 자동으로 데모 모드가 됩니다.
window.RSD_CONFIG = {
  // 'auto'   : 같은 주소에 서버(/api/health)가 있으면 서버 모드, 없으면 데모 모드
  // 'server' : 항상 서버 모드
  // 'demo'   : 항상 데모 모드(브라우저 안에만 저장)
  mode: 'auto',
  // 실제 CAD에서 만든 GLB 파일을 public/models/<id>.glb 로 넣었다면 여기에 id를 적으세요.
  // 예: ['LIDAR_MID360', 'CAM_D405']
  glbModels: [],
};
