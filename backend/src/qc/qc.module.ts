import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [QcController],
  providers: [QcService],
  exports: [QcService],
})
export class QcModule {}
