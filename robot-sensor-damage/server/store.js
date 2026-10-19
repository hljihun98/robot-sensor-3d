// SQLite 저장소 — Node.js 내장 node:sqlite 사용(별도 설치 없음, Node 22.13 이상)
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, TABLES } from '../public/js/core/schema.js';

const SQL_TYPE = { text: 'TEXT', int: 'INTEGER', real: 'REAL', json: 'TEXT' };
const INDEXES = [
  ['damages', 'sensor_id'], ['damage_events', 'damage_id'], ['damage_events', 'sensor_id'], ['mounts', 'robot_id'],
  ['mounts', 'sensor_id'], ['reports', 'sensor_id'], ['reports', 'status'], ['photos', 'owner_id'], ['inspections', 'sensor_id'],
  ['sessions', 'user_id'], ['audit_log', 'at'],
];

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  TABLES.forEach((t) => {
    const cols = Object.entries(SCHEMA[t]).map(([c, type]) => `${c} ${SQL_TYPE[type]}${c === 'id' ? ' PRIMARY KEY' : ''}`);
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (${cols.join(', ')})`);
    // 간단 마이그레이션: 새로 생긴 컬럼 추가
    const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
    Object.entries(SCHEMA[t]).forEach(([c, type]) => {
      if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${SQL_TYPE[type]}`);
    });
  });
  INDEXES.forEach(([t, c]) => db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_${c} ON ${t}(${c})`));
  return db;
}

export function createSqliteStore(db) {
  const cache = new Map();
  const stmt = new Map();
  const prep = (sql) => {
    if (!stmt.has(sql)) stmt.set(sql, db.prepare(sql));
    return stmt.get(sql);
  };
  const cols = (t) => {
    const s = SCHEMA[t];
    if (!s) throw new Error(`알 수 없는 테이블: ${t}`);
    return s;
  };
  const encode = (t, row) => {
    const s = cols(t);
    const out = {};
    Object.keys(row).forEach((k) => {
      if (!(k in s)) return;
      const v = row[k];
      out[k] = s[k] === 'json' ? (v === undefined || v === null ? null : JSON.stringify(v)) : v === undefined ? null : typeof v === 'boolean' ? Number(v) : v;
    });
    return out;
  };
  const decode = (t, row) => {
    if (!row) return null;
    const s = cols(t);
    const out = {};
    Object.keys(s).forEach((k) => {
      const v = row[k];
      out[k] = s[k] === 'json' && typeof v === 'string' ? JSON.parse(v) : v ?? null;
    });
    return out;
  };
  const touch = (t) => cache.delete(t);
  let depth = 0;

  return {
    all(t) {
      cols(t);
      if (!cache.has(t)) cache.set(t, prep(`SELECT * FROM ${t}`).all().map((r) => decode(t, r)));
      return cache.get(t).slice();
    },
    get(t, id) {
      if (cache.has(t)) return cache.get(t).find((r) => r.id === id) ?? null;
      return decode(t, prep(`SELECT * FROM ${t} WHERE id = ?`).get(id));
    },
    insert(t, row) {
      const e = encode(t, row);
      const keys = Object.keys(e);
      prep(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => e[k]));
      touch(t);
    },
    update(t, id, patch) {
      const e = encode(t, patch);
      delete e.id;
      const keys = Object.keys(e);
      if (!keys.length) return;
      const r = prep(`UPDATE ${t} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => e[k]), id);
      if (!r.changes) throw new Error(`없는 행: ${t}/${id}`);
      touch(t);
    },
    remove(t, id) {
      prep(`DELETE FROM ${t} WHERE id = ?`).run(id);
      touch(t);
    },
    tx(fn) {
      if (depth > 0) {
        depth += 1;
        try {
          return fn();
        } finally {
          depth -= 1;
        }
      }
      depth = 1;
      let ok = false;
      try {
        db.exec('BEGIN');
        const r = fn();
        db.exec('COMMIT');
        ok = true;
        return r;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* 이미 끝난 트랜잭션 */
        }
        throw e;
      } finally {
        depth = 0;
        if (!ok) cache.clear();
      }
    },
    clearCache: () => cache.clear(),
  };
}
