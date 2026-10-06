import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { VersionCrAssignmentsController } from './version-cr-assignments.controller';
import { VersionCrAssignmentsService } from './version-cr-assignments.service';
import { QcModule } from '../qc/qc.module';
import { QaModule } from '../qa/qa.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    QcModule,
    QaModule,
    PermissionsModule,
  ],
  controllers: [VersionCrAssignmentsController],
  providers: [VersionCrAssignmentsService],
})
export class VersionCrAssignmentsModule {}
