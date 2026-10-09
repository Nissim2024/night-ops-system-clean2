import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { DETAIL_FIELDS, DETAIL_FIELD_LABEL, DEFAULT_OPEN_PROD_DETAIL_GROUPS, DEFECT_FORM_FIXED_FIELDS, ATTACHMENTS_FIELD, ATTACHMENTS_FIELD_DEF, CREATE_REQUIRED_FIELDS, normalizeLayout, TOP_PANEL_COUNT, keepPairsTogether, pairPartnerOf, pairUp } from './openProdDefectsFields';
import { useDialog } from '../../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// AdminPanel "תבנית טופס תקלה" (user ask 2026-10-04): design the defect
// view/update form's panels — which fields, their order, panel names and
// panel order — per scope: a default for everyone, plus optional per-role and
// per-team layouts. A user gets team → role → default (backend
// resolveDefectFormLayout). The editor mirrors the form itself: panels and
// fields flow left-to-right, so "first" = leftmost, exactly as rendered.

interface Panel { name: string; fields: string[]; wide?: string[]; below?: boolean; }
interface Layout { panels: Panel[]; }
interface Layouts { default: Layout | null; roles: Record<string, Layout>; teams: Record<string, Layout>; }
interface TeamRow { id: string; name: string; }

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'מנהל מערכת', RELEASE_MANAGER: 'מנהל גרסה', CR_MANAGER: 'מנהל CR',
  TEAM_LEAD: 'ראש צוות', EMPLOYEE: 'עובד', VIEWER: 'צופה',
};

// three panels on top + a full-width "שדות נוספים" under them (normalizeLayout);
// an older saved layout is shown — and saved — in that shape
const builtinLayout = (): Layout => ({
  panels: normalizeLayout(DEFAULT_OPEN_PROD_DETAIL_GROUPS.map(g => ({ name: g.title, fields: [...g.fields], wide: [...(g.wide ?? [])] }))),
});
const cloneLayout = (l: Layout): Layout => ({ panels: normalizeLayout(l.panels).map(p => ({ name: p.name, fields: [...p.fields], wide: [...(p.wide ?? [])], ...(p.below ? { below: true } : {}) })) });
const toggleWide = (p: Panel, f: string) => { const w = p.wide ?? []; p.wide = w.includes(f) ? w.filter(x => x !== f) : [...w, f]; };
// Move a field to another place / panel (drag & drop or "העבר ל…", 2026-10-09);
// its ↔ full row setting goes with it.
const moveField = (l: Layout, fromPi: number, fi: number, toPi: number, toIdx?: number) => {
  const src = l.panels[fromPi], dst = l.panels[toPi];
  const f = src.fields[fi];
  const wasWide = !!src.wide?.includes(f);
  src.fields.splice(fi, 1);
  if (wasWide) toggleWide(src, f);
  let idx = toIdx ?? dst.fields.length;
  if (fromPi === toPi && toIdx !== undefined && fi < toIdx) idx--;
  dst.fields.splice(idx, 0, f);
  if (wasWide !== !!dst.wide?.includes(f)) toggleWide(dst, f);
  keepPairsTogether(l.panels, f);   // a related field follows it
};
// ▲/▼: a pair moves as one unit
const shiftField = (l: Layout, pi: number, f: string, dir: -1 | 1) => {
  const units = pairUp(l.panels[pi].fields).map(u => (Array.isArray(u) ? u : [u]));
  const i = units.findIndex(u => u.includes(f));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= units.length) return;
  [units[i], units[j]] = [units[j], units[i]];
  l.panels[pi].fields = units.flat();
};

const btn = 'cursor-pointer rounded-sm border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground disabled:cursor-default disabled:opacity-30';

