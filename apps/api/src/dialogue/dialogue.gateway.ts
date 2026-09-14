import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../prisma';
import { WsAuthService, wsUser, wsIsStaff } from '../auth';

// Two-door Phase 4: the handshake is authenticated (WsAuthService
// middleware installed in afterInit — an unauthenticated socket never
// connects) and every join checks ownership, so a student can only
// receive their own streamed replies. Students only through the public
// door; staff may observe any session from the private door.
@WebSocketGateway({ namespace: 'dialogue', cors: true })
export class DialogueGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DialogueGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Namespace) {
    server.use(this.wsAuth.middleware({ namespace: 'dialogue', publicDoor: 'student' }));
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id} user=${wsUser(client)?.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): Promise<{ joined?: string; error?: string }> {
    const user = wsUser(client);
    if (!user || typeof data?.sessionId !== 'string') return { error: 'Unauthorized' };

    if (!wsIsStaff(client)) {
      const owned = await this.prisma.dialogueSession.findFirst({
        where: { id: data.sessionId, studentId: user.id },
        select: { id: true },
      });
      if (!owned) {
        this.logger.warn(`Client ${client.id} (user ${user.id}) refused session ${data.sessionId}`);
        return { error: 'Not found' };
      }
    }

    const room = `session:${data.sessionId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { joined: room };
  }

  @SubscribeMessage('leave_session')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    const room = `session:${data.sessionId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
  }

  @SubscribeMessage('join_student')
  async handleJoinStudent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { studentId: string },
  ): Promise<{ joined?: string; error?: string }> {
    const user = wsUser(client);
    if (!user || typeof data?.studentId !== 'string') return { error: 'Unauthorized' };
    if (data.studentId !== user.id && !wsIsStaff(client)) {
      this.logger.warn(
        `Client ${client.id} (user ${user.id}) refused student room ${data.studentId}`,
      );
      return { error: 'Not found' };
    }

    const room = `student:${data.studentId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined student room ${room}`);
    return { joined: room };
  }

  // ─── Emit helpers ─────────────────────────────────────────

  emitMessageChunk(sessionId: string, chunk: { content: string; index: number }) {
    this.server.to(`session:${sessionId}`).emit('message_chunk', chunk);
  }

  emitMessageComplete(
    sessionId: string,
    message: { id: string; content: string; citations?: unknown },
  ) {
    this.server.to(`session:${sessionId}`).emit('message_complete', message);
  }

  emitProcessingUpdate(
    studentId: string,
    payload: { documentId: string; status: string; progress?: number },
  ) {
    this.server.to(`student:${studentId}`).emit('processing_update', payload);
  }
}
