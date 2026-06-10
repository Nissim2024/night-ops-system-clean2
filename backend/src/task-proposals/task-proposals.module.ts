import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TaskProposalsController } from './task-proposals.controller';
import { TaskProposalsService } from './task-proposals.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    EventsModule,
  ],
  controllers: [TaskProposalsController],
  providers: [TaskProposalsService],
  exports: [TaskProposalsService],
})
export class TaskProposalsModule {}
