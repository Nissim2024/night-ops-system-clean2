import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C, FONT_MONO } from '../theme';
import { cn } from '../lib/utils';
import { useDialog } from '../context/DialogContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// AdminPanel → אינטגרציות → AI (2026-10-09): which AI provider the system
// uses (Claude / Gemini / OpenAI-compatible / Azure), every prompt it sends
// (view, edit, try on sample data), the firewall rules IT has to open, and
// the recent AI calls.

type ProviderId = 'anthropic' | 'gemini' | 'openai' | 'azure';
interface ProviderSettings { apiKey?: string; hasKey?: boolean; model?: string; baseUrl?: string; apiVersion?: string; authHeader?: string }
interface AiConfigView { activeProvider: ProviderId; providers: Record<ProviderId, ProviderSettings>; proxyUrl?: string; timeoutMs?: number }
type ProviderMeta = Record<ProviderId, { label: string; defaultBaseUrl: string; defaultModel: string; keyHelp: string }>;

const input = 'w-full rounded-md bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none';
const inputStyle: React.CSSProperties = { border: `1px solid ${C.border}` };
const btn = 'cursor-pointer rounded-md bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
const btnStyle: React.CSSProperties = { border: `1px solid ${C.border}` };
const btnPrimary = 'cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const card: React.CSSProperties = { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 };

export const AiSettingsPanel: React.FC<{ token: string }> = ({ token }) => {
  const [section, setSection] = useState<'providers' | 'prompts' | 'firewall' | 'calls'>('providers');
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const tabs: { key: typeof section; label: string }[] = [
    { key: 'providers', label: '🔑 ספק ומפתחות' },
    { key: 'prompts', label: '📝 פרומפטים' },
    { key: 'firewall', label: '🛡️ Firewall וחיבור' },
    { key: 'calls', label: '📜 יומן קריאות' },
  ];
  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.key} type="button" onClick={() => setSection(t.key)}
            className={cn('cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold', section === t.key ? 'bg-primary text-white' : 'bg-card text-foreground')}
            style={section === t.key ? undefined : btnStyle}>{t.label}</button>
        ))}
      </div>
      {section === 'providers' && <ProvidersSection headers={headers} />}
      {section === 'prompts' && <PromptsSection headers={headers} />}
      {section === 'firewall' && <FirewallSection headers={headers} />}
      {section === 'calls' && <CallsSection headers={headers} />}
    </div>
  );
};

