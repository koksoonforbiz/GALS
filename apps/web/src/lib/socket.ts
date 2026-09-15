import { io, Socket } from 'socket.io-client';
import type { GradeCompletedPayload } from '@ats/shared';

let socket: Socket | null = null;

/**
 * Origin the Socket.IO clients connect to.
 *
 * Two-door split: in production both doors sit behind nginx, which proxies
 * `/socket.io` to the API, so the browser must connect to its own origin
 * (the API hostname is never exposed). `VITE_API_URL` still wins when set,
 * and plain `vite` dev keeps its direct `localhost:3000` default.
 */
export function getSocketOrigin(): string {
  return (
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)
  );
}

export function connectSocket(): Socket {
  if (!socket) {
    socket = io(getSocketOrigin(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      // The grading gateway authenticates the handshake (two-door Phase 4).
      // A function, not a value, so every reconnect picks up the current
      // token rather than the one from first connect.
      auth: (cb) => cb({ token: localStorage.getItem('token') }),
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
