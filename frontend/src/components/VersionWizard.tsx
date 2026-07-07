import React, { useState } from 'react';
import { C } from '../theme';
import { DateField, DateTimeField, DateRangeField, formatDMY } from './DatePicker';

const formatDMYTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${formatDMY(iso)} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
};

type Method = 'manual' | 'template' | 'excel';

interface NewVersionState {
  name: string; description: string; plannedStart: string; plannedEnd: string;
  reviewMeetingTime: string; workPlanMeetingTime: string;
  integrationStart: string; integrationEnd: string; qaStart: string; qaEnd: string;
  plannedRehearsalStart: string; plannedRehearsalEnd: string;
  qcReleaseId: string;
}

interface QcRelease {
  id: string; relId: number; relName: string;
  goLiveDate?: string; rehearsalDate?: string; filterDate?: string; relEndDate?: string;
}

interface Template { id: string; name: string; description?: string; }

interface Props {
  newVersion: NewVersionState;
  setNewVersion: React.Dispatch<React.SetStateAction<NewVersionState>>;
  qcReleases: QcRelease[];
  templates: Template[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  importFile: File | null;
  setImportFile: (f: File | null) => void;
  onPlannedStartChange: (val: string) => void;
  onCreateEmpty: () => void;
  onCreateFromTemplate: () => void;
  onImportFromFile: () => void;
  creatingTemplate: boolean;
  creatingFromTemplate: boolean;
  importing: boolean;
  actionError: string | null;
  setActionError: (s: string | null) => void;
  onClose: () => void;
}

// שלב ראשון: פרטי הגרסה | שלב שני: תאריכי בדיקות (אינטגרציה+QA) | שלב שלישי: תאריכי פגישות | שלב רביעי: פעילויות (חזרה+ליל הטמעה) | שלב חמישי: אישור
const STEP_LABELS = ['פרטי גרסה', 'תאריכי בדיקות', 'תאריכי פגישות', 'פעילויות', 'אישור'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px', border: `2px solid ${C.border}`, borderRadius: '8px',
  fontSize: '15px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary,
};
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontWeight: 'bold', color: C.textPrimary, fontSize: '15px' };
const optionalTag = <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}>אופציונלי</span>;