// ── providers ──────────────────────────────────────────────────────────────
const ProvidersSection: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [cfg, setCfg] = useState<AiConfigView | null>(null);
  const [meta, setMeta] = useState<ProviderMeta | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [tests, setTests] = useState<Partial<Record<ProviderId, { ok: boolean; text: string }>>>({});
  const load = useCallback(() => {
    axios.get(`${API}/ai/config`, { headers }).then(r => { setCfg(r.data.config); setMeta(r.data.providers); })
      .catch(e => setMsg({ kind: 'err', text: e?.response?.data?.message || 'טעינת הגדרות ה-AI נכשלה' }));
  }, [headers]);
  useEffect(load, [load]);
  if (!cfg || !meta) return <div style={card}>{msg?.text ?? 'טוען…'}</div>;

  const set = (id: ProviderId, k: keyof ProviderSettings, v: string) =>
    setCfg(c => c && ({ ...c, providers: { ...c.providers, [id]: { ...c.providers[id], [k]: v } } }));
  const save = async () => {
    setMsg(null);
    try {
      const r = await axios.put(`${API}/ai/config`, cfg, { headers });
      setCfg(r.data.config);
      setMsg({ kind: 'ok', text: '✓ ההגדרות נשמרו' });
    } catch (e: any) { setMsg({ kind: 'err', text: e?.response?.data?.message || 'השמירה נכשלה' }); }
  };
  const test = async (id: ProviderId) => {
    setTesting(id);
    try {
      await axios.put(`${API}/ai/config`, cfg, { headers });   // test what is on screen
      const r = await axios.post(`${API}/ai/test/${id}`, {}, { headers });
      setTests(t => ({ ...t, [id]: { ok: true, text: `✓ ענה "${r.data.answer}" · ${r.data.model} · ${(r.data.ms / 1000).toFixed(1)} שנ'` } }));
      load();
    } catch (e: any) {
      setTests(t => ({ ...t, [id]: { ok: false, text: e?.response?.data?.message || 'הבדיקה נכשלה' } }));
    } finally { setTesting(null); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div style={card} className="flex flex-col gap-2">
        <h3 className="m-0 text-base font-bold">🤖 ספק ה-AI של המערכת</h3>
        <p className="m-0 text-sm text-muted-foreground">
          כל יכולות ה-AI במערכת (ניתוח תקלות שורש, סיכום CR, ניתוח תקלות לפי KPI ועוד) עוברות דרך הספק הפעיל. אפשר להגדיר כמה ספקים ולעבור ביניהם.
          מפתחות נשמרים בשרת בלבד ומוצגים מוסתרים.
        </p>
        {msg && <div className={cn('rounded-md px-3 py-2 text-[13px] font-semibold', msg.kind === 'ok' ? 'text-success' : 'text-danger')} style={{ background: msg.kind === 'ok' ? C.successBg : C.bgBlocked }}>{msg.text}</div>}
      </div>

      {(Object.keys(meta) as ProviderId[]).map(id => {
        const p = cfg.providers[id] ?? {};
        const active = cfg.activeProvider === id;
        return (
          <div key={id} style={{ ...card, borderColor: active ? C.brand : C.border, borderWidth: active ? 2 : 1 }} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[15px] font-bold">
                <input type="radio" name="ai-active" checked={active} onChange={() => setCfg({ ...cfg, activeProvider: id })} />
                {meta[id].label}
              </label>
              {active && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: C.brand }}>פעיל</span>}
              {p.hasKey ? <span className="text-xs text-success">● מפתח מוגדר</span> : <span className="text-xs text-muted-foreground">○ אין מפתח</span>}
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              <Field label="מפתח API" hint={meta[id].keyHelp}>
                <input className={input} style={inputStyle} dir="ltr" type="password" autoComplete="off"
                  placeholder={p.hasKey ? `${p.apiKey} (השאר ריק כדי לשמור)` : 'הדבק מפתח'}
                  value={p.apiKey?.includes('…') ? '' : (p.apiKey ?? '')} onChange={e => set(id, 'apiKey', e.target.value)} />
              </Field>
              <Field label="מודל" hint={`ברירת מחדל: ${meta[id].defaultModel}`}>
                <input className={input} style={inputStyle} dir="ltr" value={p.model ?? ''} placeholder={meta[id].defaultModel} onChange={e => set(id, 'model', e.target.value)} />
              </Field>
              <Field label="כתובת שרת" hint="ריק = הכתובת הציבורית של הספק; ל-Gemini פנימי — כתובת ה-Gateway">
                <input className={input} style={inputStyle} dir="ltr" value={p.baseUrl ?? ''} placeholder={meta[id].defaultBaseUrl} onChange={e => set(id, 'baseUrl', e.target.value)} />
              </Field>
              {id === 'azure' && (
                <Field label="api-version">
                  <input className={input} style={inputStyle} dir="ltr" value={p.apiVersion ?? ''} placeholder="2024-10-21" onChange={e => set(id, 'apiVersion', e.target.value)} />
                </Field>
              )}
              {(id === 'gemini' || id === 'openai') && (
                <Field label="Header אימות" hint="רק ל-Gateway פנימי שדורש Header אחר">
                  <input className={input} style={inputStyle} dir="ltr" value={p.authHeader ?? ''} placeholder={id === 'gemini' ? 'x-goog-api-key' : 'Authorization'} onChange={e => set(id, 'authHeader', e.target.value)} />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btn} style={btnStyle} onClick={() => test(id)} disabled={testing !== null}>{testing === id ? 'בודק…' : '🔌 בדוק חיבור'}</button>
              {tests[id] && <span className={cn('text-[13px]', tests[id]!.ok ? 'text-success' : 'text-danger')}>{tests[id]!.text}</span>}
            </div>
          </div>
        );
      })}

      <div style={card} className="flex flex-col gap-3">
        <h4 className="m-0 text-sm font-bold">רשת</h4>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          <Field label="Proxy ליציאה לאינטרנט" hint="אם יש בארגון, למשל http://proxy.corp:8080">
            <input className={input} style={inputStyle} dir="ltr" value={cfg.proxyUrl ?? ''} onChange={e => setCfg({ ...cfg, proxyUrl: e.target.value })} />
          </Field>
          <Field label="זמן המתנה מקסימלי לתשובה (שניות)">
            <input className={input} style={inputStyle} dir="ltr" type="number" min={10} max={600} value={Math.round((cfg.timeoutMs ?? 120000) / 1000)}
              onChange={e => setCfg({ ...cfg, timeoutMs: Math.max(10, Number(e.target.value) || 120) * 1000 })} />
          </Field>
        </div>
      </div>
      <div><button type="button" className={btnPrimary} onClick={save}>שמור הגדרות</button></div>
    </div>
  );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground">
    {label}
    {children}
    {hint && <span className="text-[11px] font-normal" dir="auto">{hint}</span>}
  </label>
);

