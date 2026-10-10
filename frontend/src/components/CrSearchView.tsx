import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C } from '../theme';
import { cn } from '../lib/utils';
import { Card, Badge, VersionStageChip } from './ui';
import { formatDateTime } from '../utils/dateFormat';
import { DefectDrilldownModal } from './release-intelligence/DefectDrilldownModal';
import { Cr360Panels, Cr360 } from './Cr360Panels';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ניהול גרסה → "חיפוש CR" (user, 2026-10-06): find any CR in the CR_LIST
// file — scheduled or not — and see everything about it in one card: which
// version it's in, effort estimates (total + per team column: WIZ, CRM, QA…),
// status, מאפיין (the person who characterized it), CR manager, the rest of
// the row, and what DeployCenter already holds about it per version (teams,
// plans, testers, defects, change history).

interface Match { crNumber: string; title: string; version: string; status: string }
interface CrCard {
  crNumber: string; title: string; description: string; versionsInFile: string[]; status: string;
  characterizer: string; characterizerGroup: string; crManager: string; project: string; totalEstimateDays: number | null; actuals: string | null;
  teamEfforts: { team: string; columns: string[]; days: number }[];
  otherFields: { label: string; value: string }[];
  inSystem: {
    versionId: string; versionName: string; versionStatus: string; versionArchived: boolean;
    teams: { team: string; teamEstimateDays: number | null; syncStatus: string; isArchived: boolean; archivedReason: string | null }[];
    isCore: boolean; isStandAlone: boolean;
    plans: { team: string; approved: boolean; notNeeded: boolean }[];
    testers: string[];
  }[];
  history: { at: string; version: string; team: string; field: string; reason: string | null; oldValue: string | null; newValue: string | null }[];
}

const SYNC_LABEL: Record<string, [string, string]> = {
  ACTIVE: ['בתכולה', C.success], NEW: ['חדש', C.statusOpen], REMOVED: ['הוסר מהקובץ', C.danger],
};
const EVENT_LABEL: Record<string, string> = {
  SCOPE_ADDED: 'נוסף לתכולה', SCOPE_REMOVED: 'הוסר מהתכולה', ESTIMATE_CHANGED: 'שינוי הערכה', STATUS_CHANGED: 'שינוי סטטוס',
};

