import React, { useState } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  onImportSuccess: () => void;
}

export const ImportView: React.FC<Props> = ({ token, onImportSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const handleImport = async () => {
    if (!file || !versionName) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('versionName', versionName);
      if (plannedStart) formData.append('plannedStart', plannedStart);

      const res = await axios.post(`${API}/import/excel`, formData, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' },
      });

      setResult(res.data);
      if (res.data.success) onImportSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'שגיאה בייבוא הקובץ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial', maxWidth: '700px' }}>
      <h2 style={{ color: '#1a2332', marginBottom: '8px' }}>ייבוא תוכנית עבודה מ-Excel</h2>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        טען קובץ Excel בפורמט GoLive — המערכת תייצר גרסה חדשה עם כל השלבים והמשימות אוטומטית.
      </p>

      <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>

        {/* שם גרסה */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            שם הגרסה *
          </label>
          <input
            type="text"
            value={versionName}
            onChange={e => setVersionName(e.target.value)}
            placeholder="לדוגמה: ITv04-2026"
            style={{ width: '100%', padding: '12px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' }}
          />
        </div>

        {/* תאריך התחלה */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            תאריך התחלה של הפעילות
            <span style={{ fontWeight: 'normal', color: '#888', fontSize: '13px', marginRight: '8px' }}>
              (אופציונלי — אם לא ממולא, ייקחו התאריכים מהקובץ)
            </span>
          </label>
          <input
            type="date"
            value={plannedStart}
            onChange={e => setPlannedStart(e.target.value)}
            style={{ width: '100%', padding: '12px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box' }}
          />
          {plannedStart && (
            <div style={{ marginTop: '6px', fontSize: '13px', color: '#2980b9', background: '#e8f4fd', padding: '8px 12px', borderRadius: '6px' }}>
              📅 תאריך הגרסה <strong>{new Date(plannedStart + 'T12:00:00').toLocaleDateString('he-IL')}</strong> יוחל על כל שעות הקובץ — שעת הסיום תחושב מהמשך
            </div>
          )}
        </div>

        {/* בחירת קובץ */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            קובץ Excel *
          </label>
          <div style={{ border: '2px dashed #c0d4e8', borderRadius: '8px', padding: '32px', textAlign: 'center', background: '#f8fafc', cursor: 'pointer' }}
            onClick={() => document.getElementById('file-input')?.click()}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>📂</div>
            {file ? (
              <div>
                <div style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '15px' }}>{file.name}</div>
                <div style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <div>
                <div style={{ color: '#666', fontSize: '14px' }}>לחץ לבחירת קובץ</div>
                <div style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>xlsx, xls — עד 10MB</div>
              </div>
            )}
          </div>
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* כפתור ייבוא */}
        <button
          onClick={handleImport}
          disabled={!file || !versionName || loading}
          style={{
            width: '100%', padding: '14px',
            background: !file || !versionName || loading ? '#ccc' : '#1a2332',
            color: 'white', border: 'none', borderRadius: '8px',
            fontSize: '16px', fontWeight: 'bold',
            cursor: !file || !versionName || loading ? 'not-allowed' : 'pointer',
          }}>
          {loading ? 'מייבא... אנא המתן' : 'ייבא תוכנית עבודה'}
        </button>

        {/* תוצאה */}
        {result && result.success && (
          <div style={{ marginTop: '24px', background: '#d5f0dc', border: '2px solid #27ae60', borderRadius: '8px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', color: '#1a5c2a' }}>הייבוא הושלם בהצלחה!</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'שלבים',          value: result.stats.phases },
                { label: 'תת-שלבים',       value: result.stats.subPhases },
                { label: 'משימות',          value: result.stats.tasks },
                { label: 'נקודות GO/NO GO', value: result.stats.goNoGo },
                { label: 'התראות',          value: result.stats.alerts },
                { label: 'תלויות שקושרו',  value: result.stats.depsLinked ?? 0 },
              ].map(s => (
                <div key={s.label} style={{ background: 'white', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#27ae60' }}>{s.value}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '12px', fontSize: '13px', color: '#1a5c2a' }}>
              גרסה <strong>{result.stats.versionName}</strong> נוצרה — עבור לטאב גרסאות לצפייה.
            </div>
            {result.stats.missingDepRows?.length > 0 && (
              <div style={{ marginTop: '12px', background: '#fff3e0', border: '1px solid #e67e22', borderRadius: '6px', padding: '10px 14px' }}>
                <strong style={{ color: '#8b4000', fontSize: '13px' }}>⚠️ תלויות שלא נמצאו ({result.stats.missingDepRows.length} שורות):</strong>
                <div style={{ color: '#8b4000', fontSize: '12px', marginTop: '4px' }}>
                  שורות {result.stats.missingDepRows.sort((a: number, b: number) => a - b).join(', ')} — ייתכן שמספרי השורות לא תואמים לשורות קיימות בקובץ.
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: '24px', background: '#fee', border: '2px solid #e74c3c', borderRadius: '8px', padding: '16px', color: '#c0392b' }}>
            {error}
          </div>
        )}
      </div>

      {/* הסבר מבנה הקובץ */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', marginTop: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <h3 style={{ margin: '0 0 4px', color: '#1a2332', fontSize: '15px' }}>מבנה הקובץ הנתמך</h3>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#888' }}>קובץ Excel עם העמודות הבאות (לפי סדר)</p>

        {/* Column map table */}
        <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f4f6f8' }}>
                {['עמודה', 'שם', 'תיאור', 'דוגמה'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', border: '1px solid #e0e0e0', textAlign: 'right', color: '#555', fontWeight: 'bold' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { col: 'A', name: 'Start Date',                desc: 'תאריך ושעת התחלה',               example: '15/01/2026 02:00' },
                { col: 'B', name: 'Duration',                  desc: 'משך פעילות (טקסט חופשי)',        example: '45 mins, 1:30h' },
                { col: 'C', name: 'Finish Date',               desc: 'תאריך ושעת סיום',                example: '15/01/2026 04:30' },
                { col: 'D', name: 'CR#',                       desc: 'מספר CR / בקשת שינוי',           example: 'CR-1234' },
                { col: 'E', name: 'Activity Name',             desc: 'שם המשימה (צבע = סוג השורה)',    example: 'הורדת מערכת בילי' },
                { col: 'F', name: 'Application',               desc: 'מערכת / אפליקציה',               example: 'CRM, EAI, OSB' },
                { col: 'G', name: 'Team',                      desc: 'שם הצוות האחראי',                example: 'NOC, EAI Team' },
                { col: 'H', name: 'Resource Names',            desc: 'שם העובד האחראי',               example: 'ישראל ישראלי' },
                { col: 'I', name: 'Predecessors',              desc: 'תלויות — מספרי שורה מופרדים בפסיק', example: '3, 7' },
              ].map((r, i) => (
                <tr key={r.col} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={{ padding: '7px 12px', border: '1px solid #e0e0e0', fontWeight: 'bold', color: '#1a2332', textAlign: 'center' }}>{r.col}</td>
                  <td style={{ padding: '7px 12px', border: '1px solid #e0e0e0', fontWeight: 'bold', color: '#2d4a7a', whiteSpace: 'nowrap' }}>{r.name}</td>
                  <td style={{ padding: '7px 12px', border: '1px solid #e0e0e0', color: '#555' }}>{r.desc}</td>
                  <td style={{ padding: '7px 12px', border: '1px solid #e0e0e0', color: '#888', fontStyle: 'italic' }}>{r.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Row type color legend */}
        <h4 style={{ margin: '0 0 10px', color: '#1a2332', fontSize: '13px' }}>סוג שורה לפי צבע רקע (עמודה B)</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { hex: '#00B0F0', label: 'שלב ראשי (Phase)',    example: 'פעילות לילה — HOTNET' },
            { hex: '#BF9000', label: 'תת-שלב (Sub-Phase)',  example: 'הורדת מערכות' },
            { hex: '#FFFFFF', label: 'משימה רגילה',          example: 'הורדת מערכת בילי',  border: true },
            { hex: '#00B050', label: 'נקודת GO/NO GO',       example: 'החלטת GO/NO GO HOTNET' },
            { hex: '#FF0000', label: 'התראה / תזכורת',      example: 'בדיקת תקינות לאחר הקפצה' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '24px', height: '24px', background: item.hex, borderRadius: '4px', border: (item as any).border ? '1px solid #ddd' : 'none', flexShrink: 0 }} />
              <div>
                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>{item.label}</span>
                <span style={{ color: '#999', fontSize: '12px', marginRight: '8px' }}>— {item.example}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};