import React, { useEffect, useState } from 'react';
import axios from 'axios';
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
    <div className="flex flex-wrap gap-4">
      <div className="min-w-[280px] flex-1">
        <div className="mb-2 text-xs font-bold text-subtle-foreground">נבחרים ({value.length}) — לפי הסדר שיוצג</div>
        {value.length === 0 && <div className="text-sm text-subtle-foreground">לא נבחרו שדות.</div>}
        <div className="flex flex-col gap-1">
          {value.map((key, idx) => (
            <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5">
              <span className="flex-1 text-sm text-foreground">{labelOf(key)}</span>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} className={arrowBtnClass(idx === 0)}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === value.length - 1} className={arrowBtnClass(idx === value.length - 1)}>↓</button>
              <button onClick={() => remove(key)} className={`${arrowBtnClass(false)} text-danger`}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-[240px] flex-1">
        <div className="mb-2 text-xs font-bold text-subtle-foreground">זמינים להוספה ({available.length})</div>
        <div className="flex max-h-[260px] flex-wrap gap-1.5 overflow-y-auto">
          {available.length === 0 && <div className="text-sm text-subtle-foreground">כל השדות נבחרו.</div>}
          {available.map(f => (
            <button
              key={f.key}
              onClick={() => add(f.key)}
              className="cursor-pointer rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-sans text-xs text-muted-foreground"
            >
              + {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const arrowBtnClass = (disabled: boolean) =>
  `bg-transparent border-none font-sans text-sm px-1.5 py-0.5 ${disabled ? 'cursor-default text-subtle-foreground' : 'cursor-pointer text-subtle-foreground'}`;

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

  if (loading) return <div className="p-8 text-center font-sans text-subtle-foreground">טוען...</div>;

  return (
    <div className="flex flex-col gap-4 font-sans">
      {error && <Alert variant="danger" onClose={() => setError(null)}>{error}</Alert>}
      {savedMsg && <Alert variant="success" onClose={() => setSavedMsg(false)}>התצורה נשמרה</Alert>}

      <Card>
        <div className="mb-1 text-sm font-bold text-foreground">עמודות טבלת "תקלות ייצור פתוחות"</div>
        <div className="mb-3 text-xs text-subtle-foreground">
          קובע אילו עמודות מוצגות בטבלה במודול איכות גרסה → תקלות ייצור פתוחות, ובאיזה סדר.
        </div>
        {tableColumns != null && (
          <FieldOrderEditor pool={TABLE_COLUMN_FIELDS} value={tableColumns} onChange={setTableColumns} />
        )}
      </Card>

      <Card>
        <div className="mb-1 text-sm font-bold text-foreground">שדות מסך פרטי תקלה</div>
        <div className="mb-3 text-xs text-subtle-foreground">
          קובע אילו שדות מוצגים במסך שנפתח בלחיצה על תקלה בטבלה, ובאיזה סדר. מציג את מלוא השדות הזמינים מ-QC.
        </div>
        {detailFields != null && (
          <FieldOrderEditor pool={DETAIL_FIELDS} value={detailFields} onChange={setDetailFields} />
        )}
      </Card>

      <Button onClick={save} disabled={saving} className="self-start">
        {saving ? 'שומר...' : '💾 שמור תצורה'}
      </Button>
    </div>
  );
};

export default OpenProdDefectsConfigPanel;
