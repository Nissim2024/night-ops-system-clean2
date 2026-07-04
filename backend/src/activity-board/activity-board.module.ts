import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EmailModule } from '../email/email.module';
import { ActivityBoardController } from './activity-board.controller';
import { ActivityBoardService } from './activity-board.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    EmailModule,
  ],
  controllers: [ActivityBoardController],
  providers:   [ActivityBoardService],
})
export class ActivityBoardModule {}
