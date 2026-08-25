import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { sanitizeForLog } from './log-sanitizer';

interface RequestWithUser extends Request {
  user?: { id: string; role: string };
}

export interface StandardErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();

    const errorResponse = this.buildResponse(exception, request.url);

    // Every 4xx/5xx flows through this single choke point, so this is
    // also where auth/authz failures (401 from JwtAuthGuard, 403 from
    // RolesGuard or an ownership check) get their audit trail — who (when
    // known), from where, hit what route, and why it was denied.
    const safeUrl = sanitizeForLog(request.url);
    const userTag = request.user
      ? ` user=${sanitizeForLog(request.user.id)}(${sanitizeForLog(request.user.role)})`
      : '';
    const ipTag = request.ip ? ` ip=${sanitizeForLog(request.ip)}` : '';

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${safeUrl} ${errorResponse.statusCode}${userTag}${ipTag}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${safeUrl} ${errorResponse.statusCode}${userTag}${ipTag} — ${JSON.stringify(errorResponse.message)}`,
      );
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildResponse(exception: unknown, path: string): StandardErrorResponse {
    const timestamp = new Date().toISOString();

    // 1. NestJS HttpException (BadRequest, NotFound, Forbidden, Conflict, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exResponse = exception.getResponse();
      let message: string | string[];
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as Record<string, unknown>;
        message = (resp.message ?? exception.message) as string | string[];
      } else {
        message = exception.message;
      }
      return {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        timestamp,
        path,
      };
    }

    // 2. Zod validation errors
    if (exception instanceof ZodError) {
      const fieldErrors = exception.flatten().fieldErrors;
      const messages = Object.entries(fieldErrors).map(
        ([field, errs]) => `${field}: ${(errs ?? []).join(', ')}`,
      );
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: messages.length > 0 ? messages : ['Validation failed'],
        timestamp,
        path,
      };
    }

    // 3. Prisma known request errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta?.target as string[]) ?? [];
        return {
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: `Unique constraint violation on: ${target.join(', ') || 'unknown field'}`,
          timestamp,
          path,
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'Record not found',
          timestamp,
          path,
        };
      }
    }

    // 4. Unknown / unhandled errors
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp,
      path,
    };
  }
}
