import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

import { BearerToken } from '../common/decorators/bearer-token.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateProjectDto,
  ImportAssetDto,
  SubtitlesDto,
  UpdateProjectDto,
} from './dto/editor.dto';
import { EditorService } from './editor.service';

const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
// Uploads stream to disk, never into memory — a video is gigabytes. They land
// in data/tmp and the service moves them into the project.
const UPLOAD_TMP = path.join(
  path.resolve(
    process.env.API_DATA_DIR?.trim() || path.join(process.cwd(), 'data'),
  ),
  'tmp',
);

@ApiTags('editor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('editor/projects')
export class EditorController {
  constructor(private readonly editor: EditorService) {}

  @Get()
  @ApiOperation({ summary: 'Your video editor projects (Studio Max)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.editor.list(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Start a project with empty Video, Voice and Music tracks',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.editor.create(user.id, dto.name);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One project, with its files and timeline' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.editor.get(user.id, id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Save the name and/or the whole timeline (autosave)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.editor.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project and its files' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.editor.remove(user.id, id);
  }

  @Post(':id/assets')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a video, voice or music file (up to 2 GB)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(UPLOAD_TMP, { recursive: true });
          cb(null, UPLOAD_TMP);
        },
        filename: (_req, file, cb) =>
          cb(
            null,
            `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname).slice(0, 8)}`,
          ),
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.editor.upload(user.id, id, file);
  }

  @Post(':id/assets/import')
  @ApiOperation({
    summary: 'Bring in finished text-to-speech or a finished dub',
  })
  importAsset(
    @CurrentUser() user: AuthenticatedUser,
    @BearerToken() token: string,
    @Param('id') id: string,
    @Body() dto: ImportAssetDto,
  ) {
    return this.editor.importAsset(user.id, token, id, dto);
  }

  @Delete(':id/assets/:assetId')
  @ApiOperation({ summary: 'Remove a file no clip uses' })
  removeAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ) {
    return this.editor.removeAsset(user.id, id, assetId);
  }

  @Post(':id/assets/:assetId/subtitles')
  @ApiOperation({
    summary:
      "Auto subtitles: one file's speech as timed subtitle lines (CapCut style)",
  })
  subtitles(
    @CurrentUser() user: AuthenticatedUser,
    @BearerToken() token: string,
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Body() dto: SubtitlesDto,
  ) {
    return this.editor.subtitles(user.id, token, id, assetId, dto.language);
  }

  @Post(':id/render')
  @ApiOperation({
    summary: 'Export the timeline to one MP4 (poll the project for progress)',
  })
  render(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.editor.render(user.id, id);
  }
}
