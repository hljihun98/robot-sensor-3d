// 센서로그 웹 데모 빌드 — `npm run build:web -- <출력 폴더>` (기본: web-demo/dist)
// 서버 코드(server/app.js)를 서비스 워커 하나로 묶고, 화면·Three.js·SQLite(wasm)를 함께 복사한다.
import { build } from 'esbuild';
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(process.argv[2] ?? join(here, 'dist'));
const shims = join(here, 'shims');
const nm = join(root, 'node_modules');

// 서버가 쓰는 Node 전용 모듈 → 브라우저용 대체 모듈 (대체 모듈 안에서 원래 라이브러리를 부를 때는 바꾸지 않는다)
const SHIMS = {
  express: 'express.js', helmet: 'helmet.js', multer: 'multer.js', sharp: 'sharp.js', qrcode: 'qrcode.js', bcryptjs: 'bcryptjs.js',
  'express-rate-limit': 'rate-limit.js', 'csv-parse/sync': 'csv-parse-sync.js',
  'node:crypto': 'crypto.js', 'node:fs': 'fs.js', 'node:fs/promises': 'fs-promises.js', 'node:path': 'path.js', 'node:url': 'url.js', 'node:sqlite': 'sqlite.js',
};
const shimPlugin = {
  name: 'sensorlog-shims',
  setup(b) {
    const filter = new RegExp(`^(${Object.keys(SHIMS).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
    b.onResolve({ filter }, (args) => {
      if (args.importer.startsWith(shims) && !args.path.startsWith('node:')) return undefined;
      return { path: join(shims, SHIMS[args.path]) };
    });
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'app', 'vendor', 'addons'), { recursive: true });

await build({
  entryPoints: [join(here, 'sw.js')],
  outfile: join(out, 'sw.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox110', 'safari16'],
  minify: true,
  legalComments: 'none',
  inject: [join(shims, 'globals.js')],
  define: { 'import.meta.url': '"file:///app/server/app.js"' },
  plugins: [shimPlugin],
  logLevel: 'warning',
});

await copyFile(join(nm, 'sql.js', 'dist', 'sql-wasm.wasm'), join(out, 'sql-wasm.wasm'));
await copyFile(join(here, 'bootstrap.html'), join(out, 'index.html'));
await cp(join(root, 'public'), join(out, 'app'), { recursive: true });
await copyFile(join(nm, 'three', 'build', 'three.module.js'), join(out, 'app', 'vendor', 'three.js'));
await copyFile(join(nm, 'three', 'build', 'three.core.js'), join(out, 'app', 'vendor', 'three.core.js'));
for (const f of ['controls/OrbitControls.js', 'loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js']) {
  await mkdir(dirname(join(out, 'app', 'vendor', 'addons', f)), { recursive: true });
  await copyFile(join(nm, 'three', 'examples', 'jsm', f), join(out, 'app', 'vendor', 'addons', f));
}
console.log(`웹 데모를 만들었습니다: ${out}`);
