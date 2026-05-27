import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { ConfirmDialog, DialogConfig } from './ConfirmDialog';

const API = 'http://localhost:3000';

const PHASE_LABELS: Record<number, string> = {
  1: 'שלב 1 — בוקר לפני גרסה',
  2: 'שלב 2 — HOTNET',
  3: 'שלב 3 — HOT',
  4: 'שלב 4 — בוקר לאחר גרסה',
};

const PHASE_BADGE: Record<number, { bg: string; color: string }> = {
  1: { bg: '#e8f4fd', color: '#2980b9' },
  2: { bg: '#e8f8e8', color: '#27ae60' },
  3: { bg: '#fef5e7', color: '#e67e22' },
  4: { bg: '#f5e8fd', color: '#8e44ad' },
};

const APPS = [
  'BILI', 'CRM', 'OSB', 'DP', 'WEB-RETAIL', 'WEB-NEXT', 'WEB-HOT',
  'TOP', 'IRB', 'NC', 'ERP', 'CONNECT', 'CREDIT GUARD', 'ARCHIVE',
  'PRINT BOSS', 'NIFI', 'CAWA', 'BEERI', 'IVR', 'MEDIATION',
  'PROVISIONING LDAP', 'PROVISIONING TIBCO', 'PROVISIONING NAGRA',
  'PROVISIONING OTT', 'PROVISIONING TEL', 'REMEDY', 'ZOO', 'אחר',
];

interface Proposal {
  id: string;
  teamId: string;
  submittedBy?: string;
  title: string;
  app?: string;
  estimatedMins?: number;
  crNumber?: string;
  crLabel?: string;
  notes?: string;
  assignedUserName?: string;
  phase: number;
  status: 'DRAFT' | 'READY';
  usedInTaskId?: string;
}

interface CrPlan {
  id: string;
  crNumber: string;
  crLabel?: string;
  teamId: string;
  team?: { id: string; name: string };
  rollbackPlan?: string;
  gradualRollout: boolean;
  gradualDetails?: string;
  nightTestingNotes?: string;
  morningMonitoring?: string;
  crDeps: { id: string; dependsOnCr: string }[];
}

interface Props {
  token: string;
  versionId: string;
  versionName: string;
  onGoToPlan: () => void;
}

const emptyEdit = { title: '', phase: 1, app: '', estimatedMins: '', assignedUserName: '', notes: '' };

