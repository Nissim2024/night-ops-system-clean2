import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { PushService, PushPayload } from '../push/push.service';

const prisma = new PrismaClient();

const DEFAULTS = [
  { key: 'TEAMS_ENABLED',      label: 'Microsoft Teams — הפעל',        value: 'false', type: 'boolean' },
  { key: 'TEAMS_WEBHOOK_URL',  label: 'Microsoft Teams — Webhook URL',  value: '',      type: 'string'  },
  { key: 'TELEGRAM_ENABLED',   label: 'Telegram — הפעל',                value: 'false', type: 'boolean' },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram — Bot Token',           value: '',      type: 'string'  },
  { key: 'TELEGRAM_CHAT_ID',   label: 'Telegram — Chat ID',             value: '',      type: 'string'  },
];

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly pushService: PushService) {}

  async onModuleInit() {
    for (const d of DEFAULTS) {
      await prisma.systemParam.upsert({
        where: { key: d.key },
        update: {},
        create: d,
      });
    }
  }

  private async param(key: string): Promise<string> {
    const p = await prisma.systemParam.findUnique({ where: { key } });
    return p?.value ?? '';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async sendToAll(payload: PushPayload) {
    await Promise.allSettled([
      this.pushService.sendToAll(payload),
      this.sendToTeams(payload),
      this.sendToTelegram(payload),
    ]);
  }

  async sendToManagers(payload: PushPayload) {
    await Promise.allSettled([
      this.pushService.sendToManagers(payload),
      this.sendToTeams(payload),
      this.sendToTelegram(payload),
    ]);
  }

  // Personal push only — Teams/Telegram are broadcast channels
  async sendToUser(userId: string, payload: PushPayload) {
    return this.pushService.sendToUser(userId, payload);
  }

  // ── Microsoft Teams ─────────────────────────────────────────────────────────

  async sendToTeams(payload: PushPayload) {
    if (await this.param('TEAMS_ENABLED') !== 'true') return;
    const url = await this.param('TEAMS_WEBHOOK_URL');
    if (!url) return;
    try {
      await axios.post(url, { text: `**${payload.title}**\n${payload.body}` }, { timeout: 6000 });
    } catch (err: any) {
      this.logger.warn(`Teams send failed: ${err.message}`);
    }
  }

  // ── Telegram ────────────────────────────────────────────────────────────────

  async sendToTelegram(payload: PushPayload) {
    if (await this.param('TELEGRAM_ENABLED') !== 'true') return;
    const token  = await this.param('TELEGRAM_BOT_TOKEN');
    const chatId = await this.param('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return;
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: `*${payload.title}*\n${payload.body}`, parse_mode: 'Markdown' },
        { timeout: 6000 },
      );
    } catch (err: any) {
      this.logger.warn(`Telegram send failed: ${err.message}`);
    }
  }

  // ── Test ────────────────────────────────────────────────────────────────────

  async testTeams(): Promise<{ ok: boolean; message: string }> {
    const url = await this.param('TEAMS_WEBHOOK_URL');
    if (!url) return { ok: false, message: 'Webhook URL לא מוגדר' };
    try {
      await axios.post(url, { text: '**✅ בדיקת חיבור — DeployCenter**\nהחיבור ל-Microsoft Teams תקין.' }, { timeout: 6000 });
      return { ok: true, message: 'הודעה נשלחה בהצלחה ל-Teams' };
    } catch (err: any) {
      return { ok: false, message: `שגיאה: ${err.message}` };
    }
  }

  async testTelegram(): Promise<{ ok: boolean; message: string }> {
    const token  = await this.param('TELEGRAM_BOT_TOKEN');
    const chatId = await this.param('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return { ok: false, message: 'Bot Token או Chat ID לא מוגדרים' };
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: '*✅ בדיקת חיבור — DeployCenter*\nהחיבור לטלגרם תקין.', parse_mode: 'Markdown' },
        { timeout: 6000 },
      );
      return { ok: true, message: 'הודעה נשלחה בהצלחה לטלגרם' };
    } catch (err: any) {
      return { ok: false, message: `שגיאה: ${err.message}` };
    }
  }
}
