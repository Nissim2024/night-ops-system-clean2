import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const COLOR_PHASE = 'FF00B0F0';
const COLOR_SUBPHASE = 'FFBF9000';
const COLOR_GONOGO = 'FF00B050';
const COLOR_ALERT = 'FFFF0000';

interface ParsedRow {
  type: 'PHASE' | 'SUBPHASE' | 'TASK' | 'GO_NOGO' | 'ALERT';
  resource: string;
  taskName: string;
  crNumber: string;
  notes: string;
  application: string;
  team: string;
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

  private parseRowType(color: string): ParsedRow['type'] {
    if (color === COLOR_PHASE) return 'PHASE';
    if (color === COLOR_SUBPHASE) return 'SUBPHASE';
    if (color === COLOR_GONOGO) return 'GO_NOGO';
    if (color === COLOR_ALERT) return 'ALERT';
    return 'TASK';
  }

  async importFromBuffer(
    buffer: Buffer,
    versionName: string,
    createdBy: string,
  ): Promise<{ success: boolean; message: string; stats: any }> {

    const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows: ParsedRow[] = [];

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

    for (let R = 1; R <= range.e.r; R++) {
      const cellA = sheet[XLSX.utils.encode_cell({ r: R, c: 0 })];
      const cellB = sheet[XLSX.utils.encode_cell({ r: R, c: 1 })];
      const cellC = sheet[XLSX.utils.encode_cell({ r: R, c: 2 })];
      const cellD = sheet[XLSX.utils.encode_cell({ r: R, c: 3 })];
      const cellE = sheet[XLSX.utils.encode_cell({ r: R, c: 4 })];
      const cellF = sheet[XLSX.utils.encode_cell({ r: R, c: 5 })];

      const taskName = cellB?.v ? String(cellB.v).trim() : '';
      if (!taskName) continue;

      // קבל צבע מעמודה A, אם ריק - מעמודה B
      const colorA = this.getCellColor(cellA);
      const colorB = this.getCellColor(cellB);
      const color = colorA !== 'FFFFFFFF' && colorA !== 'THEME' ? colorA : colorB;

      rows.push({
        type: this.parseRowType(color),
        resource: cellA?.v ? String(cellA.v).trim() : '',
        taskName,
        crNumber: cellC?.v ? String(cellC.v).trim() : '',
        notes: cellD?.v ? String(cellD.v).trim() : '',
        application: cellE?.v ? String(cellE.v).trim() : '',
        team: cellF?.v ? String(cellF.v).trim() : '',
      });
    }

    // מיפוי שמות צוותים
    const teamNameMap: Record<string, string> = {
      'QA Team': 'QA Team', 'NOC': 'NOC', 'DBA Team': 'DBA Team',
      'EAI Team': 'EAI Team', 'CRM Team': 'CRM Team', 'CRM TEAM': 'CRM Team',
      'NETC Team': 'NETC Team', 'Operation': 'Operation', 'ETL': 'Operation',
      'ERP': 'Operation', 'NC': 'Operation',
    };

    // טעינת צוותים קיימים
    const teams = await prisma.team.findMany({ where: { active: true } });
    const teamMap: Record<string, string> = {};
    teams.forEach(t => { teamMap[t.name] = t.id; });

    // יצירת גרסה חדשה
    const version = await prisma.version.create({
      data: {
        name: versionName,
        description: `יובא מקובץ Excel`,
        status: 'DRAFT',
        createdBy,
      },
    });

    // יצירת TeamSubmissions
    await prisma.teamSubmission.createMany({
      data: teams.map(t => ({ versionId: version.id, teamId: t.id })),
    });

    let currentPhase: any = null;
    let currentSubPhase: any = null;
    let phaseOrder = 0;
    let subPhaseOrder = 0;
    let taskOrder = 0;
    let taskCount = 0;
    let goNoGoCount = 0;
    let alertCount = 0;

    for (const row of rows) {
      if (row.type === 'PHASE') {
        phaseOrder++;
        subPhaseOrder = 0;
        taskOrder = 0;

        // זיהוי סביבה לפי שם השלב
        let environment: any = 'BOTH';
        if (row.taskName.includes('הוטנט') || row.taskName.includes('HOTNET')) environment = 'HOTNET';
        else if (row.taskName.includes('הוט') && !row.taskName.includes('הוטנט')) environment = 'HOT';

        currentPhase = await prisma.phase.create({
          data: {
            versionId: version.id,
            name: row.taskName,
            orderIndex: phaseOrder,
            environment,
          },
        });
        currentSubPhase = null;

      } else if (row.type === 'SUBPHASE') {
        if (!currentPhase) continue;
        subPhaseOrder++;
        taskOrder = 0;

        currentSubPhase = await prisma.subPhase.create({
          data: {
            phaseId: currentPhase.id,
            name: row.taskName,
            orderIndex: subPhaseOrder,
          },
        });

      } else if (row.type === 'GO_NOGO') {
        goNoGoCount++;
        if (!currentPhase) continue;

        // אם אין תת-שלב נוכחי — צור אחד
        if (!currentSubPhase) {
          subPhaseOrder++;
          currentSubPhase = await prisma.subPhase.create({
            data: {
              phaseId: currentPhase.id,
              name: 'GO/NO GO',
              orderIndex: subPhaseOrder,
            },
          });
        }

        taskOrder++;
        const teamName = teamNameMap[row.team] || row.team;
        const teamId = teamMap[teamName];

        await prisma.task.create({
          data: {
            subPhaseId: currentSubPhase.id,
            versionId: version.id,
            title: row.taskName,
            assignedUserName: row.resource,
            assignedTeamId: teamId,
            application: row.application,
            notes: row.notes,
            crNumber: row.crNumber,
            status: 'WAITING',
            isCritical: true,
            isCriticalForGo: true,
            orderIndex: taskOrder,
            createdBy,
          },
        });
        taskCount++;

      } else if (row.type === 'ALERT') {
        alertCount++;
        if (!currentSubPhase) continue;

        taskOrder++;
        const teamName = teamNameMap[row.team] || row.team;
        const teamId = teamMap[teamName];

        await prisma.task.create({
          data: {
            subPhaseId: currentSubPhase.id,
            versionId: version.id,
            title: `[התראה] ${row.taskName}`,
            assignedUserName: row.resource,
            assignedTeamId: teamId,
            application: row.application,
            notes: row.notes,
            crNumber: row.crNumber,
            status: 'WAITING',
            orderIndex: taskOrder,
            createdBy,
          },
        });
        taskCount++;

      } else {
        // TASK רגיל
        if (!currentSubPhase) continue;

        taskOrder++;
        const teamName = teamNameMap[row.team] || row.team;
        const teamId = teamMap[teamName];

        await prisma.task.create({
          data: {
            subPhaseId: currentSubPhase.id,
            versionId: version.id,
            title: row.taskName,
            assignedUserName: row.resource,
            assignedTeamId: teamId,
            application: row.application,
            notes: row.notes,
            crNumber: row.crNumber,
            status: 'WAITING',
            orderIndex: taskOrder,
            createdBy,
          },
        });
        taskCount++;
      }
    }

    return {
      success: true,
      message: `הייבוא הושלם בהצלחה`,
      stats: {
        versionId: version.id,
        versionName: version.name,
        phases: phaseOrder,
        subPhases: subPhaseOrder,
        tasks: taskCount,
        goNoGo: goNoGoCount,
        alerts: alertCount,
      },
    };
  }
}