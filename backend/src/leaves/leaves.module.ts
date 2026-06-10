import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [LeavesController],
  providers:   [LeavesService],
})
export class LeavesModule {}
