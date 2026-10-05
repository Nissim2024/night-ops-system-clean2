import React, { useState, useEffect, useRef } from 'react';
import { C } from '../theme';
import { BrandedDialog, DialogButton } from './ui/BrandedDialog';

export interface DialogConfig {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  inputLabel?: string;
  inputPlaceholder?: string;
  inputDefaultValue?: string;
  /** Input may be left empty (prompt with an optional answer). */
  inputOptional?: boolean;
  onConfirm: (value?: string) => void | Promise<void>;
  onCancel?: () => void;
}

const VARIANTS: Record<string, { color: string; bg: string; icon: string }> = {
  // Plain glyphs, not emoji — emoji render as colored squares on some fonts
  danger:  { color: C.danger,  bg: C.dangerBg,  icon: '!' },
  warning: { color: C.warning, bg: C.warningBg, icon: '!' },
  info:    { color: C.brand,   bg: C.brandDim,  icon: 'i' },
  success: { color: C.success, bg: C.successBg, icon: '✓' },
};

interface Props {
  config: DialogConfig | null;
  onClose: () => void;
}

// Rebuilt on BrandedDialog 2026-10-05 — same API, so every useDialog() caller
// picks up the shared brand bar without code changes.
export const ConfirmDialog: React.FC<Props> = ({ config, onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (config) { setInputValue(config.inputDefaultValue ?? ''); setIsSubmitting(false); }
  }, [config]);

  const isInput = !!config?.inputLabel;
  // Focus the primary button for plain confirms so Enter confirms.
  useEffect(() => {
    if (config && !isInput) setTimeout(() => confirmRef.current?.focus(), 0);
  }, [config, isInput]);

  if (!config) return null;

  const variant = config.variant ?? (config.onCancel ? 'danger' : 'info');
  const v = VARIANTS[variant];
  const confirmLabel = config.confirmLabel ?? 'אישור';
  const canConfirm = !isInput || !!config.inputOptional || inputValue.trim().length > 0;
  const btnVariant = variant === 'info' ? 'primary' : variant;

  // onConfirm may be async (API call) — stay open with a pending state until
  // it resolves, so the dialog doesn't vanish before the underlying screen
  // has had a chance to refresh (looked like "nothing happened" otherwise).
  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await config.onConfirm(isInput ? inputValue.trim() : undefined);
      onClose();
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (isSubmitting) return;
    config.onCancel?.();
    onClose();
  };

  return (
    <BrandedDialog
      onClose={handleCancel}
      title={config.title}
      width="md"
      busy={isSubmitting}
      zIndex={20050}
      footer={
        <>
          <DialogButton ref={confirmRef} variant={btnVariant as 'primary' | 'danger' | 'warning' | 'success'} onClick={handleConfirm} disabled={!canConfirm || isSubmitting}>
            {isSubmitting ? 'מבצע...' : confirmLabel}
          </DialogButton>
          {config.onCancel !== undefined && (
            <DialogButton variant="secondary" onClick={handleCancel} disabled={isSubmitting}>
              {config.cancelLabel ?? 'ביטול'}
            </DialogButton>
          )}
        </>
      }
    >
      <div
        className="flex items-start gap-3.5"
        onKeyDown={e => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); handleConfirm(); } }}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[20px] font-black" style={{ background: v.bg, color: v.color, border: `2px solid ${v.color}`, fontFamily: 'Georgia, serif' }}>
          {v.icon}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          {config.message && (
            <p className="m-0 whitespace-pre-wrap text-[15px] leading-[1.65]" style={{ color: C.textSecondary }}>
              {config.message}
            </p>
          )}
          {isInput && (
            <div className={config.message ? 'mt-4' : ''}>
              <label className="mb-1.5 block text-sm font-bold" style={{ color: C.textPrimary }}>
                {config.inputLabel}
              </label>
              <input
                autoFocus
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={config.inputPlaceholder ?? ''}
                className="box-border w-full rounded-md px-3 py-2.5 text-[15px] outline-none"
                style={{ border: `1.5px solid ${C.borderEm}`, background: C.bgCard, color: C.textPrimary }}
                onFocus={e => (e.target.style.borderColor = C.brand)}
                onBlur={e => (e.target.style.borderColor = C.borderEm)}
              />
            </div>
          )}
        </div>
      </div>
    </BrandedDialog>
  );
};
