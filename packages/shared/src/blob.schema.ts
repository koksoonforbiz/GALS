import { z } from 'zod';

export const PresignedUrlResponseSchema = z.object({
  url: z.string().url(),
});
export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;
