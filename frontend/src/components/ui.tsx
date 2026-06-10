/**
 * NightOps UI Kit v3 — Asana-Inspired Light Theme
 */
import React, { useState } from 'react';
import { C, FONT, FONT_MONO, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE,
         statusColor, statusBg, statusLabel,
         versionStatusColor, versionStatusBg, versionStatusLabel } from '../theme';

// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'outline';
type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

const BTN_BASE: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: WEIGHT.semibold,
  border: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: SP[2],
  outline: 'none',
  whiteSpace: 'nowrap',
  transition: EASE.fast,
  userSelect: 'none',
  textDecoration: 'none',
};

const BTN_SIZES: Record<ButtonSize, React.CSSProperties> = {
  xs: { ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 10px', borderRadius: RADIUS.sm },
  sm: { ...TEXT.sm, fontWeight: WEIGHT.semibold, padding: '5px 12px', borderRadius: RADIUS.md },
  md: { ...TEXT.base, padding: '7px 14px', borderRadius: RADIUS.md },
  lg: { ...TEXT.md, padding: '9px 18px', borderRadius: RADIUS.lg },
};

const BTN_VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { background: C.brand, color: '#fff', boxShadow: SHADOW.xs },
  secondary: { background: C.bgCard, color: C.textSecondary, border: `1px solid ${C.borderEm}`, boxShadow: SHADOW.xs },
  ghost:     { background: 'transparent', color: C.textMuted },
  danger:    { background: C.dangerBg, color: C.danger, border: `1px solid rgba(240,106,106,0.30)` },
  success:   { background: C.successBg, color: C.success, border: `1px solid rgba(55,196,122,0.30)` },
  warning:   { background: C.warningBg, color: C.warning, border: `1px solid rgba(232,175,0,0.30)` },
  outline:   { background: 'transparent', color: C.textSecondary, border: `1px solid ${C.borderEm}` },
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary', size = 'md', loading, icon, iconRight, fullWidth,
  children, style, disabled, ...props
}) => {
  const [hov, setHov] = useState(false);
  const dis = disabled || loading;

  const hovStyle: React.CSSProperties = hov && !dis ? {
    filter: 'brightness(0.94)',
    transform: 'translateY(-1px)',
    boxShadow: SHADOW.sm,
  } : {};

  return (
    <button {...props} disabled={dis}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        ...BTN_BASE, ...BTN_SIZES[size], ...BTN_VARIANTS[variant],
        width: fullWidth ? '100%' : undefined,
        opacity: dis ? 0.45 : 1,
        cursor: dis ? 'not-allowed' : 'pointer',
        ...hovStyle, ...style,
      }}
    >
      {loading ? <Spinner size={13} color="currentColor" /> : icon}
      {children}
      {iconRight}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  padding?: keyof typeof SP | 'none';
  variant?: 'default' | 'flat' | 'ghost' | 'outlined';
  hover?: boolean;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children, style, padding = 6, variant = 'default', hover, onClick,
}) => {
  const [hov, setHov] = useState(false);
  const pad = padding === 'none' ? '0' : SP[padding as keyof typeof SP] ?? SP[6];

  const variants: Record<string, React.CSSProperties> = {
    default:  { background: C.bgCard, border: `1px solid ${C.border}`, boxShadow: SHADOW.card },
    flat:     { background: C.bgNested, border: `1px solid ${C.border}` },
    ghost:    { background: 'transparent' },
    outlined: { background: C.bgCard, border: `1px solid ${C.borderEm}` },
  };

  const hovStyle: React.CSSProperties = (hover || onClick) && hov ? {
    boxShadow: SHADOW.md,
    borderColor: C.borderEm,
  } : {};

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: RADIUS.xl, padding: pad,
        transition: EASE.standard, cursor: onClick ? 'pointer' : undefined,
        ...variants[variant], ...hovStyle, ...style,
      }}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StatusChip
// ─────────────────────────────────────────────────────────────────────────────