export const VersionWizard: React.FC<Props> = ({
  newVersion, setNewVersion, qcReleases, templates, selectedTemplateId, setSelectedTemplateId,
  importFile, setImportFile, onPlannedStartChange,
  onCreateEmpty, onCreateFromTemplate, onImportFromFile,
  creatingTemplate, creatingFromTemplate, importing,
  actionError, setActionError, onClose,
}) => {
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>('manual');

  const busy = creatingTemplate || creatingFromTemplate || importing;
  const LAST_STEP = STEP_LABELS.length - 1;

  // ── Per-step validity ──────────────────────────────────────────────────────
  const step0Valid =
    !!newVersion.name.trim() &&
    (method !== 'manual' || !!newVersion.description.trim()) &&
    (method !== 'template' || !!selectedTemplateId) &&
    (method !== 'excel' || !!importFile);
  const step1Valid = method !== 'manual' || !!(newVersion.integrationStart && newVersion.integrationEnd && newVersion.qaStart && newVersion.qaEnd);
  const step2Valid = true; // meetings are always optional
  const step3Valid = method === 'manual' || !!newVersion.plannedStart; // go-live start required for template/excel

  const canProceed = [step0Valid, step1Valid, step2Valid, step3Valid, true][step];

  const handleFinish = () => {
    if (method === 'manual') onCreateEmpty();
    else if (method === 'template') onCreateFromTemplate();
    else onImportFromFile();
  };

  const missingLabels = (() => {
    if (step === 0) {
      return [
        !newVersion.name.trim() && 'שם גרסה',
        method === 'manual' && !newVersion.description.trim() && 'תיאור',
        method === 'template' && !selectedTemplateId && 'בחירת תבנית',
        method === 'excel' && !importFile && 'בחירת קובץ Excel',
      ].filter(Boolean) as string[];
    }
    if (step === 1 && method === 'manual') {
      return [
        !newVersion.integrationStart && 'תאריך תחילת אינטגרציה',
        !newVersion.integrationEnd && 'תאריך סיום אינטגרציה',
        !newVersion.qaStart && 'תאריך תחילת QA',
        !newVersion.qaEnd && 'תאריך סיום QA',
      ].filter(Boolean) as string[];
    }
    if (step === 3 && method !== 'manual') {
      return [!newVersion.plannedStart && 'תאריך ושעת ליל ההטמעה'].filter(Boolean) as string[];
    }
    return [];
  })();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, direction: 'rtl' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,20,40,0.72)', backdropFilter: 'blur(2px)' }} />

      <div style={{
        position: 'relative', zIndex: 1, maxWidth: 760,
        margin: '32px auto', background: 'white', borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.45)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 64px)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 28px 16px', background: 'linear-gradient(135deg, #1a2332 0%, #2d4a7a 100%)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 'bold', letterSpacing: '0.3px' }}>📋 יצירת גרסה חדשה</div>
            <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '3px' }}>{newVersion.name || 'ללא שם עדיין'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: '15px', cursor: 'pointer', padding: '7px 14px', borderRadius: '8px' }}>
            ✕ ביטול
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: '14px 28px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            {STEP_LABELS.map((label, i) => {
              const isActive = step === i;
              const isDone = step > i;
              const bg = isActive ? '#2d4a7a' : isDone ? '#16a34a' : '#e2e8f0';
              const fg = (isActive || isDone) ? 'white' : '#64748b';
              return (
                <React.Fragment key={i}>
                  <button
                    onClick={() => { if (i <= step) setStep(i); }}
                    disabled={i > step}
                    style={{ flex: 1, padding: '8px 6px', border: 'none', borderRadius: '8px', cursor: i <= step ? 'pointer' : 'default', background: bg, color: fg, fontSize: '14px', fontWeight: isActive ? 700 : 500, transition: 'background 0.2s', lineHeight: 1.4 }}
                  >
                    <div style={{ fontSize: '15px', marginBottom: '3px' }}>{isDone ? '✅' : isActive ? '●' : `${i + 1}`}</div>
                    {label}
                  </button>
                  {i < STEP_LABELS.length - 1 && (
                    <div style={{ width: '18px', alignSelf: 'center', height: '2px', background: isDone ? '#16a34a' : '#e2e8f0', flexShrink: 0 }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {actionError && (
            <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#b91c1c', fontSize: '15px', display: 'flex', justifyContent: 'space-between' }}>
              <span>⚠️ {actionError}</span>
              <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontWeight: 'bold' }}>×</button>
            </div>
          )}

          {/* ── שלב 1: פרטי גרסה + בחירת שיטה ── */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={labelStyle}>איך רוצים ליצור את הגרסה?</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  {([
                    { key: 'manual',   icon: '✏️', label: 'ידנית', desc: 'הזן פרטים ובנה תוכנית בהמשך' },
                    { key: 'template', icon: '📋', label: 'מתבנית שמורה', desc: 'שכפל מבנה מתבנית קיימת' },
                    { key: 'excel',    icon: '📤', label: 'ייבוא מ-Excel', desc: 'טען קובץ GoLive עם התוכנית המלאה' },
                  ] as const).map(opt => (
                    <div
                      key={opt.key}
                      onClick={() => setMethod(opt.key)}
                      style={{
                        cursor: 'pointer', borderRadius: '10px', padding: '14px 10px', textAlign: 'center',
                        border: `2px solid ${method === opt.key ? C.brand : C.border}`,
                        background: method === opt.key ? `${C.brand}0d` : C.bgNested,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '22px', marginBottom: '4px' }}>{opt.icon}</div>
                      <div style={{ fontWeight: 'bold', fontSize: '15px', color: method === opt.key ? C.brand : C.textPrimary }}>{opt.label}</div>
                      <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '2px' }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>
                  שם גרסה <span style={{ color: C.statusBlocked }}>*</span>
                  {qcReleases.length === 0 && (
                    <span style={{ fontSize: '13px', color: C.warning, marginRight: '6px', fontWeight: 'normal' }}>(סנכרן גרסאות QC מ-AdminPanel)</span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select
                    value={newVersion.qcReleaseId || '__manual__'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '__manual__') {
                        setNewVersion(v => ({ ...v, qcReleaseId: '', name: v.qcReleaseId ? '' : v.name }));
                      } else {
                        const rel = qcReleases.find(r => r.id === val);
                        setNewVersion(v => ({ ...v, qcReleaseId: val, name: rel?.relName || v.name }));
                      }
                    }}
                    style={{ flexShrink: 0, maxWidth: '150px', padding: '9px 8px', border: `2px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', background: C.bgNested, color: C.textPrimary }}
                  >
                    <option value="__manual__">✏️ ידנית</option>
                    {qcReleases.length > 0 && <option disabled>── QC ──</option>}
                    {[...qcReleases]
                      .sort((a, b) => {
                        if (a.goLiveDate && b.goLiveDate) return new Date(a.goLiveDate).getTime() - new Date(b.goLiveDate).getTime();
                        if (a.goLiveDate) return -1;
                        if (b.goLiveDate) return 1;
                        return a.relName.localeCompare(b.relName, 'he');
                      })
                      .map(r => (
                        <option key={r.id} value={r.id}>
                          {r.relName}{r.goLiveDate ? ` — ${formatDMY(r.goLiveDate)}` : r.relEndDate ? ` — ${formatDMY(r.relEndDate)}` : ''}
                        </option>
                      ))}
                  </select>
                  <input
                    value={newVersion.name}
                    onChange={e => setNewVersion(v => ({ ...v, name: e.target.value, qcReleaseId: '' }))}
                    placeholder="לדוגמה: ITv04-2026"
                    style={{ ...inputStyle, flex: 1, minWidth: 0, border: `2px solid ${newVersion.qcReleaseId ? C.statusDone : C.border}` }}
                  />
                </div>
              </div>

              {method === 'manual' && (
                <div>
                  <label style={labelStyle}>תיאור <span style={{ color: C.statusBlocked }}>*</span></label>
                  <textarea
                    value={newVersion.description}
                    onChange={e => setNewVersion({ ...newVersion, description: e.target.value })}
                    placeholder="תיאור קצר של הגרסה"
                    rows={3}
                    style={{ ...inputStyle, border: `2px solid ${!newVersion.description.trim() ? C.statusBlocked : C.statusDone}`, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              )}

              {method === 'template' && (
                <div>
                  <label style={labelStyle}>תבנית <span style={{ color: C.statusBlocked }}>*</span></label>
                  {templates.length > 0 ? (
                    <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}
                      style={{ ...inputStyle, border: `2px solid ${selectedTemplateId ? C.statusDone : C.statusBlocked}` }}>
                      <option value="">📋 בחר תבנית שמורה</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>)}
                    </select>
                  ) : (
                    <div style={{ fontSize: '15px', color: C.textMuted, fontStyle: 'italic' }}>אין תבניות שמורות — צור תבנית קודם, או בחר שיטה אחרת</div>
                  )}
                </div>
              )}

              {method === 'excel' && (
                <div>
                  <label style={labelStyle}>קובץ Excel <span style={{ color: C.statusBlocked }}>*</span></label>
                  <div style={{ border: `2px dashed ${importFile ? C.statusDone : '#c0d4e8'}`, borderRadius: '8px', padding: '24px', textAlign: 'center', background: '#f8fafc', cursor: 'pointer' }}
                    onClick={() => document.getElementById('wizard-file-input')?.click()}>
                    <div style={{ fontSize: '32px', marginBottom: '6px' }}>📂</div>
                    {importFile ? (
                      <div style={{ fontWeight: 'bold', color: C.textPrimary, fontSize: '15px' }}>{importFile.name}</div>
                    ) : (
                      <div style={{ color: C.textMuted, fontSize: '15px' }}>לחץ לבחירת קובץ (xlsx, xls)</div>
                    )}
                  </div>
                  <input id="wizard-file-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => setImportFile(e.target.files?.[0] || null)} />
                </div>
              )}
            </div>
          )}

          {/* ── שלב 2: תאריכי בדיקות (אינטגרציה + QA) ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>🔧 תאריכי אינטגרציה {method === 'manual' ? <span style={{ color: C.statusBlocked }}>*</span> : optionalTag}</div>
                <DateRangeField
                  startIso={newVersion.integrationStart}
                  endIso={newVersion.integrationEnd}
                  onChange={(s, e) => setNewVersion({ ...newVersion, integrationStart: s, integrationEnd: e })}
                  style={method === 'manual' ? { ...inputStyle, border: `2px solid ${!newVersion.integrationStart ? C.statusBlocked : C.statusDone}` } : inputStyle}
                />
              </div>

              <div>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>🧪 תאריכי בדיקות QA {method === 'manual' ? <span style={{ color: C.statusBlocked }}>*</span> : optionalTag}</div>
                <DateRangeField
                  startIso={newVersion.qaStart}
                  endIso={newVersion.qaEnd}
                  onChange={(s, e) => setNewVersion({ ...newVersion, qaStart: s, qaEnd: e })}
                  style={method === 'manual' ? { ...inputStyle, border: `2px solid ${!newVersion.qaStart ? C.statusBlocked : C.statusDone}` } : inputStyle}
                />
              </div>

              {method !== 'manual' && (
                <div style={{ fontSize: '14px', color: C.textMuted, fontStyle: 'italic' }}>
                  אם לא ממולא, ניתן להשלים מאוחר יותר דרך פרטי הגרסה.
                </div>
              )}
            </div>
          )}

          {/* ── שלב 3: תאריכי פגישות ── */}
          {step === 2 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>📅 ישיבת סקירת CR-ים <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}>T−10 ימי עבודה</span></label>
                <DateTimeField value={newVersion.reviewMeetingTime}
                  onChange={v => setNewVersion({ ...newVersion, reviewMeetingTime: v })}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>📋 ישיבת הצגת תוכנית עליה לאוויר <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}>T−9 ימי עבודה</span></label>
                <DateTimeField value={newVersion.workPlanMeetingTime}
                  onChange={v => setNewVersion({ ...newVersion, workPlanMeetingTime: v })}
                  style={inputStyle} />
              </div>
            </div>
          )}

          {/* ── שלב 4: פעילויות — חזרה גנרלית + ליל ההטמעה ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>🎭 חזרה גנרלית <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}>אופציונלי</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={labelStyle}>תחילה</label>
                    <DateTimeField value={newVersion.plannedRehearsalStart}
                      onChange={v => setNewVersion({ ...newVersion, plannedRehearsalStart: v })}
                      style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>סיום</label>
                    <DateTimeField value={newVersion.plannedRehearsalEnd}
                      onChange={v => setNewVersion({ ...newVersion, plannedRehearsalEnd: v })}
                      style={inputStyle} />
                  </div>
                </div>
              </div>

              <div>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>
                  🚀 ליל ההטמעה {method !== 'manual' && <span style={{ color: C.statusBlocked }}>*</span>}
                  {method === 'manual' && <span style={{ fontSize: '12px', color: C.textMuted, fontWeight: 'normal' }}> אופציונלי</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={labelStyle}>תחילה</label>
                    <DateTimeField value={newVersion.plannedStart}
                      onChange={v => onPlannedStartChange(v)}
                      style={method !== 'manual' ? { ...inputStyle, border: `2px solid ${!newVersion.plannedStart ? C.statusBlocked : C.statusDone}` } : inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>סיום</label>
                    <DateTimeField value={newVersion.plannedEnd}
                      onChange={v => setNewVersion({ ...newVersion, plannedEnd: v })}
                      style={inputStyle} />
                  </div>
                </div>
                {method === 'excel' && (
                  <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '4px' }}>אם לא ממולא, ייקחו התאריכים מהקובץ</div>
                )}
              </div>
            </div>
          )}

          {/* ── שלב 5: סקירה ואישור ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '15px', color: C.textMuted, marginBottom: '4px' }}>
                שיטת יצירה: <strong style={{ color: C.textPrimary }}>{method === 'manual' ? 'ידנית' : method === 'template' ? 'מתבנית שמורה' : 'ייבוא מ-Excel'}</strong>
              </div>
              {[
                ['שם גרסה', newVersion.name],
                ...(method === 'manual' ? [['תיאור', newVersion.description]] : []),
                ...(method === 'template' ? [['תבנית', templates.find(t => t.id === selectedTemplateId)?.name || '—']] : []),
                ...(method === 'excel' ? [['קובץ', importFile?.name || '—']] : []),
                ['תחילת אינטגרציה', formatDMY(newVersion.integrationStart)],
                ['סיום אינטגרציה', formatDMY(newVersion.integrationEnd)],
                ['תחילת QA', formatDMY(newVersion.qaStart)],
                ['סיום QA', formatDMY(newVersion.qaEnd)],
                ['ישיבת סקירת CR', formatDMYTime(newVersion.reviewMeetingTime)],
                ['ישיבת מעבר', formatDMYTime(newVersion.workPlanMeetingTime)],
                ['חזרה גנרלית — תחילה', formatDMYTime(newVersion.plannedRehearsalStart)],
                ['חזרה גנרלית — סיום', formatDMYTime(newVersion.plannedRehearsalEnd)],
                ['ליל ההטמעה — תחילה', formatDMYTime(newVersion.plannedStart)],
                ['ליל ההטמעה — סיום', formatDMYTime(newVersion.plannedEnd)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: C.bgNested, borderRadius: '6px', fontSize: '15px' }}>
                  <span style={{ color: C.textMuted }}>{label}</span>
                  <span style={{ color: C.textPrimary, fontWeight: 'bold' }}>{value || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {step < LAST_STEP && missingLabels.length > 0 && (
            <p style={{ margin: '14px 0 0', fontSize: '14px', color: C.danger }}>יש למלא: {missingLabels.join(', ')}</p>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', flexShrink: 0, background: '#f8fafc' }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{ padding: '9px 18px', background: step === 0 ? '#f1f5f9' : '#e2e8f0', border: 'none', borderRadius: '8px', cursor: step === 0 ? 'not-allowed' : 'pointer', color: step === 0 ? '#94a3b8' : '#374151', fontSize: '15px' }}
          >
            ← הקודם
          </button>

          {step < LAST_STEP ? (
            <button
              onClick={() => setStep(s => Math.min(LAST_STEP, s + 1))}
              disabled={!canProceed}
              style={{ padding: '9px 24px', background: canProceed ? C.brand : C.textDisabled, color: 'white', border: 'none', borderRadius: '8px', cursor: canProceed ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '15px' }}
            >
              הבא ←
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={busy}
              style={{ padding: '9px 24px', background: busy ? C.textDisabled : C.statusDone, color: 'white', border: 'none', borderRadius: '8px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '15px' }}
            >
              {busy ? 'יוצר...' : '✓ צור גרסה'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
