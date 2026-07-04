import {
  Controller, Post, Get, Patch, Body, Param, Res, UseGuards,
  Request, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SummaryService } from './summary.service';
import { EmailService } from '../email/email.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const MANAGERS  = ['RELEASE_MANAGER', 'ADMIN'];
const LEADS_UP  = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('summary')
export class SummaryController {
  constructor(
    private summaryService: SummaryService,
    private emailService: EmailService,
  ) {}

  @Get(':versionId')
  async getSummary(@Param('versionId') versionId: string) {
    return this.summaryService.findByVersion(versionId);
  }

  @Post(':versionId/approve')
  async approveSummary(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { headline?: string; morningNotes?: string; crData?: any; force?: boolean },
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לאשר סיכום');
    const canForce = MANAGERS.includes(req.user.role);
    return this.summaryService.approve(versionId, req.user.sub, body.headline, body.morningNotes, body.crData, !!(body.force && canForce));
  }

  @Patch(':versionId')
  async updateSummary(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { headline?: string; morningNotes?: string; crData?: any },
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן סיכום מאושר');
    return this.summaryService.updateApproved(versionId, body.headline, body.morningNotes, body.crData);
  }

  @Get(':versionId/rehearsal')
  async getRehearsalSummary(@Param('versionId') versionId: string) {
    return this.summaryService.findRehearsalByVersion(versionId);
  }

  @Patch(':versionId/rehearsal')
  async updateRehearsalSummary(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { headline?: string; morningNotes?: string; crData?: any },
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן סיכום חזרה מאושר');
    return this.summaryService.updateApprovedRehearsal(versionId, body.headline, body.morningNotes, body.crData);
  }

  @Post(':versionId/rehearsal/approve')
  async approveRehearsalSummary(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { headline?: string; morningNotes?: string; crData?: any },
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לאשר סיכום חזרה');
    return this.summaryService.approveRehearsal(versionId, req.user.sub, body.headline, body.morningNotes, body.crData);
  }

  @Post(':versionId/night-download')
  async downloadNightReport(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { versionName: string; headline?: string; morningNotes?: string },
    @Res() res: Response,
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה להורדת דוח');
    const gate = await this.summaryService.canDownload(versionId, req.user.role);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);
    const buffer = await this.summaryService.generateNightSummary(
      versionId,
      body.headline || '',
      body.morningNotes || '',
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="night-${body.versionName}-${new Date().toISOString().slice(0,10)}.docx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Post(':versionId/rehearsal-download')
  async downloadRehearsalReport(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { versionName: string; headline?: string; morningNotes?: string },
    @Res() res: Response,
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה להורדת דוח');
    const buffer = await this.summaryService.generateRehearsalSummary(
      versionId,
      body.headline || '',
      body.morningNotes || '',
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="rehearsal-${body.versionName}-${new Date().toISOString().slice(0,10)}.docx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Post('generate')
  async generateWord(
    @Request() req: any,
    @Body() body: { versionId: string; versionName: string; headline: string; morningNotes: string; isRehearsal?: boolean },
    @Res() res: Response,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להפיק דוח');
    const buffer = await this.summaryService.generateSummary(
      body.versionId,
      body.headline,
      body.morningNotes,
      body.isRehearsal ?? false,
    );
    const prefix = body.isRehearsal ? 'rehearsal' : 'summary';
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${prefix}-${body.versionName}-${new Date().toISOString().slice(0,10)}.docx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get(':versionId/night-stats')
  async getNightStats(@Param('versionId') versionId: string, @Request() req: any) {
    requireRole(req, MANAGERS);
    return this.summaryService.getNightStats(versionId);
  }

  @Get('email/config')
  async getEmailConfig() {
    return this.emailService.getConfig();
  }

  @Post(':versionId/send-email')
  async sendEmail(
    @Param('versionId') _versionId: string,
    @Request() req: any,
    @Body() body: { subject: string; text: string; extraRecipients?: string[] },
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לשליחת מייל');
    if (!body.subject || !body.text) throw new BadRequestException('חסר נושא או גוף המייל');
    try {
      await this.emailService.sendEmail(body.subject, body.text, body.extraRecipients);
      return { ok: true };
    } catch (err: any) {
      throw new BadRequestException(err.message || 'שגיאה בשליחת המייל');
    }
  }
}
