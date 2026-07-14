import React, { useState } from 'react';
import { C, TEXT, WEIGHT, SP, RADIUS, SHADOW, FONT } from '../../theme';

export type InviteTeamMember = { id: string; fullName: string; email: string };
export type InviteTeamOption = { id: string; name: string; members: InviteTeamMember[] };

interface InviteDialogProps {
  title:              string;
  subtitle?:          string;
  startISO:           string | null;
  endISO:             string | null;
  teams:              InviteTeamOption[];
  preSelectedEmails?: string[];
  onSend:             (attendees: string[]) => Promise<void>;
  onClose:            () => void;
}

// Recipient picker + real ICS calendar-invite sender — shared by any screen that
// has its own event with a start/end time (activities board, runbook steps, etc).
export function InviteDialog({ title, subtitle, startISO, endISO, teams, preSelectedEmails, onSend, onClose }: InviteDialogProps) {
  const allMembers = React.useMemo(() => {
    const seen = new Set<string>();
    const list: (InviteTeamMember & { teamNames: string[] })[] = [];
    const byEmail = new Map<string, InviteTeamMember & { teamNames: string[] }>();
    for (const t of teams) for (const m of t.members) {
      if (!m.email) continue;
      if (!seen.has(m.email)) {
        seen.add(m.email);
        const entry = { ...m, teamNames: [t.name] };
        byEmail.set(m.email, entry);
        list.push(entry);
      } else {
        byEmail.get(m.email)!.teamNames.push(t.name);
      }
    }
    return list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'));
  }, [teams]);

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const filteredMembers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allMembers.filter(m => {
      if (teamFilter && !m.teamNames.includes(teamFilter)) return false;
      if (q && !m.fullName.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allMembers, search, teamFilter]);

  const [selected, setSelected] = useState<Set<string>>(new Set(preSelectedEmails ?? []));
  const [extraEmail, setExtraEmail] = useState('');
  const [extraEmails, setExtraEmails] = useState<string[]>(
    (preSelectedEmails ?? []).filter(e => !allMembers.some(m => m.email === e)),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const toggle = (email: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(email)) next.delete(email); else next.add(email);
    return next;
  });

  const addExtraEmail = () => {
    const v = extraEmail.trim();
    if (v && /\S+@\S+\.\S+/.test(v) && !extraEmails.includes(v)) {
      setExtraEmails(prev => [...prev, v]);
      setExtraEmail('');
    }
  };

  const handleSend = async () => {
    const attendees = [...Array.from(selected), ...extraEmails];
    if (!attendees.length) { setError('בחר לפחות משתתף אחד'); return; }
    if (!startISO || !endISO) { setError('אין תאריך/שעה תקינים לפעילות זו'); return; }
    setSending(true); setError(null);
    try {
      await onSend(attendees);
      setSent(true);
      setTimeout(onClose, 1200);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בשליחת הזימון');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
    >
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, width: '92vw', maxWidth: 480, boxShadow: SHADOW.xl, overflow: 'hidden' }}>
        <div style={{ padding: `${SP[4]} ${SP[5]}`, background: C.brand, color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
            <span style={{ fontSize: 22 }}>📅</span>
            <div style={{ ...TEXT.base, fontWeight: WEIGHT.bold }}>קביעת פגישה ביומן</div>
          </div>
          <div style={{ ...TEXT.xs, marginTop: 4, opacity: 0.9 }}>
            {title}{subtitle ? ` · ${subtitle}` : ''}
          </div>
          {startISO && endISO && (
            <div style={{ ...TEXT.xs, marginTop: 2, opacity: 0.85 }}>
              {new Date(startISO).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {' – '}
              {new Date(endISO).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        <div style={{ padding: SP[5], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>בחר משתתפים לזימון:</div>

          <div style={{ display: 'flex', gap: SP[2] }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם..."
              style={{ flex: 1, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT }}
            />
            <select
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, background: C.bgCard, color: C.textPrimary }}
            >
              <option value="">כל הקבוצות</option>
              {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>

          {filteredMembers.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: SP[2], cursor: 'pointer', ...TEXT.xs, color: C.textMuted }}>
              <input
                type="checkbox"
                checked={filteredMembers.every(m => selected.has(m.email))}
                onChange={e => {
                  const emails = filteredMembers.map(m => m.email);
                  setSelected(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) emails.forEach(email => next.add(email));
                    else emails.forEach(email => next.delete(email));
                    return next;
                  });
                }}
              />
              בחר הכל {teamFilter || search ? '(מהתוצאות המסוננות)' : ''}
            </label>
          )}

          <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SP[2] }}>
            {filteredMembers.map(m => (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: '5px 4px', cursor: 'pointer', ...TEXT.sm, color: C.textPrimary }}>
                <input type="checkbox" checked={selected.has(m.email)} onChange={() => toggle(m.email)} />
                {m.fullName} <span style={{ color: C.textMuted, ...TEXT.xs }}>({m.email})</span>
              </label>
            ))}
            {allMembers.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[2] }}>אין משתמשים עם כתובת מייל</div>}
            {allMembers.length > 0 && filteredMembers.length === 0 && <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[2] }}>לא נמצאו משתתפים תואמים</div>}
          </div>

          <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
            {extraEmails.map(email => (
              <span key={email} style={{ ...TEXT.xs, background: C.bgNested, borderRadius: RADIUS.full, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                {email}
                <span onClick={() => setExtraEmails(prev => prev.filter(e => e !== email))} style={{ cursor: 'pointer', color: C.textMuted }}>✕</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: SP[2] }}>
            <input
              value={extraEmail}
              onChange={e => setExtraEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraEmail(); } }}
              placeholder="הוסף כתובת מייל נוספת"
              style={{ flex: 1, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, direction: 'ltr' }}
            />
            <button onClick={addExtraEmail} style={{ padding: '6px 14px', borderRadius: RADIUS.sm, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, ...TEXT.sm, cursor: 'pointer' }}>
              הוסף
            </button>
          </div>

          {error && <div style={{ ...TEXT.xs, color: C.danger }}>{error}</div>}

          <div style={{ display: 'flex', gap: SP[2], marginTop: SP[2] }}>
            <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: RADIUS.md, border: `1px solid ${C.border}`, background: C.bgNested, color: C.textSecondary, ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer' }}>
              ביטול
            </button>
            <button onClick={handleSend} disabled={sending || sent} style={{
              flex: 2, padding: '9px', borderRadius: RADIUS.md, border: 'none',
              background: sent ? C.success : C.brand, color: 'white',
              ...TEXT.sm, fontWeight: WEIGHT.bold, cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1,
            }}>
              {sent ? '✓ נשלח' : sending ? 'שולח…' : '📅 שלח זימון'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
