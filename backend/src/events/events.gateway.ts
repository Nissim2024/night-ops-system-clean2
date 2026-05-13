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

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // מעקב אחרי משתמשים מחוברים
  private connectedUsers = new Map<string, { userId: string; fullName: string; teamId?: string }>();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const user = this.connectedUsers.get(client.id);
    if (user) {
      this.connectedUsers.delete(client.id);
      this.server.emit('USER_OFFLINE', { userId: user.userId, fullName: user.fullName });
    }
  }

  // משתמש מתחבר ומזהה את עצמו
  @SubscribeMessage('JOIN')
  handleJoin(@MessageBody() data: { userId: string; fullName: string; teamId?: string }, @ConnectedSocket() client: Socket) {
    this.connectedUsers.set(client.id, data);
    client.join(`team_${data.teamId}`);
    this.server.emit('USER_ONLINE', { userId: data.userId, fullName: data.fullName, teamId: data.teamId });
    return { event: 'JOINED', data: { connectedUsers: Array.from(this.connectedUsers.values()) } };
  }

  // שליחת עדכון משימה לכולם
  emitTaskUpdated(task: any) {
    this.server.emit('TASK_UPDATED', task);
  }

  // שליחת התראה על חסימה
  emitTaskBlocked(task: any) {
    this.server.emit('TASK_BLOCKED', {
      ...task,
      urgent: true,
      message: `משימה חסומה: ${task.title}`,
    });
  }

  // שליחת GO/NO GO
  emitGoDecision(decision: { go: boolean; versionId: string; message: string; decidedBy: string }) {
    this.server.emit('GO_DECISION', decision);
  }

  // שליחת עדכון גרסה
  emitVersionUpdated(version: any) {
    this.server.emit('VERSION_UPDATED', version);
  }

  // קבלת רשימת משתמשים מחוברים
  @SubscribeMessage('GET_ONLINE_USERS')
  handleGetOnlineUsers() {
    return { event: 'ONLINE_USERS', data: Array.from(this.connectedUsers.values()) };
  }
}