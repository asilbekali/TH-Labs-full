import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { HealthService } from './health.service';
import { HealthResponseDto } from './dto/health-response.dto';

/**
 * GET /v1/health — one call that answers "can I dub right now?".
 *
 * It reports this API, its database, and the dubbing pipeline behind it. The
 * pipeline used to be asked directly by the browser, so the whole Studio showed
 * a red "service unreachable" the moment the GPU box slept, even though
 * sign-in, plans and the library were all fine. Answering here separates the
 * two: this route stays 200 while `pipeline` tells the truth about the rest.
 *
 * Public — the landing page renders it before anyone signs in.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'API, database and dubbing pipeline status (public)' })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}
