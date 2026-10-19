// 서버 공용: DB 열기, 서비스 의존성(시간·ID·비밀번호·사진 저장), 초기 데이터
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config, dbFile, photoDir } from './config.js';
import { openDatabase, createSqliteStore } from './store.js';
import { createService } from '../public/js/core/service.js';
import { buildSeed } from '../public/js/core/seed.js';
import { TABLES } from '../public/js/core/schema.js';

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => dayFmt.format(new Date());
export const now = () => new Date().toISOString();
export const uid = (p) => `${p}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => {
  try {
    return bcrypt.compareSync(pw, hash ?? '');
  } catch {
    return false;
  }
};

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function writeDataUrl(dataUrl, file) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!m) {
    const err = new Error('사진은 JPEG·PNG·WEBP만 올릴 수 있습니다.');
    err.status = 400;
    throw err;
  }
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.maxPhotoBytes) {
    const err = new Error('사진 한 장이 너무 큽니다.');
    err.status = 413;
    throw err;
  }
  const out = `${file}.${MIME_EXT[m[1]]}`;
  fs.writeFileSync(out, buf);
  return path.basename(out);
}

export function savePhoto({ id, full, thumb }) {
  const d = today();
  const rel = path.join(d.slice(0, 4), d.slice(5, 7));
  const dir = path.join(photoDir(), rel);
  fs.mkdirSync(dir, { recursive: true });
  const a = writeDataUrl(full, path.join(dir, id));
  const b = writeDataUrl(thumb ?? full, path.join(dir, `${id}_t`));
  const url = (name) => `files/photos/${rel.split(path.sep).join('/')}/${name}`;
  return { src: url(a), thumb: url(b) };
}

export function openApp() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(photoDir(), { recursive: true });
  const db = openDatabase(dbFile());
  const store = createSqliteStore(db);
  const service = createService(store, { now, today, uid, hashPassword, verifyPassword, savePhoto });
  return { db, store, service };
}

export function isEmpty(store) {
  return store.all('users').length === 0;
}

export function seedDatabase(store, { withSamples = false, password } = {}) {
  let pw = password || config.initialAdminPassword || '';
  if (pw.length < 8) {
    if (pw) console.warn('INIT_ADMIN_PASSWORD가 8자보다 짧아 무작위 비밀번호를 대신 만듭니다.');
    pw = crypto.randomBytes(9).toString('base64url');
  }
  const data = buildSeed({ withSamples, hashPassword, now, sysadminPassword: pw });
  store.tx(() => TABLES.forEach((t) => data[t].forEach((row) => store.insert(t, row))));
  return withSamples ? null : pw;
}
