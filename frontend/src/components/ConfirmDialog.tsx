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
  danger:  { btn: '#e74c3c', icon: '⚠️' },
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={{ background: 'white', borderRadius: '14px', maxWidth: '440px', width: '90%', boxShadow: '0 12px 48px rgba(0,0,0,0.35)', direction: 'rtl', overflow: 'hidden' }}
        onKeyDown={handleKeyDown}
      >
        {/* ── Logo header ── */}
        <div style={{ background: '#1a2332', padding: '11px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Owl SVG inline — compact version for dialog header */}
          <svg width="28" height="30" viewBox="0 0 48 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="24" cy="38" rx="14" ry="12" fill="#2d4a7a" />
            <circle cx="24" cy="18" r="14" fill="#2d4a7a" />
            <polygon points="12,4 10,14 16,14" fill="#2d4a7a" />
            <polygon points="36,4 38,14 32,14" fill="#2d4a7a" />
            <circle cx="17" cy="18" r="6.5" fill="rgba(255,255,255,0.95)" />
            <circle cx="31" cy="18" r="6.5" fill="rgba(255,255,255,0.95)" />
            <circle cx="17" cy="18" r="4" fill="#3498db" />
            <circle cx="31" cy="18" r="4" fill="#3498db" />
            <circle cx="17" cy="18" r="2.2" fill="#0d0d1a" />
            <circle cx="31" cy="18" r="2.2" fill="#0d0d1a" />
            <circle cx="18.2" cy="16.8" r="1" fill="white" />
            <circle cx="32.2" cy="16.8" r="1" fill="white" />
            <polygon points="21,22 27,22 24,26.5" fill="#f0a030" />
          </svg>
          <span style={{ fontWeight: '900', fontFamily: "'Arial Black', Arial, sans-serif", fontSize: '17px', letterSpacing: '-0.5px' }}>
            <span style={{ color: 'white' }}>Deploy</span><span style={{ color: '#3498db' }}>Center</span>
          </span>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: '24px 32px 28px' }}>
        <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '10px' }}>{colors.icon}</div>
        <h3 style={{ margin: '0 0 12px', color: '#1a2332', textAlign: 'center', fontSize: '18px' }}>{config.title}</h3>

        {config.message && (
          <p style={{ margin: '0 0 18px', color: '#444', fontSize: '15px', lineHeight: 1.65, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
            {config.message}
          </p>
        )}

        {isInput && (
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '15px', color: '#333' }}>
              {config.inputLabel}
            </label>
            <input
              autoFocus
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={config.inputPlaceholder ?? ''}
              style={{ width: '100%', padding: '10px 12px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
              onFocus={e => (e.target.style.borderColor = '#2d4a7a')}
              onBlur={e => (e.target.style.borderColor = '#e0e0e0')}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          {config.onCancel !== undefined && (
            <button
              onClick={handleCancel}
              style={{ padding: '10px 22px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', minWidth: '90px' }}
            >
              {config.cancelLabel ?? 'ביטול'}
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{ padding: '10px 22px', background: canConfirm ? colors.btn : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: '15px', fontWeight: 'bold', minWidth: '90px' }}
          >
            {confirmLabel}
          </button>
        </div>
        </div>{/* end content */}
      </div>
    </div>
  );
};
