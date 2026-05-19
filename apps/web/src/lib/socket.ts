import { io, Socket } from 'socket.io-client';
import type { GradeCompletedPayload } from '@ats/shared';

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (!socket) {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    socket = io(apiUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function getSocket(): Socket {
  return connectSocket();
}

export function joinStudentRoom(studentId: string): void {
  getSocket().emit('join', { studentId });
}

export function onGradeCompleted(callback: (data: GradeCompletedPayload) => void): () => void {
  const s = getSocket();
  s.on('grade_completed', callback);
  return () => s.off('grade_completed', callback);
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
