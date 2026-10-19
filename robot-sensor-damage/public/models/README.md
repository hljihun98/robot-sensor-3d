# 센서 3D 모델(GLB) 넣는 곳

기본으로는 코드(`js/three/models.js`)가 실제 치수로 단순 모델을 그립니다.
제조사 CAD로 만든 GLB를 쓰려면:

1. 파일 이름을 모델 id로 저장합니다: `LIDAR_CYL.glb`, `LIDAR_MID360.glb`, `CAM_D405.glb`
2. 단위는 mm, 원점은 센서 중심, 위쪽 +Y, 정면 +Z (라이다는 커넥터 반대쪽, 카메라는 렌즈 쪽)
3. 메시 이름을 부위 이름으로 시작하게 합니다.
   - 라이다 원통형: `cap`, `window`, `body`, `connector`, `bracket`
   - Mid-360: `window`, `body`, `connector`, `bracket`
   - D405: `lens_left`, `lens_right`, `front_cover`, `housing`, `rear_connector`, `bracket`
4. `config.js`의 `glbModels`에 id를 추가합니다.

좌표 기준이 같으면 이미 기록된 파손 위치는 그대로 맞습니다.
