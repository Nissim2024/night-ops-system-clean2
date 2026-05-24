import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { VersionTemplatesController } from './version-templates.controller';
import { VersionTemplatesService } from './version-templates.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [VersionTemplatesController],
  providers: [VersionTemplatesService],
})
export class VersionTemplatesModule {}
