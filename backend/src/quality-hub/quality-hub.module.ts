import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { QcModule } from '../qc/qc.module';
import { QualityHubService } from './quality-hub.service';
import { QualityHubController } from './quality-hub.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
    MulterModule.register({
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
    QcModule,
  ],
  controllers: [QualityHubController],
  providers: [QualityHubService],
  exports: [QualityHubService],
})
export class QualityHubModule {}
