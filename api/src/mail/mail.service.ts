// Outgoing email, over plain nodemailer SMTP.
//
// MailModule is @Global, so injecting MailService works from any module without
// importing anything — `constructor(private readonly mail: MailService) {}`.
//
// Sending never throws by default: a community signup must not 500 because
// Gmail rate-limited us. Callers that genuinely need to know pass
// `{ throwOnError: true }` and get the transport error back.
//
// The automatic emails are community join, account signup, and the feedback
// receipt. Each is a side effect of something the user did (see
// sendCommunityWelcome / sendSignupWelcome / sendFeedbackReceipt); nothing here
// is triggered by an API call.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import {
  communityWelcomeTemplate,
  feedbackReceiptTemplate,
  renderEmail,
  renderText,
  signupWelcomeTemplate,
  type TemplateOptions,
} from './mail.templates';

export interface SendMailOptions {
  /** Recipient address. */
  email: string;
  /** Recipient name, used for the greeting. */
  name: string;
  /** Body copy. Blank lines become separate paragraphs. */
  text: string;
  /** Subject line. Defaults to a greeting. */
  subject?: string;
  /** Headline inside the card. Defaults to `Hey <name> 👋`. */
  heading?: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the divider. */
  footnote?: string;
  /** Ready-made HTML. Skips the branded template entirely. */
  html?: string;
  /** Re-raise transport failures instead of swallowing them. */
  throwOnError?: boolean;
}

export interface SendMailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');

    this.appUrl = this.config.get<string>('APP_URL') ?? 'https://thlabs.io';
    this.from =
      this.config.get<string>('MAIL_FROM') ?? `"TH Labs" <${user ?? ''}>`;

    // No credentials is a valid dev setup — log once and no-op on send rather
    // than crashing the whole app at boot.
    if (!user || !pass) {
      this.logger.warn(
        'MAIL_USER / MAIL_PASS not set — emails will be skipped (logged, not sent).',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST') ?? 'smtp.gmail.com',
      port: Number(this.config.get<string>('MAIL_PORT') ?? 465),
      // 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: Number(this.config.get<string>('MAIL_PORT') ?? 465) === 465,
      auth: { user, pass },
    });
  }

  /** Verify the SMTP login at boot so bad credentials surface immediately. */
  async onModuleInit(): Promise<void> {
    if (!this.transporter) return;

    try {
      await this.transporter.verify();
      this.logger.log(`SMTP ready — sending as ${this.from}`);
    } catch (error) {
      this.logger.error(
        `SMTP verification failed: ${this.describe(error)}. ` +
          'Emails will keep being attempted, but check MAIL_USER / MAIL_PASS.',
      );
    }
  }

  /**
   * The one function to send mail from anywhere in the app.
   *
   * ```ts
   * await this.mail.sendMail({
   *   email: 'john@example.com',
   *   name: 'John',
   *   text: 'Your dub is ready to download.',
   *   subject: 'Your dub is ready',
   *   cta: { label: 'Open Studio', url: 'https://thlabs.io/studio' },
   * });
   * ```
   */
  async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    const { email, name, text, throwOnError } = options;
    const subject = options.subject ?? `Hey ${name}, a note from TH Labs`;

    const template: TemplateOptions = {
      name,
      text,
      heading: options.heading,
      cta: options.cta,
      footnote: options.footnote,
    };

    if (!this.transporter) {
      this.logger.warn(`Email to ${email} skipped (SMTP not configured)`);
      return { sent: false, error: 'SMTP not configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text: renderText(template),
        html: options.html ?? renderEmail(template),
      });

      this.logger.log(`Email sent to ${email} — ${subject}`);
      return { sent: true, messageId: info.messageId };
    } catch (error) {
      const message = this.describe(error);
      this.logger.error(`Email to ${email} failed: ${message}`);

      if (throwOnError) throw error;
      return { sent: false, error: message };
    }
  }

  // ── The automatic emails ─────────────────────────────────────────────────
  // Callers fire these and move on: each swallows its own failures, so a
  // bounced email can never turn a successful signup into a 500.

  /** Someone joined the community from the landing page. */
  sendCommunityWelcome(email: string, name: string): Promise<SendMailResult> {
    return this.sendMail({
      email,
      subject: `▶ Player 2 has entered — welcome to TH Labs, ${name}`,
      ...communityWelcomeTemplate(name, this.appUrl),
    });
  }

  /** Someone registered an account. */
  sendSignupWelcome(email: string, name: string): Promise<SendMailResult> {
    return this.sendMail({
      email,
      subject: `▶ Insert coin — your TH Labs account is ready, ${name}`,
      ...signupWelcomeTemplate(name, this.appUrl),
    });
  }

  /** Someone left feedback from inside the app. */
  sendFeedbackReceipt(email: string, name: string): Promise<SendMailResult> {
    return this.sendMail({
      email,
      subject: `▶ Message received — thanks, ${name}`,
      ...feedbackReceiptTemplate(name, this.appUrl),
    });
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
