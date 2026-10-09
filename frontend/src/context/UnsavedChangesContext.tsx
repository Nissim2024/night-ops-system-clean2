import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { BrandedDialog, DialogButton } from '../components/ui/BrandedDialog';

// Unsaved-changes guard (user, 2026-10-09). A screen with edits that are not
// yet written anywhere (the defect form, the create-defect form) registers a
// guard; then
//   - any click in the app shell (sidebar, top bar, notification toasts —
//     marked data-leave-guard) is held until the user decides,
//   - the screen's own "back" / "cancel" asks the same via confirmLeave(),
//   - refresh / closing the tab gets the browser's own "leave site?" prompt.
// The dialog offers: save and leave / leave without saving / stay.

export interface LeaveGuard {
  /** how many unsaved changes there are right now (0 = nothing to lose) */
  count: () => number;
  /** what is unsaved, e.g. "שינויים בתקלה #57953" */
  label: () => string;
  /** write the changes; resolve true when they were saved */
  save?: () => Promise<boolean>;
  /** the user chose to leave without saving */
  discard?: () => void;
}

interface Ctx {
  register: (g: LeaveGuard) => () => void;
  /** resolves true when it is OK to leave (nothing unsaved, saved, or discarded) */
  confirmLeave: () => Promise<boolean>;
}

const UnsavedChangesContext = createContext<Ctx>({
  register: () => () => {},
  confirmLeave: () => Promise.resolve(true),
});

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const guards = useRef(new Set<LeaveGuard>());
  const [ask, setAsk] = useState<{ count: number; label: string; canSave: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const bypass = useRef(false);

  const dirty = () => Array.from(guards.current).filter(g => g.count() > 0);

  const register = useCallback((g: LeaveGuard) => {
    guards.current.add(g);
    return () => { guards.current.delete(g); };
  }, []);

  const confirmLeave = useCallback((): Promise<boolean> => {
    const d = dirty();
    if (d.length === 0) return Promise.resolve(true);
    if (resolver.current) return Promise.resolve(false);   // a dialog is already open
    setSaveError(false);
    setAsk({
      count: d.reduce((n, g) => n + g.count(), 0),
      label: d.map(g => g.label()).join(' · '),
      canSave: d.every(g => !!g.save),
    });
    return new Promise<boolean>(res => { resolver.current = res; });
  }, []);

  const finish = (ok: boolean) => {
    setAsk(null);
    setSaving(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(ok);
  };
  const onSave = async () => {
    setSaving(true);
    setSaveError(false);
    let ok = true;
    for (const g of dirty()) ok = (await g.save?.().catch(() => false)) !== false && ok;
    if (ok) finish(true);
    else { setSaving(false); setSaveError(true); }   // stay; the screen shows QC's error
  };
  const onDiscard = () => { for (const g of dirty()) g.discard?.(); finish(true); };
  const onStay = () => finish(false);

  // shell clicks (sidebar / top bar / toasts): hold the click, ask, then replay it
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bypass.current || dirty().length === 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('[data-leave-guard]')) return;
      e.preventDefault();
      e.stopPropagation();
      confirmLeave().then(ok => {
        if (!ok) return;
        bypass.current = true;
        try { target.click(); } finally { bypass.current = false; }
      });
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty().length === 0) return;
      e.preventDefault();
      e.returnValue = '';   // the browser shows its own "leave site?" text
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [confirmLeave]);

  return (
    <UnsavedChangesContext.Provider value={{ register, confirmLeave }}>
      {children}
      <BrandedDialog
        open={!!ask} onClose={onStay} closeOnBackdrop={false} busy={saving} zIndex={6000} width="sm"
        icon="⚠" title="יש שינויים שלא נשמרו"
        footer={<>
          {ask?.canSave && <DialogButton variant="primary" onClick={onSave} disabled={saving}>{saving ? 'מעדכן ב-QC…' : 'עדכן ב-QC וצא'}</DialogButton>}
          <DialogButton variant="danger" onClick={onDiscard} disabled={saving}>צא בלי לשמור</DialogButton>
          <DialogButton variant="secondary" onClick={onStay} disabled={saving}>הישאר בטופס</DialogButton>
        </>}
      >
        <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
          <div>{ask?.label}: <b>{ask?.count}</b> {ask?.count === 1 ? 'שינוי שלא נשמר' : 'שינויים שלא נשמרו'} ב-QC.</div>
          <div className="text-muted-foreground">יציאה בלי לשמור תמחק אותם.</div>
          {saveError && <div className="font-semibold text-danger">העדכון ל-QC נכשל — השינויים נשארו בטופס. ראה את ההודעה בראש הטופס.</div>}
        </div>
      </BrandedDialog>
    </UnsavedChangesContext.Provider>
  );
}

export const useUnsavedChanges = () => useContext(UnsavedChangesContext);

/** Register a guard for as long as the calling component is mounted. The
 *  guard object can change every render — the latest one is always used. */
export function useLeaveGuard(guard: LeaveGuard) {
  const { register } = useUnsavedChanges();
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(() => register({
    count: () => latest.current.count(),
    label: () => latest.current.label(),
    save: guard.save ? () => latest.current.save?.() ?? Promise.resolve(true) : undefined,
    discard: () => latest.current.discard?.(),
  }), [register, !!guard.save]);   // eslint-disable-line react-hooks/exhaustive-deps
}
