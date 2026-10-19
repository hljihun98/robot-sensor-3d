// 초기 데이터 넣기 — `npm run seed` (기본) / `npm run seed:demo` (예시 데이터 포함)
// 이미 데이터가 있으면 아무것도 하지 않습니다. 처음부터 다시 하려면 --reset (기존 DB는 백업 후 삭제).
import fs from 'node:fs';
import { config, dbFile } from './config.js';
import { openApp, isEmpty, seedDatabase } from './runtime.js';

const args = new Set(process.argv.slice(2));
if (args.has('--reset') && fs.existsSync(dbFile())) {
  const bak = `${dbFile()}.${Date.now()}.bak`;
  fs.renameSync(dbFile(), bak);
  ['-wal', '-shm'].forEach((s) => fs.existsSync(dbFile() + s) && fs.rmSync(dbFile() + s));
  console.log(`기존 DB를 ${bak} 로 옮겼습니다.`);
}
const { store } = openApp();
if (!isEmpty(store)) {
  console.log('이미 데이터가 있어 건너뜁니다. 처음부터 다시 하려면: npm run seed -- --reset');
  process.exit(0);
}
const withSamples = args.has('--samples');
const pw = seedDatabase(store, { withSamples });
console.log(`초기 데이터를 넣었습니다 (${config.dataDir}).`);
if (withSamples) console.log('예시 계정: field / field1234, admin / admin1234, sysadmin / sys1234 — 실제 운영 전에는 지우거나 바꾸세요.');
else console.log(`시스템 관리자  아이디: sysadmin  임시 비밀번호: ${pw}`);
