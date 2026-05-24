import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QcReleasesController } from './qc-releases.controller';
import { QcReleasesService } from './qc-releases.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [QcReleasesController],
  providers: [QcReleasesService],
  exports: [QcReleasesService],
})
export class QcReleasesModule {}
