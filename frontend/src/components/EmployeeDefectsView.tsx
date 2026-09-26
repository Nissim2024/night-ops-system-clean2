import React from 'react';
import { SEVERITY_COLOR, hexTint } from './shared/defectFieldDisplay';

interface Props {
  versionName?: string | null;
  loading: boolean;
  summary: {
    total: number;
    scopeKind: 'all' | 'team' | 'personal';
    scopedTotal: number;
    scopedOpen: number;
    bySeverity: { label: string; count: number }[];
  } | null;
}

// Employee-facing version of the "תקלות" KPI tile already shown to team leads
// on HomeDashboard — same data (getHomeDefectsSummary), same visual language
// (severity pills via SEVERITY_COLOR/hexTint), just a full-page view instead
// of a small tile, since employees have no Home widget space reserved for it.
export const EmployeeDefectsView: React.FC<Props> = ({ versionName, loading, summary }) => {
  if (loading) {
    return (
      <div className="text-center p-20 text-subtle-foreground">
        <div className="text-5xl">🪲</div>
        <p className="text-[17px] mt-3">טוען...</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center p-20 text-subtle-foreground bg-card rounded-2xl border border-border">
        <div className="text-6xl">🪲</div>
        <h2 className="text-foreground mt-4">אין מידע על תקלות כרגע</h2>
        <p>לא נמצאה גרסה פעילה עם נתוני תקלות</p>
      </div>
    );
  }

  const scopeLabel = summary.scopeKind === 'team' ? 'תקלות הצוות שלי' : 'התקלות שלי';

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold text-foreground mb-1">🪲 תקלות{versionName ? ` — ${versionName}` : ''}</h2>
      <p className="text-sm text-subtle-foreground mb-5">נתוני התקלות מוצגים עבור הגרסה הרלוונטית לתפקידך.</p>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[220px] rounded-lg border border-border bg-card px-5 py-4">
          <div className="text-2xl font-bold leading-tight text-foreground">{summary.total}</div>
          <div className="mt-1 text-xs text-subtle-foreground">סה״כ תקלות בגרסה</div>
          <div className="mt-1 text-xs text-subtle-foreground">בכל הצוותים</div>
        </div>

        {summary.scopeKind !== 'all' && summary.scopedTotal > 0 && (
          <div className="flex-1 min-w-[220px] rounded-lg border border-border bg-card px-5 py-4">
            <div className="text-2xl font-bold leading-tight text-foreground">{summary.scopedTotal}</div>
            <div className="mt-1 text-xs text-subtle-foreground">{scopeLabel}</div>
            <div className={`mt-1 text-xs ${summary.scopedOpen > 0 ? 'text-warning' : 'text-success'}`}>
              {summary.scopedOpen > 0 ? `${summary.scopedOpen} פתוחות` : 'הכל סגור'}
            </div>
            {summary.bySeverity.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {summary.bySeverity.map(s => {
                  const color = SEVERITY_COLOR[s.label] ?? '#64748b';
                  return (
                    <span
                      key={s.label}
                      style={{ color, background: hexTint(color) }}
                      className="text-xs font-semibold rounded-full px-2 py-0.5"
                    >
                      {s.count} {s.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {summary.scopeKind !== 'all' && summary.scopedTotal === 0 && (
          <div className="flex-1 min-w-[220px] rounded-lg border border-border bg-card px-5 py-4 text-sm text-subtle-foreground">
            אין תקלות פתוחות המשויכות אליך בגרסה זו.
          </div>
        )}
      </div>
    </div>
  );
};
