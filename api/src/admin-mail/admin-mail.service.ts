import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { MailService } from '../mail/mail.service';
import { SendAdminMailDto } from './dto/send-admin-mail.dto';

export interface AdminMailResult {
  total: number;
  sent: number;
  failed: Array<{ email: string; error: string }>;
}

const SMTP_OFF = 'SMTP not configured';

@Injectable()
export class AdminMailService {
  constructor(private readonly mail: MailService) {}

  /**
   * One message per recipient, in sequence.
   *
   * Sequential on purpose: SMTP servers (Gmail especially) throttle bursts of
   * parallel connections, and a partial failure is reported per address rather
   * than failing the whole batch.
   */
  async send(dto: SendAdminMailDto): Promise<AdminMailResult> {
    const seen = new Set<string>();
    const recipients = dto.recipients.filter((r) => {
      const key = r.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const failed: AdminMailResult['failed'] = [];
    let sent = 0;

    for (const recipient of recipients) {
      const name = recipient.name?.trim() || recipient.email.split('@')[0];
      const result = await this.mail.sendMail({
        email: recipient.email,
        name,
        subject: dto.subject,
        text: dto.message,
        // A blank heading would render an empty headline instead of the
        // template's greeting, which only kicks in on undefined.
        heading: dto.heading?.trim() || undefined,
        footnote: 'You can reply to this email directly. It reaches our team.',
      });

      // No credentials on this deploy — every send would be skipped the same
      // way, so say so once instead of reporting N identical failures.
      if (!result.sent && result.error === SMTP_OFF) {
        throw new ServiceUnavailableException(
          'Email is not configured on the API — set MAIL_USER and MAIL_PASS.',
        );
      }

      if (result.sent) sent += 1;
      else
        failed.push({
          email: recipient.email,
          error: result.error ?? 'Unknown error',
        });
    }

    return { total: recipients.length, sent, failed };
  }
}
