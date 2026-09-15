import React, { useEffect, useState } from 'react';
import axios from 'axios';
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
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-bold text-subtle-foreground">
        חזרות גנרליות קודמות ({rows.length})
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map(r => (
          <button key={r.id} onClick={() => openArchive(r.id)}
            className="cursor-pointer rounded-full border border-[#8b5cf680] bg-[#8b5cf615] px-3 py-1.5 text-xs font-semibold text-[#8b5cf6]">
            🎭 חזרה #{r.runNumber} · {fmt(r.ranAt)}
          </button>
        ))}
      </div>

      {openId && (
        <div onClick={() => setOpenId(null)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-foreground/45">
          <div onClick={e => e.stopPropagation()} className="max-h-[80vh] w-[90%] max-w-[520px] overflow-y-auto rounded-2xl border border-border bg-card px-7 py-6 shadow-xl">
            {detailLoading ? (
              <div className="p-[30px] text-center text-subtle-foreground">טוען...</div>
            ) : !detail ? (
              <div className="p-[30px] text-center text-danger">שגיאה בטעינת הארכיון</div>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-lg font-bold text-foreground">🎭 חזרה גנרלית #{detail.runNumber}</div>
                  <button onClick={() => setOpenId(null)} className="cursor-pointer border-none bg-transparent text-xl text-subtle-foreground">×</button>
                </div>
                <div className="mb-3.5 text-xs text-subtle-foreground">
                  הורצה {fmt(detail.ranAt)} · ארוכב {fmt(detail.archivedAt)}
                  {detail.sentAt && <> · נשלח {fmt(detail.sentAt)}</>}
                </div>
                <div className="mb-3.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-xs font-semibold text-warning">
                  🔒 תצוגה היסטורית לקריאה בלבד — לא ניתן לערוך
                </div>
                {detail.headline && (
                  <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-subtle-foreground">כותרת</div>
                    <div className="text-sm text-foreground">{detail.headline}</div>
                  </div>
                )}
                {detail.morningNotes && (
                  <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-subtle-foreground">הערות לצוות הבוקר</div>
                    <div className="whitespace-pre-wrap text-sm text-foreground">{detail.morningNotes}</div>
                  </div>
                )}
                {(() => {
                  const tasks = detail.tasksSnapshot ?? [];
                  if (tasks.length === 0) return null;
                  const done = tasks.filter(t => t.status === 'DONE').length;
                  const blocked = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED').length;
                  return (
                    <div className="flex gap-2.5">
                      <div className="flex-1 rounded-md bg-muted p-2.5 text-center">
                        <div className="text-lg font-bold text-foreground">{tasks.length}</div>
                        <div className="text-xs text-subtle-foreground">סה״כ משימות</div>
                      </div>
                      <div className="flex-1 rounded-md bg-muted p-2.5 text-center">
                        <div className="text-lg font-bold text-success">{done}</div>
                        <div className="text-xs text-subtle-foreground">הושלמו</div>
                      </div>
                      <div className="flex-1 rounded-md bg-muted p-2.5 text-center">
                        <div className="text-lg font-bold text-danger">{blocked}</div>
                        <div className="text-xs text-subtle-foreground">נחסמו/נכשלו</div>
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
