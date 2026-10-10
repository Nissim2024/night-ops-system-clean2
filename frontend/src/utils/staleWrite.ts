// "Someone saved this meanwhile" (backend stale-write.ts, 2026-10-10): a save
// refused with 409 STALE_WRITE asks the user what to do instead of failing
// silently or overwriting a colleague's work.
export const isStaleWrite = (e: any): boolean =>
  e?.response?.status === 409 && e?.response?.data?.code === 'STALE_WRITE';

type Confirm = (message: string, title?: string, variant?: 'danger' | 'warning' | 'info' | 'success', labels?: { confirm?: string; cancel?: string }) => Promise<boolean>;

/**
 * Handles a STALE_WRITE refusal: returns 'force' when the user chose to save
 * anyway (resend with force: true), 'reload' when they chose to load the
 * colleague's version, or null when the error is something else.
 */
export async function askStaleWrite(e: any, confirm: Confirm): Promise<'force' | 'reload' | null> {
  if (!isStaleWrite(e)) return null;
  const msg = String(e.response.data.message ?? 'הרשומה עודכנה בינתיים על ידי משתמש אחר.');
  const force = await confirm(
    `${msg}\n\nלטעון את הגרסה העדכנית (השינויים שלך יאבדו), או לשמור בכל זאת ולדרוס את השינוי שלו/ה?`,
    'עודכן בינתיים על ידי משתמש אחר', 'warning',
    { confirm: 'שמור בכל זאת', cancel: 'טען את העדכני' },
  );
  return force ? 'force' : 'reload';
}
