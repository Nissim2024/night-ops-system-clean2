import React, { useState } from 'react';
// DateField/DateTimeField/DateRangeField/TimeField (unmigrated) only accept a
// `style` prop, not className — the style objects still feeding them below
// (inputStyle / validBorder) are the deliberate exception to the className
// migration in this file, mirroring the same convention used in
// PlanWizard.tsx. `C` is kept only for that purpose; every other visual has
// moved to Tailwind classes. Colors with no equivalent design token (this
// wizard's own one-off navy header gradient etc.) are preserved as literal
// arbitrary-value classes rather than re-designed.
import { C } from '../theme';
import { cn } from '../lib/utils';
import { DateField, DateTimeField, DateRangeField, TimeField, formatDMY } from './DatePicker';

// formatDMY only parses bare 'YYYY-MM-DD' — split off the date part before
// handing it a full 'YYYY-MM-DDTHH:MM' value, otherwise it silently returns ''.
const formatDMYTime = (iso?: string): string => {
  if (!iso) return '';
  const [datePart, timePart] = iso.split('T');
  return [formatDMY(datePart), timePart].filter(Boolean).join(' ');
};

// Like DateTimeField, but never silently defaults a missing time to 00:00 —
// used for ליל ההטמעה תחילה, where the time must be a real user-entered value
// so "required" validation can actually tell whether it was set.
const StrictDateTimeField: React.FC<{ value: string; onChange: (v: string) => void; style?: React.CSSProperties }> = ({ value, onChange, style }) => {
  const [datePart, timePart] = value ? value.split('T') : ['', ''];
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <DateField value={datePart} onChange={d => onChange(`${d}T${timePart}`)} style={style} />
      </div>
      <TimeField value={timePart} onChange={t => onChange(`${datePart}T${t}`)} />
    </div>
  );
};

type Method = 'manual' | 'template' | 'excel';

interface NewVersionState {
  name: string; description: string; plannedStart: string; plannedEnd: string;
  reviewMeetingTime: string; workPlanMeetingTime: string;
  integrationStart: string; integrationEnd: string; qaStart: string; qaEnd: string;
  plannedRehearsalStart: string; plannedRehearsalEnd: string;
  qcReleaseId: string;
}

interface Template { id: string; name: string; description?: string; }

// A version already created in "ניהול גרסה" (DRAFT, no phases yet) — this
// wizard fills in ITS plan, it no longer creates the version itself.
interface ExistingVersion { id: string; name: string; }

interface Props {
  newVersion: NewVersionState;
  setNewVersion: React.Dispatch<React.SetStateAction<NewVersionState>>;
  existingVersions: ExistingVersion[];
  templates: Template[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  importFile: File | null;
  setImportFile: (f: File | null) => void;
  onPlannedStartChange: (val: string) => void;
  onCreateEmpty: (targetVersionId: string) => void;
  onCreateFromTemplate: (targetVersionId: string) => void;
  onImportFromFile: (targetVersionId: string) => void;
  creatingTemplate: boolean;
  creatingFromTemplate: boolean;
  importing: boolean;
  actionError: string | null;
  setActionError: (s: string | null) => void;
  onClose: () => void;
}

// שלב ראשון: בחירת גרסה + שיטה | שלב שני: תאריכי בדיקות (אינטגרציה+QA) | שלב שלישי: תאריכי פגישות | שלב רביעי: פעילויות (חזרה+ליל הטמעה) | שלב חמישי: אישור
const STEP_LABELS = ['בחירת גרסה', 'תאריכי בדיקות', 'תאריכי פגישות', 'פעילויות', 'אישור'];

// ── Style objects for DateField/DateTimeField/DateRangeField — the deliberate
// exception (those components only accept `style`, not `className`). ──
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px', border: `2px solid ${C.border}`, borderRadius: '8px',
  fontSize: '15px', boxSizing: 'border-box', background: C.bgNested, color: C.textPrimary,
};
const validBorder = (ok: boolean): React.CSSProperties => ({ ...inputStyle, border: `2px solid ${ok ? C.statusDone : C.statusBlocked}` });

// ── Tailwind class constants for genuine (className-capable) form elements ──
const LABEL_CLASS = 'mb-1.5 block text-[15px] font-bold text-foreground';
const INPUT_CLASS = 'box-border w-full rounded-md border-2 border-border bg-muted p-[9px] text-[15px] text-foreground';
const validClass = (ok: boolean) => (ok ? 'border-success' : 'border-danger');

