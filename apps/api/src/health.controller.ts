import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DbService } from './db/db.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOkResponse({ description: 'The Core API process is up.' })
  check() {
    return { status: 'ok', service: 'midan-core-api' };
  }

  @Get('db')
  @ApiOkResponse({ description: 'The Core API can reach the database, as a restricted role.' })
  async database() {
    const [row] = await this.db.asAnon((tx) =>
      tx.$queryRaw<{ login: string; role: string; bypass_rls: boolean }[]>`
        select session_user as login, current_user as role,
          (select rolbypassrls from pg_roles where rolname = session_user) as bypass_rls`,
    );
    return { status: 'ok', ...row };
  }
}
