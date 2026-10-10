import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserThrottlerGuard } from './user-throttler.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamsModule } from './teams/teams.module';
import { VersionsModule } from './versions/versions.module';
import { EventsModule } from './events/events.module';
import { ImportModule } from './import/import.module';
import { SummaryModule } from './summary/summary.module';
import { PermissionsModule } from './permissions/permissions.module';
import { QcModule } from './qc/qc.module';
import { QcReleasesModule } from './qc-releases/qc-releases.module';
import { VersionTemplatesModule } from './version-templates/version-templates.module';
import { TaskProposalsModule } from './task-proposals/task-proposals.module';
import { CrPlansModule } from './cr-plans/cr-plans.module';
import { PushModule } from './push/push.module';
import { VersionCrAssignmentsModule } from './version-cr-assignments/version-cr-assignments.module';
import { SystemParamsModule } from './system-params/system-params.module';
import { FailureReasonsModule } from './failure-reasons/failure-reasons.module';
import { QaModule } from './qa/qa.module';
import { LeavesModule } from './leaves/leaves.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TeamsBotModule } from './notifications/teams-bot/teams-bot.module';
import { ActivityBoardModule } from './activity-board/activity-board.module';
import { RunbookModule } from './runbook/runbook.module';
import { HealthModule } from './health/health.module';
import { ReleaseIntelligenceModule } from './release-intelligence/release-intelligence.module';
import { QualityHubModule } from './quality-hub/quality-hub.module';
import { TargetCrModule } from './target-cr/target-cr.module';
import { IncidentsModule } from './incidents/incidents.module';
import { SuggestedRisksModule } from './suggested-risks/suggested-risks.module';

import { AiModule } from './ai/ai.controller';
@Module({
  imports: [
    AiModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'dev'}`,
    }),
    // Abuse guard: 600 requests / minute per signed-in USER (not per IP — all
    // traffic comes through nginx, users may share an address). Login has its
    // own 10 / 15 min per IP + e-mail (auth.controller). See UserThrottlerGuard.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    ScheduleModule.forRoot(),
    PushModule,
    AuthModule, UsersModule, TasksModule, TeamsModule, VersionsModule,
    EventsModule, ImportModule, SummaryModule, PermissionsModule, QcModule, QcReleasesModule,
    VersionTemplatesModule, TaskProposalsModule, CrPlansModule, VersionCrAssignmentsModule,
    SystemParamsModule, FailureReasonsModule, QaModule, LeavesModule, NotificationsModule,
    TeamsBotModule,
    ActivityBoardModule,
    RunbookModule,
    HealthModule,
    ReleaseIntelligenceModule,
    QualityHubModule,
    TargetCrModule,
    IncidentsModule,
    SuggestedRisksModule,
  ],
  controllers: [AppController],
  providers: [
    // the throttler's guard was never registered — nothing was limited (regression 2026-10-10)
    { provide: APP_GUARD, useClass: UserThrottlerGuard },AppService],
})
export class AppModule {}
