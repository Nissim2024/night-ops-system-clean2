import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { RunbookController } from './runbook.controller';
import { RunbookService } from './runbook.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    NotificationsModule,
  ],
  controllers: [RunbookController],
  providers:   [RunbookService],
})
export class RunbookModule {}
