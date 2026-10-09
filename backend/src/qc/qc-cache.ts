import { projectCacheKey } from './qc-project-context';

// Short-lived shared cache for heavy QC (Oracle) reads (2026-10-07, prod was
// slow on the testing home page, the bug dashboard and the defects module).
//
// One home-page load fired ~9 requests in parallel that each ran the same
// release-defects query (7x) and cycle-progress queries (3x) — every one on a
// brand-new Oracle connection. qcMemo() makes concurrent and back-to-back
// callers share one query: the first caller runs it, everyone asking for the
// same key within the TTL (or while it is still running) gets that result.
//
// Freshness: any successful write through the QC API (status, comment, new
// defect, attachment, field edit) calls invalidateQcReadCache(), so a user
// sees their own change immediately; other QC changes show up within the TTL.
// Results are handed out as shallow copies (array / Set / Map) so one
// consumer can never reorder another's data.

export const QC_READ_TTL_MS = 60_000;

const store = new Map<string, { at: number; p: Promise<unknown> }>();
let generation = 0;

function copyOf<T>(v: T): T {
  if (Array.isArray(v)) return v.slice() as unknown as T;
  if (v instanceof Set) return new Set(v) as unknown as T;
  if (v instanceof Map) return new Map(v) as unknown as T;
  return v;
}

export function qcMemo<T>(rawKey: string, fn: () => Promise<T>, ttlMs = QC_READ_TTL_MS): Promise<T> {
  // each QC project has its own entries (2026-10-09, multi-project)
  const key = projectCacheKey(rawKey);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return (hit.p as Promise<T>).then(copyOf);
  const gen = generation;
  const p = fn();
  store.set(key, { at: now, p });
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
  // a write that landed while this query ran must not leave its stale result cached
  p.then(() => { if (gen !== generation && store.get(key)?.p === p) store.delete(key); }, () => {});
  if (store.size > 400) for (const [k, v] of store) if (now - v.at >= ttlMs) store.delete(k);
  return p.then(copyOf);
}

export function invalidateQcReadCache(): void {
  generation++;
  store.clear();
}
