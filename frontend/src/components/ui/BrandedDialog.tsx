import React, { useEffect } from 'react';
import { C, RADIUS } from '../../theme';
import { DeployCenterLogo } from '../DeployCenterLogo';

// One frame for every dialog in the app (2026-10-05): a dark brand bar —
// DeployCenter mark, dialog title, close ✕ — over a card body. Before this
// there were three unrelated looks (ConfirmDialog with a hand-drawn owl,
// native window.confirm/alert/prompt, and ~40 hand-built overlays, each with
// its own header/radius/backdrop).
//
// Two layers so existing hand-built modals can adopt the look without
// rewriting their bodies:
//   • DialogBrandBar — just the header strip; drop it in as the first child
//     of any existing panel (panel needs overflow-hidden + rounded corners).
//   • BrandedDialog  — the whole thing: overlay + panel + bar + body/footer.

export const DIALOG_OVERLAY_BG = C.bgOverlay;
export const DIALOG_PANEL_SHADOW = '0 24px 64px rgba(20,21,42,0.28)';

export const DialogBrandBar: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  /** Extra controls rendered before the ✕ (e.g. a step counter). */
  actions?: React.ReactNode;
  /** For retrofitting into a padded panel: negative margins to sit flush. */
  style?: React.CSSProperties;
}> = ({ title, subtitle, icon, onClose, closeDisabled, actions, style }) => (
  <div
    dir="rtl"
    className="flex min-h-[46px] shrink-0 items-center gap-3 px-4 py-2"
    style={{ background: C.sidebarBg, borderBottom: `1px solid ${C.sidebarBorder}`, ...style }}
  >
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {icon && <span className="shrink-0 text-[17px] leading-none">{icon}</span>}
      {title && (
        <div className="min-w-0">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-bold" style={{ color: C.sidebarText }}>{title}</div>
          {subtitle && <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs" style={{ color: C.sidebarTextMuted }}>{subtitle}</div>}
        </div>
      )}
    </div>
    {actions}
    <DeployCenterLogo variant="compact" />
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="סגור"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: C.sidebarTextMuted, cursor: closeDisabled ? 'not-allowed' : 'pointer' }}
        onMouseEnter={e => { if (!closeDisabled) { e.currentTarget.style.background = C.sidebarBgHover; e.currentTarget.style.color = C.sidebarText; } }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.sidebarTextMuted; }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    )}
  </div>
);

const WIDTHS = { sm: 400, md: 480, lg: 640, xl: 860, '2xl': 1100 } as const;

export const BrandedDialog: React.FC<{
  open?: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  width?: keyof typeof WIDTHS | number;
  /** Small dialogs close on backdrop click; wizards / forms pass false. */
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  /** Disables every way of closing (e.g. while a request is in flight). */
  busy?: boolean;
  footer?: React.ReactNode;
  zIndex?: number;
  /** Panel max height, default 88vh — body scrolls inside. */
  maxHeight?: string;
  align?: 'center' | 'top';
  bodyClassName?: string;
  bodyStyle?: React.CSSProperties;
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({
  open = true, onClose, title, subtitle, icon, width = 'md', closeOnBackdrop = true, closeOnEsc = true,
  busy, footer, zIndex = 5000, maxHeight = '88vh', align = 'center', bodyClassName, bodyStyle, headerActions, children,
}) => {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEsc, busy, onClose]);

  if (!open) return null;
  const w = typeof width === 'number' ? width : WIDTHS[width];
  return (
    <div
      dir="rtl"
      className={`fixed inset-0 flex justify-center px-4 ${align === 'top' ? 'items-start pt-[9vh]' : 'items-center py-4'}`}
      style={{ background: DIALOG_OVERLAY_BG, zIndex }}
      onMouseDown={e => { if (closeOnBackdrop && !busy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full flex-col overflow-hidden bg-card"
        style={{ maxWidth: w, maxHeight, borderRadius: RADIUS.lg, boxShadow: DIALOG_PANEL_SHADOW }}
      >
        <DialogBrandBar title={title} subtitle={subtitle} icon={icon} onClose={onClose} closeDisabled={busy} actions={headerActions} />
        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName ?? 'p-5'}`} style={bodyStyle}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2.5 border-t border-border bg-muted px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// Standard footer buttons so every dialog's actions look the same.
type BtnVariant = 'primary' | 'danger' | 'warning' | 'success' | 'secondary';
const BTN_BG: Record<Exclude<BtnVariant, 'secondary'>, string> = {
  primary: C.brand, danger: C.danger, warning: C.warning, success: C.success,
};
export const DialogButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }>(({
  variant = 'primary', disabled, style, className, children, ...rest
}, ref) => {
  const secondary = variant === 'secondary';
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={`min-w-[92px] rounded-md px-4 py-2 text-[15px] font-semibold transition-opacity ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-90'} ${className ?? ''}`}
      style={{
        background: secondary ? C.bgCard : BTN_BG[variant],
        color: secondary ? C.textSecondary : C.textInverse,
        border: secondary ? `1px solid ${C.borderEm}` : 'none',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
});
DialogButton.displayName = 'DialogButton';
