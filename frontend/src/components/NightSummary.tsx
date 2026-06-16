import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';
import { useDialog } from '../context/DialogContext';
import { Card, Badge, StatCard, ProgressBar, SectionHeader, Alert, TextArea, Button } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  isRehearsal?: boolean;
  onApproved?: () => void;
  onGoToHub?: () => void;
}

interface Defect {
  id: string;
  assignedTo: string;
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
    <div style={{ background: C.bgNested, borderRadius: '8px', padding: '12px 16px', border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: C.textMuted, marginBottom: '10px' }}>{title}</div>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '72px', fontSize: '11px', color: C.textMuted, textAlign: 'right', flexShrink: 0 }}>{d.label}</div>
          <div style={{ flex: 1, background: C.bgHover, borderRadius: '4px', height: '20px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 0)}%`,
              background: d.color, height: '100%', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingLeft: '6px',
              transition: 'width 0.4s',
            }}>
              {d.count > 0 && <span style={{ fontSize: '11px', color: 'white', fontWeight: 'bold', paddingLeft: '4px' }}>{d.count}</span>}
            </div>
          </div>
          {d.count === 0 && <span style={{ fontSize: '11px', color: C.textDisabled }}>0</span>}
        </div>
      ))}
    </div>
  );
};

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: '4px 14px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' };
}

