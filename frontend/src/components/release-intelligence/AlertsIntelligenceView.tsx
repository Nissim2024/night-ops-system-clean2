import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Insight {
  id: string; category: string; severity: string; title: string | null; message: string; recommendation: string | null; createdAt: string;
}
interface Alerts { manual: Insight[]; auto: Insight[]; }

const MANUAL_CATEGORIES = [
  { value: 'ANNOUNCEMENT', label: 'הודעה' },
  { value: 'ENVIRONMENT', label: 'סביבה' },
  { value: 'KNOWN_ISSUE', label: 'תקלה ידועה' },
  { value: 'RELEASE', label: 'גרסה' },
  { value: 'BLOCKER', label: 'חוסם' },
];

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: C.danger, HIGH: '#f0883e', MEDIUM: '#e8af00', LOW: C.textMuted };

const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

interface Props { token: string; versionId?: string; role: string; }

export const AlertsIntelligenceView: React.FC<Props> = ({ token, versionId, role }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<Alerts | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState('ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);

  const canWrite = RISK_WRITERS.includes(role);

  const load = useCallback(() => {
    if (!versionId) { setData(null); return; }
    setLoading(true);
    axios.get(`${API}/release-intelligence/alerts/${versionId}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, token]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!versionId || !title.trim() || !message.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API}/release-intelligence/alerts`, { versionId, category, severity, title: title.trim(), message: message.trim() }, { headers });
      setTitle(''); setMessage(''); setCategory('ANNOUNCEMENT'); setSeverity('MEDIUM'); setAdding(false);
      load();
    } catch (e) { console.error('failed to create alert', e); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await axios.delete(`${API}/release-intelligence/alerts/${id}`, { headers }); load(); }
    catch (e) { console.error('failed to delete alert', e); }
  };

  if (!versionId) {
    return <div className="p-8 text-center text-subtle-foreground [direction:rtl]">בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div className="p-6 text-subtle-foreground [direction:rtl]">טוען...</div>;
  if (!data) return <div className="p-6 text-subtle-foreground [direction:rtl]">לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div className="flex flex-col gap-4 [direction:rtl]">
      <div className="text-lg font-bold text-foreground">🔔 התראות ותובנות</div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[320px] flex-1 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">📢 הודעות ידניות</div>
          </div>
          {data.manual.length === 0 && !adding && <div className="text-sm text-subtle-foreground">אין הודעות.</div>}
          {data.manual.map(m => (
            <div key={m.id} className="flex items-start gap-2 border-b border-border py-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[m.severity] ?? C.textMuted }} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">{m.title}</div>
                <div className="text-xs text-subtle-foreground">{m.message}</div>
                <div className="mt-0.5 text-xs text-subtle-foreground">{m.category}</div>
              </div>
              {canWrite && (
                <button onClick={() => remove(m.id)} className="cursor-pointer border-none bg-transparent text-[14px] text-subtle-foreground">✕</button>
              )}
            </div>
          ))}
          {canWrite && (
            adding ? (
              <div className="mt-3 flex flex-col gap-2">
                <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-md border border-border px-2.5 py-2 text-sm">
                  {MANUAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת" className="rounded-md border border-border px-2.5 py-2 text-sm" />
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="תוכן ההודעה" rows={2} className="resize-y rounded-md border border-border px-2.5 py-2 text-sm" />
                <select value={severity} onChange={e => setSeverity(e.target.value)} className="rounded-md border border-border px-2.5 py-2 text-sm">
                  <option value="CRITICAL">CRITICAL</option><option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option><option value="LOW">LOW</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={submit} disabled={saving || !title.trim() || !message.trim()} className="rounded-md border-none bg-primary px-4 py-[7px] text-sm font-semibold text-white cursor-pointer">{saving ? 'שומר...' : 'שמור'}</button>
                  <button onClick={() => setAdding(false)} className="cursor-pointer rounded-md border border-border bg-muted px-4 py-[7px] text-sm text-muted-foreground">ביטול</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="mt-3 w-full cursor-pointer rounded-md border border-dashed border-border bg-transparent px-3.5 py-[7px] text-sm text-subtle-foreground">+ הוסף הודעה</button>
            )
          )}
        </div>

        <div className="min-w-[320px] flex-1 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 text-sm font-bold text-foreground">🤖 תובנות אוטומטיות</div>
          {data.auto.length === 0
            ? <div className="text-sm text-subtle-foreground">אין תובנות פעילות כרגע.</div>
            : data.auto.map(a => (
              <div key={a.id} className="flex items-start gap-2 border-b border-border py-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[a.severity] ?? C.textMuted }} />
                <div className="flex-1">
                  <div className="text-sm text-foreground">{a.message}</div>
                  <div className="mt-0.5 text-xs text-subtle-foreground">{a.category}</div>
                </div>
              </div>
            ))}
        </div>

        <div className="min-w-[260px] flex-1 rounded-lg border border-border bg-card p-4">
          <div className="mb-3 text-sm font-bold text-foreground">💡 פעולות מומלצות</div>
          <div className="flex flex-col gap-2">
            <div className="text-sm text-subtle-foreground">ליצירת סיכון חדש — עבור למסך "סקירה כללית" ולחץ "+ הוסף סיכון".</div>
            <div className="text-sm text-subtle-foreground">לבדיקת מצב ה-CR-ים — עבור למסך "בריאות CR".</div>
          </div>
        </div>
      </div>
    </div>
  );
};
