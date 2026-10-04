// "העתק דף הבית למייל" — the email is built from DATA, not by cloning the
// page's DOM (user report 2026-10-04: pasted into desktop Outlook "הכל
// מתפרק ונראה שבור, לא כל האובייקטים מוצגים"). Desktop Outlook renders
// with Word's engine, so every object the page uses is swapped for one it
// does know:
//   tile row (grid)        → <table> row of fixed-% cells (cellspacing gap)
//   tile (rounded card)    → bordered cell + coloured top border, square
//   progress bar (div %)   → two-cell table, each cell bgcolor'd
//   badge / pill           → cell with bgcolor
//   oklch / rgba colours   → fixed hex palette below
//   buttons, arrows, links → dropped (only "פתח במערכת →" stays a link)
//   padding on <div>       → margin (Word only pads table cells)
// Because nothing here reads the page, a UI redesign can't break the email.
// riHomeEmail.test.ts guards the Outlook-safe rules.

export type EmailTone = 'ok' | 'warn' | 'bad' | 'muted' | 'brand';

export interface EmailTile {
  icon: string;
  title: string;
  value: string;
  label: string;
  sub?: string;
  subTone?: EmailTone;
  accent: EmailTone;
  lines?: { text: string; tone?: EmailTone }[];
  bar?: { pct: number; tone: EmailTone };
}

export interface EmailCycle {
  name: string;
  dates: string;
  state: 'done' | 'active' | 'upcoming';
  crCount: number;
  defectCount: number;
  successPct: number | null;
  targetPct: number | null;
  progressPct: number;
}

export interface EmailAlert { text: string; detail?: string; tone: EmailTone }

export interface RiHomeEmailData {
  title: string;
  stamp: string;
  href: string;
  tiles: EmailTile[];
  note?: string;
  cycles: EmailCycle[];
  alerts: EmailAlert[];
}

const FONT = "'Segoe UI', Arial, sans-serif";
export const EMAIL_COLOR: Record<EmailTone | 'text' | 'border' | 'page' | 'track', string> = {
  ok: '#16a34a', warn: '#d97706', bad: '#dc2626', muted: '#6b7280', brand: '#0e7490',
  text: '#1f2937', border: '#e5e7eb', page: '#f4f5f7', track: '#e5e7eb',
};
const STATE: Record<EmailCycle['state'], { label: string; fg: string; bg: string }> = {
  done: { label: 'הושלם', fg: '#166534', bg: '#dcfce7' },
  active: { label: 'פעיל', fg: '#1e40af', bg: '#dbeafe' },
  upcoming: { label: 'עתידי', fg: '#4b5563', bg: '#f3f4f6' },
};

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Word honours bgcolor on a cell; height needs real content + exact line-height.
function bar(pct: number, tone: EmailTone): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const cell = (w: number, color: string) =>
    `<td width="${w}%" bgcolor="${color}" style="background:${color};font-size:1px;line-height:6px;mso-line-height-rule:exactly;height:6px">&nbsp;</td>`;
  const cells = p <= 0 ? cell(100, EMAIL_COLOR.track)
    : p >= 100 ? cell(100, EMAIL_COLOR[tone])
    : cell(p, EMAIL_COLOR[tone]) + cell(100 - p, EMAIL_COLOR.track);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px"><tr>${cells}</tr></table>`;
}

function tile(t: EmailTile): string {
  const accent = EMAIL_COLOR[t.accent];
  const rows = [
    `<div style="font-size:13px;font-weight:700;color:${EMAIL_COLOR.brand}">${esc(t.icon)} ${esc(t.title)}</div>`,
    `<div style="font-size:24px;font-weight:700;color:${EMAIL_COLOR.text};margin-top:6px">${esc(t.value)}</div>`,
    t.label ? `<div style="font-size:13px;font-weight:600;color:${EMAIL_COLOR.text}">${esc(t.label)}</div>` : '',
    t.sub ? `<div style="font-size:12px;color:${EMAIL_COLOR[t.subTone ?? 'muted']};margin-top:6px">${esc(t.sub)}</div>` : '',
    t.bar ? bar(t.bar.pct, t.bar.tone) : '',
    ...(t.lines ?? []).map(l => `<div style="font-size:12px;color:${EMAIL_COLOR[l.tone ?? 'muted']};margin-top:4px">${esc(l.text)}</div>`),
  ].join('');
  return `<td width="20%" valign="top" bgcolor="#ffffff" align="center" `
    + `style="background:#ffffff;border:1px solid ${EMAIL_COLOR.border};border-top:4px solid ${accent};padding:12px 8px;text-align:center;font-family:${FONT}">${rows}</td>`;
}

