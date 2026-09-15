import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';
import { useDialog } from '../context/DialogContext';
import { Card, Badge, StatCard, ProgressBar, SectionHeader, Alert, TextArea, Button } from './ui';
import { NightStatsDashboard } from './NightStatsDashboard';
import { RehearsalArchivePanel } from './shared/RehearsalArchivePanel';
import { cleanHtmlText } from '../utils/textSanitize';
import { formatDateTime as fmtDateTimeShared, formatTime as fmtTimeShared } from '../utils/dateFormat';
import { DefectIdBadge } from './shared/defectFieldDisplay';

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

const fmtTime     = (iso: string) => iso ? fmtTimeShared(iso) : '—';
const fmtDateTime = (iso: string) => iso ? fmtDateTimeShared(iso) : '';
const fmtMins     = (m: number)   => m >= 60 ? `${Math.floor(m / 60)}ש' ${m % 60}דק'` : `${m}דק'`;

const SIGNIFICANT_MINS = 15;

// ── Simple CSS bar chart ──
const BarChart: React.FC<{ title: string; data: { label: string; count: number; color: string }[] }> = ({ title, data }) => {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="rounded-lg border border-border bg-muted px-4 py-3">
      <div className="mb-2.5 text-sm font-bold text-subtle-foreground">{title}</div>
      {data.map(d => (
        <div key={d.label} className="mb-1.5 flex items-center gap-2">
          <div className="w-[72px] flex-shrink-0 text-end text-[13px] text-subtle-foreground">{d.label}</div>
          <div className="h-5 flex-1 overflow-hidden rounded" style={{ background: C.bgHover }}>
            <div
              className="flex h-full items-center justify-end rounded ps-1.5 transition-[width] duration-300"
              style={{ width: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 0)}%`, background: d.color }}
            >
              {d.count > 0 && <span className="ps-1 text-[13px] font-bold text-white">{d.count}</span>}
            </div>
          </div>
          {d.count === 0 && <span className="text-[13px] text-subtle-foreground">0</span>}
        </div>
      ))}
    </div>
  );
};

function badgeClass(): string {
  return 'rounded-full px-3.5 py-1 font-bold text-[15px] whitespace-nowrap';
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
  const [qcMock,              setQcMock]              = useState(true);
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
  const [activeTab,           setActiveTab]           = useState<'dashboard' | 'summary'>('dashboard');

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
      // Rehearsal report → Dress Rehearsal cycle's own defects/coverage;
      // production report → Go Live's — otherwise both reports show
      // identical, always-Go-Live data regardless of which one this is.
      const cycle = isRehearsal ? 'REHEARSAL' : 'GO_LIVE';
      const [defectsRes, coverageRes, statusRes] = await Promise.all([
        axios.get(`${API}/qc/defects?versionId=${versionId}&cycle=${cycle}`, { headers }),
        axios.get(`${API}/qc/test-coverage?versionId=${versionId}&cycle=${cycle}`, { headers }),
        axios.get(`${API}/qc/status`, { headers }).catch(() => ({ data: { enabled: false } })),
      ]);
      setDefects(defectsRes.data);
      setCoverage(coverageRes.data);
      setQcMock(!statusRes.data?.enabled);
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
          const updateEndpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal` : `${API}/summary/${versionId}`;
          const updated = await axios.patch(updateEndpoint, { headline, morningNotes }, { headers });
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
  // Test coverage table: only show status columns that have at least one
  // non-zero value across all rows, to cut visual noise from all-zero columns.
  const coverageCols = React.useMemo(() => ({
    passed:       coverage.some(r => r.passed > 0),
    failed:       coverage.some(r => r.failed > 0),
    notCompleted: coverage.some(r => r.notCompleted > 0),
    blocked:      coverage.some(r => r.blocked > 0),
    notRun:       coverage.some(r => r.notRun > 0),
  }), [coverage]);
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
  // For rehearsal summaries after the rehearsal ended, tasks are reset to WAITING in the DB.
  // We must use the snapshot tasks (from `tasks` state) to get actual times,
  // cross-referenced to phases via subPhaseId.
  const snapshotBySubPhase = React.useMemo<Map<string, any[]>>(() => {
    const useSnapshot = isRehearsal && version?.status !== 'REHEARSAL';
    if (!useSnapshot) return new Map();
    const m = new Map<string, any[]>();
    for (const t of tasks) {
      if (!t.subPhaseId) continue;
      if (!m.has(t.subPhaseId)) m.set(t.subPhaseId, []);
      m.get(t.subPhaseId)!.push(t);
    }
    return m;
  }, [tasks, isRehearsal, version?.status]);

  const phaseTimelines = React.useMemo(() => {
    if (!version?.phases) return [];
    const useSnapshot = isRehearsal && version?.status !== 'REHEARSAL';
    const sorted = [...version.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    return sorted.map((phase: any) => {
      // When showing a completed rehearsal, substitute live tasks with snapshot tasks per subPhase
      const phTasks: any[] = (phase.subPhases || []).flatMap((s: any) =>
        useSnapshot ? (snapshotBySubPhase.get(s.id) ?? s.tasks ?? []) : (s.tasks || [])
      );
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
  }, [version, snapshotBySubPhase, isRehearsal]);

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
      lines.push(`תאריך: ${fmtDateTimeShared(summaryRecord.sentAt)}`);
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
    lines.push('הופק אוטומטית ע"י DeployCenter');
    return lines.join('\n');
  };

  // Legacy fallback for insecure contexts (plain HTTP by hostname/IP) where
  // navigator.clipboard is entirely undefined. Selects a hidden contentEditable
  // node holding the rich HTML and copies via document.execCommand — still
  // allowed by browsers over HTTP, unlike the async Clipboard API. Falls back
  // further to a plain textarea (text-only) if the rich-selection copy fails.
  const legacyCopyRichText = (html: string, text: string): boolean => {
    const container = document.createElement('div');
    container.contentEditable = 'true';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.innerHTML = html;
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    selection?.removeAllRanges();
    document.body.removeChild(container);
    if (ok) return true;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(textarea);
    return ok;
  };

  const copyToEmail = async () => {
    const html = buildEmailHtml();
    const text = buildEmailText();
    // navigator.clipboard only exists in a "secure context" (HTTPS, or localhost) —
    // on a production server reached over plain HTTP by hostname/IP, the whole
    // Clipboard API is undefined. Fall back to the legacy execCommand('copy')
    // path, which browsers still allow over HTTP.
    if (!navigator.clipboard) {
      if (legacyCopyRichText(html, text)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        dialog.alert(
          'העתקה אוטומטית אינה נתמכת בדפדפן עבור חיבור HTTP. בחר את הטקסט למטה והעתק ידנית (Ctrl+C).',
          'העתקה לא זמינה',
          'warning',
        );
      }
      return;
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        if (!legacyCopyRichText(html, text)) {
          dialog.alert('שגיאה בהעתקה ללוח', 'שגיאה בהעתקה', 'danger');
          return;
        }
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const openInOutlook = () => {
    const titleText = isRehearsal ? 'סיכום חזרה גנרלית' : 'סיכום ליל ההטמעה';
    const subject = `${titleText} — ${versionName}`;
    const body = buildEmailText();
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  if (loading) return (
    <div className="p-10 text-center font-sans text-subtle-foreground">טוען...</div>
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
    const dateStr = fmtDateTimeShared(summaryRecord?.sentAt ? new Date(summaryRecord.sentAt) : new Date());

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
      return `<tr>
        <td style="padding:9px 8px;font-weight:bold;color:#2c3e50;font-size:13px;text-align:right;border-bottom:1px solid #e9ecef;">${pt.name}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;border-bottom:1px solid #e9ecef;">${ltr(pt.environment)}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;border-bottom:1px solid #e9ecef;">${timePair(pt.plannedStart, pt.plannedEnd)}</td>
        <td style="padding:9px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;border-bottom:1px solid #e9ecef;">${timePair(pt.actualStart, pt.actualEnd)}</td>
        <td style="padding:9px 8px;font-size:12px;font-weight:bold;color:${sc};text-align:right;white-space:nowrap;border-bottom:1px solid #e9ecef;">${statusTxt}${reason ? `<br><span style="font-size:11px;color:#6c757d;font-weight:normal;">הערה: ${reason}</span>` : ''}</td>
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
      return `<tr>
        <td style="padding:7px 8px;font-size:12px;color:#2c3e50;text-align:right;max-width:200px;border-bottom:1px solid #e9ecef;">${d.title}</td>
        <td style="padding:7px 8px;font-size:12px;color:#6c757d;text-align:right;white-space:nowrap;border-bottom:1px solid #e9ecef;">${d.assignedTo}</td>
        <td style="padding:7px 8px;text-align:center;white-space:nowrap;border-bottom:1px solid #e9ecef;">
          <span style="background:${sevColor};color:white;padding:1px 8px;border-radius:8px;font-size:11px;font-weight:bold;">${d.severity}</span>
        </td>
        <td style="padding:7px 8px;text-align:center;white-space:nowrap;border-bottom:1px solid #e9ecef;">
          <span style="background:${stColor};color:white;padding:1px 8px;border-radius:8px;font-size:11px;font-weight:bold;">${d.status}</span>
        </td>
        <td style="padding:7px 8px;font-size:11px;color:#6c757d;text-align:right;white-space:nowrap;border-bottom:1px solid #e9ecef;">${d.reporter}</td>
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
      return `<tr>
        <td style="padding:8px;font-size:12px;color:#2c3e50;text-align:right;border-bottom:1px solid #e9ecef;">${cv.title || cv.cycle}</td>
        <td style="padding:8px;font-size:12px;color:#6c757d;text-align:right;border-bottom:1px solid #e9ecef;">${cv.responsible}</td>
        <td style="padding:8px;text-align:center;font-size:12px;font-weight:bold;color:#2c3e50;border-bottom:1px solid #e9ecef;">${cv.total}</td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">
          <span style="background:#27ae60;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.passed}</span>
        </td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">
          <span style="background:#e74c3c;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.failed}</span>
        </td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">
          <span style="background:#e67e22;color:white;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:bold;">${cv.blocked}</span>
        </td>
        <td style="padding:8px;text-align:center;font-size:12px;color:#6c757d;border-bottom:1px solid #e9ecef;">${cv.notRun}</td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #e9ecef;">
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
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border:1px solid #dee2e6;">

  <!-- HEADER -->
  <tr><td bgcolor="#1e3a5f" align="center" style="padding:28px 32px;">
    <p style="margin:0 0 6px;font-size:12px;color:#8ab4d4;font-family:Arial;">DeployCenter</p>
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
    <p style="margin:0;font-size:12px;color:#adb5bd;font-family:Arial;">הופק אוטומטית ע"י DeployCenter</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  };

  const tdBaseClass = 'px-2.5 py-2 border border-border text-[15px] align-middle text-muted-foreground';

  const timelineDelayBadge = (delayMins: number | null) => {
    if (delayMins === null) return <span className={badgeClass()} style={{ background: C.bgHover, color: C.textMuted }}>— ממתין לנתונים</span>;
    if (delayMins <= -SIGNIFICANT_MINS) return <span className={badgeClass()} style={{ background: C.bgDone, color: C.statusDone }}>⏩ לפני הזמן {fmtMins(Math.abs(delayMins))}</span>;
    if (delayMins <= 0)                 return <span className={badgeClass()} style={{ background: C.bgDone, color: C.statusDone }}>✅ כמתוכנן</span>;
    if (delayMins < SIGNIFICANT_MINS)  return <span className={badgeClass()} style={{ background: C.bgInProgress, color: C.statusInProgress }}>⚠️ איחור קל {fmtMins(delayMins)}</span>;
    return <span className={badgeClass()} style={{ background: C.bgBlocked, color: C.statusFailed }}>🚨 חריגה בלוחות הזמנים +{fmtMins(delayMins)}</span>;
  };

  return (
    <div dir="rtl" className="font-sans">
      <h2 className="mb-5 text-xl" style={{ color: isRehearsal ? C.warning : C.textPrimary }}>
        {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} (
        <bdi
          onClick={onGoToHub}
          title={onGoToHub ? 'עבור לדף הנחיתה' : undefined}
          className={onGoToHub ? 'cursor-pointer underline decoration-dotted' : 'cursor-default no-underline'}
        >{versionName}</bdi>)
      </h2>

      {isRehearsal && <RehearsalArchivePanel token={token} versionId={versionId} />}

      {/* ── Tab switcher ── */}
      {!isRehearsal && (
        <div className="mb-4 flex gap-2 border-b border-border pb-2">
          {(['dashboard', 'summary'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`cursor-pointer rounded-t-md border-none px-4 py-2 font-sans text-sm transition-[background,color] duration-150 ease-out ${activeTab === tab ? 'bg-primary font-semibold text-white' : 'bg-transparent font-normal text-subtle-foreground'}`}
            >
              {tab === 'dashboard' ? 'דשבורד' : 'סיכום מפורט'}
            </button>
          ))}
        </div>
      )}

      {!isRehearsal && activeTab === 'dashboard' && (
        <NightStatsDashboard token={token} versionId={versionId} versionName={versionName} />
      )}

      {(isRehearsal || activeTab === 'summary') && <>

      {/* ── Rollback required warning ── */}
      {(() => {
        const rollbackSet = new Set(failureReasonsList.filter(r => r.requiresRollback).map(r => r.reason));
        const rollbackTasks = tasks.filter(t => t.status === 'FAILED' && t.failedReason && rollbackSet.has(t.failedReason));
        if (rollbackTasks.length === 0) return null;
        return (
          <div className="mb-4 rounded-xl px-5 py-3.5" style={{ background: C.nogoBg, border: `2px solid ${C.nogoBorder}` }}>
            <div className="mb-2 text-base font-bold" style={{ color: C.nogoText }}>🔴 נדרש Rollback לגרסה!</div>
            <div className="flex flex-col gap-1.5">
              {rollbackTasks.map(t => (
                <div key={t.id} className="text-[15px] text-muted-foreground">
                  ✗ <strong className="text-foreground">{t.title}</strong> — {t.failedReason}
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-sm font-bold" style={{ color: C.nogoText }}>
              לא ניתן לאשר סיכום עד לביצוע Rollback. פנה למנהל הלילה.
            </div>
          </div>
        );
      })()}

      {/* ── GO/NO GO Banner ── */}
      <div
        className="relative mb-5 flex items-center justify-between gap-4 overflow-hidden rounded-2xl px-6 py-5"
        style={{
          background: effectiveGo ? C.goBg : C.nogoBg,
          border: `2px solid ${effectiveGo ? C.goBorder : C.nogoBorder}`,
          boxShadow: effectiveGo
            ? `0 4px 20px rgba(55,196,122,0.15)`
            : `0 4px 20px rgba(240,106,106,0.15)`,
        }}
      >
        {/* Background pulse */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: effectiveGo
              ? 'radial-gradient(ellipse at 80% 50%, rgba(86,211,100,0.06), transparent)'
              : 'radial-gradient(ellipse at 80% 50%, rgba(248,81,73,0.06), transparent)',
          }}
        />

        <div className="relative flex-1">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-2xl">{effectiveGo ? '✅' : '🛑'}</span>
            <span className="text-xl font-bold" style={{ color: effectiveGo ? C.goText : C.nogoText }}>
              {effectiveGo
                ? (isGoNogo ? 'GO — ניתן להוציא סיכום' : 'GO — הגרסה עברה בהצלחה')
                : 'NO GO — לא ניתן להוציא סיכום'}
            </span>
          </div>
          {!isGoNogo && (
            <div className="flex flex-wrap gap-2">
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
        <div className="relative flex flex-shrink-0 flex-col items-center gap-1">
          <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
            <circle cx="36" cy="36" r="30" fill="none" stroke={effectiveGo ? `${C.success}22` : `${C.danger}22`} strokeWidth="5"/>
            <circle cx="36" cy="36" r="30" fill="none"
              stroke={effectiveGo ? C.success : C.danger}
              strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 30}`}
              strokeDashoffset={`${2 * Math.PI * 30 * (1 - progressPercent / 100)}`}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
            <text x="36" y="36" textAnchor="middle" dominantBaseline="central"
              style={{ transform: 'rotate(90deg) translateY(-72px)' }}
              fill={effectiveGo ? C.success : C.danger}
              fontSize="16" fontWeight="700" className="font-sans">
              {progressPercent}%
            </text>
          </svg>
          <span className="text-xs text-subtle-foreground">הושלם</span>
        </div>
      </div>

      {/* ── KPI Stats ── */}
      <div className="mb-5 grid grid-cols-5 gap-3">
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

      <div className="flex flex-col gap-4">

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
            dir="rtl"
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-muted px-3 py-3 font-sans text-base text-foreground outline-none transition-colors duration-fast ease-out focus:border-primary"
            style={{ boxSizing: 'border-box' }}
          />
        </Card>

        {/* ── Timeline ── */}
        {phaseTimelines.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[17px] font-bold text-foreground">⏱ לוחות זמנים</h3>
            <div className="flex flex-col gap-3">
              {phaseTimelines.map((pt, idx) => {
                const isLate  = pt.delayMins !== null && pt.delayMins >= SIGNIFICANT_MINS;
                const isEarly = pt.delayMins !== null && pt.delayMins <= -SIGNIFICANT_MINS;
                const isOk    = pt.delayMins !== null && pt.delayMins <= 0;
                const borderColor = isLate ? C.statusFailed : (isEarly || isOk) ? C.statusDone : C.border;
                const bgColor     = isLate ? C.bgBlocked : (isEarly || isOk) ? C.bgDone : C.bgNested;
                const envColor    = pt.environment === 'HOT' ? C.statusFailed : C.statusOpen;
                const envBg       = pt.environment === 'HOT' ? 'rgba(248,81,73,0.15)' : 'rgba(88,166,255,0.15)';
                return (
                  <div key={idx} className="rounded-xl px-5 py-4 shadow-sm" style={{ border: `2px solid ${borderColor}`, background: bgColor }}>
                    {/* Header row */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="rounded-xl px-3 py-1 text-sm font-bold" style={{ background: envBg, color: envColor, border: `1px solid ${envColor}33` }}>{pt.environment}</span>
                        <span className="text-base font-bold text-foreground">{pt.name}</span>
                        <span className="rounded-lg bg-muted px-2 py-0.5 text-sm text-subtle-foreground">{pt.doneTasks}/{pt.totalTasks} משימות</span>
                      </div>
                      {timelineDelayBadge(pt.delayMins)}
                    </div>
                    {/* Timing grid */}
                    <div className="mb-3 grid grid-cols-4 gap-2">
                      {[
                        { label: 'התחלה מתוכננת', value: pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—', color: C.textSecondary },
                        { label: 'סיום מתוכנן',   value: pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—', color: C.statusInProgress },
                        { label: 'התחלה בפועל',   value: pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—', color: C.statusOpen },
                        { label: 'סיום בפועל',    value: pt.actualEnd    ? fmtTime(pt.actualEnd.toISOString())    : '—', color: isLate ? C.statusFailed : C.statusDone },
                      ].map(f => (
                        <div key={f.label} className="rounded-lg border border-border bg-white px-3 py-2">
                          <div className="mb-1 text-[13px] font-medium text-subtle-foreground">{f.label}</div>
                          <div className="text-base font-bold tracking-wide" style={{ color: f.color }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Delay reason */}
                    <div className="flex items-start gap-2">
                      <label className={`flex-shrink-0 pt-2 text-sm ${isLate ? 'font-semibold' : 'font-normal'}`} style={{ color: isLate ? C.statusFailed : C.textMuted }}>
                        {isLate ? '⚠️ סיבת חריגה *' : 'סיבת חריגה / הערה'}
                      </label>
                      <textarea
                        value={phaseDelayReasons[idx] || ''}
                        onChange={e => setPhaseDelayReasons(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder={isLate ? 'חובה — הסבר מדוע חרגו מלוחות הזמנים' : 'אופציונלי'}
                        dir="rtl"
                        rows={2}
                        className="flex-1 resize-y rounded-md px-2.5 py-1.5 font-sans text-[15px] text-foreground outline-none"
                        style={{
                          border: `1px solid ${isLate && !(phaseDelayReasons[idx] || '').trim() ? C.statusFailed : C.border}`,
                          background: C.bgNested,
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
          <div className="rounded-xl bg-card p-5" style={{ border: `2px solid ${C.statusFailed}` }}>
            <h3 className="mb-3 text-base" style={{ color: C.statusFailed }}>תקלות ({blockedTasks.length})</h3>
            {blockedTasks.map(task => (
              <div key={task.id} className="mb-2 rounded-lg bg-danger/10 p-3" style={{ border: `1px solid ${C.statusFailed}33` }}>
                <div className="text-[15px] font-bold" style={{ color: C.statusFailed }}>{task.title}</div>
                <div className="mt-1 text-sm text-subtle-foreground">
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Test Coverage (QC) ── */}
        {(
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[17px] font-bold text-foreground">🧪 תכולת בדיקות (QC Test Coverage)</h3>
              {qcMock && (
                <span className="rounded-xl bg-warning/10 px-2.5 py-1 text-[13px] text-warning" style={{ border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
              )}
            </div>
            {qcLoading ? (
              <div className="p-4 text-center text-subtle-foreground">טוען נתוני QC...</div>
            ) : coverage.length === 0 ? (
              <div className="rounded-lg bg-muted p-4 text-center text-subtle-foreground">אין נתוני בדיקות</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#E6E7F5]">
                      {[
                        '#', 'פרויקט/רגרסיה/באג', 'כותרת / CR', 'אחראי',
                        ...(coverageCols.passed ? ['Passed'] : []),
                        ...(coverageCols.failed ? ['Failed'] : []),
                        ...(coverageCols.notCompleted ? ['Not Completed'] : []),
                        ...(coverageCols.blocked ? ['Blocked'] : []),
                        ...(coverageCols.notRun ? ['Not Run'] : []),
                        'הערות',
                      ].map(h => (
                        <th key={h} className="whitespace-nowrap border border-border px-2.5 py-2.5 text-end text-sm font-semibold text-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : C.bgNested }}>
                        <td className={`${tdBaseClass} w-7 text-center text-subtle-foreground`}>{i + 1}</td>
                        <td className={`${tdBaseClass} whitespace-nowrap ${r.subject ? 'font-bold text-foreground' : 'font-normal text-subtle-foreground'}`}>{r.subject || '—'}</td>
                        <td className={`${tdBaseClass} max-w-[240px]`}>{r.title}</td>
                        <td className={`${tdBaseClass} whitespace-nowrap`}>{r.responsible}</td>
                        {coverageCols.passed && <td className={`${tdBaseClass} text-center text-success ${r.passed > 0 ? 'font-bold' : 'font-normal'}`}>{r.passed}</td>}
                        {coverageCols.failed && <td className={`${tdBaseClass} text-center ${r.failed > 0 ? 'font-bold text-danger' : 'font-normal text-subtle-foreground'}`}>{r.failed}</td>}
                        {coverageCols.notCompleted && <td className={`${tdBaseClass} text-center`} style={{ color: r.notCompleted > 0 ? C.statusInProgress : C.textMuted }}>{r.notCompleted}</td>}
                        {coverageCols.blocked && <td className={`${tdBaseClass} text-center ${r.blocked > 0 ? 'text-danger' : 'text-subtle-foreground'}`}>{r.blocked}</td>}
                        {coverageCols.notRun && <td className={`${tdBaseClass} text-center`}>{r.notRun}</td>}
                        <td className={`${tdBaseClass} min-w-[120px]`}>
                          <textarea
                            value={coverageRemarks[i] || ''}
                            onChange={e => setCoverageRemarks(prev => ({ ...prev, [i]: e.target.value }))}
                            placeholder="הערות..."
                            dir="rtl"
                            rows={2}
                            className="w-full resize-y rounded border border-border bg-muted p-1 font-sans text-[13px] text-foreground"
                            style={{ boxSizing: 'border-box' }}
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
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base text-foreground">🪲 תקלות שדווחו (QC)</h3>
              {qcMock ? (
                <span className="rounded-xl bg-warning/10 px-2.5 py-1 text-[13px] text-warning" style={{ border: `1px solid ${C.statusInProgress}44` }}>Mock — ממתין לחיבור QC</span>
              ) : (
                <span className="rounded-xl bg-success/10 px-2.5 py-1 text-[13px] text-success" style={{ border: `1px solid ${C.statusDone}44` }}>מחובר ל-QC ✅</span>
              )}
            </div>
            {qcLoading ? (
              <div className="p-4 text-center text-subtle-foreground">טוען נתוני QC...</div>
            ) : defects.length === 0 ? (
              <div className="rounded-lg bg-success/10 p-5 text-center text-[15px] font-bold text-success" style={{ border: `1px solid ${C.statusDone}44` }}>
                ✅ לא דווחו תקלות במהלך הפעילות
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <BarChart title="התפלגות לפי חומרה"       data={severityData.filter(d => d.count > 0)} />
                  <BarChart title="התפלגות לפי סטטוס"       data={statusData.filter(d => d.count > 0)} />
                  <BarChart title="התפלגות לפי Responsibility" data={responsibilityData} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-muted">
                        {['ID', 'כותרת התקלה', 'תיאור', 'חומרה', 'עדיפות', 'צוות אחראי', 'דווח ע"י', 'תאריך גילוי', 'סביבה', 'סטטוס', 'שלב בדיקה', 'סוג תקלה', 'הערות', 'מלל חופשי'].map(h => (
                          <th key={h} className="whitespace-nowrap border border-border px-2 py-1.5 text-end text-[13px] font-bold text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defects.map((d, i) => (
                        <tr key={d.id} style={{ background: i % 2 === 0 ? 'transparent' : C.bgNested }}>
                          <td className={`${tdBaseClass} whitespace-nowrap text-center`}><DefectIdBadge id={d.id} /></td>
                          <td className={`${tdBaseClass} max-w-[160px] font-bold text-foreground`}>{d.title}</td>
                          <td className={`${tdBaseClass} max-w-[220px]`}>{cleanHtmlText(d.description)}</td>
                          <td className={tdBaseClass}>
                            <span className="whitespace-nowrap rounded-lg px-1.5 py-px text-[13px] font-bold" style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6' }}>{d.severity}</span>
                          </td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.priority}</td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.assignedTo}</td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.reporter}</td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.discoveryDate}</td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.environment}</td>
                          <td className={tdBaseClass}>
                            <span
                              className="whitespace-nowrap rounded-lg px-2 py-px text-[13px] font-bold"
                              style={{
                                background: d.status === 'Open' ? C.bgBlocked : d.status === 'Closed' ? C.bgDone : C.bgHover,
                                color: d.status === 'Open' ? C.statusFailed : d.status === 'Closed' ? C.statusDone : C.textMuted,
                              }}
                            >{d.status}</span>
                          </td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.testPhase}</td>
                          <td className={`${tdBaseClass} whitespace-nowrap`}>{d.defectType}</td>
                          <td className={`${tdBaseClass} max-w-[160px]`}>{cleanHtmlText(d.notes)}</td>
                          <td className={`${tdBaseClass} min-w-[120px]`}>
                            <textarea
                              value={defectRemarks[d.id] || ''}
                              onChange={e => setDefectRemarks(prev => ({ ...prev, [d.id]: e.target.value }))}
                              placeholder="מלל חופשי..."
                              dir="rtl"
                              rows={2}
                              className="w-full resize-y rounded border border-border bg-muted p-1 font-sans text-[13px] text-foreground"
                              style={{ boxSizing: 'border-box' }}
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
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base text-foreground">הערות לצוות הבוקר</h3>
          <textarea value={morningNotes} onChange={e => setMorningNotes(e.target.value)}
            placeholder="פריטים שדורשים מעקב בוקר..."
            dir="rtl"
            rows={3}
            className="w-full resize-y rounded-lg border border-border bg-muted px-2.5 py-2.5 font-sans text-[15px] text-foreground outline-none"
            style={{ boxSizing: 'border-box' }}
          />
        </div>

        {/* ── משימות נכשלות — אישור דילוג (מנהל בלבד) ── */}
        {canForceApprove && failedNightTasks.length > 0 && !summaryRecord?.sentAt && (
          <div className="rounded-xl bg-card p-5" style={{ border: `2px solid ${C.statusFailed}` }}>
            <h3 className="mb-3 text-base" style={{ color: C.statusFailed }}>⚠️ משימות נכשלות ({failedNightTasks.length})</h3>
            <p className="mb-3 text-[15px] text-subtle-foreground">
              סמן משימות שנכשלו כ"מאושר לדילוג" כדי לאפשר הפקת סיכום מבלי לעקוף GO/NO GO.
            </p>
            <div className="flex flex-col gap-1.5">
              {failedNightTasks.map(t => (
                <div
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                  style={{
                    background: t.goNoGoWaived ? C.bgDone : C.bgBlocked,
                    border: `1px solid ${t.goNoGoWaived ? C.statusDone + '44' : C.statusFailed + '44'}`,
                  }}
                >
                  <span className={`flex-1 text-[15px] ${t.goNoGoWaived ? 'font-normal' : 'font-bold'}`} style={{ color: t.goNoGoWaived ? C.statusDone : C.statusFailed }}>
                    {t.goNoGoWaived ? '✓ ' : '✗ '}{t.title}
                  </span>
                  {t.assignedTeam?.name && <span className="text-[13px] text-subtle-foreground">{t.assignedTeam.name}</span>}
                  <button
                    onClick={() => waiveTask(t.id)}
                    className="cursor-pointer whitespace-nowrap rounded-md border-none px-3 py-1 text-sm font-bold"
                    style={{ background: t.goNoGoWaived ? C.bgHover : '#e67e22', color: t.goNoGoWaived ? C.textMuted : 'white' }}
                  >
                    {t.goNoGoWaived ? 'בטל אישור' : '✓ אשר דילוג'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── אישור סיכום ── */}
        <div
          className="rounded-xl p-5"
          style={{
            background: summaryRecord?.sentAt ? C.bgDone : C.bgCard,
            border: `2px solid ${summaryRecord?.sentAt ? C.statusDone : '#e67e22'}`,
          }}
        >
          {summaryRecord?.sentAt ? (
            <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <div className="text-base font-bold" style={{ color: C.statusDone }}>הסיכום אושר ונשמר במערכת</div>
                  <div className="mt-0.5 text-[15px] text-subtle-foreground">
                    {fmtDateTimeShared(summaryRecord.sentAt)}
                  </div>
                  {summaryRecord.forceApprovedBy && (
                    <div className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: C.statusInProgress }}>
                      <span>⚠️</span>
                      <span>
                        אושר בעקיפת GO על-ידי {summaryRecord.forceApprovedBy}
                        {summaryRecord.forceApprovedAt && ` ב-${fmtDateTimeShared(summaryRecord.forceApprovedAt)}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {canForceApprove && !editingApproved && (
                  <button
                    onClick={() => { setHeadline(summaryRecord?.headline || ''); setMorningNotes(summaryRecord?.morningNotes || ''); setEditingApproved(true); }}
                    className="cursor-pointer rounded-lg border border-border bg-muted px-[18px] py-2.5 font-sans text-[15px] font-bold text-muted-foreground"
                  >
                    ✏️ ערוך דוח
                  </button>
                )}
                <button
                  onClick={copyToEmail}
                  className="cursor-pointer rounded-lg border-none px-6 py-2.5 font-sans text-[15px] font-bold text-white transition-colors duration-200"
                  style={{ background: copied ? C.statusDone : C.statusWaiting }}
                >
                  {copied ? '✓ הועתק!' : '📋 העתק לאימייל'}
                </button>
                <button
                  onClick={openInOutlook}
                  className="cursor-pointer rounded-lg border border-border bg-muted px-6 py-2.5 font-sans text-[15px] font-bold text-muted-foreground"
                >
                  📧 פתח Outlook
                </button>
                <button
                  onClick={emailEnabled ? sendEmail : () => dialog.alert('שירות המייל אינו מופעל — הגדר SMTP בפאנל הניהול', 'שירות מייל מושבת', 'warning')}
                  disabled={emailSending}
                  className={`rounded-lg border-none px-6 py-2.5 font-sans text-[15px] font-bold text-white transition-colors duration-200 ${emailSending ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{
                    background: emailSending ? C.textDisabled : emailStatus === 'ok' ? C.statusDone : emailStatus === 'err' ? C.statusFailed : emailEnabled ? C.brand : C.bgHover,
                  }}
                >
                  {emailSending ? '⏳ שולח...' : emailStatus === 'ok' ? '✓ נשלח!' : emailStatus === 'err' ? '✗ שגיאה' : '📧 שלח במייל לרשימת תפוצה'}
                </button>
                {emailStatus === 'err' && emailError && (
                  <div className="mt-1 text-sm" style={{ color: C.statusFailed }}>{emailError}</div>
                )}
              </div>
            </div>

            {/* ── עריכת דוח לאחר אישור (מנהל לילה בלבד) ── */}
            {editingApproved && canForceApprove && (
              <div className="mt-4 flex flex-col gap-2.5 border-t border-border pt-4">
                <div className="text-[15px] font-bold" style={{ color: C.statusInProgress }}>✏️ עריכת תוכן הדוח</div>
                <div>
                  <label className="mb-1 block text-sm text-subtle-foreground">עיקרי הדברים</label>
                  <textarea
                    value={headline}
                    onChange={e => setHeadline(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-muted px-2 py-2 font-sans text-[15px] text-foreground"
                    style={{ boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-subtle-foreground">לתשומת לב צוות הבוקר</label>
                  <textarea
                    value={morningNotes}
                    onChange={e => setMorningNotes(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-muted px-2 py-2 font-sans text-[15px] text-foreground"
                    style={{ boxSizing: 'border-box' }}
                  />
                </div>
                <div className="flex gap-2">
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
                        const updateEndpoint = isRehearsal ? `${API}/summary/${versionId}/rehearsal` : `${API}/summary/${versionId}`;
                        const res = await axios.patch(updateEndpoint, {
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
                    className={`rounded-lg border-none px-5 py-2 text-[15px] font-bold text-white ${savingEdit ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    style={{ background: savingEdit ? C.textDisabled : C.statusDone }}
                  >
                    {savingEdit ? 'שומר...' : '✓ שמור שינויים'}
                  </button>
                  <button
                    onClick={() => setEditingApproved(false)}
                    className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 text-[15px] text-muted-foreground"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}
            </>
          ) : (
            <div>
              <h3 className="mb-3 text-base" style={{ color: '#e67e22' }}>
                {isRehearsal ? '⚠️ אישור סיכום החזרה הגנרלית' : '⚠️ אישור סיכום — נדרש לסיום הלילה'}
              </h3>
              <p className="mb-4 text-[15px] text-subtle-foreground">
                {isRehearsal ? 'אישור הסיכום ישמור אותו במערכת ויאפס את תוכנית העבודה לקראת ליל ההטמעה.' : 'לפני אישור הסיכום — קרא את הדוח בעיון ווודא שכל הנתונים מדויקים.'}
              </p>
              <label className="mb-3.5 flex cursor-pointer items-center gap-2.5 text-[15px] text-muted-foreground">
                <input type="checkbox" checked={readConfirmed} onChange={e => setReadConfirmed(e.target.checked)} className="h-[18px] w-[18px] cursor-pointer" />
                קראתי את הדוח ואישרתי שכל הנתונים נכונים
              </label>
              {approveError && (
                <div className="mb-2.5 rounded-md bg-danger/10 px-3 py-2 text-[15px] text-danger" style={{ border: `1px solid ${C.statusFailed}44` }}>{approveError}</div>
              )}
              {!isGoNogo && !canForceApprove && (
                <div className="mb-2.5 rounded-md bg-danger/10 px-3 py-2 text-[15px] font-bold text-danger" style={{ border: `1px solid ${C.statusFailed}44` }}>
                  🚫 לא ניתן לאשר סיכום — יש {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה שטרם הושלמו
                  {isActiveRun && morningSubPhaseIds.size > 0 && (
                    <div className="mt-1 text-sm font-normal text-danger">משימות שלב הבוקר אינן נכללות בחישוב</div>
                  )}
                </div>
              )}
              {!isGoNogo && canForceApprove && (
                <div className="mb-3 rounded-md bg-warning/10 px-3.5 py-2.5 text-[15px] text-warning" style={{ border: `1px solid ${C.statusInProgress}44` }}>
                  <div className="mb-1 font-bold">⚠️ עקיפת בדיקת GO — {goNogoWaiting + goNogoInc + goNogoBlocked} משימות לילה טרם הושלמו</div>
                  <div>בתור {userRole === 'ADMIN' ? 'מנהל מערכת' : 'מנהל לילה'} באפשרותך לאשר את הסיכום למרות זאת.</div>
                </div>
              )}
              <button
                onClick={approveSummary}
                disabled={!readConfirmed || approveLoading || !canDownload}
                className={`rounded-lg border-none px-6 py-2.5 font-sans text-[15px] font-bold ${(readConfirmed && canDownload) ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                style={{
                  background: (readConfirmed && canDownload) ? (!isGoNogo ? '#e67e22' : C.statusDone) : C.bgHover,
                  color: (readConfirmed && canDownload) ? 'white' : C.textDisabled,
                }}
              >
                {approveLoading ? '...' : !isGoNogo && canForceApprove ? '⚠️ אשר סיכום בעקיפת GO' : '✅ אשר סיכום'}
              </button>
            </div>
          )}
        </div>

        {/* ── HTML Report (after approval) — intentionally white for print/email,
            with fixed literal colors matching buildEmailHtml's own palette
            exactly (not app theme tokens): this block is a live preview of
            what actually gets emailed, so it must render identically
            regardless of the viewer's app theme. ── */}
        {summaryRecord?.sentAt && (
          <div className="rounded-xl bg-white p-8" style={{ border: `3px solid ${isRehearsal ? '#7c3aed' : C.brand}` }}>
            <div className="mb-6 pb-4 text-center" style={{ borderBottom: `2px solid ${isRehearsal ? '#7c3aed' : '#1a2332'}` }}>
              <div className="text-[28px] font-bold" style={{ color: isRehearsal ? '#4c1d95' : '#1a2332' }}>
                {isRehearsal ? '🎭 סיכום חזרה גנרלית' : '🌙 סיכום ליל ההטמעה'} (<bdi>{versionName}</bdi>)
              </div>
              {isRehearsal && <div className="mt-1.5 text-[15px] font-bold" style={{ color: '#c0392b' }}>⚠ מסמך זה הופק מחזרה גנרלית ואינו משקף לילה אמיתי</div>}
              <div className="mt-1.5 text-[15px]" style={{ color: '#888' }}>
                הופק: {fmtDateTimeShared(summaryRecord.sentAt)}
              </div>
            </div>

            {/* GO/NO GO */}
            <div className="mb-5 rounded-lg px-5 py-3" style={{ background: effectiveGo ? '#d5f0dc' : '#fee', border: `1px solid ${effectiveGo ? '#27ae60' : '#e74c3c'}` }}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold" style={{ color: effectiveGo ? '#27ae60' : '#e74c3c' }}>
                  {effectiveGo ? '✅ GO — הגרסה עברה בהצלחה' : '❌ NO GO'}
                </span>
                <span className="text-[17px]" style={{ color: '#333' }}>הושלמו <strong>{doneTasks.length}</strong> מתוך <strong>{tasks.length}</strong> משימות ({progressPercent}%)</span>
              </div>
              {effectiveGo && !isGoNogo && waitingTasks.length > 0 && (
                <div className="mt-1.5 text-[15px]" style={{ color: '#1e8449' }}>
                  המשך בפעילויות הבוקר שלאחר הגרסה — נותרו {waitingTasks.length} משימות לביצוע
                </div>
              )}
            </div>

            {/* Headline */}
            {(autoHeadline || summaryRecord.headline || headline) && (
              <div className="mb-5">
                <h3 className="mb-2 ps-2.5 text-[17px]" style={{ color: '#1a2332', borderInlineStart: '4px solid #1a2332' }}>עיקרי הדברים</h3>
                {autoHeadline && <div className="mb-2 rounded-md px-3 py-2 text-[15px] font-bold" style={{ background: '#d5f0dc', border: '1px solid #a9dfbf', color: '#1e8449' }}>✅ {autoHeadline}</div>}
                {(summaryRecord.headline || headline) && <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: '#333' }}>{summaryRecord.headline || headline}</p>}
              </div>
            )}

            {/* Timeline in report */}
            {phaseTimelines.length > 0 && (
              <div className="mb-5">
                <h3 className="mb-3 ps-2.5 text-[17px]" style={{ color: '#1a2332', borderInlineStart: '4px solid #2980b9' }}>⏱ לוחות זמנים</h3>
                <table className="w-full border-collapse text-[15px]">
                  <thead>
                    <tr style={{ background: '#eaf0fb' }}>
                      {['שלב', 'סביבה', 'התחלה מתוכננת', 'סיום מתוכנן', 'התחלה בפועל', 'סיום בפועל', 'סטטוס', 'סיבת חריגה / הערה'].map(h => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-end font-bold" style={{ color: '#2d4a7a', border: '1px solid #c8d8f0' }}>{h}</th>
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
                          <td className="px-3 py-2 font-bold" style={{ border: '1px solid #e0e8f0', color: '#1a2332' }}>{pt.name}</td>
                          <td className="px-3 py-2" style={{ border: '1px solid #e0e8f0' }}>
                            <span className="rounded text-[13px] font-bold" style={{ background: pt.environment === 'HOT' ? '#fee' : '#e8f4fd', color: pt.environment === 'HOT' ? '#c0392b' : '#2980b9', padding: '1px 6px' }}>{pt.environment}</span>
                          </td>
                          <td className="px-3 py-2" style={{ border: '1px solid #e0e8f0', color: '#333' }}>{pt.plannedStart ? fmtTime(pt.plannedStart.toISOString()) : '—'}</td>
                          <td className="px-3 py-2" style={{ border: '1px solid #e0e8f0', color: '#333' }}>{pt.plannedEnd   ? fmtTime(pt.plannedEnd.toISOString())   : '—'}</td>
                          <td className="px-3 py-2" style={{ border: '1px solid #e0e8f0', color: '#333' }}>{pt.actualStart  ? fmtTime(pt.actualStart.toISOString())  : '—'}</td>
                          <td className="px-3 py-2 font-bold" style={{ border: '1px solid #e0e8f0', color: isOk && !isLate ? '#27ae60' : isLate ? '#c0392b' : '#333' }}>{pt.actualEnd ? fmtTime(pt.actualEnd.toISOString()) : '—'}</td>
                          <td className="px-3 py-2" style={{ border: '1px solid #e0e8f0' }}>
                            <span className="whitespace-nowrap rounded-lg px-2 py-0.5 text-sm font-bold" style={{ background: isEarly ? '#e8f8f0' : isOk ? '#d5f0dc' : isLate ? '#fde8d0' : '#f0f0f0', color: isEarly ? '#1e8449' : isOk ? '#1e8449' : isLate ? '#c0392b' : '#666' }}>
                              {pt.delayMins === null ? '—' : isEarly ? `⏩ לפני הזמן ${fmtMins(Math.abs(pt.delayMins))}` : !isLate ? '✅ כמתוכנן' : `🚨 חריגה +${fmtMins(pt.delayMins)}`}
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-sm ${phaseDelayReasons[i] ? 'not-italic' : 'italic'}`} style={{ border: '1px solid #e0e8f0', color: phaseDelayReasons[i] ? '#333' : '#bbb' }}>
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
              <div className="mb-5">
                <h3 className="mb-2.5 ps-2.5 text-[17px]" style={{ color: '#e74c3c', borderInlineStart: '4px solid #e74c3c' }}>תקלות ({blockedTasks.length})</h3>
                <table className="w-full border-collapse text-[15px]">
                  <thead>
                    <tr style={{ background: '#fee' }}>
                      {['משימה', 'צוות', 'סיבה'].map(h => (
                        <th key={h} className="px-3 py-2 text-end font-bold" style={{ color: '#c0392b', border: '1px solid #f5b7b1' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {blockedTasks.map((t, i) => (
                      <tr key={t.id} style={{ background: i % 2 === 0 ? 'white' : '#fff9f9' }}>
                        <td className="px-3 py-2" style={{ border: '1px solid #f0e0e0', color: '#333' }}>{t.title}</td>
                        <td className="px-3 py-2" style={{ border: '1px solid #f0e0e0', color: '#333' }}>{t.assignedTeam?.name || '—'}</td>
                        <td className="px-3 py-2" style={{ border: '1px solid #f0e0e0', color: '#333' }}>{t.blockedReason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Test Coverage in report */}
            {coverage.length > 0 && (
              <div className="mb-5">
                <h3 className="mb-2.5 ps-2.5 text-[17px]" style={{ color: '#1a2332', borderInlineStart: '4px solid #2980b9' }}>
                  🧪 תכולת בדיקות (QC)
                  {qcMock && <span className="me-2 text-[13px] font-normal" style={{ color: '#e67e22' }}>נתוני Mock</span>}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr style={{ background: '#f0f7ff' }}>
                        {[
                          '#', 'פרויקט/רגרסיה/באג', 'כותרת / CR', 'אחראי',
                          ...(coverageCols.passed ? ['Passed'] : []),
                          ...(coverageCols.failed ? ['Failed'] : []),
                          ...(coverageCols.notCompleted ? ['Not Completed'] : []),
                          ...(coverageCols.blocked ? ['Blocked'] : []),
                          ...(coverageCols.notRun ? ['Not Run'] : []),
                          'הערות',
                        ].map(h => (
                          <th key={h} className="whitespace-nowrap px-2 py-1.5 text-end font-bold" style={{ color: '#2d4a7a', border: '1px solid #c8d8f0' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fbff' }}>
                          <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: '#888' }}>{i + 1}</td>
                          <td className="px-2 py-1.5" style={{ border: '1px solid #dde8f5', fontWeight: r.subject ? 'bold' : 'normal', color: '#333' }}>{r.subject || '—'}</td>
                          <td className="max-w-[200px] px-2 py-1.5" style={{ border: '1px solid #dde8f5', color: '#333' }}>{r.title}</td>
                          <td className="px-2 py-1.5" style={{ border: '1px solid #dde8f5', color: '#333' }}>{r.responsible}</td>
                          {coverageCols.passed && <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: '#27ae60', fontWeight: r.passed > 0 ? 'bold' : 'normal' }}>{r.passed}</td>}
                          {coverageCols.failed && <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: r.failed > 0 ? '#e74c3c' : '#aaa' }}>{r.failed}</td>}
                          {coverageCols.notCompleted && <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: r.notCompleted > 0 ? '#e67e22' : '#aaa' }}>{r.notCompleted}</td>}
                          {coverageCols.blocked && <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: r.blocked > 0 ? '#c0392b' : '#aaa' }}>{r.blocked}</td>}
                          {coverageCols.notRun && <td className="px-2 py-1.5 text-center" style={{ border: '1px solid #dde8f5', color: '#95a5a6' }}>{r.notRun}</td>}
                          <td className="px-2 py-1.5" style={{ border: '1px solid #dde8f5', color: '#555' }}>{coverageRemarks[i] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Defects in report */}
            {(
              <div className="mb-5">
                <h3 className="mb-3 ps-2.5 text-[17px]" style={{ color: '#1a2332', borderInlineStart: '4px solid #9b59b6' }}>
                  🪲 תקלות שדווחו (QC)
                  {qcMock && <span className="me-2 text-[13px] font-normal" style={{ color: '#e67e22' }}>נתוני Mock</span>}
                </h3>
                {defects.length === 0 ? (
                  <div className="rounded-md p-3 font-bold" style={{ background: '#f0fff4', color: '#27ae60' }}>✅ לא דווחו תקלות</div>
                ) : (
                  <>
                    <div className="mb-3.5 grid grid-cols-3 gap-2.5">
                      <BarChart title="חומרה"          data={severityData.filter(d => d.count > 0)} />
                      <BarChart title="סטטוס"          data={statusData.filter(d => d.count > 0)} />
                      <BarChart title="Responsibility"  data={responsibilityData} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[13px]">
                        <thead>
                          <tr style={{ background: '#f3e8ff' }}>
                            {['ID', 'כותרת התקלה', 'תיאור', 'חומרה', 'עדיפות', 'צוות אחראי', 'דווח ע"י', 'תאריך גילוי', 'סביבה', 'סטטוס', 'שלב בדיקה', 'סוג תקלה', 'הערות', 'מלל חופשי'].map(h => (
                              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-end font-bold" style={{ color: '#6c3483', border: '1px solid #d7bff5' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {defects.map((d, i) => (
                            <tr key={d.id} style={{ background: i % 2 === 0 ? 'white' : '#fdf5ff' }}>
                              <td className="whitespace-nowrap px-2 py-1.5 text-center" style={{ border: '1px solid #ead9f5' }}><DefectIdBadge id={d.id} /></td>
                              <td className="max-w-[140px] px-2 py-1.5 font-bold" style={{ border: '1px solid #ead9f5', color: '#1a2332' }}>{d.title}</td>
                              <td className="max-w-[200px] px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#555' }}>{cleanHtmlText(d.description)}</td>
                              <td className="px-2 py-1.5" style={{ border: '1px solid #ead9f5' }}>
                                <span className="whitespace-nowrap rounded font-bold" style={{ background: (SEVERITY_COLORS[d.severity] || '#95a5a6') + '22', color: SEVERITY_COLORS[d.severity] || '#95a5a6', padding: '1px 5px' }}>{d.severity}</span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.priority}</td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.assignedTo}</td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.reporter}</td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.discoveryDate}</td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.environment}</td>
                              <td className="px-2 py-1.5" style={{ border: '1px solid #ead9f5' }}>
                                <span className="whitespace-nowrap rounded font-bold" style={{ background: d.status === 'Open' ? '#fee' : d.status === 'Closed' ? '#d5f0dc' : '#f5f5f5', color: d.status === 'Open' ? '#e74c3c' : d.status === 'Closed' ? '#27ae60' : '#888', padding: '1px 5px' }}>{d.status}</span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.testPhase}</td>
                              <td className="whitespace-nowrap px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#333' }}>{d.defectType}</td>
                              <td className="max-w-[140px] px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#555' }}>{cleanHtmlText(d.notes)}</td>
                              <td className="px-2 py-1.5" style={{ border: '1px solid #ead9f5', color: '#555' }}>{defectRemarks[d.id] || '—'}</td>
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
              <div className="mb-5">
                <h3 className="mb-2 ps-2.5 text-[17px]" style={{ color: '#8B4000', borderInlineStart: '4px solid #f39c12' }}>לתשומת לב צוות הבוקר</h3>
                <p className="whitespace-pre-wrap rounded-md p-3 text-[15px] leading-relaxed" style={{ color: '#333', background: '#fff8f0' }}>{summaryRecord.morningNotes || morningNotes}</p>
              </div>
            )}

            <div className="mt-6 border-t pt-3 text-center text-sm" style={{ color: '#bbb', borderTopColor: '#eee' }}>
              הופק אוטומטית ע"י DeployCenter
            </div>
          </div>
        )}

      </div>
      </>}
    </div>
  );
};
