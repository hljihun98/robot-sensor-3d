// 메모리 저장소 — 데모 모드(브라우저)와 테스트에서 사용. onChange 로 영구 저장을 붙인다.
import { TABLES } from './schema.js';

export function createMemoryStore(initial = {}, { onChange } = {}) {
  let data = Object.fromEntries(TABLES.map((t) => [t, new Map((initial[t] ?? []).map((r) => [r.id, r]))]));
  let depth = 0;
  let dirty = false;
  const changed = () => {
    if (depth === 0) onChange?.(snapshot());
    else dirty = true;
  };
  const table = (t) => data[t] ?? (() => {
    throw new Error(`알 수 없는 테이블: ${t}`);
  })();
  const clone = (v) => (v == null ? v : structuredClone(v));
  const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, [...data[t].values()]]));

  return {
    all: (t) => [...table(t).values()].map(clone),
    get: (t, id) => clone(table(t).get(id)) ?? null,
    insert(t, row) {
      if (!row.id) throw new Error('id가 필요합니다');
      if (table(t).has(row.id)) throw new Error(`중복 id: ${row.id}`);
      table(t).set(row.id, clone(row));
      changed();
    },
    update(t, id, patch) {
      const cur = table(t).get(id);
      if (!cur) throw new Error(`없는 행: ${t}/${id}`);
      table(t).set(id, { ...cur, ...clone(patch) });
      changed();
    },
    remove(t, id) {
      table(t).delete(id);
      changed();
    },
    tx(fn) {
      const backup = depth === 0 ? structuredClone(snapshot()) : null;
      depth += 1;
      try {
        const r = fn();
        depth -= 1;
        if (depth === 0 && dirty) {
          dirty = false;
          onChange?.(snapshot());
        }
        return r;
      } catch (e) {
        depth -= 1;
        if (backup) {
          data = Object.fromEntries(TABLES.map((t) => [t, new Map(backup[t].map((r) => [r.id, r]))]));
          dirty = false;
        }
        throw e;
      }
    },
    snapshot,
  };
}
