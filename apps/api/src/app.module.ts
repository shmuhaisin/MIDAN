import { InvitationContextController } from './organizations/invitation-context.controller';
import { MembersController } from './organizations/members.controller';
import { InvitationMailer } from './organizations/invitation-mailer';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsController } from './applications/applications.controller';
import { TokenThrottlerGuard } from './common/token-throttler.guard';
import { AiClient } from './ai/ai.client';
import { AssessmentsController } from './assessments/assessments.controller';
import { AttemptsController } from './attempts/attempts.controller';
import { DbModule } from './db/db.module';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { SkillsController } from './jobs/skills.controller';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';

@Module({
  imports: [DbModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  providers: [InvitationMailer, AiClient, { provide: APP_GUARD, useClass: TokenThrottlerGuard }],
  controllers: [
    InvitationContextController, MembersController, HealthController, JobsController, SkillsController, OrganizationsController, ApplicationsController, MeController,
    AssessmentsController, AttemptsController, EvaluationsController,
  ],
})
export class AppModule {}
