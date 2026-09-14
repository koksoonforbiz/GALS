import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { UserRole } from '@ats/shared';
import { PrismaService } from '../prisma';
import { SecurityEventService } from './security-event.service';
import { mustChangePassword } from './password-lifecycle.util';
import { requestDoor } from '../common/door/door.decorator';

export interface WsUser {
  id: string;
  role: UserRole;
}

export interface WsAuthOptions {
  /** Gateway namespace, for log/audit lines only. */
  namespace: string;
  /**
   * Who may connect through the PUBLIC door:
   *   'student' — students only (dialogue, grading)
   *   'never'   — refused outright (text-mining is teacher-facing)
   * The private door and door-less connections (dev on :3000) are not
   * restricted here beyond the JWT itself.
   */
  publicDoor: 'student' | 'never';
}

type WsNext = (err?: Error) => void;

/**
 * Socket.IO handshake authentication (two-door Phase 4).
 *
 * Before this the three gateways accepted any connection and put a
 * client into whatever room it named — see the "no authentication at
 * all" finding in docs/two-door/api-classification.md. This service is
 * installed as a namespace middleware from each gateway's afterInit, so
 * an unauthenticated socket never reaches `connection`, let alone a
 * @SubscribeMessage handler. It verifies the same JWT the HTTP layer
 * uses (no new token format) and re-checks the account the same way
 * JwtStrategy does (exists, active, no outstanding forced password
 * change). The authenticated user is stored on `socket.data.user`;
 * handlers read it via `wsUser()` for ownership checks.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  middleware(opts: WsAuthOptions): (socket: Socket, next: WsNext) => void {
    return (socket, next) => {
      void this.authorize(socket, opts).then(
        (user) => {
          socket.data.user = user;
          next();
        },
        (err: Error) => {
          this.logger.warn(`[${opts.namespace}] handshake refused: ${err.message}`);
          next(err);
        },
      );
    };
  }

  private async authorize(socket: Socket, opts: WsAuthOptions): Promise<WsUser> {
    const user = await this.authenticate(socket);

    if (requestDoor(socket.handshake.headers as Record<string, unknown>) === 'public') {
      const allowed = opts.publicDoor === 'student' && user.role === 'student';
      if (!allowed) {
        this.securityEvents.record({
          type: 'PERMISSION_DENIED',
          userId: user.id,
          ipAddress: socket.handshake.address,
          metadata: {
            reason: 'PRIVATE_NAMESPACE_VIA_PUBLIC_DOOR',
            namespace: opts.namespace,
            actualRole: user.role,
          },
        });
        // Same wording nginx/DoorGuard use for HTTP: nothing here.
        throw new Error('Not found');
      }
    }

    return user;
  }

  private async authenticate(socket: Socket): Promise<WsUser> {
    const token = extractToken(socket);
    if (!token) throw new Error('Unauthorized: missing token');

    let payload: { sub?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
    } catch {
      throw new Error('Unauthorized: invalid token');
    }
    if (!payload.sub) throw new Error('Unauthorized: invalid token');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        isActive: true,
        isTemporaryPassword: true,
        passwordChangedAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new Error('Unauthorized: user not found');
    if (!user.isActive) {
      this.securityEvents.record({ type: 'DEACTIVATED_TOKEN_REUSE', userId: user.id });
      throw new Error('Unauthorized: account deactivated');
    }
    if (mustChangePassword(user)) throw new Error('Unauthorized: password change required');

    return { id: user.id, role: user.role };
  }
}

/** The user authenticated at handshake, or undefined if the middleware is not installed. */
export function wsUser(socket: Socket): WsUser | undefined {
  return (socket.data as { user?: WsUser }).user;
}

/** Teachers/admins may observe any room; students only their own. */
export function wsIsStaff(socket: Socket): boolean {
  const role = wsUser(socket)?.role;
  return role === 'teacher' || role === 'admin';
}

function extractToken(socket: Socket): string | undefined {
  // socket.io-client `auth: { token }` (what DialogueLearning.tsx and
  // lib/socket.ts send) — falls back to a Bearer header for non-browser
  // clients.
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}
