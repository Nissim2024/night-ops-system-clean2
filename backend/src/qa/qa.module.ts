import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { QaController } from './qa.controller';
import { QaStatsController } from './qa-stats.controller';
import { QaMyTasksController } from './qa-my-tasks.controller';
import { QaService } from './qa.service';
import { QaAdminGuard } from './qa-admin.guard';
import { QaWorkPlanService } from './qa-workplan.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    MulterModule.register({
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [QaController, QaStatsController, QaMyTasksController],
  providers:   [QaService, QaAdminGuard, QaWorkPlanService],
})
export class QaModule {}
