import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { C, FONT } from '../theme';
import { formatDate } from '../utils/dateFormat';
import { cleanHtmlText } from '../utils/textSanitize';
import { usePermissions } from '../context/PermissionsContext';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Version templates — moved out of AdminPanel (2026-10-05) so the הטמעות
// module's menu can show it too ("תבניות גרסה"), where templates are actually
// used. Delete follows the permissions table (action:template_delete).
export const VersionTemplatesView: React.FC<{ token: string }> = ({ token }) => {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const { can } = usePermissions();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API}/version-templates`, { headers });
      setTemplates(res.data ?? []);
    } catch {
      setError('שגיאה בטעינת תבניות');
    } finally {
      setLoading(false);
    }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm('למחוק את התבנית?')) return;
    setDeletingId(id);
    try {
      await axios.delete(`${API}/version-templates/${id}`, { headers });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שגיאה במחיקת התבנית');
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = can('action:template_delete');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: C.bgNested, borderRadius: '12px', padding: '16px 20px', border: `1px solid ${C.border}`, fontSize: '15px', color: C.textSecondary, lineHeight: '1.7' }}>
        <strong style={{ color: C.textPrimary, display: 'block', marginBottom: '6px' }}>מהן תבניות גרסה?</strong>
        <p style={{ margin: 0 }}>
          תבנית היא "צילום" של תוכנית לילה קיימת — שלבים, משימות, שיוכי צוות — שניתן להשתמש בה ליצירת גרסאות עתידיות.
          ליצירת תבנית: פתח גרסה קיימת ← לחץ <strong>שמור כתבנית</strong>. בעת יצירת גרסה חדשה בחר "מתבנית" ותקבל את כל המשימות מוכנות לעריכה.
        </p>
      </div>
      <div style={{ background: C.bgCard, borderRadius: '12px', padding: '24px', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', color: C.textPrimary }}>📁 תבניות גרסה ({templates.length})</h3>
            <p style={{ margin: 0, fontSize: '15px', color: C.textMuted }}>תבניות שמורות ליצירת גרסאות עתידיות</p>
          </div>
          <button onClick={load} disabled={loading}
            style={{ padding: '8px 16px', background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '15px', color: C.textSecondary, fontFamily: FONT }}>
            {loading ? '...' : '🔄 רענן'}
          </button>
        </div>
        {error && (
          <div style={{ background: C.bgBlocked, border: `1px solid ${C.statusFailed}44`, borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '15px', color: C.statusFailed }}>
            ⚠️ {error}
            <button onClick={() => setError(null)} style={{ marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.statusFailed, fontWeight: 'bold' }}>×</button>
          </div>
        )}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>טוען תבניות...</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📭</div>
            <p>אין תבניות שמורות — שמור תבנית מגרסה קיימת</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {templates.map((t: any) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', border: `1px solid ${C.border}`, borderRadius: '10px', background: C.bgNested }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: C.textPrimary }}>{t.name}</div>
                  {t.description && <div style={{ fontSize: '14px', color: C.textMuted, marginTop: '2px' }}>{cleanHtmlText(t.description)}</div>}
                  <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '4px' }}>
                    נוצר ע"י {t.creator?.fullName ?? '—'} · {t.createdAt ? formatDate(t.createdAt) : ''}
                  </div>
                </div>
                {canDelete && (
                  <button
                    disabled={deletingId === t.id}
                    onClick={() => remove(t.id)}
                    style={{ padding: '7px 16px', background: deletingId === t.id ? C.bgHover : C.statusFailed, color: deletingId === t.id ? C.textDisabled : 'white', border: 'none', borderRadius: '8px', cursor: deletingId === t.id ? 'not-allowed' : 'pointer', fontSize: '15px', whiteSpace: 'nowrap', fontFamily: FONT }}
                  >
                    {deletingId === t.id ? 'מוחק...' : '🗑 מחק'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
