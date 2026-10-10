import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LdapService } from './ldap.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    // (no ThrottlerModule here: a second forRoot replaced the app-wide limits
    // with 10 / 15 min for EVERY route — login's own limit is the @Throttle on
    // AuthController.login; regression 2026-10-10)
    JwtModule.register({
      // JWT_SECRET presence is guaranteed by main.ts fail-fast check
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LdapService],
  exports: [AuthService],
})
export class AuthModule {}