interface StatusChipProps {
  status: string;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
  style?: React.CSSProperties;
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, size = 'sm', dot, style }) => {
  const color = statusColor(status);
  const bg    = statusBg(status);
  const label = statusLabel(status);

  const sizes = {
    xs: { ...TEXT.xs, padding: '2px 7px', borderRadius: RADIUS.full, gap: '4px' },
    sm: { ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 9px', borderRadius: RADIUS.full, gap: '5px' },
    md: { ...TEXT.sm, fontWeight: WEIGHT.semibold, padding: '4px 11px', borderRadius: RADIUS.full, gap: '6px' },
  };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontFamily: FONT,
      color, background: bg, border: `1px solid ${color}30`,
      ...sizes[size], ...style,
    }}>
      {dot && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />}
      {label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// VersionStatusChip
// ─────────────────────────────────────────────────────────────────────────────

export const VersionStatusChip: React.FC<{ status: string; size?: 'xs' | 'sm' | 'md'; style?: React.CSSProperties }> = ({ status, size = 'sm', style }) => {
  const color = versionStatusColor[status] ?? C.textMuted;
  const bg    = versionStatusBg[status]    ?? 'transparent';
  const label = versionStatusLabel[status] ?? status;

  const sizes = {
    xs: { ...TEXT.xs, padding: '2px 8px', borderRadius: RADIUS.full },
    sm: { ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 10px', borderRadius: RADIUS.full },
    md: { ...TEXT.sm, fontWeight: WEIGHT.semibold, padding: '4px 12px', borderRadius: RADIUS.full },
  };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontFamily: FONT, color, background: bg, border: `1px solid ${color}30`,
      ...sizes[size], ...style,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PriorityChip — Asana-style High/Medium/Low
// ─────────────────────────────────────────────────────────────────────────────

interface PriorityChipProps {
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | string;
  size?: 'xs' | 'sm';
  style?: React.CSSProperties;
}

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  HIGH:     { label: 'גבוהה',   color: C.priorityHigh,   bg: C.priorityBgHigh },
  CRITICAL: { label: 'קריטי',   color: C.priorityHigh,   bg: C.priorityBgHigh },
  MEDIUM:   { label: 'בינונית', color: C.priorityMedium, bg: C.priorityBgMedium },
  LOW:      { label: 'נמוכה',   color: C.priorityLow,    bg: C.priorityBgLow },
};

export const PriorityChip: React.FC<PriorityChipProps> = ({ priority, size = 'sm', style }) => {
  const meta = PRIORITY_META[priority?.toUpperCase()] ?? { label: priority, color: C.textMuted, bg: C.bgHover };
  const sz = size === 'xs'
    ? { ...TEXT.xs, padding: '2px 7px', borderRadius: RADIUS.full }
    : { ...TEXT.xs, fontWeight: WEIGHT.semibold, padding: '3px 9px', borderRadius: RADIUS.full };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontFamily: FONT,
      color: meta.color, background: meta.bg,
      border: `1px solid ${meta.color}30`,
      ...sz, ...style,
    }}>
      {meta.label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Badge
// ─────────────────────────────────────────────────────────────────────────────

interface BadgeProps {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({ children, color = C.textMuted, bg = C.bgHover, style }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    ...TEXT.xs, fontWeight: WEIGHT.semibold, fontFamily: FONT,
    color, background: bg, padding: '2px 7px', borderRadius: RADIUS.full, lineHeight: '16px',
    ...style,
  }}>
    {children}
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// TextField
// ─────────────────────────────────────────────────────────────────────────────

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  inputStyle?: React.CSSProperties;
}

export const TextField: React.FC<TextFieldProps> = ({
  label, hint, error, icon, iconRight, fullWidth, inputStyle, style, id, ...props
}) => {
  const [focused, setFocused] = useState(false);
  const elId = id ?? `field-${Math.random().toString(36).slice(2,8)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], width: fullWidth ? '100%' : undefined, ...style }}>
      {label && (
        <label htmlFor={elId} style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textSecondary, fontFamily: FONT }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {icon && (
          <span style={{ position: 'absolute', right: '10px', color: C.textMuted, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
            {icon}
          </span>
        )}
        <input id={elId} {...props}
          onFocus={e => { setFocused(true); props.onFocus?.(e); }}
          onBlur={e  => { setFocused(false); props.onBlur?.(e); }}
          style={{
            fontFamily: FONT, ...TEXT.base, color: C.textPrimary,
            background: C.bgCard,
            border: `1px solid ${error ? C.danger : focused ? C.borderFocus : C.borderEm}`,
            borderRadius: RADIUS.md,
            padding: `${SP[2]} ${iconRight ? SP[8] : SP[3]} ${SP[2]} ${icon ? SP[8] : SP[3]}`,
            width: fullWidth ? '100%' : undefined,
            outline: 'none',
            boxShadow: focused ? (error ? `0 0 0 2px ${C.danger}30` : `0 0 0 2px ${C.borderFocus}25`) : SHADOW.inset,
            transition: EASE.fast, boxSizing: 'border-box',
            ...inputStyle,
          }}
        />
        {iconRight && (
          <span style={{ position: 'absolute', left: '10px', color: C.textMuted, display: 'flex', alignItems: 'center' }}>
            {iconRight}
          </span>
        )}
      </div>
      {(hint || error) && (
        <span style={{ ...TEXT.xs, color: error ? C.danger : C.textMuted, fontFamily: FONT }}>{error ?? hint}</span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TextArea
// ─────────────────────────────────────────────────────────────────────────────

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; hint?: string; fullWidth?: boolean;
}

export const TextArea: React.FC<TextAreaProps> = ({ label, hint, fullWidth, style, id, ...props }) => {
  const [focused, setFocused] = useState(false);
  const elId = id ?? `ta-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], width: fullWidth ? '100%' : undefined, ...style }}>
      {label && <label htmlFor={elId} style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textSecondary, fontFamily: FONT }}>{label}</label>}
      <textarea id={elId} {...props}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e  => { setFocused(false); props.onBlur?.(e); }}
        style={{
          fontFamily: FONT, ...TEXT.base, color: C.textPrimary, background: C.bgCard,
          border: `1px solid ${focused ? C.borderFocus : C.borderEm}`,
          borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`,
          resize: 'vertical', outline: 'none',
          boxShadow: focused ? `0 0 0 2px ${C.borderFocus}25` : SHADOW.inset,
          transition: EASE.fast, width: fullWidth ? '100%' : undefined,
          boxSizing: 'border-box', minHeight: '80px',
        }}
      />
      {hint && <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{hint}</span>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Select
// ─────────────────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; fullWidth?: boolean; children: React.ReactNode;
}

export const Select: React.FC<SelectProps> = ({ label, fullWidth, style, id, children, ...props }) => {
  const [focused, setFocused] = useState(false);
  const elId = id ?? `sel-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], width: fullWidth ? '100%' : undefined, ...style }}>
      {label && <label htmlFor={elId} style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: C.textSecondary, fontFamily: FONT }}>{label}</label>}
      <select id={elId} {...props}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e  => { setFocused(false); props.onBlur?.(e); }}
        style={{
          fontFamily: FONT, ...TEXT.base, color: C.textPrimary, background: C.bgCard,
          border: `1px solid ${focused ? C.borderFocus : C.borderEm}`,
          borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, outline: 'none',
          boxShadow: focused ? `0 0 0 2px ${C.borderFocus}25` : SHADOW.inset,
          transition: EASE.fast, width: fullWidth ? '100%' : undefined, cursor: 'pointer',
          appearance: 'none', WebkitAppearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237F7F7F'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'left 12px center', paddingLeft: '30px',
        }}
      >
        {children}
      </select>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

