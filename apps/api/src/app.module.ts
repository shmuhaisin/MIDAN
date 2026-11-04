import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications/applications.controller';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController, JobsController, OrganizationsController, ApplicationsController, MeController],
})
export class AppModule {}
