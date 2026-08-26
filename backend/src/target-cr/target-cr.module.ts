import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TargetCrController } from './target-cr.controller';
import { TargetCrService } from './target-cr.service';
import { QcModule } from '../qc/qc.module';
import { CrPlansModule } from '../cr-plans/cr-plans.module';

@Module({
  imports: [
    QcModule,
    CrPlansModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [TargetCrController],
  providers: [TargetCrService],
  exports: [TargetCrService],
})
export class TargetCrModule {}
