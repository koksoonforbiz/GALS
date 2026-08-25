import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { sanitizeForLog } from '../common';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const port = config.getOrThrow<number>('SMTP_PORT');
    this.from = config.getOrThrow<string>('SMTP_FROM');
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port,
      // Implicit TLS on 465, STARTTLS otherwise — matches how every
      // mainstream SMTP provider (Gmail, Outlook, etc.) splits these.
      secure: port === 465,
      auth: {
        user: config.getOrThrow<string>('SMTP_USER'),
        pass: config.getOrThrow<string>('SMTP_PASS'),
      },
    });
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
    });
    this.logger.log(`OTP email sent: to=${sanitizeForLog(to)}`);
  }
}
