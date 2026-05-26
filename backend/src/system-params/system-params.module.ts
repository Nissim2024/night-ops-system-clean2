import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SystemParamsService } from './system-params.service';
import { SystemParamsController } from './system-params.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [SystemParamsController],
  providers: [SystemParamsService],
  exports: [SystemParamsService],
})
export class SystemParamsModule {}
