import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsController } from './applications/applications.controller';
import { TokenThrottlerGuard } from './common/token-throttler.guard';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';

@Module({
  imports: [DbModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  providers: [{ provide: APP_GUARD, useClass: TokenThrottlerGuard }],
  controllers: [HealthController, JobsController, OrganizationsController, ApplicationsController, MeController],
})
export class AppModule {}
