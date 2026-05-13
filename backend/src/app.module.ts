import { Module } from '@nestjs/common';
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

@Module({
imports: [AuthModule, UsersModule, TasksModule, TeamsModule, VersionsModule, EventsModule, ImportModule, SummaryModule],  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}