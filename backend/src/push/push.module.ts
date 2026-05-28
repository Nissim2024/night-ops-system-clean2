import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PushService } from './push.service';
import { PushController } from './push.controller';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  providers: [PushService],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