export const VersionWizard: React.FC<Props> = ({
  newVersion, setNewVersion, existingVersions, templates, selectedTemplateId, setSelectedTemplateId,
  importFile, setImportFile, onPlannedStartChange,
  onCreateEmpty, onCreateFromTemplate, onImportFromFile,
  creatingTemplate, creatingFromTemplate, importing,
  actionError, setActionError, onClose,
}) => {
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>('manual');
  const [targetVersionId, setTargetVersionId] = useState('');
  const selectedVersion = existingVersions.find(v => v.id === targetVersionId) ?? null;

  const busy = creatingTemplate || creatingFromTemplate || importing;
  const LAST_STEP = STEP_LABELS.length - 1;

  // ── Per-step validity ──────────────────────────────────────────────────────
  const step0Valid =
    !!targetVersionId &&
    (method !== 'template' || !!selectedTemplateId) &&
    (method !== 'excel' || !!importFile);
  const step1Valid = method !== 'manual' || !!(newVersion.integrationStart && newVersion.integrationEnd && newVersion.qaStart && newVersion.qaEnd);
  const step2Valid = true; // meetings are always optional
  const [plannedStartDate, plannedStartTime] = (newVersion.plannedStart || '').split('T');
  const step3Valid = method === 'manual' || !!(plannedStartDate && plannedStartTime); // go-live date+time required for template/excel

  const canProceed = [step0Valid, step1Valid, step2Valid, step3Valid, true][step];

  const handleFinish = () => {
    if (!targetVersionId) return;
    if (method === 'manual') onCreateEmpty(targetVersionId);
    else if (method === 'template') onCreateFromTemplate(targetVersionId);
    else onImportFromFile(targetVersionId);
  };

  const missingLabels = (() => {
    if (step === 0) {
      return [
        !targetVersionId && 'בחירת גרסה',
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
      return [
        !plannedStartDate && 'תאריך ליל ההטמעה',
        !plannedStartTime && 'שעת ליל ההטמעה',
      ].filter(Boolean) as string[];
    }
    return [];
  })();

  return (
    <div className="fixed inset-0 z-[3000]" dir="rtl">
      <div className="absolute inset-0 bg-[rgba(10,20,40,0.72)] backdrop-blur-[2px]" />

      <div className="relative z-[1] mx-auto my-8 flex max-h-[calc(100vh-64px)] max-w-[760px] flex-col overflow-hidden rounded-2xl bg-card shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-br from-[#1a2332] to-[#2d4a7a] px-7 pb-4 pt-[18px] text-white">
          <div>
            <div className="text-[17px] font-bold tracking-[0.3px]">📋 יצירת תוכנית הטמעה</div>
            <div className="mt-[3px] text-sm text-[#94a3b8]">{selectedVersion?.name || 'טרם נבחרה גרסה'}</div>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.12)] px-3.5 py-[7px] text-[15px] text-white">
            ✕ ביטול
          </button>
        </div>

        {/* Progress bar */}
        <div className="shrink-0 border-b border-[#e2e8f0] bg-[#f8fafc] px-7 py-3.5">
          <div className="flex items-stretch gap-1.5">
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
                    className={cn(
                      'flex-1 rounded-md border-none px-1.5 py-2 text-sm leading-[1.4] transition-colors duration-fast ease-out',
                      i <= step ? 'cursor-pointer' : 'cursor-default',
                      isActive ? 'font-bold' : 'font-medium'
                    )}
                    style={{ background: bg, color: fg }}
                  >
                    <div className="mb-[3px] text-[15px]">{isDone ? '✅' : isActive ? '●' : `${i + 1}`}</div>
                    {label}
                  </button>
                  {i < STEP_LABELS.length - 1 && (
                    <div className="h-0.5 w-[18px] shrink-0 self-center" style={{ background: isDone ? '#16a34a' : '#e2e8f0' }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {actionError && (
            <div className="mb-4 flex justify-between rounded-md border border-[#fca5a5] bg-[#fff5f5] px-4 py-3 text-[15px] text-[#b91c1c]">
              <span>⚠️ {actionError}</span>
              <button onClick={() => setActionError(null)} className="cursor-pointer border-none bg-transparent font-bold text-[#b91c1c]">×</button>
            </div>
          )}

          {/* ── שלב 1: בחירת גרסה קיימת + שיטת בניית התוכנית ── */}
          {step === 0 && (
            <div className="flex flex-col gap-[18px]">
              <div>
                <label className={LABEL_CLASS}>
                  גרסה <span className="text-danger">*</span>
                  {existingVersions.length === 0 && (
                    <span className="ms-1.5 text-[13px] font-normal text-warning">(אין גרסאות ממתינות — צור גרסה קודם במודול ניהול גרסה)</span>
                  )}
                </label>
                <select
                  value={targetVersionId}
                  onChange={e => setTargetVersionId(e.target.value)}
                  className={cn(INPUT_CLASS, validClass(!!targetVersionId))}
                >
                  <option value="">בחר גרסה שנוצרה בניהול גרסה...</option>
                  {existingVersions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>

              <div>
                <label className={LABEL_CLASS}>איך לבנות את התוכנית?</label>
                <div className="grid grid-cols-3 gap-2.5">
                  {([
                    { key: 'manual',   icon: '✏️', label: 'ידנית', desc: 'הגדר תאריכים, בנה שלבים ומשימות בהמשך' },
                    { key: 'template', icon: '📋', label: 'מתבנית שמורה', desc: 'שכפל מבנה מתבנית קיימת' },
                    { key: 'excel',    icon: '📤', label: 'ייבוא מ-Excel', desc: 'טען קובץ GoLive עם התוכנית המלאה' },
                  ] as const).map(opt => (
                    <div
                      key={opt.key}
                      onClick={() => setMethod(opt.key)}
                      className={cn(
                        'cursor-pointer rounded-[10px] border-2 px-2.5 py-3.5 text-center transition-[background-color,border-color] duration-base ease-out',
                        method === opt.key ? 'border-primary bg-primary/5' : 'border-border bg-muted'
                      )}
                    >
                      <div className="mb-1 text-[22px]">{opt.icon}</div>
                      <div className={cn('text-[15px] font-bold', method === opt.key ? 'text-primary' : 'text-foreground')}>{opt.label}</div>
                      <div className="mt-0.5 text-[13px] text-subtle-foreground">{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {method === 'template' && (
                <div>
                  <label className={LABEL_CLASS}>תבנית <span className="text-danger">*</span></label>
                  {templates.length > 0 ? (
                    <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}
                      className={cn(INPUT_CLASS, validClass(!!selectedTemplateId))}>
                      <option value="">📋 בחר תבנית שמורה</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>)}
                    </select>
                  ) : (
                    <div className="text-[15px] italic text-subtle-foreground">אין תבניות שמורות — צור תבנית קודם, או בחר שיטה אחרת</div>
                  )}
                </div>
              )}

              {method === 'excel' && (
                <div>
                  <label className={LABEL_CLASS}>קובץ Excel <span className="text-danger">*</span></label>
                  <div
                    className={cn('cursor-pointer rounded-md border-2 border-dashed bg-[#f8fafc] p-6 text-center', importFile ? 'border-success' : 'border-[#c0d4e8]')}
                    onClick={() => document.getElementById('wizard-file-input')?.click()}
                  >
                    <div className="mb-1.5 text-[32px]">📂</div>
                    {importFile ? (
                      <div className="text-[15px] font-bold text-foreground">{importFile.name}</div>
                    ) : (
                      <div className="text-[15px] text-subtle-foreground">לחץ לבחירת קובץ (xlsx, xls)</div>
                    )}
                  </div>
                  <input id="wizard-file-input" type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => setImportFile(e.target.files?.[0] || null)} />
                </div>
              )}
            </div>
          )}

          {/* ── שלב 2: תאריכי בדיקות (אינטגרציה + QA) ── */}
          {step === 1 && (
            <div className="flex flex-col gap-[18px]">
              <div>
                <div className={cn(LABEL_CLASS, 'mb-2.5')}>🔧 תאריכי אינטגרציה {method === 'manual' ? <span className="text-danger">*</span> : <span className="text-xs font-normal text-subtle-foreground">אופציונלי</span>}</div>
                <DateRangeField
                  startIso={newVersion.integrationStart}
                  endIso={newVersion.integrationEnd}
                  onChange={(s, e) => setNewVersion({ ...newVersion, integrationStart: s, integrationEnd: e })}
                  style={method === 'manual' ? validBorder(!!newVersion.integrationStart) : inputStyle}
                />
              </div>

              <div>
                <div className={cn(LABEL_CLASS, 'mb-2.5')}>🧪 תאריכי בדיקות QA {method === 'manual' ? <span className="text-danger">*</span> : <span className="text-xs font-normal text-subtle-foreground">אופציונלי</span>}</div>
                <DateRangeField
                  startIso={newVersion.qaStart}
                  endIso={newVersion.qaEnd}
                  onChange={(s, e) => setNewVersion({ ...newVersion, qaStart: s, qaEnd: e })}
                  style={method === 'manual' ? validBorder(!!newVersion.qaStart) : inputStyle}
                />
              </div>

              {method !== 'manual' && (
                <div className="text-sm italic text-subtle-foreground">
                  אם לא מוזן, ניתן להשלים מאוחר יותר דרך פרטי הגרסה.
                </div>
              )}
            </div>
          )}

          {/* ── שלב 3: תאריכי פגישות ── */}
          {step === 2 && (
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className={LABEL_CLASS}>📅 ישיבת סקירת CR-ים <span className="text-xs font-normal text-subtle-foreground">T−10 ימי עבודה</span></label>
                <DateTimeField value={newVersion.reviewMeetingTime}
                  onChange={v => setNewVersion({ ...newVersion, reviewMeetingTime: v })}
                  style={inputStyle} />
              </div>
              <div>
                <label className={LABEL_CLASS}>📋 ישיבת הצגת תוכנית עליה לאוויר <span className="text-xs font-normal text-subtle-foreground">T−9 ימי עבודה</span></label>
                <DateTimeField value={newVersion.workPlanMeetingTime}
                  onChange={v => setNewVersion({ ...newVersion, workPlanMeetingTime: v })}
                  style={inputStyle} />
              </div>
            </div>
          )}

          {/* ── שלב 4: פעילויות — חזרה גנרלית + ליל ההטמעה ── */}
          {step === 3 && (
            <div className="flex flex-col gap-[18px]">
              <div>
                <div className={cn(LABEL_CLASS, 'mb-2.5')}>🎭 חזרה גנרלית <span className="text-xs font-normal text-subtle-foreground">אופציונלי</span></div>
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className={LABEL_CLASS}>תחילה</label>
                    <DateTimeField value={newVersion.plannedRehearsalStart}
                      onChange={v => setNewVersion({ ...newVersion, plannedRehearsalStart: v })}
                      style={inputStyle} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>סיום</label>
                    <DateTimeField value={newVersion.plannedRehearsalEnd}
                      onChange={v => setNewVersion({ ...newVersion, plannedRehearsalEnd: v })}
                      style={inputStyle} />
                  </div>
                </div>
              </div>

              <div>
                <div className={cn(LABEL_CLASS, 'mb-2.5')}>
                  🚀 ליל ההטמעה {method !== 'manual' && <span className="text-danger">*</span>}
                  {method === 'manual' && <span className="text-xs font-normal text-subtle-foreground"> אופציונלי</span>}
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className={LABEL_CLASS}>תחילה</label>
                    <StrictDateTimeField value={newVersion.plannedStart}
                      onChange={v => onPlannedStartChange(v)}
                      style={method !== 'manual' ? validBorder(!!(plannedStartDate && plannedStartTime)) : inputStyle} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>סיום</label>
                    <DateTimeField value={newVersion.plannedEnd}
                      onChange={v => setNewVersion({ ...newVersion, plannedEnd: v })}
                      style={inputStyle} />
                  </div>
                </div>
                {method === 'excel' && (
                  <div className="mt-1 text-[13px] text-subtle-foreground">אם לא ממולא, ייקחו התאריכים מהקובץ</div>
                )}
              </div>
            </div>
          )}

          {/* ── שלב 5: סקירה ואישור ── */}
          {step === 4 && (
            <div className="flex flex-col gap-2.5">
              <div className="mb-1 text-[15px] text-subtle-foreground">
                שיטת יצירה: <strong className="text-foreground">{method === 'manual' ? 'ידנית' : method === 'template' ? 'מתבנית שמורה' : 'ייבוא מ-Excel'}</strong>
              </div>
              {[
                ['גרסה', selectedVersion?.name || '—'],
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
                <div key={label} className="flex justify-between rounded-sm bg-muted px-3 py-2 text-[15px]">
                  <span className="text-subtle-foreground">{label}</span>
                  <span className="font-bold text-foreground">{value || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {step < LAST_STEP && missingLabels.length > 0 && (
            <p className="mt-3.5 text-sm text-danger">יש למלא: {missingLabels.join(', ')}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-between border-t border-[#e2e8f0] bg-[#f8fafc] px-7 py-4">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className={cn(
              'rounded-md border-none px-[18px] py-[9px] text-[15px]',
              step === 0 ? 'cursor-not-allowed bg-[#f1f5f9] text-[#94a3b8]' : 'cursor-pointer bg-[#e2e8f0] text-[#374151]'
            )}
          >
            ← הקודם
          </button>

          {step < LAST_STEP ? (
            <button
              onClick={() => setStep(s => Math.min(LAST_STEP, s + 1))}
              disabled={!canProceed}
              className={cn(
                'rounded-md border-none px-6 py-[9px] text-[15px] font-bold text-white',
                canProceed ? 'cursor-pointer bg-primary' : 'cursor-not-allowed bg-subtle-foreground'
              )}
            >
              הבא ←
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={busy}
              className={cn(
                'rounded-md border-none px-6 py-[9px] text-[15px] font-bold text-white',
                busy ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-success'
              )}
            >
              {busy ? 'בונה תוכנית...' : '✓ בנה תוכנית הטמעה'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
