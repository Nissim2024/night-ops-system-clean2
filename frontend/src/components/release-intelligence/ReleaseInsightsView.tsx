import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C } from '../../theme';
import { cn } from '../../lib/utils';
import { Card } from '../ui';
import { BrandedDialog, DialogButton } from '../ui/BrandedDialog';
import { formatDateTime } from '../../utils/dateFormat';
import { DefectDrilldownModal } from './DefectDrilldownModal';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ניהול בדיקות → "תובנות גרסה" — the version summary page for the summary
// meeting (user, 2026-10-06). Behind its own explicit permission (ri:insights).
// Auto findings come from the backend rules (release-insights.service.ts) and
// can only be hidden for this version with a reason; manual ones are editable.

type Level = 'CRITICAL' | 'WARNING' | 'INFO' | 'POSITIVE';
type Drill =
  | { kind: 'defects'; ids: string[]; title: string }
  | { kind: 'crDefects'; crNumber: string; title: string }
  | { kind: 'crs'; crs: { crNumber: string; label: string; days: number | null }[]; title: string }
  | { kind: 'screen'; module: string; view: string };
interface Insight {
  key: string; source: 'AUTO' | 'MANUAL'; id?: string; level: Level; category: string; title: string; text: string;
  drill?: Drill; hidden?: { reason: string; by: string | null; at: string }; createdBy?: string | null;
}
interface Payload {
  versionName: string; generatedAt: string;
  summary: { total: number; critical: number; warning: number; info: number; positive: number; hidden: number };
  insights: Insight[];
}

const LEVEL: Record<Level, { label: string; icon: string; color: string; bg: string }> = {
  CRITICAL: { label: 'קריטית', icon: '🔴', color: C.danger, bg: C.dangerBg },
  WARNING:  { label: 'אזהרה', icon: '⚠️', color: C.warning, bg: C.warningBg },
  INFO:     { label: 'מידע', icon: 'ℹ️', color: C.info, bg: C.infoBg },
  POSITIVE: { label: 'חיובית', icon: '✅', color: C.success, bg: C.successBg },
};
const LEVEL_ORDER: Level[] = ['CRITICAL', 'WARNING', 'INFO', 'POSITIVE'];
const CATEGORIES = ['מוכנות', 'תקלות', 'סיכונים', 'כיסוי בדיקות', 'לוח זמנים', 'מאמץ', 'יעדי איכות', 'תכולה', 'כללי'];
const LINKS: { value: string; label: string; needsValue?: string }[] = [
  { value: '', label: 'ללא קישור' },
  { value: 'cr', label: 'תקלות של CR', needsValue: 'מספר CR' },
  { value: 'defect', label: 'תקלות לפי מספר', needsValue: 'מספרי תקלות (מופרדים בפסיק)' },
  { value: 'risks', label: 'מסך ניהול סיכונים' },
  { value: 'coverage-readiness', label: 'מסך כיסוי ומוכנות' },
  { value: 'bug-dashboard', label: 'לוח באגים' },
  { value: 'daily-qa', label: 'ניהול QA יומי' },
  { value: 'kpi', label: 'מטריצת KPI (איכות גרסה)' },
];

