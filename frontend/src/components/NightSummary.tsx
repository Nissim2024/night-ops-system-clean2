import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  isRehearsal?: boolean;
  onApproved?: () => void;
}

interface Defect {
  id: string;
  system: string;
  title: string;
  description: string;
  severity: string;
  priority: string;
  reporter: string;
  discoveryDate: string;
  environment: string;
  status: string;
  testPhase: string;
  defectType: string;
  notes: string;
}

interface TestCoverage {
  total: number;
  responsible: string;
  planned: number;
  passed: number;
  failed: number;
  notCompleted: number;
  blocked: number;
  notRun: number;
  subject: string;
  title: string;
  release: string;
  cycle: string;
  planId: string;
  labId: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  'Show Stopper': '#6c0000', Severe: '#c0392b', High: '#e67e22', Medium: '#f39c12', Low: '#3498db',
};

const fmtTime     = (iso: string) => iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDateTime = (iso: string) => iso ? new Date(iso).toLocaleString('he-IL',     { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const fmtMins     = (m: number)   => m >= 60 ? `${Math.floor(m / 60)}ש' ${m % 60}דק'` : `${m}דק'`;

const SIGNIFICANT_MINS = 15;

// ── Simple CSS bar chart ──
const BarChart: React.FC<{ title: string; data: { label: string; count: number; color: string }[] }> = ({ title, data }) => {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '12px 16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#555', marginBottom: '10px' }}>{title}</div>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '72px', fontSize: '11px', color: '#555', textAlign: 'right', flexShrink: 0 }}>{d.label}</div>
          <div style={{ flex: 1, background: '#e0e0e0', borderRadius: '4px', height: '20px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 0)}%`,
              background: d.color, height: '100%', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingLeft: '6px',
              transition: 'width 0.4s',
            }}>
              {d.count > 0 && <span style={{ fontSize: '11px', color: 'white', fontWeight: 'bold', paddingLeft: '4px' }}>{d.count}</span>}
            </div>
          </div>
          {d.count === 0 && <span style={{ fontSize: '11px', color: '#bbb' }}>0</span>}
        </div>
      ))}
    </div>
  );
};

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: '4px 14px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' };
}

