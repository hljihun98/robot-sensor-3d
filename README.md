# 로봇 센서 파손 3D 이력관리

같은 기획안(로봇 센서 파손 3D 이력관리 플랫폼)으로 만든 프로그램 두 가지와, 둘을 실행·관리하는 홈페이지를 한 저장소에 담았습니다.

| 폴더 | 프로그램 | 특징 | 필요 환경 |
| --- | --- | --- | --- |
| [`robot-sensor-damage/`](robot-sensor-damage/) | 센서 파손 3D 이력관리 | 업무 로직을 브라우저·서버가 공유, 서버 없이 데모 모드, 360° 펼쳐보기 | Node.js 22.13+ |
| [`robot-sensor-platform/`](robot-sensor-platform/) | 센서로그 | 서버 저장형, 사진별 공개 권한·CSRF 토큰, QR·CSV 일괄 등록 | Node.js 24+ |
| [`launcher/`](launcher/) | 실행 관리 홈페이지 | 두 프로그램 실행·중지, 로그·초기 계정 보기, 첫 실행 때 자동 설치 | Node.js 22.13+ |

## 실행 방법 두 가지

| 방법 | 필요한 것 | 데이터 | 용도 |
| --- | --- | --- | --- |
| ① 웹에서 바로 실행 | 링크만 열기 | 그 브라우저에만 저장 | 화면·흐름 확인, 소개 |
| ② 내려받아 실행 | Node.js, ZIP 또는 git | PC의 `data/` 폴더 | 실제 운영, 시범 운영 |

### ① 웹에서 바로 실행

- 홈페이지: https://hljihun98.github.io/robot-sensor-3d/
- 센서 파손 3D 이력관리 데모: https://hljihun98.github.io/robot-sensor-3d/damage/
- 센서로그 웹 데모: https://hljihun98.github.io/robot-sensor-3d/platform/
- 두 데모 모두 계정이 같습니다: `field / field1234`(현장), `admin / admin1234`(관리자), `sysadmin / sys1234`(시스템 관리자)

센서로그 웹 데모는 실제 서버 코드(`robot-sensor-platform/server/`)를 브라우저의 서비스 워커 안에서 그대로 실행합니다. SQLite는 sql.js(WebAssembly)로, 사진 처리(sharp)는 브라우저 캔버스로 바꿔 끼웠습니다. 데이터는 그 브라우저의 IndexedDB에만 남고 화면 위쪽 **데모 초기화**로 지울 수 있습니다. 시크릿·사생활 보호 창에서는 동작하지 않을 수 있습니다. 자세한 구조는 [`robot-sensor-platform/web-demo/`](robot-sensor-platform/web-demo/)를 보세요.

### ② 내려받아 실행

git 없이 [ZIP 파일](https://github.com/hljihun98/robot-sensor-3d/archive/refs/heads/main.zip)을 받아 압축을 풀어도 됩니다.

```bash
git clone https://github.com/hljihun98/robot-sensor-3d.git
cd robot-sensor-3d
npm start            # Windows는 START.cmd 더블클릭, macOS·Linux는 ./start.sh
```

브라우저에서 http://127.0.0.1:8080 이 열립니다. 프로그램 카드의 **실행**을 누르면 필요한 패키지를 설치(처음 한 번, 인터넷 필요)한 뒤 프로그램을 켜고, **열기**로 접속합니다.

| 프로그램 | 실행 방식 | 주소 | 첫 로그인 |
| --- | --- | --- | --- |
| damage | 서버 모드 | http://127.0.0.1:3000 | `sysadmin` / 홈페이지에 표시되는 임시 비밀번호 |
| damage | 데모 모드 | http://127.0.0.1:5173 | 위 데모 계정 |
| platform | 서버 모드 | http://127.0.0.1:3210 | `admin` / 홈페이지에 표시되는 임시 비밀번호 |

- 런처와 프로그램은 이 PC 안(127.0.0.1)에서만 열립니다. 휴대폰 등 다른 기기에서 쓰려면 각 폴더 README의 서버 운영(HTTPS) 방법을 따르세요.
- 데이터는 각 폴더의 `data/`에 저장되며 Git에는 올라가지 않습니다.
- 런처 창(또는 터미널)을 닫으면 실행 중인 프로그램도 함께 꺼집니다. 다른 포트: `LAUNCHER_PORT=8081 npm start`

각 프로그램을 따로 실행하는 방법, 서버 운영, 백업은 폴더별 README를 보세요.

## 테스트

```bash
npm test             # 두 프로그램 테스트를 차례로 실행 (각 폴더에서 npm ci 먼저)
```

GitHub에 올리면 `.github/workflows/ci.yml`이 두 프로그램 테스트·센서로그 웹 데모 빌드·런처 확인을, `pages.yml`이 홈페이지와 두 웹 데모 배포를 합니다.

## 개발 기록

개발 방향·다음 할 일·완료 기록·결정 기록을 앱마다 남깁니다. 고치기 전에 읽고, 고친 뒤에는 같은 커밋에서 함께 고칩니다.

- 공통: [`개발기록.md`](개발기록.md) · 작업 규칙: [`CLAUDE.md`](CLAUDE.md)
- [`robot-sensor-damage/개발기록.md`](robot-sensor-damage/개발기록.md)
- [`robot-sensor-platform/개발기록.md`](robot-sensor-platform/개발기록.md)
- [`launcher/개발기록.md`](launcher/개발기록.md)
