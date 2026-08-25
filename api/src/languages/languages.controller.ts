import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';

import { LanguagesService } from './languages.service';
import {
  LanguageListResponseDto,
  LanguageResponseDto,
} from './dto/language-response.dto';

/**
 * The public language catalog: GET /v1/languages.
 *
 * Public on purpose. The landing page and the Studio's target picker both read
 * it before anyone signs in, and it contains nothing user-specific.
 */
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  @Get()
  @ApiOperation({ summary: 'List supported dubbing languages (public)' })
  @ApiOkResponse({ type: LanguageListResponseDto })
  async findAll(): Promise<LanguageListResponseDto> {
    return { languages: await this.languagesService.findAll() };
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get one language by its short code (public)' })
  @ApiParam({ name: 'code', example: 'uz' })
  @ApiOkResponse({ type: LanguageResponseDto })
  findOne(@Param('code') code: string): Promise<LanguageResponseDto> {
    return this.languagesService.findOne(code);
  }
}
