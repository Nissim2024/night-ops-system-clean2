import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActivityBoardController } from './activity-board.controller';
import { ActivityBoardService } from './activity-board.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [ActivityBoardController],
  providers:   [ActivityBoardService],
})
export class ActivityBoardModule {}
