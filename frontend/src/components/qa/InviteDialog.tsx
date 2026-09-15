import React, { useState } from 'react';
import { Button } from '../ui';
import { formatDateTime, formatTime } from '../../utils/dateFormat';

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
//
// The outer overlay is kept as a hand-rolled backdrop (not the shared Modal from
// '../ui') rather than swapped to it: this dialog has a custom brand-colored
// banner header (icon + title + date range on a solid background) that Modal's
// generic string title/subtitle can't reproduce, and it intentionally only
// closes via backdrop-click or the Cancel/Send buttons — Modal's Radix-based
// dialog would add Escape-to-close/focus-trap semantics that aren't here today.
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
      dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55"
    >
      <div className="w-[92vw] max-w-[480px] overflow-hidden rounded-xl bg-card shadow-xl">
        <div className="bg-primary px-5 py-4 text-white">
          <div className="flex items-center gap-2">
            <span className="text-[22px]">📅</span>
            <div className="text-base font-bold">קביעת פגישה ביומן</div>
          </div>
          <div className="mt-1 text-xs opacity-90">
            {title}{subtitle ? ` · ${subtitle}` : ''}
          </div>
          {startISO && endISO && (
            <div className="mt-0.5 text-xs opacity-85">
              {formatDateTime(startISO)}
              {' – '}
              {formatTime(endISO)}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-foreground">בחר משתתפים לזימון:</div>

          <div className="flex gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם..."
              className="flex-1 rounded-sm border border-border px-2.5 py-1.5 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus:border-primary"
            />
            <select
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              className="cursor-pointer rounded-sm border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">כל הקבוצות</option>
              {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>

          {filteredMembers.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-subtle-foreground">
              <input
                type="checkbox"
                className="accent-primary"
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

          <div className="max-h-[220px] overflow-y-auto rounded-md border border-border p-2">
            {filteredMembers.map(m => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm text-foreground">
                <input type="checkbox" className="accent-primary" checked={selected.has(m.email)} onChange={() => toggle(m.email)} />
                {m.fullName} <span className="text-xs text-subtle-foreground">({m.email})</span>
              </label>
            ))}
            {allMembers.length === 0 && <div className="p-2 text-xs text-subtle-foreground">אין משתמשים עם כתובת מייל</div>}
            {allMembers.length > 0 && filteredMembers.length === 0 && <div className="p-2 text-xs text-subtle-foreground">לא נמצאו משתתפים תואמים</div>}
          </div>

          <div className="flex flex-wrap gap-2">
            {extraEmails.map(email => (
              <span key={email} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-[3px] text-xs text-foreground">
                {email}
                <span onClick={() => setExtraEmails(prev => prev.filter(e => e !== email))} className="cursor-pointer text-subtle-foreground">✕</span>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={extraEmail}
              onChange={e => setExtraEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraEmail(); } }}
              placeholder="הוסף כתובת מייל נוספת"
              dir="ltr"
              className="flex-1 rounded-sm border border-border px-2.5 py-1.5 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus:border-primary"
            />
            <Button onClick={addExtraEmail} variant="secondary" size="sm">
              הוסף
            </Button>
          </div>

          {error && <div className="text-xs text-danger">{error}</div>}

          <div className="mt-2 flex gap-2">
            <Button onClick={onClose} variant="secondary" size="md" className="flex-1">
              ביטול
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || sent}
              variant={sent ? 'success' : 'primary'}
              size="md"
              className={`flex-[2] ${sending ? 'cursor-wait opacity-70' : ''}`}
            >
              {sent ? '✓ נשלח' : sending ? 'שולח…' : '📅 שלח זימון'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
