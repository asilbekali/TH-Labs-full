import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackStatus, Prisma } from '@prisma/client';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListFeedbackDto } from './dto/list-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';

/** Who sent it, when the request carried a verified token. */
export interface FeedbackSender {
  id: number;
  email: string;
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * File a message. `sender` is present only when a bearer token came with the
   * request (see OptionalJwtAuthGuard).
   *
   * Identity is the server's job, not the form's. A signed-in caller posts
   * nothing but `message` and the account behind the token supplies the rest:
   * the id, the email and — with one lookup — the name. `createdAt` is the
   * row's own default, so "when" is the server's clock and not a timestamp the
   * client could get wrong or invent.
   *
   * The name lookup is what makes the short form possible. The JWT carries only
   * id/email/role, so without reading the User row every message from inside
   * the app would land in the panel as an email address with no name attached.
   *
   * An anonymous caller must still supply both — there is nothing to read them
   * from — and gets a 400 naming exactly what is missing rather than a
   * validation error about a field the app never showed them.
   *
   * No unique constraint and no duplicate check on purpose: the same person
   * legitimately sends more than one message, and silently rejecting the second
   * one as a duplicate is how a follow-up bug report disappears.
   */
  async create(
    dto: CreateFeedbackDto,
    sender: FeedbackSender | undefined,
    userAgent: string | undefined,
  ) {
    const account = sender
      ? await this.prisma.user.findUnique({
          where: { id: sender.id },
          select: { name: true, email: true },
        })
      : null;

    // The token wins over the body for identity: a signed-in sender cannot file
    // a message under somebody else's account by editing the payload.
    const email = account?.email ?? sender?.email ?? dto.email;
    const name = account?.name ?? dto.name;

    if (!email || !name) {
      throw new BadRequestException(
        'Sign in, or send your name and email with the message.',
      );
    }

    const entry = await this.prisma.feedback.create({
      data: {
        userId: sender?.id ?? null,
        email,
        name,
        subject: dto.subject ?? null,
        message: dto.message,
        ...(dto.kind !== undefined && { kind: dto.kind }),
        rating: dto.rating ?? null,
        pagePath: dto.pagePath ?? null,
        // Truncated rather than rejected: a long UA string is a browser quirk,
        // not a reason to lose the message.
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    });

    // Fire-and-forget, exactly like CommunityService.create: the message is
    // already saved and MailService swallows its own failures, so a bounced
    // receipt cannot undo a good submission.
    void this.mail.sendFeedbackReceipt(entry.email, entry.name);

    // Only what the sender needs to see it worked. The triage fields
    // (`status`, `adminNote`) are staff-facing and are not echoed to a public
    // caller.
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      message: 'Thanks — your feedback reached the team.',
    };
  }

  /** The panel's inbox: newest first, paginated, filterable. */
  async findAll(query: ListFeedbackDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const q = query.q?.trim();
    const where: Prisma.FeedbackWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.kind && { kind: query.kind }),
      ...(q && {
        OR: [
          { subject: { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, items, newCount] = await this.prisma.$transaction([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      // Unfiltered on purpose: the panel's unread badge must not change
      // depending on which tab the admin happens to be looking at.
      this.prisma.feedback.count({ where: { status: FeedbackStatus.NEW } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      newCount,
    };
  }

  async findOne(id: number) {
    const entry = await this.prisma.feedback.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`Feedback #${id} not found`);
    return entry;
  }

  /** Triage: move the status, attach a private note. Never edits the message. */
  async update(id: number, dto: UpdateFeedbackDto) {
    await this.findOne(id);
    return this.prisma.feedback.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.adminNote !== undefined && { adminNote: dto.adminNote }),
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.feedback.delete({ where: { id } });
    return { message: `Feedback #${id} removed` };
  }
}
