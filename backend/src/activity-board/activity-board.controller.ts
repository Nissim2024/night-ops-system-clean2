import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import type { EntryInput, EntryPatch } from './activity-board.service';
import { ActivityBoardService } from './activity-board.service';

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('activity-board')
export class ActivityBoardController {
  constructor(private readonly svc: ActivityBoardService) {}

  @Get(':versionId')
  getBoard(@Param('versionId') versionId: string) {
    return this.svc.getBoard(versionId);
  }

  @Delete(':versionId')
  deleteBoard(@Param('versionId') versionId: string, @Request() req: any) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('רק מנהל לילה יכול למחוק לוח פעילויות');
    return this.svc.deleteBoard(versionId);
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

  @Patch(':versionId/by-key/:key')
  patchByKey(
    @Param('versionId') versionId: string,
    @Param('key') key: string,
    @Body() patch: Record<string, any>,
  ) {
    return this.svc.patchByKey(versionId, key, patch as EntryPatch);
  }

  @Post(':versionId/bulk-replace')
  bulkReplace(
    @Param('versionId') versionId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.bulkReplace(versionId, body.from as string, body.to as string);
  }

  @Post('entry/:entryId/invite')
  sendInvite(
    @Param('entryId') entryId: string,
    @Body('attendees') attendees: string[],
  ) {
    return this.svc.sendInvite(entryId, attendees ?? []);
  }
}
