import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { GradeCompletedPayload } from '@ats/shared';
import { WsAuthService, wsUser, wsIsStaff } from '../auth';

// Two-door Phase 4: handshake authenticated via WsAuthService (default
// namespace, so the middleware goes on the Server itself); a student may
// only join their own `student:<id>` room. lib/socket.ts now sends the
// JWT in the handshake `auth` payload.
@WebSocketGateway({ cors: true })
export class GradingGateway implements OnGatewayInit {
  private readonly logger = new Logger(GradingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly wsAuth: WsAuthService) {}

  afterInit(server: Server) {
    server.use(this.wsAuth.middleware({ namespace: '/', publicDoor: 'student' }));
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { studentId: string },
  ): Promise<{ joined?: string; error?: string }> {
    const user = wsUser(client);
    if (!user || typeof data?.studentId !== 'string') return { error: 'Unauthorized' };
    if (data.studentId !== user.id && !wsIsStaff(client)) {
      this.logger.warn(
        `Client ${client.id} (user ${user.id}) refused room student:${data.studentId}`,
      );
      return { error: 'Not found' };
    }

    const room = `student:${data.studentId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { joined: room };
  }

  notifyGradeCompleted(studentId: string, result: GradeCompletedPayload): void {
    const room = `student:${studentId}`;
    this.server.to(room).emit('grade_completed', result);
    this.logger.log(`Emitted grade_completed to ${room}`);
  }
}
