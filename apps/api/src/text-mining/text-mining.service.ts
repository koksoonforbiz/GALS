import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TextMiningService {
  private readonly logger = new Logger(TextMiningService.name);

  // TODO stage 2: implement ingest() — fire-and-forget detection trigger
  async ingest(args: {
    messageId: string;
    sessionId: string;
    studentId: string;
    courseId: string | null;
    teacherId: string;
    utterance: string;
  }): Promise<void> {
    this.logger.debug(`Text-mining ingest stub called for message ${args.messageId}`);
  }
}
