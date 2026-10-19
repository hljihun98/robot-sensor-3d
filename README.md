# 로봇 센서 파손 3D 이력관리

같은 기획안(로봇 센서 파손 3D 이력관리 플랫폼)으로 만든 프로그램 두 가지와, 둘을 실행·관리하는 홈페이지를 한 저장소에 담았습니다.

| 폴더 | 프로그램 | 특징 | 필요 환경 |
| --- | --- | --- | --- |
| [`robot-sensor-damage/`](robot-sensor-damage/) | 센서 파손 3D 이력관리 | 업무 로직을 브라우저·서버가 공유, 서버 없이 데모 모드, 360° 펼쳐보기 | Node.js 22.13+ |
| [`robot-sensor-platform/`](robot-sensor-platform/) | 센서로그 | 서버 저장형, 사진별 공개 권한·CSRF 토큰, QR·CSV 일괄 등록 | Node.js 24+ |
| [`launcher/`](launcher/) | 실행 관리 홈페이지 | 두 프로그램 실행·중지, 로그·초기 계정 보기, 첫 실행 때 자동 설치 | Node.js 22.13+ |

## 온라인으로 보기

- 홈페이지: https://hljihun98.github.io/robot-sensor-3d/
- damage 데모: https://hljihun98.github.io/robot-sensor-3d/damage/ (데이터는 보는 사람 브라우저에만 저장)
  - 데모 계정 `field / field1234`(현장), `admin / admin1234`(관리자), `sysadmin / sys1234`(시스템 관리자)
- platform은 서버가 필요해서 온라인 데모가 없습니다. 아래처럼 내 PC에서 실행하세요.

## 내 PC에서 실행하기

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

GitHub에 올리면 `.github/workflows/ci.yml`이 두 프로그램 테스트와 런처 확인을, `pages.yml`이 홈페이지·damage 데모 배포를 합니다.
