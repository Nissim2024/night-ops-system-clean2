import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { Card, Button, Alert } from '../ui';
import { TABLE_COLUMN_FIELDS, DETAIL_FIELDS, FieldDef } from './openProdDefectsFields';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Admin-only editor for which fields show (and in what order) on the open-
// production-defects table and its per-defect detail screen. No drag-and-drop
// library in this app, so reordering is up/down buttons — consistent with
// every other list-editing UI here.
const FieldOrderEditor: React.FC<{ pool: FieldDef[]; value: string[]; onChange: (next: string[]) => void }> = ({ pool, value, onChange }) => {
  const labelOf = (key: string) => pool.find(f => f.key === key)?.label ?? key;
  const available = pool.filter(f => !value.includes(f.key));

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...value];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };
  const remove = (key: string) => onChange(value.filter(k => k !== key));
  const add = (key: string) => { if (key && !value.includes(key)) onChange([...value, key]); };

  return (
    <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '280px' }}>
        <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: SP[2] }}>נבחרים ({value.length}) — לפי הסדר שיוצג</div>
        {value.length === 0 && <div style={{ ...TEXT.sm, color: C.textMuted }}>לא נבחרו שדות.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {value.map((key, idx) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: SP[2], background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '6px 10px' }}>
              <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>{labelOf(key)}</span>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} style={arrowBtn(idx === 0)}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === value.length - 1} style={arrowBtn(idx === value.length - 1)}>↓</button>
              <button onClick={() => remove(key)} style={{ ...arrowBtn(false), color: C.danger }}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: '240px' }}>
        <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: SP[2] }}>זמינים להוספה ({available.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
          {available.length === 0 && <div style={{ ...TEXT.sm, color: C.textMuted }}>כל השדות נבחרו.</div>}
          {available.map(f => (
            <button key={f.key} onClick={() => add(f.key)} style={{
              fontFamily: FONT, ...TEXT.xs, cursor: 'pointer', padding: '5px 10px', borderRadius: RADIUS.full,
              border: `1px dashed ${C.border}`, background: 'transparent', color: C.textSecondary,
            }}>
              + {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const arrowBtn = (disabled: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
  color: disabled ? C.textDisabled : C.textMuted, fontSize: '14px', padding: '2px 6px', fontFamily: FONT,
});

export const OpenProdDefectsConfigPanel: React.FC<{ token: string }> = ({ token }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [tableColumns, setTableColumns] = useState<string[] | null>(null);
  const [detailFields, setDetailFields] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios.get(`${API}/qc/open-prod-defects-config`, { headers })
      .then(r => { setTableColumns(r.data.tableColumns); setDetailFields(r.data.detailFields); })
      .catch(() => setError('שגיאה בטעינת התצורה הנוכחית'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const save = async () => {
    if (tableColumns == null || detailFields == null) return;
    setSaving(true);
    setError(null);
    setSavedMsg(false);
    try {
      await axios.patch(`${API}/qc/open-prod-defects-config`, { tableColumns, detailFields }, { headers });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה בשמירת התצורה');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: SP[8], color: C.textMuted, fontFamily: FONT }}>טוען...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4], fontFamily: FONT }}>
      {error && <Alert variant="danger" onClose={() => setError(null)}>{error}</Alert>}
      {savedMsg && <Alert variant="success" onClose={() => setSavedMsg(false)}>התצורה נשמרה</Alert>}

      <Card>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>עמודות טבלת "תקלות ייצור פתוחות"</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[3] }}>
          קובע אילו עמודות מוצגות בטבלה במודול איכות גרסה → תקלות ייצור פתוחות, ובאיזה סדר.
        </div>
        {tableColumns != null && (
          <FieldOrderEditor pool={TABLE_COLUMN_FIELDS} value={tableColumns} onChange={setTableColumns} />
        )}
      </Card>

      <Card>
        <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '4px' }}>שדות מסך פרטי תקלה</div>
        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[3] }}>
          קובע אילו שדות מוצגים במסך שנפתח בלחיצה על תקלה בטבלה, ובאיזה סדר. מציג את מלוא השדות הזמינים מ-QC.
        </div>
        {detailFields != null && (
          <FieldOrderEditor pool={DETAIL_FIELDS} value={detailFields} onChange={setDetailFields} />
        )}
      </Card>

      <Button onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
        {saving ? 'שומר...' : '💾 שמור תצורה'}
      </Button>
    </div>
  );
};

export default OpenProdDefectsConfigPanel;
