import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FailureReasonsController } from './failure-reasons.controller';
import { FailureReasonsService } from './failure-reasons.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [FailureReasonsController],
  providers: [FailureReasonsService],
  exports: [FailureReasonsService],
})
export class FailureReasonsModule {}
