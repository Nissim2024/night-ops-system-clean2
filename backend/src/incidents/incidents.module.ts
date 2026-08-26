import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { QcModule } from '../qc/qc.module';

@Module({
  imports: [
    QcModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