export const DefectFormLayoutEditor: React.FC<{ token: string }> = ({ token }) => {
  const dialog = useDialog();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [layouts, setLayouts] = useState<Layouts | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [scope, setScope] = useState<string>('default'); // 'default' | 'role:X' | 'team:id'
  const [draft, setDraft] = useState<Layout | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState<{ pi: number; fi: number } | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null); // "pi" or "pi:fi"

  useEffect(() => {
    axios.get(`${API}/qc/defect-form-layouts`, { headers }).then(r => setLayouts(r.data)).catch(() => setLayouts({ default: null, roles: {}, teams: {} }));
    axios.get(`${API}/teams`, { headers }).then(r => setTeams((r.data ?? []).map((t: any) => ({ id: t.id, name: t.name })))).catch(() => setTeams([]));
  }, [headers]);

  const stored = (l: Layouts | null, sc: string): Layout | null => {
    if (!l) return null;
    if (sc === 'default') return l.default;
    if (sc.startsWith('role:')) return l.roles[sc.slice(5)] ?? null;
    if (sc.startsWith('team:')) return l.teams[sc.slice(5)] ?? null;
    return null;
  };

  // Load the selected scope's own layout into the editor (null = inherits).
  useEffect(() => {
    const own = stored(layouts, scope);
    setDraft(own ? cloneLayout(own) : null);
    setDirty(false);
    setMsg(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, layouts]);

  const inheritsFrom = scope === 'default'
    ? 'התבנית המובנית של המערכת'
    : layouts?.default ? 'תבנית ברירת המחדל' : 'התבנית המובנית של המערכת';

  const changeScope = async (next: string) => {
    if (dirty && !await dialog.confirm('יש שינויים שלא נשמרו. לעבור בכל זאת?', 'שינויים שלא נשמרו', 'warning')) return;
    setScope(next);
  };

  const update = (fn: (l: Layout) => void) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = cloneLayout(prev);
      fn(next);
      keepPairsTogether(next.panels);
      return next;
    });
    setDirty(true);
    setMsg(null);
  };

  const usedFields = new Set(draft?.panels.flatMap(p => p.fields) ?? []);
  // 📎 attachments is placeable too; when no panel has it, the form shows it in the first panel
  const availableFields = [...DETAIL_FIELDS, ATTACHMENTS_FIELD_DEF].filter(f => !DEFECT_FORM_FIXED_FIELDS.has(f.key) && !usedFields.has(f.key));
  const label = (k: string) => (k === ATTACHMENTS_FIELD ? ATTACHMENTS_FIELD_DEF.label : DETAIL_FIELD_LABEL[k] ?? k);

  const save = async (nextDraft: Layout | null) => {
    if (!layouts) return;
    const next: Layouts = { default: layouts.default, roles: { ...layouts.roles }, teams: { ...layouts.teams } };
    if (scope === 'default') next.default = nextDraft;
    else if (scope.startsWith('role:')) { if (nextDraft) next.roles[scope.slice(5)] = nextDraft; else delete next.roles[scope.slice(5)]; }
    else if (scope.startsWith('team:')) { if (nextDraft) next.teams[scope.slice(5)] = nextDraft; else delete next.teams[scope.slice(5)]; }
    setSaving(true);
    try {
      const r = await axios.put(`${API}/qc/defect-form-layouts`, next, { headers });
      setLayouts(r.data);
      setMsg({ ok: true, text: nextDraft ? 'התבנית נשמרה' : 'התבנית הייעודית נמחקה — הסקופ יורש כעת' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.message || 'השמירה נכשלה' });
    } finally {
      setSaving(false);
    }
  };

  const scopeHasOwn = (sc: string) => !!stored(layouts, sc);

  const topCount = draft?.panels.filter(p => !p.below).length ?? 0;
  const panelCard = (p: Panel, pi: number) => (
              <div key={pi} dir="rtl" className="flex flex-col gap-3 rounded-xl border bg-card p-4"
                style={{ borderColor: drag && dropAt === String(pi) ? '#0052CC' : undefined, borderWidth: drag && dropAt === String(pi) ? 2 : 1 }}
                onDragOver={e => { if (!drag) return; e.preventDefault(); if (dropAt !== String(pi) && !dropAt?.startsWith(`${pi}:`)) setDropAt(String(pi)); }}
                onDrop={e => { e.preventDefault(); if (drag) update(l => moveField(l, drag.pi, drag.fi, pi)); setDrag(null); setDropAt(null); }}>
                <div className="flex items-center gap-1.5">
                  <input
                    value={p.name}
                    onChange={e => update(l => { l.panels[pi].name = e.target.value; })}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm font-bold"
                    placeholder="שם החלונית"
                  />
                  <button className={btn} title="הזז שמאלה (מוקדם יותר)" disabled={pi === 0}
                    onClick={() => update(l => { [l.panels[pi - 1], l.panels[pi]] = [l.panels[pi], l.panels[pi - 1]]; })}>◀</button>
                  <button className={btn} title="הזז ימינה (מאוחר יותר)" disabled={pi === draft!.panels.length - 1}
                    onClick={() => update(l => { [l.panels[pi + 1], l.panels[pi]] = [l.panels[pi], l.panels[pi + 1]]; })}>▶</button>
                  <button className={btn}
                    title={p.below ? 'חלונית רחבה מתחת — לחץ כדי להעביר לשורה העליונה' : 'חלונית עליונה — לחץ כדי להפוך לחלונית רחבה מתחת'}
                    style={p.below ? { background: '#DEEBFF', color: '#0052CC', borderColor: '#0052CC' } : undefined}
                    onClick={() => update(l => { l.panels[pi].below = !l.panels[pi].below || undefined; })}>{p.below ? '⬇ רחבה' : '⬆ עליונה'}</button>
                  <button className={btn} title="מחק חלונית (השדות יחזרו לרשימת הזמינים)"
                    onClick={async () => { if (p.fields.length === 0 || await dialog.confirm(`למחוק את "${p.name}"? השדות יחזרו לרשימת הזמינים.`, 'מחיקת חלונית', 'danger')) update(l => { l.panels.splice(pi, 1); }); }}>🗑</button>
                </div>

                <div className={p.below ? 'grid gap-1' : 'flex flex-col gap-1'}
                  style={{ direction: 'ltr', ...(p.below ? { gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' } : {}) }}>
                  {p.fields.length === 0 && <span className="text-xs text-subtle-foreground" dir="rtl">אין שדות בחלונית</span>}
                  {p.fields.map((f, fi) => (
                    <div key={f} className="flex w-full items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-1 text-xs"
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); setDrag({ pi, fi }); }}
                      onDragEnd={() => { setDrag(null); setDropAt(null); }}
                      onDragOver={e => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (dropAt !== `${pi}:${fi}`) setDropAt(`${pi}:${fi}`); }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); if (drag) update(l => moveField(l, drag.pi, drag.fi, pi, fi)); setDrag(null); setDropAt(null); }}
                      title="גרור לחלונית אחרת או למקום אחר"
                      style={{
                        ...(p.wide?.includes(f) ? { borderColor: '#0052CC' } : {}),
                        cursor: 'grab',
                        opacity: drag && drag.pi === pi && drag.fi === fi ? 0.4 : 1,
                        boxShadow: drag && dropAt === `${pi}:${fi}` ? '0 -3px 0 0 #0052CC' : undefined,
                      }}>
                      <span className="select-none text-subtle-foreground" aria-hidden>⋮⋮</span>
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap font-semibold text-foreground" title={label(f)}>{label(f)}</span>
                      <button className={btn} title="למעלה (מוקדם יותר)" disabled={fi === 0}
                        onClick={() => update(l => shiftField(l, pi, f, -1))}>▲</button>
                      <button className={btn} title="למטה (מאוחר יותר)" disabled={fi === p.fields.length - 1}
                        onClick={() => update(l => shiftField(l, pi, f, 1))}>▼</button>
                      {pairPartnerOf(f) && p.fields.includes(pairPartnerOf(f)!) && (
                        <span className="shrink-0 cursor-help" title={`צמוד ל-${label(pairPartnerOf(f)!)} — תמיד זה לצד זה, זזים יחד`}>🔗</span>
                      )}
                      <button
                        className={btn}
                        disabled={!!pairPartnerOf(f) && p.fields.includes(pairPartnerOf(f)!)}
                        title={p.wide?.includes(f) ? 'שורה מלאה — לחץ לביטול' : 'תן לשדה שורה מלאה בחלונית (לערכים ארוכים)'}
                        style={p.wide?.includes(f) ? { background: '#DEEBFF', color: '#0052CC', borderColor: '#0052CC' } : undefined}
                        onClick={() => update(l => toggleWide(l.panels[pi], f))}
                      >↔</button>
                      {draft!.panels.length > 1 && (
                        <select
                          value=""
                          title="העבר לחלונית אחרת"
                          onChange={e => { const to = Number(e.target.value); if (e.target.value !== '') update(l => moveField(l, pi, fi, to)); }}
                          className="w-[74px] cursor-pointer rounded-sm border border-border bg-card px-0.5 text-[11px] text-muted-foreground"
                        >
                          <option value="">⇄ העבר ל…</option>
                          {draft!.panels.map((tp, ti) => ti !== pi && <option key={ti} value={ti}>{tp.name || `חלונית ${ti + 1}`}</option>)}
                        </select>
                      )}
                      {CREATE_REQUIRED_FIELDS.has(f) && <span className="font-bold" style={{ color: '#DE350B' }} title="שדה חובה ב-QC">*</span>}
                      <button className={btn} title="הסר מהטופס" onClick={() => update(l => { l.panels[pi].fields.splice(fi, 1); })}>✕</button>
                    </div>
                  ))}
                </div>

                {availableFields.length > 0 && (
                  <select
                    value=""
                    onChange={e => { const k = e.target.value; if (k) update(l => { l.panels[pi].fields.push(k); }); }}
                    className="self-start rounded-sm border border-dashed border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                  >
                    <option value="">+ הוסף שדה לחלונית…</option>
                    {availableFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                )}
              </div>
  );

  if (!layouts) return <div className="p-6 text-sm text-subtle-foreground">טוען תבניות…</div>;

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div>
        <div className="text-base font-bold text-foreground">🧩 תבנית טופס תקלה</div>
        <div className="mt-1 text-xs leading-relaxed text-subtle-foreground">
          קובעים אילו שדות יופיעו בטופס תצוגת/עדכון התקלה, באיזה סדר, ובאילו חלוניות. משתמש מקבל את תבנית הצוות שלו; אם אין — את תבנית התפקיד; אם אין — את ברירת המחדל.
          החלוניות והשדות מוצגים כאן כמו בטופס עצמו: הראשון משמאל. Title, Description ו-Comments קבועים מחוץ לחלוניות.
          להעברת שדה בין חלוניות: גרור אותו לחלונית אחרת (או למקום בין שדות), או בחר "העבר ל…" בשדה עצמו. 🔗 = שדות קשורים (Release+Cycle, Environment+Component, Responsibility+Assigned To, CR+Project, Detected By+Date) — מוצגים תמיד זה לצד זה וזזים יחד.
          מבנה הטופס: עד 3 חלוניות עליונות זו לצד זו, ומתחתן חלונית רחבה ("שדות נוספים") לשדות הפחות שכיחים — ⬇/⬆ בכותרת החלונית קובע אם היא עליונה או רחבה מתחת.
          אותה תבנית משמשת גם לפתיחת תקלה חדשה, באותם מקומות (שם החלונית הרחבה מקופלת). שדות חובה של QC מסומנים * בשני הטפסים.
        </div>
      </div>

      {/* ── scope picker ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-subtle-foreground">תבנית עבור:</span>
        <select value={scope} onChange={e => changeScope(e.target.value)} className="min-w-[260px] rounded-md border border-border bg-card px-3 py-2 text-sm">
          <option value="default">ברירת מחדל — כל המשתמשים{scopeHasOwn('default') ? ' ✓' : ''}</option>
          <optgroup label="לפי תפקיד">
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={`role:${k}`}>{v}{scopeHasOwn(`role:${k}`) ? ' ✓' : ''}</option>)}
          </optgroup>
          <optgroup label="לפי צוות">
            {[...teams].sort((a, b) => a.name.localeCompare(b.name)).map(t => <option key={t.id} value={`team:${t.id}`}>{t.name}{scopeHasOwn(`team:${t.id}`) ? ' ✓' : ''}</option>)}
          </optgroup>
        </select>
        <span className="text-[11px] text-subtle-foreground">✓ = יש לסקופ תבנית משלו</span>
      </div>

      {!draft ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card p-5">
          <div className="text-sm text-foreground">אין לסקופ הזה תבנית משלו — הוא יורש מ{inheritsFrom}.</div>
          <div className="flex flex-wrap gap-2">
            {scope !== 'default' && layouts.default && (
              <button onClick={() => { setDraft(cloneLayout(layouts.default!)); setDirty(true); }} className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-2 text-sm font-semibold text-white">
                צור תבנית — התחל מברירת המחדל
              </button>
            )}
            <button onClick={() => { setDraft(builtinLayout()); setDirty(true); }} className="cursor-pointer rounded-md border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground">
              צור תבנית — התחל מהתבנית המובנית
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── panels, laid out like the form (first = leftmost) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, direction: 'ltr' }}>
            {draft.panels.map((p, pi) => !p.below && panelCard(p, pi))}
          </div>
          {topCount > TOP_PANEL_COUNT && <div className="text-xs" style={{ color: '#974F0C' }}>⚠ {topCount} חלוניות עליונות — מומלץ עד {TOP_PANEL_COUNT} (⬇ להעברת חלונית מתחת)</div>}
          {draft.panels.map((p, pi) => p.below && panelCard(p, pi))}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => update(l => { l.panels.push({ name: 'חלונית חדשה', fields: [] }); })} className="cursor-pointer rounded-md border border-dashed border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              + חלונית חדשה
            </button>
            <span className="text-[11px] text-subtle-foreground">{availableFields.length} שדות זמינים שלא נמצאים בטופס</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              onClick={() => save(draft)}
              disabled={saving || !dirty}
              className={`rounded-md border-none px-4 py-2 text-sm font-bold text-white ${saving || !dirty ? 'cursor-default bg-subtle-foreground' : 'cursor-pointer bg-primary'}`}
            >
              {saving ? 'שומר…' : '💾 שמור תבנית'}
            </button>
            {dirty && (
              <button onClick={() => { const own = stored(layouts, scope); setDraft(own ? cloneLayout(own) : null); setDirty(false); }} className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                בטל שינויים
              </button>
            )}
            {scopeHasOwn(scope) && (
              <button
                onClick={async () => { if (await dialog.confirm('למחוק את התבנית הייעודית? הסקופ יחזור לרשת.', 'מחיקת תבנית', 'danger')) save(null); }}
                className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm text-danger"
              >
                מחק תבנית לסקופ זה
              </button>
            )}
            {msg && <span className={`text-sm font-semibold ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
};
