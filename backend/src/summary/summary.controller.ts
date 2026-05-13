import { Controller, Post, Body, Res, UseGuards, Request } from '@nestjs/common';
import type { Response } from 'express';import { SummaryService } from './summary.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('summary')
export class SummaryController {
  constructor(private summaryService: SummaryService) {}

  @Post('generate')
  async generateWord(
    @Body() body: { versionId: string; versionName: string; headline: string; morningNotes: string },
    @Res() res: Response,
  ) {
    const buffer = await this.summaryService.generateSummary(
      body.versionId,
      body.headline,
      body.morningNotes,
    );

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="summary-${body.versionName}-${new Date().toISOString().slice(0,10)}.docx"`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }
}