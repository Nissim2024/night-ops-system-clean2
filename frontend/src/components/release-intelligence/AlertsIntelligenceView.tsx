import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';

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
    return <div style={{ fontFamily: FONT, direction: 'rtl', textAlign: 'center', padding: SP[8], color: C.textMuted }}>בחר גרסה מתפריט הצד.</div>;
  }
  if (loading && !data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>טוען...</div>;
  if (!data) return <div style={{ fontFamily: FONT, direction: 'rtl', padding: SP[6], color: C.textMuted }}>לא ניתן לטעון נתונים עבור גרסה זו.</div>;

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔔 התראות ותובנות</div>

      <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '320px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3] }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📢 הודעות ידניות</div>
          </div>
          {data.manual.length === 0 && !adding && <div style={{ ...TEXT.sm, color: C.textMuted }}>אין הודעות.</div>}
          {data.manual.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: SP[2], padding: `${SP[2]} 0`, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[m.severity] ?? C.textMuted, marginTop: '6px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{m.title}</div>
                <div style={{ ...TEXT.xs, color: C.textMuted }}>{m.message}</div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>{m.category}</div>
              </div>
              {canWrite && (
                <button onClick={() => remove(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 14 }}>✕</button>
              )}
            </div>
          ))}
          {canWrite && (
            adding ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2], marginTop: SP[3] }}>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm }}>
                  {MANUAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת" style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm }} />
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="תוכן ההודעה" rows={2} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm, resize: 'vertical' }} />
                <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, fontFamily: FONT, ...TEXT.sm }}>
                  <option value="CRITICAL">CRITICAL</option><option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option><option value="LOW">LOW</option>
                </select>
                <div style={{ display: 'flex', gap: SP[2] }}>
                  <button onClick={submit} disabled={saving || !title.trim() || !message.trim()} style={{ padding: '7px 16px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.sm, fontWeight: WEIGHT.semibold }}>{saving ? 'שומר...' : 'שמור'}</button>
                  <button onClick={() => setAdding(false)} style={{ padding: '7px 16px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.sm }}>ביטול</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} style={{ marginTop: SP[3], padding: '7px 14px', background: 'none', border: `1px dashed ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textMuted, ...TEXT.sm, width: '100%' }}>+ הוסף הודעה</button>
            )
          )}
        </div>

        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '320px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>🤖 תובנות אוטומטיות</div>
          {data.auto.length === 0
            ? <div style={{ ...TEXT.sm, color: C.textMuted }}>אין תובנות פעילות כרגע.</div>
            : data.auto.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: SP[2], padding: `${SP[2]} 0`, borderBottom: `1px solid ${C.border}` }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[a.severity] ?? C.textMuted, marginTop: '6px', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ ...TEXT.sm, color: C.textPrimary }}>{a.message}</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>{a.category}</div>
                </div>
              </div>
            ))}
        </div>

        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], flex: 1, minWidth: '260px' }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>💡 פעולות מומלצות</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            <div style={{ ...TEXT.sm, color: C.textMuted }}>ליצירת סיכון חדש — עבור למסך "סקירה כללית" ולחץ "+ הוסף סיכון".</div>
            <div style={{ ...TEXT.sm, color: C.textMuted }}>לבדיקת מצב ה-CR-ים — עבור למסך "בריאות CR".</div>
          </div>
        </div>
      </div>
    </div>
  );
};