export const ReleaseInsightsView: React.FC<{
  token: string; versionId?: string; versionName?: string;
  onNavigate: (module: string, view: string) => void;
}> = ({ token, versionId, versionName, onNavigate }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<Level | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [hiding, setHiding] = useState<Insight | null>(null);
  const [editing, setEditing] = useState<Insight | 'new' | null>(null);
  const [defectDrill, setDefectDrill] = useState<{ filter: string; value: string; title: string; screen: string } | null>(null);
  const [crList, setCrList] = useState<Extract<Drill, { kind: 'crs' }> | null>(null);

  const load = useCallback(async () => {
    if (!versionId) return;
    setLoading(true); setError(null);
    try {
      const r = await axios.get(`${API}/release-insights/${versionId}`, { headers });
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'טעינת התובנות נכשלה');
    } finally { setLoading(false); }
  }, [versionId, headers]);
  useEffect(() => { load(); }, [load]);

  const openDrill = (d: Drill) => {
    if (d.kind === 'defects') setDefectDrill({ screen: 'bug-dashboard', filter: 'ids', value: d.ids.join(','), title: d.title });
    else if (d.kind === 'crDefects') setDefectDrill({ screen: 'cycle-progress', filter: 'crReported', value: d.crNumber, title: d.title });
    else if (d.kind === 'crs') setCrList(d);
    else onNavigate(d.module, d.view);
  };

  const unhide = async (i: Insight) => {
    await axios.delete(`${API}/release-insights/${versionId}/hide`, { headers, params: { key: i.key } });
    load();
  };

  if (!versionId) return <div className="p-10 text-center text-subtle-foreground">בחר גרסה בבורר הגרסאות</div>;

  const list = (data?.insights ?? []).filter(i => (showHidden ? true : !i.hidden) && (!levelFilter || i.level === levelFilter));
  const s = data?.summary;

  return (
    <div className="flex flex-col gap-4">
      <Card padding={4}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-foreground">🧭 תובנות גרסה — סיכום {data?.versionName ?? versionName ?? ''}</div>
            <div className="mt-0.5 text-xs text-subtle-foreground">
              המשמעויות הניהוליות מתוך נתוני ניהול הבדיקות — לישיבת סיכום הגרסה
              {data && <> · עודכן <span dir="ltr">{formatDateTime(data.generatedAt)}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={loading} className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground">🔄 רענן</button>
            <button onClick={() => setEditing('new')} className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground">+ הוסף תובנה</button>
          </div>
        </div>

        {s && (
          <div className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <SummaryTile label='סה"כ תובנות' value={s.total} color={C.textPrimary} active={levelFilter === null} onClick={() => setLevelFilter(null)} />
            {LEVEL_ORDER.map(l => (
              <SummaryTile key={l} label={`${LEVEL[l].icon} ${l === 'CRITICAL' ? 'קריטיות' : l === 'WARNING' ? 'אזהרות' : l === 'INFO' ? 'מידע' : 'חיוביות'}`}
                value={s[l === 'CRITICAL' ? 'critical' : l === 'WARNING' ? 'warning' : l === 'INFO' ? 'info' : 'positive']}
                color={LEVEL[l].color} active={levelFilter === l} onClick={() => setLevelFilter(levelFilter === l ? null : l)} />
            ))}
          </div>
        )}
        {s && s.hidden > 0 && (
          <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> הצג תובנות מוסתרות ({s.hidden})
          </label>
        )}
      </Card>

      {error && <div className="rounded-lg border border-danger bg-danger-bg px-3.5 py-2.5 text-sm text-danger">⚠️ {error}</div>}
      {loading && !data && <div className="p-6 text-center text-sm text-subtle-foreground">מחשב תובנות...</div>}

      {data && list.length === 0 && (
        <div className="p-8 text-center text-sm text-subtle-foreground">{levelFilter ? 'אין תובנות ברמה זו' : 'אין תובנות להצגה'}</div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {list.map(i => (
          <InsightCard key={i.key} insight={i}
            onOpen={i.drill ? () => openDrill(i.drill!) : undefined}
            onHide={() => setHiding(i)} onUnhide={() => unhide(i)}
            onEdit={i.source === 'MANUAL' ? () => setEditing(i) : undefined} />
        ))}
      </div>

      {hiding && <HideDialog insight={hiding} versionId={versionId} headers={headers} onClose={() => setHiding(null)} onDone={() => { setHiding(null); load(); }} />}
      {editing && <ManualDialog insight={editing === 'new' ? null : editing} versionId={versionId} headers={headers} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {defectDrill && (
        <DefectDrilldownModal token={token} versionId={versionId} screen={defectDrill.screen} filter={defectDrill.filter}
          value={defectDrill.value} title={defectDrill.title} onClose={() => setDefectDrill(null)} />
      )}
      {crList && (
        <BrandedDialog onClose={() => setCrList(null)} title={crList.title} icon="📋" width="md" footer={<DialogButton variant="secondary" onClick={() => setCrList(null)}>סגור</DialogButton>}>
          <table className="w-full table-fixed border-collapse text-[13px]">
            <colgroup><col style={{ width: 90 }} /><col /><col style={{ width: 90 }} /></colgroup>
            <thead><tr className="bg-muted">{['CR', 'כותרת', 'ימים'].map(h => <th key={h} className="border-b border-border px-2 py-1.5 text-right text-xs font-semibold text-subtle-foreground">{h}</th>)}</tr></thead>
            <tbody>
              {crList.crs.map(c => (
                <tr key={c.crNumber} className="border-b border-border">
                  <td className="px-2 py-1.5 font-semibold text-primary">{c.crNumber}</td>
                  <td className="truncate px-2 py-1.5 text-foreground" title={c.label}>{c.label.replace(/^\d+\s*-\s*/, '')}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{c.days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </BrandedDialog>
      )}
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: number; color: string; active: boolean; onClick: () => void }> = ({ label, value, color, active, onClick }) => (
  <button onClick={onClick}
    className={cn('cursor-pointer rounded-lg border bg-card px-3 py-2.5 text-center', active ? 'border-primary ring-1 ring-primary' : 'border-border')}>
    <div className="text-xs text-subtle-foreground">{label}</div>
    <div className="text-2xl font-bold leading-tight" style={{ color }}>{value}</div>
  </button>
);

const InsightCard: React.FC<{ insight: Insight; onOpen?: () => void; onHide: () => void; onUnhide: () => void; onEdit?: () => void }> = ({ insight: i, onOpen, onHide, onUnhide, onEdit }) => {
  const lv = LEVEL[i.level];
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5', i.hidden && 'opacity-55')}
      style={{ borderInlineStart: `4px solid ${lv.color}` }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: lv.color, background: lv.bg }}>{lv.icon} {lv.label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{i.category}</span>
        <span className="ms-auto text-[11px] text-subtle-foreground">{i.source === 'AUTO' ? 'אוטומטית' : `ידנית${i.createdBy ? ` · ${i.createdBy}` : ''}`}</span>
      </div>
      <div className="text-[15px] font-bold leading-snug text-foreground">{i.title}</div>
      {i.text && <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground" dir="auto">{i.text}</div>}
      {i.hidden && (
        <div className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          הוסתרה: {i.hidden.reason}{i.hidden.by ? ` · ${i.hidden.by}` : ''} · <span dir="ltr">{formatDateTime(i.hidden.at)}</span>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {onOpen && <button onClick={onOpen} className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">פתח ←</button>}
        <span className="flex-1" />
        {onEdit && !i.hidden && <button onClick={onEdit} className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-primary">✎ ערוך</button>}
        {i.hidden
          ? <button onClick={onUnhide} className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-primary">↩ הצג שוב</button>
          : <button onClick={onHide} className="cursor-pointer border-none bg-transparent p-0 text-xs text-subtle-foreground hover:text-danger">{i.source === 'MANUAL' ? '🗑 מחק' : '🙈 הסתר'}</button>}
      </div>
    </div>
  );
};

// Hide ("delete") a finding for this version only — reason / note required.
const HideDialog: React.FC<{ insight: Insight; versionId: string; headers: any; onClose: () => void; onDone: () => void }> = ({ insight, versionId, headers, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await axios.post(`${API}/release-insights/${versionId}/hide`, { key: insight.key, level: insight.level, reason: reason.trim() }, { headers });
      onDone();
    } catch (e: any) { setErr(e?.response?.data?.message ?? 'הפעולה נכשלה'); setBusy(false); }
  };
  return (
    <BrandedDialog onClose={onClose} title={insight.source === 'MANUAL' ? 'מחיקת תובנה' : 'הסתרת תובנה'} icon="🙈" width="sm" busy={busy} closeOnBackdrop={false}
      footer={<>
        <DialogButton variant="secondary" onClick={onClose} disabled={busy}>ביטול</DialogButton>
        <DialogButton variant="danger" onClick={submit} disabled={busy || reason.trim().length < 2}>{insight.source === 'MANUAL' ? 'מחק' : 'הסתר'}</DialogButton>
      </>}>
      <div className="flex flex-col gap-2.5 text-sm">
        <div className="font-semibold text-foreground">{insight.title}</div>
        <div className="text-xs text-muted-foreground">
          התובנה תוסתר עבור הגרסה הנוכחית בלבד{insight.source === 'AUTO' ? ', ותחזור אוטומטית אם רמת החומרה שלה תחמיר' : ''}. ניתן להציג אותה שוב מ"הצג תובנות מוסתרות".
        </div>
        <label className="text-xs font-semibold text-muted-foreground">סיבה / הערה (חובה)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
          className="w-full resize-y rounded-md border border-border bg-card p-2 text-sm text-foreground" placeholder="למשל: סיכון מאושר בישיבת ההנהלה" />
        {err && <div className="text-xs text-danger">⚠️ {err}</div>}
      </div>
    </BrandedDialog>
  );
};

const ManualDialog: React.FC<{ insight: Insight | null; versionId: string; headers: any; onClose: () => void; onDone: () => void }> = ({ insight, versionId, headers, onClose, onDone }) => {
  const initialLink = (() => {
    const d = insight?.drill;
    if (!d) return { type: '', value: '' };
    if (d.kind === 'crDefects') return { type: 'cr', value: d.crNumber };
    if (d.kind === 'defects') return { type: 'defect', value: d.ids.join(', ') };
    if (d.kind === 'screen') return { type: d.module === 'quality-hub' ? 'kpi' : d.view, value: '' };
    return { type: '', value: '' };
  })();
  const [title, setTitle] = useState(insight?.title ?? '');
  const [text, setText] = useState(insight?.text ?? '');
  const [category, setCategory] = useState(insight?.category ?? 'כללי');
  const [level, setLevel] = useState<Level>(insight?.level ?? 'INFO');
  const [linkType, setLinkType] = useState(initialLink.type);
  const [linkValue, setLinkValue] = useState(initialLink.value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const link = LINKS.find(l => l.value === linkType);
  const submit = async () => {
    setBusy(true); setErr(null);
    const body = { title: title.trim(), text: text.trim(), category, level, linkType: linkType || null, linkValue: link?.needsValue ? linkValue.trim() : null };
    try {
      if (insight?.id) await axios.patch(`${API}/release-insights/${versionId}/manual/${insight.id}`, body, { headers });
      else await axios.post(`${API}/release-insights/${versionId}/manual`, body, { headers });
      onDone();
    } catch (e: any) { setErr(e?.response?.data?.message ?? 'השמירה נכשלה'); setBusy(false); }
  };
  const field = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground';
  const lbl = 'mb-1 block text-xs font-semibold text-muted-foreground';
  return (
    <BrandedDialog onClose={onClose} title={insight ? 'עריכת תובנה' : 'הוספת תובנה'} icon="🧭" width="md" busy={busy} closeOnBackdrop={false}
      footer={<>
        <DialogButton variant="secondary" onClick={onClose} disabled={busy}>ביטול</DialogButton>
        <DialogButton onClick={submit} disabled={busy || !title.trim() || (!!link?.needsValue && !linkValue.trim())}>{busy ? 'שומר...' : 'שמור'}</DialogButton>
      </>}>
      <div className="flex flex-col gap-3">
        <div><label className={lbl}>כותרת</label><input value={title} onChange={e => setTitle(e.target.value)} className={field} autoFocus /></div>
        <div><label className={lbl}>פירוט</label><textarea value={text} onChange={e => setText(e.target.value)} rows={4} className={cn(field, 'resize-y')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>קטגוריה</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>חומרה</label>
            <select value={level} onChange={e => setLevel(e.target.value as Level)} className={field}>
              {LEVEL_ORDER.map(l => <option key={l} value={l}>{LEVEL[l].icon} {LEVEL[l].label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>קישור לישות במערכת (אופציונלי)</label>
            <select value={linkType} onChange={e => { setLinkType(e.target.value); setLinkValue(''); }} className={field}>
              {LINKS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          {link?.needsValue && (
            <div><label className={lbl}>{link.needsValue}</label><input value={linkValue} onChange={e => setLinkValue(e.target.value)} className={field} dir="ltr" /></div>
          )}
        </div>
        {err && <div className="text-xs text-danger">⚠️ {err}</div>}
      </div>
    </BrandedDialog>
  );
};
