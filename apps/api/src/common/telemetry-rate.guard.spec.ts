import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { TelemetryRateGuard, TELEMETRY_LIMIT_PER_MIN } from './telemetry-rate.guard';

/** Telemetry is limited per signed-in learner, not per IP (a lab shares one IP). */
describe('TelemetryRateGuard', () => {
  const env = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = 'development';
  });
  afterAll(() => {
    process.env.NODE_ENV = env;
  });

  function ctx(user?: { id: string }) {
    const headers: Record<string, string> = {};
    const c = {
      switchToHttp: () => ({
        getRequest: () => ({ user, ip: '10.0.0.1' }),
        getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
      }),
    } as unknown as ExecutionContext;
    return { c, headers };
  }

  it('keys on the user, allows under the limit', async () => {
    const storage = { increment: jest.fn().mockResolvedValue({ isBlocked: false }) };
    const guard = new TelemetryRateGuard(storage as never);
    await expect(guard.canActivate(ctx({ id: 'u1' }).c)).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledWith(
      'telemetry:user:u1',
      60_000,
      TELEMETRY_LIMIT_PER_MIN,
      1_000,
      'telemetry',
    );
  });

  it('answers 429 with Retry-After over the limit', async () => {
    const storage = {
      increment: jest.fn().mockResolvedValue({ isBlocked: true, timeToExpire: 12 }),
    };
    const guard = new TelemetryRateGuard(storage as never);
    const { c, headers } = ctx({ id: 'u1' });
    await expect(guard.canActivate(c)).rejects.toBeInstanceOf(HttpException);
    expect(headers['Retry-After']).toBe('12');
  });
});
