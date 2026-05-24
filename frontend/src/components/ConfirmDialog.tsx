import React, { useState, useEffect } from 'react';

export interface DialogConfig {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  inputLabel?: string;
  inputPlaceholder?: string;
  inputDefaultValue?: string;
  onConfirm: (value?: string) => void;
  onCancel?: () => void;
}

const VARIANT_COLORS: Record<string, { btn: string; icon: string }> = {
  danger:  { btn: '#e74c3c', icon: '🗑' },
  warning: { btn: '#e67e22', icon: '⚠️' },
  info:    { btn: '#2d4a7a', icon: 'ℹ️' },
  success: { btn: '#27ae60', icon: '✅' },
};

interface Props {
  config: DialogConfig | null;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({ config, onClose }) => {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (config) setInputValue(config.inputDefaultValue ?? '');
  }, [config]);

  if (!config) return null;

  const variant = config.variant ?? (config.onCancel ? 'danger' : 'info');
  const colors = VARIANT_COLORS[variant];
  const isInput = !!config.inputLabel;
  const confirmLabel = config.confirmLabel ?? 'אישור';
  const canConfirm = !isInput || inputValue.trim().length > 0;

  const handleConfirm = () => {
    config.onConfirm(isInput ? inputValue.trim() : undefined);
    onClose();
  };

  const handleCancel = () => {
    config.onCancel?.();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canConfirm) handleConfirm();
    if (e.key === 'Escape') handleCancel();
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={{ background: 'white', borderRadius: '14px', padding: '28px 32px', maxWidth: '440px', width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,0.3)', direction: 'rtl' }}
        onKeyDown={handleKeyDown}
      >
        <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '10px' }}>{colors.icon}</div>
        <h3 style={{ margin: '0 0 12px', color: '#1a2332', textAlign: 'center', fontSize: '18px' }}>{config.title}</h3>

        {config.message && (
          <p style={{ margin: '0 0 18px', color: '#444', fontSize: '14px', lineHeight: 1.65, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
            {config.message}
          </p>
        )}

        {isInput && (
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '13px', color: '#333' }}>
              {config.inputLabel}
            </label>
            <input
              autoFocus
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={config.inputPlaceholder ?? ''}
              style={{ width: '100%', padding: '10px 12px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
              onFocus={e => (e.target.style.borderColor = '#2d4a7a')}
              onBlur={e => (e.target.style.borderColor = '#e0e0e0')}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          {config.onCancel !== undefined && (
            <button
              onClick={handleCancel}
              style={{ padding: '10px 22px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', minWidth: '90px' }}
            >
              {config.cancelLabel ?? 'ביטול'}
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{ padding: '10px 22px', background: canConfirm ? colors.btn : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold', minWidth: '90px' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
