import { Controller, Post, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post('test/teams')
  testTeams() { return this.service.testTeams(); }

  @Post('test/telegram')
  testTelegram() { return this.service.testTelegram(); }
}
