import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CrPlansController } from './cr-plans.controller';
import { CrPlansService } from './cr-plans.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [CrPlansController],
  providers: [CrPlansService],
  exports: [CrPlansService],
})
export class CrPlansModule {}
