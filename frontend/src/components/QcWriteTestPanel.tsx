import React, { useState } from 'react';
import axios from 'axios';
import { formatDateTime } from '../utils/dateFormat';
import { DefectIdBadge } from './shared/defectFieldDisplay';
import { Button, TextField, TextArea } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface DefectPreview { id: string; title: string; status: string; comments: string; }

// Test tool for the QC REST write-back integration (spec confirmed
// 2026-08-29/30, per-user auth 2026-09-02) — gated by the 'action:qc_write'
// permission, writes to REAL PRODUCTION QC as the logged-in user's own QC
// identity (qcLogin + empty password, nothing stored). Deliberately narrow:
// appends to the internal "Dev Comments" field only, never overwrites it,
// and every write requires an explicit confirm click after seeing the exact
// before/after text. See backend/src/qc/qc-rest.service.ts for why this
// can't go through the existing read-only Oracle connection.
export const QcWriteTestPanel: React.FC<{ token: string }> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [defectId, setDefectId] = useState('47000');
  const [preview, setPreview] = useState<DefectPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [allFields, setAllFields] = useState<Record<string, string> | null>(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsFilter, setFieldsFilter] = useState('');

  // Stage-0 de-risk (2026-09-15): does this QC instance's REST API even
  // support Release/Release-Cycle entities, before any create-Release code
  // is written. Both calls below are read-only.
  const [entityProbe, setEntityProbe] = useState<{ type: string; result?: any; error?: string } | null>(null);
  const [entityProbeLoading, setEntityProbeLoading] = useState(false);

  const probeEntity = async (type: 'release' | 'release-cycle' | 'releases-list') => {
    setEntityProbeLoading(true);
    setEntityProbe({ type });
    try {
      const url = type === 'releases-list'
        ? `${API}/qc/rest-test/releases`
        : `${API}/qc/rest-test/entity-fields/${type}`;
      const res = await axios.get(url, { headers });
      setEntityProbe({ type, result: res.data });
    } catch (e: any) {
      setEntityProbe({ type, error: e?.response?.data?.message || e.message || 'שגיאה בבדיקה מול QC' });
    } finally {
      setEntityProbeLoading(false);
    }
  };

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setResult(null);
    setConfirming(false);
    try {
      const res = await axios.get(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}`, { headers });
      setPreview(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלה מ-QC');
    } finally {
      setLoading(false);
    }
  };

  const sendUpdate = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/append-note`, { note }, { headers });
      setResult(res.data?.newValue ?? '');
      setPreview(prev => prev ? { ...prev, comments: res.data?.newValue ?? prev.comments } : prev);
      setConfirming(false);
      setNote('');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בשליחת העדכון ל-QC');
    } finally {
      setSending(false);
    }
  };

  // Diagnostic: dump every REST field name QC actually returns for this
  // defect — BG_DEV_COMMENTS (the raw Oracle column name) turned out not to
  // be the REST field name; this lets us find the real one by inspecting a
  // defect with known real comment text instead of guessing again (spec
  // confirmed 2026-09-01).
  const loadAllFields = async () => {
    setFieldsLoading(true);
    setError(null);
    setAllFields(null);
    try {
      const res = await axios.get(`${API}/qc/rest-test/defect/${encodeURIComponent(defectId)}/fields`, { headers });
      setAllFields(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'שגיאה בטעינת רשימת השדות מ-QC');
    } finally {
      setFieldsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <div className="bg-danger-bg border border-danger/25 rounded-lg p-4 text-sm text-danger">
        ⚠️ כלי זה כותב ל-QC <strong>אמיתי בייצור</strong>, מזוהה מול QC כמשתמש ה-QC המקושר לחשבון שלך (ללא שמירת סיסמה). הוא רק מוסיף שורה ל"הערות פיתוח" הקיימות — לעולם לא מוחק/דורס. כל שליחה דורשת אישור מפורש.
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <div className="text-xs text-subtle-foreground mb-1">מספר תקלה</div>
          <TextField value={defectId} onChange={e => setDefectId(e.target.value)} className="w-[160px]" />
        </div>
        <Button
          variant="primary"
          onClick={loadPreview}
          disabled={loading || !defectId.trim()}
        >
          {loading ? 'טוען...' : 'טען תקלה מ-QC'}
        </Button>
        <Button
          variant="secondary"
          onClick={loadAllFields}
          disabled={fieldsLoading || !defectId.trim()}
          title="מציג את כל שמות השדות ש-REST מחזיר בפועל עבור התקלה, לאבחון שדות שלא נטענים נכון"
        >
          {fieldsLoading ? 'טוען...' : '🔍 הצג את כל שמות השדות (אבחון)'}
        </Button>
      </div>

      {allFields && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            כל שמות השדות שהוחזרו מ-QC עבור תקלה <DefectIdBadge id={defectId} /> ({Object.keys(allFields).length})
          </div>
          <TextField
            value={fieldsFilter}
            onChange={e => setFieldsFilter(e.target.value)}
            placeholder="סנן לפי שם שדה או ערך (למשל: comment)…"
            fullWidth
          />
          <div className="max-h-[360px] overflow-auto border border-border rounded-md">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted">
                  <th className="py-1.5 px-2 text-right border-b border-border">שם שדה (REST)</th>
                  <th className="py-1.5 px-2 text-right border-b border-border">ערך</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(allFields)
                  .filter(([k, v]) => !fieldsFilter.trim() || k.toLowerCase().includes(fieldsFilter.toLowerCase()) || v.toLowerCase().includes(fieldsFilter.toLowerCase()))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-[5px] px-2 border-b border-border font-semibold text-primary whitespace-nowrap">{k}</td>
                      <td className="py-[5px] px-2 border-b border-border text-foreground whitespace-pre-wrap break-words">{v || '(ריק)'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
          {error}
        </div>
      )}

      {preview && (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">תקלה <DefectIdBadge id={preview.id} /> — {preview.title || '(ללא כותרת)'}</div>
            <div className="text-xs text-subtle-foreground mt-0.5">סטטוס: {preview.status || '—'}</div>
          </div>

          <div>
            <div className="text-xs text-subtle-foreground mb-1">הערות פיתוח נוכחיות (ב-QC):</div>
            <div className="bg-muted border border-border rounded-md p-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">
              {preview.comments || '(ריק)'}
            </div>
          </div>

          <div>
            <div className="text-xs text-subtle-foreground mb-1">טקסט להוספה:</div>
            <TextArea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="הטקסט הזה יתווסף בסוף ההערות הקיימות, עם חותמת DeployCenter + זמן + שם המשתמש..."
              fullWidth
              className="resize-y"
            />
          </div>

          {!confirming ? (
            <Button
              variant="secondary"
              onClick={() => setConfirming(true)}
              disabled={!note.trim()}
              className="self-start"
            >
              המשך לתצוגה מקדימה
            </Button>
          ) : (
            <div className="bg-warning-bg border border-warning/25 rounded-md p-3 flex flex-col gap-2">
              <div className="text-sm font-semibold text-foreground">הערך שיישלח בפועל ל-QC (הערות פיתוח, אחרי הוספה):</div>
              <div className="bg-card rounded-sm p-3 text-xs text-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">
                {preview.comments ? `${preview.comments}\n---\n[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}` : `[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}`}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                >
                  ביטול
                </Button>
                <Button
                  variant="danger"
                  onClick={sendUpdate}
                  disabled={sending}
                >
                  {sending ? 'שולח ל-QC...' : '🔴 שלח עדכון ל-QC (ייצור)'}
                </Button>
              </div>
            </div>
          )}

          {result !== null && (
            <div className="bg-success-bg border border-success/25 rounded-md p-3 text-sm text-success">
              ✓ העדכון נשלח בהצלחה ל-QC.
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 mt-2">
        <div className="text-sm font-bold text-foreground">
          🧪 שלב 0 — האם QC בכלל תומך ביצירת Release / Release Cycle דרך REST?
        </div>
        <div className="text-xs text-subtle-foreground">
          כלי אבחון בלבד — קריאות GET בלבד, לא כותב כלום ל-QC.
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => probeEntity('release')} disabled={entityProbeLoading}>
            בדוק שדות ישות "release"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('release-cycle')} disabled={entityProbeLoading}>
            בדוק שדות ישות "release-cycle"
          </Button>
          <Button variant="secondary" onClick={() => probeEntity('releases-list')} disabled={entityProbeLoading}>
            קרא רשימת releases אמיתית
          </Button>
        </div>
        {entityProbeLoading && <div className="text-sm text-subtle-foreground">בודק מול QC...</div>}
        {entityProbe?.error && (
          <div className="bg-danger-bg border border-danger/25 rounded-md p-3 text-sm text-danger whitespace-pre-wrap">
            [{entityProbe.type}] {entityProbe.error}
          </div>
        )}
        {entityProbe?.result !== undefined && (
          <pre className="bg-muted border border-border rounded-md p-3 text-xs text-foreground whitespace-pre-wrap max-h-[300px] overflow-auto" dir="ltr">
            {JSON.stringify(entityProbe.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};
