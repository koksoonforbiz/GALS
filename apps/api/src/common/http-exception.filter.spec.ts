import { ArgumentsHost, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

function createMockSecurityEvents() {
  return { record: jest.fn() };
}

function createHost(request: Record<string, unknown>): { host: ArgumentsHost; response: any } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('GlobalExceptionFilter', () => {
  it('records a SYSTEM_ERROR security event for a 5xx (checklist item 25 — system alerts and failures)', () => {
    const securityEvents = createMockSecurityEvents();
    const filter = new GlobalExceptionFilter(securityEvents as any);
    const { host, response } = createHost({
      method: 'GET',
      url: '/api/courses/123',
      ip: '203.0.113.5',
      headers: { 'user-agent': 'jest-test' },
      user: { id: 'user-1', role: 'teacher' },
    });

    filter.catch(new Error('boom'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(securityEvents.record).toHaveBeenCalledWith({
      type: 'SYSTEM_ERROR',
      userId: 'user-1',
      ipAddress: '203.0.113.5',
      userAgent: 'jest-test',
      metadata: {
        method: 'GET',
        path: '/api/courses/123',
        statusCode: 500,
        exceptionName: 'Error',
        message: 'boom',
      },
    });
  });

  it('records a SYSTEM_ERROR event for an explicit InternalServerErrorException too', () => {
    const securityEvents = createMockSecurityEvents();
    const filter = new GlobalExceptionFilter(securityEvents as any);
    const { host } = createHost({ method: 'POST', url: '/api/x', headers: {} });

    filter.catch(new InternalServerErrorException('db down'), host);

    expect(securityEvents.record).toHaveBeenCalledTimes(1);
    expect(securityEvents.record.mock.calls[0]![0].type).toBe('SYSTEM_ERROR');
  });

  it('does NOT record a security event for a 4xx — a client mistake is not a system failure', () => {
    const securityEvents = createMockSecurityEvents();
    const filter = new GlobalExceptionFilter(securityEvents as any);
    const { host, response } = createHost({ method: 'POST', url: '/api/courses', headers: {} });

    filter.catch(new BadRequestException('bad input'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('still returns the standard error response shape for a 5xx', () => {
    const securityEvents = createMockSecurityEvents();
    const filter = new GlobalExceptionFilter(securityEvents as any);
    const { host, response } = createHost({ method: 'GET', url: '/api/y', headers: {} });

    filter.catch(new Error('unexpected'), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        path: '/api/y',
      }),
    );
  });
});
