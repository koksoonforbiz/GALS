import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'dialogue', cors: true })
export class DialogueGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DialogueGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_session')
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    const room = `session:${data.sessionId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
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
  handleJoinStudent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { studentId: string },
  ): void {
    const room = `student:${data.studentId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined student room ${room}`);
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
