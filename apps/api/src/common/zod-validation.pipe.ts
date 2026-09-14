import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      // GlobalExceptionFilter (common/http-exception.filter.ts) reads
      // only `message` off a thrown HttpException's response body — it
      // has no idea about `errors`, so a per-field reason has to travel
      // as the message itself or it never reaches the client at all.
      const messages = Object.entries(fieldErrors).map(
        ([field, errs]) => `${field}: ${(errs ?? []).join(', ')}`,
      );
      throw new BadRequestException({
        message: messages.length > 0 ? messages : 'Validation failed',
        errors: fieldErrors,
      });
    }
    return result.data;
  }
}
