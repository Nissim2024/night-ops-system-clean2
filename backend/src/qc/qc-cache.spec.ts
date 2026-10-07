import { qcMemo, invalidateQcReadCache } from './qc-cache';

describe('qcMemo — shared short-lived QC read cache', () => {
  beforeEach(() => invalidateQcReadCache());

  it('parallel callers share ONE query', async () => {
    let runs = 0;
    const q = () => new Promise<number[]>(r => setTimeout(() => { runs++; r([1, 2, 3]); }, 20));
    const all = await Promise.all(Array.from({ length: 7 }, () => qcMemo('defects|v1', q)));
    expect(runs).toBe(1);
    expect(all.every(a => a.length === 3)).toBe(true);
  });

  it('each caller gets its own array (sorting one does not reorder another)', async () => {
    const a = await qcMemo('k', async () => [3, 1, 2]);
    a.sort();
    const b = await qcMemo('k', async () => [9]);
    expect(b).toEqual([3, 1, 2]);
  });

  it('different keys do not share', async () => {
    let runs = 0;
    await qcMemo('defects|v1', async () => { runs++; return []; });
    await qcMemo('defects|v2', async () => { runs++; return []; });
    expect(runs).toBe(2);
  });

  it('expires after the TTL', async () => {
    let runs = 0;
    const q = async () => { runs++; return runs; };
    await qcMemo('t', q, 10);
    await new Promise(r => setTimeout(r, 25));
    expect(await qcMemo('t', q, 10)).toBe(2);
  });

  it('a write (invalidate) forces fresh data — also for a query that was running during the write', async () => {
    let v = 1;
    const slow = () => new Promise<number>(r => setTimeout(() => r(v), 20));
    const inFlight = qcMemo('x', slow);
    v = 2; invalidateQcReadCache();
    await inFlight;
    expect(await qcMemo('x', slow)).toBe(2);
  });

  it('a failed query is not cached', async () => {
    await expect(qcMemo('f', async () => { throw new Error('ORA-12170'); })).rejects.toThrow('ORA-12170');
    expect(await qcMemo('f', async () => 'ok')).toBe('ok');
  });
});
