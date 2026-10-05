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
//   text in <div>          → one table row per line (Word keeps size,
//                            colour, alignment and spacing on a <td>)
//   "(יעד 90%)" in RTL     → value over target, no parentheses (Word mirrors them)
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

// ── CR breakdown by cycle (user spec 2026-10-04) ─────────────────────────
// Core cycles + Stand Alone form one track, each CR listed ONCE:
//   current  - the CRs of every active cycle in the track (none active ->
//              the last cycle that started), with their test status;
//   planned  - not in the current cycle(s) but in one that hasn't started;
//   past     - only in cycle(s) that already ended (last result shown).
// UAT is different testing: its own section with ALL its CRs, repeats allowed.
// Rehearsal / go-live aren't listed.
export interface EmailCrRow {
  crNumber: string; crLabel: string; tester: string | null;
  passed: number; failed: number; total: number;
  executedPct: number | null; successPct: number | null; targetPct: number | null;
  openDefects: number; reportedDefects: number;
  cycleName: string; cycleStart: string;
}
export interface EmailCrSection { kind: 'current' | 'planned' | 'past'; title: string; rows: EmailCrRow[] }

export interface CrSourceCycle {
  cycleType: string; plannedStart: string; state: 'done' | 'active' | 'upcoming'; qgTargetPct: number | null;
  crs: { crNumber: string; crLabel: string }[];
  crCoverage: {
    crNumber: string; crLabel: string; passed: number; failed: number; total: number;
    coveragePct: number | null; tester: string | null; reportedDefectsCount: number; stillOpenDefectsCount: number;
  }[];
}

const TRACK_TYPES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE'];

function crRowsOf(c: CrSourceCycle, label: (t: string) => string, fmt: (d: string) => string): EmailCrRow[] {
  const cov = new Map(c.crCoverage.map(r => [r.crNumber, r]));
  const crs = c.crs.length > 0 ? c.crs : c.crCoverage.map(r => ({ crNumber: r.crNumber, crLabel: r.crLabel }));
  return crs.map(cr => {
    const r = cov.get(cr.crNumber);
    const total = r?.total ?? 0;
    return {
      crNumber: cr.crNumber, crLabel: cr.crLabel || r?.crLabel || '', tester: r?.tester ?? null,
      passed: r?.passed ?? 0, failed: r?.failed ?? 0, total,
      executedPct: r ? r.coveragePct : null,
      successPct: total > 0 ? Math.round(((r?.passed ?? 0) / total) * 100) : null,
      targetPct: c.qgTargetPct,
      openDefects: r?.stillOpenDefectsCount ?? 0, reportedDefects: r?.reportedDefectsCount ?? 0,
      cycleName: label(c.cycleType), cycleStart: fmt(c.plannedStart),
    };
  });
}

export function buildCrSections(
  timeline: CrSourceCycle[], label: (cycleType: string) => string, fmt: (d: string) => string,
): EmailCrSection[] {
  const byStart = (a: CrSourceCycle, b: CrSourceCycle) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime();
  const track = timeline.filter(c => TRACK_TYPES.includes(c.cycleType)).sort(byStart);
  let current = track.filter(c => c.state === 'active');
  if (current.length === 0) {
    const started = track.filter(c => c.state === 'done');
    if (started.length > 0) current = [started[started.length - 1]];
  }
  const sections: EmailCrSection[] = [];
  const shown = new Set<string>();
  for (const c of current) {
    const rows = crRowsOf(c, label, fmt).filter(r => !shown.has(r.crNumber));
    rows.forEach(r => shown.add(r.crNumber));
    if (rows.length > 0) sections.push({ kind: 'current', title: `${c.state === 'active' ? 'בסבב הנוכחי' : 'בסבב האחרון שהחל'} — ${label(c.cycleType)}`, rows });
  }
  // planned before past: a CR still ahead of us matters more than its history
  const planned: EmailCrRow[] = [];
  for (const c of track.filter(x => x.state === 'upcoming')) {
    for (const r of crRowsOf(c, label, fmt)) if (!shown.has(r.crNumber)) { shown.add(r.crNumber); planned.push(r); }
  }
  if (planned.length > 0) sections.push({ kind: 'planned', title: 'מתוכננים לסבב עתידי', rows: planned });
  const past: EmailCrRow[] = [];
  for (const c of track.filter(x => x.state === 'done' && !current.includes(x)).reverse()) {   // latest result first
    for (const r of crRowsOf(c, label, fmt)) if (!shown.has(r.crNumber)) { shown.add(r.crNumber); past.push(r); }
  }
  if (past.length > 0) sections.push({ kind: 'past', title: 'הסתיימו בסבב קודם', rows: past });
  for (const uat of timeline.filter(c => c.cycleType === 'UAT').sort(byStart)) {
    const rows = crRowsOf(uat, label, fmt);
    if (rows.length > 0) sections.push({ kind: uat.state === 'upcoming' ? 'planned' : 'current', title: `${label(uat.cycleType)} — בדיקות משתמשים${uat.state === 'upcoming' ? ' (טרם החל)' : ''}`, rows });
  }
  return sections;
}

