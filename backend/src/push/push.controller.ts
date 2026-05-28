import { Controller, Post, Delete, Get, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('push')
export class PushController {
  constructor(private pushService: PushService) {}

  @Get('vapid-public-key')
  getPublicKey() {
    return { publicKey: this.pushService.getPublicKey() };
  }

  @Post('subscribe')
  subscribe(@Body() body: any, @Request() req: any) {
    const { role } = req.user;
    // body contains endpoint/keys from PushSubscription.toJSON(); role stored alongside
    this.pushService.addSubscription(req.user.sub, role, body);
    return { ok: true };
  }

  @Delete('subscribe')
  unsubscribe(@Request() req: any) {
    this.pushService.removeSubscription(req.user.sub);
    return { ok: true };
  }

  @Get('status')
  getStatus() {
    return { enabled: this.pushService.isPushEnabled() };
  }

  @Post('toggle')
  toggle(@Body() body: { enabled: boolean }, @Request() req: any) {
    if (!MANAGERS.includes(req.user.role)) {
      throw new ForbiddenException('רק מנהל לילה או מנהל מערכת יכולים לשנות הגדרות PUSH');
    }
    this.pushService.setPushEnabled(body.enabled);
    return { enabled: this.pushService.isPushEnabled() };
  }

  @Get('subscribed-users')
  getSubscribedUsers() {
    return this.pushService.getSubscribedUserIds();
  }
}
