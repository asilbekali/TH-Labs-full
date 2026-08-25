import { Injectable, NotFoundException } from '@nestjs/common';
import { Language } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { LanguageResponseDto } from './dto/language-response.dto';

// Storage columns the picker has no use for. Stripping them keeps the response
// byte-identical to what the pipeline used to serve.
function toResponse(row: Language): LanguageResponseDto {
  return {
    code: row.code,
    name: row.name,
    native: row.native,
    flag: row.flag,
    whisper: row.whisper,
    nllb: row.nllb,
  };
}

@Injectable()
export class LanguagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active languages in picker order.
   *
   * Deactivated rows are hidden here but still resolve through findOne, so a
   * job created against a language that was retired mid-flight can still be
   * described.
   */
  async findAll(): Promise<LanguageResponseDto[]> {
    const rows = await this.prisma.language.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async findOne(code: string): Promise<LanguageResponseDto> {
    // Codes are lowercase in the table; a picker or a hand-written curl may
    // send "EN". Normalising here beats a 404 that looks like a missing row.
    const row = await this.prisma.language.findUnique({
      where: { code: code.trim().toLowerCase() },
    });

    if (!row) throw new NotFoundException(`Language "${code}" is not supported`);

    return toResponse(row);
  }

  /** How many languages are live — used by the health check. */
  count(): Promise<number> {
    return this.prisma.language.count({ where: { active: true } });
  }
}