export const Spinner: React.FC<{ size?: number; color?: string; style?: React.CSSProperties }> = ({
  size = 18, color = C.brand, style,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0, ...style }}>
    <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.20" strokeWidth="2.5" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────────

export const Divider: React.FC<{ style?: React.CSSProperties; label?: string }> = ({ style, label }) => (
  label ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[3], ...style }}>
      <div style={{ flex: 1, height: '1px', background: C.border }} />
      <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: C.border }} />
    </div>
  ) : (
    <div style={{ height: '1px', background: C.border, ...style }} />
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Alert
// ─────────────────────────────────────────────────────────────────────────────

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';
interface AlertProps {
  variant?: AlertVariant; title?: string; children: React.ReactNode;
  onClose?: () => void; style?: React.CSSProperties; icon?: React.ReactNode;
}

const ALERT_COLORS: Record<AlertVariant, { color: string; bg: string; border: string }> = {
  info:    { color: C.info,    bg: C.infoBg,    border: `rgba(69,115,210,0.25)` },
  success: { color: C.success, bg: C.successBg, border: `rgba(55,196,122,0.25)` },
  warning: { color: C.warning, bg: C.warningBg, border: `rgba(232,175,0,0.25)` },
  danger:  { color: C.danger,  bg: C.dangerBg,  border: `rgba(240,106,106,0.25)` },
};

const ALERT_ICONS: Record<AlertVariant, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚫' };

export const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, onClose, style, icon }) => {
  const { color, bg, border } = ALERT_COLORS[variant];
  return (
    <div style={{
      display: 'flex', gap: SP[3], alignItems: 'flex-start',
      background: bg, border: `1px solid ${border}`, borderRadius: RADIUS.lg,
      padding: `${SP[3]} ${SP[4]}`, ...style,
    }}>
      <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>{icon ?? ALERT_ICONS[variant]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color, fontFamily: FONT, marginBottom: '2px' }}>{title}</div>}
        <div style={{ ...TEXT.sm, color, fontFamily: FONT }}>{children}</div>
      </div>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color, opacity: 0.6, padding: '2px', flexShrink: 0 }}>✕</button>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean; onClose?: () => void; title?: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode;
  width?: number | string; style?: React.CSSProperties;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, children, footer, width = 560, style }) => {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: C.bgOverlay,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: SP[4], backdropFilter: 'blur(2px)',
      animation: 'fadeIn 0.15s ease',
    }}>
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideUp{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width, maxWidth: '100%', maxHeight: '90vh',
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: RADIUS['2xl'], boxShadow: SHADOW.floating,
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp 0.20s cubic-bezier(0.34,1.56,0.64,1)',
        ...style,
      }}>
        {(title || onClose) && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: `${SP[5]} ${SP[6]} ${subtitle ? SP[2] : SP[4]}`,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div>
              {title && <h2 style={{ margin: 0, ...TEXT.xl, fontWeight: WEIGHT.semibold, color: C.textPrimary, fontFamily: FONT }}>{title}</h2>}
              {subtitle && <p style={{ margin: `${SP[1]} 0 0`, ...TEXT.sm, color: C.textMuted, fontFamily: FONT }}>{subtitle}</p>}
            </div>
            {onClose && (
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '18px', lineHeight: 1, padding: SP[1], borderRadius: RADIUS.sm }}>✕</button>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: SP[6] }}>{children}</div>
        {footer && (
          <div style={{ padding: `${SP[4]} ${SP[6]}`, borderTop: `1px solid ${C.border}`, display: 'flex', gap: SP[3] }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string; title: string; description?: string; action?: React.ReactNode; style?: React.CSSProperties;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon = '📭', title, description, action, style }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: SP[3], padding: `${SP[12]} ${SP[6]}`, textAlign: 'center',
    color: C.textMuted, fontFamily: FONT, ...style,
  }}>
    <span style={{ fontSize: '32px', opacity: 0.5 }}>{icon}</span>
    <div>
      <div style={{ ...TEXT.md, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: SP[1] }}>{title}</div>
      {description && <div style={{ ...TEXT.sm, color: C.textMuted, maxWidth: '280px' }}>{description}</div>}
    </div>
    {action}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader
