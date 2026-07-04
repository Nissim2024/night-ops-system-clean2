import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Row type by cell background color (primary detection)
const COLOR_PHASE    = 'FF00B0F0';
const COLOR_SUBPHASE = 'FFBF9000';
const COLOR_GONOGO   = 'FF00B050';
const COLOR_ALERT    = 'FFFF0000';

// Indentation levels (fallback when no color)
const INDENT_PHASE    = 0;
const INDENT_SUBPHASE = 3;

type RowType = 'PHASE' | 'SUBPHASE' | 'TASK' | 'GO_NOGO' | 'ALERT';

interface ParsedRow {
  type:            RowType;
  rowNum:          number;       // sequential row number (kept for reference)
  excelRow:        number;       // Excel 1-indexed row number (R + 1) for dep matching
  title:           string;
  plannedStart:    Date | null;
  duration:        string;
  durationMinutes: number | null;
  plannedEnd:      Date | null;
  crNumber:        string;
  application:     string;
  team:            string;
  resource:        string;
  predecessors:    string;       // comma-sep row numbers
}

@Injectable()
export class ImportService {

  private getCellColor(cell: any): string {
    if (!cell || !cell.s) return 'FFFFFFFF';
    const fill = cell.s.fgColor;
    if (!fill) return 'FFFFFFFF';
    if (fill.rgb) return fill.rgb.length === 6 ? 'FF' + fill.rgb : fill.rgb;
    if (fill.theme !== undefined) return 'THEME';
    return 'FFFFFFFF';
  }

  private parseRowType(color: string, indent: number): RowType {
    // Color takes priority
    if (color === COLOR_PHASE)    return 'PHASE';
    if (color === COLOR_SUBPHASE) return 'SUBPHASE';
    if (color === COLOR_GONOGO)   return 'GO_NOGO';
    if (color === COLOR_ALERT)    return 'ALERT';

    // Fallback: indentation-based hierarchy
    if (color === 'FFFFFFFF' || color === 'THEME') {
      if (indent <= INDENT_PHASE)    return 'PHASE';
      if (indent <= INDENT_SUBPHASE) return 'SUBPHASE';
    }
    return 'TASK';
  }

  // Leading spaces count in a string
  private countIndent(s: string): number {
    let i = 0;
    while (i < s.length && s[i] === ' ') i++;
    return i;
  }

