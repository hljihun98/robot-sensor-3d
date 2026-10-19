// node:sqlite DatabaseSync — sql.js(WebAssembly SQLite)로 같은 동기 API를 제공한다.
import initSqlJs from 'sql.js';

let SQL = null;
let initialBytes = null;
let current = null;

export async function initSqlite(wasmUrl, bytes) {
  SQL ??= await initSqlJs({ locateFile: () => wasmUrl });
  initialBytes = bytes ?? null;
}
export const openedDatabase = () => current;

const bindable = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

export class DatabaseSync {
  constructor() {
    if (!SQL) throw new Error('sql.js가 아직 준비되지 않았습니다.');
    this.db = new SQL.Database(initialBytes ?? undefined);
    this.dirty = !initialBytes;
    current = this;
  }

  exec(sql) {
    this.db.exec(sql);
    if (!/^\s*(select|pragma\s+\w+\s*;?\s*$)/i.test(sql)) this.dirty = true;
  }

  prepare(sql) {
    const withStmt = (args, fn) => {
      const st = this.db.prepare(sql);
      try {
        st.bind(bindable(args));
        return fn(st);
      } finally {
        st.free();
      }
    };
    return {
      get: (...args) => withStmt(args, (st) => (st.step() ? st.getAsObject() : undefined)),
      all: (...args) => withStmt(args, (st) => {
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      }),
      run: (...args) => {
        this.db.run(sql, bindable(args));
        this.dirty = true;
        const changes = this.db.getRowsModified();
        const lastInsertRowid = this.db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        return { changes, lastInsertRowid };
      },
    };
  }

  close() {}

  // 저장용 바이트. sql.js는 내보낼 때 DB를 다시 열어 PRAGMA가 초기화되므로 외래 키 검사를 다시 켠다.
  takeSnapshot() {
    const bytes = this.db.export();
    this.db.exec('PRAGMA foreign_keys=ON');
    this.dirty = false;
    return bytes;
  }
}
export default { DatabaseSync };