// ── prompts ────────────────────────────────────────────────────────────────
interface PromptView {
  id: string; title: string; description: string; usedIn: string; wired: boolean; output: 'text' | 'json' | 'chat';
  template: string; system: string | null; defaultTemplate: string; defaultSystem: string | null;
  vars: Record<string, string>; edited: boolean; editedAt: string | null; editedBy: string | null;
  sampleRendered: { system: string | null; prompt: string };
}

const PromptsSection: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [list, setList] = useState<PromptView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    axios.get(`${API}/ai/prompts`, { headers }).then(r => setList(r.data ?? [])).catch(() => {});
  }, [headers]);
  useEffect(load, [load]);
  return (
    <div className="flex flex-col gap-3">
      <div style={card}>
        <h3 className="m-0 text-base font-bold">📝 הפרומפטים שהמערכת שולחת ל-AI</h3>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          כל פרומפט מוצג כפי שהוא נשלח, עם נתוני דוגמה. השדות ב-{'{{סוגריים}}'} הם הנתונים שהמערכת ממלאת — אפשר לשנות את הניסוח סביבם.
          "נסה" שולח את הפרומפט עם נתוני הדוגמה לספק הפעיל ומציג את התשובה.
        </p>
      </div>
      {list.map(p => (
        <div key={p.id} style={card} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => setOpenId(o => (o === p.id ? null : p.id))} className="cursor-pointer border-none bg-transparent p-0 text-start text-[15px] font-bold text-foreground">
              {openId === p.id ? '▾' : '▸'} {p.title}
            </button>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: p.wired ? C.success : C.warning, border: `1px solid ${p.wired ? C.success : C.warning}` }}>
              {p.wired ? 'בשימוש' : 'מוצע — טרם מחובר למסך'}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${C.border}` }}>פלט: {p.output === 'json' ? 'JSON' : p.output === 'chat' ? 'שיחה' : 'טקסט'}</span>
            {p.edited && <span className="text-[11px] text-warning">✎ נערך{p.editedBy ? ` ע"י ${p.editedBy}` : ''}</span>}
          </div>
          <div className="text-[13px] text-muted-foreground">{p.description} · <span className="font-semibold">היכן:</span> {p.usedIn}</div>
          {openId === p.id && <PromptEditor p={p} headers={headers} onChanged={load} />}
        </div>
      ))}
    </div>
  );
};

