import { ConflictException } from '@nestjs/common';
import { prisma } from './prisma-client';

// "Someone saved this meanwhile" — optimistic concurrency for forms that save
// a whole record (CR plan, risk, QA assignment, work-plan settings, cycle
// dates / notes), user ask 2026-10-10. The screen sends the updatedAt it
// loaded (`baseUpdatedAt`); if the record changed since, the save is refused
// with 409 STALE_WRITE naming who saved it and when — instead of silently
// overwriting their work. `force: true` = "save anyway" after the user saw
// the warning. A request without baseUpdatedAt (older screen, background
// sync) is not checked.
export function assertNotStale(
  current: { updatedAt: Date; updatedByName?: string | null } | null | undefined,
  input: { baseUpdatedAt?: unknown; force?: unknown } | null | undefined,
  what: string,
): void {
  if (!current || !input || input.force === true || input.baseUpdatedAt == null || input.baseUpdatedAt === '') return;
  const base = new Date(String(input.baseUpdatedAt)).getTime();
  if (Number.isNaN(base)) return;
  if (current.updatedAt.getTime() <= base) return;
  const at = current.updatedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  const by = current.updatedByName ? ` על ידי ${current.updatedByName}` : '';
  throw new ConflictException({
    statusCode: 409,
    code: 'STALE_WRITE',
    // `what` is the full phrase, gender included: "הסיכון עודכן", "תוכנית ה-CR עודכנה"
    message: `${what} בינתיים${by} (${at}) — השינויים שלך לא נשמרו כדי לא לדרוס את שלו/ה.`,
    updatedAt: current.updatedAt.toISOString(),
    updatedBy: current.updatedByName ?? null,
  });
}

// the name saved as updatedByName (kept a few minutes per user)
const names = new Map<string, { at: number; name: string | null }>();
export async function editorName(userId: string | undefined | null): Promise<string | null> {
  if (!userId) return null;
  const hit = names.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.name;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
  const name = u?.fullName ?? null;
  names.set(userId, { at: Date.now(), name });
  return name;
}

// fields the screens send that are not columns
export function stripConcurrencyFields<T extends Record<string, any>>(o: T): Omit<T, 'baseUpdatedAt' | 'force'> {
  const { baseUpdatedAt: _b, force: _f, ...rest } = o ?? ({} as any);
  return rest;
}

// Field-level variant for screens that save one or two fields at a time (QA
// assignment, work-plan settings, cycle notes / dates): the screen sends, per
// field it changes, the value it had loaded (`base`); only if someone changed
// THAT field meanwhile is the save refused — the user's own back-to-back saves
// of other fields never collide.
const normalize = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { const t = new Date(v); return Number.isNaN(t.getTime()) ? v : t.toISOString(); }
  if (Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'string' ? v.trim() : JSON.stringify(v);
};
export function assertFieldsUnchanged(
  current: Record<string, any> | null | undefined,
  base: Record<string, unknown> | null | undefined,
  force: unknown,
  what: string,
  labels: Record<string, string> = {},
): void {
  if (!current || !base || typeof base !== 'object' || force === true) return;
  const changed = Object.keys(base).filter(k => k in current && normalize(current[k]) !== normalize(base[k]));
  if (!changed.length) return;
  const by = current.updatedByName ? ` על ידי ${current.updatedByName}` : '';
  throw new ConflictException({
    statusCode: 409,
    code: 'STALE_WRITE',
    message: `${what}: ${changed.map(k => labels[k] ?? k).join(', ')} שונה בינתיים${by} — השינוי שלך לא נשמר כדי לא לדרוס.`,
    fields: changed,
    updatedBy: current.updatedByName ?? null,
  });
}
