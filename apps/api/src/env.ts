import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development')
    .describe('Application environment (development | production | test)'),
  PORT: z.coerce
    .number()
    .int('PORT must be an integer')
    .min(1, 'PORT must be between 1 and 65535')
    .max(65535, 'PORT must be between 1 and 65535')
    .default(3000)
    .describe('Port the API server listens on'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — provide a PostgreSQL connection string')
    .startsWith(
      'postgresql://',
      'DATABASE_URL must start with postgresql:// (e.g. postgresql://user:pass@localhost:5432/db)',
    )
    .describe('PostgreSQL connection string'),
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required — provide a Redis connection string')
    .startsWith('redis://', 'REDIS_URL must start with redis:// (e.g. redis://localhost:6379)')
    .describe('Redis connection string'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters — use a strong random string in production')
    .describe('Secret key for signing JWT tokens'),
  BLOB_STORAGE_ENDPOINT: z
    .string()
    .url('BLOB_STORAGE_ENDPOINT must be a valid URL (e.g. http://localhost:9000 for MinIO)')
    .describe('S3-compatible blob storage endpoint'),
  BLOB_STORAGE_BUCKET: z
    .string()
    .min(1, 'BLOB_STORAGE_BUCKET is required (e.g. ats-blobs)')
    .describe('Blob storage bucket name'),
  BLOB_STORAGE_ACCESS_KEY: z
    .string()
    .min(1, 'BLOB_STORAGE_ACCESS_KEY is required — check your MinIO or S3 credentials')
    .describe('Blob storage access key'),
  BLOB_STORAGE_SECRET_KEY: z
    .string()
    .min(1, 'BLOB_STORAGE_SECRET_KEY is required — check your MinIO or S3 credentials')
    .describe('Blob storage secret key'),
  BLOB_STORAGE_REGION: z.string().default('us-east-1').describe('Blob storage region'),
  BLOB_STORAGE_PUBLIC_ENDPOINT: z
    .string()
    .url('BLOB_STORAGE_PUBLIC_ENDPOINT must be a valid URL if provided')
    .optional()
    .describe('Public URL for blob storage (optional, for pre-signed URLs)'),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .describe('Comma-separated list of origins allowed to call this API via CORS'),
  SMTP_HOST: z
    .string()
    .min(1, 'SMTP_HOST is required — the hostname of your SMTP provider (e.g. smtp.gmail.com)')
    .describe('SMTP server hostname used to send 2FA emails'),
  SMTP_PORT: z.coerce
    .number()
    .int('SMTP_PORT must be an integer')
    .min(1, 'SMTP_PORT must be between 1 and 65535')
    .max(65535, 'SMTP_PORT must be between 1 and 65535')
    .describe('SMTP server port (587 for STARTTLS, 465 for implicit TLS)'),
  SMTP_USER: z
    .string()
    .min(1, 'SMTP_USER is required — the SMTP account username')
    .describe('SMTP account username'),
  SMTP_PASS: z
    .string()
    .min(1, 'SMTP_PASS is required — the SMTP account password or app password')
    .describe('SMTP account password'),
  SMTP_FROM: z
    .string()
    .min(1, 'SMTP_FROM is required — the From address for outgoing emails')
    .describe('From address used on outgoing 2FA emails'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    const messages = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, val], i) => {
        const errors = (val as { _errors: string[] })._errors;
        return `  ${i + 1}. ${key}: ${errors.join('; ')}`;
      })
      .join('\n');
    console.error(
      `\n❌ Environment validation failed:\n${messages}\n\n` +
        `💡 Hint: Copy .env.example to .env and fill in all required values.\n` +
        `   See README.md for full setup instructions.\n`,
    );
    process.exit(1);
  }
  return result.data;
}
