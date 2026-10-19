// node:fs (서버 코드가 쓰는 동기 함수만) — 가상 파일에 쓴다
import { writeFileNow } from './storage.js';

export const mkdirSync = () => {};
export const writeFileSync = (path, data) => writeFileNow(path, data);
export const existsSync = () => false;
export default { mkdirSync, writeFileSync, existsSync };
