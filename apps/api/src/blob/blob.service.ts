import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export interface PutBlobOptions {
  key: string;
  body: Buffer | string;
  contentType: string;
}

export interface PresignedUrlOptions {
  key: string;
  contentType?: string;
  expiresIn?: number;
}

@Injectable()
export class BlobService implements OnModuleInit {
  private readonly logger = new Logger(BlobService.name);
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string | undefined;
  private readonly internalEndpoint: string;

  constructor(private readonly config: ConfigService) {
    this.internalEndpoint = this.config.getOrThrow<string>('BLOB_STORAGE_ENDPOINT');
    this.bucket = this.config.getOrThrow<string>('BLOB_STORAGE_BUCKET');
    this.publicEndpoint = this.config.get<string>('BLOB_STORAGE_PUBLIC_ENDPOINT');

    const region = this.config.get<string>('BLOB_STORAGE_REGION', 'us-east-1');
    const credentials = {
      accessKeyId: this.config.getOrThrow<string>('BLOB_STORAGE_ACCESS_KEY'),
      secretAccessKey: this.config.getOrThrow<string>('BLOB_STORAGE_SECRET_KEY'),
    };

    // Internal client for direct S3 operations (put, get, delete)
    this.client = new S3Client({
      endpoint: this.internalEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });

    // Presigning client uses the public endpoint so browser-signed URLs
    // have a Host header that matches what the browser actually sends.
    this.presignClient = new S3Client({
      endpoint: this.publicEndpoint || this.internalEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" is accessible`);
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
        this.logger.warn(`Bucket "${this.bucket}" not found, creating...`);
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" created`);
      } else {
        this.logger.error(`Failed to verify bucket "${this.bucket}"`, err);
        throw err;
      }
    }
  }

  async put(options: PutBlobOptions): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
        Body: options.body,
        ContentType: options.contentType,
      }),
    );
    return options.key;
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getPresignedUploadUrl(options: PresignedUrlOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      ContentType: options.contentType,
    });
    const url = await getSignedUrl(this.presignClient, command, {
      expiresIn: options.expiresIn ?? 3600,
    });
    // Return a relative path so the browser routes through the dev proxy,
    // avoiding CORS issues with direct cross-origin MinIO requests.
    return this.toRelativePath(url);
  }

  async getPresignedDownloadUrl(options: PresignedUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
    });
    const url = await getSignedUrl(this.presignClient, command, {
      expiresIn: options.expiresIn ?? 3600,
    });
    return this.toRelativePath(url);
  }

  /**
   * Convert an absolute presigned URL to a relative path.
   * The frontend dev server proxies /s3/ to MinIO, avoiding CORS.
   */
  private toRelativePath(absoluteUrl: string): string {
    try {
      const parsed = new URL(absoluteUrl);
      return `/s3${parsed.pathname}${parsed.search}`;
    } catch {
      return absoluteUrl;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
