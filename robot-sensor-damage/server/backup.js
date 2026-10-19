// 백업 — DB를 안전하게 복사하고 사진 폴더와 함께 보관, 오래된 백업 정리
// 사용: node server/backup.js [보관할 개수=7]   (cron 예: 0 3 * * * cd /srv/app && node server/backup.js)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { config, dbFile, photoDir } from './config.js';

const keep = Number(process.argv[2] ?? 7);
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const dbOut = path.join(dir, `app-${stamp}.db`);
const db = new DatabaseSync(dbFile());
db.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
db.close();
const tarOut = path.join(dir, `backup-${stamp}.tar.gz`);
execFileSync('tar', ['-czf', tarOut, '-C', path.dirname(dbOut), path.basename(dbOut), '-C', path.dirname(photoDir()), path.basename(photoDir())]);
fs.rmSync(dbOut);
const all = fs.readdirSync(dir).filter((f) => f.startsWith('backup-') && f.endsWith('.tar.gz')).sort();
all.slice(0, Math.max(0, all.length - keep)).forEach((f) => fs.rmSync(path.join(dir, f)));
console.log(`백업 완료: ${tarOut} (보관 ${Math.min(all.length, keep)}개)`);