  // Raw Excel value (number = minutes, or string) → minutes
  private parseDurationToMinutes(raw: any): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ''));
    return !isNaN(n) && n > 0 ? Math.round(n) : null;
  }

  // Apply version's date to a task time.
  // If the task's hour is 00:00–03:59 it's after midnight → add 1 day to the version date.
  private applyVersionDate(taskStart: Date, versionDate: Date): Date {
    const h = taskStart.getUTCHours();
    const extraDays = h < 4 ? 1 : 0;
    const base = new Date(Date.UTC(
      versionDate.getUTCFullYear(),
      versionDate.getUTCMonth(),
      versionDate.getUTCDate() + extraDays,
      taskStart.getUTCHours(),
      taskStart.getUTCMinutes(),
    ));
    return base;
  }

  // Parse "45 mins", "45 mins?", "1 min", "0 mins" → "45 דק'" / "1ש' 30דק'"
  private parseDurationStr(raw: string): string {
    if (!raw) return '';
    const clean = raw.replace(/[?]/g, '').trim();
    const m = clean.match(/^(\d+)\s*min/i);
    if (!m) return clean;
    const mins = parseInt(m[1]);
    if (mins === 0) return '';
    if (mins < 60) return `${mins} דק'`;
    const h = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${h}ש' ${rem}דק'` : `${h}ש'`;
  }

  private parseDate(cell: any): Date | null {
    if (!cell || cell.v == null) return null;
    let v = cell.v;

    if (v && typeof v === 'object' && v.$type === 'DateTime') v = v.value;

    // Reject row-IDs misinterpreted as dates
    const isValidYear = (d: Date) => { const y = d.getFullYear(); return y >= 2000 && y <= 2100; };
    // 2-digit year: 00–49 → 2000s, 50–99 → 1900s
    const toFull = (yy: number) => yy < 100 ? (yy >= 50 ? 1900 + yy : 2000 + yy) : yy;

    // JS Date (from cellDates:true)
    if (v instanceof Date) return isNaN(v.getTime()) || !isValidYear(v) ? null : v;

    // Excel serial number
    if (typeof v === 'number') {
      try {
        const p = (XLSX.SSF as any).parse_date_code(v);
        if (p) { const d = new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S)); return isValidYear(d) ? d : null; }
      } catch { /* fall through */ }
    }

    // String parsing — try cell.v first, then cell.w (formatted display string)
    const raw = (typeof v === 'string' ? v : '') || (cell.w ? String(cell.w) : '');
    if (!raw.trim()) return null;
    const s = raw.trim();

    // Optional day-name prefix, DD/MM/YY or DD/MM/YYYY, optional HH:MM
    // Handles: "Sun 30/03/25 08:00", "30/03/2025 08:00", "Sun 30/03/2025", "30/03/25"
    const mDate = s.match(/^(?:[A-Za-z]{2,4}\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (mDate) {
      const yr = toFull(+mDate[3]);
      const hr = mDate[4] ? +mDate[4] : 0;
      const mn = mDate[5] ? +mDate[5] : 0;
      const d = new Date(Date.UTC(yr, +mDate[2] - 1, +mDate[1], hr, mn));
      if (!isNaN(d.getTime()) && isValidYear(d)) return d;
    }

    // YYYY-MM-DD HH:MM or ISO 8601
    const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
    if (mIso) {
      const d = new Date(Date.UTC(+mIso[1], +mIso[2] - 1, +mIso[3], mIso[4] ? +mIso[4] : 0, mIso[5] ? +mIso[5] : 0));
      if (!isNaN(d.getTime()) && isValidYear(d)) return d;
    }

    // Last resort: JS Date parser
    const d = new Date(s);
    if (!isNaN(d.getTime()) && isValidYear(d)) return d;

    return null;
  }

  async importFromBuffer(
    buffer: Buffer,
    versionName: string,
    createdBy: string,
    fileName?: string,
    versionPlannedStart?: Date,
    qcReleaseId?: string,
    integrationStart?: Date,
    integrationEnd?: Date,
    qaStart?: Date,
    qaEnd?: Date,
    plannedRehearsalStart?: Date,
    plannedRehearsalEnd?: Date,
  ): Promise<{ success: boolean; message: string; stats: any }> {

    const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true, cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows: ParsedRow[] = [];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    let rowNum = 0;

    for (let R = 1; R <= range.e.r; R++) {
      const cell = (c: number) => sheet[XLSX.utils.encode_cell({ r: R, c })];

      /*
       * Column mapping (new format):
       *  A(0) = Start (plannedStart)
       *  B(1) = Duration
       *  C(2) = Finish (plannedEnd)
       *  D(3) = CR#
       *  E(4) = Task Name  ← main content
       *  F(5) = Application
       *  G(6) = Team
       *  H(7) = Resource Names (assignedUserName)
       *  I(8) = Predecessors
       *  J(9),K(10),L(11) = ignored (task status, Actual Start, Actual Finish)
       */
      const nameCell = cell(4); // col E
      const rawName  = nameCell?.v != null ? String(nameCell.v) : '';
      if (!rawName.trim()) continue;

      rowNum++;

      // Hierarchy: color of col E (name cell), fallback to indentation
      const color  = this.getCellColor(nameCell);
      const indent = this.countIndent(rawName);
      const type   = this.parseRowType(color, indent);

      // Duration raw value from col B
      const durCell       = cell(1);
      const durRaw        = durCell?.v != null ? String(durCell.v).trim() : '';
      const duration      = this.parseDurationStr(durRaw);
      const durationMinutes = this.parseDurationToMinutes(durCell?.v);

      // Predecessors from col I
      const predCell = cell(8);
      const predRaw  = predCell?.v != null ? String(predCell.v).trim() : '';

      rows.push({
        type,
        rowNum,
        excelRow:        R + 1,
        title:           rawName.trim(),
        plannedStart:    this.parseDate(cell(0)),   // col A
        duration,
        durationMinutes,
        plannedEnd:      this.parseDate(cell(2)),   // col C
        crNumber:        cell(3)?.v != null ? String(cell(3).v).trim() : '',  // col D
        application:     cell(5)?.v != null ? String(cell(5).v).trim() : '',  // col F
        team:            cell(6)?.v != null ? String(cell(6).v).trim() : '',  // col G
        resource:        cell(7)?.v != null ? String(cell(7).v).trim() : '',  // col H
        predecessors:    predRaw,
      });
    }

    // Team name normalization
    const teamNameMap: Record<string, string> = {
      'QA Team': 'QA Team', 'QA team': 'QA Team', 'QA': 'QA Team',
      'NOC': 'NOC', 'NOC Team': 'NOC',
      'DBA Team': 'DBA Team', 'DBA': 'DBA Team',
      'EAI Team': 'EAI Team', 'EAI TEAM': 'EAI Team', 'EAI': 'EAI Team',
      'CRM Team': 'CRM Team', 'CRM TEAM': 'CRM Team', 'CRM': 'CRM Team',
      'NETC Team': 'NETC Team', 'NETC': 'NETC Team',
      'Operation': 'Operation', 'Operations': 'Operation',
      'ETL': 'Operation', 'ERP': 'Operation', 'NC': 'Operation',
      'System': 'NOC',
      'שיווק': 'Operation',
      'QV Team': 'Operation',
      'CAWA': 'Operation', 'SEC': 'Operation', 'BOXI': 'Operation',
    };

    const teams = await prisma.team.findMany({ where: { active: true } });
    const teamMap: Record<string, string> = {};
    teams.forEach(t => { teamMap[t.name] = t.id; });

    const version = await (prisma.version.create as any)({
      data: {
        name: versionName,
        description: `יובא מקובץ Excel`,
        status: 'DRAFT',
        createdBy,
        importedFileName: fileName || undefined,
        plannedStart: versionPlannedStart || undefined,
        qcReleaseId: qcReleaseId || undefined,
        integrationStart: integrationStart || undefined,
        integrationEnd: integrationEnd || undefined,
        qaStart: qaStart || undefined,
        qaEnd: qaEnd || undefined,
        plannedRehearsalStart: plannedRehearsalStart || undefined,
        plannedRehearsalEnd: plannedRehearsalEnd || undefined,
      },
    });

    await prisma.teamSubmission.createMany({
      data: teams.map(t => ({ versionId: version.id, teamId: t.id })),
    });

    let currentPhase: any    = null;
    let currentSubPhase: any = null;
    let phaseOrder     = 0;
    let subPhaseOrder  = 0;
    let taskOrder      = 0;
    let taskCount      = 0;
    let goNoGoCount    = 0;
    let alertCount     = 0;

    // Excel 1-indexed row number → DB task id  (for dependency second pass)
    const rowNumToDbId: Record<number, string> = {};
    const pendingDeps: Array<[string, string]> = [];  // [taskId, predecessorStr]

    for (const row of rows) {
      if (row.type === 'PHASE') {
        phaseOrder++;
        subPhaseOrder = 0;
        taskOrder     = 0;

        let environment: any = 'BOTH';
        const n = row.title;
        if (n.includes('הוטנט') || n.toUpperCase().includes('HOTNET')) environment = 'HOTNET';
        else if (n.includes('הוט') || n.toUpperCase().includes('HOT')) environment = 'HOT';

        currentPhase = await prisma.phase.create({
          data: { versionId: version.id, name: row.title, orderIndex: phaseOrder, environment },
        });
        currentSubPhase = null;

      } else if (row.type === 'SUBPHASE') {
        if (!currentPhase) continue;
        subPhaseOrder++;
        taskOrder = 0;
        currentSubPhase = await prisma.subPhase.create({
          data: { phaseId: currentPhase.id, name: row.title, orderIndex: subPhaseOrder },
        });

      } else {
        if (!currentPhase) continue;

        if (!currentSubPhase) {
          subPhaseOrder++;
          currentSubPhase = await prisma.subPhase.create({
            data: {
              phaseId:    currentPhase.id,
              name:       row.type === 'GO_NOGO' ? 'GO/NO GO' : 'כללי',
              orderIndex: subPhaseOrder,
            },
          });
        }

        taskOrder++;
        if (row.type === 'GO_NOGO') goNoGoCount++;
        if (row.type === 'ALERT')   alertCount++;

        const teamName = teamNameMap[row.team] || row.team;
        const teamId   = teamMap[teamName];

        // Adjust plannedStart: if version has a start date, use its date + Excel's time
        let adjustedStart = row.plannedStart;
        if (versionPlannedStart && row.plannedStart) {
          adjustedStart = this.applyVersionDate(row.plannedStart, versionPlannedStart);
        }

        // Calculate plannedEnd from duration minutes when available
        let adjustedEnd = row.plannedEnd;
        if (adjustedStart && row.durationMinutes) {
          adjustedEnd = new Date(adjustedStart.getTime() + row.durationMinutes * 60 * 1000);
        }

        const task = await prisma.task.create({
          data: {
            subPhaseId:       currentSubPhase.id,
            versionId:        version.id,
            title:            row.type === 'ALERT' ? `[התראה] ${row.title}` : row.title,
            assignedUserName: row.resource    || undefined,
            assignedTeamId:   teamId          || undefined,
            application:      row.application || undefined,
            crNumber:         row.crNumber    || undefined,
            duration:         row.duration    || undefined,
            status:           'WAITING',
            isCritical:       row.type === 'GO_NOGO',
            isCriticalForGo:  row.type === 'GO_NOGO',
            orderIndex:       taskOrder,
            createdBy,
            plannedStart:     adjustedStart ?? undefined,
            plannedEnd:       adjustedEnd   ?? undefined,
          },
        });
        taskCount++;
        rowNumToDbId[row.excelRow] = task.id;

        if (row.predecessors) {
          row.predecessors
            .split(/[,;]/)
            .map(p => p.trim())
            .filter(Boolean)
            .forEach(p => pendingDeps.push([task.id, p]));
        }
      }
    }

    // Second pass: create TaskDependency records
    let depsLinked = 0;
    const missingDepRows: number[] = [];
    for (const [taskId, predStr] of pendingDeps) {
      // Extract leading digits only: "3FS+1d" → 3, "5SS" → 5, "10" → 10
      const m = predStr.match(/^(\d+)/);
      const predNum = m ? parseInt(m[1]) : NaN;
      if (isNaN(predNum) || predNum === 0) continue;
      const predDbId = rowNumToDbId[predNum];
      if (predDbId && predDbId !== taskId) {
        try {
          await prisma.taskDependency.create({ data: { taskId, dependsOnTaskId: predDbId } });
          depsLinked++;
        } catch { /* skip duplicates / circular */ }
      } else {
        if (!missingDepRows.includes(predNum)) missingDepRows.push(predNum);
      }
    }

    // Auto-set isGoNoGo on the second-to-last phase (the last phase = morning-after)
    if (phaseOrder >= 2) {
      const allPhases = await prisma.phase.findMany({
        where: { versionId: version.id },
        orderBy: { orderIndex: 'asc' },
        select: { id: true },
      });
      const goNogoPhaseId = allPhases[allPhases.length - 2]?.id;
      if (goNogoPhaseId) {
        await prisma.phase.update({ where: { id: goNogoPhaseId }, data: { isGoNoGo: true } });
      }
    }

    return {
      success: true,
      message: `הייבוא הושלם בהצלחה`,
      stats: {
        versionId:   version.id,
        versionName: version.name,
        phases:      phaseOrder,
        subPhases:   subPhaseOrder,
        tasks:       taskCount,
        goNoGo:      goNoGoCount,
        alerts:      alertCount,
        depsLinked,
        missingDepRows,
      },
    };
  }

  // ── Team column mapping: DB team name → Excel column header(s) ──
  private static readonly TEAM_COLUMNS: Record<string, string[]> = {
    'CAWA Team':               ['CAWA'],
    'CRM Dev Team':            ['CRM'],
    'Cyber Security Team':     ['CYBER', 'Cyber PT', 'אבט"מ'],
    'DBA Team':                ['DBA'],
    'EAI Team':                ['EAI'],
    'ERP Team':                ['ERP'],
    'ETL Team':                ['ETL'],
    'IVR Team':                ['IVR'],
    'JACADA Team':             ['JACADA'],
    'MAILIT Team':             ['MAILIT'],
    'NC Team':                 ['NC'],
    'NETCOL Team':             ['NETCOL'],
    'OSS Team':                ['OSS'],
    'PrintBoss Team':          ['PRINTBOS'],
    'Provisioning Team':       ['PROV'],
    'PT Team':                 ['PT'],
    'QA Team':                 ['QA', 'QA BI', 'QA מוצרים'],
    'BI Team':                 ['BI'],
    'REMEDY Team':             ['REMEDY'],
    'Setup Team':              ['SETUP', 'Setup יש'],
    'TV Team':                 ['TV'],
    'Web Dev Team':            ['WEB'],
    'NETC Team':               ['WIZ'],
    'Billing Operations Team': ['תפעול בילינג'],
    'Telecom Team':            ['תקשורת'],
  };

  async fetchCrsForTeam(versionId: string, userId: string, userRole: string, teamIdOverride?: string): Promise<{ crNumber: string; crLabel: string; application: string; crManager: string; crDescription: string }[]> {
    const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

    // Resolve team ID
    let resolvedTeamId: string;
    if (teamIdOverride && MANAGERS.includes(userRole)) {
      resolvedTeamId = teamIdOverride;
    } else {
      const membership = await prisma.teamMember.findFirst({ where: { userId }, select: { teamId: true } });
      if (!membership) throw new BadRequestException('המשתמש אינו משויך לאף צוות');
      resolvedTeamId = membership.teamId;
    }

    // Primary: read from VersionCrAssignment table (populated by sync)
    const dbAssignments = await prisma.versionCrAssignment.findMany({
      where: { versionId, teamId: resolvedTeamId },
      orderBy: { crNumber: 'asc' },
    });
    if (dbAssignments.length > 0) {
      return dbAssignments.map(a => ({
        crNumber:      a.crNumber,
        crLabel:       a.crLabel ?? `${a.crNumber}`,
        application:   a.application ?? '',
        crManager:     a.crManager ?? '',
        crDescription: a.crDescription ?? '',
      }));
    }

    // Fallback: read directly from Excel file (before first sync)
    const param = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
    const filePath = param?.value?.trim();
    if (!filePath) throw new BadRequestException('נתיב קובץ הגשת פיתוחים לא הוגדר בפרמטרי המערכת');
    if (!fs.existsSync(filePath)) throw new BadRequestException(`הקובץ לא נמצא בנתיב: ${filePath}`);

    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const team = await prisma.team.findUnique({ where: { id: resolvedTeamId }, select: { name: true } });
    if (!team) throw new BadRequestException('צוות לא נמצא');
    const teamCols = ImportService.TEAM_COLUMNS[team.name];
    if (!teamCols || teamCols.length === 0) throw new BadRequestException(`לא הוגדרו עמודות לצוות "${team.name}" בקובץ`);

    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return [];

    const REQUIRED_COLS = ['# CR', 'כותרת', 'גרסה'];
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = (rows[i] as any[]).map(h => String(h ?? '').trim());
      if (REQUIRED_COLS.every(col => row.includes(col))) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) {
      const sample = (rows[0] as any[]).slice(0, 10).map(h => String(h ?? '').trim()).join(', ');
      throw new BadRequestException(`מבנה הקובץ אינו תקין — עמודות חובה חסרות. עמודות שנמצאו בשורה 1: ${sample}`);
    }

    const headers: string[] = (rows[headerRowIdx] as any[]).map(h => String(h ?? '').trim());
    const colIdx = (name: string) => headers.findIndex(h => h === name);
    const crCol = colIdx('# CR'); const titleCol = colIdx('כותרת'); const verCol = colIdx('גרסה');
    const statusCol = colIdx('סטטוס'); const appCol = colIdx('מאפיין');
    const teamColIdxs = teamCols.map(colIdx).filter(i => i !== -1);
    const COL_DESCRIPTION = 5; const COL_MANAGER = 9;

    const results: { crNumber: string; crLabel: string; application: string; crManager: string; crDescription: string }[] = [];
    const seen = new Set<string>();
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      const crNumber = String(row[crCol] ?? '').trim();
      const title    = String(row[titleCol] ?? '').trim();
      if (!crNumber || !title) continue;
      if (String(row[verCol] ?? '').trim() !== version.name) continue;
      if (String(row[statusCol] ?? '').trim() === 'מבוטל') continue;
      const involved = teamColIdxs.some(ci => {
        const val = parseFloat(String(row[ci] ?? '0').replace(/[^\d.]/g, ''));
        return !isNaN(val) && val > 0.3;
      });
      if (!involved || seen.has(crNumber)) continue;
      seen.add(crNumber);
      results.push({
        crNumber, crLabel: `${crNumber} - ${title}`,
        application:   appCol !== -1 ? String(row[appCol] ?? '').trim() : '',
        crManager:     String(row[COL_MANAGER]     ?? '').trim(),
        crDescription: String(row[COL_DESCRIPTION] ?? '').trim(),
      });
    }
    return results;
  }

  async getCrSummary(versionId: string): Promise<{
    teamId: string;
    teamName: string;
    crListCount: number;
    proposedCount: number;
    submissionStatus: string;
    notRequired: boolean;
    status: 'NONE' | 'PARTIAL' | 'COMPLETE' | 'NOT_REQUIRED' | 'NO_FILE' | 'SUBMITTED_EMPTY' | 'ALL_NOT_NEEDED';
  }[]> {
    // Primary: read from VersionCrAssignment table (populated by sync)
    const exemptRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Team" WHERE "requiresPlan" = false`,
    );
    const exemptTeamIds = new Set(exemptRows.map((r: any) => String(r.id)));

    const dbAssignmentsRaw = await prisma.versionCrAssignment.findMany({
      where: { versionId },
      include: { team: { select: { id: true, name: true } } },
    });
    const dbAssignments = exemptTeamIds.size > 0
      ? dbAssignmentsRaw.filter((a: any) => !exemptTeamIds.has(String(a.teamId)))
      : dbAssignmentsRaw;

    // Build crsByTeam from DB
    const crsByTeamId: Record<string, Set<string>> = {};
    const teamNameById: Record<string, string> = {};
    for (const a of dbAssignments) {
      if (!crsByTeamId[a.teamId]) crsByTeamId[a.teamId] = new Set();
      crsByTeamId[a.teamId].add(a.crNumber);
      teamNameById[a.teamId] = a.team.name;
    }

    // If no DB assignments, return empty (frontend will trigger sync)
    const involvedTeamIds = Object.keys(crsByTeamId);
    if (involvedTeamIds.length === 0) return [];

    // Count proposals per team
    const proposals = await prisma.taskProposal.findMany({
      where: { versionId },
      select: { teamId: true },
    });
    const proposalCountByTeam: Record<string, number> = {};
    for (const p of proposals) {
      if (!p.teamId) continue;
      proposalCountByTeam[p.teamId] = (proposalCountByTeam[p.teamId] ?? 0) + 1;
    }

    // Submission status
    const submissions = await prisma.teamSubmission.findMany({
      where: { versionId },
      select: { teamId: true, status: true, notRequiredForApproval: true },
    });
    const subByTeam: Record<string, { status: string; notRequired: boolean }> = {};
    for (const s of submissions) {
      subByTeam[s.teamId] = { status: s.status, notRequired: (s as any).notRequiredForApproval ?? false };
    }

    // CrPlan not-needed stats
    const allCrPlans = await prisma.crPlan.findMany({
      where: { versionId },
      select: { teamId: true, notNeededForPlan: true },
    });
    const crPlanStatsByTeam: Record<string, { total: number; notNeeded: number }> = {};
    for (const cp of allCrPlans) {
      if (!cp.teamId) continue;
      if (!crPlanStatsByTeam[cp.teamId]) crPlanStatsByTeam[cp.teamId] = { total: 0, notNeeded: 0 };
      crPlanStatsByTeam[cp.teamId].total++;
      if (cp.notNeededForPlan) crPlanStatsByTeam[cp.teamId].notNeeded++;
    }

    return involvedTeamIds.map(teamId => {
      const teamName       = teamNameById[teamId] ?? '';
      const crListCount    = crsByTeamId[teamId]?.size ?? 0;
      const proposedCount  = proposalCountByTeam[teamId] ?? 0;
      const sub            = subByTeam[teamId];
      const submissionStatus = sub?.status ?? 'NOT_STARTED';
      const notRequired    = sub?.notRequired ?? false;
      const cpStats        = crPlanStatsByTeam[teamId];
      const allCrPlansNotNeeded = !!(cpStats && cpStats.total > 0 && cpStats.total === cpStats.notNeeded);
      const notNeededCount = cpStats?.notNeeded ?? 0;
      const handledCount   = proposedCount + notNeededCount;

      let status: 'NONE' | 'PARTIAL' | 'COMPLETE' | 'NOT_REQUIRED' | 'NO_FILE' | 'SUBMITTED_EMPTY' | 'ALL_NOT_NEEDED';
      if (notRequired) status = 'NOT_REQUIRED';
      else if (submissionStatus === 'SUBMITTED' && proposedCount === 0 && allCrPlansNotNeeded) status = 'ALL_NOT_NEEDED';
      else if (submissionStatus === 'SUBMITTED' && proposedCount === 0) status = 'SUBMITTED_EMPTY';
      else if (proposedCount === 0) status = 'NONE';
      else if (handledCount >= crListCount) status = 'COMPLETE';
      else status = 'PARTIAL';

      return { teamId, teamName, crListCount, proposedCount, notNeededCount, submissionStatus, notRequired, status };
    }).sort((a, b) => a.teamName.localeCompare(b.teamName, 'he'));
  }

  async teamsWithoutProposals(versionId: string): Promise<{ name: string; crCount: number }[]> {
    const param = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
    const filePath = param?.value?.trim();
    if (!filePath || !fs.existsSync(filePath)) return [];

    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });
    if (!version) return [];

    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return [];

    const REQUIRED_COLS = ['# CR', 'כותרת', 'גרסה'];
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = (rows[i] as any[]).map(h => String(h ?? '').trim());
      if (REQUIRED_COLS.every(col => row.includes(col))) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) return [];

    const headers: string[] = (rows[headerRowIdx] as any[]).map(h => String(h ?? '').trim());
    const colIdx = (name: string) => headers.findIndex(h => h === name);
    const verCol    = colIdx('גרסה');
    const statusCol = colIdx('סטטוס');
    const crCol     = colIdx('# CR');

    // Build a map: teamName → Set of unique CR numbers they're involved in
    const crsByTeam: Record<string, Set<string>> = {};
    for (const [teamName, teamCols] of Object.entries(ImportService.TEAM_COLUMNS)) {
      const teamColIdxs = teamCols.map(colIdx).filter(i => i !== -1);
      if (teamColIdxs.length === 0) continue;
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        if (String(row[verCol] ?? '').trim() !== version.name) continue;
        if (String(row[statusCol] ?? '').trim() === 'מבוטל') continue;
        const involved = teamColIdxs.some(ci => {
          const val = parseFloat(String(row[ci] ?? '0').replace(/[^\d.]/g, ''));
          return !isNaN(val) && val > 1;
        });
        if (involved) {
          if (!crsByTeam[teamName]) crsByTeam[teamName] = new Set();
          const crNum = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
          if (crNum) crsByTeam[teamName].add(crNum);
        }
      }
    }

    const involvedTeamNames = new Set(Object.keys(crsByTeam));
    if (involvedTeamNames.size === 0) return [];

    const allTeams = await prisma.team.findMany({
      where: { name: { in: [...involvedTeamNames] } },
      select: { id: true, name: true },
    });
    const teamIdByName: Record<string, string> = {};
    allTeams.forEach(t => { teamIdByName[t.name] = t.id; });

    const proposals = await prisma.taskProposal.findMany({
      where: { versionId },
      select: { teamId: true },
    });
    const teamsWithProposals = new Set(proposals.map(p => p.teamId));

    const notRequiredSubs = await prisma.teamSubmission.findMany({
      where: { versionId, notRequiredForApproval: true },
      select: { teamId: true },
    });
    const notRequiredIds = new Set(notRequiredSubs.map((s: any) => s.teamId));

    const missing: { name: string; crCount: number; notRequired: boolean }[] = [];
    for (const teamName of involvedTeamNames) {
      const teamId = teamIdByName[teamName];
      if (!teamId) continue;
      const isNotRequired = notRequiredIds.has(teamId);
      const hasProposals = teamsWithProposals.has(teamId);
      // Include: teams that haven't submitted (pending) OR teams marked as not-required
      if (isNotRequired || !hasProposals) {
        missing.push({ name: teamName, crCount: crsByTeam[teamName]?.size ?? 0, notRequired: isNotRequired });
      }
    }

    return missing.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }
}
