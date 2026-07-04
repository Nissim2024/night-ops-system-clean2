import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { buildTaskActionCard } from './adaptive-card.util';

const prisma = new PrismaClient();

// Fixed Bot Framework endpoints — same for every Azure Bot regardless of tenant.
const BOT_OPENID_METADATA_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const BOT_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const VALID_ISSUERS = ['https://api.botframework.com'];

const STATUS_BY_ACTION: Record<string, string> = {
  start: 'IN_PROGRESS',
  complete: 'DONE',
  block: 'BLOCKED',
};

@Injectable()
export class TeamsBotService {
  private readonly logger = new Logger(TeamsBotService.name);
  private jwks: JwksClient | null = null;
  private botToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly jwtService: JwtService) {}

  private async param(key: string): Promise<string> {
    const p = await prisma.systemParam.findUnique({ where: { key } });
    return p?.value ?? '';
  }

  async isConfigured(): Promise<boolean> {
    const [enabled, appId, appPassword] = await Promise.all([
      this.param('TEAMS_BOT_ENABLED'),
      this.param('TEAMS_BOT_APP_ID'),
      this.param('TEAMS_BOT_APP_PASSWORD'),
    ]);
    return enabled === 'true' && !!appId && !!appPassword;
  }

  private async getJwks(): Promise<JwksClient> {
    if (this.jwks) return this.jwks;
    const { data } = await axios.get(BOT_OPENID_METADATA_URL, { timeout: 6000 });
    this.jwks = new JwksClient({ jwksUri: data.jwks_uri, cache: true, cacheMaxAge: 24 * 60 * 60 * 1000 });
    return this.jwks;
  }

  // Verifies the incoming request really came from Bot Framework for OUR app,
  // not just anyone POSTing to this public endpoint.
  private async verifyIncomingToken(authHeader?: string): Promise<boolean> {
    const appId = await this.param('TEAMS_BOT_APP_ID');
    if (!appId || !authHeader?.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.decode(token, { complete: true }) as any;
      if (!decoded?.header?.kid) return false;
      const jwks = await this.getJwks();
      const signingKey = await jwks.getSigningKey(decoded.header.kid);
      const verified = jwt.verify(token, signingKey.getPublicKey(), { algorithms: ['RS256'] }) as any;
      return VALID_ISSUERS.includes(verified.iss) && verified.aud === appId;
    } catch (err: any) {
      this.logger.warn(`Bot token verification failed: ${err.message}`);
      return false;
    }
  }

  private async getBotAccessToken(): Promise<string> {
    if (this.botToken && this.botToken.expiresAt > Date.now() + 30_000) return this.botToken.value;
    const [appId, appPassword] = await Promise.all([
      this.param('TEAMS_BOT_APP_ID'),
      this.param('TEAMS_BOT_APP_PASSWORD'),
    ]);
    const res = await axios.post(
      BOT_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appPassword,
        scope: 'https://api.botframework.com/.default',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 6000 },
    );
    this.botToken = { value: res.data.access_token, expiresAt: Date.now() + res.data.expires_in * 1000 };
    return this.botToken.value;
  }

  // Bot Framework doesn't send the clicking user's email directly — we look
  // it up via the Teams roster API using the bot's own credentials, then
  // match it against our User table (no per-user linking step needed).
  private async resolveUserFromActivity(activity: any): Promise<{ id: string; email: string; role: string } | null> {
    try {
      const token = await this.getBotAccessToken();
      const { data: member } = await axios.get(
        `${activity.serviceUrl}v3/conversations/${activity.conversation.id}/members/${activity.from.id}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 6000 },
      );
      const email = member?.email || member?.userPrincipalName;
      if (!email) return null;
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, active: true },
      });
      return user ? { id: user.id, email: user.email, role: user.role } : null;
    } catch (err: any) {
      this.logger.warn(`Failed to resolve Teams user: ${err.message}`);
      return null;
    }
  }

  private async replyToActivity(activity: any, card: any) {
    try {
      const token = await this.getBotAccessToken();
      await axios.post(
        `${activity.serviceUrl}v3/conversations/${activity.conversation.id}/activities/${activity.id}`,
        { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 6000 },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to reply to Teams activity: ${err.message}`);
    }
  }

  // Remembers where the bot was last talked to, so we can proactively push
  // actionable cards later (single-channel model, same assumption as the
  // existing Incoming Webhook integration).
  private async storeConversationReference(activity: any) {
    if (!activity?.serviceUrl || !activity?.conversation?.id) return;
    const ref = {
      serviceUrl: activity.serviceUrl,
      conversationId: activity.conversation.id,
      botId: activity.recipient?.id,
    };
    await prisma.systemParam.upsert({
      where: { key: 'TEAMS_BOT_CONVERSATION_REF' },
      update: { value: JSON.stringify(ref) },
      create: {
        key: 'TEAMS_BOT_CONVERSATION_REF',
        label: 'Teams Bot — Conversation Reference (internal)',
        value: JSON.stringify(ref),
        type: 'string',
      },
    });
  }

  async handleActivity(activity: any, authHeader?: string): Promise<{ status: number; body?: any }> {
    if (!(await this.isConfigured())) return { status: 404 };
    if (!(await this.verifyIncomingToken(authHeader))) return { status: 401 };

    await this.storeConversationReference(activity);

    const actionValue = activity?.value;
    if (!actionValue?.taskId || !actionValue?.action) {
      return { status: 200 }; // conversationUpdate / plain chat message — nothing to act on
    }

    const respond = async (card: any) => {
      if (activity.type === 'invoke') {
        return { status: 200, body: { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card } };
      }
      await this.replyToActivity(activity, card);
      return { status: 200 };
    };

    const user = await this.resolveUserFromActivity(activity);
    if (!user) {
      return respond(buildTaskActionCard(null, 'החשבון שלך ב-Teams לא משויך למשתמש ב-DeployCenter. פנה למנהל המערכת.'));
    }

    const newStatus = STATUS_BY_ACTION[actionValue.action];
    if (!newStatus) return { status: 400 };

    try {
      // Mint a short-lived internal token and go through the real HTTP endpoint
      // so team-membership + phase-gate checks stay defined in one place
      // (tasks.controller.ts / tasks.service.ts) instead of being duplicated here.
      const internalToken = this.jwtService.sign(
        { sub: user.id, role: user.role },
        { secret: process.env.JWT_SECRET, expiresIn: '2m' },
      );
      const apiUrl = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`;
      const { data: updatedTask } = await axios.patch(
        `${apiUrl}/tasks/${actionValue.taskId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${internalToken}` }, timeout: 6000 },
      );
      return respond(buildTaskActionCard(updatedTask));
    } catch (err: any) {
      const message = err.response?.data?.message || err.message;
      this.logger.warn(`Bot task action failed: ${message}`);
      return respond(buildTaskActionCard(null, `הפעולה נכשלה: ${message}`));
    }
  }
}
