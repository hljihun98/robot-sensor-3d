// node:fs/promises — 가상 파일
import { writeFileNow, readFileAsync, removeFileNow } from './storage.js';

export const writeFile = async (path, data) => writeFileNow(path, data);
export const readFile = async (path, enc) => {
  const bytes = await readFileAsync(path);
  if (!bytes) {
    const err = new Error(`ENOENT: ${path}`);
    err.code = 'ENOENT';
    throw err;
  }
  return enc ? new TextDecoder().decode(bytes) : Buffer.from(bytes);
};
export const unlink = async (path) => removeFileNow(path);
export const mkdir = async () => {};
export default { writeFile, readFile, unlink, mkdir };
