import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { GradeCompletedPayload } from '@ats/shared';

@WebSocketGateway({ cors: true })
export class GradingGateway {
  private readonly logger = new Logger(GradingGateway.name);

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { studentId: string }): void {
    const room = `student:${data.studentId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
  }

  notifyGradeCompleted(studentId: string, result: GradeCompletedPayload): void {
    const room = `student:${studentId}`;
    this.server.to(room).emit('grade_completed', result);
    this.logger.log(`Emitted grade_completed to ${room}`);
  }
}
