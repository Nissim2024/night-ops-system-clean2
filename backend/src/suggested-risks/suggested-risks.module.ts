import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SuggestedRisksService } from './suggested-risks.service';
import { SuggestedRisksController } from './suggested-risks.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [SuggestedRisksController],
  providers: [SuggestedRisksService],
  exports: [SuggestedRisksService],
})
export class SuggestedRisksModule {}
