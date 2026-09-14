import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe';

// Regression test for a real bug: GlobalExceptionFilter
// (http-exception.filter.ts) only reads `message` off a thrown
// HttpException's response body — it has no special handling for an
// `errors` field. A per-field reason that only lives in `errors` (and
// not in `message`) is silently dropped before it ever reaches the
// client, leaving the user with just the generic "Validation failed".
describe('ZodValidationPipe', () => {
  const schema = z.object({
    newPassword: z.string().min(12, 'Password must be at least 12 characters'),
  });
  const pipe = new ZodValidationPipe(schema);

  it('passes valid input through unchanged', () => {
    expect(pipe.transform({ newPassword: 'ValidPassw0rd!' })).toEqual({
      newPassword: 'ValidPassw0rd!',
    });
  });

  it('throws BadRequestException whose message carries the actual field-level reason, not a generic placeholder', () => {
    expect(() => pipe.transform({ newPassword: 'short' })).toThrow(BadRequestException);

    try {
      pipe.transform({ newPassword: 'short' });
      fail('expected transform to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        message: string | string[];
        errors: Record<string, string[]>;
      };
      expect(response.message).not.toBe('Validation failed');
      expect(response.message).toEqual(
        expect.arrayContaining([expect.stringContaining('at least 12 characters')]),
      );
      expect(response.errors.newPassword).toEqual(
        expect.arrayContaining([expect.stringContaining('at least 12 characters')]),
      );
    }
  });

  it('falls back to a generic message only when there are no field errors to report', () => {
    // A schema-level refinement error has no field key, so fieldErrors
    // ends up empty — this is the one case the generic string is
    // actually appropriate for.
    const refined = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a === v.b, { message: 'a and b must match' });
    const refinedPipe = new ZodValidationPipe(refined);

    try {
      refinedPipe.transform({ a: 'x', b: 'y' });
      fail('expected transform to throw');
    } catch (err) {
      const response = (err as BadRequestException).getResponse() as { message: string | string[] };
      expect(response.message).toBe('Validation failed');
    }
  });
});
