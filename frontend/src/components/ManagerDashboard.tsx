import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { VersionsView } from './VersionsView';
import { ImportView } from './ImportView';
import { WarRoom } from './WarRoom';
import { NightSummary } from './NightSummary';
import { TeamView } from './TeamView';
import { Sidebar, Stage } from './Sidebar';
import { useSocket } from '../hooks/useSocket';
import { TimelineView } from './TimelineView';
import { AdminPanel } from './AdminPanel';
import { usePermissions } from '../context/PermissionsContext';
import { playTaskReady } from '../utils/sound';
import { DeployCenterLogo } from './DeployCenterLogo';
import { VersionProgressChain } from './VersionProgressChain';
import { TeamLeadProposalView } from './TeamLeadProposalView';
import { CrHandoffView } from './CrHandoffView';
import { FEATURES } from '../featureFlags';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  onLogout: () => void;
}

export const ManagerDashboard: React.FC<Props> = ({ token, onLogout }) => {
  const [stage, setStage]                       = useState('');
  const [prepTab, setPrepTab]                   = useState<'versions' | 'import'>('versions');
  const [versions, setVersions]                 = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [onlineUsers, setOnlineUsers]           = useState<any[]>([]);
  const [alert, setAlert]                       = useState<string | null>(null);
  const [endNightLoading, setEndNightLoading]   = useState(false);
  const [endNightError, setEndNightError]       = useState<string | null>(null);
  const [endNightBlockers, setEndNightBlockers] = useState<any[]>([]);
  const [summaryReady, setSummaryReady]         = useState(false);
  const [currentPhaseName, setCurrentPhaseName] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading]     = useState(false);
  const [versionFilter, setVersionFilter]       = useState<'active' | 'inactive' | 'archived'>('active');
  const [blockerReasons, setBlockerReasons]     = useState<Record<string, string>>({});
  const [savingReason, setSavingReason]         = useState<string | null>(null);
  const [activeRunPhase, setActiveRunPhase]     = useState<number>(1);

  const payload  = JSON.parse(atob(token.split('.')[1]));
  const fullName = localStorage.getItem('deploycenter_fullName') || payload.fullName || 'מנהל';
  const headers  = { Authorization: `Bearer ${token}` };
  const { can } = usePermissions();

  const ALL_STAGE_KEYS = ['prep', 'cr-review', 'handoff', 'timeline', 'night', 'summary', 'admin'];
  const allowedKeys = ALL_STAGE_KEYS.filter(key => {
    if (key === 'admin' && payload.role === 'ADMIN') return true;
    if (key === 'prep' && FEATURES.TEAM_LEAD_PROPOSAL && payload.role === 'TEAM_LEAD') return true;
    if (key === 'cr-review' && FEATURES.CR_PLAN_HANDOFF && ['RELEASE_MANAGER', 'ADMIN'].includes(payload.role)) return true;
    if (key === 'cr-review') return false; // hide from others
    return can(`screen:${key}`);
  });

  // ברגע שההרשאות נטענות — קבע שלב ראשון
  useEffect(() => {
    if (allowedKeys.length > 0 && !allowedKeys.includes(stage)) {
      setStage(allowedKeys[0]);
    }
  }, [allowedKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // TEAM_LEAD + feature flag: auto-navigate to prep when there's a planning version
  useEffect(() => {
    if (!FEATURES.TEAM_LEAD_PROPOSAL || payload.role !== 'TEAM_LEAD' || !versions.length) return;
    const planningVersion = versions.find((v: any) =>
      !v.isArchived && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(v.status)
    );
    if (planningVersion && allowedKeys.includes('prep') && stage === allowedKeys[0]) {
      setSelectedVersionId(planningVersion.id);
      setStage('prep');
    }
  }, [versions.length, allowedKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocket({
    userId: payload.sub,
    fullName,
    onTaskUpdated: (task) => {
      if (task?.assignedUserId === payload.sub && task?.status === 'OPEN') {
        playTaskReady();
        showAlert(`🔔 משימה מוכנה: ${task.title}`);
      }
    },
    onTaskBlocked: (task) => showAlert(`⚠️ חסום: ${task.title}`),
    onGoDecision:  (d)    => showAlert(d.go ? `✅ GO! ${d.message}` : `❌ NO GO! ${d.message}`),
    onJoined:      (users) => setOnlineUsers(users.filter((u, i, arr) => arr.findIndex(x => x.userId === u.userId) === i)),
    onUserOnline:  (u)    => setOnlineUsers(prev => [...prev.filter(x => x.userId !== u.userId), u]),
    onUserOffline: (u)    => setOnlineUsers(prev => prev.filter(x => x.userId !== u.userId)),
  });

  const fetchVersions = () => {
    return axios.get(`${API}/versions`, { headers }).then(r => {
      setVersions(r.data);
      setSelectedVersionId(prev => {
        if (r.data.some((v: any) => v.id === prev)) return prev;
        const active = r.data.find((v: any) => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status));
        if (active) return active.id;
        const inactive = r.data.find((v: any) => !v.isArchived && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(v.status));
        if (inactive) return inactive.id;
        return r.data.find((v: any) => v.isArchived || ['COMPLETED', 'ROLLED_BACK'].includes(v.status))?.id || r.data[0]?.id || '';
      });
    });
  };

  const handleGoLive = (versionId: string, _versionName: string, isRehearsal: boolean) => {
    setSelectedVersionId(versionId);
    setStage('handoff');
    fetchVersions();
  };

  useEffect(() => {
    fetchVersions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter to match selected version's category (when dropdown changes or on initial load)
  useEffect(() => {
    if (!selectedVersionId || !versions.length) return;
    const v = versions.find((x: any) => x.id === selectedVersionId);
    if (!v) return;
    const cat: 'active' | 'inactive' | 'archived' =
      v.isArchived || ['COMPLETED', 'ROLLED_BACK'].includes(v.status) ? 'archived' :
      ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status) ? 'active' : 'inactive';
    setVersionFilter(cat);
  }, [selectedVersionId]); // eslint-disable-line

  // When filter tab changes, auto-select first version in that filter if current isn't in it
  useEffect(() => {
    if (!versions.length) return;
    const filtered = versions.filter((v: any) =>
      v.isArchived || ['COMPLETED', 'ROLLED_BACK'].includes(v.status) ? versionFilter === 'archived' :
      ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status) ? versionFilter === 'active' :
      versionFilter === 'inactive'
    );
    if (filtered.length > 0 && !filtered.some((v: any) => v.id === selectedVersionId)) {
      setSelectedVersionId(filtered[0].id);
    }
  }, [versionFilter]); // eslint-disable-line

  // Reset stale per-version state when switching versions
  useEffect(() => {
    setSummaryReady(false);
    setCurrentPhaseName(null);
    setEndNightError(null);
    setEndNightBlockers([]);
    setBlockerReasons({});
  }, [selectedVersionId]); // eslint-disable-line

  // Compute which phase (1-4) is currently active within ACTIVE/REHEARSAL versions
  useEffect(() => {
    const v = versions.find((x: any) => x.id === selectedVersionId);
    if (!v || !['ACTIVE', 'REHEARSAL'].includes(v.status)) { setActiveRunPhase(1); return; }
    axios.get(`${API}/versions/${selectedVersionId}`, { headers })
      .then(res => {
        const phases = [...(res.data.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
        let donePhasesCount = 0;
        for (const ph of phases) {
          const tasks = (ph.subPhases || []).flatMap((sp: any) => sp.tasks || []);
          const nightTasks = tasks.filter((t: any) => t.status !== 'WAITING');
          if (nightTasks.length > 0 && nightTasks.every((t: any) => t.status === 'DONE')) {
            donePhasesCount++;
          } else break;
        }
        setActiveRunPhase(Math.min(donePhasesCount + 1, 4));
      })
      .catch(() => {});
  }, [selectedVersionId, versions]); // eslint-disable-line

  const parseMins = (dur: string | null): number | null => {
    if (!dur) return null;
    const hM = dur.match(/(\d+)ש/); const mM = dur.match(/(\d+)ד/);
    if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
    const n = parseInt(dur); return isNaN(n) ? null : n;
  };

  const fmtMins = (m: number) => m >= 60 ? `${Math.floor(m/60)}ש' ${m%60}דק'` : `${m}דק'`;

  const DELAY_REASONS = [
    'תקלה טכנית בלתי צפויה','תלות שלא הושלמה בזמן','בדיקות / Rollback נדרשו',
    'בעיית גישה / הרשאות','עיכוב בצוות / לא ענו','בעיית תקשורת / רשת',
    'בעיית סביבה / תשתית','תיאום בעיה עם צוות אחר','לא סומן בזמן (בוצע אך לא עודכן)','אחר',
  ];

  const computeBlockers = (tasks: any[]) => tasks.filter((t: any) => {
    if (!['DONE', 'FAILED', 'ROLLED_BACK'].includes(t.status)) return false;
    if (t.delayReason) return false;
    const actualM = t.actualStart && t.actualFinish
      ? Math.round((new Date(t.actualFinish).getTime() - new Date(t.actualStart).getTime()) / 60000) : null;
    const plannedM = parseMins(t.duration) ||
      (t.plannedStart && t.plannedEnd
        ? Math.round((new Date(t.plannedEnd).getTime() - new Date(t.plannedStart).getTime()) / 60000) : null);
    return !!(actualM && plannedM && actualM >= plannedM * 2);
  }).map((t: any) => {
    const actualM = Math.round((new Date(t.actualFinish).getTime() - new Date(t.actualStart).getTime()) / 60000);
    const plannedM = parseMins(t.duration) ||
      Math.round((new Date(t.plannedEnd).getTime() - new Date(t.plannedStart).getTime()) / 60000);
    return { ...t, actualM, plannedM };
  });

  const endNight = async () => {
    setEndNightLoading(true);
    setEndNightError(null);
    setEndNightBlockers([]);
    setBlockerReasons({});
    try {
      // Transition to morning-after phase (not directly to COMPLETED)
      await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: 'MORNING_AFTER' }, { headers });
      await fetchVersions();
      setStage('summary');
    } catch (err: any) {
      setEndNightError(err?.response?.data?.message || err?.message || 'שגיאה');
    } finally {
      setEndNightLoading(false);
    }
  };

  const saveBlockerReason = async (taskId: string) => {
    const reason = blockerReasons[taskId]?.trim();
    if (!reason) return;
    setSavingReason(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}`, { delayReason: reason }, { headers });
      const remaining = endNightBlockers.filter(t => t.id !== taskId);
      setEndNightBlockers(remaining);
      setBlockerReasons(prev => { const n = {...prev}; delete n[taskId]; return n; });
      if (remaining.length === 0) {
        setEndNightError(null);
        endNight(); // auto-retry once all reasons filled
      }
    } catch { /* ignore */ }
    finally { setSavingReason(null); }
  };

  const showAlert = (msg: string) => {
    setAlert(msg);
    setTimeout(() => setAlert(null), 5000);
  };

  const ACTIVE_STATUSES = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'];

  const versionCategory = (v: any): 'active' | 'inactive' | 'archived' => {
    if (v.isArchived || ['COMPLETED', 'ROLLED_BACK'].includes(v.status)) return 'archived';
    if (ACTIVE_STATUSES.includes(v.status)) return 'active';
    return 'inactive';
  };

  const filteredVersions = versions.filter(v => versionCategory(v) === versionFilter);

  const handleVersionFocus = (versionId: string) => {
    const v = versions.find(x => x.id === versionId);
    if (v) {
      setVersionFilter(versionCategory(v));
      setSelectedVersionId(versionId);
    }
  };

  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const vStatus = selectedVersion?.status;
  const isRehearsal = vStatus === 'REHEARSAL';
  const isMorningAfter = vStatus === 'MORNING_AFTER';

  const STAGES: Stage[] = [
    {
      key: 'prep',
      label: 'בנייה ואישור',
      icon: '📋',
      description: 'תוכנית העבודה',
      step: 1,
    },
    {
      key: 'cr-review',
      label: 'סקירת CRים',
      icon: '🔍',
      description: 'סיכום הגשות לפני שיוך',
      step: 2,
    },
    {
      key: 'handoff',
      label: isRehearsal ? 'חזרה גנרלית' : 'ביצוע הטמעה',
      icon: isRehearsal ? '🎭' : '🚀',
      description: isRehearsal ? 'הרצת תוכנית בחזרה גנרלית'
        : currentPhaseName ? `עכשיו: ${currentPhaseName}`
        : isMorningAfter ? 'שלב 4 — בוקר לאחר גרסה'
        : 'הרצת תוכנית ההטמעה',
      step: 3,
    },
    {
      key: 'timeline',
      label: 'ציר זמן',
      icon: '⏱',
      description: 'תוכנית vs בפועל',
      step: 4,
    },
    {
      key: 'night',
      label: 'בקרת ביצוע',
      icon: '📡',
      description: 'מעקב ובקרה בזמן אמת',
      step: 5,
    },
    {
      key: 'summary',
      label: 'דוח סיכום פעילות',
      icon: '📊',
      description: isRehearsal ? 'סיכום וממצאי החזרה הגנרלית' : (vStatus === 'ACTIVE' || vStatus === 'MORNING_AFTER' || vStatus === 'COMPLETED') ? 'סיכום וממצאי ליל ההטמעה' : 'סיכום הפעילות',
      step: 6,
    },
    {
      key: 'admin',
      label: 'ניהול',
      icon: '⚙️',
      description: 'משתמשים וצוותים',
      step: 7,
    },
  ];

  const visibleStages = STAGES.filter(s => allowedKeys.includes(s.key));

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Arial, sans-serif', direction: 'rtl' }}>

      {/* ─── Header ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '64px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        {/* Left side (RTL = right in DOM order) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <DeployCenterLogo variant="nav" />
          {versions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Filter tabs */}
              {(['active', 'inactive', 'archived'] as const).map(f => {
                const labels: Record<string, string> = { active: '🟢 פעילות', inactive: '📋 לא פעילות', archived: '📦 ארכיון' };
                const count = versions.filter(v => versionCategory(v) === f).length;
                return (
                  <button key={f} onClick={() => setVersionFilter(f)} style={{
                    padding: '4px 10px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap',
                    background: versionFilter === f ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)',
                    color: versionFilter === f ? '#1a2332' : 'rgba(255,255,255,0.8)',
                  }}>
                    {labels[f]} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                  </button>
                );
              })}
              {/* Version select */}
              <select
                value={filteredVersions.some(v => v.id === selectedVersionId) ? selectedVersionId : ''}
                onChange={e => setSelectedVersionId(e.target.value)}
                style={{
                  padding: '6px 12px', borderRadius: '8px', border: 'none',
                  background: 'rgba(255,255,255,0.15)', color: 'white',
                  fontSize: '14px', cursor: 'pointer', maxWidth: '200px',
                }}
              >
                {filteredVersions.length === 0
                  ? <option value="" style={{ color: '#1a2332', background: 'white' }}>אין גרסאות</option>
                  : filteredVersions.map(v => (
                    <option key={v.id} value={v.id} style={{ color: '#1a2332', background: 'white' }}>
                      {v.status === 'ACTIVE' ? '🟢 ' : v.status === 'REHEARSAL' ? '🎭 ' : v.status === 'MORNING_AFTER' ? '🌅 ' : ''}{v.name}
                    </option>
                  ))
                }
              </select>
            </div>
          )}
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {alert && (
            <div style={{
              padding: '8px 16px', background: 'rgba(231,76,60,0.9)',
              color: 'white', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
            }}>
              {alert}
            </div>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '8px',
          }}>
            <span style={{ fontSize: '10px', color: '#2ecc71' }}>●</span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>{onlineUsers.length} מחוברים</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>👤 {fullName}</span>
          <button
            onClick={onLogout}
            style={{ padding: '8px 16px', background: 'rgba(231,76,60,0.7)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            יציאה
          </button>
        </div>
      </div>

      {/* ─── Progress Chain ─── */}
      {selectedVersion && (
        <VersionProgressChain versionStatus={selectedVersion.status} activeRunPhase={activeRunPhase} />
      )}

      {/* ─── Body ─── */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>

        {/* Main content */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto', minWidth: 0 }}>

          {/* ── Stage 1: הכנה ── */}
          {stage === 'prep' && (
            FEATURES.TEAM_LEAD_PROPOSAL && payload.role === 'TEAM_LEAD' && selectedVersionId && selectedVersion && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK'].includes(selectedVersion.status)
              ? <TeamLeadProposalView token={token} versionId={selectedVersionId} versionName={selectedVersion.name} />
              : prepTab === 'import' && can('action:import')
                ? <ImportView token={token} onImportSuccess={() => setPrepTab('versions')} />
                : <VersionsView token={token} onImportClick={can('action:import') ? () => setPrepTab('import') : undefined} onVersionsChanged={fetchVersions} onGoLive={handleGoLive} onVersionFocus={handleVersionFocus} />
          )}

          {/* ── Stage cr-review: סקירת CRים ── */}
          {stage === 'cr-review' && selectedVersionId && (
            <CrHandoffView
              token={token}
              versionId={selectedVersionId}
              versionName={selectedVersion?.name || ''}
              onGoToPlan={() => setStage('prep')}
            />
          )}

          {/* ── Stage 2: ביצוע ── */}
          {stage === 'handoff' && (
            ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(selectedVersion?.status) ? (
              <div>
                {selectedVersion?.status === 'REHEARSAL' ? (
                  /* Rehearsal header */
                  <div style={{
                    background: 'linear-gradient(135deg, #7d3c00 0%, #f39c12 100%)',
                    borderRadius: '12px', padding: '12px 20px', marginBottom: '14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '22px' }}>🎭</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>חזרה גנרלית — {selectedVersion?.name}</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>מצב אימון — שינויים לא יכנסו לייצור | לסיום עבור לטאב "דוח סיכום פעילות"</div>
                      </div>
                    </div>
                    {summaryReady && (
                      <button
                        onClick={() => setStage('summary')}
                        style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                      >
                        עבור לדוח הסיכום ←
                      </button>
                    )}
                  </div>
                ) : selectedVersion?.status === 'MORNING_AFTER' ? (
                  /* Morning-after header */
                  <div style={{ background: 'white', borderRadius: '12px', padding: '12px 20px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>🌅</span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 'bold', color: '#8e44ad', fontSize: '14px' }}>שלב 4 — בוקר לאחר גרסה — {selectedVersion?.name}</span>
                            {currentPhaseName && (
                              <span style={{ background: '#8e44ad', color: 'white', fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
                                {currentPhaseName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>השלם את משימות הבוקר ואשר סיכום לסגירת הגרסה</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {summaryReady && (
                          <button
                            onClick={() => setStage('summary')}
                            style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                          >
                            עבור לדוח הסיכום ←
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!window.confirm('לסגור את הגרסה? (ניתן לארכב אותה לאחר מכן)')) return;
                            setEndNightLoading(true);
                            setEndNightError(null);
                            setEndNightBlockers([]);
                            try {
                              await axios.patch(`${API}/versions/${selectedVersionId}/status`, { status: 'COMPLETED' }, { headers });
                              await fetchVersions();
                            } catch (err: any) {
                              const msg = err?.response?.data?.message || err?.message || 'שגיאה';
                              setEndNightError(msg);
                              if (msg.includes('עיכוב')) {
                                try {
                                  const res = await axios.get(`${API}/tasks?versionId=${selectedVersionId}`, { headers });
                                  setEndNightBlockers(computeBlockers(res.data));
                                } catch { /* ignore */ }
                              }
                            } finally {
                              setEndNightLoading(false);
                            }
                          }}
                          disabled={endNightLoading}
                          style={{ padding: '8px 20px', background: endNightLoading ? '#aaa' : '#1a5c2a', color: 'white', border: 'none', borderRadius: '8px', cursor: endNightLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                        >
                          {endNightLoading ? '...' : '✅ סגור גרסה'}
                        </button>
                      </div>
                    </div>
                    {(endNightError || endNightBlockers.length > 0) && (
                      <div style={{ background: '#fff8f0', border: '1px solid #e67e22', borderRadius: '8px', padding: '10px 14px', fontSize: '13px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: endNightBlockers.length ? '10px' : 0 }}>
                          <span style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ {endNightBlockers.length > 0 ? `${endNightBlockers.length} משימות עם עיכוב ללא סיבה` : endNightError}</span>
                          <button onClick={() => { setEndNightError(null); setEndNightBlockers([]); setBlockerReasons({}); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontWeight: 'bold', fontSize: '16px' }}>×</button>
                        </div>
                        {endNightBlockers.map((t: any) => (
                          <div key={t.id} style={{ background: 'white', border: '1px solid #f0c040', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#1a2332' }}>{t.title}</div>
                            <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>מתוכנן: {fmtMins(t.plannedM)} · בפועל: {fmtMins(t.actualM)} · חריגה: +{fmtMins(t.actualM - t.plannedM)}</div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <select value={blockerReasons[t.id] || ''} onChange={e => setBlockerReasons(prev => ({ ...prev, [t.id]: e.target.value }))} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', direction: 'rtl' }}>
                                <option value="">— בחר סיבת עיכוב —</option>
                                {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <button onClick={() => saveBlockerReason(t.id)} disabled={!blockerReasons[t.id] || savingReason === t.id} style={{ padding: '5px 14px', background: blockerReasons[t.id] ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: blockerReasons[t.id] ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                {savingReason === t.id ? '...' : 'שמור'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ACTIVE: Real-night header */
                  <div style={{ background: 'white', borderRadius: '12px', padding: '12px 20px', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '14px' }}>🌙 {selectedVersion?.name}</span>
                        {currentPhaseName && (
                          <span style={{ background: '#2d4a7a', color: 'white', fontSize: '11px', padding: '2px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
                            {currentPhaseName}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {summaryReady && (
                          <button
                            onClick={() => setStage('summary')}
                            style={{ padding: '8px 20px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                          >
                            עבור לדוח הסיכום ←
                          </button>
                        )}
                        <button
                          onClick={endNight}
                          disabled={endNightLoading}
                          style={{ padding: '8px 20px', background: endNightLoading ? '#aaa' : '#1a5c2a', color: 'white', border: 'none', borderRadius: '8px', cursor: endNightLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                        >
                          {endNightLoading ? '...' : 'סיום פעילות גרסה →'}
                        </button>
                      </div>
                    </div>
                    {endNightError && (
                      <div style={{ background: '#fff8f0', border: '1px solid #e67e22', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#c0392b', fontWeight: 'bold' }}>⚠️ {endNightError}</span>
                        <button onClick={() => setEndNightError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontWeight: 'bold', fontSize: '16px' }}>×</button>
                      </div>
                    )}
                  </div>
                )}
                <TeamView token={token} versionId={selectedVersionId} onTaskUpdated={fetchVersions} onSummaryReady={setSummaryReady} onCurrentPhaseChange={setCurrentPhaseName} />
              </div>
            ) : (
              <NoActiveVersionMessage />
            )
          )}

          {/* ── Stage 4: ציר זמן ── */}
          {stage === 'timeline' && (
            selectedVersionId
              ? <TimelineView token={token} versionId={selectedVersionId} versionName={selectedVersion?.name || ''} />
              : <EmptyVersionMessage />
          )}

          {/* ── Stage 5: לילה ── */}
          {stage === 'night' && (
            ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(selectedVersion?.status) ? (
              <div>
                <div style={{
                  background: isRehearsal
                    ? 'linear-gradient(135deg, #7d3c00 0%, #f39c12 100%)'
                    : isMorningAfter ? 'linear-gradient(135deg, #6c3483 0%, #8e44ad 100%)' : '#1a2332',
                  border: `2px solid ${isRehearsal ? '#e67e22' : isMorningAfter ? '#8e44ad' : '#2d4a7a'}`,
                  borderRadius: '12px',
                  padding: '14px 20px', marginBottom: '20px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <span style={{ fontSize: '22px' }}>{isRehearsal ? '🎭' : isMorningAfter ? '🌅' : '🌙'}</span>
                  <div>
                    <div style={{ fontWeight: 'bold', color: 'white' }}>
                      {isRehearsal ? 'חזרה גנרלית — מעקב התקדמות' : isMorningAfter ? 'ביצוע — לילה ובוקר לאחר גרסה' : 'לילה פעיל — מעקב בזמן אמת'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>
                      {isRehearsal ? 'מצב אימון — שינויים לא יכנסו לייצור' : isMorningAfter ? 'מעקב בזמן אמת — משימות לילה ובוקר' : 'המערכת מתריעה על חסימות וסטטוסים בזמן אמת'}
                    </div>
                  </div>
                </div>
                <WarRoom
                  token={token}
                  versionId={selectedVersionId}
                  versionName={selectedVersion?.name || ''}
                  onTeamClick={() => setStage('handoff')}
                  onlineUsers={onlineUsers}
                  isRehearsal={selectedVersion?.status === 'REHEARSAL'}
                  hideGoNogo={false}
                />
              </div>
            ) : <NoActiveVersionMessage />
          )}

          {/* ── Stage 7: ניהול ── */}
          {stage === 'admin' && (
            <AdminPanel token={token} />
          )}

          {/* ── Stage 6: סיכום ── */}
          {stage === 'summary' && (
            selectedVersionId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

                {/* ── גרסה סגורה (COMPLETED/ROLLED_BACK) ── */}
                {['COMPLETED', 'ROLLED_BACK'].includes(selectedVersion?.status) && (
                  <div style={{ background: 'white', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontSize: '36px' }}>{selectedVersion?.isArchived ? '📦' : '✅'}</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '15px' }}>
                          {selectedVersion?.isArchived ? 'גרסה בארכיון' : 'גרסה סגורה'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#aaa', marginTop: '3px' }}>
                          {selectedVersion?.isArchived
                            ? 'גרסה זו הועברה לארכיון — ניתן לשחזר מעמוד ניהול הגרסאות'
                            : 'ניתן לארכב את הגרסה כדי להסירה מהרשימה הפעילה'}
                        </div>
                      </div>
                    </div>
                    {!selectedVersion?.isArchived && (
                      <button
                        onClick={async () => {
                          if (!window.confirm('להעביר את הגרסה לארכיון?')) return;
                          setArchiveLoading(true);
                          try {
                            await axios.patch(`${API}/versions/${selectedVersionId}/archive`, {}, { headers });
                            await fetchVersions();
                          } catch (err: any) {
                            showAlert(err?.response?.data?.message || 'שגיאה בהעברה לארכיון');
                          } finally {
                            setArchiveLoading(false);
                          }
                        }}
                        disabled={archiveLoading}
                        style={{ padding: '8px 20px', background: archiveLoading ? '#aaa' : '#6c3483', color: 'white', border: 'none', borderRadius: '8px', cursor: archiveLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
                      >
                        {archiveLoading ? '...' : '📦 העבר לארכיון'}
                      </button>
                    )}
                  </div>
                )}

                {/* ── סיכום ליל ההטמעה ── */}
                {['ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(selectedVersion?.status) && (
                  <div>
                    <div style={{
                      background: '#1a2332', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px',
                      display: 'flex', alignItems: 'center', gap: '12px',
                    }}>
                      <span style={{ fontSize: '22px' }}>🌙</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>סיכום ליל ההטמעה</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>הפק ואשר את דוח הסיכום</div>
                      </div>
                    </div>
                    <NightSummary
                      token={token}
                      versionId={selectedVersionId}
                      versionName={selectedVersion?.name || ''}
                      isRehearsal={false}
                      onApproved={() => fetchVersions()}
                    />
                  </div>
                )}

                {/* ── סיכום חזרה גנרלית ── */}
                {(selectedVersion?.lastRehearsalAt || selectedVersion?.status === 'REHEARSAL') && (
                  <div>
                    <div style={{
                      background: 'linear-gradient(135deg, #7d3c00 0%, #f39c12 100%)',
                      borderRadius: '12px', padding: '14px 20px', marginBottom: '20px',
                      display: 'flex', alignItems: 'center', gap: '12px',
                    }}>
                      <span style={{ fontSize: '22px' }}>🎭</span>
                      <div>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: '15px' }}>סיכום חזרה גנרלית</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', marginTop: '2px' }}>
                          {selectedVersion?.lastRehearsalAt
                            ? `הופעלה ב-${new Date(selectedVersion.lastRehearsalAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                            : 'חזרה גנרלית פעילה — אשר את הסיכום לאיפוס ומעבר לשלב ההטמעה'}
                        </div>
                      </div>
                    </div>
                    <NightSummary
                      token={token}
                      versionId={selectedVersionId}
                      versionName={selectedVersion?.name || ''}
                      isRehearsal={true}
                      onApproved={async () => { await fetchVersions(); setStage('prep'); }}
                    />
                  </div>
                )}

                {/* אם אין עדיין שום ריצה */}
                {!selectedVersion?.lastRehearsalAt && !['REHEARSAL', 'ACTIVE', 'MORNING_AFTER'].includes(selectedVersion?.status) && !['COMPLETED', 'ROLLED_BACK'].includes(selectedVersion?.status) && (
                  <div style={{ textAlign: 'center', padding: '60px', color: '#666', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: '48px' }}>📋</div>
                    <p style={{ fontSize: '16px', marginTop: '12px' }}>הדוח יהיה זמין לאחר הרצת החזרה הגנרלית או ליל ההטמעה</p>
                  </div>
                )}
              </div>
            ) : <EmptyVersionMessage />
          )}
        </div>

        {/* ─── Sidebar ─── */}
        <Sidebar stages={visibleStages} activeStage={stage} onStageChange={setStage} />
      </div>
    </div>
  );
};

const EmptyVersionMessage: React.FC = () => (
  <div style={{ textAlign: 'center', padding: '80px', color: '#666', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
    <div style={{ fontSize: '48px' }}>📁</div>
    <p style={{ fontSize: '16px', marginTop: '12px' }}>בחר גרסה מהתפריט בכותרת</p>
  </div>
);

const NoActiveVersionMessage: React.FC = () => (
  <div style={{ textAlign: 'center', padding: '80px', color: '#666', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
    <div style={{ fontSize: '48px' }}>🔒</div>
    <h3 style={{ color: '#1a2332', marginTop: '16px' }}>אין גרסה פעילה</h3>
    <p style={{ fontSize: '14px', color: '#888' }}>מסך זה זמין רק כאשר גרסה הופעלה ללילה</p>
    <p style={{ fontSize: '13px', color: '#aaa' }}>עבור למסך הכנה ושנה את סטטוס הגרסה ל-ACTIVE</p>
  </div>
);
