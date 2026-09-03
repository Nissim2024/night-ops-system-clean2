import React, { useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../theme';
import { formatDateTime } from '../utils/dateFormat';
import { DefectIdBadge } from './shared/defectFieldDisplay';

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

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: RADIUS.md, border: `1px solid ${C.borderEm}`,
    background: C.bgCard, color: C.textPrimary, fontFamily: FONT, ...TEXT.sm, boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4], fontFamily: FONT, direction: 'rtl', maxWidth: '760px' }}>
      <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.lg, padding: SP[4], ...TEXT.sm, color: C.danger }}>
        ⚠️ כלי זה כותב ל-QC <strong>אמיתי בייצור</strong>, מזוהה מול QC כמשתמש ה-QC המקושר לחשבון שלך (ללא שמירת סיסמה). הוא רק מוסיף שורה ל"הערות פיתוח" הקיימות — לעולם לא מוחק/דורס. כל שליחה דורשת אישור מפורש.
      </div>

      <div style={{ display: 'flex', gap: SP[3], alignItems: 'flex-end' }}>
        <div>
          <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>מספר תקלה</div>
          <input value={defectId} onChange={e => setDefectId(e.target.value)} style={{ ...inputStyle, width: '160px' }} />
        </div>
        <button
          onClick={loadPreview}
          disabled={loading || !defectId.trim()}
          style={{ padding: '8px 18px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'טוען...' : 'טען תקלה מ-QC'}
        </button>
        <button
          onClick={loadAllFields}
          disabled={fieldsLoading || !defectId.trim()}
          title="מציג את כל שמות השדות ש-REST מחזיר בפועל עבור התקלה, לאבחון שדות שלא נטענים נכון"
          style={{ padding: '8px 18px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: fieldsLoading ? 0.6 : 1 }}
        >
          {fieldsLoading ? 'טוען...' : '🔍 הצג את כל שמות השדות (אבחון)'}
        </button>
      </div>

      {allFields && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[2] }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
            כל שמות השדות שהוחזרו מ-QC עבור תקלה <DefectIdBadge id={defectId} /> ({Object.keys(allFields).length})
          </div>
          <input
            value={fieldsFilter}
            onChange={e => setFieldsFilter(e.target.value)}
            placeholder="סנן לפי שם שדה או ערך (למשל: comment)…"
            style={{ ...inputStyle, width: '100%' }}
          />
          <div style={{ maxHeight: '360px', overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: RADIUS.md }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs, fontFamily: FONT }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>שם שדה (REST)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>ערך</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(allFields)
                  .filter(([k, v]) => !fieldsFilter.trim() || k.toLowerCase().includes(fieldsFilter.toLowerCase()) || v.toLowerCase().includes(fieldsFilter.toLowerCase()))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}`, fontWeight: WEIGHT.semibold, color: C.brand, whiteSpace: 'nowrap' }}>{k}</td>
                      <td style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '(ריק)'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.md, padding: SP[3], ...TEXT.sm, color: C.danger, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      {preview && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>תקלה <DefectIdBadge id={preview.id} /> — {preview.title || '(ללא כותרת)'}</div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '2px' }}>סטטוס: {preview.status || '—'}</div>
          </div>

          <div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>הערות פיתוח נוכחיות (ב-QC):</div>
            <div style={{ background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SP[3], ...TEXT.sm, color: C.textSecondary, whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
              {preview.comments || '(ריק)'}
            </div>
          </div>

          <div>
            <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>טקסט להוספה:</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="הטקסט הזה יתווסף בסוף ההערות הקיימות, עם חותמת DeployCenter + זמן + שם המשתמש..."
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            />
          </div>

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={!note.trim()}
              style={{ alignSelf: 'flex-start', padding: '8px 18px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: note.trim() ? 'pointer' : 'default', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold, opacity: note.trim() ? 1 : 0.5 }}
            >
              המשך לתצוגה מקדימה
            </button>
          ) : (
            <div style={{ background: C.warningBg, border: `1px solid ${C.warning}40`, borderRadius: RADIUS.md, padding: SP[3], display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>הערך שיישלח בפועל ל-QC (הערות פיתוח, אחרי הוספה):</div>
              <div style={{ background: C.bgCard, borderRadius: RADIUS.sm, padding: SP[3], ...TEXT.xs, color: C.textPrimary, whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                {preview.comments ? `${preview.comments}\n---\n[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}` : `[DeployCenter · ... · ${formatDateTime(new Date())}]\n${note.trim()}`}
              </div>
              <div style={{ display: 'flex', gap: SP[2] }}>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                  style={{ padding: '8px 18px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm }}
                >
                  ביטול
                </button>
                <button
                  onClick={sendUpdate}
                  disabled={sending}
                  style={{ padding: '8px 18px', background: C.danger, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.bold, opacity: sending ? 0.6 : 1 }}
                >
                  {sending ? 'שולח ל-QC...' : '🔴 שלח עדכון ל-QC (ייצור)'}
                </button>
              </div>
            </div>
          )}

          {result !== null && (
            <div style={{ background: C.successBg, border: `1px solid ${C.success}40`, borderRadius: RADIUS.md, padding: SP[3], ...TEXT.sm, color: C.success }}>
              ✓ העדכון נשלח בהצלחה ל-QC.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
