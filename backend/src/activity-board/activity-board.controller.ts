import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import type { EntryInput, EntryPatch } from './activity-board.service';
import { ActivityBoardService } from './activity-board.service';

@UseGuards(JwtGuard)
@Controller('activity-board')
export class ActivityBoardController {
  constructor(private readonly svc: ActivityBoardService) {}

  @Get(':versionId')
  getBoard(@Param('versionId') versionId: string) {
    return this.svc.getBoard(versionId);
  }

  @Post(':versionId/save')
  saveBoard(
    @Param('versionId') versionId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.saveBoard(versionId, (body.entries ?? []) as EntryInput[]);
  }

  @Patch('entry/:entryId')
  patchEntry(
    @Param('entryId') entryId: string,
    @Body() patch: Record<string, any>,
  ) {
    return this.svc.patchEntry(entryId, patch as EntryPatch);
  }

  @Post(':versionId/bulk-replace')
  bulkReplace(
    @Param('versionId') versionId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.bulkReplace(versionId, body.from as string, body.to as string);
  }
}
