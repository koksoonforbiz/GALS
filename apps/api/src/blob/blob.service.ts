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
  private readonly bucket: string;
  private readonly publicEndpoint: string | undefined;
  private readonly internalEndpoint: string;

  constructor(private readonly config: ConfigService) {
    this.internalEndpoint = this.config.getOrThrow<string>('BLOB_STORAGE_ENDPOINT');
    this.bucket = this.config.getOrThrow<string>('BLOB_STORAGE_BUCKET');
    this.publicEndpoint = this.config.get<string>('BLOB_STORAGE_PUBLIC_ENDPOINT');
    this.client = new S3Client({
      endpoint: this.internalEndpoint,
      region: this.config.get<string>('BLOB_STORAGE_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('BLOB_STORAGE_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('BLOB_STORAGE_SECRET_KEY'),
      },
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
    let url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn ?? 3600,
    });
    if (this.publicEndpoint) {
      url = url.replace(this.internalEndpoint, this.publicEndpoint);
    }
    return url;
  }

  async getPresignedDownloadUrl(options: PresignedUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
    });
    let url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn ?? 3600,
    });
    if (this.publicEndpoint) {
      url = url.replace(this.internalEndpoint, this.publicEndpoint);
    }
    return url;
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