export const NightSummary: React.FC<Props> = ({ token, versionId, versionName, isRehearsal = false, onApproved, onGoToHub }) => {
  const dialog = useDialog();
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
  const [failureReasonsList,  setFailureReasonsList]  = useState<{ reason: string; requiresRollback: boolean }[]>([]);
  const [editingApproved,     setEditingApproved]     = useState(false);
  const [savingEdit,          setSavingEdit]          = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const userRole = (() => { try { return JSON.parse(atob(token.split('.')[1])).role; } catch { return ''; } })();
  const canForceApprove = ['ADMIN', 'RELEASE_MANAGER'].includes(userRole);

  const fetchSummaryRecord = async () => {
    try {
      const endpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal` : `${API}/summary/${versionId}`;
      const res = await axios.get(endpoint, { headers });
      setSummaryRecord(res.data);
      if (res.data?.headline)     setHeadline(res.data.headline);
      if (res.data?.morningNotes) setMorningNotes(res.data.morningNotes);
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
      // שמור headline/morningNotes אם הסיכום כבר מאושר
      if (summaryRecord) {
        try {
          const updated = await axios.patch(`${API}/summary/${versionId}`, { headline, morningNotes }, { headers });
          setSummaryRecord(updated.data);
        } catch { /* שגיאת שמירה לא חוסמת שליחת מייל */ }
      }
      const subject = isRehearsal
        ? `‏סיכום חזרה גנרלית (${versionName})`
        : `‏סיכום ליל ההטמעה (${versionName})`;
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
    axios.get(`${API}/failure-reasons`, { headers })
      .then(r => setFailureReasonsList(r.data.filter((fr: any) => fr.isActive)))
      .catch(() => {});
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
      // No phase marked isGoNoGo — treat only the last phase as "morning after".
      // Guard: if there is only one phase, nothing is a morning task (deployment IS the only phase).
      const sorted = [...version.phases].sort((a: any, b: any) => b.orderIndex - a.orderIndex);
      if (sorted.length > 1) {
        (sorted[0].subPhases ?? []).forEach((sp: any) => ids.add(sp.id));
      }
    }
    return ids;
  }, [version]);

  const isMorningTask = (t: any) => morningSubPhaseIds.has(t.subPhaseId);

  const goNogoWaiting = waitingTasks.filter(t => !isMorningTask(t)).length;
  const goNogoBlocked = blockedTasks.filter(t => !isMorningTask(t) && !t.goNoGoWaived).length;
  const goNogoInc     = nonWaitingTasks.filter(t => t.status !== 'DONE' && !isMorningTask(t) && !t.goNoGoWaived).length;
  const isGoNogo      = tasks.length > 0 && goNogoWaiting === 0 && goNogoBlocked === 0 && goNogoInc === 0;

  const failedNightTasks = tasks.filter(t => t.status === 'FAILED' && !isMorningTask(t));

  const canDownload = isGoNogo || canForceApprove;

  // ── Phase timeline ──
  const phaseTimelines = React.useMemo(() => {
    if (!version?.phases) return [];
    const sorted = [...version.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    return sorted.map((phase: any) => {
      const phTasks: any[] = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
      const ps  = phTasks.filter(t => t.plannedStart).map(t => new Date(t.plannedStart).getTime());
      const pe  = phTasks.filter(t => t.plannedEnd).map(t => new Date(t.plannedEnd).getTime());
      const as_ = phTasks.filter(t => t.actualStart || t.startedAt).map(t => new Date(t.actualStart || t.startedAt).getTime());
      const af  = phTasks.filter(t => t.actualFinish).map(t => new Date(t.actualFinish).getTime());
      const plannedEndMs = pe.length ? Math.max(...pe) : null;
      const actualEndMs  = af.length ? Math.max(...af) : null;
      const delayMins    = plannedEndMs && actualEndMs ? Math.round((actualEndMs - plannedEndMs) / 60000) : null;
      return {
        id:           phase.id,
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
    { label: 'Open',     count: defects.filter(d => d.status === 'Open').length,     color: C.statusFailed },
    { label: 'Closed',   count: defects.filter(d => d.status === 'Closed').length,   color: C.statusDone },
    { label: 'Canceled', count: defects.filter(d => d.status === 'Canceled').length, color: C.statusRollback },
  ];
  const responsibilityCounts = defects.reduce((acc: Record<string, number>, d) => {
    const key = d.assignedTo || '—';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const responsibilityData = Object.entries(responsibilityCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, color: C.brand }));

  const approveSummary = async () => {
    setApproveLoading(true); setApproveError(null);
    try {
      const endpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal/approve` : `${API}/summary/${versionId}/approve`;
      const force = canForceApprove && !isGoNogo;

      // Build phaseDelayReasons keyed by phase.id AND phase.name for backend lookup
      const phaseDelayReasonsForApi: Record<string, string> = {};
      phaseTimelines.forEach((pt, idx) => {
        const reason = phaseDelayReasons[idx];
        if (reason?.trim()) {
          phaseDelayReasonsForApi[pt.id]   = reason.trim();
          phaseDelayReasonsForApi[pt.name] = reason.trim();
        }
      });

      const crDataPayload = Object.keys(phaseDelayReasonsForApi).length > 0
        ? { phaseDelayReasons: phaseDelayReasonsForApi }
        : undefined;

      const res = await axios.post(endpoint, {
        headline,
        morningNotes,
        ...(force && { force: true }),
        ...(crDataPayload && { crData: crDataPayload }),
      }, { headers });
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
      ? `‏סיכום חזרה גנרלית (${versionName})`
      : `‏סיכום ליל ההטמעה (${versionName})`;
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

  const copyToEmail = async () => {
    const html = buildEmailHtml();
    const text = buildEmailText();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted, fontFamily: FONT }}>טוען...</div>
  );

  const effectiveGo = isGoNogo || (canForceApprove && !!summaryRecord?.sentAt);

  const morningTasksLeft = tasks.filter(t =>
    isMorningTask(t) && t.status !== 'DONE' && t.status !== 'FAILED' && t.status !== 'ROLLED_BACK'
  ).length;

  const autoHeadline = isGoNogo
    ? isRehearsal
      ? 'החזרה הגנרלית הסתיימה בהצלחה — כל המשימות הושלמו'
      : morningTasksLeft > 0
        ? `שלב ההטמעה הושלם בהצלחה — נותרו ${morningTasksLeft} משימות בוקר לביצוע`
        : 'הגרסה הוטמעה בהצלחה בסביבת הייצור גם ב-HOT וגם ב-HOTNET'
    : canForceApprove
      ? 'GO — הגרסה עברה בהצלחה, המשך בפעילויות הבוקר שלאחר הגרסה'
      : null;

  const buildEmailHtml = (): string => {
    const titleText = isRehearsal ? 'סיכום חזרה גנרלית' : 'סיכום ליל ההטמעה';
    const title = `${titleText} (<span dir="ltr" style="unicode-bidi:embed;">${versionName}</span>)`;
    const titlePlain = `${titleText} (${versionName})`;
    const headlineText = summaryRecord?.headline || headline;
    const notesText    = summaryRecord?.morningNotes || morningNotes;
    const dateStr = (summaryRecord?.sentAt ? new Date(summaryRecord.sentAt) : new Date())
      .toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Wraps a time range in dir=ltr so digits don't flip in RTL context
    const ltr = (s: string) => `<span dir="ltr" style="unicode-bidi:embed;">${s}</span>`;
    const timePair = (a: Date | null, b: Date | null) =>
      ltr(`${a ? fmtTime(a.toISOString()) : '—'} — ${b ? fmtTime(b.toISOString()) : '—'}`);

    // Section wrapper — full-width table row with header
    const sec = (icon: string, heading: string, body: string) => `
      <tr><td style="padding:22px 32px;border-bottom:1px solid #e9ecef;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">
          <tr><td style="padding-bottom:12px;border-bottom:2px solid #1e3a5f;font-size:14px;font-weight:bold;color:#1e3a5f;">
            ${icon}&nbsp;${heading}
          </td></tr>
          <tr><td style="padding-top:14px;">${body}</td></tr>
        </table>
      </td></tr>`;

    // ── Phase timelines ──────────────────────────────────────────
    const phaseRows = phaseTimelines.map((pt, i) => {
      const dm = pt.delayMins;
      const statusTxt = dm === null ? '—'
        : dm <= -SIGNIFICANT_MINS ? `⏩ לפני הזמן ${fmtMins(Math.abs(dm))}`
        : dm <= 0                 ? '✅ כמתוכנן'
        : dm < SIGNIFICANT_MINS  ? `⚠️ איחור קל ${fmtMins(dm)}`
        : `🚨 חריגה +${fmtMins(dm)}`;
      const sc = dm === null ? '#6c757d' : dm <= 0 ? '#27ae60' : dm < SIGNIFICANT_MINS ? '#e67e22' : '#e74c3c';
      const reason = phaseDelayReasons[i];
      return `<tr style="border-bottom:1px solid #e9ecef;">
        <td style="padding:9px 8px;font-weight:bold;color:#2c3e50;font-size:13px;text-align:right;">${pt.name}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;">${ltr(pt.environment)}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;">${timePair(pt.plannedStart, pt.plannedEnd)}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;">${timePair(pt.actualStart, pt.actualEnd)}</td>
        <td style="padding:9px 8px;font-size:12px;font-weight:bold;color:${sc};text-align:right;white-space:nowrap;">${statusTxt}${reason ? `<br><span style="font-size:11px;color:#6c757d;font-weight:normal;">הערה: ${reason}</span>` : ''}</td>
      </tr>`;
    }).join('');

    const phaseSection = phaseTimelines.length > 0 ? sec('⏱', 'לוחות זמנים', `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:collapse;font-size:13px;">
        <thead><tr bgcolor="#f8f9fa">
          <th style="padding:8px;text-align:right;color:#6c757d;font-size:11px;font-weight:bold;border-bottom:2px solid #dee2e6;">שלב</th>
          <th style="padding:8px;text-align:right;color:#6c757d;font-size:11px;font-weight:bold;border-bottom:2px solid #dee2e6;">סביבה</th>
          <th style="padding:8px;text-align:right;color:#6c757d;font-size:11px;font-weight:bold;border-bottom:2px solid #dee2e6;">מתוכנן</th>
          <th style="padding:8px;text-align:right;color:#6c757d;font-size:11px;font-weight:bold;border-bottom:2px solid #dee2e6;">בפועל</th>
          <th style="padding:8px;text-align:right;color:#6c757d;font-size:11px;font-weight:bold;border-bottom:2px solid #dee2e6;">סטטוס</th>
        </tr></thead>
        <tbody>${phaseRows}</tbody>
      </table>`) : '';

    // ── Blocked / failed tasks ───────────────────────────────────
    const blockedItems = blockedTasks.map(t => `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;border-right:4px solid #e74c3c;background:#fff5f5;" dir="rtl">
        <tr><td style="padding:10px 14px;">
          <div style="font-weight:bold;color:#2c3e50;font-size:13px;">• ${t.title}</div>
          ${t.assignedTeam?.name ? `<div style="font-size:12px;color:#6c757d;margin-top:3px;">👥 ${t.assignedTeam.name}</div>` : ''}
          ${t.blockedReason ? `<div style="font-size:12px;color:#e74c3c;margin-top:3px;">חסום: ${t.blockedReason}</div>` : ''}
          ${t.failedReason  ? `<div style="font-size:12px;color:#e74c3c;margin-top:3px;">נכשל: ${t.failedReason}</div>` : ''}
        </td></tr>
      </table>`).join('');
    const blockedSection = blockedTasks.length > 0
      ? sec('⚠️', `תקלות (${blockedTasks.length})`, blockedItems) : '';

    // ── QC defects — bar chart + status table ───────────────────
    const SEV_COLORS: Record<string, string> = {
      'Show Stopper': '#6c0000', Severe: '#c0392b', High: '#e67e22', Medium: '#f39c12', Low: '#3498db',
    };
    const SEVS = ['Show Stopper', 'Severe', 'High', 'Medium', 'Low'];
    const maxSev = Math.max(...SEVS.map(s => defects.filter(d => d.severity === s).length), 1);
    const sevBarRows = SEVS.map(sev => {
      const count = defects.filter(d => d.severity === sev).length;
      if (count === 0) return '';
      const pct = Math.round((count / maxSev) * 100);
      // gradient fills from RIGHT (RTL-native)
      return `<tr>
        <td style="text-align:right;padding:3px 10px;font-size:12px;color:#2c3e50;white-space:nowrap;width:110px;">${sev}</td>
        <td style="padding:3px 6px;">
          <div style="background:linear-gradient(to left,${SEV_COLORS[sev]} ${pct}%,#e9ecef ${pct}%);height:18px;border-radius:3px;min-width:80px;"></div>
        </td>
        <td style="text-align:center;padding:3px 6px;width:36px;">
          <span style="background:${SEV_COLORS[sev]};color:white;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:bold;">${count}</span>
        </td>
      </tr>`;
    }).join('');

    const openDef   = defects.filter(d => d.status === 'Open').length;
    const closedDef = defects.filter(d => d.status === 'Closed').length;
    const cancelDef = defects.filter(d => d.status === 'Canceled').length;

    const statusTableRows = [
      { label: 'פתוחות', count: openDef,   color: '#e74c3c' },
      { label: 'סגורות', count: closedDef, color: '#27ae60' },
      { label: 'בוטלו',  count: cancelDef, color: '#95a5a6' },
    ].filter(r => r.count > 0).map(r =>
      `<tr><td style="padding:5px 10px;text-align:right;font-size:13px;color:#2c3e50;">${r.label}</td>
       <td style="padding:5px 10px;text-align:center;"><span style="background:${r.color};color:white;padding:2px 12px;border-radius:10px;font-size:13px;font-weight:bold;">${r.count}</span></td></tr>`
    ).join('');

    // responsibility breakdown
    const respCounts = defects.reduce((acc: Record<string, number>, d) => { const k = d.assignedTo || '—'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const maxResp = Math.max(...Object.values(respCounts), 1);
    const sysRows = Object.entries(respCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([resp, cnt]) => {
        const pct = Math.round((cnt / maxResp) * 100);
        return `<tr>
          <td style="text-align:right;padding:3px 10px;font-size:12px;color:#2c3e50;white-space:nowrap;width:110px;">${resp}</td>
          <td style="padding:3px 6px;">
            <div style="background:linear-gradient(to left,#3498db ${pct}%,#e9ecef ${pct}%);height:16px;border-radius:3px;min-width:60px;"></div>
          </td>
          <td style="text-align:center;padding:3px 6px;width:30px;font-size:12px;font-weight:bold;color:#3498db;">${cnt}</td>
        </tr>`;
      }).join('');

    // individual defects table
    const defectTableRows = defects.map(d => {
      const sevColor = SEV_COLORS[d.severity] || '#95a5a6';
      const stColor  = d.status === 'Open' ? '#e74c3c' : d.status === 'Closed' ? '#27ae60' : '#95a5a6';
      return `<tr style="border-bottom:1px solid #e9ecef;">
        <td style="padding:7px 8px;font-size:12px;color:#2c3e50;text-align:right;max-width:200px;">${d.title}</td>
        <td style="padding:7px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;">${d.assignedTo}</td>
        <td style="padding:7px 8px;text-align:center;white-space:nowrap;">
          <span style="background:${sevColor};color:white;padding:1px 8px;border-radius:8px;font-size:11px;font-weight:bold;">${d.severity}</span>
        </td>
        <td style="padding:7px 8px;text-align:center;white-space:nowrap;">
          <span style="background:${stColor};color:white;padding:1px 8px;border-radius:8px;font-size:11px;font-weight:bold;">${d.status}</span>
        </td>
        <td style="padding:7px 8px;font-size:11px;color:#6c757d;text-align:right;white-space:nowrap;">${d.reporter}</td>
      </tr>`;
    }).join('');

    const defectsSection = defects.length > 0 ? sec('🔬', `תקלות QC — סה"כ ${defects.length} (פתוחות: ${openDef})`, `
      <!-- Charts row -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="margin-bottom:18px;">
        <tr>
          <td valign="top" style="width:50%;padding-left:16px;">
            <div style="font-size:11px;font-weight:bold;color:#6c757d;margin-bottom:8px;letter-spacing:1px;">לפי חומרה</div>
            <table cellpadding="0" cellspacing="0" border="0" dir="rtl" width="100%">${sevBarRows}</table>
          </td>
          <td valign="top" style="width:25%;padding-left:16px;">
            <div style="font-size:11px;font-weight:bold;color:#6c757d;margin-bottom:8px;letter-spacing:1px;">לפי סטטוס</div>
            <table cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:collapse;">${statusTableRows}</table>
          </td>
          <td valign="top" style="width:25%;">
            <div style="font-size:11px;font-weight:bold;color:#6c757d;margin-bottom:8px;letter-spacing:1px;">לפי מערכת</div>
            <table cellpadding="0" cellspacing="0" border="0" dir="rtl" width="100%">${sysRows}</table>
          </td>
        </tr>
      </table>
      <!-- Defects detail table -->
      <div style="font-size:11px;font-weight:bold;color:#6c757d;margin-bottom:8px;letter-spacing:1px;">רשימת תקלות</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:collapse;font-size:12px;">
        <thead><tr bgcolor="#f8f9fa">
          <th style="padding:7px 8px;text-align:right;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">כותרת</th>
          <th style="padding:7px 8px;text-align:right;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">מערכת</th>
          <th style="padding:7px 8px;text-align:center;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">חומרה</th>
          <th style="padding:7px 8px;text-align:center;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">סטטוס</th>
          <th style="padding:7px 8px;text-align:right;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">מדווח</th>
        </tr></thead>
        <tbody>${defectTableRows}</tbody>
      </table>`) : '';

    // ── Test coverage ────────────────────────────────────────────
    const coverageRows = coverage.map(cv => {
      const passPct = cv.total > 0 ? Math.round((cv.passed / cv.total) * 100) : 0;
      return `<tr style="border-bottom:1px solid #e9ecef;">
        <td style="padding:8px;font-size:12px;color:#2c3e50;text-align:right;">${cv.title || cv.cycle}</td>
        <td style="padding:8px;font-size:12px;color:#6c757d;text-align:right;">${cv.responsible}</td>
        <td style="padding:8px;text-align:center;font-size:12px;font-weight:bold;color:#2c3e50;">${cv.total}</td>
        <td style="padding:8px;text-align:center;">
          <span style="background:#27ae60;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.passed}</span>
        </td>
        <td style="padding:8px;text-align:center;">
          <span style="background:#e74c3c;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.failed}</span>
        </td>
        <td style="padding:8px;text-align:center;">
          <span style="background:#e67e22;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.blocked}</span>
        </td>
        <td style="padding:8px;text-align:center;font-size:12px;color:#6c757d;">${cv.notRun}</td>
        <td style="padding:8px;text-align:center;">
          <div style="background:linear-gradient(to left,#27ae60 ${passPct}%,#e9ecef ${passPct}%);height:14px;min-width:60px;border-radius:3px;"></div>
          <div style="font-size:10px;color:#6c757d;margin-top:2px;text-align:center;">${passPct}%</div>
        </td>
      </tr>`;
    }).join('');

    const coverageSection = coverage.length > 0 ? sec('🧪', 'תכולת בדיקות', `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-collapse:collapse;font-size:12px;">
        <thead><tr bgcolor="#f8f9fa">
          <th style="padding:7px 8px;text-align:right;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">תכנית</th>
          <th style="padding:7px 8px;text-align:right;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">אחראי</th>
          <th style="padding:7px 8px;text-align:center;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">סה"כ</th>
          <th style="padding:7px 8px;text-align:center;color:#27ae60;font-size:11px;border-bottom:2px solid #dee2e6;">עברו</th>
          <th style="padding:7px 8px;text-align:center;color:#e74c3c;font-size:11px;border-bottom:2px solid #dee2e6;">נכשלו</th>
          <th style="padding:7px 8px;text-align:center;color:#e67e22;font-size:11px;border-bottom:2px solid #dee2e6;">חסומות</th>
          <th style="padding:7px 8px;text-align:center;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">לא הורצו</th>
          <th style="padding:7px 8px;text-align:center;color:#6c757d;font-size:11px;border-bottom:2px solid #dee2e6;">כיסוי</th>
        </tr></thead>
        <tbody>${coverageRows}</tbody>
      </table>`) : '';

    // ── Headline & notes ─────────────────────────────────────────
    const headlineSection = (autoHeadline || headlineText) ? sec('📋', 'עיקרי הדברים', `
      ${autoHeadline ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="margin-bottom:8px;border-right:4px solid #27ae60;background:#f0f9f0;"><tr><td style="padding:10px 14px;font-size:13px;color:#155724;line-height:1.5;">${autoHeadline}</td></tr></table>` : ''}
      ${headlineText ? `<div style="font-size:13px;color:#2c3e50;line-height:1.6;white-space:pre-wrap;">${headlineText}</div>` : ''}`) : '';

    const notesSection = notesText ? sec('🌅', 'לתשומת לב צוות הבוקר', `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="border-right:4px solid #f39c12;background:#fffbf0;">
        <tr><td style="padding:10px 14px;font-size:13px;color:#2c3e50;line-height:1.6;white-space:pre-wrap;">${notesText}</td></tr>
      </table>`) : '';

    // ── Assemble ─────────────────────────────────────────────────
    return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<!--[if mso]><style>table{border-collapse:collapse;}td{font-family:Arial,sans-serif;}</style><![endif]-->
</head>
<body dir="rtl" style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;direction:rtl;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8">
<tr><td style="padding:8px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">

  <!-- HEADER -->
  <tr><td bgcolor="#1e3a5f" align="center" style="padding:28px 32px;">
    <p style="margin:0 0 6px;font-size:12px;color:#8ab4d4;font-family:Arial;">NightOps Platform</p>
    <h1 style="margin:0 0 16px;color:#ffffff;font-size:20px;font-weight:bold;font-family:Arial;">${title}</h1>
    <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td bgcolor="${effectiveGo ? '#27ae60' : '#c0392b'}" style="padding:8px 28px;font-size:16px;font-weight:bold;color:white;font-family:Arial;">
        ${effectiveGo ? '✅ GO' : '❌ NO GO'}
      </td>
    </tr></table>
    <p style="margin:10px 0 0;font-size:13px;color:#8ab4d4;font-family:Arial;">${ltr(dateStr)}</p>
  </td></tr>

  <!-- STATS -->
  <tr><td bgcolor="#f8f9fa" style="padding:20px 32px;border-bottom:1px solid #e9ecef;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">
      <tr>
        <td align="center" style="padding:12px;">
          <div style="font-size:30px;font-weight:bold;color:#27ae60;font-family:Arial;">${doneTasks.length}</div>
          <div style="font-size:12px;color:#6c757d;margin-top:4px;font-family:Arial;">הושלמו</div>
        </td>
        <td align="center" style="padding:12px;border-right:1px solid #dee2e6;">
          <div style="font-size:30px;font-weight:bold;color:#e67e22;font-family:Arial;">${inProgressTasks.length}</div>
          <div style="font-size:12px;color:#6c757d;margin-top:4px;font-family:Arial;">בביצוע</div>
        </td>
        <td align="center" style="padding:12px;border-right:1px solid #dee2e6;">
          <div style="font-size:30px;font-weight:bold;color:#e74c3c;font-family:Arial;">${blockedTasks.length}</div>
          <div style="font-size:12px;color:#6c757d;margin-top:4px;font-family:Arial;">חסומות/נכשלו</div>
        </td>
        <td align="center" style="padding:12px;border-right:1px solid #dee2e6;">
          <div style="font-size:30px;font-weight:bold;color:#2c3e50;font-family:Arial;">${tasks.length}</div>
          <div style="font-size:12px;color:#6c757d;margin-top:4px;font-family:Arial;">סה"כ</div>
        </td>
      </tr>
    </table>
    <!-- Progress bar: gradient fills from RIGHT (RTL-native, no overflow:hidden needed) -->
    <div style="background:linear-gradient(to left,#27ae60 ${progressPercent}%,#dee2e6 ${progressPercent}%);height:10px;margin-top:12px;"></div>
    <p style="text-align:center;font-size:13px;color:#6c757d;margin:6px 0 0;font-weight:bold;font-family:Arial;">${progressPercent}% הושלמו</p>
  </td></tr>

  ${headlineSection}
  ${phaseSection}
  ${blockedSection}
  ${defectsSection}
  ${coverageSection}
  ${notesSection}

  <!-- FOOTER -->
  <tr><td bgcolor="#f8f9fa" align="center" style="padding:14px 32px;border-top:1px solid #e9ecef;">
    <p style="margin:0;font-size:12px;color:#adb5bd;font-family:Arial;">הופק אוטומטית ע"י NightOps Platform</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  };

  const tdBase: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${C.border}`, fontSize: '13px', verticalAlign: 'middle', color: C.textSecondary };

  const timelineDelayBadge = (delayMins: number | null) => {
    if (delayMins === null) return <span style={badgeStyle(C.bgHover, C.textMuted)}>— ממתין לנתונים</span>;
    if (delayMins <= -SIGNIFICANT_MINS) return <span style={badgeStyle(C.bgDone, C.statusDone)}>⏩ לפני הזמן {fmtMins(Math.abs(delayMins))}</span>;
    if (delayMins <= 0)                 return <span style={badgeStyle(C.bgDone, C.statusDone)}>✅ כמתוכנן</span>;
    if (delayMins < SIGNIFICANT_MINS)  return <span style={badgeStyle(C.bgInProgress, C.statusInProgress)}>⚠️ איחור קל {fmtMins(delayMins)}</span>;
    return <span style={badgeStyle(C.bgBlocked, C.statusFailed)}>🚨 חריגה בלוחות הזמנים +{fmtMins(delayMins)}</span>;
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: FONT }}>
      <h2 style={{ color: isRehearsal ? C.warning : C.textPrimary, margin: '0 0 20px', fontSize: '20px' }}>
        {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} (
        <bdi
          onClick={onGoToHub}
          title={onGoToHub ? 'עבור לדף הנחיתה' : undefined}
          style={{ cursor: onGoToHub ? 'pointer' : 'default', textDecoration: onGoToHub ? 'underline dotted' : 'none' }}
        >{versionName}</bdi>)
      </h2>

      {/* ── Rollback required warning ── */}
      {(() => {
        const rollbackSet = new Set(failureReasonsList.filter(r => r.requiresRollback).map(r => r.reason));
        const rollbackTasks = tasks.filter(t => t.status === 'FAILED' && t.failedReason && rollbackSet.has(t.failedReason));
        if (rollbackTasks.length === 0) return null;
        return (
          <div style={{ background: C.nogoBg, border: `2px solid ${C.nogoBorder}`, borderRadius: '12px', padding: '14px 20px', marginBottom: '16px' }}>
            <div style={{ fontWeight: 'bold', color: C.nogoText, fontSize: '15px', marginBottom: '8px' }}>🔴 נדרש Rollback לגרסה!</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rollbackTasks.map(t => (
                <div key={t.id} style={{ fontSize: '13px', color: C.textSecondary }}>
                  ✗ <strong style={{ color: C.textPrimary }}>{t.title}</strong> — {t.failedReason}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '10px', fontSize: '12px', color: C.nogoText, fontWeight: 'bold' }}>
              לא ניתן לאשר סיכום עד לביצוע Rollback. פנה למנהל הלילה.
            </div>
          </div>
        );
      })()}

      {/* ── GO/NO GO Banner ── */}
      <div style={{
        borderRadius: RADIUS['2xl'],
        padding: `${SP[5]} ${SP[6]}`,
        marginBottom: SP[5],
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: SP[4],
        background: effectiveGo ? C.goBg : C.nogoBg,
        border: `2px solid ${effectiveGo ? C.goBorder : C.nogoBorder}`,
        boxShadow: effectiveGo
          ? `0 4px 20px rgba(55,196,122,0.15)`
          : `0 4px 20px rgba(240,106,106,0.15)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background pulse */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: effectiveGo
            ? 'radial-gradient(ellipse at 80% 50%, rgba(86,211,100,0.06), transparent)'
            : 'radial-gradient(ellipse at 80% 50%, rgba(248,81,73,0.06), transparent)',
        }} />

        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: SP[3], marginBottom: SP[2],
          }}>
            <span style={{ fontSize: '24px' }}>{effectiveGo ? '✅' : '🛑'}</span>
            <span style={{
              ...TEXT.xl, fontWeight: WEIGHT.bold,
              color: effectiveGo ? C.goText : C.nogoText,
            }}>
              {effectiveGo
                ? (isGoNogo ? 'GO — ניתן להוציא סיכום' : 'GO — הגרסה עברה בהצלחה')
                : 'NO GO — לא ניתן להוציא סיכום'}
            </span>
          </div>
          {!isGoNogo && (
            <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
              {waitingTasks.length > 0 && (
                <Badge color={C.statusWaiting} bg={C.bgWaiting}>⏳ {waitingTasks.length} ממתינות</Badge>
              )}
              {incompleteCount > 0 && (
                <Badge color={C.warning} bg={C.bgInProgress}>{incompleteCount} לא הושלמו</Badge>
              )}
              {blockedTasks.length > 0 && (
                <Badge color={C.statusBlocked} bg={C.bgBlocked}>{blockedTasks.length} חסומות</Badge>
              )}
            </div>
          )}
        </div>

        {/* Progress ring */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SP[1],
          flexShrink: 0, position: 'relative',
        }}>
          <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="36" cy="36" r="30" fill="none" stroke={effectiveGo ? `${C.success}22` : `${C.danger}22`} strokeWidth="5"/>
            <circle cx="36" cy="36" r="30" fill="none"
              stroke={effectiveGo ? C.success : C.danger}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 30}`}
              strokeDashoffset={`${2 * Math.PI * 30 * (1 - progressPercent / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
            <text x="36" y="36" textAnchor="middle" dominantBaseline="central"
              style={{ transform: 'rotate(90deg) translateY(-72px)' }}
              fill={effectiveGo ? C.success : C.danger}
              fontSize="16" fontWeight="700" fontFamily={FONT}>
              {progressPercent}%
            </text>
          </svg>
          <span style={{ ...TEXT.xs, color: C.textMuted }}>הושלם</span>
        </div>
      </div>

      {/* ── KPI Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: SP[3], marginBottom: SP[5] }}>
        {[
          { label: 'הושלמו',  value: doneTasks.length,       color: C.statusDone    },
          { label: 'בביצוע',  value: inProgressTasks.length, color: C.statusInProgress },
          { label: 'פתוחות',  value: openTasks.length,       color: C.statusOpen    },
          { label: 'ממתינות', value: waitingTasks.length,    color: C.statusWaiting },
          { label: 'חסומות',  value: blockedTasks.length,    color: C.statusBlocked },
        ].map(s => (
          <StatCard key={s.label} label={s.label} value={s.value} color={s.color} />
        ))}
      </div>

      {/* ── Progress bar ── */}
      <Card style={{ marginBottom: SP[4] }}>
        <ProgressBar
          value={doneTasks.length} max={tasks.length}
          color={effectiveGo ? C.success : C.brand}
          label="התקדמות כללית"
          showValue
          height={8}
        />
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>

        {/* ── עיקרי הדברים ── */}
        <Card>
          <SectionHeader title="עיקרי הדברים" style={{ marginBottom: SP[3] }} />
          {autoHeadline && (
            <Alert variant="success" style={{ marginBottom: SP[3] }}>
              {autoHeadline}
            </Alert>
          )}
          <textarea value={headline} onChange={e => setHeadline(e.target.value)}
            placeholder={autoHeadline ? 'הוסף הערות נוספות אם נדרש...' : 'לדוגמה: העלאת הגרסה הסתיימה בהצלחה בהוט ובהוטנט'}
            rows={3} style={{
              width: '100%', padding: SP[3], border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.md,
              ...TEXT.base, boxSizing: 'border-box', resize: 'vertical', fontFamily: FONT, direction: 'rtl',
              background: C.bgNested, color: C.textPrimary, outline: 'none', transition: EASE.fast,
            }} />
        </Card>

        {/* ── Timeline ── */}
        {phaseTimelines.length > 0 && (
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
            <h3 style={{ margin: '0 0 16px', color: C.textPrimary, fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>⏱ לוחות זמנים</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {phaseTimelines.map((pt, idx) => {
                const isLate  = pt.delayMins !== null && pt.delayMins >= SIGNIFICANT_MINS;
                const isEarly = pt.delayMins !== null && pt.delayMins <= -SIGNIFICANT_MINS;
                const isOk    = pt.delayMins !== null && pt.delayMins <= 0;
                const borderColor = isLate ? C.statusFailed : (isEarly || isOk) ? C.statusDone : C.border;
                const bgColor     = isLate ? C.bgBlocked : (isEarly || isOk) ? C.bgDone : C.bgNested;
                const envColor    = pt.environment === 'HOT' ? C.statusFailed : C.statusOpen;
                const envBg       = pt.environment === 'HOT' ? 'rgba(248,81,73,0.15)' : 'rgba(88,166,255,0.15)';
                return (
                  <div key={idx} style={{ border: `2px solid ${borderColor}`, borderRadius: '12px', padding: '16px 20px', background: bgColor, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ background: envBg, color: envColor, padding: '3px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', border: `1px solid ${envColor}33` }}>{pt.environment}</span>
                        <span style={{ fontWeight: '700', color: C.textPrimary, fontSize: '15px' }}>{pt.name}</span>
                        <span style={{ fontSize: '12px', color: C.textMuted, background: C.bgNested, padding: '2px 8px', borderRadius: '8px' }}>{pt.doneTasks}/{pt.totalTasks} משימות</span>
                      </div>
                      {timelineDelayBadge(pt.delayMins)}
                    </div>
                    {/* Timing grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
                      {[
                        { label: 'התחלה מתוכננת', value: pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—', color: C.textSecondary },
                        { label: 'סיום מתוכנן',   value: pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—', color: C.statusInProgress },
                        { label: 'התחלה בפועל',   value: pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—', color: C.statusOpen },
                        { label: 'סיום בפועל',    value: pt.actualEnd    ? fmtTime(pt.actualEnd.toISOString())    : '—', color: isLate ? C.statusFailed : C.statusDone },
                      ].map(f => (
                        <div key={f.label} style={{ background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 12px' }}>
                          <div style={{ color: C.textMuted, fontSize: '11px', marginBottom: '4px', fontWeight: '500' }}>{f.label}</div>
                          <div style={{ fontWeight: '700', color: f.color, fontSize: '15px', letterSpacing: '0.3px' }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Delay reason */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <label style={{ fontSize: '12px', color: isLate ? C.statusFailed : C.textMuted, paddingTop: '8px', flexShrink: 0, fontWeight: isLate ? '600' : 'normal' }}>
                        {isLate ? '⚠️ סיבת חריגה *' : 'סיבת חריגה / הערה'}
                      </label>
                      <textarea
                        value={phaseDelayReasons[idx] || ''}
                        onChange={e => setPhaseDelayReasons(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder={isLate ? 'חובה — הסבר מדוע חרגו מלוחות הזמנים' : 'אופציונלי'}
                        rows={2}
                        style={{
                          flex: 1, padding: '7px 10px',
                          border: `1px solid ${isLate && !(phaseDelayReasons[idx] || '').trim() ? C.statusFailed : C.border}`,
                          borderRadius: '6px', fontSize: '13px', resize: 'vertical', fontFamily: FONT, direction: 'rtl',
                          background: C.bgNested, color: C.textPrimary, outline: 'none',
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
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `2px solid ${C.statusFailed}` }}>
            <h3 style={{ margin: '0 0 12px', color: C.statusFailed, fontSize: '15px' }}>תקלות ({blockedTasks.length})</h3>
            {blockedTasks.map(task => (
              <div key={task.id} style={{ background: C.bgBlocked, borderRadius: '8px', padding: '12px', marginBottom: '8px', border: `1px solid ${C.statusFailed}33` }}>
                <div style={{ fontWeight: 'bold', color: C.statusFailed, fontSize: '14px' }}>{task.title}</div>
                <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '4px' }}>
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Test Coverage (QC) ── */}
        {(
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: C.textPrimary, fontSize: '16px', fontWeight: '700' }}>🧪 תכולת בדיקות (QC Test Coverage)</h3>
              <span style={{ fontSize: '11px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
            </div>
            {qcLoading ? (
              <div style={{ textAlign: 'center', padding: '16px', color: C.textMuted }}>טוען נתוני QC...</div>
            ) : coverage.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px', color: C.textMuted, background: C.bgNested, borderRadius: '8px' }}>אין נתוני בדיקות</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: C.bgActive }}>
                      {['#', 'פרויקט/רגרסיה/באג', 'כותרת / CR', 'אחראי', 'Passed', 'Failed', 'Not Completed', 'Blocked', 'Not Run', 'הערות'].map(h => (
                        <th key={h} style={{ padding: '9px 10px', textAlign: 'right', color: C.textPrimary, fontWeight: '600', whiteSpace: 'nowrap', border: `1px solid ${C.border}`, fontSize: '12px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : C.bgNested }}>
                        <td style={{ ...tdBase, color: C.textMuted, width: '28px', textAlign: 'center' }}>{i + 1}</td>
                        <td style={{ ...tdBase, fontWeight: r.subject ? 'bold' : 'normal', color: r.subject ? C.textPrimary : C.textMuted, whiteSpace: 'nowrap' }}>{r.subject || '—'}</td>
                        <td style={{ ...tdBase, maxWidth: '240px' }}>{r.title}</td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{r.responsible}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: C.statusDone, fontWeight: r.passed > 0 ? 'bold' : 'normal' }}>{r.passed}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.failed > 0 ? C.statusFailed : C.textMuted, fontWeight: r.failed > 0 ? 'bold' : 'normal' }}>{r.failed}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.notCompleted > 0 ? C.statusInProgress : C.textMuted }}>{r.notCompleted}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: r.blocked > 0 ? C.statusFailed : C.textMuted }}>{r.blocked}</td>
                        <td style={{ ...tdBase, textAlign: 'center', color: C.textMuted }}>{r.notRun}</td>
                        <td style={{ ...tdBase, minWidth: '120px' }}>
                          <textarea
                            value={coverageRemarks[i] || ''}
                            onChange={e => setCoverageRemarks(prev => ({ ...prev, [i]: e.target.value }))}
                            placeholder="הערות..."
                            rows={2}
                            style={{ width: '100%', padding: '4px', border: `1px solid ${C.border}`, borderRadius: '4px', fontSize: '11px', resize: 'vertical', fontFamily: FONT, direction: 'rtl', boxSizing: 'border-box', background: C.bgHover, color: C.textPrimary }}
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
          <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: C.textPrimary, fontSize: '15px' }}>🐛 תקלות שדווחו (QC)</h3>
              <span style={{ fontSize: '11px', background: C.bgInProgress, color: C.statusInProgress, padding: '3px 10px', borderRadius: '10px', border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
            </div>
            {qcLoading ? (
              <div style={{ textAlign: 'center', padding: '16px', color: C.textMuted }}>טוען נתוני QC...</div>
            ) : defects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: C.statusDone, background: C.bgDone, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', border: `1px solid ${C.statusDone}44` }}>
                ✅ לא דווחו תקלות במהלך הפעילות
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                  <BarChart title="התפלגות לפי חומרה"       data={severityData.filter(d => d.count > 0)} />
                  <BarChart title="התפלגות לפי סטטוס"       data={statusData.filter(d => d.count > 0)} />
                  <BarChart title="התפלגות לפי Responsibility" data={responsibilityData} />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: C.bgNested }}>
                        {['ID', 'כותרת התקלה', 'תיאור', 'חומרה', 'עדיפות', 'צוות אחראי', 'דווח ע"י', 'תאריך גילוי', 'סביבה', 'סטטוס', 'שלב בדיקה', 'סוג תקלה', 'הערות', 'מלל חופשי'].map(h => (
                          <th key={h} style={{ padding: '7px 8px', textAlign: 'right', color: C.textSecondary, fontWeight: 'bold', whiteSpace: 'nowrap', border: `1px solid ${C.border}`, fontSize: '11px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defects.map((d, i) => (
                        <tr key={d.id} style={{ background: i % 2 === 0 ? 'transparent' : C.bgNested }}>
                          <td style={{ ...tdBase, color: C.statusOpen, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.id}</td>
                          <td style={{ ...tdBase, maxWidth: '160px', fontWeight: 'bold', color: C.textPrimary }}>{d.title}</td>
                          <td style={{ ...tdBase, maxWidth: '220px' }}>{d.description}</td>
                          <td style={{ ...tdBase }}>
                            <span style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6', padding: '1px 6px', borderRadius: '8px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap' }}>{d.severity}</span>
                          </td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.priority}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.assignedTo}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.reporter}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.discoveryDate}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.environment}</td>
                          <td style={{ ...tdBase }}>
                            <span style={{
                              background: d.status === 'Open' ? C.bgBlocked : d.status === 'Closed' ? C.bgDone : C.bgHover,
                              color: d.status === 'Open' ? C.statusFailed : d.status === 'Closed' ? C.statusDone : C.textMuted,
                              padding: '1px 8px', borderRadius: '8px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap',
                            }}>{d.status}</span>
                          </td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.testPhase}</td>
                          <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>{d.defectType}</td>
                          <td style={{ ...tdBase, maxWidth: '160px' }}>{d.notes}</td>
                          <td style={{ ...tdBase, minWidth: '120px' }}>
                            <textarea
                              value={defectRemarks[d.id] || ''}
                              onChange={e => setDefectRemarks(prev => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="מלל חופשי..."
                              rows={2}
                              style={{ width: '100%', padding: '4px', border: `1px solid ${C.border}`, borderRadius: '4px', fontSize: '11px', resize: 'vertical', fontFamily: FONT, direction: 'rtl', boxSizing: 'border-box', background: C.bgHover, color: C.textPrimary }}
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
        <div style={{ background: C.bgCard, borderRadius: '12px', padding: '20px', border: `1px solid ${C.border}` }}>
          <h3 style={{ margin: '0 0 12px', color: C.textPrimary, fontSize: '15px' }}>הערות לצוות הבוקר</h3>
          <textarea value={morningNotes} onChange={e => setMorningNotes(e.target.value)}
            placeholder="פריטים שדורשים מעקב בוקר..."
            rows={3} style={{
              width: '100%', padding: '10px', border: `1px solid ${C.borderEm}`, borderRadius: '8px',
              fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: FONT, direction: 'rtl',
              background: C.bgNested, color: C.textPrimary, outline: 'none',
            }} />
        </div>

        {/* ── משימות נכשלות — אישור דילוג (מנהל בלבד) ── */}
        {canForceApprove && failedNightTasks.length > 0 && !summaryRecord?.sentAt && (
          <div style={{ background: C.bgCard, border: `2px solid ${C.statusFailed}`, borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', color: C.statusFailed, fontSize: '15px' }}>⚠️ משימות נכשלות ({failedNightTasks.length})</h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: C.textMuted }}>
              סמן משימות שנכשלו כ"מאושר לדילוג" כדי לאפשר הפקת סיכום מבלי לעקוף GO/NO GO.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {failedNightTasks.map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px',
                  background: t.goNoGoWaived ? C.bgDone : C.bgBlocked,
                  border: `1px solid ${t.goNoGoWaived ? C.statusDone + '44' : C.statusFailed + '44'}`,
                }}>
                  <span style={{ flex: 1, fontSize: '13px', color: t.goNoGoWaived ? C.statusDone : C.statusFailed, fontWeight: t.goNoGoWaived ? 'normal' : 'bold' }}>
                    {t.goNoGoWaived ? '✓ ' : '✗ '}{t.title}
                  </span>
                  {t.assignedTeam?.name && <span style={{ fontSize: '11px', color: C.textMuted }}>{t.assignedTeam.name}</span>}
                  <button
                    onClick={() => waiveTask(t.id)}
                    style={{ padding: '4px 12px', fontSize: '12px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap',
                      background: t.goNoGoWaived ? C.bgHover : '#e67e22', color: t.goNoGoWaived ? C.textMuted : 'white' }}>
                    {t.goNoGoWaived ? 'בטל אישור' : '✓ אשר דילוג'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── אישור סיכום ── */}
        <div style={{
          background: summaryRecord?.sentAt ? C.bgDone : C.bgCard,
          border: `2px solid ${summaryRecord?.sentAt ? C.statusDone : '#e67e22'}`,
          borderRadius: '12px', padding: '20px',
        }}>
          {summaryRecord?.sentAt ? (
            <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>✅</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: C.statusDone, fontSize: '15px' }}>הסיכום אושר ונשמר במערכת</div>
                  <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '2px' }}>
                    {new Date(summaryRecord.sentAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {summaryRecord.forceApprovedBy && (
                    <div style={{ fontSize: '12px', color: C.statusInProgress, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>⚠️</span>
                      <span>
                        אושר בעקיפת GO על-ידי {summaryRecord.forceApprovedBy}
                        {summaryRecord.forceApprovedAt && ` ב-${new Date(summaryRecord.forceApprovedAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {canForceApprove && !editingApproved && (
                  <button onClick={() => { setHeadline(summaryRecord?.headline || ''); setMorningNotes(summaryRecord?.morningNotes || ''); setEditingApproved(true); }}
                    style={{ padding: '10px 18px', background: C.bgHover, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT }}>
                    ✏️ ערוך דוח
                  </button>
                )}
                <button onClick={copyToEmail}
                  style={{ padding: '10px 24px', background: copied ? C.statusDone : C.statusWaiting, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: FONT, transition: 'background 0.2s' }}>
                  {copied ? '✓ הועתק!' : '📋 העתק לאימייל'}
                </button>
                <button
                  onClick={emailEnabled ? sendEmail : () => dialog.alert('שירות המייל אינו מופעל — הגדר SMTP בפאנל הניהול', 'שירות מייל מושבת', 'warning')}
                  disabled={emailSending}
                  style={{
                    padding: '10px 24px', fontFamily: FONT,
                    background: emailSending ? C.textDisabled : emailStatus === 'ok' ? C.statusDone : emailStatus === 'err' ? C.statusFailed : emailEnabled ? C.brand : C.bgHover,
                    color: 'white', border: 'none', borderRadius: '8px',
                    cursor: emailSending ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold', fontSize: '14px', transition: 'background 0.2s',
                  }}
                >
                  {emailSending ? '⏳ שולח...' : emailStatus === 'ok' ? '✓ נשלח!' : emailStatus === 'err' ? '✗ שגיאה' : '📧 שלח במייל לרשימת תפוצה'}
                </button>
                {emailStatus === 'err' && emailError && (
                  <div style={{ fontSize: '12px', color: C.statusFailed, marginTop: '4px' }}>{emailError}</div>
                )}
              </div>
            </div>

            {/* ── עריכת דוח לאחר אישור (מנהל לילה בלבד) ── */}
            {editingApproved && canForceApprove && (
              <div style={{ marginTop: '16px', borderTop: `1px solid ${C.border}`, paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: C.statusInProgress }}>✏️ עריכת תוכן הדוח</div>
                <div>
                  <label style={{ fontSize: '12px', color: C.textMuted, display: 'block', marginBottom: '4px' }}>עיקרי הדברים</label>
                  <textarea
                    value={headline}
                    onChange={e => setHeadline(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, fontSize: '13px', fontFamily: FONT, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: C.textMuted, display: 'block', marginBottom: '4px' }}>לתשומת לב צוות הבוקר</label>
                  <textarea
                    value={morningNotes}
                    onChange={e => setMorningNotes(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.bgNested, color: C.textPrimary, fontSize: '13px', fontFamily: FONT, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    disabled={savingEdit}
                    onClick={async () => {
                      setSavingEdit(true);
                      try {
                        const phaseDelayReasonsForApi: Record<string, string> = {};
                        phaseTimelines.forEach((pt, idx) => {
                          const reason = phaseDelayReasons[idx];
                          if (reason?.trim()) {
                            phaseDelayReasonsForApi[pt.id]   = reason.trim();
                            phaseDelayReasonsForApi[pt.name] = reason.trim();
                          }
                        });
                        const res = await axios.patch(`${API}/summary/${versionId}`, {
                          headline,
                          morningNotes,
                          ...(Object.keys(phaseDelayReasonsForApi).length > 0 && { crData: { phaseDelayReasons: phaseDelayReasonsForApi } }),
                        }, { headers });
                        setSummaryRecord(res.data);
                        setEditingApproved(false);
                      } catch (err: any) {
                        dialog.alert(err?.response?.data?.message || 'שגיאה בשמירה', 'שגיאה', 'danger');
                      } finally { setSavingEdit(false); }
                    }}
                    style={{ padding: '8px 20px', background: savingEdit ? C.textDisabled : C.statusDone, color: 'white', border: 'none', borderRadius: '8px', cursor: savingEdit ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                    {savingEdit ? 'שומר...' : '✓ שמור שינויים'}
                  </button>
                  <button onClick={() => setEditingApproved(false)}
                    style={{ padding: '8px 16px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    ביטול
                  </button>
                </div>
              </div>
            )}
            </>
          ) : (
            <div>
              <h3 style={{ margin: '0 0 12px', color: '#e67e22', fontSize: '15px' }}>
                {isRehearsal ? '⚠️ אישור סיכום החזרה הגנרלית' : '⚠️ אישור סיכום — נדרש לסיום הלילה'}
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.textMuted }}>
                {isRehearsal ? 'אישור הסיכום ישמור אותו במערכת ויאפס את תוכנית העבודה לקראת ליל ההטמעה.' : 'לפני אישור הסיכום — קרא את הדוח בעיון ווודא שכל הנתונים מדויקים.'}
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: C.textSecondary, marginBottom: '14px', fontSize: '14px' }}>
                <input type="checkbox" checked={readConfirmed} onChange={e => setReadConfirmed(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                קראתי את הדוח ואישרתי שכל הנתונים נכונים
              </label>
              {approveError && (
                <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', fontSize: '13px', color: C.statusFailed, marginBottom: '10px' }}>{approveError}</div>
              )}
              {!isGoNogo && !canForceApprove && (
                <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', fontSize: '13px', color: C.statusFailed, marginBottom: '10px', fontWeight: 'bold' }}>
                  🚫 לא ניתן לאשר סיכום — יש {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה שטרם הושלמו
                  {isActiveRun && morningSubPhaseIds.size > 0 && (
                    <div style={{ fontWeight: 'normal', fontSize: '12px', marginTop: '4px', color: C.statusFailed }}>משימות שלב הבוקר אינן נכללות בחישוב</div>
                  )}
                </div>
              )}
              {!isGoNogo && canForceApprove && (
                <div style={{ background: C.bgInProgress, border: `1px solid ${C.statusInProgress}44`, borderRadius: '6px', padding: '10px 14px', fontSize: '13px', color: C.statusInProgress, marginBottom: '12px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>⚠️ עקיפת בדיקת GO — {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה טרם הושלמו</div>
                  <div>בתור {userRole === 'ADMIN' ? 'מנהל מערכת' : 'מנהל לילה'} באפשרותך לאשר את הסיכום למרות זאת.</div>
                </div>
              )}
              <button onClick={approveSummary} disabled={!readConfirmed || approveLoading || !canDownload}
                style={{
                  padding: '10px 24px', fontFamily: FONT,
                  background: (readConfirmed && canDownload) ? (!isGoNogo ? '#e67e22' : C.statusDone) : C.bgHover,
                  color: (readConfirmed && canDownload) ? 'white' : C.textDisabled,
                  border: 'none', borderRadius: '8px',
                  cursor: (readConfirmed && canDownload) ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold', fontSize: '14px',
                }}>
                {approveLoading ? '...' : !isGoNogo && canForceApprove ? '⚠️ אשר סיכום בעקיפת GO' : '✅ אשר סיכום'}
              </button>
            </div>
          )}
        </div>

        {/* ── HTML Report (after approval) — intentionally white for print/email ── */}
        {summaryRecord?.sentAt && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '32px', border: `3px solid ${isRehearsal ? '#f39c12' : C.brand}` }}>
            <div style={{ textAlign: 'center', borderBottom: `2px solid ${isRehearsal ? '#f39c12' : '#1a2332'}`, paddingBottom: '16px', marginBottom: '24px' }}>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: isRehearsal ? '#7d3c00' : '#1a2332' }}>
                {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} (<bdi>{versionName}</bdi>)
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
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', fontWeight: 'bold', color: '#1a2332' }}>{pt.name}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0' }}>
                            <span style={{ background: pt.environment === 'HOT' ? '#fee' : '#e8f4fd', color: pt.environment === 'HOT' ? '#c0392b' : '#2980b9', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{pt.environment}</span>
                          </td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', color: '#333' }}>{pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', color: '#333' }}>{pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—'}</td>
                          <td style={{ padding: '8px 12px', border: '1px solid #e0e8f0', color: '#333' }}>{pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—'}</td>
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
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0', color: '#333' }}>{t.title}</td>
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0', color: '#333' }}>{t.assignedTeam?.name || '—'}</td>
                        <td style={{ padding: '8px 12px', border: '1px solid #f0e0e0', color: '#333' }}>{t.blockedReason || '—'}</td>
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
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', fontWeight: r.subject ? 'bold' : 'normal', color: '#333' }}>{r.subject || '—'}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', maxWidth: '200px', color: '#333' }}>{r.title}</td>
                          <td style={{ padding: '6px 8px', border: '1px solid #dde8f5', color: '#333' }}>{r.responsible}</td>
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
                      <BarChart title="חומרה"          data={severityData.filter(d => d.count > 0)} />
                      <BarChart title="סטטוס"          data={statusData.filter(d => d.count > 0)} />
                      <BarChart title="Responsibility"  data={responsibilityData} />
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
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', fontWeight: 'bold', maxWidth: '140px', color: '#1a2332' }}>{d.title}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', maxWidth: '200px', color: '#555' }}>{d.description}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5' }}>
                                <span style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6', padding: '1px 5px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.severity}</span>
                              </td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.priority}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.assignedTo}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.reporter}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.discoveryDate}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.environment}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5' }}>
                                <span style={{ background: d.status === 'Open' ? '#fee' : d.status === 'Closed' ? '#d5f0dc' : '#f5f5f5', color: d.status === 'Open' ? '#e74c3c' : d.status === 'Closed' ? '#27ae60' : '#888', padding: '1px 5px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.status}</span>
                              </td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.testPhase}</td>
                              <td style={{ padding: '6px 8px', border: '1px solid #ead9f5', whiteSpace: 'nowrap', color: '#333' }}>{d.defectType}</td>
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
              הופק אוטומטית ע"י NightOps Platform
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
