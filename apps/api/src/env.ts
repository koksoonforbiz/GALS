import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  BLOB_STORAGE_ENDPOINT: z.string().url('BLOB_STORAGE_ENDPOINT must be a valid URL'),
  BLOB_STORAGE_BUCKET: z.string().min(1, 'BLOB_STORAGE_BUCKET is required'),
  BLOB_STORAGE_ACCESS_KEY: z.string().min(1, 'BLOB_STORAGE_ACCESS_KEY is required'),
  BLOB_STORAGE_SECRET_KEY: z.string().min(1, 'BLOB_STORAGE_SECRET_KEY is required'),
  BLOB_STORAGE_REGION: z.string().default('us-east-1'),
  BLOB_STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    const messages = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, val]) => {
        const errors = (val as { _errors: string[] })._errors;
        return `  ${key}: ${errors.join(', ')}`;
      })
      .join('\n');
    console.error(`\n❌ Environment validation failed:\n${messages}\n`);
    process.exit(1);
  }
  return result.data;
}
