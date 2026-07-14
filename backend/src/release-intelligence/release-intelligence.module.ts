import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ReleaseIntelligenceController } from './release-intelligence.controller';
import { ReleaseIntelligenceService } from './release-intelligence.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [ReleaseIntelligenceController],
  providers: [ReleaseIntelligenceService],
  exports: [ReleaseIntelligenceService],
})
export class ReleaseIntelligenceModule {}
