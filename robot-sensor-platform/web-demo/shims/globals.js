// 서버 코드가 기대하는 전역 Buffer·process. (process.versions.node 는 넣지 않는다 — sql.js가 Node로 착각한다)
import { Buffer } from 'buffer';

export { Buffer };
export const process = { env: {}, argv: [], platform: 'browser', cwd: () => '/app' };