// ─────────────────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string; subtitle?: string; action?: React.ReactNode; count?: number; style?: React.CSSProperties;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, action, count, style }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3], ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
      <h3 style={{ margin: 0, ...TEXT.md, fontWeight: WEIGHT.semibold, color: C.textPrimary, fontFamily: FONT }}>{title}</h3>
      {count !== undefined && <Badge color={C.textMuted} bg={C.bgHover}>{count}</Badge>}
      {subtitle && <span style={{ ...TEXT.sm, color: C.textMuted, fontFamily: FONT }}>{subtitle}</span>}
    </div>
    {action && <div style={{ display: 'flex', gap: SP[2], alignItems: 'center' }}>{action}</div>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// ProgressBar
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number; max?: number; color?: string; label?: string; showValue?: boolean; height?: number; style?: React.CSSProperties;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, max = 100, color = C.brand, label, showValue, height = 6, style }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], ...style }}>
      {(label || showValue) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {label && <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{label}</span>}
          {showValue && <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, fontFamily: FONT }}>{Math.round(pct)}%</span>}
        </div>
      )}
      <div style={{ height: `${height}px`, background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: RADIUS.full, transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#4573D2','#37C47A','#9C6ADE','#E8AF00','#F06A6A','#42B0C5'];

export const Avatar: React.FC<{ name: string; size?: number; color?: string; style?: React.CSSProperties }> = ({
  name, size = 28, color, style,
}) => {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const bg = color ?? AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: `${Math.round(size * 0.38)}px`, fontWeight: WEIGHT.semibold,
      fontFamily: FONT, flexShrink: 0, ...style,
    }}>
      {initials}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StatCard
// ─────────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string; value: string | number; icon?: string; color?: string;
  delta?: string; deltaPositive?: boolean; style?: React.CSSProperties;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, icon, color = C.brand, delta, deltaPositive, style }) => (
  <Card style={{ ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[2] }}>
      <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, fontWeight: WEIGHT.medium, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      {icon && <span style={{ fontSize: '16px', opacity: 0.6 }}>{icon}</span>}
    </div>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: SP[2] }}>
      <span style={{ ...TEXT['3xl'], fontWeight: WEIGHT.bold, color: C.textPrimary, fontFamily: FONT, lineHeight: 1 }}>
        {value}
      </span>
      {delta && (
        <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, fontFamily: FONT, color: deltaPositive ? C.success : C.danger, paddingBottom: '2px' }}>
          {deltaPositive ? '↑' : '↓'} {delta}
        </span>
      )}
    </div>
  </Card>
);

