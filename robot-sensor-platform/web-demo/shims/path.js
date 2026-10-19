// node:path (POSIX) — 가상 파일 경로용
export const sep = '/';
function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  p.split('/').forEach((s) => {
    if (!s || s === '.') return;
    if (s === '..') out.pop();
    else out.push(s);
  });
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
export const join = (...parts) => normalize(parts.filter(Boolean).join('/'));
export const resolve = (...parts) => {
  let p = '';
  for (const part of parts) p = part.startsWith('/') ? part : `${p}/${part}`;
  return normalize(p.startsWith('/') ? p : `/app/${p}`);
};
export const dirname = (p) => normalize(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p) => normalize(p).split('/').pop();
export const extname = (p) => /\.[^./]*$/.exec(basename(p))?.[0] ?? '';
export default { sep, join, resolve, dirname, basename, extname };
