import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { VersionCrAssignmentsController } from './version-cr-assignments.controller';
import { VersionCrAssignmentsService } from './version-cr-assignments.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [VersionCrAssignmentsController],
  providers: [VersionCrAssignmentsService],
})
export class VersionCrAssignmentsModule {}
