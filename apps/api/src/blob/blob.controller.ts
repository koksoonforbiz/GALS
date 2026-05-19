import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BlobService } from './blob.service';

const ALLOWED_TYPES: Record<string, string> = {
  'strokes.json': 'application/json',
  'snapshot.png': 'image/png',
};

@Controller('blobs')
export class BlobController {
  constructor(private readonly blob: BlobService) {}

  @Get('presign/upload')
  async getUploadUrl(@Query('key') key: string) {
    this.validateKey(key);
    const contentType = this.resolveContentType(key);
    const url = await this.blob.getPresignedUploadUrl({ key, contentType });
    return { url, key, contentType };
  }

  @Get('presign/download')
  async getDownloadUrl(@Query('key') key: string) {
    this.validateKey(key);
    const url = await this.blob.getPresignedDownloadUrl({ key });
    return { url, key };
  }

  @Put(':attemptId/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async proxyUpload(
    @Param('attemptId') attemptId: string,
    @Param('type') type: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    const contentType = this.resolveContentType(key);

    const body = req.rawBody ?? Buffer.alloc(0);

    await this.blob.put({ key, body, contentType });
  }

  @Get(':attemptId/:type')
  async proxyDownload(
    @Param('attemptId') attemptId: string,
    @Param('type') type: string,
    @Res() res: Response,
  ) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    const { body, contentType } = await this.blob.get(key);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }

  @Delete(':attemptId/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBlob(@Param('attemptId') attemptId: string, @Param('type') type: string) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    await this.blob.delete(key);
  }

  private validateKey(key: string): void {
    if (!key) {
      throw new BadRequestException('Blob key is required');
    }
    const parts = key.split('/');
    if (parts.length !== 2) {
      throw new BadRequestException(
        `Invalid blob key "${key}". Expected format: {attemptId}/{type}`,
      );
    }
    const [, type] = parts;
    if (!type || !ALLOWED_TYPES[type]) {
      throw new BadRequestException(
        `Invalid blob type "${type}". Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      );
    }
  }

  private resolveContentType(key: string): string {
    const type = key.split('/').pop();
    return ALLOWED_TYPES[type!]!;
  }
}