function cyclesTable(cycles: EmailCycle[]): string {
  if (cycles.length === 0) return '';
  const th = (s: string) => `<th align="right" bgcolor="#f9fafb" style="background:#f9fafb;border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px;font-size:12px;font-weight:700;color:${EMAIL_COLOR.muted};text-align:right;font-family:${FONT}">${s}</th>`;
  const td = (s: string, extra = '') => `<td align="right" valign="middle" style="border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px;font-size:13px;color:${EMAIL_COLOR.text};text-align:right;font-family:${FONT}${extra}">${s}</td>`;
  const rows = cycles.map(c => {
    const st = STATE[c.state];
    const badge = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${st.bg}" style="background:${st.bg};color:${st.fg};font-size:12px;font-weight:700;padding:2px 10px;font-family:${FONT}">${st.label}</td></tr></table>`;
    const below = c.successPct != null && c.targetPct != null && c.successPct < c.targetPct && c.state !== 'upcoming';
    const success = c.successPct == null
      ? `<span style="color:${EMAIL_COLOR.muted}">אין נתונים</span>`
      : `<span style="color:${below ? EMAIL_COLOR.bad : EMAIL_COLOR.ok};font-weight:700">${c.successPct.toFixed(0)}%</span>`
        + (c.targetPct != null ? `<span style="color:${EMAIL_COLOR.muted}"> (יעד ${c.targetPct}%)</span>` : '');
    return `<tr>${td(`<b>${esc(c.name)}</b>`)}${td(esc(c.dates), ';white-space:nowrap')}${td(badge)}${td(String(c.crCount))}${td(String(c.defectCount))}${td(success)}</tr>`;
  }).join('');
  return `<div style="font-size:15px;font-weight:700;color:${EMAIL_COLOR.text};margin:18px 0 8px;font-family:${FONT}">סבבים</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:100%;background:#ffffff;border:1px solid ${EMAIL_COLOR.border}">`
    + `<tr>${th('סבב')}${th('תאריכים')}${th('מצב')}${th('CR-ים')}${th('תקלות שדווחו')}${th('אחוז הצלחה')}</tr>${rows}</table>`;
}

function alertsTable(alerts: EmailAlert[]): string {
  if (alerts.length === 0) return '';
  const rows = alerts.map(a => `<tr>`
    + `<td width="18" valign="top" style="padding:8px 0 8px 6px;font-size:14px;color:${EMAIL_COLOR[a.tone]};font-family:${FONT}">&#9679;</td>`
    + `<td valign="top" style="border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px 0;font-family:${FONT}">`
    + `<div style="font-size:13px;font-weight:600;color:${EMAIL_COLOR.text}">${esc(a.text)}</div>`
    + (a.detail ? `<div style="font-size:12px;color:${EMAIL_COLOR.muted};margin-top:2px">${esc(a.detail)}</div>` : '')
    + `</td></tr>`).join('');
  return `<div style="font-size:15px;font-weight:700;color:${EMAIL_COLOR.text};margin:18px 0 8px;font-family:${FONT}">📌 סיכונים ופעילויות</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:100%;background:#ffffff;border:1px solid ${EMAIL_COLOR.border};padding:0 12px">${rows}</table>`;
}

export function buildRiHomeEmailHtml(d: RiHomeEmailData): string {
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;border-bottom:1px solid ${EMAIL_COLOR.border}"><tr>`
    + `<td align="right" valign="bottom" style="padding-bottom:10px;font-family:${FONT}"><div style="font-size:18px;font-weight:700;color:${EMAIL_COLOR.text}">${esc(d.title)}</div>`
    + `<div style="font-size:12px;color:${EMAIL_COLOR.muted};margin-top:2px">${esc(d.stamp)}</div></td>`
    + `<td align="left" valign="bottom" style="padding-bottom:10px;font-size:13px;font-weight:600;white-space:nowrap;font-family:${FONT}"><a href="${esc(d.href)}" style="color:#2563eb;text-decoration:none">פתח במערכת →</a></td>`
    + `</tr></table>`;
  const tiles = d.tiles.length === 0 ? '' :
    `<div style="font-size:15px;font-weight:700;color:${EMAIL_COLOR.text};margin:16px 0 4px;font-family:${FONT}">תמונת מצב</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="8" border="0" style="width:100%"><tr>${d.tiles.map(tile).join('')}</tr></table>`;
  const note = d.note ? `<div style="font-size:12px;color:${EMAIL_COLOR.muted};margin:2px 8px 0;font-family:${FONT}">ⓘ ${esc(d.note)}</div>` : '';
  return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOR.page}" style="border-collapse:collapse;width:100%;direction:rtl;background:${EMAIL_COLOR.page};font-family:${FONT}">`
    + `<tr><td dir="rtl" align="right" style="padding:16px;direction:rtl;text-align:right;font-family:${FONT};color:${EMAIL_COLOR.text}">`
    + header + tiles + note + cyclesTable(d.cycles) + alertsTable(d.alerts)
    + `<div style="margin-top:20px;font-size:11px;color:#9ca3af;text-align:center;font-family:${FONT}">הופק על ידי DeployCenter</div>`
    + `</td></tr></table>`;
}
