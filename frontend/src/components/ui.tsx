/**
 * DeployCenter UI Kit v3 — Asana-Inspired Light Theme
 */
import React, { useState } from 'react';
import { C, SP, JIRA,
         statusColor, statusBg, statusLabel,
         versionStatusColor, versionStatusBg, versionStatusLabel } from '../theme';
import { cn } from '../lib/utils';
import * as Kit from './ui/index';

// ─────────────────────────────────────────────────────────────────────────────
// Migration note (2026-09-12): the components below marked "→ new kit" now
// render on top of src/components/ui/* (Tailwind + Radix) internally, but
// keep their exact original prop APIs (style-object based, same prop names)
// so none of this file's ~23 existing callers needed to change. Components
// with app-specific shapes (StatusChip, VersionStatusChip, PriorityChip,
// TaskCheckbox, TaskRowAsana, KPIBar, TableHeader, SectionCollapse, Alert,
// EmptyState, SectionHeader, ProgressBar, Avatar, StatCard, TabBar, BackLink)
// don't map cleanly onto generic Linear-style primitives and were left as-is
// on theme.ts. `Select` also stayed a native <select> (just restyled) rather
// than swapping to Radix Select, since callers pass literal <option> children
// that Radix's item-based API can't render — swapping would break all of them.

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

// → new kit: renders Kit.Button internally. Variants beyond the kit's own
// four (primary/secondary/ghost/destructive) are layered on via className
// overrides (twMerge resolves the conflicting bg/text/border utilities).
const BTN_VARIANT_CLASS: Record<ButtonVariant, { kitVariant: 'primary' | 'secondary' | 'ghost' | 'destructive'; extra?: string }> = {
  primary:   { kitVariant: 'primary' },
  secondary: { kitVariant: 'secondary' },
  ghost:     { kitVariant: 'ghost' },
  danger:    { kitVariant: 'destructive' },
  success:   { kitVariant: 'ghost', extra: 'bg-success-bg text-success hover:bg-success-bg border border-success/30' },
  warning:   { kitVariant: 'ghost', extra: 'bg-warning-bg text-warning hover:bg-warning-bg border border-warning/30' },
  outline:   { kitVariant: 'secondary', extra: 'bg-transparent shadow-none' },
};