const PromptEditor: React.FC<{ p: PromptView; headers: Record<string, string>; onChanged: () => void }> = ({ p, headers, onChanged }) => {
  const dialog = useDialog();
  const [view, setView] = useState<'sample' | 'edit'>('sample');
  const [template, setTemplate] = useState(p.template);
  const [system, setSystem] = useState(p.system ?? '');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState<{ text: string; meta: string; err?: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = template !== p.template || (p.system !== null && system !== (p.system ?? ''));

  const save = async () => {
    setMsg(null);
    try { await axios.put(`${API}/ai/prompts/${p.id}`, { template, ...(p.system !== null ? { system } : {}) }, { headers }); setMsg('✓ נשמר'); onChanged(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'השמירה נכשלה'); }
  };
  const reset = async () => {
    if (!await dialog.confirm('לשחזר את הנוסח המקורי של הפרומפט? השינויים שלך יימחקו.', 'שחזור ברירת מחדל', 'warning')) return;
    await axios.delete(`${API}/ai/prompts/${p.id}`, { headers });
    setTemplate(p.defaultTemplate); setSystem(p.defaultSystem ?? ''); onChanged();
  };
  const tryIt = async () => {
    setBusy(true); setTried(null);
    try {
      const r = await axios.post(`${API}/ai/prompts/${p.id}/try`, { template, ...(p.system !== null ? { system } : {}) }, { headers });
      setTried({ text: r.data.text, meta: `${r.data.provider} · ${r.data.model} · ${(r.data.ms / 1000).toFixed(1)} שנ'` });
    } catch (e: any) { setTried({ text: e?.response?.data?.message || 'הבקשה נכשלה', meta: '', err: true }); }
    finally { setBusy(false); }
  };

  const pre: React.CSSProperties = { fontFamily: FONT_MONO, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, maxHeight: 460, overflow: 'auto', margin: 0 };
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={view === 'sample' ? btnPrimary : btn} style={view === 'sample' ? undefined : btnStyle} onClick={() => setView('sample')}>👁 כפי שנשלח (עם נתוני דוגמה)</button>
        <button type="button" className={view === 'edit' ? btnPrimary : btn} style={view === 'edit' ? undefined : btnStyle} onClick={() => setView('edit')}>✏️ עריכת הנוסח</button>
        <button type="button" className={btn} style={btnStyle} onClick={tryIt} disabled={busy}>{busy ? 'שולח…' : '▶ נסה עם נתוני הדוגמה'}</button>
      </div>

      {view === 'sample' && (
        <>
          {p.sampleRendered.system && <><div className="text-xs font-semibold text-muted-foreground">הנחיית מערכת (System):</div><pre style={pre} dir="auto">{p.sampleRendered.system}</pre></>}
          <div className="text-xs font-semibold text-muted-foreground">{p.output === 'chat' ? 'הודעת הפתיחה:' : 'הפרומפט:'}</div>
          <pre style={pre} dir="auto">{p.sampleRendered.prompt}</pre>
        </>
      )}

      {view === 'edit' && (
        <>
          <div className="rounded-md p-2.5 text-xs" style={{ background: C.bgNested }}>
            <div className="mb-1 font-semibold">שדות הנתונים (חייבים להישאר בפרומפט):</div>
            {Object.entries(p.vars).map(([k, v]) => <div key={k}><code style={{ fontFamily: FONT_MONO }}>{`{{${k}}}`}</code> — {v}</div>)}
            {p.output === 'json' && <div className="mt-1.5 text-warning">⚠ הפיצ'ר מצפה לתשובת JSON במבנה שמתואר בפרומפט — אין לשנות את שמות השדות במבנה.</div>}
          </div>
          {p.system !== null && (
            <>
              <div className="text-xs font-semibold text-muted-foreground">הנחיית מערכת (System):</div>
              <textarea className={input} style={{ ...inputStyle, fontFamily: FONT_MONO, fontSize: 12, minHeight: 260 }} dir="auto" value={system} onChange={e => setSystem(e.target.value)} />
            </>
          )}
          <div className="text-xs font-semibold text-muted-foreground">{p.output === 'chat' ? 'הודעת הפתיחה:' : 'הפרומפט:'}</div>
          <textarea className={input} style={{ ...inputStyle, fontFamily: FONT_MONO, fontSize: 12, minHeight: 320 }} dir="auto" value={template} onChange={e => setTemplate(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} onClick={save} disabled={!dirty}>שמור נוסח</button>
            {p.edited && <button type="button" className={btn} style={btnStyle} onClick={reset}>↺ שחזר ברירת מחדל</button>}
            {msg && <span className="text-[13px]">{msg}</span>}
          </div>
        </>
      )}

      {tried && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold" style={{ color: tried.err ? C.danger : C.success }}>{tried.err ? '✗ שגיאה' : `✓ תשובת ה-AI · ${tried.meta}`}</div>
          <pre style={{ ...pre, borderColor: tried.err ? C.danger : C.border }} dir="auto">{tried.text}</pre>
        </div>
      )}
    </div>
  );
};

// ── firewall ───────────────────────────────────────────────────────────────
interface FwRule { provider: string; label: string; direction: string; source: string; destination: string; port: number; protocol: string; purpose: string; active: boolean }
type Step = { ok: boolean; detail: string; ms: number };
interface FwCheck { provider: string; label: string; destination: string; port: number; dns: Step; tcp: Step; https?: Step; verdict: string }

const FirewallSection: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [data, setData] = useState<{ server: { hostname: string; addresses: string[]; inDocker: boolean }; rules: FwRule[]; requestText: string; proxyUrl: string } | null>(null);
  const [checks, setChecks] = useState<FwCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { axios.get(`${API}/ai/network`, { headers }).then(r => setData(r.data)).catch(() => {}); }, [headers]);
  if (!data) return <div style={card}>טוען…</div>;

  const check = async () => {
    setChecking(true); setChecks(null);
    try { setChecks((await axios.post(`${API}/ai/network/check`, {}, { headers })).data); }
    finally { setChecking(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.requestText); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const th = 'px-2.5 py-2 text-right text-xs font-bold';
  const td = 'px-2.5 py-2 text-[13px] align-top';
  const cellBorder: React.CSSProperties = { borderTop: `1px solid ${C.border}` };
  const stepCell = (s?: Step) => s
    ? <span style={{ color: s.ok ? C.success : C.danger }}>{s.ok ? '✓' : '✗'} {s.detail}{s.ms ? <span className="text-muted-foreground"> · {s.ms}ms</span> : null}</span>
    : <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-col gap-4">
      <div style={card} className="flex flex-col gap-2">
        <h3 className="m-0 text-base font-bold">🛡️ חוקי Firewall לשירות ה-AI</h3>
        <p className="m-0 text-sm text-muted-foreground">
          החוקים שצוות התשתיות צריך לפתוח כדי ששרת DeployCenter יגיע לספק ה-AI. הטבלה נבנית מהספקים שהוגדרו בלשונית "ספק ומפתחות"{data.proxyUrl ? ' ומה-Proxy שהוגדר' : ''}.
          החיבור יוצא מהשרת בלבד (אין צורך בחיבור נכנס) ומוצפן ב-TLS.
        </p>
        <div className="text-[13px]">
          <b>שרת המקור:</b> <span className="font-mono" dir="ltr">{data.server.hostname}</span>
          {data.server.addresses.length > 0 && <> · <span className="font-mono" dir="ltr">{data.server.addresses.join(', ')}</span></>}
          {data.server.inDocker && <span className="text-warning"> · המערכת רצה ב-Docker — בבקשה ל-IT יש לציין את כתובת השרת המארח</span>}
        </div>
      </div>

      <div style={card} className="flex flex-col gap-3">
        {data.rules.length === 0
          ? <div className="text-sm text-muted-foreground">לא הוגדר אף ספק עם כתובת — הגדר ספק בלשונית "ספק ומפתחות".</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr style={{ background: C.bgNested }}>
                  {['כיוון', 'מקור', 'יעד (FQDN)', 'פורט', 'פרוטוקול', 'מטרה'].map(h => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.rules.map((r, i) => (
                    <tr key={i} style={cellBorder}>
                      <td className={td}>{r.direction} ←</td>
                      <td className={td}>{r.source}</td>
                      <td className={cn(td, 'font-mono')} dir="ltr" style={{ textAlign: 'right', fontWeight: r.active ? 700 : 400 }}>{r.destination}{r.active && <span className="ms-1.5 text-[11px] text-white" style={{ background: C.brand, borderRadius: 999, padding: '1px 6px' }}>פעיל</span>}</td>
                      <td className={cn(td, 'font-mono')}>TCP {r.port}</td>
                      <td className={td}>{r.protocol}</td>
                      <td className={td}>{r.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="text-xs text-muted-foreground">כתובות ה-IP של שירותי ענן משתנות — מומלץ חוק לפי שם (FQDN). ל-Gemini פנימי / Gateway ארגוני היעד הוא הכתובת הפנימית שהוגדרה.</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={check} disabled={checking || data.rules.length === 0}>{checking ? 'בודק מהשרת…' : '🔍 בדוק חיבור מהשרת'}</button>
          <button type="button" className={btn} style={btnStyle} onClick={copy}>{copied ? '✓ הועתק' : '📋 העתק בקשה ל-IT'}</button>
        </div>
      </div>

      {checks && (
        <div style={card} className="flex flex-col gap-2">
          <h4 className="m-0 text-sm font-bold">תוצאות בדיקה מהשרת</h4>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr style={{ background: C.bgNested }}>{['יעד', 'DNS', 'TCP', 'HTTPS', 'מסקנה'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {checks.map((c, i) => {
                  const ok = c.tcp.ok && (c.https ? c.https.ok : true) && c.dns.ok;
                  return (
                    <tr key={i} style={cellBorder}>
                      <td className={cn(td, 'font-mono')} dir="ltr" style={{ textAlign: 'right' }}>{c.destination}:{c.port}</td>
                      <td className={td}>{stepCell(c.dns)}</td>
                      <td className={td}>{stepCell(c.tcp)}</td>
                      <td className={td}>{stepCell(c.https)}</td>
                      <td className={td} style={{ fontWeight: 700, color: ok ? C.success : C.danger }}>{c.verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={card} className="flex flex-col gap-2">
        <h4 className="m-0 text-sm font-bold">נוסח הבקשה ל-IT</h4>
        <pre style={{ fontFamily: FONT_MONO, fontSize: 12, whiteSpace: 'pre-wrap', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, margin: 0 }} dir="auto">{data.requestText}</pre>
      </div>
    </div>
  );
};

// ── recent calls ───────────────────────────────────────────────────────────
const CallsSection: React.FC<{ headers: Record<string, string> }> = ({ headers }) => {
  const [rows, setRows] = useState<{ at: string; feature: string; provider: string; model: string; ms: number; ok: boolean; inputChars: number; outputChars: number; error?: string }[]>([]);
  const load = useCallback(() => { axios.get(`${API}/ai/calls`, { headers }).then(r => setRows(r.data ?? [])).catch(() => {}); }, [headers]);
  useEffect(load, [load]);
  return (
    <div style={card} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-base font-bold">📜 100 הקריאות האחרונות ל-AI</h3>
        <button type="button" className={btn} style={btnStyle} onClick={load}>רענן</button>
      </div>
      <div className="text-xs text-muted-foreground">נשמר בזיכרון השרת עד הפעלה מחדש. כמות התווים נותנת הערכה לעלות.</div>
      {rows.length === 0 ? <div className="text-sm text-muted-foreground">אין קריאות עדיין.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr style={{ background: C.bgNested }}>{['מתי', 'יכולת', 'ספק / מודל', 'זמן', 'תווים נשלחו / התקבלו', 'תוצאה'].map(h => <th key={h} className="px-2.5 py-2 text-right text-xs font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="px-2.5 py-1.5">{new Date(r.at).toLocaleString('he-IL')}</td>
                  <td className="px-2.5 py-1.5">{r.feature}</td>
                  <td className="px-2.5 py-1.5 font-mono" dir="ltr" style={{ textAlign: 'right' }}>{r.provider} · {r.model}</td>
                  <td className="px-2.5 py-1.5">{(r.ms / 1000).toFixed(1)} שנ'</td>
                  <td className="px-2.5 py-1.5">{r.inputChars.toLocaleString()} / {r.outputChars.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5" style={{ color: r.ok ? C.success : C.danger }}>{r.ok ? '✓' : `✗ ${r.error ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
