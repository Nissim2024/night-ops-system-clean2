import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, RADIUS, SHADOW } from '../../theme';
import { formatDateTime } from '../../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface ArchiveRow {
  id: string;
  runNumber: number;
  ranAt: string | null;
  headline: string | null;
  sentAt: string | null;
  archivedAt: string;
}

interface ArchiveDetail extends ArchiveRow {
  versionId: string;
  morningNotes: string | null;
  tasksSnapshot: { status: string }[] | null;
}

// Read-only viewer for rehearsal runs archived before a version re-entered
// REHEARSAL for another run (see versions.service.ts's restartRehearsal) —
// Version.lastRehearsalSnapshot / RehearsalSummary are both single-slot per
// version, so without this, a second rehearsal silently loses the first
// run's report. Purely additive: renders nothing when there's nothing to
// show, and never touches the live rehearsal-summary state/flow.
export const RehearsalArchivePanel: React.FC<{ token: string; versionId: string }> = ({ token, versionId }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/versions/${versionId}/rehearsal-archive`, { headers })
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]));
  }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openArchive = (id: string) => {
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    axios.get(`${API}/versions/${versionId}/rehearsal-archive/${id}`, { headers })
      .then(r => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  };

  if (rows.length === 0) return null;

  const fmt = (iso: string | null) => iso ? formatDateTime(iso) : '—';

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '6px' }}>
        חזרות גנרליות קודמות ({rows.length})
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
        {rows.map(r => (
          <button key={r.id} onClick={() => openArchive(r.id)}
            style={{
              fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: 'pointer',
              padding: '6px 12px', borderRadius: RADIUS.full, border: `1px solid #8b5cf680`,
              background: '#8b5cf615', color: '#8b5cf6',
            }}>
            🎭 חזרה #{r.runNumber} · {fmt(r.ranAt)}
          </button>
        ))}
      </div>

      {openId && (
        <div onClick={() => setOpenId(null)} style={{ position: 'fixed', inset: 0, background: C.bgOverlay, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: RADIUS.xl, padding: '24px 28px', maxWidth: '520px', width: '90%', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: SHADOW.floating, border: `1px solid ${C.border}`, fontFamily: FONT }}>
            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>טוען...</div>
            ) : !detail ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.danger }}>שגיאה בטעינת הארכיון</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🎭 חזרה גנרלית #{detail.runNumber}</div>
                  <button onClick={() => setOpenId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '20px' }}>×</button>
                </div>
                <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '14px' }}>
                  הורצה {fmt(detail.ranAt)} · ארוכב {fmt(detail.archivedAt)}
                  {detail.sentAt && <> · נשלח {fmt(detail.sentAt)}</>}
                </div>
                <div style={{ background: C.warningBg, border: `1px solid ${C.warning}40`, borderRadius: RADIUS.md, padding: '8px 12px', ...TEXT.xs, color: C.warning, fontWeight: WEIGHT.semibold, marginBottom: '14px' }}>
                  🔒 תצוגה היסטורית לקריאה בלבד — לא ניתן לערוך
                </div>
                {detail.headline && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '4px' }}>כותרת</div>
                    <div style={{ ...TEXT.sm, color: C.textPrimary }}>{detail.headline}</div>
                  </div>
                )}
                {detail.morningNotes && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '4px' }}>הערות לצוות הבוקר</div>
                    <div style={{ ...TEXT.sm, color: C.textPrimary, whiteSpace: 'pre-wrap' as const }}>{detail.morningNotes}</div>
                  </div>
                )}
                {(() => {
                  const tasks = detail.tasksSnapshot ?? [];
                  if (tasks.length === 0) return null;
                  const done = tasks.filter(t => t.status === 'DONE').length;
                  const blocked = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED').length;
                  return (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <div style={{ flex: 1, background: C.bgNested, borderRadius: RADIUS.md, padding: '10px', textAlign: 'center' as const }}>
                        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>{tasks.length}</div>
                        <div style={{ ...TEXT.xs, color: C.textMuted }}>סה״כ משימות</div>
                      </div>
                      <div style={{ flex: 1, background: C.bgNested, borderRadius: RADIUS.md, padding: '10px', textAlign: 'center' as const }}>
                        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.success }}>{done}</div>
                        <div style={{ ...TEXT.xs, color: C.textMuted }}>הושלמו</div>
                      </div>
                      <div style={{ flex: 1, background: C.bgNested, borderRadius: RADIUS.md, padding: '10px', textAlign: 'center' as const }}>
                        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.danger }}>{blocked}</div>
                        <div style={{ ...TEXT.xs, color: C.textMuted }}>נחסמו/נכשלו</div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