const BTN_SIZE_CLASS: Record<ButtonSize, { kitSize: 'sm' | 'md' | 'lg'; extra?: string }> = {
  xs: { kitSize: 'sm', extra: 'h-6 px-2 text-xs rounded' },
  sm: { kitSize: 'sm' },
  md: { kitSize: 'md' },
  lg: { kitSize: 'lg' },
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary', size = 'md', loading, icon, iconRight, fullWidth,
  children, style, className, ...props
}) => {
  const v = BTN_VARIANT_CLASS[variant];
  const s = BTN_SIZE_CLASS[size];
  return (
    <Kit.Button
      variant={v.kitVariant}
      size={s.kitSize}
      loading={loading}
      style={style}
      className={cn(v.extra, s.extra, fullWidth && 'w-full', className)}
      {...props}
    >
      {!loading && icon}
      {children}
      {iconRight}
    </Kit.Button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BackLink — the app-wide "back" affordance: a plain blue text link, no border
// or background, sitting at the start (right, in RTL) of its container. Every
// drill-in / sub-screen "→ חזרה…" should use this (spec 2026-09-08).
// ─────────────────────────────────────────────────────────────────────────────
export const BackLink: React.FC<{ onClick: () => void; label?: string; style?: React.CSSProperties }> = ({
  onClick, label = 'חזרה', style,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center self-start gap-1 border-none bg-transparent p-0 m-0 cursor-pointer text-[13px] font-semibold leading-snug hover:underline"
    style={{ color: JIRA.blue, ...style }}
  >
    <span aria-hidden>→</span>{label}
  </button>
);

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

// → new kit: same rounded-xl/padding-scale look, built on Kit.Card's base classes.
const CARD_VARIANT_CLASS: Record<string, string> = {
  default:  'bg-card border border-border shadow-xs',
  flat:     'bg-muted border border-border shadow-none',
  ghost:    'bg-transparent border-none shadow-none',
  outlined: 'bg-card border border-border shadow-none',
};

// Tailwind's class scanner needs literal strings, not template interpolation
// (`p-${padding}` would never generate real CSS) — hence this explicit map.
const CARD_PADDING_CLASS: Record<keyof typeof SP | 'none', string> = {
  none: 'p-0', 1: 'p-1', 2: 'p-2', 3: 'p-3', 4: 'p-4', 5: 'p-5',
  6: 'p-6', 8: 'p-8', 10: 'p-10', 12: 'p-12', 16: 'p-16', 20: 'p-20',
};

export const Card: React.FC<CardProps> = ({
  children, style, padding = 6, variant = 'default', hover, onClick,
}) => {
  const padClass = CARD_PADDING_CLASS[padding] ?? CARD_PADDING_CLASS[6];
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl transition-shadow duration-base ease-out',
        CARD_VARIANT_CLASS[variant],
        padClass,
        onClick && 'cursor-pointer',
        (hover || onClick) && 'hover:shadow-md hover:border-neutral-300'
      )}
      style={style}
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

const STATUS_CHIP_SIZE_CLASS: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'text-xs px-[7px] py-0.5 gap-1',
  sm: 'text-xs font-semibold px-[9px] py-[3px] gap-[5px]',
  md: 'text-sm font-semibold px-[11px] py-1 gap-1.5',
};

export const StatusChip: React.FC<StatusChipProps> = ({ status, size = 'sm', dot, style }) => {
  const color = statusColor(status);
  const bg    = statusBg(status);
  const label = statusLabel(status);

  return (
    <span
      className={cn('inline-flex items-center rounded-full border', STATUS_CHIP_SIZE_CLASS[size])}
      style={{ color, background: bg, borderColor: `${color}30`, ...style }}
    >
      {dot && <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// VersionStatusChip
// ─────────────────────────────────────────────────────────────────────────────

const VERSION_STATUS_CHIP_SIZE_CLASS: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'text-xs px-2 py-0.5',
  sm: 'text-xs font-semibold px-2.5 py-[3px]',
  md: 'text-sm font-semibold px-3 py-1',
};

export const VersionStatusChip: React.FC<{ status: string; size?: 'xs' | 'sm' | 'md'; style?: React.CSSProperties }> = ({ status, size = 'sm', style }) => {
  const color = versionStatusColor[status] ?? C.textMuted;
  const bg    = versionStatusBg[status]    ?? 'transparent';
  const label = versionStatusLabel[status] ?? status;

  return (
    <span
      className={cn('inline-flex items-center gap-[5px] rounded-full border', VERSION_STATUS_CHIP_SIZE_CLASS[size])}
      style={{ color, background: bg, borderColor: `${color}30`, ...style }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
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
  const szClass = size === 'xs' ? 'text-xs px-[7px] py-0.5' : 'text-xs font-semibold px-[9px] py-[3px]';

  return (
    <span
      className={cn('inline-flex items-center rounded-full border', szClass)}
      style={{ color: meta.color, background: meta.bg, borderColor: `${meta.color}30`, ...style }}
    >
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
  <span
    className="inline-flex items-center justify-center rounded-full px-[7px] py-0.5 text-xs font-semibold leading-4"
    style={{ color, background: bg, ...style }}
  >
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

// → new kit: wraps Kit.Input, preserving the label/hint/error/icon layout.
export const TextField: React.FC<TextFieldProps> = ({
  label, hint, error, icon, iconRight, fullWidth, inputStyle, style, id, className, ...props
}) => {
  const elId = id ?? `field-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div className={cn('flex flex-col gap-1', fullWidth && 'w-full')} style={style}>
      {label && (
        <label htmlFor={elId} className="text-sm font-medium text-muted-foreground">{label}</label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <span className="pointer-events-none absolute start-3 flex items-center text-subtle-foreground">{icon}</span>
        )}
        <Kit.Input
          id={elId}
          aria-invalid={!!error}
          className={cn(icon && 'ps-9', iconRight && 'pe-9', fullWidth && 'w-full', className)}
          style={inputStyle}
          {...props}
        />
        {iconRight && (
          <span className="absolute end-3 flex items-center text-subtle-foreground">{iconRight}</span>
        )}
      </div>
      {(hint || error) && (
        <span className={cn('text-xs', error ? 'text-danger' : 'text-subtle-foreground')}>{error ?? hint}</span>
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

// → new kit: wraps Kit.Textarea.
export const TextArea: React.FC<TextAreaProps> = ({ label, hint, fullWidth, style, id, className, ...props }) => {
  const elId = id ?? `ta-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div className={cn('flex flex-col gap-1', fullWidth && 'w-full')} style={style}>
      {label && <label htmlFor={elId} className="text-sm font-medium text-muted-foreground">{label}</label>}
      <Kit.Textarea id={elId} className={cn(fullWidth && 'w-full', className)} {...props} />
      {hint && <span className="text-xs text-subtle-foreground">{hint}</span>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Select
// ─────────────────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; fullWidth?: boolean; children: React.ReactNode;
}

// NOT swapped to Radix Select: every caller passes literal <option> children,
// which Radix's item-based API can't render. Restyled in place instead — same
// native <select>, new kit's visual language (border/focus-ring/radius).
// The chevron background-image stays inline style (a data-URI SVG doesn't
// survive being encoded as a Tailwind arbitrary-value class reliably).
const SELECT_CHEVRON_STYLE: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237F7F7F'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'left 12px center',
};

export const Select: React.FC<SelectProps> = ({ label, fullWidth, style, id, className, children, ...props }) => {
  const elId = id ?? `sel-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div className={cn('flex flex-col gap-1', fullWidth && 'w-full')} style={style}>
      {label && <label htmlFor={elId} className="text-sm font-medium text-muted-foreground">{label}</label>}
      <select
        id={elId}
        className={cn(
          'h-9 rounded-md border border-input bg-card ps-3 pe-8 text-sm text-foreground',
          'cursor-pointer appearance-none',
          'transition-[border-color,box-shadow] duration-fast ease-out',
          'hover:border-neutral-300',
          'focus:outline-none focus:border-primary focus:shadow-focus',
          fullWidth && 'w-full',
          className
        )}
        style={SELECT_CHEVRON_STYLE}
        {...props}
      >
        {children}
      </select>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

// → new kit: Kit.Spinner is currentColor-based, so `color` still works via inline style.
export const Spinner: React.FC<{ size?: number; color?: string; style?: React.CSSProperties }> = ({
  size = 18, color = C.brand, style,
}) => (
  <Kit.Spinner
    style={{ width: size, height: size, color, flexShrink: 0, ...style }}
  />
);

// ─────────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────────

// → new kit: built on Kit.Separator.
export const Divider: React.FC<{ style?: React.CSSProperties; label?: string }> = ({ style, label }) => (
  label ? (
    <div className="flex items-center gap-3" style={style}>
      <Kit.Separator className="flex-1" />
      <span className="whitespace-nowrap text-xs text-subtle-foreground">{label}</span>
      <Kit.Separator className="flex-1" />
    </div>
  ) : (
    <Kit.Separator style={style} />
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

const ALERT_TEXT_CLASS: Record<AlertVariant, string> = {
  info: 'text-info', success: 'text-success', warning: 'text-warning', danger: 'text-danger',
};
const ALERT_CLASS: Record<AlertVariant, string> = {
  info:    `${ALERT_TEXT_CLASS.info} bg-info-bg border-info/25`,
  success: `${ALERT_TEXT_CLASS.success} bg-success-bg border-success/25`,
  warning: `${ALERT_TEXT_CLASS.warning} bg-warning-bg border-warning/25`,
  danger:  `${ALERT_TEXT_CLASS.danger} bg-danger-bg border-danger/25`,
};

const ALERT_ICONS: Record<AlertVariant, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚫' };

export const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, onClose, style, icon }) => (
  <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3', ALERT_CLASS[variant])} style={style}>
    <span className="mt-px shrink-0 text-[15px]">{icon ?? ALERT_ICONS[variant]}</span>
    <div className="min-w-0 flex-1">
      {title && <div className="mb-0.5 text-sm font-semibold">{title}</div>}
      <div className="text-sm">{children}</div>
    </div>
    {onClose && (
      <button onClick={onClose} className={cn('shrink-0 border-none bg-transparent p-0.5 cursor-pointer opacity-60 hover:opacity-100', ALERT_TEXT_CLASS[variant])}>✕</button>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean; onClose?: () => void; title?: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode;
  width?: number | string; style?: React.CSSProperties;
}

// → new kit: built on Kit.Dialog/Kit.DialogContent, fully controlled via
// `open`/`onOpenChange` (no state lives inside Radix, same as the old div-based
// version). `hideClose` (added to DialogContent for this) keeps the close X
// conditional on `onClose`, matching the old behavior exactly.
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, children, footer, width = 560, style }) => (
  <Kit.Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
    <Kit.DialogContent
      hideClose={!onClose}
      className="flex max-h-[90vh] max-w-none flex-col rounded-2xl p-0"
      style={{ width, maxWidth: '100%', ...style }}
    >
      {(title || onClose) && (
        <div className={cn('border-b border-border px-6 pt-5', subtitle ? 'pb-2' : 'pb-4')}>
          {title && <Kit.DialogTitle className="text-xl">{title}</Kit.DialogTitle>}
          {subtitle && <Kit.DialogDescription className="mt-1">{subtitle}</Kit.DialogDescription>}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
      {footer && <div className="flex gap-3 border-t border-border px-6 py-4">{footer}</div>}
    </Kit.DialogContent>
  </Kit.Dialog>
);

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string; title: string; description?: string; action?: React.ReactNode; style?: React.CSSProperties;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon = '📭', title, description, action, style }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-subtle-foreground" style={style}>
    <span className="text-[32px] opacity-50">{icon}</span>
    <div>
      <div className="mb-1 text-md font-semibold text-muted-foreground">{title}</div>
      {description && <div className="max-w-[280px] text-sm text-subtle-foreground">{description}</div>}
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
  <div className="flex items-center justify-between gap-3" style={style}>
    <div className="flex items-center gap-2">
      <h3 className="m-0 text-md font-semibold text-foreground">{title}</h3>
      {count !== undefined && <Badge color={C.textMuted} bg={C.bgHover}>{count}</Badge>}
      {subtitle && <span className="text-sm text-subtle-foreground">{subtitle}</span>}
    </div>
    {action && <div className="flex items-center gap-2">{action}</div>}
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
    <div className="flex flex-col gap-1" style={style}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-xs text-subtle-foreground">{label}</span>}
          {showValue && <span className="text-xs font-semibold text-muted-foreground">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className="overflow-hidden rounded-full bg-muted" style={{ height: `${height}px` }}>
        <div className="h-full rounded-full transition-[width] duration-slow ease-out" style={{ width: `${pct}%`, background: color }} />
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
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: `${size}px`, height: `${size}px`, background: bg, fontSize: `${Math.round(size * 0.38)}px`, ...style }}
    >
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
  <Card style={style}>
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
        {label}
      </span>
      {icon && <span className="text-[17px] opacity-60">{icon}</span>}
    </div>
    <div className="flex items-end gap-2">
      <span className="text-3xl font-bold leading-none text-foreground">
        {value}
      </span>
      {delta && (
        <span className={cn('pb-0.5 text-xs font-semibold', deltaPositive ? 'text-success' : 'text-danger')}>
          {deltaPositive ? '↑' : '↓'} {delta}
        </span>
      )}
    </div>
  </Card>
);

// ─────────────────────────────────────────────────────────────────────────────
// Checkbox
// ─────────────────────────────────────────────────────────────────────────────

// → new kit: wraps Kit.Checkbox (Radix), same checked/onChange(boolean) API.
export const Checkbox: React.FC<{
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; style?: React.CSSProperties;
}> = ({ checked, onChange, label, disabled, style }) => (
  <label
    className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground select-none', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
    style={style}
  >
    <Kit.Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
    {label}
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Toggle
// ─────────────────────────────────────────────────────────────────────────────

// → new kit: wraps Kit.Switch (Radix), same checked/onChange(boolean) API.
export const Toggle: React.FC<{
  checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: 'sm' | 'md'; style?: React.CSSProperties;
}> = ({ checked, onChange, label, disabled, size = 'md', style }) => (
  <label
    className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground select-none', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
    style={style}
  >
    <Kit.Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      className={size === 'sm' ? 'scale-90' : undefined}
    />
    {label}
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// TabBar
// ─────────────────────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: { key: string; label: string; icon?: React.ReactNode; count?: number }[];
  active: string; onChange: (key: string) => void;
  style?: React.CSSProperties; variant?: 'underline' | 'pill';
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, active, onChange, style, variant = 'underline' }) => (
  <div className={cn('flex', variant === 'pill' ? 'gap-1' : 'gap-0 border-b border-border')} style={style}>
    {tabs.map(tab => {
      const isActive = tab.key === active;
      if (variant === 'pill') return (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-[5px] text-sm cursor-pointer transition-[background-color,color,border-color] duration-fast ease-out',
            isActive ? 'bg-primary-50 font-semibold text-primary border-primary/30' : 'bg-transparent font-medium text-subtle-foreground border-transparent'
          )}
        >
          {tab.icon}{tab.label}
          {tab.count !== undefined && <Badge color={isActive ? C.brand : C.textDisabled} bg={isActive ? C.infoBg : C.bgHover}>{tab.count}</Badge>}
        </button>
      );
      return (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'flex items-center gap-2 border-0 border-b-2 bg-transparent px-3 py-2 -mb-px text-sm cursor-pointer transition-[color,border-color] duration-fast ease-out',
            isActive ? 'font-semibold text-foreground border-b-primary' : 'font-normal text-subtle-foreground border-b-transparent'
          )}
        >
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
    <span className="relative inline-flex items-center"
      onMouseEnter={() => setVis(true)} onMouseLeave={() => setVis(false)}>
      {children}
      {vis && (
        <span
          className={cn(
            'absolute start-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-xs text-white shadow-md pointer-events-none',
            position === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          )}
        >
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
      className="flex shrink-0 items-center justify-center rounded-full border-2 p-0 cursor-pointer transition-[background-color,border-color] duration-fast ease-out"
      style={{
        width: `${size}px`, height: `${size}px`,
        background: checked ? color : 'transparent',
        borderColor: checked ? color : hov ? color : C.borderEm,
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
      className="flex min-h-[40px] cursor-pointer items-center border-b border-border transition-colors duration-fast ease-out"
      style={{ background: isSelected ? C.bgActive : hov ? C.bgHover : C.bgCard, ...style }}
    >
      {/* Checkbox */}
      <div className="flex w-10 shrink-0 items-center justify-center">
        {onCheck !== undefined ? (
          <TaskCheckbox checked={!!isChecked} onChange={onCheck} />
        ) : (
          <div className="h-5 w-5 rounded-full border-2" style={{ borderColor: C.borderEm }} />
        )}
      </div>

      {/* Title */}
      <div onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-2">
        <span className={cn(
          'overflow-hidden text-ellipsis whitespace-nowrap text-base',
          isChecked ? 'text-subtle-foreground line-through' : 'text-foreground no-underline'
        )}>
          {title}
        </span>
        {crNumber && <Badge color={C.info} bg={C.infoBg}>{crNumber}</Badge>}
        {application && <Badge color={C.textMuted} bg={C.bgHover}>{application}</Badge>}
      </div>

      {/* Assignee */}
      <div className="flex w-[120px] shrink-0 items-center gap-2 overflow-hidden px-2" dir="ltr">
        {assignee && <><Avatar name={assignee} size={22} /><span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-subtle-foreground">{assignee.split(' ')[0]}</span></>}
      </div>

      {/* Due date */}
      <div className="w-[110px] shrink-0 pe-2">
        {dueDate && <span className="text-xs text-subtle-foreground">{dueDate}</span>}
      </div>

      {/* Priority */}
      <div className="w-[90px] shrink-0 pe-2">
        {priority && <PriorityChip priority={priority} size="xs" />}
      </div>

      {/* Status */}
      <div className="w-[100px] shrink-0 pe-2">
        {status && <StatusChip status={status} size="xs" dot />}
      </div>

      {/* Actions */}
      {(hov || isSelected) && actions && (
        <div className="flex w-20 shrink-0 items-center gap-1 pe-2">
          {actions}
        </div>
      )}
      {!(hov || isSelected) && actions && <div className="w-20 shrink-0" />}
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

const TABLE_HEADER_ALIGN_CLASS: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left', right: 'text-right', center: 'text-center',
};

export const TableHeader: React.FC<TableHeaderProps> = ({ columns, style }) => (
  <div className="flex items-center border-b border-border bg-card py-1" style={style}>
    {/* Checkbox column */}
    <div className="w-10 shrink-0" />
    {columns.map(col => (
      <div
        key={col.key}
        className={cn(
          'whitespace-nowrap px-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground',
          col.width ? 'shrink-0' : 'flex-1',
          TABLE_HEADER_ALIGN_CLASS[col.align ?? 'right']
        )}
        style={{ width: col.width }}
      >
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
      className={cn('flex cursor-pointer items-center gap-2 border-b border-border py-2 ps-0 pe-3 transition-colors duration-fast ease-out', color && 'border-s-[3px]')}
      style={{ background: hov ? C.bgHover : C.bgCard, borderInlineStartColor: color, ...style }}
    >
      {/* Checkbox placeholder */}
      <div className="flex w-10 shrink-0 items-center justify-center">
        <button
          onClick={onToggle}
          className={cn(
            'cursor-pointer rounded-xs border-none bg-transparent p-0.5 text-xs leading-none text-subtle-foreground transition-transform duration-fast ease-out',
            isOpen ? 'rotate-0' : '-rotate-90'
          )}
        >▼</button>
      </div>

      <span className="flex-1 text-sm font-semibold text-muted-foreground">
        {title}
      </span>

      {count !== undefined && (
        <Badge color={C.textMuted} bg={C.bgHover}>{count}</Badge>
      )}

      {hov && actions && (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
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
  <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3" style={style}>
    {stats.map((s, i) => (
      <React.Fragment key={s.label}>
        {i > 0 && <div className="h-8 w-px bg-border" />}
        <div className="flex min-w-[80px] flex-col gap-0.5">
          <span className="text-2xl font-bold leading-none" style={{ color: s.color ?? C.textPrimary }}>
            {s.value}
          </span>
          <span className="text-xs text-subtle-foreground">{s.label}</span>
        </div>
      </React.Fragment>
    ))}
  </div>
);
