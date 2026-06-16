import { Controller, Post, Get, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LdapService } from './ldap.service';
import { JwtGuard } from './jwt/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private ldapService: LdapService,
  ) {}

  // Strict rate limit on login: 10 attempts per 15 minutes
  @Throttle({ default: { ttl: 15 * 60 * 1000, limit: 10 } })
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    if (!body?.email || typeof body.email !== 'string' || !body.email.trim()) {
      throw new BadRequestException('email is required');
    }
    if (!body?.password || typeof body.password !== 'string') {
      throw new BadRequestException('password is required');
    }
    return this.authService.login(body.email.trim(), body.password);
  }

  // Public — tells the frontend whether LDAP mode is active (changes login label)
  @Get('config')
  async config() {
    const ldapEnabled = await this.ldapService.isEnabled().catch(() => false);
    return { ldapEnabled };
  }

  // Protected — admin only, tests the LDAP service-account bind
  @UseGuards(JwtGuard)
  @Post('ldap-test')
  testLdap() {
    return this.ldapService.testConnection();
  }
}
