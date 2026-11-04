import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'The Core API process is up.' })
  check() {
    return { status: 'ok', service: 'midan-core-api' };
  }
}