export const NightSummary: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, onApproved }) => {
  const [tasks,               setTasks]               = useState<any[]>([]);
  const [version,             setVersion]             = useState<any>(null);
  const [loading,             setLoading]             = useState(true);
  const [headline,            setHeadline]            = useState('');
  const [morningNotes,        setMorningNotes]        = useState('');
  const [summaryRecord,       setSummaryRecord]       = useState<any>(null);
  const [readConfirmed,       setReadConfirmed]       = useState(false);
  const [approveLoading,      setApproveLoading]      = useState(false);
  const [approveError,        setApproveError]        = useState<string | null>(null);
  const [defects,             setDefects]             = useState<Defect[]>([]);
  const [coverage,            setCoverage]            = useState<TestCoverage[]>([]);
  const [qcLoading,           setQcLoading]           = useState(false);
  const [phaseDelayReasons,   setPhaseDelayReasons]   = useState<Record<number, string>>({});
  const [coverageRemarks,     setCoverageRemarks]     = useState<Record<number, string>>({});
  const [defectRemarks,       setDefectRemarks]       = useState<Record<string, string>>({});
  const [copied,              setCopied]              = useState(false);
  const [emailSending,        setEmailSending]        = useState(false);
  const [emailStatus,         setEmailStatus]         = useState<'idle' | 'ok' | 'err'>('idle');
  const [emailError,          setEmailError]          = useState('');
  const [emailEnabled,        setEmailEnabled]        = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  // Roles that may override the go-nogo check and force-approve the summary
  const userRole = (() => { try { return JSON.parse(atob(token.split('.')[1])).role; } catch { return ''; } })();
  const canForceApprove = ['ADMIN', 'RELEASE_MANAGER'].includes(userRole);

  const fetchSummaryRecord = async () => {
    try {
      const endpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal` : `${API}/summary/${versionId}`;
      const res = await axios.get(endpoint, { headers });
      setSummaryRecord(res.data);
    } catch { /* not yet created */ }
  };

  const fetchQcData = useCallback(async () => {
    setQcLoading(true);
    try {
      const [defectsRes, coverageRes] = await Promise.all([
        axios.get(`${API}/qc/defects?versionId=${versionId}`, { headers }),
        axios.get(`${API}/qc/test-coverage?versionId=${versionId}`, { headers }),
      ]);
      setDefects(defectsRes.data);
      setCoverage(coverageRes.data);
    } catch (err) { console.error('QC fetch failed', err); }
    finally { setQcLoading(false); }
  }, [versionId, isRehearsal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    axios.get(`${API}/summary/email/config`, { headers })
      .then(r => setEmailEnabled(!!r.data.enabled))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendEmail = async () => {
    setEmailSending(true);
    setEmailStatus('idle');
    setEmailError('');
    try {
      const subject = isRehearsal
        ? `סיכום חזרה גנרלית — גרסת ${versionName}`
        : `סיכום ליל ההטמעה — גרסת ${versionName}`;
      await axios.post(`${API}/summary/${versionId}/send-email`, {
        subject,
        text: buildEmailText(),
      }, { headers });
      setEmailStatus('ok');
      setTimeout(() => setEmailStatus('idle'), 4000);
    } catch (err: any) {
      setEmailError(err?.response?.data?.message || 'שגיאה בשליחת המייל');
      setEmailStatus('err');
    } finally {
      setEmailSending(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const versionRes = await axios.get(`${API}/versions/${versionId}`, { headers });
        setVersion(versionRes.data);
        let loadedTasks: any[] = [];
        if (isRehearsal) {
          if (versionRes.data.status === 'REHEARSAL') {
            const tasksRes = await axios.get(`${API}/tasks?versionId=${versionId}`, { headers });
            loadedTasks = tasksRes.data;
          } else {
            loadedTasks = versionRes.data.lastRehearsalSnapshot ?? [];
          }
        } else {
          const tasksRes = await axios.get(`${API}/tasks?versionId=${versionId}`, { headers });
          loadedTasks = tasksRes.data;
        }
        setTasks(loadedTasks);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchData();
    fetchSummaryRecord();
    fetchQcData();
  }, [versionId, isRehearsal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed stats ──
  const doneTasks       = tasks.filter(t => t.status === 'DONE');
  const blockedTasks    = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED');
  const inProgressTasks = tasks.filter(t => t.status === 'IN_PROGRESS');
  const openTasks       = tasks.filter(t => t.status === 'OPEN');
  const waitingTasks    = tasks.filter(t => t.status === 'WAITING');
  const progressPercent = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
  const nonWaitingTasks = tasks.filter(t => t.status !== 'WAITING');
  const incompleteCount = nonWaitingTasks.filter(t => t.status !== 'DONE').length;

  // Tasks in phases AFTER the isGoNoGo phase (morning-after phases) must never block approval.
  // The isGoNoGo phase is configurable; fall back to treating the last phase as morning-after.
  const isActiveRun = version?.status === 'ACTIVE' && !isRehearsal;
  const morningSubPhaseIds = React.useMemo<Set<string>>(() => {
    if (!version?.phases?.length) return new Set();
    const ids = new Set<string>();
    const goNogoPhase = version.phases.find((p: any) => p.isGoNoGo);
    if (goNogoPhase) {
      version.phases
        .filter((p: any) => p.orderIndex > goNogoPhase.orderIndex)
        .forEach((ph: any) => (ph.subPhases ?? []).forEach((sp: any) => ids.add(sp.id)));
    } else {
      // Fallback: treat last phase as morning-after
      const sorted = [...version.phases].sort((a: any, b: any) => b.orderIndex - a.orderIndex);
      (sorted[0].subPhases ?? []).forEach((sp: any) => ids.add(sp.id));
    }
    return ids;
  }, [version]);

  const isMorningTask = (t: any) => morningSubPhaseIds.has(t.subPhaseId);

  // For active runs and rehearsals, WAITING tasks = morning-after tasks that weren't executed yet.
  // They must not block summary approval — the summary is about the night activity only.
  // For active runs, WAITING tasks are morning-after tasks and don't block GO.
  // For rehearsal or other states, only morning-phase tasks (after isGoNoGo) are excluded.
  const goNogoWaiting = isActiveRun ? 0 : waitingTasks.filter(t => !isMorningTask(t)).length;
  const goNogoBlocked = blockedTasks.filter(t => !isMorningTask(t) && !t.goNoGoWaived).length;
  const goNogoInc     = nonWaitingTasks.filter(t => t.status !== 'DONE' && !isMorningTask(t) && !t.goNoGoWaived).length;
  const isGoNogo      = tasks.length > 0 && goNogoWaiting === 0 && goNogoBlocked === 0 && goNogoInc === 0;

  const failedNightTasks = tasks.filter(t => t.status === 'FAILED' && !isMorningTask(t));

  const canDownload = isGoNogo || canForceApprove;

  // ── Phase timeline (phases 2 & 3 by orderIndex, using nested tasks from version) ──
  const phaseTimelines = React.useMemo(() => {
    if (!version?.phases) return [];
    const sorted = [...version.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    return sorted.slice(1, 3).map((phase: any) => {
      const phTasks: any[] = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
      const ps  = phTasks.filter(t => t.plannedStart).map(t => new Date(t.plannedStart).getTime());
      const pe  = phTasks.filter(t => t.plannedEnd).map(t => new Date(t.plannedEnd).getTime());
      const as_ = phTasks.filter(t => t.actualStart || t.startedAt).map(t => new Date(t.actualStart || t.startedAt).getTime());
      const af  = phTasks.filter(t => t.actualFinish).map(t => new Date(t.actualFinish).getTime());
      const plannedEndMs = pe.length ? Math.max(...pe) : null;
      const actualEndMs  = af.length ? Math.max(...af) : null;
      const delayMins    = plannedEndMs && actualEndMs ? Math.round((actualEndMs - plannedEndMs) / 60000) : null;
      return {
        name:         phase.name,
        environment:  phase.environment,
        plannedStart: ps.length    ? new Date(Math.min(...ps))  : null,
        plannedEnd:   plannedEndMs ? new Date(plannedEndMs)     : null,
        actualStart:  as_.length   ? new Date(Math.min(...as_)) : null,
        actualEnd:    actualEndMs  ? new Date(actualEndMs)      : null,
        delayMins,
        doneTasks:  phTasks.filter(t => t.status === 'DONE').length,
        totalTasks: phTasks.length,
      };
    });
  }, [version]);

  // ── Defect chart data ──
  const severityData = ['Show Stopper', 'Severe', 'High', 'Medium', 'Low'].map(s => ({
    label: s, count: defects.filter(d => d.severity === s).length, color: SEVERITY_COLORS[s] || '#95a5a6',
  }));
  const statusData = [
    { label: 'Open',     count: defects.filter(d => d.status === 'Open').length,     color: '#e74c3c' },
    { label: 'Closed',   count: defects.filter(d => d.status === 'Closed').length,   color: '#27ae60' },
    { label: 'Canceled', count: defects.filter(d => d.status === 'Canceled').length, color: '#95a5a6' },
  ];
  const systemCounts = defects.reduce((acc: Record<string, number>, d) => { acc[d.system] = (acc[d.system] || 0) + 1; return acc; }, {});
  const systemData   = Object.entries(systemCounts).map(([label, count]) => ({ label, count, color: '#3498db' }));

  const approveSummary = async () => {
    setApproveLoading(true); setApproveError(null);
    try {
      const endpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal/approve` : `${API}/summary/${versionId}/approve`;
      const force = canForceApprove && !isGoNogo;
      const res = await axios.post(endpoint, { headline, morningNotes, ...(force && { force: true }) }, { headers });
      setSummaryRecord(res.data);
      onApproved?.();
    } catch (err: any) {
      setApproveError(err?.response?.data?.message || 'שגיאה באישור הסיכום');
    } finally { setApproveLoading(false); }
  };

  const waiveTask = async (taskId: string) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}/waive-gonogo`, {}, { headers });
      const tasksRes = await axios.get(`${API}/tasks?versionId=${versionId}`, { headers });
      setTasks(tasksRes.data);
    } catch (err) { console.error(err); }
  };

  const buildEmailText = (): string => {
    const lines: string[] = [];
    const title = isRehearsal
      ? `סיכום חזרה גנרלית — גרסת ${versionName}`
      : `סיכום ליל ההטמעה — גרסת ${versionName}`;
    lines.push(title);
    lines.push('━'.repeat(40));
    lines.push('');
    if (summaryRecord?.sentAt) {
      lines.push(`תאריך: ${new Date(summaryRecord.sentAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    }
    lines.push(`סטטוס: ${effectiveGo ? '✅ GO' : '❌ NO GO'}`);
    lines.push(`התקדמות: ${doneTasks.length}/${tasks.length} משימות הושלמו (${progressPercent}%)`);
    lines.push('');

    const headlineText = summaryRecord?.headline || headline;
    if (autoHeadline || headlineText) {
      lines.push('עיקרי הדברים');
      lines.push('─'.repeat(30));
      if (autoHeadline) lines.push(autoHeadline);
      if (headlineText) lines.push(headlineText);
      lines.push('');
    }

    if (phaseTimelines.length > 0) {
      lines.push('לוחות זמנים');
      lines.push('─'.repeat(30));
      phaseTimelines.forEach((pt, i) => {
        const statusText = pt.delayMins === null ? '—'
          : pt.delayMins <= -SIGNIFICANT_MINS ? `לפני הזמן ${fmtMins(Math.abs(pt.delayMins))}`
          : pt.delayMins <= 0 ? 'כמתוכנן'
          : `חריגה +${fmtMins(pt.delayMins)}`;
        lines.push(`${pt.name} (${pt.environment}) — ${statusText}`);
        lines.push(`  מתוכנן: ${pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—'} — ${pt.plannedEnd ? fmtTime(pt.plannedEnd.toISOString()) : '—'}`);
        lines.push(`  בפועל:  ${pt.actualStart ? fmtTime(pt.actualStart.toISOString()) : '—'} — ${pt.actualEnd ? fmtTime(pt.actualEnd.toISOString()) : '—'}`);
        const phaseReason = phaseDelayReasons[i];
        if (phaseReason) lines.push(`  הערה: ${phaseReason}`);
      });
      lines.push('');
    }

    if (blockedTasks.length > 0) {
      lines.push(`תקלות (${blockedTasks.length})`);
      lines.push('─'.repeat(30));
      blockedTasks.forEach(t => {
        lines.push(`• ${t.title}`);
        if (t.assignedTeam?.name) lines.push(`  צוות: ${t.assignedTeam.name}`);
        if (t.blockedReason) lines.push(`  סיבה: ${t.blockedReason}`);
      });
      lines.push('');
    }

    if (defects.length > 0) {
      const openDefects = defects.filter(d => d.status === 'Open');
      lines.push(`תקלות QC — סה"כ ${defects.length} (פתוחות: ${openDefects.length})`);
      lines.push('─'.repeat(30));
      ['Show Stopper', 'Severe', 'High', 'Medium', 'Low'].forEach(sev => {
        const count = defects.filter(d => d.severity === sev).length;
        if (count > 0) lines.push(`  ${sev}: ${count}`);
      });
      lines.push('');
    }

    const notesText = summaryRecord?.morningNotes || morningNotes;
    if (notesText) {
      lines.push('לתשומת לב צוות הבוקר');
      lines.push('─'.repeat(30));
      lines.push(notesText);
      lines.push('');
    }

    lines.push('━'.repeat(40));
    lines.push('הופק אוטומטית ע"י NightOps Platform');
    return lines.join('\n');
  };

  const copyToEmail = () => {
    navigator.clipboard.writeText(buildEmailText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>טוען...</div>;

  // Effective GO: real GO or manager override — used for display/styling
  const effectiveGo = isGoNogo || canForceApprove;

  const autoHeadline = isGoNogo
    ? (isRehearsal ? 'החזרה הגנרלית הסתיימה בהצלחה — כל המשימות הושלמו' : 'הגרסה הוטמעה בהצלחה בסביבת הייצור גם ב-HOT וגם ב-HOTNET')
    : canForceApprove
      ? 'GO — הגרסה עברה בהצלחה, המשך בפעילויות הבוקר שלאחר הגרסה'
      : null;

  const tdBase: React.CSSProperties = { padding: '6px 8px', border: '1px solid #e0e0e0', fontSize: '12px', verticalAlign: 'top' };

  const timelineDelayBadge = (delayMins: number | null) => {
    if (delayMins === null) return <span style={badgeStyle('#f0f0f0', '#666')}>— ממתין לנתונים</span>;
    if (delayMins <= -SIGNIFICANT_MINS) return <span style={badgeStyle('#e8f8f0', '#1e8449')}>⏩ לפני הזמן {fmtMins(Math.abs(delayMins))}</span>;
    if (delayMins <= 0)                 return <span style={badgeStyle('#d5f0dc', '#1a5c2a')}>✅ כמתוכנן</span>;
    if (delayMins < SIGNIFICANT_MINS)  return <span style={badgeStyle('#fff8f0', '#c0392b')}>⚠️ איחור קל {fmtMins(delayMins)}</span>;
    return <span style={badgeStyle('#fee', '#c0392b')}>🚨 חריגה בלוחות הזמנים +{fmtMins(delayMins)}</span>;
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>
      <h2 style={{ color: isRehearsal ? '#7d3c00' : '#1a2332', margin: '0 0 20px' }}>
        {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} — {versionName}
      </h2>

      {/* GO/NO GO Banner */}
      <div style={{ background: effectiveGo ? '#d5f0dc' : '#fee', border: `2px solid ${effectiveGo ? '#27ae60' : '#e74c3c'}`, borderRadius: '12px', padding: '16px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '22px', fontWeight: 'bold', color: effectiveGo ? '#27ae60' : '#e74c3c' }}>
            {effectiveGo
              ? (isGoNogo
                  ? '✅ GO — ניתן להוציא סיכום'
                  : '✅ GO — הגרסה עברה בהצלחה, המשך בפעילויות הבוקר שלאחר הגרסה')
              : '🛑 NO GO — לא ניתן להוציא סיכום'}
          </span>
          {!isGoNogo && !canForceApprove && (
            <div style={{ fontSize: '13px', color: '#e74c3c', marginTop: '4px' }}>
              {waitingTasks.length > 0 && <span>⏳ {waitingTasks.length} משימות ממתינות (טרם הופעלו) | </span>}
              {incompleteCount > 0 && <span>{incompleteCount} משימות לא הושלמו | </span>}
              {blockedTasks.length > 0 && <span>{blockedTasks.length} משימות חסומות</span>}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: effectiveGo ? '#27ae60' : '#e74c3c' }}>{progressPercent}%</div>
          <div style={{ fontSize: '12px', color: '#666' }}>הושלם</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#666' }}>
          <span>התקדמות כללית</span>
          <span>{doneTasks.length}/{tasks.length} משימות</span>
        </div>
        <div style={{ background: '#f0f0f0', borderRadius: '8px', height: '14px', overflow: 'hidden', marginBottom: '16px' }}>
          <div style={{ background: effectiveGo ? '#27ae60' : '#3498db', width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s' }} />
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {[
            { label: 'הושלמו',  value: doneTasks.length,       color: '#27ae60' },
            { label: 'בביצוע',  value: inProgressTasks.length, color: '#f39c12' },
            { label: 'פתוחות',  value: openTasks.length,       color: '#3498db' },
            { label: 'ממתינות', value: waitingTasks.length,    color: '#9b59b6' },
            { label: 'חסומות',  value: blockedTasks.length,    color: '#e74c3c' },
          ].map(s => (
            <div key={s.label} style={{ background: s.color + '22', color: s.color, padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>
              {s.value} {s.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* ── עיקרי הדברים ── */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 12px', color: '#1a2332', fontSize: '15px' }}>עיקרי הדברים</h3>
          {autoHeadline && (
            <div style={{ background: '#d5f0dc', border: '1px solid #a9dfbf', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '14px', color: '#1e8449', fontWeight: 'bold' }}>
              ✅ {autoHeadline}
            </div>
          )}
          <textarea value={headline} onChange={e => setHeadline(e.target.value)}
            placeholder={autoHeadline ? 'הוסף הערות נוספות אם נדרש...' : 'לדוגמה: העלאת הגרסה הסתיימה בהצלחה בהוט ובהוטנט'}
            rows={3} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl' }} />
        </div>

        {/* ── Timeline ── */}
        {phaseTimelines.length > 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <h3 style={{ margin: '0 0 16px', color: '#1a2332', fontSize: '15px' }}>⏱ לוחות זמנים</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {phaseTimelines.map((pt, idx) => {
                const isLate  = pt.delayMins !== null && pt.delayMins >= SIGNIFICANT_MINS;
                const isEarly = pt.delayMins !== null && pt.delayMins <= -SIGNIFICANT_MINS;
                const isOk    = pt.delayMins !== null && pt.delayMins <= 0;
                const borderColor = isLate ? '#c0392b' : isEarly || isOk ? '#27ae60' : '#e0e0e0';
                const bgColor     = isLate ? '#fff5f5' : isEarly || isOk ? '#f0fff4' : '#fafafa';
                const envColor    = pt.environment === 'HOT' ? '#e74c3c' : '#2980b9';
                return (
                  <div key={idx} style={{ border: `2px solid ${borderColor}`, borderRadius: '10px', padding: '14px 18px', background: bgColor }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ background: envColor, color: 'white', padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>{pt.environment}</span>
                        <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '14px' }}>{pt.name}</span>
                        <span style={{ fontSize: '12px', color: '#888' }}>{pt.doneTasks}/{pt.totalTasks} משימות</span>
                      </div>
                      {timelineDelayBadge(pt.delayMins)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '12px', marginBottom: '10px' }}>
                      {[
                        { label: 'התחלה מתוכננת', value: pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—', color: '#666' },
                        { label: 'סיום מתוכנן',   value: pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—', color: '#e65100' },
                        { label: 'התחלה בפועל',   value: pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—', color: '#2980b9' },
                        { label: 'סיום בפועל',    value: pt.actualEnd    ? fmtTime(pt.actualEnd.toISOString())    : '—', color: isLate ? '#c0392b' : '#27ae60' },
                      ].map(f => (
                        <div key={f.label} style={{ background: '#f8f9fa', borderRadius: '6px', padding: '6px 10px' }}>
                          <div style={{ color: '#999', fontSize: '10px', marginBottom: '2px' }}>{f.label}</div>
                          <div style={{ fontWeight: 'bold', color: f.color, fontSize: '13px' }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Always-visible reason field */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <label style={{ fontSize: '11px', color: '#888', paddingTop: '8px', flexShrink: 0 }}>
                        {isLate ? '⚠️ סיבת חריגה *' : 'סיבת חריגה / הערה'}
                      </label>
                      <textarea
                        value={phaseDelayReasons[idx] || ''}
                        onChange={e => setPhaseDelayReasons(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder={isLate ? 'חובה — הסבר מדוע חרגו מלוחות הזמנים' : 'אופציונלי'}
                        rows={2}
                        style={{
                          flex: 1, padding: '6px 10px',
                          border: `1px solid ${isLate && !(phaseDelayReasons[idx] || '').trim() ? '#e74c3c' : '#ddd'}`,
                          borderRadius: '6px', fontSize: '12px', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── תקלות מהמערכת ── */}
        {blockedTasks.length > 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #e74c3c' }}>
            <h3 style={{ margin: '0 0 12px', color: '#e74c3c', fontSize: '15px' }}>תקלות ({blockedTasks.length})</h3>
            {blockedTasks.map(task => (
              <div key={task.id} style={{ background: '#fee', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', color: '#c0392b', fontSize: '14px' }}>{task.title}</div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Test Coverage (QC) ── */}
        {(
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#1a2332', fontSize: '15px' }}>🧪 תכולת בדיקות (QC Test Coverage)</h3>
              <span style={{ fontSize: '11px', background: '#fff3e0', color: '#e67e22', padding: '3px 10px', borderRadius: '10px', border: '1px solid #f0c040' }}>Mock — ממתין לחיבור QC</span>
            </div>
            {qcLoading ? (
              <div style={{ textAlign: 'center', padding: '16px', color: '#888' }}>טוען נתוני QC...</div>
            ) : coverage.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px', color: '#aaa', background: '#f8f9fa', borderRadius: '8px' }}>אין נתוני בדיקות</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f0f7ff' }}>
                      {['#', 'פרויקט/רגרסיה/באג', 'כותרת / CR', 'אחראי', 'Passed', 'Failed', 'Not Completed', 'Blocked', 'Not Run', 'הערות'].map(h => (
                        <th key={h} style={{ padding: '7px 8px', textAlign: 'right', color: '#2d4a7a', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid #c8d8f0', fontSize: '11px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fbff' }}>
                        <td style={{ ...tdBase, color: '#888', width: '28px', textAlign: 'center' }}>{i + 1}</td>
                        <td style={{ ...tdBase, fontWeight: r.subject ? 'bold' : 'normal', color: r.subject ? '#1a2332' : '#999', whiteSpace: 'nowrap' }}>{r.subject || '—'}</td>
                        <td style={{ ...tdBase, maxWidth: '240px' }}>{r.title}</td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{r.responsible}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: '#27ae60', fontWeight: r.passed > 0 ? 'bold' : 'normal' }}>{r.passed}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.failed > 0 ? '#e74c3c' : '#aaa', fontWeight: r.failed > 0 ? 'bold' : 'normal' }}>{r.failed}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.notCompleted > 0 ? '#e67e22' : '#aaa' }}>{r.notCompleted}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.blocked > 0 ? '#c0392b' : '#aaa' }}>{r.blocked}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: '#95a5a6' }}>{r.notRun}</td>
                        <td style={{ ...tdBase, minWidth: '120px' }}>
                          <textarea
                            value={coverageRemarks[i] || ''}
                            onChange={e => setCoverageRemarks(prev => ({ ...prev, [i]: e.target.value }))}
                            placeholder="הערות..."
                            rows={2}
                            style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl', boxSizing: 'border-box' }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Defects (QC) ── */}
        {(
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#1a2332', fontSize: '15px' }}>🐛 תקלות שדווחו (QC)</h3>
              <span style={{ fontSize: '11px', background: '#fff3e0', color: '#e67e22', padding: '3px 10px', borderRadius: '10px', border: '1px solid #f0c040' }}>Mock — ממתין לחיבור QC</span>
            </div>
            {qcLoading ? (
              <div style={{ textAlign: 'center', padding: '16px', color: '#888' }}>טוען נתוני QC...</div>
            ) : defects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#27ae60', background: '#f0fff4', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold' }}>
                ✅ לא דווחו תקלות במהלך הפעילות
              </div>
            ) : (
              <>
                {/* Charts */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                  <BarChart title="התפלגות לפי חומרה" data={severityData.filter(d => d.count > 0)} />
                  <BarChart title="סטטוס תקלות"       data={statusData.filter(d => d.count > 0)} />
                  <BarChart title="לפי מערכת"         data={systemData} />
                </div>
                {/* Defects table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f0f0f0' }}>
                        {['ID', 'כותרת התקלה', 'תיאור', 'חומרה', 'עדיפות', 'צוות אחראי', 'דווח ע"י', 'תאריך גילוי', 'סביבה', 'סטטוס', 'שלב בדיקה', 'סוג תקלה', 'הערות', 'מלל חופשי'].map(h => (
                          <th key={h} style={{ padding: '7px 8px', textAlign: 'right', color: '#333', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid #e0e0e0', fontSize: '11px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defects.map((d, i) => (
                        <tr key={d.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                          <td style={{ ...tdBase, color: '#2980b9', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.id}</td>
                          <td style={{ ...tdBase, maxWidth: '160px', fontWeight: 'bold' }}>{d.title}</td>
                          <td style={{ ...tdBase, maxWidth: '220px', color: '#555' }}>{d.description}</td>
                          <td style={{ ...tdBase }}>
                            <span style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6', padding: '1px 6px', borderRadius: '8px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap' }}>{d.severity}</span>
                          </td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.priority}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.system}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.reporter}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.discoveryDate}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.environment}</td>
                          <td style={{ ...tdBase }}>
                            <span style={{ background: d.status === 'Open' ? '#fee' : d.status === 'Closed' ? '#d5f0dc' : '#f5f5f5', color: d.status === 'Open' ? '#e74c3c' : d.status === 'Closed' ? '#27ae60' : '#888', padding: '1px 8px', borderRadius: '8px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap' }}>{d.status}</span>
                          </td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.testPhase}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.defectType}</td>
                          <td style={{ ...tdBase, maxWidth: '160px', color: '#555' }}>{d.notes}</td>
                          <td style={{ ...tdBase, minWidth: '120px' }}>
                            <textarea
                              value={defectRemarks[d.id] || ''}
                              onChange={e => setDefectRemarks(prev => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="מלל חופשי..."
                              rows={2}
                              style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl', boxSizing: 'border-box' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── הערות לצוות הבוקר ── */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 12px', color: '#1a2332', fontSize: '15px' }}>הערות לצוות הבוקר</h3>
          <textarea value={morningNotes} onChange={e => setMorningNotes(e.target.value)}
            placeholder="פריטים שדורשים מעקב בוקר..."
            rows={3} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl' }} />
        </div>

        {/* ── משימות נכשלות — אישור דילוג (מנהל בלבד) ── */}
        {canForceApprove && failedNightTasks.length > 0 && !summaryRecord?.sentAt && (
          <div style={{ background: 'white', border: '2px solid #e74c3c', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '0' }}>
            <h3 style={{ margin: '0 0 12px', color: '#c0392b', fontSize: '15px' }}>⚠️ משימות נכשלות ({failedNightTasks.length})</h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#666' }}>
              סמן משימות שנכשלו כ"מאושר לדילוג" כדי לאפשר הפקת סיכום מבלי לעקוף GO/NO GO.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {failedNightTasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: t.goNoGoWaived ? '#f0fff4' : '#fee', border: `1px solid ${t.goNoGoWaived ? '#27ae60' : '#f5b7b1'}` }}>
                  <span style={{ flex: 1, fontSize: '13px', color: t.goNoGoWaived ? '#1e8449' : '#c0392b', fontWeight: t.goNoGoWaived ? 'normal' : 'bold' }}>
                    {t.goNoGoWaived ? '✓ ' : '✗ '}{t.title}
                  </span>
                  {t.assignedTeam?.name && <span style={{ fontSize: '11px', color: '#888' }}>{t.assignedTeam.name}</span>}
                  <button
                    onClick={() => waiveTask(t.id)}
                    style={{ padding: '4px 12px', fontSize: '12px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap',
                      background: t.goNoGoWaived ? '#bdc3c7' : '#e67e22', color: 'white' }}>
                    {t.goNoGoWaived ? 'בטל אישור' : '✓ אשר דילוג'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── אישור סיכום ── */}
        <div style={{ background: summaryRecord?.sentAt ? '#f0fff4' : 'white', border: `2px solid ${summaryRecord?.sentAt ? '#27ae60' : '#e67e22'}`, borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          {summaryRecord?.sentAt ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>✅</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: '#1e8449', fontSize: '15px' }}>הסיכום אושר ונשמר במערכת</div>
                  <div style={{ fontSize: '13px', color: '#555', marginTop: '2px' }}>
                    {new Date(summaryRecord.sentAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button onClick={copyToEmail}
                  style={{ padding: '10px 24px', background: copied ? '#27ae60' : '#6c3483', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', transition: 'background 0.2s' }}>
                  {copied ? '✓ הועתק!' : '📋 העתק לאימייל'}
                </button>
                <button
                  onClick={emailEnabled ? sendEmail : () => alert('שירות המייל אינו מופעל — הגדר SMTP בפאנל הניהול')}
                  disabled={emailSending}
                  style={{
                    padding: '10px 24px',
                    background: emailSending ? '#95a5a6' : emailStatus === 'ok' ? '#27ae60' : emailStatus === 'err' ? '#e74c3c' : emailEnabled ? '#2980b9' : '#aaa',
                    color: 'white', border: 'none', borderRadius: '8px',
                    cursor: emailSending ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold', fontSize: '14px', transition: 'background 0.2s',
                  }}
                >
                  {emailSending ? '⏳ שולח...' : emailStatus === 'ok' ? '✓ נשלח!' : emailStatus === 'err' ? '✗ שגיאה' : '📧 שלח במייל לרשימת תפוצה'}
                </button>
                {emailStatus === 'err' && emailError && (
                  <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>{emailError}</div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h3 style={{ margin: '0 0 12px', color: '#c0392b', fontSize: '15px' }}>
                {isRehearsal ? '⚠️ אישור סיכום החזרה הגנרלית' : '⚠️ אישור סיכום — נדרש לסיום הלילה'}
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#666' }}>
                {isRehearsal ? 'אישור הסיכום ישמור אותו במערכת ויאפס את תוכנית העבודה לקראת ליל ההטמעה.' : 'לפני אישור הסיכום — קרא את הדוח בעיון ווודא שכל הנתונים מדויקים.'}
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: '#333', marginBottom: '14px', fontSize: '14px' }}>
                <input type="checkbox" checked={readConfirmed} onChange={e => setReadConfirmed(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                קראתי את הדוח ואישרתי שכל הנתונים נכונים
              </label>
              {approveError && (
                <div style={{ background: '#fee', border: '1px solid #e74c3c', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', color: '#c0392b', marginBottom: '10px' }}>{approveError}</div>
              )}
              {!isGoNogo && !canForceApprove && (
                <div style={{ background: '#fee', border: '1px solid #f99', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', color: '#c0392b', marginBottom: '10px', fontWeight: 'bold' }}>
                  🚫 לא ניתן לאשר סיכום — יש {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה שטרם הושלמו
                  {isActiveRun && morningSubPhaseIds.size > 0 && (
                    <div style={{ fontWeight: 'normal', fontSize: '12px', marginTop: '4px', color: '#a00' }}>משימות שלב הבוקר אינן נכללות בחישוב</div>
                  )}
                </div>
              )}
              {!isGoNogo && canForceApprove && (
                <div style={{ background: '#fff3cd', border: '1px solid #f0a500', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', color: '#7d5a00', marginBottom: '12px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ עקיפת בדיקת GO — {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה טרם הושלמו</div>
                  <div>בתור {userRole === 'ADMIN' ? 'מנהל מערכת' : 'מנהל לילה'} באפשרותך לאשר את הסיכום למרות זאת.</div>
                </div>
              )}
              <button onClick={approveSummary} disabled={!readConfirmed || approveLoading || !canDownload}
                style={{ padding: '10px 24px', background: (readConfirmed && canDownload) ? (!isGoNogo ? '#e67e22' : '#1e8449') : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: (readConfirmed && canDownload) ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '14px' }}>
                {approveLoading ? '...' : !isGoNogo && canForceApprove ? '⚠️ אשר סיכום בעקיפת GO' : '✅ אשר סיכום'}
              </button>
            </div>
          )}
        </div>

        {/* ── HTML Report (after approval) ── */}
        {summaryRecord?.sentAt && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: `3px solid ${isRehearsal ? '#f39c12' : '#1a2332'}` }}>
            <div style={{ textAlign: 'center', borderBottom: `2px solid ${isRehearsal ? '#f39c12' : '#1a2332'}`, paddingBottom: '16px', marginBottom: '24px' }}>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: isRehearsal ? '#7d3c00' : '#1a2332' }}>
                {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} — {versionName}
              </div>
              {isRehearsal && <div style={{ color: '#c0392b', fontSize: '13px', marginTop: '6px', fontWeight: 'bold' }}>⚠ מסמך זה הופק מחזרה גנרלית ואינו משקף לילה אמיתי</div>}
              <div style={{ color: '#888', fontSize: '13px', marginTop: '6px' }}>
                הופק: {new Date(summaryRecord.sentAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {/* GO/NO GO */}
            <div style={{ background: effectiveGo ? '#d5f0dc' : '#fee', border: `1px solid ${effectiveGo ? '#27ae60' : '#e74c3c'}`, borderRadius: '8px', padding: '12px 20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '18px', fontWeight: 'bold', color: effectiveGo ? '#27ae60' : '#e74c3c' }}>
                  {effectiveGo ? '✅ GO — הגרסה עברה בהצלחה' : '❌ NO GO'}
                </span>
                <span style={{ fontSize: '16px', color: '#333' }}>הושלמו <strong>{doneTasks.length}</strong> מתוך <strong>{tasks.length}</strong> משימות ({progressPercent}%)</span>
              </div>
              {effectiveGo && !isGoNogo && waitingTasks.length > 0 && (
                <div style={{ fontSize: '13px', color: '#1e8449', marginTop: '6px' }}>
                  המשך בפעילויות הבוקר שלאחר הגרסה — נותרו {waitingTasks.length} משימות לביצוע
                </div>
              )}
            </div>

            {/* Headline */}
            {(autoHeadline || summaryRecord.headline || headline) && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#1a2332', margin: '0 0 8px', fontSize: '16px', borderRight: '4px solid #1a2332', paddingRight: '10px' }}>עיקרי הדברים</h3>
                {autoHeadline && <div style={{ background: '#d5f0dc', border: '1px solid #a9dfbf', borderRadius: '6px', padding: '8px 12px', marginBottom: '8px', fontSize: '14px', color: '#1e8449', fontWeight: 'bold' }}>✅ {autoHeadline}</div>}
                {(summaryRecord.headline || headline) && <p style={{ margin: 0, color: '#333', lineHeight: 1.7, fontSize: '14px', whiteSpace: 'pre-wrap' }}>{summaryRecord.headline || headline}</p>}
              </div>
            )}

            {/* Timeline in report */}
            {phaseTimelines.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#1a2332', margin: '0 0 12px', fontSize: '16px', borderRight: '4px solid #2980b9', paddingRight: '10px' }}>⏱ לוחות זמנים</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#eaf0fb' }}>
                      {['שלב', 'סביבה', 'התחלה מתוכננת', 'סיום מתוכנן', 'התחלה בפועל', 'סיום בפועל', 'סטטוס', 'סיבת חריגה / הערה'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'right', color: '#2d4a7a', fontWeight: 'bold', border: '1px solid #c8d8f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {phaseTimelines.map((pt, i) => {
                      const isLate  = pt.delayMins !== null && pt.delayMins >= SIGNIFICANT_MINS;
                      const isEarly = pt.delayMins !== null && pt.delayMins <= -SIGNIFICANT_MINS;
                      const isOk    = pt.delayMins !== null && !isLate;
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8f9fa' }}>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', fontWeight: 'bold' }}>{pt.name}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>
                            <span style={{ background: pt.environment === 'HOT' ? '#fee' : '#e8f4fd', color: pt.environment === 'HOT' ? '#c0392b' : '#2980b9', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{pt.environment}</span>
                          </td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>{pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>{pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>{pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', color: isOk && !isLate ? '#27ae60' : isLate ? '#c0392b' : '#333', fontWeight: 'bold' }}>{pt.actualEnd ? fmtTime(pt.actualEnd.toISOString()) : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>
                            <span style={{ background: isEarly ? '#e8f8f0' : isOk ? '#d5f0dc' : isLate ? '#fde8d0' : '#f0f0f0', color: isEarly ? '#1e8449' : isOk ? '#1e8449' : isLate ? '#c0392b' : '#666', padding: '2px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              {pt.delayMins === null ? '—' : isEarly ? `⏩ לפני הזמן ${fmtMins(Math.abs(pt.delayMins))}` : !isLate ? '✅ כמתוכנן' : `🚨 חריגה +${fmtMins(pt.delayMins)}`}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', color: phaseDelayReasons[i] ? '#333' : '#bbb', fontSize: '12px', fontStyle: phaseDelayReasons[i] ? 'normal' : 'italic' }}>
                            {phaseDelayReasons[i] || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Blocked tasks */}
            {blockedTasks.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#e74c3c', margin: '0 0 10px', fontSize: '16px', borderRight: '4px solid #e74c3c', paddingRight: '10px' }}>תקלות ({blockedTasks.length})</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#fee' }}>
                      {['משימה', 'צוות', 'סיבה'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'right', color: '#c0392b', fontWeight: 'bold', border: '1px solid #f5b7b1' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {blockedTasks.map((t, i) => (
                      <tr key={t.id} style={{ background: i % 2 === 0 ? 'white' : '#fff9f9' }}>
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0' }}>{t.title}</td>
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0' }}>{t.assignedTeam?.name || '—'}</td>
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0' }}>{t.blockedReason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Test Coverage in report */}
            {coverage.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#1a2332', margin: '0 0 10px', fontSize: '16px', borderRight: '4px solid #2980b9', paddingRight: '10px' }}>
                  🧪 תכולת בדיקות (QC)
                  <span style={{ fontSize: '11px', color: '#e67e22', marginRight: '8px', fontWeight: 'normal' }}>נתוני Mock</span>
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ background: '#f0f7ff' }}>
                        {['#', 'פרויקט/רגרסיה/באג', 'כותרת / CR', 'אחראי', 'Passed', 'Failed', 'Not Completed', 'Blocked', 'Not Run', 'הערות'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'right', color: '#2d4a7a', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid #c8d8f0' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fbff' }}>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', color: '#888', textAlign: 'center' }}>{i + 1}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', fontWeight: r.subject ? 'bold' : 'normal' }}>{r.subject || '—'}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', maxWidth: '200px' }}>{r.title}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5' }}>{r.responsible}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', textAlign: 'center', color: '#27ae60', fontWeight: r.passed > 0 ? 'bold' : 'normal' }}>{r.passed}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', textAlign: 'center', color: r.failed > 0 ? '#e74c3c' : '#aaa' }}>{r.failed}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', textAlign: 'center', color: r.notCompleted > 0 ? '#e67e22' : '#aaa' }}>{r.notCompleted}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', textAlign: 'center', color: r.blocked > 0 ? '#c0392b' : '#aaa' }}>{r.blocked}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', textAlign: 'center', color: '#95a5a6' }}>{r.notRun}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', color: '#555' }}>{coverageRemarks[i] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Defects in report */}
            {(
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#1a2332', margin: '0 0 12px', fontSize: '16px', borderRight: '4px solid #9b59b6', paddingRight: '10px' }}>
                  🐛 תקלות שדווחו (QC)
                  <span style={{ fontSize: '11px', color: '#e67e22', marginRight: '8px', fontWeight: 'normal' }}>נתוני Mock</span>
                </h3>
                {defects.length === 0 ? (
                  <div style={{ background: '#f0fff4', borderRadius: '6px', padding: '12px', color: '#27ae60', fontWeight: 'bold' }}>✅ לא דווחו תקלות</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' }}>
                      <BarChart title="חומרה" data={severityData.filter(d => d.count > 0)} />
                      <BarChart title="סטטוס" data={statusData.filter(d => d.count > 0)} />
                      <BarChart title="מערכת" data={systemData} />
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f3e8ff' }}>
                            {['ID', 'כותרת התקלה', 'תיאור', 'חומרה', 'עדיפות', 'צוות אחראי', 'דווח ע"י', 'תאריך גילוי', 'סביבה', 'סטטוס', 'שלב בדיקה', 'סוג תקלה', 'הערות', 'מלל חופשי'].map(h => (
                              <th key={h} style={{ padding: '7px 8px', textAlign: 'right', color: '#6c3483', fontWeight: 'bold', border: '1px solid #d7bff5', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {defects.map((d, i) => (
                            <tr key={d.id} style={{ background: i % 2 === 0 ? 'white' : '#fdf5ff' }}>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', color: '#2980b9', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.id}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', fontWeight: 'bold', maxWidth: '140px' }}>{d.title}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', maxWidth: '200px', color: '#555' }}>{d.description}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5' }}>
                                <span style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6', padding: '1px 5px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.severity}</span>
                              </td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.priority}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.system}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.reporter}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.discoveryDate}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.environment}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5' }}>
                                <span style={{ background: d.status === 'Open' ? '#fee' : d.status === 'Closed' ? '#d5f0dc' : '#f5f5f5', color: d.status === 'Open' ? '#e74c3c' : d.status === 'Closed' ? '#27ae60' : '#888', padding: '1px 5px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.status}</span>
                              </td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.testPhase}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap' }}>{d.defectType}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', maxWidth: '140px', color: '#555' }}>{d.notes}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', color: '#555' }}>{defectRemarks[d.id] || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Morning notes */}
            {(summaryRecord.morningNotes || morningNotes) && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: '#8B4000', margin: '0 0 8px', fontSize: '16px', borderRight: '4px solid #f39c12', paddingRight: '10px' }}>לתשומת לב צוות הבוקר</h3>
                <p style={{ margin: 0, color: '#333', lineHeight: 1.7, fontSize: '14px', background: '#fff8f0', padding: '12px', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>{summaryRecord.morningNotes || morningNotes}</p>
              </div>
            )}

            <div style={{ textAlign: 'center', color: '#bbb', fontSize: '12px', marginTop: '24px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
              הופק אוטומטית ע"י DeployOps Platform
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
