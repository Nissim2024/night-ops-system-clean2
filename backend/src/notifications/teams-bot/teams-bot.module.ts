import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TeamsBotService } from './teams-bot.service';
import { TeamsBotController } from './teams-bot.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [TeamsBotController],
  providers: [TeamsBotService],
})
export class TeamsBotModule {}
