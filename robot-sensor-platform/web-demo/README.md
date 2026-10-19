# 센서로그 웹 데모

설치 없이 링크만 열면 센서로그를 써 볼 수 있게, **실제 서버 코드(`server/app.js`, `auth.js`, `db.js`, `validation.js`)를 고치지 않고** 브라우저의 서비스 워커 안에서 실행합니다.

- 주소: https://hljihun98.github.io/robot-sensor-3d/platform/
- 데모 계정: `field / field1234`(현장), `admin / admin1234`(관리자), `sysadmin / sys1234`(시스템 관리자)
- 데이터: 그 브라우저의 IndexedDB에만 저장. 화면 위쪽 **데모 초기화**로 예시 데이터 상태로 되돌립니다.

## 동작 방식

```text
화면(public/)  ──/api, /files 요청──▶  서비스 워커(sw.js)
                                         └─ server/app.js (그대로)
                                              ├─ express        → shims/express.js   작은 라우터
                                              ├─ node:sqlite    → shims/sqlite.js    sql.js(WebAssembly)
                                              ├─ sharp          → shims/sharp.js     브라우저 캔버스
                                              ├─ multer         → shims/multer.js    FormData
                                              ├─ node:fs        → shims/storage.js   IndexedDB 가상 파일
                                              └─ qrcode·crypto·path·url·helmet·rate-limit → shims/
```

- 처음 열면 `index.html`(시작 화면)이 서비스 워커를 설치하고, `seed.js`가 **실제 API**(신고 → 승인 → 변화·수리)를 불러 예시 데이터를 만듭니다.
- 서비스 워커가 화면을 내려줄 때 `<meta name="app-base">`·`<meta name="app-demo">`를 넣습니다. 화면 코드(`public/js/app.js`)는 이 표시가 있을 때만 주소 앞부분(`/robot-sensor-3d/platform`)과 데모 안내를 맞춥니다. 서버로 실행할 때는 동작이 바뀌지 않습니다.
- 로그인 쿠키는 서비스 워커가 대신 기억합니다(서비스 워커가 만든 응답의 Set-Cookie는 브라우저가 무시합니다).
- 예시 데이터 구조를 바꾸면 `sw.js`의 `DEMO_VERSION`을 올리세요. 다음 접속 때 예시 데이터로 새로 시작합니다.

## 빌드

```bash
cd robot-sensor-platform
npm ci
npm run build:web -- <출력 폴더>     # 기본: web-demo/dist
```

GitHub에 올리면 `.github/workflows/pages.yml`이 빌드해 `/platform/`에 배포합니다. 깊은 주소(`/platform/robot/18`)로 바로 들어오면 홈페이지의 `404.html`이 시작 화면을 거쳐 그 주소로 보냅니다.

## 실제 서버와 다른 점

- 데이터가 브라우저마다 따로입니다. 다른 사람·다른 기기와 공유되지 않고, QR을 다른 휴대폰으로 찍으면 그 휴대폰의 예시 데이터가 보입니다.
- 비밀번호 해시 비용을 낮췄고(브라우저 속도), 로그인 시도 제한과 보안 헤더는 없습니다.
- 사진은 브라우저 캔버스로 줄이므로 서버(sharp)와 화질·용량이 조금 다릅니다.
- 시크릿·사생활 보호 창, 서비스 워커를 막은 브라우저에서는 동작하지 않습니다.
