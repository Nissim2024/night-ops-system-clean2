import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useDialog } from '../../context/DialogContext';
import { DimItem, DIM_ORDER, DEFAULT_DIM_LABELS, BuiltinDim, Dim } from './analytics';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// AdminPanel "📊 לוח תקלות – הצג לפי" (user, 2026-10-10): the value list of the
// defects dashboard's "הצג לפי" chart — rename, reorder, hide, and add any QC
// defect field as a value. One list for everyone; a hidden value keeps
// working in charts people already pinned. Saved list → GET/PUT
// /qc/defects-analytics/dims; the dashboard reads it on load.

interface FieldOpt { key: string; label: string; kind: string }

const defaultList = (): DimItem[] => DIM_ORDER.map(k => ({ key: k, label: DEFAULT_DIM_LABELS[k] }));
const isBuiltin = (k: Dim): k is BuiltinDim => (DIM_ORDER as string[]).includes(k);
const btn = 'cursor-pointer rounded-sm border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground disabled:cursor-default disabled:opacity-30';
// a CR field gets the name the user asked for
const suggestedLabel = (f: FieldOpt) => (f.key === 'crHbrNumberReference' ? 'לפי CR' : f.label);

export const DefectsDashboardDimsPanel: React.FC<{ token: string }> = ({ token }) => {
  const dialog = useDialog();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [saved, setSaved] = useState<DimItem[] | null>(null);   // null = never customized
  const [draft, setDraft] = useState<DimItem[] | null>(null);
  const [fields, setFields] = useState<FieldOpt[]>([]);
  const [addKey, setAddKey] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (d: { dims: DimItem[] | null; fields: FieldOpt[] }) => {
    setSaved(d.dims);
    setDraft(d.dims ? d.dims.map(x => ({ ...x })) : defaultList());
    setFields(d.fields ?? []);
  };
  useEffect(() => {
    axios.get(`${API}/qc/defects-analytics/dims`, { headers }).then(r => apply(r.data)).catch(() => apply({ dims: null, fields: [] }));
  }, [headers]);

  const base = saved ?? defaultList();
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
  const update = (fn: (l: DimItem[]) => void) => setDraft(prev => { if (!prev) return prev; const n = prev.map(x => ({ ...x })); fn(n); return n; });
  const fieldOf = (k: Dim) => fields.find(f => `f:${f.key}` === k);
  const addable = fields.filter(f => !draft?.some(d => d.key === `f:${f.key}`));

  const save = async (reset = false) => {
    setSaving(true); setMsg(null);
    try {
      const r = await axios.put(`${API}/qc/defects-analytics/dims`, reset ? { reset: true } : { dims: draft }, { headers });
      apply(r.data);
      setMsg({ ok: true, text: reset ? 'הרשימה חזרה לברירת המחדל' : 'הרשימה נשמרה — תוצג בלוח התקלות בטעינה הבאה' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || 'השמירה נכשלה' });
    } finally { setSaving(false); }
  };

  if (!draft) return <div className="p-6 text-sm text-subtle-foreground">טוען…</div>;
  const shown = draft.filter(d => !d.hidden).length;

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div>
        <div className="text-base font-bold text-foreground">📊 לוח תקלות — רשימת "הצג לפי"</div>
        <div className="mt-1 text-xs leading-relaxed text-subtle-foreground">
          הערכים שמופיעים בגרף "הצג לפי" (ובבחירת "פילוח לפי") במודול 🐞 תקלות — לכל המשתמשים.
          אפשר לשנות שם, לסדר, להסתיר, ולהוסיף כל שדה של תקלה ב-QC כערך חדש; הגרף עובד עליו בדיוק כמו על ערך מובנה (סוגי גרף, פילוח, Top 10, הקלקה לרשימת התקלות, הצמדה).
          ערך מוסתר נעלם מהרשימה אבל גרף שכבר הוצמד איתו ממשיך לעבוד. שדה CR מקובץ לפי מספר ה-CR.
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-xs text-subtle-foreground">
              <th className="w-[70px] px-3 py-2 text-start font-semibold">סדר</th>
              <th className="px-3 py-2 text-start font-semibold">שם בגרף</th>
              <th className="px-3 py-2 text-start font-semibold">מקור</th>
              <th className="w-[110px] px-3 py-2 text-start font-semibold">מוצג</th>
              <th className="w-[44px] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {draft.map((d, i) => {
              const f = fieldOf(d.key);
              return (
                <tr key={d.key} className="border-t border-border" style={{ opacity: d.hidden ? 0.55 : 1 }}>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      <button className={btn} disabled={i === 0} title="למעלה" onClick={() => update(l => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}>▲</button>
                      <button className={btn} disabled={i === draft.length - 1} title="למטה" onClick={() => update(l => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}>▼</button>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <input value={d.label} maxLength={40} onChange={e => update(l => { l[i].label = e.target.value; })}
                      className="w-full max-w-[280px] rounded-sm border border-border bg-background px-2 py-1 text-sm" />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-subtle-foreground">
                    {isBuiltin(d.key)
                      ? <>מובנה{d.label !== DEFAULT_DIM_LABELS[d.key] && <> · במקור "{DEFAULT_DIM_LABELS[d.key]}"</>}</>
                      : <>שדה QC: <span dir="ltr">{f?.label ?? d.key.slice(2)}</span>{(d.key === 'f:crHbrNumberReference' || d.key === 'f:crReferenceNumber') && ' · מקובץ לפי מספר CR'}</>}
                  </td>
                  <td className="px-3 py-1.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
                      <input type="checkbox" checked={!d.hidden} onChange={e => update(l => { if (e.target.checked) delete l[i].hidden; else l[i].hidden = true; })} />
                      {d.hidden ? 'מוסתר' : 'מוצג'}
                    </label>
                  </td>
                  <td className="px-3 py-1.5">
                    {!isBuiltin(d.key) && (
                      <button className={btn} title="הסר את הערך מהרשימה" onClick={() => update(l => { l.splice(i, 1); })}>🗑</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* add a QC field as a value */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-3">
        <span className="text-sm font-semibold text-foreground">➕ הוסף ערך:</span>
        <select value={addKey} onChange={e => {
          const k = e.target.value; setAddKey(k);
          const f = fields.find(x => x.key === k); setAddLabel(f ? suggestedLabel(f) : '');
        }} className="min-w-[240px] rounded-md border border-border bg-background px-2 py-1.5 text-sm" dir="ltr">
          <option value="">— בחר שדה של תקלה ב-QC —</option>
          {addable.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <input value={addLabel} onChange={e => setAddLabel(e.target.value)} maxLength={40} placeholder="שם בגרף"
          className="w-[200px] rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        <button disabled={!addKey || !addLabel.trim()}
          onClick={() => { update(l => { l.push({ key: `f:${addKey}` as Dim, label: addLabel.trim() }); }); setAddKey(''); setAddLabel(''); }}
          className="cursor-pointer rounded-md border-none bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40">
          הוסף לרשימה
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button onClick={() => save()} disabled={saving || !dirty || shown === 0}
          className={`rounded-md border-none px-4 py-2 text-sm font-bold text-white ${saving || !dirty || shown === 0 ? 'cursor-default bg-subtle-foreground' : 'cursor-pointer bg-primary'}`}>
          {saving ? 'שומר…' : '💾 שמור'}
        </button>
        {dirty && (
          <button onClick={() => setDraft(base.map(x => ({ ...x })))} className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">בטל שינויים</button>
        )}
        {saved && (
          <button onClick={async () => { if (await dialog.confirm('להחזיר את הרשימה לברירת המחדל? ערכים שנוספו יוסרו.', 'שחזור ברירת מחדל', 'warning')) save(true); }}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">↺ שחזר ברירת מחדל</button>
        )}
        {shown === 0 && <span className="text-sm text-danger">חייב להישאר לפחות ערך אחד מוצג</span>}
        {msg && <span className={`text-sm font-semibold ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span>}
        <span className="ms-auto text-xs text-subtle-foreground">{shown} מוצגים · {draft.length - shown} מוסתרים</span>
      </div>
    </div>
  );
};
