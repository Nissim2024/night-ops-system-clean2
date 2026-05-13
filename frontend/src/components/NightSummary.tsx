import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = 'http://localhost:3000';

interface Props {
  token: string;
  versionId: string;
  versionName: string;
}

interface CRRow {
  id: number;
  projectName: string;
  title: string;
  crNumber: string;
  testerVersion: string;
  testerNight: string;
  executionStatus: string;
  notes: string;
}

export const NightSummary: React.FC<Props> = ({ token, versionId, versionName }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [headline, setHeadline] = useState('');
  const [morningNotes, setMorningNotes] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [crRows, setCrRows] = useState<CRRow[]>([
    { id: 1, projectName: '', title: '', crNumber: '', testerVersion: '', testerNight: '', executionStatus: 'Passed', notes: '' },
  ]);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchTasks = async () => {
      try {
const res = await axios.get(`${API}/tasks?versionId=${versionId}`, { headers });        setTasks(res.data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchTasks();
  }, [versionId]);

  const doneTasks = tasks.filter(t => t.status === 'DONE');
  const blockedTasks = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED');
  const inProgressTasks = tasks.filter(t => t.status === 'IN_PROGRESS');
  const openTasks = tasks.filter(t => t.status === 'OPEN');
  const waitingTasks = tasks.filter(t => t.status === 'WAITING');
  const progressPercent = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const nonWaitingTasks = tasks.filter(t => t.status !== 'WAITING');
  const incompleteCount = nonWaitingTasks.filter(t => t.status !== 'DONE').length;
  const isGoNogo = nonWaitingTasks.length > 0 && blockedTasks.length === 0 && incompleteCount === 0;
  const canDownload = isGoNogo;

  const addCRRow = () => {
    setCrRows(prev => [...prev, { id: Date.now(), projectName: '', title: '', crNumber: '', testerVersion: '', testerNight: '', executionStatus: 'Passed', notes: '' }]);
  };

  const updateCRRow = (id: number, field: keyof CRRow, value: string) => {
    setCrRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeCRRow = (id: number) => {
    setCrRows(prev => prev.filter(r => r.id !== id));
  };

  const downloadWord = async () => {
    if (!canDownload) {
      alert('לא ניתן להוציא סיכום — ההטמעה לא הסתיימה בהצלחה.\nיש משימות פתוחות או חסומות.');
      return;
    }
    try {
      const res = await axios.post(`${API}/summary/generate`, {
        versionId, versionName, headline, morningNotes,
      }, { headers, responseType: 'blob' });

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `summary-${versionName}-${new Date().toISOString().slice(0, 10)}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('שגיאה בהורדת הקובץ');
    }
  };

  const copyToClipboard = () => {
    if (!canDownload) {
      alert('לא ניתן להעתיק סיכום — ההטמעה לא הסתיימה בהצלחה.');
      return;
    }
    let text = `להלן סיכום לעלייה לאוויר של גרסת ${versionName}:\n\n`;
    text += `${headline}\n\n`;
    text += `סטטוס: ${isGoNogo ? 'GO ✅' : 'NO GO ❌'}\n`;
    text += `הושלמו ${doneTasks.length}/${tasks.length} משימות\n\n`;
    if (blockedTasks.length > 0) {
      text += `תקלות:\n`;
      blockedTasks.forEach(t => { text += `- ${t.title}: ${t.blockedReason || ''}\n`; });
      text += '\n';
    }
    if (morningNotes) text += `לתשומת לב צוות הבוקר:\n${morningNotes}\n`;
    navigator.clipboard.writeText(text);
    alert('הסיכום הועתק ללוח!');
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>טוען...</div>;

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#1a2332', margin: 0 }}>סיכום לילה — {versionName}</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setPreviewMode(!previewMode)} style={{ padding: '8px 16px', background: previewMode ? '#1a2332' : '#f0f0f0', color: previewMode ? 'white' : '#333', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
            {previewMode ? 'עריכה' : 'תצוגה מקדימה'}
          </button>
          <button onClick={copyToClipboard} disabled={!canDownload} style={{ padding: '8px 16px', background: canDownload ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canDownload ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold' }}>
            העתק סיכום
          </button>
          <button onClick={downloadWord} disabled={!canDownload} style={{ padding: '8px 16px', background: canDownload ? '#2d4a7a' : '#ccc', color: 'white', border: 'none', borderRadius: '8px', cursor: canDownload ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 'bold' }}>
            הורד Word
          </button>
        </div>
      </div>

      {/* GO/NO GO Banner */}
      <div style={{ background: isGoNogo ? '#d5f0dc' : '#fee', border: `2px solid ${isGoNogo ? '#27ae60' : '#e74c3c'}`, borderRadius: '12px', padding: '16px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '22px', fontWeight: 'bold', color: isGoNogo ? '#27ae60' : '#e74c3c' }}>
            {isGoNogo ? '✅ GO — ניתן להוציא סיכום' : '🛑 NO GO — לא ניתן להוציא סיכום'}
          </span>
          {!isGoNogo && (
            <div style={{ fontSize: '13px', color: '#e74c3c', marginTop: '4px' }}>
              {incompleteCount > 0 && <span>{incompleteCount} משימות לא הושלמו | </span>}
              {blockedTasks.length > 0 && <span>{blockedTasks.length} משימות חסומות</span>}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: isGoNogo ? '#27ae60' : '#e74c3c' }}>{progressPercent}%</div>
          <div style={{ fontSize: '12px', color: '#666' }}>הושלם</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#666' }}>
          <span>התקדמות כללית</span>
          <span>{doneTasks.length}/{tasks.length} משימות</span>
        </div>
        <div style={{ background: '#f0f0f0', borderRadius: '8px', height: '14px', overflow: 'hidden', marginBottom: '16px' }}>
          <div style={{ background: isGoNogo ? '#27ae60' : '#3498db', width: `${progressPercent}%`, height: '100%', borderRadius: '8px', transition: 'width 0.5s' }} />
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {[
            { label: 'הושלמו', value: doneTasks.length, color: '#27ae60' },
            { label: 'בביצוע', value: inProgressTasks.length, color: '#f39c12' },
            { label: 'פתוחות', value: openTasks.length, color: '#3498db' },
            { label: 'ממתינות', value: waitingTasks.length, color: '#9b59b6' },
            { label: 'חסומות', value: blockedTasks.length, color: '#e74c3c' },
          ].map(s => (
            <div key={s.label} style={{ background: s.color + '22', color: s.color, padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>
              {s.value} {s.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* עיקרי הדברים */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 12px', color: '#1a2332', fontSize: '15px' }}>עיקרי הדברים</h3>
          <textarea value={headline} onChange={e => setHeadline(e.target.value)}
            placeholder="לדוגמה: העלאת הגרסה הסתיימה בהצלחה בהוט ובהוטנט"
            rows={3} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl' }} />
        </div>

        {/* תקלות */}
        {blockedTasks.length > 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #e74c3c' }}>
            <h3 style={{ margin: '0 0 12px', color: '#e74c3c', fontSize: '15px' }}>תקלות ({blockedTasks.length})</h3>
            {blockedTasks.map(task => (
              <div key={task.id} style={{ background: '#fee', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', color: '#c0392b', fontSize: '14px' }}>{task.title}</div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  {task.assignedTeam?.name && <span>צוות: {task.assignedTeam.name} | </span>}
                  {task.blockedReason && <span>סיבה: {task.blockedReason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* תכולה שנבדקה — ממלא ידנית */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#1a2332', fontSize: '15px' }}>תכולה שנבדקה (CRים)</h3>
            <button onClick={addCRRow} style={{ padding: '4px 12px', background: '#1a2332', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>+ הוסף שורה</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  {['פרויקט אב', 'כותרת', 'CR#', 'בודק בגרסה', 'בודק בלילה', 'Execution Status', 'הערות', ''].map(h => (
                    <th key={h} style={{ padding: '8px', textAlign: 'right', color: '#333', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crRows.map(row => (
                  <tr key={row.id}>
                    {(['projectName', 'title', 'crNumber', 'testerVersion', 'testerNight'] as (keyof CRRow)[]).map(field => (
                      <td key={field} style={{ padding: '4px' }}>
                        <input value={row[field] as string} onChange={e => updateCRRow(row.id, field, e.target.value)}
                          style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px', minWidth: '80px' }} />
                      </td>
                    ))}
                    <td style={{ padding: '4px' }}>
                      <select value={row.executionStatus} onChange={e => updateCRRow(row.id, 'executionStatus', e.target.value)}
                        style={{ padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px' }}>
                        <option value="Passed">Passed</option>
                        <option value="Failed">Failed</option>
                        <option value="Partial">Partial</option>
                      </select>
                    </td>
                    <td style={{ padding: '4px' }}>
                      <input value={row.notes} onChange={e => updateCRRow(row.id, 'notes', e.target.value)}
                        style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '12px', minWidth: '80px' }} />
                    </td>
                    <td style={{ padding: '4px' }}>
                      <button onClick={() => removeCRRow(row.id)} style={{ padding: '4px 8px', background: '#fee', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>מחק</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* הערות לצוות הבוקר */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 12px', color: '#1a2332', fontSize: '15px' }}>הערות לצוות הבוקר</h3>
          <textarea value={morningNotes} onChange={e => setMorningNotes(e.target.value)}
            placeholder="פריטים שדורשים מעקב בוקר..."
            rows={3} style={{ width: '100%', padding: '10px', border: '2px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'Arial', direction: 'rtl' }} />
        </div>
      </div>
    </div>
  );
};