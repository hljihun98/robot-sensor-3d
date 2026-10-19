// 서버 설정 — 환경 변수로 바꿀 수 있다(.env.example 참고)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  publicDir: path.join(root, 'public'),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  timeZone: process.env.APP_TZ ?? 'Asia/Seoul',
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  // Nginx 등 프록시 뒤에서 실행하면 1로 두세요(HTTPS 쿠키 판단에 필요)
  trustProxy: process.env.TRUST_PROXY === '1',
  initialAdminPassword: process.env.INIT_ADMIN_PASSWORD || null,
  maxPhotoBytes: Number(process.env.MAX_PHOTO_MB ?? 8) * 1024 * 1024,
};

export const dbFile = () => path.join(config.dataDir, 'app.db');
export const photoDir = () => path.join(config.dataDir, 'photos');
