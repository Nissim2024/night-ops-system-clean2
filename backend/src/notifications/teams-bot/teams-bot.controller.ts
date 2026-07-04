import { Controller, Post, Body, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TeamsBotService } from './teams-bot.service';

// No JwtGuard here — the caller is Microsoft's Bot Framework connector, not
// our own frontend. Authenticity is verified inside the service via the
// Bot Framework JWT (see TeamsBotService.verifyIncomingToken).
@Controller('notifications/teams/bot')
export class TeamsBotController {
  constructor(private readonly teamsBotService: TeamsBotService) {}

  @Post('messages')
  async messages(@Body() activity: any, @Headers('authorization') authHeader: string, @Res() res: Response) {
    const result = await this.teamsBotService.handleActivity(activity, authHeader);
    res.status(result.status).send(result.body ?? {});
  }
}