// ─────────────────────────────────────────────────────────────────────────────
// Checkbox
// ─────────────────────────────────────────────────────────────────────────────

export const Checkbox: React.FC<{
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; style?: React.CSSProperties;
}> = ({ checked, onChange, label, disabled, style }) => (
  <label style={{
    display: 'inline-flex', alignItems: 'center', gap: SP[2],
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    fontFamily: FONT, ...TEXT.sm, color: C.textSecondary, userSelect: 'none', ...style,
  }}>
    <span style={{
      width: '16px', height: '16px', borderRadius: RADIUS.xs, flexShrink: 0,
      background: checked ? C.brand : C.bgCard,
      border: `1.5px solid ${checked ? C.brand : C.borderEm}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: EASE.fast,
    }}>
      {checked && (
        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
          <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
    {label}
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Toggle
// ─────────────────────────────────────────────────────────────────────────────

export const Toggle: React.FC<{
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: 'sm' | 'md'; style?: React.CSSProperties;
}> = ({ checked, onChange, label, disabled, size = 'md', style }) => {
  const w = size === 'sm' ? 28 : 36, h = size === 'sm' ? 16 : 20, d = h - 4;
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: SP[2],
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      fontFamily: FONT, ...TEXT.sm, color: C.textSecondary, userSelect: 'none', ...style,
    }}>
      <span style={{
        width: `${w}px`, height: `${h}px`, borderRadius: `${h}px`, flexShrink: 0,
        background: checked ? C.brand : C.bgHover,
        border: `1px solid ${checked ? C.brand : C.borderEm}`,
        position: 'relative', transition: EASE.fast,
      }}>
        <span style={{
          position: 'absolute', top: '2px',
          right: checked ? '2px' : `${w - d - 2}px`,
          width: `${d}px`, height: `${d}px`, borderRadius: '50%',
          background: 'white', transition: EASE.spring, boxShadow: SHADOW.xs,
        }} />
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
      {label}
    </label>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TabBar
// ─────────────────────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: { key: string; label: string; icon?: React.ReactNode; count?: number }[];
  active: string; onChange: (key: string) => void;
  style?: React.CSSProperties; variant?: 'underline' | 'pill';
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, active, onChange, style, variant = 'underline' }) => (
  <div style={{
    display: 'flex', gap: variant === 'pill' ? SP[1] : 0,
    borderBottom: variant === 'underline' ? `1px solid ${C.border}` : undefined,
    ...style,
  }}>
    {tabs.map(tab => {
      const isActive = tab.key === active;
      if (variant === 'pill') return (
        <button key={tab.key} onClick={() => onChange(tab.key)} style={{
          fontFamily: FONT, ...TEXT.sm, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.medium,
          background: isActive ? C.bgActive : 'transparent',
          color: isActive ? C.brand : C.textMuted,
          border: `1px solid ${isActive ? C.borderFocus + '30' : 'transparent'}`,
          borderRadius: RADIUS.md, padding: '5px 12px', cursor: 'pointer', transition: EASE.fast,
          display: 'flex', alignItems: 'center', gap: SP[2],
        }}>
          {tab.icon}{tab.label}
          {tab.count !== undefined && <Badge color={isActive ? C.brand : C.textDisabled} bg={isActive ? C.infoBg : C.bgHover}>{tab.count}</Badge>}
        </button>
      );
      return (
        <button key={tab.key} onClick={() => onChange(tab.key)} style={{
          fontFamily: FONT, ...TEXT.sm, fontWeight: isActive ? WEIGHT.semibold : WEIGHT.normal,
          background: 'none', border: 'none', cursor: 'pointer',
          color: isActive ? C.textPrimary : C.textMuted,
          padding: `${SP[2]} ${SP[3]}`,
          borderBottom: `2px solid ${isActive ? C.brand : 'transparent'}`,
          marginBottom: '-1px', transition: EASE.fast,
          display: 'flex', alignItems: 'center', gap: SP[2],
        }}>
          {tab.icon}{tab.label}
          {tab.count !== undefined && <Badge color={isActive ? C.brand : C.textDisabled} bg={isActive ? C.infoBg : C.bgHover}>{tab.count}</Badge>}
        </button>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────────────

export const Tooltip: React.FC<{ text: string; children: React.ReactNode; position?: 'top' | 'bottom' }> = ({ text, children, position = 'top' }) => {
  const [vis, setVis] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVis(true)} onMouseLeave={() => setVis(false)}>
      {children}
      {vis && (
        <span style={{
          position: 'absolute',
          [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
          left: '50%', transform: 'translateX(-50%)',
          background: C.textPrimary, color: '#fff', ...TEXT.xs, fontFamily: FONT,
          padding: '4px 10px', borderRadius: RADIUS.md,
          whiteSpace: 'nowrap', zIndex: 100, boxShadow: SHADOW.md, pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TaskCheckbox — Asana-style circle checkbox
// ─────────────────────────────────────────────────────────────────────────────

export const TaskCheckbox: React.FC<{
  checked: boolean; onChange: () => void; color?: string; size?: number; style?: React.CSSProperties;
}> = ({ checked, onChange, color = C.success, size = 20, style }) => {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onChange}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0,
        background: checked ? color : 'transparent',
        border: `2px solid ${checked ? color : hov ? color : C.borderEm}`,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: EASE.fast, padding: 0,
        ...style,
      }}
    >
      {(checked || hov) && (
        <svg width={size * 0.5} height={size * 0.4} viewBox="0 0 10 8" fill="none">
          <path d="M1 4L4 7L9 1" stroke={checked ? 'white' : color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TaskRow — Asana-style row for list view
// ─────────────────────────────────────────────────────────────────────────────

interface TaskRowAsanaProps {
  title: string;
  assignee?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  crNumber?: string;
  application?: string;
  isChecked?: boolean;
  onCheck?: () => void;
  onClick?: () => void;
  isSelected?: boolean;
  style?: React.CSSProperties;
  actions?: React.ReactNode;
}

export const TaskRowAsana: React.FC<TaskRowAsanaProps> = ({
  title, assignee, dueDate, priority, status, crNumber, application,
  isChecked, onCheck, onClick, isSelected, style, actions,
}) => {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center',
        minHeight: '40px',
        background: isSelected ? C.bgActive : hov ? C.bgHover : C.bgCard,
        borderBottom: `1px solid ${C.border}`,
        transition: EASE.fast, cursor: 'pointer',
        ...style,
      }}
    >
      {/* Checkbox */}
      <div style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {onCheck !== undefined ? (
          <TaskCheckbox checked={!!isChecked} onChange={onCheck} />
        ) : (
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${C.borderEm}` }} />
        )}
      </div>

      {/* Title */}
      <div onClick={onClick} style={{ flex: 1, minWidth: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: SP[2] }}>
        <span style={{
          ...TEXT.base, color: isChecked ? C.textDisabled : C.textPrimary,
          fontFamily: FONT, textDecoration: isChecked ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        {crNumber && <Badge color={C.info} bg={C.infoBg}>{crNumber}</Badge>}
        {application && <Badge color={C.textMuted} bg={C.bgHover}>{application}</Badge>}
      </div>

      {/* Assignee */}
      <div style={{ width: '120px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: SP[2], padding: `0 ${SP[2]}`, overflow: 'hidden', direction: 'ltr' }}>
        {assignee && <><Avatar name={assignee} size={22} /><span style={{ ...TEXT.xs, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{assignee.split(' ')[0]}</span></>}
      </div>

      {/* Due date */}
      <div style={{ width: '110px', flexShrink: 0, paddingRight: SP[2] }}>
        {dueDate && <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{dueDate}</span>}
      </div>

      {/* Priority */}
      <div style={{ width: '90px', flexShrink: 0, paddingRight: SP[2] }}>
        {priority && <PriorityChip priority={priority} size="xs" />}
      </div>

      {/* Status */}
      <div style={{ width: '100px', flexShrink: 0, paddingRight: SP[2] }}>
        {status && <StatusChip status={status} size="xs" dot />}
      </div>

      {/* Actions */}
      {(hov || isSelected) && actions && (
        <div style={{ width: '80px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: SP[1], paddingRight: SP[2] }}>
          {actions}
        </div>
      )}
      {!(hov || isSelected) && actions && <div style={{ width: '80px', flexShrink: 0 }} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TableHeader — Asana-style column headers
// ─────────────────────────────────────────────────────────────────────────────

interface TableHeaderProps {
  columns: { key: string; label: string; width?: number | string; align?: 'left' | 'right' | 'center' }[];
  style?: React.CSSProperties;
}

export const TableHeader: React.FC<TableHeaderProps> = ({ columns, style }) => (
  <div style={{
    display: 'flex', alignItems: 'center',
    background: C.bgCard, borderBottom: `1px solid ${C.border}`,
    padding: `${SP[1]} 0`,
    ...style,
  }}>
    {/* Checkbox column */}
    <div style={{ width: '40px', flexShrink: 0 }} />
    {columns.map(col => (
      <div key={col.key} style={{
        width: col.width,
        flex: col.width ? undefined : 1,
        padding: `0 ${SP[2]}`,
        ...TEXT.xs, fontWeight: WEIGHT.semibold,
        color: C.textMuted, fontFamily: FONT,
        textAlign: col.align ?? 'right',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        whiteSpace: 'nowrap', flexShrink: col.width ? 0 : undefined,
      }}>
        {col.label}
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SectionCollapse — Asana-style collapsible section header
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCollapseProps {
  title: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  color?: string;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export const SectionCollapse: React.FC<SectionCollapseProps> = ({
  title, count, isOpen, onToggle, color, actions, style,
}) => {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: SP[2],
        padding: `${SP[2]} ${SP[3]} ${SP[2]} 0`,
        background: hov ? C.bgHover : C.bgCard,
        borderBottom: `1px solid ${C.border}`,
        borderLeft: color ? `3px solid ${color}` : 'none',
        paddingRight: color ? SP[3] : undefined,
        cursor: 'pointer', transition: EASE.fast,
        ...style,
      }}
    >
      {/* Checkbox placeholder */}
      <div style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={onToggle} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
          color: C.textMuted, fontSize: '10px', lineHeight: 1, borderRadius: RADIUS.xs,
          transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: EASE.fast,
        }}>▼</button>
      </div>

      <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, fontFamily: FONT, flex: 1 }}>
        {title}
      </span>

      {count !== undefined && (
        <Badge color={C.textMuted} bg={C.bgHover}>{count}</Badge>
      )}

      {hov && actions && (
        <div style={{ display: 'flex', gap: SP[1], alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// KPIBar — Asana-style top stats
// ─────────────────────────────────────────────────────────────────────────────

interface KPIBarProps {
  stats: { label: string; value: number; color?: string }[];
  style?: React.CSSProperties;
}

export const KPIBar: React.FC<KPIBarProps> = ({ stats, style }) => (
  <div style={{
    display: 'flex', gap: SP[4], alignItems: 'center',
    padding: `${SP[3]} ${SP[4]}`,
    background: C.bgCard, border: `1px solid ${C.border}`,
    borderRadius: RADIUS.xl, ...style,
  }}>
    {stats.map((s, i) => (
      <React.Fragment key={s.label}>
        {i > 0 && <div style={{ width: '1px', height: '32px', background: C.border }} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '80px' }}>
          <span style={{ ...TEXT['2xl'], fontWeight: WEIGHT.bold, color: s.color ?? C.textPrimary, fontFamily: FONT, lineHeight: 1 }}>
            {s.value}
          </span>
          <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{s.label}</span>
        </div>
      </React.Fragment>
    ))}
  </div>
);
