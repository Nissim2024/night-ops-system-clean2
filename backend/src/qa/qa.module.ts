import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QaController } from './qa.controller';
import { QaStatsController } from './qa-stats.controller';
import { QaService } from './qa.service';
import { QaAdminGuard } from './qa-admin.guard';
import { QaWorkPlanService } from './qa-workplan.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [QaController, QaStatsController],
  providers:   [QaService, QaAdminGuard, QaWorkPlanService],
})
export class QaModule {}