export const CrSearchView: React.FC<{ token: string; versions: any[]; initialQuery?: string }> = ({ token, versions, initialQuery }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [q, setQ] = useState(initialQuery ?? '');
  // the CR's full picture in one version (2026-10-10) + drill into any defect list
  const [c360, setC360] = useState<Cr360 | null>(null);
  const [loading360, setLoading360] = useState(false);
  const [idDrill, setIdDrill] = useState<{ title: string; ids: string[] } | null>(null);
  const load360 = async (crNumber: string, versionId?: string) => {
    setLoading360(true);
    try {
      const r = await axios.get(`${API}/release-intelligence/cr-360/${encodeURIComponent(crNumber)}`, { headers, params: versionId ? { versionId } : undefined });
      setC360(r.data);
    } catch { setC360(null); } finally { setLoading360(false); }
  };
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [card, setCard] = useState<CrCard | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ versionId: string; versionName: string } | null>(null);

  const search = async (override?: string) => {
    const query = (override ?? q).trim();
    if (query.length < 2) return;
    setSearching(true); setError(null); setCard(null);
    try {
      const r = await axios.get(`${API}/version-cr-assignments/cr-search`, { headers, params: { q: query } });
      const m: Match[] = r.data.matches ?? [];
      setMatches(m);
      if (m.length === 1 || (m[0] && m[0].crNumber === query)) openCard(m[0].crNumber);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'החיפוש נכשל'); setMatches(null);
    } finally { setSearching(false); }
  };

  const openCard = async (crNumber: string) => {
    setLoadingCard(true); setError(null); setC360(null);
    load360(crNumber);
    try {
      const r = await axios.get(`${API}/version-cr-assignments/cr-card/${encodeURIComponent(crNumber)}`, { headers });
      setCard(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'טעינת ה-CR נכשלה');
    } finally { setLoadingCard(false); }
  };

  useEffect(() => { setCard(null); }, [token]);
  // opened from the home page with a query → search right away
  useEffect(() => { if (initialQuery && initialQuery.trim().length >= 2) search(initialQuery); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  return (
    <div className="flex flex-col gap-4">
      <Card padding={4}>
        <div className="mb-1 text-base font-bold text-foreground">🔎 חיפוש CR</div>
        <div className="mb-3 text-xs text-subtle-foreground">חיפוש בקובץ ה-CR_LIST לפי מספר CR או מילה מהכותרת — כולל CR-ים שעדיין לא שובצו לגרסה</div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search(); }}
            placeholder="מספר CR או טקסט..."
            className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          />
          <button onClick={() => search()} disabled={searching || q.trim().length < 2}
            className={cn('rounded-md border-none px-4 py-2 text-sm font-semibold text-white', searching || q.trim().length < 2 ? 'cursor-not-allowed bg-subtle-foreground' : 'cursor-pointer bg-primary')}>
            {searching ? '⏳ מחפש...' : 'חפש'}
          </button>
        </div>
        {error && <div className="mt-2 text-sm" style={{ color: C.danger }}>⚠️ {error}</div>}
      </Card>

      {matches && !card && (
        <Card padding="none">
          {matches.length === 0 ? (
            <div className="p-6 text-center text-sm text-subtle-foreground">לא נמצאו CR-ים תואמים</div>
          ) : (
            <table className="w-full table-fixed border-collapse text-[13px]">
              <colgroup><col style={{ width: 90 }} /><col /><col style={{ width: 130 }} /><col style={{ width: 170 }} /></colgroup>
              <thead>
                <tr className="bg-muted">
                  {['CR', 'כותרת', 'גרסה', 'סטטוס'].map(h => (
                    <th key={h} className="border-b border-border px-3 py-2 text-right text-xs font-semibold text-subtle-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.crNumber} onClick={() => openCard(m.crNumber)} className="cursor-pointer border-b border-border hover:bg-muted">
                    <td className="px-3 py-2 font-semibold text-primary">{m.crNumber}</td>
                    <td className="truncate px-3 py-2 text-foreground" title={m.title}>{m.title}</td>
                    <td className="px-3 py-2 text-muted-foreground" dir="ltr" style={{ textAlign: 'right' }}>{m.version || '—'}</td>
                    <td className="truncate px-3 py-2 text-muted-foreground">{m.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {matches.length >= 30 && <div className="p-2 text-center text-xs text-subtle-foreground">מוצגות 30 התוצאות הראשונות — צמצם את החיפוש</div>}
        </Card>
      )}

      {loadingCard && <div className="p-6 text-center text-sm text-subtle-foreground">טוען...</div>}

      {card && !loadingCard && (
        <CrCardView card={card} versions={versions}
          onBack={matches && matches.length > 1 ? () => setCard(null) : undefined}
          onDefects={(versionId, versionName) => setDrill({ versionId, versionName })}>
          {/* version picker — every panel below follows it */}
          {c360 && c360.versions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">גרסה:</span>
              {c360.versions.map(v => (
                <button key={v.id} onClick={() => load360(card.crNumber, v.id)}
                  className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs', c360.versionId === v.id ? 'border-primary bg-primary font-bold text-white' : 'border-border bg-card text-foreground')}>
                  {v.name}{v.goLive ? ` · ${formatDateTime(v.goLive).split(' ')[0]}` : ''}
                </button>
              ))}
            </div>
          )}
          {loading360 && !c360 && <div className="p-4 text-center text-sm text-subtle-foreground">טוען את תמונת ה-CR…</div>}
          {c360 && (
            <div style={{ opacity: loading360 ? 0.5 : 1 }}>
              <Cr360Panels data={c360}
                onDrill={(title, ids) => setIdDrill({ title, ids })}
                onOpenCr={n => { setQ(n); setMatches(null); openCard(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>
          )}
        </CrCardView>
      )}

      {idDrill && (
        <DefectDrilldownModal token={token} screen="cycle-progress" filter="__ids__" value="" title={idDrill.title}
          idList={idDrill.ids} onClose={() => setIdDrill(null)} />
      )}

      {drill && card && (
        <DefectDrilldownModal token={token} versionId={drill.versionId} screen="cycle-progress" filter="crReported"
          value={card.crNumber} title={`תקלות CR ${card.crNumber} — ${drill.versionName}`} onClose={() => setDrill(null)} />
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-xs text-subtle-foreground">{label}</div>
    <div className="truncate text-sm font-semibold text-foreground">{children || '—'}</div>
  </div>
);

const CrCardView: React.FC<{ card: CrCard; versions: any[]; onBack?: () => void; onDefects: (versionId: string, versionName: string) => void; children?: React.ReactNode }> = ({ card, versions, onBack, onDefects, children }) => {
  const maxEffort = Math.max(1, ...card.teamEfforts.map(t => t.days));
  const teamSum = card.teamEfforts.reduce((s, t) => s + t.days, 0);
  return (
    <div className="flex flex-col gap-4">
      {onBack && <button onClick={onBack} className="self-start cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-primary">→ חזרה לתוצאות</button>}

      <Card padding={4}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-lg font-bold text-foreground"><span className="text-primary">CR {card.crNumber}</span> · {card.title}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {card.versionsInFile.map(v => <Badge key={v} color={C.brand} bg={C.brandDim}>גרסה {v}</Badge>)}
              {card.status && <Badge color={C.textSecondary} bg={C.bgNested}>{card.status}</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Field label="מאפיין">{card.characterizer}</Field>
          {card.characterizerGroup && <Field label="קבוצת אפיון">{card.characterizerGroup}</Field>}
          <Field label="מנהל CR">{card.crManager}</Field>
          <Field label="פרויקט">{card.project}</Field>
          <Field label='סה"כ הערכות השקעה'>{card.totalEstimateDays != null ? `${card.totalEstimateDays} ימים` : ''}</Field>
          <Field label="Actuals">{card.actuals}</Field>
        </div>
        {card.description && (
          <div className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-[13px] leading-relaxed text-foreground" dir="auto">{card.description}</div>
        )}
      </Card>

      {children}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card padding={4}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">הערכות השקעה לפי צוות</div>
            <Badge color={C.textMuted} bg={C.bgHover}>{Math.round(teamSum * 100) / 100} ימים</Badge>
          </div>
          {card.teamEfforts.length === 0 ? <div className="text-xs text-subtle-foreground">אין הערכות צוות בקובץ</div> : (
            <div className="flex flex-col gap-2">
              {card.teamEfforts.map(t => (
                <div key={t.team} className="flex items-center gap-2 text-xs">
                  <div className="w-[150px] shrink-0 truncate text-left text-muted-foreground" title={t.columns.join(', ')}>{t.team}</div>
                  <div className="h-3 min-w-0 flex-1">
                    <div className="h-full rounded-e-[4px]" style={{ width: `${(t.days / maxEffort) * 100}%`, background: C.brand }} />
                  </div>
                  <div className="w-14 shrink-0 text-left tabular-nums text-foreground">{t.days} י׳</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding={4}>
          <div className="mb-3 text-sm font-semibold text-foreground">📄 נתונים נוספים</div>
          {card.otherFields.length === 0 ? <div className="text-xs text-subtle-foreground">—</div> : (
            // one row per field: the full label beside its full value (both wrap — nothing cut)
            <div className="grid text-[13px]" style={{ gridTemplateColumns: 'minmax(110px, max-content) 1fr', columnGap: 16 }}>
              {card.otherFields.map(f => (
                <React.Fragment key={f.label}>
                  <div className="border-t border-border py-1.5 text-xs font-semibold text-subtle-foreground" dir="auto">{f.label}</div>
                  {/* right-aligned next to its label even when the value is English / a date */}
                  <div className="whitespace-pre-wrap break-words border-t border-border py-1.5 text-right text-foreground"><span dir="auto">{f.value || '—'}</span></div>
                </React.Fragment>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card padding={4}>
        <div className="mb-3 text-sm font-semibold text-foreground">במערכת</div>
        {card.inSystem.length === 0 ? (
          <div className="text-xs text-subtle-foreground">ה-CR עדיין לא שובץ לאף גרסה ב-DeployCenter</div>
        ) : (
          <div className="flex flex-col gap-3">
            {card.inSystem.map(v => {
              const ver = versions.find(x => x.id === v.versionId);
              return (
                <div key={v.versionId} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{v.versionName}</span>
                    {ver && <VersionStageChip version={ver} size="xs" />}
                    {v.isCore && <Badge color={C.brand} bg={C.brandDim}>Core</Badge>}
                    {v.isStandAlone && <Badge color={C.statusWaiting} bg={C.bgWaiting}>Stand Alone</Badge>}
                    <button onClick={() => onDefects(v.versionId, v.versionName)}
                      className="ms-auto cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-primary">
                      🐞 תקלות ה-CR בגרסה
                    </button>
                  </div>
                  <table className="w-full table-fixed border-collapse text-[13px]">
                    <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 130 }} /></colgroup>
                    <thead>
                      <tr>{['צוות', 'הערכה (ימים)', 'בתכולה', 'תוכנית CR'].map(h => (
                        <th key={h} className="border-b border-border px-2 py-1.5 text-right text-xs font-semibold text-subtle-foreground">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {v.teams.map(t => {
                        const [lbl, col] = t.isArchived ? ['בארכיון', C.textMuted] : (SYNC_LABEL[t.syncStatus] ?? [t.syncStatus, C.textMuted]);
                        const plan = v.plans.find(p => p.team === t.team);
                        return (
                          <tr key={t.team} className="border-b border-border">
                            <td className="truncate px-2 py-1.5 text-foreground">{t.team}</td>
                            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{t.teamEstimateDays ?? '—'}</td>
                            <td className="px-2 py-1.5 text-xs font-semibold" style={{ color: col }} title={t.archivedReason ?? undefined}>{lbl}</td>
                            <td className="px-2 py-1.5 text-xs text-muted-foreground">
                              {!plan ? '—' : plan.notNeeded ? 'לא נדרשת' : plan.approved ? <span style={{ color: C.success }}>✓ אושרה</span> : 'טרם אושרה'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {v.testers.length > 0 && <div className="mt-2 text-xs text-muted-foreground">בודקי QA: {v.testers.join(', ')}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {card.history.length > 0 && (
        <Card padding={4}>
          <div className="mb-3 text-sm font-semibold text-foreground">היסטוריית שינויים בתכולה</div>
          <table className="w-full table-fixed border-collapse text-[13px]">
            <colgroup><col style={{ width: 150 }} /><col style={{ width: 110 }} /><col style={{ width: 140 }} /><col style={{ width: 120 }} /><col /></colgroup>
            <thead>
              <tr className="bg-muted">{['מתי', 'גרסה', 'צוות', 'שינוי', 'פירוט'].map(h => (
                <th key={h} className="border-b border-border px-2 py-1.5 text-right text-xs font-semibold text-subtle-foreground">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {card.history.map((h, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground"><span dir="ltr">{formatDateTime(h.at)}</span></td>
                  <td className="px-2 py-1.5 text-muted-foreground">{h.version}</td>
                  <td className="truncate px-2 py-1.5 text-muted-foreground">{h.team}</td>
                  <td className="px-2 py-1.5 font-semibold text-foreground">{EVENT_LABEL[h.field] ?? h.field}</td>
                  <td className="px-2 py-1.5 text-muted-foreground" dir="auto">{h.reason ?? [h.oldValue, h.newValue].filter(Boolean).join(' ← ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};
