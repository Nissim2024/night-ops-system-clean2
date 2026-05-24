import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Strict rate limit on login: 10 attempts per 15 minutes
  @Throttle({ default: { ttl: 15 * 60 * 1000, limit: 10 } })
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  // /auth/register has been intentionally removed.
  // User creation is handled exclusively by ADMIN via POST /users.
}
