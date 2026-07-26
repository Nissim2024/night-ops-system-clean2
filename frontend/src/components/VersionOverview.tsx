import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, WEIGHT, RADIUS, SHADOW } from '../theme';
import { VersionStatusChip } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  version: any;
  token: string;
  onJumpToStep: (view: string) => void;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

// A compact "landing" summary for the version-management module — reachable
// via the sidebar's "סקירה כללית" and the module's own default view. Gives a
// glance at all 4 lifecycle steps + every version-level date field in one
// place, with each row jumping straight into the step/screen that owns it,
// instead of always opening the module on the last-visited step (or, from
// Home, always on 'open').
export const VersionOverview: React.FC<Props> = ({ version, token, onJumpToStep }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState<{ needsAttention: boolean; syncStatus: string }[]>([]);
  const [effortDays, setEffortDays] = useState<number | null>(null);

  useEffect(() => {
    axios.get(`${API}/version-cr-assignments/version/${version.id}`, { headers })
      .then(r => setRows(r.data ?? []))
      .catch(() => setRows([]));
    axios.get(`${API}/version-cr-assignments/version/${version.id}/stats`, { headers })
      .then(r => setEffortDays(r.data?.totalEstimateDays ?? null))
      .catch(() => setEffortDays(null));
  }, [version.id]); // eslint-disable-line

  const activeRows = rows.filter(r => r.syncStatus !== 'REMOVED');
  const attentionCount = new Set(rows.filter(r => r.needsAttention).map((r: any) => r.crNumber)).size;
  const activeCrCount = new Set(activeRows.map((r: any) => r.crNumber)).size;

  const datesComplete = !!(version.integrationStart && version.integrationEnd && version.plannedStart);
  const scopeExists = activeRows.length > 0;
  const scopeApproved = !!version.scopeApprovedAt;

  const goLive = version.plannedStart ? new Date(version.plannedStart) : null;
  const daysToGoLive = goLive ? Math.ceil((goLive.getTime() - Date.now()) / 86400000) : null;
  const goLiveLabel = !goLive ? null
    : daysToGoLive! < 0 ? '⚠ תאריך היעד חלף'
    : daysToGoLive === 0 ? '🚀 עולים לאוויר היום'
    : `🚀 בעוד ${daysToGoLive} ${daysToGoLive === 1 ? 'יום' : 'ימים'}`;

  const steps: { label: string; done: boolean; detail: string; view: string }[] = [
    {
      label: 'פתיחת גרסה', done: datesComplete, view: 'open',
      detail: datesComplete ? `הושלם · עלייה לאוויר ${fmtDateTime(version.plannedStart)}` : 'חסרים תאריכי אינטגרציה ו/או יעד עלייה לאוויר',
    },
    {
      label: 'תכולת משימות', done: scopeExists, view: 'manage',
      detail: scopeExists
        ? `${activeCrCount} CR-ים פעילים${attentionCount > 0 ? ` · ${attentionCount} דורשים תשומת לב ⚠` : ''}`
        : 'אין עדיין CR-ים בתכולה — יש לסנכרן מ-CR_LIST',
    },
    {
      label: 'אישור תכולה', done: scopeApproved, view: 'approve',
      detail: scopeApproved ? `אושר ב-${fmtDate(version.scopeApprovedAt)}` : scopeExists && datesComplete ? 'ממתין לאישור' : 'ממתין להשלמת השלבים הקודמים',
    },
    {
      label: 'ניהול שינויים', done: false, view: 'changes',
      detail: scopeApproved ? (attentionCount > 0 ? `${attentionCount} שינויי תכולה ממתינים לאישור מחדש ⚠` : 'אין שינויים ממתינים') : 'זמין לאחר אישור תכולה',
    },
  ];

  return (
    <div style={{ fontFamily: FONT, direction: 'rtl' }}>
      {/* ── Header ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '18px 24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>{version.name}</span>
          <VersionStatusChip status={version.status} size="md" />
          {goLiveLabel && (
            <span style={{
              fontSize: '13px', fontWeight: WEIGHT.bold, color: daysToGoLive! < 0 ? C.danger : C.brand,
              background: daysToGoLive! < 0 ? C.dangerBg : C.brandDim, borderRadius: RADIUS.full, padding: '3px 12px',
            }}>
              {goLiveLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Step status list ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, marginBottom: '16px', overflow: 'hidden' }}>
        {steps.map((s, i) => (
          <div
            key={s.view}
            onClick={() => onJumpToStep(s.view)}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer',
              borderTop: i > 0 ? `1px solid ${C.border}` : 'none',
            }}
          >
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
              background: s.done ? C.success : C.bgNested, border: `2px solid ${s.done ? C.success : C.borderEm}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {s.done && (
                <svg width="11" height="9" viewBox="0 0 12 10" fill="none">
                  <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{s.label}</div>
              <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '2px' }}>{s.detail}</div>
            </div>
            <span style={{ fontSize: '13px', color: C.brand, fontWeight: WEIGHT.semibold, flexShrink: 0 }}>פתח ›</span>
          </div>
        ))}
      </div>

      {/* ── Dates card ── */}
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '18px 24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>📅 תאריכי גרסה</span>
          <span onClick={() => onJumpToStep('open')} style={{ fontSize: '13px', color: C.brand, fontWeight: WEIGHT.semibold, cursor: 'pointer' }}>ערוך ›</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px 24px' }}>
          {[
            ['תחילת אינטגרציה', fmtDate(version.integrationStart)],
            ['סיום אינטגרציה', fmtDate(version.integrationEnd)],
            ['תחילת QA', fmtDate(version.qaStart)],
            ['סיום QA', fmtDate(version.qaEnd)],
            ['עלייה לאוויר', fmtDateTime(version.plannedStart)],
            ['ישיבת סקירה', fmtDateTime(version.reviewMeetingTime)],
            ['ישיבת תוכנית עבודה', fmtDateTime(version.workPlanMeetingTime)],
            ['מועד הגשת תוכניות', fmtDateTime(version.submissionDeadline)],
            ['מועד אישור תוכניות', fmtDateTime(version.approvalDeadline)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: C.textMuted }}>{label}</span>
              <span style={{ color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Effort ── */}
      {effortDays !== null && (
        <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '15px' }}>📊</span>
          <span style={{ fontSize: '14px', color: C.textSecondary }}>הערכת מאמץ כוללת:</span>
          <span style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.brand }}>{effortDays} ימ"ע</span>
          <span onClick={() => onJumpToStep('manage')} style={{ fontSize: '13px', color: C.brand, fontWeight: WEIGHT.semibold, cursor: 'pointer', marginRight: 'auto' }}>פירוט לפי צוות ›</span>
        </div>
      )}
    </div>
  );
};
