import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { WsAuthService, wsIsStaff } from '../auth';

// Two-door Phase 4: teacher-facing namespace. Refused at the handshake
// on the public door (publicDoor: 'never') and, on any door, joins are
// staff-only — the events here are per-student detections.
@WebSocketGateway({ namespace: 'text-mining', cors: true })
export class TextMiningGateway implements OnGatewayInit {
  private readonly logger = new Logger(TextMiningGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(private readonly wsAuth: WsAuthService) {}

  afterInit(server: Namespace) {
    server.use(this.wsAuth.middleware({ namespace: 'text-mining', publicDoor: 'never' }));
  }

  @SubscribeMessage('join_session')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): Promise<{ joined?: string; error?: string }> {
    if (!wsIsStaff(client) || typeof data?.sessionId !== 'string') {
      this.logger.warn(`Client ${client.id} refused text-mining session ${data?.sessionId}`);
      return { error: 'Not found' };
    }
    const room = `session:${data.sessionId}`;
    await client.join(room);
    return { joined: room };
  }

  @SubscribeMessage('leave_session')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const room = `session:${data.sessionId}`;
    client.leave(room);
    return { left: room };
  }

  emitDetectionCreated(sessionId: string, detection: unknown) {
    this.server.to(`session:${sessionId}`).emit('ef.detection.created', detection);
  }

  emitBatchCompleted(sessionId: string, payload: { messageId: string; constructKeys: string[] }) {
    this.server.to(`session:${sessionId}`).emit('ef.detection.batch.completed', payload);
  }
}
