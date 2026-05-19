import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'text-mining', cors: true })
export class TextMiningGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join_session')
  handleJoinSession(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string }) {
    const room = `session:${data.sessionId}`;
    client.join(room);
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
