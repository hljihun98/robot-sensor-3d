import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const slots = ['LIDAR_1','LIDAR_2','CAM_1','CAM_2'];
export const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
export function openDatabase(directory, initialPassword) {
  mkdirSync(join(directory, 'photos'), { recursive: true });
  mkdirSync(join(directory, 'models'), { recursive: true });
  const db = new DatabaseSync(join(directory, 'app.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,department TEXT NOT NULL DEFAULT '',role TEXT NOT NULL CHECK(role IN ('FIELD','ADMIN','SYSADMIN')),password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,must_change INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),csrf TEXT NOT NULL,expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS robots(no INTEGER PRIMARY KEY,site TEXT NOT NULL DEFAULT '미지정',shape TEXT NOT NULL CHECK(shape IN ('CYLINDER','DOME')),status TEXT NOT NULL DEFAULT 'ACTIVE',disposed_at TEXT,reason TEXT);
    CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY,label TEXT NOT NULL,file TEXT,revision INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sensors(id INTEGER PRIMARY KEY,serial TEXT UNIQUE NOT NULL,verified INTEGER NOT NULL DEFAULT 0,model TEXT NOT NULL REFERENCES models(id),status TEXT NOT NULL DEFAULT 'SPARE');
    CREATE TABLE IF NOT EXISTS mounts(id INTEGER PRIMARY KEY,robot_no INTEGER REFERENCES robots(no),sensor_id INTEGER REFERENCES sensors(id),slot TEXT NOT NULL,position TEXT NOT NULL DEFAULT '미확인',mounted_at TEXT NOT NULL,unmounted_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_sensor_mount ON mounts(sensor_id) WHERE unmounted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS one_slot_mount ON mounts(robot_no,slot) WHERE unmounted_at IS NULL;
    CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,sensor_id INTEGER REFERENCES sensors(id),robot_no INTEGER REFERENCES robots(no),reporter_id INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'SUBMITTED',payload TEXT NOT NULL,photos TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,reviewer_id INTEGER REFERENCES users(id),reason TEXT,damage_id TEXT);
    CREATE TABLE IF NOT EXISTS damages(id TEXT PRIMARY KEY,sensor_id INTEGER REFERENCES sensors(id),snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS damage_events(id INTEGER PRIMARY KEY,damage_id TEXT REFERENCES damages(id),kind TEXT NOT NULL,at TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),before_json TEXT,after_json TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',photos TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS inspections(id INTEGER PRIMARY KEY,sensor_id INTEGER REFERENCES sensors(id),at TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),result TEXT NOT NULL,note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES users(id),action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,at TEXT NOT NULL);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch(e) { db.exec('ROLLBACK'); throw e; } };
  const audit = (actor, action, target, detail = {}) => run('INSERT INTO audit_log(actor_id,action,target,detail,at) VALUES(?,?,?,?,?)', actor, action, String(target), JSON.stringify(detail), now());
  tx(() => {
    for (const [id,label] of [['CYLINDER','원통형 라이다 · 치수 미확정'],['DOME','Livox Mid-360 · 단순 모델'],['CAMERA','RealSense D405 · 단순 모델']]) run('INSERT OR IGNORE INTO models(id,label) VALUES(?,?)',id,label);
    if (!get('SELECT id FROM users LIMIT 1')) {
      const password = initialPassword || randomBytes(15).toString('base64url');
      run('INSERT INTO users(username,name,role,password_hash) VALUES(?,?,?,?)','admin','시스템 관리자','SYSADMIN',bcrypt.hashSync(password,12));
      if (!initialPassword) writeFileSync(join(directory,'initial-account.txt'),`첫 로그인 계정: admin\n임시 비밀번호: ${password}\n첫 로그인에서 비밀번호를 변경하세요. 변경 후 이 파일을 삭제하세요.\n`,{mode:0o600});
    }
    if (!get('SELECT no FROM robots LIMIT 1')) for (let no=1;no<=30;no++) {
      run('INSERT INTO robots(no,shape,status) VALUES(?,?,?)',no,no<=16?'CYLINDER':'DOME',no<=5?'DISPOSED':'ACTIVE');
      for (const slot of slots) {
        const id=Number(run('INSERT INTO sensors(serial,model,status) VALUES(?,?,?)',`UNVERIFIED-${no}-${slot}`,slot.startsWith('CAM')?'CAMERA':no<=16?'CYLINDER':'DOME',no<=5?'DISPOSED':'MOUNTED').lastInsertRowid);
        run('INSERT INTO mounts(robot_no,sensor_id,slot,mounted_at,unmounted_at) VALUES(?,?,?,?,?)',no,id,slot,now(),no<=5?now():null);
      }
    }
  });
  return {db,get,all,run,tx,audit};
}
