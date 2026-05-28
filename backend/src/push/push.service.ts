import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  urgent?: boolean;
  data?: Record<string, any>;
}

const MANAGER_ROLES = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly subscriptions = new Map<string, { sub: webpush.PushSubscription; role: string }>();
  private pushEnabled = true;

  private get vapidReady() {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  constructor() {
    if (this.vapidReady) {
      webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@company.com',
        process.env.VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      );
      this.logger.log('Web Push enabled');
    } else {
      this.logger.warn('VAPID keys not configured — push notifications disabled');
    }
  }

  getPublicKey(): string { return process.env.VAPID_PUBLIC_KEY || ''; }
  setPushEnabled(enabled: boolean) { this.pushEnabled = enabled; }
  isPushEnabled() { return this.pushEnabled; }
  getSubscribedUserIds(): string[] { return Array.from(this.subscriptions.keys()); }

  addSubscription(userId: string, role: string, sub: webpush.PushSubscription) {
    this.subscriptions.set(userId, { sub, role });
    this.logger.log(`Push subscription registered for user ${userId} (${role})`);
  }

  removeSubscription(userId: string) {
    this.subscriptions.delete(userId);
  }

  async sendToAll(payload: PushPayload) {
    if (!this.vapidReady || !this.pushEnabled || this.subscriptions.size === 0) return;
    const body = JSON.stringify(payload);
    const expired: string[] = [];

    await Promise.allSettled(
      Array.from(this.subscriptions.entries()).map(async ([userId, { sub }]) => {
        try {
          await webpush.sendNotification(sub, body);
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) expired.push(userId);
          else this.logger.warn(`Push failed for ${userId}: ${err.message}`);
        }
      }),
    );

    expired.forEach(id => this.subscriptions.delete(id));
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<'sent' | 'not-subscribed' | 'disabled'> {
    if (!this.vapidReady || !this.pushEnabled) return 'disabled';
    const entry = this.subscriptions.get(userId);
    if (!entry) return 'not-subscribed';
    try {
      await webpush.sendNotification(entry.sub, JSON.stringify(payload));
      return 'sent';
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) this.subscriptions.delete(userId);
      else this.logger.warn(`Push to ${userId} failed: ${err.message}`);
      return 'not-subscribed';
    }
  }

  async sendToManagers(payload: PushPayload) {
    if (!this.vapidReady || !this.pushEnabled) return;
    const expired: string[] = [];
    await Promise.allSettled(
      Array.from(this.subscriptions.entries())
        .filter(([, { role }]) => MANAGER_ROLES.includes(role))
        .map(async ([userId, { sub }]) => {
          try {
            await webpush.sendNotification(sub, JSON.stringify(payload));
          } catch (err: any) {
            if (err.statusCode === 410 || err.statusCode === 404) expired.push(userId);
            else this.logger.warn(`Push to manager ${userId} failed: ${err.message}`);
          }
        }),
    );
    expired.forEach(id => this.subscriptions.delete(id));
  }
}