export const CrHandoffView: React.FC<Props> = ({ token, versionId, versionName, onGoToPlan }) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [crPlans, setCrPlans]     = useState<CrPlan[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [users, setUsers]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expandedCrs, setExpandedCrs]   = useState<Set<string>>(new Set());
  const [teamFilter, setTeamFilter]     = useState<string>('');
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editForm, setEditForm]         = useState({ ...emptyEdit });
  const [savingId, setSavingId]         = useState<string | null>(null);
  const [dialog, setDialog]             = useState<DialogConfig | null>(null);
  const [missingTeams, setMissingTeams] = useState<{ name: string; crCount: number; notRequired: boolean }[]>([]);
  const [bannerOpen, setBannerOpen]     = useState(true);
  const [togglingTeam, setTogglingTeam] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const [propRes, planRes, teamRes, userRes, missingRes] = await Promise.all([
        axios.get(`${API}/task-proposals/version/${versionId}`, { headers }),
        axios.get(`${API}/cr-plans/version/${versionId}`, { headers }),
        axios.get(`${API}/teams`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/import/teams-without-proposals?versionId=${versionId}`, { headers }).catch(() => ({ data: [] })),
      ]);
      setProposals(propRes.data);
      setCrPlans(planRes.data);
      setTeams(teamRes.data);
      setUsers(userRes.data.filter((u: any) => u.active));
      setMissingTeams(missingRes.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [versionId]); // eslint-disable-line

  const markNotRequired = async (teamDisplayName: string) => {
    const team = teams.find((t: any) => t.name === teamDisplayName);
    if (!team) return;
    setTogglingTeam(teamDisplayName);
    try {
      await axios.patch(`${API}/versions/${versionId}/submissions/${team.id}/not-required`, { notRequiredForApproval: true }, { headers });
      const res = await axios.get(`${API}/import/teams-without-proposals?versionId=${versionId}`, { headers }).catch(() => ({ data: [] }));
      setMissingTeams(res.data);
    } catch { /* silent */ }
    finally { setTogglingTeam(null); }
  };

  const teamName = (teamId: string) => teams.find(t => t.id === teamId)?.name || '';

  // Build grouped structure: per team → per CR
  const teamGroups = useMemo(() => {
    const byTeam: Record<string, Proposal[]> = {};
    for (const p of proposals) {
      if (!byTeam[p.teamId]) byTeam[p.teamId] = [];
      byTeam[p.teamId].push(p);
    }
    return Object.entries(byTeam)
      .filter(([tid]) => !teamFilter || tid === teamFilter)
      .map(([tid, teamProps]) => {
        const crMap: Record<string, Proposal[]> = {};
        const free: Proposal[] = [];
        for (const p of teamProps) {
          if (p.crNumber) {
            if (!crMap[p.crNumber]) crMap[p.crNumber] = [];
            crMap[p.crNumber].push(p);
          } else { free.push(p); }
        }
        const crGroups = Object.entries(crMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([crNumber, props]) => {
            const plan = crPlans.find(cp => cp.crNumber === crNumber && cp.teamId === tid);
            const label = plan?.crLabel || props[0]?.crLabel || '';
            return { crNumber, crLabel: label, crPlan: plan, proposals: props };
          });
        return { teamId: tid, teamName: teamName(tid), crGroups, freeProposals: free };
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName, 'he'));
  }, [proposals, crPlans, teams, teamFilter]); // eslint-disable-line

  const totalProposals = proposals.length;
  const totalReady     = proposals.filter(p => p.status === 'READY' || p.usedInTaskId).length;
  const totalInPlan    = proposals.filter(p => p.usedInTaskId).length;

  const toggleCr = (key: string) => setExpandedCrs(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const expandAll = () => {
    const keys: string[] = [];
    teamGroups.forEach(tg => {
      tg.crGroups.forEach(cg => keys.push(`${tg.teamId}:${cg.crNumber}`));
      if (tg.freeProposals.length) keys.push(`${tg.teamId}:__free__`);
    });
    setExpandedCrs(new Set(keys));
  };
  const collapseAll = () => setExpandedCrs(new Set());

  const toggleStatus = async (p: Proposal) => {
    const next = p.status === 'DRAFT' ? 'READY' : 'DRAFT';
    await axios.patch(`${API}/task-proposals/${p.id}`, { status: next }, { headers });
    await load();
  };

  const deleteProposal = (p: Proposal) => {
    setDialog({
      title: 'מחיקת הצעה',
      message: `האם למחוק את "${p.title}"?\nפעולה זו בלתי הפיכה.`,
      variant: 'danger',
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול',
      onConfirm: async () => {
        await axios.delete(`${API}/task-proposals/${p.id}`, { headers });
        await load();
      },
      onCancel: () => {},
    });
  };

  const startEdit = (p: Proposal) => {
    setEditingId(p.id);
    setEditForm({
      title: p.title,
      phase: p.phase,
      app: p.app || '',
      estimatedMins: p.estimatedMins ? String(p.estimatedMins) : '',
      assignedUserName: p.assignedUserName || '',
      notes: p.notes || '',
    });
  };

  const saveEdit = async (id: string) => {
    setSavingId(id);
    try {
      await axios.patch(`${API}/task-proposals/${id}`, {
        title: editForm.title.trim(),
        phase: editForm.phase,
        app: editForm.app || undefined,
        estimatedMins: editForm.estimatedMins ? parseInt(editForm.estimatedMins) : undefined,
        assignedUserName: editForm.assignedUserName || undefined,
        notes: editForm.notes || undefined,
      }, { headers });
      setEditingId(null);
      await load();
    } catch { /* silent */ }
    finally { setSavingId(null); }
  };

  const inputS: React.CSSProperties = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', width: '100%', boxSizing: 'border-box' };

  const renderProposalRow = (p: Proposal) => {
    const isEditing = editingId === p.id;
    const isSaving  = savingId === p.id;

    if (isEditing) {
      return (
        <div key={p.id} style={{ background: '#fffdf0', border: '2px solid #f39c12', borderRadius: '8px', padding: '12px', marginBottom: '6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>שם המשימה *</div>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} style={inputS} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>שלב</div>
              <select value={editForm.phase} onChange={e => setEditForm(f => ({ ...f, phase: parseInt(e.target.value) }))} style={inputS}>
                {[1,2,3,4].map(n => <option key={n} value={n}>{PHASE_LABELS[n]}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>מערכת</div>
              <select value={editForm.app} onChange={e => setEditForm(f => ({ ...f, app: e.target.value }))} style={inputS}>
                <option value="">--</option>
                {APPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>משך (דק')</div>
              <input type="number" min={1} value={editForm.estimatedMins} onChange={e => setEditForm(f => ({ ...f, estimatedMins: e.target.value }))} style={inputS} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>עובד אחראי</div>
              <select value={editForm.assignedUserName} onChange={e => setEditForm(f => ({ ...f, assignedUserName: e.target.value }))} style={inputS}>
                <option value="">--</option>
                {users.sort((a,b) => a.fullName.localeCompare(b.fullName,'he')).map((u: any) => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>הערות</div>
              <input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} style={inputS} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => saveEdit(p.id)} disabled={isSaving || !editForm.title.trim()}
              style={{ padding: '5px 14px', background: isSaving ? '#aaa' : '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
              {isSaving ? '...' : 'שמור'}
            </button>
            <button onClick={() => setEditingId(null)}
              style={{ padding: '5px 12px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              ביטול
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={p.id} style={{
        borderRadius: '6px', marginBottom: '5px',
        background: p.usedInTaskId ? '#f0faf0' : 'white',
        border: `1px solid ${p.usedInTaskId ? '#b7dfb8' : '#e0e0e0'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px' }}>
          <span style={{
            background: PHASE_BADGE[p.phase]?.bg, color: PHASE_BADGE[p.phase]?.color,
            padding: '2px 8px', borderRadius: '8px', fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {PHASE_LABELS[p.phase]?.split(' — ')[0]}
          </span>
          <span style={{ flex: 1, fontSize: '13px', color: '#1a2332', fontWeight: 'bold' }}>{p.title}</span>
          {p.usedInTaskId ? (
            <span style={{ fontSize: '10px', background: '#e8f8e8', color: '#27ae60', padding: '2px 8px', borderRadius: '8px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              ✅ בתוכנית
            </span>
          ) : (
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              <button onClick={() => toggleStatus(p)} style={{
                padding: '2px 8px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontSize: '10px', fontWeight: 'bold',
                background: p.status === 'READY' ? '#27ae60' : '#f39c12', color: 'white',
              }}>
                {p.status === 'READY' ? '✓ מוכן' : 'טיוטא'}
              </button>
              <button onClick={() => startEdit(p)}
                style={{ padding: '2px 8px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '10px' }}>
                ערוך
              </button>
              <button onClick={() => deleteProposal(p)}
                style={{ padding: '2px 8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '10px' }}>
                מחק
              </button>
            </div>
          )}
        </div>
        {(p.app || p.assignedUserName || p.estimatedMins || p.notes) && (
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', padding: '4px 10px 7px', borderTop: '1px solid #f0f0f0', fontSize: '11px', color: '#666' }}>
            {p.app && <span><span style={{ color: '#bbb' }}>מערכת: </span>{p.app}</span>}
            {p.estimatedMins && <span><span style={{ color: '#bbb' }}>משך: </span>{p.estimatedMins} דק'</span>}
            {p.assignedUserName && <span><span style={{ color: '#bbb' }}>עובד: </span>{p.assignedUserName}</span>}
            {p.notes && <span style={{ fontStyle: 'italic', color: '#888' }}>📝 {p.notes}</span>}
          </div>
        )}
      </div>
    );
  };

  if (loading) return (
    <div style={{ padding: '60px', textAlign: 'center', color: '#888', fontFamily: 'Arial' }}>טוען...</div>
  );

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial, sans-serif' }}>
      <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)',
        borderRadius: '12px', padding: '16px 24px', marginBottom: '20px', color: 'white',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>סקירת CRים — {versionName}</div>
            <div style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>סיכום הגשות ראשי הצוות לפני שיוך לתוכנית</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{totalReady}/{totalProposals}</div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>מוכנות</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{totalInPlan}</div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>בתוכנית</div>
            </div>
            {(() => {
              const pendingCount = missingTeams.filter(mt => !mt.notRequired).length;
              return (
                <button
                  onClick={pendingCount > 0 ? undefined : onGoToPlan}
                  disabled={pendingCount > 0}
                  title={pendingCount > 0 ? 'יש צוותים שלא הגישו — סמן אותם כ"לא נדרש" כדי להמשיך' : ''}
                  style={{
                    padding: '10px 20px',
                    background: pendingCount > 0 ? '#aaa' : '#27ae60',
                    color: 'white', border: 'none', borderRadius: '8px',
                    cursor: pendingCount > 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold', fontSize: '13px',
                  }}>עבור לתוכנית ←</button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Missing / not-required teams banner */}
      {missingTeams.length > 0 && (() => {
        const pendingTeams   = missingTeams.filter(mt => !mt.notRequired);
        const approvedTeams  = missingTeams.filter(mt => mt.notRequired);
        return (
          <div style={{ background: '#fef9e7', border: '1px solid #f39c12', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setBannerOpen(b => !b)}>
              <span style={{ fontSize: '18px' }}>{pendingTeams.length > 0 ? '⚠️' : '✅'}</span>
              <span style={{ fontWeight: 'bold', color: pendingTeams.length > 0 ? '#d35400' : '#1e8449', fontSize: '14px' }}>
                {pendingTeams.length > 0
                  ? `${pendingTeams.length} צוותים מעורבים טרם הגישו תוכניות`
                  : 'כל הצוותים הגישו או סומנו כ"לא נדרש"'}
              </span>
              <span style={{ marginRight: 'auto', color: '#e67e22', fontSize: '12px' }}>{bannerOpen ? '▲ סגור' : '▼ פרוט'}</span>
            </div>
            {bannerOpen && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pendingTeams.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#7d4e00', marginBottom: '2px' }}>
                    לחץ "לא נדרש לאישור" כדי לאפשר מעבר לתוכנית ללא אישור הצוות:
                  </div>
                )}
                {pendingTeams.map(mt => (
                  <div key={mt.name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ background: '#fadbd8', color: '#c0392b', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', minWidth: '120px' }}>
                      {mt.name}
                    </span>
                    {mt.crCount > 0 && (
                      <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold' }}>
                        {mt.crCount} CR
                      </span>
                    )}
                    <button
                      onClick={() => markNotRequired(mt.name)}
                      disabled={togglingTeam === mt.name}
                      style={{
                        padding: '3px 12px', background: togglingTeam === mt.name ? '#ccc' : '#e67e22',
                        color: 'white', border: 'none', borderRadius: '12px',
                        cursor: togglingTeam === mt.name ? 'not-allowed' : 'pointer',
                        fontSize: '11px', fontWeight: 'bold',
                      }}>
                      {togglingTeam === mt.name ? '...' : 'לא נדרש לאישור ✓'}
                    </button>
                  </div>
                ))}
                {approvedTeams.length > 0 && (
                  <>
                    {pendingTeams.length > 0 && <div style={{ borderTop: '1px solid #f0d9a0', margin: '4px 0' }} />}
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>צוותים שסומנו כ"לא נדרש לאישור":</div>
                    {approvedTeams.map(mt => (
                      <div key={mt.name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ background: '#d5f5e3', color: '#1e8449', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', minWidth: '120px' }}>
                          ✓ {mt.name}
                        </span>
                        {mt.crCount > 0 && (
                          <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold' }}>
                            {mt.crCount} CR
                          </span>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Team filter */}
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', minWidth: '160px' }}>
          <option value="">כל הצוותים</option>
          {teams.filter(t => proposals.some(p => p.teamId === t.id)).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span style={{ fontSize: '13px', color: '#888' }}>
          {teamGroups.length} צוותים · {teamGroups.reduce((s, tg) => s + tg.crGroups.length, 0)} CRים
        </span>
        <button onClick={expandAll} style={{ padding: '5px 12px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>פתח הכל</button>
        <button onClick={collapseAll} style={{ padding: '5px 12px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>סגור הכל</button>
      </div>

      {teamGroups.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', background: 'white', borderRadius: '12px', color: '#aaa' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
          <div style={{ fontSize: '16px', color: '#666' }}>{teamFilter ? 'אין הגשות לצוות זה' : 'אין הגשות עדיין'}</div>
        </div>
      ) : (
        teamGroups.map(tg => (
          <div key={tg.teamId} style={{ marginBottom: '16px' }}>
            {/* Team header */}
            <div style={{ background: '#1a2332', color: 'white', borderRadius: '10px 10px 0 0', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '16px' }}>👥</span>
              <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{tg.teamName}</span>
              <span style={{ opacity: 0.6, fontSize: '12px' }}>
                {tg.crGroups.length} CR{tg.crGroups.length !== 1 ? 'ים' : ''} · {tg.crGroups.reduce((s, cg) => s + cg.proposals.length, 0) + tg.freeProposals.length} הגשות
              </span>
              <span style={{ marginRight: 'auto', fontSize: '12px', opacity: 0.8 }}>
                {[...tg.crGroups.flatMap(cg => cg.proposals), ...tg.freeProposals].filter(p => p.status === 'READY' || p.usedInTaskId).length} מוכן
              </span>
            </div>

            <div style={{ background: 'white', borderRadius: '0 0 10px 10px', padding: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
              {tg.crGroups.map(cg => {
                const key = `${tg.teamId}:${cg.crNumber}`;
                const isExpanded = expandedCrs.has(key);
                const readyCount = cg.proposals.filter(p => p.status === 'READY' || p.usedInTaskId).length;
                const hasPlan = !!cg.crPlan;

                return (
                  <div key={cg.crNumber} style={{ marginBottom: '8px', border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
                    {/* CR header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer', background: isExpanded ? '#f8f8f8' : 'white' }}
                      onClick={() => toggleCr(key)}>
                      <span style={{ color: '#888', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                      <span style={{ background: '#1a2332', color: 'white', padding: '2px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {cg.crNumber}
                      </span>
                      {cg.crLabel && cg.crLabel !== cg.crNumber && (
                        <span style={{ fontSize: '13px', color: '#333' }}>{cg.crLabel}</span>
                      )}
                      <span style={{ flex: 1 }} />
                      {hasPlan && (
                        <span style={{ fontSize: '11px', background: '#e8d5f7', color: '#6c3483', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>📋 תכנית CR</span>
                      )}
                      <span style={{ fontSize: '12px', color: readyCount === cg.proposals.length ? '#27ae60' : '#e67e22', fontWeight: 'bold' }}>
                        {readyCount}/{cg.proposals.length}
                      </span>
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: '1px solid #e8e8e8', padding: '12px 14px', background: '#fafafa' }}>
                        {/* CrPlan metadata */}
                        {cg.crPlan && (
                          <div style={{ background: '#f8f0ff', border: '1px solid #d7bef7', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#6c3483', marginBottom: '6px' }}>📋 תכנית CR</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px' }}>
                              {cg.crPlan.rollbackPlan && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <span style={{ color: '#999' }}>Rollback: </span><span>{cg.crPlan.rollbackPlan}</span>
                                </div>
                              )}
                              <div>
                                <span style={{ color: '#999' }}>עלייה מדורגת: </span>
                                <span style={{ fontWeight: 'bold', color: cg.crPlan.gradualRollout ? '#e67e22' : '#27ae60' }}>
                                  {cg.crPlan.gradualRollout ? `כן — ${cg.crPlan.gradualDetails || 'ללא פרטים'}` : 'לא'}
                                </span>
                              </div>
                              {cg.crPlan.crDeps.length > 0 && (
                                <div><span style={{ color: '#999' }}>תלויות: </span>{cg.crPlan.crDeps.map(d => d.dependsOnCr).join(', ')}</div>
                              )}
                              {cg.crPlan.nightTestingNotes && (
                                <div><span style={{ color: '#999' }}>בדיקות לילה: </span><span style={{ color: '#2980b9' }}>{cg.crPlan.nightTestingNotes}</span></div>
                              )}
                              {cg.crPlan.morningMonitoring && (
                                <div><span style={{ color: '#999' }}>בקרות בוקר: </span><span style={{ color: '#8e44ad' }}>{cg.crPlan.morningMonitoring}</span></div>
                              )}
                            </div>
                          </div>
                        )}
                        {!cg.crPlan && (
                          <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '8px', fontStyle: 'italic' }}>לא הוזנה תכנית CR</div>
                        )}
                        {cg.proposals.sort((a, b) => a.phase - b.phase).map(renderProposalRow)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Free proposals */}
              {tg.freeProposals.length > 0 && (() => {
                const key = `${tg.teamId}:__free__`;
                const isExpanded = expandedCrs.has(key);
                return (
                  <div style={{ border: '1px dashed #ccc', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer', background: isExpanded ? '#f8f8f8' : 'white' }}
                      onClick={() => toggleCr(key)}>
                      <span style={{ color: '#888', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                      <span style={{ background: '#7f8c8d', color: 'white', padding: '2px 10px', borderRadius: '5px', fontSize: '12px', fontWeight: 'bold' }}>ללא CR</span>
                      <span style={{ fontSize: '13px', color: '#666', flex: 1 }}>משימות תשתיתיות / כלליות</span>
                      <span style={{ fontSize: '12px', color: '#888' }}>{tg.freeProposals.length} הגשות</span>
                    </div>
                    {isExpanded && (
                      <div style={{ borderTop: '1px dashed #ccc', padding: '12px 14px', background: '#fafafa' }}>
                        {tg.freeProposals.sort((a, b) => a.phase - b.phase).map(renderProposalRow)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ))
      )}

      {totalProposals > 0 && (
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            onClick={missingTeams.filter(mt => !mt.notRequired).length > 0 ? undefined : onGoToPlan}
            disabled={missingTeams.filter(mt => !mt.notRequired).length > 0}
            title={missingTeams.filter(mt => !mt.notRequired).length > 0 ? 'יש צוותים שלא הגישו — סמן אותם כ"לא נדרש" כדי להמשיך' : ''}
            style={{
              padding: '12px 32px',
              background: missingTeams.filter(mt => !mt.notRequired).length > 0 ? '#aaa' : '#27ae60',
              color: 'white', border: 'none', borderRadius: '10px',
              cursor: missingTeams.filter(mt => !mt.notRequired).length > 0 ? 'not-allowed' : 'pointer',
              fontWeight: 'bold', fontSize: '15px',
            }}>
            עבור לתוכנית ←
          </button>
          <div style={{ fontSize: '12px', color: '#aaa', marginTop: '8px' }}>
            שיוך ההגשות לתוכנית הכללית מתבצע במסך "בנייה ואישור"
          </div>
        </div>
      )}
    </div>
  );
};
