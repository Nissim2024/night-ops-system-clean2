import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ConfirmDialog, DialogConfig } from '../components/ConfirmDialog';

type Variant = 'danger' | 'warning' | 'info' | 'success';

interface DialogContextValue {
  alert:   (message: string, title?: string, variant?: Variant) => void;
  confirm: (message: string, title?: string, variant?: Variant) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue>({
  alert:   () => {},
  confirm: () => Promise.resolve(false),
});

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const close = useCallback(() => {
    setConfig(null);
    resolveRef.current = null;
  }, []);

  const alert = useCallback((message: string, title?: string, variant: Variant = 'info') => {
    setConfig({
      title:        title ?? (variant === 'danger' ? 'שגיאה' : variant === 'success' ? 'הצלחה' : 'הודעה'),
      message,
      variant,
      confirmLabel: 'אישור',
      onConfirm:    () => setConfig(null),
    });
  }, []);

  const confirm = useCallback((
    message: string,
    title   = 'אישור פעולה',
    variant: Variant = 'warning',
  ): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setConfig({
        title, message, variant,
        confirmLabel: 'אישור',
        cancelLabel:  'ביטול',
        onConfirm: () => { resolveRef.current?.(true);  resolveRef.current = null; setConfig(null); },
        onCancel:  () => { resolveRef.current?.(false); resolveRef.current = null; setConfig(null); },
      });
    });
  }, []);

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      <ConfirmDialog config={config} onClose={close} />
    </DialogContext.Provider>
  );
}

export const useDialog = () => useContext(DialogContext);
