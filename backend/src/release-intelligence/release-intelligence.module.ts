import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ReleaseIntelligenceController } from './release-intelligence.controller';
import { ReleaseIntelligenceService } from './release-intelligence.service';
import { ReleaseInsightsController } from './release-insights.controller';
import { ReleaseInsightsService } from './release-insights.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [ReleaseIntelligenceController, ReleaseInsightsController],
  providers: [ReleaseIntelligenceService, ReleaseInsightsService],
  exports: [ReleaseIntelligenceService],
})
export class ReleaseIntelligenceModule {}
