import { ServiceUnavailableException } from '@nestjs/common';

import type { MailService, SendMailResult } from '../mail/mail.service';
import { AdminMailService } from './admin-mail.service';
import type { SendAdminMailDto } from './dto/send-admin-mail.dto';

describe('AdminMailService', () => {
  let sendMail: jest.Mock<Promise<SendMailResult>, [Record<string, unknown>]>;
  let service: AdminMailService;

  const dto = (
    overrides: Partial<SendAdminMailDto> = {},
  ): SendAdminMailDto => ({
    recipients: [{ email: 'ada@example.com', name: 'Ada' }],
    subject: 'Re: Dub drifts',
    message: 'Thanks!\n\nIt is fixed now.',
    ...overrides,
  });

  beforeEach(() => {
    sendMail = jest
      .fn<Promise<SendMailResult>, [Record<string, unknown>]>()
      .mockResolvedValue({ sent: true, messageId: 'm1' });
    service = new AdminMailService({ sendMail } as unknown as MailService);
  });

  it('sends one branded email per recipient with the given fields', async () => {
    const result = await service.send(dto({ heading: 'It is fixed' }));

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      name: 'Ada',
      subject: 'Re: Dub drifts',
      text: 'Thanks!\n\nIt is fixed now.',
      heading: 'It is fixed',
    });
    expect(result).toEqual({ total: 1, sent: 1, failed: [] });
  });

  it('sends duplicate emails once, ignoring case', async () => {
    const result = await service.send(
      dto({
        recipients: [
          { email: 'ada@example.com' },
          { email: 'ADA@Example.com' },
          { email: 'bob@example.com' },
          { email: 'bob@example.com' },
        ],
      }),
    );

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map(([o]) => o.email)).toEqual([
      'ada@example.com',
      'bob@example.com',
    ]);
    expect(result).toEqual({ total: 2, sent: 2, failed: [] });
  });

  it('falls back to the part before the @ when there is no name', async () => {
    await service.send(
      dto({
        recipients: [
          { email: 'grace.hopper@example.com' },
          { email: 'linus@example.com', name: '   ' },
        ],
      }),
    );

    expect(sendMail.mock.calls.map(([o]) => o.name)).toEqual([
      'grace.hopper',
      'linus',
    ]);
  });

  it('passes a blank heading as undefined so the template greeting is used', async () => {
    await service.send(dto({ heading: '  ' }));

    expect(sendMail.mock.calls[0][0].heading).toBeUndefined();
  });

  it('throws 503 when SMTP is not configured, without trying the rest', async () => {
    sendMail.mockResolvedValue({ sent: false, error: 'SMTP not configured' });

    await expect(
      service.send(
        dto({
          recipients: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('reports per-recipient failures without failing the batch', async () => {
    sendMail
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false, error: 'Mailbox unavailable' })
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false });

    const result = await service.send(
      dto({
        recipients: [
          { email: 'a@example.com' },
          { email: 'b@example.com' },
          { email: 'c@example.com' },
          { email: 'd@example.com' },
        ],
      }),
    );

    expect(sendMail).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      total: 4,
      sent: 2,
      failed: [
        { email: 'b@example.com', error: 'Mailbox unavailable' },
        { email: 'd@example.com', error: 'Unknown error' },
      ],
    });
  });

  it('sends in sequence, never in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    sendMail.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return { sent: true };
    });

    await service.send(
      dto({
        recipients: [
          { email: 'a@example.com' },
          { email: 'b@example.com' },
          { email: 'c@example.com' },
        ],
      }),
    );

    expect(maxInFlight).toBe(1);
  });
});
