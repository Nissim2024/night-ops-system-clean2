import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const wsOrigins = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3011',
  'http://localhost:3013',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : []),
];

@WebSocketGateway({
  cors: {
    origin: wsOrigins,
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, { userId: string; fullName: string; teamId?: string }>();

  constructor(
    private notificationsService: NotificationsService,
    private jwtService: JwtService,
  ) {}

  handleConnection(client: Socket) {
    const token: string | undefined = client.handshake.auth?.token;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
      client.data.user = payload;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    if (user) {
      this.connectedUsers.delete(client.id);
      this.server.emit('USER_OFFLINE', { userId: user.userId, fullName: user.fullName });
    }
  }

  @SubscribeMessage('JOIN')
  async handleJoin(@MessageBody() data: { teamId?: string }, @ConnectedSocket() client: Socket) {
    const jwtUser = client.data?.user;
    if (!jwtUser) {
      client.disconnect(true);
      return;
    }
    const dbUser = await prisma.user.findUnique({
      where: { id: jwtUser.sub },
      select: { fullName: true, active: true },
    });
    if (!dbUser?.active) {
      client.disconnect(true);
      return;
    }
    const entry = { userId: jwtUser.sub as string, fullName: dbUser.fullName, teamId: data?.teamId };
    this.connectedUsers.set(client.id, entry);
    client.join(`team_${data?.teamId}`);
    this.server.emit('USER_ONLINE', entry);
    return { event: 'JOINED', data: { connectedUsers: Array.from(this.connectedUsers.values()) } };
  }

  emitTaskUpdated(task: any) {
    this.server.emit('TASK_UPDATED', task);
  }

  // מנהל פתח משימה (OPEN) → Push למשתמש המשויך
  async emitTaskOpen(task: any) {
    let assignedUserId = task.assignedUserId;
    // fallback: look up by name if no ID linked
    if (!assignedUserId && task.assignedUserName) {
      const found = await prisma.user.findFirst({
        where: { fullName: { equals: task.assignedUserName, mode: 'insensitive' } },
        select: { id: true },
      });
      assignedUserId = found?.id ?? null;
    }
    if (!assignedUserId) return;
    const userName = task.assignedUser?.fullName || task.assignedUserName || 'המשתמש';
    const result = await this.notificationsService.sendToUser(assignedUserId, {
      title: '🟠 משימה ממתינה לביצוע',
      body: `${userName}, נא התחל לבצע: ${task.title}`,
      tag: `open-${task.id}`,
      data: { taskId: task.id, type: 'TASK_OPEN' },
    });
    // אם המשתמש לא מנוי — שלח התראה למנהלים
    if (result === 'not-subscribed') {
      await this.notificationsService.sendToManagers({
        title: '📵 משתמש לא מנוי להתראות',
        body: `${userName} לא קיבל התראה על: "${task.title}" — שקול להתקשר`,
        tag: `unreachable-${assignedUserId}-${task.id}`,
        data: { taskId: task.id, type: 'USER_NOT_SUBSCRIBED', userId: assignedUserId, userName },
      });
    }
  }

  // עובד לחץ "התחל" (IN_PROGRESS) → Push למנהלים
  async emitTaskStarted(task: any) {
    const userName = task.assignedUser?.fullName || task.assignedUserName || 'עובד';
    await this.notificationsService.sendToManagers({
      title: '▶️ משימה החלה',
      body: `${userName} התחיל: ${task.title}`,
      tag: `started-${task.id}`,
      data: { taskId: task.id, type: 'TASK_STARTED' },
    });
  }

  // עובד לחץ "סיים" (DONE) → Push למנהלים
  async emitTaskCompleted(task: any) {
    const userName = task.assignedUser?.fullName || task.assignedUserName || 'עובד';
    await this.notificationsService.sendToManagers({
      title: '✅ משימה הושלמה',
      body: `${userName} סיים: ${task.title}`,
      tag: `done-${task.id}`,
      data: { taskId: task.id, type: 'TASK_DONE' },
    });
  }

  // משימה חסומה → Push לכולם (urgent)
  emitTaskBlocked(task: any) {
    this.server.emit('TASK_BLOCKED', {
      ...task,
      urgent: true,
      message: `משימה חסומה: ${task.title}`,
    });
    this.notificationsService.sendToAll({
      title: '🚨 משימה חסומה',
      body: `${task.title}${task.blockedReason ? ` — ${task.blockedReason}` : ''}`,
      tag: `blocked-${task.id}`,
      urgent: true,
      data: { taskId: task.id, type: 'TASK_BLOCKED' },
    });
  }

  // שחרור חסימה → Push לכולם
  async emitTaskUnblocked(task: any) {
    await this.notificationsService.sendToAll({
      title: '🔓 חסימה שוחררה',
      body: `המשימה "${task.title}" שוחררה — ניתן להמשיך`,
      tag: `unblocked-${task.id}`,
      data: { taskId: task.id, type: 'TASK_UNBLOCKED' },
    });
  }

  emitGoDecision(decision: { go: boolean; versionId: string; message: string; decidedBy: string }) {
    this.server.emit('GO_DECISION', decision);
    this.notificationsService.sendToAll({
      title: decision.go ? '✅ GO — הגרסה עברה!' : '🛑 NO GO — עצור!',
      body: decision.message || (decision.go ? 'המשך לשלב הבא' : 'לא ניתן להמשיך'),
      tag: `go-${decision.versionId}`,
      urgent: !decision.go,
      data: { versionId: decision.versionId, type: 'GO_DECISION', go: decision.go },
    });
  }

  emitVersionUpdated(version: any) {
    this.server.emit('VERSION_UPDATED', version);
    const STATUS_PUSH: Record<string, { title: string; body: string }> = {
      ACTIVE:        { title: '🌙 ליל ההטמעה מתחיל!', body: `גרסה ${version.name} עברה למצב ACTIVE` },
      MORNING_AFTER: { title: '☀️ בוקר שלמחרת',       body: `גרסה ${version.name} — שלב הבוקר החל` },
      COMPLETED:     { title: '✅ גרסה הושלמה',         body: `גרסה ${version.name} הושלמה בהצלחה` },
      ROLLED_BACK:   { title: '⏪ Rollback בוצע',       body: `גרסה ${version.name} בוצע Rollback` },
    };
    const pushData = STATUS_PUSH[version.status];
    if (pushData) {
      this.notificationsService.sendToAll({
        ...pushData,
        tag: `version-${version.id}-${version.status}`,
        data: { versionId: version.id, status: version.status, type: 'VERSION_UPDATED' },
      });
    }
  }

  emitProposalCreated(versionId: string) {
    this.server.emit('PROPOSAL_CREATED', { versionId });
  }

  emitTeamSubmitted(data: { versionId: string; teamName: string; submittedCount: number; totalTeams: number }) {
    this.server.emit('TEAM_SUBMITTED', data);
  }

  emitAllTeamsSubmitted(data: { versionId: string; totalTeams: number }) {
    this.server.emit('ALL_TEAMS_SUBMITTED', data);
  }

  @SubscribeMessage('GET_ONLINE_USERS')
  handleGetOnlineUsers() {
    return { event: 'ONLINE_USERS', data: Array.from(this.connectedUsers.values()) };
  }
}
