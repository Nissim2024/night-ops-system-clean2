import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
  imports: [
    // Global rate limiting: max 100 requests per minute per IP
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule, UsersModule, TasksModule, TeamsModule, VersionsModule,
    EventsModule, ImportModule, SummaryModule, PermissionsModule, QcModule, QcReleasesModule,
    VersionTemplatesModule, TaskProposalsModule, CrPlansModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