export interface RiHomeEmailData {
  title: string;
  stamp: string;
  href: string;
  tiles: EmailTile[];
  note?: string;
  cycles: EmailCycle[];
  crSections?: EmailCrSection[];
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

// Every line of text is its own table row (2026-10-05, Outlook paste
// review): Word keeps font size / colour / alignment / spacing set on a <td>,
// but not reliably on a <div> - tile values came out small and right-aligned,
// and the production-defects note collided with the next heading.
const textRow = (html: string, css: string, align: 'right' | 'center' | 'left' = 'right') =>
  `<tr><td align="${align}" dir="rtl" style="font-family:${FONT};text-align:${align};${css}">${html}</td></tr>`;
const stack = (rows: string[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">${rows.join('')}</table>`;
const heading = (text: string, padTop = 18) =>
  stack([textRow(text, `padding:${padTop}px 0 8px;font-size:15px;font-weight:700;color:${EMAIL_COLOR.text}`)]);

function tile(t: EmailTile): string {
  const accent = EMAIL_COLOR[t.accent];
  const rows = [
    textRow(`${esc(t.icon)} ${esc(t.title)}`, `font-size:13px;font-weight:700;color:${EMAIL_COLOR.brand}`, 'center'),
    textRow(esc(t.value), `padding-top:6px;font-size:26px;line-height:30px;font-weight:700;color:${EMAIL_COLOR.text}`, 'center'),
    t.label ? textRow(esc(t.label), `font-size:13px;font-weight:600;color:${EMAIL_COLOR.text}`, 'center') : '',
    t.sub ? textRow(esc(t.sub), `padding-top:6px;font-size:12px;color:${EMAIL_COLOR[t.subTone ?? 'muted']}`, 'center') : '',
    t.bar ? `<tr><td style="padding-top:8px">${bar(t.bar.pct, t.bar.tone)}</td></tr>` : '',
    ...(t.lines ?? []).map(l => textRow(esc(l.text), `padding-top:4px;font-size:12px;color:${EMAIL_COLOR[l.tone ?? 'muted']}`, 'center')),
  ];
  return `<td width="20%" valign="top" bgcolor="#ffffff" align="center" `
    + `style="background:#ffffff;border:1px solid ${EMAIL_COLOR.border};border-top:4px solid ${accent};padding:12px 8px;text-align:center;font-family:${FONT}">${stack(rows)}</td>`;
}

// "63%" over "יעד 90%" - no parentheses: in right-to-left text Word mirrors
// them ("(יעד 90%)" pasted as ")90% יעד63%(").
function successCell(pct: number | null, target: number | null, below: boolean, empty: string): string {
  if (pct == null) return `<span style="color:${EMAIL_COLOR.muted}">${empty}</span>`;
  return `<span style="font-weight:700;color:${below ? EMAIL_COLOR.bad : EMAIL_COLOR.ok}">${Math.round(pct)}%</span>`
    + (target != null ? `<br><span style="font-size:11px;color:${EMAIL_COLOR.muted}">יעד ${target}%</span>` : '');
}

function cyclesTable(cycles: EmailCycle[]): string {
  if (cycles.length === 0) return '';
  const th = (s: string) => `<th align="right" bgcolor="#f9fafb" style="background:#f9fafb;border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px;font-size:12px;font-weight:700;color:${EMAIL_COLOR.muted};text-align:right;font-family:${FONT}">${s}</th>`;
  const td = (s: string, extra = '') => `<td align="right" valign="middle" style="border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px;font-size:13px;color:${EMAIL_COLOR.text};text-align:right;font-family:${FONT}${extra}">${s}</td>`;
  const rows = cycles.map(c => {
    const st = STATE[c.state];
    const badge = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${st.bg}" style="background:${st.bg};color:${st.fg};font-size:12px;font-weight:700;padding:2px 10px;font-family:${FONT}">${st.label}</td></tr></table>`;
    const below = c.successPct != null && c.targetPct != null && c.successPct < c.targetPct && c.state !== 'upcoming';
    return `<tr>${td(`<b>${esc(c.name)}</b>`)}${td(esc(c.dates), ';white-space:nowrap')}${td(badge)}${td(String(c.crCount))}${td(String(c.defectCount))}${td(successCell(c.successPct, c.targetPct, below, 'אין נתונים'))}</tr>`;
  }).join('');
  return heading('סבבים')
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:100%;background:#ffffff;border:1px solid ${EMAIL_COLOR.border}">`
    + `<tr>${th('סבב')}${th('תאריכים')}${th('מצב')}${th('CR-ים')}${th('תקלות שדווחו')}${th('אחוז הצלחה')}</tr>${rows}</table>`;
}

function crSectionsHtml(sections: EmailCrSection[]): string {
  if (sections.length === 0) return '';
  const th = (s: string) => `<th align="right" bgcolor="#f9fafb" style="background:#f9fafb;border-bottom:1px solid ${EMAIL_COLOR.border};padding:6px 8px;font-size:12px;font-weight:700;color:${EMAIL_COLOR.muted};text-align:right;font-family:${FONT}">${s}</th>`;
  const td = (s: string, extra = '') => `<td align="right" valign="middle" style="border-bottom:1px solid ${EMAIL_COLOR.border};padding:6px 8px;font-size:13px;color:${EMAIL_COLOR.text};text-align:right;font-family:${FONT}${extra}">${s}</td>`;
  const cr = (r: EmailCrRow) => td(`<b>${esc(r.crNumber)}</b>${r.crLabel ? `<br><span style="font-size:12px;color:${EMAIL_COLOR.muted}">${esc(r.crLabel.replace(/^\d+\s*-\s*/, ''))}</span>` : ''}`);
  const success = (r: EmailCrRow) => successCell(r.successPct, null, r.targetPct != null && r.successPct != null && r.successPct < r.targetPct, '—');
  const defects = (r: EmailCrRow) => `<span style="font-weight:700;color:${r.openDefects > 0 ? EMAIL_COLOR.bad : EMAIL_COLOR.ok}">${r.openDefects}</span><span style="color:${EMAIL_COLOR.muted}"> / ${r.reportedDefects}</span>`;
  const executed = (r: EmailCrRow) => r.executedPct == null ? `<span style="color:${EMAIL_COLOR.muted}">—</span>`
    : `${Math.round(r.executedPct)}%${bar(r.executedPct, r.executedPct >= 80 ? 'ok' : 'brand')}`;
  const table = (sec: EmailCrSection) => {
    const head = sec.kind === 'planned'
      ? `${th('CR')}${th('סבב')}${th('מתאריך')}`
      : sec.kind === 'past'
        ? `${th('CR')}${th('סבב')}${th('בודק')}${th('הצלחה')}${th('תקלות פתוחות / נפתחו')}`
        : `${th('CR')}${th('בודק')}${th('עברו')}${th('נכשלו')}${th('סה"כ')}${th('בוצע')}${th('הצלחה')}${th('תקלות פתוחות / נפתחו')}`;
    const rows = sec.rows.map(r => `<tr>${
      sec.kind === 'planned'
        ? cr(r) + td(esc(r.cycleName)) + td(esc(r.cycleStart), ';white-space:nowrap')
        : sec.kind === 'past'
          ? cr(r) + td(esc(r.cycleName)) + td(esc(r.tester ?? '—')) + td(success(r)) + td(defects(r))
          : cr(r) + td(esc(r.tester ?? '—')) + td(String(r.passed)) + td(String(r.failed)) + td(String(r.total)) + td(executed(r), ';width:90px') + td(success(r)) + td(defects(r))
    }</tr>`).join('');
    return stack([textRow(`${esc(sec.title)} (${sec.rows.length})`, `padding:12px 0 6px;font-size:13px;font-weight:700;color:${EMAIL_COLOR.brand}`)])
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:100%;background:#ffffff;border:1px solid ${EMAIL_COLOR.border}"><tr>${head}</tr>${rows}</table>`;
  };
  return heading('פירוט CR-ים לפי סבבים', 18) + sections.map(table).join('');
}

function alertsTable(alerts: EmailAlert[]): string {
  if (alerts.length === 0) return '';
  const rows = alerts.map(a => `<tr>`
    + `<td width="18" valign="top" style="padding:8px 6px 8px 0;font-size:14px;color:${EMAIL_COLOR[a.tone]};font-family:${FONT}">&#9679;</td>`
    + `<td valign="top" style="border-bottom:1px solid ${EMAIL_COLOR.border};padding:8px 0;font-family:${FONT}">`
    + stack([
      textRow(esc(a.text), `font-size:13px;font-weight:600;color:${EMAIL_COLOR.text}`),
      a.detail ? textRow(esc(a.detail), `padding-top:2px;font-size:12px;color:${EMAIL_COLOR.muted}`) : '',
    ])
    + `</td></tr>`).join('');
  return heading('📌 סיכונים ופעילויות')
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;width:100%;background:#ffffff;border:1px solid ${EMAIL_COLOR.border}">${rows}</table>`;
}

export function buildRiHomeEmailHtml(d: RiHomeEmailData): string {
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;border-bottom:1px solid ${EMAIL_COLOR.border}"><tr>`
    + `<td align="right" valign="bottom" style="padding-bottom:10px;font-family:${FONT}">`
    + stack([
      textRow(esc(d.title), `font-size:18px;font-weight:700;color:${EMAIL_COLOR.text}`),
      textRow(esc(d.stamp), `padding-top:2px;font-size:12px;color:${EMAIL_COLOR.muted}`),
    ])
    + `</td>`
    + `<td align="left" valign="bottom" style="padding-bottom:10px;font-size:13px;font-weight:600;white-space:nowrap;font-family:${FONT}"><a href="${esc(d.href)}" style="color:#2563eb;text-decoration:none">פתח במערכת →</a></td>`
    + `</tr></table>`;
  const tiles = d.tiles.length === 0 ? '' :
    heading('תמונת מצב', 16)
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="8" border="0" style="width:100%"><tr>${d.tiles.map(tile).join('')}</tr></table>`;
  const note = d.note ? stack([textRow(`ⓘ ${esc(d.note)}`, `padding:2px 8px 0;font-size:12px;color:${EMAIL_COLOR.muted}`)]) : '';
  return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOR.page}" style="border-collapse:collapse;width:100%;direction:rtl;background:${EMAIL_COLOR.page};font-family:${FONT}">`
    + `<tr><td dir="rtl" align="right" style="padding:16px;direction:rtl;text-align:right;font-family:${FONT};color:${EMAIL_COLOR.text}">`
    + header + tiles + note + cyclesTable(d.cycles) + crSectionsHtml(d.crSections ?? []) + alertsTable(d.alerts)
    + stack([textRow('הופק על ידי DeployCenter', 'padding-top:20px;font-size:11px;color:#9ca3af', 'center')])
    + `</td></tr></table>`;
}
