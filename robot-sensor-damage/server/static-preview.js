// GitHub Pages와 같은 "화면 파일만" 미리보기(데모 모드) — `npm run dev:static` → http://localhost:5173
// 설치 없이 Node.js만으로 동작한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.md': 'text/plain; charset=utf-8' };
const port = Number(process.env.PORT ?? 5173);
http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(config.publicDir, url.endsWith('/') ? `${url}index.html` : url));
  if (!file.startsWith(config.publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`데모 미리보기: http://localhost:${port}`));
